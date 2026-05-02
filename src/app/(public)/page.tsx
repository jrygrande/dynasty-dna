import Link from "next/link";
import {
  ArrowRightLeft,
  ClipboardList,
  BarChart3,
  Dna,
  Map,
  BookOpen,
  FlaskConical,
} from "lucide-react";
import { LandingWaitlist } from "./LandingWaitlist";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      {/* Hero */}
      <section className="container mx-auto px-6 py-24 text-center max-w-3xl">
        <h1 className="font-serif text-5xl md:text-6xl font-medium tracking-tight mb-4 leading-[1.05]">
          Decode your dynasty <span className="text-primary">DNA</span>
        </h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto leading-relaxed">
          Enter your Sleeper username to find your dynasty leagues.
        </p>
        <Link
          href="/start"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium text-lg"
        >
          Get started
        </Link>
        <LandingWaitlist />
        <p className="text-xs text-muted-foreground mt-6 flex flex-wrap justify-center gap-x-2 gap-y-0.5">
          <span>Only for Sleeper leagues</span>
          <span>&middot; Player valuations by FantasyCalc &middot; NFL data from nflverse</span>
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
          <h2 className="font-serif text-3xl md:text-4xl font-medium tracking-tight mb-3 text-center">
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
    <div className="rounded-lg border bg-card p-6 hover:border-primary/50 transition-colors">
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
