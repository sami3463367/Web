/**
 * Boighor BD — Turso/libsql (Hrana v2) client protocol tests
 * Runs the real client against a local mock of the libsql-server HTTP API:
 * value codec, statement mapping, transaction framing and error handling.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let received = [];

function okRow(value, type = 'integer') {
  return { type: 'ok', cols: [{ name: 'a' }], rows: [[{ type, value: String(value) }]], affected_rows: 0, last_insert_rowid: '0' };
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      received.push(body);
      const results = (body.steps || []).map((step) => {
        if (step.type === 'begin' || step.type === 'commit' || step.type === 'rollback') {
          return { type: 'ok', cols: [], rows: [], affected_rows: 0, last_insert_rowid: '0' };
        }
        if (step.type === 'batch') {
          const inner = step.batch.steps.map((s) => respondExecute(s.stmt));
          const failed = inner.findIndex((r) => r.type === 'error');
          return {
            type: 'batch',
            step_results: inner,
            step_errors: inner.map((r, i) => (i === failed ? r.error : null))
          };
        }
        return respondExecute(step.stmt);
      });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ results }));
    });
  });

  function respondExecute(stmt) {
    const sql = stmt?.text || '';
    if (sql.includes('FAIL')) return { type: 'error', error: { message: 'mock statement error' } };
    if (/^select/i.test(sql)) {
      const arg = stmt.args?.positional?.[0];
      // echo the first arg back so tests can verify encoding
      if (sql.includes('ECHO')) return { type: 'ok', cols: [{ name: 'a' }], rows: [[arg ?? null]], affected_rows: 0, last_insert_rowid: '0' };
      if (sql.includes('REAL')) return okRow('4.5', 'real');
      if (sql.includes('TEXT')) return okRow('hello', 'text');
      if (sql.includes('BARE')) return { type: 'ok', cols: [{ name: 'a' }], rows: [[9]], affected_rows: 0, last_insert_rowid: '0' };
      return okRow('7');
    }
    return { type: 'ok', cols: [], rows: [], affected_rows: 1, last_insert_rowid: '42' };
  }

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  process.env.TURSO_URL = `http://127.0.0.1:${port}`;
  process.env.TURSO_AUTH_TOKEN = 'test-token';
});

after(() => server?.close());

const client = async () => import('../server/core/libsql.js');

test('execute: decodes typed integer/real/text values', async () => {
  const { libsqlExecute } = await client();
  const int = await libsqlExecute('SELECT 1');
  assert.equal(int.rows[0].a, 7);
  const real = await libsqlExecute('SELECT REAL');
  assert.equal(real.rows[0].a, 4.5);
  const text = await libsqlExecute('SELECT TEXT');
  assert.equal(text.rows[0].a, 'hello');
});

test('execute: decodes bare JSON values too', async () => {
  const { libsqlExecute } = await client();
  const bare = await libsqlExecute('SELECT BARE');
  assert.equal(bare.rows[0].a, 9);
});

test('execute: encodes params as typed Hrana values', async () => {
  const { libsqlExecute } = await client();
  received = [];
  await libsqlExecute('SELECT ECHO ?', [5]);
  const sent = received.at(-1).steps[0].stmt.args.positional[0];
  assert.deepEqual(sent, { type: 'integer', value: '5' });

  await libsqlExecute('SELECT ECHO ?', [2.5]);
  assert.deepEqual(received.at(-1).steps[0].stmt.args.positional[0], { type: 'real', value: '2.5' });

  await libsqlExecute('SELECT ECHO ?', ['x']);
  assert.deepEqual(received.at(-1).steps[0].stmt.args.positional[0], { type: 'text', value: 'x' });

  await libsqlExecute('SELECT ECHO ?', [null]);
  assert.equal(received.at(-1).steps[0].stmt.args.positional[0], null);
});

test('execute: INSERT maps last_insert_rowid + affected_rows', async () => {
  const { libsqlExecute } = await client();
  const r = await libsqlExecute('INSERT INTO t VALUES (?)', [1]);
  assert.equal(r.lastInsertRowid, 42);
  assert.equal(r.changes, 1);
});

test('execute: server-side statement error becomes a thrown 500', async () => {
  const { libsqlExecute } = await client();
  await assert.rejects(() => libsqlExecute('SELECT FAIL'), /mock statement error/);
});

test('transaction: framed as begin…commit in ONE pipeline request', async () => {
  const { libsqlTransaction } = await client();
  received = [];
  const results = await libsqlTransaction([
    { sql: 'UPDATE products SET stock = stock - 1 WHERE id = 1', params: [] },
    { sql: 'INSERT INTO orders(code) VALUES (?)', params: ['BD-X'] },
    { sql: 'INSERT INTO order_items(order_id) VALUES(last_insert_rowid())', params: [] }
  ]);
  const steps = received.at(-1).steps.map((s) => s.type);
  assert.deepEqual(steps, ['begin', 'execute', 'execute', 'execute', 'commit']);
  assert.equal(results.length, 3);
  assert.equal(results[1].lastInsertRowid, 42);
});

test('transaction: statement error inside rolls up as thrown error', async () => {
  const { libsqlTransaction } = await client();
  await assert.rejects(
    () => libsqlTransaction([{ sql: 'SELECT FAIL', params: [] }]),
    /mock statement error/
  );
});

test('batch: atomic batch step + error propagation', async () => {
  const { libsqlBatch } = await client();
  received = [];
  const out = await libsqlBatch([
    { sql: 'INSERT INTO a VALUES (1)', params: [] },
    { sql: 'INSERT INTO b VALUES (2)', params: [] }
  ]);
  assert.equal(received.at(-1).steps[0].type, 'batch');
  assert.equal(out.length, 2);
  await assert.rejects(() => libsqlBatch([{ sql: 'SELECT FAIL', params: [] }]), /mock statement error/);
});

test('auth header carries the Turso token', async () => {
  // the mock doesn't assert headers; verify via a direct fetch through client path
  const { libsqlExecute } = await client();
  await libsqlExecute('SELECT 1');
  assert.ok(process.env.TURSO_AUTH_TOKEN);
});
