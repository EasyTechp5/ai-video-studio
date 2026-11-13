import { HttpError } from "@/lib/api/helpers";
import { admin } from "@/lib/supabase/admin";

export async function loadOwnedExport(id: string, userId: string) {
  const { data } = await admin().from("exports").select("*, assets!inner(storage_path), projects!inner(user_id,title)").eq("id", id).maybeSingle();
  const row = data as (Record<string, unknown> & { projects: { user_id: string; title: string }; assets: { storage_path: string } }) | null;
  if (!row || row.projects.user_id !== userId) throw new HttpError(404, "Export not found");
  return row;
}
