// ============================================================================
// src/ui/classModal.js
//
// Handles class creation, editing, deletion, and the class picker dropdown.
// Single source of truth for "which class is active".
// ============================================================================

import { api } from '../api/client.js';
import { toast } from './toast.js';

const ACTIVE_KEY = 'cvq_activeClass';

// ---------- Module state ----------
let classes = [];
let activeClassId = null;
let editingId = null;
let els = {};

// Listeners for other modules (trainees.js, worklog.js) to react to class changes
const listeners = new Set();

// ============================================================================
// PUBLIC API
// ============================================================================

export function getActiveClassId() {
  return activeClassId;
}

export function getActiveClass() {
  return classes.find((c) => String(c.id) === String(activeClassId)) || null;
}

export function onClassChange(fn) {
  listeners.add(fn);
}

export async function init() {
  cacheElements();
  wireEvents();

  await refresh();
  await checkFirstRun();
}

// ============================================================================
// DOM CACHE
// ============================================================================

function cacheElements() {
  els = {
    // Class bar
    pickerBtn: document.getElementById('classPickerBtn'),
    activeName: document.getElementById('activeClassName'),
    classMeta: document.getElementById('classMeta'),
    dropdown: document.getElementById('classDropdown'),
    dropdownList: document.getElementById('classDropdownList'),
    dropdownNew: document.getElementById('classDropdownNew'),
    dropdownEdit: document.getElementById('classDropdownEdit'),
    dropdownDelete: document.getElementById('classDropdownDelete'),

    // Class modal
    modal: document.getElementById('classModal'),
    modalTitle: document.getElementById('classModalTitle'),
    modalClose: document.getElementById('classModalClose'),
    form: document.getElementById('classForm'),
    name: document.getElementById('className'),
    subject: document.getElementById('classSubject'),
    description: document.getElementById('classDescription'),
    submitBtn: document.getElementById('classSubmitBtn'),
    cancelBtn: document.getElementById('classCancelBtn'),

    // Onboarding
    onboarding: document.getElementById('onboardingModal'),
    onboardingForm: document.getElementById('onboardingForm'),
    onboardingName: document.getElementById('onboardingClassName'),
    onboardingSubj: document.getElementById('onboardingSubject'),
    onboardingBtn: document.getElementById('onboardingSubmitBtn'),
  };
}

// ============================================================================
// EVENTS
// ============================================================================

function wireEvents() {
  // Picker dropdown
  if (els.pickerBtn) {
    els.pickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });
  }

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (els.dropdown && !els.dropdown.contains(e.target) && e.target !== els.pickerBtn) {
      closeDropdown();
    }
  });

  // Dropdown items
  if (els.dropdownNew)
    els.dropdownNew.addEventListener('click', () => {
      closeDropdown();
      openModal('new');
    });
  if (els.dropdownEdit)
    els.dropdownEdit.addEventListener('click', () => {
      closeDropdown();
      openModal('edit');
    });
  if (els.dropdownDelete)
    els.dropdownDelete.addEventListener('click', () => {
      closeDropdown();
      confirmDelete();
    });

  // Class modal
  if (els.form) els.form.addEventListener('submit', onSubmit);
  if (els.modalClose) els.modalClose.addEventListener('click', closeModal);
  if (els.cancelBtn) els.cancelBtn.addEventListener('click', closeModal);
  if (els.modal) {
    els.modal.addEventListener('click', (e) => {
      if (e.target === els.modal) closeModal();
    });
  }

  // Onboarding form
  if (els.onboardingForm) els.onboardingForm.addEventListener('submit', onOnboardingSubmit);

  // Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (els.dropdown && els.dropdown.classList.contains('open')) closeDropdown();
      if (els.modal && els.modal.style.display !== 'none') closeModal();
    }
  });
}

// ============================================================================
// DATA
// ============================================================================

