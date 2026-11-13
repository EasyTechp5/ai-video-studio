import type { Metadata } from "next";
import { Alert, Card } from "@/components/ui";
import { COSTS } from "@/lib/costs";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Credits" };

export default async function BillingPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const [{ data: profile }, { data: tx }] = await Promise.all([
    supabase.from("profiles").select("credits,spending_limit").eq("id", auth.user!.id).single(),
    supabase.from("credit_transactions").select("id,kind,amount,balance_after,note,created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-4xl">Credits</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card className="p-6"><p className="text-xs uppercase tracking-wider text-muted">Balance</p><p className="font-display text-5xl">{profile?.credits ?? 0}</p></Card>
        <Card className="p-6">
          <p className="text-xs uppercase tracking-wider text-muted">Per-run spending limit</p>
          <p className="font-display text-5xl">{profile?.spending_limit ?? "None"}</p>
          <p className="mt-1 text-xs text-muted">Change it in Settings.</p>
        </Card>
      </div>
      <div className="mt-4"><Alert tone="warn">Buying credits and subscriptions arrives with the commercialization phase. Until then, balances come from signup credits and manual grants.</Alert></div>

      <h2 className="font-display mt-10 text-2xl">How credits are used</h2>
      <Card className="mt-3 divide-y divide-line text-sm">
        {([
          ["Research", `${COSTS.researchQuick}–${COSTS.researchDetailed}`], ["Script & storyboard", COSTS.script], ["Character reference image", COSTS.characterImage],
          ["Scene image", COSTS.sceneImage], ["Voiceover per scene", COSTS.voice], ["Background music", COSTS.music],
          ["AI video clip", `${COSTS.videoPerSecond} / second`], ["Render & export", COSTS.render],
        ] as const).map(([k, v]) => <div key={k} className="flex justify-between px-4 py-2.5"><span className="text-muted">{k}</span><span>{v}</span></div>)}
      </Card>
      <p className="mt-2 text-xs text-muted">Credits are reserved when a run starts. Anything not consumed — failed or cancelled work — is refunded automatically, and a retried step is never charged twice.</p>

      <h2 className="font-display mt-10 text-2xl">History</h2>
      <Card className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted"><tr><th className="px-4 py-2.5 font-medium">When</th><th className="px-4 font-medium">Type</th><th className="px-4 font-medium">Note</th><th className="px-4 text-right font-medium">Amount</th><th className="px-4 text-right font-medium">Balance</th></tr></thead>
          <tbody className="divide-y divide-line">
            {(tx ?? []).map((t) => (
              <tr key={t.id}><td className="px-4 py-2.5 text-muted">{new Date(t.created_at).toLocaleString()}</td><td className="px-4">{t.kind}</td><td className="px-4 text-muted">{t.note}</td>
                <td className={`px-4 text-right tabular-nums ${t.amount < 0 ? "text-danger" : "text-ok"}`}>{t.amount > 0 ? "+" : ""}{t.amount}</td><td className="px-4 text-right tabular-nums">{t.balance_after}</td></tr>
            ))}
            {!tx?.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No transactions yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
