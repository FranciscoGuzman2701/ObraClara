/** Pruebas de integración contra PostgreSQL real (base desechable). */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  setupFiles: ['<rootDir>/test/env.js'],
  globalSetup: '<rootDir>/test/global-setup.mjs',
  testTimeout: 20000,
};
