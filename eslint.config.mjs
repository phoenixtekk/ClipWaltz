import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees are full repo copies (incl. their .next builds).
    ".claude/**",
    // Generated pipeline bundle for the AI-box render worker (scripts/build-social-render.mjs).
    "worker/social-render/dist/**",
  ]),
]);

export default eslintConfig;
