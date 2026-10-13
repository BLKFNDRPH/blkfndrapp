"use client";

import { useEffect, useState } from 'react';
import { resizedImageUrl, resizedSrcSet } from '@/lib/project-image';

interface ImageWithFallbackProps {
  src: string;
  alt: string;
  className?: string;
  fill?: boolean;
  width?: number;
  height?: number;
  /**
   * How wide the picture is shown, as an <img sizes> value, so the browser
   * picks a resized copy that fits. Defaults to the full viewport.
   */
  sizes?: string;
  /**
   * The picture the page is about, above the fold: fetched first and not
   * lazily. Cards and thumbnails leave this off.
   */
  priority?: boolean;
  /**
   * Load at once rather than lazily, at the browser's own priority. For a
   * picture that may be on screen but is not the one the page is about: a
   * high-priority picture is also preloaded from the page's <head>, where it
   * competes with the stylesheets the first paint waits on.
   */
  eager?: boolean;
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

/** The width asked for when the browser cannot use the srcset. */
const DEFAULT_WIDTH = 640;

/**
 * Where a picture is in its fallbacks: the resized copy this site serves,
 * then the original on IPFS (should resizing fail), then the placeholder.
 */
type Stage = 'resized' | 'original' | 'placeholder';

export function ImageWithFallback({
  src,
  alt,
  className,
  fill = false,
  width,
  height,
  sizes = '100vw',
  priority = false,
  eager = false,
  "data-ai-hint": dataAiHint,
}: ImageWithFallbackProps) {
  const [stage, setStage] = useState<Stage>(src ? 'resized' : 'placeholder');

  useEffect(() => {
    setStage(src ? 'resized' : 'placeholder');
  }, [src]);

  const srcSet = stage === 'resized' ? resizedSrcSet(src) : undefined;
  const imgSrc =
    stage === 'placeholder'
      ? FALLBACK_IMAGE
      : stage === 'resized'
        ? resizedImageUrl(src, width ?? DEFAULT_WIDTH)
        : src;

  const onError = () => {
    // A picture not on IPFS has no resized copy, so its first failure is the
    // original's: straight to the placeholder.
    if (stage === 'resized' && srcSet) setStage('original');
    else setStage('placeholder');
  };

  const imageProps: React.ImgHTMLAttributes<HTMLImageElement> & { "data-ai-hint"?: string } = {
    className,
    src: imgSrc,
    srcSet,
    sizes: srcSet ? sizes : undefined,
    width: fill ? undefined : width,
    height: fill ? undefined : height,
    loading: priority || eager ? 'eager' : 'lazy',
    decoding: 'async',
    fetchPriority: priority ? 'high' : undefined,
    style: fill ? { position: 'absolute', height: '100%', width: '100%', inset: 0, objectFit: 'cover' } : {},
    onError,
    ...(dataAiHint && { "data-ai-hint": dataAiHint }),
  };

  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} {...imageProps} />;
}
