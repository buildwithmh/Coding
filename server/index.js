'use strict';
const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_CODE = 128 * 1024;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
const auditPath = process.env.AUDIT_FILE || '/data/audit.log';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const RUNNER_URL = process.env.JAVA_RUNNER_URL || 'http://java-runner:3100';
const RUNNER_TOKEN = process.env.JAVA_RUNNER_TOKEN || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'mhcoder';

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; connect-src 'self' https:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
});

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'mysql', port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'mhcoder', password: process.env.MYSQL_PASSWORD || '', database: MYSQL_DATABASE,
  waitForConnections: true, connectionLimit: 5, queueLimit: 10, multipleStatements: false,
  supportBigNumbers: true, bigNumberStrings: true, dateStrings: true
});

function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function getSession(req) {
  const sid = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('mhcoder_sid='))?.slice('mhcoder_sid='.length);
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s || s.expires < Date.now()) { sessions.delete(sid); return null; }
  return { sid, ...s };
}
function requireAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ ok: false, error: 'Sign in to use the execution services.', authRequired: true });
  req.auth = s; next();
}
function requireCsrf(req, res, next) {
  if (!safeEqual(req.headers['x-csrf-token'] || '', req.auth.csrf)) return res.status(403).json({ ok: false, error: 'Security token expired. Refresh and sign in again.' });
  next();
}
async function audit(event, req, detail = {}) {
  const record = JSON.stringify({ at: new Date().toISOString(), event, ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '', detail });
  try { await fs.mkdir(path.dirname(auditPath), { recursive: true }); await fs.appendFile(auditPath, record + '\n', { mode: 0o600 }); } catch {}
}
function rateLimitLogin(req, res, next) {
  const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now();
  const arr = (loginAttempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  if (arr.length >= 8) return res.status(429).json({ ok: false, error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  loginAttempts.set(ip, arr); req.loginIp = ip; next();
}
const executionAttempts = new Map();
function rateLimitExecution(req, res, next) {
  const key = req.socket.remoteAddress || req.auth.sid; const now = Date.now();
  const arr = (executionAttempts.get(key) || []).filter(t => now - t < 60 * 1000);
  if (arr.length >= 30) return res.status(429).json({ ok: false, error: 'Execution limit reached. Wait one minute and try again.' });
  arr.push(now); executionAttempts.set(key, arr); next();
}


app.get('/api/auth/session', (req, res) => {
  const s = getSession(req); res.json({ authenticated: !!s, csrf: s?.csrf || null, expiresAt: s?.expires || null });
});
app.post('/api/auth/login', rateLimitLogin, async (req, res) => {
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 16) return res.status(503).json({ ok: false, error: 'Set a strong ADMIN_PASSWORD (at least 16 characters) in .env and restart MhCoder.' });
  const password = req.body?.password;
  if (typeof password !== 'string' || !safeEqual(password, ADMIN_PASSWORD)) {
    const arr = loginAttempts.get(req.loginIp) || []; arr.push(Date.now()); loginAttempts.set(req.loginIp, arr); await audit('login_failed', req); return res.status(401).json({ ok: false, error: 'Incorrect password.' });
  }
  const sid = crypto.randomBytes(32).toString('hex'); const csrf = crypto.randomBytes(24).toString('hex'); const expires = Date.now() + SESSION_TTL;
  sessions.set(sid, { csrf, expires }); loginAttempts.delete(req.loginIp);
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `mhcoder_sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}${secure}`);
  await audit('login_success', req); res.json({ ok: true, csrf, expiresAt: expires });
});
app.post('/api/auth/logout', requireAuth, requireCsrf, async (req, res) => {
  sessions.delete(req.auth.sid); res.setHeader('Set-Cookie', 'mhcoder_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  await audit('logout', req); res.json({ ok: true });
});

app.get('/api/health', async (_req, res) => {
  let mysqlStatus = 'unavailable'; try { await pool.query('SELECT 1'); mysqlStatus = 'connected'; } catch {}
  let runner = 'unavailable'; try { const r = await fetch(`${RUNNER_URL}/health`, { signal: AbortSignal.timeout(1500) }); if (r.ok) runner = 'connected'; } catch {}
  res.json({ ok: true, service: 'MhCoder backend', javaRunner: runner, mysql: mysqlStatus, auth: !!ADMIN_PASSWORD });
});

app.post('/api/java/run', requireAuth, requireCsrf, rateLimitExecution, async (req, res) => {
  const { filename = 'Main.java', code, input = '' } = req.body || {};
  if (typeof code !== 'string' || !code.trim()) return res.status(400).json({ ok: false, error: 'Java source code is required.' });
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE) return res.status(413).json({ ok: false, error: 'Java source is too large (128 KB limit).' });
  if (typeof filename !== 'string' || !/^[A-Za-z_$][\w$]*\.java$/.test(path.basename(filename))) return res.status(400).json({ ok: false, error: 'Use a valid Java filename, e.g. Main.java.' });
  try {
    const r = await fetch(`${RUNNER_URL}/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-runner-token': RUNNER_TOKEN }, body: JSON.stringify({ filename: path.basename(filename), code, input: String(input).slice(0, 16000) }), signal: AbortSignal.timeout(15000) });
    const data = await r.json(); await audit('java_execution', req, { filename: path.basename(filename), exitCode: data.exitCode ?? null });
    res.status(r.status).json(data);
  } catch (e) { res.status(503).json({ ok: false, error: `Java runner unavailable: ${e.message}` }); }
});

app.post('/api/mysql/query', requireAuth, requireCsrf, rateLimitExecution, async (req, res) => {
  const { database = MYSQL_DATABASE, sql } = req.body || {};
  if (typeof sql !== 'string' || !sql.trim()) return res.status(400).json({ ok: false, error: 'Enter an SQL query first.' });
  if (Buffer.byteLength(sql, 'utf8') > MAX_CODE) return res.status(413).json({ ok: false, error: 'SQL query is too large (128 KB limit).' });
  if (typeof database !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(database)) return res.status(400).json({ ok: false, error: 'Database name may contain only letters, numbers and underscores.' });
  const started = Date.now();
  try {
    const conn = await pool.getConnection();
    try {
      await conn.query(`USE \`${database}\``);
      const [result] = await conn.query({ sql, timeout: 8000 });
      if (Array.isArray(result)) {
        const rows = result.slice(0, 300).map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, typeof v === 'bigint' ? v.toString() : v instanceof Buffer ? v.toString('utf8') : v])));
        await audit('mysql_query', req, { database, statement: sql.slice(0, 160), rows: result.length });
        res.json({ ok: true, columns: result.length ? Object.keys(result[0]) : [], rows, rowCount: result.length, truncated: result.length > 300, durationMs: Date.now() - started, affectedRows: result.length });
      } else {
        await audit('mysql_query', req, { database, statement: sql.slice(0, 160), affectedRows: result.affectedRows ?? 0 });
        res.json({ ok: true, columns: [], rows: [], rowCount: 0, affectedRows: result.affectedRows ?? 0, insertId: result.insertId ? String(result.insertId) : null, durationMs: Date.now() - started });
      }
    } finally { conn.release(); }
  } catch (e) { await audit('mysql_error', req, { database, code: e.code || 'SQL_ERROR' }); res.status(400).json({ ok: false, error: e.code ? `${e.code}: ${e.sqlMessage || e.message}` : e.message }); }
});

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], etag: true, maxAge: '1h' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => process.stdout.write(`MhCoder listening on port ${PORT}\n`));
