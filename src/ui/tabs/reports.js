// ============================================================================
// src/ui/tabs/reports.js
//
// Reports tab: generates printable summaries.
// Depends on: src/api/client.js, src/ui/classModal.js
// ============================================================================

import { api } from '../../api/client.js';
import { getActiveClass, getActiveClassId, onClassChange } from '../classModal.js';

// ---------- State ----------
let worklogs = [];
let marks = [];
let attendance = [];
let media = [];
let trainees = [];
let activeClass = null;
let currentReport = null;

let els = {};

// ============================================================================
// PUBLIC INIT
// ============================================================================

export async function init() {
  cacheElements();
  if (!els.picker) {
    console.warn('[reports] DOM not found — tab not in this page');
    return;
  }
  wireEvents();

  activeClass = getActiveClass();

  onClassChange(async (cls) => {
    activeClass = cls;
    updateVisibility();
    if (cls) await loadAll();
    hideOutput();
  });

  await refresh();
}

// ============================================================================
// DOM CACHE
// ============================================================================

function cacheElements() {
  els = {
    classLabel: document.getElementById('reportsClassLabel'),
    noClass: document.getElementById('reportsNoClass'),
    picker: document.getElementById('reportsPickerCard'),
    output: document.getElementById('reportsOutputCard'),
    outputTitle: document.getElementById('reportsOutputTitle'),
    content: document.getElementById('reportsContent'),
    backBtn: document.getElementById('reportsBackBtn'),
    copyBtn: document.getElementById('reportsCopyBtn'),
    printBtn: document.getElementById('reportsPrintBtn'),
  };
}

// ============================================================================
// EVENTS
// ============================================================================

function wireEvents() {
  // Report type buttons
  document.querySelectorAll('[data-report]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.report;
      generateReport(type);
    });
  });

  if (els.backBtn) els.backBtn.addEventListener('click', hideOutput);
  if (els.copyBtn) els.copyBtn.addEventListener('click', copyAsText);
  if (els.printBtn) els.printBtn.addEventListener('click', () => window.print());
}

// ============================================================================
// DATA
// ============================================================================

async function refresh() {
  activeClass = getActiveClass();
  updateVisibility();

  if (activeClass) {
    await loadAll();
  }
}

async function loadAll() {
  try {
    const [w, m, a, med, t] = await Promise.all([
      api.call('listWorklogs').catch(() => []),
      api.call('listMarks').catch(() => []),
      api.call('listAttendance').catch(() => []),
      api.call('listMedia').catch(() => []),
      api.call('listStudents').catch(() => []),
    ]);
    const classId = getActiveClassId();

    worklogs = (w || []).filter((x) => String(x.classId) === String(classId));
    marks = (m || []).filter((x) => String(x.classId) === String(classId));
    attendance = (a || []).filter((x) => String(x.classId) === String(classId));
    media = (med || []).filter((x) => String(x.classId) === String(classId));
    trainees = (t || []).filter((x) => String(x.classId) === String(classId));
  } catch (err) {
    console.error('[reports] load failed', err);
  }
}

// ============================================================================
// VISIBILITY
// ============================================================================

function updateVisibility() {
  const hasClass = !!activeClass;
  if (els.noClass) els.noClass.style.display = hasClass ? 'none' : 'block';
  if (els.picker) els.picker.style.display = hasClass ? 'block' : 'none';

  if (els.classLabel) {
    els.classLabel.textContent = hasClass
      ? `${activeClass.name}${activeClass.subject ? ' · ' + activeClass.subject : ''}`
      : 'All classes';
  }
}

