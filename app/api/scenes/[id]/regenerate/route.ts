import { z } from "zod";
import { adjustNarrationLength, rewriteScene } from "@/lib/ai/script";
import { invalidateAssets } from "@/lib/assets";
import { handle, HttpError, ok, ownedProject, ownedScene, parseBody, rateLimit, requireUser } from "@/lib/api/helpers";
import { assertIdle, startProduction } from "@/lib/api/project-ops";
import { providerStatus } from "@/lib/providers";
import { admin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({
  target: z.enum(["rewrite", "expand", "shorten", "image", "voice", "video"]),
  instruction: z.string().trim().max(500).optional(),
  /** Required for media targets, which spend credits. */
  confirm: z.boolean().default(false),
});

/**
 * Scoped regeneration. Text targets (rewrite/expand/shorten) call Claude and invalidate only the
 * media they affect. Media targets invalidate one asset and start a production job, which — because
 * the planner only generates what is missing — redoes just that scene and re-renders.
 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  rateLimit(`regen:${user.id}`, 30, 60_000);
  const { target, instruction, confirm } = await parseBody(req, body);
  const scene = await ownedScene(id, user.id);
  const project = await ownedProject(scene.project_id, user.id);
  await assertIdle(project.id);

  if (target === "rewrite" || target === "expand" || target === "shorten") {
    if (!providerStatus().anthropic) throw new HttpError(503, "ANTHROPIC_API_KEY is not configured.", { code: "not_configured" });
    if (target === "rewrite") {
      const out = await rewriteScene(project, scene, instruction || "Improve clarity and engagement while keeping the meaning.");
      await admin().from("scenes").update({ title: out.title, narration: out.narration, visual_prompt: out.visual_description, camera_movement: out.camera_movement }).eq("id", id);
      await invalidateAssets(project.id, { sceneId: id, kinds: ["voice", "scene_image", "scene_video"] });
    } else {
      const narration = await adjustNarrationLength(scene.narration, target, project.language);
      await admin().from("scenes").update({ narration }).eq("id", id);
      await invalidateAssets(project.id, { sceneId: id, kinds: ["voice"] });
    }
    await admin().from("scripts").update({ approved: false, approved_at: null }).eq("project_id", project.id);
    return ok({ ok: true });
  }

  const kinds = target === "image" ? (["scene_image", "scene_video"] as const) : target === "voice" ? (["voice"] as const) : (["scene_video"] as const);
  if (!confirm) throw new HttpError(400, "Confirm the credit cost to regenerate this scene.", { code: "confirmation_required" });
  await invalidateAssets(project.id, { sceneId: id, kinds: [...kinds] });
  const job = await startProduction(project, true);
  return ok({ job }, 202);
});
