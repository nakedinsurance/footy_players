---
name: test-confidence-review
description: Use when a developer needs local validation evidence for a code change, especially to decide whether related tests meaningfully exercise the changed code. Reviews git diff, related tests, narrow validation command results, and explicit gaps without judging whether the implementation satisfies the product spec.
---

# Test Confidence Review

Use this workflow when the user needs validation evidence for a change, not a broad code review.

The workflow answers:

> Do the tests around this change meaningfully exercise the changed code and provide useful regression confidence?

## Inputs

- Optional markdown spec or intent context passed as `--spec <path>`. This is context only; spec compliance is owned by another review workflow.
- If no spec is provided, run a best-effort code/test assessment from the changed files and related tests only.
- The current branch and working tree diff against the default branch.
- Optional base ref override with `--base <ref>`.
- Optional config override with `--config <path>`.
- Optional output path with `--out <path>`.
- Optional JSON contract output path with `--json-out <path>`.
- Optional coverage evidence with `--with-coverage`.

## Modes

### GitHub Action Mode

Use this mode for PR automation. It is the authoritative validation evidence that feeds `spec-review`.

Recommended CI flow:

1. Install project dependencies.
2. Install optional skill tool dependencies from the skill manifests when present.
3. Run the deterministic evidence collector with `--json-out` and `--with-coverage`.
4. Invoke an agent with this skill to perform the qualitative static review of test value, shallow tests, and missed edge cases.
5. Pass the JSON artifact and agent review to `spec-review`.
6. Upload the markdown, JSON, agent review, and coverage reports as workflow artifacts.

CI command shape:

```sh
node .cursor/skills/test-confidence-review/scripts/test-confidence-review.mjs \
  --base origin/main \
  --spec PRD.md \
  --with-coverage \
  --out test-confidence-result.md \
  --json-out test-confidence-result.json
```

Then run the agent against this skill, using `test-confidence-result.json`, `test-confidence-result.md`, and the changed tests as input. The agent review should explicitly assess whether the tests are meaningful or shallow, whether they merely satisfy coverage metrics, and which edge/failure/regression cases remain untested.

### Local Offline Mode

Use this mode as an optional developer pre-flight before opening or updating a PR. It should run without network access after dependencies are installed.

Recommended local command:

```sh
npm run test-confidence
```

Run the CI-equivalent local check when you want coverage evidence too:

```sh
npm run test-confidence:ci
```

Local output files are intentionally ignored by git:

- `test-confidence-result.md`
- `test-confidence-result.json`
- `test-confidence-agent-review.md`
- `coverage/`

## Direct Command

Run the bundled script from the target repo root. Resolve `<skill-dir>` to the installed skill folder:

```sh
node <skill-dir>/scripts/test-confidence-review.mjs --out test-confidence-result.md
```

For CI or downstream skills, also emit the JSON contract:

```sh
node <skill-dir>/scripts/test-confidence-review.mjs --out test-confidence-result.md --json-out test-confidence-result.json
```

Pass `--spec <path>` when useful context exists. Do not invent a spec just to run the workflow.

The script uses repo-local `.test-confidence.yml` when present. Otherwise it falls back to the bundled default at `assets/default-test-confidence.yml`.

Repo-local config may either include only specific paths or ignore noisy paths. Use exactly one mode; configuring both `include.paths` and `ignore.paths` is invalid.

Use include mode to limit review to a target surface:

```yaml
include:
  paths:
    - apps/mcp-server/src/**
```

Use ignore mode to exclude generated or irrelevant paths:

```yaml
ignore:
  paths:
    - generated/**
    - fixtures/large/**
    - "**/*.snap"
```

Excluded files are removed from change classification, related-test discovery, project inference, and validation command selection. The report lists the active path filter and the number of excluded diff entries so the workflow does not hide that evidence was excluded.

Project inference supports common Nx layouts:

- Central `workspace.json` / `angular.json` project maps.
- Per-project `project.json`.
- Package-based projects from nested `package.json`.

This supports workspaces where Nx project names are not package names.

Use `--base <ref>` when default-branch discovery is unavailable or wrong.

Use `--config <path>` to force a specific validation config.

Use `--no-run` when validation commands must not be executed; the report must then treat execution evidence as missing.

Use `--with-coverage` to run configured coverage evidence or read local coverage artifacts such as `coverage/coverage-summary.json` and `coverage/lcov.info`.

The skill includes optional dependency manifests:

- `requirements.txt` for coverage-adjacent Python tools such as `codecov-cli`.

These manifests travel with the skill. They are not installed automatically; dependency installation still requires explicit user approval. Prefer repo-local tools when the target repo already has them.

Bundled references:

- `assets/example-spec.md`: minimal example spec input.
- `references/example-output.md`: example report.
- `references/eval-scenarios.md`: lightweight eval scenarios.

## Evidence Bar

Before reporting `Pass`, combine these evidence types:

