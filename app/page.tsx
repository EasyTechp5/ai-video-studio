import Link from "next/link";

const STAGES = ["Research", "Script", "Characters", "Images", "Voice", "Music", "Clips", "Render"];

export default function Landing() {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(55%_60%_at_70%_0%,color-mix(in_srgb,var(--accent)_26%,transparent),transparent_70%)]" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-xl">AI Video Studio</span>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-2 text-muted hover:text-text">Sign in</Link>
          <Link href="/signup" className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink hover:brightness-110">Start free</Link>
        </nav>
      </header>

      <main className="relative mx-auto max-w-6xl px-6">
        <section className="pt-20 pb-24 md:pt-28">
          <p className="rise text-sm uppercase tracking-[0.2em] text-accent">From a simple idea to a complete video</p>
          <h1 className="font-display rise mt-5 max-w-4xl text-5xl leading-[1.02] sm:text-7xl" style={{ animationDelay: ".05s" }}>
            Describe it. Approve it.<br />We produce the whole film.
          </h1>
          <p className="rise mt-6 max-w-xl text-lg text-muted" style={{ animationDelay: ".1s" }}>
            Not a prompt box that returns one clip. A production agent that researches, writes, designs characters, records narration, scores the music, generates the shots and cuts the final MP4.
          </p>
          <div className="rise mt-9 flex flex-wrap gap-3" style={{ animationDelay: ".15s" }}>
            <Link href="/signup" className="rounded-lg bg-accent px-6 py-3 font-medium text-accent-ink hover:brightness-110">Create your first video</Link>
            <Link href="/login" className="rounded-lg border border-line px-6 py-3 text-text hover:border-muted/50">Sign in</Link>
          </div>
        </section>

        <section aria-label="Pipeline" className="border-y border-line py-8">
          <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4 lg:grid-cols-8">
            {STAGES.map((s, i) => (
              <li key={s} className="bg-surface p-4">
                <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                <span className="mt-6 block text-sm">{s}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-10 py-24 md:grid-cols-3">
          {[
            ["You stay in control", "Review the research, script and character designs before any paid generation starts. Edit a line, rewrite a scene, regenerate one image."],
            ["Nothing is faked", "Every stage shows its real status. Sources come from real searches. If a provider fails, you see why — and only that scene is retried."],
            ["Costs before commitments", "See an estimate before you run. Credits are reserved up front and unused credits are refunded when work fails or is cancelled."],
          ].map(([t, d]) => (
            <div key={t}><h3 className="font-display text-2xl">{t}</h3><p className="mt-3 text-sm leading-relaxed text-muted">{d}</p></div>
          ))}
        </section>
      </main>
      <footer className="relative border-t border-line py-8 text-center text-xs text-muted">AI Video Studio</footer>
    </div>
  );
}
