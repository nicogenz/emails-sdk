const encoder = new TextEncoder();

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignRequestOptions {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  date: Date;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(data)));
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

export async function signRequest(options: SignRequestOptions): Promise<Record<string, string>> {
  const { credentials } = options;
  const url = new URL(options.url);
  const amzDate = options.date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...options.headers, 'X-Amz-Date': amzDate };
  if (credentials.sessionToken) {
    headers['X-Amz-Security-Token'] = credentials.sessionToken;
  }

  const canonicalHeaders = Object.entries({ ...headers, Host: url.host })
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = canonicalHeaders.map(([name]) => name).join(';');
  const canonicalRequest = [
    options.method,
    url.pathname,
    '',
    canonicalHeaders.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders,
    await sha256Hex(options.body),
  ].join('\n');

  const scope = `${dateStamp}/${options.region}/${options.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join(
    '\n',
  );

  let key: BufferSource = encoder.encode(`AWS4${credentials.secretAccessKey}`);
  for (const part of [dateStamp, options.region, options.service, 'aws4_request']) {
    key = await hmac(key, part);
  }
  const signature = toHex(await hmac(key, stringToSign));

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
