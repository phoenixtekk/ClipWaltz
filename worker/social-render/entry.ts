// Bundle entry for the explainer / Shorts pipeline on the render worker (AI box). Built by
// `node scripts/build-social-render.mjs` into worker/social-render/dist/pipeline.mjs (esbuild, ESM, @napi-rs/canvas
// external) so the AI box — which has the worker's own small node_modules, not the app's TypeScript tree — runs the
// SAME pipeline code the app type-checks. Only pure modules are pulled in: no db, no storage, no Next.
export { runStage, STAGE_LABEL, startPayload, type EpisodePayload } from "../../src/lib/explainer/pipeline";
export { buildShort, shortCaption } from "../../src/lib/shorts/pipeline";
