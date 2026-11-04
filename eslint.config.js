import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default tseslint.config(
  tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.svelte-kit/**',
      '**/build/**',
      'supabase/.temp/**',
    ],
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
);
