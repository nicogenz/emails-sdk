import { EmailError, type EmailErrorCode } from './errors.ts';
import type { ProviderName } from './types.ts';

export interface ProviderErrorInfo {
  code?: EmailErrorCode;
  message?: string;
}

export interface RequestOptions {
  provider: ProviderName;
  url: string;
  headers: Record<string, string>;
  body: string | FormData;
  fetch?: typeof fetch;
  mapError?: (status: number, body: unknown, response: Response) => ProviderErrorInfo;
}

export interface RequestResult {
  data: unknown;
  response: Response;
}

export function codeFromStatus(status: number): EmailErrorCode {
  switch (status) {
    case 400:
    case 422:
      return 'validation';
    case 401:
    case 403:
      return 'auth';
    case 429:
      return 'rate_limited';
    default:
      return 'provider_error';
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  const seconds = Number(header);
  return header && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function request(options: RequestOptions): Promise<RequestResult> {
  const fetchImpl = options.fetch ?? fetch;
  let response: Response;
  let data: unknown;
  try {
    response = await fetchImpl(options.url, {
      method: 'POST',
      headers: options.headers,
      body: options.body,
    });
    data = await parseBody(response);
  } catch (cause) {
    throw new EmailError(`Request to ${options.provider} failed`, {
      code: 'network_error',
      provider: options.provider,
      cause,
    });
  }
  if (!response.ok) {
    const info = options.mapError?.(response.status, data, response) ?? {};
    throw new EmailError(
      info.message ?? `Request to ${options.provider} failed with status ${response.status}`,
      {
        code: info.code ?? codeFromStatus(response.status),
        provider: options.provider,
        status: response.status,
        retryAfter: parseRetryAfter(response.headers.get('retry-after')),
        raw: data,
      },
    );
  }
  return { data, response };
}
