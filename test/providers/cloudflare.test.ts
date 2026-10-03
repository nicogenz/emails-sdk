import { describe, expect, it } from 'vitest';
import { EmailError } from '../../src/errors.ts';
import { cloudflare, type CloudflareEmailBinding } from '../../src/providers/cloudflare/index.ts';
import type { SendEmailParams } from '../../src/types.ts';
import { createFetchStub, type StubHandler } from '../helpers/fetch-stub.ts';

const message: SendEmailParams = {
  from: 'sender@example.com',
  to: 'jane@example.com',
  subject: 'Hello',
  text: 'Hi Jane',
};

const fullMessage: SendEmailParams = {
  from: { email: 'sender@example.com', name: 'Sender' },
  to: ['jane@example.com', 'John <john@example.com>'],
  cc: 'cc@example.com',
  bcc: ['bcc@example.com'],
  replyTo: { email: 'reply@example.com', name: 'Support' },
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: 'Hi',
  headers: { 'X-Entity-Ref-ID': '123' },
  attachments: [
    { filename: 'a.txt', content: new TextEncoder().encode('hello') },
    { filename: 'logo.png', content: 'iVBORw0=', contentType: 'image/png', contentId: 'logo' },
  ],
};

function sentResponse(result: Record<string, unknown> = {}) {
  return {
    success: true,
    errors: [],
    messages: [],
    result: {
      message_id: 'cf-1',
      delivered: ['jane@example.com'],
      permanent_bounces: [],
      queued: [],
      suppressed_recipients: [],
      ...result,
    },
  };
}

function setup(handler: StubHandler) {
  const stub = createFetchStub(handler);
  const provider = cloudflare({ accountId: 'account-1', apiToken: 'cf-token', fetch: stub.fetch });
  return { provider, requests: stub.requests };
}

function setupBinding(send: () => Promise<{ messageId: string }>) {
  const messages: object[] = [];
  const binding: CloudflareEmailBinding = {
    async send(message) {
      messages.push(message);
      return send();
    },
  };
  return { provider: cloudflare({ binding }), messages };
}

function bodyOf(request: { body?: string } | undefined): unknown {
  return JSON.parse(request?.body ?? '');
}

