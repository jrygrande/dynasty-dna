"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

export function PublicNav() {
  const { data: session, status } = useSession();
  const isAuthed = status === "authenticated";

  return (
    <header className="border-b">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">
            Dynasty <span className="text-primary">DNA</span>
          </span>
        </Link>
        <nav className="flex items-center gap-6">
          <Link
            href="/roadmap"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Roadmap
          </Link>
          <Link
            href="/changelog"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Changelog
          </Link>
          <Link
            href="/experiments"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Experiments
          </Link>
          <Link
            href={isAuthed ? "/dashboard" : "/login"}
            className="text-sm px-4 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {isAuthed ? "Dashboard" : "Sign In"}
          </Link>
        </nav>
      </div>
    </header>
  );
}
