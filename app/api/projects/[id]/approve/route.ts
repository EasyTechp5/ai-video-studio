import { handle, HttpError, ok, ownedProject, requireUser } from "@/lib/api/helpers";
import { assertIdle } from "@/lib/api/project-ops";
import { admin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

/** Human approval gate: nothing expensive runs until the script and character designs are approved. */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  await ownedProject(id, user.id);
  await assertIdle(id);
  const db = admin();
  const [{ data: script }, { data: scenes }, { data: chars }, { data: refs }] = await Promise.all([
    db.from("scripts").select("id").eq("project_id", id).order("version", { ascending: false }).limit(1),
    db.from("scenes").select("id,narration").eq("project_id", id),
    db.from("characters").select("id,name").eq("project_id", id),
    db.from("assets").select("character_id").eq("project_id", id).eq("kind", "character_reference").eq("is_current", true),
  ]);
  if (!script?.[0] || !scenes?.length) throw new HttpError(409, "There is no script to approve yet.");
  if (scenes.some((s: { narration: string }) => !s.narration.trim())) throw new HttpError(409, "Every scene needs narration before approval.");
  const have = new Set((refs ?? []).map((r: { character_id: string }) => r.character_id));
  const missing = (chars ?? []).filter((c: { id: string }) => !have.has(c.id));
  if (missing.length) throw new HttpError(409, `Character designs are not ready: ${missing.map((m: { name: string }) => m.name).join(", ")}`);

  await db.from("scripts").update({ approved: true, approved_at: new Date().toISOString() }).eq("id", script[0].id);
  await db.from("characters").update({ approved: true }).eq("project_id", id);
  return ok({ approved: true });
});
