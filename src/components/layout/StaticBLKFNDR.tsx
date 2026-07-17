'use client';
import React from 'react';
import { cn } from '@/lib/utils';

const StaticBLKFNDR: React.FC<{ className?: string, textColor?: string }> = ({ className, textColor }) => {
  const text = 'BLKFNDR';
  const fontFamily = 'Compressa VF';
  const fontUrl =
    'https://res.cloudinary.com/dr6lvwubh/raw/upload/v1529908256/CompressaPRO-GX.woff2';

  // Assign gradual weight + italic per character (center heaviest)
  const styles = [
    { wght: 200, ital: 0 }, // B - thinnest
    { wght: 400, ital: 0.2 }, // L
    { wght: 600, ital: 0.5 }, // K
    { wght: 800, ital: 1 }, // F - boldest, most italic
    { wght: 600, ital: 0.5 }, // N
    { wght: 400, ital: 0.2 }, // D
    { wght: 200, ital: 0 }, // R - thinnest
  ];

  return (
    <span className={cn("inline-flex justify-center items-center bg-transparent", className)}>
      <style>{`
        @font-face {
          font-family: '${fontFamily}';
          src: url('${fontUrl}');
          font-style: normal;
        }
      `}</style>

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
              fontVariationSettings: `'wght' ${styles[i].wght}, 'ital' ${styles[i].ital}, 'wdth' 100`,
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
