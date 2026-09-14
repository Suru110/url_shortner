'use strict';

jest.mock('../src/lib/db', () => ({
  getUrl: jest.fn(),
  incrementClickCount: jest.fn(),
}));

const { getUrl, incrementClickCount } = require('../src/lib/db');
const { handler } = require('../src/handlers/redirect');

function makeEvent(shortCode) {
  return {
    pathParameters: { shortCode },
    requestContext: { requestId: 'test-req-id' },
  };
}

const mockContext = { awsRequestId: 'test-ctx' };
const futureEpoch = Math.floor(Date.now() / 1000) + 86400; // +1 day
const pastEpoch   = Math.floor(Date.now() / 1000) - 1;    // 1 second ago

beforeEach(() => {
  jest.clearAllMocks();
  incrementClickCount.mockResolvedValue(); // default: success (fire-and-forget)
});

describe('GET /{shortCode}', () => {
  test('redirects to the long URL (301)', async () => {
    getUrl.mockResolvedValueOnce({
      shortCode: 'abc1234',
      longUrl: 'https://example.com/page',
      clickCount: 5,
    });

    const res = await handler(makeEvent('abc1234'), mockContext);

    expect(res.statusCode).toBe(301);
    expect(res.headers.Location).toBe('https://example.com/page');
  });

  test('increments click count after redirecting', async () => {
    getUrl.mockResolvedValueOnce({
      shortCode: 'abc1234',
      longUrl: 'https://example.com/page',
    });

    await handler(makeEvent('abc1234'), mockContext);

    // Give the fire-and-forget a tick to resolve
    await new Promise((r) => setImmediate(r));
    expect(incrementClickCount).toHaveBeenCalledWith('abc1234');
  });

  test('returns 404 HTML when short code is not found', async () => {
    getUrl.mockResolvedValueOnce(null);

    const res = await handler(makeEvent('notfound'), mockContext);

    expect(res.statusCode).toBe(404);
    expect(res.headers['Content-Type']).toMatch(/text\/html/);
    expect(res.body).toContain('404');
    expect(res.body).toContain('notfound');
  });

  test('returns 410 HTML for an expired URL', async () => {
    getUrl.mockResolvedValueOnce({
      shortCode: 'expired',
      longUrl: 'https://example.com',
      expiresAt: pastEpoch,
    });

    const res = await handler(makeEvent('expired'), mockContext);

    expect(res.statusCode).toBe(410);
    expect(res.headers['Content-Type']).toMatch(/text\/html/);
    expect(res.body).toContain('410');
  });

  test('still redirects when expiresAt is in the future', async () => {
    getUrl.mockResolvedValueOnce({
      shortCode: 'future',
      longUrl: 'https://example.com/future',
      expiresAt: futureEpoch,
    });

    const res = await handler(makeEvent('future'), mockContext);

    expect(res.statusCode).toBe(301);
  });

  test('returns 404 when shortCode is empty', async () => {
    const res = await handler(makeEvent(''), mockContext);
    expect(res.statusCode).toBe(404);
  });

  test('returns 500 on DynamoDB error', async () => {
    getUrl.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const res = await handler(makeEvent('errcode'), mockContext);

    expect(res.statusCode).toBe(500);
  });

  test('does not crash when click increment fails (fire-and-forget)', async () => {
    getUrl.mockResolvedValueOnce({
      shortCode: 'abc1234',
      longUrl: 'https://example.com/page',
    });
    incrementClickCount.mockRejectedValueOnce(new Error('DynamoDB throttle'));

    // Should not throw
    const res = await handler(makeEvent('abc1234'), mockContext);
    expect(res.statusCode).toBe(301);
  });

  test('escapes HTML special chars in the error page', async () => {
    getUrl.mockResolvedValueOnce(null);

    const res = await handler(makeEvent('<script>'), mockContext);
    expect(res.body).not.toContain('<script>');
    expect(res.body).toContain('&lt;script&gt;');
  });
});
