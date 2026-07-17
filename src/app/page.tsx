"use client";

import { ProjectList } from "@/components/project/ProjectList";
import type { Project } from "@/lib/types";
import { AnimatedCubeAvatar } from "@/components/layout/AnimatedCubeAvatar";
import { useEffect, useState, useRef } from "react";
import { SpeedLinesBackground } from "@/components/layout/SpeedLinesBackground";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { FloatingAsteroids } from "@/components/layout/FloatingAsteroids";
import { cn } from "@/lib/utils";
import { CityScape } from "@/components/layout/CityScape";
import Image from "next/image";
import "./ScrollGlitch.css";
import { StellarLogo } from "@/components/layout/StellarLogo";
import { AnimatedSpaceship } from "@/components/layout/AnimatedSpaceship";
import { motion, useAnimation } from "framer-motion";
import { MouseTrail } from "@/components/layout/MouseTrail";
import { ProjectLoader } from "@/components/project/ProjectLoader";
import TradingViewWidget from "@/components/home/TradingViewWidget";
import { SectionWave } from "@/components/layout/SectionWave";
import { VerticalProjectCarousel } from "@/components/home/VerticalProjectCarousel";
import { useProjects, usePlatformInfo } from "@/context/BlockchainContext";
import TextPressure from "@/components/layout/TextPressure";
import StaticBLKFNDR from "@/components/layout/StaticBLKFNDR";
export default function Home() {
  const { projects, isLoadingProjects } = useProjects();
  const { platformInfo, isLoadingPlatform } = usePlatformInfo();

  const [featuredProjects, setFeaturedProjects] = useState<Project[]>([]);
  const [carouselProjects, setCarouselProjects] = useState<Project[]>([]);
  const heroSectionRef = useRef<HTMLElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const { user, login } = useAuth();
  const router = useRouter();

  const heroTextRef = useRef<HTMLDivElement>(null);
  const featuredTitleRef = useRef<HTMLHeadingElement>(null);
  const [isHeroTextVisible, setIsHeroTextVisible] = useState(true);
  const [isTrailActive, setIsTrailActive] = useState(false);

  // For cube drag and drop
  const controls = useAnimation();
  const [isDragging, setIsDragging] = useState(false);
  const [rotation, setRotation] = useState({ x: 0, y: 0 });

  const isLoading = isLoadingProjects || isLoadingPlatform;

  useEffect(() => {
    if (isLoading) return;

    const approvedProjects = projects.filter(
      (p) =>
        p.status === "funded" ||
        p.status === "completed" ||
        p.status === "featured" ||
        p.status === "raising" ||
        p.status === "active" ||
        p.status === "failed" ||
        p.status === "refunding",
    );
    const sorted = [...approvedProjects].sort((a, b) => {
      const aProgress = (a.currentFunding / a.fundingGoal) * 100;
      const bProgress = (b.currentFunding / b.fundingGoal) * 100;

      if (bProgress !== aProgress) {
        return bProgress - aProgress;
      }
      return (new Date(b.createdAt!) as any) - (new Date(a.createdAt!) as any);
    });

    // Carousel logic: show if 5+ projects, repeat if less than 9
    const approvedCount = sorted.length;
    let finalCarouselProjects: Project[] = [];
    if (approvedCount >= 5) {
      if (approvedCount < 9) {
        for (let i = 0; i < 9; i++) {
          finalCarouselProjects.push(sorted[i % approvedCount]);
        }
      } else {
        finalCarouselProjects = sorted.slice(0, 9);
      }
    }
    setCarouselProjects(finalCarouselProjects);
    setFeaturedProjects(sorted.slice(0, 12));
  }, [projects, isLoading]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsHeroTextVisible(!entry.isIntersecting);
      },
      {
        root: null,
        rootMargin: "0px",
        threshold: 0.1,
      },
    );

    const currentFeaturedTitle = featuredTitleRef.current;
    if (currentFeaturedTitle) {
      observer.observe(currentFeaturedTitle);
    }

    return () => {
      if (currentFeaturedTitle) {
        observer.unobserve(currentFeaturedTitle);
      }
    };
  }, []);

  const handleDragStart = () => {
    setIsDragging(true);
    controls.stop();
  };

  const handleDragEnd = (
    event: MouseEvent | TouchEvent | PointerEvent,
    info: any,
  ) => {
    setIsDragging(false);

    // Get the cube element's dimensions
    if (cubeRef.current) {
      const rect = cubeRef.current.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      // Calculate offset: default position minus half the element's dimensions
      // This ensures the center of the element returns to the intended center position
      const offsetX = -(width / 2);
      const offsetY = -(height / 2);

      controls.start({
        x: offsetX,
        y: offsetY,
        transition: { type: "spring", stiffness: 600, damping: 30 },
      });
    }
  };

  const handleHoverChange = (hovering: boolean) => {
    setIsHovering(hovering);
  };

  const showCarousel = carouselProjects.length > 0;

  return (
    <div className="flex-1">
      <section
        ref={heroSectionRef}
        className="h-screen overflow-hidden hero-light sticky top-0 z-10"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 to-slate-900 z-0"></div>
        <div className="absolute inset-0 z-[1]">
          <SpeedLinesBackground />
        </div>
        {isTrailActive && (
          <div className="absolute inset-0 z-[2]">
            <MouseTrail />
          </div>
        )}
        <div className="absolute inset-0 z-[2]">
          <FloatingAsteroids />
        </div>
        <AnimatedSpaceship />

        <div className="container mx-auto px-4 relative z-10 h-full flex flex-col justify-center">
          <motion.div
            ref={cubeRef}
            drag
            dragConstraints={heroSectionRef}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            animate={controls}
            className="absolute top-1/2 left-[60%] -translate-x-1/2 -translate-y-1/2 hidden min-[840px]:flex justify-center items-center cursor-grab active:cursor-grabbing h-48 z-20 pointer-events-auto"
          >
            <AnimatedCubeAvatar
              onHoverChange={handleHoverChange}
              isDragging={isDragging}
              rotation={rotation}
            />
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8 items-center flex-grow">
            <div className="text-center relative">
              <div
                ref={heroTextRef}
                className={cn(
                  "transition-opacity duration-500",
                  !isHeroTextVisible && "opacity-0 pointer-events-none",
                )}
              >
                <div className="flex h-32 items-start justify-center md:h-48">
                  <TextPressure
                    text="BLKFNDR"
                    minFontSize={24}
                    stroke={true}
                    strokeWidth={1}
                    textColor="white"
                    strokeColor="white"
                  />
                </div>
                <div className="text-lg md:text-xl text-white/90 max-w-2xl mx-auto mb-8">
                  A revolutionary platform for property development funding and
                  land title minting, powered by the speed and security of the
                  Stellar blockchain.
                </div>
              </div>
              <div
                className={cn(
                  "absolute inset-0 flex items-center justify-center transition-opacity duration-500",
                  isHeroTextVisible
                    ? "opacity-0 pointer-events-none"
                    : "opacity-100",
                )}
              >
                <div className="flex items-center gap-6 md:gap-10 text-white -mt-12 select-none pointer-events-none">
                  <StellarLogo className="w-24 h-24 md:w-36 md:h-36 text-white fill-white" />
                  <span className="text-6xl md:text-9xl font-light tracking-wide font-headline">Stellar</span>
                </div>
              </div>
            </div>

            {showCarousel ? (
              <div
                className={cn(
                  "h-full md:flex items-center hidden",
                  "min-[840px]:justify-center",
                )}
              >
                <div className="h-48 md:h-56">
                  <VerticalProjectCarousel projects={carouselProjects} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="relative z-20">
        <CityScape />
        <section className="sticky top-0 pb-16 pt-8 bg-card -mt-12 lg:-mt-14">
          <div className="container mx-auto px-2 sm:px-4 md:px-8">
            <div className="text-center mb-8 md:mb-12">
              <h2
                ref={featuredTitleRef}
                className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-accent font-headline"
              >
                Featured Projects
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground mt-2">
                Check out some of the most popular projects on our platform.
              </p>
            </div>
            {isLoading ? (
              <ProjectLoader />
            ) : (
              <ProjectList
                projects={featuredProjects}
                onlyShowCompletedStatus={true}
              />
            )}
          </div>
        </section>

        <section className="sticky top-0 min-h-[60vh] md:h-screen flex flex-col justify-center bg-background">
          <SectionWave />
          <div className="container mx-auto px-2 sm:px-4 md:px-8 flex flex-col h-full py-8 md:py-12 -mt-12">
            <div className="text-center mb-8 md:mb-12">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-accent font-headline">
                Stellar Market Overview
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground mt-2">
                Track XLM performance against other stablecoins in real-time.
              </p>
            </div>
            <div className="rounded-lg border overflow-hidden flex-grow">
              <TradingViewWidget />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
