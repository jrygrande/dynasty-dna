import type { Viewport } from "next";

// Lock viewport scale so iOS Safari doesn't auto-zoom the page on orientation
// change. React Flow's pinch-zoom on the canvas is JS-based (CSS transforms
// on its own content) and is unaffected by these flags, so the canvas stays
// fully interactive while the page chrome stays stable.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function GraphLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
