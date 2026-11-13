import { env } from "@/lib/env";
import { admin } from "@/lib/supabase/admin";

const bucket = () => admin().storage.from(env.bucket);

export async function uploadObject(path: string, data: Buffer | Uint8Array, contentType: string): Promise<void> {
  const { error } = await bucket().upload(path, data, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed (${path}): ${error.message}`);
}

export async function downloadObject(path: string): Promise<Buffer> {
  const { data, error } = await bucket().download(path);
  if (error || !data) throw new Error(`Storage download failed (${path}): ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Time-limited URL. Default 1 hour; downloads use shorter. */
export async function signedUrl(path: string, seconds = 3600, download?: string): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(path, seconds, download ? { download } : undefined);
  if (error || !data) throw new Error(`Could not sign URL (${path}): ${error?.message}`);
  return data.signedUrl;
}

/** Batch-sign many objects in one request. Returns path → URL. */
export async function signedUrls(paths: string[], seconds = 3600): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await bucket().createSignedUrls(paths, seconds);
  if (error) throw new Error(`Could not sign URLs: ${error.message}`);
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
  return out;
}

export async function removeObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await bucket().remove(paths);
  if (error) console.error("[storage] remove failed", error.message);
}

export const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "audio/mpeg": "mp3", "video/mp4": "mp4",
};
