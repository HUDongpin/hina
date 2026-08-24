import { execFileSync } from "node:child_process";

const token = process.env.NPM_TOKEN?.trim();
if (token) {
  // First-release bridge only. The protected environment secret is deleted
  // after npm Trusted Publishing has been configured for this workflow.
  execFileSync(
    "npm",
    ["config", "set", "//registry.npmjs.org/:_authToken", token, "--location=user"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

execFileSync(
  "npm",
  ["publish", "--access", "public", "--provenance"],
  { stdio: "inherit" },
);
