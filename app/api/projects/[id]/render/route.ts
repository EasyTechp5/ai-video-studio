import { z } from "zod";
import { handle, ok, ownedProject, parseBody, rateLimit, requireUser } from "@/lib/api/helpers";
import { startProduction } from "@/lib/api/project-ops";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Starts (or resumes) production. The planner only generates what is missing, so retrying after a
 * failure or re-rendering after a scene edit never redoes completed scenes.
 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  rateLimit(`produce:${user.id}`, 10, 60_000);
  const { confirm } = await parseBody(req, z.object({ confirm: z.boolean().default(false) }));
  const project = await ownedProject(id, user.id);
  const job = await startProduction(project, confirm);
  return ok({ job }, 202);
});