async function refresh() {
  try {
    classes = await api.call('listClasses');
  } catch (err) {
    console.warn('[classModal] could not load classes', err);
    classes = [];
  }

  // Restore active class
  activeClassId = localStorage.getItem(ACTIVE_KEY);

  // Verify it still exists — if not, pick the first one (or none)
  if (activeClassId && !classes.some((c) => String(c.id) === String(activeClassId))) {
    activeClassId = null;
    localStorage.removeItem(ACTIVE_KEY);
  }

  if (!activeClassId && classes.length) {
    activeClassId = classes[0].id;
    localStorage.setItem(ACTIVE_KEY, activeClassId);
  }

  render();
  notifyListeners();
}

function render() {
  const active = getActiveClass();

  // Update the class bar
  if (active) {
    if (els.activeName) els.activeName.textContent = active.name;
    if (els.pickerBtn) els.pickerBtn.classList.remove('empty');
    if (els.classMeta) {
      const count = ''; // we don't have trainee count here — leave empty for now
      els.classMeta.textContent = active.subject ? `${active.subject}` : '';
    }
  } else {
    if (els.activeName) els.activeName.textContent = 'No class selected';
    if (els.pickerBtn) els.pickerBtn.classList.add('empty');
    if (els.classMeta) els.classMeta.textContent = '';
  }

  // Show/hide dropdown edit/delete
  if (els.dropdownEdit) els.dropdownEdit.style.display = active ? 'flex' : 'none';
  if (els.dropdownDelete) els.dropdownDelete.style.display = active ? 'flex' : 'none';

  // Render dropdown list
  renderDropdownList();
}

function renderDropdownList() {
  if (!els.dropdownList) return;

  if (!classes.length) {
    els.dropdownList.innerHTML = `<div class="class-dropdown-empty">No classes yet. Create one below.</div>`;
    return;
  }

  els.dropdownList.innerHTML = classes
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((c) => {
      const isActive = String(c.id) === String(activeClassId);
      return `
        <button class="class-dropdown-item${isActive ? ' active' : ''}" data-class-id="${escapeHtml(c.id)}" type="button">
          <span>📚</span>
          <span>${escapeHtml(c.name)}</span>
        </button>
      `;
    })
    .join('');

  els.dropdownList.querySelectorAll('[data-class-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.classId;
      setActiveClass(id);
      closeDropdown();
    });
  });
}

function setActiveClass(id) {
  activeClassId = id;
  localStorage.setItem(ACTIVE_KEY, id);
  render();
  notifyListeners();
}

function notifyListeners() {
  const active = getActiveClass();
  listeners.forEach((fn) => {
    try {
      fn(active);
    } catch (e) {
      console.error('[classModal] listener error', e);
    }
  });
}

// ============================================================================
// DROPDOWN
// ============================================================================

function toggleDropdown() {
  if (!els.dropdown) return;
  if (els.dropdown.classList.contains('open')) {
    closeDropdown();
  } else {
    els.dropdown.classList.add('open');
    if (els.pickerBtn) els.pickerBtn.setAttribute('aria-expanded', 'true');
  }
}

function closeDropdown() {
  if (!els.dropdown) return;
  els.dropdown.classList.remove('open');
  if (els.pickerBtn) els.pickerBtn.setAttribute('aria-expanded', 'false');
}

// ============================================================================
// CLASS MODAL (create + edit)
// ============================================================================

function openModal(mode = 'new', cls = null) {
  if (!els.modal) return;

  els.form.reset();

  if (mode === 'edit') {
    const active = cls || getActiveClass();
    if (!active) return;
    editingId = active.id;
    els.modalTitle.textContent = '✏️ Edit class';
    els.name.value = active.name || '';
    els.subject.value = active.subject || '';
    els.description.value = active.description || '';
    els.submitBtn.textContent = '💾 Update class';
  } else {
    editingId = null;
    els.modalTitle.textContent = '➕ Create a class';
    els.submitBtn.textContent = '💾 Save class';
  }

  els.modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => els.name && els.name.focus(), 50);
}

