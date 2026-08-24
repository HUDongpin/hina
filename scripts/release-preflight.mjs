import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const [packageSource, packageLockSource, citation, changelog] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  readFile(new URL("../CITATION.cff", import.meta.url), "utf8"),
  readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
]);
const packageJson = JSON.parse(packageSource);
const packageLock = JSON.parse(packageLockSource);
const releaseTag = process.env.RELEASE_TAG;
if (releaseTag !== `v${packageJson.version}`) {
  throw new Error(
    `Release tag ${String(releaseTag)} does not match package version ${packageJson.version}.`,
  );
}
if (packageJson.name !== "hina-js") throw new Error("Unexpected npm package name.");
if (packageJson.license !== "MIT") throw new Error("Unexpected package license.");
if (packageJson.repository?.url !== "git+https://github.com/HUDongpin/hina.git") {
  throw new Error("Unexpected package repository URL.");
}
if (
  packageLock.name !== packageJson.name ||
  packageLock.version !== packageJson.version ||
  packageLock.packages?.[""]?.name !== packageJson.name ||
  packageLock.packages?.[""]?.version !== packageJson.version
) {
  throw new Error("package-lock.json identity or version is out of sync.");
}

const citationVersions = citation
  .split(/\r?\n/u)
  .map((line) => /^\s*version:\s*['"]?([^'"\s]+)['"]?\s*$/u.exec(line)?.[1])
  .filter((version) => version !== undefined);
if (
  citationVersions.length !== 2 ||
  citationVersions.some((version) => version !== packageJson.version)
) {
  throw new Error("CITATION.cff versions are out of sync with package.json.");
}
if (!changelog.includes(`## [${packageJson.version}] - `)) {
  throw new Error(`CHANGELOG.md has no entry for ${packageJson.version}.`);
}

const versionQuery = spawnSync(
  "npm",
  [
    "view",
    `${packageJson.name}@${packageJson.version}`,
    "version",
    "--json",
    "--registry=https://registry.npmjs.org/",
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
if (versionQuery.error) {
  throw new Error(
    `Unable to query npm before publication: ${versionQuery.error.message}`,
  );
}

const versionQueryOutput = `${versionQuery.stdout ?? ""}\n${versionQuery.stderr ?? ""}`;
if (versionQuery.status === 0) {
  if (versionQuery.stdout.trim().length > 0) {
    throw new Error(`${packageJson.name}@${packageJson.version} is already published.`);
  }
  throw new Error(
    `Unable to verify that ${packageJson.name}@${packageJson.version} is unpublished: npm returned an empty successful response.`,
  );
}
if (!/\bE404\b/u.test(versionQueryOutput)) {
  throw new Error(
    `Unable to verify that ${packageJson.name}@${packageJson.version} is unpublished.\n${versionQueryOutput.trim()}`,
  );
}

console.log(
  JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    releaseTag,
    exactVersionPublished: false,
  }),
);
