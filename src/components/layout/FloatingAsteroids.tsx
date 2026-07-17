"use client";

import React, { useEffect, useState } from "react";
import "./FloatingAsteroids.css";

interface Asteroid {
  id: number;
  style: React.CSSProperties;
  size: number;
  spinDuration: number;
}

export function FloatingAsteroids() {
  const [asteroids, setAsteroids] = useState<Asteroid[]>([]);

  useEffect(() => {
    const generateAsteroids = () => {
      const newAsteroids = Array.from({ length: 18 }).map((_, i) => {
        const size = Math.random() * 45 + 15;
        const startY = Math.random() * 100;
        const endY = startY + (Math.random() - 0.5) * 30;
        const floatDuration = Math.random() * 25 + 20;
        const spinDuration = Math.random() * 16 + 10;
        const delay = Math.random() * 20;

        return {
          id: i,
          size,
          style: {
            width: `${size}px`,
            height: `${size}px`,
            top: `${startY}%`,
            left: "-70px",
            animationDuration: `${floatDuration}s`,
            animationDelay: `${delay}s`,
            "--start-y": `${startY}%`,
            "--end-y": `${endY}%`,
          } as React.CSSProperties,
          spinDuration,
        };
      });
      setAsteroids(newAsteroids);
    };

    generateAsteroids();
  }, []);

  return (
    <div className="floating-asteroids-container">
      {asteroids.map((asteroid) => (
        <div
          key={asteroid.id}
          className="floating-asteroid-scene"
          style={asteroid.style}
        >
          <div
            className="floating-asteroid"
            style={{
              animationDuration: `${asteroid.spinDuration}s`,
              "--cube-size-half": `${asteroid.size / 2}px`,
            } as React.CSSProperties}
          >
            {/* 3D Realistic Lunar/Asteroid Faces with distributed craters */}
            <div className="face front">
              <div className="crater c-lg p1"></div>
              <div className="crater c-sm p2"></div>
              <div className="crater c-md p3"></div>
            </div>
            <div className="face back">
              <div className="crater c-md p4"></div>
              <div className="crater c-sm p5"></div>
              <div className="crater c-lg p6"></div>
            </div>
            <div className="face right">
              <div className="crater c-sm p7"></div>
              <div className="crater c-lg p8"></div>
              <div className="crater c-md p9"></div>
            </div>
            <div className="face left">
              <div className="crater c-lg p10"></div>
              <div className="crater c-sm p11"></div>
              <div className="crater c-md p12"></div>
            </div>
            <div className="face top">
              <div className="crater c-md p13"></div>
              <div className="crater c-lg p14"></div>
              <div className="crater c-sm p15"></div>
            </div>
            <div className="face bottom">
              <div className="crater c-sm p16"></div>
              <div className="crater c-md p17"></div>
              <div className="crater c-lg p18"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default React.memo(FloatingAsteroids);
