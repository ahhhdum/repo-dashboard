# repo-dashboard: Multi-Repo Git Command Center

## Context

Managing 32 git repos across `~/repos-epcvip/` with 7-8 concurrent Claude Code sessions makes it hard to track which repos have uncommitted work, open PRs, stale branches, or active worktrees. No existing tool covers the full picture — `gh-dash` only shows GitHub PRs (no local git state), `ccmanager` focuses on session management, and the existing `ccs` tool manages Claude sessions specifically.

**Goal:** A single web dashboard showing always-current git health for all repos — dirty status, line changes, branches, PRs, worktrees — refreshing automatically via polling.

## Decisions

- **Location:** `~/repos-epcvip/utilities/repo-dashboard/` (standalone, not extending ccs)
- **Port:** 8421 (adjacent to ccs at 8420)
- **Stack:** FastAPI + vanilla HTML/CSS/JS (matching ccs and all other EPCVIP utilities)
- **Refresh:** Poll all repos every 30 seconds (~2s total scan time) + manual "Rescan Now" button
- **No filesystem watcher** — polling is simple and sufficient

## Reference Patterns (reuse from ccs)

| Pattern | Source File |
|---------|------------|
| FastAPI app structure, startup scan, static file serving | `utilities/claude-session-manager/ccs/server.py` |
| Directory walking, dataclass models, filesystem probing | `utilities/claude-session-manager/ccs/scanner.py` |
| Single-page vanilla HTML with sidebar/tabs/filters | `utilities/claude-session-manager/ccs/static/index.html` |
| Vanilla JS fetch, auto-refresh, keyboard nav, class toggling | `utilities/claude-session-manager/ccs/static/js/app.js` |
| Dark theme CSS variables, table/card styling | `utilities/claude-session-manager/ccs/static/css/styles.css` |
| Frontend standards (class toggling, no style.display) | `templates/ai-dev-templates/templates/standards/FRONTEND_STANDARDS.md` |
| Port registration | `~/.dev-ports.json` |

## File Structure

```
utilities/repo-dashboard/
  main.py              # FastAPI app, background scanner task, API endpoints
  scanner.py           # Git repo scanner (subprocess git calls)
  gh_client.py         # GitHub PR data via `gh pr list` subprocess
  models.py            # Pydantic response models
  config.py            # Repo discovery (walk ~/repos-epcvip/ for .git dirs)
  static/
    index.html         # Single-page dashboard
    css/styles.css     # Dark theme (match ccs aesthetic)
    js/app.js          # Table rendering, auto-refresh, keyboard shortcuts
  requirements.txt     # fastapi, uvicorn, pydantic (3 deps only)
  CLAUDE.md            # Dev context
```

## Data Model

```python
class RepoStatus(BaseModel):
    name: str                      # "data-platform-assistant"
    path: str                      # Full filesystem path
    category: str                  # "tools" | "utilities" | "docs" | "projects" | "templates"
    github_url: str                # Parsed from git remote
    current_branch: str
    is_dirty: bool
    uncommitted_files: int
    insertions: int                # Uncommitted line additions
    deletions: int                 # Uncommitted line removals
    last_commit_date: str          # ISO timestamp
    last_commit_message: str
    ahead: int                     # Commits ahead of remote
    behind: int                    # Commits behind remote
    branch_count: int
    stale_branches: list[str]      # Merged into main but not deleted
    worktree_count: int
    stash_count: int
    open_prs: list[PullRequest]    # From gh CLI
    last_scanned: str

class PullRequest(BaseModel):
    number: int
    title: str
    head_branch: str
    state: str                     # "OPEN" | "DRAFT"
    updated_at: str
    review_decision: str | None    # "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED"
    ci_status: str | None          # "SUCCESS" | "FAILURE" | "PENDING"
    url: str
```

## API Endpoints

