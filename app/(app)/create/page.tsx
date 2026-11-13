import type { Metadata } from "next";
import { CreateForm } from "@/components/forms/CreateForm";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New video" };

export default async function CreatePage() {
  const supabase = await createClient();
  const { data: voices } = await supabase.from("voice_profiles").select("id,name,gender,accent,description").order("name");
  return <CreateForm voices={voices ?? []} maxDuration={env.maxDurationSeconds} />;
}
