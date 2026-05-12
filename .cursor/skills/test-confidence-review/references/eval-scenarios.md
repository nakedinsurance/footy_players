# Test Confidence Review Eval Set

Each eval scenario should include:

- `spec.md`: intent description.
- `diff.patch` or fixture repo state instructions.
- `expected-tests.md`: expected real related test files.
- `expected-result.md`: expected pass/fail outcome, checklist score, and main gap.

Score each scenario from 0 to 2 on:

- Change understanding.
- Test-file classification.
- Related-test identification.
- Test meaning assessment.
- Execution evidence handling.
- Optional coverage evidence handling.
- Gap identification.
- Non-overclaiming.

## Initial Scenarios

| Scenario                                     | Expected outcome | Expected main gap                                                |
| -------------------------------------------- | ---------------- | ---------------------------------------------------------------- |
| Good targeted test update                    | Pass             | Remaining integration evidence, if any                           |
| Production change with no tests              | Fail             | No related tests found                                           |
| Tests changed but irrelevant                 | Fail             | Tests do not exercise changed behavior                           |
| Tests mirror implementation                  | Fail             | Assertions mirror implementation rather than observable behavior |
| Edge case added but not tested               | Pass             | Boundary case remains unproven                                   |
| Refactor with no intended behavior change    | Fail             | Need evidence that public behavior stayed stable                 |
| Security / validation fix with focused tests | Pass             | Broader integration/runtime evidence may still be missing        |
| Docs/tooling-only change                     | Pass or Fail     | Depends on whether tooling behavior changed and validation ran   |
| Helper heuristic failure                     | Fail             | Non-test files must not be classified as tests                   |
| Broad change with unknown test surface       | Fail             | Related-test discovery is incomplete or ambiguous                |
| High coverage but irrelevant tests           | Fail             | Coverage does not prove changed behavior is meaningfully tested  |
