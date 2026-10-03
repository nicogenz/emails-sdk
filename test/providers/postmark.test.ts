import { describe, expect, it } from 'vitest';
import { EmailError } from '../../src/errors.ts';
import { postmark, type PostmarkProviderOptions } from '../../src/providers/postmark/index.ts';
import type { SendEmailParams } from '../../src/types.ts';
import { createFetchStub, type StubHandler } from '../helpers/fetch-stub.ts';

const message: SendEmailParams = {
  from: 'sender@example.com',
  to: 'jane@example.com',
  subject: 'Hello',
  text: 'Hi Jane',
};

function ok(id: string, to = 'jane@example.com') {
  return {
    To: to,
    SubmittedAt: '2026-10-02T10:00:00Z',
    MessageID: id,
    ErrorCode: 0,
    Message: 'OK',
  };
}

function setup(handler: StubHandler, options: Partial<PostmarkProviderOptions> = {}) {
  const stub = createFetchStub(handler);
  const provider = postmark({ serverToken: 'pm_test', fetch: stub.fetch, ...options });
  return { provider, requests: stub.requests };
}

function bodyOf(request: { body?: string } | undefined): unknown {
  return JSON.parse(request?.body ?? '');
}

describe('postmark', () => {
  it('requires a serverToken', () => {
    expect(() => postmark({ serverToken: '' })).toThrow(
      new EmailError('Missing required postmark options: serverToken', {
        code: 'validation',
        provider: 'postmark',
      }),
    );
  });

  describe('send', () => {
    it('posts the email to /email', async () => {
      const { provider, requests } = setup(() => ({ json: ok('msg-1') }));

      const result = await provider.send(message);

      expect(provider.name).toBe('postmark');
      expect(result).toEqual({ id: 'msg-1', raw: ok('msg-1') });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: 'https://api.postmarkapp.com/email',
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-postmark-server-token': 'pm_test',
        },
      });
      expect(bodyOf(requests[0])).toEqual({
        From: 'sender@example.com',
        To: 'jane@example.com',
        Subject: 'Hello',
        TextBody: 'Hi Jane',
      });
    });

    it('maps every field', async () => {
      const { provider, requests } = setup(() => ({ json: ok('msg-1') }));

      await provider.send({
        from: { email: 'sender@example.com', name: 'Sender' },
        to: ['jane@example.com', { email: 'john@example.com', name: 'Doe, John' }],
        cc: 'cc@example.com',
        bcc: ['bcc1@example.com', 'bcc2@example.com'],
        replyTo: ['reply1@example.com', 'reply2@example.com'],
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
        From: '"Sender" <sender@example.com>',
        To: 'jane@example.com, "Doe, John" <john@example.com>',
        Cc: 'cc@example.com',
        Bcc: 'bcc1@example.com, bcc2@example.com',
        ReplyTo: 'reply1@example.com, reply2@example.com',
        Subject: 'Hello',
        HtmlBody: '<p>Hi</p>',
        TextBody: 'Hi',
        Headers: [{ Name: 'X-Entity-Ref-ID', Value: '123' }],
        Attachments: [
          { Name: 'a.txt', Content: 'aGVsbG8=', ContentType: 'application/octet-stream' },
          {
            Name: 'logo.png',
            Content: 'iVBORw0=',
            ContentType: 'image/png',
            ContentID: 'cid:logo',
          },
        ],
        Metadata: { category: 'welcome', plan: 'pro' },
      });
    });

    it('sends the configured message stream', async () => {
      const { provider, requests } = setup(() => ({ json: ok('msg-1') }), {
        messageStream: 'broadcast',
      });

      await provider.send(message);

      expect(bodyOf(requests[0])).toMatchObject({ MessageStream: 'broadcast' });
    });

    it('rejects an idempotency key without sending', async () => {
      const { provider, requests } = setup(() => ({ json: ok('msg-1') }));

      const error = await provider
        .send({ ...message, idempotencyKey: 'key-1' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: 'postmark does not support idempotencyKey',
        code: 'unsupported',
        provider: 'postmark',
      });
      expect(requests).toHaveLength(0);
    });

    it('uses the Postmark error message', async () => {
      const body = { ErrorCode: 300, Message: "Invalid 'To' address: 'nope'." };
      const { provider } = setup(() => ({ status: 422, json: body }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: "Invalid 'To' address: 'nope'.",
        code: 'validation',
        provider: 'postmark',
        status: 422,
        raw: body,
      });
    });

    it('maps ErrorCode 10 to auth', async () => {
      const { provider } = setup(() => ({
        status: 422,
        json: { ErrorCode: 10, Message: 'Bad or missing Server API token.' },
      }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'auth', status: 422 });
    });
  });

  describe('sendBatch', () => {
    it('posts the emails to /email/batch', async () => {
      const { provider, requests } = setup(() => ({
        json: [ok('a'), ok('b', 'john@example.com')],
      }));

      const results = await provider.sendBatch!([message, { ...message, to: 'john@example.com' }]);

      expect(results).toEqual([
        { ok: true, id: 'a', raw: ok('a') },
        { ok: true, id: 'b', raw: ok('b', 'john@example.com') },
      ]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('https://api.postmarkapp.com/email/batch');
      expect(bodyOf(requests[0])).toEqual([
        {
          From: 'sender@example.com',
          To: 'jane@example.com',
          Subject: 'Hello',
          TextBody: 'Hi Jane',
        },
        {
          From: 'sender@example.com',
          To: 'john@example.com',
          Subject: 'Hello',
          TextBody: 'Hi Jane',
        },
      ]);
    });

    it('reports per-message errors', async () => {
      const failure = { ErrorCode: 406, Message: 'You tried to send to an inactive recipient.' };
      const { provider } = setup(() => ({ json: [ok('a'), failure, ok('c')] }));

      const results = await provider.sendBatch!([message, message, message]);

      expect(results).toEqual([
        { ok: true, id: 'a', raw: ok('a') },
        {
          ok: false,
          error: new EmailError(failure.Message, {
            code: 'validation',
            provider: 'postmark',
            raw: failure,
          }),
        },
        { ok: true, id: 'c', raw: ok('c') },
      ]);
    });

    it('splits batches larger than 500', async () => {
      const { provider, requests } = setup((request) => {
        const count = (JSON.parse(request.body ?? '') as unknown[]).length;
        return { json: Array.from({ length: count }, (_, i) => ok(`id-${i}`)) };
      });

      const results = await provider.sendBatch!(Array.from({ length: 501 }, () => message));

      expect(requests.map((request) => (bodyOf(request) as unknown[]).length)).toEqual([500, 1]);
      expect(results).toHaveLength(501);
      expect(results.every((result) => result.ok)).toBe(true);
    });

    it('fails every message in a chunk when the request fails', async () => {
      const { provider } = setup(() => ({
        status: 401,
        json: { ErrorCode: 10, Message: 'Bad or missing Server API token.' },
      }));

      const results = await provider.sendBatch!([message, message]);

      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result).toMatchObject({ ok: false, error: { code: 'auth', status: 401 } });
      }
    });

    it('sends one by one when a message has an idempotency key', async () => {
      const { provider, requests } = setup(() => ({ json: ok('a') }));

      const results = await provider.sendBatch!([message, { ...message, idempotencyKey: 'key-1' }]);

      expect(requests.map((request) => request.url)).toEqual(['https://api.postmarkapp.com/email']);
      expect(results[0]).toEqual({ ok: true, id: 'a', raw: ok('a') });
      expect(results[1]).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    });
  });
});
