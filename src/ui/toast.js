// ============================================================================
// src/ui/toast.js
// Simple toast notification system. Auto-creates the container.
// ============================================================================

let toastNode = null;
let toastTimer = null;

function ensureToastNode() {
  if (toastNode && document.body.contains(toastNode)) return toastNode;

  toastNode = document.createElement('div');
  toastNode.className = 'toast';
  document.body.appendChild(toastNode);
  return toastNode;
}

export function toast(message, type = 'default') {
  const node = ensureToastNode();
  node.textContent = message;

  const colors = {
    default: 'var(--text)',
    success: 'var(--success)',
    error: 'var(--danger)',
    warning: 'var(--warning)',
    info: 'var(--info)',
  };
  node.style.background = colors[type] || colors.default;

  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3000);
}
