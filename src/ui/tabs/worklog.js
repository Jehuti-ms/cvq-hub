// ============================================================================
// src/ui/tabs/worklog.js
//
// Worklog tab: log sessions with evidence.
// Depends on: src/api/client.js, src/ui/toast.js, src/components/evidence.js,
//             src/ui/classModal.js
// ============================================================================

import { api } from '../../api/client.js';
import { toast } from '../toast.js';
import { createEvidenceCapture } from '../../components/evidence.js';
import { getActiveClassId, onClassChange } from '../classModal.js';

let worklogs = [];
let trainees = [];
let editingId = null;
let activeClassId = null;
let searchQuery = '';
let evidence = null;

let els = {};

// ============================================================================
// PUBLIC INIT
// ============================================================================

export async function init() {
  cacheElements();
  if (!els.form) {
    console.warn('[worklog] DOM not found — tab not in this page');
    return;
  }
  wireEvents();

  const evidenceContainer = document.getElementById('worklogEvidence');
  if (evidenceContainer) {
    evidence = createEvidenceCapture(evidenceContainer, {
      refType: 'worklog',
      refId: null,
      classId: null,
    });
  }

  activeClassId = getActiveClassId();

  onClassChange(async (cls) => {
    activeClassId = cls ? cls.id : null;
    updateVisibility();
    if (activeClassId) {
      await Promise.all([loadTrainees(), loadWorklogs()]);
    } else {
      if (els.count) els.count.textContent = '0';
    }
  });

  await refresh();
}

// ============================================================================
// DOM CACHE
// ============================================================================

function cacheElements() {
  els = {
    count: document.getElementById('worklogCount'),
    noClass: document.getElementById('worklogNoClass'),
    listCard: document.getElementById('worklogListCard'),
    list: document.getElementById('worklogList'),
    search: document.getElementById('worklogSearch'),
    addBtn: document.getElementById('addWorklogBtn'),

    modal: document.getElementById('worklogModal'),
    modalTitle: document.getElementById('worklogModalTitle'),
    modalClose: document.getElementById('worklogModalClose'),
    form: document.getElementById('worklogForm'),

    date: document.getElementById('worklogDate'),
    type: document.getElementById('worklogType'),
    traineeGroup: document.getElementById('worklogTraineeGroup'),
    trainee: document.getElementById('worklogTrainee'),
    unit: document.getElementById('worklogUnit'),
    topic: document.getElementById('worklogTopic'),
    duration: document.getElementById('worklogDuration'),
    sessions: document.getElementById('worklogSessions'),
    traineesCount: document.getElementById('worklogTraineesCount'),
    description: document.getElementById('worklogDescription'),
    outcomes: document.getElementById('worklogOutcomes'),
    nextSteps: document.getElementById('worklogNextSteps'),
    notes: document.getElementById('worklogNotes'),

    submitBtn: document.getElementById('worklogSubmitBtn'),
    cancelBtn: document.getElementById('worklogCancelBtn'),
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

  if (els.type) {
    els.type.addEventListener('change', updateTraineeVisibility);
  }

  if (els.search) {
    let timer;
    els.search.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderList();
      }, 150);
    });
  }
}

function updateTraineeVisibility() {
  if (!els.traineeGroup) return;
  const isTrainee = els.type.value === 'trainee';
  els.traineeGroup.style.display = isTrainee ? 'block' : 'none';
  if (els.trainee) els.trainee.required = isTrainee;
}

// ============================================================================
// DATA
// ============================================================================

async function refresh() {
  activeClassId = getActiveClassId();
  updateVisibility();

  if (activeClassId) {
    await Promise.all([loadTrainees(), loadWorklogs()]);
  } else if (els.count) {
    els.count.textContent = '0';
  }
}

async function loadTrainees() {
  try {
    const all = await api.call('listStudents');
    trainees = all.filter((t) => String(t.classId) === String(activeClassId));
    populateTraineeSelect();
  } catch (err) {
    console.warn('[worklog] trainees load failed', err);
  }
}

