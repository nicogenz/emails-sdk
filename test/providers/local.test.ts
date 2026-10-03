import { afterEach, describe, expect, it, vi } from 'vitest';
import { local } from '../../src/providers/local/index.ts';
import type { SendEmailParams } from '../../src/types.ts';

const message: SendEmailParams = {
  from: { email: 'sender@example.com', name: 'Sender' },
  to: ['jane@example.com', 'john@example.com'],
  cc: 'cc@example.com',
  subject: 'Hello',
  text: 'Hi Jane',
  html: '<p>Hi Jane</p>',
  attachments: [{ filename: 'invoice.pdf', content: 'aGVsbG8=' }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('local', () => {
  it('records sent emails with a generated id', async () => {
    const provider = local({ log: false });

    const first = await provider.send(message);
    const second = await provider.send(message);

    expect(provider.name).toBe('local');
    expect(provider.sent).toEqual([
      { ...message, id: first.id },
      { ...message, id: second.id },
    ]);
    expect(first.id).not.toBe(second.id);
    expect(first.raw).toBe(provider.sent[0]);
  });

  it('prints each email to the console by default', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const provider = local();

    const { id } = await provider.send(message);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      [
        '[@nicogenz/emails-sdk] Email sent with the local provider',
        `ID: ${id}`,
        'From: "Sender" <sender@example.com>',
        'To: jane@example.com, john@example.com',
        'Cc: cc@example.com',
        'Subject: Hello',
        'Attachments: invoice.pdf',
        '',
        'Hi Jane',
      ].join('\n'),
    );
  });

  it('prints the html when there is no text', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const provider = local();

    await provider.send({ ...message, text: undefined });

    expect(log.mock.calls[0]?.[0]).toMatch(/\n\n<p>Hi Jane<\/p>$/);
  });

  it('does not print when log is false', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const provider = local({ log: false });

    await provider.send(message);

    expect(log).not.toHaveBeenCalled();
  });
});
