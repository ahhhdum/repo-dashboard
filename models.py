"""Pydantic models for repo-dashboard API responses."""

from __future__ import annotations

from pydantic import BaseModel


class PullRequest(BaseModel):
    """An open pull request on GitHub."""

    number: int
    title: str
    head_branch: str
    state: str  # "OPEN" | "DRAFT"
    updated_at: str
    review_decision: str | None = None
    ci_status: str | None = None
    url: str


class RepoStatus(BaseModel):
    """Git health status for a single repository."""

    name: str
    path: str
    category: str  # "tools" | "utilities" | "docs" | "projects" | "templates" | "other"
    github_url: str | None = None
    current_branch: str
    default_branch: str  # auto-detected via symbolic-ref
    is_dirty: bool
    uncommitted_files: int
    insertions: int
    deletions: int
    last_commit_date: str | None = None
    last_commit_message: str | None = None
    ahead: int
    behind: int
    branch_count: int
    stale_branches: list[str]
    worktree_count: int
    stash_count: int
    open_prs: list[PullRequest]
    has_remote: bool
    is_worktree: bool = False
    parent_repo: str | None = None
    last_scanned: str


class OverviewStats(BaseModel):
    """Summary statistics across all repos."""

    total_repos: int
    dirty_repos: int
    clean_repos: int
    total_open_prs: int
    repos_ahead: int
    repos_behind: int
    total_stale_branches: int
    last_scanned: str


class ScanResult(BaseModel):
    """Result of a manual or scheduled scan."""

    repos_scanned: int
    scan_duration_ms: int
    errors: list[str]
