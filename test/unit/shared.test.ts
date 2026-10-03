import { describe, expect, it } from 'vitest';
import { EmailError } from '../../src/errors.ts';
import {
  formatAddress,
  parseAddress,
  requireOptions,
  toArray,
  toBase64,
} from '../../src/providers/shared.ts';

describe('toArray', () => {
  it('wraps a single value', () => {
    expect(toArray('a@example.com')).toEqual(['a@example.com']);
  });

  it('returns an array unchanged', () => {
    expect(toArray(['a@example.com', 'b@example.com'])).toEqual(['a@example.com', 'b@example.com']);
  });

  it('returns an empty array for undefined', () => {
    expect(toArray(undefined)).toEqual([]);
  });
});

describe('formatAddress', () => {
  it('returns a string address unchanged', () => {
    expect(formatAddress('Jane <jane@example.com>')).toBe('Jane <jane@example.com>');
  });

  it('returns the email when there is no name', () => {
    expect(formatAddress({ email: 'jane@example.com' })).toBe('jane@example.com');
  });

  it('quotes the name', () => {
    expect(formatAddress({ email: 'jane@example.com', name: 'Doe, Jane' })).toBe(
      '"Doe, Jane" <jane@example.com>',
    );
  });

  it('escapes quotes and backslashes in the name', () => {
    expect(formatAddress({ email: 'jane@example.com', name: 'Jane "J" \\ Doe' })).toBe(
      '"Jane \\"J\\" \\\\ Doe" <jane@example.com>',
    );
  });
});

describe('parseAddress', () => {
  it.each([
    ['jane@example.com', { email: 'jane@example.com' }],
    ['  jane@example.com  ', { email: 'jane@example.com' }],
    ['<jane@example.com>', { email: 'jane@example.com' }],
    ['Jane Doe <jane@example.com>', { email: 'jane@example.com', name: 'Jane Doe' }],
    ['"Doe, Jane" <jane@example.com>', { email: 'jane@example.com', name: 'Doe, Jane' }],
    ['"Jane \\"J\\" Doe" <jane@example.com>', { email: 'jane@example.com', name: 'Jane "J" Doe' }],
  ])('parses %s', (input, expected) => {
    expect(parseAddress(input)).toEqual(expected);
  });

  it('keeps an address object', () => {
    expect(parseAddress({ email: 'jane@example.com', name: 'Jane' })).toEqual({
      email: 'jane@example.com',
      name: 'Jane',
    });
  });

  it('drops an empty name', () => {
    expect(parseAddress({ email: 'jane@example.com', name: '' })).toEqual({
      email: 'jane@example.com',
    });
  });

  it('reverses formatAddress', () => {
    const address = { email: 'jane@example.com', name: 'Jane "J" \\ Doe, Jr.' };

    expect(parseAddress(formatAddress(address))).toEqual(address);
  });
});

describe('toBase64', () => {
  it('returns a string unchanged', () => {
    expect(toBase64('aGVsbG8=')).toBe('aGVsbG8=');
  });

  it('encodes bytes', () => {
    expect(toBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=');
  });

  it('encodes bytes larger than one chunk', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);

    const decoded = Uint8Array.from(atob(toBase64(bytes)), (char) => char.charCodeAt(0));

    expect(decoded).toEqual(bytes);
  });
});

describe('requireOptions', () => {
  it('passes when all options are set', () => {
    expect(() => requireOptions('resend', { apiKey: 'key' })).not.toThrow();
  });

  it('throws a validation error naming the missing options', () => {
    let error: unknown;
    try {
      requireOptions('mailgun', { apiKey: '', domain: undefined, region: 'eu' });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(EmailError);
    expect(error).toMatchObject({
      message: 'Missing required mailgun options: apiKey, domain',
      code: 'validation',
      provider: 'mailgun',
    });
  });
});
