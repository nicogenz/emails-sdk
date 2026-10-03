export default defineAppConfig({
  github: {
    url: 'https://github.com/nicogenz/emails-sdk',
    branch: 'main',
    rootDir: 'docs',
  },
  docus: {
    colorMode: 'dark'
  },
  header: {
    logo: {
      light: '/logo-light.svg',
      dark: '/logo-dark.svg',
      alt: 'emails-sdk',
    },
  },
  ui: {
    colors: {
      primary: 'indigo',
    },
  },
})
