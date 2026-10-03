import { EmailError } from './errors.ts';
import { sendEach, toArray } from './providers/shared.ts';
import type {
  BatchItemResult,
  EmailAddress,
  EmailProvider,
  SendEmailParams,
  SendEmailResult,
} from './types.ts';

export interface CreateClientOptions {
  provider: EmailProvider;
}

export interface EmailClient {
  send(params: SendEmailParams): Promise<SendEmailResult>;
  sendBatch(params: SendEmailParams[]): Promise<BatchItemResult[]>;
}

function hasAddress(address: EmailAddress | undefined): boolean {
  const email = typeof address === 'string' ? address : address?.email;
  return Boolean(email?.trim());
}

function findProblem(params: SendEmailParams): string | undefined {
  if (!hasAddress(params.from)) {
    return 'Missing from address';
  }
  if (![params.to, params.cc, params.bcc].flatMap((value) => toArray(value)).some(hasAddress)) {
    return 'Missing recipient in to, cc or bcc';
  }
  if (!params.subject?.trim()) {
    return 'Missing subject';
  }
  if (!params.html && !params.text) {
    return 'Missing html or text';
  }
  return undefined;
}

export function createClient(options: CreateClientOptions): EmailClient {
  const { provider } = options;

  function validationError(message: string): EmailError {
    return new EmailError(message, { code: 'validation', provider: provider.name });
  }

  return {
    async send(params) {
      const problem = findProblem(params);
      if (problem) {
        throw validationError(problem);
      }
      return provider.send(params);
    },
    async sendBatch(params) {
      params.forEach((message, index) => {
        const problem = findProblem(message);
        if (problem) {
          throw validationError(`Message ${index}: ${problem}`);
        }
      });
      if (params.length === 0) {
        return [];
      }
      return provider.sendBatch ? provider.sendBatch(params) : sendEach(provider, params);
    },
  };
}
