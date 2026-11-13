import { generateStructured, generateText } from "@/lib/ai/claude";
import { scriptSystem, scriptUser, type ProjectBrief, WORDS_PER_SECOND } from "@/lib/ai/prompts";
import { scriptOutputSchema, sceneRewriteSchema, type ScriptOutput } from "@/types/schemas";
import { z } from "zod";

export class ContentRefusedError extends Error {
  constructor(reason: string) {
    super(`This request was declined by the content safety check: ${reason}`);
    this.name = "ContentRefusedError";
  }
}

/** Fits scene durations to the target, within tolerance. Pure and unit-tested. */
export function normalizeDurations<T extends { duration_seconds: number }>(scenes: T[], target: number): T[] {
  const sum = scenes.reduce((a, s) => a + s.duration_seconds, 0);
  if (sum === 0) return scenes;
  if (Math.abs(sum - target) / target <= 0.1) return scenes;
  const factor = target / sum;
  const scaled = scenes.map((s) => ({
    ...s,
    duration_seconds: Math.min(10, Math.max(3, Math.round(s.duration_seconds * factor))),
  }));
  return scaled;
}

/** Referenced character ids must exist; anything else is dropped rather than silently invented. */
export function sanitizeCharacterRefs(script: ScriptOutput): ScriptOutput {
  const known = new Set(script.characters.map((c) => c.id));
  return {
    ...script,
    scenes: script.scenes.map((s) => ({ ...s, character_ids: s.character_ids.filter((id) => known.has(id)) })),
  };
}

export async function generateScript(brief: ProjectBrief, researchText: string | null): Promise<ScriptOutput> {
  const out = await generateStructured({
    schema: scriptOutputSchema,
    toolName: "write_video_script",
    toolDescription: "Return the complete structured video script, storyboard scenes and character bible.",
    system: scriptSystem(),
    user: scriptUser(brief, researchText),
    maxTokens: 8000,
  });
  if (!out.content_safety.allowed) throw new ContentRefusedError(out.content_safety.reason ?? "not allowed");
  const cleaned = sanitizeCharacterRefs(out);
  return { ...cleaned, scenes: normalizeDurations(cleaned.scenes, brief.duration_seconds) };
}

export async function rewriteScene(
  brief: ProjectBrief,
  scene: { title: string | null; narration: string; visual_prompt: string; camera_movement: string | null; duration_seconds: number },
  instruction: string,
): Promise<z.infer<typeof sceneRewriteSchema>> {
  return generateStructured({
    schema: sceneRewriteSchema,
    toolName: "rewrite_scene",
    toolDescription: "Return the rewritten scene.",
    system: `You rewrite one scene of a video script. Keep the narration speakable in ${scene.duration_seconds}s at ~${WORDS_PER_SECOND} words/sec. Keep the visual style. Never request on-screen text.`,
    user: `${JSON.stringify({ topic: brief.topic, style: brief.video_style, language: brief.language })}\n\nCurrent scene:\n${JSON.stringify(scene)}\n\nInstruction: ${instruction}`,
    maxTokens: 1500,
  });
}

export async function adjustNarrationLength(narration: string, mode: "expand" | "shorten", language: string): Promise<string> {
  const text = await generateText({
    system: `Rewrite narration in ${language}. Return only the rewritten narration text, no quotes or commentary.`,
    user: `${mode === "expand" ? "Expand by about 30%" : "Shorten by about 30%"}, keeping the meaning and tone:\n\n${narration}`,
    maxTokens: 600,
  });
  return text.trim();
}
