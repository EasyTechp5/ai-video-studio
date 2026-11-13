import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

let cached: SupabaseClient | null = null;

/** Service-role client. Server and worker only; bypasses RLS, so always check ownership first. */
export function admin(): SupabaseClient {
  if (!cached) {
    cached = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL", "Supabase"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY", "Supabase service role"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return cached;
}
