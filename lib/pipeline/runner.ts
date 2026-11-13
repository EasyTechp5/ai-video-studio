import Anthropic from "@anthropic-ai/sdk";
import { AiOutputError } from "@/lib/ai/claude";
import { ContentRefusedError } from "@/lib/ai/script";
import { MissingConfigError } from "@/lib/env";
import { ProviderError } from "@/lib/providers/types";
import { FfmpegError } from "@/lib/rendering/ffmpeg";
import { admin } from "@/lib/supabase/admin";
import { advance, failJob } from "@/lib/pipeline/jobs";
import { backoffSeconds } from "@/lib/pipeline/state";
import { CancelledError, EXECUTORS, PermanentError, type StageContext } from "@/lib/pipeline/stages";
import type { JobRow, ProjectRow, StepRow } from "@/lib/pipeline/types";

export function isRetryable(e: unknown): boolean {
  if (e instanceof MissingConfigError || e instanceof ContentRefusedError || e instanceof PermanentError || e instanceof FfmpegError) return false;
  if (e instanceof ProviderError) return e.retryable;
  if (e instanceof Anthropic.APIError) return !e.status || e.status === 429 || e.status >= 500 || e.status === 408;
  if (e instanceof AiOutputError) return true; // LLM output can differ on the next attempt
  return true; // network / transient infrastructure
}

function message(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 1000);
}

/** Runs one leased step to completion, recording honest status, retrying transient failures. */
export async function processStep(step: StepRow, workerId: string): Promise<void> {
  const db = admin();
  const { data: job } = await db.from("generation_jobs").select("*").eq("id", step.job_id).single();
  const jobRow = job as JobRow | null;

  if (!jobRow || jobRow.cancel_requested || ["completed", "failed", "cancelled"].includes(jobRow.status)) {
    await db.from("job_steps").update({ status: "cancelled", locked_at: null, locked_by: null }).eq("id", step.id);
    return;
  }
  if (step.attempts > step.max_attempts) {
    await db.from("job_steps").update({ status: "failed", error: "Exceeded maximum attempts (worker restarted repeatedly)", locked_at: null, locked_by: null }).eq("id", step.id);
    await failJob(jobRow.id, `${step.stage} exceeded its retry budget`);
    return;
  }
  if (jobRow.status === "queued" || jobRow.status === "retrying") {
    await db.from("generation_jobs").update({ status: "processing" }).eq("id", jobRow.id).in("status", ["queued", "retrying"]);
  }
  const project = (await db.from("projects").select("*").eq("id", step.project_id).single()).data as ProjectRow;
  if (step.scene_id) await db.from("scenes").update({ status: "processing" }).eq("id", step.scene_id);

  const ctx: StageContext = {
    step, job: jobRow, project,
    async heartbeat() {
      await db.from("job_steps").update({ locked_at: new Date().toISOString(), locked_by: workerId }).eq("id", step.id);
      const { data } = await db.from("generation_jobs").select("cancel_requested").eq("id", jobRow.id).single();
      if ((data as { cancel_requested: boolean } | null)?.cancel_requested) throw new CancelledError();
    },
  };

  const t0 = Date.now();
  try {
    const result = (await EXECUTORS[step.stage](ctx)) ?? {};
    await db.from("job_steps").update({
      status: "completed", completed_at: new Date().toISOString(), error: null, cost_credits: result.cost ?? 0,
      payload: { ...step.payload, ...(result.payload ?? {}) }, locked_at: null, locked_by: null,
    }).eq("id", step.id);
    console.log(`[worker] ${step.stage} ok (${Date.now() - t0}ms) step=${step.id}`);
    await advance(jobRow.id);
  } catch (e) {
    if (e instanceof CancelledError) {
      await db.from("job_steps").update({ status: "cancelled", locked_at: null, locked_by: null }).eq("id", step.id);
      return;
    }
    const msg = message(e);
    console.error(`[worker] ${step.stage} failed (attempt ${step.attempts}/${step.max_attempts}): ${msg}`);
    if (isRetryable(e) && step.attempts < step.max_attempts) {
      await db.from("job_steps").update({
        status: "retrying", error: msg, locked_at: null, locked_by: null,
        run_after: new Date(Date.now() + backoffSeconds(step.attempts) * 1000).toISOString(),
      }).eq("id", step.id);
      await db.from("generation_jobs").update({ status: "retrying" }).eq("id", jobRow.id).eq("status", "processing");
      return;
    }
    await db.from("job_steps").update({ status: "failed", error: msg, locked_at: null, locked_by: null }).eq("id", step.id);
    if (step.scene_id) await db.from("scenes").update({ status: "failed" }).eq("id", step.scene_id);
    await failJob(jobRow.id, `${step.stage.replace("_", " ")} failed: ${msg}`);
  }
}
