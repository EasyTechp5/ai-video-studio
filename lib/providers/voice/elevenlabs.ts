import { requireEnv } from "@/lib/env";
import { providerFetch, type AudioResult, type VoiceInput, type VoiceProvider } from "@/lib/providers/types";

/** ElevenLabs text-to-speech, generated scene by scene. */
export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly name = "elevenlabs-voice";

  async generateSpeech(input: VoiceInput): Promise<AudioResult> {
    const key = requireEnv("ELEVENLABS_API_KEY", "voice generation");
    const res = await providerFetch(
      this.name,
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text: input.text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: input.style === "energetic" ? 0.35 : input.style === "storytelling" ? 0.45 : 0.6,
            similarity_boost: 0.75,
            style: input.style === "energetic" ? 0.5 : 0.15,
            speed: Math.min(1.2, Math.max(0.7, input.speed ?? 1)),
          },
        }),
      },
    );
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: "audio/mpeg" };
  }
}
