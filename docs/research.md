# Research: Multi-Repo Dashboard Solutions (Feb 2026)

## Problem Statement

Managing 32 git repos across `~/repos-epcvip/` with 7-8 concurrent Claude Code sessions.
Need a single UI showing: worktrees, PRs, branches, line changes, dirty status, notes — constantly refreshing.

## Existing Tools Evaluated

### gh-dash (Terminal UI for GitHub)
- **URL:** https://github.com/dlvhdr/gh-dash
- **What it does:** TUI for GitHub PRs and issues. YAML config with per-repo sections, custom filters, Vim-style keyboard nav. Shows PRs, issues, line changes, CI status.
- **Stars:** 10.1k | **Latest:** v4.22.0 (Jan 2026) | **Status:** Actively maintained
- **Strengths:** Beautiful TUI, highly configurable, per-repo sections, custom keybindings, integrates with lazygit
- **Gaps:** No local git status (dirty/clean), no worktree awareness, no filesystem watching, TUI competes for terminal space with Claude Code sessions
- **Config example:**
  ```yaml
  repoPaths:
    dlvhdr/*: ~/code/personal/*
    my-work-org/*: ~/code/my-work-org/*
  prSections:
    - title: "My Pull Requests"
      filters: "is:open author:@me"
    - title: "Needs My Review"
      filters: "is:open review-requested:@me"
  ```
- **Verdict:** Great for pure GitHub PR triage, but doesn't cover local git state which is a core requirement.

### ccmanager (AI Session + Worktree Manager)
- **URL:** https://github.com/kbwo/ccmanager
- **What it does:** CLI for managing multiple Claude Code / Gemini / Codex sessions across git worktrees. Real-time status monitoring, seamless session switching, worktree create/merge/delete.
- **Install:** `npm install -g ccmanager`
- **Strengths:** Multi-project support, auto-discovery, file change indicators (+10 -5), ahead/behind tracking, session transfer between worktrees
- **Gaps:** Session-focused, not a repo health dashboard. No PR integration. No web UI.
- **Verdict:** Good for worktree-heavy workflows, but we use worktrees minimally. Session management is already handled by ccs.

### Repo Dashboard (Local Web UI)
- **URL:** https://albertoroura.com/repo-dashboard-local-github-visibility-tool/
- **What it does:** Node.js + React + Express local web app. Three-column layout: Issues, PRs, Branches across multiple repos.
- **Strengths:** Local-first, web UI, multi-repo, branch metadata
- **Gaps:** No local git status, no worktrees, no line changes, no filesystem watching. GitHub API only.
- **Verdict:** Right concept (web dashboard) but too basic. GitHub-only data.

### claude-session-manager (ccs) — Our Existing Tool
- **URL:** https://github.com/ahhhdum/claude-code-session-monitor
- **Port:** 8420 | **Stack:** FastAPI + vanilla HTML/CSS/JS + SQLite
- **What it does:** Index, search, summarize, and resume Claude Code sessions across all projects. Web UI + CLI.
- **Strengths:** Already has project scanning, web UI, our established patterns
- **Consideration:** Could extend with a "Repos" tab, but would bloat a published PyPI package with a different domain. Better as separate utility.

### Other Tools Noted
- **LazyWorktree** (https://github.com/chmouel/lazyworktree) — BubbleTea TUI for worktrees within a single repo. Shows CI status for PRs. Nice but single-repo only.
- **Git Worktree Toolbox** (https://github.com/ben-rogerson/git-worktree-toolbox) — MCP server for worktree management. Interesting for AI integration but not a dashboard.
- **git-worktree-runner / git gtr** (https://github.com/coderabbitai/git-worktree-runner) — Wraps git worktree with editor/AI tool integration. Launching tool, not monitoring.
- **Context Manager** (https://contextmanager.cc) — macOS menubar app for Claude Code sessions. macOS only, couldn't fetch details.
- **Claude Session Manager (Swarek)** (https://github.com/Swarek/claude-session-manager) — Bash scripts for session tracking via env vars and lock files. Simple but no web UI.

## Conclusion

No existing tool covers the full requirements (local git state + GitHub PRs + worktrees + web UI + multi-repo). The closest approach is building a custom dashboard that:
1. Scans local repos via `git` subprocess calls (fast, no API needed)
2. Fetches PR data via `gh` CLI (authenticated, rate-limit friendly)
3. Serves a web dashboard via FastAPI + vanilla JS (matching our established patterns)

This is essentially "Repo Dashboard concept" + "local git scanning" + "our stack."

## Key Design Insights from Research

1. **gh-dash's YAML config** is a good pattern for user customization — consider supporting a config file for repo inclusion/exclusion
2. **ccmanager's file change display** (`+10 -5`) is the right UX for line changes
3. **Repo Dashboard's three-column layout** works for overview, but a table with expandable rows is better for 32 repos
4. **ccs's patterns** (FastAPI server.py, scanner.py, static/) are the implementation template
5. **Polling > watching** for our case — 32 repos in ~2s is fast enough, watchdog adds complexity on WSL2
