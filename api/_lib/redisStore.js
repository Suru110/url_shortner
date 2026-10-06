'use strict';

/**
 * Redis-backed store for Vercel production using Upstash.
 * All data is stored as JSON strings with key prefixes:
 *   url:{shortCode}   → URL item
 *   user:{userId}     → user item
 *   email:{email}     → userId (index)
 */

const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ── URLs ──────────────────────────────────────────────────────────────────────
async function getUrl(shortCode) {
  const item = await redis.get(`url:${shortCode}`);
  return item || null;
}

async function putUrl(item) {
  const existing = await redis.get(`url:${item.shortCode}`);
  if (existing) {
    const err = new Error('Condition failed');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  const opts = item.expiresAt
    ? { ex: item.expiresAt - Math.floor(Date.now() / 1000) }
    : {};
  await redis.set(`url:${item.shortCode}`, item, opts);
  // Add to owner's set for listing
  if (item.ownerId) {
    await redis.zadd(`owner_urls:${item.ownerId}`, { score: Date.now(), member: item.shortCode });
  }
}

async function incrementClickCount(shortCode) {
  const item = await redis.get(`url:${shortCode}`);
  if (!item) return;
  item.clickCount    = (item.clickCount || 0) + 1;
  item.lastAccessedAt = new Date().toISOString();
  await redis.set(`url:${shortCode}`, item);
}

async function deleteUrl(shortCode, ownerId) {
  const item = await redis.get(`url:${shortCode}`);
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
  await redis.del(`url:${shortCode}`);
  if (item.ownerId) {
    await redis.zrem(`owner_urls:${item.ownerId}`, shortCode);
  }
}

async function listUrls(ownerId, cursor, limit = 50) {
  if (!ownerId) return { items: [], lastKey: undefined };

  // Get shortCodes from sorted set (newest first)
  const codes = await redis.zrange(`owner_urls:${ownerId}`, 0, -1, { rev: true });
  if (!codes.length) return { items: [], lastKey: undefined };

  // Fetch all items
  const items = await Promise.all(codes.map(c => redis.get(`url:${c}`)));
  const valid  = items.filter(Boolean);

  const start = cursor ? valid.findIndex(i => i.shortCode === cursor) + 1 : 0;
  const page  = valid.slice(start, start + limit);

  return {
    items: page,
    lastKey: page.length === limit && start + limit < valid.length
      ? page[page.length - 1].shortCode : undefined,
  };
}

// ── Users ─────────────────────────────────────────────────────────────────────
async function getUserById(userId) {
  return (await redis.get(`user:${userId}`)) || null;
}

async function getUserByEmail(email) {
  const userId = await redis.get(`email:${email.toLowerCase().trim()}`);
  if (!userId) return null;
  return (await redis.get(`user:${userId}`)) || null;
}

async function putUser(user) {
  await redis.set(`user:${user.userId}`, user);
  await redis.set(`email:${user.email}`, user.userId);
}

async function updateUser(userId, updates) {
  const user = await redis.get(`user:${userId}`);
  if (!user) return;
  const updated = { ...user, ...updates };
  await redis.set(`user:${userId}`, updated);
}

module.exports = { getUrl, putUrl, incrementClickCount, deleteUrl, listUrls, getUserById, getUserByEmail, putUser, updateUser };
