import type { EmailError } from './errors.ts';

export type ProviderName =
  'cloudflare' | 'mailgun' | 'postmark' | 'resend' | 'sendgrid' | 'ses' | 'local';

export type EmailAddress = string | { email: string; name?: string };

export interface Attachment {
  filename: string;
  content: string | Uint8Array;
  contentType?: string;
  contentId?: string;
}

export interface SendEmailParams {
  from: EmailAddress;
  to: EmailAddress | EmailAddress[];
  cc?: EmailAddress | EmailAddress[];
  bcc?: EmailAddress | EmailAddress[];
  replyTo?: EmailAddress | EmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: Attachment[];
  headers?: Record<string, string>;
  tags?: Record<string, string>;
  idempotencyKey?: string;
}

export interface SendEmailResult {
  id: string;
  raw: unknown;
}

export type BatchItemResult = (SendEmailResult & { ok: true }) | { ok: false; error: EmailError };

export interface EmailProvider {
  name: ProviderName;
  send(params: SendEmailParams): Promise<SendEmailResult>;
  sendBatch?(params: SendEmailParams[]): Promise<BatchItemResult[]>;
}
