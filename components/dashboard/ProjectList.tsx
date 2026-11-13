"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert, api, Badge, Button, Card, Input, Modal, Select, statusTone } from "@/components/ui";
import { styleFor } from "@/lib/styles";

interface P { id: string; title: string; topic: string; video_style: string; duration_seconds: number; aspect_ratio: string; status: string; error: string | null; updated_at: string }

const FILTERS = [
  ["all", "All"], ["draft", "Drafts"], ["active", "Generating"], ["completed", "Completed"], ["failed", "Failed"],
] as const;
const ACTIVE = ["planning", "producing", "review"];

export function ProjectList({ initial }: { initial: P[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [renaming, setRenaming] = useState<P | null>(null);
  const [deleting, setDeleting] = useState<P | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    let list = items.filter((p) => (p.title + p.topic).toLowerCase().includes(q.toLowerCase()));
    if (filter === "active") list = list.filter((p) => ACTIVE.includes(p.status));
    else if (filter === "failed") list = list.filter((p) => ["failed", "cancelled"].includes(p.status));
    else if (filter !== "all") list = list.filter((p) => p.status === filter);
    return [...list].sort((a, b) => (sort === "title" ? a.title.localeCompare(b.title) : +new Date(b.updated_at) - +new Date(a.updated_at)));
  }, [items, q, filter, sort]);

  async function act(fn: () => Promise<void>) {
    setErr(null); setBusy(true);
    try { await fn(); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="Search projects" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <div role="tablist" aria-label="Filter" className="flex flex-wrap gap-1">
          {FILTERS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1 text-sm transition ${filter === k ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}>{label}</button>
          ))}
        </div>
        <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as "recent" | "title")} className="ml-auto w-auto">
          <option value="recent">Most recent</option><option value="title">Title A–Z</option>
        </Select>
      </div>
      {err && <div className="mt-4"><Alert>{err}</Alert></div>}

      {shown.length === 0 ? (
        <Card className="mt-6 p-10 text-center">
          <p className="font-display text-2xl">{items.length ? "No projects match." : "No videos yet."}</p>
          {!items.length && <p className="mt-2 text-sm text-muted">Describe an idea and the studio will take it from there.</p>}
        </Card>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <li key={p.id} className="rise">
              <Card className="group relative flex h-full flex-col p-5 transition hover:border-muted/50">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/projects/${p.id}`} className="font-display line-clamp-2 text-xl leading-snug after:absolute after:inset-0">
                    {p.title}
                  </Link>
                  <Badge tone={statusTone(p.status)}>{["planning", "producing"].includes(p.status) && <span className="pulse-dot size-1.5 rounded-full bg-current" />}{p.status}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted">{p.topic}</p>
                {p.error && p.status === "failed" && <p className="mt-2 line-clamp-2 text-xs text-danger">{p.error}</p>}
                <div className="mt-auto flex items-center justify-between pt-5 text-xs text-muted">
                  <span>{styleFor(p.video_style).label} · {p.duration_seconds}s · {p.aspect_ratio}</span>
                  <span className="relative z-10 flex gap-1">
                    <button className="rounded px-2 py-1 hover:bg-surface-2 hover:text-text" onClick={() => setRenaming(p)}>Rename</button>
                    <button className="rounded px-2 py-1 hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(p)}>Delete</button>
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename project">
        <form onSubmit={(e) => { e.preventDefault(); const title = String(new FormData(e.currentTarget).get("title")); const id = renaming!.id;
          act(async () => { await api(`/api/projects/${id}`, { method: "PATCH", json: { title } }); setItems((l) => l.map((x) => (x.id === id ? { ...x, title } : x))); setRenaming(null); }); }}>
          <Input name="title" defaultValue={renaming?.title} required maxLength={200} autoFocus />
          <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button><Button type="submit" busy={busy}>Save</Button></div>
        </form>
      </Modal>
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete this project?">
        <p className="text-sm text-muted">“{deleting?.title}” and all of its generated media will be permanently deleted. This can’t be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>Keep it</Button>
          <Button variant="danger" busy={busy} onClick={() => act(async () => { const id = deleting!.id; await api(`/api/projects/${id}`, { method: "DELETE" }); setItems((l) => l.filter((x) => x.id !== id)); setDeleting(null); })}>Delete forever</Button>
        </div>
      </Modal>
    </section>
  );
}
