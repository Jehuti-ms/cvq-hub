// ============================================================================
// src/ui/tabs/attendance.js
//
// Attendance tab: one-tap roll call for the whole class + stats summary.
// Depends on: src/api/client.js, src/ui/toast.js, src/ui/classModal.js
// ============================================================================

import { api } from '../../api/client.js';
import { toast } from '../toast.js';
import { getActiveClassId, onClassChange } from '../classModal.js';

// ---------- State ----------
let trainees = [];
let attendance = [];
let rosterState = {};
let activeClassId = null;
let searchQuery = '';
let saving = false;
let perTraineeSort = 'name'; // 'name' | 'rate-desc' | 'rate-asc' | 'absences'

let els = {};

// ============================================================================
// PUBLIC INIT
// ============================================================================

export async function init() {
  cacheElements();
  if (!els.roster) {
    console.warn('[attendance] DOM not found — tab not in this page');
    return;
  }
  wireEvents();

  activeClassId = getActiveClassId();

  onClassChange(async (cls) => {
    activeClassId = cls ? cls.id : null;
    updateVisibility();
    if (activeClassId) {
      await Promise.all([loadTrainees(), loadAttendance()]);
    } else if (els.count) {
      els.count.textContent = '0';
    }
  });

  await refresh();
}

// ============================================================================
// DOM CACHE
// ============================================================================

function cacheElements() {
  els = {
    count: document.getElementById('attendanceCount'),
    noClass: document.getElementById('attendanceNoClass'),
    formCard: document.getElementById('attendanceFormCard'),
    listCard: document.getElementById('attendanceListCard'),

    date: document.getElementById('attendanceDate'),
    unit: document.getElementById('attendanceUnit'),
    topic: document.getElementById('attendanceTopic'),
    notes: document.getElementById('attendanceNotes'),

    roster: document.getElementById('attendanceRoster'),
    list: document.getElementById('attendanceList'),
    search: document.getElementById('attendanceSearch'),

    allPresentBtn: document.getElementById('allPresentBtn'),
    allLateBtn: document.getElementById('allLateBtn'),
    allAbsentBtn: document.getElementById('allAbsentBtn'),

    saveBtn: document.getElementById('saveAttendanceBtn'),
    resetBtn: document.getElementById('resetAttendanceBtn'),

    // Stats card
    statsCard: document.getElementById('attendanceStatsCard'),
    attSessionsCount: document.getElementById('attSessionsCount'),
    attRecordsCount: document.getElementById('attRecordsCount'),
    attRate: document.getElementById('attRate'),
    attPresentBadge: document.getElementById('attPresentBadge'),
    attLateBadge: document.getElementById('attLateBadge'),
    attAbsentBadge: document.getElementById('attAbsentBadge'),
    attExcusedBadge: document.getElementById('attExcusedBadge'),
    attPerTrainee: document.getElementById('attPerTrainee'),
    attSortToggle: document.getElementById('attSortToggle'),
  };
}

// ============================================================================
// EVENTS
// ============================================================================

function wireEvents() {
  // Date defaults to today
  if (els.date) els.date.value = new Date().toISOString().slice(0, 10);

  if (els.allPresentBtn) els.allPresentBtn.addEventListener('click', () => bulkSet('present'));
  if (els.allLateBtn) els.allLateBtn.addEventListener('click', () => bulkSet('late'));
  if (els.allAbsentBtn) els.allAbsentBtn.addEventListener('click', () => bulkSet('absent'));

  if (els.saveBtn) els.saveBtn.addEventListener('click', saveAll);
  if (els.resetBtn) els.resetBtn.addEventListener('click', resetForm);

  // Search for recent sessions
  if (els.search) {
    let t;
    els.search.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderRecent();
      }, 150);
    });
  }

  // Sort toggle for per-trainee breakdown
  if (els.attSortToggle) {
    els.attSortToggle.addEventListener('click', () => {
      const modes = [
        { key: 'name', label: 'Name A→Z' },
        { key: 'rate-desc', label: 'Rate high → low' },
        { key: 'rate-asc', label: 'Rate low → high' },
        { key: 'absences', label: 'Most absences' },
      ];
      const currentIdx = modes.findIndex((m) => m.key === perTraineeSort);
      const next = modes[(currentIdx + 1) % modes.length];
      perTraineeSort = next.key;
      els.attSortToggle.textContent = 'Sort: ' + next.label;
      renderPerTrainee();
    });
  }
}

// ============================================================================
// DATA
// ============================================================================

