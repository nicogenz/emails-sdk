import { request, type ProviderErrorInfo } from '../../http.ts';
import type { EmailAddress, EmailProvider, SendEmailParams } from '../../types.ts';
import { parseAddress, requireOptions, toArray, toBase64, unsupported } from '../shared.ts';

const BASE_URLS = {
  global: 'https://api.sendgrid.com',
  eu: 'https://api.eu.sendgrid.com',
};

export interface SendGridProviderOptions {
  apiKey: string;
  region?: 'global' | 'eu';
  fetch?: typeof fetch;
}

interface SendGridErrorBody {
  errors?: { message: string; field?: string | null }[];
}

function addressList(value: EmailAddress | EmailAddress[] | undefined) {
  const addresses = toArray(value).map(parseAddress);
  return addresses.length > 0 ? addresses : undefined;
}

function toPayload(params: SendEmailParams) {
  const replyTo = toArray(params.replyTo).map(parseAddress);
  const content: { type: string; value: string }[] = [];
  if (params.text) {
    content.push({ type: 'text/plain', value: params.text });
  }
  if (params.html) {
    content.push({ type: 'text/html', value: params.html });
  }
  return {
    personalizations: [
      {
        to: toArray(params.to).map(parseAddress),
        cc: addressList(params.cc),
        bcc: addressList(params.bcc),
      },
    ],
    from: parseAddress(params.from),
    reply_to: replyTo.length === 1 ? replyTo[0] : undefined,
    reply_to_list: replyTo.length > 1 ? replyTo : undefined,
    subject: params.subject,
    content,
    attachments: params.attachments?.map((attachment) => ({
      content: toBase64(attachment.content),
      filename: attachment.filename,
      type: attachment.contentType,
      disposition: attachment.contentId ? 'inline' : undefined,
      content_id: attachment.contentId,
    })),
    headers: params.headers,
    custom_args: params.tags,
  };
}

function mapError(_status: number, body: unknown): ProviderErrorInfo {
  const errors = (body as SendGridErrorBody | undefined)?.errors;
  if (!errors?.length) {
    return {};
  }
  return {
    code: errors.some((error) => error.field) ? 'validation' : undefined,
    message: errors.map((error) => error.message).join('; '),
  };
}

export function sendgrid(options: SendGridProviderOptions): EmailProvider {
  requireOptions('sendgrid', { apiKey: options.apiKey });
  const baseUrl = BASE_URLS[options.region ?? 'global'];

  return {
    name: 'sendgrid',
    async send(params) {
      if (params.idempotencyKey) {
        throw unsupported('sendgrid', 'idempotencyKey');
      }
      const { data, response } = await request({
        provider: 'sendgrid',
        url: `${baseUrl}/v3/mail/send`,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(toPayload(params)),
        fetch: options.fetch,
        mapError,
      });
      return { id: response.headers.get('x-message-id') ?? '', raw: data };
    },
  };
}
