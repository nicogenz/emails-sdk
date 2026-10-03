---
seo:
  title: One API for every email provider
  description: Send email through Resend, Postmark, SendGrid, Mailgun, Amazon SES or Cloudflare with the same TypeScript code.
---

::u-page-hero
#title
One API for every email provider

#description
Send email through Resend, Postmark, SendGrid, Mailgun, Amazon SES or Cloudflare with the same TypeScript code. Switching providers is a one-line change.

#links
  :::u-button
  ---
  color: neutral
  size: xl
  to: /getting-started/introduction
  trailing-icon: i-lucide-arrow-right
  ---
  Get started
  :::

  :::u-button
  ---
  color: neutral
  icon: simple-icons-github
  size: xl
  to: https://github.com/nicogenz/emails-sdk
  variant: outline
  ---
  Star on GitHub
  :::
::

::u-page-section
#title
Why emails-sdk

#features
  :::u-page-feature
  ---
  icon: i-lucide-mail
  ---
  #title
  One API

  #description
  `send()` and `sendBatch()` take the same message and return the same result, whichever provider you use.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-repeat
  ---
  #title
  Swap providers in one line

  #description
  Each provider is its own import. Change the import and its options, and the rest of your code stays the same.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-package
  ---
  #title
  Zero dependencies

  #description
  Built only on web standards like `fetch`, so it runs on Node.js and edge runtimes without pulling in a provider SDK.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-shield-alert
  ---
  #title
  Typed errors

  #description
  Every failure is an `EmailError` with a normalized code, such as `auth`, `rate_limited` or `validation`.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-layers
  ---
  #title
  Batch sending

  #description
  Uses the provider's batch endpoint where there is one, and returns a result for every message.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-terminal
  ---
  #title
  Local provider

  #description
  Prints emails to the console during development and records them for assertions in your tests.
  :::
::
