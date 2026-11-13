import type { Metadata } from "next";
import Link from "next/link";
import { ProjectList } from "@/components/dashboard/ProjectList";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Projects" };

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id,title,topic,video_style,duration_seconds,aspect_ratio,status,error,updated_at")
    .order("updated_at", { ascending: false });

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Your studio</h1>
          <p className="mt-1 text-sm text-muted">Every project keeps its progress, even if you close the tab.</p>
        </div>
        <Link href="/create" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:brightness-110">Create new video</Link>
      </header>
      <ProjectList initial={projects ?? []} />
    </div>
  );
}
