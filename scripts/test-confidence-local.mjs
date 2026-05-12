#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const skillScript = path.join(
  repoRoot,
  ".cursor",
  "skills",
  "test-confidence-review",
  "scripts",
  "test-confidence-review.mjs"
);

if (!existsSync(skillScript)) {
  console.error(`Missing test-confidence skill script at ${skillScript}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const mode = args.includes("--ci") ? "ci" : "local";
const passThrough = args.filter((arg) => arg !== "--ci");
const commandArgs = [
  skillScript,
  "--base",
  defaultBase(),
  "--out",
  "test-confidence-result.md",
  "--json-out",
  "test-confidence-result.json",
];

if (existsSync("PRD.md")) commandArgs.push("--spec", "PRD.md");
if (mode === "ci") commandArgs.push("--with-coverage");
commandArgs.push(...passThrough);

const result = spawnSync("node", commandArgs, {
  cwd: repoRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);

function defaultBase() {
  if (gitRefExists("origin/main")) return "origin/main";
  if (gitRefExists("origin/master")) return "origin/master";
  if (gitRefExists("main")) return "main";
  if (gitRefExists("master")) return "master";
  return "HEAD";
}

function gitRefExists(ref) {
  return spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], {
    cwd: repoRoot,
    stdio: "ignore",
  }).status === 0;
}
