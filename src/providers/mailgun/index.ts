import { request, type ProviderErrorInfo } from '../../http.ts';
import type { EmailAddress, EmailProvider, SendEmailParams } from '../../types.ts';
import { formatAddress, requireOptions, toArray, unsupported } from '../shared.ts';

const BASE_URLS = {
  us: 'https://api.mailgun.net',
  eu: 'https://api.eu.mailgun.net',
};

export interface MailgunProviderOptions {
  apiKey: string;
  domain: string;
  region?: 'us' | 'eu';
  fetch?: typeof fetch;
}

function toBytes(content: string | Uint8Array): Uint8Array<ArrayBuffer> {
  if (typeof content === 'string') {
    return Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
  }
  return new Uint8Array(content);
}

function appendAddresses(
  form: FormData,
  field: string,
  value: EmailAddress | EmailAddress[] | undefined,
): void {
  for (const address of toArray(value)) {
    form.append(field, formatAddress(address));
  }
}

function toForm(params: SendEmailParams): FormData {
  const form = new FormData();
  form.append('from', formatAddress(params.from));
  appendAddresses(form, 'to', params.to);
  appendAddresses(form, 'cc', params.cc);
  appendAddresses(form, 'bcc', params.bcc);
  form.append('subject', params.subject);
  if (params.text) {
    form.append('text', params.text);
  }
  if (params.html) {
    form.append('html', params.html);
  }
  const replyTo = toArray(params.replyTo).map(formatAddress);
  if (replyTo.length > 0) {
    form.append('h:Reply-To', replyTo.join(', '));
  }
  for (const [name, value] of Object.entries(params.headers ?? {})) {
    form.append(`h:${name}`, value);
  }
  for (const [name, value] of Object.entries(params.tags ?? {})) {
    form.append(`v:${name}`, value);
  }
  for (const attachment of params.attachments ?? []) {
    const file = new Blob([toBytes(attachment.content)], { type: attachment.contentType ?? '' });
    if (attachment.contentId) {
      form.append('inline', file, attachment.contentId);
    } else {
      form.append('attachment', file, attachment.filename);
    }
  }
  return form;
}

function mapError(_status: number, body: unknown): ProviderErrorInfo {
  return { message: (body as { message?: string } | undefined)?.message };
}

export function mailgun(options: MailgunProviderOptions): EmailProvider {
  requireOptions('mailgun', { apiKey: options.apiKey, domain: options.domain });
  const baseUrl = BASE_URLS[options.region ?? 'us'];

  return {
    name: 'mailgun',
    async send(params) {
      if (params.idempotencyKey) {
        throw unsupported('mailgun', 'idempotencyKey');
      }
      const { data } = await request({
        provider: 'mailgun',
        url: `${baseUrl}/v3/${encodeURIComponent(options.domain)}/messages`,
        headers: { Authorization: `Basic ${btoa(`api:${options.apiKey}`)}` },
        body: toForm(params),
        fetch: options.fetch,
        mapError,
      });
      const id = (data as { id: string }).id;
      return { id: id.replace(/^<(.*)>$/, '$1'), raw: data };
    },
  };
}