async function loadWorklogs() {
  if (!els.list) return;
  els.list.innerHTML = `<p class="empty-message">Loading…</p>`;

  try {
    const all = await api.call('listWorklogs');
    worklogs = all
      .filter((w) => String(w.classId) === String(activeClassId))
      .map((w) => ({ ...w, date: normalizeDate(w.date) }));
    renderList();
  } catch (err) {
    console.error('[worklog] load failed', err);
    els.list.innerHTML = `
      <p class="empty-message" style="color: var(--danger);">
        ⚠️ Could not load sessions: ${escapeHtml(err.message)}
      </p>
    `;
  }
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

// ============================================================================
// VISIBILITY
// ============================================================================

function updateVisibility() {
  const hasClass = !!activeClassId;
  if (els.noClass) els.noClass.style.display = hasClass ? 'none' : 'block';
  if (els.listCard) els.listCard.style.display = hasClass ? 'block' : 'none';
}

// ============================================================================
// MODAL
// ============================================================================

function openModal(mode = 'new', entry = null) {
  if (!els.modal) return;

  els.form.reset();

  if (mode === 'edit' && entry) {
    editingId = entry.id;
    els.modalTitle.textContent = '✏️ Edit session';
    els.date.value = entry.date || '';
    els.type.value = entry.type || 'trainee';
    els.unit.value = entry.unit || entry.subject || '';
    els.topic.value = entry.topic || '';
    els.duration.value = entry.duration || 1;
    els.sessions.value = entry.sessions || 1;
    els.traineesCount.value = entry.traineesCount || 1;
    els.description.value = entry.description || '';
    els.outcomes.value = entry.outcomes || '';
    els.nextSteps.value = entry.nextSteps || '';
    els.notes.value = entry.notes || '';
    els.submitBtn.textContent = '💾 Update session';

    if (entry.entityId) {
      setTimeout(() => {
        els.trainee.value = entry.entityId;
      }, 50);
    }
  } else {
    editingId = null;
    els.modalTitle.textContent = '➕ Log Session';
    els.submitBtn.textContent = '💾 Save session';
    els.date.value = new Date().toISOString().slice(0, 10);
    if (evidence) evidence.clear();
  }

  updateTraineeVisibility();
  els.modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => els.date && els.date.focus(), 50);
}

function closeModal() {
  if (!els.modal) return;
  els.modal.style.display = 'none';
  document.body.style.overflow = '';
  editingId = null;
  els.form.reset();
  if (evidence) evidence.clear();
}

// ============================================================================
// SUBMIT
// ============================================================================

async function onSubmit(e) {
  e.preventDefault();

  const type = els.type.value;
  const isTrainee = type === 'trainee';
  const traineeId = els.trainee.value;

  if (isTrainee && !traineeId) {
    toast('Please select a trainee', 'error');
    return;
  }

  const traineeName = isTrainee
    ? trainees.find((t) => String(t.id) === String(traineeId))?.name || ''
    : '';

  const payload = {
    classId: activeClassId,
    type,
    entityId: isTrainee ? traineeId : '',
    entityName: isTrainee ? traineeName : '',
    date: els.date.value,
    unit: els.unit.value.trim(),
    subject: els.unit.value.trim(),
    topic: els.topic.value.trim(),
    duration: parseFloat(els.duration.value) || 1,
    sessions: parseInt(els.sessions.value, 10) || 1,
    traineesCount: parseInt(els.traineesCount.value, 10) || 0,
    description: els.description.value.trim(),
    outcomes: els.outcomes.value.trim(),
    nextSteps: els.nextSteps.value.trim(),
    notes: els.notes.value.trim(),
  };

  if (!payload.date || !payload.unit || !payload.topic || !payload.description) {
    toast('Please fill in all required fields', 'error');
    return;
  }

  setFormBusy(true);

  try {
    let saved;
    if (editingId) {
      saved = await api.call('updateWorklog', { id: editingId, patch: payload });
      if (saved && saved.queued) {
        toast('Session update queued — will sync when online', 'info');
      } else {
        toast('Session updated', 'success');
      }
    } else {
      saved = await api.call('createWorklog', payload);
      if (saved && saved.queued) {
        toast('Session queued — will sync when online', 'info');
      } else {
        toast('Session logged', 'success');
      }
    }

    // Skip evidence upload if we're queued — evidence needs a real worklog ID
    if (saved && saved.queued && evidence) {
      evidence.clear();
      closeModal();
      await loadWorklogs();
      return;
    }

    if (evidence) {
      const pending = evidence.getItems().filter((i) => i.status !== 'done');
      if (pending.length) {
        const refId = saved.id || editingId;
        const result = await evidence.uploadAll(refId);
        if (result.failed) {
          toast(`${result.failed} file(s) failed to upload`, 'warning');
        }
      }
    }

    closeModal();
    await loadWorklogs();
  } catch (err) {
    console.error('[worklog] save failed', err);
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    setFormBusy(false);
  }
}

