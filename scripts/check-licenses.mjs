import { readFile } from "node:fs/promises";

const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const allowed = new Set([
  "Apache-2.0",
  "Apache-2.0 AND BSL-1.0",
  "MIT",
]);
const productionPackages = Object.entries(lock.packages)
  .filter(([path, metadata]) => path.length > 0 && metadata.dev !== true)
  .map(([path, metadata]) => ({ path, license: metadata.license ?? null }));
const rejected = productionPackages.filter(
  ({ license }) => typeof license !== "string" || !allowed.has(license),
);

if (rejected.length > 0) {
  console.error(JSON.stringify({ rejected }, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      productionPackageCount: productionPackages.length,
      licenses: [...new Set(productionPackages.map(({ license }) => license))].sort(),
    }),
  );
}
