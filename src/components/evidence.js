// ============================================================================
// src/components/evidence.js
//
// Evidence capture widget. Attaches to any container.
// Lets the user take photos, record videos, or pick files.
// Files queue locally, then upload after the parent record is created.
// ============================================================================

import { api } from '../api/client.js';
import { toast } from '../ui/toast.js';

export function createEvidenceCapture(container, options = {}) {
  if (!container) throw new Error('Evidence: container required');

  const { refType = 'worklog', refId = null, classId = null } = options;

  const items = [];

  container.innerHTML = `
    <div class="evidence-capture">
      <div class="evidence-actions">
        <button type="button" class="button small" data-act="camera">
          📷 Take photo
        </button>
        <button type="button" class="button small" data-act="video">
          🎥 Record video
        </button>
        <button type="button" class="button small" data-act="file">
          📁 Choose file
        </button>
      </div>

      <input type="file" accept="image/*" capture="environment" hidden data-input="camera">
      <input type="file" accept="video/*" capture="environment" hidden data-input="video">
      <input type="file" accept="image/*,video/*" hidden data-input="file" multiple>

      <div class="evidence-grid" data-grid></div>
      <div class="evidence-status" data-status></div>
    </div>
  `;

  const grid = container.querySelector('[data-grid]');
  const status = container.querySelector('[data-status]');

  container.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      const input = container.querySelector(`[data-input="${act}"]`);
      if (input) input.click();
    });
  });

  container.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      files.forEach(addFile);
      input.value = '';
    });
  });

  function addFile(file) {
    if (!file) return;

    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      toast(`File too large (max 50 MB): ${file.name}`, 'error');
      return;
    }

    const item = {
      id: crypto.randomUUID(),
      file,
      localUrl: URL.createObjectURL(file),
      status: 'pending',
    };
    items.push(item);
    renderItem(item);
    updateStatus();
  }

  function renderItem(item) {
    const card = document.createElement('div');
    card.className = 'evidence-card pending';
    card.dataset.evidenceId = item.id;

    const isVideo = item.file.type.startsWith('video');
    const isImage = item.file.type.startsWith('image');

    card.innerHTML = isVideo
      ? `<video src="${item.localUrl}" muted playsinline></video><div class="badge">Pending</div>`
      : isImage
        ? `<img src="${item.localUrl}" alt=""><div class="badge">Pending</div>`
        : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:.75rem;text-align:center;padding:6px;">📎<br>${escapeHtml(item.file.name).slice(0, 20)}</div><div class="badge">Pending</div>`;

    grid.appendChild(card);
    item.el = card;
  }

  function updateStatus() {
    const total = items.length;
    const done = items.filter((i) => i.status === 'done').length;
    const pending = items.filter((i) => i.status === 'pending' || i.status === 'uploading').length;
    const errs = items.filter((i) => i.status === 'error').length;

    if (!total) {
      status.textContent = '';
      return;
    }

    const parts = [];
    if (done) parts.push(`${done} saved`);
    if (pending) parts.push(`${pending} pending`);
    if (errs) parts.push(`${errs} failed`);
    status.textContent = parts.join(' · ');
  }

  function setItemStatus(item, s, errMsg = '') {
    item.status = s;
    if (!item.el) return;

    item.el.classList.remove('pending', 'error');
    if (s === 'pending') item.el.classList.add('pending');
    if (s === 'error') item.el.classList.add('error');

    const badge = item.el.querySelector('.badge');
    if (!badge) return;

    const labels = {
      pending: 'Pending',
      uploading: 'Uploading…',
      done: '✓ Saved',
      error: errMsg ? '✗ ' + errMsg.slice(0, 24) : '✗ Failed',
    };
    badge.textContent = labels[s] || s;
  }

  return {
    async uploadAll(overrideRefId = null) {
      const ref = overrideRefId || refId;
      if (!ref) {
        if (items.length) {
          console.warn('[evidence] No refId provided — skipping upload');
          items.forEach((it) => setItemStatus(it, 'error', 'No ref'));
        }
        return { uploaded: 0, failed: 0 };
      }

      let uploaded = 0;
      let failed = 0;

      for (const item of items) {
        if (item.status === 'done') continue;

        setItemStatus(item, 'uploading');

        try {
          const record = await api.uploadMedia({
            file: item.file,
            refType,
            refId: ref,
            classId,
          });

          item.remoteId = record.id;
          item.remoteUrl = record.url;
          setItemStatus(item, 'done');
          uploaded++;
        } catch (err) {
          console.error('[evidence] upload failed', err);
          setItemStatus(item, 'error', err.message);
          failed++;
        }
      }

      updateStatus();
      return { uploaded, failed };
    },

    getItems() {
      return items.map((it) => ({
        id: it.id,
        name: it.file.name,
        type: it.file.type,
        size: it.file.size,
        status: it.status,
        remoteId: it.remoteId,
        remoteUrl: it.remoteUrl,
      }));
    },

    clear() {
      items.forEach((it) => URL.revokeObjectURL(it.localUrl));
      items.length = 0;
      grid.innerHTML = '';
      updateStatus();
    },
  };

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
}
