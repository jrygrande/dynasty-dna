"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

export function AppNav() {
  const { data: session } = useSession();

  return (
    <header className="border-b">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">
            Dynasty <span className="text-primary">DNA</span>
          </span>
        </Link>
        <div className="flex items-center gap-4">
          {session?.user && (
            <span className="text-sm text-muted-foreground">
              {session.user.name || session.user.email}
            </span>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}
