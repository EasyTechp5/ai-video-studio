import { z } from "zod";

export const VIDEO_STYLES = [
  "3d_cartoon",
  "photorealistic",
  "anime",
  "documentary",
  "motion_graphics",
  "storybook",
  "cinematic",
] as const;
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export const NARRATION_STYLES = ["professional", "conversational", "storytelling", "energetic"] as const;
export const MUSIC_MOODS = ["cinematic", "inspirational", "calm", "suspenseful", "none"] as const;
export const AUDIENCES = ["children", "students", "professionals", "general audience"] as const;
export const TRANSITIONS = ["cut", "fade", "dissolve"] as const;

/** Durations offered in the UI. Only those <= MAX_DURATION_SECONDS are selectable. */
export const DURATION_OPTIONS = [5, 10, 30, 60, 120, 300, 600, 1200] as const;

export const projectInputSchema = z.object({
  topic: z.string().trim().min(3, "Topic is required").max(200),
  description: z.string().trim().max(4000).optional().default(""),
  video_style: z.enum(VIDEO_STYLES),
  duration_seconds: z.number().int().positive(),
  aspect_ratio: z.enum(ASPECT_RATIOS).default("16:9"),
  target_audience: z.string().trim().min(2).max(80).default("general audience"),
  language: z.string().trim().min(2).max(12).default("en"),
  voice_profile_id: z.string().uuid().nullable().optional(),
  narration_style: z.enum(NARRATION_STYLES).default("professional"),
  music_mood: z.enum(MUSIC_MOODS).default("inspirational"),
  subtitles: z.boolean().default(true),
  research_mode: z.enum(["quick", "detailed"]).default("quick"),
  output_quality: z.enum(["720p", "1080p"]).default("1080p"),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

// ───────── Claude structured outputs ─────────

export const researchOutputSchema = z.object({
  summary: z.string().min(20),
  key_facts: z
    .array(z.object({ fact: z.string(), source_urls: z.array(z.string()) }))
    .min(1),
  creative_notes: z.string().describe("Interpretation/angle that is NOT a sourced fact"),
});
export type ResearchOutput = z.infer<typeof researchOutputSchema>;

export const characterDraftSchema = z.object({
  id: z.string().describe("Short stable key used by scenes, e.g. 'c1'"),
  name: z.string(),
  kind: z.enum(["character", "environment", "object"]).default("character"),
  appearance: z.string(),
  skin_tone: z.string().optional(),
  hairstyle: z.string().optional(),
  clothing: z.string().optional(),
  age_appearance: z.string().optional(),
  accessories: z.string().optional(),
  personality: z.string().optional(),
});

export const sceneDraftSchema = z.object({
  scene_number: z.number().int().positive(),
  title: z.string(),
  duration_seconds: z.number().int().positive(),
  narration: z.string().min(1),
  visual_description: z.string().min(1),
  camera_movement: z.string(),
  character_ids: z.array(z.string()).default([]),
  transition: z.enum(TRANSITIONS).default("fade"),
  music_mood: z.string().optional(),
});
export type SceneDraft = z.infer<typeof sceneDraftSchema>;

export const scriptOutputSchema = z.object({
  content_safety: z.object({
    allowed: z.boolean(),
    reason: z.string().optional(),
  }),
  title: z.string(),
  description: z.string(),
  hook: z.string(),
  introduction: z.string(),
  closing_statement: z.string(),
  call_to_action: z.string().optional(),
  characters: z.array(characterDraftSchema).default([]),
  scenes: z.array(sceneDraftSchema).min(1),
});
export type ScriptOutput = z.infer<typeof scriptOutputSchema>;

export const sceneRewriteSchema = z.object({
  title: z.string(),
  narration: z.string().min(1),
  visual_description: z.string().min(1),
  camera_movement: z.string(),
});

export const sceneEditSchema = z
  .object({
    title: z.string().max(200).optional(),
    narration: z.string().min(1).max(2000).optional(),
    visual_prompt: z.string().min(1).max(2000).optional(),
    camera_movement: z.string().max(200).optional(),
    transition: z.enum(TRANSITIONS).optional(),
    duration_seconds: z.number().int().min(2).max(15).optional(),
  })
  .strict();

export type Quality = "720p" | "1080p";
