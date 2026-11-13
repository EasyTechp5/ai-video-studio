import { handle, HttpError, ok, requireUser } from "@/lib/api/helpers";
import { signedUrl } from "@/lib/storage";
import { admin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  const { data } = await admin().from("assets").select("storage_path, projects!inner(user_id)").eq("id", id).maybeSingle();
  const row = data as { storage_path: string; projects: { user_id: string } } | null;
  if (!row || row.projects.user_id !== user.id) throw new HttpError(404, "Asset not found");
  return ok({ url: await signedUrl(row.storage_path, 900) });
});
