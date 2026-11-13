import { z } from "zod";
import { handle, HttpError, ok, ownedProject, parseBody, requireUser } from "@/lib/api/helpers";
import { assertIdle, deleteProjectCompletely } from "@/lib/api/project-ops";
import { signedUrls } from "@/lib/storage";
import { admin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

/** One round-trip workspace payload: everything the project page renders. */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  const project = await ownedProject(id, user.id);
  const db = admin();
  const [research, scripts, scenes, characters, assets, jobs, exportsRes] = await Promise.all([
    db.from("research_results").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(1),
    db.from("scripts").select("id,version,approved,approved_at,content,created_at").eq("project_id", id).order("version", { ascending: false }).limit(1),
    db.from("scenes").select("*").eq("project_id", id).order("scene_number"),
    db.from("characters").select("*").eq("project_id", id).order("created_at"),
    db.from("assets").select("id,scene_id,character_id,kind,mime_type,bytes,duration_ms,width,height,provider,version,created_at,storage_path").eq("project_id", id).eq("is_current", true),
    db.from("generation_jobs").select("*, job_steps(id,stage,status,scene_id,character_id,attempts,max_attempts,error,cost_credits,completed_at)").eq("project_id", id).order("created_at", { ascending: false }).limit(3),
    db.from("exports").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(5),
  ]);
  // Preview URLs are only signed on request (?urls=1); the client caches them while polling.
  type A = { id: string; kind: string; storage_path: string; url?: string };
  const assetRows = (assets.data ?? []) as A[];
  if (new URL(req.url).searchParams.get("urls") === "1") {
    const previewable = assetRows.filter((a) => ["scene_image", "character_reference", "voice", "scene_video"].includes(a.kind));
    const signed = await signedUrls(previewable.map((a) => a.storage_path), 3000);
    for (const a of previewable) a.url = signed[a.storage_path];
  }
  const safeAssets = assetRows.map(({ storage_path: _p, ...rest }) => rest);
  return ok({
    project, research: research.data?.[0] ?? null, script: scripts.data?.[0] ?? null,
    scenes: scenes.data ?? [], characters: characters.data ?? [], assets: safeAssets,
    jobs: jobs.data ?? [], exports: exportsRes.data ?? [],
  });
});

const patchSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  await ownedProject(id, user.id);
  const body = await parseBody(req, patchSchema);
  const { error } = await admin().from("projects").update({ title: body.title }).eq("id", id);
  if (error) throw new HttpError(500, "Could not update project");
  return ok({ ok: true });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  const project = await ownedProject(id, user.id);
  await assertIdle(id);
  await deleteProjectCompletely(project);
  return ok({ ok: true });
});
