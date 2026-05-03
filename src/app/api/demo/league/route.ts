import { NextResponse } from "next/server";
import { DEMO_API_CACHE_HEADERS, getDemoFamilyId } from "@/lib/demoFamily";

// Hits the DB at request time. Skip static prerender so CI builds don't try
// to call Neon with a stub connection string.
export const dynamic = "force-dynamic";

export async function GET() {
  const familyId = await getDemoFamilyId();
  return NextResponse.json(
    { family_id: familyId },
    { headers: DEMO_API_CACHE_HEADERS }
  );
}
