import { PublicNav } from "@/components/PublicNav";
import { DemoBanner, DemoQueryParamSync } from "@/components/DemoIndicators";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <DemoQueryParamSync />
      <PublicNav />
      <DemoBanner />
      {children}
    </div>
  );
}
