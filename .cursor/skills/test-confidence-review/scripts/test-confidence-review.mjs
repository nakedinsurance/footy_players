#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");

const RESULT = {
  PASS: "Pass",
  FAIL: "Fail",
};

const PASS_THRESHOLD = 80;

let workspaceProjectsCache;

const COMMON_WORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "around",
  "because",
  "before",
  "change",
  "changed",
  "current",
  "expected",
  "should",
  "their",
  "there",
  "these",
  "thing",
  "under",
  "where",
  "which",
  "workflow",
]);

function main() {
  const args = parseArgs(process.argv.slice(2));

  const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(repoRoot);

  const specPath = args.spec ? path.resolve(args.spec) : null;
  if (specPath && !existsSync(specPath)) {
    fail(`Spec file does not exist: ${specPath}`);
  }

  const spec = specPath ? readFileSync(specPath, "utf8") : "";
  const outPath = path.resolve(args.out ?? "test-confidence-result.md");
  const outRelative = path.relative(repoRoot, outPath);
  const configPath = resolveConfigPath(repoRoot, args.config);
  const config = readConfig(configPath);
  const pathFilter = buildPathFilter(config);
  const baseRef = args.base ?? discoverBaseRef();
  const allChanges = collectChanges(baseRef).filter((change) => change.path !== outRelative);
  const changes = allChanges.filter((change) => pathFilter.include(change.path));
  const excludedChanges = allChanges.filter((change) => !pathFilter.include(change.path));
  const categorized = categorizeChanges(changes);
  const projects = inferProjects(changes.map((change) => change.path));
  const relatedTests = findRelatedTests(categorized, projects);
  const validation = args.noRun
    ? [
        {
          name: "validation skipped",
          command: "--no-run",
          status: "skipped",
          exitCode: null,
          summary: "Validation commands were not executed.",
        },
      ]
    : runValidation(projects, relatedTests, configPath);
  const qualityTools = args.noRun
    ? qualityToolsSkipped(args)
    : runQualityTools(args, projects, configPath);
  const assessment = assessTestMeaning(categorized, relatedTests, baseRef);
  const checklist = buildChecklist(categorized, relatedTests, validation, assessment);
  const result = decideResult(checklist);
  const context = {
    result,
    checklist,
    specPath,
    spec,
    baseRef,
    changes,
    excludedChanges,
    categorized,
    configPath,
    config,
    projects,
    relatedTests,
    validation,
    qualityTools,
    assessment,
  };
  const report = renderReport(context);

  writeFileSync(outPath, report);
  console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
  if (args.jsonOut) {
    const jsonOutPath = path.resolve(args.jsonOut);
    writeFileSync(jsonOutPath, `${JSON.stringify(renderJsonContract(context), null, 2)}\n`);
    console.log(`Wrote ${path.relative(repoRoot, jsonOutPath)}`);
  }
  console.log(`Result: ${result.label}`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--spec") args.spec = argv[++index];
    else if (arg === "--base") args.base = argv[++index];
    else if (arg === "--config") args.config = argv[++index];
    else if (arg === "--out") args.out = argv[++index];
    else if (arg === "--json-out") args.jsonOut = argv[++index];
    else if (arg === "--no-run") args.noRun = true;
    else if (arg === "--with-coverage") args.withCoverage = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node test-confidence-review.mjs [--spec <path>] [--base <ref>] [--config <path>] [--out <path>] [--json-out <path>] [--no-run] [--with-coverage]"
      );
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function resolveConfigPath(repoRoot, configArg) {
  if (configArg) {
    const explicitPath = path.resolve(configArg);
    if (!existsSync(explicitPath)) fail(`Config file does not exist: ${explicitPath}`);
    return explicitPath;
  }

  const repoConfig = path.join(repoRoot, ".test-confidence.yml");
  if (existsSync(repoConfig)) return repoConfig;

  return path.join(SKILL_DIR, "assets", "default-test-confidence.yml");
}

function readConfig(configPath) {
  const content = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const config = {
    content,
    includePaths: readYamlStringList(content, "include", "paths"),
    ignorePaths: readYamlStringList(content, "ignore", "paths"),
  };
  if (config.includePaths.length > 0 && config.ignorePaths.length > 0) {
    fail("Invalid test-confidence config: use either include.paths or ignore.paths, not both.");
  }
  return config;
}

function readYamlStringList(content, sectionName, keyName) {
  const lines = content.split("\n");
  const values = [];
  let inSection = false;
  let inList = false;
  const sectionPattern = new RegExp(`^${sectionName}:\\s*$`);
  const keyPattern = new RegExp(`^\\s{2}${keyName}:\\s*$`);

  for (const line of lines) {
    if (/^\S/.test(line)) {
      inSection = sectionPattern.test(line);
      inList = false;
      continue;
    }

    if (inSection && keyPattern.test(line)) {
      inList = true;
      continue;
    }

    if (inSection && inList) {
      const match = line.match(/^\s{4}-\s+['"]?(.+?)['"]?\s*$/);
      if (match) values.push(match[1]);
      else if (/^\s{2}\S/.test(line)) inList = false;
    }
  }

  return values;
}

function buildPathFilter(config) {
  if (config.includePaths.length > 0) {
    const includeMatchers = buildPathMatchers(config.includePaths);
    return {
      mode: "include",
      patterns: config.includePaths,
      include: (file) => includeMatchers.some((matches) => matches(file)),
    };
  }

  const ignoreMatchers = buildPathMatchers(config.ignorePaths);
  return {
    mode: "ignore",
    patterns: config.ignorePaths,
    include: (file) => !ignoreMatchers.some((matches) => matches(file)),
  };
}

function buildPathMatchers(patterns) {
  return patterns.map((pattern) => {
    const normalized = pattern.replaceAll("\\", "/");
    if (normalized.endsWith("/**")) {
      const prefix = normalized.slice(0, -3);
      return (file) => file === prefix || file.startsWith(`${prefix}/`);
    }
    if (normalized.startsWith("**/*.")) {
      const suffix = normalized.slice(4);
      return (file) => file.endsWith(suffix);
    }
    if (normalized.includes("*")) {
      const escaped = normalized
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      const regex = new RegExp(`^${escaped}$`);
      return (file) => regex.test(file);
    }
    return (file) => file === normalized || file.startsWith(`${normalized}/`);
  });
}

function discoverBaseRef() {
  const ghDefault = tryExec("gh", [
    "repo",
    "view",
    "--json",
    "defaultBranchRef",
    "--jq",
    ".defaultBranchRef.name",
  ]);
  if (ghDefault.status === 0 && ghDefault.stdout.trim()) {
    const ref = `origin/${ghDefault.stdout.trim()}`;
    if (gitRefExists(ref)) return ref;
  }

  for (const ref of ["origin/main", "origin/master"]) {
    if (gitRefExists(ref)) return ref;
  }

  const remoteHead = tryGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remoteHead.status === 0 && remoteHead.stdout.trim()) {
    return remoteHead.stdout.trim();
  }

  for (const ref of ["main", "master"]) {
    if (gitRefExists(ref)) return ref;
  }

  fail("Could not discover default branch. Pass --base <ref>.");
}

function collectChanges(baseRef) {
  const maps = [
    parseNameStatus(tryGit(["diff", "--name-status", `${baseRef}...HEAD`]).stdout, "branch"),
    parseNameStatus(tryGit(["diff", "--cached", "--name-status"]).stdout, "staged"),
    parseNameStatus(tryGit(["diff", "--name-status"]).stdout, "working-tree"),
    parseUntracked(tryGit(["ls-files", "--others", "--exclude-standard"]).stdout),
  ];

  const merged = new Map();
  for (const entries of maps) {
    for (const entry of entries) {
      const existing = merged.get(entry.path);
      if (existing) {
        existing.sources.add(entry.source);
        existing.statuses.add(entry.status);
      } else {
        merged.set(entry.path, {
          path: entry.path,
          oldPath: entry.oldPath,
          status: entry.status,
          statuses: new Set([entry.status]),
          sources: new Set([entry.source]),
        });
      }
    }
  }

  return [...merged.values()].map((entry) => ({
    path: entry.path,
    oldPath: entry.oldPath,
    status: [...entry.statuses].join(","),
    source: [...entry.sources].join(","),
  }));
}

function parseNameStatus(output, source) {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0];
      if (status.startsWith("R") || status.startsWith("C")) {
        return { status, oldPath: parts[1], path: parts[2], source };
      }
      return { status, path: parts[1], source };
    })
    .filter((entry) => entry.path);
}

