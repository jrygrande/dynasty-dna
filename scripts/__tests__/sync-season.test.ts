/**
 * @jest-environment node
 *
 * Coverage for `scripts/sync-season.ts`. Mocks the three nflverse syncs.
 */
import { run, parseArgs, HELP_TEXT } from "../sync-season";

describe("sync-season parseArgs", () => {
  it("parses a year arg", () => {
    expect(parseArgs(["2023"])).toEqual({ help: false, season: 2023 });
  });

  it("ignores non-numeric args", () => {
    expect(parseArgs(["banana"]).season).toBeNull();
  });

  it("parses --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });
});

describe("sync-season run", () => {
  function makeDeps(overrides: Partial<Parameters<typeof run>[1]> = {}) {
    const ok = (total: number) =>
      jest.fn().mockResolvedValue({ total, seasonResults: {} });
    return {
      log: jest.fn(),
      err: jest.fn(),
      syncRosterStatus: ok(100),
      syncInjuries: ok(50),
      syncSchedule: ok(20),
      currentSeason: () => 2025,
      ...overrides,
    };
  }

  it("--help returns 0", async () => {
    const deps = makeDeps();
    const code = await run(["--help"], deps);
    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(HELP_TEXT);
    expect(deps.syncRosterStatus).not.toHaveBeenCalled();
  });

  it("missing year returns 1", async () => {
    const deps = makeDeps();
    const code = await run([], deps);
    expect(code).toBe(1);
    expect(deps.syncRosterStatus).not.toHaveBeenCalled();
  });

  it("future season returns 1", async () => {
    const deps = makeDeps();
    const code = await run(["2099"], deps);
    expect(code).toBe(1);
    expect(deps.err).toHaveBeenCalledWith(
      expect.stringContaining("future")
    );
    expect(deps.syncRosterStatus).not.toHaveBeenCalled();
  });

  it("happy path calls all three services with force=true", async () => {
    const deps = makeDeps();
    const code = await run(["2023"], deps);
    expect(code).toBe(0);
    expect(deps.syncRosterStatus).toHaveBeenCalledWith({
      seasons: [2023],
      force: true,
      trigger: "manual",
    });
    expect(deps.syncInjuries).toHaveBeenCalledWith({
      seasons: [2023],
      force: true,
      trigger: "manual",
    });
    expect(deps.syncSchedule).toHaveBeenCalledWith({
      seasons: [2023],
      force: true,
      trigger: "manual",
    });
  });

  it("returns 1 when a service throws", async () => {
    const deps = makeDeps({
      syncInjuries: jest.fn().mockRejectedValue(new Error("nflverse 500")),
    });
    const code = await run(["2023"], deps);
    expect(code).toBe(1);
    expect(deps.err).toHaveBeenCalledWith(
      expect.stringContaining("nflverse 500")
    );
  });
});
