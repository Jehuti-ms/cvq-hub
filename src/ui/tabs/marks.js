// ============================================================================
// src/ui/tabs/marks.js
//
// Marks tab: record assessments with auto-calculated percentage and grade.
// Unit field uses a dropdown with an "Other…" option + custom units memory.
// Depends on: src/api/client.js, src/ui/toast.js, src/ui/classModal.js
// ============================================================================

import { api } from '../../api/client.js';
import { toast } from '../toast.js';
import { getActiveClassId, onClassChange } from '../classModal.js';

let marks = [];
let trainees = [];
let editingId = null;
let activeClassId = null;
let searchQuery = '';
let traineeFilter = '';

let els = {};

const CUSTOM_UNITS_KEY = 'cvq_customUnits';
const OTHER_VALUE = '__other__';

// ============================================================================
// PUBLIC INIT
// ============================================================================

export async function init() {
  cacheElements();
  if (!els.form) {
    console.warn('[marks] DOM not found — tab not in this page');
    return;
  }
  wireEvents();
  loadCustomUnits();

  activeClassId = getActiveClassId();

  onClassChange(async (cls) => {
    activeClassId = cls ? cls.id : null;
    updateVisibility();
    if (activeClassId) {
      await Promise.all([loadTrainees(), loadMarks()]);
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
    count: document.getElementById('marksCount'),
    avg: document.getElementById('marksAvg'),
    noClass: document.getElementById('marksNoClass'),
    listCard: document.getElementById('marksListCard'),
    list: document.getElementById('marksList'),
    search: document.getElementById('marksSearch'),
    filterTrainee: document.getElementById('marksFilterTrainee'),
    addBtn: document.getElementById('addMarkBtn'),

    modal: document.getElementById('marksModal'),
    modalTitle: document.getElementById('marksModalTitle'),
    modalClose: document.getElementById('marksModalClose'),
    form: document.getElementById('marksForm'),

    trainee: document.getElementById('marksTrainee'),
    date: document.getElementById('marksDate'),
    topic: document.getElementById('marksTopic'),
    unit: document.getElementById('marksUnit'),
    unitCustom: document.getElementById('marksUnitCustom'),
    unitCustomGroup: document.getElementById('marksUnitCustom'),
    score: document.getElementById('marksScore'),
    max: document.getElementById('marksMax'),
    notes: document.getElementById('marksNotes'),

    preview: document.getElementById('marksPreview'),
    previewPct: document.getElementById('marksPreviewPct'),
    previewGrade: document.getElementById('marksPreviewGrade'),

    submitBtn: document.getElementById('marksSubmitBtn'),
    cancelBtn: document.getElementById('marksCancelBtn'),
  };
}

// ============================================================================
// EVENTS
// ============================================================================

function wireEvents() {
  els.form.addEventListener('submit', onSubmit);
  if (els.addBtn) els.addBtn.addEventListener('click', () => openModal());
  if (els.modalClose) els.modalClose.addEventListener('click', closeModal);
  if (els.cancelBtn) els.cancelBtn.addEventListener('click', closeModal);

  if (els.modal) {
    els.modal.addEventListener('click', (e) => {
      if (e.target === els.modal) closeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modal && els.modal.style.display !== 'none') {
      closeModal();
    }
  });

  // Unit dropdown — show/hide custom input
  els.unit.addEventListener('change', onUnitChange);

  // Live preview update on score / max change
  els.score.addEventListener('input', updatePreview);
  els.max.addEventListener('input', updatePreview);

  // Search
  if (els.search) {
    let t;
    els.search.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderList();
      }, 150);
    });
  }

  // Trainee filter
  if (els.filterTrainee) {
    els.filterTrainee.addEventListener('change', (e) => {
      traineeFilter = e.target.value;
      renderList();
    });
  }
}

function onUnitChange() {
  const isOther = els.unit.value === OTHER_VALUE;
  els.unitCustom.style.display = isOther ? 'block' : 'none';
  if (isOther) {
    els.unitCustom.required = true;
    setTimeout(() => els.unitCustom.focus(), 50);
  } else {
    els.unitCustom.required = false;
    els.unitCustom.value = '';
  }
}

function updatePreview() {
  const score = parseFloat(els.score.value);
  const max = parseFloat(els.max.value);

  if (!isFinite(score) || !isFinite(max) || max <= 0) {
    els.preview.style.display = 'none';
    return;
  }

  const pct = Math.round((score / max) * 1000) / 10;
  const grade = gradeFor(pct);

  els.previewPct.textContent = pct + '%';
  els.previewGrade.textContent = grade;

  // Color-code the grade badge
  els.previewGrade.className = 'badge ' + gradeClass(grade);

  els.preview.style.display = 'block';
}

function gradeFor(pct) {
  if (pct >= 90) return 'A';
  if (pct >= 80) return 'B';
  if (pct >= 70) return 'C';
  if (pct >= 60) return 'D';
  return 'F';
}

