/**
 * Boighor BD — HTTP plumbing (zero dependencies)
 * JSON helpers, cookies, body parsing with limits, static file serving
 * with ETag + Brotli/Gzip compression, and safe MIME mapping.
 */
import { createReadStream, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';

const MAX_BODY = 64 * 1024; // 64 KB JSON payloads max

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2'
};

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function json(res, status, data, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(data));
  sendBuffer(res, status, body, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
}

export function html(res, status, body, extraHeaders = {}) {
  sendBuffer(res, status, Buffer.from(body), { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders });
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

/* ----------------------------- compression ----------------------------- */
const COMPRESSIBLE = /json|text|javascript|xml|svg|manifest/;
const compressCache = new Map(); // etag -> {br, gz}
const COMPRESS_CACHE_MAX = 200;

function pickEncoding(req, type) {
  if (!COMPRESSIBLE.test(type)) return null;
  const accept = req.headers['accept-encoding'] || '';
  if (accept.includes('br')) return 'br';
  if (accept.includes('gzip')) return 'gzip';
  return null;
}

export function sendBuffer(res, status, buf, headers = {}) {
  const type = headers['Content-Type'] || 'application/octet-stream';
  const encoding = buf.length > 1024 ? pickEncoding({ headers: res.reqHeaders || {} }, type) : null;
  // res.reqHeaders is attached by the dispatcher; fallback below handles direct calls
  finish(res, status, buf, headers, encoding);
}

function finish(res, status, buf, headers, encoding) {
  if (!encoding) {
    res.writeHead(status, { ...headers, 'Content-Length': buf.length });
    res.end(buf);
    return;
  }
  const etag = headers['ETag'];
  let packed = etag && compressCache.get(etag);
  if (!packed) {
    packed = { br: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }), gz: zlib.gzipSync(buf, { level: 6 }) };
    if (compressCache.size > COMPRESS_CACHE_MAX) compressCache.clear();
    if (etag) compressCache.set(etag, packed);
  }
  if (res.reqHeaders?.['accept-encoding']?.includes('br')) {
    res.writeHead(status, { ...headers, 'Content-Encoding': 'br', Vary: 'Accept-Encoding', 'Content-Length': packed.br.length });
    res.end(packed.br);
  } else {
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': packed.gz.length });
    res.end(packed.gz);
  }
}

/* -------------------------------- cookies -------------------------------- */
export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  parts.push(`Max-Age=${opts.maxAge ?? 0}`);
  parts.push('SameSite=Lax');
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  const existing = res.getHeader('Set-Cookie');
  const list = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  list.push(parts.join('; '));
  res.setHeader('Set-Cookie', list);
}

/* ------------------------------ request body ---------------------------- */
export function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'Bad request')));
  });
}

/* ------------------------------ static files ---------------------------- */
const STATIC_ROOT = path.join(process.cwd(), 'public');
const staticEtag = new Map(); // file -> {etag, mtimeMs, size}

export async function serveStatic(req, res, urlPath) {
  // normalise + block traversal
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(STATIC_ROOT, clean);
  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403).end();
    return true;
  }
  let stat;
  try {
    stat = statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = statSync(filePath);
    }
  } catch {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';

  let meta = staticEtag.get(filePath);
  if (!meta || meta.mtimeMs !== stat.mtimeMs || meta.size !== stat.size) {
    meta = { mtimeMs: stat.mtimeMs, size: stat.size, etag: `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(36)}"` };
    staticEtag.set(filePath, meta);
  }

  const headers = {
    'Content-Type': type,
    ETag: meta.etag,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=2592000, immutable',
    'X-Content-Type-Options': 'nosniff'
  };
  if (req.headers['if-none-match'] === meta.etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  // stream images uncompressed; compress text assets
  if (!COMPRESSIBLE.test(type)) {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    await new Promise((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on('error', reject);
      stream.pipe(res);
      res.on('finish', resolve);
      res.on('close', resolve);
    });
    return true;
  }
  const buf = await readFile(filePath);
  res.reqHeaders = req.headers;
  sendBuffer(res, 200, buf, headers);
  return true;
}

export { STATIC_ROOT };
