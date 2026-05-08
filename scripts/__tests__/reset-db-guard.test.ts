/**
 * @jest-environment node
 *
 * Guard tests for `scripts/reset-db.ts`. The destructive SQL must NEVER fire
 * in tests — every case provides a mocked sql client and asserts the call
 * count.
 */
import { isHostAllowed, parseHost, run } from "../reset-db";

const PROD_HOST = "ep-prod-pooler.us-east-2.aws.neon.tech";
// Hostname must literally contain "-dev." (with the trailing dot) to match the
// guard, mirroring the convention Neon uses for branch hostnames.
const DEV_HOST = "ep-something-dev.us-east-2.aws.neon.tech";
const DEV_BRANCH_HOST = "ep-dev-branch-1234-pooler.us-east-2.aws.neon.tech";

const PROD_URL = `postgresql://u:p@${PROD_HOST}/neondb?sslmode=require`;
const DEV_URL = `postgresql://u:p@${DEV_HOST}/neondb?sslmode=require`;

describe("reset-db guard: isHostAllowed", () => {
  it("rejects a prod-looking host", () => {
    const result = isHostAllowed({
      host: PROD_HOST,
      source: "DATABASE_URL",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.host).toBe(PROD_HOST);
    }
  });

  it("allows a host containing '-dev.'", () => {
    const result = isHostAllowed({
      host: "ep-something-dev.us-east-2.aws.neon.tech",
      source: "DATABASE_URL",
    });
    expect(result).toEqual({ ok: true, reason: "dev-host" });
  });

  it("allows a host containing 'dev-branch'", () => {
    const result = isHostAllowed({
      host: DEV_BRANCH_HOST,
      source: "DATABASE_URL_DEV",
    });
    expect(result).toEqual({ ok: true, reason: "dev-host" });
  });

  it("allows a host listed in NEON_DEV_HOST_ALLOWLIST", () => {
    const result = isHostAllowed({
      host: PROD_HOST,
      source: "DATABASE_URL",
      allowlist: `something-else.example.com,${PROD_HOST}`,
    });
    expect(result).toEqual({ ok: true, reason: "allowlist" });
  });

  it("ignores allowlist entries that do not match", () => {
    const result = isHostAllowed({
      host: PROD_HOST,
      source: "DATABASE_URL",
      allowlist: "other.example.com",
    });
    expect(result.ok).toBe(false);
  });

  it("allows when --i-know-this-is-prod override is set", () => {
    const result = isHostAllowed({
      host: PROD_HOST,
      source: "DATABASE_URL",
      override: true,
    });
    expect(result).toEqual({ ok: true, reason: "override" });
  });

  it("matches host case-insensitively", () => {
    const result = isHostAllowed({
      host: "EP-FOO-DEV.us-east-2.aws.neon.tech",
      source: "DATABASE_URL",
    });
    expect(result).toEqual({ ok: true, reason: "dev-host" });
  });
});

describe("reset-db guard: parseHost", () => {
  it("extracts hostname from a postgres URL", () => {
    expect(parseHost(DEV_URL)).toBe(DEV_HOST);
  });

  it("returns the raw input for un-parseable URLs", () => {
    expect(parseHost("not a url")).toBe("not a url");
  });
});

describe("reset-db guard: run()", () => {
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => {
        throw new Error("__exit__");
      }) as never);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("refuses to run when host looks like prod", async () => {
    const sqlClient = jest.fn().mockResolvedValue(undefined);

    await expect(
      run({
        sqlClient,
        argv: [],
        env: {
          DATABASE_URL: PROD_URL,
        } as unknown as NodeJS.ProcessEnv,
      })
    ).rejects.toThrow("__exit__");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(sqlClient).not.toHaveBeenCalled();
  });

  it("allows when host contains '-dev.'", async () => {
    const sqlClient = jest.fn().mockResolvedValue(undefined);

    await run({
      sqlClient,
      argv: [],
      env: {
        DATABASE_URL_DEV: DEV_URL,
      } as unknown as NodeJS.ProcessEnv,
    });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(sqlClient).toHaveBeenCalledTimes(2);
    expect(sqlClient).toHaveBeenNthCalledWith(1, "DROP SCHEMA public CASCADE");
    expect(sqlClient).toHaveBeenNthCalledWith(2, "CREATE SCHEMA public");
  });

  it("allows with --i-know-this-is-prod flag even on prod host", async () => {
    const sqlClient = jest.fn().mockResolvedValue(undefined);

    await run({
      sqlClient,
      argv: ["--i-know-this-is-prod"],
      env: {
        DATABASE_URL: PROD_URL,
      } as unknown as NodeJS.ProcessEnv,
    });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(sqlClient).toHaveBeenCalledTimes(2);
  });

  it("allows hosts in NEON_DEV_HOST_ALLOWLIST", async () => {
    const sqlClient = jest.fn().mockResolvedValue(undefined);

    await run({
      sqlClient,
      argv: [],
      env: {
        DATABASE_URL: PROD_URL,
        NEON_DEV_HOST_ALLOWLIST: PROD_HOST,
      } as unknown as NodeJS.ProcessEnv,
    });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(sqlClient).toHaveBeenCalledTimes(2);
  });

  it("never executes destructive SQL on rejection", async () => {
    const sqlClient = jest.fn().mockResolvedValue(undefined);

    await expect(
      run({
        sqlClient,
        argv: [],
        env: {
          DATABASE_URL: PROD_URL,
          NEON_DEV_HOST_ALLOWLIST: "unrelated.example.com",
        } as unknown as NodeJS.ProcessEnv,
      })
    ).rejects.toThrow("__exit__");

    expect(sqlClient).not.toHaveBeenCalled();
  });
});
