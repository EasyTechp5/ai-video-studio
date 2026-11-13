import { z } from "zod";
import { invalidateAssets } from "@/lib/assets";
import { handle, HttpError, ok, ownedCharacter, ownedProject, parseBody, requireUser } from "@/lib/api/helpers";
import { assertIdle } from "@/lib/api/project-ops";
import { startJob } from "@/lib/pipeline/jobs";
import { admin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Regenerates one character's reference design. Scenes that use the character are listed and
 * their images/clips are only invalidated after the user confirms (no silent identity swaps).
 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  const { character_id, confirm } = await parseBody(req, z.object({ character_id: z.string().uuid(), confirm: z.boolean().default(false) }));
  const project = await ownedProject(id, user.id);
  const character = await ownedCharacter(character_id, user.id);
  if (character.project_id !== id) throw new HttpError(404, "Character not found");
  await assertIdle(id);

  const { data: dependents } = await admin().from("scenes").select("id,scene_number,title").eq("project_id", id).contains("character_ids", [character_id]);
  const { count } = dependents?.length
    ? await admin().from("assets").select("id", { count: "exact", head: true }).eq("project_id", id).eq("is_current", true).in("scene_id", dependents.map((d: { id: string }) => d.id)).in("kind", ["scene_image", "scene_video"])
    : { count: 0 };
  if (!confirm && (count ?? 0) > 0) {
    throw new HttpError(409, "Scenes already generated with this character will be regenerated.", { code: "confirmation_required", dependent_scenes: dependents });
  }

  await invalidateAssets(id, { characterId: character_id, kinds: ["character_reference"] });
  for (const s of dependents ?? []) await invalidateAssets(id, { sceneId: (s as { id: string }).id, kinds: ["scene_image", "scene_video"] });
  await admin().from("characters").update({ approved: false }).eq("id", character_id);
  await admin().from("scripts").update({ approved: false, approved_at: null }).eq("project_id", id);
  const job = await startJob(project, "plan", { script: false });
  return ok({ job }, 202);
});
