// ============================================================================
// src/ui/tabs/trainees.js
//
// Trainees tab: list, add, edit, delete. Add/edit uses a modal.
// Depends on: src/api/client.js, src/ui/toast.js
// ============================================================================

import { api } from '../../api/client.js';
import { toast } from '../toast.js';
import { getActiveClassId, onClassChange } from '../classModal.js';

// ---------- Module state ----------
let trainees = [];
let editingId = null;
let activeClassId = null;
let searchQuery = '';

// ---------- DOM refs ----------
let els = {};

// ============================================================================
// PUBLIC INIT
// ============================================================================

export async function init() {
  cacheElements();
  if (!els.form) {
    console.warn('[trainees] DOM not found — tab not in this page');
    return;
  }
  wireEvents();
  await refresh();
}

export async function setActiveClass(classId) {
  activeClassId = classId;
  updateVisibility();
  if (classId) await loadTrainees();
}

// ============================================================================
// DOM CACHE
// ============================================================================

function cacheElements() {
  els = {
    count: document.getElementById('traineeCount'),
    noClass: document.getElementById('noClassBanner'),
    listCard: document.getElementById('traineeListCard'),
    list: document.getElementById('traineeList'),
    search: document.getElementById('traineeSearch'),
    addBtn: document.getElementById('addTraineeBtn'),
    createFirstClassBtn: document.getElementById('createFirstClassBtn'),

    // Modal
    modal: document.getElementById('traineeModal'),
    modalTitle: document.getElementById('traineeModalTitle'),
    modalClose: document.getElementById('traineeModalClose'),
    form: document.getElementById('traineeForm'),
    name: document.getElementById('traineeName'),
    studentId: document.getElementById('traineeStudentId'),
    gender: document.getElementById('traineeGender'),
    email: document.getElementById('traineeEmail'),
    phone: document.getElementById('traineePhone'),
    notes: document.getElementById('traineeNotes'),
    submitBtn: document.getElementById('traineeSubmitBtn'),
    cancelBtn: document.getElementById('traineeCancelBtn'),
  };
}

// ============================================================================
// EVENTS
// ============================================================================

function wireEvents() {
  // Form submit
  els.form.addEventListener('submit', onSubmit);

  // Add button → open modal in "new" mode
  if (els.addBtn) els.addBtn.addEventListener('click', () => openModal());
  if (els.createFirstClassBtn) {
    els.createFirstClassBtn.addEventListener('click', async () => {
      const { openCreateModal } = await import('../classModal.js');
      openCreateModal();
    });
  }

  // React to class changes from the picker
  onClassChange(async (cls) => {
    activeClassId = cls ? cls.id : null;
    updateVisibility();
    if (activeClassId) await loadTrainees();
    else if (els.count) els.count.textContent = '0';
  });

  // Modal close paths
  if (els.modalClose) els.modalClose.addEventListener('click', closeModal);
  if (els.cancelBtn) els.cancelBtn.addEventListener('click', closeModal);

  // Click backdrop to close
  if (els.modal) {
    els.modal.addEventListener('click', (e) => {
      if (e.target === els.modal) closeModal();
    });
  }

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modal && els.modal.style.display !== 'none') {
      closeModal();
    }
  });

  // Search (debounced)
  if (els.search) {
    let searchTimer;
    els.search.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderList();
      }, 150);
    });
  }
}

// ============================================================================
// DATA
// ============================================================================

async function refresh() {
  activeClassId = getActiveClassId();
  updateVisibility();
  if (activeClassId) await loadTrainees();
  else if (els.count) els.count.textContent = '0';
}

async function loadTrainees() {
  if (!els.list) return;
  els.list.innerHTML = `<p class="empty-message">Loading…</p>`;

  try {
    const all = await api.call('listStudents');
    trainees = all.filter((t) => String(t.classId) === String(activeClassId));
    renderList();
  } catch (err) {
    console.error('[trainees] load failed', err);
    els.list.innerHTML = `
      <p class="empty-message" style="color: var(--danger);">
        ⚠️ Could not load trainees: ${escapeHtml(err.message)}
      </p>
    `;
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

async function openModal(mode = 'new', trainee = null) {
  if (!els.modal) return;

  els.form.reset();

  if (mode === 'edit' && trainee) {
    editingId = trainee.id;
    els.modalTitle.textContent = `✏️ Edit ${trainee.name}`;
    els.name.value = trainee.name || '';
    els.studentId.value = trainee.studentId || '';
    els.gender.value = trainee.gender || '';
    els.email.value = trainee.email || '';
    els.phone.value = trainee.phone || '';
    els.notes.value = trainee.notes || '';
    els.submitBtn.textContent = '💾 Update trainee';
  } else {
    editingId = null;
    els.modalTitle.textContent = '➕ Add Trainee';
    els.submitBtn.textContent = '💾 Save trainee';

    // Auto-generate trainee ID based on class + year + sequence
    els.studentId.value = await generateTraineeId();
  }

  els.modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Focus first field
  setTimeout(() => els.name && els.name.focus(), 50);
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

  const payload = {
    classId: activeClassId,
    name: els.name.value.trim(),
    studentId: els.studentId.value.trim(),
    gender: els.gender.value,
    email: els.email.value.trim(),
    phone: els.phone.value.trim(),
    notes: els.notes.value.trim(),
  };

  if (!payload.name || !payload.studentId) {
    toast('Name and Trainee ID are required', 'error');
    return;
  }

  setFormBusy(true);

  try {
    if (editingId) {
      await api.call('updateStudent', { id: editingId, patch: payload });
      toast(`Updated ${payload.name}`, 'success');
    } else {
      await api.call('createStudent', payload);
      toast(`Added ${payload.name}`, 'success');
    }
    closeModal();
    await loadTrainees();
  } catch (err) {
    console.error('[trainees] save failed', err);
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    setFormBusy(false);
  }
}

function setFormBusy(busy) {
  if (els.submitBtn) {
    els.submitBtn.disabled = busy;
    els.submitBtn.textContent = busy
      ? '⏳ Saving…'
      : editingId
        ? '💾 Update trainee'
        : '💾 Save trainee';
  }
}

// ============================================================================
// LIST
// ============================================================================

function renderList() {
  if (!els.list) return;

  const filtered = trainees.filter((t) => {
    if (!searchQuery) return true;
    return (
      (t.name || '').toLowerCase().includes(searchQuery) ||
      (t.studentId || '').toLowerCase().includes(searchQuery)
    );
  });

  if (els.count) els.count.textContent = String(trainees.length);

  if (!filtered.length) {
    els.list.innerHTML = trainees.length
      ? `<p class="empty-message">No matches for "${escapeHtml(searchQuery)}".</p>`
      : `<p class="empty-message">No trainees yet. Click "Add trainee" above to start.</p>`;
    return;
  }

  filtered.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  els.list.innerHTML = filtered.map(traineeCardHtml).join('');

  els.list.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = trainees.find((x) => String(x.id) === String(btn.dataset.id));
      if (t) openModal('edit', t);
    });
  });

  els.list.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id));
  });
}

