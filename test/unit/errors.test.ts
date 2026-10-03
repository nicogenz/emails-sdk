import { describe, expect, it } from 'vitest';
import { EmailError } from '../../src/errors.ts';

describe('EmailError', () => {
  it('is an Error with the given message and name', () => {
    const error = new EmailError('Invalid API key', { code: 'auth', provider: 'resend' });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EmailError);
    expect(error.name).toBe('EmailError');
    expect(error.message).toBe('Invalid API key');
  });

  it('exposes the given options', () => {
    const raw = { message: 'Too many requests' };
    const error = new EmailError('Too many requests', {
      code: 'rate_limited',
      provider: 'postmark',
      status: 429,
      retryAfter: 30,
      raw,
    });

    expect(error.code).toBe('rate_limited');
    expect(error.provider).toBe('postmark');
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(30);
    expect(error.raw).toBe(raw);
  });

  it('leaves optional fields undefined', () => {
    const error = new EmailError('Missing recipient', { code: 'validation', provider: 'local' });

    expect(error.status).toBeUndefined();
    expect(error.retryAfter).toBeUndefined();
    expect(error.raw).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });

  it('keeps the cause', () => {
    const cause = new TypeError('fetch failed');
    const error = new EmailError('Request failed', {
      code: 'network_error',
      provider: 'sendgrid',
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});
