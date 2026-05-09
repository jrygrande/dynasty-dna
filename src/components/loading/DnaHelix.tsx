/**
 * DNA Helix loading mark (#151).
 *
 * Pure SVG + CSS — no JS animation libs. The two sinusoidal strands sit
 * inside a container that slowly rotates around its Y axis (12s linear
 * infinite) to suggest the 3D twist of a real helix; connecting "base
 * pairs" between the strands give the eye anchor points to track the
 * rotation. When the user prefers reduced motion we drop the rotation
 * entirely and keep only a soft pulse on the bases — calm, but still
 * communicates that work is happening.
 *
 * Design tokens only:
 *   - Strand A (sage): `text-primary` via `stroke-current`
 *   - Strand B (slate): `text-muted-foreground` via `stroke-current`
 *
 * Sized via the `width` / `height` props on the wrapping `<svg>`-parent.
 * Default (180x240) fits the cold-sync loading screen at all breakpoints
 * without layout shift.
 */

interface DnaHelixProps {
  /** Width of the helix in CSS px. Default 180. */
  width?: number;
  /** Height of the helix in CSS px. Default 240. */
  height?: number;
  /** Optional class name applied to the outermost wrapper. */
  className?: string;
  /** Optional aria-label override. */
  ariaLabel?: string;
}

/**
 * Geometry constants. The helix is constructed analytically so the two
 * strands meet at every base-pair anchor — this lets the connecting
 * segments sit pixel-perfect on the strand path even as the SVG is
 * rescaled.
 */
const VIEWBOX_WIDTH = 180;
const VIEWBOX_HEIGHT = 240;
const STRAND_AMPLITUDE = 50; // px from centerline to strand peak
const STRAND_TWIST_HEIGHT = 120; // px per full sine wavelength
const STRAND_SAMPLES = 80; // resolution of each strand path
const BASE_PAIR_COUNT = 8; // connecting "rungs" along the helix
const STRAND_STROKE_WIDTH = 3.25;
const BASE_PAIR_STROKE_WIDTH = 2;

/** Build a smooth sinusoidal `d` attribute for one strand. */
function buildStrandPath(phaseOffset: number): string {
  const cx = VIEWBOX_WIDTH / 2;
  const top = 8;
  const bottom = VIEWBOX_HEIGHT - 8;
  const totalHeight = bottom - top;
  const omega = (2 * Math.PI) / STRAND_TWIST_HEIGHT;

  const points: string[] = [];
  for (let i = 0; i <= STRAND_SAMPLES; i++) {
    const t = i / STRAND_SAMPLES;
    const y = top + t * totalHeight;
    const x = cx + STRAND_AMPLITUDE * Math.sin(omega * (y - top) + phaseOffset);
    points.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

/** Compute the (x, y) coordinates for one base pair anchor on a strand. */
function basePairPoint(t: number, phaseOffset: number): { x: number; y: number } {
  const cx = VIEWBOX_WIDTH / 2;
  const top = 8;
  const bottom = VIEWBOX_HEIGHT - 8;
  const totalHeight = bottom - top;
  const omega = (2 * Math.PI) / STRAND_TWIST_HEIGHT;
  const y = top + t * totalHeight;
  const x = cx + STRAND_AMPLITUDE * Math.sin(omega * (y - top) + phaseOffset);
  return { x, y };
}

/**
 * Renders the DNA helix mark. Stateless and side-effect free — safe to
 * server-render. The animation lives entirely in CSS keyframes (see
 * `.dna-helix-rotor` / `.dna-helix-pulse` in `globals.css`).
 */
export function DnaHelix({
  width = 180,
  height = 240,
  className,
  ariaLabel = "Loading helix",
}: DnaHelixProps) {
  // Two strands offset by half a wavelength (pi rad) so the helix looks
  // genuinely paired rather than like two parallel sine waves.
  const strandA = buildStrandPath(0);
  const strandB = buildStrandPath(Math.PI);

  // Base pair rungs: one connector every (1 / BASE_PAIR_COUNT) of the way
  // down the helix, drawn from strand A to strand B at that y.
  const basePairs: Array<{ x1: number; y1: number; x2: number; y2: number }> =
    [];
  for (let i = 1; i <= BASE_PAIR_COUNT; i++) {
    const t = i / (BASE_PAIR_COUNT + 1); // skip very top + very bottom
    const a = basePairPoint(t, 0);
    const b = basePairPoint(t, Math.PI);
    basePairs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }

  return (
    <div
      className={`dna-helix-3d inline-block ${className ?? ""}`.trim()}
      style={{ width, height }}
      role="img"
      aria-label={ariaLabel}
      data-testid="dna-helix"
    >
      <div
        className="dna-helix-rotor h-full w-full"
        data-testid="dna-helix-rotor"
      >
        <svg
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          width="100%"
          height="100%"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Strand A — sage */}
          <path
            d={strandA}
            className="stroke-current text-primary"
            strokeWidth={STRAND_STROKE_WIDTH}
            strokeLinecap="round"
            data-testid="dna-helix-strand-a"
          />
          {/* Strand B — slate */}
          <path
            d={strandB}
            className="stroke-current text-muted-foreground"
            strokeWidth={STRAND_STROKE_WIDTH}
            strokeLinecap="round"
            data-testid="dna-helix-strand-b"
          />
          {/* Base pairs — pulse softly so reduced-motion users still see motion */}
          <g
            className="dna-helix-pulse stroke-current text-muted-foreground"
            strokeWidth={BASE_PAIR_STROKE_WIDTH}
            strokeLinecap="round"
            data-testid="dna-helix-bases"
          >
            {basePairs.map((bp, i) => (
              <line
                key={i}
                x1={bp.x1}
                y1={bp.y1}
                x2={bp.x2}
                y2={bp.y2}
              />
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}

export default DnaHelix;