describe('cloudflare', () => {
  it('requires an accountId and apiToken', () => {
    expect(() => cloudflare({ accountId: '', apiToken: '' })).toThrow(
      new EmailError('Missing required cloudflare options: accountId, apiToken', {
        code: 'validation',
        provider: 'cloudflare',
      }),
    );
  });

  it('requires a binding', () => {
    expect(() => cloudflare({ binding: undefined as unknown as CloudflareEmailBinding })).toThrow(
      new EmailError('Missing required cloudflare options: binding', {
        code: 'validation',
        provider: 'cloudflare',
      }),
    );
  });

  it('has no native batch', () => {
    expect(cloudflare({ accountId: 'account-1', apiToken: 'cf-token' }).sendBatch).toBeUndefined();
  });

  describe('send with the REST API', () => {
    it('posts the email and returns the message_id', async () => {
      const { provider, requests } = setup(() => ({ json: sentResponse() }));

      const result = await provider.send(message);

      expect(provider.name).toBe('cloudflare');
      expect(result).toEqual({ id: 'cf-1', raw: sentResponse() });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: 'https://api.cloudflare.com/client/v4/accounts/account-1/email/sending/send',
        method: 'POST',
        headers: { authorization: 'Bearer cf-token', 'content-type': 'application/json' },
      });
      expect(bodyOf(requests[0])).toEqual({
        from: 'sender@example.com',
        to: ['jane@example.com'],
        subject: 'Hello',
        text: 'Hi Jane',
      });
    });

    it('maps every field', async () => {
      const { provider, requests } = setup(() => ({ json: sentResponse() }));

      await provider.send(fullMessage);

      expect(bodyOf(requests[0])).toEqual({
        from: { address: 'sender@example.com', name: 'Sender' },
        to: ['jane@example.com', { address: 'john@example.com', name: 'John' }],
        cc: ['cc@example.com'],
        bcc: ['bcc@example.com'],
        reply_to: { address: 'reply@example.com', name: 'Support' },
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
        headers: { 'X-Entity-Ref-ID': '123' },
        attachments: [
          {
            content: 'aGVsbG8=',
            filename: 'a.txt',
            type: 'application/octet-stream',
            disposition: 'attachment',
          },
          {
            content: 'iVBORw0=',
            filename: 'logo.png',
            type: 'image/png',
            disposition: 'inline',
            content_id: 'logo',
          },
        ],
      });
    });

    it('returns the message_id even when every recipient bounced', async () => {
      const body = sentResponse({ delivered: [], permanent_bounces: ['jane@example.com'] });
      const { provider } = setup(() => ({ json: body }));

      const result = await provider.send(message);

      expect(result).toEqual({ id: 'cf-1', raw: body });
    });

    it('joins the Cloudflare error messages', async () => {
      const body = {
        success: false,
        errors: [
          { code: 10001, message: 'email.sending.error.invalid_request_schema' },
          { code: 10202, message: 'email.sending.error.email.invalid' },
        ],
        messages: [],
        result: null,
      };
      const { provider } = setup(() => ({ status: 400, json: body }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: 'email.sending.error.invalid_request_schema; email.sending.error.email.invalid',
        code: 'validation',
        provider: 'cloudflare',
        status: 400,
        raw: body,
      });
    });
  });

  describe('send with a Workers binding', () => {
    it('passes the email to the binding and returns the messageId', async () => {
      const { provider, messages } = setupBinding(async () => ({ messageId: 'msg-1' }));

      const result = await provider.send(message);

      expect(result).toEqual({ id: 'msg-1', raw: { messageId: 'msg-1' } });
      expect(messages).toEqual([
        { from: 'sender@example.com', to: ['jane@example.com'], subject: 'Hello', text: 'Hi Jane' },
      ]);
    });

    it('maps every field', async () => {
      const { provider, messages } = setupBinding(async () => ({ messageId: 'msg-1' }));

      await provider.send(fullMessage);

      expect(messages[0]).toEqual({
        from: { email: 'sender@example.com', name: 'Sender' },
        to: ['jane@example.com', { email: 'john@example.com', name: 'John' }],
        cc: ['cc@example.com'],
        bcc: ['bcc@example.com'],
        replyTo: { email: 'reply@example.com', name: 'Support' },
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
        headers: { 'X-Entity-Ref-ID': '123' },
        attachments: [
          {
            content: 'aGVsbG8=',
            filename: 'a.txt',
            type: 'application/octet-stream',
            disposition: 'attachment',
          },
          {
            content: 'iVBORw0=',
            filename: 'logo.png',
            type: 'image/png',
            disposition: 'inline',
            contentId: 'logo',
          },
        ],
      });
    });

    it.each([
      ['E_SENDER_NOT_VERIFIED', 'validation'],
      ['E_TOO_MANY_RECIPIENTS', 'validation'],
      ['E_RATE_LIMIT_EXCEEDED', 'rate_limited'],
      ['E_DAILY_LIMIT_EXCEEDED', 'rate_limited'],
      ['E_DELIVERY_FAILED', 'provider_error'],
      ['E_INTERNAL_SERVER_ERROR', 'provider_error'],
    ])('maps the binding error %s to %s', async (bindingCode, code) => {
      const thrown = Object.assign(new Error('Sending failed'), { code: bindingCode });
      const { provider } = setupBinding(async () => {
        throw thrown;
      });

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: 'Sending failed',
        code,
        provider: 'cloudflare',
        cause: thrown,
      });
    });

    it('maps a binding error without a code to provider_error', async () => {
      const { provider } = setupBinding(async () => {
        throw new Error('Something broke');
      });

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toMatchObject({ message: 'Something broke', code: 'provider_error' });
    });
  });

  it.each<[string, Partial<SendEmailParams>, string]>([
    ['an idempotency key', { idempotencyKey: 'key-1' }, 'idempotencyKey'],
    ['tags', { tags: { category: 'welcome' } }, 'tags'],
    [
      'several reply-to addresses',
      { replyTo: ['a@example.com', 'b@example.com'] },
      'multiple replyTo addresses',
    ],
  ])('rejects %s without sending', async (_name, fields, field) => {
    const { provider, requests } = setup(() => ({ json: sentResponse() }));

    const error = await provider.send({ ...message, ...fields }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmailError);
    expect(error).toMatchObject({
      message: `cloudflare does not support ${field}`,
      code: 'unsupported',
      provider: 'cloudflare',
    });
    expect(requests).toHaveLength(0);
  });
});
