import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Reuse the bundler supplied by the already locked migration tooling.
const require = createRequire(import.meta.url);
const tooling = createRequire(require.resolve("drizzle-kit"));
const { build } = tooling("esbuild");
const destination = resolve("node_modules/.cache/marketplace-demo.cjs");
await mkdir(resolve("node_modules/.cache"), { recursive: true });
await build({ entryPoints: [resolve("scripts/seed-demo.ts")], outfile: destination, bundle: true,
  platform: "node", format: "cjs", packages: "external", tsconfig: resolve("tsconfig.json"), logLevel: "warning" });
await import(pathToFileURL(destination).href);
