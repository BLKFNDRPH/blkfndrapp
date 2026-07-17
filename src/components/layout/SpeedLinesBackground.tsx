
"use client";

import { useEffect, useState } from 'react';
import './SpeedLinesBackground.css';

export function SpeedLinesBackground() {
  const [lines, setLines] = useState<JSX.Element[]>([]);

  useEffect(() => {
    const generateLines = () => {
      const newLines = Array.from({ length: 20 }).map((_, i) => {
        const duration = Math.random() * 2 + 1; // 1s to 3s
        const delay = Math.random() * 2; // 0s to 2s
        const top = Math.random() * 100;
        
        return (
          <div
            key={i}
            className="speed-line"
            style={{
              animationDuration: `${duration}s`,
              animationDelay: `${delay}s`,
              height: `${Math.random() * 2 + 1}px`, // Varying thickness
              top: `${top}%`,
            }}
          />
        );
      });
      setLines(newLines);
    };

    generateLines();
  }, []);

  return <div className="speed-lines-container">{lines}</div>;
}
