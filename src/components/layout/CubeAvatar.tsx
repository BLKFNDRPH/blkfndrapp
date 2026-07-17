"use client";

import React, { useState, useEffect, useRef } from "react";
import "./CubeAvatar.css";

export function CubeAvatar() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setMousePos({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  const eyeRef = useRef<HTMLDivElement>(null);

  let eyeX = 0;
  let eyeY = 0;

  if (eyeRef.current) {
    const rect = eyeRef.current.getBoundingClientRect();
    const anchorX = rect.left + rect.width / 2;
    const anchorY = rect.top + rect.height / 2;
    const deltaX = mousePos.x - anchorX;
    const deltaY = mousePos.y - anchorY;

    const angle = Math.atan2(deltaY, deltaX);
    const distance = Math.min(Math.sqrt(deltaX * deltaX + deltaY * deltaY), 2);
    eyeX = Math.cos(angle) * distance;
    eyeY = Math.sin(angle) * distance;
  }

  const cubeRotateY = mousePos.x
    ? (mousePos.x / window.innerWidth - 0.5) * 40
    : 0;
  const cubeRotateX = mousePos.y
    ? -(mousePos.y / window.innerHeight - 0.5) * 40
    : 0;

  return (
    <div className="scene">
      <div
        className="cube"
        style={{
          transform: `rotateX(${cubeRotateX}deg) rotateY(${cubeRotateY}deg)`,
        }}
      >
        <div className="face front">
          <div className="eyes">
            <div className="eye" ref={eyeRef}>
              <div
                className="pupil"
                style={{ transform: `translate(${eyeX}px, ${eyeY}px)` }}
              >
                <div className="highlight" />
              </div>
            </div>
            <div className="eye">
              <div
                className="pupil"
                style={{ transform: `translate(${eyeX}px, ${eyeY}px)` }}
              >
                <div className="highlight" />
              </div>
            </div>
          </div>
          <div className="mouth" />
        </div>
        <div className="face back" />
        <div className="face right" />
        <div className="face left" />
        <div className="face top" />
        <div className="face bottom" />
      </div>
    </div>
  );
}
