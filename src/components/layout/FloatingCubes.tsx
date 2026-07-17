
"use client";

import { useEffect, useState } from 'react';
import './FloatingCubes.css';

interface Cube {
  id: number;
  style: React.CSSProperties;
  size: number;
  spinDuration: number;
}

export function FloatingCubes() {
  const [cubes, setCubes] = useState<Cube[]>([]);

  useEffect(() => {
    const generateCubes = () => {
      const newCubes = Array.from({ length: 15 }).map((_, i) => {
        const size = Math.random() * 40 + 10; // 10px to 50px
        const startY = Math.random() * 100; // 0% to 100% of height
        const endY = startY + (Math.random() - 0.5) * 20; // Drift up or down
        const floatDuration = Math.random() * 20 + 15; // 15s to 35s
        const spinDuration = Math.random() * 10 + 5; // 5s to 15s
        const delay = Math.random() * 15; // 0s to 15s delay

        return {
          id: i,
          size,
          style: {
            width: `${size}px`,
            height: `${size}px`,
            top: `${startY}%`,
            left: '-50px', // Start off-screen
            animationDuration: `${floatDuration}s`,
            animationDelay: `${delay}s`,
            '--start-y': `${startY}%`,
            '--end-y': `${endY}%`,
          } as React.CSSProperties,
          spinDuration,
        };
      });
      setCubes(newCubes);
    };

    generateCubes();
  }, []);

  return (
    <div className="floating-cubes-container">
      {cubes.map(cube => (
        <div key={cube.id} className="floating-cube-scene" style={cube.style}>
          <div
            className="floating-cube"
            style={{
              animationDuration: `${cube.spinDuration}s`,
              '--cube-size-half': `${cube.size / 2}px`,
            } as React.CSSProperties}
          >
            <div className="face front"></div>
            <div className="face back"></div>
            <div className="face right"></div>
            <div className="face left"></div>
            <div className="face top"></div>
            <div className="face bottom"></div>
          </div>
        </div>
      ))}
    </div>
  );
}
