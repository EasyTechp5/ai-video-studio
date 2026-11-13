import { admin } from "@/lib/supabase/admin";

export { COSTS, stepCost, estimatePlan, estimateProduce, type Estimate } from "@/lib/costs";

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Not enough credits for this operation.");
    this.name = "InsufficientCreditsError";
  }
}

/** Idempotent ledger write. Replays of the same key are no-ops. */
export async function applyCredit(args: {
  userId: string; amount: number; kind: "grant" | "reserve" | "refund" | "adjustment";
  key: string; projectId?: string; jobId?: string; note?: string;
}): Promise<{ applied: boolean; balance: number }> {
  const { data, error } = await admin().rpc("apply_credit", {
    p_user: args.userId, p_amount: args.amount, p_kind: args.kind, p_key: args.key,
    p_project: args.projectId ?? null, p_job: args.jobId ?? null, p_note: args.note ?? null,
  });
  if (error) {
    if (error.message.includes("insufficient_credits")) throw new InsufficientCreditsError();
    throw new Error(`Credit ledger error: ${error.message}`);
  }
  return data as { applied: boolean; balance: number };
}
