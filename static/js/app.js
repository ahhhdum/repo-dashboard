/* ============================================================
   EPCVIP Repo Dashboard — app.js
   ============================================================ */

// --- State ---
let repos = [];
let previousRepos = {};  // name -> JSON string, for change detection
let focusedIndex = -1;
let refreshTimer = null;
let collapsedCategories = JSON.parse(localStorage.getItem('rd-collapsed') || '{}');
let collapsedWorktrees = new Set();
const INACTIVE_DAY_OPTIONS = [7, 14, 30, 60, 90];
const INACTIVE_DAYS_DEFAULT = 14;
const savedHideInactive = localStorage.getItem('rd-hide-inactive');
let hideInactive = savedHideInactive === null ? true : savedHideInactive === 'true';
const savedInactiveDays = parseInt(localStorage.getItem('rd-inactive-days') || '', 10);
let inactiveDays = INACTIVE_DAY_OPTIONS.includes(savedInactiveDays) ? savedInactiveDays : INACTIVE_DAYS_DEFAULT;
const savedDirtyAsActive = localStorage.getItem('rd-dirty-as-active');
let dirtyAsActive = savedDirtyAsActive === null ? true : savedDirtyAsActive === 'true';
const savedGroupByFolder = localStorage.getItem('rd-group-by-folder');
let groupByFolder = savedGroupByFolder === null ? true : savedGroupByFolder === 'true';
const savedCommitSortDir = localStorage.getItem('rd-last-commit-sort');
let commitSortDir = savedCommitSortDir === 'asc' ? 'asc' : 'desc';

// --- DOM refs ---
const tableBody = document.getElementById('tableBody');
const headerStats = document.getElementById('headerStats');
const scanTime = document.getElementById('scanTime');
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');
const statusFilter = document.getElementById('statusFilter');
const groupByFolderToggle = document.getElementById('groupByFolderToggle');
const inactiveFilterToggle = document.getElementById('inactiveFilterToggle');
const inactiveDaysFilter = document.getElementById('inactiveDaysFilter');
const dirtyActiveToggle = document.getElementById('dirtyActiveToggle');
const filterCounts = document.getElementById('filterCounts');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const rescanBtn = document.getElementById('rescanBtn');
const lastCommitSortBtn = document.getElementById('lastCommitSortBtn');
const lastCommitSortIndicator = document.getElementById('lastCommitSortIndicator');

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  if (groupByFolderToggle) {
    groupByFolderToggle.checked = groupByFolder;
  }
  if (inactiveFilterToggle) {
    inactiveFilterToggle.checked = hideInactive;
  }
  if (inactiveDaysFilter) {
    inactiveDaysFilter.value = String(inactiveDays);
  }
  if (dirtyActiveToggle) {
    dirtyActiveToggle.checked = dirtyAsActive;
  }
  updateInactiveFilterUi();
  updateCommitSortUi();
  loadRepos();
  refreshTimer = setInterval(loadRepos, 30000);
  document.addEventListener('keydown', handleKeyboard);
});

// --- Data Fetching ---

async function loadRepos() {
  try {
    const response = await fetch('/api/repos');
    const data = await response.json();
    repos = data;
    renderAll();
    loadingState.classList.add('hidden');
  } catch (err) {
    console.error('Failed to load repos:', err);
    showToast('Failed to load repo data', 'error');
  }
}

async function loadOverview() {
  try {
    const response = await fetch('/api/overview');
    return await response.json();
  } catch (err) {
    return null;
  }
}

async function triggerRescan() {
  rescanBtn.classList.add('is-loading');
  showToast('Scanning repositories…');
  try {
    const response = await fetch('/api/scan', { method: 'POST' });
    const result = await response.json();
    await loadRepos();
    showToast(`Scanned ${result.repos_scanned} repos in ${result.scan_duration_ms}ms`, 'success');
  } catch (err) {
    showToast('Rescan failed', 'error');
  } finally {
    rescanBtn.classList.remove('is-loading');
  }
}

// --- Rendering ---

