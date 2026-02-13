# AGENTS.md

Repository-specific guidance for coding agents.

## Scope

These instructions apply to this repository (`utilities/repo-dashboard`).

## Local Workflow

1. Install dependencies:
   `./venv/bin/pip install -r requirements-dev.txt`
2. Run lint before finishing:
   `./venv/bin/python -m ruff check .`
3. Run tests before finishing:
   `./venv/bin/python -m pytest -q`

## Code Standards

- Keep changes small and focused.
- Prefer straightforward Python and vanilla JS.
- Do not commit local environment artifacts (`venv/`, caches, editor files).
- Preserve existing UI behavior unless the task explicitly changes UX.

## Verification

- If behavior changes, include or update tests in `tests/`.
- Report lint/test results in your final summary.
