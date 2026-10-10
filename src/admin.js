// ============================================================================
// src/admin.js
//
// Coordinator panel — auth guard, data loading, and tab routing.
// Depends on: src/api/client.js, src/ui/classModal.js (for class name lookups)
// ============================================================================

import { api } from './api/client.js';
import { toast } from './ui/toast.js';

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
    teachers = (u || []).map((row) => ({ ...row, uid: row.id }));
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

      // Render on every visit (cheap and always up-to-date)
      if (tab === 'teachers') renderTeachers();
      if (tab === 'classes') renderClasses();
      if (tab === 'trainees') renderTrainees();
      if (tab === 'audit') renderAudit();
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

  const rowsHtml = active
    .map(
      (t) => `
    <tr style="border-top: 1px solid var(--border-light);">
      <td style="padding: 12px 8px;">
        <div style="font-weight: 500;">${escapeHtml(t.name || t.email)}</div>
        <div style="font-size: 0.75rem; color: var(--text-light);">${escapeHtml(t.email)}</div>
      </td>
      <td style="padding: 12px 8px; text-align: center;">${t.stats.classes}</td>
      <td style="padding: 12px 8px; text-align: center;">${t.stats.students}</td>
      <td style="padding: 12px 8px; text-align: center;">${t.stats.worklogs}</td>
      <td style="padding: 12px 8px; text-align: center; font-weight: 600; color: var(--primary);">${t.stats.hours}</td>
      <td style="padding: 12px 8px; text-align: center;">${t.stats.marks}</td>
      <td style="padding: 12px 8px; text-align: center;">${t.stats.media}</td>
      <td style="padding: 12px 8px; text-align: center; font-size: 0.8rem; color: var(--text-light);">${formatRelative(t.lastSeenAt)}</td>
    </tr>
  `
    )
    .join('');

  const cardsHtml = active
    .map(
      (t) => `
    <div class="admin-card">
      <div class="admin-card-header">
        <div class="admin-card-avatar">
          ${
            t.picture
              ? `<img src="${escapeHtml(t.picture)}" alt="" onerror="this.style.display='none'; this.parentNode.textContent='${escapeHtml((t.name || '?').charAt(0).toUpperCase())}';">`
              : escapeHtml((t.name || t.email || '?').charAt(0).toUpperCase())
          }
        </div>
        <div style="min-width: 0; flex: 1;">
          <div class="admin-card-title">${escapeHtml(t.name || t.email)}</div>
          <div class="admin-card-subtitle">${escapeHtml(t.email)}</div>
          <div class="admin-card-subtitle" style="color: var(--text-muted); margin-top: 2px;">Last seen ${formatRelative(t.lastSeenAt)}</div>
        </div>
      </div>

      <div class="admin-card-stats">
        <div><div class="value">${t.stats.classes}</div><div class="label">Classes</div></div>
        <div><div class="value">${t.stats.students}</div><div class="label">Trainees</div></div>
        <div><div class="value">${t.stats.hours}</div><div class="label">Hours</div></div>
        <div><div class="value">${t.stats.worklogs}</div><div class="label">Sessions</div></div>
        <div><div class="value">${t.stats.marks}</div><div class="label">Marks</div></div>
        <div><div class="value">${t.stats.media}</div><div class="label">Evidence</div></div>
      </div>
    </div>
  `
    )
    .join('');

  teacherList.innerHTML = `
    <!-- Desktop table -->
    <div class="admin-table-view" style="overflow-x: auto;">
      <table style="width: 100%; font-size: 0.9rem; border-collapse: collapse;">
        <thead>
          <tr style="text-align: left; color: var(--text-light); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em;">
            <th style="padding: 10px 8px;">Teacher</th>
            <th style="padding: 10px 8px; text-align: center;">Classes</th>
            <th style="padding: 10px 8px; text-align: center;">Trainees</th>
            <th style="padding: 10px 8px; text-align: center;">Sessions</th>
            <th style="padding: 10px 8px; text-align: center;">Hours</th>
            <th style="padding: 10px 8px; text-align: center;">Marks</th>
            <th style="padding: 10px 8px; text-align: center;">Evidence</th>
            <th style="padding: 10px 8px; text-align: center;">Last seen</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>

    <!-- Mobile cards -->
    <div class="admin-card-view admin-card-list">
      ${cardsHtml}
    </div>
  `;
}

