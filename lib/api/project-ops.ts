import { admin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/api/helpers";
import { estimateFor, startJob } from "@/lib/pipeline/jobs";
import { missingForProduction, providerStatus } from "@/lib/providers";
import { removeObjects } from "@/lib/storage";
import type { JobRow, ProjectRow } from "@/lib/pipeline/types";

export async function activeJob(projectId: string): Promise<JobRow | null> {
  const { data } = await admin().from("generation_jobs").select("*").eq("project_id", projectId)
    .in("status", ["pending", "queued", "processing", "retrying"]).limit(1);
  return (data?.[0] as JobRow | undefined) ?? null;
}

export async function assertIdle(projectId: string) {
  if (await activeJob(projectId)) throw new HttpError(409, "A job is currently running for this project.", { code: "job_active" });
}

/** True when the project already has generated media that a change would invalidate. */
export async function hasMedia(projectId: string): Promise<boolean> {
  const { count } = await admin().from("assets").select("id", { count: "exact", head: true })
    .eq("project_id", projectId).eq("is_current", true).neq("kind", "character_reference");
  return (count ?? 0) > 0;
}

export async function startProduction(project: ProjectRow, confirmed: boolean) {
  if (!confirmed) throw new HttpError(400, "Confirm the estimated credit cost before production starts.", { code: "confirmation_required", estimate: await estimateFor(project.id, "produce") });
  const { data: script } = await admin().from("scripts").select("approved").eq("project_id", project.id).order("version", { ascending: false }).limit(1);
  if (!script?.[0]?.approved) throw new HttpError(409, "Approve the script and character designs before production.", { code: "not_approved" });
  const missing = missingForProduction({ music: project.music_mood !== "none" });
  if (missing.length) throw new HttpError(503, `Production is not configured: ${missing.join("; ")}`, { code: "not_configured", missing });
  await assertIdle(project.id);
  return startJob(project, "produce");
}

export async function deleteProjectCompletely(project: ProjectRow) {
  await assertIdle(project.id);
  const { data } = await admin().from("assets").select("storage_path").eq("project_id", project.id);
  await removeObjects((data ?? []).map((a: { storage_path: string }) => a.storage_path));
  const { error } = await admin().from("projects").delete().eq("id", project.id);
  if (error) throw new HttpError(500, "Could not delete project");
}

export { providerStatus };
