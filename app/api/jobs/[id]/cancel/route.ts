import { handle, HttpError, ok, requireUser } from "@/lib/api/helpers";
import { cancelJob } from "@/lib/pipeline/jobs";
import { admin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  const { data } = await admin().from("generation_jobs").select("id,status").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!data) throw new HttpError(404, "Job not found");
  if (["completed", "failed", "cancelled"].includes(data.status)) throw new HttpError(409, `Job is already ${data.status}.`);
  await cancelJob(id); // unused reservation is refunded; completed steps are kept and reused on the next run
  return ok({ cancelled: true });
});
