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
            { from: 'package-data', allow: ['package-shared', 'package-data'] },
            { from: 'package-shared', allow: ['package-shared'] },
            { from: 'package-infra', allow: ['package-shared', 'package-infra', 'package-data'] },
            { from: 'domain-core', allow: ['package-data', 'package-shared', 'package-infra'] },
            {
              from: 'domain-flow',
              allow: ['package-data', 'package-shared', 'package-infra', 'domain-core'],
            },
            {
              from: 'app',
              allow: [
                'package-data',
                'package-shared',
                'package-infra',
                'domain-core',
                'domain-flow',
              ],
            },
          ],
        },
      ],
    },
  },
]
