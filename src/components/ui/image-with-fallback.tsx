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

/**
 * Served from our own origin.
 *
 * This was a hotlinked Dribbble GIF, which made every image-less project card a
 * request to a third party — disclosing each visitor's IP and the fact that they
 * were browsing this site — and presented someone else's artwork as ours. It was
 * also the only blue left on a site whose palette is greys and gold, and it could
 * have changed or 404'd at any time without warning.
 */
const FALLBACK_IMAGE = '/images/project-placeholder.svg';

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