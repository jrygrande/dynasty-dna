"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

export function AuthCTA() {
  const { status } = useSession();
  const isAuthed = status === "authenticated";

  return (
    <Link
      href={isAuthed ? "/dashboard" : "/login"}
      className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium text-lg"
    >
      {isAuthed ? "Go to Dashboard" : "Get Started"}
    </Link>
  );
}
