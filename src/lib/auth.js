'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('./localDb');   // always use the JSON file store for auth

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
  const existing  = db.getUserByEmail(emailNorm);
  if (existing)   throw { status: 409, message: 'An account with this email already exists' };

  const userId       = uid();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = { userId, email: emailNorm, name: name.trim(), provider: 'local', passwordHash, createdAt: now() };

  db.putUser(user);

  const token = signToken({ userId, email: emailNorm, name: user.name });
  return { token, user: safeUser(user) };
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login({ email, password }) {
  if (!email || !password) throw { status: 400, message: 'Email and password are required' };

  const user = db.getUserByEmail(email.toLowerCase().trim());
  if (!user)               throw { status: 401, message: 'Invalid email or password' };
  if (user.provider !== 'local') throw { status: 401, message: 'Please sign in with Google' };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw { status: 401, message: 'Invalid email or password' };

  const token = signToken({ userId: user.userId, email: user.email, name: user.name });
  return { token, user: safeUser(user) };
}

// ── Require auth middleware ────────────────────────────────────────────────────
function requireAuth(req) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw { status: 401, message: 'Authentication required — please sign in' };
  try {
    return verifyToken(token);
  } catch {
    throw { status: 401, message: 'Session expired — please sign in again' };
  }
}

// ── Get user by ID ────────────────────────────────────────────────────────────
function getUserById(userId) {
  return db.getUserById(userId);
}

// ── Strip password hash ───────────────────────────────────────────────────────
function safeUser(u) {
  const { passwordHash, ...safe } = u;
  return safe;
}

module.exports = { register, login, requireAuth, getUserById, safeUser };
