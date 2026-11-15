// Test helper: lets scripts import modules marked `import "server-only"` (Next provides that package inside its
// bundler only). Use: node --import ./scripts/lib/server-only-stub.mjs --import tsx scripts/<test>.mts
import { registerHooks } from "node:module";
const EMPTY = new URL("./server-only-empty.cjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: EMPTY, shortCircuit: true };
    return next(specifier, context);
  },
});
