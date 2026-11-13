/** Central, validated access to environment variables. Server/worker only. */

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export class MissingConfigError extends Error {
  constructor(public readonly vars: string[], purpose: string) {
    super(`Missing configuration for ${purpose}: set ${vars.join(", ")}`);
    this.name = "MissingConfigError";
  }
}

export function requireEnv(name: string, purpose: string): string {
  const v = opt(name);
  if (!v) throw new MissingConfigError([name], purpose);
  return v;
}

export const env = {
  get anthropicKey() { return opt("ANTHROPIC_API_KEY"); },
  get claudeModel() { return opt("CLAUDE_MODEL") ?? "claude-sonnet-5-5"; },
  get supabaseUrl() { return opt("NEXT_PUBLIC_SUPABASE_URL"); },
  get supabaseAnonKey() { return opt("NEXT_PUBLIC_SUPABASE_ANON_KEY"); },
  get supabaseServiceKey() { return opt("SUPABASE_SERVICE_ROLE_KEY"); },
  get bucket() { return opt("STORAGE_BUCKET") ?? "media"; },
  get openaiKey() { return opt("OPENAI_API_KEY"); },
  get imageModel() { return opt("IMAGE_MODEL") ?? "gpt-image-1"; },
  get elevenKey() { return opt("ELEVENLABS_API_KEY"); },
  get runwayKey() { return opt("RUNWAY_API_KEY"); },
  get runwayModel() { return opt("RUNWAY_MODEL") ?? "gen4_turbo"; },
  get workerConcurrency() { return Math.max(1, Number(opt("WORKER_CONCURRENCY") ?? 3)); },
  get ffmpeg() { return opt("FFMPEG_PATH") ?? "ffmpeg"; },
  get ffprobe() { return opt("FFPROBE_PATH") ?? "ffprobe"; },
  get maxDurationSeconds() { return Math.max(5, Number(opt("MAX_DURATION_SECONDS") ?? 60)); },
};
