import { env, requireEnv } from "@/lib/env";
import {
  ProviderError,
  providerFetch,
  type VideoInput,
  type VideoProvider,
  type VideoTaskStatus,
} from "@/lib/providers/types";

const RATIOS = { "16:9": "1280:720", "9:16": "720:1280", "1:1": "960:960" } as const;
const API = "https://api.dev.runwayml.com/v1";
const VERSION = "2024-11-06";

const STATUS_MAP: Record<string, VideoTaskStatus> = {
  PENDING: "pending",
  THROTTLED: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/** Runway image-to-video. Provider tasks are asynchronous; task IDs are persisted by the pipeline. */
export class RunwayVideoProvider implements VideoProvider {
  readonly name = "runway";
  readonly allowedDurations = [5, 10] as const;

  private headers() {
    return {
      Authorization: `Bearer ${requireEnv("RUNWAY_API_KEY", "video generation")}`,
      "X-Runway-Version": VERSION,
      "Content-Type": "application/json",
    };
  }

  async generateVideo(input: VideoInput) {
    const res = await providerFetch(this.name, `${API}/image_to_video`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: env.runwayModel,
        promptImage: input.imageUrl,
        promptText: input.prompt.slice(0, 1000),
        ratio: RATIOS[input.aspectRatio],
        duration: input.duration,
      }),
    });
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new ProviderError("runway returned no task id", this.name, false);
    return { taskId: json.id, status: "pending" as VideoTaskStatus };
  }

  async getTaskStatus(taskId: string) {
    const res = await providerFetch(this.name, `${API}/tasks/${encodeURIComponent(taskId)}`, {
      headers: this.headers(),
    });
    const json = (await res.json()) as { status: string; output?: string[]; failure?: string };
    return {
      status: STATUS_MAP[json.status] ?? "running",
      videoUrl: json.output?.[0],
      error: json.failure,
    };
  }
}
