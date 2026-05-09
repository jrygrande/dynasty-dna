/**
 * @jest-environment node
 *
 * Coverage for `scripts/sync-family.ts`. Mocks the underlying services so
 * the real DB / Sleeper aren't touched, and asserts exit codes + that the
 * service was invoked with the expected shape.
 */
import { run, parseArgs, HELP_TEXT } from "../sync-family";

describe("sync-family parseArgs", () => {
  it("parses leagueId and --force", () => {
    expect(parseArgs(["abc123", "--force"])).toEqual({
      help: false,
      force: true,
      id: "abc123",
    });
  });

  it("parses --force before id", () => {
    expect(parseArgs(["--force", "abc123"])).toEqual({
      help: false,
      force: true,
      id: "abc123",
    });
  });

  it("recognises --help / -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("ignores unknown flags after id is set", () => {
    expect(parseArgs(["abc", "extra"]).id).toBe("abc");
  });
});

describe("sync-family run", () => {
  function makeDeps(overrides: Partial<Parameters<typeof run>[1]> = {}) {
    return {
      log: jest.fn(),
      err: jest.fn(),
      syncLeagueFamily: jest.fn().mockResolvedValue(undefined),
      resolveFamilyAndLeagues: jest.fn().mockResolvedValue({
        familyId: "fam-1",
        leagueIds: ["l-2024", "l-2025"],
      }),
      ...overrides,
    };
  }

  it("--help returns 0 and prints usage", async () => {
    const deps = makeDeps();
    const code = await run(["--help"], deps);
    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(HELP_TEXT);
    expect(deps.syncLeagueFamily).not.toHaveBeenCalled();
  });

  it("returns 1 + prints error when no id is provided", async () => {
    const deps = makeDeps();
    const code = await run([], deps);
    expect(code).toBe(1);
    expect(deps.err).toHaveBeenCalled();
    expect(deps.syncLeagueFamily).not.toHaveBeenCalled();
  });

  it("returns 1 when family has no member leagues", async () => {
    const deps = makeDeps({
      resolveFamilyAndLeagues: jest.fn().mockResolvedValue({
        familyId: "fam-1",
        leagueIds: [],
      }),
    });
    const code = await run(["abc"], deps);
    expect(code).toBe(1);
    expect(deps.syncLeagueFamily).not.toHaveBeenCalled();
  });

  it("happy path: invokes syncLeagueFamily and returns 0", async () => {
    const deps = makeDeps();
    const code = await run(["abc"], deps);
    expect(code).toBe(0);
    expect(deps.resolveFamilyAndLeagues).toHaveBeenCalledWith("abc", false);
    expect(deps.syncLeagueFamily).toHaveBeenCalledWith(
      ["l-2024", "l-2025"],
      undefined,
      "fam-1",
      { trigger: "manual" }
    );
  });

  it("--force is forwarded to the resolver", async () => {
    const deps = makeDeps();
    const code = await run(["abc", "--force"], deps);
    expect(code).toBe(0);
    expect(deps.resolveFamilyAndLeagues).toHaveBeenCalledWith("abc", true);
  });

  it("returns 1 when syncLeagueFamily throws", async () => {
    const deps = makeDeps({
      syncLeagueFamily: jest.fn().mockRejectedValue(new Error("boom")),
    });
    const code = await run(["abc"], deps);
    expect(code).toBe(1);
    expect(deps.err).toHaveBeenCalledWith(
      expect.stringContaining("[sync-family] failed: boom")
    );
  });
});
