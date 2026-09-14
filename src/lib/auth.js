'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const JWT_SECRET   = process.env.JWT_SECRET   || 'local-dev-secret-change-in-prod';
const JWT_EXPIRES  = process.env.JWT_EXPIRES  || '7d';
const USERS_TABLE  = process.env.USERS_TABLE  || 'users-local';
const SALT_ROUNDS  = 10;

// ── DynamoDB client ───────────────────────────────────────────────────────────
const clientCfg = {
  region: process.env.AWS_REGION || 'us-east-1',
};
if (process.env.DYNAMODB_ENDPOINT) {
  clientCfg.endpoint = process.env.DYNAMODB_ENDPOINT;
  clientCfg.credentials = {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  };
}
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(clientCfg), {
  marshallOptions: { removeUndefinedValues: true },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid()   { return crypto.randomUUID(); }
function now()   { return new Date().toISOString(); }

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ── Look up user by email via GSI ─────────────────────────────────────────────
async function getUserByEmail(email) {
  const res = await ddb.send(new QueryCommand({
    TableName: USERS_TABLE,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :e',
    ExpressionAttributeValues: { ':e': email.toLowerCase().trim() },
    Limit: 1,
  }));
  return res.Items?.[0] || null;
}

// ── Look up user by ID ────────────────────────────────────────────────────────
async function getUserById(userId) {
  const res = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId } }));
  return res.Item || null;
}

// ── Register ──────────────────────────────────────────────────────────────────
async function register({ name, email, password }) {
  if (!name || !email || !password) throw { status: 400, message: 'Name, email and password are required' };
  if (password.length < 6)           throw { status: 400, message: 'Password must be at least 6 characters' };

  const emailNorm = email.toLowerCase().trim();
  const existing  = await getUserByEmail(emailNorm);
  if (existing)  throw { status: 409, message: 'An account with this email already exists' };

  const userId      = uid();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = {
    userId,
    email:    emailNorm,
    name:     name.trim(),
    provider: 'local',
    passwordHash,
    createdAt: now(),
  };
  await ddb.send(new PutCommand({ TableName: USERS_TABLE, Item: user }));

  const token = signToken({ userId, email: emailNorm, name: user.name });
  return { token, user: safeUser(user) };
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login({ email, password }) {
  if (!email || !password) throw { status: 400, message: 'Email and password are required' };

  const user = await getUserByEmail(email.toLowerCase().trim());
  if (!user || user.provider !== 'local') throw { status: 401, message: 'Invalid email or password' };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw { status: 401, message: 'Invalid email or password' };

  const token = signToken({ userId: user.userId, email: user.email, name: user.name });
  return { token, user: safeUser(user) };
}

// ── Google OAuth (upsert) ─────────────────────────────────────────────────────
async function loginWithGoogle({ googleId, email, name, picture }) {
  const emailNorm = email.toLowerCase().trim();
  let user = await getUserByEmail(emailNorm);

  if (user) {
    // Update google info if they previously registered locally
    await ddb.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userId: user.userId },
      UpdateExpression: 'SET googleId = :g, #n = :n, picture = :p',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: { ':g': googleId, ':n': name, ':p': picture || null },
    }));
    user = { ...user, googleId, name, picture };
  } else {
    user = { userId: uid(), email: emailNorm, name, googleId, picture: picture || null, provider: 'google', createdAt: now() };
    await ddb.send(new PutCommand({ TableName: USERS_TABLE, Item: user }));
  }

  const token = signToken({ userId: user.userId, email: user.email, name: user.name });
  return { token, user: safeUser(user) };
}

// ── Middleware — verify JWT from Authorization header ─────────────────────────
function requireAuth(req) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw { status: 401, message: 'Authentication required' };
  try {
    return verifyToken(token);
  } catch {
    throw { status: 401, message: 'Invalid or expired token' };
  }
}

// ── Strip sensitive fields ────────────────────────────────────────────────────
function safeUser(u) {
  const { passwordHash, ...safe } = u;
  return safe;
}

module.exports = { register, login, loginWithGoogle, requireAuth, getUserById, safeUser };
