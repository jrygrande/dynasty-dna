"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import { BrandLockup } from "./BrandMark";
import { DemoChip } from "./DemoIndicators";
import { useClickOutside } from "@/lib/useClickOutside";
import { useDemoActive } from "@/lib/useDemoMap";
import { useScrolled } from "@/lib/useScrolled";
import {
  STORED_USERNAME_KEY,
  clearStoredUsername,
  getStoredUsername,
} from "@/lib/storedUsername";

const navLinks: Array<{ href: string; label: string; soon?: boolean }> = [
  { href: "/trade-finder", label: "Trade Finder", soon: true },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/changelog", label: "Changelog" },
  { href: "/experiments", label: "Experiments" },
];

type LeagueMenuItem = {
  href: string;
  label: string;
  exact?: boolean;
  pathPrefix?: string;
};

// Dedupes concurrent mounts on the same family — both subscribe to the same
// in-flight fetch instead of firing twice.
const leagueNamePromises = new Map<string, Promise<string | null>>();

function fetchLeagueName(familyId: string): Promise<string | null> {
  const inFlight = leagueNamePromises.get(familyId);
  if (inFlight) return inFlight;
  const promise = fetch(`/api/leagues/${familyId}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data?.league?.name as string | undefined) ?? null)
    .catch(() => null)
    .then((name) => {
      if (!name) leagueNamePromises.delete(familyId);
      return name;
    });
  leagueNamePromises.set(familyId, promise);
  return promise;
}

function extractFamilyId(pathname: string | null): string | null {
  const m = pathname?.match(/^\/league\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function useLeagueContext(): { familyId: string | null; leagueName: string | null } {
  const pathname = usePathname();
  const familyId = useMemo(() => extractFamilyId(pathname), [pathname]);
  const [leagueName, setLeagueName] = useState<string | null>(null);

  useEffect(() => {
    if (!familyId) {
      setLeagueName(null);
      return;
    }
    let cancelled = false;
    fetchLeagueName(familyId).then((name) => {
      if (!cancelled) setLeagueName(name);
    });
    return () => {
      cancelled = true;
    };
  }, [familyId]);

  return { familyId, leagueName };
}

export function PublicNav() {
  const pathname = usePathname();
  const router = useRouter();
  const navRef = useRef<HTMLElement | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [storedUsername, setStoredUsername] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const { active: demoActive } = useDemoActive();
  const { familyId, leagueName } = useLeagueContext();
  const scrolled = useScrolled();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    setHydrated(true);
    setStoredUsername(getStoredUsername());
    function onStorage(e: StorageEvent) {
      if (e.key === STORED_USERNAME_KEY) {
        setStoredUsername(e.newValue && e.newValue.trim() ? e.newValue : null);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Publish nav height as --nav-height so sticky sub-headers can dock below.
  useEffect(() => {
    const node = navRef.current;
    if (!node) return;
    let last = -1;
    const setVar = () => {
      const h = node.getBoundingClientRect().height;
      if (h === last) return;
      last = h;
      document.body.style.setProperty("--nav-height", `${h}px`);
    };
    setVar();
    const observer = new ResizeObserver(setVar);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.body.style.removeProperty("--nav-height");
    };
  }, []);

  function handleSwitchUser() {
    clearStoredUsername();
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
    <header
      ref={navRef}
      className={`sticky top-0 z-40 bg-background border-b transition-shadow ${
        scrolled ? "shadow-sm" : ""
      }`}
    >
      <div className="container mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <Link href="/" aria-label="Dynasty DNA home">
          <BrandLockup />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6">
          {familyId && (
            <LeagueMenu
              familyId={familyId}
              leagueName={leagueName}
              currentPath={pathname}
            />
          )}
          {renderNavLinks()}
          {/* Render server-side default; client swaps in user chip on mount.
              Keeps SSR markup stable; suppressHydrationWarning narrows the
              warning surface to the swapped node. */}
          <div suppressHydrationWarning>
            {hydrated && demoActive ? (
              <DemoChip />
            ) : hydrated && storedUsername ? (
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
          {familyId && (
            <MobileLeagueSection
              familyId={familyId}
              leagueName={leagueName}
              currentPath={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
          )}
          {renderNavLinks(() => setMobileOpen(false))}
          <div suppressHydrationWarning>
            {hydrated && demoActive ? (
              <div className="pt-2 border-t flex">
                <DemoChip />
              </div>
            ) : hydrated && storedUsername ? (
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

function leagueMenuItems(familyId: string): LeagueMenuItem[] {
  return [
    { href: `/league/${familyId}`, label: "Overview", exact: true },
    { href: `/league/${familyId}/transactions`, label: "Transactions" },
    { href: `/league/${familyId}/drafts`, label: "Drafts" },
    {
      href: `/league/${familyId}/graph?from=overview`,
      label: "Lineage Tracer",
      pathPrefix: `/league/${familyId}/graph`,
    },
  ];
}

function isLeagueItemActive(
  item: LeagueMenuItem,
  currentPath: string | null
): boolean {
  if (item.exact) return currentPath === item.href;
  if (item.pathPrefix) return !!currentPath?.startsWith(item.pathPrefix);
  return currentPath === item.href;
}

function LeagueMenu({
  familyId,
  leagueName,
  currentPath,
}: {
  familyId: string;
  leagueName: string | null;
  currentPath: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const items = useMemo(() => leagueMenuItems(familyId), [familyId]);
  useClickOutside(ref, () => setOpen(false));

  useEffect(() => {
    setOpen(false);
  }, [currentPath]);

  const label = leagueName ?? "League";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors max-w-[14rem]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute left-0 mt-2 w-56 rounded-md border bg-card shadow-md py-1 z-50"
        >
          <div className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wide text-muted-foreground border-b">
            {label}
          </div>
          {items.map((item) => {
            const isActive = isLeagueItemActive(item, currentPath);
            return (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`block px-3 py-2 text-sm hover:bg-muted ${
                  isActive ? "text-foreground font-medium" : ""
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MobileLeagueSection({
  familyId,
  leagueName,
  currentPath,
  onNavigate,
}: {
  familyId: string;
  leagueName: string | null;
  currentPath: string | null;
  onNavigate: () => void;
}) {
  const items = useMemo(() => leagueMenuItems(familyId), [familyId]);
  const label = leagueName ?? "League";
  return (
    <div className="flex flex-col gap-2 pb-2 border-b">
      <span className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground truncate">
        {label}
      </span>
      <div className="flex flex-col gap-2 pl-1">
        {items.map((item) => {
          const isActive = isLeagueItemActive(item, currentPath);
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={onNavigate}
              className={`text-sm transition-colors ${
                isActive
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
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
  useClickOutside(ref, () => setOpen(false));

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
