import type { Stage, Status } from "@/lib/pipeline/state";

export interface ProjectRow {
  id: string; user_id: string; title: string; topic: string; description: string | null;
  video_style: string; duration_seconds: number; aspect_ratio: "16:9" | "9:16" | "1:1";
  target_audience: string; language: string; voice_profile_id: string | null;
  narration_style: string; music_mood: string; subtitles: boolean;
  research_mode: "quick" | "detailed"; output_quality: "720p" | "1080p"; fps: number;
  status: string; error: string | null;
}
export interface SceneRow {
  id: string; project_id: string; scene_number: number; title: string | null; narration: string;
  visual_prompt: string; camera_movement: string | null; transition: "cut" | "fade" | "dissolve";
  music_mood: string | null; character_ids: string[]; duration_seconds: number; status: string;
}
export interface CharacterRow {
  id: string; project_id: string; name: string; kind: string; appearance: string;
  skin_tone: string | null; hairstyle: string | null; clothing: string | null;
  age_appearance: string | null; accessories: string | null; personality: string | null;
  approved: boolean;
}
export interface JobRow {
  id: string; project_id: string; user_id: string; kind: "plan" | "produce"; status: Status;
  reserved_credits: number; settled: boolean; cancel_requested: boolean; options: { script?: boolean }; error: string | null;
}
export interface StepRow {
  id: string; job_id: string; project_id: string; scene_id: string | null; character_id: string | null;
  stage: Stage; status: Status; attempts: number; max_attempts: number;
  provider_task_id: string | null; idempotency_key: string; payload: Record<string, unknown>;
}
