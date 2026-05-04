---
name: spec-review
description: >
  Review code changes against a spec document (PRD, requirements markdown, user story) using
  parallel specialist sub-agents. Produces a machine-readable verdict contract (SHIP / NEEDS_WORK /
  BLOCKED), per-requirement coverage with confidence scores, risk signals with severity ceiling,
  pre-open vs pre-merge gate classification, and an intent alignment assessment. Designed so
  downstream CI, PR bots, and dashboards can rely on a stable JSON output contract without
  parsing prose.
  Use when asked to "review against spec", "check implementation vs PRD", "did we build what was
  specced", "spec review", or invokes /spec-review.
---

# Spec Review

Review a code implementation against a specification using parallel specialist agents. Emits
both a human report and a machine-readable contract for downstream automation.

**Skill version:** `1.1.0` — emit this as `skill_version` in JSON output.

---

## When Invoked

Parse these arguments from the user message:

| Arg | Description | Required |
|-----|-------------|----------|
| `--spec <path>` | Path to spec file (PRD, requirements markdown, user story) | Yes |
| `--branch <name>` | Branch to diff against base (default: current branch) | No |
| `--base <name>` | Base branch (default: `main`) | No |
| `--diff <path>` | Path to a pre-generated diff file | No (alt to --branch) |
| `--focus <area>` | Narrow review to a domain (e.g. "auth", "payments") | No |
| `--output <fmt>` | `human` (default), `json`, or `both` | No |
| `--gate <stage>` | `pre-open`, `pre-merge`, or `all` (default) | No |

If `--spec` is missing, ask: "Which spec file should I review against? Provide the path."

If neither `--branch` nor `--diff` is provided, default to `git diff <base>...HEAD`.

### Path safety

Before reading `--spec`:
1. Resolve the path to an absolute path.
2. If it does not start with the repo root (`git rev-parse --show-toplevel`) AND is not a URL, abort with `error: spec path outside repo root`.
3. If the path resolves through a symlink that escapes the repo root, abort.

---

## Boundary: what this skill owns vs delegates

This skill is a **consistency checker** — does the code match the spec, are there obvious risks. It does NOT replicate signals other tools own.

| Signal | Owner | Spec-review behaviour |
|--------|-------|-----------------------|
| Test pass/fail | Test runner | Do not assert. Read from CI report if attached. |
| Coverage % (line/branch) | Coverage tool | Do not score. May reference the number if provided. |
| Build success | CI build step | Do not assert. |
| Type errors | Type checker | Do not flag. |
| Lint errors | Linter | Do not flag. |
| Dependency CVEs | Audit tool | Do not duplicate. |
| Spec alignment | **This skill** | Owned. |
| Risk in changed code | **This skill** | Owned. |
| Design + correctness review | **This skill** | Owned. |
| Intent gap | **This skill** | Owned. |

**Hard rule for Agent C (Quality):** must not produce a coverage percentage or a "X% of new lines tested" finding. May flag a missing test ONLY when tied to a specific spec AC. Coverage tooling owns coverage.

---

## Execution Strategy

**Claude Code** (Agent tool available): spawn Phase 1 agents in parallel, then Phase 2 aggregation after all complete.

**Other editors** (no Agent tool): execute each agent task sequentially in one pass, labeling each section. Same output contract.

---

## Phase 1 — Parallel Intake

Spawn (or execute sequentially) these four specialist agents simultaneously.

---

### Agent A: Spec Parser

> Read the spec file at `{SPEC_PATH}`.
>
> Extract and structure ALL of the following. Be exhaustive — a missed requirement won't be reviewed.
>
> **1. REQUIREMENTS** — explicit statements of what the system must/should/shall do.
> For each:
> - `id`: REQ-001, REQ-002...
> - `text`: exact or paraphrased wording
> - `type`: `functional` | `non_functional` | `constraint`
> - `priority`: `must` | `should` | `could`
> - `testable`: `yes` | `no` | `partial`
>
> **2. ACCEPTANCE_CRITERIA** — explicit ACs, definition of done, or success conditions.
> For each:
> - `id`: AC-001, AC-002...
> - `text`: the criterion
> - `linked_req`: which REQ it proves (best guess if not explicit)
>
> **3. CONSTRAINTS** — performance targets, security requirements, data retention, compliance, backwards-compatibility requirements.
>
> **4. OUT_OF_SCOPE** — what the spec explicitly says NOT to build.
>
> **5. SUCCESS_METRICS** — measurable outcomes: latency budgets, error rate targets, conversion rates.
>
> **6. SPEC_GAPS** — places where the spec is unclear, silent, or self-contradictory.
> Each: `{ id, location, issue }`.
>
> Output as a single JSON object with these top-level keys, lowercase. No prose outside the JSON.

