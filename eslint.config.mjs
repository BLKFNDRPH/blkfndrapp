import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unsafe-declaration-merging": "off",
      "@typescript-eslint/no-require-imports": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/static-components": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/use-memo": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "target/**",
    "next-env.d.ts",
    // Soroban contract bindings, produced by `stellar contract bindings
    // typescript`. Regenerated wholesale from the contract ABI, so hand-editing
    // them to satisfy lint rules would be undone by the next build.
    "src/packages/**",
    "user-check.js",
  ]),
]);
