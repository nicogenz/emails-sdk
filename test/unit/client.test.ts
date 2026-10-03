import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../../src/client.ts';
import { EmailError } from '../../src/errors.ts';
import { local } from '../../src/providers/local/index.ts';
import type { EmailProvider, SendEmailParams } from '../../src/types.ts';

const message: SendEmailParams = {
  from: 'sender@example.com',
  to: 'jane@example.com',
  subject: 'Hello',
  text: 'Hi Jane',
};

function fakeProvider(overrides: Partial<EmailProvider> = {}): EmailProvider {
  return {
    name: 'resend',
    send: vi.fn(async () => ({ id: 'id-1', raw: { id: 'id-1' } })),
    ...overrides,
  };
}

describe('createClient', () => {
  describe('send', () => {
    it('sends through the provider and returns its result', async () => {
      const provider = local({ log: false });
      const client = createClient({ provider });

      const result = await client.send(message);

      expect(provider.sent).toHaveLength(1);
      expect(provider.sent[0]).toMatchObject(message);
      expect(result.id).toBe(provider.sent[0]?.id);
    });

    it('accepts cc or bcc as the only recipients', async () => {
      const provider = local({ log: false });
      const client = createClient({ provider });

      await client.send({ ...message, to: [], cc: 'cc@example.com' });
      await client.send({ ...message, to: [], bcc: { email: 'bcc@example.com' } });

      expect(provider.sent).toHaveLength(2);
    });

    it.each<[string, Partial<SendEmailParams>, string]>([
      ['from is empty', { from: '' }, 'Missing from address'],
      ['from has an empty email', { from: { email: ' ', name: 'Sender' } }, 'Missing from address'],
      ['there are no recipients', { to: [] }, 'Missing recipient in to, cc or bcc'],
      [
        'all recipients are empty',
        { to: [''], cc: { email: '' } },
        'Missing recipient in to, cc or bcc',
      ],
      ['subject is blank', { subject: '  ' }, 'Missing subject'],
      ['html and text are missing', { text: undefined }, 'Missing html or text'],
    ])('rejects when %s', async (_case, overrides, expectedMessage) => {
      const provider = local({ log: false });
      const client = createClient({ provider });

      const error = await client.send({ ...message, ...overrides }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({
        message: expectedMessage,
        code: 'validation',
        provider: 'local',
      });
      expect(provider.sent).toHaveLength(0);
    });

    it('passes provider errors through', async () => {
      const providerError = new EmailError('Invalid API key', { code: 'auth', provider: 'resend' });
      const client = createClient({
        provider: fakeProvider({ send: () => Promise.reject(providerError) }),
      });

      await expect(client.send(message)).rejects.toBe(providerError);
    });
  });

  describe('sendBatch', () => {
    it('returns an empty array without calling the provider', async () => {
      const provider = fakeProvider({ sendBatch: vi.fn() });
      const client = createClient({ provider });

      expect(await client.sendBatch([])).toEqual([]);
      expect(provider.send).not.toHaveBeenCalled();
      expect(provider.sendBatch).not.toHaveBeenCalled();
    });

    it('uses the native batch when the provider has one', async () => {
      const results = [
        { ok: true as const, id: 'a', raw: {} },
        { ok: true as const, id: 'b', raw: {} },
      ];
      const provider = fakeProvider({ sendBatch: vi.fn(async () => results) });
      const client = createClient({ provider });
      const messages = [message, { ...message, to: 'john@example.com' }];

      expect(await client.sendBatch(messages)).toBe(results);
      expect(provider.sendBatch).toHaveBeenCalledWith(messages);
      expect(provider.send).not.toHaveBeenCalled();
    });

    it('sends one by one when the provider has no native batch', async () => {
      const provider = local({ log: false });
      const client = createClient({ provider });

      const results = await client.sendBatch([message, { ...message, to: 'john@example.com' }]);

      expect(provider.sent.map((email) => email.to)).toEqual([
        'jane@example.com',
        'john@example.com',
      ]);
      expect(results).toEqual([
        { ok: true, id: provider.sent[0]?.id, raw: provider.sent[0] },
        { ok: true, id: provider.sent[1]?.id, raw: provider.sent[1] },
      ]);
    });

    it('reports failures per message and keeps sending', async () => {
      const failure = new EmailError('Too many requests', {
        code: 'rate_limited',
        provider: 'resend',
      });
      const send = vi
        .fn()
        .mockResolvedValueOnce({ id: 'a', raw: {} })
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({ id: 'c', raw: {} });
      const client = createClient({ provider: fakeProvider({ send }) });

      const results = await client.sendBatch([message, message, message]);

      expect(send).toHaveBeenCalledTimes(3);
      expect(results).toEqual([
        { ok: true, id: 'a', raw: {} },
        { ok: false, error: failure },
        { ok: true, id: 'c', raw: {} },
      ]);
    });

    it('wraps unexpected errors in a provider_error', async () => {
      const cause = new TypeError('Cannot read properties of undefined');
      const client = createClient({
        provider: fakeProvider({ send: () => Promise.reject(cause) }),
      });

      const [result] = await client.sendBatch([message]);

      expect(result?.ok).toBe(false);
      expect(result).toMatchObject({
        error: { code: 'provider_error', provider: 'resend', cause },
      });
    });

    it('rejects the whole batch before sending when a message is invalid', async () => {
      const provider = local({ log: false });
      const client = createClient({ provider });

      const error = await client
        .sendBatch([message, { ...message, subject: '' }])
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailError);
      expect(error).toMatchObject({ message: 'Message 1: Missing subject', code: 'validation' });
      expect(provider.sent).toHaveLength(0);
    });
  });
});
