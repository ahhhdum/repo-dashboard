"""Unit tests for repo discovery configuration helpers."""

from pathlib import Path

from config import DEFAULT_ROOT, get_root_dir


def test_get_root_dir_uses_override_first() -> None:
    assert get_root_dir("/tmp/custom-root") == Path("/tmp/custom-root")


def test_get_root_dir_falls_back_to_default(monkeypatch) -> None:
    monkeypatch.delenv("REPO_DASHBOARD_ROOT", raising=False)
    assert get_root_dir() == DEFAULT_ROOT


def test_get_root_dir_uses_environment_variable(monkeypatch) -> None:
    monkeypatch.setenv("REPO_DASHBOARD_ROOT", "/tmp/from-env")
    assert get_root_dir() == Path("/tmp/from-env")
