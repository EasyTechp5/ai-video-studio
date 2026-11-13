import { z } from "zod";
import { handle, HttpError, ok, ownedCharacter, parseBody, requireUser } from "@/lib/api/helpers";
import { assertIdle } from "@/lib/api/project-ops";
import { admin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  appearance: z.string().trim().min(3).max(1000).optional(),
  skin_tone: z.string().trim().max(120).optional(),
  hairstyle: z.string().trim().max(120).optional(),
  clothing: z.string().trim().max(240).optional(),
  age_appearance: z.string().trim().max(80).optional(),
  accessories: z.string().trim().max(240).optional(),
  personality: z.string().trim().max(240).optional(),
}).strict();

/** Edits a character description. Regenerate the reference image afterwards to apply it. */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  const c = await ownedCharacter(id, user.id);
  await assertIdle(c.project_id);
  const patch = await parseBody(req, schema);
  if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to update");
  await admin().from("characters").update({ ...patch, approved: false }).eq("id", id);
  await admin().from("scripts").update({ approved: false, approved_at: null }).eq("project_id", c.project_id);
  return ok({ ok: true });
});
