/**
 * Boighor BD — Account API (register / login / logout / profile)
 */
import { Router } from '../core/router.js';
import { get, run } from '../core/db.js';
import { hashPassword, verifyPassword, createSession, destroySession, currentUser, publicUser, requireUser, throttle } from '../core/auth.js';
import { requireName, requireBdPhone, optionalEmail, requireAddress, requirePassword } from '../core/validate.js';
import { readJson, json, HttpError } from '../core/http.js';

const router = new Router();

router.get('/api/me', async (req, res) => {
  res.json(200, { user: publicUser(await currentUser(req)) });
});

router.post('/api/auth/register', async (req, res) => {
  throttle(`register:${req.ip}`, 8);
  const body = await readJson(req);
  const name = requireName(body.name);
  const phone = requireBdPhone(body.phone);
  const email = optionalEmail(body.email);
  const address = requireAddress(body.address);
  const password = requirePassword(body.password);

  if (await get('SELECT id FROM users WHERE phone = ?', phone)) {
    throw new HttpError(409, 'An account with this mobile number already exists — please sign in', { field: 'phone' });
  }
  if (email && await get('SELECT id FROM users WHERE email = ?', email)) {
    throw new HttpError(409, 'An account with this email already exists', { field: 'email' });
  }
  const result = await run(
    `INSERT INTO users(name, phone, email, password_hash, address, role) VALUES(?,?,?,?,?, 'customer')`,
    name, phone, email, hashPassword(password), address
  );
  await createSession(res, Number(result.lastInsertRowid));
  const user = await get('SELECT id,name,phone,email,address,role,created_at FROM users WHERE id=?', Number(result.lastInsertRowid));
  res.json(201, { user: publicUser(user) });
});

router.post('/api/auth/login', async (req, res) => {
  throttle(`login:${req.ip}`, 10);
  const body = await readJson(req);
  const identifier = String(body.phone || body.email || '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!identifier || !password) throw new HttpError(422, 'Enter your mobile number and password');

  const user = identifier.includes('@')
    ? await get('SELECT * FROM users WHERE email = ?', identifier)
    : await get('SELECT * FROM users WHERE phone = ?', identifier.replace(/^\+?880/, '0').replace(/^880/, '0') || identifier);

  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'Incorrect mobile number or password');
  }
  await createSession(res, user.id);
  res.json(200, { user: publicUser(user) });
});

router.post('/api/auth/logout', async (req, res) => {
  await destroySession(req, res);
  res.json(200, { ok: true });
});

router.patch('/api/me', async (req, res) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const name = body.name !== undefined ? requireName(body.name) : user.name;
  const address = body.address !== undefined ? requireAddress(body.address) : user.address;
  const email = body.email !== undefined ? optionalEmail(body.email) : user.email;
  if (email && email !== user.email && await get('SELECT id FROM users WHERE email=? AND id!=?', email, user.id)) {
    throw new HttpError(409, 'That email is already in use', { field: 'email' });
  }
  await run('UPDATE users SET name=?, address=?, email=? WHERE id=?', name, address, email, user.id);
  res.json(200, { user: publicUser(await get('SELECT id,name,phone,email,address,role,created_at FROM users WHERE id=?', user.id)) });
});

router.post('/api/auth/password', async (req, res) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const full = await get('SELECT password_hash FROM users WHERE id=?', user.id);
  if (!verifyPassword(String(body.current || ''), full.password_hash)) {
    throw new HttpError(401, 'Current password is incorrect');
  }
  await run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(requirePassword(body.next)), user.id);
  res.json(200, { ok: true });
});

export default router;