function hideOutput() {
  if (els.output) els.output.style.display = 'none';
  currentReport = null;
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

function generateReport(type) {
  if (!els.output || !els.content) return;

  let html = '';
  let title = '';

  switch (type) {
    case 'weekly':
      title = 'Weekly summary';
      html = reportWeekly();
      break;
    case 'monthly':
      title = 'Monthly summary';
      html = reportMonthly();
      break;
    case 'class':
      title = 'Class report';
      html = reportClass();
      break;
    case 'trainee':
      title = 'Trainee progress';
      html = reportTrainee();
      break;
    default:
      return;
  }

  currentReport = { type, title, html };

  els.outputTitle.textContent = title;
  els.content.innerHTML = html;
  els.output.style.display = 'block';

  els.output.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================================
// WEEKLY
// ============================================================================

function reportWeekly() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dow = now.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(monday.getDate() + diff);
  const from = iso(monday);
  const to = iso(now);

  const fw = worklogs.filter((w) => inRange(w.date, from, to));
  const fm = marks.filter((m) => inRange(m.date, from, to));
  const fa = attendance.filter((a) => inRange(a.date, from, to));
  const fmed = media.filter((m) => inRange(m.capturedAt, from, to));

  const totalHours = fw.reduce(
    (s, w) => s + (parseFloat(w.duration) || 0) * (parseInt(w.sessions, 10) || 1),
    0
  );
  const totalSessions = fw.reduce((s, w) => s + (parseInt(w.sessions, 10) || 1), 0);

  const present = fa.filter((a) => (a.status || '').toLowerCase() === 'present').length;
  const late = fa.filter((a) => (a.status || '').toLowerCase() === 'late').length;
  const absent = fa.filter((a) => (a.status || '').toLowerCase() === 'absent').length;

  return `
    <h2>Weekly summary</h2>
    <div class="report-meta">
      <strong>${escapeHtml(activeClass.name)}</strong>
      ${activeClass.subject ? ' · ' + escapeHtml(activeClass.subject) : ''}
      <br>
      Week of ${formatDate(from)} — ${formatDate(to)}
      <br>
      Generated ${formatDate(iso(new Date()))}
    </div>

    <h3>Overview</h3>
    <div class="stat-line"><span>Sessions delivered</span><strong>${totalSessions}</strong></div>
    <div class="stat-line"><span>Hours logged</span><strong>${fmtNum(totalHours, 1)}</strong></div>
    <div class="stat-line"><span>Worklog entries</span><strong>${fw.length}</strong></div>
    <div class="stat-line"><span>Assessments recorded</span><strong>${fm.length}</strong></div>
    <div class="stat-line"><span>Evidence files</span><strong>${fmed.length}</strong></div>

    <h3>Attendance</h3>
    <div class="stat-line"><span>✅ Present</span><strong>${present}</strong></div>
    <div class="stat-line"><span>⏰ Late</span><strong>${late}</strong></div>
    <div class="stat-line"><span>❌ Absent</span><strong>${absent}</strong></div>

    ${worklogTable(fw)}
  `;
}

// ============================================================================
// MONTHLY
// ============================================================================

function reportMonthly() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = iso(first);
  const to = iso(now);

  const fw = worklogs.filter((w) => inRange(w.date, from, to));
  const fm = marks.filter((m) => inRange(m.date, from, to));
  const fa = attendance.filter((a) => inRange(a.date, from, to));
  const fmed = media.filter((m) => inRange(m.capturedAt, from, to));

  const totalHours = fw.reduce(
    (s, w) => s + (parseFloat(w.duration) || 0) * (parseInt(w.sessions, 10) || 1),
    0
  );
  const totalSessions = fw.reduce((s, w) => s + (parseInt(w.sessions, 10) || 1), 0);

  const avgMark = fm.length
    ? Math.round(
        (fm.reduce((s, m) => s + (parseFloat(m.score) / parseFloat(m.maxScore)) * 100, 0) /
          fm.length) *
          10
      ) / 10
    : null;

  // By week within the month
  const byWeek = {};
  fw.forEach((w) => {
    const d = normalizeDate(w.date);
    const wk = iso(mondayOf(d));
    if (!byWeek[wk]) byWeek[wk] = { hours: 0, sessions: 0 };
    byWeek[wk].hours += (parseFloat(w.duration) || 0) * (parseInt(w.sessions, 10) || 1);
    byWeek[wk].sessions += parseInt(w.sessions, 10) || 1;
  });

  const weeks = Object.entries(byWeek).sort((a, b) => a[0].localeCompare(b[0]));

  return `
    <h2>Monthly summary</h2>
    <div class="report-meta">
      <strong>${escapeHtml(activeClass.name)}</strong>
      ${activeClass.subject ? ' · ' + escapeHtml(activeClass.subject) : ''}
      <br>
      ${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
      <br>
      Generated ${formatDate(iso(new Date()))}
    </div>

    <h3>Overview</h3>
    <div class="stat-line"><span>Sessions delivered</span><strong>${totalSessions}</strong></div>
    <div class="stat-line"><span>Hours logged</span><strong>${fmtNum(totalHours, 1)}</strong></div>
    <div class="stat-line"><span>Worklog entries</span><strong>${fw.length}</strong></div>
    <div class="stat-line"><span>Assessments recorded</span><strong>${fm.length}</strong></div>
    ${avgMark != null ? `<div class="stat-line"><span>Average mark</span><strong>${avgMark}%</strong></div>` : ''}
    <div class="stat-line"><span>Attendance records</span><strong>${fa.length}</strong></div>
    <div class="stat-line"><span>Evidence files</span><strong>${fmed.length}</strong></div>

    ${
      weeks.length
        ? `
      <h3>Weekly breakdown</h3>
      <table>
        <thead><tr><th>Week starting</th><th>Hours</th><th>Sessions</th></tr></thead>
        <tbody>
          ${weeks
            .map(
              ([wk, v]) => `
            <tr>
              <td>${formatDate(wk)}</td>
              <td>${fmtNum(v.hours, 1)}</td>
              <td>${v.sessions}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `
        : ''
    }

    ${worklogTable(fw)}
  `;
}

// ============================================================================
// CLASS REPORT
// ============================================================================

function reportClass() {
  const totalHours = worklogs.reduce(
    (s, w) => s + (parseFloat(w.duration) || 0) * (parseInt(w.sessions, 10) || 1),
    0
  );
  const totalSessions = worklogs.reduce((s, w) => s + (parseInt(w.sessions, 10) || 1), 0);

  const avgMark = marks.length
    ? Math.round(
        (marks.reduce((s, m) => s + (parseFloat(m.score) / parseFloat(m.maxScore)) * 100, 0) /
          marks.length) *
          10
      ) / 10
    : null;

  const attendanceRate = (() => {
    const attended = attendance.filter((a) =>
      ['present', 'late'].includes((a.status || '').toLowerCase())
    ).length;
    const eligible = attendance.filter((a) =>
      ['present', 'late', 'absent'].includes((a.status || '').toLowerCase())
    ).length;
    return eligible ? Math.round((attended / eligible) * 1000) / 10 : null;
  })();

  return `
    <h2>Class report</h2>
    <div class="report-meta">
      <strong>${escapeHtml(activeClass.name)}</strong>
      ${activeClass.subject ? ' · ' + escapeHtml(activeClass.subject) : ''}
      ${activeClass.description ? '<br>' + escapeHtml(activeClass.description) : ''}
      <br>
      Generated ${formatDate(iso(new Date()))}
    </div>

    <h3>Overview</h3>
    <div class="stat-line"><span>Enrolled trainees</span><strong>${trainees.length}</strong></div>
    <div class="stat-line"><span>Total sessions delivered</span><strong>${totalSessions}</strong></div>
    <div class="stat-line"><span>Total hours logged</span><strong>${fmtNum(totalHours, 1)}</strong></div>
    <div class="stat-line"><span>Worklog entries</span><strong>${worklogs.length}</strong></div>
    <div class="stat-line"><span>Assessments recorded</span><strong>${marks.length}</strong></div>
    ${avgMark != null ? `<div class="stat-line"><span>Average mark</span><strong>${avgMark}%</strong></div>` : ''}
    <div class="stat-line"><span>Attendance rate</span><strong>${attendanceRate != null ? attendanceRate + '%' : '—'}</strong></div>
    <div class="stat-line"><span>Evidence files</span><strong>${media.length}</strong></div>

        <h3>Roster</h3>
    ${
      trainees.length
        ? `
      <!-- Desktop table -->
      <div class="reports-table-view">
        <table>
          <thead><tr><th>Name</th><th>ID</th><th>Gender</th><th>Contact</th></tr></thead>
          <tbody>
            ${trainees
              .map(
                (t) => `
              <tr>
                <td>${escapeHtml(t.name || '')}</td>
                <td>${escapeHtml(t.studentId || '')}</td>
                <td>${escapeHtml(t.gender || '')}</td>
                <td>${escapeHtml(t.email || t.phone || '')}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Mobile cards -->
      <div class="reports-card-view">
        ${trainees
          .map(
            (t) => `
          <div class="report-trainee-card">
            <div class="report-trainee-header">
              <div>
                <div class="report-trainee-name">${escapeHtml(t.name || '—')}</div>
                <div class="report-trainee-id">${escapeHtml(t.studentId || '')}</div>
              </div>
              ${t.gender ? `<span class="badge neutral" style="font-size: 0.7rem;">${escapeHtml(t.gender)}</span>` : ''}
            </div>
            ${
              t.email || t.phone
                ? `
              <div style="font-size: 0.85rem; color: var(--text-light);">
                ${t.email ? `📧 ${escapeHtml(t.email)}` : ''}
                ${t.email && t.phone ? ' · ' : ''}
                ${t.phone ? `📞 ${escapeHtml(t.phone)}` : ''}
              </div>
            `
                : ''
            }
          </div>
        `
          )
          .join('')}
      </div>
    `
        : '<p>No trainees enrolled.</p>'
    }
  `;
}

// ============================================================================
// TRAINEE PROGRESS
// ============================================================================

function reportTrainee() {
  // Group marks and attendance by trainee
  const byTrainee = {};
  trainees.forEach((t) => {
    byTrainee[t.id] = {
      name: t.name,
      studentId: t.studentId,
      marks: [],
      attendance: { present: 0, late: 0, absent: 0, excused: 0 },
    };
  });

  marks.forEach((m) => {
    const id = String(m.studentId);
    if (byTrainee[id]) byTrainee[id].marks.push(m);
  });

  attendance.forEach((a) => {
    const id = String(a.studentId);
    const s = (a.status || '').toLowerCase();
    if (byTrainee[id] && s in byTrainee[id].attendance) {
      byTrainee[id].attendance[s]++;
    }
  });

  const rows = Object.values(byTrainee).map((t) => {
    const avg = t.marks.length
      ? Math.round(
          (t.marks.reduce((s, m) => s + (parseFloat(m.score) / parseFloat(m.maxScore)) * 100, 0) /
            t.marks.length) *
            10
        ) / 10
      : null;
    const attended = t.attendance.present + t.attendance.late;
    const eligible = attended + t.attendance.absent;
    const rate = eligible ? Math.round((attended / eligible) * 1000) / 10 : null;
    return { ...t, avg, rate, attended, eligible };
  });

  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return `
    <h2>Trainee progress report</h2>
    <div class="report-meta">
      <strong>${escapeHtml(activeClass.name)}</strong>
      ${activeClass.subject ? ' · ' + escapeHtml(activeClass.subject) : ''}
      <br>
      All time
      <br>
      Generated ${formatDate(iso(new Date()))}
    </div>

    ${
      rows.length
        ? `
      <!-- Desktop table -->
      <div class="reports-table-view">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>ID</th>
              <th>📝 Marks</th>
              <th>📊 Avg</th>
              <th>🎯 Attended</th>
              <th>✅ Present</th>
              <th>⏰ Late</th>
              <th>❌ Absent</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (t) => `
              <tr>
                <td>${escapeHtml(t.name || '')}</td>
                <td>${escapeHtml(t.studentId || '')}</td>
                <td>${t.marks.length}</td>
                <td>${t.avg != null ? t.avg + '%' : '—'}</td>
                <td>${t.attendance.present}</td>
                <td>${t.attendance.late}</td>
                <td>${t.attendance.absent}</td>
                <td>${t.rate != null ? t.rate + '%' : '—'}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Mobile cards -->
      <div class="reports-card-view">
        ${rows
          .map(
            (t) => `
          <div class="report-trainee-card">
            <div class="report-trainee-header">
              <div>
                <div class="report-trainee-name">${escapeHtml(t.name || '—')}</div>
                <div class="report-trainee-id">${escapeHtml(t.studentId || '')}</div>
              </div>
              ${t.rate != null ? `<div class="report-trainee-rate">${t.rate}%</div>` : ''}
            </div>
            <div class="report-trainee-stats">
              <div><span class="label">📝 Marks</span><span class="value">${t.marks.length}</span></div>
              <div><span class="label">📊 Avg</span><span class="value">${t.avg != null ? t.avg + '%' : '—'}</span></div>
              <div><span class="label">🎯 Attended</span><span class="value">${t.attended}</span></div>
              <div><span class="label">✅ Present</span><span class="value">${t.attendance.present}</span></div>
              <div><span class="label">⏰ Late</span><span class="value">${t.attendance.late}</span></div>
              <div><span class="label">❌ Absent</span><span class="value">${t.attendance.absent}</span></div>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `
        : '<p>No trainees enrolled.</p>'
    }
  `;
}

// ============================================================================
// COPY AS TEXT
// ============================================================================

function copyAsText() {
  if (!els.content) return;
  const text = els.content.innerText;

  navigator.clipboard
    .writeText(text)
    .then(() => {
      const btn = els.copyBtn;
      const original = btn.textContent;
      btn.textContent = '✓ Copied';
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    })
    .catch((err) => {
      console.error('Copy failed:', err);
    });
}

// ============================================================================
// HELPERS
// ============================================================================

function worklogTable(list) {
  if (!list.length) return '<h3>Sessions</h3><p>No sessions logged in this period.</p>';

  const sorted = list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return `
    <h3>Sessions</h3>

    <!-- Desktop table -->
    <div class="reports-table-view">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Topic</th>
            <th>Duration</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${sorted
            .map(
              (w) => `
            <tr>
              <td>${formatDate(normalizeDate(w.date))}</td>
              <td>${escapeHtml(w.topic || w.subject || '—')}</td>
              <td>${w.duration}h</td>
              <td>${escapeHtml((w.description || '').slice(0, 80))}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <!-- Mobile cards -->
    <div class="reports-card-view">
      ${sorted
        .map(
          (w) => `
        <div class="report-session-card">
          <div class="report-session-header">
            <div>
              <div class="report-session-title">${escapeHtml(w.topic || w.subject || 'Untitled session')}</div>
              <div class="report-session-meta">${formatDate(normalizeDate(w.date))}</div>
            </div>
            <span class="badge primary" style="font-size: 0.75rem; flex-shrink: 0;">${w.duration}h</span>
          </div>
          ${
            w.description
              ? `
            <div class="report-session-desc">${escapeHtml(w.description.slice(0, 160))}${w.description.length > 160 ? '…' : ''}</div>
          `
              : ''
          }
        </div>
      `
        )
        .join('')}
    </div>
  `;
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

function iso(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const d = normalizeDate(dateStr);
  return d >= from && d <= to;
}

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr + 'T00:00:00').toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoStr;
  }
}

function fmtNum(n, decimals = 0) {
  if (!isFinite(n)) return '0';
  return Number(n).toFixed(decimals).replace(/\.0+$/, '');
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
