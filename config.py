"""Repo discovery — walks a root directory for git repositories."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

# Category mapping based on parent directory name
CATEGORY_MAP = {
    "tools": "tools",
    "utilities": "utilities",
    "docs": "docs",
    "projects": "projects",
    "templates": "templates",
    "engagement-analysis": "other",
    "graveyard": "other",
}

DEFAULT_ROOT = Path.home() / "repos-epcvip"


@dataclass
class RepoInfo:
    """Discovered git repository metadata."""

    name: str
    path: Path
    category: str
    github_url: str | None
    has_remote: bool
    default_branch: str
    is_worktree: bool = False
    parent_repo: str | None = None


def get_root_dir(override: str | None = None) -> Path:
    """Get the root directory to scan for repos.

    Priority: override > REPO_DASHBOARD_ROOT env var > ~/repos-epcvip
    """
    if override:
        return Path(override)
    env_root = os.getenv("REPO_DASHBOARD_ROOT")
    if env_root:
        return Path(env_root)
    return DEFAULT_ROOT


def _run_git(repo_path: Path, args: list[str]) -> str | None:
    """Run a git command in a repo directory, returning stdout or None on error."""
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_path)] + args,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def _detect_default_branch(repo_path: Path) -> str:
    """Detect the default branch for a repo.

    Uses git symbolic-ref to read what origin/HEAD points to.
    Falls back to 'main', then 'master' if neither is set.
    """
    # Try symbolic-ref first (most reliable)
    ref = _run_git(repo_path, ["symbolic-ref", "refs/remotes/origin/HEAD"])
    if ref:
        # Returns something like "refs/remotes/origin/main"
        return ref.split("/")[-1]

    # Fallback: check if 'main' or 'master' branch exists locally
    branches = _run_git(repo_path, ["branch", "--list"])
    if branches:
        branch_names = [b.strip().lstrip("* ") for b in branches.splitlines()]
        if "main" in branch_names:
            return "main"
        if "master" in branch_names:
            return "master"

    return "main"


def _parse_remote_url(repo_path: Path) -> str | None:
    """Parse the remote origin URL into a GitHub web URL."""
    raw = _run_git(repo_path, ["remote", "get-url", "origin"])
    if not raw:
        return None

    url = raw
    # SSH format: git@github.com:user/repo.git
    if url.startswith("git@github.com:"):
        url = url.replace("git@github.com:", "https://github.com/")
    # Remove .git suffix
    if url.endswith(".git"):
        url = url[:-4]
    return url


def _categorize(repo_path: Path, root: Path) -> str:
    """Determine category based on the repo's parent directory relative to root."""
    try:
        relative = repo_path.relative_to(root)
        parts = relative.parts
        if len(parts) >= 2:
            # e.g. tools/data-platform-assistant -> "tools"
            return CATEGORY_MAP.get(parts[0], "other")
        # Top-level repo (e.g. engagement-analysis/)
        return CATEGORY_MAP.get(parts[0], "other")
    except ValueError:
        return "other"


def discover_repos(root: Path | None = None) -> list[RepoInfo]:
    """Walk the root directory and discover all git repositories.

    Finds directories containing a .git folder, up to 3 levels deep.
    """
    root = root or get_root_dir()
    repos: list[RepoInfo] = []

    if not root.exists():
        return repos

    for dirpath in sorted(root.rglob("*")):
        # Only look at directories
        if not dirpath.is_dir():
            continue
        # Skip hidden directories and node_modules
        if any(part.startswith(".") or part == "node_modules" for part in dirpath.relative_to(root).parts):
            continue
        # Limit depth to 3 levels (root/category/repo)
        if len(dirpath.relative_to(root).parts) > 3:
            continue
        # Check for .git directory
        if not (dirpath / ".git").exists():
            continue
        # Skip nested git repos (don't scan .git inside node_modules, etc.)
        # If a parent directory is already a git repo, skip this one
        parent_is_repo = any(
            (p / ".git").exists()
            for p in dirpath.relative_to(root).parents
            if p != Path(".")
        )
        if parent_is_repo:
            continue

        # Detect worktrees: .git as file = worktree, .git as dir = primary
        git_path = dirpath / ".git"
        is_worktree = git_path.is_file()
        parent_repo = None
        if is_worktree:
            try:
                content = git_path.read_text(encoding="utf-8").strip()
                if content.startswith("gitdir:"):
                    gitdir = content.split("gitdir:", 1)[1].strip()
                    if "/.git/worktrees/" in gitdir:
                        parent_path = Path(gitdir.split("/.git/worktrees/")[0]).resolve()
                        if parent_path.is_relative_to(root):
                            parent_repo = parent_path.name
            except (OSError, UnicodeDecodeError, ValueError):
                is_worktree = False

        remote_url = _parse_remote_url(dirpath)
        default_branch = _detect_default_branch(dirpath)

        repos.append(
            RepoInfo(
                name=dirpath.name,
                path=dirpath,
                category=_categorize(dirpath, root),
                github_url=remote_url,
                has_remote=remote_url is not None,
                default_branch=default_branch,
                is_worktree=is_worktree,
                parent_repo=parent_repo,
            )
        )

    return repos
