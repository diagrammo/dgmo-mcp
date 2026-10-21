import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'bundle', 'node_modules'] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      // Measured at zero hits and raised from 'warn' as a ratchet (#1468).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Measured at zero hits and turned on as a ratchet (#992): an object
      // interpolated as `[object Object]`, string eval, a non-string in a
      // template literal, a union swallowed by `any`/`unknown`.
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      // Measured at zero hits (or fixed to zero) and turned on (#1267): an
      // `any` flowing into an assignment, member access, argument, return or
      // call; a cast the type already satisfies; an `async` with no `await`.
      // A tool callback may return its result directly — the MCP SDK takes
      // `CallToolResult | Promise<CallToolResult>` and awaits either.
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/require-await': 'error',
    },
  },
  // Disable type-checked linting for files outside the TS project.
  {
    files: ['**/*.config.ts', '**/*.config.mjs', '**/*.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  // The selection-harness is browser dev tooling (not in the TS project, not
  // shipped) — lint it without type-aware rules and with browser/node globals.
  {
    files: ['tools/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false, project: false },
      globals: {
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        CSS: 'readonly',
        console: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: { 'no-undef': 'off' },
  }
);
