export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="relative grid min-h-screen lg:grid-cols-2">
      <section className="flex items-center justify-center px-6 py-16">{children}</section>
      <aside className="film-grain relative hidden overflow-hidden border-l border-line bg-surface lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_30%,color-mix(in_srgb,var(--accent)_28%,transparent),transparent_70%)]" />
        <div className="relative flex h-full flex-col justify-end p-14">
          <p className="font-display max-w-md text-5xl leading-[1.05]">An idea goes in. A finished film comes out.</p>
          <p className="mt-5 max-w-sm text-sm text-muted">Research, script, characters, voice, music, clips and the final cut — orchestrated for you, with a human approval step before anything expensive runs.</p>
        </div>
      </aside>
    </main>
  );
}
