import { listCategories } from "@/lib/data/categories";
import { getProjects } from "@/lib/data/projects";
import { projectCategories } from "@/lib/categories";
import { ProjectsPageClient } from "./ProjectsPageClient";

/**
 * Explore. The server reads what the page's first layout depends on, the
 * category list and the header search, so the HTML it sends is the page the
 * visitor ends up with, not a title and skeletons that the browser then
 * rebuilds with a legend, filter chips and four rows of categories above
 * the grid, pushing it down (a layout shift of about 0.4 on desktop).
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q } = await searchParams;
  const [categories, projects] = await Promise.all([
    listCategories()
      .then((list) => (list.length > 0 ? list : projectCategories))
      // Falls back to the compiled-in list rather than failing the page.
      .catch(() => projectCategories),
    // The list itself, so the cards (and the first row's pictures) are in
    // the HTML rather than requested after the scripts have run. The
    // caller's own client: hidden listings stay as visible as they were.
    getProjects().catch(() => []),
  ]);

  return (
    <ProjectsPageClient
      initialCategories={categories}
      initialProjects={projects}
      searchQuery={typeof q === "string" && q.trim() ? q : null}
    />
  );
}