- Change understanding: identify changed production, test, docs, config, and tooling files, plus the code areas the tests should exercise.
- Executed validation: run a configured narrow repo-local validation command when a related project can be inferred, and capture pass/fail evidence.
- Test meaning assessment: identify tests that exist, tests that ran, tests that appear relevant to the changed code, tests that appear meaningful, tests that are shallow or coverage-gaming, and changed behavior that remains unproven.

Passing tests are not enough. A test is meaningful only if it appears to challenge observable behavior of the changed code or a likely regression in a way that would catch a real mistake. Do not treat code coverage as proof of confidence; coverage is only a weak indicator.

Coverage reports are supporting evidence. High line coverage can reduce uncertainty, but cannot make unrelated or shallow tests meaningful by itself.

## Result Labels

- `Pass`: weighted checklist score is at least 80/100 and every required check passes.
- `Fail`: weighted checklist score is below 80/100 or any required check fails.

Docs-only changes may be sufficient without behavior tests if the diff truly has no behavior, config, tooling, or test impact. Tooling/config changes need targeted validation evidence when feasible.

## Weighted Checklist

The report must score these checks:

- Changed code classified: 10 points, required.
- Related tests found: 25 points, required for behavior-impacting production or contract changes.
- Validation passed: 30 points, required for behavior-impacting, config, or tooling changes.
- Meaningful assertions: 25 points, required for behavior-impacting production or contract changes.
- Low remaining uncertainty: 10 points, optional.

The final outcome is `Pass` only when the score is at least 80/100 and all required checks pass.

## JSON Contract

When `--json-out <path>` is provided, emit a stable JSON artifact for downstream skills such as `spec-review`.

Required top-level fields:

```json
{
  "skill_version": "1.0.0",
  "outcome": "Pass",
  "passed": true,
  "score": 90,
  "max_score": 100,
  "threshold": 80,
  "required_checks_passed": true,
  "checks": [],
  "validation": [],
  "quality_tools": [],
  "related_tests": {},
  "change_summary": {},
  "uncertainty": {},
  "metadata": {}
}
```

Downstream consumers must use this JSON contract instead of parsing the markdown report.

## Scope Boundary

Test Confidence owns:

- Whether validation around the change is meaningful.
- Whether relevant tests exist and ran.
- Whether tests appear to exercise the changed code through observable behavior.
- What validation gaps remain.

Code Review owns:

- Whether the implementation satisfies the spec.
- Whether the code change itself is acceptable.
- Architecture, maintainability, style, safety, product fit, and overall approval.

Do not duplicate broad code-review scoring or checklist logic.

## Safety

Allowed:

- Read git diff and local files.
- Inspect tests and changed modules.
- Run configured narrow repo-local validation commands.
- Run configured or auto-detected optional coverage commands only when explicitly requested.
- Produce local markdown reports.

Avoid unless explicitly approved:

- Arbitrary commands not present in `.test-confidence.yml` or the script's safe built-in Nx project-test fallback.
- Network calls, secrets access, production/staging calls, dependency installation, Codecov uploads, or automatic code modification.

## Optional Tool Config

Optional coverage tools are separate from the required validation checklist. Configure them in `.test-confidence.yml` when repo-local scripts exist:

```yaml
coverage:
  commandTemplates:
    - name: vitest coverage
      command: yarn test --coverage
      when: single-project
```

Codecov is treated as coverage evidence, not a default upload step. Prefer local reports generated by the test command, CI-provided Codecov summaries, or `codecov-cli` dry-run style checks when explicitly configured by the repo.

## Report Format

The report must use this structure:

```md
# Test Confidence Result

## Result

Pass | Fail

## Checklist outcome

- Score: earned/100
- Pass threshold: 80/100
- Final outcome: Pass | Fail

## Why

Short explanation of the judgment.

## Weighted checklist

- Changed code classified: Pass | Fail (earned/10, required)
- Related tests found: Pass | Fail (earned/25, required when behavior-impacting)
- Validation passed: Pass | Fail (earned/30, required when validation is needed)
- Meaningful assertions: Pass | Fail (earned/25, required when behavior-impacting)
- Low remaining uncertainty: Pass | Fail (earned/10)

## Change summary

- What changed in production code
- What changed in tests
- Coarse counts for other changed areas, if relevant

## Code/test scope

- Spec context, if provided
- What changed code the tests should be exercising
- Any code/test alignment uncertainty

## Evidence found

- Primary related tests found
- Broad candidate test count
- Validation commands run
- Pass/fail result
- Any static evidence from test inspection

## Optional quality tools

- Coverage evidence requested or not requested
- Mutation evidence requested or not requested
- Local artifacts found, commands run, skipped, blocked, or missing

## Test meaning assessment

- What the primary tests appear to validate
- Whether they check meaningful behavior or mostly mirror implementation
- Edge cases / failure cases / regression areas covered

## Gaps and uncertainty

- Relevant behavior not covered
- Tests not executed or not discoverable
- Missing integration or runtime evidence
- Coverage caveats, if coverage is available
- Any assumptions made

## Recommended next step

The smallest useful action to improve confidence.
```
