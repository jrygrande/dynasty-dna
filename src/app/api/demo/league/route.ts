import { NextResponse } from "next/server";
import { DEMO_API_CACHE_HEADERS, getDemoFamilyId } from "@/lib/demoFamily";

export async function GET() {
  const familyId = await getDemoFamilyId();
  return NextResponse.json(
    { family_id: familyId },
    { headers: DEMO_API_CACHE_HEADERS }
  );
}
