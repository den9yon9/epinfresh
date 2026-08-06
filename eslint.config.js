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
        { type: 'shared', pattern: 'packages/shared' },
        { type: 'persistence', pattern: 'packages/database' },
        // ponytail: 领域层只允许依赖 persistence/shared(纯逻辑), 一切基础设施接线归 presentation;
        // queue/http/session/redis 均属 infrastructure, 域内禁用
        { type: 'infrastructure', pattern: 'packages/(session|queue|redis|http)' },
        { type: 'domain', pattern: 'domains/(user|product)' },
        { type: 'application', pattern: 'domains/(order|cart|payment|checkout)' },
        { type: 'presentation', pattern: 'apps/*' },
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
              from: { element: { type: 'persistence' } },
              allow: [
                { to: { element: { type: 'shared' } } },
                { to: { element: { type: 'persistence' } } },
              ],
            },
            {
              from: { element: { type: 'shared' } },
              allow: [{ to: { element: { type: 'shared' } } }],
            },
            {
              from: { element: { type: 'infrastructure' } },
              allow: [
                { to: { element: { type: 'shared' } } },
                { to: { element: { type: 'infrastructure' } } },
                { to: { element: { type: 'persistence' } } },
              ],
            },
            {
              from: { element: { type: 'domain' } },
              allow: [
                { to: { element: { type: 'persistence' } } },
                { to: { element: { type: 'shared' } } },
              ],
            },
            {
              from: { element: { type: 'application' } },
              allow: [
                { to: { element: { type: 'persistence' } } },
                { to: { element: { type: 'shared' } } },
                { to: { element: { type: 'domain' } } },
              ],
            },
            {
              from: { element: { type: 'presentation' } },
              allow: [
                { to: { element: { type: 'persistence' } } },
                { to: { element: { type: 'shared' } } },
                { to: { element: { type: 'infrastructure' } } },
                { to: { element: { type: 'domain' } } },
                { to: { element: { type: 'application' } } },
              ],
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
]
