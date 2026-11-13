"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { Badge, Button, Card, Input, Textarea } from "@/components/ui";
import type { Asset, Scene } from "@/components/video/types";

export type RegenTarget = "rewrite" | "expand" | "shorten" | "image" | "voice" | "video";

export function SceneCard({ scene, assets, charNames, locked, canRegenMedia, hasVideoProvider, onSave, onRegen }: {
  scene: Scene; assets: Asset[]; charNames: string[]; locked: boolean; canRegenMedia: boolean; hasVideoProvider: boolean;
  onSave: (patch: { narration?: string; visual_prompt?: string; title?: string }) => Promise<void>;
  onRegen: (target: RegenTarget, instruction?: string) => Promise<void>;
}) {
  const image = assets.find((a) => a.kind === "scene_image");
  const voice = assets.find((a) => a.kind === "voice");
  const clip = assets.find((a) => a.kind === "scene_video");
  const [narration, setNarration] = useState(scene.narration);
  const [visual, setVisual] = useState(scene.visual_prompt);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = narration !== scene.narration || visual !== scene.visual_prompt;
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  const fits = words / 2.5 <= scene.duration_seconds + 1;

  const run = (k: string, fn: () => Promise<void>) => async () => { setBusy(k); try { await fn(); } finally { setBusy(null); } };

  return (
    <Card className="overflow-hidden">
      <div className="grid md:grid-cols-[300px_1fr]">
        <div className="relative aspect-video bg-surface-2 md:aspect-auto md:min-h-48">
          {clip?.url ? (
            <video src={clip.url} controls muted playsInline preload="metadata" className="absolute inset-0 size-full object-cover" aria-label={`Scene ${scene.scene_number} clip`} />
          ) : image?.url ? (
            <img src={image.url} alt={`Scene ${scene.scene_number}: ${scene.title ?? ""}`} className="absolute inset-0 size-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">Not generated yet</div>
          )}
          <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 font-mono text-xs">{String(scene.scene_number).padStart(2, "0")}</span>
        </div>
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl">{scene.title ?? `Scene ${scene.scene_number}`}</h3>
            <Badge>{scene.duration_seconds}s</Badge>
            {scene.camera_movement && <Badge>{scene.camera_movement}</Badge>}
            {charNames.map((n) => <Badge key={n} tone="accent">{n}</Badge>)}
            {scene.status === "failed" && <Badge tone="danger">failed</Badge>}
          </div>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-muted">Narration <span className={fits ? "" : "text-warn"}>· {words} words{fits ? "" : " — may run long; the scene will stretch to fit"}</span></span>
            <Textarea value={narration} onChange={(e) => setNarration(e.target.value)} disabled={locked} rows={3} className="mt-1" />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-muted">Visual</span>
            <Textarea value={visual} onChange={(e) => setVisual(e.target.value)} disabled={locked} rows={2} className="mt-1 min-h-16" />
          </label>
          {voice?.url && <audio controls src={voice.url} className="h-9 w-full" aria-label={`Scene ${scene.scene_number} voiceover`} />}

          {!locked && (
            <div className="space-y-2 border-t border-line pt-3">
              <div className="flex flex-wrap gap-2">
                {dirty && <Button busy={busy === "save"} onClick={run("save", async () => { await onSave({ narration, visual_prompt: visual }); })}>Save edits</Button>}
                <Button variant="secondary" busy={busy === "shorten"} onClick={run("shorten", () => onRegen("shorten"))}>Shorter</Button>
                <Button variant="secondary" busy={busy === "expand"} onClick={run("expand", () => onRegen("expand"))}>Longer</Button>
              </div>
              <div className="flex gap-2">
                <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Rewrite this scene with AI… e.g. “make it more playful”" />
                <Button variant="secondary" busy={busy === "rewrite"} onClick={run("rewrite", async () => { await onRegen("rewrite", instruction); setInstruction(""); })}>Rewrite</Button>
              </div>
              {canRegenMedia && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="self-center text-muted">Regenerate:</span>
                  <Button variant="ghost" className="!px-2 !py-1" onClick={() => onRegen("image")}>image</Button>
                  <Button variant="ghost" className="!px-2 !py-1" onClick={() => onRegen("voice")}>voice</Button>
                  {hasVideoProvider && <Button variant="ghost" className="!px-2 !py-1" onClick={() => onRegen("video")}>clip</Button>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
