export interface Asset { id: string; scene_id: string | null; character_id: string | null; kind: string; mime_type: string; bytes: number | null; duration_ms: number | null; width: number | null; height: number | null; provider: string | null; version: number; url?: string }
export interface Step { id: string; stage: string; status: string; scene_id: string | null; character_id: string | null; attempts: number; max_attempts: number; error: string | null; cost_credits: number }
export interface Job { id: string; kind: "plan" | "produce"; status: string; error: string | null; reserved_credits: number; created_at: string; job_steps: Step[] }
export interface Scene { id: string; scene_number: number; title: string | null; narration: string; visual_prompt: string; camera_movement: string | null; transition: string; duration_seconds: number; character_ids: string[]; status: string }
export interface Character { id: string; name: string; kind: string; appearance: string; skin_tone: string | null; hairstyle: string | null; clothing: string | null; age_appearance: string | null; accessories: string | null; personality: string | null; approved: boolean }
export interface Source { title: string; url: string; domain: string; retrieved_at: string; excerpt?: string }
export interface Research { performed: boolean; summary: string | null; key_facts: { fact: string; source_urls: string[] }[]; sources: Source[] }
export interface ExportRow { id: string; duration_ms: number | null; width: number | null; height: number | null; bytes: number | null; created_at: string; render_notes: { animatedStills?: number; aiClips?: number; music?: boolean; subtitles?: boolean } }
export interface Project { id: string; title: string; topic: string; status: string; error: string | null; video_style: string; duration_seconds: number; aspect_ratio: string; music_mood: string; subtitles: boolean }
export interface Bundle {
  project: Project; research: Research | null; script: { id: string; version: number; approved: boolean } | null;
  scenes: Scene[]; characters: Character[]; assets: Asset[]; jobs: Job[]; exports: ExportRow[];
}
export interface EstimateResp {
  estimate: { credits: number; breakdown: { label: string; credits: number }[]; uncertain: boolean };
  balance: number; spending_limit: number | null; missing: string[]; providers: { video: boolean };
}