async function refresh() {
  activeClassId = getActiveClassId();
  updateVisibility();

  if (activeClassId) {
    await Promise.all([loadTrainees(), loadAttendance()]);
  }
}

async function loadTrainees() {
  try {
    const all = await api.call('listStudents');
    trainees = all
      .filter((t) => String(t.classId) === String(activeClassId))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    rosterState = {};
    trainees.forEach((t) => {
      rosterState[t.id] = 'present';
    });
    renderRoster();
  } catch (err) {
    console.error('[attendance] trainees load failed', err);
    if (els.roster) {
      els.roster.innerHTML = `<p class="empty-message" style="color: var(--danger);">⚠️ ${escapeHtml(err.message)}</p>`;
    }
  }
}

async function loadAttendance() {
  if (!els.list) return;
  els.list.innerHTML = `<p class="empty-message">Loading…</p>`;

  try {
    const all = await api.call('listAttendance');
    attendance = all
      .filter((a) => String(a.classId) === String(activeClassId))
      .map((a) => ({ ...a, date: normalizeDate(a.date) }));

    renderRecent();
    renderStats();
    if (els.count) els.count.textContent = String(attendance.length);
  } catch (err) {
    console.error('[attendance] load failed', err);
    els.list.innerHTML = `<p class="empty-message" style="color: var(--danger);">⚠️ ${escapeHtml(err.message)}</p>`;
  }
}

// ============================================================================
// VISIBILITY
// ============================================================================

function updateVisibility() {
  const hasClass = !!activeClassId;
  if (els.noClass) els.noClass.style.display = hasClass ? 'none' : 'block';
  if (els.formCard) els.formCard.style.display = hasClass ? 'block' : 'none';
  if (els.listCard) els.listCard.style.display = hasClass ? 'block' : 'none';
  if (els.statsCard) els.statsCard.style.display = hasClass ? 'block' : 'none';
}

// ============================================================================
// ROSTER RENDERING
// ============================================================================

function renderRoster() {
  if (!els.roster) return;

  if (!trainees.length) {
    els.roster.innerHTML = `<p class="empty-message">No trainees in this class yet. Add some in the Trainees tab first.</p>`;
    return;
  }

  els.roster.innerHTML = trainees.map(traineeRowHtml).join('');

  els.roster.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.traineeId;
      const status = btn.dataset.status;
      rosterState[id] = status;
      updateRowVisual(id);
    });
  });
}

function traineeRowHtml(t) {
  const status = rosterState[t.id] || 'present';
  const initial = String(t.name || '?')
    .charAt(0)
    .toUpperCase();

  return `
    <div class="roster-row" data-trainee-id="${escapeHtml(t.id)}" data-status="${status}">
      <div class="roster-info">
        <div class="trainee-avatar" style="width: 36px; height: 36px; font-size: var(--text-base);">${escapeHtml(initial)}</div>
        <div style="min-width: 0;">
          <div class="roster-name">${escapeHtml(t.name)}</div>
          <div class="roster-meta">${escapeHtml(t.studentId || '')}</div>
        </div>
      </div>
      <div class="roster-status">
        ${statusButton(t.id, 'present', '✅', 'Present')}
        ${statusButton(t.id, 'late', '⏰', 'Late')}
        ${statusButton(t.id, 'absent', '❌', 'Absent')}
      </div>
    </div>
  `;
}

function statusButton(traineeId, status, icon, label) {
  return `
    <button type="button" class="status-btn ${status}" data-status="${status}" data-trainee-id="${escapeHtml(traineeId)}" title="${label}">
      <span>${icon}</span>
    </button>
  `;
}

