import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { researchToPromptText, researchTopic } from "@/lib/ai/research";
import { generateScript } from "@/lib/ai/script";
import { saveAsset, type AssetRow } from "@/lib/assets";
import { stepCost } from "@/lib/costs";
import { providers } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";
import { probeDurationSeconds } from "@/lib/rendering/ffmpeg";
import { renderVideo, sceneDuration, type RenderScene } from "@/lib/rendering/render";
import { downloadObject, removeObjects, signedUrl } from "@/lib/storage";
import { styleFor } from "@/lib/styles";
import { admin } from "@/lib/supabase/admin";
import type { ProjectBrief } from "@/lib/ai/prompts";
import type { CharacterRow, JobRow, ProjectRow, SceneRow, StepRow } from "@/lib/pipeline/types";

export class CancelledError extends Error {
  constructor() { super("Job cancelled"); this.name = "CancelledError"; }
}
/** Failures that retrying cannot fix (bad config, refused content, missing prerequisites). */
export class PermanentError extends Error {
  constructor(message: string) { super(message); this.name = "PermanentError"; }
}

export interface StageContext {
  step: StepRow;
  job: JobRow;
  project: ProjectRow;
  /** Extends the lease and throws CancelledError if the user cancelled. */
  heartbeat(): Promise<void>;
}
export interface StageResult { cost?: number; payload?: Record<string, unknown> }
type Executor = (ctx: StageContext) => Promise<StageResult | void>;

const db = () => admin();
const brief = (p: ProjectRow): ProjectBrief => p;

async function one<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await q;
  if (error || !data) throw new Error(`${what}: ${error?.message ?? "not found"}`);
  return data;
}

async function currentAsset(projectId: string, kind: string, sceneId?: string, characterId?: string): Promise<AssetRow | null> {
  let q = db().from("assets").select("*").eq("project_id", projectId).eq("kind", kind).eq("is_current", true);
  if (sceneId) q = q.eq("scene_id", sceneId);
  if (characterId) q = q.eq("character_id", characterId);
  const { data } = await q.order("version", { ascending: false }).limit(1);
  return (data?.[0] as AssetRow | undefined) ?? null;
}

/** Crash-safety: if this step already produced an asset (worker died before marking it done), reuse it. */
async function alreadyProduced(step: StepRow): Promise<AssetRow | null> {
  const { data } = await db().from("assets").select("*").eq("meta->>step_id", step.id).limit(1);
  return (data?.[0] as AssetRow | undefined) ?? null;
}

function describe(c: CharacterRow): string {
  const bits = [c.appearance, c.skin_tone && `skin tone: ${c.skin_tone}`, c.hairstyle && `hair: ${c.hairstyle}`,
    c.clothing && `wearing ${c.clothing}`, c.age_appearance && `appears ${c.age_appearance}`, c.accessories && `accessories: ${c.accessories}`];
  return `${c.name} (${bits.filter(Boolean).join("; ")})`;
}

async function resolveVoiceId(project: ProjectRow): Promise<string> {
  if (project.voice_profile_id) {
    const v = await one<{ provider_voice_id: string }>(db().from("voice_profiles").select("provider_voice_id").eq("id", project.voice_profile_id).single(), "voice profile");
    return v.provider_voice_id;
  }
  const { data } = await db().from("voice_profiles").select("provider_voice_id").eq("active", true).order("gender", { ascending: true }).limit(1);
  if (!data?.[0]) throw new PermanentError("No voice profiles are configured.");
  return (data[0] as { provider_voice_id: string }).provider_voice_id;
}

// ───────────────────────── stages ─────────────────────────

const research: Executor = async ({ project }) => {
  const result = await researchTopic(brief(project), project.research_mode);
  await db().from("research_results").insert({
    project_id: project.id, performed: result.performed, summary: result.summary,
    key_facts: result.key_facts, sources: result.sources,
  });
  return { payload: { performed: result.performed, sources: result.sources.length } };
};

