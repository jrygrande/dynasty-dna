"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

const navLinks = [
  { href: "/roadmap", label: "Roadmap" },
  { href: "/changelog", label: "Changelog" },
  { href: "/experiments", label: "Experiments" },
];

export function PublicNav() {
  const { status } = useSession();
  const pathname = usePathname();
  const isAuthed = status === "authenticated";
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close mobile menu on route change (e.g., browser back/forward)
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function linkClass(href: string) {
    const active = pathname === href;
    return `text-sm transition-colors ${
      active
        ? "text-foreground font-medium"
        : "text-muted-foreground hover:text-foreground"
    }`;
  }

  function renderLinks(onNavigate?: () => void) {
    return (
      <>
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={linkClass(link.href)}
            onClick={onNavigate}
          >
            {link.label}
          </Link>
        ))}
        <Link
          href={isAuthed ? "/dashboard" : "/login"}
          className="text-sm px-4 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-center"
          onClick={onNavigate}
        >
          {isAuthed ? "Dashboard" : "Sign In"}
        </Link>
      </>
    );
  }

  return (
    <header className="border-b">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">
            Dynasty <span className="text-primary">DNA</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6">
          {renderLinks()}
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
          {renderLinks(() => setMobileOpen(false))}
        </nav>
      )}
    </header>
  );
}
