// Component ported from https://codepen.io/JuanFuentes/full/rgXKGQ
'use client';
import { useEffect, useRef, useState } from 'react';

interface TextPressureProps {
  text?: string;
  fontFamily?: string;
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

const TextPressure: React.FC<TextPressureProps> = ({
  text = 'BLKFNDR',
  // @font-face lives in globals.css so the file is fetched once, not per instance.
  fontFamily = 'Roboto Flex Variable',
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

  // The pressure effect follows the pointer, and costs nothing when nothing
  // moves. It used to run a frame loop forever, for every visitor, on or off
  // screen, reading each letter's box between style writes, which forced a
  // fresh layout of the variable font once per letter per frame: seconds of
  // main thread on a phone, where no cursor ever moves. Now a frame runs only
  // while the eased position is still catching up with the pointer, and only
  // while the wordmark is on screen; reads come before writes in each frame;
  // reduced motion gets the still wordmark.
  useEffect(() => {
    const still = () => {
      spansRef.current.forEach(span => {
        if (!span) return;
        span.style.opacity = '1';
        span.style.fontVariationSettings = `'wght' 400, 'wdth' 100, 'slnt' 0`;
      });
    };

    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!interactive || reducedMotion) {
      still();
      return;
    }

    let rafId = 0;
    let visible = true;

    const frame = () => {
      rafId = 0;
      const mouse = mouseRef.current;
      const cursor = cursorRef.current;
      mouse.x += (cursor.x - mouse.x) / 15;
      mouse.y += (cursor.y - mouse.y) / 15;
      const settled = Math.abs(cursor.x - mouse.x) < 0.5 && Math.abs(cursor.y - mouse.y) < 0.5;
      if (settled) {
        mouse.x = cursor.x;
        mouse.y = cursor.y;
      }

      const title = titleRef.current;
      if (title) {
        // Every read first, then every write: one layout per frame, not one per letter.
        const maxDist = title.getBoundingClientRect().width / 2;
        const centers = spansRef.current.map(span => {
          if (!span) return null;
          const rect = span.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });

        const getAttr = (distance: number, minVal: number, maxVal: number) => {
          const val = maxVal - Math.abs((maxVal * distance) / maxDist);
          return Math.max(minVal, val + minVal);
        };

        spansRef.current.forEach((span, i) => {
          const center = centers[i];
          if (!span || !center) return;
          const d = dist(mouse, center);
          // Ranges are clamped to the font's own axes (wght 100..1000, wdth 25..151,
          // slnt 0..-10deg) so cursor travel maps onto the axis instead of saturating.
          const wdth = width ? Math.floor(getAttr(d, 25, 126)) : 100;
          const wght = weight ? Math.floor(getAttr(d, 100, 900)) : 400;
          const slntVal = italic ? (-10 * getAttr(d, 0, 1)).toFixed(2) : '0';
          const alphaVal = alpha ? getAttr(d, 0, 1).toFixed(2) : '1';
          span.style.opacity = alphaVal;
          span.style.fontVariationSettings = `'wght' ${wght}, 'wdth' ${wdth}, 'slnt' ${slntVal}`;
        });
      }

      if (!settled && visible) rafId = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (!rafId && visible) rafId = requestAnimationFrame(frame);
    };

    const handleMouseMove = (e: MouseEvent) => {
      cursorRef.current.x = e.clientX;
      cursorRef.current.y = e.clientY;
      wake();
    };
    const handleTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      cursorRef.current.x = t.clientX;
      cursorRef.current.y = t.clientY;
      wake();
    };

    window.addEventListener('mousemove', handleMouseMove);
    // Passive: this only reads the touch, and a non-passive listener on the
    // window makes the browser wait on it before every scroll.
    window.addEventListener('touchmove', handleTouchMove, { passive: true });

    if (containerRef.current) {
      const { left, top, width: w, height: h } = containerRef.current.getBoundingClientRect();
      mouseRef.current.x = left + w / 2;
      mouseRef.current.y = top + h / 2;
      cursorRef.current.x = mouseRef.current.x;
      cursorRef.current.y = mouseRef.current.y;
    }

    const observer =
      typeof IntersectionObserver === 'function' && containerRef.current
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible) wake();
            else if (rafId) {
              cancelAnimationFrame(rafId);
              rafId = 0;
            }
          })
        : null;
    if (observer && containerRef.current) observer.observe(containerRef.current);

    // One frame for the resting shape, centred on the wordmark.
    wake();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      observer?.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [width, weight, italic, alpha, chars.length, interactive]);

  const setSize = () => {
    if (!containerRef.current || !titleRef.current) return;

    const { width: containerW, height: containerH } = containerRef.current.getBoundingClientRect();

    // The original divisor (chars.length / 2) was tuned for the ultra-condensed
    // face this component was written against. Roboto Flex's uppercase advances
    // are far wider, so that divisor overflows the container: the letters are
    // laid out with `justify-between`, so their combined advance has to fit or
    // the wordmark clips. 0.78em per character fits the worst case — every
    // letter at once at the top of both the wdth *and* wght ranges, since
    // weight widens glyphs too and sizing off wdth alone still overflows.
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


  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-transparent">
      <style>{`
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
          fontFamily: `'${fontFamily}', var(--font-inter), sans-serif`,
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
