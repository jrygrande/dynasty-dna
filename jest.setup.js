/**
 * Jest setup. Runs once per test process before any test code is loaded.
 *
 * Loads environment variables in priority order:
 *   1. .env.development.local  (gitignored personal overrides)
 *   2. .env.development        (gitignored, copied from .env.development.example)
 *   3. .env.local              (gitignored, pulled from Vercel — typically prod)
 *
 * Existing process.env values always win (never overwrite values set by the
 * caller or CI), so on Vercel / GitHub Actions where DATABASE_URL is injected
 * at runtime this is a noop.
 *
 * The integration tests (src/services/__tests__/syncLeagueFamily.integration.test.ts)
 * key off DATABASE_URL_DEV — they self-skip when the env var isn't set, so
 * unit-only runs (CI, fresh checkouts) silently no-op. Integration tests
 * never read DATABASE_URL directly to avoid accidentally hitting prod.
 */

const fs = require("fs");
const path = require("path");

function tryLoad(filename) {
  const fullPath = path.resolve(__dirname, filename);
  if (!fs.existsSync(fullPath)) return;
  // Lazy-require dotenv so the setup file itself doesn't crash if dotenv
  // isn't installed. dotenv is a devDependency, so it should always be
  // present in node_modules during local + CI runs.
  try {
    require("dotenv").config({ path: fullPath, override: false });
  } catch {
    // Best-effort: missing dotenv just means no env loading.
  }
}

tryLoad(".env.development.local");
tryLoad(".env.development");
tryLoad(".env.local");
