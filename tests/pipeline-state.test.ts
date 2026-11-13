import { describe, expect, it } from "vitest";
import {
  assertTransition, backoffSeconds, canTransition, isJobComplete, nextSteps, stepKey,
  type PipelineState, type Stage, type Status,
} from "@/lib/pipeline/state";

const J = "job1";
function produceState(over: Partial<PipelineState> = {}): PipelineState {
  return {
    jobId: J, kind: "produce", runScript: true, videoEnabled: true, wantsMusic: true, hasResearch: true, hasMusic: false,
    scenes: [1, 2, 3].map((n) => ({ id: `s${n}`, hasImage: false, hasVoice: false, hasVideo: false })),
    characters: [], steps: [], ...over,
  };
}

/** Executes the planner like the worker would: complete every queued step, apply its asset, repeat. */
function simulate(state: PipelineState, mutate: (s: PipelineState, stage: Stage, key: string) => void) {
  const order: string[] = [];
  for (let i = 0; i < 50; i++) {
    const specs = nextSteps(state);
    state.steps.push(...specs.map((s) => ({ key: s.key, stage: s.stage, status: "queued" as Status })));
    const queued = state.steps.filter((s) => s.status === "queued");
    if (!queued.length) break;
    for (const st of queued) { st.status = "completed"; order.push(st.stage); mutate(state, st.stage, st.key); }
    if (isJobComplete(state)) break;
  }
  return order;
}
const applyAssets = (s: PipelineState, stage: Stage, key: string) => {
  const target = key.split(":")[2];
  const sc = s.scenes.find((x) => x.id === target);
  if (stage === "scene_image" && sc) sc.hasImage = true;
  if (stage === "scene_voice" && sc) sc.hasVoice = true;
  if (stage === "scene_video" && sc) sc.hasVideo = true;
  if (stage === "music") s.hasMusic = true;
  if (stage === "character_image") s.characters.find((c) => c.id === target)!.hasRef = true;
};

describe("state machine", () => {
  it("allows the documented transitions and rejects the rest", () => {
    expect(canTransition("queued", "processing")).toBe(true);
    expect(canTransition("processing", "retrying")).toBe(true);
    expect(canTransition("retrying", "processing")).toBe(true);
    expect(canTransition("completed", "processing")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(() => assertTransition("completed", "failed")).toThrow(/Invalid state transition/);
  });
  it("backs off exponentially with a cap", () => {
    expect([1, 2, 3].map(backoffSeconds)).toEqual([15, 30, 60]);
    expect(backoffSeconds(20)).toBe(300);
  });
});

describe("plan job", () => {
  it("runs research → script → character art, then finishes", () => {
    const s: PipelineState = { ...produceState(), kind: "plan", hasResearch: false, scenes: [], characters: [] };
    const order: string[] = [];
    // research
    expect(nextSteps(s).map((x) => x.stage)).toEqual(["research"]);
    s.steps.push({ key: stepKey(J, "research"), stage: "research", status: "completed" }); s.hasResearch = true; order.push("research");
    expect(nextSteps(s).map((x) => x.stage)).toEqual(["script"]);
    s.steps.push({ key: stepKey(J, "script"), stage: "script", status: "completed" });
    s.characters = [{ id: "c1", hasRef: false }, { id: "c2", hasRef: false }];
    expect(nextSteps(s).map((x) => x.key)).toEqual([stepKey(J, "character_image", "c1"), stepKey(J, "character_image", "c2")]);
    expect(isJobComplete(s)).toBe(false);
    s.steps.push(...nextSteps(s).map((x) => ({ key: x.key, stage: x.stage, status: "completed" as Status })));
    s.characters.forEach((c) => (c.hasRef = true));
    expect(isJobComplete(s)).toBe(true);
  });
  it("skips research when it already exists", () => {
    const s: PipelineState = { ...produceState(), kind: "plan", hasResearch: true, scenes: [] };
    expect(nextSteps(s).map((x) => x.stage)).toEqual(["script"]);
  });
  it("character-only job never rewrites the script", () => {
    const s: PipelineState = { ...produceState(), kind: "plan", runScript: false, characters: [{ id: "c1", hasRef: false }, { id: "c2", hasRef: true }] };
    expect(nextSteps(s).map((x) => x.stage)).toEqual(["character_image"]);
  });
  it("character-only job with nothing to do completes", () => {
    const s: PipelineState = { ...produceState(), kind: "plan", runScript: false, characters: [{ id: "c1", hasRef: true }] };
    expect(isJobComplete(s)).toBe(true);
  });
});

describe("produce job", () => {
  it("generates images+voices+music first, clips after images, validates, then renders last", () => {
    const order = simulate(produceState(), applyAssets);
    expect(order.at(-1)).toBe("render");
    expect(order.at(-2)).toBe("validate");
    expect(order.filter((x) => x === "scene_image")).toHaveLength(3);
    expect(order.filter((x) => x === "scene_voice")).toHaveLength(3);
    expect(order.filter((x) => x === "scene_video")).toHaveLength(3);
    expect(order.filter((x) => x === "music")).toHaveLength(1);
    expect(order.indexOf("scene_video")).toBeGreaterThan(order.indexOf("scene_image"));
  });
  it("animated-stills mode creates no clip steps", () => {
    const order = simulate(produceState({ videoEnabled: false }), applyAssets);
    expect(order).not.toContain("scene_video");
    expect(order.at(-1)).toBe("render");
  });
  it("no music step when mood is none", () => {
    const order = simulate(produceState({ wantsMusic: false }), applyAssets);
    expect(order).not.toContain("music");
  });
  it("does not redo completed scenes: only the invalidated asset is regenerated", () => {
    const s = produceState({
      hasMusic: true,
      scenes: [
        { id: "s1", hasImage: true, hasVoice: true, hasVideo: true },
        { id: "s2", hasImage: true, hasVoice: false, hasVideo: true }, // only voice was invalidated
        { id: "s3", hasImage: true, hasVoice: true, hasVideo: true },
      ],
    });
    const specs = nextSteps(s);
    expect(specs.map((x) => x.key)).toEqual([stepKey(J, "scene_voice", "s2")]);
    const order = simulate(s, applyAssets);
    expect(order).toEqual(["scene_voice", "validate", "render"]);
  });
  it("re-render with everything present goes straight to validate → render", () => {
    const s = produceState({ hasMusic: true, scenes: [{ id: "s1", hasImage: true, hasVoice: true, hasVideo: true }] });
    expect(simulate(s, applyAssets)).toEqual(["validate", "render"]);
  });
  it("is idempotent: planning twice never duplicates keys", () => {
    const s = produceState();
    const first = nextSteps(s);
    s.steps.push(...first.map((x) => ({ key: x.key, stage: x.stage, status: "queued" as Status })));
    expect(nextSteps(s)).toEqual([]);
  });
  it("is not complete until render has completed", () => {
    const s = produceState({ hasMusic: true, scenes: [{ id: "s1", hasImage: true, hasVoice: true, hasVideo: true }] });
    s.steps.push({ key: stepKey(J, "validate"), stage: "validate", status: "completed" });
    expect(isJobComplete(s)).toBe(false);
  });
});
