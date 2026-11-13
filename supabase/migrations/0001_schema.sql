-- AI Video Studio: core schema
-- Apply with the Supabase CLI (`supabase db push`) or the SQL editor, in order.

create extension if not exists pgcrypto;

-- ───────────────────────── profiles ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  credits integer not null default 0 check (credits >= 0),
  spending_limit integer check (spending_limit is null or spending_limit >= 0),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── voice profiles ─────────────────────────
create table public.voice_profiles (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'elevenlabs',
  provider_voice_id text not null,
  name text not null,
  gender text,
  accent text,
  language text not null default 'en',
  description text,
  active boolean not null default true,
  unique (provider, provider_voice_id)
);

-- ───────────────────────── projects ─────────────────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  topic text not null,
  description text,
  video_style text not null,
  duration_seconds integer not null check (duration_seconds > 0),
  aspect_ratio text not null default '16:9' check (aspect_ratio in ('16:9','9:16','1:1')),
  target_audience text not null default 'general audience',
  language text not null default 'en',
  voice_profile_id uuid references public.voice_profiles(id),
  narration_style text not null default 'professional',
  music_mood text not null default 'inspirational',
  subtitles boolean not null default true,
  research_mode text not null default 'quick' check (research_mode in ('quick','detailed')),
  output_quality text not null default '1080p' check (output_quality in ('720p','1080p')),
  fps integer not null default 24 check (fps between 12 and 60),
  -- draft | planning | review | producing | completed | failed | cancelled
  status text not null default 'draft',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_idx on public.projects (user_id, updated_at desc);

-- ───────────────────────── research ─────────────────────────
create table public.research_results (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  performed boolean not null default false,   -- true only if a real search ran
  summary text,
  key_facts jsonb not null default '[]',
  sources jsonb not null default '[]',        -- [{title,url,domain,retrieved_at,excerpt}]
  created_at timestamptz not null default now()
);
create index research_project_idx on public.research_results (project_id, created_at desc);

-- ───────────────────────── scripts ─────────────────────────
create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null,
  content jsonb not null,
  approved boolean not null default false,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

-- ───────────────────────── characters ─────────────────────────
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  kind text not null default 'character' check (kind in ('character','environment','object')),
  appearance text not null,
  skin_tone text,
  hairstyle text,
  clothing text,
  age_appearance text,
  accessories text,
  personality text,
  voice_profile_id uuid references public.voice_profiles(id),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index characters_project_idx on public.characters (project_id);

-- ───────────────────────── scenes ─────────────────────────
create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_number integer not null,
  title text,
  narration text not null default '',
  visual_prompt text not null default '',
  camera_movement text,
  transition text not null default 'fade' check (transition in ('cut','fade','dissolve')),
  music_mood text,
  character_ids uuid[] not null default '{}',
  duration_seconds integer not null check (duration_seconds > 0),
  -- pending | processing | completed | failed
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, scene_number)
);

-- ───────────────────────── assets (versioned) ─────────────────────────
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_id uuid references public.scenes(id) on delete cascade,
  character_id uuid references public.characters(id) on delete cascade,
  kind text not null check (kind in ('character_reference','scene_image','scene_video','voice','music','export')),
  storage_path text not null,
  mime_type text not null,
  bytes bigint,
  duration_ms integer,
  width integer,
  height integer,
  provider text,
  provider_task_id text,
  prompt text,
  version integer not null default 1,
  is_current boolean not null default true,   -- previous versions kept for rollback
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index assets_project_idx on public.assets (project_id, kind) where is_current;
create index assets_scene_idx on public.assets (scene_id, kind) where is_current;
create index assets_character_idx on public.assets (character_id) where is_current;

-- ───────────────────────── jobs and steps ─────────────────────────
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('plan','produce')),
  status text not null default 'queued'
    check (status in ('pending','queued','processing','completed','failed','retrying','cancelled')),
  reserved_credits integer not null default 0,
  settled boolean not null default false,
  cancel_requested boolean not null default false,
  options jsonb not null default '{}',   -- e.g. {"script": false} to only (re)generate character art
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_project_idx on public.generation_jobs (project_id, created_at desc);
-- at most one active job per project
create unique index jobs_one_active_per_project
  on public.generation_jobs (project_id)
  where status in ('pending','queued','processing','retrying');

create table public.job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_id uuid references public.scenes(id) on delete cascade,
  character_id uuid references public.characters(id) on delete cascade,
  stage text not null check (stage in
    ('research','script','character_image','scene_image','scene_voice','music','scene_video','validate','render')),
  status text not null default 'queued'
    check (status in ('pending','queued','processing','completed','failed','retrying','cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  provider_task_id text,
  cost_credits integer not null default 0,
  idempotency_key text not null unique,
  payload jsonb not null default '{}',
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index steps_job_idx on public.job_steps (job_id);
create index steps_claim_idx on public.job_steps (run_after) where status in ('queued','retrying','processing');

-- ───────────────────────── exports ─────────────────────────
create table public.exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  duration_ms integer,
  width integer,
  height integer,
  bytes bigint,
  render_notes jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index exports_project_idx on public.exports (project_id, created_at desc);

-- ───────────────────────── credits ─────────────────────────
create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  job_id uuid references public.generation_jobs(id) on delete set null,
  kind text not null check (kind in ('grant','reserve','refund','adjustment')),
  amount integer not null,              -- signed; reserve is negative, refund positive
  balance_after integer not null,
  note text,
  idempotency_key text not null unique, -- prevents duplicate charges on retries
  created_at timestamptz not null default now()
);
create index credit_user_idx on public.credit_transactions (user_id, created_at desc);

-- ───────────────────────── audit log ─────────────────────────
create table public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid,
  project_id uuid,
  event text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ───────────────────────── updated_at triggers ─────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger trg_projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
create trigger trg_scenes_touch before update on public.scenes
  for each row execute function public.touch_updated_at();
create trigger trg_jobs_touch before update on public.generation_jobs
  for each row execute function public.touch_updated_at();

-- ───────────────────────── seed voices ─────────────────────────
-- ElevenLabs premade voices. Verify these IDs exist on your account/plan.
insert into public.voice_profiles (provider_voice_id, name, gender, accent, description) values
  ('21m00Tcm4TlvDq8ikWAM', 'Rachel', 'female', 'American', 'Calm, professional female narrator'),
  ('EXAVITQu4vr4xnSDxMaL', 'Sarah',  'female', 'American', 'Warm, conversational female voice'),
  ('pNInz6obpgDQGcFmaJgB', 'Adam',   'male',   'American', 'Deep, authoritative male narrator'),
  ('ErXwobaYiN019PkySvjV', 'Antoni', 'male',   'American', 'Well-rounded, friendly male voice')
on conflict do nothing;
