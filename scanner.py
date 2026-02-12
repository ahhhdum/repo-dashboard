"""Git repo scanner — collects local git status for each repository."""

from __future__ import annotations

import re
import subprocess
import time
from datetime import datetime
from pathlib import Path

from config import RepoInfo, _run_git
from models import RepoStatus


def scan_repo(repo: RepoInfo) -> RepoStatus:
    """Scan a single repository for git health status."""
    path = repo.path
    now = datetime.now().isoformat()

    current_branch = _run_git(path, ["rev-parse", "--abbrev-ref", "HEAD"]) or "unknown"

    # Uncommitted files
    porcelain = _run_git(path, ["status", "--porcelain"]) or ""
    dirty_lines = [ln for ln in porcelain.splitlines() if ln.strip()]
    uncommitted_files = len(dirty_lines)
    is_dirty = uncommitted_files > 0

    # Line changes (unstaged + staged)
    insertions, deletions = _parse_shortstat(path)

    # Last commit
    log_line = _run_git(path, ["log", "-1", "--format=%aI|%s"])
    last_commit_date = None
    last_commit_message = None
    if log_line and "|" in log_line:
        parts = log_line.split("|", 1)
        last_commit_date = parts[0]
        last_commit_message = parts[1]

    # Ahead/behind remote
    ahead, behind = _parse_ahead_behind(path)

    # Branch count
    branches_output = _run_git(path, ["branch", "--list"])
    branch_count = len(branches_output.splitlines()) if branches_output else 0

    # Stale branches (merged into default but not deleted)
    stale_branches = _detect_stale_branches(path, repo.default_branch)

    # Worktrees
    worktree_output = _run_git(path, ["worktree", "list"])
    worktree_count = len(worktree_output.splitlines()) if worktree_output else 0

    # Stash count
    stash_output = _run_git(path, ["stash", "list"])
    stash_count = len(stash_output.splitlines()) if stash_output else 0

    return RepoStatus(
        name=repo.name,
        path=str(path),
        category=repo.category,
        github_url=repo.github_url,
        current_branch=current_branch,
        default_branch=repo.default_branch,
        is_dirty=is_dirty,
        uncommitted_files=uncommitted_files,
        insertions=insertions,
        deletions=deletions,
        last_commit_date=last_commit_date,
        last_commit_message=last_commit_message,
        ahead=ahead,
        behind=behind,
        branch_count=branch_count,
        stale_branches=stale_branches,
        worktree_count=worktree_count,
        stash_count=stash_count,
        open_prs=[],  # Filled in by gh_client
        has_remote=repo.has_remote,
        is_worktree=repo.is_worktree,
        parent_repo=repo.parent_repo,
        last_scanned=now,
    )


def _parse_shortstat(path: Path) -> tuple[int, int]:
    """Parse insertions and deletions from git diff --shortstat (staged + unstaged)."""
    insertions = 0
    deletions = 0

    for diff_args in [["diff", "--shortstat"], ["diff", "--cached", "--shortstat"]]:
        output = _run_git(path, diff_args)
        if not output:
            continue
        ins_match = re.search(r"(\d+) insertion", output)
        del_match = re.search(r"(\d+) deletion", output)
        if ins_match:
            insertions += int(ins_match.group(1))
        if del_match:
            deletions += int(del_match.group(1))

    return insertions, deletions


def _parse_ahead_behind(path: Path) -> tuple[int, int]:
    """Parse ahead/behind counts relative to upstream tracking branch."""
    output = _run_git(path, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
    if not output:
        return 0, 0
    parts = output.split()
    if len(parts) == 2:
        try:
            return int(parts[0]), int(parts[1])
        except ValueError:
            pass
    return 0, 0


def _detect_stale_branches(path: Path, default_branch: str) -> list[str]:
    """Find branches merged into the default branch but not yet deleted."""
    output = _run_git(path, ["branch", "--merged", default_branch, "--no-contains", default_branch])
    if not output:
        return []
    stale = []
    for line in output.splitlines():
        branch = line.strip().lstrip("* ")
        # Skip the default branch itself and common non-stale branches
        if branch and branch != default_branch:
            stale.append(branch)
    return stale


def scan_all(repos: list[RepoInfo]) -> tuple[list[RepoStatus], list[str], int]:
    """Scan all discovered repos. Returns (statuses, errors, duration_ms)."""
    start = time.monotonic()
    statuses: list[RepoStatus] = []
    errors: list[str] = []

    for repo in repos:
        try:
            status = scan_repo(repo)
            statuses.append(status)
        except Exception as e:
            errors.append(f"{repo.name}: {type(e).__name__}: {e}")

    duration_ms = int((time.monotonic() - start) * 1000)
    return statuses, errors, duration_ms
