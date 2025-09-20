export default function LoadingPlayerTimeline() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="space-y-2">
        <div className="h-8 w-1/3 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
      </div>
      <div className="h-32 animate-pulse rounded-lg bg-slate-200" />
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-200" />
      </div>
    </main>
  );
}
