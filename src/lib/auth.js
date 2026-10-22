'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
// Unified DB selector — uses Upstash on Render, localDb in local dev.
const db     = require('./db');

const JWT_SECRET  = process.env.JWT_SECRET  || 'local-dev-secret-change-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '30d';
const SALT_ROUNDS = 10;

function uid()  { return crypto.randomUUID(); }
function now()  { return new Date().toISOString(); }

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ── Register ──────────────────────────────────────────────────────────────────
async function register({ name, email, password }) {
  if (!name || !email || !password) throw { status: 400, message: 'Name, email and password are required' };
  if (password.length < 6)          throw { status: 400, message: 'Password must be at least 6 characters' };

  const emailNorm = email.toLowerCase().trim();
  const existing  = await db.getUserByEmail(emailNorm);
  if (existing)   throw { status: 409, message: 'An account with this email already exists' };

  const userId       = uid();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = { userId, email: emailNorm, name: name.trim(), provider: 'local', passwordHash, createdAt: now() };

  await db.putUser(user);

  return { token: signToken({ userId, email: emailNorm, name: user.name }), user: safeUser(user) };
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login({ email, password }) {
  if (!email || !password) throw { status: 400, message: 'Email and password are required' };

  const user = await db.getUserByEmail(email.toLowerCase().trim());
  if (!user)               throw { status: 401, message: 'Invalid email or password' };
  if (user.provider !== 'local') throw { status: 401, message: 'Please sign in with Google' };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw { status: 401, message: 'Invalid email or password' };

  return { token: signToken({ userId: user.userId, email: user.email, name: user.name }), user: safeUser(user) };
}

// ── Reset password ────────────────────────────────────────────────────────────
async function resetPassword({ email, newPassword }) {
  if (!email || !newPassword)
    throw { status: 400, message: 'Email and new password are required' };
  if (newPassword.length < 6)
    throw { status: 400, message: 'Password must be at least 6 characters' };

  const user = await db.getUserByEmail(email.toLowerCase().trim());
  if (!user)
    throw { status: 404, message: 'No account found with that email address' };

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db.updateUser(user.userId, { passwordHash });

  return { token: signToken({ userId: user.userId, email: user.email, name: user.name }), user: safeUser({ ...user, passwordHash }) };
}

// ── Require auth (synchronous — only reads JWT, no DB call) ───────────────────
function requireAuth(req) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw { status: 401, message: 'Authentication required — please sign in' };
  try   { return verifyToken(token); }
  catch { throw { status: 401, message: 'Session expired — please sign in again' }; }
}

// ── Get user by ID ────────────────────────────────────────────────────────────
async function getUserById(userId) {
  return db.getUserById(userId);
}

// ── Strip password hash ───────────────────────────────────────────────────────
function safeUser(u) {
  const { passwordHash, ...safe } = u;
  return safe;
}

module.exports = { register, login, resetPassword, requireAuth, getUserById, safeUser };
