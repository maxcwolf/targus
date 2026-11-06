// @ts-check
// ESLint guards for docs/engineering-standards.md section 2. Loosening a rule here needs a
// maintainer review (CODEOWNERS) and, for an architectural rule, an ADR.
//
// Versions: ESLint 9 (the brief's pin; ESLint 10 is also supported by every plugin here).
// typescript-eslint 8 caps TypeScript at <6.1, which is why the repo is on TypeScript 6.0 and
// not 7.x. `eslint-plugin-vitest` is deprecated; its successor is `@vitest/eslint-plugin`.
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Files allowed to call the clock and randomness APIs: the adapters implementing the ports. */
const portAdapterFiles = ['**/adapters/**', '**/*.adapter.ts'];

const bannedNondeterminism = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'Inject the Clock port instead of calling new Date().',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Inject the Clock port instead of calling Date.now().',
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: 'Inject the IdGenerator port instead of calling Math.random().',
  },
  {
    selector: "CallExpression[callee.property.name='randomUUID']",
    message: 'Inject the IdGenerator port instead of calling crypto.randomUUID().',
  },
];

export default tseslint.config(
  {
    name: 'targus/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.tsbuild/**',
      '**/coverage/**',
      '**/.wrangler/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.yarn/**',
      'docs/**',
      'spike/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    name: 'targus/typescript',
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js', '*.cjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    name: 'targus/imports',
    plugins: { 'import-x': importX },
    settings: {
      // Without these, import-x skips .ts files when it builds the module graph and no-cycle
      // silently finds nothing.
      ...importX.flatConfigs.typescript.settings,
      'import-x/resolver-next': [createTypeScriptImportResolver({ alwaysTryTypes: true })],
    },
    rules: {
      'import-x/no-cycle': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-duplicates': 'error',
    },
  },

  {
    name: 'targus/standards',
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-throw-literal': 'off', // superseded by @typescript-eslint/only-throw-error
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'no-restricted-syntax': ['error', ...bannedNondeterminism],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration in config.ts and validate it with zod.',
        },
      ],
    },
  },
  {
    // Relative imports name the file that exists; tsc rewrites `.ts` to `.js` on emit (ADR 0017).
    name: 'targus/import-extensions',
    files: ['**/*.{ts,tsx,mts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.{1,2}/.*\\.js$',
              message: 'Import the TypeScript file by its real name (./file.ts or ./file.tsx).',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'targus/port-adapters',
    files: portAdapterFiles,
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    name: 'targus/config-files',
    files: ['**/config.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },

  {
    name: 'targus/web',
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat['recommended-latest'],
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      // Data enters the web app only through api-client/ (standards section 1.2).
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Call the API through src/api-client/ only.' },
        { name: 'XMLHttpRequest', message: 'Call the API through src/api-client/ only.' },
      ],
    },
  },
  {
    name: 'targus/web-api-client',
    files: ['apps/web/src/api-client/**'],
    rules: { 'no-restricted-globals': 'off' },
  },

  {
    name: 'targus/node-scripts',
    files: ['scripts/**', '*.js', '*.cjs', 'e2e/**', '**/vite.config.ts', '**/vitest.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // node:test's describe/it return promises the runner itself awaits.
    name: 'targus/node-test',
    files: ['scripts/**/*.test.mjs'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  {
    name: 'targus/commonjs',
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    // Root config files are not part of any tsconfig project.
    name: 'targus/untyped-config-files',
    files: ['*.js', '*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    name: 'targus/vitest',
    files: ['**/*.test.{ts,tsx}'],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-disabled-tests': 'error',
      'vitest/no-focused-tests': 'error',
    },
  },
);
