
"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { motion } from "framer-motion";
import "./HeaderSearch.css";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Project } from "@/lib/types";
import { debounce } from 'lodash';
import { Card } from "../ui/card";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { formatCurrency } from "@/lib/formatters";

interface HeaderSearchProps {
  isMobileOpen?: boolean;
  setMobileOpen?: (isOpen: boolean) => void;
}

export function HeaderSearch({ isMobileOpen, setMobileOpen }: HeaderSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const isDesktop = useMediaQuery("(min-width: 950px)");
  const { openProjectDetails } = useProjectDetails();

  useEffect(() => {
    async function loadProjects() {
      const res = await fetch('/api/projects');
      const allProjects = await res.json();
      setProjects(allProjects.filter((p: Project) => p.status !== 'rejected' && p.status !== 'hidden'));
    }
    loadProjects();
  }, []);

  const debouncedSearch = useCallback(
    debounce((query: string) => {
      setDebouncedQuery(query);
    }, 300),
    []
  );

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
    setSearchQuery('');
    setShowSuggestions(false);
    openProjectDetails(project, false);
    if (setMobileOpen) {
      setMobileOpen(false);
    }
    inputRef.current?.blur();
  }

  const handleClose = () => {
    if (setMobileOpen) {
      setMobileOpen(false);
    }
    setSearchQuery("");
    setShowSuggestions(false);
  }

  const suggestions = useMemo(() => {
    if (!debouncedQuery.trim()) return [];

    const query = debouncedQuery.toLowerCase();
    return projects
      .filter(project =>
        project.title.toLowerCase().includes(query) ||
        project.tagline.toLowerCase().includes(query)
      )
      .slice(0, 5);
  }, [projects, debouncedQuery]);

  const searchComponent = (
    <div className="relative w-full">
      <form onSubmit={handleSearchSubmit} className="search-input-wrapper">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Search projects..."
          value={searchQuery}
          onChange={handleSearchChange}
          onFocus={() => setShowSuggestions(searchQuery.length > 0)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          className="h-10 w-full rounded-full border-2 border-primary/50 bg-background/80 pl-9 pr-4"
        />
      </form>
      {showSuggestions && suggestions.length > 0 && (
        <Card className="absolute z-10 w-full mt-1 max-h-80 overflow-y-auto">
          <div className="p-2 space-y-1">
            <p className="px-3 py-1 text-xs font-semibold text-muted-foreground">Projects</p>
            {suggestions.map((project) => (
              <div
                key={project.id}
                className="px-3 py-2 hover:bg-accent hover:text-accent-foreground rounded cursor-pointer flex items-center gap-3 group"
                onMouseDown={(e) => { // Use onMouseDown to prevent onBlur from firing first
                  e.preventDefault();
                  handleSelectProject(project);
                }}
              >
                <Avatar className="h-10 w-10 flex-shrink-0">
                  <AvatarImage src={project.imageUrl} alt={project.title} className="object-cover" />
                  <AvatarFallback>{project.title.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate text-foreground leading-tight">{project.title}</p>
                  <p className="text-xs text-muted-foreground truncate leading-relaxed">{project.tagline}</p>
                </div>
                <div className="text-xs font-bold text-accent whitespace-nowrap pl-2">
                  {formatCurrency(project.fundingGoal, project.currencyType, true)}
                </div>
              </div>
            ))}
          </div>
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
        <div className="w-full flex items-center gap-2">
          <div className="flex-grow">
            {searchComponent}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full flex-shrink-0"
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
