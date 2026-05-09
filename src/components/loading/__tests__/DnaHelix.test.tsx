/**
 * @jest-environment node
 *
 * Snapshot + structural tests for the DNA helix loading mark (#151).
 *
 * The helix is pure SVG + CSS — there's no internal state to drive, so we
 * lock in:
 *   - The structural shape (two strands + N base pairs)
 *   - The token classes that the design system enforces
 *   - The wrapper class that triggers the rotateY keyframes (so a future
 *     refactor that drops the rotor div fails loud rather than silent)
 *
 * Reduced-motion is enforced by `globals.css`'s media query — we don't
 * need to JSDOM-render to verify it; an integration check would just
 * exercise the CSS engine. We assert the component still renders the
 * pulse-target group so the reduced-motion fallback (pulse-only) keeps
 * working.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { DnaHelix } from "../DnaHelix";

describe("DnaHelix", () => {
  test("renders both strands with token classes", () => {
    const html = renderToStaticMarkup(<DnaHelix />);
    expect(html).toMatch(/data-testid="dna-helix-strand-a"/);
    expect(html).toMatch(/data-testid="dna-helix-strand-b"/);
    expect(html).toMatch(/text-primary/);
    expect(html).toMatch(/text-muted-foreground/);
    // Sanity: no raw Tailwind palette classes leaked in.
    expect(html).not.toMatch(
      /\b(text|bg|stroke|fill)-(blue|red|green|yellow|purple|pink|gray)-\d/
    );
  });

  test("renders the rotor wrapper that drives the rotateY keyframes", () => {
    const html = renderToStaticMarkup(<DnaHelix />);
    expect(html).toMatch(/dna-helix-3d/);
    expect(html).toMatch(/dna-helix-rotor/);
    expect(html).toMatch(/data-testid="dna-helix-rotor"/);
  });

  test("renders the base-pair pulse group (reduced-motion fallback)", () => {
    const html = renderToStaticMarkup(<DnaHelix />);
    // 8 base pair lines per the geometry constants.
    const lineMatches = html.match(/<line\s/g) ?? [];
    expect(lineMatches.length).toBeGreaterThanOrEqual(6);
    expect(html).toMatch(/dna-helix-pulse/);
    expect(html).toMatch(/data-testid="dna-helix-bases"/);
  });

  test("uses default 180x240 sizing when props omitted", () => {
    const html = renderToStaticMarkup(<DnaHelix />);
    expect(html).toMatch(/width:180px/);
    expect(html).toMatch(/height:240px/);
  });

  test("exposes role=img + aria-label for assistive tech", () => {
    const html = renderToStaticMarkup(
      <DnaHelix ariaLabel="Loading your league" />
    );
    expect(html).toMatch(/role="img"/);
    expect(html).toMatch(/aria-label="Loading your league"/);
  });

  test("two strands have offset paths (not identical)", () => {
    // Strand B is phase-shifted by pi from strand A — if they ever match
    // exactly we've collapsed back to a single sine wave.
    const html = renderToStaticMarkup(<DnaHelix />);
    // Pull every <path d="..."> in document order; first is strand A,
    // second is strand B (no other paths exist in the markup).
    const paths = Array.from(html.matchAll(/<path[^>]*d="([^"]+)"/g)).map(
      (m) => m[1]
    );
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(paths[0]).not.toEqual(paths[1]);
  });
});
