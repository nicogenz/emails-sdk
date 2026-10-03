import { describe, expect, it } from 'vitest';
import { signRequest, type SignRequestOptions } from '../../src/providers/ses/sign.ts';

const vector: SignRequestOptions = {
  method: 'GET',
  url: 'https://example.amazonaws.com/',
  headers: {},
  body: '',
  region: 'us-east-1',
  service: 'service',
  credentials: {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  },
  date: new Date('2015-08-30T12:36:00Z'),
};

function authorization(signedHeaders: string, signature: string): string {
  return `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

describe('signRequest', () => {
  it('signs get-vanilla', async () => {
    expect(await signRequest(vector)).toEqual({
      'X-Amz-Date': '20150830T123600Z',
      Authorization: authorization(
        'host;x-amz-date',
        '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
      ),
    });
  });

  it('signs post-vanilla', async () => {
    const headers = await signRequest({ ...vector, method: 'POST' });

    expect(headers.Authorization).toBe(
      authorization(
        'host;x-amz-date',
        '5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b',
      ),
    );
  });

  it('signs post-x-www-form-urlencoded', async () => {
    const headers = await signRequest({
      ...vector,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': '13',
        'x-amz-content-sha256': '9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e',
      },
      body: 'Param1=value1',
    });

    expect(headers.Authorization).toBe(
      authorization(
        'content-length;content-type;host;x-amz-content-sha256;x-amz-date',
        'd3875051da38690788ef43de4db0d8f280229d82040bfac253562e56c3f20e0b',
      ),
    );
  });

  it('signs post-sts-header-before with a session token', async () => {
    const sessionToken =
      'AQoDYXdzEPT//////////wEXAMPLEtc764bNrC9SAPBSM22wDOk4x4HIZ8j4FZTwdQWLWsKWHGBuFqwAeMicRXmxfpSPfIeoIYRqTflfKD8YUuwthAx7mSEI/qkPpKPi/kMcGdQrmGdeehM4IC1NtBmUpp2wUE8phUZampKsburEDy0KPkyQDYwT7WZ0wq5VSXDvp75YU9HFvlRd8Tx6q6fE8YQcHNVXAkiY9q6d+xo0rKwT38xVqr7ZD0u0iPPkUL64lIZbqBAz+scqKmlzm8FDrypNC9Yjc8fPOLn9FX9KSYvKTr4rvx3iSIlTJabIQwj2ICCR/oLxBA==';

    const headers = await signRequest({
      ...vector,
      method: 'POST',
      credentials: { ...vector.credentials, sessionToken },
    });

    expect(headers['X-Amz-Security-Token']).toBe(sessionToken);
    expect(headers.Authorization).toBe(
      authorization(
        'host;x-amz-date;x-amz-security-token',
        '85d96828115b5dc0cfc3bd16ad9e210dd772bbebba041836c64533a82be05ead',
      ),
    );
  });
});
