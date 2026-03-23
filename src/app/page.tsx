import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { AuthCTA } from "@/components/AuthCTA";
import {
  ArrowRightLeft,
  ClipboardList,
  BarChart3,
  Dna,
  Map,
  BookOpen,
  FlaskConical,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <PublicNav />

      {/* Hero */}
      <section className="container mx-auto px-6 py-24 text-center max-w-3xl">
        <h1 className="text-5xl font-bold tracking-tight mb-4">
          Decode your dynasty <span className="text-primary">DNA</span>
        </h1>
        <p className="text-xl text-muted-foreground mb-8 max-w-xl mx-auto">
          Find out if you won the trade, graded every pick right, and where
          you&apos;re leaving points on your bench — all from your Sleeper data.
        </p>
        <AuthCTA />
        <p className="text-xs text-muted-foreground mt-6">
          Powered by 50+ data points per player &middot; FantasyCalc &middot;
          nflverse
        </p>
      </section>

      {/* Feature cards */}
      <section className="container mx-auto px-6 pb-20 max-w-5xl">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            icon={<ArrowRightLeft className="h-6 w-6 text-primary" />}
            title="Know if you won the trade"
            description="Every trade scored with surplus value so you can see who came out ahead — and why."
          />
          <FeatureCard
            icon={<ClipboardList className="h-6 w-6 text-primary" />}
            title="Grade every pick"
            description="Pick-by-pick draft grades comparing capital spent vs. production gained."
          />
          <FeatureCard
            icon={<BarChart3 className="h-6 w-6 text-primary" />}
            title="Never leave points on your bench"
            description="Weekly lineup analysis showing exactly where you left points on the table."
          />
          <FeatureCard
            icon={<Dna className="h-6 w-6 text-primary" />}
            title="Discover your manager style"
            description="A profile across trades, drafts, and waivers that reveals how you build rosters."
          />
        </div>
      </section>

      {/* How It's Built */}
      <section className="border-t bg-muted/30">
        <div className="container mx-auto px-6 py-16 max-w-5xl">
          <h2 className="text-2xl font-bold tracking-tight mb-2 text-center">
            Built by a dynasty player, for dynasty players
          </h2>
          <p className="text-muted-foreground text-center mb-10 max-w-lg mx-auto">
            Every feature is built in the open — see what&apos;s planned, what shipped, and the data behind each decision.
          </p>
          <div className="grid gap-6 sm:grid-cols-3">
            <BuildCard
              href="/roadmap"
              icon={<Map className="h-5 w-5 text-primary" />}
              title="Roadmap"
              description="What we're building next and why — priorities driven by real league data."
            />
            <BuildCard
              href="/changelog"
              icon={<BookOpen className="h-5 w-5 text-primary" />}
              title="Changelog"
              description="What shipped and the results. Full transparency on every release."
            />
            <BuildCard
              href="/experiments"
              icon={<FlaskConical className="h-5 w-5 text-primary" />}
              title="Experiments"
              description="Algorithm variants tested against real data to find what actually works."
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="container mx-auto px-6 py-8 text-center text-xs text-muted-foreground">
          <a
            href="https://github.com/jrygrande/dynasty-dna"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            View source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-3">{icon}</div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function BuildCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border bg-card p-6 hover:border-primary/50 transition-colors group"
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="font-semibold group-hover:text-primary transition-colors">
          {title}
        </h3>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
