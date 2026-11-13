"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, api, ApiError, Badge, Button, Card, Modal, Spinner, statusTone } from "@/components/ui";
import { PipelineStrip } from "@/components/video/PipelineStrip";
import { SceneCard, type RegenTarget } from "@/components/video/SceneCard";
import type { Asset, Bundle, EstimateResp } from "@/components/video/types";
import { styleFor } from "@/lib/styles";

const ACTIVE_JOB = ["pending", "queued", "processing", "retrying"];
const PREVIEW = ["scene_image", "character_reference", "voice", "scene_video"];

function FinalPlayer({ exportId }: { exportId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ url: string }>(`/api/exports/${exportId}/download?inline=1`).then((r) => live && setUrl(r.url)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [exportId]);
  if (failed) return <div className="flex aspect-video items-center justify-center text-sm text-danger">Could not load the video. Try refreshing.</div>;
  if (!url) return <div className="flex aspect-video items-center justify-center text-sm text-muted"><Spinner className="mr-2" /> Loading player…</div>;
  return <video src={url} controls playsInline className="max-h-[70vh] w-full" aria-label="Final video" />;
}

type Pending =
  | { type: "produce" }
  | { type: "script" }
  | { type: "character"; id: string; scenes: { scene_number: number; title: string | null }[] }
  | { type: "media"; sceneId: string; target: RegenTarget }
  | { type: "cancel" }
  | null;