function gradeClass(g) {
  switch (g) {
    case 'A':
      return 'success';
    case 'B':
      return 'info';
    case 'C':
      return 'warning';
    case 'D':
      return 'warning';
    default:
      return 'danger';
  }
}

// ============================================================================
// DATA
// ============================================================================

async function refresh() {
  activeClassId = getActiveClassId();
  updateVisibility();

  if (activeClassId) {
    await Promise.all([loadTrainees(), loadMarks()]);
  }
}

async function loadTrainees() {
  try {
    const all = await api.call('listStudents');
    trainees = all.filter((t) => String(t.classId) === String(activeClassId));
    populateTraineeSelects();
  } catch (err) {
    console.warn('[marks] trainees load failed', err);
  }
}

async function loadMarks() {
  if (!els.list) return;
  els.list.innerHTML = `<p class="empty-message">Loading…</p>`;

  try {
    const all = await api.call('listMarks');
    marks = all.filter((m) => String(m.classId) === String(activeClassId));
    renderList();
    updateStats();
  } catch (err) {
    console.error('[marks] load failed', err);
    els.list.innerHTML = `
      <p class="empty-message" style="color: var(--danger);">
        ⚠️ Could not load marks: ${escapeHtml(err.message)}
      </p>
    `;
  }
}

function updateStats() {
  if (els.count) els.count.textContent = String(marks.length);

  const valid = marks.filter((m) => {
    const s = parseFloat(m.score);
    const mx = parseFloat(m.maxScore);
    return isFinite(s) && isFinite(mx) && mx > 0;
  });

  if (!valid.length) {
    if (els.avg) els.avg.textContent = '—';
    return;
  }

  const total = valid.reduce((sum, m) => sum + (m.score / m.maxScore) * 100, 0);
  const avg = Math.round((total / valid.length) * 10) / 10;
  if (els.avg) els.avg.textContent = avg + '%';
}

// ============================================================================
// VISIBILITY
// ============================================================================

function updateVisibility() {
  const hasClass = !!activeClassId;
  if (els.noClass) els.noClass.style.display = hasClass ? 'none' : 'block';
  if (els.listCard) els.listCard.style.display = hasClass ? 'block' : 'none';
}

// ============================================================================
// CUSTOM UNITS (localStorage memory)
// ============================================================================

