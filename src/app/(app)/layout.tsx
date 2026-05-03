import { PublicNav } from "@/components/PublicNav";
import { DemoBanner } from "@/components/DemoIndicators";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <PublicNav />
      <DemoBanner />
      {children}
    </div>
  );
}
