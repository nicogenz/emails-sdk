import { describe, expect, it } from 'vitest';
import { EmailError } from '../../src/errors.ts';
import { codeFromStatus, request, type RequestOptions } from '../../src/http.ts';
import { createFetchStub, type StubHandler } from '../helpers/fetch-stub.ts';

function send(handler: StubHandler, options: Partial<RequestOptions> = {}) {
  const stub = createFetchStub(handler);
  const result = request({
    provider: 'resend',
    url: 'https://api.example.com/emails',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer key' },
    body: JSON.stringify({ subject: 'Hi' }),
    fetch: stub.fetch,
    ...options,
  });
  return { result, requests: stub.requests };
}

describe('codeFromStatus', () => {
  it.each([
    [400, 'validation'],
    [401, 'auth'],
    [403, 'auth'],
    [404, 'provider_error'],
    [422, 'validation'],
    [429, 'rate_limited'],
    [500, 'provider_error'],
    [503, 'provider_error'],
  ])('maps %i to %s', (status, code) => {
    expect(codeFromStatus(status)).toBe(code);
  });
});

describe('request', () => {
  it('posts the body with the given headers', async () => {
    const { result, requests } = send(() => ({ json: { id: 'abc' } }));

    await result;

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://api.example.com/emails',
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer key' },
      body: '{"subject":"Hi"}',
    });
  });

  it('returns the parsed JSON body and the response', async () => {
    const { result } = send(() => ({ json: { id: 'abc' }, headers: { 'X-Message-Id': 'm1' } }));

    const { data, response } = await result;

    expect(data).toEqual({ id: 'abc' });
    expect(response.headers.get('x-message-id')).toBe('m1');
  });

  it('returns undefined data for an empty body', async () => {
    const { result } = send(() => ({ status: 202 }));

    const { data } = await result;

    expect(data).toBeUndefined();
  });

  it('throws an EmailError derived from the status', async () => {
    const { result } = send(() => ({ status: 401, json: { message: 'Invalid key' } }));

    const error = await result.catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmailError);
    expect(error).toMatchObject({
      message: 'Request to resend failed with status 401',
      code: 'auth',
      provider: 'resend',
      status: 401,
      raw: { message: 'Invalid key' },
    });
  });

  it('reads Retry-After seconds', async () => {
    const { result } = send(() => ({ status: 429, headers: { 'Retry-After': '30' } }));

    const error = await result.catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'rate_limited', retryAfter: 30 });
  });

  it('ignores a Retry-After that is not a number of seconds', async () => {
    const { result } = send(() => ({
      status: 429,
      headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
    }));

    const error = await result.catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'rate_limited', retryAfter: undefined });
  });

  it('keeps a non-JSON error body as text', async () => {
    const { result } = send(() => ({ status: 502, body: 'Bad Gateway' }));

    const error = await result.catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'provider_error', raw: 'Bad Gateway' });
  });

  it('lets the provider override the code and message', async () => {
    const { result } = send(
      () => ({ status: 422, json: { ErrorCode: 10, Message: 'Bad token' } }),
      {
        mapError: (_status, body) => ({
          code: 'auth',
          message: (body as { Message: string }).Message,
        }),
      },
    );

    const error = await result.catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'auth', message: 'Bad token', status: 422 });
  });

  it('wraps a failed fetch in a network_error', async () => {
    const cause = new TypeError('fetch failed');

    const error = await request({
      provider: 'resend',
      url: 'https://api.example.com/emails',
      headers: {},
      body: '{}',
      fetch: () => Promise.reject(cause),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmailError);
    expect(error).toMatchObject({ code: 'network_error', provider: 'resend', cause });
  });
});
