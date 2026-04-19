"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { BrandLockup } from "./BrandMark";

export function AppNav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const displayName = session?.user?.name || session?.user?.email || "User";

  return (
    <header className="border-b">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/dashboard" aria-label="Dynasty DNA dashboard">
          <BrandLockup />
        </Link>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center gap-4">
          {session?.user && (
            <span className="text-sm text-muted-foreground truncate max-w-[200px]">
              {displayName}
            </span>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign Out
          </button>
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="sm:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="sm:hidden border-t px-6 py-4 flex flex-col gap-4 bg-background">
          {session?.user && (
            <span className="text-sm text-muted-foreground truncate">
              {displayName}
            </span>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
          >
            Sign Out
          </button>
        </div>
      )}
    </header>
  );
}
