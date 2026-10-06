'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const store  = require('./store');

const JWT_SECRET  = process.env.JWT_SECRET  || 'local-dev-secret-change-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '30d';
const SALT_ROUNDS = 10;

function uid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

async function register({ name, email, password }) {
  if (!name || !email || !password) throw { status: 400, message: 'Name, email and password are required' };
  if (password.length < 6)          throw { status: 400, message: 'Password must be at least 6 characters' };

  const emailNorm = email.toLowerCase().trim();
  const existing  = await store.getUserByEmail(emailNorm);
  if (existing)   throw { status: 409, message: 'An account with this email already exists' };

  const userId       = uid();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = { userId, email: emailNorm, name: name.trim(), provider: 'local', passwordHash, createdAt: now() };
  await store.putUser(user);

  return { token: signToken({ userId, email: emailNorm, name: user.name }), user: safe(user) };
}

async function login({ email, password }) {
  if (!email || !password) throw { status: 400, message: 'Email and password are required' };

  const user = await store.getUserByEmail(email.toLowerCase().trim());
  if (!user)               throw { status: 401, message: 'Invalid email or password' };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw { status: 401, message: 'Invalid email or password' };

  return { token: signToken({ userId: user.userId, email: user.email, name: user.name }), user: safe(user) };
}

function requireAuth(req) {
  const header = (req.headers['authorization'] || req.headers['Authorization'] || '');
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw { status: 401, message: 'Authentication required — please sign in' };
  try { return jwt.verify(token, JWT_SECRET); }
  catch { throw { status: 401, message: 'Session expired — please sign in again' }; }
}

function safe(u) { const { passwordHash, ...s } = u; return s; }

module.exports = { register, login, requireAuth, safe };
