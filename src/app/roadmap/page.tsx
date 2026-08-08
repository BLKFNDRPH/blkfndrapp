import { FeatureRequestBoard } from "@/components/community/FeatureRequestBoard";

export const metadata = {
  title: "Roadmap — BLKFNDR",
  description:
    "Request a feature and see what the platform owners have agreed to build.",
};

/**
 * Public, deliberately. A roadmap only readable by the people who already know
 * what is planned is not a roadmap, and the upvote count is only meaningful if
 * the people whose votes it counts can see it.
 */
export default function RoadmapPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Roadmap</h1>
        <p className="mt-2 text-muted-foreground">
          What people have asked for, and what the owners have agreed to build.
        </p>
      </header>
      <FeatureRequestBoard />
    </main>
  );
}
