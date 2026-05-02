"use client";

import { WaitlistProgress } from "@/components/WaitlistProgress";
import { useWaitlistCount } from "@/lib/useWaitlistCount";

export function LandingWaitlist() {
  const { current } = useWaitlistCount();
  return <WaitlistProgress current={current} target={100} />;
}
