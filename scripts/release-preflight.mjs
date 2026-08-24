import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
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

let publishedVersion = null;
try {
  publishedVersion = execFileSync(
    "npm",
    ["view", `${packageJson.name}@${packageJson.version}`, "version", "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
} catch {
  // An unavailable exact version is the required state before publication.
}
if (publishedVersion !== null && publishedVersion.length > 0) {
  throw new Error(`${packageJson.name}@${packageJson.version} is already published.`);
}

if (packageJson.version === "0.1.0") {
  try {
    const owner = execFileSync(
      "npm",
      ["view", packageJson.name, "maintainers", "--json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (owner.length > 0) {
      throw new Error(
        `The npm name ${packageJson.name} is already registered; first publication must stop.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("already registered")) throw error;
  }
}

console.log(
  JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    releaseTag,
    exactVersionAvailable: true,
  }),
);
