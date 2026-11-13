import { describe, expect, it } from "vitest";
import { COSTS, estimatePlan, estimateProduce, stepCost } from "@/lib/costs";
import { normalizeDurations, sanitizeCharacterRefs } from "@/lib/ai/script";
import { targetSceneCount } from "@/lib/ai/prompts";
import { isRetryable } from "@/lib/pipeline/runner";
import { MissingConfigError } from "@/lib/env";
import { ProviderError } from "@/lib/providers/types";
import { PermanentError } from "@/lib/pipeline/stages";
import { ContentRefusedError } from "@/lib/ai/script";
import { projectInputSchema, scriptOutputSchema, sceneEditSchema } from "@/types/schemas";

describe("credits", () => {
  it("prices video per second, snapped clip length", () => {
    expect(stepCost("scene_video", { sceneSeconds: 5 })).toBe(5 * COSTS.videoPerSecond);
    expect(stepCost("research", { researchMode: "detailed" })).toBe(COSTS.researchDetailed);
  });
  it("only estimates the work that is still missing", () => {
    const full = estimateProduce({ videoEnabled: false, wantsMusic: true, hasMusic: false, scenes: [1, 2, 3].map(() => ({ seconds: 5, hasImage: false, hasVoice: false, hasVideo: false })) });
    const partial = estimateProduce({ videoEnabled: false, wantsMusic: true, hasMusic: true, scenes: [1, 2, 3].map(() => ({ seconds: 5, hasImage: true, hasVoice: true, hasVideo: false })) });
    expect(full.credits).toBe(3 * COSTS.sceneImage + 3 * COSTS.voice + COSTS.music + COSTS.render);
    expect(partial.credits).toBe(COSTS.render);
  });
  it("plan estimate omits research when it exists and the script for character-only runs", () => {
    expect(estimatePlan({ researchMode: "quick", hasResearch: true }).credits).toBeLessThan(estimatePlan({ researchMode: "quick", hasResearch: false }).credits);
    expect(estimatePlan({ researchMode: "quick", hasResearch: true, script: false }).breakdown.some((b) => b.label.startsWith("Script"))).toBe(false);
  });
});

describe("script post-processing", () => {
  it("rescales scene durations that miss the target by more than 10%", () => {
    const out = normalizeDurations([{ duration_seconds: 5 }, { duration_seconds: 5 }, { duration_seconds: 5 }], 30);
    expect(out.reduce((a, s) => a + s.duration_seconds, 0)).toBe(30);
  });
  it("leaves durations alone when within tolerance", () => {
    const scenes = [{ duration_seconds: 10 }, { duration_seconds: 10 }, { duration_seconds: 9 }];
    expect(normalizeDurations(scenes, 30)).toBe(scenes);
  });
  it("drops references to characters that were never defined", () => {
    const script = scriptOutputSchema.parse({
      content_safety: { allowed: true }, title: "t", description: "d", hook: "h", introduction: "i", closing_statement: "c",
      characters: [{ id: "c1", name: "Ada", appearance: "tall" }],
      scenes: [{ scene_number: 1, title: "a", duration_seconds: 5, narration: "n", visual_description: "v", camera_movement: "pan", character_ids: ["c1", "ghost"] }],
    });
    expect(sanitizeCharacterRefs(script).scenes[0].character_ids).toEqual(["c1"]);
  });
  it("plans 3–6 scenes", () => {
    expect([5, 30, 60, 600].map(targetSceneCount)).toEqual([3, 3, 6, 6]);
  });
});

describe("validation", () => {
  it("rejects bad project input and defaults the rest", () => {
    expect(projectInputSchema.safeParse({ topic: "x", video_style: "cinematic", duration_seconds: 30 }).success).toBe(false);
    const ok = projectInputSchema.parse({ topic: "Solar power", video_style: "cinematic", duration_seconds: 30 });
    expect(ok.aspect_ratio).toBe("16:9");
    expect(ok.subtitles).toBe(true);
  });
  it("rejects unknown fields and bad values in scene edits", () => {
    expect(sceneEditSchema.safeParse({ status: "completed" }).success).toBe(false);
    expect(sceneEditSchema.safeParse({ duration_seconds: 99 }).success).toBe(false);
    expect(sceneEditSchema.safeParse({ narration: "Hello" }).success).toBe(true);
  });
});

describe("failure classification", () => {
  it("retries transient provider failures, not permanent ones", () => {
    expect(isRetryable(new ProviderError("429", "x", true, 429))).toBe(true);
    expect(isRetryable(new ProviderError("400", "x", false, 400))).toBe(false);
  });
  it("never retries config errors, refusals or permanent errors", () => {
    expect(isRetryable(new MissingConfigError(["K"], "p"))).toBe(false);
    expect(isRetryable(new ContentRefusedError("no"))).toBe(false);
    expect(isRetryable(new PermanentError("no voice"))).toBe(false);
  });
  it("retries unknown/network errors", () => {
    expect(isRetryable(new Error("socket hang up"))).toBe(true);
  });
});
