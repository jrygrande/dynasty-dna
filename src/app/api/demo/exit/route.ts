import { NextResponse } from "next/server";
import { DEMO_SEED_COOKIE } from "@/lib/demoServer";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: DEMO_SEED_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  });
  return res;
}
