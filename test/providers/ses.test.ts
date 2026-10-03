import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailError } from '../../src/errors.ts';
import { ses, type SesProviderOptions } from '../../src/providers/ses/index.ts';
import { signRequest } from '../../src/providers/ses/sign.ts';
import type { SendEmailParams } from '../../src/types.ts';
import { createFetchStub, type StubHandler } from '../helpers/fetch-stub.ts';

const message: SendEmailParams = {
  from: 'sender@example.com',
  to: 'jane@example.com',
  subject: 'Hello',
  text: 'Hi Jane',
};

const credentials = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

const sent = { json: { MessageId: 'ses-1' } };

function setup(handler: StubHandler, options: Partial<SesProviderOptions> = {}) {
  const stub = createFetchStub(handler);
  const provider = ses({ region: 'eu-central-1', ...credentials, fetch: stub.fetch, ...options });
  return { provider, requests: stub.requests };
}

function bodyOf(request: { body?: string } | undefined): unknown {
  return JSON.parse(request?.body ?? '');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T10:15:30.123Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ses', () => {
  it('requires a region and credentials', () => {
    expect(() => ses({ region: '', accessKeyId: '', secretAccessKey: '' })).toThrow(
      new EmailError('Missing required ses options: region, accessKeyId, secretAccessKey', {
        code: 'validation',
        provider: 'ses',
      }),
    );
  });

  it('has no native batch', () => {
    expect(ses({ region: 'eu-central-1', ...credentials }).sendBatch).toBeUndefined();
  });

  describe('send', () => {
    it('posts a signed request to the regional endpoint', async () => {
      const { provider, requests } = setup(() => sent);

      const result = await provider.send(message);

      expect(provider.name).toBe('ses');
      expect(result).toEqual({ id: 'ses-1', raw: { MessageId: 'ses-1' } });
      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request).toMatchObject({
        url: 'https://email.eu-central-1.amazonaws.com/v2/email/outbound-emails',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-amz-date': '20261002T101530Z' },
      });
      const expected = await signRequest({
        method: 'POST',
        url: 'https://email.eu-central-1.amazonaws.com/v2/email/outbound-emails',
        headers: { 'Content-Type': 'application/json' },
        body: request?.body ?? '',
        region: 'eu-central-1',
        service: 'ses',
        credentials,
        date: new Date('2026-10-02T10:15:30Z'),
      });
      expect(request?.headers.authorization).toBe(expected.Authorization);
      expect(request?.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261002\/eu-central-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
      );
      expect(bodyOf(request)).toEqual({
        FromEmailAddress: 'sender@example.com',
        Destination: { ToAddresses: ['jane@example.com'] },
        Content: {
          Simple: {
            Subject: { Data: 'Hello', Charset: 'UTF-8' },
            Body: { Text: { Data: 'Hi Jane', Charset: 'UTF-8' } },
          },
        },
      });
    });

    it('signs the session token', async () => {
      const { provider, requests } = setup(() => sent, { sessionToken: 'token-1' });

      await provider.send(message);

      expect(requests[0]?.headers['x-amz-security-token']).toBe('token-1');
      expect(requests[0]?.headers.authorization).toContain(
        'SignedHeaders=content-type;host;x-amz-date;x-amz-security-token',
      );
    });

    it('maps every field', async () => {
      const { provider, requests } = setup(() => sent, { configurationSetName: 'tracking' });

      await provider.send({
        from: { email: 'sender@example.com', name: 'Sender' },
        to: ['jane@example.com', 'Jürgen Müller <juergen@example.com>'],
        cc: 'cc@example.com',
        bcc: ['bcc@example.com'],
        replyTo: ['reply@example.com'],
        subject: 'Grüße',
        html: '<p>Hi</p>',
        text: 'Hi',
        headers: { 'X-Entity-Ref-ID': '123' },
        attachments: [
          {
            filename: 'a.txt',
            content: new TextEncoder().encode('hello'),
            contentType: 'text/plain',
          },
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
        FromEmailAddress: '"Sender" <sender@example.com>',
        Destination: {
          ToAddresses: [
            'jane@example.com',
            '=?UTF-8?B?SsO8cmdlbiBNw7xsbGVy?= <juergen@example.com>',
          ],
          CcAddresses: ['cc@example.com'],
          BccAddresses: ['bcc@example.com'],
        },
        ReplyToAddresses: ['reply@example.com'],
        Content: {
          Simple: {
            Subject: { Data: 'Grüße', Charset: 'UTF-8' },
            Body: {
              Text: { Data: 'Hi', Charset: 'UTF-8' },
              Html: { Data: '<p>Hi</p>', Charset: 'UTF-8' },
            },
            Headers: [{ Name: 'X-Entity-Ref-ID', Value: '123' }],
            Attachments: [
              { FileName: 'a.txt', RawContent: 'aGVsbG8=', ContentType: 'text/plain' },
              {
                FileName: 'logo.png',
                RawContent: 'iVBORw0=',
                ContentType: 'image/png',
                ContentId: 'logo',
                ContentDisposition: 'INLINE',
              },
            ],
          },
        },
        EmailTags: [
          { Name: 'category', Value: 'welcome' },
          { Name: 'plan', Value: 'pro' },
        ],
        ConfigurationSetName: 'tracking',
      });
    });

    it('rejects an idempotency key without sending', async () => {
      const { provider, requests } = setup(() => sent);

      const error = await provider
        .send({ ...message, idempotencyKey: 'key-1' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: 'ses does not support idempotencyKey',
        code: 'unsupported',
        provider: 'ses',
      });
      expect(requests).toHaveLength(0);
    });

    it('uses the SES error message', async () => {
      const body = { message: 'Email address is not verified.' };
      const { provider } = setup(() => ({
        status: 400,
        headers: { 'x-amzn-ErrorType': 'MessageRejected:http://internal.amazon.com/coral/' },
        json: body,
      }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: 'Email address is not verified.',
        code: 'validation',
        provider: 'ses',
        status: 400,
        raw: body,
      });
    });

    it.each(['AccountSuspendedException', 'SendingPausedException'])(
      'maps %s to auth',
      async (type) => {
        const { provider } = setup(() => ({
          status: 400,
          headers: { 'x-amzn-ErrorType': type },
          json: { message: 'Sending is paused for this account.' },
        }));

        const error = await provider.send(message).catch((e: unknown) => e);

        expect(error).toMatchObject({ code: 'auth', status: 400 });
      },
    );

    it('reads the error type from the body when the header is missing', async () => {
      const { provider } = setup(() => ({
        status: 400,
        json: { __type: 'com.amazonaws.sesv2#SendingPausedException', message: 'Paused.' },
      }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'auth', message: 'Paused.' });
    });

    it('maps a rejected signature to auth', async () => {
      const { provider } = setup(() => ({
        status: 403,
        headers: { 'x-amzn-ErrorType': 'InvalidSignatureException' },
        json: { message: 'The request signature we calculated does not match.' },
      }));

      const error = await provider.send(message).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'auth', status: 403 });
    });
  });
});
