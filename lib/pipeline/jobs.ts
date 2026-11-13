import { providerStatus } from "@/lib/providers";
import { applyCredit, InsufficientCreditsError } from "@/lib/credits";
import { estimatePlan, estimateProduce, type Estimate } from "@/lib/costs";
import { admin } from "@/lib/supabase/admin";
import { isJobComplete, nextSteps, type PipelineState, type Stage } from "@/lib/pipeline/state";
import type { JobRow, ProjectRow, SceneRow } from "@/lib/pipeline/types";

export class JobAlreadyActiveError extends Error {
  constructor() { super("This project already has a job running."); this.name = "JobAlreadyActiveError"; }
}
export class SpendingLimitError extends Error {
  constructor(limit: number, needed: number) {
    super(`This run needs about ${needed} credits, above your per-run spending limit of ${limit}.`);
    this.name = "SpendingLimitError";
  }
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

/** Everything the planner needs, read fresh from the database. */
export async function loadState(jobId: string): Promise<{ state: PipelineState; job: JobRow; project: ProjectRow }> {
  const db = admin();
  const job = must(await db.from("generation_jobs").select("*").eq("id", jobId).single(), "load job") as JobRow;
  const project = must(await db.from("projects").select("*").eq("id", job.project_id).single(), "load project") as ProjectRow;
  const [scenes, characters, assets, steps, research] = await Promise.all([
    db.from("scenes").select("id").eq("project_id", project.id).order("scene_number"),
    db.from("characters").select("id").eq("project_id", project.id),
    db.from("assets").select("scene_id,character_id,kind").eq("project_id", project.id).eq("is_current", true),
    db.from("job_steps").select("idempotency_key,stage,status").eq("job_id", jobId),
    db.from("research_results").select("id").eq("project_id", project.id).limit(1),
  ]);
  const a = must(assets, "load assets") as { scene_id: string | null; character_id: string | null; kind: string }[];
  const has = (kind: string, sceneId?: string, characterId?: string) =>
    a.some((x) => x.kind === kind && (sceneId ? x.scene_id === sceneId : characterId ? x.character_id === characterId : true));

  const state: PipelineState = {
    jobId,
    kind: job.kind,
    runScript: (job.options?.script ?? true) !== false,
    videoEnabled: providerStatus().video,
    wantsMusic: project.music_mood !== "none",
    hasResearch: (must(research, "load research") as unknown[]).length > 0,
    scenes: (must(scenes, "load scenes") as { id: string }[]).map((s) => ({
      id: s.id,
      hasImage: has("scene_image", s.id),
      hasVoice: has("voice", s.id),
      hasVideo: has("scene_video", s.id),
    })),
    characters: (must(characters, "load characters") as { id: string }[]).map((c) => ({
      id: c.id,
      hasRef: has("character_reference", undefined, c.id),
    })),
    hasMusic: has("music"),
    steps: (must(steps, "load steps") as { idempotency_key: string; stage: Stage; status: PipelineState["steps"][number]["status"] }[]).map(
      (s) => ({ key: s.idempotency_key, stage: s.stage, status: s.status }),
    ),
  };
  return { state, job, project };
}

/** Estimate for what a job of this kind would still need to do. */
export async function estimateFor(projectId: string, kind: "plan" | "produce", options: { script?: boolean } = {}): Promise<Estimate> {
  const db = admin();
  const project = must(await db.from("projects").select("*").eq("id", projectId).single(), "load project") as ProjectRow;
  if (kind === "plan") {
    const r = must(await db.from("research_results").select("id").eq("project_id", projectId).limit(1), "research") as unknown[];
    return estimatePlan({ researchMode: project.research_mode, hasResearch: r.length > 0, script: options.script !== false });
  }
  const [scenes, assets] = await Promise.all([
    db.from("scenes").select("id,duration_seconds").eq("project_id", projectId),
    db.from("assets").select("scene_id,kind").eq("project_id", projectId).eq("is_current", true),
  ]);
  const a = must(assets, "assets") as { scene_id: string | null; kind: string }[];
  const has = (k: string, id?: string) => a.some((x) => x.kind === k && (id ? x.scene_id === id : true));
  return estimateProduce({
    videoEnabled: providerStatus().video,
    wantsMusic: project.music_mood !== "none",
    hasMusic: has("music"),
    scenes: (must(scenes, "scenes") as Pick<SceneRow, "id" | "duration_seconds">[]).map((s) => ({
      seconds: s.duration_seconds < 8 ? 5 : 10,
      hasImage: has("scene_image", s.id), hasVoice: has("voice", s.id), hasVideo: has("scene_video", s.id),
    })),
  });
}

/** Creates a job, reserves credits (idempotently), flips project status and enqueues the first steps. */
export async function startJob(project: ProjectRow, kind: "plan" | "produce", options: { script?: boolean } = {}): Promise<JobRow> {
  const db = admin();
  const estimate = await estimateFor(project.id, kind, options);

  const profile = must(await db.from("profiles").select("spending_limit").eq("id", project.user_id).single(), "profile") as { spending_limit: number | null };
  if (profile.spending_limit != null && estimate.credits > profile.spending_limit) {
    throw new SpendingLimitError(profile.spending_limit, estimate.credits);
  }

  const ins = await db.from("generation_jobs").insert({ project_id: project.id, user_id: project.user_id, kind, status: "queued", options }).select("*").single();
  if (ins.error) {
    if (ins.error.code === "23505") throw new JobAlreadyActiveError();
    throw new Error(`Could not create job: ${ins.error.message}`);
  }
  const job = ins.data as JobRow;

  try {
    await applyCredit({
      userId: project.user_id, amount: -estimate.credits, kind: "reserve", key: `reserve:${job.id}`,
      projectId: project.id, jobId: job.id, note: `Reserved for ${kind} job`,
    });
  } catch (e) {
    await db.from("generation_jobs").delete().eq("id", job.id);
    throw e;
  }
  await db.from("generation_jobs").update({ reserved_credits: estimate.credits }).eq("id", job.id);
  await db.from("projects").update({ status: kind === "plan" ? "planning" : "producing", error: null }).eq("id", project.id);
  await db.from("audit_events").insert({ user_id: project.user_id, project_id: project.id, event: `job.${kind}.started`, detail: { job_id: job.id, reserved: estimate.credits } });

  await advance(job.id);
  return { ...job, reserved_credits: estimate.credits };
}

/** Enqueue whatever is now runnable; finish the job when nothing remains. Safe to call concurrently. */
export async function advance(jobId: string): Promise<void> {
  const db = admin();
  const { state, job } = await loadState(jobId);
  if (job.cancel_requested || ["completed", "failed", "cancelled"].includes(job.status)) return;

  const specs = nextSteps(state);
  if (specs.length) {
    const { error } = await db.from("job_steps").upsert(
      specs.map((s) => ({
        job_id: jobId, project_id: job.project_id, stage: s.stage, scene_id: s.scene_id ?? null,
        character_id: s.character_id ?? null, idempotency_key: s.key, status: "queued", max_attempts: 3,
      })),
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    );
    if (error) throw new Error(`Could not enqueue steps: ${error.message}`);
    return;
  }
  if (isJobComplete(state)) await finalizeJob(jobId, "completed");
}

/** Moves the job to a terminal state exactly once, settles credits, and updates the project. */
export async function finalizeJob(jobId: string, status: "completed" | "failed" | "cancelled", error?: string): Promise<void> {
  const db = admin();
  const { data: updated } = await db.from("generation_jobs")
    .update({ status, error: error ?? null, finished_at: new Date().toISOString() })
    .eq("id", jobId).in("status", ["pending", "queued", "processing", "retrying"]).select("*");
  const job = (updated?.[0] ?? null) as JobRow | null;
  if (!job) return; // another worker already finalized it

  await settleCredits(job);

  if (status !== "completed") {
    await db.from("job_steps").update({ status: "cancelled", locked_at: null, locked_by: null })
      .eq("job_id", jobId).in("status", ["pending", "queued", "retrying"]);
  }
  const projectStatus = status === "completed" ? (job.kind === "plan" ? "review" : "completed")
    : status === "cancelled" ? "cancelled" : "failed";
  await db.from("projects").update({ status: projectStatus, error: status === "failed" ? error ?? "Job failed" : null }).eq("id", job.project_id);
  if (status === "completed" && job.kind === "produce") {
    await db.from("scenes").update({ status: "completed" }).eq("project_id", job.project_id);
  }
  await db.from("audit_events").insert({ user_id: job.user_id, project_id: job.project_id, event: `job.${job.kind}.${status}`, detail: { job_id: jobId, error } });
}

/** Refund whatever was reserved but not consumed by completed steps. Idempotent per job. */
async function settleCredits(job: JobRow): Promise<void> {
  const db = admin();
  const { data } = await db.from("job_steps").select("cost_credits").eq("job_id", job.id).eq("status", "completed");
  const spent = Math.min(job.reserved_credits, (data ?? []).reduce((a, r: { cost_credits: number }) => a + r.cost_credits, 0));
  const refund = job.reserved_credits - spent;
  if (refund > 0) {
    await applyCredit({
      userId: job.user_id, amount: refund, kind: "refund", key: `refund:${job.id}`,
      projectId: job.project_id, jobId: job.id, note: `Unused reservation (${spent} credits consumed)`,
    });
  }
  await db.from("generation_jobs").update({ settled: true }).eq("id", job.id);
}

export async function failJob(jobId: string, message: string): Promise<void> {
  await finalizeJob(jobId, "failed", message);
}

export async function cancelJob(jobId: string): Promise<void> {
  const db = admin();
  await db.from("generation_jobs").update({ cancel_requested: true }).eq("id", jobId);
  await finalizeJob(jobId, "cancelled");
}

export { InsufficientCreditsError };
