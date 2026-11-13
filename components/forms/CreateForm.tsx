"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, api, ApiError, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { estimatePlan } from "@/lib/costs";
import { STYLE_PRESETS } from "@/lib/styles";
import { AUDIENCES, ASPECT_RATIOS, DURATION_OPTIONS, MUSIC_MOODS, NARRATION_STYLES } from "@/types/schemas";

interface Voice { id: string; name: string; gender: string | null; accent: string | null; description: string | null }
const LANGUAGES = [["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"], ["it", "Italian"]];
const label = (d: number) => (d < 60 ? `${d} sec` : `${d / 60} min`);

export function CreateForm({ voices, maxDuration }: { voices: Voice[]; maxDuration: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [research, setResearch] = useState<"quick" | "detailed">("quick");
  const plan = estimatePlan({ researchMode: research, hasResearch: false });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const { project } = await api<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        json: {
          topic: f.get("topic"), description: f.get("description"), video_style: f.get("video_style"),
          duration_seconds: Number(f.get("duration")), aspect_ratio: f.get("aspect_ratio"),
          target_audience: f.get("audience"), language: f.get("language"),
          voice_profile_id: f.get("voice") || null, narration_style: f.get("narration"),
          music_mood: f.get("music"), subtitles: f.get("subtitles") === "on",
          research_mode: research, output_quality: f.get("quality"),
        },
      });
      // Kick off planning; if it can't start (credits, config) the project page explains why.
      await api(`/api/projects/${project.id}/research`, { method: "POST" }).catch(() => undefined);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-5xl">
      <h1 className="font-display text-4xl">New video</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Final length is assembled from several scenes, each generated separately — not one uninterrupted AI clip.
        You’ll review the script and character designs before any expensive generation runs.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="space-y-5 p-6">
            <Field label="Topic"><Input name="topic" required minLength={3} maxLength={200} placeholder="The importance of artificial intelligence in modern education" /></Field>
            <Field label="Description" hint="Angle, key points, tone — anything the script should cover.">
              <Textarea name="description" maxLength={4000} placeholder="An engaging explainer about personalized learning, intelligent tutors and the future of classrooms." />
            </Field>
          </Card>
          <Card className="grid gap-5 p-6 sm:grid-cols-2">
            <Field label="Visual style">
              <Select name="video_style" defaultValue="3d_cartoon">{Object.entries(STYLE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
            </Field>
            <Field label="Duration" hint={`Up to ${label(maxDuration)} while the pipeline is validated.`}>
              <Select name="duration" defaultValue={30}>
                {DURATION_OPTIONS.map((d) => <option key={d} value={d} disabled={d > maxDuration}>{label(d)}{d > maxDuration ? " — coming soon" : ""}</option>)}
              </Select>
            </Field>
            <Field label="Aspect ratio"><Select name="aspect_ratio" defaultValue="16:9">{ASPECT_RATIOS.map((a) => <option key={a}>{a}</option>)}</Select></Field>
            <Field label="Output quality"><Select name="quality" defaultValue="1080p"><option>720p</option><option>1080p</option></Select></Field>
            <Field label="Target audience"><Select name="audience" defaultValue="general audience">{AUDIENCES.map((a) => <option key={a}>{a}</option>)}</Select></Field>
            <Field label="Language"><Select name="language" defaultValue="en">{LANGUAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </Card>
          <Card className="grid gap-5 p-6 sm:grid-cols-2">
            <Field label="Voice">
              <Select name="voice" defaultValue={voices.find((v) => v.gender === "female")?.id ?? ""}>
                {voices.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.gender} · {v.accent}</option>)}
              </Select>
            </Field>
            <Field label="Narration style"><Select name="narration" defaultValue="professional">{NARRATION_STYLES.map((n) => <option key={n}>{n}</option>)}</Select></Field>
            <Field label="Music mood"><Select name="music" defaultValue="inspirational">{MUSIC_MOODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
            <Field label="Research">
              <Select value={research} onChange={(e) => setResearch(e.target.value as "quick" | "detailed")}>
                <option value="quick">Quick (3 searches)</option><option value="detailed">Detailed (8 searches)</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="subtitles" defaultChecked className="size-4 accent-[var(--accent)]" /> Burn subtitles into the video</label>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <Card className="p-6">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted">What happens next</h2>
            <ol className="mt-3 space-y-2 text-sm text-muted">
              <li>1. Claude researches the topic and cites real sources.</li>
              <li>2. A script, storyboard and character designs are drafted.</li>
              <li>3. <span className="text-text">You review and approve.</span></li>
              <li>4. Images, voice, music and clips are generated, then rendered.</li>
            </ol>
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-xs uppercase tracking-wider text-muted">Planning cost (estimate)</p>
              <p className="font-display text-3xl">~{plan.credits} <span className="text-base text-muted">credits</span></p>
              <p className="mt-1 text-xs text-muted">Production is estimated separately, and you confirm it before it runs.</p>
            </div>
            {error && <div className="mt-4"><Alert>{error}</Alert></div>}
            <Button type="submit" busy={busy} className="mt-5 w-full">Start planning</Button>
          </Card>
        </aside>
      </div>
    </form>
  );
}
