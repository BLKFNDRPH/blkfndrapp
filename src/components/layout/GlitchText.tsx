
'use client';

import React, { useState, useEffect } from 'react';
import './GlitchText.css';
import { cn } from '@/lib/utils';

interface GlitchTextProps {
  text: string;
  className?: string;
  isGlitching: boolean;
}

export function GlitchText({ text, className, isGlitching }: GlitchTextProps) {
  const stacks = 3;
  const [isClient, setIsClient] = useState(false);
  
  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null;
  }
  
  return (
    <div
      className={cn(
        "stack font-logo font-bold uppercase",
        !isGlitching && "glitching-out",
        className
      )}
      style={{ '--stacks': stacks } as React.CSSProperties}
    >
      {Array.from({ length: stacks }).map((_, i) => (
        <span
          key={i}
          style={{ '--index': i } as React.CSSProperties}
        >
          {text}
        </span>
      ))}
    </div>
  );
}
