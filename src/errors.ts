import type { ProviderName } from './types.ts';

export type EmailErrorCode =
  'auth' | 'network_error' | 'provider_error' | 'rate_limited' | 'unsupported' | 'validation';

export interface EmailErrorOptions {
  code: EmailErrorCode;
  provider: ProviderName;
  status?: number;
  retryAfter?: number;
  raw?: unknown;
  cause?: unknown;
}

export class EmailError extends Error {
  readonly code: EmailErrorCode;
  readonly provider: ProviderName;
  readonly status?: number;
  readonly retryAfter?: number;
  readonly raw?: unknown;

  constructor(message: string, options: EmailErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'EmailError';
    this.code = options.code;
    this.provider = options.provider;
    this.status = options.status;
    this.retryAfter = options.retryAfter;
    this.raw = options.raw;
  }
}
