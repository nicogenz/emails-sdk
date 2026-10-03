export { createClient } from './client.ts';
export { EmailError } from './errors.ts';

export type { CreateClientOptions, EmailClient } from './client.ts';
export type { EmailErrorCode, EmailErrorOptions } from './errors.ts';
export type {
  Attachment,
  BatchItemResult,
  EmailAddress,
  EmailProvider,
  ProviderName,
  SendEmailParams,
  SendEmailResult,
} from './types.ts';
