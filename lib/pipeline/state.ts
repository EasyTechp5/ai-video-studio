/** Pure pipeline logic: state machine and the step planner. No I/O, fully unit-tested. */

export type Status = "pending" | "queued" | "processing" | "completed" | "failed" | "retrying" | "cancelled";
export type Stage =
  | "research" | "script" | "character_image" | "scene_image"
  | "scene_voice" | "music" | "scene_video" | "validate" | "render";

const TRANSITIONS: Record<Status, Status[]> = {
  pending: ["queued", "cancelled"],
  queued: ["processing", "cancelled"],
  processing: ["completed", "failed", "retrying", "cancelled"],
  retrying: ["processing", "failed", "cancelled"],
  failed: ["queued"], // explicit manual retry only
  completed: [],
  cancelled: [],
};

export function canTransition(from: Status, to: Status): boolean {
  return from === to ? false : TRANSITIONS[from].includes(to);
}
export function assertTransition(from: Status, to: Status): void {
  if (!canTransition(from, to)) throw new Error(`Invalid state transition ${from} → ${to}`);
}
export const isTerminal = (s: Status) => s === "completed" || s === "failed" || s === "cancelled";

export interface PipelineState {
  jobId: string;
  kind: "plan" | "produce";
  /** Plan jobs only: false when just (re)generating character art without rewriting the script. */
  runScript: boolean;
  /** True when a video provider is configured; otherwise stills are animated at render time. */
  videoEnabled: boolean;
  wantsMusic: boolean;
  hasResearch: boolean;
  scenes: { id: string; hasImage: boolean; hasVoice: boolean; hasVideo: boolean }[];
  characters: { id: string; hasRef: boolean }[];
  hasMusic: boolean;
  steps: { key: string; stage: Stage; status: Status }[];
}

export interface StepSpec {
  key: string;
  stage: Stage;
  scene_id?: string;
  character_id?: string;
}

export const stepKey = (jobId: string, stage: Stage, targetId?: string) =>
  `${jobId}:${stage}${targetId ? `:${targetId}` : ""}`;

/** Steps that should be enqueued now, given what exists. Idempotent: never repeats a key. */
export function nextSteps(s: PipelineState): StepSpec[] {
  const have = new Map(s.steps.map((x) => [x.key, x]));
  const out: StepSpec[] = [];
  const add = (spec: StepSpec) => { if (!have.has(spec.key)) out.push(spec); };
  const completed = (key: string) => have.get(key)?.status === "completed";

  if (s.kind === "plan") {
    const research = stepKey(s.jobId, "research");
    const script = stepKey(s.jobId, "script");
    if (!s.hasResearch) add({ key: research, stage: "research" });
    if (s.runScript && (s.hasResearch || completed(research))) add({ key: script, stage: "script" });
    if (!s.runScript || completed(script)) {
      for (const c of s.characters.filter((c) => !c.hasRef)) {
        add({ key: stepKey(s.jobId, "character_image", c.id), stage: "character_image", character_id: c.id });
      }
    }
    return out;
  }

  for (const sc of s.scenes) {
    if (!sc.hasImage) add({ key: stepKey(s.jobId, "scene_image", sc.id), stage: "scene_image", scene_id: sc.id });
    if (!sc.hasVoice) add({ key: stepKey(s.jobId, "scene_voice", sc.id), stage: "scene_voice", scene_id: sc.id });
  }
  if (s.wantsMusic && !s.hasMusic) add({ key: stepKey(s.jobId, "music"), stage: "music" });
  if (s.videoEnabled) {
    for (const sc of s.scenes.filter((x) => x.hasImage && !x.hasVideo)) {
      add({ key: stepKey(s.jobId, "scene_video", sc.id), stage: "scene_video", scene_id: sc.id });
    }
  }

  const ready =
    s.scenes.length > 0 &&
    s.scenes.every((x) => x.hasImage && x.hasVoice && (!s.videoEnabled || x.hasVideo)) &&
    (!s.wantsMusic || s.hasMusic);
  const validate = stepKey(s.jobId, "validate");
  const render = stepKey(s.jobId, "render");
  if (ready) add({ key: validate, stage: "validate" });
  if (completed(validate)) add({ key: render, stage: "render" });
  return out;
}

/** The job is finished when nothing new is plannable and every step completed. */
export function isJobComplete(s: PipelineState): boolean {
  if (s.steps.length === 0) return s.kind === "plan" && !s.runScript && nextSteps(s).length === 0;
  if (nextSteps(s).length > 0) return false;
  if (!s.steps.every((x) => x.status === "completed")) return false;
  if (s.kind === "produce") return s.steps.some((x) => x.stage === "render" && x.status === "completed");
  return s.runScript ? s.steps.some((x) => x.stage === "script" && x.status === "completed") : true;
}

/** Exponential backoff with a cap, seconds. */
export function backoffSeconds(attempt: number): number {
  return Math.min(300, 15 * 2 ** Math.max(0, attempt - 1));
}