function setFormBusy(busy) {
  if (!els.submitBtn) return;
  els.submitBtn.disabled = busy;
  els.submitBtn.textContent = busy
    ? '⏳ Saving…'
    : editingId
      ? '💾 Update session'
      : '💾 Save session';
}

// ============================================================================
// LIST
// ============================================================================

function renderList() {
  if (!els.list) return;

  const filtered = worklogs.filter((w) => {
    if (!searchQuery) return true;
    return (
      (w.topic || '').toLowerCase().includes(searchQuery) ||
      (w.unit || w.subject || '').toLowerCase().includes(searchQuery) ||
      (w.description || '').toLowerCase().includes(searchQuery)
    );
  });

  if (els.count) els.count.textContent = String(worklogs.length);

  if (!filtered.length) {
    els.list.innerHTML = worklogs.length
      ? `<p class="empty-message">No matches for "${escapeHtml(searchQuery)}".</p>`
      : `<p class="empty-message">No sessions logged yet. Click "Log session" to start.</p>`;
    return;
  }

  filtered.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  els.list.innerHTML = filtered.map(worklogCardHtml).join('');

  els.list.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = worklogs.find((w) => String(w.id) === String(btn.dataset.id));
      if (entry) openModal('edit', entry);
    });
  });

  els.list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id));
  });
}

function worklogCardHtml(w) {
  const date = formatDate(w.date);
  const typeBadges = {
    trainee: '👤 Trainee',
    group: '👥 Group',
    admin: '🗂️ Admin',
  };
  const typeLabel = typeBadges[w.type] || '📝 Session';

  const meta = [
    typeLabel,
    w.entityName && `— ${escapeHtml(w.entityName)}`,
    w.duration && `${w.duration}h`,
    w.sessions && parseInt(w.sessions, 10) > 1 && `${w.sessions} sessions`,
  ]
    .filter(Boolean)
    .join(' · ');

  const desc = w.description
    ? `<div class="item-meta" style="margin-top:6px; opacity:0.85;">${escapeHtml(w.description.slice(0, 140))}${w.description.length > 140 ? '…' : ''}</div>`
    : '';

  return `
    <div class="item-card" data-id="${escapeHtml(w.id)}">
      <div class="item-main">
        <div class="item-title">
          <span>${escapeHtml(w.topic || w.unit || 'Untitled session')}</span>
          <span class="badge neutral" style="font-size: 0.7rem;">${date}</span>
        </div>
        <div class="item-meta">${meta}</div>
        ${desc}
      </div>
      <div class="item-actions">
        <button class="button small secondary" data-action="edit" data-id="${escapeHtml(w.id)}" type="button" title="Edit">✏️</button>
        <button class="button small danger" data-action="delete" data-id="${escapeHtml(w.id)}" type="button" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

async function confirmDelete(id) {
  const entry = worklogs.find((w) => String(w.id) === String(id));
  if (!entry) return;

  if (!confirm(`Delete this session?\n\n"${entry.topic || entry.unit}"\n${formatDate(entry.date)}`))
    return;

  try {
    await api.call('deleteWorklog', { id });
    toast('Session deleted', 'success');
    await loadWorklogs();
  } catch (err) {
    console.error('[worklog] delete failed', err);
    toast(`Delete failed: ${err.message}`, 'error');
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function populateTraineeSelect() {
  if (!els.trainee) return;
  const current = els.trainee.value;

  els.trainee.innerHTML =
    '<option value="">Select a trainee…</option>' +
    trainees
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .map(
        (t) =>
          `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} (${escapeHtml(t.studentId || '')})</option>`
      )
      .join('');

  if (current) els.trainee.value = current;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, {
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
