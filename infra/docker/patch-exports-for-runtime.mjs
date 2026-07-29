/**
 * Rewrites workspace package exports from TypeScript sources to compiled dist
 * so production Node can resolve @mplus/worker and @mplus/addon-exporter.
 * Local `tsx` DX keeps source exports; this runs only inside image builds.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const patches = [
  {
    path: join(root, "apps/worker/package.json"),
    exports: {
      ".": {
        types: "./dist/public-api.d.ts",
        import: "./dist/public-api.js",
      },
    },
    main: "./dist/public-api.js",
    types: "./dist/public-api.d.ts",
  },
  {
    path: join(root, "tools/addon-exporter/package.json"),
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    },
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
  },
];

for (const patch of patches) {
  const pkg = JSON.parse(readFileSync(patch.path, "utf8"));
  pkg.exports = patch.exports;
  pkg.main = patch.main;
  pkg.types = patch.types;
  writeFileSync(patch.path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`patched exports: ${patch.path}`);
}
