import { request, type ProviderErrorInfo } from '../../http.ts';
import type { EmailAddress, EmailProvider, SendEmailParams } from '../../types.ts';
import {
  formatAddress,
  parseAddress,
  requireOptions,
  toArray,
  toBase64,
  unsupported,
} from '../shared.ts';
import { signRequest } from './sign.ts';

const ACCOUNT_ERRORS = new Set(['AccountSuspendedException', 'SendingPausedException']);

export interface SesProviderOptions {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  configurationSetName?: string;
  fetch?: typeof fetch;
}

function formatSesAddress(address: EmailAddress): string {
  const { email, name } = parseAddress(address);
  if (!name || !/[^\x20-\x7e]/.test(name)) {
    return formatAddress({ email, name });
  }
  return `=?UTF-8?B?${toBase64(new TextEncoder().encode(name))}?= <${email}>`;
}

function addressList(value: EmailAddress | EmailAddress[] | undefined): string[] | undefined {
  const addresses = toArray(value).map(formatSesAddress);
  return addresses.length > 0 ? addresses : undefined;
}

function content(data: string) {
  return { Data: data, Charset: 'UTF-8' };
}

function toPayload(params: SendEmailParams, configurationSetName: string | undefined) {
  return {
    FromEmailAddress: formatSesAddress(params.from),
    Destination: {
      ToAddresses: addressList(params.to),
      CcAddresses: addressList(params.cc),
      BccAddresses: addressList(params.bcc),
    },
    ReplyToAddresses: addressList(params.replyTo),
    Content: {
      Simple: {
        Subject: content(params.subject),
        Body: {
          Text: params.text ? content(params.text) : undefined,
          Html: params.html ? content(params.html) : undefined,
        },
        Headers:
          params.headers &&
          Object.entries(params.headers).map(([Name, Value]) => ({ Name, Value })),
        Attachments: params.attachments?.map((attachment) => ({
          FileName: attachment.filename,
          RawContent: toBase64(attachment.content),
          ContentType: attachment.contentType,
          ContentId: attachment.contentId,
          ContentDisposition: attachment.contentId ? 'INLINE' : undefined,
        })),
      },
    },
    EmailTags: params.tags && Object.entries(params.tags).map(([Name, Value]) => ({ Name, Value })),
    ConfigurationSetName: configurationSetName,
  };
}

function mapError(_status: number, body: unknown, response: Response): ProviderErrorInfo {
  const error = body as { message?: string; Message?: string; __type?: string } | undefined;
  const type = (response.headers.get('x-amzn-errortype') ?? error?.__type)
    ?.split(':')[0]
    ?.split('#')
    .pop();
  return {
    code: type && ACCOUNT_ERRORS.has(type) ? 'auth' : undefined,
    message: error?.message ?? error?.Message,
  };
}

export function ses(options: SesProviderOptions): EmailProvider {
  requireOptions('ses', {
    region: options.region,
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
  });
  const url = `https://email.${options.region}.amazonaws.com/v2/email/outbound-emails`;

  return {
    name: 'ses',
    async send(params) {
      if (params.idempotencyKey) {
        throw unsupported('ses', 'idempotencyKey');
      }
      const body = JSON.stringify(toPayload(params, options.configurationSetName));
      const headers = await signRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        body,
        region: options.region,
        service: 'ses',
        credentials: options,
        date: new Date(),
      });
      const { data } = await request({
        provider: 'ses',
        url,
        headers,
        body,
        fetch: options.fetch,
        mapError,
      });
      return { id: (data as { MessageId: string }).MessageId, raw: data };
    },
  };
}
