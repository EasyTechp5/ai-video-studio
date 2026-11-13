import { env, requireEnv } from "@/lib/env";
import { ProviderError, providerFetch, type ImageInput, type ImageProvider, type ImageResult } from "@/lib/providers/types";

const SIZES = { "16:9": "1536x1024", "9:16": "1024x1536", "1:1": "1024x1024" } as const;
const DIMS = { "16:9": [1536, 1024], "9:16": [1024, 1536], "1:1": [1024, 1024] } as const;

/** OpenAI Images API (gpt-image-1). Uses /edits when approved reference images are supplied. */
export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai-image";

  async generateImage(input: ImageInput): Promise<ImageResult> {
    const key = requireEnv("OPENAI_API_KEY", "image generation");
    const size = SIZES[input.aspectRatio];
    let res: Response;

    if (input.references?.length) {
      const form = new FormData();
      form.set("model", env.imageModel);
      form.set("prompt", input.prompt);
      form.set("size", size);
      form.set("n", "1");
      input.references.slice(0, 4).forEach((ref, i) => {
        form.append("image[]", new Blob([new Uint8Array(ref.data)], { type: ref.mimeType }), `ref${i}.png`);
      });
      res = await providerFetch(this.name, "https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        timeoutMs: 240_000,
      });
    } else {
      res = await providerFetch(this.name, "https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env.imageModel, prompt: input.prompt, size, n: 1 }),
        timeoutMs: 240_000,
      });
    }

    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("openai-image returned no image data", this.name, false);
    const [width, height] = DIMS[input.aspectRatio];
    return { data: Buffer.from(b64, "base64"), mimeType: "image/png", width, height };
  }
}
