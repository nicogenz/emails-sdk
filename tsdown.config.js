import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/cloudflare.ts',
    'src/local.ts',
    'src/mailgun.ts',
    'src/postmark.ts',
    'src/resend.ts',
    'src/sendgrid.ts',
    'src/ses.ts',
  ],
  format: 'esm',
  platform: 'neutral',
  dts: true,
});
