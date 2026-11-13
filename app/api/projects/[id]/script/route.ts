import { z } from "zod";
import { handle, HttpError, ok, ownedProject, parseBody, rateLimit, requireUser } from "@/lib/api/helpers";
import { assertIdle, hasMedia } from "@/lib/api/project-ops";
import { startJob } from "@/lib/pipeline/jobs";
import { providerStatus } from "@/lib/providers";
import { admin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

/** Regenerates the whole script. Invalidates storyboard media, so it needs explicit confirmation. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  rateLimit(`script:${user.id}`, 10, 60_000);
  const { confirm } = await parseBody(req, z.object({ confirm: z.boolean().default(false) }));
  const project = await ownedProject(id, user.id);
  if (!providerStatus().anthropic) throw new HttpError(503, "ANTHROPIC_API_KEY is not configured.", { code: "not_configured" });
  await assertIdle(id);
  if (!confirm && (await hasMedia(id))) {
    throw new HttpError(409, "Regenerating the script replaces every scene and its generated media.", { code: "confirmation_required" });
  }
  await admin().from("scripts").update({ approved: false, approved_at: null }).eq("project_id", id);
  const job = await startJob(project, "plan");
  return ok({ job }, 202);
});
