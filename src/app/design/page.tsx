import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Design system — Dynasty DNA",
  description:
    "Token and component specimens for the Dynasty DNA brand: colors, type, spacing, components.",
};

type Card = {
  file: string;
  title: string;
  height?: number;
};

type Group = {
  label: string;
  cards: Card[];
};

const DEFAULT_CARD_HEIGHT = 340;

const GROUPS: Group[] = [
  {
    label: "Colors",
    cards: [
      { file: "color_sage.html", title: "Sage — brand accent" },
      { file: "color_neutrals.html", title: "Cream + slate neutrals" },
      { file: "color_grades.html", title: "Grade palette (A–F)" },
      { file: "color_chart.html", title: "Chart palette" },
    ],
  },
  {
    label: "Type",
    cards: [
      { file: "type_display.html", title: "Display — Source Serif 4", height: 360 },
      { file: "type_headings.html", title: "Headings", height: 360 },
      { file: "type_body.html", title: "Body & prose" },
      { file: "type_mono.html", title: "Mono — JetBrains Mono" },
    ],
  },
  {
    label: "Spacing & elevation",
    cards: [
      { file: "spacing_tokens.html", title: "Spacing scale" },
      { file: "spacing_elevation.html", title: "Elevation & radius" },
    ],
  },
  {
    label: "Components",
    cards: [
      { file: "components_buttons.html", title: "Buttons" },
      { file: "components_badges.html", title: "Badges" },
      { file: "components_inputs.html", title: "Inputs" },
      { file: "components_cards.html", title: "Cards" },
      { file: "components_table.html", title: "Tables", height: 360 },
      { file: "components_nav.html", title: "Navigation" },
      { file: "components_grade_card.html", title: "Grade card", height: 380 },
    ],
  },
  {
    label: "Brand",
    cards: [
      { file: "brand_logo.html", title: "Logo & wordmark", height: 280 },
      { file: "brand_icons.html", title: "Iconography — Lucide" },
      { file: "brand_voice.html", title: "Voice & tone", height: 380 },
    ],
  },
];

export default function DesignSystemPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="container mx-auto px-6 py-10 max-w-5xl">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Design system · v1
          </p>
          <h1 className="font-serif text-4xl font-medium tracking-tight">
            Dynasty <span className="text-primary">DNA</span>
          </h1>
          <p className="mt-3 text-muted-foreground max-w-2xl">
            Claude-inspired warmth, sage accent, editorial serif display.
            Specimens below are rendered from the handoff bundle so we can
            eyeball tokens + components as we roll the redesign into real
            screens.
          </p>
        </div>
      </header>

      <div className="container mx-auto px-6 py-12 max-w-5xl space-y-16">
        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Shadcn primitives (live)
          </h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
            Rendered with the live tokens. Compare against the specimen
            iframes below — button/badge/card/input/table/separator should
            read sage-on-cream with hairline borders.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Buttons</CardTitle>
                <CardDescription>
                  Default is sage; secondary/outline/ghost stay quiet.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="link">Link</Button>
                <Button variant="destructive">Destructive</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Badges</CardTitle>
                <CardDescription>
                  Default, secondary, outline, destructive.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="destructive">Destructive</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Input</CardTitle>
                <CardDescription>
                  Focus ring uses sage; border is a cream hairline.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input placeholder="you@example.com" />
                <Input placeholder="Disabled" disabled />
                <Separator />
                <p className="text-xs text-muted-foreground">
                  Separator above renders as a single hairline.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Table</CardTitle>
                <CardDescription>
                  Hairline rows, tabular numbers on mono columns.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Manager</TableHead>
                      <TableHead className="text-right">Pts</TableHead>
                      <TableHead className="text-right">Eff.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Team A</TableCell>
                      <TableCell className="text-right font-mono">
                        1,428.6
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        92.4%
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Team B</TableCell>
                      <TableCell className="text-right font-mono">
                        1,391.2
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        87.3%
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </section>

        {GROUPS.map((group) => (
          <section key={group.label}>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-6">
              {group.label}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {group.cards.map((card) => (
                <figure
                  key={card.file}
                  className="rounded-lg border border-border bg-card overflow-hidden"
                >
                  <iframe
                    src={`/design-preview/${card.file}`}
                    title={card.title}
                    className="block w-full border-0"
                    style={{ height: card.height ?? DEFAULT_CARD_HEIGHT }}
                    loading="lazy"
                  />
                  <figcaption className="px-5 py-3 border-t border-border flex items-center justify-between text-sm">
                    <span className="font-medium">{card.title}</span>
                    <a
                      href={`/design-preview/${card.file}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-primary text-xs font-mono"
                    >
                      open ↗
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
