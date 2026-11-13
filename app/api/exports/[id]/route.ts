import { handle, ok, requireUser } from "@/lib/api/helpers";
import { loadOwnedExport } from "@/lib/api/exports";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  const row = await loadOwnedExport(id, user.id);
  const { assets: _a, projects: _p, ...meta } = row;
  return ok({ export: meta });
});