const script: Executor = async ({ project }) => {
  const { data: r } = await db().from("research_results").select("*").eq("project_id", project.id).order("created_at", { ascending: false }).limit(1);
  const researchRow = r?.[0] as { performed: boolean; summary: string | null; key_facts: unknown } | undefined;
  const text = researchRow?.performed ? researchToPromptText(researchRow) : null;
  const out = await generateScript(brief(project), text);

  // Replace the previous storyboard. Remove orphaned media from storage first.
  const { data: old } = await db().from("assets").select("storage_path").eq("project_id", project.id).neq("kind", "export");
  await db().from("assets").delete().eq("project_id", project.id).neq("kind", "export");
  await removeObjects((old ?? []).map((a: { storage_path: string }) => a.storage_path));
  await db().from("scenes").delete().eq("project_id", project.id);
  await db().from("characters").delete().eq("project_id", project.id);

  const { data: prev } = await db().from("scripts").select("version").eq("project_id", project.id).order("version", { ascending: false }).limit(1);
  await db().from("scripts").insert({ project_id: project.id, version: (prev?.[0]?.version ?? 0) + 1, content: out });

  const idMap = new Map<string, string>();
  if (out.characters.length) {
    const rows = out.characters.map((c) => ({
      project_id: project.id, name: c.name, kind: c.kind, appearance: c.appearance, skin_tone: c.skin_tone ?? null,
      hairstyle: c.hairstyle ?? null, clothing: c.clothing ?? null, age_appearance: c.age_appearance ?? null,
      accessories: c.accessories ?? null, personality: c.personality ?? null,
    }));
    const { data, error } = await db().from("characters").insert(rows).select("id");
    if (error) throw new Error(`Could not save characters: ${error.message}`);
    out.characters.forEach((c, i) => idMap.set(c.id, (data as { id: string }[])[i].id));
  }
  const { error } = await db().from("scenes").insert(
    out.scenes.map((s, i) => ({
      project_id: project.id, scene_number: i + 1, title: s.title, narration: s.narration,
      visual_prompt: s.visual_description, camera_movement: s.camera_movement, transition: s.transition,
      music_mood: s.music_mood ?? project.music_mood, duration_seconds: s.duration_seconds,
      character_ids: s.character_ids.map((id) => idMap.get(id)).filter(Boolean),
    })),
  );
  if (error) throw new Error(`Could not save scenes: ${error.message}`);
  await db().from("projects").update({ title: out.title.slice(0, 200) }).eq("id", project.id);
  return { payload: { scenes: out.scenes.length, characters: out.characters.length } };
};

const characterImage: Executor = async ({ step, project }) => {
  if (await alreadyProduced(step)) return { cost: stepCost("character_image") };
  const c = await one(db().from("characters").select("*").eq("id", step.character_id!).single(), "character") as CharacterRow;
  const style = styleFor(project.video_style);
  const subject = c.kind === "character"
    ? `Character design reference sheet, full body, neutral pose, plain light background, front view. ${describe(c)}.`
    : `Reference illustration of ${describe(c)}, plain neutral background.`;
  const prompt = `${subject} ${style.promptSuffix}. No text, no logos, no watermark.`;
  const img = await providers.image().generateImage({ prompt, aspectRatio: "1:1" });
  await saveAsset({
    userId: project.user_id, projectId: project.id, kind: "character_reference", characterId: c.id,
    data: img.data, mimeType: img.mimeType, width: img.width, height: img.height,
    provider: providers.image().name, prompt, meta: { step_id: step.id },
  });
  return { cost: stepCost("character_image") };
};

const sceneImage: Executor = async ({ step, project }) => {
  if (await alreadyProduced(step)) return { cost: stepCost("scene_image") };
  const scene = await one(db().from("scenes").select("*").eq("id", step.scene_id!).single(), "scene") as SceneRow;
  const chars: CharacterRow[] = [];
  const references: { data: Buffer; mimeType: string }[] = [];
  if (scene.character_ids.length) {
    const { data } = await db().from("characters").select("*").in("id", scene.character_ids);
    for (const c of (data ?? []) as CharacterRow[]) {
      chars.push(c);
      const ref = await currentAsset(project.id, "character_reference", undefined, c.id);
      if (ref) references.push({ data: await downloadObject(ref.storage_path), mimeType: ref.mime_type });
    }
  }
  const style = styleFor(project.video_style);
  const prompt = [
    scene.visual_prompt,
    chars.length ? `Recurring characters (keep their design identical to the reference images): ${chars.map(describe).join(" | ")}.` : "",
    scene.camera_movement ? `Composition suited to camera move: ${scene.camera_movement}.` : "",
    style.promptSuffix,
    "No text, no logos, no watermark.",
  ].filter(Boolean).join(" ");
  const img = await providers.image().generateImage({ prompt, aspectRatio: project.aspect_ratio, references });
  await saveAsset({
    userId: project.user_id, projectId: project.id, kind: "scene_image", sceneId: scene.id,
    data: img.data, mimeType: img.mimeType, width: img.width, height: img.height,
    provider: providers.image().name, prompt, meta: { step_id: step.id, references: references.length },
  });
  return { cost: stepCost("scene_image") };
};

