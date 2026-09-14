'use strict';

/**
 * localDb.js — lightweight JSON file store that replaces DynamoDB Local.
 *
 * Data is written to data/db.json on every write.
 * This means accounts and URLs persist across server restarts with zero
 * dependencies — no Docker, no DynamoDB Local, no extra setup.
 *
 * Structure:
 *   { urls: { [shortCode]: item }, users: { [userId]: item } }
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

// ── Load or init store ───────────────────────────────────────────────────────
function loadStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ urls: {}, users: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { urls: {}, users: {} };
  }
}

function saveStore(store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

// Keep store in memory, flush to disk on writes
let store = loadStore();

// ── URLs ─────────────────────────────────────────────────────────────────────
function getUrl(shortCode) {
  return store.urls[shortCode] || null;
}

function putUrl(item) {
  if (store.urls[item.shortCode]) {
    const err = new Error('Condition failed');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  store.urls[item.shortCode] = item;
  saveStore(store);
}

function incrementClickCount(shortCode) {
  const item = store.urls[shortCode];
  if (!item) return;
  item.clickCount = (item.clickCount || 0) + 1;
  item.lastAccessedAt = new Date().toISOString();
  saveStore(store);
}

function deleteUrlDb(shortCode, ownerId) {
  const item = store.urls[shortCode];
  if (!item) {
    const err = new Error('Not found');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  if (ownerId && item.ownerId !== ownerId) {
    const err = new Error('Not owner');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  delete store.urls[shortCode];
  saveStore(store);
}

function listUrls(ownerId, lastKey, limit = 50) {
  let items = Object.values(store.urls);
  if (ownerId) items = items.filter(i => i.ownerId === ownerId);
  // Filter expired items
  const now = Math.floor(Date.now() / 1000);
  items = items.filter(i => !i.expiresAt || i.expiresAt > now);
  // Sort newest first
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const start = lastKey ? items.findIndex(i => i.shortCode === lastKey) + 1 : 0;
  const page  = items.slice(start, start + limit);
  return {
    items: page,
    lastKey: page.length === limit && start + limit < items.length
      ? page[page.length - 1].shortCode : undefined,
  };
}

// ── Users ─────────────────────────────────────────────────────────────────────
function getUserById(userId) {
  return store.users[userId] || null;
}

function getUserByEmail(email) {
  const norm = email.toLowerCase().trim();
  return Object.values(store.users).find(u => u.email === norm) || null;
}

function putUser(user) {
  store.users[user.userId] = user;
  saveStore(store);
}

function updateUser(userId, updates) {
  if (!store.users[userId]) return;
  Object.assign(store.users[userId], updates);
  saveStore(store);
}

module.exports = {
  // URL ops
  getUrl, putUrl, incrementClickCount,
  deleteUrl: deleteUrlDb, listUrls,
  // User ops
  getUserById, getUserByEmail, putUser, updateUser,
  // For testing
  _reload: () => { store = loadStore(); },
};
