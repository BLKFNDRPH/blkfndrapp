import type { Metadata } from "next";
import { getProjectById } from "@/lib/data/projects";
import { ProjectPageClient } from "./ProjectPageClient";

/**
 * One project's page. The server part only names the page for the tab title
 * and link previews; the project itself, with its live vault figures, is read
 * on the client by ProjectDetailsContext, as the dialog did.
 */

type Props = { params: Promise<{ id: string }> };

const FALLBACK_TITLE = "Project · BLKFNDR";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  let project: Awaited<ReturnType<typeof getProjectById>>;
  try {
    project = await getProjectById(decodeURIComponent(id));
  } catch {
    project = undefined;
  }
  if (!project) return { title: FALLBACK_TITLE };
  return {
    title: `${project.title} · BLKFNDR`,
    description: project.tagline?.trim() || undefined,
  };
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;
  return <ProjectPageClient id={decodeURIComponent(id)} />;
}
