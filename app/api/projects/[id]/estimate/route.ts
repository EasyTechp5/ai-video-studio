import { handle, ok, ownedProject, requireUser } from "@/lib/api/helpers";
import { estimateFor } from "@/lib/pipeline/jobs";
import { missingForProduction, providerStatus } from "@/lib/providers";
import { admin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  const project = await ownedProject(id, user.id);
  const [estimate, profile] = await Promise.all([
    estimateFor(id, "produce"),
    admin().from("profiles").select("credits,spending_limit").eq("id", user.id).single(),
  ]);
  return ok({
    estimate, balance: profile.data?.credits ?? 0, spending_limit: profile.data?.spending_limit ?? null,
    providers: providerStatus(), missing: missingForProduction({ music: project.music_mood !== "none" }),
    note: "Estimates are based on configurable credit prices; provider billing may differ.",
  });
});
