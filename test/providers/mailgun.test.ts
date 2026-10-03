import { describe, expect, it } from 'vitest';
import { EmailError } from '../../src/errors.ts';
import { mailgun, type MailgunProviderOptions } from '../../src/providers/mailgun/index.ts';
import type { SendEmailParams } from '../../src/types.ts';
import { createFetchStub, type StubHandler, type StubRequest } from '../helpers/fetch-stub.ts';

const message: SendEmailParams = {
  from: 'sender@example.com',
  to: 'jane@example.com',
  subject: 'Hello',
  text: 'Hi Jane',
};

const queued = {
  json: { id: '<20261002101500.1.ABC@mg.example.com>', message: 'Queued. Thank you.' },
};

function setup(handler: StubHandler, options: Partial<MailgunProviderOptions> = {}) {
  const stub = createFetchStub(handler);
  const provider = mailgun({
    apiKey: 'key-test',
    domain: 'mg.example.com',
    fetch: stub.fetch,
    ...options,
  });
  return { provider, requests: stub.requests };
}

function formOf(request: StubRequest | undefined): Promise<FormData> {
  return new Response(request?.body, {
    headers: { 'content-type': request?.headers['content-type'] ?? '' },
  }).formData();
}

function fieldsOf(form: FormData): [string, string][] {
  return [...form.entries()]
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, value]) => [name, value]);
}

describe('mailgun', () => {
  it('requires an apiKey and a domain', () => {
    expect(() => mailgun({ apiKey: '', domain: '' })).toThrow(
      new EmailError('Missing required mailgun options: apiKey, domain', {
        code: 'validation',
        provider: 'mailgun',
      }),
    );
  });

  it('has no native batch', () => {
    expect(mailgun({ apiKey: 'key-test', domain: 'mg.example.com' }).sendBatch).toBeUndefined();
  });

  describe('send', () => {
    it('posts the email to /v3/{domain}/messages', async () => {
      const { provider, requests } = setup(() => queued);

      const result = await provider.send(message);

      expect(provider.name).toBe('mailgun');
      expect(result).toEqual({ id: '20261002101500.1.ABC@mg.example.com', raw: queued.json });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: 'https://api.mailgun.net/v3/mg.example.com/messages',
        method: 'POST',
        headers: { authorization: `Basic ${btoa('api:key-test')}` },
      });
      expect(requests[0]?.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
      expect(fieldsOf(await formOf(requests[0]))).toEqual([
        ['from', 'sender@example.com'],
        ['to', 'jane@example.com'],
        ['subject', 'Hello'],
        ['text', 'Hi Jane'],
      ]);
    });

    it('uses the EU host for the eu region', async () => {
      const { provider, requests } = setup(() => queued, { region: 'eu' });

      await provider.send(message);

      expect(requests[0]?.url).toBe('https://api.eu.mailgun.net/v3/mg.example.com/messages');
    });

    it('maps every field', async () => {
      const { provider, requests } = setup(() => queued);

      await provider.send({
        from: { email: 'sender@example.com', name: 'Sender' },
        to: ['jane@example.com', { email: 'john@example.com', name: 'Doe, John' }],
        cc: 'cc@example.com',
        bcc: ['bcc@example.com'],
        replyTo: ['reply1@example.com', 'reply2@example.com'],
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
        headers: { 'X-Entity-Ref-ID': '123' },
        tags: { category: 'welcome', plan: 'pro' },
      });

      expect(fieldsOf(await formOf(requests[0]))).toEqual([
        ['from', '"Sender" <sender@example.com>'],
        ['to', 'jane@example.com'],
        ['to', '"Doe, John" <john@example.com>'],
        ['cc', 'cc@example.com'],
        ['bcc', 'bcc@example.com'],
        ['subject', 'Hello'],
        ['text', 'Hi'],
        ['html', '<p>Hi</p>'],
        ['h:Reply-To', 'reply1@example.com, reply2@example.com'],
        ['h:X-Entity-Ref-ID', '123'],
        ['v:category', 'welcome'],
        ['v:plan', 'pro'],
      ]);
    });

    it('sends attachments and inline images as files', async () => {
      const { provider, requests } = setup(() => queued);

      await provider.send({
        ...message,
        attachments: [
          {
            filename: 'a.txt',
            content: new TextEncoder().encode('hello'),
            contentType: 'text/plain',
          },
          { filename: 'logo.png', content: 'aGk=', contentType: 'image/png', contentId: 'logo' },
        ],
      });

      const form = await formOf(requests[0]);
      const attachment = form.get('attachment') as File;
      const inline = form.get('inline') as File;
      expect(attachment.name).toBe('a.txt');
      expect(attachment.type).toBe('text/plain');
      expect(await attachment.text()).toBe('hello');
      expect(inline.name).toBe('logo');
      expect(inline.type).toBe('image/png');
      expect(await inline.text()).toBe('hi');
    });

    it('rejects an idempotency key without sending', async () => {
      const { provider, requests } = setup(() => queued);

      const error = await provider
        .send({ ...message, idempotencyKey: 'key-1' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: 'mailgun does not support idempotencyKey',
        code: 'unsupported',
        provider: 'mailgun',
      });
      expect(requests).toHaveLength(0);
    });

    it('uses the Mailgun error message', async () => {
      const body = { message: "'to' parameter is not a valid address. please check documentation" };
      const { provider } = setup(() => ({ status: 400, json: body }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: body.message,
        code: 'validation',
        provider: 'mailgun',
        status: 400,
        raw: body,
      });
    });

    it('keeps a plain-text error body as raw', async () => {
      const { provider } = setup(() => ({ status: 401, body: 'Forbidden' }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toMatchObject({
        message: 'Request to mailgun failed with status 401',
        code: 'auth',
        raw: 'Forbidden',
      });
    });
  });
});
