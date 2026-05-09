/** @type {import('jest').Config} */
const customJestConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: [],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // ts-jest needs JSX overridden to "react-jsx" because the project's
  // tsconfig is set to "preserve" (Next.js handles JSX itself in prod).
  // Without this override, .test.tsx files fail to parse.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
      },
    }],
  },
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.ts',
    '<rootDir>/src/**/__tests__/**/*.test.tsx',
    '<rootDir>/scripts/**/__tests__/**/*.test.ts',
  ],
  // Coverage gate for the sync pipeline. Each listed file must clear 80%
  // line + statement coverage. Branch + function thresholds are looser
  // because most branch misses are defensive `||` fallbacks (e.g.
  // `tx.adds || {}`) and catch-all error paths that are exercised by
  // integration tests, not unit tests. The sync-pipeline files are the
  // trust-critical surface; other modules are not gated here so this PR
  // doesn't accidentally block work on unrelated code paths.
  coverageThreshold: {
    'src/services/sync.ts': {
      statements: 80,
      lines: 80,
      branches: 70,
      functions: 70,
    },
    'src/services/playerSync.ts': {
      statements: 80,
      lines: 80,
      branches: 80,
      functions: 80,
    },
    'src/services/fantasyCalcSync.ts': {
      statements: 80,
      lines: 80,
      branches: 60,
      functions: 80,
    },
    'src/services/injurySync.ts': {
      statements: 80,
      lines: 80,
      branches: 65,
      functions: 80,
    },
    'src/services/rosterStatusSync.ts': {
      statements: 80,
      lines: 80,
      branches: 65,
      functions: 75,
    },
    'src/services/scheduleSync.ts': {
      statements: 80,
      lines: 80,
      branches: 70,
      functions: 80,
    },
    'src/services/syncLock.ts': {
      statements: 80,
      lines: 80,
      branches: 80,
      functions: 80,
    },
    'src/services/nflverseWatermark.ts': {
      statements: 80,
      lines: 80,
      branches: 80,
      functions: 80,
    },
    'src/lib/sleeper.ts': {
      statements: 80,
      lines: 80,
      branches: 80,
      functions: 80,
    },
    'src/lib/concurrency.ts': {
      statements: 80,
      lines: 80,
      branches: 80,
      functions: 80,
    },
  },
  collectCoverageFrom: [
    'src/services/sync.ts',
    'src/services/playerSync.ts',
    'src/services/fantasyCalcSync.ts',
    'src/services/injurySync.ts',
    'src/services/rosterStatusSync.ts',
    'src/services/scheduleSync.ts',
    'src/services/syncLock.ts',
    'src/services/nflverseWatermark.ts',
    'src/lib/sleeper.ts',
    'src/lib/concurrency.ts',
  ],
}

module.exports = customJestConfig
