// Component ported from https://codepen.io/JuanFuentes/full/rgXKGQ
'use client';
import { useEffect, useRef, useState } from 'react';

interface TextPressureProps {
  text?: string;
  fontFamily?: string;
  /** Only needed for a self-hosted face. Omit to use a font already loaded by the document. */
  fontUrl?: string;
  width?: boolean;
  weight?: boolean;
  italic?: boolean;
  alpha?: boolean;
  flex?: boolean;
  stroke?: boolean;
  scale?: boolean;
  textColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  className?: string;
  minFontSize?: number;
  interactive?: boolean;
}

// Roboto Flex's real axis ranges, as requested in layout.tsx. Feeding a value
// outside these does not error — the browser just clamps it — but keeping the
// interpolation inside the range is what stops the effect flattening out at
// the extremes.
const WGHT = { min: 100, max: 900 };
const SLNT = { min: 0, max: 10 };
// Narrower than the font's full 25..151 on purpose. The ceiling is held down
// because the letters are laid out with `justify-between`, so their combined
// advance has to stay inside the container or the wordmark clips; the floor is
// held up because Roboto Flex at wdth 25 is spindly enough to read as a
// rendering fault at display size.
const WDTH = { min: 60, max: 125 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const TextPressure: React.FC<TextPressureProps> = ({
  text = 'BLKFNDR',
  fontFamily = 'Roboto Flex',
  fontUrl,
  width = true,
  weight = true,
  italic = true,
  alpha = false,
  flex = true,
  stroke = false,
  scale = false,
  textColor = 'hsl(var(--foreground))',
  strokeColor = 'hsl(var(--primary))',
  strokeWidth = 2,
  className = '',
  minFontSize = 24,
  interactive = true
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const spansRef = useRef<(HTMLSpanElement | null)[]>([]);

  const mouseRef = useRef({ x: 0, y: 0 });
  const cursorRef = useRef({ x: 0, y: 0 });

  const [fontSize, setFontSize] = useState(minFontSize);
  const [scaleY, setScaleY] = useState(1);
  const [lineHeight, setLineHeight] = useState(1);

  const chars = text.split('');

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  useEffect(() => {
    if (!interactive) return;

    const handleMouseMove = (e: MouseEvent) => {
      cursorRef.current.x = e.clientX;
      cursorRef.current.y = e.clientY;
    };
    const handleTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      cursorRef.current.x = t.clientX;
      cursorRef.current.y = t.clientY;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });

    if (containerRef.current) {
      const { left, top, width, height } = containerRef.current.getBoundingClientRect();
      mouseRef.current.x = left + width / 2;
      mouseRef.current.y = top + height / 2;
      cursorRef.current.x = mouseRef.current.x;
      cursorRef.current.y = mouseRef.current.y;
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, [interactive]);

  const setSize = () => {
    if (!containerRef.current || !titleRef.current) return;

    const { width: containerW, height: containerH } = containerRef.current.getBoundingClientRect();

    // The old divisor (chars.length / 2) was tuned for an ultra-condensed face.
    // Roboto Flex's uppercase advances are far wider, so the same divisor
    // overflowed the container. 0.78em per character fills the width at rest
    // while still fitting the worst case — every letter at once at WDTH.max
    // *and* WGHT.max. Weight widens the glyphs too, so sizing off the width
    // axis alone still overflows.
    let newFontSize = containerW / (chars.length * 0.78);
    newFontSize = Math.max(newFontSize, minFontSize);

    setFontSize(newFontSize);
    setScaleY(1);
    setLineHeight(1);

    requestAnimationFrame(() => {
      if (!titleRef.current) return;
      const textRect = titleRef.current.getBoundingClientRect();

      if (scale && textRect.height > 0) {
        const yRatio = containerH / textRect.height;
        setScaleY(yRatio);
        setLineHeight(yRatio);
      }
    });
  };

  useEffect(() => {
    setSize();
    window.addEventListener('resize', setSize);
    return () => window.removeEventListener('resize', setSize);
  }, [scale, text]);

  useEffect(() => {
    let rafId: number;
    const animate = () => {
      mouseRef.current.x += (cursorRef.current.x - mouseRef.current.x) / 15;
      mouseRef.current.y += (cursorRef.current.y - mouseRef.current.y) / 15;

      if (titleRef.current) {
        const titleRect = titleRef.current.getBoundingClientRect();
        const maxDist = titleRect.width / 2;

        spansRef.current.forEach(span => {
          if (!span) return;

          const rect = span.getBoundingClientRect();
          const charCenter = {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2
          };

          const d = dist(mouseRef.current, charCenter);

          const getAttr = (distance: number, minVal: number, maxVal: number) => {
            const val = maxVal - Math.abs((maxVal * distance) / maxDist);
            return Math.max(minVal, val + minVal);
          };

          const wdth = width
            ? clamp(Math.floor(getAttr(d, WDTH.min, WDTH.max)), WDTH.min, WDTH.max)
            : 100;
          const wght = weight
            ? clamp(Math.floor(getAttr(d, WGHT.min, WGHT.max)), WGHT.min, WGHT.max)
            : 400;
          // Roboto Flex slants on `slnt` (0 to -10 degrees); it has no `ital`
          // axis, so the old 'ital' setting was silently doing nothing.
          const slnt = italic
            ? -clamp(getAttr(d, SLNT.min, SLNT.max), SLNT.min, SLNT.max)
            : 0;
          const alphaVal = alpha ? getAttr(d, 0, 1).toFixed(2) : '1';

          span.style.opacity = alphaVal;
          span.style.fontVariationSettings = `'wght' ${wght}, 'wdth' ${wdth}, 'slnt' ${slnt.toFixed(2)}`;
        });
      }

      rafId = requestAnimationFrame(animate);
    };

    if (interactive) {
      animate();
    } else {
      if (titleRef.current) {
        spansRef.current.forEach(span => {
          if (!span) return;
          span.style.opacity = '1';
          span.style.fontVariationSettings = `'wght' 400, 'wdth' 100, 'slnt' 0`;
        });
      }
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [width, weight, italic, alpha, chars.length, interactive]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-transparent">
      <style>{`
        ${fontUrl ? `@font-face {
          font-family: '${fontFamily}';
          src: url('${fontUrl}') format('woff2-variations');
          font-weight: 100 1000;
          font-display: swap;
          font-style: normal;
        }` : ''}
        .stroke span {
          position: relative;
        }
        .stroke span::after {
          content: attr(data-char);
          position: absolute;
          left: 0;
          top: 0;
          color: transparent;
          z-index: -1;
          -webkit-text-stroke-width: ${strokeWidth}px;
          -webkit-text-stroke-color: ${strokeColor};
        }
      `}</style>

      <h1
        ref={titleRef}
        className={`text-pressure-title ${className} ${flex ? 'flex justify-between' : ''
          } ${stroke ? 'stroke' : ''} uppercase text-center`}
        style={{
          // Fallback stack matters: without one, a failed webfont drops the
          // wordmark to the browser's default serif at display size.
          fontFamily: `'${fontFamily}', 'Inter', sans-serif`,
          fontSize: fontSize,
          color: textColor,
          lineHeight,
          transform: `scale(1, ${scaleY})`,
          transformOrigin: 'center top',
          margin: 0,
          fontWeight: 100,
        }}
      >
        {chars.map((char, i) => (
          <span
            key={i}
            ref={el => {
              spansRef.current[i] = el;
            }}
            data-char={char}
            className="inline-block"
          >
            {char}
          </span>
        ))}
      </h1>
    </div>
  );
};

export default TextPressure;
