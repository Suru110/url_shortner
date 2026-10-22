'use strict';

/**
 * mongoStore.js — MongoDB Atlas data store.
 *
 * Implements the exact same interface as localDb.js and redisStore.js so it
 * can be dropped in as a replacement with zero changes to handlers.
 *
 * Set MONGODB_URI in your environment (Render dashboard) to enable:
 *   MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/urlshortener?retryWrites=true&w=majority
 *
 * Collections:
 *   urls   — { shortCode (PK), longUrl, ownerId, clickCount, … }
 *   users  — { userId (PK), email (unique), name, passwordHash, … }
 */

const mongoose = require('mongoose');

// ── Connection (lazy singleton) ───────────────────────────────────────────────
let _connected = false;

async function connect() {
  if (_connected) return;
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  _connected = true;
}

// ── Schemas ───────────────────────────────────────────────────────────────────
const urlSchema = new mongoose.Schema({
  shortCode:      { type: String, required: true, unique: true, index: true },
  longUrl:        { type: String, required: true },
  ownerId:        { type: String, index: true, default: null },
  name:           { type: String, default: null },
  clickCount:     { type: Number, default: 0 },
  createdAt:      { type: String, default: () => new Date().toISOString() },
  lastAccessedAt: { type: String, default: null },
  isCustomAlias:  { type: Boolean, default: false },
  expiresAt:      { type: Number, default: null },   // unix epoch seconds, for TTL check
}, { versionKey: false });

const userSchema = new mongoose.Schema({
  userId:       { type: String, required: true, unique: true, index: true },
  email:        { type: String, required: true, unique: true, index: true },
  name:         { type: String, required: true },
  passwordHash: { type: String, required: true },
  provider:     { type: String, default: 'local' },
  createdAt:    { type: String, default: () => new Date().toISOString() },
}, { versionKey: false });

// Prevent model re-compilation on hot-reload
const Url  = mongoose.models.Url  || mongoose.model('Url',  urlSchema);
const User = mongoose.models.User || mongoose.model('User', userSchema);

// ── URL operations ────────────────────────────────────────────────────────────

async function getUrl(shortCode) {
  await connect();
  const doc = await Url.findOne({ shortCode }).lean();
  return doc || null;
}

async function putUrl(item) {
  await connect();
  try {
    await Url.create(item);
  } catch (e) {
    // Duplicate key — same signal as DynamoDB ConditionalCheckFailedException
    if (e.code === 11000) {
      const err = new Error('Duplicate shortCode');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
    throw e;
  }
}

async function incrementClickCount(shortCode) {
  await connect();
  await Url.updateOne(
    { shortCode },
    { $inc: { clickCount: 1 }, $set: { lastAccessedAt: new Date().toISOString() } }
  );
}

async function deleteUrl(shortCode, ownerId) {
  await connect();
  const query = { shortCode };
  if (ownerId) query.ownerId = ownerId;
  const result = await Url.deleteOne(query);
  if (result.deletedCount === 0) {
    const err = new Error('Not found or not owner');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
}

async function listUrls(ownerId, cursor, limit = 50) {
  await connect();
  const query = {};
  if (ownerId) query.ownerId = ownerId;

  // Exclude expired urls from the list
  const nowEpoch = Math.floor(Date.now() / 1000);
  query.$or = [{ expiresAt: null }, { expiresAt: { $gt: nowEpoch } }];

  // Cursor-based pagination using createdAt
  if (cursor) {
    try {
      const cursorDate = Buffer.from(cursor, 'base64').toString('utf8');
      query.createdAt = { $lt: cursorDate };
    } catch { /* ignore bad cursor */ }
  }

  const items = await Url.find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = items.length > limit;
  const page    = hasMore ? items.slice(0, limit) : items;

  // Encode next cursor as base64 of the last item's createdAt
  const lastKey = hasMore
    ? Buffer.from(page[page.length - 1].createdAt).toString('base64')
    : undefined;

  return { items: page, lastKey };
}

// ── User operations ───────────────────────────────────────────────────────────

async function getUserById(userId) {
  await connect();
  return (await User.findOne({ userId }).lean()) || null;
}

async function getUserByEmail(email) {
  await connect();
  return (await User.findOne({ email: email.toLowerCase().trim() }).lean()) || null;
}

async function putUser(user) {
  await connect();
  await User.create(user);
}

async function updateUser(userId, updates) {
  await connect();
  await User.updateOne({ userId }, { $set: updates });
}

module.exports = {
  getUrl, putUrl, incrementClickCount, deleteUrl, listUrls,
  getUserById, getUserByEmail, putUser, updateUser,
};
