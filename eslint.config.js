import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'assets-raw', 'e2e-shots', 'public'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // 以 `cond && doSomething()` 當作陳述式是本專案的慣用寫法
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true }],
    },
  },
);
