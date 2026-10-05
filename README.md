# @nicogenz/emails-sdk

One TypeScript API for sending email through Resend, Postmark, SendGrid, Mailgun, Amazon SES and Cloudflare. Switching providers is a one-line change.

- `send()` and `sendBatch()` work the same for every provider
- Zero dependencies, built only on web standards like `fetch` and Web Crypto
- Typed `EmailError` with normalized codes such as `auth`, `rate_limited` and `validation`
- A local provider that prints emails to the console during development and records them in tests

## Installation

```bash
npm install @nicogenz/emails-sdk
```

## Usage

```ts
import { createClient } from '@nicogenz/emails-sdk';
import { resend } from '@nicogenz/emails-sdk/resend';

const email = createClient({
  provider: resend({ apiKey: process.env.RESEND_API_KEY! }),
});

const { id } = await email.send({
  from: 'Acme <hello@acme.com>',
  to: 'jane@example.com',
  subject: 'Welcome to Acme',
  html: '<p>Thanks for signing up!</p>',
});
```

## Providers

| Provider   | Import                                                         |
| ---------- | -------------------------------------------------------------- |
| Local      | `import { local } from '@nicogenz/emails-sdk/local'`           |
| Resend     | `import { resend } from '@nicogenz/emails-sdk/resend'`         |
| Postmark   | `import { postmark } from '@nicogenz/emails-sdk/postmark'`     |
| SendGrid   | `import { sendgrid } from '@nicogenz/emails-sdk/sendgrid'`     |
| Mailgun    | `import { mailgun } from '@nicogenz/emails-sdk/mailgun'`       |
| Amazon SES | `import { ses } from '@nicogenz/emails-sdk/ses'`               |
| Cloudflare | `import { cloudflare } from '@nicogenz/emails-sdk/cloudflare'` |

## Documentation

The full documentation, including the options for each provider, is at [emails-sdk.com](https://emails-sdk.com).

## License

MIT
