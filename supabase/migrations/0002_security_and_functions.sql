-- Row Level Security, storage policies, signup trigger, credit ledger and queue functions.

-- ───────────────────────── RLS ─────────────────────────
alter table public.profiles            enable row level security;
alter table public.voice_profiles      enable row level security;
alter table public.projects            enable row level security;
alter table public.research_results    enable row level security;
alter table public.scripts             enable row level security;
alter table public.characters          enable row level security;
alter table public.scenes              enable row level security;
alter table public.assets              enable row level security;
alter table public.generation_jobs     enable row level security;
alter table public.job_steps           enable row level security;
alter table public.exports             enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.audit_events        enable row level security;  -- no policies: server only

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- Users may only edit these columns; credits / is_admin are server-controlled.
revoke update on public.profiles from authenticated, anon;
grant update (display_name, spending_limit) on public.profiles to authenticated;

create policy voices_select on public.voice_profiles
  for select to authenticated using (active);

create policy projects_select_own on public.projects
  for select to authenticated using (user_id = auth.uid());
create policy projects_insert_own on public.projects
  for insert to authenticated with check (user_id = auth.uid() and status = 'draft');
create policy projects_update_own on public.projects
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy projects_delete_own on public.projects
  for delete to authenticated using (user_id = auth.uid());
-- status / error are written only by the server (service role).
revoke update on public.projects from authenticated, anon;
grant update (title, topic, description) on public.projects to authenticated;

-- Child tables: owners can read; all writes go through the server with ownership checks.
do $$
declare t text;
begin
  foreach t in array array['research_results','scripts','characters','scenes','assets',
                           'generation_jobs','job_steps','exports']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (exists (select 1 from public.projects p where p.id = %I.project_id and p.user_id = auth.uid()))',
      t || '_select_own', t, t);
  end loop;
end $$;

create policy credits_select_own on public.credit_transactions
  for select to authenticated using (user_id = auth.uid());

-- ───────────────────────── storage ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 524288000)
on conflict (id) do nothing;

-- Objects live under  <user_id>/<project_id>/...  Owners may read their own;
-- uploads happen server-side with the service role.
create policy media_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ───────────────────────── signup trigger ─────────────────────────
-- Free starter credits live here (change the number to taste).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, credits)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), 100);
  insert into public.credit_transactions (user_id, kind, amount, balance_after, note, idempotency_key)
  values (new.id, 'grant', 100, 100, 'Signup credits', 'signup:' || new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── credit ledger ─────────────────────────
-- Atomic, idempotent balance change. Replaying the same key is a no-op, so job
-- retries can never double-charge or double-refund.
create or replace function public.apply_credit(
  p_user uuid, p_amount integer, p_kind text, p_key text,
  p_project uuid default null, p_job uuid default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_balance integer;
  v_existing integer;
begin
  select credits into v_balance from public.profiles where id = p_user for update;
  if not found then raise exception 'profile_not_found'; end if;

  select balance_after into v_existing from public.credit_transactions where idempotency_key = p_key;
  if found then
    return jsonb_build_object('applied', false, 'balance', v_balance);
  end if;

  if v_balance + p_amount < 0 then
    raise exception 'insufficient_credits';
  end if;

  update public.profiles set credits = v_balance + p_amount where id = p_user;
  insert into public.credit_transactions (user_id, project_id, job_id, kind, amount, balance_after, note, idempotency_key)
  values (p_user, p_project, p_job, p_kind, p_amount, v_balance + p_amount, p_note, p_key);

  return jsonb_build_object('applied', true, 'balance', v_balance + p_amount);
end $$;

-- ───────────────────────── queue claim ─────────────────────────
-- Workers call this to atomically lease the next runnable step. A step whose
-- lease expired (worker crash/restart) becomes claimable again, which is what
-- makes production resumable.
create or replace function public.claim_job_step(p_worker text, p_lease_seconds integer default 120)
returns setof public.job_steps
language plpgsql security definer set search_path = public as $$
begin
  return query
  with cand as (
    select s.id
    from public.job_steps s
    join public.generation_jobs j on j.id = s.job_id
    where j.cancel_requested = false
      and j.status in ('queued','processing','retrying')
      and (
        (s.status in ('queued','retrying') and s.run_after <= now())
        or (s.status = 'processing' and s.locked_at < now() - make_interval(secs => p_lease_seconds))
      )
    order by s.run_after, s.created_at
    limit 1
    for update of s skip locked
  )
  update public.job_steps s
     set status = 'processing',
         locked_at = now(),
         locked_by = p_worker,
         attempts = s.attempts + 1,
         started_at = coalesce(s.started_at, now())
    from cand
   where s.id = cand.id
  returning s.*;
end $$;

-- Lock the privileged functions down to the service role.
revoke all on function public.apply_credit(uuid, integer, text, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_job_step(text, integer) from public, anon, authenticated;
grant execute on function public.apply_credit(uuid, integer, text, text, uuid, uuid, text) to service_role;
grant execute on function public.claim_job_step(text, integer) to service_role;

-- ───────────────────────── realtime ─────────────────────────
alter publication supabase_realtime add table public.projects, public.generation_jobs, public.job_steps;
