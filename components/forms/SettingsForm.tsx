"use client";
import { useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { createBrowser } from "@/lib/supabase/browser";

export function SettingsForm({ email, displayName, spendingLimit }: { email: string; displayName: string; spendingLimit: number | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const f = new FormData(e.currentTarget);
    const limit = String(f.get("limit") ?? "").trim();
    const supabase = createBrowser();
    const { data: u } = await supabase.auth.getUser();
    // RLS + column grants only let users change these two fields.
    const { error } = await supabase.from("profiles").update({
      display_name: String(f.get("name") ?? "").trim() || null,
      spending_limit: limit === "" ? null : Math.max(0, Math.floor(Number(limit))),
    }).eq("id", u.user!.id);
    setBusy(false);
    setMsg(error ? { tone: "danger", text: error.message } : { tone: "ok", text: "Saved." });
  }

  return (
    <form onSubmit={save} className="mt-6">
      <Card className="space-y-5 p-6">
        <Field label="Email"><Input value={email} disabled readOnly /></Field>
        <Field label="Display name"><Input name="name" defaultValue={displayName} maxLength={80} /></Field>
        <Field label="Per-run spending limit (credits)" hint="A run estimated above this is blocked before it starts. Leave empty for no limit.">
          <Input name="limit" type="number" min={0} defaultValue={spendingLimit ?? ""} />
        </Field>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Button type="submit" busy={busy}>Save changes</Button>
      </Card>
    </form>
  );
}
