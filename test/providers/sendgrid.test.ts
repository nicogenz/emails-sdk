import { describe, expect, it } from 'vitest';
import { EmailError } from '../../src/errors.ts';
import { sendgrid, type SendGridProviderOptions } from '../../src/providers/sendgrid/index.ts';
import type { SendEmailParams } from '../../src/types.ts';
import { createFetchStub, type StubHandler } from '../helpers/fetch-stub.ts';

const message: SendEmailParams = {
  from: 'sender@example.com',
  to: 'jane@example.com',
  subject: 'Hello',
  text: 'Hi Jane',
};

const accepted = { status: 202, headers: { 'X-Message-Id': 'sg-1' } };

function setup(handler: StubHandler, options: Partial<SendGridProviderOptions> = {}) {
  const stub = createFetchStub(handler);
  const provider = sendgrid({ apiKey: 'SG.test', fetch: stub.fetch, ...options });
  return { provider, requests: stub.requests };
}

function bodyOf(request: { body?: string } | undefined): unknown {
  return JSON.parse(request?.body ?? '');
}

describe('sendgrid', () => {
  it('requires an apiKey', () => {
    expect(() => sendgrid({ apiKey: '' })).toThrow(
      new EmailError('Missing required sendgrid options: apiKey', {
        code: 'validation',
        provider: 'sendgrid',
      }),
    );
  });

  it('has no native batch', () => {
    expect(sendgrid({ apiKey: 'SG.test' }).sendBatch).toBeUndefined();
  });

  describe('send', () => {
    it('posts the email to /v3/mail/send and returns the X-Message-Id', async () => {
      const { provider, requests } = setup(() => accepted);

      const result = await provider.send(message);

      expect(provider.name).toBe('sendgrid');
      expect(result).toEqual({ id: 'sg-1', raw: undefined });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: 'https://api.sendgrid.com/v3/mail/send',
        method: 'POST',
        headers: { authorization: 'Bearer SG.test', 'content-type': 'application/json' },
      });
      expect(bodyOf(requests[0])).toEqual({
        personalizations: [{ to: [{ email: 'jane@example.com' }] }],
        from: { email: 'sender@example.com' },
        subject: 'Hello',
        content: [{ type: 'text/plain', value: 'Hi Jane' }],
      });
    });

    it('uses the EU host for the eu region', async () => {
      const { provider, requests } = setup(() => accepted, { region: 'eu' });

      await provider.send(message);

      expect(requests[0]?.url).toBe('https://api.eu.sendgrid.com/v3/mail/send');
    });

    it('maps every field', async () => {
      const { provider, requests } = setup(() => accepted);

      await provider.send({
        from: 'Sender <sender@example.com>',
        to: ['jane@example.com', { email: 'john@example.com', name: 'John' }],
        cc: '"Doe, Cc" <cc@example.com>',
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
        personalizations: [
          {
            to: [{ email: 'jane@example.com' }, { email: 'john@example.com', name: 'John' }],
            cc: [{ email: 'cc@example.com', name: 'Doe, Cc' }],
            bcc: [{ email: 'bcc@example.com' }],
          },
        ],
        from: { email: 'sender@example.com', name: 'Sender' },
        reply_to: { email: 'reply@example.com' },
        subject: 'Hello',
        content: [
          { type: 'text/plain', value: 'Hi' },
          { type: 'text/html', value: '<p>Hi</p>' },
        ],
        attachments: [
          { content: 'aGVsbG8=', filename: 'a.txt' },
          {
            content: 'iVBORw0=',
            filename: 'logo.png',
            type: 'image/png',
            disposition: 'inline',
            content_id: 'logo',
          },
        ],
        headers: { 'X-Entity-Ref-ID': '123' },
        custom_args: { category: 'welcome', plan: 'pro' },
      });
    });

    it('uses reply_to_list for several reply-to addresses', async () => {
      const { provider, requests } = setup(() => accepted);

      await provider.send({ ...message, replyTo: ['a@example.com', 'b@example.com'] });

      expect(bodyOf(requests[0])).toMatchObject({
        reply_to_list: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
      });
      expect(bodyOf(requests[0])).not.toHaveProperty('reply_to');
    });

    it('rejects an idempotency key without sending', async () => {
      const { provider, requests } = setup(() => accepted);

      const error = await provider
        .send({ ...message, idempotencyKey: 'key-1' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: 'sendgrid does not support idempotencyKey',
        code: 'unsupported',
        provider: 'sendgrid',
      });
      expect(requests).toHaveLength(0);
    });

    it('joins the SendGrid error messages', async () => {
      const body = {
        errors: [
          { message: 'The subject is required.', field: 'subject' },
          { message: 'Invalid email address.', field: 'personalizations.0.to.0.email' },
        ],
      };
      const { provider } = setup(() => ({ status: 400, json: body }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: 'The subject is required.; Invalid email address.',
        code: 'validation',
        provider: 'sendgrid',
        status: 400,
        raw: body,
      });
    });

    it('maps a 403 for an unverified sender to validation', async () => {
      const { provider } = setup(() => ({
        status: 403,
        json: {
          errors: [
            {
              message: 'The from address does not match a verified Sender Identity.',
              field: 'from',
            },
          ],
        },
      }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'validation', status: 403 });
    });

    it('keeps a 403 without a field as auth', async () => {
      const { provider } = setup(() => ({
        status: 403,
        json: { errors: [{ message: 'access forbidden', field: null }] },
      }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'auth', message: 'access forbidden', status: 403 });
    });
  });
});