function renderAll() {
  renderStats();
  renderTable();
  renderScanTime();
}

async function renderStats() {
  const overview = await loadOverview();
  if (!overview) return;

  const badges = [
    { label: 'Repos', value: overview.total_repos, cls: '' },
    { label: 'Dirty', value: overview.dirty_repos, cls: overview.dirty_repos > 0 ? 'is-warning' : '' },
    { label: 'PRs', value: overview.total_open_prs, cls: overview.total_open_prs > 0 ? 'is-info' : '' },
    { label: 'Behind', value: overview.repos_behind, cls: overview.repos_behind > 0 ? 'is-error' : '' },
    { label: 'Stale', value: overview.total_stale_branches, cls: overview.total_stale_branches > 0 ? 'is-warning' : '' },
  ];

  headerStats.innerHTML = badges.map(b =>
    `<div class="stat-badge ${b.cls}">
      <span class="stat-value">${b.value}</span>
      <span>${b.label}</span>
    </div>`
  ).join('');
}

function renderScanTime() {
  if (repos.length > 0 && repos[0].last_scanned) {
    const ago = timeAgo(new Date(repos[0].last_scanned));
    scanTime.textContent = `Updated ${ago}`;
  }
}

function renderTable() {
  const worktreeMap = buildWorktreeMap();
  const filtered = getFilteredRepos(worktreeMap);

  let html = '';
  let rowIndex = 0;
  const categoryOrder = ['tools', 'utilities', 'docs', 'projects', 'templates', 'other'];

  if (groupByFolder) {
    const groups = {};
    for (const repo of filtered) {
      const cat = repo.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(repo);
    }

    for (const cat of categoryOrder) {
      const catRepos = groups[cat];
      if (!catRepos || catRepos.length === 0) continue;
      const sortedCatRepos = [...catRepos].sort((a, b) => compareByLastCommit(a, b, worktreeMap));

      const isCollapsed = collapsedCategories[cat] || false;
      const collapsedCls = isCollapsed ? 'is-collapsed' : '';

      html += `<tr class="category-header ${collapsedCls}" onclick="toggleCategory('${cat}')">
        <td colspan="7">
          <span class="category-label">
            <svg class="category-chevron" viewBox="0 0 16 16" fill="none">
              <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            ${cat}
            <span class="category-count">${sortedCatRepos.length}</span>
          </span>
        </td>
      </tr>`;

      for (const repo of sortedCatRepos) {
        const changed = detectChange(repo);
        const focusedCls = rowIndex === focusedIndex ? 'is-focused' : '';
        const changedCls = changed ? 'is-changed' : '';
        const hiddenCls = isCollapsed ? 'is-collapsed' : '';
        const worktrees = worktreeMap[repo.name] || [];
        const commitMeta = getLatestCommitMeta(repo, worktrees);

        html += renderRepoRow(repo, rowIndex, `${focusedCls} ${changedCls} ${hiddenCls}`, cat, worktrees.length, commitMeta);

        // PR detail row (hidden by default)
        if (repo.open_prs && repo.open_prs.length > 0) {
          const detailHidden = isCollapsed ? 'is-collapsed' : '';
          html += renderPrDetailRow(repo, detailHidden);
        }

        // Worktree detail row (expanded by default)
        if (worktrees.length > 0) {
          const wtCollapsed = collapsedWorktrees.has(repo.name);
          const wtExpandedCls = (isCollapsed || wtCollapsed) ? '' : 'is-expanded';
          html += renderWtDetailRow(repo, worktrees, wtExpandedCls);
        }

        rowIndex++;
      }
    }
  } else {
    const sortedRepos = [...filtered].sort((a, b) => compareByLastCommit(a, b, worktreeMap));

    for (const repo of sortedRepos) {
      const changed = detectChange(repo);
      const focusedCls = rowIndex === focusedIndex ? 'is-focused' : '';
      const changedCls = changed ? 'is-changed' : '';
      const worktrees = worktreeMap[repo.name] || [];
      const commitMeta = getLatestCommitMeta(repo, worktrees);
      const cat = repo.category || 'other';

      html += renderRepoRow(repo, rowIndex, `${focusedCls} ${changedCls}`, cat, worktrees.length, commitMeta);

      if (repo.open_prs && repo.open_prs.length > 0) {
        html += renderPrDetailRow(repo, '');
      }

      if (worktrees.length > 0) {
        const wtCollapsed = collapsedWorktrees.has(repo.name);
        const wtExpandedCls = wtCollapsed ? '' : 'is-expanded';
        html += renderWtDetailRow(repo, worktrees, wtExpandedCls);
      }

      rowIndex++;
    }
  }

  tableBody.innerHTML = html;

  // Update filter counts
  const primaryCount = repos.filter(r => !r.is_worktree).length;
  filterCounts.textContent = `${filtered.length} of ${primaryCount} repos`;

  // Show/hide empty state
  if (filtered.length === 0 && repos.length > 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
  }

  // Store current state for change detection
  for (const repo of repos) {
    previousRepos[repo.name] = JSON.stringify({
      is_dirty: repo.is_dirty,
      insertions: repo.insertions,
      deletions: repo.deletions,
      current_branch: repo.current_branch,
      ahead: repo.ahead,
      behind: repo.behind,
      open_prs: repo.open_prs?.length || 0,
    });
  }
}

