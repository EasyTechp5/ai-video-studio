import { handle, HttpError, ok, requireUser } from "@/lib/api/helpers";
import { admin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  const { data } = await admin().from("generation_jobs").select("*, job_steps(*)").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!data) throw new HttpError(404, "Job not found");
  return ok({ job: data });
});
