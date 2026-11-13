export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    /** Transient failures (429/5xx/network) are retried; permanent ones fail the step. */
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ImageInput {
  prompt: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
  /** Approved reference images (character sheets) to condition on, where supported. */
  references?: { data: Buffer; mimeType: string }[];
}
export interface ImageResult { data: Buffer; mimeType: string; width?: number; height?: number }
export interface ImageProvider {
  readonly name: string;
  generateImage(input: ImageInput): Promise<ImageResult>;
}

export interface VoiceInput {
  text: string;
  voiceId: string;
  language: string;
  style: string;
  speed?: number;
}
export interface AudioResult { data: Buffer; mimeType: string }
export interface VoiceProvider {
  readonly name: string;
  generateSpeech(input: VoiceInput): Promise<AudioResult>;
}

export interface MusicInput { prompt: string; durationSeconds: number }
export interface MusicProvider {
  readonly name: string;
  generateMusic(input: MusicInput): Promise<AudioResult>;
}

export interface VideoInput {
  prompt: string;
  imageUrl: string;
  duration: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
}
export type VideoTaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export interface VideoProvider {
  readonly name: string;
  /** Provider-allowed clip lengths; the pipeline snaps each scene to the nearest. */
  readonly allowedDurations: readonly number[];
  generateVideo(input: VideoInput): Promise<{ taskId: string; status: VideoTaskStatus }>;
  getTaskStatus(taskId: string): Promise<{ status: VideoTaskStatus; videoUrl?: string; error?: string }>;
}

/** fetch wrapper that classifies failures as retryable/permanent. */
export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 120_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new ProviderError(`${provider} request failed: ${(e as Error).message}`, provider, true);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 500);
    const retryable = res.status === 429 || res.status >= 500 || res.status === 408;
    throw new ProviderError(`${provider} responded ${res.status}: ${body}`, provider, retryable, res.status);
  }
  return res;
}
