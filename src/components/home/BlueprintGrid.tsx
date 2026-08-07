"use client";

import React from "react";
import "./BlueprintGrid.css";

/**
 * The hero backdrop: a drafting grid that drifts, with a few dimension marks
 * scattered over it. It replaces the asteroid field that used to sit here —
 * blkfndr funds buildings from the blueprint stage, so the backdrop is a
 * blueprint rather than deep space.
 */
export function BlueprintGrid() {
  return (
    <div className="blueprint-grid" aria-hidden="true">
      <div className="blueprint-grid__fine" />
      <div className="blueprint-grid__coarse" />
      <div className="blueprint-grid__vignette" />
      <svg
        className="blueprint-grid__marks"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Dimension line, top left */}
        <g className="blueprint-mark" style={{ ["--mark-delay" as string]: "0s" }}>
          <path d="M80 120 H300" />
          <path d="M80 112 V128" />
          <path d="M300 112 V128" />
        </g>
        {/* Corner bracket, top right */}
        <g className="blueprint-mark" style={{ ["--mark-delay" as string]: "1.6s" }}>
          <path d="M1120 90 H1000 V210" />
        </g>
        {/* Elevation ticks, bottom left */}
        <g className="blueprint-mark" style={{ ["--mark-delay" as string]: "2.8s" }}>
          <path d="M120 560 V700" />
          <path d="M112 600 H128" />
          <path d="M112 640 H128" />
          <path d="M112 680 H128" />
        </g>
        {/* Setting-out circle, bottom right */}
        <g className="blueprint-mark" style={{ ["--mark-delay" as string]: "4.2s" }}>
          <circle cx="1050" cy="620" r="46" />
          <path d="M1004 620 H1096" />
          <path d="M1050 574 V666" />
        </g>
      </svg>
    </div>
  );
}

export default React.memo(BlueprintGrid);