---

### Agent B: Diff Analyzer

> Get the code diff using one of:
> - `git diff <BASE>...HEAD` for the current branch (default base: `main`)
> - Read the diff file at `{DIFF_PATH}` if provided
>
> Output a single JSON object with these keys:
>
> **1. `changed_files`** — `[{ path, change_type: added|modified|deleted, line_delta_added, line_delta_removed }]`
>
> **2. `domain_groups`** — `[{ domain, files: [...] }]` grouped by logical domain (auth, api, database, ui, tests, config, infra).
>
> **3. `new_capabilities`** — `[{ name, kind: function|endpoint|component|event|cli|env_var, location }]`
>
> **4. `removed_or_changed`** — `[{ kind, before, after, location }]` for behavioural breaks: API contracts, DB schema, config keys, event schemas.
>
> **5. `tests_added_or_changed`** — list of test files touched. NO coverage scoring. NO percentages. NO "X is untested" assertions.
>
> **6. `entry_points`** — public APIs, events, CLI flags, env vars a caller must know about.
>
> No prose outside the JSON.

---

### Agent C: Quality Reviewer

> Review the code diff for quality issues. Skip style nits unless they hide bugs.
>
> Categories:
>
> **1. CORRECTNESS** — logic errors, off-by-one, wrong conditions, unhandled return values.
>
> **2. ERROR_HANDLING** — missing try/catch at I/O boundaries, unhandled promise rejections, silent failures, errors swallowed without logging.
>
> **3. SPEC_LINKED_TEST_GAPS** — ONLY flag a missing test when it ties to a specific spec AC. Format: `missing test for AC-XX: <what is untested>`. Do NOT produce coverage percentages. Do NOT flag generic "more tests needed".
>
> **4. DESIGN** — violations of existing codebase patterns, premature abstraction, magic numbers/strings, copy-paste duplication.
>
> **5. READABILITY** — identifiers that obscure intent, missing WHY comments for non-obvious decisions.
>
> Output JSON array, each finding:
> ```json
> {
>   "file": "path/to/file.ts",
>   "line": 42,
>   "severity": "high" | "med" | "low",
>   "category": "correctness" | "error_handling" | "spec_linked_test_gap" | "design" | "readability",
>   "issue": "what is wrong",
>   "suggestion": "concrete fix",
>   "linked_ac": "AC-XX"  // only for spec_linked_test_gap
> }
> ```
>
> Focus HIGH first. Only flag LOW if clearly worth attention.

---

### Agent D: Risk Reviewer

> Review the code diff for risks that could cause incidents, security issues, or data loss.
>
> **1. SECURITY**
> - Injection (SQL, command, template, path traversal)
> - Auth/authz bypass or missing permission checks
> - Secrets or credentials in code, logs, or responses
> - Insecure storage (plaintext passwords, PII in logs, unencrypted sensitive fields)
> - Missing input validation at API/service boundaries
>
> **2. DATA_INTEGRITY**
> - Missing DB transactions on multi-step writes
> - Race conditions or TOCTOU
> - Missing idempotency on retry-able operations
> - Schema migrations without rollback path
>
> **3. BREAKING_CHANGES**
> - API contract changes (removed fields, changed types, renamed endpoints)
> - Event schema changes affecting downstream consumers
> - Config key renames without migration
> - DB column renames or drops without backward-compat window
>
> **4. OPERATIONAL**
> - No observability on new code paths (missing logs/metrics/traces)
> - External calls without timeout or circuit breaker
> - Unclosed resources, unbounded in-memory caches
> - Missing rate limiting on new public endpoints
>
> Output JSON array, each risk:
> ```json
> {
>   "file": "path/to/file.ts",
>   "line": 42,
>   "severity": "HIGH" | "MED" | "LOW",
>   "category": "security" | "data_integrity" | "breaking_changes" | "operational",
>   "risk": "what could go wrong",
>   "likelihood": "likely" | "possible" | "unlikely",
>   "mitigation": "concrete fix",
>   "gate_stage": "pre_open" | "pre_merge"
> }
> ```
>
> **`gate_stage` rule:** assign `pre_open` ONLY for security risks that, once committed, cause damage regardless of merge (secrets in diff, credentials, known critical CVEs introduced). All other risks are `pre_merge`.
>
> **Severity guide:**
> - HIGH = could cause data loss, security incident, or production outage
> - MED = degraded experience, hard-to-detect bugs, tech debt that bites
> - LOW = minor issues that compound

---

