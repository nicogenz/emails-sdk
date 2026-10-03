import { EmailError } from '../errors.ts';
import type {
  BatchItemResult,
  EmailAddress,
  EmailProvider,
  ProviderName,
  SendEmailParams,
} from '../types.ts';

const BASE64_CHUNK_SIZE = 0x8000;

export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function formatAddress(address: EmailAddress): string {
  if (typeof address === 'string') {
    return address;
  }
  if (!address.name) {
    return address.email;
  }
  return `"${address.name.replace(/["\\]/g, '\\$&')}" <${address.email}>`;
}

export function parseAddress(address: EmailAddress): { email: string; name?: string } {
  if (typeof address !== 'string') {
    return address.name ? { email: address.email, name: address.name } : { email: address.email };
  }
  const match = /^(.*)<([^<>]+)>$/.exec(address.trim());
  if (!match) {
    return { email: address.trim() };
  }
  const name = (match[1] ?? '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\(.)/g, '$1');
  const email = (match[2] ?? '').trim();
  return name ? { email, name } : { email };
}

export function toBase64(content: string | Uint8Array): string {
  if (typeof content === 'string') {
    return content;
  }
  let binary = '';
  for (let i = 0; i < content.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...content.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

export function requireOptions(provider: ProviderName, options: Record<string, unknown>): void {
  const missing = Object.entries(options)
    .filter(([, value]) => value === undefined || value === null || value === '')
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new EmailError(`Missing required ${provider} options: ${missing.join(', ')}`, {
      code: 'validation',
      provider,
    });
  }
}

export function unsupported(provider: ProviderName, field: string): EmailError {
  return new EmailError(`${provider} does not support ${field}`, { code: 'unsupported', provider });
}

export function toFailure(provider: ProviderName, error: unknown): BatchItemResult {
  return {
    ok: false,
    error:
      error instanceof EmailError
        ? error
        : new EmailError('Unexpected error while sending', {
            code: 'provider_error',
            provider,
            cause: error,
          }),
  };
}

export async function sendEach(
  provider: EmailProvider,
  messages: SendEmailParams[],
): Promise<BatchItemResult[]> {
  const results: BatchItemResult[] = [];
  for (const message of messages) {
    try {
      results.push({ ok: true, ...(await provider.send(message)) });
    } catch (error) {
      results.push(toFailure(provider.name, error));
    }
  }
  return results;
}