function parseUntracked(output) {
  return output
    .split("\n")
    .filter(Boolean)
    .map((file) => ({ status: "??", path: file, source: "untracked" }));
}

function categorizeChanges(changes) {
  const categorized = {
    production: [],
    tests: [],
    docs: [],
    config: [],
    tooling: [],
    contracts: [],
    other: [],
  };

  for (const change of changes) {
    const file = change.path;
    if (isTestFile(file)) categorized.tests.push(change);
    else if (file.startsWith("packages/contracts/") || file.startsWith("contracts/"))
      categorized.contracts.push(change);
    else if (isDocsFile(file)) categorized.docs.push(change);
    else if (isToolingFile(file)) categorized.tooling.push(change);
    else if (isConfigFile(file)) categorized.config.push(change);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(file)) categorized.production.push(change);
    else categorized.other.push(change);
  }

  return categorized;
}

function isTestFile(file) {
  return /(^|\/)__tests__\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function isDocsFile(file) {
  return file.startsWith("docs/") || file.endsWith(".md") || file.endsWith(".mdx");
}

function isConfigFile(file) {
  if (/^\.[^/]+\.(json|ya?ml|[cm]?[jt]s)$/.test(file)) return true;
  return /(^|\/)(tsconfig|eslint\.config|vitest\.config|nx|package|pnpm-workspace|docker-compose|cdk\.context)\.(json|ya?ml|[cm]?[jt]s)$/.test(
    file
  );
}

function isToolingFile(file) {
  return file.startsWith("scripts/") || file.startsWith("tools/") || file.startsWith(".github/");
}

function inferProjects(files) {
  const projects = new Map();
  for (const file of files) {
    const project = findNearestProject(file);
    if (project) projects.set(project.root, project);
  }
  return [...projects.values()];
}

function findNearestProject(file) {
  const workspaceProject = findWorkspaceProject(file);
  if (workspaceProject) return workspaceProject;

  let dir = path.dirname(file);
  while (dir && dir !== ".") {
    const projectPath = path.join(dir, "project.json");
    if (existsSync(projectPath)) {
      const project = JSON.parse(readFileSync(projectPath, "utf8"));
      return { root: dir, name: project.name ?? path.basename(dir) };
    }

    const packagePath = path.join(dir, "package.json");
    if (existsSync(packagePath)) {
      const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
      return { root: dir, name: pkg.nx?.name ?? pkg.name ?? path.basename(dir) };
    }
    dir = path.dirname(dir);
  }

  const rootPackagePath = "package.json";
  if (existsSync(rootPackagePath)) {
    const pkg = JSON.parse(readFileSync(rootPackagePath, "utf8"));
    return { root: ".", name: pkg.nx?.name ?? pkg.name ?? path.basename(process.cwd()) };
  }

  return null;
}

function findWorkspaceProject(file) {
  const projects = loadWorkspaceProjects();
  return projects
    .filter((project) => file === project.root || file.startsWith(`${project.root}/`))
    .sort((a, b) => b.root.length - a.root.length)[0];
}

function loadWorkspaceProjects() {
  if (workspaceProjectsCache) return workspaceProjectsCache;

  workspaceProjectsCache = ["workspace.json", "angular.json"]
    .filter((file) => existsSync(file))
    .flatMap((file) => projectsFromWorkspaceFile(file));

  return workspaceProjectsCache;
}

function projectsFromWorkspaceFile(file) {
  const workspace = JSON.parse(readFileSync(file, "utf8"));
  const projects = workspace.projects ?? {};
  return Object.entries(projects)
    .map(([name, value]) => {
      if (typeof value === "string") return { name, root: value };
      const root = value.root ?? value.sourceRoot;
      return root ? { name: value.name ?? name, root } : null;
    })
    .filter(Boolean);
}

function findRelatedTests(categorized, projects) {
  const allTests = git(["ls-files"]).split("\n").filter(Boolean).filter(isTestFile);
  const related = new Map();
  const changedNonTests = [
    ...categorized.production,
    ...categorized.contracts,
    ...categorized.config,
    ...categorized.tooling,
  ].map((change) => change.path);

  for (const change of categorized.tests) addRelated(related, change.path, "changed test file");

  for (const changedFile of changedNonTests) {
    const dir = path.dirname(changedFile);
    const stem = moduleStem(changedFile);
    const changedProject = findNearestProject(changedFile);
    for (const testFile of allTests) {
      if (path.dirname(testFile) === dir)
        addRelated(related, testFile, `sibling test for ${changedFile}`);
      if (testFile.startsWith(`${dir}/__tests__/`))
        addRelated(related, testFile, `same directory __tests__ for ${changedFile}`);
      if (
        stem &&
        changedProject &&
        testFile.startsWith(`${changedProject.root}/`) &&
        referencesChangedModule(testFile, stem)
      ) {
        addRelated(related, testFile, `references ${stem}`);
      }
    }
  }

  for (const project of projects) {
    for (const testFile of allTests) {
      if (testFile.startsWith(`${project.root}/`))
        addRelated(related, testFile, `same project ${project.name}`);
    }
  }

  return [...related.values()]
    .map((test) => ({
      ...test,
      relevance: classifyTestRelevance(test),
    }))
    .sort((a, b) => {
      const rank = { primary: 0, candidate: 1 };
      return rank[a.relevance] - rank[b.relevance] || a.path.localeCompare(b.path);
    });
}

function addRelated(map, file, reason) {
  const current = map.get(file);
  if (current) current.reasons.add(reason);
  else map.set(file, { path: file, reasons: new Set([reason]) });
}

function classifyTestRelevance(test) {
  const reasons = [...test.reasons];
  if (
    reasons.some((reason) => reason === "changed test file" || reason.startsWith("references "))
  ) {
    return "primary";
  }
  return "candidate";
}

function moduleStem(file) {
  const parsed = path.parse(file);
  if (!/\.[cm]?[jt]sx?$/.test(parsed.base)) return "";
  const stem = parsed.name.replace(/\.(test|spec)$/, "");
  if (["index", "main", "types", "utils", "helpers"].includes(stem)) return "";
  return stem.length >= 4 ? stem : "";
}

function referencesChangedModule(testFile, stem) {
  if (!existsSync(testFile)) return false;
  const content = readFileSync(testFile, "utf8").slice(0, 20000);
  return content.includes(stem);
}

function runValidation(projects, relatedTests, configPath) {
  const commands = configuredCommands(projects, configPath);
  if (commands.length === 0 && projects.length === 1) {
    commands.push({
      name: `pnpm nx test ${projects[0].name}`,
      command: `pnpm exec nx test ${projects[0].name}`,
    });
  }

  if (commands.length === 0) {
    return [
      {
        name: "no command found",
        command: "",
        status: "missing",
        exitCode: null,
        summary:
          relatedTests.length > 0
            ? "Related tests were found, but no unambiguous project-level validation command was available."
            : "No related tests or unambiguous project-level validation command were available.",
      },
    ];
  }

  return commands.map((command) => runSafeCommand(command));
}

function configuredCommands(projects, configPath) {
  if (!existsSync(configPath) || projects.length !== 1) return [];

  const content = readFileSync(configPath, "utf8");
  const commandLines = readSectionCommandLines(content, "validation");

  return commandLines.map((template) => ({
    name: template,
    command: template
      .replaceAll("{project}", projects[0].name)
      .replaceAll("{projectRoot}", projects[0].root),
  }));
}

function readSectionCommandLines(content, sectionName) {
  const lines = content.split("\n");
  const commands = [];
  let inSection = false;

  for (const line of lines) {
    if (/^\S/.test(line)) {
      inSection = new RegExp(`^${sectionName}:\\s*$`).test(line);
      continue;
    }

    if (!inSection) continue;
    const match = line.match(/^\s*command:\s*['"]?(.+?)['"]?\s*$/);
    if (match) commands.push(match[1]);
  }

  return commands;
}

function runSafeCommand(command) {
  if (!isSafeCommand(command.command)) {
    return {
      ...command,
      status: "blocked",
      exitCode: null,
      summary:
        "Command was blocked because it is not a simple configured package-manager or local Python tool command.",
    };
  }

  const parts = command.command
    .match(/(?:[^\s"]+|"[^"]*")+/g)
    .map((part) => part.replace(/^"|"$/g, ""));
  const result = spawnSync(parts[0], parts.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const noTestsFound = /No test files found/i.test(output);

  return {
    ...command,
    status: result.status === 0 && !noTestsFound ? "passed" : "failed",
    exitCode: result.status,
    summary: summarizeOutput(output),
  };
}

function isSafeCommand(command) {
  if (/[;&|`$<>]/.test(command)) return false;
  return /^(pnpm|yarn|npm)\s+/.test(command) || /^(uv\s+run|python3?\s+-m)\s+/.test(command);
}

function qualityToolsSkipped(args) {
  if (!args.withCoverage) return [];
  const skipped = [];
  skipped.push({
    name: "coverage",
    command: "--no-run",
    status: "skipped",
    exitCode: null,
    summary: "Coverage tooling was requested, but validation commands were not executed.",
  });
  return skipped;
}

function runQualityTools(args, projects, configPath) {
  const results = [];
  if (args.withCoverage) {
    const artifacts = readCoverageArtifacts();
    results.push(...runQualityTool("coverage", projects, configPath, detectCoverageCommands, artifacts.length > 0));
    results.push(...artifacts);
  }
  return results;
}

function runQualityTool(sectionName, projects, configPath, detectCommands, hasArtifact) {
  const commands = configuredToolCommands(sectionName, projects, configPath);
  const detected = commands.length > 0 ? commands : detectCommands();

  if (detected.length === 0 && hasArtifact) return [];

  if (detected.length === 0) {
    return [
      {
        name: sectionName,
        command: "",
        status: "missing",
        exitCode: null,
        summary: `No ${sectionName} command or local ${sectionName} artifact was found.`,
      },
    ];
  }

  return detected.map((command) => runSafeCommand(command));
}

function configuredToolCommands(sectionName, projects, configPath) {
  if (!existsSync(configPath) || projects.length !== 1) return [];

  const content = readFileSync(configPath, "utf8");
  return readSectionCommandLines(content, sectionName).map((template) => ({
    name: `${sectionName}: ${template}`,
    command: template
      .replaceAll("{project}", projects[0].name)
      .replaceAll("{projectRoot}", projects[0].root),
  }));
}

function detectCoverageCommands() {
  const scripts = packageScripts();
  for (const name of ["test:coverage", "coverage"]) {
    if (scripts[name]) return [{ name: `coverage script ${name}`, command: packageRunCommand(name) }];
  }
  if (existsSync("coverage/lcov.info")) return [];
  return [];
}

function packageScripts() {
  if (!existsSync("package.json")) return {};
  return JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
}

function packageRunCommand(scriptName) {
  const manager = packageManager();
  return manager === "npm" ? `npm run ${scriptName}` : `${manager} ${scriptName}`;
}

function packageManager() {
  if (existsSync("yarn.lock")) return "yarn";
  if (existsSync("pnpm-lock.yaml")) return "pnpm";
  return "npm";
}

function readCoverageArtifacts() {
  const artifacts = [];
  if (existsSync("coverage/coverage-summary.json")) {
    const summary = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));
    const total = summary.total ?? {};
    artifacts.push({
      name: "coverage summary",
      command: "coverage/coverage-summary.json",
      status: "evidence",
      exitCode: null,
      summary: `Lines ${coveragePct(total.lines)}, branches ${coveragePct(total.branches)}, functions ${coveragePct(total.functions)}, statements ${coveragePct(total.statements)}.`,
    });
  } else if (existsSync("coverage/lcov.info")) {
    artifacts.push({
      name: "lcov coverage",
      command: "coverage/lcov.info",
      status: "evidence",
      exitCode: null,
      summary: "LCOV coverage artifact exists. This workflow treats coverage as supporting evidence, not proof of test confidence.",
    });
  }
  return artifacts;
}

function coveragePct(metric) {
  return metric?.pct === undefined ? "unknown" : `${metric.pct}%`;
}

function assessTestMeaning(categorized, relatedTests, baseRef) {
  const codeTerms = changedCodeTerms(categorized, baseRef);
  const changedStems = [...categorized.production, ...categorized.contracts]
    .map((change) => moduleStem(change.path))
    .filter(Boolean);

  const tests = relatedTests.map((test) => {
    const content = existsSync(test.path) ? readFileSync(test.path, "utf8") : "";
    const names = extractTestNames(content);
    const assertionCount = countMatches(content, /\bexpect\s*\(|\bassert\.|\bassert\s*\(/g);
    const codeTermHits = codeTerms.filter((word) => content.toLowerCase().includes(word));
    const moduleHits = changedStems.filter((stem) => content.includes(stem));
    const hasBehaviorWords = names.some((name) =>
      /\b(should|returns|throws|rejects|handles|prevents|allows|blocks|validates|fails|succeeds|renders|updates)\b/i.test(
        name
      )
    );
    const meaningful =
      assertionCount > 0 && (codeTermHits.length > 0 || moduleHits.length > 0 || hasBehaviorWords);
    const shallowReasons = [];
    if (assertionCount === 0) shallowReasons.push("no obvious assertions");
    if (codeTermHits.length === 0 && moduleHits.length === 0)
      shallowReasons.push("no obvious changed-code or changed-module terms");
    if (/toMatchSnapshot\s*\(/.test(content) && assertionCount <= 1)
      shallowReasons.push("snapshot-only or snapshot-heavy signal");

    return {
      ...test,
      reasons: [...test.reasons],
      names: names.slice(0, 8),
      assertionCount,
      codeTermHits: codeTermHits.slice(0, 8),
      moduleHits,
      meaningful,
      shallowReasons,
    };
  });

  const meaningfulTests = tests.filter((test) => test.meaningful);
  const primaryTests = tests.filter((test) => test.relevance === "primary");
  const candidateTests = tests.filter((test) => test.relevance !== "primary");
  const primaryMeaningfulTests = primaryTests.filter((test) => test.meaningful);
  const primaryAssessmentSurface = primaryTests.length > 0 ? primaryTests : tests;
  const edgeSignals = collectEdgeSignals(primaryAssessmentSurface);
  const unproven = [];
  if (primaryAssessmentSurface.length === 0)
    unproven.push(
      "No primary related tests were found; only broad candidate tests were discoverable."
    );
  if (primaryMeaningfulTests.length === 0)
    unproven.push(
      "No primary related test showed both assertions and a clear link to changed code or changed modules."
    );
  if (!edgeSignals.failure) unproven.push("Failure/error behavior is not clearly exercised.");
  if (!edgeSignals.edge) unproven.push("Boundary or edge-case behavior is not clearly exercised.");
  if (!edgeSignals.regression)
    unproven.push("Regression-specific assertions are not clearly identified.");

  return {
    tests,
    primaryTests,
    candidateTests,
    meaningfulTests,
    primaryMeaningfulTests,
    edgeSignals,
    unproven,
    codeTerms: codeTerms.slice(0, 20),
    changedStems,
  };
}

function changedCodeTerms(categorized, baseRef) {
  const changedFiles = [...categorized.production, ...categorized.contracts].map(
    (change) => change.path
  );
  const addedText = changedFiles
    .flatMap((file) => [
      tryGit(["diff", "--unified=0", `${baseRef}...HEAD`, "--", file]).stdout,
      tryGit(["diff", "--cached", "--unified=0", "--", file]).stdout,
      tryGit(["diff", "--unified=0", "--", file]).stdout,
    ])
    .join("\n")
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");

  return keywords(addedText);
}

function keywords(text) {
  return [...new Set(text.toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) ?? [])]
    .filter((word) => !COMMON_WORDS.has(word))
    .slice(0, 80);
}

function extractTestNames(content) {
  const names = [];
  const pattern = /\b(?:describe|it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = pattern.exec(content))) names.push(match[1]);
  return names;
}

function collectEdgeSignals(tests) {
  const text = tests
    .flatMap((test) => test.names)
    .join(" ")
    .toLowerCase();
  return {
    failure: /\b(error|fail|reject|throw|invalid|missing|unauthori[sz]ed|forbid|deny)\b/.test(text),
    edge: /\b(edge|empty|null|undefined|boundary|duplicate|multiple|zero|limit|fallback)\b/.test(
      text
    ),
    regression: /\b(regression|previous|again|does not|prevents|guards)\b/.test(text),
  };
}

function decideResult(checklist) {
  const failedRequired = checklist.checks.filter((check) => check.required && !check.passed);
  const passed = checklist.score >= checklist.threshold && failedRequired.length === 0;
  return {
    label: passed ? RESULT.PASS : RESULT.FAIL,
    why: passed
      ? `Weighted checklist score is ${checklist.score}/${checklist.maxScore}, meeting the ${checklist.threshold}/${checklist.maxScore} pass threshold.`
      : `Weighted checklist score is ${checklist.score}/${checklist.maxScore}; ${
          failedRequired.length > 0
            ? `required check failed: ${failedRequired.map((check) => check.name).join(", ")}.`
            : `below the ${checklist.threshold}/${checklist.maxScore} pass threshold.`
        }`,
  };
}

function buildChecklist(categorized, relatedTests, validation, assessment) {
  const behaviorImpacting = categorized.production.length > 0 || categorized.contracts.length > 0;
  const configOrToolingImpacting = categorized.config.length > 0 || categorized.tooling.length > 0;
  const validationFailed = validation.some((item) => item.status === "failed");
  const validationPassed = validation.some((item) => item.status === "passed");
  const validationRequired = behaviorImpacting || configOrToolingImpacting;
  const checks = [
    {
      name: "Changed code classified",
      weight: 10,
      required: true,
      passed:
        behaviorImpacting ||
        configOrToolingImpacting ||
        categorized.docs.length > 0 ||
        categorized.other.length > 0,
      evidence: behaviorImpacting
        ? `${categorized.production.length + categorized.contracts.length} behavior-impacting file(s) identified.`
        : "No behavior-impacting production or contract files were identified.",
    },
    {
      name: "Related tests found",
      weight: 25,
      required: behaviorImpacting,
      passed: !behaviorImpacting || relatedTests.length > 0,
      evidence:
        assessment.primaryTests.length > 0
          ? `${assessment.primaryTests.length} primary related test file(s) found.`
          : relatedTests.length > 0
            ? `${relatedTests.length} broad candidate test file(s) found, but none were primary.`
            : behaviorImpacting
              ? "No related tests found."
              : "No behavior-impacting files require related tests.",
    },
    {
      name: "Validation passed",
      weight: 30,
      required: validationRequired,
      passed: validationRequired ? validationPassed && !validationFailed : true,
      evidence: validationSummary(validation),
    },
    {
      name: "Meaningful assertions",
      weight: 25,
      required: behaviorImpacting,
      passed: !behaviorImpacting || assessment.primaryMeaningfulTests.length > 0,
      evidence:
        assessment.primaryMeaningfulTests.length > 0
          ? `${assessment.primaryMeaningfulTests.length} primary related test file(s) have assertions tied to changed code, behavior names, or changed modules.`
          : assessment.meaningfulTests.length > 0
            ? "Only broad candidate tests showed meaningful assertion signals."
            : "No meaningful assertion signal found in related tests.",
    },
    {
      name: "Low remaining uncertainty",
      weight: 10,
      required: false,
      passed: assessment.unproven.length <= 2,
      evidence:
        assessment.unproven.length === 0
          ? "No major static gaps were identified."
          : assessment.unproven.slice(0, 2).join(" "),
    },
  ];

  const maxScore = checks.reduce((sum, check) => sum + check.weight, 0);
  const score = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);

  return {
    checks,
    maxScore,
    score,
    threshold: PASS_THRESHOLD,
    percentage: Math.round((score / maxScore) * 100),
  };
}

function renderReport(context) {
  const {
    result,
    checklist,
    specPath,
    spec,
    baseRef,
    changes,
    excludedChanges,
    categorized,
    configPath,
    config,
    projects,
    relatedTests,
    validation,
    qualityTools,
    assessment,
  } = context;
  const behaviorFromDiff = [...categorized.production, ...categorized.contracts].map(
    (change) => change.path
  );
  const specSummary = spec ? firstMeaningfulLines(spec, 3) : "";

  return `# Test Confidence Result

## Result
${result.label}

## Checklist outcome
- Score: ${checklist.score}/${checklist.maxScore} (${checklist.percentage}%)
- Pass threshold: ${checklist.threshold}/${checklist.maxScore}
- Final outcome: ${result.label}

## Why
${result.why}

## Weighted checklist
${checklist.checks.map(renderChecklistItem).join("\n")}

## Change summary
- Production code: ${formatFiles(categorized.production)}
- Tests: ${formatFiles(categorized.tests)}
- Contracts: ${formatFiles(categorized.contracts)}
- Other changed areas: ${formatFileCounts({ docs: categorized.docs, contracts: categorized.contracts, configTooling: [...categorized.config, ...categorized.tooling], other: categorized.other })}
- Compared against: \`${baseRef}\`
- Diff entries considered: ${changes.length}
- Path filter: ${pathFilterSummary(config)}
- Excluded diff entries: ${excludedChanges.length}

## Code/test scope
- Spec source: ${specPath ? `\`${path.relative(process.cwd(), specPath)}\`` : "none provided"}
- Spec context: ${specPath ? specSummary || "No concise context lines could be extracted." : "Not provided. This is a best-effort code/test assessment based only on the diff."}
- Changed code under test: ${behaviorFromDiff.length > 0 ? inlineList(behaviorFromDiff) : "no production-code behavior change was detected by file classification."}
- Scope note: The spec is included as context only. This confidence judgment assesses whether tests meaningfully exercise the changed code; it does not decide whether the code satisfies the spec.
- Code/test link: ${assessment.changedStems.length > 0 || assessment.codeTerms.length > 0 ? "The workflow found changed-code or changed-module terms to compare against tests." : "The workflow found limited changed-code terms, so static test relevance is less certain."}

## Evidence found
- Primary related tests: ${assessment.primaryTests.length === 0 ? "none" : ""}
${assessment.primaryTests.map((test) => `  - \`${test.path}\` (${displayReasons(test).join("; ")})`).join("\n") || ""}
- Broad candidate tests: ${assessment.candidateTests.length}
- Projects inferred: ${projects.length === 0 ? "none" : projects.map((project) => `\`${project.name}\` at \`${project.root}\``).join(", ")}
- Validation config: \`${path.relative(process.cwd(), configPath)}\`
- Validation commands run:
${validation.map((item) => `  - ${item.command ? `\`${item.command}\`` : item.name}: ${item.status}${item.exitCode === null ? "" : ` (exit ${item.exitCode})`}\n    ${item.summary}`).join("\n")}
- Static test evidence: ${assessment.primaryMeaningfulTests.length} of ${assessment.primaryTests.length} primary related test file(s) showed assertions tied to changed-code terms, changed modules, or behavior-oriented test names.

## Optional quality tools
${renderQualityTools(qualityTools)}

## Test meaning assessment
${assessment.primaryTests.length === 0 ? "- No primary related tests were available for static inspection." : assessment.primaryTests.map(renderTestAssessment).join("\n")}
- Edge/failure/regression signals: failure=${yesNo(assessment.edgeSignals.failure)}, edge=${yesNo(assessment.edgeSignals.edge)}, regression=${yesNo(assessment.edgeSignals.regression)}

## Gaps and uncertainty
${assessment.unproven.map((gap) => `- ${gap}`).join("\n") || "- No major static gaps were identified by the workflow heuristics."}
${validation.some((item) => item.status !== "passed") ? "- Validation execution is incomplete or unsuccessful; do not overclaim confidence from static inspection alone." : ""}
- Mental mutation thinking, coverage, and Codecov evidence are supporting signals only; they do not replace meaningful related tests.
- Codecov upload/network operations are not run by default. Use generated local coverage artifacts or CI-provided Codecov results as evidence.
- This workflow does not include runtime integration tracing or test-impact analysis.
- This workflow may miss tests that exercise behavior indirectly through higher-level flows with unrelated file names or imports.

## Recommended next step
${recommendedNextStep(checklist, relatedTests, validation, assessment)}
`;
}

function renderJsonContract(context) {
  const {
    result,
    checklist,
    specPath,
    baseRef,
    changes,
    excludedChanges,
    categorized,
    configPath,
    config,
    projects,
    validation,
    qualityTools,
    assessment,
  } = context;
  const failedRequired = checklist.checks.filter((check) => check.required && !check.passed);

  return {
    skill_version: "1.0.0",
    outcome: result.label,
    passed: result.label === RESULT.PASS,
    score: checklist.score,
    max_score: checklist.maxScore,
    threshold: checklist.threshold,
    required_checks_passed: failedRequired.length === 0,
    checks: checklist.checks.map((check) => ({
      name: check.name,
      passed: check.passed,
      weight: check.weight,
      earned: check.passed ? check.weight : 0,
      required: check.required,
      evidence: check.evidence,
    })),
    validation: validation.map(commandResultForJson),
    quality_tools: qualityTools.map(commandResultForJson),
    related_tests: {
      primary: assessment.primaryTests.map(testForJson),
      candidate_count: assessment.candidateTests.length,
      primary_meaningful_count: assessment.primaryMeaningfulTests.length,
    },
    change_summary: {
      production: categorized.production.map((change) => change.path),
      tests: categorized.tests.map((change) => change.path),
      contracts: categorized.contracts.map((change) => change.path),
      config_tooling: [...categorized.config, ...categorized.tooling].map((change) => change.path),
      docs: categorized.docs.map((change) => change.path),
      other_count: categorized.other.length,
      considered_count: changes.length,
      excluded_count: excludedChanges.length,
    },
    uncertainty: {
      gaps: assessment.unproven,
      edge_signals: assessment.edgeSignals,
    },
    metadata: {
      spec: specPath ? path.relative(process.cwd(), specPath) : null,
      base: baseRef,
      config: path.relative(process.cwd(), configPath),
      path_filter: pathFilterSummary(config),
      projects: projects.map((project) => ({ name: project.name, root: project.root })),
      generated_at: new Date().toISOString(),
    },
  };
}

function commandResultForJson(item) {
  return {
    name: item.name,
    command: item.command,
    status: item.status,
    exit_code: item.exitCode,
    summary: stripAnsi(item.summary),
  };
}

function testForJson(test) {
  return {
    path: test.path,
    reasons: test.reasons,
    meaningful: test.meaningful,
    assertion_count: test.assertionCount,
    test_names: test.names,
  };
}

function renderTestAssessment(test) {
  return `- \`${test.path}\`: ${test.meaningful ? "appears meaningful" : "weak signal"}; assertions=${test.assertionCount}; names=${test.names.length === 0 ? "none found" : test.names.map((name) => `"${name}"`).join(", ")}; gaps=${test.shallowReasons.length === 0 ? "none obvious" : test.shallowReasons.join(", ")}`;
}

function displayReasons(test) {
  const primaryReasons = test.reasons.filter(
    (reason) => reason === "changed test file" || reason.startsWith("references ")
  );
  return primaryReasons.length > 0 ? primaryReasons : test.reasons.slice(0, 2);
}

function renderChecklistItem(check) {
  return `- ${check.name}: ${check.passed ? "Pass" : "Fail"} (${check.passed ? check.weight : 0}/${check.weight}${check.required ? ", required" : ""}). ${check.evidence}`;
}

function renderQualityTools(qualityTools) {
  if (qualityTools.length === 0) {
    return "- Not requested. Run with `--with-coverage` to collect optional coverage evidence.";
  }
  return qualityTools
    .map(
      (item) =>
        `- ${item.name}: ${item.status}${item.exitCode === null ? "" : ` (exit ${item.exitCode})`}${item.command ? ` via \`${item.command}\`` : ""}\n  ${item.summary}`
    )
    .join("\n");
}

function validationSummary(validation) {
  const passed = validation.filter((item) => item.status === "passed").length;
  const failed = validation.filter((item) => item.status === "failed").length;
  const missing = validation.filter((item) =>
    ["missing", "skipped", "blocked"].includes(item.status)
  ).length;
  return `${passed} passed, ${failed} failed, ${missing} missing/skipped/blocked.`;
}

function recommendedNextStep(checklist, relatedTests, validation, assessment) {
  if (validation.some((item) => item.status === "failed"))
    return "Fix the failing validation command, then rerun this workflow.";
  if (relatedTests.length === 0)
    return "Add or identify the smallest test that exercises the intended behavior change, then rerun validation.";
  if (validation.every((item) => item.status !== "passed"))
    return "Configure or run the narrowest repo-local test command for the related project.";
  if (assessment.meaningfulTests.length === 0)
    return "Strengthen the related tests so they assert observable behavior of the changed code rather than only mirroring implementation details.";
  if (checklist.score < checklist.threshold)
    return "Add one focused edge/failure/regression assertion for the highest-risk unproven behavior.";
  return "Use this report as validation evidence for PR creation, with human review for code quality and product fit.";
}

function formatFiles(files) {
  if (files.length === 0) return "none";
  return files
    .map((change) => `\`${change.path}\` (${change.status}; ${change.source})`)
    .join(", ");
}

function formatFileCounts(groups) {
  return (
    Object.entries(groups)
      .filter(([, files]) => files.length > 0)
      .map(([name, files]) => `${name}=${files.length}`)
      .join(", ") || "none"
  );
}

function pathFilterSummary(config) {
  if (config.includePaths.length > 0) {
    return `include ${config.includePaths.map((pattern) => `\`${pattern}\``).join(", ")}`;
  }
  if (config.ignorePaths.length > 0) {
    return `ignore ${config.ignorePaths.map((pattern) => `\`${pattern}\``).join(", ")}`;
  }
  return "none";
}

function inlineList(items) {
  return items.map((item) => `\`${item}\``).join(", ");
}

function firstMeaningfulLines(text, maxLines) {
  return text
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line && !line.startsWith("```"))
    .slice(0, maxLines)
    .join(" / ");
}

function summarizeOutput(output) {
  const lines = output
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const interesting = lines.filter((line) =>
    /(pass|fail|error|test|suite|duration|nx|vitest|failed|passed)/i.test(line)
  );
  return (
    (interesting.length > 0 ? interesting : lines).slice(-8).join(" | ") || "No output captured."
  );
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function stripAnsi(text) {
  return String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function tryGit(args) {
  return tryExec("git", args);
}

function gitRefExists(ref) {
  return tryGit(["rev-parse", "--verify", "--quiet", ref]).status === 0;
}

function tryExec(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10000 });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