const sceneVoice: Executor = async ({ step, project }) => {
  if (await alreadyProduced(step)) return { cost: stepCost("scene_voice") };
  const scene = await one(db().from("scenes").select("*").eq("id", step.scene_id!).single(), "scene") as SceneRow;
  if (!scene.narration.trim()) throw new PermanentError(`Scene ${scene.scene_number} has no narration.`);
  const voiceId = await resolveVoiceId(project);
  const audio = await providers.voice().generateSpeech({
    text: scene.narration, voiceId, language: project.language, style: project.narration_style,
    speed: project.narration_style === "energetic" ? 1.05 : 1,
  });
  const tmp = path.join(os.tmpdir(), `avs-voice-${step.id}.mp3`);
  await fs.writeFile(tmp, audio.data);
  let seconds: number;
  try { seconds = await probeDurationSeconds(tmp); } finally { await fs.rm(tmp, { force: true }); }
  await saveAsset({
    userId: project.user_id, projectId: project.id, kind: "voice", sceneId: scene.id,
    data: audio.data, mimeType: audio.mimeType, durationMs: Math.round(seconds * 1000),
    provider: providers.voice().name, prompt: scene.narration, meta: { step_id: step.id, voice_id: voiceId },
  });
  return { cost: stepCost("scene_voice") };
};

const music: Executor = async ({ step, project }) => {
  if (await alreadyProduced(step)) return { cost: stepCost("music") };
  const { data } = await db().from("scenes").select("duration_seconds").eq("project_id", project.id);
  const total = (data ?? []).reduce((a: number, s: { duration_seconds: number }) => a + s.duration_seconds, 0);
  const prompt = `${project.music_mood} instrumental background music, no vocals, suitable under spoken narration, for a ${styleFor(project.video_style).label} video about ${project.topic}`;
  const audio = await providers.music().generateMusic({ prompt, durationSeconds: total + 4 });
  const tmp = path.join(os.tmpdir(), `avs-music-${step.id}.mp3`);
  await fs.writeFile(tmp, audio.data);
  let seconds: number;
  try { seconds = await probeDurationSeconds(tmp); } finally { await fs.rm(tmp, { force: true }); }
  await saveAsset({
    userId: project.user_id, projectId: project.id, kind: "music", data: audio.data, mimeType: audio.mimeType,
    durationMs: Math.round(seconds * 1000), provider: providers.music().name, prompt, meta: { step_id: step.id },
  });
  return { cost: stepCost("music") };
};

