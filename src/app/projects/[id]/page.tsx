import type { Metadata, ResolvingMetadata } from "next";
import { cache } from "react";
import { readProjectForVisitor } from "@/lib/data/public-reads";
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

// One read per request, shared by the title and the page. Shared between
// signed-out visitors for a few seconds; anyone signed in reads through their
// own session, so a project hidden from them is not rendered for them either
// (see public-reads.ts).
const readProject = cache(async (id: string) => {
  try {
    return await readProjectForVisitor(id);
  } catch {
    return null;
  }
});

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { id } = await params;
  const project = await readProject(decodeURIComponent(id));
  if (!project) return { title: FALLBACK_TITLE };
  const title = `${project.title} · BLKFNDR`;
  const description = project.tagline?.trim() || undefined;
  // Without these a shared project link would carry the site's title from the
  // root layout. They extend the layout's rather than replace them: a page's
  // own openGraph drops the inherited logo image, site name and large card.
  const { openGraph, twitter } = await parent;
  return {
    title,
    description,
    openGraph: {
      type: "website",
      siteName: openGraph?.siteName ?? undefined,
      images: openGraph?.images,
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      images: twitter?.images,
      title,
      description,
    },
  };
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);
  return <ProjectPageClient id={projectId} initialProject={await readProject(projectId)} />;
}
