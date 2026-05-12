# Example Intent

The workflow should review test confidence for the current change.

It should identify changed production, test, docs, config, and tooling files; find related tests without misclassifying non-test files; run only safe configured local validation commands when a single project can be inferred; and produce an honest markdown result with explicit gaps.

Passing tests alone must not be treated as sufficient evidence.
