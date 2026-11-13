import { requireEnv } from "@/lib/env";
import { providerFetch, type AudioResult, type MusicInput, type MusicProvider } from "@/lib/providers/types";

/**
 * ElevenLabs Music (generated, royalty-cleared per ElevenLabs terms — confirm the licence for
 * your plan before commercial use). Endpoint/params follow the public docs; verify against
 * your account since this API is newer than text-to-speech.
 */
export class ElevenLabsMusicProvider implements MusicProvider {
  readonly name = "elevenlabs-music";

  async generateMusic(input: MusicInput): Promise<AudioResult> {
    const key = requireEnv("ELEVENLABS_API_KEY", "music generation");
    const lengthMs = Math.min(300_000, Math.max(10_000, Math.round(input.durationSeconds * 1000)));
    const res = await providerFetch(this.name, "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: input.prompt, music_length_ms: lengthMs }),
      timeoutMs: 300_000,
    });
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: "audio/mpeg" };
  }
}
