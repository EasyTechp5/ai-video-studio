import { handle, ok, rateLimit, requireUser, HttpError } from "@/lib/api/helpers";
import { env } from "@/lib/env";
import { admin } from "@/lib/supabase/admin";
import { projectInputSchema } from "@/types/schemas";

export const GET = handle(async () => {
  const { supabase } = await requireUser(); // RLS scopes this to the caller
  const { data, error } = await supabase
    .from("projects")
    .select("id,title,topic,video_style,duration_seconds,aspect_ratio,status,error,created_at,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new HttpError(500, "Could not load projects");
  return ok({ projects: data });
});

export const POST = handle(async (req: Request) => {
  const { user } = await requireUser();
  rateLimit(`create:${user.id}`, 20, 60_000);
  const body = projectInputSchema.parse(await req.json().catch(() => { throw new HttpError(400, "Invalid JSON body"); }));
  if (body.duration_seconds > env.maxDurationSeconds) {
    throw new HttpError(400, `Videos up to ${env.maxDurationSeconds}s are supported right now. Longer durations arrive after the MVP pipeline is validated.`);
  }
  if (body.voice_profile_id) {
    const { data } = await admin().from("voice_profiles").select("id").eq("id", body.voice_profile_id).eq("active", true).maybeSingle();
    if (!data) throw new HttpError(400, "Unknown voice profile");
  }
  const { data, error } = await admin().from("projects").insert({
    user_id: user.id, title: body.topic.slice(0, 120), ...body, voice_profile_id: body.voice_profile_id ?? null, status: "draft",
  }).select("*").single();
  if (error) throw new HttpError(500, "Could not create project");
  return ok({ project: data }, 201);
});