function renderRepoRow(repo, index, extraCls, category, wtCount, commitMeta) {
  const statusInfo = getStatusInfo(repo);
  const branchCls = repo.current_branch === repo.default_branch ? 'is-default' : 'is-feature';
  const commitDate = commitMeta?.date || null;
  const commitAgo = commitDate ? timeAgo(new Date(commitDate)) : '—';
  const commitCls = getCommitFreshness(commitDate);
  const commitTitle = commitMeta?.message || repo.last_commit_message || '';

  const repoLink = repo.github_url
    ? `<a href="${repo.github_url}" target="_blank" rel="noopener" title="${repo.path}">${repo.name}</a>`
    : `<span class="repo-no-remote" title="${repo.path}">${repo.name}</span>`;

  const wtBadge = wtCount > 0
    ? `<span class="wt-badge" onclick="toggleWtDetail('${repo.name}', event)"><svg class="wt-icon" viewBox="0 0 16 16" fill="none"><path d="M6 3v4.5c0 .83.67 1.5 1.5 1.5H12M6 3V13M6 3H4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>${wtCount}</span>`
    : '';

  let changesHtml;
  if (repo.insertions === 0 && repo.deletions === 0) {
    changesHtml = '<span class="changes-none">—</span>';
  } else {
    const ins = repo.insertions > 0 ? `<span class="changes-ins">+${repo.insertions}</span>` : '';
    const del = repo.deletions > 0 ? `<span class="changes-del">-${repo.deletions}</span>` : '';
    changesHtml = `${ins}${ins && del ? ' ' : ''}${del}`;
  }

  let prHtml;
  if (!repo.open_prs || repo.open_prs.length === 0) {
    prHtml = '<span class="pr-none">—</span>';
  } else {
    const hasDraft = repo.open_prs.some(p => p.state === 'DRAFT');
    const cls = hasDraft && repo.open_prs.length === 1 ? 'is-draft' : '';
    prHtml = `<span class="pr-badge ${cls}" onclick="togglePrDetail('${repo.name}', event)">${repo.open_prs.length} PR${repo.open_prs.length > 1 ? 's' : ''}</span>`;
  }

  const staleCls = repo.stale_branches.length > 0 ? 'is-nonzero' : 'is-zero';
  const staleVal = repo.stale_branches.length > 0 ? repo.stale_branches.length : '—';
  const staleTitle = repo.stale_branches.length > 0 ? repo.stale_branches.join(', ') : '';

  return `<tr class="repo-row ${extraCls}" data-index="${index}" data-name="${repo.name}" data-category="${category}">
    <td class="col-repo"><div class="repo-name">${repoLink}${wtBadge}</div></td>
    <td class="col-branch"><span class="branch-name ${branchCls}">${repo.current_branch}</span></td>
    <td class="col-status"><span class="status-badge ${statusInfo.cls}"><span class="status-dot"></span>${statusInfo.label}</span></td>
    <td class="col-changes"><span class="changes">${changesHtml}</span></td>
    <td class="col-prs">${prHtml}</td>
    <td class="col-commit"><span class="commit-time ${commitCls}" title="${commitTitle}">${commitAgo}</span></td>
    <td class="col-stale"><span class="stale-count ${staleCls}" title="${staleTitle}">${staleVal}</span></td>
  </tr>`;
}

