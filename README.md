# AI Video Studio

Turns a topic and a short description into a finished, downloadable MP4: **research → script & storyboard → character designs → (you approve) → images → voiceover → music → video clips → validation → render → export.**

Claude is the intelligence layer (research synthesis, scripting, planning, scene rewrites). Media comes from replaceable provider adapters. Long-running work runs in a separate worker, never inside a web request.

```
Next.js (Vercel)  ──►  API routes ──►  Supabase Postgres (state, queue, credits) + Storage (media)
                                              ▲
                              production worker (Node + FFmpeg, Docker)
                                 claims steps with FOR UPDATE SKIP LOCKED
                                 Claude · OpenAI Images · ElevenLabs · Runway · FFmpeg
```

## Quick start

```bash
cp .env.example .env.local        # fill in values (see below)
npm install
# apply supabase/migrations/0001_schema.sql then 0002_security_and_functions.sql
#   (Supabase CLI: `supabase link` + `supabase db push`, or paste into the SQL editor)
npm run dev                       # web app on :3000
npm run worker                    # in a second terminal: production worker (needs ffmpeg on PATH)
```

Supabase Auth: enable email/password and add `http://localhost:3000/auth/callback` (and your production URL) to the allowed redirect URLs.

## Required credentials

| Variable | Needed for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | everything (service key: server + worker only) |
| `ANTHROPIC_API_KEY` | research (uses Anthropic's web search tool — must be enabled for your org), scripts, rewrites |
| `OPENAI_API_KEY` | character & scene images (`gpt-image-1`) |
| `ELEVENLABS_API_KEY` | voiceover and music |
| `RUNWAY_API_KEY` *(optional)* | AI video clips. **Without it the renderer animates the still images (Ken Burns) and the UI says so.** |

The app refuses to start production if a required provider is missing and tells the user exactly which variable to set.

## How it works

- **Queue** — Postgres, not Redis: `job_steps` rows are leased with `claim_job_step()` (`FOR UPDATE SKIP LOCKED`). A worker that dies loses its lease and another worker resumes the step; Runway task IDs are persisted so a restart resumes polling instead of paying twice. Run as many workers as you like.
- **Planner** — `lib/pipeline/state.ts` is a pure function: given what exists, which steps should be enqueued. It only ever generates what's *missing*, so a retry, a scene edit, or a "regenerate this voice" re-runs just that piece and re-renders. Fully unit-tested.
- **Approval gate** — nothing paid runs after planning until the script and character designs are approved and the user confirms the credit estimate.
- **Credits** — reserved when a run starts (idempotent ledger, `apply_credit`), step costs recorded as they complete, unused reservation refunded on failure/cancel. Prices live in `lib/costs.ts` — set them from real provider costs before charging money.
- **Renderer** — FFmpeg (`lib/rendering`): per-scene segments (AI clip or animated still), narration-driven scene length (speech is never clipped), burned-in subtitles, fades, concat, music with sidechain ducking under narration, then output validation (resolution, audio track, duration).
- **Security** — RLS on every table, column-level grants so users can't edit credits/status, ownership checks in every route (404 not 403), private storage bucket + short-lived signed URLs, secrets server-side only, research text treated as untrusted data in prompts, Claude never gets infrastructure tools.

## Deploy

1. **Web → Vercel.** Import the repo, set the env vars above (not `FFMPEG_*`/`WORKER_*`). Node functions are fine; no FFmpeg needed on Vercel.
2. **Worker → any container host** (Railway, Fly, Render, a VM): build `Dockerfile.worker`, give it the same env vars. It must stay running.
3. Verify with the end-to-end test below before telling anyone it works.

## Tests

```bash
npm test            # unit + integration (renderer uses real FFmpeg; DB tests run the migrations on in-process Postgres)
npm run typecheck && npm run lint && npm run build
```

## Known limitations (read before launching)

- **Not yet run end-to-end with real provider keys.** Provider adapters follow the vendors' public docs but were not executed against live APIs: verify OpenAI image edits, ElevenLabs Music (newest API), Runway parameters/duration limits, and Anthropic web-search availability with your keys. ElevenLabs voice IDs in the seed are premade voices — confirm they exist on your plan.
- MVP scope: videos up to `MAX_DURATION_SECONDS` (60). Longer durations are listed as "coming soon".
- Renderer is FFmpeg-only; Remotion compositions (intro/outro, branding templates) are not implemented.
- Narration only: per-character dialogue voices, voice cloning, and sound effects are not implemented. Music is one track per video.
- Rate limiting is in-memory per server instance; use Redis/Upstash when running multiple instances.
- Not built: payments/subscriptions, admin dashboard, Supabase Realtime (the UI polls every 3 s), media retention/lifecycle jobs, content moderation beyond Claude's `content_safety` gate.
- Supabase Realtime/Storage behaviour and live RLS were validated on in-process Postgres with stubbed `auth`/`storage`, not on a hosted Supabase project.

## End-to-end acceptance test (PRD §16)

Topic *"The importance of artificial intelligence in modern education"*, 3D cartoon, 30 s, 16:9, professional female voice, inspirational music. Sign up → create → review script/characters → approve → confirm estimate → wait for the pipeline strip to finish → play and download the MP4. Passes only if the file is a real, playable, correctly assembled video.
