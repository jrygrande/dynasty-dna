"use client";

import { useEffect, useState } from "react";

export function useScrolled(threshold = 0): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function update() {
      setScrolled(window.scrollY > threshold);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [threshold]);

  return scrolled;
}