function updateRowVisual(traineeId) {
  const row = els.roster.querySelector(`[data-trainee-id="${cssEscape(traineeId)}"]`);
  if (!row) return;

  const status = rosterState[traineeId] || 'present';
  row.dataset.status = status;

  row.querySelectorAll('[data-status]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });
}

function bulkSet(status) {
  Object.keys(rosterState).forEach((id) => {
    rosterState[id] = status;
  });
  trainees.forEach((t) => updateRowVisual(t.id));
  toast(`All marked ${status}`, 'info');
}

// ============================================================================
// SAVE
// ============================================================================

async function saveAll() {
  if (saving) return;

  const date = els.date.value;
  const unit = els.unit.value.trim();
  const topic = els.topic.value.trim();
  const notes = els.notes.value.trim();

  if (!date) {
    toast('Please pick a date', 'error');
    return;
  }

  if (!trainees.length) {
    toast('No trainees to save', 'error');
    return;
  }

  const existingOnDate = attendance.filter((a) => a.date === date);
  if (existingOnDate.length) {
    const ok = confirm(
      `There are already ${existingOnDate.length} attendance records for ${formatDate(date)}.\n\n` +
        `Saving will add ${trainees.length} more (creating duplicates). Continue?`
    );
    if (!ok) return;
  }

  saving = true;
  if (els.saveBtn) {
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = '⏳ Saving…';
  }

  let saved = 0;
  let failed = 0;

  for (const t of trainees) {
    const status = rosterState[t.id] || 'present';
    const payload = {
      classId: activeClassId,
      studentId: t.id,
      studentName: t.name,
      date,
      status,
      subject: unit,
      topic,
      notes,
    };

    try {
      await api.call('createAttendance', payload);
      saved++;
    } catch (err) {
      console.error('[attendance] save failed for', t.name, err);
      failed++;
    }
  }

  saving = false;
  if (els.saveBtn) {
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = '💾 Save attendance';
  }

  if (failed) {
    toast(`${saved} saved · ${failed} failed`, 'warning');
  } else {
    toast(`${saved} attendance record${saved === 1 ? '' : 's'} saved`, 'success');
  }

  await loadAttendance();
}

function resetForm() {
  if (!confirm('Reset all attendance for this session back to Present?')) return;

  trainees.forEach((t) => {
    rosterState[t.id] = 'present';
  });
  trainees.forEach((t) => updateRowVisual(t.id));

  els.unit.value = '';
  els.topic.value = '';
  els.notes.value = '';

  toast('Form reset', 'info');
}

// ============================================================================
// RECENT SESSIONS LIST
// ============================================================================

function renderRecent() {
  if (!els.list) return;

  const filtered = attendance.filter((a) => {
    if (!searchQuery) return true;
    const hay = [a.studentName, a.subject, a.topic, a.status]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(searchQuery);
  });

  if (!filtered.length) {
    els.list.innerHTML = attendance.length
      ? `<p class="empty-message">No matches.</p>`
      : `<p class="empty-message">No attendance recorded yet.</p>`;
    return;
  }

  const byDate = {};
  filtered.forEach((a) => {
    const d = a.date || 'unknown';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(a);
  });

  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  els.list.innerHTML = dates
    .map((date) => {
      const records = byDate[date];
      const counts = { present: 0, late: 0, absent: 0, excused: 0 };
      records.forEach((r) => {
        const s = (r.status || '').toLowerCase();
        if (s in counts) counts[s]++;
      });

      const summary = [
        counts.present && `<span class="badge success">✅ ${counts.present}</span>`,
        counts.late && `<span class="badge warning">⏰ ${counts.late}</span>`,
        counts.absent && `<span class="badge danger">❌ ${counts.absent}</span>`,
        counts.excused && `<span class="badge info">📝 ${counts.excused}</span>`,
      ]
        .filter(Boolean)
        .join(' ');

      const unitLine = records[0]?.subject ? escapeHtml(records[0].subject) : '';
      const topicLine = records[0]?.topic ? escapeHtml(records[0].topic) : '';

      return `
      <div class="item-card" style="flex-direction: column; align-items: stretch;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap;">
          <div>
            <div class="item-title">${formatDate(date)}</div>
            ${unitLine || topicLine ? `<div class="item-meta">${unitLine}${unitLine && topicLine ? ' · ' : ''}${topicLine}</div>` : ''}
          </div>
          <div style="display: flex; gap: 4px; flex-wrap: wrap;">${summary}</div>
        </div>
        <div style="margin-top: 8px; font-size: var(--text-sm); color: var(--text-light);">
          ${records.length} trainee${records.length === 1 ? '' : 's'} marked
        </div>
      </div>
    `;
    })
    .join('');
}

// ============================================================================
// STATS
// ============================================================================

function renderStats() {
  if (!els.statsCard) return;

  const uniqueDates = new Set(attendance.map((a) => a.date).filter(Boolean));
  const sessionsCount = uniqueDates.size;
  const recordsCount = attendance.length;

  const counts = { present: 0, late: 0, absent: 0, excused: 0 };
  attendance.forEach((a) => {
    const s = (a.status || '').toLowerCase();
    if (s in counts) counts[s]++;
  });

  const attended = counts.present + counts.late;
  const eligible = counts.present + counts.late + counts.absent;
  const rate = eligible > 0 ? Math.round((attended / eligible) * 1000) / 10 : null;

  if (els.attSessionsCount) els.attSessionsCount.textContent = String(sessionsCount);
  if (els.attRecordsCount) els.attRecordsCount.textContent = String(recordsCount);
  if (els.attRate) els.attRate.textContent = rate != null ? rate + '%' : '—';

  if (els.attPresentBadge) els.attPresentBadge.textContent = `✅ ${counts.present} present`;
  if (els.attLateBadge) els.attLateBadge.textContent = `⏰ ${counts.late} late`;
  if (els.attAbsentBadge) els.attAbsentBadge.textContent = `❌ ${counts.absent} absent`;
  if (els.attExcusedBadge) els.attExcusedBadge.textContent = `📝 ${counts.excused} excused`;

  if (els.attRate && rate != null) {
    els.attRate.style.color =
      rate >= 90 ? 'var(--success)' : rate >= 80 ? 'var(--warning)' : 'var(--danger)';
  }

  renderPerTrainee();
}

function renderPerTrainee() {
  if (!els.attPerTrainee) return;

  if (!attendance.length) {
    els.attPerTrainee.innerHTML = `<p class="empty-message">No data yet.</p>`;
    return;
  }

  const byTrainee = {};
  attendance.forEach((a) => {
    const id = String(a.studentId);
    if (!byTrainee[id]) {
      byTrainee[id] = {
        id,
        name: a.studentName || traineeName(id) || 'Unknown',
        studentId: '',
        present: 0,
        late: 0,
        absent: 0,
        excused: 0,
      };
    }
    const s = (a.status || '').toLowerCase();
    if (s in byTrainee[id]) byTrainee[id][s]++;
  });

  trainees.forEach((t) => {
    const id = String(t.id);
    if (byTrainee[id]) byTrainee[id].studentId = t.studentId || '';
  });

  const rows = Object.values(byTrainee).map((r) => {
    const attended = r.present + r.late;
    const eligible = r.present + r.late + r.absent;
    r.rate = eligible > 0 ? Math.round((attended / eligible) * 1000) / 10 : null;
    r.total = r.present + r.late + r.absent + r.excused;
    return r;
  });

  const sorted = rows.slice();
  switch (perTraineeSort) {
    case 'rate-desc':
      sorted.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
      break;
    case 'rate-asc':
      sorted.sort((a, b) => (a.rate ?? 999) - (b.rate ?? 999));
      break;
    case 'absences':
      sorted.sort((a, b) => b.absent - a.absent);
      break;
    default:
      sorted.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  els.attPerTrainee.innerHTML = `
    <div style="overflow-x: auto;">
      <table style="width: 100%; font-size: var(--text-sm); border-collapse: collapse;">
        <thead>
          <tr style="text-align: left; color: var(--text-light); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.03em;">
            <th style="padding: 8px 4px;">Trainee</th>
            <th style="padding: 8px 4px; text-align: center;">✅</th>
            <th style="padding: 8px 4px; text-align: center;">⏰</th>
            <th style="padding: 8px 4px; text-align: center;">❌</th>
            <th style="padding: 8px 4px; text-align: right;">Rate</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(perTraineeRowHtml).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function perTraineeRowHtml(r) {
  const rateColor =
    r.rate == null
      ? 'var(--text-muted)'
      : r.rate >= 90
        ? 'var(--success)'
        : r.rate >= 80
          ? 'var(--warning)'
          : 'var(--danger)';

  const flag = r.rate == null ? '' : r.rate >= 90 ? '' : r.rate >= 80 ? '⚠️' : '🚨';

  return `
    <tr style="border-top: 1px solid var(--border-light);">
      <td style="padding: 10px 4px;">
        <div style="font-weight: var(--weight-medium);">${escapeHtml(r.name)} ${flag}</div>
        ${r.studentId ? `<div style="font-size: var(--text-xs); color: var(--text-light);">${escapeHtml(r.studentId)}</div>` : ''}
      </td>
      <td style="padding: 10px 4px; text-align: center;">${r.present}</td>
      <td style="padding: 10px 4px; text-align: center; color: var(--warning);">${r.late}</td>
      <td style="padding: 10px 4px; text-align: center; color: var(--danger);">${r.absent}</td>
      <td style="padding: 10px 4px; text-align: right; font-weight: var(--weight-semibold); color: ${rateColor};">
        ${r.rate != null ? r.rate + '%' : '—'}
      </td>
    </tr>
  `;
}

// ============================================================================
// HELPERS
// ============================================================================

function traineeName(id) {
  const t = trainees.find((x) => String(x.id) === String(id));
  return t ? t.name : '';
}

function normalizeDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
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

function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}
