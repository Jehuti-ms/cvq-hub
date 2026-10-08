// ============================================================================
// src/api/client.js
// Frontend API client — talks to the Apps Script backend.
//
// If APPS_SCRIPT_URL is blank, the client runs in MOCK mode using
// localStorage so you can develop the UI without a live backend.
// ============================================================================

// Paste your /exec URL here once the Apps Script is deployed.
// Leave blank to stay in mock mode.
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyHfRJDq6U24FtMfHihS1ZtEU41hApq9Uw5dWLmze8qYEe-ZemMkxG68D3-FtXxbw3u/exec';
const MOCK = !APPS_SCRIPT_URL;
const MOCK_KEY = 'cvq_mock_db';

// ============================================================================
// OFFLINE QUEUE (IndexedDB)
// ============================================================================

const DB_NAME = 'cvq-offline';
const STORE = 'queue';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueAdd(item) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

async function queueAll() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function queueDelete(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

// ============================================================================
// MOCK BACKEND (localStorage)
// ============================================================================

function mockDB() {
  try {
    return JSON.parse(localStorage.getItem(MOCK_KEY) || '{}');
  } catch {
    return {};
  }
}

function mockSave(db) {
  localStorage.setItem(MOCK_KEY, JSON.stringify(db));
}

function mockHandle(action, body) {
  const db = mockDB();

  // Turn action into a table name: 'listStudents' → 'students'
  const table =
    action.replace(/^(create|update|delete|list)/, '').replace(/^./, (c) => c.toLowerCase()) + 's';

  if (action.startsWith('list')) {
    return db[table] || [];
  }
  if (action.startsWith('create')) {
    db[table] = db[table] || [];
    const record = {
      ...body,
      id: body.id || crypto.randomUUID(),
      createdAt: body.createdAt || new Date().toISOString(),
      teacherId: body.teacherId || 'demo-teacher',
    };
    db[table].push(record);
    mockSave(db);
    return record;
  }
  if (action.startsWith('update')) {
    db[table] = (db[table] || []).map((r) => (r.id === body.id ? { ...r, ...body.patch } : r));
    mockSave(db);
    return db[table].find((r) => r.id === body.id);
  }
  if (action.startsWith('delete')) {
    db[table] = (db[table] || []).filter((r) => r.id !== body.id);
    mockSave(db);
    return true;
  }
  if (action === 'uploadMedia') {
    db.media = db.media || [];
    db.media.push(body);
    mockSave(db);
    return body;
  }

  throw new Error('Mock: unknown action ' + action);
}

// ============================================================================
// PUBLIC API
// ============================================================================

export const api = {
  /** True when running without a real backend URL. */
  isMock: MOCK,

  /**
   * Call the backend with an action and optional body.
   * Automatically queues writes if offline.
   */
  async call(action, body = {}) {
    // ----- Mock mode -----
    if (MOCK) {
      await new Promise((r) => setTimeout(r, 80));
      return mockHandle(action, body);
    }

    // ----- Real mode -----
    const idToken = localStorage.getItem('cvq_idToken');
    if (!idToken) throw new Error('Not authenticated');

    const isWrite = /^(create|update|delete|upload)/.test(action);

    // Offline? Queue writes.
    if (!navigator.onLine && isWrite) {
      const item = {
        id: crypto.randomUUID(),
        action,
        body,
        queuedAt: Date.now(),
      };
      await queueAdd(item);
      return { queued: true, id: item.id };
    }

    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      // text/plain avoids CORS preflight with Apps Script
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, idToken, ...body }),
    });

    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'API error');
    return json.data;
  },

  /** Flush any queued offline writes. Called automatically on reconnect. */
  async flushQueue() {
    if (MOCK) return { synced: 0, total: 0 };

    const items = await queueAll();
    if (!items.length) return { synced: 0, total: 0 };

    const idToken = localStorage.getItem('cvq_idToken');
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'bulkSync',
        idToken,
        items: items.map((it) => ({
          id: it.id,
          action: it.action,
          body: it.body,
        })),
      }),
    });

    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    let synced = 0;
    for (const r of json.data || []) {
      if (r.ok) {
        await queueDelete(r.id);
        synced++;
      }
    }
    return { synced, total: items.length };
  },

  /** Upload an image or video file as evidence. */
  async uploadMedia({ file, refType, refId, classId }) {
    if (MOCK) {
      const url = URL.createObjectURL(file);
      return mockHandle('uploadMedia', {
        id: crypto.randomUUID(),
        fileName: file.name || `${refType}-${Date.now()}`,
        mimeType: file.type,
        url,
        refType,
        refId,
        classId,
        capturedAt: new Date().toISOString(),
      });
    }

    const base64 = await fileToBase64(file);
    return api.call('uploadMedia', {
      id: crypto.randomUUID(),
      fileName: file.name || `${refType}-${Date.now()}.${file.type.split('/')[1]}`,
      mimeType: file.type,
      base64,
      refType,
      refId,
      classId,
      capturedAt: new Date().toISOString(),
    });
  },
};

// ============================================================================
// HELPERS
// ============================================================================

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// AUTO-FLUSH ON RECONNECT
// ============================================================================

window.addEventListener('online', () => {
  api
    .flushQueue()
    .then((r) => {
      if (r.synced) {
        document.dispatchEvent(new CustomEvent('offline-sync-complete', { detail: r }));
      }
    })
    .catch(console.error);
});
