import { handle, ok, requireUser } from "@/lib/api/helpers";
import { providerStatus } from "@/lib/providers";

/** Which providers are configured (booleans only — never values). */
export const GET = handle(async () => {
  await requireUser();
  return ok({ providers: providerStatus() });
});
