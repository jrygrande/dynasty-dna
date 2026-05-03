/**
 * @jest-environment node
 *
 * buildTransactionHeader contract: title formatting (especially the new
 * "{season}  {round}.{pickInRound}" draft format from #92) and the
 * subtitle split that lets dates render in full while long manager names
 * truncate.
 */

import type { TransactionNode } from "@/lib/assetGraph";
import { buildTransactionHeader } from "../transactionHeader";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toBeUndefined: () => void;
};

// 2025-03-05 12:00 UTC — picked so en-US short formatting is stable across
// host timezones near the boundary. Formats as "Mar 5, 25" in en-US.
const SAMPLE_CREATED_AT = Date.UTC(2025, 2, 5, 12, 0, 0);

function draftNode(
  draftPick: TransactionNode["draftPick"],
): TransactionNode {
  return {
    id: "draft:e1",
    kind: "transaction",
    txKind: "draft",
    transactionId: null,
    leagueId: "L",
    season: "2024",
    week: 0,
    createdAt: SAMPLE_CREATED_AT,
    managers: [{ userId: "u1", displayName: "jrygrande" }],
    assets: [],
    draftPick,
  };
}

describe("buildTransactionHeader — draft", () => {
  it("formats title as '{season}  {round}.{pickInRound}' with zero-padded pick", () => {
    const node = draftNode({
      season: "2024",
      round: 3,
      originalRosterId: 1,
      pickInRound: 4,
    });
    const header = buildTransactionHeader(node);
    expect(header.title).toBe("2024  3.04");
  });

  it("splits subtitle into manager lead + date so dates never truncate", () => {
    const node = draftNode({
      season: "2024",
      round: 3,
      originalRosterId: 1,
      pickInRound: 4,
    });
    const header = buildTransactionHeader(node);
    expect(header.subtitleLead).toBe("jrygrande");
    expect(header.subtitle).toBe("Mar 5, 25");
  });

  it("falls back to 'Draft' when draftPick is missing", () => {
    const node = draftNode(undefined);
    const header = buildTransactionHeader(node);
    expect(header.title).toBe("Draft");
  });

  it("falls back to 'Draft' when pickInRound is null (older event)", () => {
    const node = draftNode({
      season: "2024",
      round: 3,
      originalRosterId: 1,
      pickInRound: null,
    });
    const header = buildTransactionHeader(node);
    expect(header.title).toBe("Draft");
  });

  it("zero-pads single-digit pickInRound but does not pad rounds", () => {
    const node = draftNode({
      season: "2025",
      round: 1,
      originalRosterId: 1,
      pickInRound: 1,
    });
    const header = buildTransactionHeader(node);
    expect(header.title).toBe("2025  1.01");
  });
});

describe("buildTransactionHeader — non-draft (regression guard)", () => {
  function txNode(
    overrides: Partial<TransactionNode>,
  ): TransactionNode {
    return {
      id: "tx:1",
      kind: "transaction",
      txKind: "trade",
      transactionId: "1",
      leagueId: "L",
      season: "2024",
      week: 1,
      createdAt: SAMPLE_CREATED_AT,
      managers: [
        { userId: "u1", displayName: "Andrew" },
        { userId: "u2", displayName: "Brian" },
      ],
      assets: [],
      ...overrides,
    };
  }

  it("trade title joins both managers; subtitle is just the date", () => {
    const header = buildTransactionHeader(txNode({ txKind: "trade" }));
    expect(header.title).toBe("Andrew ↔ Brian");
    expect(header.subtitle).toBe("Mar 5, 25");
    expect(header.subtitleLead).toBeUndefined();
  });

  it("waiver subtitle has no lead segment", () => {
    const header = buildTransactionHeader(
      txNode({ txKind: "waiver", managers: [{ userId: "u1", displayName: "Andrew" }] }),
    );
    expect(header.title).toBe("Waiver claim by Andrew");
    expect(header.subtitleLead).toBeUndefined();
  });

  it("free-agent subtitle has no lead segment", () => {
    const header = buildTransactionHeader(
      txNode({ txKind: "free_agent", managers: [{ userId: "u1", displayName: "Andrew" }] }),
    );
    expect(header.title).toBe("Free-agent signing by Andrew");
    expect(header.subtitleLead).toBeUndefined();
  });
});
