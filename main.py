"""FastAPI app for repo-dashboard — multi-repo git command center."""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from config import discover_repos, RepoInfo
from gh_client import fetch_prs, parse_github_url
from models import OverviewStats, RepoStatus, ScanResult
from scanner import scan_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: initial scan + background polling. Shutdown: cancel polling."""
    print("Running initial scan...")
    _run_scan()
    print(f"Initial scan complete: {len(_statuses)} repos")
    task = asyncio.create_task(_background_scanner())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="EPCVIP Repo Dashboard",
    description="Multi-repo git command center",
    version="0.1.0",
    lifespan=lifespan,
)

# In-memory state
_repos: list[RepoInfo] = []
_statuses: list[RepoStatus] = []
_last_scan: str = ""
_scan_errors: list[str] = []


def _run_scan() -> None:
    """Execute a full scan of all repos and merge PR data."""
    global _repos, _statuses, _last_scan, _scan_errors

    # Discover repos (runs once, then reused)
    if not _repos:
        _repos = discover_repos()

    # Scan local git status
    statuses, errors, duration_ms = scan_all(_repos)

    # Fetch PRs via GraphQL (uses internal 5-min cache)
    github_repos = []
    repo_key_map: dict[str, int] = {}  # "owner/name" -> index in statuses
    for i, status in enumerate(statuses):
        if status.github_url:
            parsed = parse_github_url(status.github_url)
            if parsed:
                owner, name = parsed
                full_name = f"{owner}/{name}"
                github_repos.append(parsed)
                repo_key_map[full_name] = i

    pr_map = fetch_prs(github_repos)

    # Merge PR data into statuses
    for full_name, prs in pr_map.items():
        idx = repo_key_map.get(full_name)
        if idx is not None:
            statuses[idx] = statuses[idx].model_copy(update={"open_prs": prs})

    _statuses = statuses
    _scan_errors = errors
    _last_scan = datetime.now().isoformat()


async def _background_scanner():
    """Re-scan all repos every 30 seconds."""
    while True:
        await asyncio.sleep(30)
        try:
            _run_scan()
        except Exception as e:
            print(f"Background scan error: {e}")


# --- API Endpoints ---


@app.get("/api/repos", response_model=list[RepoStatus])
async def list_repos():
    """Return status for all discovered repos."""
    return _statuses


@app.get("/api/repos/{name}", response_model=RepoStatus)
async def get_repo(name: str):
    """Return status for a single repo by name."""
    for status in _statuses:
        if status.name == name:
            return status
    raise HTTPException(status_code=404, detail=f"Repo '{name}' not found")


@app.get("/api/prs")
async def list_prs():
    """Return all open PRs across all repos."""
    prs = []
    for status in _statuses:
        for pr in status.open_prs:
            prs.append({"repo": status.name, "category": status.category, **pr.model_dump()})
    return prs


@app.get("/api/overview", response_model=OverviewStats)
async def overview():
    """Return summary statistics."""
    return OverviewStats(
        total_repos=len(_statuses),
        dirty_repos=sum(1 for s in _statuses if s.is_dirty),
        clean_repos=sum(1 for s in _statuses if not s.is_dirty),
        total_open_prs=sum(len(s.open_prs) for s in _statuses),
        repos_ahead=sum(1 for s in _statuses if s.ahead > 0),
        repos_behind=sum(1 for s in _statuses if s.behind > 0),
        total_stale_branches=sum(len(s.stale_branches) for s in _statuses),
        last_scanned=_last_scan,
    )


@app.post("/api/scan", response_model=ScanResult)
async def force_scan():
    """Trigger an immediate rescan."""
    start = time.monotonic()
    _run_scan()
    duration_ms = int((time.monotonic() - start) * 1000)
    return ScanResult(
        repos_scanned=len(_statuses),
        scan_duration_ms=duration_ms,
        errors=_scan_errors,
    )


@app.get("/health")
async def health():
    """Health check."""
    return {
        "status": "ok",
        "repos": len(_statuses),
        "last_scan": _last_scan,
    }


# --- Static files ---

static_dir = Path(__file__).parent / "static"


@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve the dashboard."""
    index_path = static_dir / "index.html"
    if index_path.exists():
        return HTMLResponse(content=index_path.read_text())
    return HTMLResponse(content="<h1>Static files not found</h1>", status_code=500)


if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
