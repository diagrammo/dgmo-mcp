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
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Measured at zero hits and turned on as a ratchet (#992): an object
      // interpolated as `[object Object]`, string eval, a non-string in a
      // template literal, a union swallowed by `any`/`unknown`.
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      // Disable noisy type-checked rules that don't catch real bugs
      // (matches dgmo + app convention).
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
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
