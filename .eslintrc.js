// SSOT Phase 001 §1.2 — root ESLint wiring (legacy config, spec-verbatim filename)
// - Extends packages/eslint-config/base.js (single rule source).
// - TypeScript adjustments: core no-undef off (tsc owns definedness),
//   unused-args ignore ^_ (guard/middleware signatures across 130 phases).
// - Backend lint (`eslint "src/**/*.ts"`) is the consumer; frontend rides
//   tsc (Next 15 removed `next lint`).
module.exports = {
  root: true,
  extends: ['./packages/eslint-config/base.js'],
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['node_modules/', 'dist/', '.next/', 'coverage/'],
  overrides: [
    {
      files: ['*.ts'],
      rules: {
        // Core rule is TS-blind (flags ctor parameter properties);
        // the plugin rule understands TypeScript semantics.
        'no-undef': 'off',
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      },
    },
  ],
};
