import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import boundaries from 'eslint-plugin-boundaries'

export default [
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
    },
    plugins: {
      boundaries,
      '@typescript-eslint': tseslint,
    },
    settings: {
      'boundaries/elements': [
        { type: 'package-data', pattern: 'packages/database' },
        { type: 'package-shared', pattern: 'packages/shared' },
        { type: 'package-infra', pattern: 'packages/(session|queue|redis|http)' },
        { type: 'domain-core', pattern: 'domains/(user|product)' },
        { type: 'domain-flow', pattern: 'domains/(order|cart|payment|checkout)' },
        { type: 'app', pattern: 'apps/*' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'package-data' } },
              allow: [
                { to: { element: { type: 'package-shared' } } },
                { to: { element: { type: 'package-data' } } },
              ],
            },
            {
              from: { element: { type: 'package-shared' } },
              allow: [{ to: { element: { type: 'package-shared' } } }],
            },
            {
              from: { element: { type: 'package-infra' } },
              allow: [
                { to: { element: { type: 'package-shared' } } },
                { to: { element: { type: 'package-infra' } } },
                { to: { element: { type: 'package-data' } } },
              ],
            },
            {
              from: { element: { type: 'domain-core' } },
              allow: [
                { to: { element: { type: 'package-data' } } },
                { to: { element: { type: 'package-shared' } } },
                { to: { element: { type: 'package-infra' } } },
              ],
            },
            {
              from: { element: { type: 'domain-flow' } },
              allow: [
                { to: { element: { type: 'package-data' } } },
                { to: { element: { type: 'package-shared' } } },
                { to: { element: { type: 'package-infra' } } },
                { to: { element: { type: 'domain-core' } } },
              ],
            },
            {
              from: { element: { type: 'app' } },
              allow: [
                { to: { element: { type: 'package-data' } } },
                { to: { element: { type: 'package-shared' } } },
                { to: { element: { type: 'package-infra' } } },
                { to: { element: { type: 'domain-core' } } },
                { to: { element: { type: 'domain-flow' } } },
              ],
            },
          ],
        },
      ],
    },
  },
]