// ============================================================================
// STUBS (filled in next message)
// ============================================================================

// ============================================================================
// TEACHERS TAB
// ============================================================================

function renderTeachers() {
  const container = document.getElementById('teachersTable');
  if (!container) return;

  const searchEl = document.getElementById('teacherSearch');
  const filterEl = document.getElementById('teacherFilter');
  const query = (searchEl?.value || '').trim().toLowerCase();
  const filter = filterEl?.value || '';

  // Filter
  let filtered = teachers.filter((t) => {
    if (filter && t.role !== filter) return false;
    if (!query) return true;
    const hay = [t.name, t.email, t.uid].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(query);
  });

  // Sort: most recently seen first, then by name
  filtered.sort((a, b) => {
    const aTime = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
    const bTime = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(a.name || a.email).localeCompare(String(b.name || b.email));
  });

  if (!filtered.length) {
    container.innerHTML = teachers.length
      ? `<p class="empty-message">No matches for "${escapeHtml(query)}".</p>`
      : `<p class="empty-message">No users found.</p>`;
    return;
  }

  const isLastCoordinator = countActiveCoordinators() <= 1;

  const rowsHtml = filtered.map((t) => teacherRowHtml(t, isLastCoordinator)).join('');
  const cardsHtml = filtered.map((t) => teacherCardHtml(t, isLastCoordinator)).join('');

  container.innerHTML = `
    <!-- Desktop table -->
    <div class="admin-table-view" style="overflow-x: auto;">
      <table style="width: 100%; font-size: 0.9rem; border-collapse: collapse; background: var(--surface); border-radius: var(--radius); overflow: hidden;">
        <thead>
          <tr>
            <th style="padding: 12px; text-align: left; background: var(--surface-alt); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--text-light); letter-spacing: 0.03em;">User</th>
            <th style="padding: 12px; text-align: center; background: var(--surface-alt); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--text-light); letter-spacing: 0.03em;">Role</th>
            <th style="padding: 12px; text-align: center; background: var(--surface-alt); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--text-light); letter-spacing: 0.03em;">Status</th>
            <th style="padding: 12px; text-align: center; background: var(--surface-alt); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--text-light); letter-spacing: 0.03em;">Activity</th>
            <th style="padding: 12px; text-align: center; background: var(--surface-alt); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--text-light); letter-spacing: 0.03em;">Last seen</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>

    <!-- Mobile cards -->
    <div class="admin-card-view admin-card-list">
      ${cardsHtml}
    </div>
  `;

  // Wire role change dropdowns
  container.querySelectorAll('[data-role-select]').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const uid = sel.dataset.uid;
      const newRole = sel.value;
      await changeUserRole(uid, newRole, sel);
    });
  });

  // Wire active toggles
  container.querySelectorAll('[data-active-toggle]').forEach((chk) => {
    chk.addEventListener('change', async (e) => {
      const uid = chk.dataset.uid;
      const active = chk.checked;
      await toggleUserActive(uid, active, chk);
    });
  });
}

function countActiveCoordinators() {
  return teachers.filter(
    (t) =>
      t.role === 'coordinator' && (t.active === true || String(t.active).toLowerCase() === 'true')
  ).length;
}

