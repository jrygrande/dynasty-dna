"use client";

/**
 * rAF-driven tween of graph node positions.
 *
 * On every change to `targetPositions`, the hook captures a "start" snapshot
 * (current rendered positions for existing nodes; spawn-parent positions for
 * newcomers) and animates over `durationMs` toward the target. The returned
 * map is React state, so React Flow re-renders nodes AND edges every frame —
 * letting the bezier router track motion smoothly.
 *
 * Honors `prefers-reduced-motion: reduce` by snapping to the target.
 */

import { useEffect, useRef, useState } from "react";

export interface Pos {
  x: number;
  y: number;
}

export interface UseGraphPositionTweenOptions {
  durationMs?: number;
}

export function useGraphPositionTween(
  targetPositions: Map<string, Pos>,
  spawnParents: Map<string, string>,
  options: UseGraphPositionTweenOptions = {},
): Map<string, Pos> {
  const { durationMs = 400 } = options;
  const [current, setCurrent] = useState<Map<string, Pos>>(targetPositions);
  const currentRef = useRef<Map<string, Pos>>(targetPositions);
  const rafRef = useRef<number | null>(null);
  const lastTargetRef = useRef<Map<string, Pos>>(targetPositions);

  // Mirror state into a ref so the effect always reads the latest positions
  // without re-firing mid-tween.
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    if (mapsEqual(targetPositions, lastTargetRef.current)) return;
    lastTargetRef.current = targetPositions;

    // Reduced motion → snap, no animation.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setCurrent(targetPositions);
      return;
    }

    // Build the starting snapshot:
    //  - existing ids: keep where they currently render (so an in-flight
    //    tween doesn't snap to its target before re-tweening).
    //  - new ids: start at their spawn parent's *current* position so they
    //    appear to launch from the parent.
    //  - removed ids: dropped — for v1, descendants disappear immediately.
    const startSnapshot = new Map<string, Pos>();
    const liveCurrent = currentRef.current;
    for (const [id, target] of targetPositions) {
      const existing = liveCurrent.get(id);
      if (existing) {
        startSnapshot.set(id, existing);
      } else {
        const parentId = spawnParents.get(id);
        const parentPos = parentId ? liveCurrent.get(parentId) : undefined;
        startSnapshot.set(id, parentPos ?? target);
      }
    }

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

    const startTime = performance.now();
    const targetSnapshot = targetPositions;

    function tick(now: number) {
      const t = Math.min((now - startTime) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const next = new Map<string, Pos>();
      for (const [id, target] of targetSnapshot) {
        const s = startSnapshot.get(id) ?? target;
        next.set(id, {
          x: s.x + (target.x - s.x) * eased,
          y: s.y + (target.y - s.y) * eased,
        });
      }
      setCurrent(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // Intentionally only re-run on target changes. `current`, `spawnParents`,
    // and `durationMs` are read via closure / ref so the effect doesn't re-fire
    // mid-tween.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetPositions]);

  return current;
}

function mapsEqual(a: Map<string, Pos>, b: Map<string, Pos>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, pos] of a) {
    const bp = b.get(id);
    if (!bp) return false;
    if (Math.abs(bp.x - pos.x) > 0.5 || Math.abs(bp.y - pos.y) > 0.5) return false;
  }
  return true;
}