function renderPrDetailRow(repo, extraCls) {
  const items = repo.open_prs.map(pr => {
    const ciCls = pr.ci_status ? `is-${pr.ci_status.toLowerCase()}` : '';
    const ciLabel = pr.ci_status || '—';
    const reviewCls = pr.review_decision ? `is-${pr.review_decision.toLowerCase().replace(/_/g, '-')}` : '';
    const reviewLabel = pr.review_decision ? pr.review_decision.replace(/_/g, ' ') : '';

    return `<div class="pr-detail-item">
      <a href="${pr.url}" target="_blank" rel="noopener">#${pr.number} ${pr.title}</a>
      <div class="pr-meta">
        <span class="pr-branch-tag">${pr.head_branch}</span>
        <span class="pr-ci ${ciCls}">${ciLabel}</span>
        ${reviewLabel ? `<span class="pr-review ${reviewCls}">${reviewLabel}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<tr class="pr-detail-row ${extraCls}" data-pr-for="${repo.name}">
    <td colspan="7"><div class="pr-detail-list">${items}</div></td>
  </tr>`;
}

function renderWtDetailRow(parentRepo, worktrees, extraCls) {
  const items = worktrees.map(wt => {
    const statusInfo = getStatusInfo(wt);
    const commitAgo = wt.last_commit_date ? timeAgo(new Date(wt.last_commit_date)) : '—';

    let displayName = wt.name;
    if (wt.name.startsWith(parentRepo.name)) {
      displayName = '…' + wt.name.slice(parentRepo.name.length);
    }

    let changesHtml = '';
    if (wt.insertions > 0) changesHtml += `<span class="wt-detail-ins">+${wt.insertions}</span>`;
    if (wt.deletions > 0) changesHtml += `<span class="wt-detail-del">-${wt.deletions}</span>`;
    if (!changesHtml) changesHtml = '<span class="wt-detail-no-changes">—</span>';

    return `<div class="wt-detail-item">
      <span class="wt-detail-name">${displayName}</span>
      <span class="wt-detail-branch">${wt.current_branch}</span>
      <span class="status-badge ${statusInfo.cls}"><span class="status-dot"></span>${statusInfo.label}</span>
      <span class="wt-detail-changes">${changesHtml}</span>
      <span class="wt-detail-commit">${commitAgo}</span>
    </div>`;
  }).join('');

  return `<tr class="wt-detail-row ${extraCls}" data-wt-for="${parentRepo.name}">
    <td colspan="7"><div class="wt-detail-list">${items}</div></td>
  </tr>`;
}

// --- Worktree Detail Toggle ---

function toggleWtDetail(repoName, event) {
  if (event) event.stopPropagation();
  const detailRow = tableBody.querySelector(`tr[data-wt-for="${repoName}"]`);
  if (detailRow) {
    detailRow.classList.toggle('is-expanded');
    if (detailRow.classList.contains('is-expanded')) {
      collapsedWorktrees.delete(repoName);
    } else {
      collapsedWorktrees.add(repoName);
    }
  }
}

// --- Filtering ---

function getFilteredRepos(worktreeMap) {
  const catVal = categoryFilter.value;
  const statusVal = statusFilter.value;
  const searchVal = searchInput.value.toLowerCase().trim();
  const cutoffTs = Date.now() - (inactiveDays * 24 * 60 * 60 * 1000);

  return repos.filter(repo => {
    // Worktrees are rendered as sub-rows, not standalone rows
    if (repo.is_worktree) return false;
    const worktrees = worktreeMap[repo.name] || [];
    if (catVal && repo.category !== catVal) return false;
    if (statusVal === 'dirty' && !repo.is_dirty) return false;
    if (statusVal === 'clean' && repo.is_dirty) return false;
    if (statusVal === 'behind' && repo.behind <= 0) return false;
    if (statusVal === 'ahead' && repo.ahead <= 0) return false;
    if (searchVal) {
      const nameMatch = repo.name.toLowerCase().includes(searchVal);
      const wtNames = worktrees.map(wt => wt.name.toLowerCase());
      const wtMatch = wtNames.some(n => n.includes(searchVal));
      if (!nameMatch && !wtMatch) return false;
    }
    if (hideInactive && !isRepoActive(repo, worktrees, cutoffTs, dirtyAsActive)) return false;
    return true;
  });
}

function applyFilters() {
  focusedIndex = -1;
  renderTable();
}

function toggleGroupByFolder() {
  if (!groupByFolderToggle) return;
  groupByFolder = groupByFolderToggle.checked;
  localStorage.setItem('rd-group-by-folder', String(groupByFolder));
  focusedIndex = -1;
  renderTable();
}

function toggleInactiveFilter() {
  if (!inactiveFilterToggle) return;
  hideInactive = inactiveFilterToggle.checked;
  localStorage.setItem('rd-hide-inactive', String(hideInactive));
  updateInactiveFilterUi();
  applyFilters();
}

function setInactiveDays() {
  if (!inactiveDaysFilter) return;
  const parsed = parseInt(inactiveDaysFilter.value, 10);
  if (!INACTIVE_DAY_OPTIONS.includes(parsed)) return;
  inactiveDays = parsed;
  localStorage.setItem('rd-inactive-days', String(inactiveDays));
  applyFilters();
}

function toggleDirtyAsActive() {
  if (!dirtyActiveToggle) return;
  dirtyAsActive = dirtyActiveToggle.checked;
  localStorage.setItem('rd-dirty-as-active', String(dirtyAsActive));
  applyFilters();
}

function toggleCommitSort() {
  commitSortDir = commitSortDir === 'desc' ? 'asc' : 'desc';
  localStorage.setItem('rd-last-commit-sort', commitSortDir);
  updateCommitSortUi();
  renderTable();
}

function updateCommitSortUi() {
  if (!lastCommitSortBtn || !lastCommitSortIndicator) return;
  const isDesc = commitSortDir === 'desc';
  lastCommitSortBtn.classList.add('is-active');
  lastCommitSortBtn.setAttribute('aria-label', `Sort by last commit (${isDesc ? 'newest first' : 'oldest first'})`);
  lastCommitSortIndicator.textContent = isDesc ? '↓' : '↑';
}

function updateInactiveFilterUi() {
  if (inactiveDaysFilter) {
    inactiveDaysFilter.disabled = !hideInactive;
    inactiveDaysFilter.classList.toggle('is-disabled', !hideInactive);
  }

  if (dirtyActiveToggle) {
    dirtyActiveToggle.disabled = !hideInactive;
    const dirtyToggleWrap = dirtyActiveToggle.closest('.filter-toggle');
    if (dirtyToggleWrap) {
      dirtyToggleWrap.classList.toggle('is-disabled', !hideInactive);
    }
  }
}

// --- Category Collapse ---

function toggleCategory(cat) {
  collapsedCategories[cat] = !collapsedCategories[cat];
  localStorage.setItem('rd-collapsed', JSON.stringify(collapsedCategories));

  // Toggle header class
  const headers = tableBody.querySelectorAll('.category-header');
  headers.forEach(h => {
    if (h.querySelector('.category-label')?.textContent.trim().startsWith(cat)) {
      h.classList.toggle('is-collapsed');
    }
  });

  // Toggle row visibility
  const rows = tableBody.querySelectorAll(`tr[data-category="${cat}"]`);
  rows.forEach(r => r.classList.toggle('is-collapsed'));

  // Toggle PR detail rows
  const detailRows = tableBody.querySelectorAll('.pr-detail-row');
  detailRows.forEach(r => {
    const forName = r.dataset.prFor;
    const parentRow = tableBody.querySelector(`tr[data-name="${forName}"]`);
    if (parentRow && parentRow.dataset.category === cat) {
      if (collapsedCategories[cat]) {
        r.classList.add('is-collapsed');
        r.classList.remove('is-expanded');
      } else {
        r.classList.remove('is-collapsed');
      }
    }
  });

  // Toggle worktree detail rows
  const wtDetailRows = tableBody.querySelectorAll('.wt-detail-row');
  wtDetailRows.forEach(r => {
    const forName = r.dataset.wtFor;
    const parentRow = tableBody.querySelector(`tr[data-name="${forName}"]`);
    if (parentRow && parentRow.dataset.category === cat) {
      if (collapsedCategories[cat]) {
        r.classList.add('is-collapsed');
        r.classList.remove('is-expanded');
      } else {
        r.classList.remove('is-collapsed');
        if (!collapsedWorktrees.has(forName)) {
          r.classList.add('is-expanded');
        }
      }
    }
  });
}

// --- PR Detail Toggle ---

function togglePrDetail(repoName, event) {
  if (event) event.stopPropagation();
  const detailRow = tableBody.querySelector(`tr[data-pr-for="${repoName}"]`);
  if (detailRow) {
    detailRow.classList.toggle('is-expanded');
  }
}

// --- Keyboard Navigation ---

function handleKeyboard(e) {
  // Escape: clear search / close help
  if (e.key === 'Escape') {
    const helpModal = document.getElementById('keyboardHelp');
    if (!helpModal.classList.contains('hidden')) {
      toggleHelp();
      return;
    }
    if (document.activeElement === searchInput) {
      searchInput.value = '';
      searchInput.blur();
      applyFilters();
      return;
    }
    focusedIndex = -1;
    renderTable();
    return;
  }

  // Don't intercept when typing in inputs
  if (e.target.matches('input, textarea, select')) return;

  // ? — toggle help
  if (e.key === '?') {
    e.preventDefault();
    toggleHelp();
    return;
  }

  // / — focus search
  if (e.key === '/') {
    e.preventDefault();
    searchInput.focus();
    return;
  }

  // r — rescan
  if (e.key === 'r') {
    e.preventDefault();
    triggerRescan();
    return;
  }

  // j — next row
  if (e.key === 'j') {
    e.preventDefault();
    navigateRows(1);
    return;
  }

  // k — previous row
  if (e.key === 'k') {
    e.preventDefault();
    navigateRows(-1);
    return;
  }

  // Enter — toggle PR detail for focused row
  if (e.key === 'Enter' && focusedIndex >= 0) {
    e.preventDefault();
    const row = tableBody.querySelector(`tr.repo-row[data-index="${focusedIndex}"]`);
    if (row) {
      const name = row.dataset.name;
      togglePrDetail(name);
    }
    return;
  }

  // o — open focused repo in GitHub
  if (e.key === 'o' && focusedIndex >= 0) {
    e.preventDefault();
    const row = tableBody.querySelector(`tr.repo-row[data-index="${focusedIndex}"]`);
    if (row) {
      const link = row.querySelector('.repo-name a');
      if (link) window.open(link.href, '_blank');
    }
    return;
  }
}

function navigateRows(direction) {
  const visibleRows = tableBody.querySelectorAll('tr.repo-row:not(.is-collapsed)');
  if (visibleRows.length === 0) return;

  // Remove current focus
  const currentFocused = tableBody.querySelector('.repo-row.is-focused');
  if (currentFocused) currentFocused.classList.remove('is-focused');

  // Find visible indexes
  const visibleIndexes = Array.from(visibleRows).map(r => parseInt(r.dataset.index));

  if (focusedIndex < 0) {
    // Nothing focused yet — start at first or last
    focusedIndex = direction > 0 ? visibleIndexes[0] : visibleIndexes[visibleIndexes.length - 1];
  } else {
    const currentPos = visibleIndexes.indexOf(focusedIndex);
    const nextPos = currentPos + direction;
    if (nextPos >= 0 && nextPos < visibleIndexes.length) {
      focusedIndex = visibleIndexes[nextPos];
    }
  }

  // Apply focus
  const newFocused = tableBody.querySelector(`tr.repo-row[data-index="${focusedIndex}"]`);
  if (newFocused) {
    newFocused.classList.add('is-focused');
    newFocused.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// --- Help Modal ---

function toggleHelp() {
  const modal = document.getElementById('keyboardHelp');
  modal.classList.toggle('hidden');
}

// --- Toast ---

let toastTimer = null;

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type ? `is-${type}` : ''}`;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// --- Helpers ---

function buildWorktreeMap() {
  const worktreeMap = {};
  for (const repo of repos) {
    if (repo.is_worktree && repo.parent_repo) {
      if (!worktreeMap[repo.parent_repo]) worktreeMap[repo.parent_repo] = [];
      worktreeMap[repo.parent_repo].push(repo);
    }
  }
  return worktreeMap;
}

function parseCommitTs(dateStr) {
  if (!dateStr) return 0;
  const ts = Date.parse(dateStr);
  return Number.isFinite(ts) ? ts : 0;
}

function getLatestCommitMeta(repo, worktrees = []) {
  let latestTs = parseCommitTs(repo.last_commit_date);
  let latestDate = repo.last_commit_date || null;
  let latestMessage = repo.last_commit_message || '';

  for (const wt of worktrees) {
    const wtTs = parseCommitTs(wt.last_commit_date);
    if (wtTs > latestTs) {
      latestTs = wtTs;
      latestDate = wt.last_commit_date || latestDate;
      latestMessage = wt.last_commit_message || latestMessage;
    }
  }

  return {
    ts: latestTs,
    date: latestDate,
    message: latestMessage,
  };
}

function compareByLastCommit(a, b, worktreeMap) {
  const aCommitTs = getLatestCommitMeta(a, worktreeMap[a.name] || []).ts;
  const bCommitTs = getLatestCommitMeta(b, worktreeMap[b.name] || []).ts;
  if (aCommitTs !== bCommitTs) {
    return commitSortDir === 'asc' ? aCommitTs - bCommitTs : bCommitTs - aCommitTs;
  }
  return a.name.localeCompare(b.name);
}

function isRepoActive(repo, worktrees, cutoffTs, treatDirtyAsActiveFlag) {
  if (treatDirtyAsActiveFlag && (repo.is_dirty || worktrees.some(wt => wt.is_dirty))) return true;
  const latest = getLatestCommitMeta(repo, worktrees);
  return latest.ts >= cutoffTs;
}

function getStatusInfo(repo) {
  if (repo.behind > 0) return { label: 'Behind', cls: 'is-behind' };
  if (repo.ahead > 0 && repo.is_dirty) return { label: 'Dirty', cls: 'is-dirty' };
  if (repo.ahead > 0) return { label: 'Ahead', cls: 'is-ahead' };
  if (repo.is_dirty) return { label: 'Dirty', cls: 'is-dirty' };
  return { label: 'Clean', cls: 'is-clean' };
}

function getCommitFreshness(dateStr) {
  if (!dateStr) return '';
  const hours = (Date.now() - new Date(dateStr).getTime()) / 3600000;
  if (hours < 4) return 'is-recent';
  if (hours > 168) return 'is-stale';  // > 1 week
  return '';
}

function detectChange(repo) {
  const prev = previousRepos[repo.name];
  if (!prev) return false;  // First load, no flash
  const current = JSON.stringify({
    is_dirty: repo.is_dirty,
    insertions: repo.insertions,
    deletions: repo.deletions,
    current_branch: repo.current_branch,
    ahead: repo.ahead,
    behind: repo.behind,
    open_prs: repo.open_prs?.length || 0,
  });
  return prev !== current;
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
