import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import eslintConfigPrettier from 'eslint-config-prettier'
import boundaries from 'eslint-plugin-boundaries'
import simpleImportSort from 'eslint-plugin-simple-import-sort'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '.agents/**',
      'packages/database/src/migrations/meta/**',
      'repomix-output.xml',
      'skills-lock.json',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    plugins: {
      boundaries,
      'simple-import-sort': simpleImportSort,
    },
    settings: {
      'boundaries/elements': [
        { type: 'package-data', pattern: 'packages/database' },
        { type: 'package-shared', pattern: 'packages/shared' },
        // ponytail: 领域层只允许依赖 data/shared(纯逻辑), 一切基础设施接线归 app;
        // queue/http/session/redis 均属 package-infra, 域内禁用
        { type: 'package-infra', pattern: 'packages/(session|queue|redis|http)' },
        { type: 'domain-core', pattern: 'domains/(user|product)' },
        { type: 'domain-flow', pattern: 'domains/(order|cart|payment|checkout)' },
        { type: 'app', pattern: 'apps/*' },
      ],
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
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
              ],
            },
            {
              from: { element: { type: 'domain-flow' } },
              allow: [
                { to: { element: { type: 'package-data' } } },
                { to: { element: { type: 'package-shared' } } },
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
  eslintConfigPrettier,
]
