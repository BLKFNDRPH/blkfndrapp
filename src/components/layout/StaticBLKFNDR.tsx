'use client';
import React from 'react';
import { cn } from '@/lib/utils';

const StaticBLKFNDR: React.FC<{ className?: string, textColor?: string }> = ({ className, textColor }) => {
  const text = 'BLKFNDR';
  // @font-face lives in globals.css so the file is fetched once, not per instance.
  const fontFamily = 'Roboto Flex Variable';

  // Assign gradual weight + lean per character (center heaviest).
  // `lean` is 0..1 and maps onto the font's `slnt` axis (0deg..-10deg).
  const styles = [
    { wght: 200, lean: 0 }, // B - thinnest
    { wght: 400, lean: 0.2 }, // L
    { wght: 600, lean: 0.5 }, // K
    { wght: 800, lean: 1 }, // F - boldest, most slanted
    { wght: 600, lean: 0.5 }, // N
    { wght: 400, lean: 0.2 }, // D
    { wght: 200, lean: 0 }, // R - thinnest
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
              fontVariationSettings: `'wght' ${styles[i].wght}, 'slnt' ${(-10 * styles[i].lean).toFixed(1)}, 'wdth' 100`,
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
