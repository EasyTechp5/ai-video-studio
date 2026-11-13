"use client";
import clsx from "clsx";
import type { Job } from "@/components/video/types";

const STAGES = [
  ["research", "Research", "plan"], ["script", "Script", "plan"], ["character_image", "Characters", "plan"],
  ["scene_image", "Images", "produce"], ["scene_voice", "Voiceover", "produce"], ["music", "Music", "produce"],
  ["scene_video", "Clips", "produce"], ["validate", "Validate", "produce"], ["render", "Render & export", "produce"],
] as const;

type State = "idle" | "queued" | "active" | "done" | "failed";

/** Real status derived from job steps. There is deliberately no percentage bar. */
export function PipelineStrip({ jobs, animatedStills }: { jobs: Job[]; animatedStills: boolean }) {
  const latest = (kind: Job["kind"]) => jobs.find((j) => j.kind === kind);
  return (
    <ol aria-label="Production stages" className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-5 xl:grid-cols-9">
      {STAGES.map(([stage, label, kind]) => {
        const steps = (latest(kind)?.job_steps ?? []).filter((s) => s.stage === stage);
        const done = steps.filter((s) => s.status === "completed").length;
        let state: State = "idle";
        if (steps.length) {
          if (steps.some((s) => s.status === "failed")) state = "failed";
          else if (done === steps.length) state = "done";
          else if (steps.some((s) => ["processing", "retrying"].includes(s.status))) state = "active";
          else state = "queued";
        }
        const retrying = steps.find((s) => s.status === "retrying");
        const skipped = stage === "scene_video" && animatedStills && state === "idle";
        return (
          <li key={stage} className="bg-surface p-3.5" aria-label={`${label}: ${skipped ? "animated stills" : state}`}>
            <div className="flex items-center gap-2 text-xs">
              <span className={clsx("size-2 rounded-full",
                state === "done" && "bg-ok", state === "active" && "pulse-dot bg-accent", state === "failed" && "bg-danger",
                state === "queued" && "bg-warn/70", state === "idle" && "bg-line")} />
              <span className="text-muted">{skipped ? "stills" : state}</span>
            </div>
            <p className="mt-3 text-sm">{label}</p>
            <p className="mt-0.5 h-4 font-mono text-xs text-muted">
              {steps.length > 1 ? `${done}/${steps.length}` : ""}{retrying ? ` retry ${retrying.attempts}/${retrying.max_attempts}` : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
