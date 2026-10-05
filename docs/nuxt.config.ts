export default defineNuxtConfig({
  extends: ['docus'],
  site: {
    name: '@nicogenz/emails-sdk',
    url: 'https://emails-sdk.com',
  },
  llms: {
    domain: 'https://emails-sdk.com',
  },
})
