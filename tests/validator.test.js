'use strict';

const { validateUrl, validateExpiry } = require('../src/lib/validator');

describe('validateUrl', () => {
  test('accepts valid https URLs', () => {
    const result = validateUrl('https://example.com/path?q=1');
    expect(result.valid).toBe(true);
    expect(result.url).toContain('https://example.com');
  });

  test('accepts valid http URLs', () => {
    const result = validateUrl('http://example.com');
    expect(result.valid).toBe(true);
  });

  test('trims whitespace', () => {
    const result = validateUrl('  https://example.com  ');
    expect(result.valid).toBe(true);
  });

  test('rejects empty string', () => {
    expect(validateUrl('')).toEqual(expect.objectContaining({ valid: false }));
    expect(validateUrl('  ')).toEqual(expect.objectContaining({ valid: false }));
  });

  test('rejects non-string input', () => {
    expect(validateUrl(null)).toEqual(expect.objectContaining({ valid: false }));
    expect(validateUrl(42)).toEqual(expect.objectContaining({ valid: false }));
  });

  test('rejects malformed URLs', () => {
    expect(validateUrl('not-a-url')).toEqual(expect.objectContaining({ valid: false }));
    expect(validateUrl('://missing-scheme')).toEqual(expect.objectContaining({ valid: false }));
  });

  test('blocks javascript: scheme', () => {
    const result = validateUrl('javascript:alert(1)');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/javascript/i);
  });

  test('blocks data: scheme', () => {
    expect(validateUrl('data:text/html,<h1>hi</h1>')).toEqual(
      expect.objectContaining({ valid: false })
    );
  });

  test('blocks vbscript: scheme', () => {
    expect(validateUrl('vbscript:msgbox(1)')).toEqual(
      expect.objectContaining({ valid: false })
    );
  });

  test('blocks file: scheme', () => {
    expect(validateUrl('file:///etc/passwd')).toEqual(
      expect.objectContaining({ valid: false })
    );
  });

  test('blocks ftp: and other non-http schemes', () => {
    expect(validateUrl('ftp://files.example.com')).toEqual(
      expect.objectContaining({ valid: false })
    );
  });

  test('blocks loopback IP (SSRF)', () => {
    expect(validateUrl('http://127.0.0.1/admin')).toEqual(
      expect.objectContaining({ valid: false })
    );
    expect(validateUrl('http://127.0.0.99')).toEqual(
      expect.objectContaining({ valid: false })
    );
  });

  test('blocks private IP ranges (SSRF)', () => {
    expect(validateUrl('http://192.168.1.1')).toEqual(
      expect.objectContaining({ valid: false })
    );
    expect(validateUrl('http://10.0.0.1')).toEqual(
      expect.objectContaining({ valid: false })
    );
    expect(validateUrl('http://172.16.0.1')).toEqual(
      expect.objectContaining({ valid: false })
    );
  });

  test('blocks AWS metadata endpoint', () => {
    expect(validateUrl('http://169.254.169.254/latest/meta-data')).toEqual(
      expect.objectContaining({ valid: false })
    );
  });

  test('rejects URLs exceeding max length', () => {
    const long = 'https://example.com/' + 'a'.repeat(2048);
    expect(validateUrl(long)).toEqual(expect.objectContaining({ valid: false }));
  });
});

describe('validateExpiry', () => {
  test('returns valid: true when no expiry provided', () => {
    expect(validateExpiry(undefined)).toEqual({ valid: true });
    expect(validateExpiry(null)).toEqual({ valid: true });
  });

  test('accepts a future ISO date string', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString(); // +1 day
    const result = validateExpiry(future);
    expect(result.valid).toBe(true);
    expect(typeof result.timestamp).toBe('number');
    expect(result.timestamp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('rejects a past date', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(validateExpiry(past)).toEqual(expect.objectContaining({ valid: false }));
  });

  test('rejects a date too close to now (< 5 minutes)', () => {
    const soon = new Date(Date.now() + 60_000).toISOString(); // +1 minute
    expect(validateExpiry(soon)).toEqual(expect.objectContaining({ valid: false }));
  });

  test('rejects invalid date strings', () => {
    expect(validateExpiry('not-a-date')).toEqual(expect.objectContaining({ valid: false }));
    expect(validateExpiry('32/13/2025')).toEqual(expect.objectContaining({ valid: false }));
  });

  test('returns epoch timestamp in seconds', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = validateExpiry(future);
    expect(result.timestamp).toBeLessThan(Date.now()); // seconds < ms
  });
});