function closeModal() {
  if (!els.modal) return;
  els.modal.style.display = 'none';
  document.body.style.overflow = '';
  editingId = null;
  els.form.reset();
}

async function onSubmit(e) {
  e.preventDefault();

  const payload = {
    name: els.name.value.trim(),
    subject: els.subject.value.trim(),
    description: els.description.value.trim(),
  };

  if (!payload.name) {
    toast('Class name is required', 'error');
    return;
  }

  setFormBusy(true);

  try {
    let saved;
    if (editingId) {
      saved = await api.call('updateClass', { id: editingId, patch: payload });
      toast(`Updated "${payload.name}"`, 'success');
    } else {
      saved = await api.call('createClass', { ...payload, archived: false });
      toast(`Created "${payload.name}"`, 'success');
      // Switch to the new class
      activeClassId = saved.id;
      localStorage.setItem(ACTIVE_KEY, saved.id);
    }

    closeModal();
    await refresh();
  } catch (err) {
    console.error('[classModal] save failed', err);
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    setFormBusy(false);
  }
}

function setFormBusy(busy) {
  if (!els.submitBtn) return;
  els.submitBtn.disabled = busy;
  els.submitBtn.textContent = busy ? '⏳ Saving…' : editingId ? '💾 Update class' : '💾 Save class';
}

async function confirmDelete() {
  const active = getActiveClass();
  if (!active) return;

  const ok = confirm(
    `Delete class "${active.name}"?\n\nThis will not delete its trainees — ` +
      `they will be left unassigned until you add them to another class.`
  );
  if (!ok) return;

  try {
    await api.call('deleteClass', { id: active.id });
    toast(`Deleted "${active.name}"`, 'success');

    // Clear active class
    activeClassId = null;
    localStorage.removeItem(ACTIVE_KEY);

    await refresh();
  } catch (err) {
    console.error('[classModal] delete failed', err);
    toast(`Delete failed: ${err.message}`, 'error');
  }
}

// ============================================================================
// ONBOARDING (first-run experience)
// ============================================================================

async function checkFirstRun() {
  // If no classes exist and the user hasn't dismissed onboarding, show it
  const dismissed = localStorage.getItem('cvq_onboardingDone');
  if (classes.length === 0 && !dismissed) {
    // Small delay so the page settles before the modal appears
    setTimeout(() => {
      if (els.onboarding) {
        els.onboarding.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        setTimeout(() => els.onboardingName && els.onboardingName.focus(), 100);
      }
    }, 400);
  }
}

async function onOnboardingSubmit(e) {
  e.preventDefault();

  const name = els.onboardingName.value.trim();
  const subject = els.onboardingSubj.value.trim();

  if (!name) {
    toast('Please enter a class name', 'error');
    return;
  }

  if (els.onboardingBtn) {
    els.onboardingBtn.disabled = true;
    els.onboardingBtn.textContent = '⏳ Creating…';
  }

  try {
    const cls = await api.call('createClass', {
      name,
      subject,
      description: '',
      archived: false,
    });

    // Mark onboarding complete
    localStorage.setItem('cvq_onboardingDone', 'true');
    activeClassId = cls.id;
    localStorage.setItem(ACTIVE_KEY, cls.id);

    // Close modal
    els.onboarding.style.display = 'none';
    document.body.style.overflow = '';

    toast(`Welcome! Class "${name}" created.`, 'success');

    await refresh();
  } catch (err) {
    console.error('[classModal] onboarding failed', err);
    toast(`Failed: ${err.message}`, 'error');
  } finally {
    if (els.onboardingBtn) {
      els.onboardingBtn.disabled = false;
      els.onboardingBtn.textContent = 'Get started →';
    }
  }
}

// ============================================================================
// HELPERS
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

export function openCreateModal() {
  openModal('new');
}
