import React from "react";

export function SolLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="4"
        rx="2"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="3"
        y="10"
        width="18"
        height="4"
        rx="2"
        fill="currentColor"
        opacity="0.7"
      />
      <rect
        x="3"
        y="15"
        width="18"
        height="4"
        rx="2"
        fill="currentColor"
        opacity="0.5"
      />
    </svg>
  );
}
