/**
 * Boighor BD — Micro router (zero dependencies)
 * Supports :params, wildcards, middleware-style handler chains and
 * automatic async error propagation.
 */
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, ...handlers) {
    const keys = [];
    const regexSrc = pattern
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        if (seg === '*') return '(.*)';
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method, regex: new RegExp(`^${regexSrc}/?$`), keys, handlers });
    return this;
  }

  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  put(p, ...h) { return this.add('PUT', p, ...h); }
  patch(p, ...h) { return this.add('PATCH', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }

  /**
   * Match routes in registration order. A route whose handlers finish the
   * response wins; a route that does NOT end the response (e.g. an auth
   * guard like `GET /api/admin/*`) acts as middleware and falls through to
   * the next matching route.
   * @returns {Promise<boolean>} true when some route handled the request
   */
  async handle(req, res, url) {
    for (const route of this.routes) {
      if (route.method !== req.method && !(route.method === 'GET' && req.method === 'HEAD')) continue;
      const m = url.pathname.match(route.regex);
      if (!m) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      req.params = params;
      for (const handler of route.handlers) {
        await handler(req, res);
        if (res.writableEnded) return true;
      }
      // fell through → middleware; keep matching subsequent routes
    }
    return false;
  }
}
