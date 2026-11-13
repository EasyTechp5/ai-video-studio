/**
 * Runs the real migrations on an in-process Postgres (PGlite) with minimal stubs for the Supabase-managed
 * `auth` / `storage` schemas and roles. Verifies schema validity, RLS, column grants, the credit ledger
 * and the queue-claim function. (Supabase-specific behaviour such as Realtime and Storage is not covered.)
 */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
create publication supabase_realtime;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant select on all tables in schema storage to authenticated;
`;

let db: PGlite;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

async function as(user: string | null, role: "authenticated" | "service_role", fn: () => Promise<unknown>) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  const dir = path.join(import.meta.dirname, "..", "supabase", "migrations");
  for (const f of fs.readdirSync(dir).sort()) {
    // pgcrypto isn't needed for gen_random_uuid() on Postgres >= 13.
    await db.exec(fs.readFileSync(path.join(dir, f), "utf8").replace(/create extension if not exists pgcrypto;/i, ""));
  }
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.com'), ('${B}', 'b@x.com');`);
}, 60_000);

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

describe("schema + signup", () => {
  it("creates a profile with starter credits and a ledger entry on signup", async () => {
    expect((await one<{ credits: number }>(`select credits from profiles where id = '${A}'`)).credits).toBe(100);
    expect((await one<{ n: number }>(`select count(*)::int n from credit_transactions where user_id = '${A}' and kind = 'grant'`)).n).toBe(1);
  });
  it("seeds voice profiles", async () => {
    expect((await one<{ n: number }>("select count(*)::int n from voice_profiles")).n).toBeGreaterThanOrEqual(2);
  });
});

describe("row level security", () => {
  let projectA: string;
  beforeAll(async () => {
    const r = await db.query<{ id: string }>(
      `insert into projects (user_id, title, topic, video_style, duration_seconds) values ('${A}', 'A video', 'Topic', 'cinematic', 30) returning id`);
    projectA = r.rows[0].id;
    await db.query(`insert into projects (user_id, title, topic, video_style, duration_seconds) values ('${B}', 'B video', 'Topic', 'cinematic', 30)`);
    await db.query(`insert into scenes (project_id, scene_number, narration, duration_seconds) values ('${projectA}', 1, 'hi', 5)`);
  });

  it("users see only their own projects and child rows", async () => {
    const rows = (await as(B, "authenticated", () => db.query("select title from projects"))) as { rows: { title: string }[] };
    expect(rows.rows.map((r) => r.title)).toEqual(["B video"]);
    const scenes = (await as(B, "authenticated", () => db.query("select id from scenes"))) as { rows: unknown[] };
    expect(scenes.rows).toHaveLength(0);
    const own = (await as(A, "authenticated", () => db.query("select id from scenes"))) as { rows: unknown[] };
    expect(own.rows).toHaveLength(1);
  });
  it("blocks writing to someone else's data and to server-controlled columns", async () => {
    await expect(as(B, "authenticated", () => db.query(`update projects set title = 'pwned' where id = '${projectA}'`)).then(async () =>
      (await one<{ title: string }>(`select title from projects where id = '${projectA}'`)).title)).resolves.toBe("A video");
    await expect(as(A, "authenticated", () => db.query(`update projects set status = 'completed' where id = '${projectA}'`))).rejects.toThrow(/permission denied/);
    await expect(as(A, "authenticated", () => db.query(`update profiles set credits = 999999 where id = '${A}'`))).rejects.toThrow(/permission denied/);
    await expect(as(A, "authenticated", () => db.query(`update profiles set is_admin = true where id = '${A}'`))).rejects.toThrow(/permission denied/);
  });
  it("lets users edit allowed profile fields and rejects inserting projects for others", async () => {
    await as(A, "authenticated", () => db.query(`update profiles set display_name = 'Ada', spending_limit = 50 where id = '${A}'`));
    expect((await one<{ display_name: string }>(`select display_name from profiles where id = '${A}'`)).display_name).toBe("Ada");
    await expect(as(A, "authenticated", () => db.query(
      `insert into projects (user_id, title, topic, video_style, duration_seconds) values ('${B}', 'x', 'x', 'cinematic', 5)`))).rejects.toThrow(/row-level security/);
  });
  it("blocks child-table writes by users and the credit RPCs", async () => {
    await expect(as(A, "authenticated", () => db.query(`insert into scenes (project_id, scene_number, narration, duration_seconds) values ('${projectA}', 2, 'x', 5)`))).rejects.toThrow();
    await expect(as(A, "authenticated", () => db.query(`select apply_credit('${A}', 500, 'grant', 'hack')`))).rejects.toThrow(/permission denied/);
    await expect(as(A, "authenticated", () => db.query(`select * from claim_job_step('w', 60)`))).rejects.toThrow(/permission denied/);
  });
});

