# repo-dashboard

Multi-repo Git command center for EPCVIP. It scans local repos, fetches open PRs, and renders a live dashboard.

## Quick Start

```bash
cd ~/repos-epcvip/utilities/repo-dashboard
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/uvicorn main:app --port 8421
```

Open `http://localhost:8421`.

## Development Setup

Install runtime + development tools:

```bash
./venv/bin/pip install -r requirements-dev.txt
```

Run local quality checks:

```bash
./venv/bin/python -m ruff check .
./venv/bin/python -m pytest -q
```

## Features

- Repo discovery under `~/repos-epcvip/`
- Git health status (dirty state, branch, line changes, ahead/behind, stale branches)
- Worktree-aware status and last-commit filtering/sorting
- Open PR data via GitHub GraphQL (`gh` CLI), with in-memory caching
- Auto-refresh every 30 seconds + manual rescan

## Project Structure

- `main.py`: FastAPI app and API routes
- `config.py`: repo discovery and metadata
- `scanner.py`: git status scanning
- `gh_client.py`: batched GitHub PR queries
- `models.py`: API models
- `static/`: frontend assets
- `tests/`: unit tests

## API Endpoints

- `GET /api/repos`
- `GET /api/repos/{name}`
- `GET /api/prs`
- `GET /api/overview`
- `POST /api/scan`
- `GET /health`
