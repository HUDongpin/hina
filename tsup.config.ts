import { defineConfig, type Options } from "tsup";

const shared: Options = {
  bundle: true,
  clean: false,
  dts: true,
  format: ["esm", "cjs"],
  minify: false,
  outDir: "dist",
  platform: "neutral" as const,
  sourcemap: true,
  splitting: false,
  target: "es2022",
  treeshake: true,
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      construction: "src/construction.ts",
      individual: "src/individual.ts",
      dyad: "src/dyad.ts",
      mesoscale: "src/mesoscale.ts",
      visualization: "src/visualization.ts",
      io: "src/io.ts",
      node: "src/node.ts",
    },
    external: ["@e965/xlsx", "papaparse"],
  },
  {
    ...shared,
    entry: { "react/index": "src/react/index.tsx" },
    external: ["@e965/xlsx", "cytoscape", "papaparse", "react", "react-dom"],
  },
]);
