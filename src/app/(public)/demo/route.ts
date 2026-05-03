import { NextResponse, type NextRequest } from "next/server";
import { generateSeed } from "@/lib/demoAnonymize";
import { getDemoFamilyId } from "@/lib/demoFamily";
import { DEMO_COOKIE_MAX_AGE, DEMO_SEED_COOKIE } from "@/lib/demoServer";

export const dynamic = "force-dynamic";

// Single-shot demo entry. Server resolves the singleton family, sets the
// per-session seed cookie, then 307-redirects to the league page. The cookie
// rides the redirect, so by the time the league page mounts and its API
// calls fire, every server response is pseudonymized at the wire.
export async function GET(req: NextRequest) {
  const familyId = await getDemoFamilyId();

  if (!familyId) {
    // Nothing to demo — drop the user into the entry flow.
    return NextResponse.redirect(new URL("/start", req.url));
  }

  const res = NextResponse.redirect(new URL(`/league/${familyId}`, req.url));
  res.cookies.set({
    name: DEMO_SEED_COOKIE,
    value: generateSeed(),
    path: "/",
    sameSite: "lax",
    maxAge: DEMO_COOKIE_MAX_AGE,
  });
  return res;
}
