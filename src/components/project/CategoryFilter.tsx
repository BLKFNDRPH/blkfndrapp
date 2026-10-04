"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Leaf, Film, BrainCircuit, Network, Users, ShoppingCart, GraduationCap, Sprout,
  Shirt, Video, Utensils, Gamepad2, HardDrive, HeartPulse, Building, Music, Home,
  Server, Smartphone, Car, Palette, Rocket, Phone, Globe, Trophy, LayoutGrid,
} from "lucide-react";

/**
 * The category strip: one row of single-select chips.
 *
 * On a phone the row scrolls sideways under the thumb; on a wider screen it
 * wraps so every category is a tap away. "All" is always first and is the
 * selected chip whenever no category is chosen (`selectedCategory === null`).
 */

interface CategoryFilterProps {
  /** Every category to offer, without an "All" entry — the strip adds its own. */
  categories: string[];
  /** The chosen category, or null for all of them. */
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
}

const categoryIcons: { [key: string]: React.ElementType } = {
  "Agriculture": Leaf,
  "Animation": Film,
  "Artificial Intelligence": BrainCircuit,
  "Blockchain": Network,
  "Community": Users,
  "Culture & Heritage": Globe,
  "E-commerce": ShoppingCart,
  "Education": GraduationCap,
  "Environment": Sprout,
  "Fashion & Design": Shirt,
  "Film/Video": Video,
  "Food & Beverage": Utensils,
  "Gaming": Gamepad2,
  "Hardware": HardDrive,
  "Healthcare": HeartPulse,
  "Infrastructure & Energy": Building,
  "Music": Music,
  "Real Estate": Home,
  "Services": Server,
  "Smart Devices": Smartphone,
  "Software": Server,
  "Sports": Trophy,
  "Startups": Rocket,
  "Tele-communications": Phone,
  "Transportation": Car,
  "Visual Arts": Palette,
};

function Chip({
  label,
  icon: Icon,
  selected,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={selected ? "default" : "outline"}
      size="sm"
      role="radio"
      aria-checked={selected}
      className={cn(
        "h-9 shrink-0 snap-start gap-1.5 rounded-full px-3 text-sm font-medium",
        selected && "bg-accent text-accent-foreground hover:bg-accent/90",
      )}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="whitespace-nowrap">{label}</span>
    </Button>
  );
}

export function CategoryFilter({
  categories,
  selectedCategory,
  onSelectCategory,
}: CategoryFilterProps) {
  const unique = categories.filter((c, i) => c && categories.indexOf(c) === i);

  return (
    <div
      role="radiogroup"
      aria-label="Category"
      className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
    >
      <Chip
        label="All"
        icon={LayoutGrid}
        selected={selectedCategory === null}
        onClick={() => onSelectCategory(null)}
      />
      {unique.map((category) => (
        <Chip
          key={category}
          label={category}
          icon={categoryIcons[category] || Globe}
          selected={selectedCategory === category}
          onClick={() =>
            onSelectCategory(selectedCategory === category ? null : category)
          }
        />
      ))}
    </div>
  );
}