export function Workspace({ id }: { id: string }) {
  const [data, setData] = useState<Bundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [estimate, setEstimate] = useState<EstimateResp | null>(null);
  const urls = useRef<Record<string, string>>({});

  const fetchBundle = useCallback(async (withUrls: boolean) => {
    const b = await api<Bundle>(`/api/projects/${id}${withUrls ? "?urls=1" : ""}`);
    for (const a of b.assets) { if (a.url) urls.current[a.id] = a.url; else if (urls.current[a.id]) a.url = urls.current[a.id]; }
    return b;
  }, [id]);
  // State is only ever set inside promise callbacks, never synchronously in an effect body.
  const load = useCallback((withUrls = false) =>
    fetchBundle(withUrls).then((b) => { setData(b); setLoadError(null); }).catch((e: Error) => setLoadError(e.message)), [fetchBundle]);

  useEffect(() => { void load(true); }, [load]);

  // Assets that appeared during polling have no preview URL yet; sign them once.
  const missingUrls = data?.assets.some((a) => PREVIEW.includes(a.kind) && !a.url) ?? false;
  useEffect(() => { if (missingUrls) void load(true); }, [missingUrls, load]);

  const job = data?.jobs[0];
  const active = !!job && ACTIVE_JOB.includes(job.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [active, load]);

  const latestExport = data?.exports[0];

  async function call(fn: () => Promise<unknown>) {
    setError(null); setBusy(true);
    try { await fn(); await load(true); setPending(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : (e as Error).message); }
    finally { setBusy(false); }
  }

  if (loadError && !data) return <Alert>{loadError}</Alert>;
  if (!data) return <div className="flex items-center gap-2 text-muted"><Spinner /> Loading project…</div>;

  const { project, research, script, scenes, characters, assets } = data;
  const status = project.status;
  const approved = !!script?.approved;
  const hasVideoProvider = !!estimate?.providers.video;
  const assetsFor = (sceneId: string): Asset[] => assets.filter((a) => a.scene_id === sceneId);
  const charRef = (cid: string) => assets.find((a) => a.character_id === cid && a.kind === "character_reference");
  const locked = active || status === "planning" || status === "producing";
  const planJob = data.jobs.find((j) => j.kind === "plan");
  const failedSteps = (job?.job_steps ?? []).filter((s) => s.status === "failed");

  async function openProduce() {
    setError(null); setEstimate(null); setPending({ type: "produce" });
    try { setEstimate(await api<EstimateResp>(`/api/projects/${id}/estimate`)); } catch (e) { setError((e as Error).message); }
  }
  async function confirmProduce() {
    await call(async () => {
      if (!approved) await api(`/api/projects/${id}/approve`, { method: "POST" });
      await api(`/api/projects/${id}/produce`, { method: "POST", json: { confirm: true } });
    });
  }
  async function regenScript(confirm: boolean) {
    setError(null); setBusy(true);
    try { await api(`/api/projects/${id}/script`, { method: "POST", json: { confirm } }); setPending(null); await load(true); }
    catch (e) { if (e instanceof ApiError && e.body.code === "confirmation_required") setPending({ type: "script" }); else setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function regenCharacter(cid: string, confirm: boolean) {
    setError(null); setBusy(true);
    try { await api(`/api/projects/${id}/characters`, { method: "POST", json: { character_id: cid, confirm } }); setPending(null); await load(true); }
    catch (e) {
      if (e instanceof ApiError && e.body.code === "confirmation_required") setPending({ type: "character", id: cid, scenes: (e.body.dependent_scenes as never) ?? [] });
      else setError((e as Error).message);
    } finally { setBusy(false); }
  }
  async function sceneRegen(sceneId: string, target: RegenTarget, instruction?: string) {
    if (["image", "voice", "video"].includes(target)) { setEstimate(null); setPending({ type: "media", sceneId, target }); api<EstimateResp>(`/api/projects/${id}/estimate`).then(setEstimate).catch(() => undefined); return; }
    setError(null);
    try { await api(`/api/scenes/${sceneId}/regenerate`, { method: "POST", json: { target, instruction } }); await load(true); }
    catch (e) { setError((e as Error).message); }
  }
  async function download() {
    if (!latestExport) return;
    const r = await api<{ url: string }>(`/api/exports/${latestExport.id}/download`);
    window.location.href = r.url;
  }

  const notes = latestExport?.render_notes;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/dashboard" className="text-sm text-muted hover:text-text">← All projects</Link>
          <h1 className="font-display mt-2 text-4xl leading-tight">{project.title}</h1>
          <p className="mt-1 text-sm text-muted">{project.topic}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone={statusTone(status)}>{locked && <span className="pulse-dot size-1.5 rounded-full bg-current" />}{status}</Badge>
            <Badge>{styleFor(project.video_style).label}</Badge><Badge>{project.duration_seconds}s</Badge><Badge>{project.aspect_ratio}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {locked && <Button variant="secondary" onClick={() => setPending({ type: "cancel" })}>Cancel run</Button>}
          {status === "draft" && <Button busy={busy} onClick={() => call(() => api(`/api/projects/${id}/research`, { method: "POST" }))}>Start planning</Button>}
          {status === "review" && (<>
            <Button variant="secondary" onClick={() => regenScript(false)}>Regenerate script</Button>
            <Button onClick={openProduce}>Approve & produce</Button>
          </>)}
          {status === "completed" && <Button variant="secondary" onClick={openProduce}>Re-render</Button>}
          {["failed", "cancelled"].includes(status) && (planJob?.status === "failed" || scenes.length === 0
            ? <Button busy={busy} onClick={() => call(() => api(`/api/projects/${id}/research`, { method: "POST" }))}>Retry planning</Button>
            : <Button onClick={openProduce}>Resume production</Button>)}
        </div>
      </header>

      {error && <Alert>{error}</Alert>}
      {status === "failed" && project.error && (
        <Alert>
          <p className="font-medium">Something failed — completed work was kept.</p>
          <p className="mt-1 opacity-90">{project.error}</p>
          {failedSteps.some((s) => /not configured|Missing configuration/i.test(s.error ?? "")) && <p className="mt-1">Add the missing API keys to your environment, then retry.</p>}
        </Alert>
      )}

      <PipelineStrip jobs={data.jobs} animatedStills={!hasVideoProvider && !assets.some((a) => a.kind === "scene_video")} />

      {locked && (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner /> {status === "planning" ? "Planning in progress" : "Production in progress"} — you can leave this page; progress is saved and resumes automatically.
          {job?.status === "retrying" && <span className="text-warn">A step hit a temporary error and will retry shortly.</span>}
        </p>
      )}

      {status === "completed" && latestExport && (
        <section aria-label="Final video" className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="overflow-hidden rounded-xl border border-line bg-black">
            <FinalPlayer key={latestExport.id} exportId={latestExport.id} />
          </div>
          <Card className="space-y-3 p-5 text-sm">
            <h2 className="font-display text-2xl">Your video</h2>
            <dl className="grid grid-cols-2 gap-y-2 text-muted">
              <dt>Duration</dt><dd className="text-right text-text">{((latestExport.duration_ms ?? 0) / 1000).toFixed(1)}s</dd>
              <dt>Resolution</dt><dd className="text-right text-text">{latestExport.width}×{latestExport.height}</dd>
              <dt>File size</dt><dd className="text-right text-text">{((latestExport.bytes ?? 0) / 1_048_576).toFixed(1)} MB</dd>
              <dt>Visuals</dt><dd className="text-right text-text">{notes?.aiClips ? `${notes.aiClips} AI clips` : ""}{notes?.aiClips && notes?.animatedStills ? " + " : ""}{notes?.animatedStills ? `${notes.animatedStills} animated stills` : ""}</dd>
            </dl>
            <Button className="w-full" onClick={download}>Download MP4</Button>
            <Link href="/create" className="block text-center text-muted hover:text-text">Create another video</Link>
            <p className="text-xs text-muted">Download links expire after 10 minutes.</p>
          </Card>
        </section>
      )}

      {research && (
        <section aria-labelledby="research-h">
          <h2 id="research-h" className="font-display text-2xl">Research</h2>
          <Card className="mt-3 p-5">
            {!research.performed && <Alert tone="warn">No web research was performed for this project{research.summary ? `: ${research.summary}` : "."} The script uses only the brief.</Alert>}
            {research.performed && (
              <div className="grid gap-6 md:grid-cols-2">
                <div><p className="whitespace-pre-line text-sm leading-relaxed">{research.summary}</p>
                  <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-muted">{research.key_facts.map((f, i) => <li key={i}>{f.fact}</li>)}</ul></div>
                <div><h3 className="text-xs uppercase tracking-wider text-muted">Sources ({research.sources.length})</h3>
                  <ul className="mt-2 space-y-3 text-sm">{research.sources.map((s) => (
                    <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">{s.title || s.domain}</a>
                      <span className="block text-xs text-muted">{s.domain} · retrieved {new Date(s.retrieved_at).toLocaleDateString()}</span>
                      {s.excerpt && <span className="mt-1 block text-xs italic text-muted">“{s.excerpt}”</span>}</li>))}</ul></div>
              </div>
            )}
          </Card>
        </section>
      )}

      {characters.length > 0 && (
        <section aria-labelledby="chars-h">
          <h2 id="chars-h" className="font-display text-2xl">Characters & references</h2>
          <p className="mt-1 text-sm text-muted">Approved references and descriptions are reused in every scene a character appears in.</p>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {characters.map((c) => { const ref = charRef(c.id); return (
              <li key={c.id}><Card className="overflow-hidden">
                <div className="relative aspect-square bg-surface-2">
                  {ref?.url ? <img src={ref.url} alt={`Reference design of ${c.name}`} className="absolute inset-0 size-full object-cover" />
                    : <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">{locked ? <><Spinner className="mr-2" /> Designing…</> : "No reference yet"}</div>}
                </div>
                <div className="space-y-2 p-4"><div className="flex items-center justify-between"><h3 className="font-display text-lg">{c.name}</h3>{c.approved && <Badge tone="ok">approved</Badge>}</div>
                  <p className="line-clamp-3 text-sm text-muted">{c.appearance}</p>
                  {!locked && <Button variant="secondary" className="w-full" onClick={() => regenCharacter(c.id, false)}>Regenerate design</Button>}</div>
              </Card></li>); })}
          </ul>
        </section>
      )}

      {scenes.length > 0 && (
        <section aria-labelledby="story-h">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div><h2 id="story-h" className="font-display text-2xl">Script & storyboard</h2>
              <p className="mt-1 text-sm text-muted">Edit anything. {approved ? "Script approved." : "Nothing is generated until you approve."}</p></div>
            {approved && <Badge tone="ok">approved v{script?.version}</Badge>}
          </div>
          <div className="mt-3 space-y-4">
            {scenes.map((s) => (
              <SceneCard key={`${s.id}-${s.narration}-${s.visual_prompt}`} scene={s} assets={assetsFor(s.id)} locked={locked}
                charNames={s.character_ids.map((cid) => characters.find((c) => c.id === cid)?.name).filter(Boolean) as string[]}
                canRegenMedia={status === "completed" || assets.some((a) => a.scene_id === s.id)} hasVideoProvider={hasVideoProvider || assets.some((a) => a.kind === "scene_video")}
                onSave={(patch) => call(() => api(`/api/scenes/${s.id}`, { method: "PATCH", json: patch }))}
                onRegen={(t, i) => sceneRegen(s.id, t, i)} />
            ))}
          </div>
        </section>
      )}

      <Modal open={pending?.type === "produce"} onClose={() => setPending(null)} title="Start production?">
        {!estimate ? <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Calculating estimate…</p> : (<>
          <ul className="divide-y divide-line text-sm">{estimate.estimate.breakdown.map((b) => <li key={b.label} className="flex justify-between py-2"><span className="text-muted">{b.label}</span><span>{b.credits}</span></li>)}</ul>
          <p className="mt-3 flex justify-between border-t border-line pt-3"><span>Estimated total</span><span className="font-display text-2xl">~{estimate.estimate.credits} credits</span></p>
          <p className="mt-1 text-xs text-muted">Balance: {estimate.balance}. Unused credits are refunded if work fails or is cancelled. {estimate.estimate.uncertain && "AI video cost can vary with provider pricing."}</p>
          {estimate.missing.length > 0 && <div className="mt-3"><Alert tone="warn">Not configured: {estimate.missing.join("; ")}</Alert></div>}
          {estimate.balance < estimate.estimate.credits && <div className="mt-3"><Alert>You don’t have enough credits for this run.</Alert></div>}
        </>)}
        {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setPending(null)}>Not yet</Button>
          <Button busy={busy} disabled={!estimate || estimate.missing.length > 0 || estimate.balance < estimate.estimate.credits} onClick={confirmProduce}>Confirm & produce</Button></div>
      </Modal>

      <Modal open={pending?.type === "script"} onClose={() => setPending(null)} title="Replace the whole script?">
        <p className="text-sm text-muted">This rewrites every scene and character and discards the images, voiceover and clips already generated. Previous versions of exported videos are kept.</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setPending(null)}>Keep current</Button><Button variant="danger" busy={busy} onClick={() => regenScript(true)}>Regenerate script</Button></div>
      </Modal>

      <Modal open={pending?.type === "character"} onClose={() => setPending(null)} title="Redesign this character?">
        <p className="text-sm text-muted">These scenes already use the current design and will have their images and clips regenerated:</p>
        <ul className="mt-2 list-disc pl-5 text-sm">{pending?.type === "character" && pending.scenes.map((s) => <li key={s.scene_number}>Scene {s.scene_number}{s.title ? ` — ${s.title}` : ""}</li>)}</ul>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button><Button variant="danger" busy={busy} onClick={() => pending?.type === "character" && regenCharacter(pending.id, true)}>Redesign & regenerate</Button></div>
      </Modal>

      <Modal open={pending?.type === "media"} onClose={() => setPending(null)} title="Regenerate this scene’s media?">
        <p className="text-sm text-muted">Only this scene is regenerated; every other completed scene is reused, then the video is re-rendered.</p>
        {estimate && <p className="mt-3 text-sm">Estimated cost: <span className="font-display text-xl">~{estimate.estimate.credits}</span> credits <span className="text-muted">(balance {estimate.balance})</span></p>}
        {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
          <Button busy={busy} disabled={!estimate} onClick={() => pending?.type === "media" && call(() => api(`/api/scenes/${pending.sceneId}/regenerate`, { method: "POST", json: { target: pending.target, confirm: true } }))}>Regenerate</Button></div>
      </Modal>

      <Modal open={pending?.type === "cancel"} onClose={() => setPending(null)} title="Cancel this run?">
        <p className="text-sm text-muted">Work already completed is kept and reused next time. Credits not yet consumed are refunded.</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setPending(null)}>Keep running</Button>
          <Button variant="danger" busy={busy} onClick={() => job && call(() => api(`/api/jobs/${job.id}/cancel`, { method: "POST" }))}>Cancel run</Button></div>
      </Modal>
    </div>
  );
}
