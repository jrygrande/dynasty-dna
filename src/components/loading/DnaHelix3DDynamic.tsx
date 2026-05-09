"use client";

import dynamic from "next/dynamic";

export const DnaHelix3D = dynamic(
  () => import("./DnaHelix3D").then((m) => m.DnaHelix3D),
  { ssr: false }
);
