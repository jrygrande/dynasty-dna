"use client";

import { useCallback, useEffect, useState } from "react";

export function useWaitlistCount(): {
  current: number;
  bump: () => void;
} {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/waitlist/count")
      .then((res) => (res.ok ? res.json() : { current: 0 }))
      .then((data: { current?: unknown }) => {
        if (cancelled) return;
        if (typeof data.current === "number") setCurrent(data.current);
      })
      .catch(() => {
        // Network/parse error: stay at 0; <WaitlistProgress /> hides itself
        // when current < 10 anyway.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bump = useCallback(() => setCurrent((n) => n + 1), []);

  return { current, bump };
}
