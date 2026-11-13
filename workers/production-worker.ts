/**
 * Background production worker. Run as a long-lived process on a host with FFmpeg installed
 * (Docker image / Railway / Fly / Render / a VM), NOT on Vercel.
 *
 *   npm run worker
 *
 * It leases steps from Postgres (FOR UPDATE SKIP LOCKED), so any number of workers can run
 * safely, and a crashed worker's steps become claimable again once their lease expires.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { providerStatus } from "@/lib/providers";
import { admin } from "@/lib/supabase/admin";
import { processStep } from "@/lib/pipeline/runner";
import type { StepRow } from "@/lib/pipeline/types";

const workerId = `worker-${randomUUID().slice(0, 8)}`;
const LEASE_SECONDS = 120;
const POLL_MS = 2000;
let stopping = false;
let active = 0;

async function claim(): Promise<StepRow | null> {
  const { data, error } = await admin().rpc("claim_job_step", { p_worker: workerId, p_lease_seconds: LEASE_SECONDS });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const rows = data as StepRow[] | null;
  return rows?.[0] ?? null;
}

async function main() {
  console.log(`[worker] ${workerId} starting (concurrency ${env.workerConcurrency})`);
  console.log("[worker] providers:", providerStatus());
  const stop = () => { if (!stopping) { stopping = true; console.log("[worker] draining…"); } };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    if (active >= env.workerConcurrency) { await sleep(250); continue; }
    let step: StepRow | null = null;
    try { step = await claim(); } catch (e) { console.error("[worker]", (e as Error).message); await sleep(5000); continue; }
    if (!step) { await sleep(POLL_MS); continue; }
    active++;
    processStep(step, workerId)
      .catch((e) => console.error("[worker] unhandled step error", e))
      .finally(() => { active--; });
  }
  while (active > 0) await sleep(250);
  console.log("[worker] stopped");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
main().catch((e) => { console.error(e); process.exit(1); });
