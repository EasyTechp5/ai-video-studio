import { handle, ok, ownedProject, rateLimit, requireUser, HttpError } from "@/lib/api/helpers";
import { assertIdle } from "@/lib/api/project-ops";
import { startJob } from "@/lib/pipeline/jobs";
import { providerStatus } from "@/lib/providers";

type Ctx = { params: Promise<{ id: string }> };

/** Starts the planning job: research → script & storyboard → character reference art. */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  rateLimit(`plan:${user.id}`, 10, 60_000);
  const project = await ownedProject(id, user.id);
  if (!providerStatus().anthropic) throw new HttpError(503, "ANTHROPIC_API_KEY is not configured.", { code: "not_configured" });
  if (!providerStatus().image) throw new HttpError(503, "OPENAI_API_KEY is not configured (needed for character references).", { code: "not_configured" });
  await assertIdle(id);
  const job = await startJob(project, "plan");
  return ok({ job }, 202);
});
