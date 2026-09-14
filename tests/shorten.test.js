'use strict';

// ---------------------------------------------------------------------------
// Mock the db module so we don't hit real DynamoDB
// ---------------------------------------------------------------------------
jest.mock('../src/lib/db', () => ({
  putUrl: jest.fn(),
}));

const { putUrl } = require('../src/lib/db');
const { handler } = require('../src/handlers/shorten');

// Helper to build a minimal API Gateway v2 event
function makeEvent(body) {
  return {
    rawPath: '/shorten',
    body: JSON.stringify(body),
    pathParameters: {},
    requestContext: { requestId: 'test-req-id' },
  };
}

const mockContext = { awsRequestId: 'test-ctx' };

// Ensure BASE_URL is set for tests
beforeAll(() => {
  process.env.BASE_URL = 'https://short.example.com';
  process.env.URLS_TABLE = 'urls-test';
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /shorten', () => {
  test('returns 201 with a valid URL', async () => {
    putUrl.mockResolvedValueOnce();

    const res = await handler(makeEvent({ url: 'https://example.com/long' }), mockContext);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.shortUrl).toMatch(/^https:\/\/short\.example\.com\//);
    expect(body.shortCode).toHaveLength(7);
    expect(body.longUrl).toBe('https://example.com/long');
    expect(body.createdAt).toBeTruthy();
    expect(body.isCustomAlias).toBe(false);
  });

  test('returns 400 for a missing URL', async () => {
    const res = await handler(makeEvent({}), mockContext);
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 for a javascript: URL', async () => {
    const res = await handler(makeEvent({ url: 'javascript:alert(1)' }), mockContext);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toMatch(/javascript/i);
  });

  test('returns 400 for a private IP URL (SSRF)', async () => {
    const res = await handler(makeEvent({ url: 'http://192.168.1.1/admin' }), mockContext);
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 for invalid JSON body', async () => {
    const event = { rawPath: '/shorten', body: '{bad json', pathParameters: {}, requestContext: {} };
    const res = await handler(event, mockContext);
    expect(res.statusCode).toBe(400);
  });

  test('uses custom alias when provided', async () => {
    putUrl.mockResolvedValueOnce();

    const res = await handler(makeEvent({ url: 'https://example.com', alias: 'my-link' }), mockContext);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.shortCode).toBe('my-link');
    expect(body.isCustomAlias).toBe(true);
  });

  test('returns 409 when custom alias already exists', async () => {
    const err = new Error('ConditionalCheckFailed');
    err.name = 'ConditionalCheckFailedException';
    putUrl.mockRejectedValueOnce(err);

    const res = await handler(makeEvent({ url: 'https://example.com', alias: 'taken' }), mockContext);

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.message).toMatch(/taken/i);
  });

  test('retries on auto-generated code collision', async () => {
    const collisionErr = new Error('ConditionalCheckFailed');
    collisionErr.name = 'ConditionalCheckFailedException';

    // Fail twice then succeed
    putUrl
      .mockRejectedValueOnce(collisionErr)
      .mockRejectedValueOnce(collisionErr)
      .mockResolvedValueOnce();

    const res = await handler(makeEvent({ url: 'https://example.com/page' }), mockContext);

    expect(res.statusCode).toBe(201);
    expect(putUrl).toHaveBeenCalledTimes(3);
  });

  test('includes expiresAt in response when provided', async () => {
    putUrl.mockResolvedValueOnce();

    const future = new Date(Date.now() + 86_400_000 * 7).toISOString();
    const res = await handler(makeEvent({ url: 'https://example.com', expiresAt: future }), mockContext);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.expiresAt).toBeTruthy();
  });

  test('returns 400 for an alias with invalid characters', async () => {
    const res = await handler(makeEvent({ url: 'https://example.com', alias: 'bad alias!' }), mockContext);
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 for reserved alias "shorten"', async () => {
    const res = await handler(makeEvent({ url: 'https://example.com', alias: 'shorten' }), mockContext);
    expect(res.statusCode).toBe(400);
  });

  test('returns 500 after exhausting all retries', async () => {
    const collisionErr = new Error('ConditionalCheckFailed');
    collisionErr.name = 'ConditionalCheckFailedException';

    // Always collide
    putUrl.mockRejectedValue(collisionErr);

    const res = await handler(makeEvent({ url: 'https://example.com/test' }), mockContext);

    expect(res.statusCode).toBe(500);
  });
});
