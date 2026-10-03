import type { EmailAddress, EmailProvider, SendEmailParams } from '../../types.ts';
import { formatAddress, toArray } from '../shared.ts';

export interface LocalProviderOptions {
  log?: boolean;
}

export type SentEmail = SendEmailParams & { id: string };

export interface LocalProvider extends EmailProvider {
  sent: SentEmail[];
}

function formatAddresses(value: EmailAddress | EmailAddress[] | undefined): string {
  return toArray(value).map(formatAddress).join(', ');
}

function format(email: SentEmail): string {
  const fields: [string, string | undefined][] = [
    ['ID', email.id],
    ['From', formatAddresses(email.from)],
    ['To', formatAddresses(email.to)],
    ['Cc', formatAddresses(email.cc)],
    ['Bcc', formatAddresses(email.bcc)],
    ['Reply-To', formatAddresses(email.replyTo)],
    ['Subject', email.subject],
    ['Attachments', email.attachments?.map((attachment) => attachment.filename).join(', ')],
  ];
  const header = fields.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  return [
    '[@nicogenz/emails-sdk] Email sent with the local provider',
    ...header,
    '',
    email.text ?? email.html,
  ].join('\n');
}

export function local(options: LocalProviderOptions = {}): LocalProvider {
  const sent: SentEmail[] = [];
  return {
    name: 'local',
    sent,
    async send(params) {
      const email: SentEmail = { ...params, id: crypto.randomUUID() };
      sent.push(email);
      if (options.log ?? true) {
        console.log(format(email));
      }
      return { id: email.id, raw: email };
    },
  };
}
