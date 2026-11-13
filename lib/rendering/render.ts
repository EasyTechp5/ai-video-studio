import fs from "node:fs/promises";
import path from "node:path";
import { ffmpeg, probeDurationSeconds, probeVideo } from "@/lib/rendering/ffmpeg";
import { chunkNarration, renderSubtitlePng } from "@/lib/rendering/subtitles";

export type Aspect = "16:9" | "9:16" | "1:1";
export type Quality = "720p" | "1080p";

export function outputSize(aspect: Aspect, quality: Quality): { width: number; height: number } {
  const long = quality === "1080p" ? 1920 : 1280;
  const short = quality === "1080p" ? 1080 : 720;
  if (aspect === "16:9") return { width: long, height: short };
  if (aspect === "9:16") return { width: short, height: long };
  return { width: short, height: short };
}

export interface RenderScene {
  /** Either an AI-generated clip or a still to animate. */
  visual: { kind: "video" | "image"; path: string };
  voicePath: string;
  narration: string;
  plannedSeconds: number;
  transition: "cut" | "fade" | "dissolve";
}

export interface RenderInput {
  workDir: string;
  scenes: RenderScene[];
  musicPath?: string | null;
  subtitles: boolean;
  aspect: Aspect;
  quality: Quality;
  fps: number;
}

export interface RenderResult {
  outputPath: string;
  durationMs: number;
  width: number;
  height: number;
  bytes: number;
  notes: { sceneSeconds: number[]; animatedStills: number; aiClips: number; music: boolean; subtitles: boolean };
}

/** A scene lasts at least as long as its narration (+ tail) so speech is never clipped. */
export function sceneDuration(plannedSeconds: number, narrationSeconds: number): number {
  return Math.round(Math.max(plannedSeconds, narrationSeconds + 0.5) * 10) / 10;
}

const FADE = 0.25;

async function renderSegment(
  scene: RenderScene,
  index: number,
  seconds: number,
  narrationSeconds: number,
  o: { workDir: string; width: number; height: number; fps: number; subtitles: boolean },
): Promise<string> {
  const { width: W, height: H, fps } = o;
  const out = path.join(o.workDir, `seg_${String(index).padStart(2, "0")}.mp4`);
  const args: string[] = [];
  const filters: string[] = [];

  // 0: visual
  if (scene.visual.kind === "image") {
    args.push("-i", scene.visual.path);
    const frames = Math.ceil(seconds * fps);
    const zoomIn = index % 2 === 0;
    const z = zoomIn ? "min(zoom+0.0006,1.15)" : "if(eq(on,0),1.15,max(zoom-0.0006,1.0))";
    filters.push(
      `[0:v]scale=${Math.round(W * 1.5)}:${Math.round(H * 1.5)}:force_original_aspect_ratio=increase,` +
        `crop=${Math.round(W * 1.5)}:${Math.round(H * 1.5)},` +
        `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},setsar=1[v0]`,
    );
  } else {
    args.push("-i", scene.visual.path);
    filters.push(
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1,` +
        `tpad=stop_mode=clone:stop_duration=${seconds},trim=duration=${seconds},setpts=PTS-STARTPTS[v0]`,
    );
  }

  // 1: narration
  args.push("-i", scene.voicePath);

  // Subtitle overlays
  let last = "v0";
  if (o.subtitles && scene.narration.trim()) {
    const chunks = chunkNarration(scene.narration, narrationSeconds);
    for (let c = 0; c < chunks.length; c++) {
      const { png, width: sw, height: sh } = await renderSubtitlePng(chunks[c].text, W, H);
      const file = path.join(o.workDir, `sub_${index}_${c}.png`);
      await fs.writeFile(file, png);
      args.push("-i", file);
      const input = 2 + c;
      const next = `v_s${c}`;
      const y = Math.round(H - sh - H * 0.07);
      filters.push(
        `[${last}][${input}:v]overlay=x=${Math.round((W - sw) / 2)}:y=${y}:enable='between(t,${chunks[c].start},${chunks[c].end})'[${next}]`,
      );
      last = next;
    }
  }

  const fade = scene.transition !== "cut" ? `,fade=t=in:st=0:d=${FADE},fade=t=out:st=${Math.max(0, seconds - FADE).toFixed(2)}:d=${FADE}` : "";
  filters.push(`[${last}]format=yuv420p${fade}[vout]`);
  filters.push(`[1:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=${seconds},atrim=0:${seconds},asetpts=PTS-STARTPTS[aout]`);

  await ffmpeg([
    ...args,
    "-filter_complex", filters.filter(Boolean).join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-t", String(seconds),
    "-r", String(fps),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
    out,
  ]);
  return out;
}

export async function renderVideo(input: RenderInput): Promise<RenderResult> {
  const { width, height } = outputSize(input.aspect, input.quality);
  await fs.mkdir(input.workDir, { recursive: true });

  const segments: string[] = [];
  const sceneSeconds: number[] = [];
  for (let i = 0; i < input.scenes.length; i++) {
    const s = input.scenes[i];
    const narration = await probeDurationSeconds(s.voicePath);
    const seconds = sceneDuration(s.plannedSeconds, narration);
    sceneSeconds.push(seconds);
    segments.push(
      await renderSegment(s, i, seconds, narration, {
        workDir: input.workDir, width, height, fps: input.fps, subtitles: input.subtitles,
      }),
    );
  }

  const list = path.join(input.workDir, "concat.txt");
  await fs.writeFile(list, segments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const joined = path.join(input.workDir, "joined.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);

  const total = sceneSeconds.reduce((a, b) => a + b, 0);
  const final = path.join(input.workDir, "final.mp4");

  if (input.musicPath) {
    // Music loops/trims to the video, sits under narration, and ducks while someone is speaking.
    await ffmpeg([
      "-i", joined,
      "-stream_loop", "-1", "-i", input.musicPath,
      "-filter_complex",
      `[0:a]asplit=2[nar][key];` +
        `[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.55,atrim=0:${total},asetpts=PTS-STARTPTS,` +
        `afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[m];` +
        `[m][key]sidechaincompress=threshold=0.04:ratio=9:attack=15:release=450[duck];` +
        `[nar][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(total),
      "-movflags", "+faststart", final,
    ]);
  } else {
    await ffmpeg(["-i", joined, "-c", "copy", "-movflags", "+faststart", final]);
  }

  const probe = await probeVideo(final);
  const stat = await fs.stat(final);
  if (probe.width !== width || probe.height !== height || !probe.hasAudio || probe.durationSeconds < total * 0.9) {
    throw new Error(
      `Rendered file failed validation (got ${probe.width}x${probe.height}, ${probe.durationSeconds.toFixed(1)}s, audio=${probe.hasAudio})`,
    );
  }
  return {
    outputPath: final,
    durationMs: Math.round(probe.durationSeconds * 1000),
    width,
    height,
    bytes: stat.size,
    notes: {
      sceneSeconds,
      animatedStills: input.scenes.filter((s) => s.visual.kind === "image").length,
      aiClips: input.scenes.filter((s) => s.visual.kind === "video").length,
      music: !!input.musicPath,
      subtitles: input.subtitles,
    },
  };
}
