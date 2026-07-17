"use client";

import "./ProjectLoader.css";

export function ProjectLoader() {
  return (
    <div className="pl-scene">
      <div className="pl-stage">
        <div className="pl-scanline" />

        <div className="pl-ship">
          <svg
            className="pl-ship-svg"
            width="100"
            height="90"
            viewBox="0 0 100 90"
            overflow="visible"
          >
            <defs>
              <clipPath id="pl-bodyClip">
                <rect x="20" y="18" width="60" height="28" rx="14" />
              </clipPath>
            </defs>

            {/* Cockpit dome */}
            <ellipse cx="50" cy="7" rx="12" ry="7" fill="#4b5563" />
            <rect x="44" y="6" width="12" height="8" fill="#4b5563" />

            {/* Main saucer hull */}
            <ellipse cx="50" cy="28" rx="30" ry="14" fill="#1f2937" />
            <ellipse cx="50" cy="25" rx="30" ry="12" fill="#374151" />

            {/* Panel line stripe */}
            <rect
              x="20"
              y="22"
              width="60"
              height="8"
              fill="#4b5563"
              clipPath="url(#pl-bodyClip)"
            />
            <line
              x1="20"
              y1="25"
              x2="80"
              y2="25"
              stroke="#6b7280"
              strokeWidth="0.5"
            />

            {/* Nav strobes */}
            <ellipse
              cx="31"
              cy="22"
              rx="5"
              ry="3"
              fill="#60a5fa"
              opacity="0.7"
              className="pl-strobe-l"
            />
            <ellipse
              cx="69"
              cy="22"
              rx="5"
              ry="3"
              fill="#fbbf24"
              opacity="0.7"
              className="pl-strobe-r"
            />

            {/* Viewport dome */}
            <ellipse cx="50" cy="15" rx="7" ry="4" fill="#111827" />
            <ellipse
              cx="50"
              cy="14"
              rx="5"
              ry="3"
              fill="#374151"
              opacity="0.8"
            />
            <ellipse
              cx="50"
              cy="14"
              rx="3"
              ry="2"
              fill="#9ca3af"
              opacity="0.4"
            />

            {/* Undercarriage */}
            <polygon points="50,36 36,50 64,50" fill="#1f2937" />
            <polygon points="50,36 40,50 60,50" fill="#2d3748" />

            {/* Engine bell */}
            <rect x="43" y="36" width="14" height="14" rx="3" fill="#111827" />
            <polygon
              points="50,38 45,50 55,50"
              fill="#9ca3af"
              opacity="0.35"
              className="pl-engine-glow"
            />

            {/* Landing legs */}
            <g className="pl-leg-l">
              <line
                x1="28"
                y1="34"
                x2="12"
                y2="58"
                stroke="#4b5563"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <line
                x1="12"
                y1="58"
                x2="6"
                y2="58"
                stroke="#4b5563"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
            <g className="pl-leg-r">
              <line
                x1="72"
                y1="34"
                x2="88"
                y2="58"
                stroke="#4b5563"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <line
                x1="88"
                y1="58"
                x2="94"
                y2="58"
                stroke="#4b5563"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>

            {/* Thruster flame */}
            <polygon
              points="50,50 42,78 58,78"
              fill="#9ca3af"
              className="pl-flame-main"
            />
            <polygon
              points="50,50 46,68 54,68"
              fill="#e5e7eb"
              className="pl-flame-main"
            />
          </svg>

          <div className="pl-exhaust">
            <div className="pl-ep" />
            <div className="pl-ep" />
            <div className="pl-ep" />
            <div className="pl-ep" />
            <div className="pl-ep" />
            <div className="pl-ep" />
          </div>
        </div>

        {/* Tractor beam */}
        <svg className="pl-beam" width="90" height="110" viewBox="0 0 90 110">
          <defs>
            <linearGradient id="pl-beamG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9ca3af" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#9ca3af" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points="35,0 55,0 90,110 0,110" fill="url(#pl-beamG)" />
        </svg>

        {/* Landing pad */}
        <svg className="pl-pad" width="140" height="30" viewBox="0 0 140 30">
          <ellipse
            cx="70"
            cy="16"
            rx="60"
            ry="8"
            fill="#1f2937"
            opacity="0.5"
          />
          <rect x="10" y="12" width="120" height="6" rx="3" fill="#374151" />
          <rect
            x="25"
            y="13"
            width="90"
            height="2"
            rx="1"
            fill="#4b5563"
            opacity="0.8"
          />
          <rect
            x="55"
            y="13"
            width="30"
            height="2"
            rx="1"
            fill="#6b7280"
            opacity="0.6"
          />
          <rect
            x="12"
            y="14"
            width="8"
            height="4"
            rx="1"
            fill="#60a5fa"
            opacity="0.5"
          />
          <rect
            x="120"
            y="14"
            width="8"
            height="4"
            rx="1"
            fill="#60a5fa"
            opacity="0.5"
          />
        </svg>

        {/* Pulse rings */}
        <svg className="pl-rings" width="140" height="60" viewBox="0 0 140 30">
          <circle
            className="pl-rng"
            cx="70"
            cy="15"
            r="4"
            fill="none"
            stroke="#6b7280"
            strokeWidth="1.5"
          />
          <circle
            className="pl-rng"
            cx="70"
            cy="15"
            r="4"
            fill="none"
            stroke="#6b7280"
            strokeWidth="1.5"
          />
          <circle
            className="pl-rng"
            cx="70"
            cy="15"
            r="4"
            fill="none"
            stroke="#6b7280"
            strokeWidth="1.5"
          />
        </svg>

        {/* Dust clouds */}
        <div className="pl-dust">
          <div className="pl-dl pl-dl-l" />
          <div className="pl-dl pl-dl-r" />
          <div className="pl-dl pl-dl-m" />
        </div>

        <div className="pl-shockwave" />
        <div className="pl-ground" />
      </div>
    </div>
  );
}
