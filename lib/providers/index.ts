import { env } from "@/lib/env";
import { OpenAIImageProvider } from "@/lib/providers/image/openai";
import { ElevenLabsMusicProvider } from "@/lib/providers/music/elevenlabs";
import type { ImageProvider, MusicProvider, VideoProvider, VoiceProvider } from "@/lib/providers/types";
import { RunwayVideoProvider } from "@/lib/providers/video/runway";
import { ElevenLabsVoiceProvider } from "@/lib/providers/voice/elevenlabs";

export const providers = {
  image: (): ImageProvider => new OpenAIImageProvider(),
  voice: (): VoiceProvider => new ElevenLabsVoiceProvider(),
  music: (): MusicProvider => new ElevenLabsMusicProvider(),
  video: (): VideoProvider => new RunwayVideoProvider(),
};

export interface ProviderStatus {
  anthropic: boolean;
  image: boolean;
  voice: boolean;
  music: boolean;
  /** When false the renderer animates still images instead of AI video clips. */
  video: boolean;
}

export function providerStatus(): ProviderStatus {
  return {
    anthropic: !!env.anthropicKey,
    image: !!env.openaiKey,
    voice: !!env.elevenKey,
    music: !!env.elevenKey,
    video: !!env.runwayKey,
  };
}

/** What blocks production for these settings. Empty array = ready. */
export function missingForProduction(opts: { music: boolean }): string[] {
  const s = providerStatus();
  const missing: string[] = [];
  if (!s.anthropic) missing.push("ANTHROPIC_API_KEY (Claude)");
  if (!s.image) missing.push("OPENAI_API_KEY (image generation)");
  if (!s.voice) missing.push("ELEVENLABS_API_KEY (voiceover)");
  if (opts.music && !s.music) missing.push("ELEVENLABS_API_KEY (music)");
  return missing;
}
