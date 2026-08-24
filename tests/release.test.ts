import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

interface PackageManifest {
  readonly name: string;
  readonly version: string;
}

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const preflightPath = fileURLToPath(
  new URL("../scripts/release-preflight.mjs", import.meta.url),
);
const workflowPath = fileURLToPath(
  new URL("../.github/workflows/release.yml", import.meta.url),
);
const packageManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as PackageManifest;

const fakeNpmSource = String.raw`#!/usr/bin/env node
import { appendFileSync } from "node:fs";

appendFileSync(
  process.env.FAKE_NPM_LOG,
  JSON.stringify(process.argv.slice(2)) + "\n",
);

switch (process.env.FAKE_NPM_MODE) {
  case "e404":
    process.stderr.write("npm error code E404\nnpm error 404 Not Found\n");
    process.exit(1);
    break;
  case "published":
    process.stdout.write(JSON.stringify(process.env.FAKE_NPM_VERSION) + "\n");
    break;
  case "network":
    process.stderr.write("npm error code EAI_AGAIN\nnpm error request failed\n");
    process.exit(1);
    break;
  case "authorization":
    process.stderr.write("npm error code E401\nnpm error authentication required\n");
    process.exit(1);
    break;
  default:
    process.stderr.write("Unexpected fake npm mode\n");
    process.exit(2);
}
`;

let fakeBinDirectory = "";
let fakeNpmLog = "";

function runPreflight(mode: string, releaseTag = `v${packageManifest.version}`) {
  return spawnSync(process.execPath, [preflightPath], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      FAKE_NPM_LOG: fakeNpmLog,
      FAKE_NPM_MODE: mode,
      FAKE_NPM_VERSION: packageManifest.version,
      PATH: `${fakeBinDirectory}${path.delimiter}${process.env["PATH"] ?? ""}`,
      RELEASE_TAG: releaseTag,
    },
  });
}

async function npmCalls(): Promise<readonly (readonly string[])[]> {
  const log = (await readFile(fakeNpmLog, "utf8")).trim();
  if (log.length === 0) return [];
  return log.split("\n").map((line) => JSON.parse(line) as string[]);
}

beforeAll(async () => {
  fakeBinDirectory = await mkdtemp(path.join(tmpdir(), "hina-release-test-"));
  fakeNpmLog = path.join(fakeBinDirectory, "npm-calls.jsonl");
  const fakeNpmPath = path.join(fakeBinDirectory, "npm");
  await Promise.all([
    writeFile(fakeNpmLog, "", "utf8"),
    writeFile(fakeNpmPath, fakeNpmSource, "utf8"),
  ]);
  await chmod(fakeNpmPath, 0o755);
});

beforeEach(async () => {
  await writeFile(fakeNpmLog, "", "utf8");
});

afterAll(async () => {
  await rm(fakeBinDirectory, { force: true, recursive: true });
});

describe("release preflight", () => {
  it("allows publication only when the exact Registry query returns E404", async () => {
    const result = runPreflight("e404");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout) as Record<string, unknown>).toMatchObject({
      name: packageManifest.name,
      version: packageManifest.version,
      releaseTag: `v${packageManifest.version}`,
      exactVersionPublished: false,
    });
    expect(await npmCalls()).toEqual([
      [
        "view",
        `${packageManifest.name}@${packageManifest.version}`,
        "version",
        "--json",
        "--registry=https://registry.npmjs.org/",
      ],
    ]);
  });

  it("rejects an exact version that is already published", async () => {
    const result = runPreflight("published");

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `${packageManifest.name}@${packageManifest.version} is already published.`,
    );
    expect(await npmCalls()).toHaveLength(1);
  });

  it.each([
    ["network", "EAI_AGAIN"],
    ["authorization", "E401"],
  ])("fails closed for a non-E404 %s error", async (mode, errorCode) => {
    const result = runPreflight(mode);

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unable to verify");
    expect(result.stderr).toContain(errorCode);
    expect(await npmCalls()).toHaveLength(1);
  });

  it("rejects a tag/version mismatch before invoking npm", async () => {
    const mismatchedTag = `v${packageManifest.version}-mismatch`;
    const result = runPreflight("published", mismatchedTag);

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `Release tag ${mismatchedTag} does not match package version ${packageManifest.version}.`,
    );
    expect(await npmCalls()).toEqual([]);
  });
});

describe("npm release workflow", () => {
  it("uses the protected npm environment and OIDC-only direct publishing", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toMatch(/^\s*id-token:\s*write\s*$/mu);
    expect(workflow).toMatch(/^\s*environment:\s*npm\s*$/mu);
    expect(workflow).toMatch(/^\s*run:\s*npm publish(?:\s|$)/mu);
    expect(workflow).not.toMatch(/\bNPM_TOKEN\b/u);
    expect(workflow).not.toMatch(/\bNODE_AUTH_TOKEN\b/u);
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("publish.mjs");
  });
});
