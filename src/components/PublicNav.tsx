"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import { BrandLockup } from "./BrandMark";

const navLinks: Array<{ href: string; label: string; soon?: boolean }> = [
  { href: "/trade-finder", label: "Trade Finder", soon: true },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/changelog", label: "Changelog" },
  { href: "/experiments", label: "Experiments" },
];

const STORAGE_KEY = "dd_username";

export function PublicNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [storedUsername, setStoredUsername] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    setHydrated(true);
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      setStoredUsername(v && v.trim() ? v : null);
    } catch {
      // localStorage unavailable — render unauthenticated CTA
    }
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        setStoredUsername(e.newValue && e.newValue.trim() ? e.newValue : null);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function handleSwitchUser() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setStoredUsername(null);
    router.push("/start?switch=1");
  }

  function linkClass(href: string) {
    const active = pathname === href;
    return `text-sm transition-colors ${
      active
        ? "text-foreground font-medium"
        : "text-muted-foreground hover:text-foreground"
    }`;
  }

  function renderNavLinks(onNavigate?: () => void) {
    return (
      <>
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`${linkClass(link.href)} inline-flex items-center gap-2`}
            onClick={onNavigate}
          >
            <span>{link.label}</span>
            {link.soon && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wide bg-muted text-muted-foreground">
                Soon
              </span>
            )}
          </Link>
        ))}
      </>
    );
  }

  return (
    <header className="border-b">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <Link href="/" aria-label="Dynasty DNA home">
          <BrandLockup />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6">
          {renderNavLinks()}
          {/* Render server-side default; client swaps in user chip on mount.
              Keeps SSR markup stable; suppressHydrationWarning narrows the
              warning surface to the swapped node. */}
          <div suppressHydrationWarning>
            {hydrated && storedUsername ? (
              <UserChip
                username={storedUsername}
                onSwitchUser={handleSwitchUser}
              />
            ) : (
              <Link
                href="/start"
                className="text-sm px-4 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Get started
              </Link>
            )}
          </div>
        </nav>

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
        <nav className="sm:hidden border-t px-6 py-4 flex flex-col gap-4 bg-background">
          {renderNavLinks(() => setMobileOpen(false))}
          <div suppressHydrationWarning>
            {hydrated && storedUsername ? (
              <div className="flex flex-col gap-2 pt-2 border-t">
                <span className="text-sm">
                  @<span className="font-mono">{storedUsername}</span>
                </span>
                <Link
                  href="/start"
                  className="text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => setMobileOpen(false)}
                >
                  My leagues
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    handleSwitchUser();
                    setMobileOpen(false);
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground text-left"
                >
                  Switch user
                </button>
              </div>
            ) : (
              <Link
                href="/start"
                className="text-sm px-4 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-center"
                onClick={() => setMobileOpen(false)}
              >
                Get started
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}

function UserChip({
  username,
  onSwitchUser,
}: {
  username: string;
  onSwitchUser: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-sm hover:bg-muted/80 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        @<span className="font-mono">{username}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-44 rounded-md border bg-card shadow-md py-1 z-50"
        >
          <Link
            href="/start"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="block px-3 py-2 text-sm hover:bg-muted"
          >
            My leagues
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSwitchUser();
            }}
            className="block w-full text-left px-3 py-2 text-sm hover:bg-muted"
          >
            Switch user
          </button>
        </div>
      )}
    </div>
  );
}