describe("credit ledger", () => {
  it("reserves, is idempotent on replay, refunds, and refuses to go negative", async () => {
    const call = (amount: number, kind: string, key: string) =>
      as(null, "service_role", () => db.query<{ apply_credit: { applied: boolean; balance: number } }>(`select apply_credit('${B}', ${amount}, '${kind}', '${key}') as apply_credit`))
        .then((r) => (r as { rows: { apply_credit: { applied: boolean; balance: number } }[] }).rows[0].apply_credit);
    expect(await call(-30, "reserve", "k1")).toEqual({ applied: true, balance: 70 });
    expect(await call(-30, "reserve", "k1")).toEqual({ applied: false, balance: 70 }); // retry does not double-charge
    expect(await call(10, "refund", "k2")).toEqual({ applied: true, balance: 80 });
    await expect(call(-500, "reserve", "k3")).rejects.toThrow(/insufficient_credits/);
    expect((await one<{ credits: number }>(`select credits from profiles where id = '${B}'`)).credits).toBe(80);
  });
});

describe("job queue", () => {
  let job: string, project: string;
  beforeAll(async () => {
    project = (await one<{ id: string }>(`select id from projects where user_id = '${A}'`)).id;
    job = (await one<{ id: string }>(`insert into generation_jobs (project_id, user_id, kind, status) values ('${project}', '${A}', 'produce', 'queued') returning id`)).id;
    for (const k of ["s1", "s2"]) await db.query(`insert into job_steps (job_id, project_id, stage, idempotency_key) values ('${job}', '${project}', 'music', '${job}:${k}')`);
  });
  it("allows only one active job per project", async () => {
    await expect(db.query(`insert into generation_jobs (project_id, user_id, kind, status) values ('${project}', '${A}', 'plan', 'processing')`)).rejects.toThrow(/duplicate key|unique/);
  });
  it("rejects duplicate idempotency keys", async () => {
    await expect(db.query(`insert into job_steps (job_id, project_id, stage, idempotency_key) values ('${job}', '${project}', 'music', '${job}:s1')`)).rejects.toThrow(/duplicate key|unique/);
  });
  it("leases distinct steps, increments attempts, and returns nothing when empty", async () => {
    const claim = async (w: string) => (await db.query<{ id: string; attempts: number; status: string }>(`select * from claim_job_step('${w}', 60)`)).rows[0];
    const a = await claim("w1"); const b = await claim("w2");
    expect(a.id).not.toBe(b.id);
    expect(a.status).toBe("processing"); expect(a.attempts).toBe(1);
    expect(await claim("w3")).toBeUndefined();
  });
  it("re-leases a step whose worker died (expired lease) — resumability", async () => {
    await db.query(`update job_steps set locked_at = now() - interval '10 minutes' where job_id = '${job}' and idempotency_key = '${job}:s1'`);
    const r = (await db.query<{ attempts: number; locked_by: string }>(`select * from claim_job_step('w-new', 60)`)).rows[0];
    expect(r.locked_by).toBe("w-new"); expect(r.attempts).toBe(2);
  });
  it("skips cancelled jobs and not-yet-due retries", async () => {
    await db.query(`update job_steps set status = 'retrying', run_after = now() + interval '1 hour', locked_at = null where job_id = '${job}'`);
    expect((await db.query(`select * from claim_job_step('w', 60)`)).rows).toHaveLength(0);
    await db.query(`update job_steps set run_after = now() where job_id = '${job}'`);
    await db.query(`update generation_jobs set cancel_requested = true where id = '${job}'`);
    expect((await db.query(`select * from claim_job_step('w', 60)`)).rows).toHaveLength(0);
  });
});
