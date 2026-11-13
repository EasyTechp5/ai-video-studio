import type { Metadata } from "next";
import { SettingsForm } from "@/components/forms/SettingsForm";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("display_name,spending_limit,email").eq("id", auth.user!.id).single();
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="font-display text-4xl">Settings</h1>
      <SettingsForm email={profile?.email ?? auth.user!.email ?? ""} displayName={profile?.display_name ?? ""} spendingLimit={profile?.spending_limit ?? null} />
    </div>
  );
}
