/**
 * Boighor BD — Turso / libsql client over the Hrana v2 HTTP protocol
 * ------------------------------------------------------------------
 * Zero dependencies (global fetch). Used automatically when TURSO_URL is
 * set (e.g. on Vercel); otherwise the app uses embedded node:sqlite.
 *
 * Wire format notes (Hrana v2):
 *   POST {TURSO_URL}/v2/pipeline   {"baton":null,"steps":[…]}
 *   step  {"type":"execute","stmt":{"text":sql,"args":{"positional":[Value…]}}}
 *         {"type":"batch","batch":{"steps":[{"stmt":…}]}}   ← atomic
 *         {"type":"begin"|"commit"|"rollback"}
 *   Value  null | {"type":"integer"|"real"|"text","value":string} | bare JSON
 *   result {"type":"ok",cols,rows,affected_rows,last_insert_rowid}
 *          {"type":"error",error:{message}}
 *          {"type":"batch",step_results:[…],step_errors:[…]}
 */
import { HttpError } from './http.js';

const URL = () => `${String(process.env.TURSO_URL).replace(/\/$/, '')}/v2/pipeline`;
const TOKEN = () => process.env.TURSO_AUTH_TOKEN || '';

export function libsqlConfigured() {
  return Boolean(process.env.TURSO_URL && process.env.TURSO_AUTH_TOKEN);
}

/* ------------------------------ value codec ----------------------------- */
function encodeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { type: 'integer', value: String(v) }
      : { type: 'real', value: String(v) };
  }
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (v instanceof Uint8Array) return { type: 'blob', value: Buffer.from(v).toString('base64') };
  return { type: 'text', value: String(v) };
}

export function decodeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;               // bare JSON scalar
  switch (v.type) {
    case 'integer': return Number(v.value);
    case 'real': return Number(v.value);
    case 'null': return null;
    case 'blob': return Buffer.from(String(v.value), 'base64');
    default: return v.value;                          // text & unknown
  }
}

function rowsToObjects(result) {
  const cols = (result.cols || []).map((c) => c.name);
  return (result.rows || []).map((row) => {
    const obj = {};
    row.forEach((cell, i) => { obj[cols[i]] = decodeValue(cell); });
    return obj;
  });
}

/* ------------------------------- pipeline ------------------------------- */
async function pipeline(steps) {
  let res;
  try {
    res = await fetch(URL(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN()}`
      },
      body: JSON.stringify({ baton: null, steps })
    });
  } catch {
    throw new HttpError(503, 'Database unreachable — please retry');
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(500, 'Turso auth rejected — check TURSO_AUTH_TOKEN');
  if (!res.ok) throw new HttpError(503, `Database error (HTTP ${res.status})`);
  const body = await res.json();
  return body.results || [];
}

const stmtStep = (sql, params) => ({
  type: 'execute',
  stmt: { text: sql, args: { positional: params.map(encodeValue) } }
});

function okResult(result, sql) {
  if (!result) throw new HttpError(500, 'Empty database response');
  if (result.type === 'error') throw new HttpError(500, result.error?.message || 'Database statement failed');
  return {
    rows: rowsToObjects(result),
    changes: Number(result.affected_rows ?? 0),
    lastInsertRowid: Number(result.last_insert_rowid ?? 0)
  };
}

/** Single statement. */
export async function libsqlExecute(sql, params = []) {
  const [result] = await pipeline([stmtStep(sql, params)]);
  if (result?.type === 'error') throw new HttpError(500, result.error?.message || 'Database statement failed', sql);
  return okResult(result, sql);
}

/**
 * Atomic transaction: [BEGIN, …statements…, COMMIT] in ONE pipeline request.
 * Later statements may use SQLite's last_insert_rowid() to reference ids
 * created by earlier statements in the same transaction.
 */
export async function libsqlTransaction(stmts) {
  const steps = [
    { type: 'begin' },
    ...stmts.map((s) => stmtStep(s.sql, s.params)),
    { type: 'commit' }
  ];
  const results = await pipeline(steps);
  // results[0] = begin, last = commit
  const inner = results.slice(1, results.length - 1);
  const failed = inner.findIndex((r) => r?.type === 'error');
  if (failed >= 0) {
    throw new HttpError(500, inner[failed].error?.message || 'Transaction statement failed');
  }
  return inner.map((r) => okResult(r));
}

/** Atomic multi-statement batch (chunk-friendly, no id chaining). */
export async function libsqlBatch(stmts) {
  if (!stmts.length) return [];
  const steps = [{
    type: 'batch',
    batch: { steps: stmts.map((s) => ({ stmt: { text: s.sql, args: { positional: s.params.map(encodeValue) } } })) }
  }];
  const [result] = await pipeline(steps);
  if (!result) throw new HttpError(500, 'Empty batch response');
  if (result.type === 'error') throw new HttpError(500, result.error?.message || 'Batch failed');
  const stepResults = result.step_results || result.results || [];
  const stepErrors = result.step_errors || [];
  const firstErr = stepErrors.findIndex((e) => e);
  if (firstErr >= 0) throw new HttpError(500, stepErrors[firstErr]?.message || 'Batch statement failed');
  const bad = stepResults.findIndex((r) => r?.type === 'error');
  if (bad >= 0) throw new HttpError(500, stepResults[bad].error?.message || 'Batch statement failed');
  return stepResults.map((r) => okResult(r));
}
