"""GitHub PR fetcher — uses GraphQL to batch-fetch PRs for all repos in one call."""

from __future__ import annotations

import json
import logging
import re
import subprocess
import time

from models import PullRequest

logger = logging.getLogger(__name__)


# In-memory cache with TTL
_pr_cache: dict[str, list[PullRequest]] = {}
_cache_time: float = 0
_CACHE_TTL_SECONDS = 300  # 5 minutes


def _make_graphql_query(repos: list[tuple[str, str]]) -> str:
    """Build a GraphQL query that fetches open PRs for all repos in one call.

    Args:
        repos: List of (owner, repo_name) tuples.

    Returns:
        GraphQL query string with aliased repo fields.
    """
    fragments = []
    for i, (owner, name) in enumerate(repos):
        # GraphQL aliases must be valid identifiers — use repo_{index}
        alias = f"repo_{i}"
        fragments.append(f"""
    {alias}: repository(owner: "{owner}", name: "{name}") {{
      nameWithOwner
      pullRequests(states: OPEN, first: 10, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{
        nodes {{
          number
          title
          headRefName
          updatedAt
          isDraft
          reviewDecision
          commits(last: 1) {{
            nodes {{
              commit {{
                statusCheckRollup {{
                  state
                }}
              }}
            }}
          }}
        }}
      }}
    }}""")

    return "{\n" + "\n".join(fragments) + "\n}"


def _parse_ci_status(pr_node: dict) -> str | None:
    """Extract CI status from the last commit's status check rollup."""
    commits = pr_node.get("commits", {}).get("nodes", [])
    if not commits:
        return None
    rollup = commits[0].get("commit", {}).get("statusCheckRollup")
    if not rollup:
        return None
    return rollup.get("state")  # SUCCESS, FAILURE, PENDING, ERROR


def _parse_pr_node(pr_node: dict, owner: str, name: str) -> PullRequest:
    """Convert a GraphQL PR node into a PullRequest model."""
    state = "DRAFT" if pr_node.get("isDraft") else "OPEN"
    return PullRequest(
        number=pr_node["number"],
        title=pr_node["title"],
        head_branch=pr_node["headRefName"],
        state=state,
        updated_at=pr_node["updatedAt"],
        review_decision=pr_node.get("reviewDecision"),
        ci_status=_parse_ci_status(pr_node),
        url=f"https://github.com/{owner}/{name}/pull/{pr_node['number']}",
    )


def fetch_prs(repos: list[tuple[str, str]]) -> dict[str, list[PullRequest]]:
    """Fetch open PRs for all repos via a single GraphQL call.

    Args:
        repos: List of (owner, repo_name) tuples.

    Returns:
        Dict mapping "owner/repo_name" to list of PullRequest models.
        Uses cached data if within TTL.
    """
    global _pr_cache, _cache_time

    # Return cache if fresh
    if _pr_cache and (time.monotonic() - _cache_time) < _CACHE_TTL_SECONDS:
        return _pr_cache

    if not repos:
        return {}

    query = _make_graphql_query(repos)

    try:
        result = subprocess.run(
            ["gh", "api", "graphql", "-f", f"query={query}"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            logger.warning("GitHub API call failed: %s", result.stderr.strip())
            return _pr_cache or {}

        data = json.loads(result.stdout).get("data", {})
    except subprocess.TimeoutExpired:
        logger.error("GitHub API timeout after 30s")
        return _pr_cache or {}
    except json.JSONDecodeError as e:
        logger.error("GitHub API returned invalid JSON: %s", e)
        return _pr_cache or {}
    except FileNotFoundError:
        logger.error("gh CLI not found — install with: https://cli.github.com/")
        return _pr_cache or {}

    # Parse results
    pr_map: dict[str, list[PullRequest]] = {}
    for i, (owner, name) in enumerate(repos):
        alias = f"repo_{i}"
        repo_data = data.get(alias)
        if not repo_data:
            continue

        full_name = f"{owner}/{name}"
        pr_nodes = repo_data.get("pullRequests", {}).get("nodes", [])
        pr_map[full_name] = [_parse_pr_node(node, owner, name) for node in pr_nodes]

    # Update cache
    _pr_cache = pr_map
    _cache_time = time.monotonic()

    return pr_map


def parse_github_url(url: str) -> tuple[str, str] | None:
    """Extract (owner, repo) from a GitHub URL.

    Handles:
      - https://github.com/owner/repo
      - https://github.com/owner/repo.git
      - git@github.com:owner/repo.git
    """
    # HTTPS format
    match = re.match(r"https://github\.com/([^/]+)/([^/.]+)", url)
    if match:
        return match.group(1), match.group(2)

    # SSH format
    match = re.match(r"git@github\.com:([^/]+)/([^/.]+)", url)
    if match:
        return match.group(1), match.group(2)

    return None
