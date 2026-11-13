import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { outputSize, renderVideo, sceneDuration } from "@/lib/rendering/render";
import { chunkNarration } from "@/lib/rendering/subtitles";
import { probeVideo } from "@/lib/rendering/ffmpeg";

const hasFfmpeg = (() => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

describe("render helpers", () => {
  it("never cuts narration: scene lasts at least narration + tail", () => {
    expect(sceneDuration(5, 3)).toBe(5);
    expect(sceneDuration(5, 6.2)).toBe(6.7);
  });
  it("maps aspect and quality to even pixel sizes", () => {
    expect(outputSize("16:9", "1080p")).toEqual({ width: 1920, height: 1080 });
    expect(outputSize("9:16", "720p")).toEqual({ width: 720, height: 1280 });
    expect(outputSize("1:1", "1080p")).toEqual({ width: 1080, height: 1080 });
  });
  it("chunks narration into timed phrases inside the spoken window", () => {
    const chunks = chunkNarration("AI is changing classrooms. Tutors adapt to every student, one lesson at a time!", 6);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].start).toBeGreaterThanOrEqual(0);
    expect(chunks.at(-1)!.end).toBeLessThanOrEqual(6.01);
    chunks.forEach((c) => expect(c.text.split(" ").length).toBeLessThanOrEqual(8));
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].start).toBeGreaterThanOrEqual(chunks[i - 1].end - 0.01);
  });
});

describe.skipIf(!hasFfmpeg)("renderVideo (real FFmpeg, synthetic inputs)", () => {
  it("assembles stills + clip + narration + ducked music + subtitles into a valid MP4", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "avs-render-"));
    const png = async (name: string, color: string) => {
      const p = path.join(dir, name);
      await sharp({ create: { width: 1536, height: 1024, channels: 3, background: color } }).png().toFile(p);
      return p;
    };
    const tone = (name: string, secs: number, hz: number) => {
      const p = path.join(dir, name);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${secs}`, "-c:a", "libmp3lame", p]);
      return p;
    };
    const clip = path.join(dir, "clip.mp4");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24:duration=3", "-pix_fmt", "yuv420p", clip]);

    const result = await renderVideo({
      workDir: path.join(dir, "work"),
      subtitles: true,
      aspect: "16:9",
      quality: "720p",
      fps: 24,
      musicPath: tone("music.mp3", 4, 220),
      scenes: [
        { visual: { kind: "image", path: await png("a.png", "#264653") }, voicePath: tone("v1.mp3", 3, 440), narration: "Artificial intelligence is changing how students learn every day.", plannedSeconds: 4, transition: "fade" },
        { visual: { kind: "video", path: clip }, voicePath: tone("v2.mp3", 5.5, 330), narration: "Adaptive tutors meet every learner exactly where they are.", plannedSeconds: 5, transition: "cut" },
        { visual: { kind: "image", path: await png("b.png", "#e76f51") }, voicePath: tone("v3.mp3", 2, 550), narration: "The classroom of the future starts today.", plannedSeconds: 4, transition: "dissolve" },
      ],
    });

    const probe = await probeVideo(result.outputPath);
    expect(probe.width).toBe(1280);
    expect(probe.height).toBe(720);
    expect(probe.hasAudio).toBe(true);
    expect(result.notes.sceneSeconds).toEqual([4, 6, 4]); // scene 2 stretched to fit its 5.5s narration
    expect(probe.durationSeconds).toBeGreaterThan(13);
    expect(probe.durationSeconds).toBeLessThan(15.5);
    expect(result.bytes).toBeGreaterThan(10_000);
  }, 180_000);
});
