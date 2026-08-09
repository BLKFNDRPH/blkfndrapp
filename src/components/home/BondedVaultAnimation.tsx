"use client";

import React from "react";
import "./BondedVaultAnimation.css";

const COINS = [
  { sx: -150, sy: -322, delay: "0s" },
  { sx: 148, sy: -334, delay: "0.35s" },
  { sx: -68, sy: -344, delay: "0.7s" },
  { sx: 88, sy: -348, delay: "1.05s" },
  { sx: -186, sy: -256, delay: "1.4s" },
  { sx: 178, sy: -262, delay: "1.75s" },
];

const FLOORS = [
  { id: 1, x: 125, y: 294, w: 150 },
  { id: 2, x: 133, y: 248, w: 134 },
  { id: 3, x: 141, y: 202, w: 118 },
  { id: 4, x: 149, y: 156, w: 102 },
];

/**
 * The hero visual, and the whole product in one loop: contributions fall into a
 * per-project vault, the raise closes, and the build rises one milestone at a
 * time while the builder's bond stays locked at the base.
 *
 * The floor timings are hand-written per floor rather than driven by
 * animation-delay. A shared delay would give each floor its own 16s loop offset
 * from the others, so the tower would never reset as one — floors would vanish
 * at staggered moments. Explicit keyframes keep every element on one cycle.
 */
export function BondedVaultAnimation() {
  return (
    <div className="bv-stage">
      {/*
        role="img" belongs on the svg, not the wrapper — on the wrapper it makes
        the whole subtree presentational and swallows the caption below.
      */}
      <svg
        viewBox="0 0 400 470"
        className="bv-svg"
        role="img"
        aria-label="Contributions collect in a per-project vault; the build rises one milestone at a time as stakeholders vote each tranche out, while the builder's performance bond stays locked in the same contract."
      >
        <defs>
          <linearGradient id="bv-slab" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(240, 240, 238, 0.20)" />
            <stop offset="100%" stopColor="rgba(240, 240, 238, 0.05)" />
          </linearGradient>
          <linearGradient id="bv-vault" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(212, 175, 55, 0.20)" />
            <stop offset="100%" stopColor="rgba(12, 12, 12, 0.75)" />
          </linearGradient>
        </defs>

        {/* Drafting frame */}
        <rect
          className="bv-frame"
          x="8"
          y="8"
          width="384"
          height="454"
          rx="18"
        />

        {/* Ground */}
        <path className="bv-ground" d="M36 402 H364" />
        <path className="bv-ground bv-ground--hatch" d="M44 410 l10 -8 M74 410 l10 -8 M104 410 l10 -8 M134 410 l10 -8 M164 410 l10 -8 M194 410 l10 -8 M224 410 l10 -8 M254 410 l10 -8 M284 410 l10 -8 M314 410 l10 -8 M344 410 l10 -8" />

        {/* Incoming contributions */}
        <g className="bv-coins">
          {COINS.map((coin, i) => (
            <g
              key={i}
              className="bv-coin"
              style={
                {
                  "--bv-sx": `${coin.sx}px`,
                  "--bv-sy": `${coin.sy}px`,
                  animationDelay: coin.delay,
                } as React.CSSProperties
              }
            >
              <circle cx="200" cy="352" r="7" className="bv-coin__body" />
              <path d="M197 348 v8 M200 347 v10 M203 348 v8" className="bv-coin__mark" />
            </g>
          ))}
        </g>

        {/* The build, floor by floor */}
        {FLOORS.map((floor) => (
          <g key={floor.id} className={`bv-floor bv-floor--${floor.id}`}>
            <rect
              className="bv-floor__slab"
              x={floor.x}
              y={floor.y}
              width={floor.w}
              height="40"
              rx="4"
            />
            {/* Windows */}
            <g className="bv-floor__windows">
              {Array.from({ length: Math.floor(floor.w / 26) }).map((_, i) => (
                <rect
                  key={i}
                  x={floor.x + 12 + i * 26}
                  y={floor.y + 12}
                  width="13"
                  height="16"
                  rx="2"
                />
              ))}
            </g>
            {/* Milestone release tag */}
            <g className="bv-tag">
              <rect x="288" y={floor.y + 9} width="66" height="22" rx="11" />
              <path
                className="bv-tag__check"
                d={`M300 ${floor.y + 20} l4 4 l7 -8`}
              />
              <text x="333" y={floor.y + 24}>
                M{floor.id}
              </text>
            </g>
          </g>
        ))}

        {/* Roof and beacon */}
        <g className="bv-floor bv-floor--5">
          <rect className="bv-floor__slab" x="192" y="112" width="16" height="44" rx="3" />
          <circle className="bv-beacon" cx="200" cy="106" r="5" />
        </g>

        {/* The vault, and the bond locked inside it */}
        <g className="bv-vaultgroup">
          <text className="bv-label" x="118" y="332">
            PROJECT VAULT
          </text>
          <rect className="bv-vault" x="118" y="340" width="164" height="62" rx="8" />
          <g className="bv-lock">
            <path
              className="bv-lock__shackle"
              d="M139 366 v-6 a6 6 0 0 1 12 0 v6"
            />
            <rect className="bv-lock__body" x="134" y="366" width="22" height="16" rx="3" />
          </g>
          <text className="bv-vault__line1" x="166" y="368">
            BOND LOCKED
          </text>
          <text className="bv-vault__line2" x="166" y="382">
            forfeits on a failed milestone
          </text>
        </g>

        {/* Raise progress */}
        <rect className="bv-bar__track" x="118" y="420" width="164" height="10" rx="5" />
        <rect className="bv-bar__fill" x="118" y="420" width="164" height="10" rx="5" />
        <text className="bv-label" x="118" y="448">
          RAISE
        </text>
        <g className="bv-funded">
          <rect x="222" y="436" width="60" height="18" rx="9" />
          <text x="252" y="449">
            FUNDED
          </text>
        </g>
      </svg>

      <p className="bv-caption">
        No admin key sits anywhere in this path. Every tranche leaves the vault
        on a stakeholder vote, or not at all.
      </p>
    </div>
  );
}

export default React.memo(BondedVaultAnimation);
