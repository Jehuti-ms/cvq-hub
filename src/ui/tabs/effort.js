// ============================================================================
// src/ui/tabs/effort.js
//
// My Effort tab: aggregate stats for the current teacher.
// Reads from existing endpoints, no new backend needed.
// Uses Chart.js (must be loaded on the page).
// ============================================================================

import { api } from '../../api/client.js';

// ---------- State ----------
let worklogs = [];
let marks = [];
let attendance = [];
let media = [];
let classes = [];
let period = 'all';
let chartInstance = null;

let els = {};

// ============================================================================
// PUBLIC INIT
// ============================================================================

export async function init() {
  cacheElements();
  if (!els.hours) {
    console.warn('[effort] DOM not found — tab not in this page');
    return;
  }
  wireEvents();
  await loadAllData();
}

// ============================================================================
// DOM CACHE
// ============================================================================

function cacheElements() {
  els = {
    period: document.getElementById('effortPeriod'),
    periods: document.getElementById('effortPeriods'),
    hours: document.getElementById('effHours'),
    sessions: document.getElementById('effSessions'),
    worklogs: document.getElementById('effWorklogs'),
    marks: document.getElementById('effMarks'),
    attendance: document.getElementById('effAttendance'),
    evidence: document.getElementById('effEvidence'),
    chart: document.getElementById('effortChart'),
    chartEmpty: document.getElementById('effortChartEmpty'),
    byClass: document.getElementById('effByClass'),
    byMonth: document.getElementById('effByMonth'),
  };
}

// ============================================================================
// EVENTS
// ============================================================================

function wireEvents() {
  if (els.periods) {
    els.periods.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-period]');
      if (!btn) return;
      period = btn.dataset.period;

      // Update active state
      els.periods.querySelectorAll('[data-period]').forEach((b) => {
        b.classList.toggle('primary', b.dataset.period === period);
      });

      // Update label
      const labels = { week: 'This week', month: 'This month', term: 'This term', all: 'All time' };
      if (els.period) els.period.textContent = labels[period] || 'All time';

      render();
    });
  }
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadAllData() {
  try {
    const [w, m, a, med, c] = await Promise.all([
      api.call('listWorklogs').catch(() => []),
      api.call('listMarks').catch(() => []),
      api.call('listAttendance').catch(() => []),
      api.call('listMedia').catch(() => []),
      api.call('listClasses').catch(() => []),
    ]);
    worklogs = w || [];
    marks = m || [];
    attendance = a || [];
    media = med || [];
    classes = c || [];
  } catch (err) {
    console.error('[effort] load failed', err);
  }

  render();
}

// ============================================================================
// PERIOD FILTER
// ============================================================================

function periodRange() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const iso = (d) => d.toISOString().slice(0, 10);

  switch (period) {
    case 'week': {
      const dow = today.getDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      const monday = new Date(today);
      monday.setDate(monday.getDate() + diff);
      return { from: iso(monday), to: iso(today) };
    }
    case 'month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: iso(first), to: iso(today) };
    }
    case 'term': {
      // Approximate: last 90 days
      const from = new Date(today);
      from.setDate(from.getDate() - 90);
      return { from: iso(from), to: iso(today) };
    }
    case 'all':
    default:
      return { from: '1970-01-01', to: '9999-12-31' };
  }
}

function inRange(dateStr, range) {
  if (!dateStr) return false;
  const d = String(dateStr).slice(0, 10);
  return d >= range.from && d <= range.to;
}

// ============================================================================
// RENDER
// ============================================================================

function render() {
  const range = periodRange();

  const fw = worklogs.filter((w) => inRange(w.date, range));
  const fm = marks.filter((m) => inRange(m.date, range));
  const fa = attendance.filter((a) => inRange(a.date, range));
  const fmed = media.filter((x) => inRange(x.capturedAt, range));

  // ----- Metrics -----
  const totalHours = fw.reduce((sum, w) => {
    const d = parseFloat(w.duration) || 0;
    const s = parseInt(w.sessions, 10) || 1;
    return sum + d * s;
  }, 0);

  const totalSessions = fw.reduce((sum, w) => sum + (parseInt(w.sessions, 10) || 1), 0);

  if (els.hours) els.hours.textContent = fmtNum(totalHours, 1);
  if (els.sessions) els.sessions.textContent = String(totalSessions);
  if (els.worklogs) els.worklogs.textContent = String(fw.length);
  if (els.marks) els.marks.textContent = String(fm.length);
  if (els.attendance) els.attendance.textContent = String(fa.length);
  if (els.evidence) els.evidence.textContent = String(fmed.length);

  // ----- By class -----
  renderByClass(fw);

  // ----- By month -----
  renderByMonth(fw);

  // ----- Chart -----
  renderChart(fw);
}

// ============================================================================
// BY CLASS
// ============================================================================