## Phase 2 — Aggregation

After all Phase 1 agents complete, run aggregation with all four results.

### Step 1: Map each REQ and AC to the diff

Search for implementation signals: function/method names, endpoint paths, test descriptions, config keys, schema fields, event names.

For each requirement, produce:
- `status`: `implemented` | `partial` | `missing` | `out_of_scope`
- `evidence`: file/function/test that implements it (or explain absence)
- `confidence`: 0–100 integer
  - `100` = code clearly matches AND a test linked to this requirement exists
  - `75` = code present, no linked test
  - `50` = partial implementation OR genuinely ambiguous
  - `25` = minimal signal, mostly inferred
  - `0` = no evidence found

### Step 2: Intent alignment

- `spec_intent`: 1 sentence — what outcome was the spec trying to achieve?
- `impl_intent`: 1 sentence — what does the implementation actually achieve?
- `gaps`: where impl technically works but misses the spirit (rate limit hardcoded vs configurable, audit log partial, etc).

### Step 3: Overall confidence

Weighted average across requirements:
- `must` weight 3
- `should` weight 2
- `could` weight 1

`overall_confidence = round( sum(req_confidence × weight) / sum(weight) )`

### Step 4: Verdict

Apply rules in order. First match wins.

| Rule | Verdict |
|------|---------|
| Any pre-open risk present (security HIGH with `gate_stage: pre_open`) | `BLOCKED` |
| Any `must` requirement `missing` | `BLOCKED` |
| Any `risk_ceiling == HIGH` (any category) | `NEEDS_WORK` |
| Any `must` requirement `partial` | `NEEDS_WORK` |
| `overall_confidence < 60` | `NEEDS_WORK` |
| Otherwise | `SHIP` |

`exit_code` mapping: `SHIP=0`, `NEEDS_WORK=1`, `BLOCKED=2`.

---

## Phase 3 — Output Contract

### JSON Contract (the stable downstream interface)

When `--output json` or `--output both`, emit this object FIRST, before any human report. Schema is versioned via `skill_version`. Fields not listed below are NOT part of the contract — downstream must not depend on them.

```json
{
  "skill_version": "1.1.0",
  "verdict": "SHIP" | "NEEDS_WORK" | "BLOCKED",
  "exit_code": 0 | 1 | 2,
  "confidence": 72,
  "risk_ceiling": "HIGH" | "MED" | "LOW" | "NONE",

  "requirements": {
    "total": 8,
    "implemented": 4,
    "partial": 2,
    "missing": 1,
    "out_of_scope": 1
  },
  "must_haves": {
    "total": 4,
    "missing": 1,
    "partial": 1
  },

  "blockers": [
    {
      "type": "missing_requirement" | "security_risk" | "data_risk" | "breaking_change",
      "id": "REQ-03",
      "summary": "Audit log on failed auth not implemented",
      "severity": "HIGH" | "MED" | "LOW",
      "gate_stage": "pre_open" | "pre_merge"
    }
  ],

  "pre_open_gates": {
    "blocked": false,
    "reasons": []
  },

  "metadata": {
    "spec": "docs/auth-prd.md",
    "branch": "feat/otp-login",
    "base": "main",
    "reviewed_at": "2026-04-21T10:34:00Z",
    "focus": null
  }
}
```

**Contract guarantees:**
- These top-level keys ALWAYS present, ALWAYS these types.
- `verdict` and `exit_code` are always consistent.
- `blockers` only contains items causing `BLOCKED` or `NEEDS_WORK`. Never advisory.
- `pre_open_gates.blocked: true` ONLY when at least one item has `gate_stage: pre_open`.
- New optional fields may be added in minor versions. Existing fields never change shape within the same major version.

**NOT part of the contract** (advisory, formatting may change):
- Full requirement-by-requirement table
- Quality signals list
- Intent alignment text
- File/line references inside `summary` strings

### Pre-open vs Pre-merge gating

Downstream automation (PR open hook, branch protection rule) gates as follows:

| Stage | What blocks | Rationale |
|-------|-------------|-----------|
| `pre_open` | `pre_open_gates.blocked == true` | Damage is permanent once committed (secrets, credentials, critical CVEs). Stop before PR exists. |
| `pre_merge` | `verdict in [BLOCKED, NEEDS_WORK]` OR `risk_ceiling == HIGH` | Standard merge gate. Reviewer can override `NEEDS_WORK` with explicit ack. |

Spec-review only OWNS pre-open gates for the cases its agents detect (e.g. unencrypted PII storage in diff, public credential leak detected by Risk agent). It does NOT replace dedicated tooling: Gitleaks/truffleHog for secret scanning, `npm audit`/`pip-audit` for CVE detection, build/type/lint checks. Those run alongside.

