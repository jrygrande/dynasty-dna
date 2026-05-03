"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { activateDemo } from "@/lib/useDemoMap";

// Client-side entry into demo mode. Activating BEFORE navigation ensures
// sessionStorage is set when the league page mounts — first render reads the
// flag and renders pseudonyms immediately, no flicker, no race, no URL param.
export function DemoEntryRedirect({ familyId }: { familyId: string }) {
  const router = useRouter();

  useEffect(() => {
    activateDemo();
    router.replace(`/league/${familyId}`);
  }, [familyId, router]);

  return (
    <main className="container mx-auto px-6 py-20 max-w-2xl text-center">
      <p className="text-muted-foreground animate-pulse">Loading demo…</p>
    </main>
  );
}
