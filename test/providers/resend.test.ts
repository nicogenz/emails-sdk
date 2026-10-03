import { describe, expect, it } from 'vitest';
import { EmailError } from '../../src/errors.ts';
import { resend } from '../../src/providers/resend/index.ts';
import type { SendEmailParams } from '../../src/types.ts';
import { createFetchStub, type StubHandler } from '../helpers/fetch-stub.ts';

const message: SendEmailParams = {
  from: 'sender@example.com',
  to: 'jane@example.com',
  subject: 'Hello',
  text: 'Hi Jane',
};

function setup(handler: StubHandler) {
  const stub = createFetchStub(handler);
  const provider = resend({ apiKey: 're_test', fetch: stub.fetch });
  return { provider, requests: stub.requests };
}

function bodyOf(request: { body?: string } | undefined): unknown {
  return JSON.parse(request?.body ?? '');
}

describe('resend', () => {
  it('requires an apiKey', () => {
    expect(() => resend({ apiKey: '' })).toThrow(
      new EmailError('Missing required resend options: apiKey', {
        code: 'validation',
        provider: 'resend',
      }),
    );
  });

  describe('send', () => {
    it('posts the email to /emails', async () => {
      const { provider, requests } = setup(() => ({ json: { id: 'email-1' } }));

      const result = await provider.send(message);

      expect(provider.name).toBe('resend');
      expect(result).toEqual({ id: 'email-1', raw: { id: 'email-1' } });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: 'https://api.resend.com/emails',
        method: 'POST',
        headers: { authorization: 'Bearer re_test', 'content-type': 'application/json' },
      });
      expect(bodyOf(requests[0])).toEqual({
        from: 'sender@example.com',
        to: ['jane@example.com'],
        subject: 'Hello',
        text: 'Hi Jane',
      });
    });

    it('maps every field', async () => {
      const { provider, requests } = setup(() => ({ json: { id: 'email-1' } }));

      await provider.send({
        from: { email: 'sender@example.com', name: 'Sender' },
        to: ['jane@example.com', { email: 'john@example.com', name: 'John' }],
        cc: 'cc@example.com',
        bcc: ['bcc@example.com'],
        replyTo: 'reply@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
        headers: { 'X-Entity-Ref-ID': '123' },
        attachments: [
          { filename: 'a.txt', content: new TextEncoder().encode('hello') },
          {
            filename: 'logo.png',
            content: 'iVBORw0=',
            contentType: 'image/png',
            contentId: 'logo',
          },
        ],
        tags: { category: 'welcome', plan: 'pro' },
      });

      expect(bodyOf(requests[0])).toEqual({
        from: '"Sender" <sender@example.com>',
        to: ['jane@example.com', '"John" <john@example.com>'],
        cc: ['cc@example.com'],
        bcc: ['bcc@example.com'],
        reply_to: ['reply@example.com'],
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
        headers: { 'X-Entity-Ref-ID': '123' },
        attachments: [
          { filename: 'a.txt', content: 'aGVsbG8=' },
          {
            filename: 'logo.png',
            content: 'iVBORw0=',
            content_type: 'image/png',
            content_id: 'logo',
          },
        ],
        tags: [
          { name: 'category', value: 'welcome' },
          { name: 'plan', value: 'pro' },
        ],
      });
    });

    it('sends the idempotency key as a header', async () => {
      const { provider, requests } = setup(() => ({ json: { id: 'email-1' } }));

      await provider.send({ ...message, idempotencyKey: 'welcome/user-1' });

      expect(requests[0]?.headers['idempotency-key']).toBe('welcome/user-1');
      expect(bodyOf(requests[0])).not.toHaveProperty('idempotencyKey');
    });

    it('uses the Resend error message', async () => {
      const body = { statusCode: 401, name: 'missing_api_key', message: 'Missing API key' };
      const { provider } = setup(() => ({ status: 401, json: body }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: 'Missing API key',
        code: 'auth',
        provider: 'resend',
        status: 401,
        raw: body,
      });
    });

    it('maps a 403 validation_error to validation', async () => {
      const { provider } = setup(() => ({
        status: 403,
        json: { name: 'validation_error', message: 'The example.com domain is not verified.' },
      }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'validation', status: 403 });
    });

    it('keeps a 401 validation_error for an invalid API key as auth', async () => {
      const { provider } = setup(() => ({
        status: 401,
        json: { message: 'API key is invalid', name: 'validation_error', statusCode: 401 },
      }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'auth', message: 'API key is invalid', status: 401 });
    });

    it('reads Retry-After on rate limits', async () => {
      const { provider } = setup(() => ({
        status: 429,
        headers: { 'Retry-After': '2' },
        json: { name: 'rate_limit_exceeded', message: 'Too many requests.' },
      }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'rate_limited', retryAfter: 2 });
    });
  });

  describe('sendBatch', () => {
    it('posts the emails to /emails/batch in permissive mode', async () => {
      const { provider, requests } = setup(() => ({
        json: { data: [{ id: 'a' }, { id: 'b' }], errors: [] },
      }));

      const results = await provider.sendBatch!([message, { ...message, to: 'john@example.com' }]);

      expect(results).toEqual([
        { ok: true, id: 'a', raw: { id: 'a' } },
        { ok: true, id: 'b', raw: { id: 'b' } },
      ]);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: 'https://api.resend.com/emails/batch',
        headers: { 'x-batch-validation': 'permissive' },
      });
      expect(bodyOf(requests[0])).toEqual([
        { from: 'sender@example.com', to: ['jane@example.com'], subject: 'Hello', text: 'Hi Jane' },
        { from: 'sender@example.com', to: ['john@example.com'], subject: 'Hello', text: 'Hi Jane' },
      ]);
    });

    it('reports per-message errors at their index', async () => {
      const failure = { index: 1, message: 'Invalid `to` field.' };
      const { provider } = setup(() => ({
        json: { data: [{ id: 'a' }, { id: 'c' }], errors: [failure] },
      }));

      const results = await provider.sendBatch!([message, message, message]);

      expect(results[0]).toEqual({ ok: true, id: 'a', raw: { id: 'a' } });
      expect(results[1]).toEqual({
        ok: false,
        error: new EmailError('Invalid `to` field.', {
          code: 'validation',
          provider: 'resend',
          raw: failure,
        }),
      });
      expect(results[2]).toEqual({ ok: true, id: 'c', raw: { id: 'c' } });
    });

    it('splits batches larger than 100', async () => {
      const { provider, requests } = setup((request) => {
        const count = (JSON.parse(request.body ?? '') as unknown[]).length;
        return { json: { data: Array.from({ length: count }, (_, i) => ({ id: `id-${i}` })) } };
      });

      const results = await provider.sendBatch!(Array.from({ length: 150 }, () => message));

      expect(requests.map((request) => (bodyOf(request) as unknown[]).length)).toEqual([100, 50]);
      expect(results).toHaveLength(150);
      expect(results.every((result) => result.ok)).toBe(true);
    });

    it('fails every message in a chunk when the request fails', async () => {
      const { provider } = setup(() => ({
        status: 401,
        json: { name: 'missing_api_key', message: 'Missing API key' },
      }));

      const results = await provider.sendBatch!([message, message]);

      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result).toMatchObject({ ok: false, error: { code: 'auth', status: 401 } });
      }
    });

    it('sends one by one when a message has attachments', async () => {
      let count = 0;
      const { provider, requests } = setup(() => ({ json: { id: `id-${++count}` } }));

      const results = await provider.sendBatch!([
        message,
        { ...message, attachments: [{ filename: 'a.txt', content: 'aGVsbG8=' }] },
      ]);

      expect(requests.map((request) => request.url)).toEqual([
        'https://api.resend.com/emails',
        'https://api.resend.com/emails',
      ]);
      expect(results).toEqual([
        { ok: true, id: 'id-1', raw: { id: 'id-1' } },
        { ok: true, id: 'id-2', raw: { id: 'id-2' } },
      ]);
    });

    it('sends one by one with each idempotency key', async () => {
      const { provider, requests } = setup(() => ({ json: { id: 'id' } }));

      await provider.sendBatch!([
        { ...message, idempotencyKey: 'key-1' },
        { ...message, idempotencyKey: 'key-2' },
      ]);

      expect(requests.map((request) => request.url)).toEqual([
        'https://api.resend.com/emails',
        'https://api.resend.com/emails',
      ]);
      expect(requests.map((request) => request.headers['idempotency-key'])).toEqual([
        'key-1',
        'key-2',
      ]);
    });
  });
});
