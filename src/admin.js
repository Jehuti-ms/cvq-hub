// ============================================================================
// src/admin.js
//
// Coordinator panel — auth guard, data loading, and tab routing.
// Depends on: src/api/client.js, src/ui/classModal.js (for class name lookups)
// ============================================================================

import { api } from './api/client.js';

// ---------- State ----------
let user = null;
let stats = null;
let teachers = [];
let classes = [];
let trainees = [];
let audit = [];

// ============================================================================
// BOOT
// ============================================================================

(async function boot() {
  // Auth guard
  const token = localStorage.getItem('cvq_idToken');
  const userRaw = localStorage.getItem('cvq_user');

  if (!token || !userRaw) {
    window.location.replace('auth.html');
    return;
  }

  try {
    user = JSON.parse(userRaw);
  } catch {
    localStorage.removeItem('cvq_idToken');
    localStorage.removeItem('cvq_user');
    window.location.replace('auth.html');
    return;
  }

  // Set user name in header
  const nameEl = document.getElementById('adminUserName');
  if (nameEl) nameEl.textContent = user.name || user.email;

  // Load initial data — try to fetch coordinator stats.
  // If backend says forbidden, show denied view.
  try {
    stats = await api.call('getCoordinatorStats');
  } catch (err) {
    if (/Forbidden/i.test(err.message)) {
      showDenied();
      return;
    }
    console.error('[admin] stats failed:', err);
    showDenied();
    return;
  }

  // Load the other datasets in parallel
  try {
    const [u, c, t, a] = await Promise.all([
      api.call('listUsers').catch(() => []),
      api.call('listClasses').catch(() => []),
      api.call('listStudents').catch(() => []),
      api.call('listAuditLog').catch(() => []),
    ]);
    teachers = u || [];
    classes = c || [];
    trainees = t || [];
    audit = a || [];
  } catch (err) {
    console.warn('[admin] some datasets failed:', err);
  }

  showAdmin();
  renderOverview();
  wireEvents();
})();

// ============================================================================
// VIEW TOGGLES
// ============================================================================

function showDenied() {
  document.getElementById('deniedView').style.display = 'flex';
  document.getElementById('adminView').style.display = 'none';
}

function showAdmin() {
  document.getElementById('deniedView').style.display = 'none';
  document.getElementById('adminView').style.display = 'block';
}

// ============================================================================
// EVENTS
// ============================================================================

function wireEvents() {
  // Tab switching
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.adminTab;

      document.querySelectorAll('.admin-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.adminTab === tab);
      });
      document.querySelectorAll('.admin-tabcontent').forEach((s) => {
        s.classList.toggle('active', s.id === 'admin-' + tab);
      });

      // Lazy render on first visit
      if (tab === 'teachers' && !teachers.length) renderTeachers();
      if (tab === 'classes' && !classes.length) renderClasses();
      if (tab === 'trainees' && !trainees.length) renderTrainees();
      if (tab === 'audit' && !audit.length) renderAudit();
    });
  });

  // Search boxes
  wireSearch('teacherSearch', renderTeachers);
  wireSearch('classSearch', renderClasses);
  wireSearch('traineeSearchAdmin', renderTrainees);
  wireSearch('auditSearch', renderAudit);

  // Filters
  const teacherFilter = document.getElementById('teacherFilter');
  if (teacherFilter) teacherFilter.addEventListener('change', renderTeachers);

  const auditFilter = document.getElementById('auditFilter');
  if (auditFilter) auditFilter.addEventListener('change', renderAudit);
}

function wireSearch(id, renderFn) {
  const el = document.getElementById(id);
  if (!el) return;
  let timer;
  el.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(renderFn, 150);
  });
}

// ============================================================================
// OVERVIEW
// ============================================================================

