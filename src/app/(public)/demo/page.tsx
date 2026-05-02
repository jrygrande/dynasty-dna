import { redirect } from "next/navigation";
import Link from "next/link";
import { getDemoFamilyId } from "@/lib/demoFamily";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const familyId = await getDemoFamilyId();
  if (familyId) {
    redirect(`/league/${familyId}?demo=1`);
  }

  return (
    <main className="container mx-auto px-6 py-20 max-w-2xl text-center">
      <h1 className="font-serif text-4xl md:text-5xl font-medium tracking-tight mb-4">
        Demo unavailable
      </h1>
      <p className="text-muted-foreground text-lg mb-2">
        No demo league is configured right now.
      </p>
      <p className="text-muted-foreground max-w-md mx-auto mb-6">
        Try entering your Sleeper username to see your own dynasty leagues
        instead.
      </p>
      <Link
        href="/start"
        className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Find your league →
      </Link>
    </main>
  );
}
