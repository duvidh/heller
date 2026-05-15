// UI utilities: modal, toast, formatting

export const fmt = {
  money(n) {
    const v = Number(n) || 0;
    return '₪' + v.toLocaleString('he-IL', { maximumFractionDigits: 2 });
  },
  number(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('he-IL', { maximumFractionDigits: 2 });
  },
  date(d) {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },
  dateInput(d) {
    if (!d) return '';
    const dt = new Date(d);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },
  initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2);
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  },
};

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'g',
  'polyline', 'polygon', 'ellipse', 'text', 'defs',
  'linearGradient', 'radialGradient', 'stop', 'use',
]);

export function el(tag, props = {}, ...children) {
  const isSvg = SVG_TAGS.has(tag);
  const node = isSvg
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

/* --------- Toast --------- */
let toastTimer;
export function toast(message, type = '') {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = 'toast';
  if (type) t.classList.add(type);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

/* --------- Modal --------- */
const backdrop = () => document.getElementById('modal-backdrop');
const modalEl = () => document.getElementById('modal');
const titleEl = () => document.getElementById('modal-title');
const bodyEl = () => document.getElementById('modal-body');

let onCloseHandler = null;

export function openModal({ title, body, large = false, onClose }) {
  titleEl().textContent = title;
  const b = bodyEl();
  b.innerHTML = '';
  if (typeof body === 'string') b.innerHTML = body;
  else if (body instanceof Node) b.appendChild(body);
  else if (Array.isArray(body)) body.forEach(n => b.appendChild(n));

  modalEl().classList.toggle('large', !!large);
  backdrop().classList.add('show');
  onCloseHandler = onClose || null;
  document.body.style.overflow = 'hidden';
}

export function closeModal() {
  backdrop().classList.remove('show');
  document.body.style.overflow = '';
  if (onCloseHandler) { try { onCloseHandler(); } catch {} }
  onCloseHandler = null;
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal-close' || e.target.closest('#modal-close')) closeModal();
  if (e.target.id === 'modal-backdrop') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && backdrop().classList.contains('show')) closeModal();
});

export function confirmDialog({ title = 'אישור', message, confirmLabel = 'אשר', danger = false }) {
  return new Promise((resolve) => {
    const wrap = el('div', {},
      el('p', { style: 'margin:4px 0 16px; color: var(--text-2); font-size: 15px;' }, message),
      el('div', { class: 'modal-footer' },
        el('button', { class: 'btn btn-secondary', onclick: () => { closeModal(); resolve(false); } }, 'ביטול'),
        el('button', {
          class: danger ? 'btn btn-danger' : 'btn btn-primary',
          onclick: () => { closeModal(); resolve(true); }
        }, confirmLabel),
      )
    );
    openModal({ title, body: wrap, onClose: () => resolve(false) });
  });
}

/* --------- Categories utilities --------- */
export function getCategoryMeta(productCategories, name) {
  const c = (productCategories || []).find(x => x.name === name);
  return c || { name, icon: '📦', color: '#64748b' };
}

/* --------- Period filter pill --------- */
const PERIOD_OPTIONS = [
  { type: 'currentMonth', label: 'החודש' },
  { type: 'lastMonth', label: 'חודש שעבר' },
  { type: 'currentYear', label: 'השנה' },
  { type: 'all', label: 'הכל' },
];

export function renderPeriodFilter(currentPeriod, onChange) {
  const wrap = el('div', { class: 'period-filter' });
  PERIOD_OPTIONS.forEach(opt => {
    const isActive = currentPeriod.type === opt.type;
    wrap.appendChild(el('button', {
      class: 'period-pill' + (isActive ? ' active' : ''),
      onclick: () => onChange({ type: opt.type }),
    }, opt.label));
  });
  return wrap;
}

export function categorySwatch(meta) {
  const bg = meta.color + '24';
  return el('div', {
    class: 'ico',
    style: { background: bg, color: meta.color }
  }, meta.icon || '📦');
}
