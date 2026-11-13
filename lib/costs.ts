/** Pure, client-safe credit pricing and estimates (no server imports). */
import type { Stage } from "@/lib/pipeline/state";

/**
 * Configurable credit prices. Adjust to current provider pricing + margin before charging
 * real money. 1 credit is an abstract unit.
 */
export const COSTS = {
  researchQuick: 2,
  researchDetailed: 5,
  script: 3,
  characterImage: 4,
  sceneImage: 4,
  voice: 1,
  music: 5,
  videoPerSecond: 8,
  render: 3,
  /** Plan jobs can't know the character count up front; we reserve for this many. */
  assumedCharacters: 2,
} as const;

export function stepCost(
  stage: Stage,
  ctx: { researchMode?: string; sceneSeconds?: number } = {},
): number {
  switch (stage) {
    case "research": return ctx.researchMode === "detailed" ? COSTS.researchDetailed : COSTS.researchQuick;
    case "script": return COSTS.script;
    case "character_image": return COSTS.characterImage;
    case "scene_image": return COSTS.sceneImage;
    case "scene_voice": return COSTS.voice;
    case "music": return COSTS.music;
    case "scene_video": return Math.round((ctx.sceneSeconds ?? 5) * COSTS.videoPerSecond);
    case "render": return COSTS.render;
    default: return 0;
  }
}

export interface Estimate { credits: number; breakdown: { label: string; credits: number }[]; uncertain: boolean }

export function estimatePlan(o: { researchMode: string; hasResearch: boolean; script?: boolean }): Estimate {
  const withScript = o.script !== false;
  const breakdown = [
    ...(o.hasResearch ? [] : [{ label: "Research", credits: stepCost("research", { researchMode: o.researchMode }) }]),
    ...(withScript ? [{ label: "Script & storyboard", credits: COSTS.script }] : []),
    { label: `Character references (~${COSTS.assumedCharacters})`, credits: COSTS.assumedCharacters * COSTS.characterImage },
  ];
  return { credits: breakdown.reduce((a, b) => a + b.credits, 0), breakdown, uncertain: true };
}

export function estimateProduce(o: {
  videoEnabled: boolean;
  wantsMusic: boolean;
  hasMusic: boolean;
  scenes: { seconds: number; hasImage: boolean; hasVoice: boolean; hasVideo: boolean }[];
}): Estimate {
  const images = o.scenes.filter((s) => !s.hasImage).length;
  const voices = o.scenes.filter((s) => !s.hasVoice).length;
  const videoSeconds = o.videoEnabled ? o.scenes.filter((s) => !s.hasVideo).reduce((a, s) => a + s.seconds, 0) : 0;
  const breakdown = [
    { label: `Scene images ×${images}`, credits: images * COSTS.sceneImage },
    { label: `Voiceover ×${voices}`, credits: voices * COSTS.voice },
    { label: "Music", credits: o.wantsMusic && !o.hasMusic ? COSTS.music : 0 },
    { label: o.videoEnabled ? `AI video ${videoSeconds}s` : "Animated stills (no AI video provider)", credits: videoSeconds * COSTS.videoPerSecond },
    { label: "Render & export", credits: COSTS.render },
  ].filter((b) => b.credits > 0 || b.label.startsWith("Animated"));
  return { credits: breakdown.reduce((a, b) => a + b.credits, 0), breakdown, uncertain: o.videoEnabled };
}

