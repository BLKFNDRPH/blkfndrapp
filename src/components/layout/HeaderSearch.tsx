"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { motion } from "framer-motion";
import "./HeaderSearch.css";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Project } from "@/lib/types";
import { debounce } from "lodash";
import { Card } from "../ui/card";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { describeMoney } from "@/lib/money";
import { describeStatus } from "@/lib/project-status";
import { useXlmRate } from "@/lib/xlm-rate";

interface HeaderSearchProps {
  isMobileOpen?: boolean;
  setMobileOpen?: (isOpen: boolean) => void;
}

/** "$5,000 goal · Open for stakes": the goal in dollars and what you can do. */
export function describeSearchRow(project: Project, xlmUsd: number | null): string {
  const goal = describeMoney(project.fundingGoal, project.currencyType, xlmUsd, "never");
  return `${goal.primary} goal · ${describeStatus(project).label}`;
}

export function HeaderSearch({ isMobileOpen, setMobileOpen }: HeaderSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const isDesktop = useMediaQuery("(min-width: 950px)");
  const { openProjectDetails } = useProjectDetails();
  const { rate } = useXlmRate();

  useEffect(() => {
    async function loadProjects() {
      const res = await fetch("/api/projects");
      const allProjects = await res.json();
      // Search is a public surface. A platform-hidden listing arrives only for a
      // viewer entitled to it (admin, builder, stakeholder), and is still not
      // something search should offer.
      setProjects(
        allProjects.filter(
          (p: Project) =>
            p.status !== "rejected" && p.status !== "hidden" && !p.restriction?.hidden,
        ),
      );
    }
    loadProjects();
  }, []);

  const debouncedSearch = useMemo(
    () => debounce((query: string) => setDebouncedQuery(query), 300),
    [],
  );
  useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setShowSuggestions(value.length > 0);
    debouncedSearch(value);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/projects?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
      setShowSuggestions(false);
      if (setMobileOpen) {
        setMobileOpen(false);
      }
      inputRef.current?.blur();
    }
  };

  const handleSelectProject = (project: Project) => {
    setSearchQuery("");
    setShowSuggestions(false);
    openProjectDetails(project, false);
    if (setMobileOpen) {
      setMobileOpen(false);
    }
    inputRef.current?.blur();
  };

  const handleClose = () => {
    if (setMobileOpen) {
      setMobileOpen(false);
    }
    setSearchQuery("");
    setShowSuggestions(false);
  };

  const suggestions = useMemo(() => {
    if (!debouncedQuery.trim()) return [];

    const query = debouncedQuery.toLowerCase();
    return projects
      .filter(
        (project) =>
          project.title.toLowerCase().includes(query) ||
          project.tagline.toLowerCase().includes(query),
      )
      .slice(0, 5);
  }, [projects, debouncedQuery]);

  // The empty state waits for the debounce so a half-typed word never flashes
  // "no match" before the list has caught up.
  const searched = debouncedQuery.trim().length > 0 && debouncedQuery === searchQuery;
  const showEmpty = showSuggestions && searched && suggestions.length === 0;

  const searchComponent = (
    <div className="relative w-full">
      <form onSubmit={handleSearchSubmit} className="search-input-wrapper">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Search projects"
          value={searchQuery}
          onChange={handleSearchChange}
          onFocus={() => setShowSuggestions(searchQuery.length > 0)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          className="h-10 w-full rounded-full border-2 border-primary/50 bg-background/80 pl-9 pr-4"
          aria-label="Search projects"
        />
      </form>
      {showSuggestions && suggestions.length > 0 && (
        <Card className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto">
          <ul className="space-y-1 p-2" aria-label="Projects">
            {suggestions.map((project) => (
              <li
                key={project.id}
                className="group flex cursor-pointer items-center gap-3 rounded px-3 py-2 hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(e) => {
                  // onMouseDown so the row wins over the input's onBlur.
                  e.preventDefault();
                  handleSelectProject(project);
                }}
              >
                <Avatar className="h-10 w-10 flex-shrink-0">
                  <AvatarImage src={project.imageUrl} alt="" className="object-cover" />
                  <AvatarFallback>{project.title.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight text-foreground group-hover:text-accent-foreground">
                    {project.title}
                  </p>
                  <p className="truncate text-xs leading-relaxed text-muted-foreground group-hover:text-accent-foreground/80">
                    {project.tagline}
                  </p>
                  <p className="truncate text-xs leading-relaxed text-foreground/80 group-hover:text-accent-foreground/90">
                    {describeSearchRow(project, rate)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {showEmpty && (
        <Card className="absolute z-10 mt-1 w-full">
          <p className="px-4 py-3 text-sm text-muted-foreground">No projects match that.</p>
        </Card>
      )}
    </div>
  );

  if (isDesktop) {
    return <div className="header-search-container w-[30%]">{searchComponent}</div>;
  }

  // Mobile view
  if (isMobileOpen) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="mobile-search-overlay"
      >
        <div className="flex w-full items-center gap-2">
          <div className="flex-grow">{searchComponent}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="flex-shrink-0 rounded-full"
            onClick={handleClose}
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close search</span>
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="rounded-full"
      onClick={() => setMobileOpen && setMobileOpen(true)}
    >
      <Search className="h-4 w-4" />
      <span className="sr-only">Search</span>
    </Button>
  );
}
