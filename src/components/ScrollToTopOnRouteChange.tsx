"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Next.js App Router scrolls the new page root into view, which lands behind
// the sticky <PublicNav>. Force absolute top after every pathname change —
// but yield to hash-jumps and to the browser's own back/forward restoration.
export function ScrollToTopOnRouteChange() {
  const pathname = usePathname();
  const isPop = useRef(false);

  useEffect(() => {
    const onPop = () => {
      isPop.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (isPop.current) {
      isPop.current = false;
      return;
    }
    if (window.location.hash) return;
    const id = requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  return null;
}
