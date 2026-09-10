/**
 * Vercel serverless entry — Boighor BD
 * -------------------------------------
 * The entire app (storefront SSR + JSON API + admin) runs behind this one
 * function. Static assets (HTML shells are NOT static — they're SSR'd here;
 * /assets/*, images, favicon, manifest) are served by Vercel's CDN straight
 * from the `public/` output directory, so this function only handles
 * dynamic routes.
 *
 * Required env vars on Vercel (both free, no credit card):
 *   TURSO_URL           e.g. libsql://your-shop.turso.io
 *   TURSO_AUTH_TOKEN    from the Turso dashboard / `turso db tokens create`
 */
import { handler, ensureReady } from '../server/index.js';

export default async function (req, res) {
  await handler(req, res);
}

export const config = {
  maxDuration: 30
};

// warm the DB connection + settings cache at cold start
ensureReady().catch(() => {});
