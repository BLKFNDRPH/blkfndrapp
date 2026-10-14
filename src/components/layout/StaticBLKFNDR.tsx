// No 'use client': it has no state, so the footer renders it on the server;
// the header and the sign-in dialog still render it in the browser.
import React from 'react';
import { cn } from '@/lib/utils';

/**
 * The BLKFNDR wordmark, cut from the brand logo. The image is used as a mask
 * and filled with the text colour, so the letterforms follow the theme (the
 * logo's own silver would vanish on a light background). It scales with the
 * parent's font size, like the text it replaces.
 */
const StaticBLKFNDR: React.FC<{ className?: string, textColor?: string }> = ({ className, textColor }) => {
  const mask = 'url(/brand/blkfndr-wordmark.png) center / contain no-repeat';

  return (
    <span
      role="img"
      aria-label="BLKFNDR"
      className={cn('inline-block shrink-0 align-middle', className)}
      style={{
        // The source wordmark is 493 x 62.
        height: '0.8em',
        width: `${(0.8 * 493) / 62}em`,
        backgroundColor: textColor || 'currentColor',
        WebkitMask: mask,
        mask,
      }}
    />
  );
};

export default StaticBLKFNDR;
