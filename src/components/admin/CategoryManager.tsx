"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  getCategoriesAction,
  addCategoryAction,
  removeCategoryAction,
} from "@/actions/categories";

/**
 * The categories builders can choose from when creating a listing.
 *
 * Removing one stops it being offered to new projects; it does not touch
 * listings already using it, because `projects.category` is stored as text
 * rather than a reference. The copy below says so, since "delete" in an admin
 * panel usually implies something is destroyed.
 *
 * Authorization is not here. Every action calls requireAdmin server-side and
 * RLS restricts the table to admins, so this component only decides what to
 * render — hiding a button is not a permission.
 */
export function CategoryManager() {
  const { toast } = useToast();
  const [categories, setCategories] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getCategoriesAction()
      .then((res) => {
        if (!cancelled && res.success) setCategories(res.categories ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = (
    label: string,
    key: string,
    action: () => Promise<{ success: boolean; categories?: string[]; error?: string }>,
  ) => {
    setBusy(key);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.success) {
          setCategories(res.categories ?? []);
          toast({ title: label });
          setDraft("");
        } else {
          toast({
            title: `${label} failed`,
            description: res.error,
            variant: "destructive",
          });
        }
      } finally {
        setBusy(null);
      }
    });
  };

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    run("Category added", "__add__", () => addCategoryAction(name));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Categories</CardTitle>
        <CardDescription>
          What builders can pick from when creating a listing. Removing a category
          stops it being offered — projects already filed under it keep their
          label and are not affected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="New category name"
            maxLength={40}
            aria-label="New category name"
          />
          <Button onClick={add} disabled={!draft.trim() || busy === "__add__"}>
            {busy === "__add__" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="ml-1">Add</span>
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading categories…
          </div>
        ) : categories.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No categories yet. A builder cannot file a listing until at least one
            exists.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((name) => (
              <Badge
                key={name}
                variant="secondary"
                className="pl-3 pr-1 py-1 text-sm font-normal gap-1"
              >
                {name}
                <button
                  type="button"
                  onClick={() =>
                    run(`Removed "${name}"`, name, () => removeCategoryAction(name))
                  }
                  disabled={busy === name}
                  aria-label={`Remove ${name}`}
                  className="rounded-full p-0.5 hover:bg-destructive/20 disabled:opacity-50"
                >
                  {busy === name ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <X className="h-3 w-3" aria-hidden="true" />
                  )}
                </button>
              </Badge>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {categories.length} categor{categories.length === 1 ? "y" : "ies"} offered.
        </p>
      </CardContent>
    </Card>
  );
}
