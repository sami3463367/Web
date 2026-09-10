/**
 * Boighor BD — Server-side rendering of page shells
 * Templates are plain HTML files in /public with [[TOKEN]] placeholders.
 * SSR gives mobile users on slow BD networks a meaningful first paint
 * (and search engines real content) while the client hydrates afterwards.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'public');
const cache = new Map();

export function template(name) {
  const file = path.join(ROOT, name);
  const stat = statSync(file);
  const hit = cache.get(name);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.html;
  const html = readFileSync(file, 'utf8');
  cache.set(name, { mtimeMs: stat.mtimeMs, html });
  return html;
}

export function render(name, tokens = {}) {
  let html = template(name);
  for (const [key, value] of Object.entries(tokens)) {
    html = html.split(`[[${key}]]`).join(value);
  }
  return html;
}
