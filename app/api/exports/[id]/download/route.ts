import { handle, ok, requireUser } from "@/lib/api/helpers";
import { signedUrl } from "@/lib/storage";
import { loadOwnedExport } from "@/lib/api/exports";

type Ctx = { params: Promise<{ id: string }> };

/** Time-limited signed URL (10 min). `?inline=1` streams for the player instead of forcing a download. */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { user } = await requireUser();
  const { id } = await params;
  const row = await loadOwnedExport(id, user.id);
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const filename = `${row.projects.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "video"}.mp4`;
  const url = await signedUrl(row.assets.storage_path, 600, inline ? undefined : filename);
  return ok({ url, expires_in: 600, filename });
});
