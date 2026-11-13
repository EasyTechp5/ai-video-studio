import { invalidateAssets } from "@/lib/assets";
import { handle, HttpError, ok, ownedProject, ownedScene, parseBody, requireUser } from "@/lib/api/helpers";
import { assertIdle } from "@/lib/api/project-ops";
import { admin } from "@/lib/supabase/admin";
import { sceneEditSchema } from "@/types/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** Edit a scene. Changing narration invalidates its voiceover; changing visuals invalidates image + clip. */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  const scene = await ownedScene(id, user.id);
  await ownedProject(scene.project_id, user.id);
  await assertIdle(scene.project_id);
  const patch = await parseBody(req, sceneEditSchema);
  if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to update");

  const { error } = await admin().from("scenes").update(patch).eq("id", id);
  if (error) throw new HttpError(500, "Could not update scene");

  const kinds: ("voice" | "scene_image" | "scene_video")[] = [];
  if (patch.narration !== undefined && patch.narration !== scene.narration) kinds.push("voice");
  if (patch.visual_prompt !== undefined && patch.visual_prompt !== scene.visual_prompt) kinds.push("scene_image", "scene_video");
  if (kinds.length) await invalidateAssets(scene.project_id, { sceneId: id, kinds });
  // Content changed: the previous approval no longer covers what will be produced.
  await admin().from("scripts").update({ approved: false, approved_at: null }).eq("project_id", scene.project_id);
  return ok({ ok: true, invalidated: kinds });
});
