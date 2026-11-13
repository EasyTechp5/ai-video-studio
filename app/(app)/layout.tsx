import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { NavLink, SignOutButton } from "@/components/dashboard/Nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return <SetupRequired />;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("display_name,credits").eq("id", data.user.id).single();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-row items-center gap-2 border-b border-line bg-surface px-4 py-3 md:w-60 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-4 md:py-6">
        <Link href="/dashboard" className="font-display mr-auto text-xl md:mr-0 md:mb-8 md:px-2">AI Video Studio</Link>
        <nav aria-label="Main" className="flex gap-1 md:flex-col">
          <NavLink href="/dashboard">Projects</NavLink>
          <NavLink href="/create">New video</NavLink>
          <NavLink href="/billing">Credits</NavLink>
          <NavLink href="/settings">Settings</NavLink>
        </nav>
        <div className="hidden md:mt-auto md:block">
          <Link href="/billing" className="block rounded-lg border border-line bg-surface-2 px-3 py-2.5 hover:border-muted/50">
            <span className="block text-xs uppercase tracking-wider text-muted">Credits</span>
            <span className="font-display text-2xl">{profile?.credits ?? 0}</span>
          </Link>
          <p className="mt-3 truncate px-1 text-xs text-muted">{profile?.display_name ?? data.user.email}</p>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-8 md:px-10 md:py-10">{children}</main>
    </div>
  );
}

function SetupRequired() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <h1 className="font-display text-4xl">Almost there</h1>
      <p className="mt-3 text-muted">Supabase isn’t configured yet. Copy <code className="font-mono text-text">.env.example</code> to <code className="font-mono text-text">.env.local</code>, fill in the Supabase values, apply the migrations in <code className="font-mono text-text">supabase/migrations</code>, and restart. See the README for the full checklist.</p>
      <ul className="mt-5 space-y-1 font-mono text-sm text-warn">
        <li>NEXT_PUBLIC_SUPABASE_URL</li><li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li><li>SUPABASE_SERVICE_ROLE_KEY</li>
      </ul>
    </main>
  );
}