function loadCustomUnits() {
  const units = readCustomUnits();
  const group = document.getElementById('marksUnitCustom');
  if (!group) return;

  group.innerHTML = units
    .map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`)
    .join('');

  group.style.display = units.length ? '' : 'none';
}

function readCustomUnits() {
  try {
    const raw = localStorage.getItem(CUSTOM_UNITS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function rememberCustomUnit(unit) {
  if (!unit) return;
  const units = readCustomUnits();
  const normalized = unit.trim();
  if (!normalized) return;
  if (units.includes(normalized)) return;
  units.push(normalized);
  units.sort((a, b) => a.localeCompare(b));
  localStorage.setItem(CUSTOM_UNITS_KEY, JSON.stringify(units));
  loadCustomUnits();
}

// ============================================================================
// MODAL
// ============================================================================

function openModal(mode = 'new', entry = null) {
  if (!els.modal) return;

  els.form.reset();
  els.unitCustom.style.display = 'none';
  els.unitCustom.value = '';
  els.preview.style.display = 'none';

  if (mode === 'edit' && entry) {
    editingId = entry.id;
    els.modalTitle.textContent = '✏️ Edit mark';
    els.trainee.value = entry.studentId || '';
    els.date.value = normalizeDate(entry.date);
    els.topic.value = entry.topic || '';
    els.score.value = entry.score ?? '';
    els.max.value = entry.maxScore ?? 100;
    els.notes.value = entry.notes || '';
    els.submitBtn.textContent = '💾 Update mark';

    // Unit — try to match an option, else custom
    const unit = entry.subject || entry.unit || '';
    const option = Array.from(els.unit.options).find((o) => o.value === unit);
    if (option) {
      els.unit.value = unit;
      onUnitChange();
    } else if (unit) {
      els.unit.value = OTHER_VALUE;
      onUnitChange();
      els.unitCustom.value = unit;
    }
  } else {
    editingId = null;
    els.modalTitle.textContent = '➕ Add Mark';
    els.submitBtn.textContent = '💾 Save mark';
    els.date.value = new Date().toISOString().slice(0, 10);
    els.max.value = 100;
  }

  updatePreview();
  els.modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => els.trainee && els.trainee.focus(), 50);
}

function closeModal() {
  if (!els.modal) return;
  els.modal.style.display = 'none';
  document.body.style.overflow = '';
  editingId = null;
  els.form.reset();
}

// ============================================================================
// SUBMIT
// ============================================================================

async function onSubmit(e) {
  e.preventDefault();

  let unit = els.unit.value;
  if (unit === OTHER_VALUE) {
    unit = els.unitCustom.value.trim();
    if (!unit) {
      toast('Please type a unit name', 'error');
      return;
    }
    rememberCustomUnit(unit);
  }

  const studentId = els.trainee.value;
  const trainee = trainees.find((t) => String(t.id) === String(studentId));

  const payload = {
    classId: activeClassId,
    studentId: studentId,
    subject: unit,
    unit: unit,
    topic: els.topic.value.trim(),
    date: els.date.value,
    score: parseFloat(els.score.value),
    maxScore: parseFloat(els.max.value),
    notes: els.notes.value.trim(),
  };

  if (!payload.studentId || !payload.date || !payload.subject || !payload.topic) {
    toast('Please fill in all required fields', 'error');
    return;
  }

  if (!isFinite(payload.score) || !isFinite(payload.maxScore) || payload.maxScore <= 0) {
    toast('Score and max score must be valid numbers', 'error');
    return;
  }

  setFormBusy(true);

  try {
    if (editingId) {
      await api.call('updateMark', { id: editingId, patch: payload });
      toast('Mark updated', 'success');
    } else {
      await api.call('createMark', payload);
      toast('Mark added', 'success');
    }
    closeModal();
    await loadMarks();
  } catch (err) {
    console.error('[marks] save failed', err);
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    setFormBusy(false);
  }
}

function setFormBusy(busy) {
  if (!els.submitBtn) return;
  els.submitBtn.disabled = busy;
  els.submitBtn.textContent = busy ? '⏳ Saving…' : editingId ? '💾 Update mark' : '💾 Save mark';
}

// ============================================================================
// LIST
// ============================================================================

function renderList() {
  if (!els.list) return;

  const filtered = marks.filter((m) => {
    if (traineeFilter && String(m.studentId) !== String(traineeFilter)) return false;
    if (!searchQuery) return true;
    const hay = [m.topic, m.subject, m.unit, traineeName(m.studentId)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(searchQuery);
  });

  if (!filtered.length) {
    els.list.innerHTML = marks.length
      ? `<p class="empty-message">No matches.</p>`
      : `<p class="empty-message">No marks recorded yet. Click "Add mark" to start.</p>`;
    return;
  }

  filtered.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  els.list.innerHTML = filtered.map(markCardHtml).join('');

  els.list.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = marks.find((m) => String(m.id) === String(btn.dataset.id));
      if (entry) openModal('edit', entry);
    });
  });

  els.list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id));
  });
}

function markCardHtml(m) {
  const pct = m.maxScore > 0 ? Math.round((m.score / m.maxScore) * 1000) / 10 : null;
  const grade = pct != null ? gradeFor(pct) : '—';
  const gradeBadgeClass = pct != null ? gradeClass(grade) : 'neutral';

  const name = traineeName(m.studentId);
  const unit = m.subject || m.unit || '';

  return `
    <div class="item-card" data-id="${escapeHtml(m.id)}">
      <div class="item-main">
        <div class="item-title">
          <span>${escapeHtml(name || 'Unknown trainee')}</span>
          <span class="badge neutral" style="font-size: 0.7rem;">${formatDate(normalizeDate(m.date))}</span>
        </div>
        <div class="item-meta">
          ${unit ? `<span>📚 ${escapeHtml(unit)}</span>` : ''}
          ${m.topic ? `<span>📝 ${escapeHtml(m.topic)}</span>` : ''}
        </div>
        <div class="item-meta" style="margin-top:6px;">
          <strong>${m.score}/${m.maxScore}</strong>
          ${pct != null ? `<span class="badge ${gradeBadgeClass}" style="margin-left: 8px;">${pct}% — ${grade}</span>` : ''}
        </div>
      </div>
      <div class="item-actions">
        <button class="button small secondary" data-action="edit" data-id="${escapeHtml(m.id)}" type="button" title="Edit">✏️</button>
        <button class="button small danger" data-action="delete" data-id="${escapeHtml(m.id)}" type="button" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

async function confirmDelete(id) {
  if (!confirm('Delete this mark?')) return;
  try {
    await api.call('deleteMark', { id });
    toast('Mark deleted', 'success');
    await loadMarks();
  } catch (err) {
    console.error('[marks] delete failed', err);
    toast(`Delete failed: ${err.message}`, 'error');
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function populateTraineeSelects() {
  if (!els.trainee) return;

  const sorted = trainees
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const options = sorted
    .map(
      (t) =>
        `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} (${escapeHtml(t.studentId || '')})</option>`
    )
    .join('');

  // Modal trainee dropdown
  const current = els.trainee.value;
  els.trainee.innerHTML = '<option value="">Select a trainee…</option>' + options;
  if (current) els.trainee.value = current;

  // Filter dropdown
  if (els.filterTrainee) {
    const currentFilter = els.filterTrainee.value;
    els.filterTrainee.innerHTML =
      '<option value="">All trainees</option>' +
      sorted
        .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
        .join('');
    if (currentFilter) els.filterTrainee.value = currentFilter;
  }
}

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
