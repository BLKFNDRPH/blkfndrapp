'use client';
import React from 'react';
import { cn } from '@/lib/utils';

const StaticBLKFNDR: React.FC<{ className?: string, textColor?: string }> = ({ className, textColor }) => {
  const text = 'BLKFNDR';
  // Was "Compressa VF", loaded from a Cloudinary URL that now 404s — which left
  // every wordmark in the app rendering as the default serif. Roboto Flex is
  // already loaded document-wide in layout.tsx with the wght/wdth/slnt axes.
  const fontFamily = "'Roboto Flex', 'Inter', sans-serif";

  // Gradual weight + slant per character (centre heaviest). Roboto Flex slants
  // on `slnt` in degrees, 0 to -10; it has no `ital` axis.
  const styles = [
    { wght: 200, slnt: 0 }, // B - thinnest
    { wght: 400, slnt: -2 }, // L
    { wght: 600, slnt: -5 }, // K
    { wght: 800, slnt: -10 }, // F - boldest, most slanted
    { wght: 600, slnt: -5 }, // N
    { wght: 400, slnt: -2 }, // D
    { wght: 200, slnt: 0 }, // R - thinnest
  ];

  return (
    <span className={cn("inline-flex justify-center items-center bg-transparent", className)}>
      <span
        className="uppercase tracking-widest text-center"
        style={{
          fontFamily,
          fontSize: '1em', // Use em to be scalable by parent
          margin: 0,
          lineHeight: 1,
          color: textColor || 'hsl(var(--foreground))',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {text.split('').map((char, i) => (
          <span
            key={i}
            style={{
              fontVariationSettings: `'wght' ${styles[i].wght}, 'slnt' ${styles[i].slnt}, 'wdth' 75`,
              transition: 'all 0.3s ease',
              margin: '0 0.05em',
            }}
          >
            {char}
          </span>
        ))}
      </span>
    </span>
  );
};

export default StaticBLKFNDR;
