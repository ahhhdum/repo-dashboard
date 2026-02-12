# repo-dashboard

Multi-repo git command center for EPCVIP. Shows real-time git health for all repos in a single web dashboard.

## Quick Start

```bash
cd ~/repos-epcvip/utilities/repo-dashboard
./venv/bin/uvicorn main:app --port 8421
# Open http://localhost:8421
```

If no venv exists:
```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

## What This Does

- Discovers all git repos under `~/repos-epcvip/` (currently 37)
- Scans local git status every 30 seconds via subprocess
- Shows: branch, dirty status, line changes (+/-), ahead/behind, stale branches, worktrees, stash
- Fetches open PRs via `gh` CLI GraphQL batching (1 API call for all repos, 5-min cache)
- Single-page dark-theme dashboard at port 8421

## Architecture

```
FastAPI (8421) → scanner.py (git subprocess) → all repos
               → gh_client.py (gh CLI GraphQL) → GitHub API
               → static/ (vanilla HTML/CSS/JS)
```

## Key Files

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app, lifespan (startup/shutdown), background scanner, API endpoints |
| `scanner.py` | `scan_repo()` — runs 9 git commands per repo, `scan_all()` iterates all |
| `gh_client.py` | GraphQL batching for PRs, in-memory cache with 5-min TTL |
| `config.py` | Repo discovery (walks `~/repos-epcvip/`), default branch detection, categorization |
| `models.py` | Pydantic models: `RepoStatus`, `PullRequest`, `OverviewStats`, `ScanResult` |
| `static/` | Dashboard frontend (dark theme matching ccs) |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/repos` | All repos with full status |
| `GET /api/repos/{name}` | Single repo detail |
| `GET /api/prs` | All open PRs across all repos |
| `GET /api/overview` | Summary stats (dirty count, PR count, etc.) |
| `POST /api/scan` | Force immediate rescan |
| `GET /health` | Health check |

## Dashboard Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate rows |
| `Enter` | Toggle PR detail |
| `o` | Open repo in GitHub |
| `r` | Rescan now |
| `/` | Focus search |
| `?` | Toggle help |
| `Esc` | Clear / Close |

## Port

8421 (registered in `~/.dev-ports.json`, adjacent to ccs at 8420)

## Related

- [ccs (claude-session-manager)](../claude-session-manager/) — Session management, pattern reference
- [Plan](plan.md) — Full design doc
- [Research](docs/research.md) — Tool evaluation notes
