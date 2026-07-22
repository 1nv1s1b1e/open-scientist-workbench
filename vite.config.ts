import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: {
    singleQuote: true,
    semi: false,
  },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ['apps/web/**'],
        plugins: ['typescript', 'react'],
        rules: {
          'react/exhaustive-deps': 'warn',
          'react/no-direct-mutation-state': 'error',
        },
      },
      {
        files: ['**/*.test.ts'],
        rules: {
          '@typescript-eslint/no-explicit-any': 'off',
        },
      },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
  },
  staged: {
    '*': 'vp check --fix',
  },
})
