"""Unit tests for GitHub URL parsing helpers."""

from gh_client import parse_github_url


def test_parse_github_url_https() -> None:
    assert parse_github_url("https://github.com/ahhhdum/repo-dashboard") == (
        "ahhhdum",
        "repo-dashboard",
    )


def test_parse_github_url_https_with_git_suffix() -> None:
    assert parse_github_url("https://github.com/ahhhdum/repo-dashboard.git") == (
        "ahhhdum",
        "repo-dashboard",
    )


def test_parse_github_url_ssh() -> None:
    assert parse_github_url("git@github.com:ahhhdum/repo-dashboard.git") == (
        "ahhhdum",
        "repo-dashboard",
    )


def test_parse_github_url_non_github_returns_none() -> None:
    assert parse_github_url("https://gitlab.com/ahhhdum/repo-dashboard") is None
