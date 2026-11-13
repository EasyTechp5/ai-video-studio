import { spawn } from "node:child_process";
import { env } from "@/lib/env";

export class FfmpegError extends Error {
  constructor(message: string, public readonly stderr: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-8000)));
    p.on("error", (e) => reject(new FfmpegError(`Could not start ${bin}: ${e.message}. Is FFmpeg installed?`, stderr)));
    p.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new FfmpegError(`${bin} exited with code ${code}`, stderr)),
    );
  });
}

export const ffmpeg = (args: string[]) => run(env.ffmpeg, ["-hide_banner", "-y", "-loglevel", "error", ...args]);

export async function probeDurationSeconds(file: string): Promise<number> {
  const { stdout } = await run(env.ffprobe, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new FfmpegError(`Could not read duration of ${file}`, stdout);
  return d;
}

export async function probeVideo(file: string): Promise<{ width: number; height: number; durationSeconds: number; hasAudio: boolean }> {
  const { stdout } = await run(env.ffprobe, [
    "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file,
  ]);
  const j = JSON.parse(stdout) as { streams: { codec_type: string; width?: number; height?: number }[]; format: { duration: string } };
  const v = j.streams.find((s) => s.codec_type === "video");
  if (!v?.width || !v?.height) throw new FfmpegError(`No video stream in ${file}`, stdout);
  return {
    width: v.width,
    height: v.height,
    durationSeconds: parseFloat(j.format.duration),
    hasAudio: j.streams.some((s) => s.codec_type === "audio"),
  };
}