### Human Report

When `--output human` or `--output both`, emit after the JSON:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPEC REVIEW  ·  <spec-filename>  ·  <branch> vs <base>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Spec Alignment  [<N>% confidence]  →  <VERDICT>

| ID     | Requirement                          | Status      | Conf | Evidence                   |
|--------|--------------------------------------|-------------|------|----------------------------|
| REQ-01 | User can login with OTP              | ✅ Done     | 92%  | auth.ts:handleOtpLogin()   |
| AC-01  | Login fails after 3 bad attempts     | ⚠️ Partial  | 55%  | check exists, no test      |
| REQ-03 | Audit log on every auth event        | ❌ Missing  |  0%  | no signal in diff          |
| REQ-04 | SMS fallback for OTP delivery        | ⬜ Out of scope | —  | explicitly excluded in spec|

Legend: ✅ Implemented  ⚠️ Partial  ❌ Missing  ⬜ Out of scope

## Spec Gaps (ambiguities found in spec document)
- [REQ-02] "Fast response" undefined — no latency target specified
- [AC-03] Success criteria missing for edge case: expired OTP retry behaviour

## Quality Signals
[HIGH] `src/auth/otp.ts:87`    — silent catch swallows OTP send failure → re-throw or log + alert
[MED]  `src/auth/otp.ts:112`   — hardcoded 300s expiry → extract to config constant
[LOW]  `src/auth/handler.ts:44` — variable `d` obscures intent → rename to `otpDeliveryResult`

## Risk Signals
[HIGH 🔴 pre-open] `src/auth/otp.ts:34`   — credential leaked to logs → redact before logging
[HIGH 🔴]          `src/auth/otp.ts:34`   — OTP stored in localStorage, spec requires httpOnly cookie → move to server-side session
[MED  🟡]          `src/auth/handler.ts:20` — no rate limiting on /auth/verify endpoint → add rate limiter middleware
[LOW  🟢]          `src/auth/types.ts:8`   — UserSession type exported but undocumented → add JSDoc for consumers

## Intent Alignment
**Spec intent:** Secure, auditable OTP-based login with configurable policy
**Impl intent:** Functional OTP login flow with basic validation
**Gap:** Storage mechanism wrong (localStorage vs httpOnly cookie). Audit logging not implemented. Expiry not configurable.

## Summary
- Requirements: 4 done · 2 partial · 1 missing · 1 out of scope  (of 8 total)
- Risks: 2 HIGH (1 pre-open) · 1 MED · 1 LOW
- Verdict: **BLOCKED**  (pre-open gate triggered)

### To Unblock (pre-open)
1. Redact credential before logging (security HIGH, pre-open)

### To Unblock (pre-merge)
1. Move OTP storage from localStorage to httpOnly cookie (security HIGH)
2. Implement audit log for all auth events (missing REQ-03)
3. Add failure-path tests for AC-01 (max-attempts) and AC-03 (OTP expiry)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Replace example rows with actual findings.

---

## Edge Cases

| Situation | Behaviour |
|-----------|-----------|
| Spec file not found | Abort with `error: spec not found at <path>`. JSON contract NOT emitted. |
| Spec path outside repo root | Abort with `error: spec path outside repo root`. JSON contract NOT emitted. |
| No diff / clean branch | `verdict: SHIP`, empty `requirements`, `metadata.note: "no changes vs base"`. Warn in human report. |
| Spec < 200 words | Proceed but reduce overall confidence by 20 and add `metadata.warning: "thin spec"`. |
| No ACs in spec | Generate inferred ACs from requirements, label `[inferred]`, cap any individual confidence at 60. |
| `--focus` provided | Scope Agent B/C/D to that domain. Still parse full spec. Record in `metadata.focus`. |
| Spec is a Jira/Linear/GitHub URL | Fetch issue content, treat body + comments as spec document. |
| Diff contains a detected secret | Emit `gate_stage: pre_open` security HIGH risk. `pre_open_gates.blocked: true`. |
| All Phase 1 agents fail to return parseable JSON | Abort with `error: agent output malformed`. Do not emit a fabricated verdict. |

---

## Telemetry (optional, advisory)

If a telemetry sink is configured, log per-run:
- `verdict`, `exit_code`, `confidence`, `risk_ceiling`
- `requirements.{total, missing, partial}`
- Per-agent latency
- `metadata.warning` if present
- Spec word count, diff line count

Used to track verdict distribution, calibration drift, and spec quality trends. Never logged: spec contents, code contents, secrets.
