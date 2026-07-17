"use client";

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface ImageWithFallbackProps {
  src: string;
  alt: string;
  className?: string;
  fill?: boolean;
  width?: number;
  height?: number;
  "data-ai-hint"?: string;
}

const FALLBACK_IMAGE = 'https://cdn.dribbble.com/userupload/24360672/file/original-185b34e5d1793db979a43af6d6abd426.gif';

export function ImageWithFallback({ src, alt, className, fill = false, width, height, "data-ai-hint": dataAiHint }: ImageWithFallbackProps) {
  const [imgSrc, setImgSrc] = useState(src || FALLBACK_IMAGE);

  useEffect(() => {
    setImgSrc(src || FALLBACK_IMAGE);
  }, [src]);

  const imageProps: React.ImgHTMLAttributes<HTMLImageElement> & { "data-ai-hint"?: string } = {
    className,
    alt,
    src: imgSrc,
    width: fill ? undefined : width,
    height: fill ? undefined : height,
    style: fill ? { position: 'absolute', height: '100%', width: '100%', inset: 0, objectFit: 'cover' } : {},
    onError: () => setImgSrc(FALLBACK_IMAGE),
    ...(dataAiHint && { "data-ai-hint": dataAiHint }),
  };

  // eslint-disable-next-line @next/next/no-img-element
  return <img {...imageProps} />;
}