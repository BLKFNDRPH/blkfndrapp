
"use client";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { projectCategories } from "@/lib/categories";
import { cn } from "@/lib/utils";
import {
  Leaf, Film, BrainCircuit, Network, Users, ShoppingCart, GraduationCap, Sprout,
  Shirt, Video, Utensils, Gamepad2, HardDrive, HeartPulse, Building, Music, Home,
  Server, Smartphone, Car, Palette, Rocket, Phone, Globe, X
} from "lucide-react";

interface CategoryFilterProps {
  categories: string[];
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
}

const categoryIcons: { [key: string]: React.ElementType } = {
  "Explore": Globe,
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
  "Sports": Gamepad2,
  "Startups": Rocket,
  "Tele-communications": Phone,
  "Transportation": Car,
  "Visual Arts": Palette,
};

export function CategoryFilter({ categories, selectedCategory, onSelectCategory }: CategoryFilterProps) {
  const Icon = ({ category }: { category: string }) => {
    const IconComponent = categoryIcons[category] || Globe;
    return <IconComponent className="h-6 w-6 mb-2" />;
  };

  const handleCategoryClick = (category: string) => {
    if (category === 'Explore') {
      onSelectCategory('Explore');
    } else {
      onSelectCategory(category);
    }
  };

  return (
    <div className="relative">
      <Carousel
        opts={{
          align: "start",
          dragFree: true,
        }}
        className="w-full"
      >
        <CarouselContent>
          {categories.map((category) => (
            <CarouselItem key={category} className="basis-auto">
              <Button
                variant={selectedCategory === category ? "secondary" : "ghost"}
                className="h-auto flex flex-col items-center justify-center p-3 gap-1 w-24"
                onClick={() => handleCategoryClick(category)}
              >
                <Icon category={category} />
                <span className="text-xs text-center w-full whitespace-normal h-8 flex items-center justify-center">{category}</span>
              </Button>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="hidden sm:flex" />
        <CarouselNext className="hidden sm:flex" />
      </Carousel>
      {selectedCategory && selectedCategory !== 'Explore' && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1/2 -right-12 -translate-y-1/2 rounded-full h-8 w-8"
          onClick={() => onSelectCategory('Explore')}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Clear category filter</span>
        </Button>
      )}
    </div>
  );
}