function teacherRowHtml(t, isLastCoordinator) {
  const isSelf = t.uid === user.uid;
  const initials = String(t.name || t.email || '?')
    .split(/[\s@]/)[0]
    .charAt(0)
    .toUpperCase();

  const activeBool = t.active === true || String(t.active).toLowerCase() === 'true';

  // Prevent the last active coordinator from demoting themselves
  const demoteDisabled = isSelf && t.role === 'coordinator' && isLastCoordinator;

  // Activity stats (from coordinator stats)
  const teacherStats = stats?.teachers?.find((x) => x.uid === t.uid);
  const statsLine = teacherStats
    ? `${teacherStats.stats.classes} class${teacherStats.stats.classes === 1 ? '' : 'es'} · ${teacherStats.stats.students} trainee${teacherStats.stats.students === 1 ? '' : 's'} · ${teacherStats.stats.hours}h`
    : 'No activity';

  return `
    <tr style="border-top: 1px solid var(--border-light);">
      <td style="padding: 12px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--primary-pale); color: var(--primary); display: flex; align-items: center; justify-content: center; font-weight: 600; flex-shrink: 0; overflow: hidden;">
            ${
              t.picture
                ? `<img src="${escapeHtml(t.picture)}" alt="" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.parentNode.textContent='${escapeHtml(initials)}';">`
                : escapeHtml(initials)
            }
          </div>
          <div style="min-width: 0;">
            <div style="font-weight: 500; display: flex; align-items: center; gap: 6px;">
              ${escapeHtml(t.name || t.email.split('@')[0])}
              ${isSelf ? `<span class="badge primary" style="font-size: 0.65rem;">you</span>` : ''}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-light); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(t.email)}</div>
          </div>
        </div>
      </td>
      <td style="padding: 12px; text-align: center;">
        <select data-role-select data-uid="${escapeHtml(t.uid)}"
                ${demoteDisabled ? 'disabled title="Cannot demote the last coordinator"' : ''}
                style="padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); font-size: 0.85rem; cursor: pointer; min-width: 130px; ${demoteDisabled ? 'opacity: 0.6; cursor: not-allowed;' : ''}">
          <option value="teacher" ${t.role === 'teacher' ? 'selected' : ''}>👩‍🏫 Teacher</option>
          <option value="coordinator" ${t.role === 'coordinator' ? 'selected' : ''}>🎯 Coordinator</option>
        </select>
      </td>
      <td style="padding: 12px; text-align: center;">
        <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.8rem;">
          <input type="checkbox" data-active-toggle data-uid="${escapeHtml(t.uid)}"
                 ${activeBool ? 'checked' : ''}
                 ${isSelf ? 'disabled title="You cannot disable your own account"' : ''}
                 style="width: 18px; height: 18px; accent-color: var(--primary); cursor: pointer; ${isSelf ? 'cursor: not-allowed;' : ''}">
          <span class="badge ${activeBool ? 'success' : 'danger'}" style="font-size: 0.7rem;">
            ${activeBool ? 'Active' : 'Disabled'}
          </span>
        </label>
      </td>
      <td style="padding: 12px; text-align: center; font-size: 0.8rem; color: var(--text-light);">
        ${statsLine}
      </td>
      <td style="padding: 12px; text-align: center; font-size: 0.8rem; color: var(--text-light);">
        ${formatRelative(t.lastSeenAt)}
      </td>
    </tr>
  `;
}

function teacherCardHtml(t, isLastCoordinator) {
  const isSelf = t.uid === user.uid;
  const activeBool = t.active === true || String(t.active).toLowerCase() === 'true';
  const initials = String(t.name || t.email || '?')
    .split(/[\s@]/)[0]
    .charAt(0)
    .toUpperCase();

  const demoteDisabled = isSelf && t.role === 'coordinator' && isLastCoordinator;

  const teacherStats = stats?.teachers?.find((x) => x.uid === t.uid);
  const statsLine = teacherStats
    ? `${teacherStats.stats.classes} class${teacherStats.stats.classes === 1 ? '' : 'es'} · ${teacherStats.stats.students} trainee${teacherStats.stats.students === 1 ? '' : 's'} · ${teacherStats.stats.hours}h`
    : 'No activity yet';

  return `
    <div class="admin-card">
      <div class="admin-card-header">
        <div class="admin-card-avatar">
          ${
            t.picture
              ? `<img src="${escapeHtml(t.picture)}" alt="" onerror="this.style.display='none'; this.parentNode.textContent='${escapeHtml(initials)}';">`
              : escapeHtml(initials)
          }
        </div>
        <div style="min-width: 0; flex: 1;">
          <div class="admin-card-title">
            ${escapeHtml(t.name || t.email.split('@')[0])}
            ${isSelf ? `<span class="badge primary" style="font-size: 0.65rem;">you</span>` : ''}
          </div>
          <div class="admin-card-subtitle">${escapeHtml(t.email)}</div>
          <div class="admin-card-subtitle" style="color: var(--text-muted); margin-top: 2px;">
            ${statsLine} · Last seen ${formatRelative(t.lastSeenAt)}
          </div>
        </div>
      </div>

      <div class="admin-card-actions">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <select data-role-select data-uid="${escapeHtml(t.uid)}"
                  ${demoteDisabled ? 'disabled title="Cannot demote the last coordinator"' : ''}
                  style="${demoteDisabled ? 'opacity: 0.6; cursor: not-allowed;' : ''}">
            <option value="teacher" ${t.role === 'teacher' ? 'selected' : ''}>👩‍🏫 Teacher</option>
            <option value="coordinator" ${t.role === 'coordinator' ? 'selected' : ''}>🎯 Coordinator</option>
          </select>
        </div>

        <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.8rem;">
          <input type="checkbox" data-active-toggle data-uid="${escapeHtml(t.uid)}"
                 ${activeBool ? 'checked' : ''}
                 ${isSelf ? 'disabled title="You cannot disable your own account"' : ''}
                 style="width: 18px; height: 18px; accent-color: var(--primary);">
          <span class="badge ${activeBool ? 'success' : 'danger'}" style="font-size: 0.7rem;">
            ${activeBool ? 'Active' : 'Disabled'}
          </span>
        </label>
      </div>
    </div>
  `;
}

async function changeUserRole(uid, newRole, selectEl) {
  const userRecord = teachers.find((x) => x.uid === uid);
  if (!userRecord) return;

  const targetLabel = userRecord.name || userRecord.email;
  const oldRole = userRecord.role;

  if (oldRole === newRole) return;

  // Safety: prevent removing the last active coordinator
  if (oldRole === 'coordinator' && newRole === 'teacher' && countActiveCoordinators() <= 1) {
    alert(
      "Can't demote the last active coordinator.\n\n" +
        'Promote someone else to coordinator first, then demote this account.'
    );
    selectEl.value = oldRole;
    return;
  }

  // Confirm significant role changes
  if (newRole === 'coordinator') {
    const ok = confirm(
      `Promote ${targetLabel} to coordinator?\n\n` +
        'Coordinators can see all teachers, classes, and trainees. ' +
        'Only do this for trusted staff.'
    );
    if (!ok) {
      selectEl.value = oldRole;
      return;
    }
  }

  if (oldRole === 'coordinator' && newRole === 'teacher') {
    const ok = confirm(
      `Demote ${targetLabel} back to teacher?\n\n` +
        'They will lose access to the coordinator panel.'
    );
    if (!ok) {
      selectEl.value = oldRole;
      return;
    }
  }

  selectEl.disabled = true;

  try {
    await api.call('setUserRole', { id: uid, role: newRole });
    userRecord.role = newRole;
    toast(`${targetLabel} is now a ${newRole}`, 'success');
    renderTeachers();
  } catch (err) {
    console.error('[admin] role change failed:', err);
    toast(`Failed: ${err.message}`, 'error');
    selectEl.value = oldRole;
  } finally {
    selectEl.disabled = false;
  }
}

async function toggleUserActive(uid, active, checkboxEl) {
  const userRecord = teachers.find((x) => x.uid === uid);
  if (!userRecord) return;

  const targetLabel = userRecord.name || userRecord.email;

  if (!active && uid === user.uid) {
    alert("You can't disable your own account.");
    checkboxEl.checked = true;
    return;
  }

  if (!active) {
    const ok = confirm(
      `Disable ${targetLabel}?\n\n` +
        "They won't be able to log in or make any changes until you re-enable them."
    );
    if (!ok) {
      checkboxEl.checked = true;
      return;
    }
  }

  checkboxEl.disabled = true;

  try {
    await api.call('updateUser', { id: uid, patch: { active: active } });
    userRecord.active = active;
    toast(`${targetLabel} ${active ? 'enabled' : 'disabled'}`, 'success');
    renderTeachers();
  } catch (err) {
    console.error('[admin] toggle active failed:', err);
    toast(`Failed: ${err.message}`, 'error');
    checkboxEl.checked = !active;
  } finally {
    checkboxEl.disabled = false;
  }
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
