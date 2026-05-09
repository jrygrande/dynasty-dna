"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

interface DnaHelix3DProps {
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

const HELIX_RADIUS = 0.9;
const HELIX_HEIGHT = 4.4;
const HELIX_TURNS = 2;
const TUBE_RADIUS = 0.085;
const TUBE_SEGMENTS = 220;
const TUBE_RADIAL_SEGMENTS = 14;
const BASE_PAIR_COUNT = 9;
const BASE_PAIR_RADIUS = 0.045;
const ROTATION_SPEED = (2 * Math.PI) / 12;

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private radius: number,
    private height: number,
    private turns: number,
    private phase: number
  ) {
    super();
  }

  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const angle = 2 * Math.PI * this.turns * t + this.phase;
    const x = this.radius * Math.cos(angle);
    const y = (t - 0.5) * this.height;
    const z = this.radius * Math.sin(angle);
    return target.set(x, y, z);
  }
}

function pointOnHelix(t: number, phase: number): THREE.Vector3 {
  const angle = 2 * Math.PI * HELIX_TURNS * t + phase;
  return new THREE.Vector3(
    HELIX_RADIUS * Math.cos(angle),
    (t - 0.5) * HELIX_HEIGHT,
    HELIX_RADIUS * Math.sin(angle)
  );
}

function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefers(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefers(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return prefers;
}

/**
 * Convert an HSL-triplet CSS var ("95 18% 46%") to hex. shadcn-style tokens
 * (--primary, --background, --muted-foreground, etc.) are stored this way so
 * Tailwind's `<alpha-value>` substitution works. three.js needs hex/rgb.
 */
function hslTripletToHex(triplet: string): string {
  const match = triplet
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!match) return "#000000";
  const h = Number(match[1]) / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

interface HelixColors {
  /** Brand primary — sage. Used for both strands + base pairs. */
  primary: string;
  /** Canvas — cream. Used to tint the key light so the scene reads warm. */
  canvas: string;
}

/**
 * Read shadcn semantic tokens straight from `:root`. Component is mounted
 * client-only via `next/dynamic({ ssr: false })`, so CSS is always loaded
 * by the time this runs — no fallback flicker, no SSR mismatch.
 */
function readHelixColors(): HelixColors {
  const cs = getComputedStyle(document.documentElement);
  return {
    primary: hslTripletToHex(cs.getPropertyValue("--primary")),
    canvas: hslTripletToHex(cs.getPropertyValue("--background")),
  };
}

interface BasePair {
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
}

function buildBasePairs(): BasePair[] {
  const pairs: BasePair[] = [];
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (let i = 1; i <= BASE_PAIR_COUNT; i++) {
    const t = i / (BASE_PAIR_COUNT + 1);
    const a = pointOnHelix(t, 0);
    const b = pointOnHelix(t, Math.PI);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const length = dir.length();
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
    pairs.push({ midpoint: mid, quaternion: q, length });
  }
  return pairs;
}

function HelixScene({
  reducedMotion,
  primary,
  canvas,
}: {
  reducedMotion: boolean;
  primary: string;
  canvas: string;
}) {
  const groupRef = useRef<THREE.Group>(null);

  const strandACurve = useMemo(
    () => new HelixCurve(HELIX_RADIUS, HELIX_HEIGHT, HELIX_TURNS, 0),
    []
  );
  const strandBCurve = useMemo(
    () => new HelixCurve(HELIX_RADIUS, HELIX_HEIGHT, HELIX_TURNS, Math.PI),
    []
  );
  const basePairs = useMemo(() => buildBasePairs(), []);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    if (groupRef.current) {
      groupRef.current.rotation.y += ROTATION_SPEED * delta;
    }
  });

  // Tilt slightly forward so reduced-motion viewers still see depth.
  const initialRotation: [number, number, number] = reducedMotion
    ? [0.18, 0.6, 0]
    : [0.18, 0, 0];

  return (
    <>
      <ambientLight intensity={0.85} />
      {/* Key light tinted with the cream canvas so highlights read warm,
          not clinical white. */}
      <directionalLight position={[3, 4, 5]} intensity={1.05} color={canvas} />
      {/* Sage rim from the back-left lifts the shadow side off black. */}
      <directionalLight position={[-4, -2, -3]} intensity={0.45} color={primary} />

      <group ref={groupRef} rotation={initialRotation}>
        <mesh>
          <tubeGeometry
            args={[strandACurve, TUBE_SEGMENTS, TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, false]}
          />
          <meshStandardMaterial
            color={primary}
            emissive={primary}
            emissiveIntensity={0.2}
            roughness={0.45}
            metalness={0.05}
          />
        </mesh>

        <mesh>
          <tubeGeometry
            args={[strandBCurve, TUBE_SEGMENTS, TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, false]}
          />
          <meshStandardMaterial
            color={primary}
            emissive={primary}
            emissiveIntensity={0.2}
            roughness={0.45}
            metalness={0.05}
          />
        </mesh>

        {basePairs.map((bp, i) => (
          <mesh
            key={i}
            position={bp.midpoint}
            quaternion={bp.quaternion}
          >
            <cylinderGeometry
              args={[BASE_PAIR_RADIUS, BASE_PAIR_RADIUS, bp.length, 12]}
            />
            <meshStandardMaterial
              color={primary}
              emissive={primary}
              emissiveIntensity={0.18}
              roughness={0.5}
              metalness={0.05}
            />
          </mesh>
        ))}
      </group>
    </>
  );
}

export function DnaHelix3D({
  width = 180,
  height = 240,
  className,
  ariaLabel = "Loading helix",
}: DnaHelix3DProps) {
  const reducedMotion = usePrefersReducedMotion();
  // Lazy init: ssr:false guarantees CSS is loaded by mount, so we read tokens
  // once and never again — no fallback flicker, no useEffect.
  const [{ primary, canvas }] = useState<HelixColors>(readHelixColors);

  // Soft vertical fade on the canvas itself: the helix strands end abruptly
  // at top + bottom, so we mask the outermost ~14% to transparent. Reads as
  // "the helix continues into space" rather than "cut off."
  const fadeMask =
    "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)";

  return (
    <div
      className={`inline-block ${className ?? ""}`.trim()}
      style={{ width, height }}
      role="img"
      aria-label={ariaLabel}
      data-testid="dna-helix-3d"
    >
      <Canvas
        camera={{ position: [0, 0, 5.6], fov: 38 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{
          background: "transparent",
          maskImage: fadeMask,
          WebkitMaskImage: fadeMask,
        }}
      >
        <HelixScene
          reducedMotion={reducedMotion}
          primary={primary}
          canvas={canvas}
        />
      </Canvas>
    </div>
  );
}

export default DnaHelix3D;