const sceneVideo: Executor = async ({ step, project, heartbeat }) => {
  const video = providers.video();
  const scene = await one(db().from("scenes").select("*").eq("id", step.scene_id!).single(), "scene") as SceneRow;
  const clipSeconds = video.allowedDurations.find((d) => d >= scene.duration_seconds) ?? video.allowedDurations.at(-1)!;
  const cost = stepCost("scene_video", { sceneSeconds: clipSeconds });
  if (await alreadyProduced(step)) return { cost };

  let taskId = step.provider_task_id;
  if (!taskId) {
    const image = await currentAsset(project.id, "scene_image", scene.id);
    if (!image) throw new PermanentError(`Scene ${scene.scene_number} has no image to animate.`);
    const style = styleFor(project.video_style);
    const created = await video.generateVideo({
      prompt: `${scene.visual_prompt}. Camera: ${scene.camera_movement ?? "gentle push-in"}. ${style.promptSuffix}`,
      imageUrl: await signedUrl(image.storage_path, 3600),
      duration: clipSeconds,
      aspectRatio: project.aspect_ratio,
    });
    taskId = created.taskId;
    // Persist immediately so a restarted worker resumes this task instead of paying for a new one.
    await db().from("job_steps").update({ provider_task_id: taskId }).eq("id", step.id);
  }

  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    await heartbeat();
    const st = await video.getTaskStatus(taskId);
    if (st.status === "succeeded" && st.videoUrl) {
      const res = await fetch(st.videoUrl, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new ProviderError(`Could not download clip (${res.status})`, video.name, true);
      const data = Buffer.from(await res.arrayBuffer());
      await saveAsset({
        userId: project.user_id, projectId: project.id, kind: "scene_video", sceneId: scene.id, data, mimeType: "video/mp4",
        durationMs: clipSeconds * 1000, provider: video.name, providerTaskId: taskId, meta: { step_id: step.id },
      });
      return { cost };
    }
    if (st.status === "failed" || st.status === "cancelled") {
      await db().from("job_steps").update({ provider_task_id: null }).eq("id", step.id); // retry submits fresh
      throw new ProviderError(`Video generation ${st.status}: ${st.error ?? "no detail"}`, video.name, st.status === "failed");
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new ProviderError("Video generation timed out", video.name, true);
};

const validate: Executor = async ({ project }) => {
  const { data: scenes } = await db().from("scenes").select("*").eq("project_id", project.id).order("scene_number");
  const list = (scenes ?? []) as SceneRow[];
  if (!list.length) throw new PermanentError("The project has no scenes.");
  const warnings: string[] = [];
  let total = 0;
  for (const s of list) {
    const voice = await currentAsset(project.id, "voice", s.id);
    const image = await currentAsset(project.id, "scene_image", s.id);
    if (!voice || !voice.bytes || !voice.duration_ms) throw new PermanentError(`Scene ${s.scene_number}: voiceover missing or empty.`);
    if (!image || !image.bytes) throw new PermanentError(`Scene ${s.scene_number}: image missing or empty.`);
    total += sceneDuration(s.duration_seconds, voice.duration_ms / 1000);
  }
  if (Math.abs(total - project.duration_seconds) / project.duration_seconds > 0.35) {
    warnings.push(`Assembled length ${total.toFixed(1)}s differs from the ${project.duration_seconds}s target by more than 35%.`);
  }
  return { payload: { total_seconds: total, warnings } };
};

const render: Executor = async ({ step, project, heartbeat }) => {
  const { data: scenes } = await db().from("scenes").select("*").eq("project_id", project.id).order("scene_number");
  const list = (scenes ?? []) as SceneRow[];
  const work = await fs.mkdtemp(path.join(os.tmpdir(), `avs-render-${project.id}-`));
  try {
    const fetchTo = async (asset: AssetRow, name: string) => {
      const file = path.join(work, name);
      await fs.writeFile(file, await downloadObject(asset.storage_path));
      return file;
    };
    const renderScenes: RenderScene[] = [];
    for (const s of list) {
      await heartbeat();
      const voice = (await currentAsset(project.id, "voice", s.id))!;
      const clip = await currentAsset(project.id, "scene_video", s.id);
      const image = (await currentAsset(project.id, "scene_image", s.id))!;
      renderScenes.push({
        visual: clip
          ? { kind: "video", path: await fetchTo(clip, `clip_${s.scene_number}.mp4`) }
          : { kind: "image", path: await fetchTo(image, `img_${s.scene_number}.${image.mime_type === "image/png" ? "png" : "jpg"}`) },
        voicePath: await fetchTo(voice, `voice_${s.scene_number}.mp3`),
        narration: s.narration, plannedSeconds: s.duration_seconds, transition: s.transition,
      });
    }
    const musicAsset = project.music_mood !== "none" ? await currentAsset(project.id, "music") : null;
    await heartbeat();
    const out = await renderVideo({
      workDir: path.join(work, "out"), scenes: renderScenes, musicPath: musicAsset ? await fetchTo(musicAsset, "music.mp3") : null,
      subtitles: project.subtitles, aspect: project.aspect_ratio, quality: project.output_quality, fps: project.fps,
    });
    const data = await fs.readFile(out.outputPath);
    const asset = await saveAsset({
      userId: project.user_id, projectId: project.id, kind: "export", data, mimeType: "video/mp4",
      durationMs: out.durationMs, width: out.width, height: out.height, provider: "ffmpeg", meta: { step_id: step.id, ...out.notes },
    });
    await db().from("exports").insert({
      project_id: project.id, asset_id: asset.id, duration_ms: out.durationMs, width: out.width,
      height: out.height, bytes: out.bytes, render_notes: out.notes,
    });
    return { cost: stepCost("render"), payload: { ...out.notes, duration_ms: out.durationMs } };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
};

export const EXECUTORS: Record<StepRow["stage"], Executor> = {
  research, script, character_image: characterImage, scene_image: sceneImage,
  scene_voice: sceneVoice, music, scene_video: sceneVideo, validate, render,
};