function renderByClass(filteredWorklogs) {
  if (!els.byClass) return;

  if (!filteredWorklogs.length) {
    els.byClass.innerHTML = `<p class="empty-message">No worklogs in this period.</p>`;
    return;
  }

  // Group by classId
  const grouped = {};
  filteredWorklogs.forEach((w) => {
    const id = String(w.classId || 'unknown');
    if (!grouped[id]) {
      grouped[id] = { id, hours: 0, sessions: 0, entries: 0 };
    }
    const d = parseFloat(w.duration) || 0;
    const s = parseInt(w.sessions, 10) || 1;
    grouped[id].hours += d * s;
    grouped[id].sessions += s;
    grouped[id].entries += 1;
  });

  const rows = Object.values(grouped).sort((a, b) => b.hours - a.hours);

  els.byClass.innerHTML = `
    <table style="width: 100%; font-size: var(--text-sm); border-collapse: collapse;">
      <thead>
        <tr style="color: var(--text-light); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.03em;">
          <th style="padding: 8px 4px; text-align: left;">Class</th>
          <th style="padding: 8px 4px; text-align: center;">Hours</th>
          <th style="padding: 8px 4px; text-align: center;">Sessions</th>
          <th style="padding: 8px 4px; text-align: center;">Entries</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr style="border-top: 1px solid var(--border-light);">
            <td style="padding: 10px 4px; font-weight: var(--weight-medium); text-align: left;">
              ${escapeHtml(className(r.id))}
            </td>
            <td style="padding: 10px 4px; text-align: center;">${fmtNum(r.hours, 1)}</td>
            <td style="padding: 10px 4px; text-align: center;">${r.sessions}</td>
            <td style="padding: 10px 4px; text-align: center; color: var(--text-light);">${r.entries}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

// ============================================================================
// BY MONTH
// ============================================================================

function renderByMonth(filteredWorklogs) {
  if (!els.byMonth) return;

  if (!filteredWorklogs.length) {
    els.byMonth.innerHTML = `<p class="empty-message">No worklogs in this period.</p>`;
    return;
  }

  const grouped = {};
  filteredWorklogs.forEach((w) => {
    const month = String(w.date || '').slice(0, 7); // YYYY-MM
    if (!month) return;
    if (!grouped[month]) grouped[month] = { month, hours: 0, sessions: 0 };
    const d = parseFloat(w.duration) || 0;
    const s = parseInt(w.sessions, 10) || 1;
    grouped[month].hours += d * s;
    grouped[month].sessions += s;
  });

  const rows = Object.values(grouped).sort((a, b) => b.month.localeCompare(a.month));

  els.byMonth.innerHTML = `
    <table style="width: 100%; font-size: var(--text-sm); border-collapse: collapse;">
      <thead>
        <tr style="color: var(--text-light); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.03em;">
          <th style="padding: 8px 4px; text-align: left;">Month</th>
          <th style="padding: 8px 4px; text-align: center;">Hours</th>
          <th style="padding: 8px 4px; text-align: center;">Sessions</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr style="border-top: 1px solid var(--border-light);">
            <td style="padding: 10px 4px; font-weight: var(--weight-medium); text-align: left;">${formatMonth(r.month)}</td>
            <td style="padding: 10px 4px; text-align: center;">${fmtNum(r.hours, 1)}</td>
            <td style="padding: 10px 4px; text-align: center;">${r.sessions}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

// ============================================================================
// CHART
// ============================================================================

async function renderChart(filteredWorklogs) {
  if (!els.chart) return;

  // Build last 12 weeks (ISO week start = Monday)
  const weeks = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 11; i >= 0; i--) {
    const monday = new Date(today);
    const dow = today.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    monday.setDate(today.getDate() + diff - i * 7);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const from = monday.toISOString().slice(0, 10);
    const to = sunday.toISOString().slice(0, 10);

    weeks.push({
      label: monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      from,
      to,
      hours: 0,
    });
  }

  // Fill hours per week
  filteredWorklogs.forEach((w) => {
    const d = String(w.date || '').slice(0, 10);
    if (!d) return;
    const hours = (parseFloat(w.duration) || 0) * (parseInt(w.sessions, 10) || 1);
    const week = weeks.find((wk) => d >= wk.from && d <= wk.to);
    if (week) week.hours += hours;
  });

  const labels = weeks.map((w) => w.label);
  const data = weeks.map((w) => Math.round(w.hours * 10) / 10);

  const hasData = data.some((v) => v > 0);

  if (!hasData) {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    els.chart.style.display = 'none';
    if (els.chartEmpty) els.chartEmpty.style.display = 'block';
    return;
  }

  els.chart.style.display = 'block';
  if (els.chartEmpty) els.chartEmpty.style.display = 'none';

  // Destroy previous chart
  if (chartInstance) chartInstance.destroy();

  // Load Chart.js on demand if not present
  if (typeof Chart === 'undefined') {
    console.log('[effort] Loading Chart.js dynamically…');
    await loadChartJs();
  }

  if (typeof Chart === 'undefined') {
    console.warn('[effort] Chart.js still not loaded after attempt');
    return;
  }

  chartInstance = new Chart(els.chart, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Hours',
          data,
          backgroundColor: '#0f766e',
          borderRadius: 6,
          maxBarThickness: 36,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y} hours`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
        x: {
          grid: { display: false },
        },
      },
    },
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function className(id) {
  if (id === 'unknown') return 'Unknown class';
  const c = classes.find((x) => String(x.id) === String(id));
  return c ? c.name : 'Class ' + id.slice(0, 8);
}

function formatMonth(yyyyMm) {
  if (!yyyyMm) return '—';
  try {
    const [y, m] = yyyyMm.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  } catch {
    return yyyyMm;
  }
}

function fmtNum(n, decimals = 0) {
  if (!isFinite(n)) return '0';
  const fixed = Number(n).toFixed(decimals);
  // Strip trailing .0
  return fixed.replace(/\.0+$/, '');
}

function loadChartJs() {
  return new Promise((resolve) => {
    if (typeof Chart !== 'undefined') return resolve();

    const existing = document.querySelector('script[src*="chart.js"]');
    if (existing) {
      // Already being loaded — wait for it
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => resolve());
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    script.onload = () => resolve();
    script.onerror = () => {
      console.warn('[effort] Failed to load Chart.js from CDN');
      resolve();
    };
    document.head.appendChild(script);
  });
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