function traineeCardHtml(t) {
  const initial = String(t.name || '?')
    .charAt(0)
    .toUpperCase();
  const meta = [
    t.studentId && `#${escapeHtml(t.studentId)}`,
    t.gender && escapeHtml(t.gender),
    t.email && escapeHtml(t.email),
  ]
    .filter(Boolean)
    .join(' · ');

  return `
    <div class="trainee-card" data-id="${escapeHtml(t.id)}">
      <div class="trainee-avatar">${escapeHtml(initial)}</div>
      <div class="trainee-info">
        <div class="trainee-name">${escapeHtml(t.name)}</div>
        <div class="trainee-meta">${meta || '—'}</div>
      </div>
      <div class="trainee-actions">
        <button class="button small secondary" data-action="edit" data-id="${escapeHtml(t.id)}" type="button" title="Edit">✏️</button>
        <button class="button small danger" data-action="delete" data-id="${escapeHtml(t.id)}" type="button" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

async function confirmDelete(id) {
  const t = trainees.find((x) => String(x.id) === String(id));
  if (!t) return;
  if (!confirm(`Delete ${t.name}?\n\nThis removes them from the current class.`)) return;

  try {
    await api.call('deleteStudent', { id });
    toast(`Deleted ${t.name}`, 'success');
    await loadTrainees();
  } catch (err) {
    console.error('[trainees] delete failed', err);
    toast(`Delete failed: ${err.message}`, 'error');
  }
}

// ============================================================================
// CREATE CLASS
// ============================================================================

async function promptCreateClass() {
  const name = prompt('Class name (e.g., "Cosmetology Level 2"):');
  if (!name || !name.trim()) return;

  const subject = prompt('Subject / area (optional):') || '';

  try {
    const cls = await api.call('createClass', {
      name: name.trim(),
      subject: subject.trim(),
      archived: false,
    });

    localStorage.setItem('cvq_activeClass', cls.id);
    activeClassId = cls.id;

    const classNameEl = document.getElementById('activeClassName');
    if (classNameEl) classNameEl.textContent = cls.name;
    const classPickerBtn = document.getElementById('classPickerBtn');
    if (classPickerBtn) classPickerBtn.classList.remove('empty');

    toast(`Class "${cls.name}" created`, 'success');
    updateVisibility();
    await loadTrainees();
  } catch (err) {
    console.error('[trainees] create class failed', err);
    toast(`Failed to create class: ${err.message}`, 'error');
  }
}

/**
 * Generate a trainee ID like "COS-2025-001" based on the active class.
 * - Prefix: first 3 letters of the class subject (uppercase), or 'TRN' if none.
 * - Year: current year.
 * - Sequence: next number after the highest existing ID in this class.
 */
async function generateTraineeId() {
  // Get the active class to determine the prefix
  let prefix = 'TRN';
  try {
    const classes = await api.call('listClasses');
    const cls = classes.find((c) => String(c.id) === String(activeClassId));
    if (cls && cls.subject) {
      // "Cosmetology" → "COS", "Math" → "MAT"
      prefix =
        cls.subject
          .replace(/[^A-Za-z]/g, '')
          .slice(0, 3)
          .toUpperCase() || 'TRN';
    } else if (cls && cls.name) {
      // Fall back to class name if subject is missing
      prefix =
        cls.name
          .replace(/[^A-Za-z]/g, '')
          .slice(0, 3)
          .toUpperCase() || 'TRN';
    }
  } catch (e) {
    console.warn('[trainees] could not load class for ID prefix', e);
  }

  const year = new Date().getFullYear();

  // Find highest existing sequence number for this prefix+year
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let maxSeq = 0;
  trainees.forEach((t) => {
    const m = String(t.studentId || '').match(pattern);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  });

  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `${prefix}-${year}-${nextSeq}`;
}

// ============================================================================
// UTILITY
// ============================================================================

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
