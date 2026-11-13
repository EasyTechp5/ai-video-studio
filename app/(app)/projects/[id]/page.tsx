import type { Metadata } from "next";
import { Workspace } from "@/components/video/Workspace";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  return <Workspace id={id} />;
}
