"use client";

import React, { useState, useEffect, useRef } from "react";
import "./CubeAvatar.css";
import { cn } from "@/lib/utils";
import { StellarLogo } from "./StellarLogo";
import { PcbPattern } from "./PcbPattern";

interface AnimatedCubeAvatarProps {
  onHoverChange: (isHovering: boolean) => void;
  isDragging: boolean;
  rotation: { x: number; y: number };
}

export function AnimatedCubeAvatar({
  onHoverChange,
  isDragging,
  rotation: externalRotation,
}: AnimatedCubeAvatarProps) {
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [pupilPosition, setPupilPosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const eyeRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    onHoverChange(isHovering);
  }, [isHovering, onHoverChange]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!eyeRef.current || isDragging) return;

      const rect = eyeRef.current.getBoundingClientRect();
      const anchorX = rect.left + rect.width / 2;
      const anchorY = rect.top + rect.height / 2;

      const deltaX = event.clientX - anchorX;
      const deltaY = event.clientY - anchorY;

      const angle = Math.atan2(deltaY, deltaX);
      const distance = Math.min(
        Math.sqrt(deltaX * deltaX + deltaY * deltaY) * 0.1,
        8,
      );

      setPupilPosition({
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
      });
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [isDragging]);

  useEffect(() => {
    const animate = (time: number) => {
      if (!isHovering && !isDragging) {
        const speed = 0.04; // Degrees per frame
        setRotation((prev) => ({
          x: (prev.x + speed) % 360,
          y: (prev.y + speed) % 360,
        }));
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isHovering, isDragging]);

  const finalRotation = isDragging
    ? { x: externalRotation.x, y: externalRotation.y }
    : rotation;

  const Mouth = () => {
    return (
      <div className="w-12 h-4 border-b-4 border-white rounded-b-full"></div>
    );
  };

  const Eye = ({
    isRef = false,
    side,
  }: {
    isRef?: boolean;
    side: "left" | "right";
  }) => (
    <div
      ref={isRef ? eyeRef : null}
      className="relative w-12 h-16 flex items-center justify-center"
    >
      {isHovering || isDragging ? (
        <div className="w-8 h-8 text-white text-5xl font-black">
          {side === "left" ? ">" : "<"}
        </div>
      ) : (
        <>
          <div className="absolute w-12 h-16 bg-white rounded-full border-2 border-gray-800" />
          <div
            className="absolute w-8 h-8 bg-gray-800 rounded-full transition-transform duration-200 ease-out"
            style={{
              transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
            }}
          ></div>
          <div className="absolute top-3 left-4 w-3 h-3 bg-white rounded-full opacity-80"></div>
        </>
      )}
    </div>
  );

  const Blush = () => (
    <div
      className={cn(
        "absolute top-[100px] w-full h-6 bg-red-400/50 rounded-full blur-md transition-opacity",
        isHovering || isDragging
          ? "opacity-100 duration-2000"
          : "opacity-0 duration-1000",
      )}
    ></div>
  );

  return (
    <div
      className="scene !w-40 !h-40 z-10"
      ref={avatarRef}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {(isHovering || isDragging) && (
        <div className="speech-bubble">
          <StellarLogo className="h-6 w-6 text-black-400" />
          Stellar!!
        </div>
      )}
      <div
        className="cube !w-full !h-full"
        style={{
          transition: "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
          transform: isDragging
            ? `rotateX(${externalRotation.x}deg) rotateY(${externalRotation.y}deg)`
            : isHovering
              ? "rotateX(0deg) rotateY(0deg)"
              : `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
        }}
      >
        <div
          className={cn(
            "face front !w-40 !h-40 !translate-z-[80px] rounded-2xl items-start pt-10",
          )}
        >
          <div className="eyes !gap-5">
            <Eye isRef={true} side="left" />
            <Eye side="right" />
          </div>
          <Blush />
          <div className="absolute top-[120px] left-1/2 -translate-x-1/2 flex justify-center mt-2">
            <Mouth />
          </div>
        </div>
        <div className="face back !w-40 !h-40 !translate-z-[80px] rounded-2xl">
          <PcbPattern />
        </div>
        <div className="face right !w-40 !h-40 !translate-z-[80px] rounded-2xl">
          <PcbPattern />
        </div>
        <div className="face left !w-40 !h-40 !translate-z-[80px] rounded-2xl">
          <PcbPattern />
        </div>
        <div className="face top !w-40 !h-40 !translate-z-[80px] rounded-2xl">
          <PcbPattern />
        </div>
        <div className="face bottom !w-40 !h-40 !translate-z-[80px] rounded-2xl">
          <PcbPattern />
        </div>
      </div>
    </div>
  );
}