```
GET  /api/repos              # All repos with full status
GET  /api/repos/{name}       # Single repo detail
GET  /api/prs                # All open PRs across all repos
GET  /api/overview           # Summary stats (dirty count, PR count, etc.)
POST /api/scan               # Force immediate rescan
GET  /health                 # Health check
```

## Frontend Dashboard

**Layout:** Single-page table grouped by category (Tools, Utilities, Docs, Projects, Templates) with collapsible sections.

**Columns:**

| Repo | Branch | Status | Changes | PRs | Last Commit | Stale |
|------|--------|--------|---------|-----|-------------|-------|

- **Status:** Color badge — green (clean), yellow (dirty), red (behind remote)
- **Changes:** `+14 -3` in green/red, links to expand file list
- **PRs:** Count badge, expandable to show PR title/status/CI/review
- **Last Commit:** Relative time ("2h ago") + hover for message
- **Stale:** Count of merged-but-not-deleted branches

**Interactions:**
- Click repo name -> open in GitHub
- Click PR badge -> expand PR detail rows
- "Rescan Now" button -> `POST /api/scan`
- Auto-refresh every 30 seconds with changed-row highlight
- Keyboard: `j/k` navigate, `/` filter, `r` rescan

## Implementation Phases

### Phase 1: Core scanner + dashboard (main deliverable)

1. **`config.py`** — Walk `~/repos-epcvip/` for `.git` directories. Parse `git remote get-url origin` to extract GitHub org/repo. Categorize by parent directory name.

2. **`scanner.py`** — `scan_repo(path) -> RepoStatus` using subprocess git calls:
   - `git rev-parse --abbrev-ref HEAD` (current branch)
   - `git status --porcelain` (dirty files count)
   - `git diff --shortstat` + `git diff --cached --shortstat` (insertions/deletions)
   - `git log -1 --format='%aI|%s'` (last commit)
   - `git rev-list --left-right --count HEAD...@{upstream}` (ahead/behind)
   - `git branch --list | wc -l` (branch count)
   - `git branch --merged main --no-contains main` (stale branches)
   - `git worktree list` (worktree count)
   - `git stash list` (stash count)
   - `scan_all()` iterates all discovered repos (~2s for 32 repos)

3. **`main.py`** — FastAPI app with startup scan, background task (30s interval), all API endpoints, static file mounting.

4. **`static/`** — Single-page dashboard with dark theme, auto-refresh, category grouping.

5. **`requirements.txt`** — `fastapi`, `uvicorn`, `pydantic`

### Phase 2: GitHub PR integration

6. **`gh_client.py`** — Wraps `gh pr list --repo org/repo --json ...` subprocess calls. Caches results in memory with 5-minute TTL.

7. Merge PR data into `RepoStatus.open_prs` on each scan cycle.

8. Frontend PR column with expandable detail rows.

### Phase 3: Polish

9. Register port 8421 in `~/.dev-ports.json`
10. Category collapse/expand with localStorage persistence
11. Row highlight animation on data change

## Future Ideas

- **ccs integration:** Call `GET http://localhost:8420/api/projects` to show active Claude Code sessions per repo
- **Railway deploy status:** Show latest deploy status per service
- **Notes/annotations:** SQLite table for user-added notes on repos/PRs
- **Port status:** Show which dev servers are running (from `~/.dev-ports.json`)

## Verification

```bash
# Start the server
cd ~/repos-epcvip/utilities/repo-dashboard
pip install -r requirements.txt
uvicorn main:app --port 8421

# Check API
curl http://localhost:8421/api/repos | python -m json.tool
curl http://localhost:8421/api/overview | python -m json.tool

# Check dashboard in browser at http://localhost:8421
# Verify: all 32 repos listed, grouped by category
# Verify: dirty repos show yellow status + line change counts
# Verify: auto-refresh updates every 30 seconds

# Force rescan
curl -X POST http://localhost:8421/api/scan

# Check PR integration (Phase 2)
curl http://localhost:8421/api/prs | python -m json.tool
```
