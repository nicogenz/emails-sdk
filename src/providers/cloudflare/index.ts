import { EmailError, type EmailErrorCode } from '../../errors.ts';
import { request, type ProviderErrorInfo } from '../../http.ts';
import type { Attachment, EmailAddress, EmailProvider, SendEmailParams } from '../../types.ts';
import { parseAddress, requireOptions, toArray, toBase64, unsupported } from '../shared.ts';

const BASE_URL = 'https://api.cloudflare.com/client/v4';

const BINDING_ERROR_CODES: Record<string, EmailErrorCode> = {
  E_DAILY_LIMIT_EXCEEDED: 'rate_limited',
  E_DELIVERY_FAILED: 'provider_error',
  E_INTERNAL_SERVER_ERROR: 'provider_error',
  E_RATE_LIMIT_EXCEEDED: 'rate_limited',
};

export interface CloudflareEmailBinding {
  send(message: object): Promise<{ messageId: string }>;
}

export type CloudflareProviderOptions =
  | { accountId: string; apiToken: string; fetch?: typeof fetch }
  | { binding: CloudflareEmailBinding };

interface CloudflareResponse {
  errors?: { code: number; message: string }[];
  result: { message_id: string };
}

function apiAddress(address: EmailAddress) {
  const { email, name } = parseAddress(address);
  return name ? { address: email, name } : email;
}

function bindingAddress(address: EmailAddress) {
  const { email, name } = parseAddress(address);
  return name ? { email, name } : email;
}

function addressList<T>(
  value: EmailAddress | EmailAddress[] | undefined,
  format: (address: EmailAddress) => T,
): T[] | undefined {
  const addresses = toArray(value).map(format);
  return addresses.length > 0 ? addresses : undefined;
}

function attachmentFields(attachment: Attachment) {
  return {
    content: toBase64(attachment.content),
    filename: attachment.filename,
    type: attachment.contentType ?? 'application/octet-stream',
    disposition: attachment.contentId ? 'inline' : 'attachment',
  };
}

function toApiPayload(params: SendEmailParams) {
  const replyTo = toArray(params.replyTo)[0];
  return {
    from: apiAddress(params.from),
    to: addressList(params.to, apiAddress),
    cc: addressList(params.cc, apiAddress),
    bcc: addressList(params.bcc, apiAddress),
    reply_to: replyTo && apiAddress(replyTo),
    subject: params.subject,
    html: params.html,
    text: params.text,
    headers: params.headers,
    attachments: params.attachments?.map((attachment) => ({
      ...attachmentFields(attachment),
      content_id: attachment.contentId,
    })),
  };
}

function toBindingMessage(params: SendEmailParams) {
  const replyTo = toArray(params.replyTo)[0];
  return {
    from: bindingAddress(params.from),
    to: addressList(params.to, bindingAddress),
    cc: addressList(params.cc, bindingAddress),
    bcc: addressList(params.bcc, bindingAddress),
    replyTo: replyTo && bindingAddress(replyTo),
    subject: params.subject,
    html: params.html,
    text: params.text,
    headers: params.headers,
    attachments: params.attachments?.map((attachment) => ({
      ...attachmentFields(attachment),
      contentId: attachment.contentId,
    })),
  };
}

function mapError(_status: number, body: unknown): ProviderErrorInfo {
  const errors = (body as Partial<CloudflareResponse> | undefined)?.errors;
  return { message: errors?.length ? errors.map((error) => error.message).join('; ') : undefined };
}

function bindingError(error: unknown): EmailError {
  const code = (error as { code?: unknown } | undefined)?.code;
  return new EmailError(error instanceof Error ? error.message : 'Request to cloudflare failed', {
    code: typeof code === 'string' ? (BINDING_ERROR_CODES[code] ?? 'validation') : 'provider_error',
    provider: 'cloudflare',
    cause: error,
  });
}

export function cloudflare(options: CloudflareProviderOptions): EmailProvider {
  if ('binding' in options) {
    requireOptions('cloudflare', { binding: options.binding });
  } else {
    requireOptions('cloudflare', { accountId: options.accountId, apiToken: options.apiToken });
  }

  return {
    name: 'cloudflare',
    async send(params) {
      if (params.idempotencyKey) {
        throw unsupported('cloudflare', 'idempotencyKey');
      }
      if (params.tags && Object.keys(params.tags).length > 0) {
        throw unsupported('cloudflare', 'tags');
      }
      if (toArray(params.replyTo).length > 1) {
        throw unsupported('cloudflare', 'multiple replyTo addresses');
      }
      if ('binding' in options) {
        let result: { messageId: string };
        try {
          result = await options.binding.send(toBindingMessage(params));
        } catch (error) {
          throw bindingError(error);
        }
        return { id: result.messageId, raw: result };
      }
      const { data } = await request({
        provider: 'cloudflare',
        url: `${BASE_URL}/accounts/${encodeURIComponent(options.accountId)}/email/sending/send`,
        headers: {
          Authorization: `Bearer ${options.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(toApiPayload(params)),
        fetch: options.fetch,
        mapError,
      });
      return { id: (data as CloudflareResponse).result.message_id, raw: data };
    },
  };
}
