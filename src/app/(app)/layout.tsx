import { PublicNav } from "@/components/PublicNav";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <PublicNav />
      {children}
    </div>
  );
}
