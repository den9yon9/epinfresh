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
        { type: 'package', pattern: 'packages/(database|session|shared|queue)' },
        { type: 'workflow', pattern: 'packages/workflows' },
        { type: 'domain-core', pattern: 'domains/(user|product)' },
        { type: 'domain-flow', pattern: 'domains/(order|cart|payment)' },
        { type: 'app', pattern: 'apps/*' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            { from: 'package', allow: ['package'] },
            { from: 'domain-core', allow: ['package'] },
            { from: 'domain-flow', allow: ['package', 'domain-core'] },
            { from: 'workflow', allow: ['package', 'domain-core', 'domain-flow'] },
            { from: 'app', allow: ['package', 'workflow', 'domain-core', 'domain-flow'] },
          ],
        },
      ],
    },
  },
]
