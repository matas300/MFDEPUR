// Vitest config MFDEPUR
// singleThread: SQLite non supporta multi-writer concorrente, i test integration
// devono essere serializzati. Unit test sono comunque veloci.
// globalSetup: azzera il DB test una volta per run.
module.exports = {
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules/**', 'dist/**'],
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    globalSetup: './tests/setup.js',
    setupFiles: [],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/config/database.js', 'src/config/env.js'],
      thresholds: {
        lines: 15,
        functions: 15,
        branches: 10,
        statements: 15,
      },
    },
  },
};
