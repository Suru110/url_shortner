'use strict';

jest.mock('../src/lib/db', () => ({
  getUrl: jest.fn(),
}));

const { getUrl } = require('../src/lib/db');
const { handler } = require('../src/handlers/stats');

function makeEvent(shortCode) {
  return {
    pathParameters: { shortCode },
    requestContext: { requestId: 'test-req-id' },
  };
}

const mockContext = { awsRequestId: 'test-ctx' };
const futureEpoch = Math.floor(Date.now() / 1000) + 86400;
const pastEpoch   = Math.floor(Date.now() / 1000) - 1;

beforeEach(() => jest.clearAllMocks());

describe('GET /stats/{shortCode}', () => {
  test('returns stats for a valid short code', async () => {
    getUrl.mockResolvedValueOnce({
      shortCode: 'abc1234',
      longUrl: 'https://example.com',
      createdAt: '2025-01-01T00:00:00.000Z',
      lastAccessedAt: '2025-06-01T12:00:00.000Z',
      clickCount: 42,
      isCustomAlias: false,
    });

    const res = await handler(makeEvent('abc1234'), mockContext);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.shortCode).toBe('abc1234');
    expect(body.clickCount).toBe(42);
    expect(body.isExpired).toBe(false);
    expect(body.longUrl).toBe('https://example.com');
  });

  test('marks expired URLs correctly', async () => {
    getUrl.mockResolvedValueOnce({
      shortCode: 'oldlink',
      longUrl: 'https://example.com',
      createdAt: '2025-01-01T00:00:00.000Z',
      lastAccessedAt: null,
      clickCount: 3,
      expiresAt: pastEpoch,
    });

    const res = await handler(makeEvent('oldlink'), mockContext);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.isExpired).toBe(true);
    expect(body.expiresAt).toBeTruthy();
  });

  test('returns isExpired: false for future expiry', async () => {
    getUrl.mockResolvedValueOnce({
      shortCode: 'fresh',
      longUrl: 'https://example.com',
      createdAt: new Date().toISOString(),
      clickCount: 0,
      expiresAt: futureEpoch,
    });

    const res = await handler(makeEvent('fresh'), mockContext);
    const body = JSON.parse(res.body);
    expect(body.isExpired).toBe(false);
  });

  test('returns 404 for unknown short code', async () => {
    getUrl.mockResolvedValueOnce(null);

    const res = await handler(makeEvent('unknown'), mockContext);
    expect(res.statusCode).toBe(404);
  });

  test('returns 404 when shortCode is empty', async () => {
    const res = await handler(makeEvent(''), mockContext);
    expect(res.statusCode).toBe(404);
  });

  test('returns 500 on DynamoDB error', async () => {
    getUrl.mockRejectedValueOnce(new Error('Connection timeout'));

    const res = await handler(makeEvent('abc1234'), mockContext);
    expect(res.statusCode).toBe(500);
  });

  test('defaults clickCount to 0 if not stored', async () => {
    getUrl.mockResolvedValueOnce({
      shortCode: 'zero',
      longUrl: 'https://example.com',
      createdAt: new Date().toISOString(),
    });

    const res = await handler(makeEvent('zero'), mockContext);
    const body = JSON.parse(res.body);
    expect(body.clickCount).toBe(0);
  });

  test('does not expose ownerId in response', async () => {
    getUrl.mockResolvedValueOnce({
      shortCode: 'owned',
      longUrl: 'https://example.com',
      createdAt: new Date().toISOString(),
      clickCount: 1,
      ownerId: 'user-secret-id',
    });

    const res = await handler(makeEvent('owned'), mockContext);
    const body = JSON.parse(res.body);
    expect(body.ownerId).toBeUndefined();
  });
});
