import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();

    const runs = await db
      .select({
        id: schema.experimentRuns.id,
        name: schema.experimentRuns.name,
        hypothesis: schema.experimentRuns.hypothesis,
        config: schema.experimentRuns.config,
        metrics: schema.experimentRuns.metrics,
        acceptanceCriteria: schema.experimentRuns.acceptanceCriteria,
        verdict: schema.experimentRuns.verdict,
        verdictReason: schema.experimentRuns.verdictReason,
        scorecard: schema.experimentRuns.scorecard,
        familyId: schema.experimentRuns.familyId,
        status: schema.experimentRuns.status,
        error: schema.experimentRuns.error,
        startedAt: schema.experimentRuns.startedAt,
        finishedAt: schema.experimentRuns.finishedAt,
        // rawData intentionally excluded — too large for list view
      })
      .from(schema.experimentRuns)
      .orderBy(desc(schema.experimentRuns.startedAt))
      .limit(100);

    return NextResponse.json({ runs, error: null });
  } catch (e) {
    console.error("[experiments API]", e);
    return NextResponse.json(
      { runs: [], error: "Failed to load experiment data." },
      { status: 500 },
    );
  }
}
