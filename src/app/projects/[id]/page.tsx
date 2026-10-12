import type { Metadata } from "next";
import { cache } from "react";
import { getProjectById } from "@/lib/data/projects";
import { ProjectPageClient } from "./ProjectPageClient";

/**
 * One project's page. The server reads the listing (as indexed) and renders
 * the page with it, so the first HTML a phone receives is the project, not a
 * skeleton that waits for the scripts and a second request. The live vault
 * figures are still read on the client by ProjectDetailsContext and replace
 * the indexed ones a moment later.
 */

type Props = { params: Promise<{ id: string }> };

const FALLBACK_TITLE = "Project · BLKFNDR";

// One read per request, shared by the title and the page. The caller's own
// client, so a project hidden from them is not rendered for them either.
const readProject = cache(async (id: string) => {
  try {
    return (await getProjectById(id)) ?? null;
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const project = await readProject(decodeURIComponent(id));
  if (!project) return { title: FALLBACK_TITLE };
  return {
    title: `${project.title} · BLKFNDR`,
    description: project.tagline?.trim() || undefined,
  };
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);
  return <ProjectPageClient id={projectId} initialProject={await readProject(projectId)} />;
}
