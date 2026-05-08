/**
 * @jest-environment node
 */
import { resolveDatabaseUrl } from "../index";

const PROD_URL = "postgresql://prod-user:prod@prod-host/neondb?sslmode=require";
const DEV_URL = "postgresql://dev-user:dev@dev-host/neondb?sslmode=require";

describe("resolveDatabaseUrl", () => {
  it("prefers DATABASE_URL on Vercel even when DATABASE_URL_DEV is set", () => {
    const env = {
      VERCEL_ENV: "production",
      DATABASE_URL: PROD_URL,
      DATABASE_URL_DEV: DEV_URL,
    } as unknown as NodeJS.ProcessEnv;

    const result = resolveDatabaseUrl(env);

    expect(result).toEqual({ url: PROD_URL, source: "DATABASE_URL" });
  });

  it("uses DATABASE_URL on Vercel preview environments too", () => {
    const env = {
      VERCEL_ENV: "preview",
      DATABASE_URL: PROD_URL,
      DATABASE_URL_DEV: DEV_URL,
    } as unknown as NodeJS.ProcessEnv;

    expect(resolveDatabaseUrl(env).source).toBe("DATABASE_URL");
  });

  it("throws if Vercel is set but DATABASE_URL is missing", () => {
    const env = {
      VERCEL_ENV: "production",
      DATABASE_URL_DEV: DEV_URL,
    } as unknown as NodeJS.ProcessEnv;

    expect(() => resolveDatabaseUrl(env)).toThrow(/DATABASE_URL/);
  });

  it("uses DATABASE_URL_DEV off-Vercel when set", () => {
    const env = {
      DATABASE_URL: PROD_URL,
      DATABASE_URL_DEV: DEV_URL,
    } as unknown as NodeJS.ProcessEnv;

    expect(resolveDatabaseUrl(env)).toEqual({
      url: DEV_URL,
      source: "DATABASE_URL_DEV",
    });
  });

  it("falls back to DATABASE_URL off-Vercel when DATABASE_URL_DEV is missing", () => {
    const env = {
      DATABASE_URL: PROD_URL,
    } as unknown as NodeJS.ProcessEnv;

    expect(resolveDatabaseUrl(env)).toEqual({
      url: PROD_URL,
      source: "DATABASE_URL",
    });
  });

  it("treats empty-string DATABASE_URL_DEV as unset and falls back", () => {
    const env = {
      DATABASE_URL: PROD_URL,
      DATABASE_URL_DEV: "",
    } as unknown as NodeJS.ProcessEnv;

    expect(resolveDatabaseUrl(env).source).toBe("DATABASE_URL");
  });

  it("throws when no URL is configured at all", () => {
    const env = {} as unknown as NodeJS.ProcessEnv;

    expect(() => resolveDatabaseUrl(env)).toThrow(/DATABASE_URL/);
  });
});
