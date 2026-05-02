import { Resend } from "resend";

const FROM_ADDRESS = "Dynasty DNA <onboarding@resend.dev>";

function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/+$/, "")}`;
  }
  return "https://dynasty-dna.app";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ConfirmationParams {
  to: string;
  leagueName: string;
  currentCapacity: number;
}

interface NotifyParams {
  to: string;
  leagueName: string;
  familyId: string;
}

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const WAITLIST_MILESTONE = 100;

export function renderConfirmation({
  leagueName,
  currentCapacity,
}: Omit<ConfirmationParams, "to">): RenderedEmail {
  const safeLeague = escapeHtml(leagueName);
  const safePosition = escapeHtml(String(currentCapacity));
  const safeMilestone = escapeHtml(String(WAITLIST_MILESTONE));
  const subject = `Waitlist confirmed: ${leagueName}`;
  const text = `We've added ${leagueName} to the waitlist for Dynasty DNA. We'll email you the moment your league data is loaded and all features are available.

We are scaling up capacity to meet demand. Your league is ${currentCapacity} on the waitlist — once it reaches ${WAITLIST_MILESTONE}, we'll invest in supporting this cohort, thanks!

— Dynasty DNA`;
  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.5;">
<p>We've added <strong>${safeLeague}</strong> to the waitlist for Dynasty DNA. We'll email you the moment your league data is loaded and all features are available.</p>
<p>We are scaling up capacity to meet demand. Your league is <strong>${safePosition}</strong> on the waitlist — once it reaches <strong>${safeMilestone}</strong>, we'll invest in supporting this cohort, thanks!</p>
<p>— Dynasty DNA</p>
</body></html>`;
  return { subject, text, html };
}

export function renderNotify({
  leagueName,
  familyId,
}: Omit<NotifyParams, "to">): RenderedEmail {
  const safeLeague = escapeHtml(leagueName);
  const url = `${getSiteUrl()}/league/${encodeURIComponent(familyId)}`;
  const safeUrl = escapeHtml(url);
  const subject = `Your league is live: ${leagueName}`;
  const text = `Good news — ${leagueName} is now ingested in Dynasty DNA.

Open it here: ${url}

— Dynasty DNA`;
  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.5;">
<p>Good news — <strong>${safeLeague}</strong> is now ingested in Dynasty DNA.</p>
<p>Open it here: <a href="${safeUrl}">${safeUrl}</a></p>
<p>— Dynasty DNA</p>
</body></html>`;
  return { subject, text, html };
}

function getClient(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("RESEND_API_KEY is not set");
  }
  return new Resend(key);
}

export async function sendConfirmation(params: ConfirmationParams) {
  const rendered = renderConfirmation(params);
  const client = getClient();
  return client.emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}

export async function sendNotify(params: NotifyParams) {
  const rendered = renderNotify(params);
  const client = getClient();
  return client.emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}

export const __test__ = { escapeHtml, FROM_ADDRESS, getSiteUrl };
