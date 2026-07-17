"use client";

import type { Project } from "@/lib/types";
import { formatCurrency } from "@/lib/formatters";
import "./VerticalProjectCarousel.css";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { ImageWithFallback } from "../ui/image-with-fallback";
import { Heart } from "lucide-react";

interface VerticalProjectCarouselProps {
  projects: Project[];
}

export function VerticalProjectCarousel({
  projects,
}: VerticalProjectCarouselProps) {
  const { openProjectDetails } = useProjectDetails();

  if (projects.length === 0) {
    return null;
  }

  const totalAnimationTime = 27; // Corresponds to the CSS animation duration
  const itemDelay = 3; // Corresponds to the delay between items in the CSS example

  const capitalizeTitle = (title: string) => {
    return title
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  return (
    <div className="carousel-wrapper">
      <div className="carousel">
        {projects.map((project, index) => {
          let animationDelay;
          if (index === 0) {
            animationDelay = `calc(${itemDelay}s * -1)`;
          } else if (index === 1) {
            animationDelay = `calc(${itemDelay}s * 0)`;
          } else if (index === projects.length - 1) {
            animationDelay = `calc(-${itemDelay}s * 2)`;
          } else {
            animationDelay = `calc(${itemDelay}s * ${index - 1})`;
          }

          return (
            <div
              key={`${project.id}-${index}`}
              className="carousel__item"
              style={{ animationDelay }}
              onClick={() => openProjectDetails(project)}
            >
              <div className="carousel__item-head">
                <ImageWithFallback
                  src={project.imageUrl}
                  alt={project.title}
                  className="w-full h-full object-cover"
                  width={90}
                  height={90}
                />
              </div>
              <div className="carousel__item-body">
                <div className="carousel-item-content">
                  <p className="title">{capitalizeTitle(project.title)}</p>
                  <div className="flex items-center justify-center mt-2">
                    <p className="text-xl font-bold flex items-center gap-2">
                      <span className="text-[#0d2c54]">
                        {formatCurrency(
                          project.fundingGoal,
                          project.currencyType ?? "XLM",
                          false,
                        )}
                        {project.currencyType &&
                          project.currencyType !== "XLM" && (
                            <span className="text-sm ml-1">
                              {project.currencyType}
                            </span>
                          )}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="carousel-extras">
                  <div className="star-container">
                    <div className="rotating-star"></div>
                    <Heart className="heart-icon" />
                  </div>
                  <img
                    src={project.creatorAvatar}
                    alt={project.creator}
                    className="creator-avatar"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
