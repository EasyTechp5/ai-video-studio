import { randomUUID } from "node:crypto";
import { admin } from "@/lib/supabase/admin";
import { EXT, uploadObject } from "@/lib/storage";

export type AssetKind = "character_reference" | "scene_image" | "scene_video" | "voice" | "music" | "export";

export interface AssetRow {
  id: string; project_id: string; scene_id: string | null; character_id: string | null;
  kind: AssetKind; storage_path: string; mime_type: string; bytes: number | null;
  duration_ms: number | null; width: number | null; height: number | null;
  provider: string | null; provider_task_id: string | null; version: number; is_current: boolean;
  meta: Record<string, unknown>;
}

/** Stores a generated file and registers it as the current version, keeping older versions for rollback. */
export async function saveAsset(a: {
  userId: string; projectId: string; kind: AssetKind; data: Buffer; mimeType: string;
  sceneId?: string; characterId?: string; durationMs?: number; width?: number; height?: number;
  provider?: string; providerTaskId?: string; prompt?: string; meta?: Record<string, unknown>;
}): Promise<AssetRow> {
  const db = admin();
  let q = db.from("assets").select("version").eq("project_id", a.projectId).eq("kind", a.kind);
  q = a.sceneId ? q.eq("scene_id", a.sceneId) : a.characterId ? q.eq("character_id", a.characterId) : q.is("scene_id", null).is("character_id", null);
  const { data: prev } = await q.order("version", { ascending: false }).limit(1);
  const version = (prev?.[0]?.version ?? 0) + 1;

  const id = randomUUID();
  const path = `${a.userId}/${a.projectId}/${a.kind}/${id}.${EXT[a.mimeType] ?? "bin"}`;
  await uploadObject(path, a.data, a.mimeType);

  // Retire older current versions of the same slot, then insert the new one.
  let retire = db.from("assets").update({ is_current: false }).eq("project_id", a.projectId).eq("kind", a.kind).eq("is_current", true);
  retire = a.sceneId ? retire.eq("scene_id", a.sceneId) : a.characterId ? retire.eq("character_id", a.characterId) : retire.is("scene_id", null).is("character_id", null);
  await retire;

  const { data, error } = await db.from("assets").insert({
    id, project_id: a.projectId, scene_id: a.sceneId ?? null, character_id: a.characterId ?? null,
    kind: a.kind, storage_path: path, mime_type: a.mimeType, bytes: a.data.length,
    duration_ms: a.durationMs ?? null, width: a.width ?? null, height: a.height ?? null,
    provider: a.provider ?? null, provider_task_id: a.providerTaskId ?? null,
    prompt: a.prompt ?? null, version, is_current: true, meta: a.meta ?? {},
  }).select("*").single();
  if (error) throw new Error(`Could not record asset: ${error.message}`);
  return data as AssetRow;
}

/** Marks current assets stale (kept for rollback, no longer used) so the next production run regenerates them. */
export async function invalidateAssets(projectId: string, filter: { sceneId?: string; characterId?: string; kinds: AssetKind[] }) {
  let q = admin().from("assets").update({ is_current: false }).eq("project_id", projectId).eq("is_current", true).in("kind", filter.kinds);
  if (filter.sceneId) q = q.eq("scene_id", filter.sceneId);
  if (filter.characterId) q = q.eq("character_id", filter.characterId);
  const { error } = await q;
  if (error) throw new Error(`Could not invalidate assets: ${error.message}`);
}
