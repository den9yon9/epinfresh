import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import eslintConfigPrettier from 'eslint-config-prettier'
import boundaries from 'eslint-plugin-boundaries'
import simpleImportSort from 'eslint-plugin-simple-import-sort'

import crossDomainRead from './eslint-rules/cross-domain-read.js'
import errorCodeRule from './eslint-rules/error-code.js'
import invariantThrow from './eslint-rules/invariant-throw.js'
import tableOwnership from './eslint-rules/table-ownership.js'
import transactionRule from './eslint-rules/transaction.js'

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
        // 目录即分层: domains/* = entity 域, usecases/* = 编排层; 新增/改名无需改动此处
        { type: 'domain', pattern: 'domains/*' },
        { type: 'usecase', pattern: 'usecases/*' },
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
              from: { element: { type: 'usecase' } },
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
                { to: { element: { type: 'usecase' } } },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'domains/**/*.ts', 'usecases/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.spec.ts', '**/e2e/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: '_unsafeUnwrap',
          message:
            'Forbidden in production code. Use .match(), or result.value after isOk()/isErr() narrowing instead.',
        },
        {
          property: '_unsafeUnwrapErr',
          message:
            'Forbidden in production code. Use .match(), or result.error after isErr() narrowing instead.',
        },
      ],
    },
  },
  {
    plugins: { 'table-ownership': tableOwnership },
    files: ['domains/**/*.ts', 'apps/**/*.ts', 'usecases/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
    rules: {
      'table-ownership/no-cross-domain-tables': 'error',
    },
  },
  {
    plugins: { 'invariant-throw': invariantThrow },
    files: ['domains/**/*.ts', 'usecases/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**', '**/env.ts'],
    rules: {
      'invariant-throw/no-bare-throw': 'error',
    },
  },
  {
    plugins: { 'cross-domain-read': crossDomainRead },
    files: ['domains/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
    rules: {
      'cross-domain-read/no-cross-domain-refs': 'warn',
    },
  },
  {
    plugins: { 'cross-domain-read': crossDomainRead },
    files: ['apps/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
    rules: {
      'cross-domain-read/no-cross-domain-refs': 'error',
    },
  },
  {
    plugins: { transaction: transactionRule },
    files: ['domains/**/*.ts', 'usecases/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
    rules: {
      'transaction/use-with-transaction': 'error',
    },
  },
  {
    plugins: { 'error-code': errorCodeRule },
    files: ['domains/**/*.ts', 'usecases/**/*.ts'],
    rules: {
      'error-code/screaming-snake': 'error',
    },
  },
  eslintConfigPrettier,
]
