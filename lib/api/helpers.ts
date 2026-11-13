import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { MissingConfigError } from "@/lib/env";
import { InsufficientCreditsError } from "@/lib/credits";
import { JobAlreadyActiveError, SpendingLimitError } from "@/lib/pipeline/jobs";
import { admin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ProjectRow } from "@/lib/pipeline/types";

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

/** Authenticates the request. The user id always comes from the verified session, never the client. */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Not signed in");
  return { user: data.user, supabase };
}

/** Loads a project only if it belongs to the caller. 404 (not 403) so ids can't be probed. */
export async function ownedProject(projectId: string, userId: string): Promise<ProjectRow> {
  const { data } = await admin().from("projects").select("*").eq("id", projectId).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(404, "Project not found");
  return data as ProjectRow;
}

export async function ownedScene(sceneId: string, userId: string) {
  const { data } = await admin().from("scenes").select("*, projects!inner(user_id)").eq("id", sceneId).maybeSingle();
  if (!data || (data as { projects: { user_id: string } }).projects.user_id !== userId) throw new HttpError(404, "Scene not found");
  return data as import("@/lib/pipeline/types").SceneRow;
}

export async function ownedCharacter(characterId: string, userId: string) {
  const { data } = await admin().from("characters").select("*, projects!inner(user_id)").eq("id", characterId).maybeSingle();
  if (!data || (data as { projects: { user_id: string } }).projects.user_id !== userId) throw new HttpError(404, "Character not found");
  return data as import("@/lib/pipeline/types").CharacterRow;
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try { json = await req.json(); } catch { throw new HttpError(400, "Invalid JSON body"); }
  return schema.parse(json);
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
      if (e instanceof ZodError) {
        return NextResponse.json({ error: "Invalid input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
      }
      if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: e.message, code: "insufficient_credits" }, { status: 402 });
      if (e instanceof SpendingLimitError) return NextResponse.json({ error: e.message, code: "spending_limit" }, { status: 402 });
      if (e instanceof JobAlreadyActiveError) return NextResponse.json({ error: e.message, code: "job_active" }, { status: 409 });
      if (e instanceof MissingConfigError) return NextResponse.json({ error: e.message, code: "not_configured" }, { status: 503 });
      console.error("[api]", e);
      return NextResponse.json({ error: "Something went wrong on our side." }, { status: 500 });
    }
  };
}

export const ok = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Dead simple per-user sliding-window limiter (per server instance). Use Redis/Upstash for multi-instance. */
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, "Too many requests, slow down.");
  arr.push(now);
  hits.set(key, arr);
}
