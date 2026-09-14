'use strict';

const { generateCode, validateAlias, ALPHABET, BASE } = require('../src/lib/generator');

describe('generateCode', () => {
  test('returns a string of the requested length (default 7)', () => {
    const code = generateCode();
    expect(typeof code).toBe('string');
    expect(code).toHaveLength(7);
  });

  test('respects a custom length', () => {
    expect(generateCode(6)).toHaveLength(6);
    expect(generateCode(12)).toHaveLength(12);
  });

  test('only uses base62 characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toMatch(/^[a-zA-Z0-9]+$/);
    }
  });

  test('generates unique codes on repeated calls', () => {
    const codes = new Set();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateCode());
    }
    // Allow a tiny number of accidental collisions in 1000 samples
    expect(codes.size).toBeGreaterThan(990);
  });

  test('BASE is 62', () => {
    expect(BASE).toBe(62);
  });

  test('ALPHABET has 62 unique characters', () => {
    expect(ALPHABET).toHaveLength(62);
    expect(new Set(ALPHABET).size).toBe(62);
  });
});

describe('validateAlias', () => {
  test('accepts a valid alias', () => {
    expect(validateAlias('my-link')).toEqual({ valid: true });
    expect(validateAlias('CoolURL123')).toEqual({ valid: true });
    expect(validateAlias('abc')).toEqual({ valid: true });
  });

  test('rejects aliases shorter than 3 chars', () => {
    const result = validateAlias('ab');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/3/);
  });

  test('rejects aliases longer than 50 chars', () => {
    const result = validateAlias('a'.repeat(51));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/50/);
  });

  test('rejects aliases with special characters', () => {
    expect(validateAlias('bad alias!')).toEqual(
      expect.objectContaining({ valid: false })
    );
    expect(validateAlias('under_score')).toEqual(
      expect.objectContaining({ valid: false })
    );
  });

  test('rejects reserved words', () => {
    expect(validateAlias('shorten')).toEqual(expect.objectContaining({ valid: false }));
    expect(validateAlias('stats')).toEqual(expect.objectContaining({ valid: false }));
    expect(validateAlias('URLS')).toEqual(expect.objectContaining({ valid: false }));
  });

  test('rejects non-string input', () => {
    expect(validateAlias(null)).toEqual(expect.objectContaining({ valid: false }));
    expect(validateAlias(123)).toEqual(expect.objectContaining({ valid: false }));
  });
});
