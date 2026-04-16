/** @type {import('jest').Config} */
const customJestConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: [],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
}

module.exports = customJestConfig
