/**
 * @jest-environment node
 *
 * Coverage for `scripts/sync-players.ts`. Mocks the playerSync service.
 */
import { run, parseArgs, HELP_TEXT } from "../sync-players";

describe("sync-players parseArgs", () => {
  it("parses --force", () => {
    expect(parseArgs(["--force"])).toEqual({ help: false, force: true });
  });

  it("parses --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("defaults to no flags", () => {
    expect(parseArgs([])).toEqual({ help: false, force: false });
  });
});

describe("sync-players run", () => {
  function makeDeps(overrides: Partial<Parameters<typeof run>[1]> = {}) {
    return {
      log: jest.fn(),
      err: jest.fn(),
      syncPlayers: jest.fn().mockResolvedValue(123),
      ...overrides,
    };
  }

  it("--help returns 0 without invoking syncPlayers", async () => {
    const deps = makeDeps();
    const code = await run(["--help"], deps);
    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(HELP_TEXT);
    expect(deps.syncPlayers).not.toHaveBeenCalled();
  });

  it("happy path: syncPlayers(false) returns 0", async () => {
    const deps = makeDeps();
    const code = await run([], deps);
    expect(code).toBe(0);
    expect(deps.syncPlayers).toHaveBeenCalledWith(false, {
      trigger: "manual",
      scope: "manual-script",
    });
  });

  it("--force passes force=true through", async () => {
    const deps = makeDeps();
    const code = await run(["--force"], deps);
    expect(code).toBe(0);
    expect(deps.syncPlayers).toHaveBeenCalledWith(true, {
      trigger: "manual",
      scope: "manual-script",
    });
  });

  it("logs skipped message when count is 0", async () => {
    const deps = makeDeps({ syncPlayers: jest.fn().mockResolvedValue(0) });
    const code = await run([], deps);
    expect(code).toBe(0);
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("skipped")
    );
  });

  it("returns 1 when syncPlayers throws", async () => {
    const deps = makeDeps({
      syncPlayers: jest.fn().mockRejectedValue(new Error("offline")),
    });
    const code = await run([], deps);
    expect(code).toBe(1);
    expect(deps.err).toHaveBeenCalledWith(
      expect.stringContaining("offline")
    );
  });
});
