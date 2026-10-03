import { EmailError } from '../../errors.ts';
import { request, type ProviderErrorInfo } from '../../http.ts';
import type { BatchItemResult, EmailAddress, EmailProvider, SendEmailParams } from '../../types.ts';
import {
  formatAddress,
  requireOptions,
  sendEach,
  toArray,
  toBase64,
  toFailure,
} from '../shared.ts';

const BASE_URL = 'https://api.resend.com';
const BATCH_LIMIT = 100;

export interface ResendProviderOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

interface ResendBatchResponse {
  data: { id: string }[];
  errors?: { index: number; message: string }[];
}

function addressList(value: EmailAddress | EmailAddress[] | undefined): string[] | undefined {
  const addresses = toArray(value).map(formatAddress);
  return addresses.length > 0 ? addresses : undefined;
}

function toPayload(params: SendEmailParams) {
  return {
    from: formatAddress(params.from),
    to: toArray(params.to).map(formatAddress),
    cc: addressList(params.cc),
    bcc: addressList(params.bcc),
    reply_to: addressList(params.replyTo),
    subject: params.subject,
    html: params.html,
    text: params.text,
    headers: params.headers,
    attachments: params.attachments?.length
      ? params.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: toBase64(attachment.content),
          content_type: attachment.contentType,
          content_id: attachment.contentId,
        }))
      : undefined,
    tags: params.tags && Object.entries(params.tags).map(([name, value]) => ({ name, value })),
  };
}

function mapError(status: number, body: unknown): ProviderErrorInfo {
  const error = body as { name?: string; message?: string } | undefined;
  return {
    code: status === 403 && error?.name === 'validation_error' ? 'validation' : undefined,
    message: error?.message,
  };
}

export function resend(options: ResendProviderOptions): EmailProvider {
  requireOptions('resend', { apiKey: options.apiKey });

  function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return request({
      provider: 'resend',
      url: `${BASE_URL}${path}`,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      fetch: options.fetch,
      mapError,
    });
  }

  async function sendChunk(messages: SendEmailParams[]): Promise<BatchItemResult[]> {
    let response: ResendBatchResponse;
    try {
      const { data } = await post('/emails/batch', messages.map(toPayload), {
        'x-batch-validation': 'permissive',
      });
      response = data as ResendBatchResponse;
    } catch (error) {
      return messages.map(() => toFailure('resend', error));
    }
    const failures = new Map(response.errors?.map((failure) => [failure.index, failure]));
    let next = 0;
    return messages.map((_, index): BatchItemResult => {
      const failure = failures.get(index);
      if (failure) {
        return {
          ok: false,
          error: new EmailError(failure.message, {
            code: 'validation',
            provider: 'resend',
            raw: failure,
          }),
        };
      }
      const created = response.data[next++] as { id: string };
      return { ok: true, id: created.id, raw: created };
    });
  }

  const provider: EmailProvider = {
    name: 'resend',
    async send(params) {
      const { data } = await post(
        '/emails',
        toPayload(params),
        params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {},
      );
      return { id: (data as { id: string }).id, raw: data };
    },
    async sendBatch(messages) {
      if (messages.some((message) => message.attachments?.length || message.idempotencyKey)) {
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