function renderOverview() {
  if (!stats) return;

  const t = stats.totals;

  const tiles = [
    { label: 'Teachers', value: t.teachers, icon: '👩‍🏫' },
    { label: 'Coordinators', value: t.coordinators, icon: '🎯' },
    { label: 'Classes', value: t.classes, icon: '🏫' },
    { label: 'Trainees', value: t.students, icon: '👨‍🎓' },
    { label: 'Sessions', value: t.worklogs, icon: '📝' },
    { label: 'Hours logged', value: t.hours, icon: '⏱️' },
    { label: 'Marks', value: t.marks, icon: '📊' },
    { label: 'Attendance', value: t.attendance, icon: '✅' },
    { label: 'Evidence files', value: t.media, icon: '📸' },
  ];

  const container = document.getElementById('overviewTiles');
  if (container) {
    container.innerHTML = tiles
      .map(
        (tile) => `
      <div class="stat-tile">
        <div style="font-size: 1.5rem; margin-bottom: 8px;">${tile.icon}</div>
        <div class="value">${tile.value}</div>
        <div class="label">${tile.label}</div>
      </div>
    `
      )
      .join('');
  }

  const updated = document.getElementById('adminLastUpdated');
  if (updated) {
    updated.textContent = 'Updated ' + new Date(stats.generatedAt).toLocaleString();
  }

  // Per-teacher activity
  const teacherList = document.getElementById('overviewTeachers');
  if (!teacherList) return;

  const active = stats.teachers
    .filter((t) => t.stats && (t.stats.hours > 0 || t.stats.classes > 0 || t.stats.worklogs > 0))
    .sort((a, b) => b.stats.hours - a.stats.hours);

  if (!active.length) {
    teacherList.innerHTML = `<p class="empty-message">No teacher activity yet.</p>`;
    return;
  }

  teacherList.innerHTML = `
    <div style="overflow-x: auto;">
      <table style="width: 100%; font-size: 0.9rem; border-collapse: collapse;">
        <thead>
          <tr style="text-align: left; color: var(--text-light); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em;">
            <th style="padding: 10px 8px;">Teacher</th>
            <th style="padding: 10px 8px; text-align: right;">Classes</th>
            <th style="padding: 10px 8px; text-align: right;">Trainees</th>
            <th style="padding: 10px 8px; text-align: right;">Sessions</th>
            <th style="padding: 10px 8px; text-align: right;">Hours</th>
            <th style="padding: 10px 8px; text-align: right;">Marks</th>
            <th style="padding: 10px 8px; text-align: right;">Evidence</th>
            <th style="padding: 10px 8px;">Last seen</th>
          </tr>
        </thead>
        <tbody>
          ${active
            .map(
              (t) => `
            <tr style="border-top: 1px solid var(--border-light);">
              <td style="padding: 12px 8px;">
                <div style="font-weight: 500;">${escapeHtml(t.name || t.email)}</div>
                <div style="font-size: 0.75rem; color: var(--text-light);">${escapeHtml(t.email)}</div>
              </td>
              <td style="padding: 12px 8px; text-align: right;">${t.stats.classes}</td>
              <td style="padding: 12px 8px; text-align: right;">${t.stats.students}</td>
              <td style="padding: 12px 8px; text-align: right;">${t.stats.worklogs}</td>
              <td style="padding: 12px 8px; text-align: right; font-weight: 600; color: var(--primary);">${t.stats.hours}</td>
              <td style="padding: 12px 8px; text-align: right;">${t.stats.marks}</td>
              <td style="padding: 12px 8px; text-align: right;">${t.stats.media}</td>
              <td style="padding: 12px 8px; font-size: 0.8rem; color: var(--text-light);">${formatRelative(t.lastSeenAt)}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// STUBS (filled in next message)
// ============================================================================

function renderTeachers() {
  document.getElementById('teachersTable').innerHTML = `<p class="empty-message">Coming next…</p>`;
}

function renderClasses() {
  document.getElementById('classesTable').innerHTML = `<p class="empty-message">Coming next…</p>`;
}

function renderTrainees() {
  document.getElementById('traineesTableAdmin').innerHTML =
    `<p class="empty-message">Coming next…</p>`;
}

function renderAudit() {
  document.getElementById('auditTable').innerHTML = `<p class="empty-message">Coming next…</p>`;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatRelative(iso) {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    if (days < 30) return `${days}d ago`;
    return date.toLocaleDateString();
  } catch {
    return iso;
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]
  );
}
