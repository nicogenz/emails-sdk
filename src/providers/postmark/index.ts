import { EmailError, type EmailErrorCode } from '../../errors.ts';
import { request, type ProviderErrorInfo } from '../../http.ts';
import type { BatchItemResult, EmailAddress, EmailProvider, SendEmailParams } from '../../types.ts';
import {
  formatAddress,
  requireOptions,
  sendEach,
  toArray,
  toBase64,
  toFailure,
  unsupported,
} from '../shared.ts';

const BASE_URL = 'https://api.postmarkapp.com';
const BATCH_LIMIT = 500;

export interface PostmarkProviderOptions {
  serverToken: string;
  messageStream?: string;
  fetch?: typeof fetch;
}

interface PostmarkResult {
  MessageID?: string;
  ErrorCode: number;
  Message: string;
}

function joinAddresses(value: EmailAddress | EmailAddress[] | undefined): string | undefined {
  const addresses = toArray(value).map(formatAddress);
  return addresses.length > 0 ? addresses.join(', ') : undefined;
}

function codeFromErrorCode(errorCode: number | undefined): EmailErrorCode | undefined {
  return errorCode === 10 ? 'auth' : undefined;
}

function mapError(_status: number, body: unknown): ProviderErrorInfo {
  const error = body as Partial<PostmarkResult> | undefined;
  return { code: codeFromErrorCode(error?.ErrorCode), message: error?.Message };
}

export function postmark(options: PostmarkProviderOptions): EmailProvider {
  requireOptions('postmark', { serverToken: options.serverToken });

  function toPayload(params: SendEmailParams) {
    return {
      From: formatAddress(params.from),
      To: joinAddresses(params.to),
      Cc: joinAddresses(params.cc),
      Bcc: joinAddresses(params.bcc),
      ReplyTo: joinAddresses(params.replyTo),
      Subject: params.subject,
      HtmlBody: params.html,
      TextBody: params.text,
      Headers:
        params.headers && Object.entries(params.headers).map(([Name, Value]) => ({ Name, Value })),
      Attachments: params.attachments?.map((attachment) => ({
        Name: attachment.filename,
        Content: toBase64(attachment.content),
        ContentType: attachment.contentType ?? 'application/octet-stream',
        ContentID: attachment.contentId && `cid:${attachment.contentId}`,
      })),
      Metadata: params.tags,
      MessageStream: options.messageStream,
    };
  }

  function post(path: string, body: unknown) {
    return request({
      provider: 'postmark',
      url: `${BASE_URL}${path}`,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': options.serverToken,
      },
      body: JSON.stringify(body),
      fetch: options.fetch,
      mapError,
    });
  }

  async function sendChunk(messages: SendEmailParams[]): Promise<BatchItemResult[]> {
    let results: PostmarkResult[];
    try {
      const { data } = await post('/email/batch', messages.map(toPayload));
      results = data as PostmarkResult[];
    } catch (error) {
      return messages.map(() => toFailure('postmark', error));
    }
    return results.map((result): BatchItemResult => {
      if (result.ErrorCode === 0 && result.MessageID) {
        return { ok: true, id: result.MessageID, raw: result };
      }
      return {
        ok: false,
        error: new EmailError(result.Message, {
          code: codeFromErrorCode(result.ErrorCode) ?? 'validation',
          provider: 'postmark',
          raw: result,
        }),
      };
    });
  }

  const provider: EmailProvider = {
    name: 'postmark',
    async send(params) {
      if (params.idempotencyKey) {
        throw unsupported('postmark', 'idempotencyKey');
      }
      const { data } = await post('/email', toPayload(params));
      return { id: (data as PostmarkResult).MessageID as string, raw: data };
    },
    async sendBatch(messages) {
      if (messages.some((message) => message.idempotencyKey)) {
        return sendEach(provider, messages);
      }
      const results: BatchItemResult[] = [];
      for (let i = 0; i < messages.length; i += BATCH_LIMIT) {
        results.push(...(await sendChunk(messages.slice(i, i + BATCH_LIMIT))));
      }
      return results;
    },
  };
  return provider;
}
