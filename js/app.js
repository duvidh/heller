// Main application controller
import { db, registerUser, loginUser, getSession, clearSession } from './storage.js';
import { UNITS, INCOME_SOURCES } from './data.js';
import { fmt, $, $$, el, toast, openModal, closeModal, confirmDialog, getCategoryMeta, categorySwatch } from './ui.js';

/* ===========================================================
   App state
   =========================================================== */
const state = {
  user: null,
  tab: 'dashboard',
  shoppingFilter: { search: '', category: '' },
};

/* ===========================================================
   Authentication flow
   =========================================================== */
function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
}
function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderAll();
}

function authError(msg) {
  const e = $('#auth-error');
  e.textContent = msg;
  e.classList.add('show');
  setTimeout(() => e.classList.remove('show'), 4000);
}

document.addEventListener('DOMContentLoaded', () => {
  // Auth tabs
  $$('.auth-tab').forEach(btn => btn.addEventListener('click', () => {
    $$('.auth-tab').forEach(b => b.classList.toggle('active', b === btn));
    const target = btn.dataset.authTab;
    $$('.auth-form').forEach(f => f.classList.toggle('active', f.id === `${target}-form`));
  }));

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const user = await loginUser({
        username: $('#login-username').value,
        password: $('#login-password').value,
      });
      state.user = user;
      showApp();
      toast('ברוך הבא, ' + user.name, 'success');
    } catch (err) { authError(err.message); }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const user = await registerUser({
        username: $('#register-username').value,
        password: $('#register-password').value,
        name: $('#register-name').value,
      });
      await loginUser({
        username: $('#register-username').value,
        password: $('#register-password').value,
      });
      state.user = user;
      showApp();
      toast('נרשמת בהצלחה, ברוך הבא!', 'success');
    } catch (err) { authError(err.message); }
  });

  // Nav
  $$('.nav-item, .bottom-nav-item').forEach(b => b.addEventListener('click', () => {
    switchTab(b.dataset.tab);
    closeMobileNav();
  }));

  // Mobile menu
  $('#menu-btn')?.addEventListener('click', toggleMobileNav);
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('sidebar-backdrop')) closeMobileNav();
  });

  // Logout
  $('#logout-btn')?.addEventListener('click', logout);
  $('#mobile-logout')?.addEventListener('click', logout);

  // Quick action: stat card "go" buttons
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) switchTab(go.dataset.go);
  });

  // Initialize session
  const session = getSession();
  if (session) {
    state.user = session;
    showApp();
  } else {
    showAuth();
  }

  // Add buttons
  $('#add-shopping-item').addEventListener('click', () => openItemModal());
  $('#shopping-search').addEventListener('input', (e) => {
    state.shoppingFilter.search = e.target.value;
    renderShopping();
  });
  $('#shopping-filter-category').addEventListener('change', (e) => {
    state.shoppingFilter.category = e.target.value;
    renderShopping();
  });

  $('#new-weekly').addEventListener('click', () => openWeeklyModal());
  $('#add-budget-cat').addEventListener('click', () => openBudgetCategoryModal());
  $('#add-income').addEventListener('click', () => openIncomeModal());
  $('#add-product-category').addEventListener('click', () => openProductCategoryModal());
});

function logout() {
  clearSession();
  state.user = null;
  showAuth();
  $('#login-username').value = '';
  $('#login-password').value = '';
}

function toggleMobileNav() {
  const s = $('.sidebar');
  s.classList.toggle('open');
  let backdrop = document.querySelector('.sidebar-backdrop');
  if (!backdrop) {
    backdrop = el('div', { class: 'sidebar-backdrop' });
    document.body.appendChild(backdrop);
  }
  backdrop.classList.toggle('show', s.classList.contains('open'));
}
function closeMobileNav() {
  $('.sidebar')?.classList.remove('open');
  document.querySelector('.sidebar-backdrop')?.classList.remove('show');
}

/* ===========================================================
   Tab switching
   =========================================================== */
function switchTab(name) {
  state.tab = name;
  $$('.page').forEach(p => p.classList.toggle('hidden', p.id !== `page-${name}`));
  $$('.nav-item, .bottom-nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  const titles = {
    dashboard: 'לוח בקרה',
    shopping: 'רשימת קניות',
    weekly: 'קניות שבועיות',
    budget: 'תקציב חודשי',
    income: 'הכנסות',
    categories: 'קטגוריות',
  };
  $('#mobile-page-title').textContent = titles[name] || '';
  renderCurrent();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ===========================================================
   Render dispatch
   =========================================================== */
function renderAll() {
  // User info in sidebar
  $('#user-name').textContent = state.user.name;
  $('#user-avatar').textContent = fmt.initials(state.user.name);
  $('#dashboard-greeting').textContent = state.user.name;

  populateCategoryFilter();
  renderCurrent();
}

function renderCurrent() {
  switch (state.tab) {
    case 'dashboard': renderDashboard(); break;
    case 'shopping': renderShopping(); break;
    case 'weekly': renderWeekly(); break;
    case 'budget': renderBudget(); break;
    case 'income': renderIncome(); break;
    case 'categories': renderProductCategories(); break;
  }
}

/* ===========================================================
   Dashboard
   =========================================================== */
function renderDashboard() {
  const incomes = db.getIncome();
  const totalIncome = incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const tithe = incomes.reduce((s, i) => s + ((Number(i.amount) || 0) * 0.1), 0);
  const titheSet = incomes.filter(i => i.titheSet).reduce((s, i) => s + ((Number(i.amount) || 0) * 0.1), 0);

  const budgetTotal = computeBudgetTotal();
  const balance = totalIncome - budgetTotal;

  $('#stat-income').textContent = fmt.money(totalIncome);
  $('#stat-income-meta').textContent = `${incomes.length} רשומות`;
  $('#stat-budget').textContent = fmt.money(budgetTotal);
  $('#stat-balance').textContent = fmt.money(balance);
  $('#stat-balance').style.color = balance >= 0 ? '#34d399' : '#fca5a5';
  $('#stat-tithe').textContent = fmt.money(tithe);
  $('#stat-tithe-meta').textContent = `הופרש: ${fmt.money(titheSet)}`;

  // Budget chart
  const chart = $('#budget-chart');
  chart.innerHTML = '';
  const cats = db.getBudget().map(c => ({ ...c, total: computeCategoryBudgetTotal(c) }));
  const maxVal = Math.max(...cats.map(c => c.total), 1);
  if (cats.length === 0) {
    chart.appendChild(emptyState('📊', 'אין נתוני תקציב', 'הוסף קטגוריות בעמוד התקציב'));
  } else {
    cats.sort((a, b) => b.total - a.total).slice(0, 8).forEach(c => {
      const pct = (c.total / maxVal) * 100;
      chart.appendChild(el('div', { class: 'bar-row' },
        el('span', { class: 'label' }, `${c.icon || '📦'} ${c.name}`),
        el('span', { class: 'bar' }, el('span', { style: { width: pct + '%', background: gradFor(c.color) } })),
        el('span', { class: 'val' }, fmt.money(c.total)),
      ));
    });
  }

  // Recent weeklies
  const weeklyEl = $('#recent-weeklies');
  weeklyEl.innerHTML = '';
  const weeklies = db.getWeekly().slice(0, 5);
  if (weeklies.length === 0) {
    weeklyEl.appendChild(emptyState('🛍️', 'אין קניות שבועיות', 'התחל קנייה שבועית חדשה'));
  } else {
    weeklies.forEach(w => {
      const total = weeklyTotal(w);
      weeklyEl.appendChild(el('div', { class: 'recent-item' },
        el('div', { class: 'left' },
          el('div', {}, el('div', { class: 'name' }, w.name || 'קנייה שבועית'),
                       el('div', { class: 'meta' }, `${fmt.date(w.createdAt)} • ${w.items?.length || 0} פריטים`)),
        ),
        el('div', { class: 'amount' }, fmt.money(total)),
      ));
    });
    // Grand total
    const grand = weeklies.reduce((s, w) => s + weeklyTotal(w), 0);
    weeklyEl.appendChild(el('div', { class: 'recent-item', style: { background: 'var(--grad-card)' } },
      el('div', { class: 'left' }, el('div', { class: 'name' }, 'סה"כ כל הקניות השבועיות')),
      el('div', { class: 'amount positive' }, fmt.money(db.getWeekly().reduce((s, w) => s + weeklyTotal(w), 0))),
    ));
  }

  // Recent incomes
  const incEl = $('#recent-incomes');
  incEl.innerHTML = '';
  const recIncomes = incomes.slice(0, 6);
  if (recIncomes.length === 0) {
    incEl.appendChild(emptyState('💰', 'אין הכנסות', 'הוסף הכנסה ראשונה'));
  } else {
    recIncomes.forEach(i => {
      incEl.appendChild(el('div', { class: 'recent-item' },
        el('div', { class: 'left' },
          el('div', {}, el('div', { class: 'name' }, i.source || 'הכנסה'),
                       el('div', { class: 'meta' }, fmt.date(i.date || i.createdAt))),
        ),
        el('div', { class: 'amount positive' }, '+' + fmt.money(i.amount)),
      ));
    });
  }
}

function gradFor(color) {
  if (!color) return 'var(--grad-primary)';
  return `linear-gradient(90deg, ${color} 0%, ${color}b0 100%)`;
}

function emptyState(icon, title, desc) {
  return el('div', { class: 'empty-state' },
    el('div', { class: 'icon' }, icon),
    el('h4', {}, title),
    el('p', {}, desc),
  );
}

/* ===========================================================
   Shopping list
   =========================================================== */
function populateCategoryFilter() {
  const sel = $('#shopping-filter-category');
  const cats = db.getProductCategories();
  sel.innerHTML = '<option value="">כל הקטגוריות</option>' +
    cats.map(c => `<option value="${c.name}">${c.icon || ''} ${c.name}</option>`).join('');
}

function renderShopping() {
  populateCategoryFilter();
  $('#shopping-filter-category').value = state.shoppingFilter.category;

  const items = db.getItems();
  const productCats = db.getProductCategories();

  // Category totals strip
  const totalsEl = $('#category-totals');
  totalsEl.innerHTML = '';
  const totalsByCat = {};
  items.forEach(it => {
    totalsByCat[it.productCategory] = (totalsByCat[it.productCategory] || 0) + (Number(it.total) || 0);
  });
  productCats.forEach(c => {
    if (totalsByCat[c.name] == null) return;
    totalsEl.appendChild(el('div', {
      class: 'cat-total-card',
      onclick: () => { state.shoppingFilter.category = c.name; renderShopping(); }
    },
      categorySwatch(c),
      el('div', {},
        el('div', { class: 'name' }, c.name),
        el('div', { class: 'val' }, fmt.money(totalsByCat[c.name] || 0)),
      ),
    ));
  });

  // Filter
  let filtered = items;
  if (state.shoppingFilter.category) {
    filtered = filtered.filter(i => i.productCategory === state.shoppingFilter.category);
  }
  if (state.shoppingFilter.search) {
    const q = state.shoppingFilter.search.trim().toLowerCase();
    filtered = filtered.filter(i => (i.name || '').toLowerCase().includes(q));
  }

  // Group by category
  const groups = {};
  filtered.forEach(it => {
    (groups[it.productCategory] = groups[it.productCategory] || []).push(it);
  });

  const list = $('#shopping-list');
  list.innerHTML = '';
  const catOrder = productCats.map(c => c.name).concat(Object.keys(groups).filter(c => !productCats.some(p => p.name === c)));
  let hasAny = false;
  catOrder.forEach(catName => {
    const groupItems = groups[catName];
    if (!groupItems || groupItems.length === 0) return;
    hasAny = true;
    const meta = getCategoryMeta(productCats, catName);
    const groupTotal = groupItems.reduce((s, i) => s + (Number(i.total) || 0), 0);

    const group = el('div', { class: 'cat-group' });
    group.appendChild(el('div', { class: 'cat-group-header' },
      categorySwatch(meta),
      el('div', { class: 'info' },
        el('div', { class: 'title' }, meta.name),
        el('div', { class: 'count' }, `${groupItems.length} מוצרים`),
      ),
      el('div', { class: 'total' }, fmt.money(groupTotal)),
    ));
    groupItems.forEach(it => {
      group.appendChild(el('div', { class: 'item-row' },
        el('div', { class: 'name' }, it.name,
          el('div', { class: 'unit-info' }, `${it.unit || 'יחידה'}`)),
        el('div', { class: 'qty' },
          el('span', { class: 'col-label' }, 'שבועי:'),
          fmt.number(it.weeklyQty) + ''),
        el('div', { class: 'qty' },
          el('span', { class: 'col-label' }, 'חודשי:'),
          fmt.number(it.monthlyQty) + ''),
        el('div', { class: 'price' },
          el('span', { class: 'col-label' }, 'מחיר:'),
          fmt.money(it.price)),
        el('div', { class: 'total' }, fmt.money(it.total)),
        el('div', { class: 'actions' },
          el('button', { onclick: () => openItemModal(it), title: 'ערוך' },
            el('svg', { viewBox: '0 0 24 24', width: 16, height: 16, html: '<path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>' })),
          el('button', { class: 'del', onclick: () => deleteItem(it), title: 'מחק' },
            el('svg', { viewBox: '0 0 24 24', width: 16, height: 16, html: '<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' })),
        ),
      ));
    });
    list.appendChild(group);
  });
  if (!hasAny) {
    list.appendChild(emptyState('🛒', 'לא נמצאו מוצרים', 'נסה לשנות חיפוש או להוסיף מוצר'));
  }

  // Sync budget categories with shopping totals
  syncBudgetWithShopping();
}

function deleteItem(it) {
  confirmDialog({
    title: 'מחיקת מוצר',
    message: `למחוק את "${it.name}"?`,
    confirmLabel: 'מחק',
    danger: true,
  }).then(ok => {
    if (!ok) return;
    db.deleteItem(it.id);
    toast('המוצר נמחק');
    renderShopping();
    renderDashboard();
  });
}

function openItemModal(item) {
  const isEdit = !!item;
  const productCats = db.getProductCategories();
  const budgetCats = db.getBudget();

  const form = el('form', { class: 'modal-form', style: 'display:flex; flex-direction:column; gap:14px;' });

  const nameInp = el('input', { class: 'input', type: 'text', required: true, value: item?.name || '', placeholder: 'לדוגמה: חלב 3%' });
  const catSelect = el('select', { class: 'select', required: true },
    ...productCats.map(c => el('option', { value: c.name, selected: item?.productCategory === c.name }, `${c.icon || ''} ${c.name}`))
  );
  const budgetSelect = el('select', { class: 'select', required: true },
    ...budgetCats.map(c => el('option', { value: c.name, selected: item?.budgetCategory === c.name }, `${c.icon || ''} ${c.name}`))
  );
  const unitSelect = el('select', { class: 'select' },
    ...UNITS.map(u => el('option', { value: u, selected: item?.unit === u }, u))
  );
  const weeklyInp = el('input', { class: 'input', type: 'number', step: '0.01', value: item?.weeklyQty ?? 0 });
  const monthlyInp = el('input', { class: 'input', type: 'number', step: '0.01', value: item?.monthlyQty ?? 0 });
  const priceInp = el('input', { class: 'input', type: 'number', step: '0.01', value: item?.price ?? 0, placeholder: '0' });

  // Auto-compute monthly from weekly
  weeklyInp.addEventListener('input', () => {
    if (Number(weeklyInp.value) > 0) {
      monthlyInp.value = (Number(weeklyInp.value) * 4).toFixed(2);
    }
  });

  form.append(
    field('שם מוצר', nameInp),
    twoCol(
      field('קטגוריה ברשימה', catSelect),
      field('קטגוריית תקציב', budgetSelect),
    ),
    field('יחידת מידה', unitSelect),
    twoCol(
      field('כמות שבועית', weeklyInp),
      field('כמות חודשית', monthlyInp),
    ),
    field('מחיר ליחידה (₪)', priceInp),
    el('div', { class: 'modal-footer' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'עדכן' : 'הוסף'),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: nameInp.value.trim(),
      productCategory: catSelect.value,
      budgetCategory: budgetSelect.value,
      unit: unitSelect.value,
      weeklyQty: Number(weeklyInp.value) || 0,
      monthlyQty: Number(monthlyInp.value) || 0,
      price: Number(priceInp.value) || 0,
    };
    if (isEdit) {
      db.updateItem(item.id, data);
      toast('המוצר עודכן', 'success');
    } else {
      db.addItem(data);
      toast('המוצר נוסף', 'success');
    }
    closeModal();
    renderShopping();
    renderDashboard();
  });

  openModal({ title: isEdit ? 'עריכת מוצר' : 'הוספת מוצר', body: form });
  nameInp.focus();
}

function field(label, input) {
  return el('div', { class: 'form-group' }, el('label', {}, label), input);
}
function twoCol(a, b) {
  return el('div', { class: 'form-row' }, a, b);
}

/* ===========================================================
   Budget syncing
   =========================================================== */
function computeShoppingTotalsByBudgetCat() {
  const map = {};
  db.getItems().forEach(it => {
    if (!it.budgetCategory) return;
    map[it.budgetCategory] = (map[it.budgetCategory] || 0) + (Number(it.total) || 0);
  });
  return map;
}

function syncBudgetWithShopping() {
  const totals = computeShoppingTotalsByBudgetCat();
  const cats = db.getBudget();
  cats.forEach(c => {
    if (c.linkedToShopping) {
      c._shoppingTotal = totals[c.name] || 0;
    }
  });
}

function computeCategoryBudgetTotal(cat) {
  const itemsTotal = (cat.items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  if (cat.linkedToShopping) {
    const shopTotals = computeShoppingTotalsByBudgetCat();
    return itemsTotal + (shopTotals[cat.name] || 0);
  }
  return itemsTotal;
}

function computeBudgetTotal() {
  return db.getBudget().reduce((s, c) => s + computeCategoryBudgetTotal(c), 0);
}

/* ===========================================================
   Budget page
   =========================================================== */
function renderBudget() {
  const cats = db.getBudget();
  $('#budget-grand-total').textContent = fmt.money(computeBudgetTotal());

  const list = $('#budget-list');
  list.innerHTML = '';
  if (cats.length === 0) {
    list.appendChild(emptyState('💰', 'אין קטגוריות תקציב', 'הוסף קטגוריה חדשה'));
    return;
  }
  const shopTotals = computeShoppingTotalsByBudgetCat();

  cats.forEach(cat => {
    const total = computeCategoryBudgetTotal(cat);
    const shoppingPart = cat.linkedToShopping ? (shopTotals[cat.name] || 0) : 0;
    const card = el('div', { class: 'budget-cat-card glass' });

    card.appendChild(
      el('div', { class: 'budget-cat-header' },
        el('div', {
          class: 'budget-cat-icon',
          style: { background: (cat.color || '#7c5cff') + '24', color: cat.color || '#a78bfa' }
        }, cat.icon || '📦'),
        el('div', { class: 'budget-cat-name' }, cat.name),
        el('div', { class: 'budget-cat-actions' },
          el('button', { class: 'icon-btn', onclick: () => openBudgetCategoryModal(cat), title: 'ערוך קטגוריה' },
            el('svg', { viewBox: '0 0 24 24', width: 16, height: 16, html: '<path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>' })),
          el('button', { class: 'icon-btn', onclick: () => deleteBudgetCat(cat), title: 'מחק' },
            el('svg', { viewBox: '0 0 24 24', width: 16, height: 16, html: '<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' })),
        ),
      )
    );
    if (cat.linkedToShopping) {
      card.appendChild(el('span', { class: 'budget-cat-linked-badge' }, '🔗 מסונכרן עם רשימת הקניות'));
    }
    card.appendChild(el('div', { class: 'budget-cat-total' }, fmt.money(total)));

    const itemsList = el('div', { class: 'budget-items-list' });
    if (cat.linkedToShopping && shoppingPart > 0) {
      itemsList.appendChild(el('div', { class: 'budget-item-row', style: 'background: var(--grad-card);' },
        el('span', { class: 'name' }, '🛒 מרשימת הקניות'),
        el('span', { class: 'amt' }, fmt.money(shoppingPart)),
      ));
    }
    (cat.items || []).forEach(item => {
      itemsList.appendChild(el('div', { class: 'budget-item-row' },
        el('span', { class: 'name' }, item.name),
        el('span', { class: 'amt' }, fmt.money(item.amount)),
        el('div', { class: 'actions' },
          el('button', { onclick: () => openBudgetItemModal(cat, item), title: 'ערוך' },
            el('svg', { viewBox: '0 0 24 24', width: 12, height: 12, html: '<path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>' })),
          el('button', { onclick: () => deleteBudgetItem(cat, item), title: 'מחק' },
            el('svg', { viewBox: '0 0 24 24', width: 12, height: 12, html: '<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' })),
        ),
      ));
    });
    card.appendChild(itemsList);
    card.appendChild(el('button', { class: 'budget-add-item', onclick: () => openBudgetItemModal(cat) }, '+ הוסף סעיף'));

    list.appendChild(card);
  });
}

function deleteBudgetCat(cat) {
  confirmDialog({
    title: 'מחיקת קטגוריה',
    message: `למחוק את הקטגוריה "${cat.name}" וכל הסעיפים שבה?`,
    confirmLabel: 'מחק',
    danger: true,
  }).then(ok => {
    if (!ok) return;
    db.deleteBudgetCategory(cat.id);
    toast('הקטגוריה נמחקה');
    renderBudget();
    renderDashboard();
  });
}

function openBudgetCategoryModal(cat) {
  const isEdit = !!cat;
  const form = el('form');
  const nameInp = el('input', { class: 'input', required: true, value: cat?.name || '', placeholder: 'שם קטגוריה' });
  const iconInp = el('input', { class: 'input', value: cat?.icon || '📦', maxlength: 4, placeholder: 'אימוג׳י' });
  const colorInp = el('input', { class: 'input', type: 'color', value: cat?.color || '#7c5cff', style: 'height: 44px; padding: 4px;' });
  const linkedChk = el('input', { type: 'checkbox' });
  if (cat?.linkedToShopping) linkedChk.checked = true;

  form.append(
    field('שם קטגוריה', nameInp),
    twoCol(field('אימוג׳י', iconInp), field('צבע', colorInp)),
    el('label', { class: 'checkbox-row' }, linkedChk, el('span', {}, '🔗 קשור לרשימת הקניות (סה"כ מחושב אוטומטית)')),
    el('div', { class: 'modal-footer' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'עדכן' : 'הוסף'),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: nameInp.value.trim(),
      icon: iconInp.value.trim() || '📦',
      color: colorInp.value,
      linkedToShopping: linkedChk.checked,
    };
    if (isEdit) {
      db.updateBudgetCategory(cat.id, data);
      toast('הקטגוריה עודכנה', 'success');
    } else {
      db.addBudgetCategory(data);
      toast('הקטגוריה נוספה', 'success');
    }
    closeModal();
    renderBudget();
    renderDashboard();
  });

  openModal({ title: isEdit ? 'עריכת קטגוריה' : 'קטגוריה חדשה', body: form });
  nameInp.focus();
}

function openBudgetItemModal(cat, item) {
  const isEdit = !!item;
  const form = el('form');
  const nameInp = el('input', { class: 'input', required: true, value: item?.name || '', placeholder: 'לדוגמה: חשמל' });
  const amountInp = el('input', { class: 'input', type: 'number', step: '0.01', required: true, value: item?.amount || 0, placeholder: '0' });

  form.append(
    field('שם סעיף', nameInp),
    field('סכום (₪)', amountInp),
    el('div', { class: 'modal-footer' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'עדכן' : 'הוסף'),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = { name: nameInp.value.trim(), amount: Number(amountInp.value) || 0 };
    if (isEdit) {
      db.updateBudgetItem(cat.id, item.id, data);
      toast('הסעיף עודכן', 'success');
    } else {
      db.addBudgetItem(cat.id, data);
      toast('הסעיף נוסף', 'success');
    }
    closeModal();
    renderBudget();
    renderDashboard();
  });

  openModal({ title: isEdit ? `עריכת סעיף ב${cat.name}` : `סעיף חדש ב${cat.name}`, body: form });
  nameInp.focus();
}

function deleteBudgetItem(cat, item) {
  confirmDialog({
    title: 'מחיקת סעיף',
    message: `למחוק את "${item.name}"?`,
    confirmLabel: 'מחק',
    danger: true,
  }).then(ok => {
    if (!ok) return;
    db.deleteBudgetItem(cat.id, item.id);
    toast('הסעיף נמחק');
    renderBudget();
    renderDashboard();
  });
}

/* ===========================================================
   Weekly Shopping
   =========================================================== */
function weeklyTotal(w) {
  return (w.items || []).reduce((s, i) => s + ((Number(i.qty) || 0) * (Number(i.price) || 0)), 0);
}

function renderWeekly() {
  const list = db.getWeekly();
  const grandTotal = list.reduce((s, w) => s + weeklyTotal(w), 0);
  $('#weekly-grand-total').textContent = fmt.money(grandTotal);
  $('#weekly-count').textContent = list.length;
  $('#weekly-avg').textContent = fmt.money(list.length ? grandTotal / list.length : 0);

  const container = $('#weekly-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.appendChild(emptyState('🛍️', 'אין קניות שבועיות', 'התחל קנייה שבועית חדשה כדי לעקוב אחר ההוצאות'));
    return;
  }
  list.forEach(w => {
    const total = weeklyTotal(w);
    const itemsCount = (w.items || []).length;
    container.appendChild(el('div', { class: 'weekly-card glass' },
      el('div', { class: 'weekly-card-header' },
        el('div', {},
          el('h4', { class: 'weekly-card-title' }, w.name || 'קנייה שבועית'),
          el('div', { class: 'weekly-card-date' }, fmt.date(w.createdAt)),
        ),
      ),
      el('div', { class: 'weekly-card-total' }, fmt.money(total)),
      el('div', { class: 'weekly-card-meta' }, `${itemsCount} פריטים`),
      el('div', { class: 'weekly-card-actions' },
        el('button', { class: 'btn btn-primary btn-sm', onclick: () => openWeeklyDetail(w) }, 'פתיחה'),
        el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openWeeklyEditName(w) }, 'שינוי שם'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => deleteWeekly(w) }, 'מחק'),
      ),
    ));
  });
}

function openWeeklyModal() {
  const form = el('form');
  const nameInp = el('input', { class: 'input', required: true, placeholder: 'לדוגמה: קנייה שבוע 21' });
  const presetBtns = el('div', { style: 'display:flex; gap:6px; flex-wrap:wrap;' });
  const now = new Date();
  const week = Math.ceil((now.getDate()) / 7);
  ['קנייה שבועית', `שבוע ${week} - ${now.toLocaleDateString('he-IL', { month: 'long' })}`, 'קנייה מיוחדת', 'שבת'].forEach(p => {
    presetBtns.appendChild(el('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { nameInp.value = p; } }, p));
  });

  form.append(
    field('שם הקנייה', nameInp),
    el('div', { style: 'font-size:12px; color:var(--text-3);' }, 'הצעות מהירות:'),
    presetBtns,
    el('div', { class: 'modal-footer', style: 'margin-top: 8px;' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, 'יצירה והוספת פריטים'),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const week = db.addWeekly({ name: nameInp.value.trim(), items: [] });
    closeModal();
    toast('קנייה שבועית נוצרה', 'success');
    renderWeekly();
    openWeeklyDetail(week);
  });

  openModal({ title: 'קנייה שבועית חדשה', body: form });
  nameInp.focus();
}

function openWeeklyEditName(w) {
  const form = el('form');
  const nameInp = el('input', { class: 'input', required: true, value: w.name });
  form.append(
    field('שם הקנייה', nameInp),
    el('div', { class: 'modal-footer' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, 'עדכן'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    db.updateWeekly(w.id, { name: nameInp.value.trim() });
    closeModal();
    toast('עודכן', 'success');
    renderWeekly();
  });
  openModal({ title: 'שינוי שם', body: form });
  nameInp.focus();
}

function deleteWeekly(w) {
  confirmDialog({
    title: 'מחיקת קנייה',
    message: `למחוק את "${w.name}"?`,
    confirmLabel: 'מחק',
    danger: true,
  }).then(ok => {
    if (!ok) return;
    db.deleteWeekly(w.id);
    toast('הקנייה נמחקה');
    renderWeekly();
    renderDashboard();
  });
}

function openWeeklyDetail(w) {
  // Refresh from db
  const fresh = db.getWeekly().find(x => x.id === w.id) || w;
  let currentWeek = JSON.parse(JSON.stringify(fresh));

  const body = el('div');

  function refresh() {
    body.innerHTML = '';
    const list = el('div', { class: 'weekly-detail-items' });
    if ((currentWeek.items || []).length === 0) {
      list.appendChild(emptyState('🛒', 'אין פריטים', 'הוסף פריטים מהרשימה או מוצר חדש'));
    } else {
      currentWeek.items.forEach((item, idx) => {
        const qtyInp = el('input', { class: 'input', type: 'number', step: '0.01', value: item.qty || 1, min: 0 });
        const priceInp = el('input', { class: 'input', type: 'number', step: '0.01', value: item.price || 0, min: 0 });
        const totalEl = el('div', { class: 'total' }, fmt.money((Number(item.qty) || 0) * (Number(item.price) || 0)));
        const updateTotal = () => {
          item.qty = Number(qtyInp.value) || 0;
          item.price = Number(priceInp.value) || 0;
          totalEl.textContent = fmt.money(item.qty * item.price);
          updateSummary();
          persistWeek();
        };
        qtyInp.addEventListener('input', updateTotal);
        priceInp.addEventListener('input', updateTotal);

        list.appendChild(el('div', { class: 'weekly-item-row' },
          el('div', { class: 'name' }, item.name, el('div', { style: 'font-size:11px; color:var(--text-3);' }, item.unit || '')),
          qtyInp,
          priceInp,
          totalEl,
          el('button', { class: 'del-btn', onclick: () => { currentWeek.items.splice(idx, 1); persistWeek(); refresh(); } },
            el('svg', { viewBox: '0 0 24 24', width: 14, height: 14, html: '<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' })),
        ));
      });
    }

    const summary = el('div', { class: 'weekly-summary' },
      el('span', { class: 'label' }, 'סה"כ לתשלום'),
      el('span', { class: 'value', id: 'wk-summary-val' }, fmt.money(weeklyTotal(currentWeek))),
    );

    const addSection = el('div', { class: 'weekly-add-section', style: 'display:flex; gap:8px; flex-wrap:wrap;' },
      el('button', { type: 'button', class: 'btn btn-primary', onclick: openPicker }, '+ הוסף מהרשימה'),
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: openNewProduct }, '+ מוצר חדש'),
      el('button', { type: 'button', class: 'btn btn-secondary', style: 'margin-inline-start:auto;', onclick: save }, '💾 שמור'),
    );

    body.append(list, summary, addSection);
  }

  function updateSummary() {
    const v = document.getElementById('wk-summary-val');
    if (v) v.textContent = fmt.money(weeklyTotal(currentWeek));
  }

  function persistWeek() {
    db.updateWeekly(currentWeek.id, { items: currentWeek.items, name: currentWeek.name });
  }

  function save() {
    persistWeek();
    toast('הקנייה נשמרה', 'success');
    renderWeekly();
    renderDashboard();
  }

  function openPicker() {
    const allItems = db.getItems();
    const productCats = db.getProductCategories();

    const search = el('input', { class: 'input', placeholder: 'חפש מוצר...', style: 'margin-bottom:10px;' });
    const catSel = el('select', { class: 'select', style: 'margin-bottom:10px;' },
      el('option', { value: '' }, 'כל הקטגוריות'),
      ...productCats.map(c => el('option', { value: c.name }, `${c.icon || ''} ${c.name}`))
    );

    const pickerList = el('div', { class: 'product-picker' });
    const selectedMap = new Map();

    function renderPicker() {
      pickerList.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      const c = catSel.value;
      const filtered = allItems.filter(it => {
        if (c && it.productCategory !== c) return false;
        if (q && !(it.name || '').toLowerCase().includes(q)) return false;
        return true;
      });
      if (filtered.length === 0) {
        pickerList.appendChild(emptyState('🔍', 'לא נמצאו תוצאות', ''));
        return;
      }
      filtered.forEach(it => {
        const isSel = selectedMap.has(it.id);
        const sel = selectedMap.get(it.id);
        const qtyInp = el('input', { type: 'number', step: '0.01', min: 0, value: sel?.qty ?? (it.weeklyQty || 1) });
        qtyInp.addEventListener('click', e => e.stopPropagation());
        qtyInp.addEventListener('input', () => {
          if (selectedMap.has(it.id)) selectedMap.get(it.id).qty = Number(qtyInp.value) || 0;
        });
        const priceInp = el('input', { type: 'number', step: '0.01', min: 0, value: sel?.price ?? (it.price || 0) });
        priceInp.addEventListener('click', e => e.stopPropagation());
        priceInp.addEventListener('input', () => {
          if (selectedMap.has(it.id)) selectedMap.get(it.id).price = Number(priceInp.value) || 0;
        });

        const row = el('div', {
          class: 'picker-item' + (isSel ? ' selected' : ''),
          onclick: () => {
            if (selectedMap.has(it.id)) selectedMap.delete(it.id);
            else selectedMap.set(it.id, { name: it.name, unit: it.unit, qty: Number(qtyInp.value) || 1, price: Number(priceInp.value) || 0 });
            renderPicker();
          },
        },
          el('div', { class: 'picker-top' },
            el('div', { class: 'picker-name-block' },
              el('div', { class: 'name' }, it.name),
              el('div', { class: 'meta' }, `${it.productCategory} • ${it.unit}`),
            ),
            el('div', { class: 'price' }, fmt.money(it.price)),
          ),
          el('div', { class: 'picker-inputs' },
            el('div', { class: 'inp-field' },
              el('label', {}, 'כמות'),
              qtyInp,
            ),
            el('div', { class: 'inp-field' },
              el('label', {}, 'מחיר'),
              priceInp,
            ),
          ),
        );
        pickerList.appendChild(row);
      });
    }
    search.addEventListener('input', renderPicker);
    catSel.addEventListener('change', renderPicker);
    renderPicker();

    const addBtn = el('button', { class: 'btn btn-primary btn-block', onclick: () => {
      const adds = [];
      selectedMap.forEach(v => adds.push(v));
      if (adds.length === 0) { toast('בחר לפחות מוצר אחד'); return; }
      currentWeek.items = currentWeek.items.concat(adds);
      persistWeek();
      closeModal();
      toast(`נוספו ${adds.length} פריטים`, 'success');
      openWeeklyDetail(currentWeek);
    } }, 'הוספת מוצרים נבחרים');
    const backBtn = el('button', { class: 'btn btn-secondary btn-block', style: 'margin-top:6px;', onclick: () => {
      closeModal();
      openWeeklyDetail(currentWeek);
    } }, '← חזרה לקנייה');

    const wrap = el('div', {}, search, catSel, pickerList, el('div', { style: 'margin-top:14px;' }, addBtn, backBtn));
    openModal({ title: 'בחר מוצרים מהרשימה', body: wrap, large: true });
    search.focus();
  }

  function openNewProduct() {
    const form = el('form');
    const nameInp = el('input', { class: 'input', required: true, placeholder: 'שם המוצר' });
    const unitSelect = el('select', { class: 'select' }, ...UNITS.map(u => el('option', { value: u }, u)));
    const qtyInp = el('input', { class: 'input', type: 'number', step: '0.01', value: 1 });
    const priceInp = el('input', { class: 'input', type: 'number', step: '0.01', value: 0 });
    const saveToListChk = el('input', { type: 'checkbox' });

    form.append(
      field('שם המוצר', nameInp),
      twoCol(field('יחידה', unitSelect), field('כמות', qtyInp)),
      field('מחיר (₪)', priceInp),
      el('label', { class: 'checkbox-row' }, saveToListChk, el('span', {}, 'הוסף גם לרשימת הקניות הקבועה')),
      el('div', { class: 'modal-footer' },
        el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
        el('button', { type: 'submit', class: 'btn btn-primary' }, 'הוסף'),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const newIt = {
        name: nameInp.value.trim(),
        unit: unitSelect.value,
        qty: Number(qtyInp.value) || 0,
        price: Number(priceInp.value) || 0,
      };
      currentWeek.items.push(newIt);
      if (saveToListChk.checked) {
        db.addItem({
          name: newIt.name,
          productCategory: 'אחר',
          budgetCategory: 'מחיה',
          unit: newIt.unit,
          weeklyQty: newIt.qty,
          monthlyQty: newIt.qty * 4,
          price: newIt.price,
        });
      }
      persistWeek();
      closeModal();
      toast('המוצר נוסף', 'success');
      openWeeklyDetail(currentWeek);
    });
    openModal({ title: 'מוצר חדש לקנייה זו', body: form });
    nameInp.focus();
  }

  refresh();
  openModal({
    title: `🛒 ${currentWeek.name}`,
    body,
    large: true,
    onClose: () => {
      persistWeek();
      renderWeekly();
      renderDashboard();
    }
  });
}

/* ===========================================================
   Income
   =========================================================== */
function renderIncome() {
  const list = db.getIncome();
  const total = list.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const tithe = total * 0.1;
  const titheSet = list.filter(i => i.titheSet).reduce((s, i) => s + ((Number(i.amount) || 0) * 0.1), 0);
  const deposited = list.filter(i => i.deposited).reduce((s, i) => s + (Number(i.amount) || 0), 0);

  $('#income-total').textContent = fmt.money(total);
  $('#income-tithe').textContent = fmt.money(tithe);
  $('#income-tithe-set').textContent = fmt.money(titheSet);
  $('#income-deposited').textContent = fmt.money(deposited);

  const container = $('#income-list');
  container.innerHTML = '';
  if (list.length === 0) {
    container.appendChild(emptyState('💰', 'אין הכנסות', 'הוסף הכנסה ראשונה'));
    return;
  }
  list.forEach(i => {
    const itTithe = (Number(i.amount) || 0) * 0.1;
    const tags = [];
    if (i.titheSet) tags.push(el('span', { class: 'income-tag success' }, '✓ מעשר הופרש'));
    else tags.push(el('span', { class: 'income-tag warning' }, '⚠ מעשר לא הופרש'));
    if (i.deposited) tags.push(el('span', { class: 'income-tag success' }, '🏦 הופקד'));
    else tags.push(el('span', { class: 'income-tag' }, '🏦 לא הופקד'));

    container.appendChild(el('div', { class: 'income-card glass' },
      el('div', { class: 'income-icon' },
        el('svg', { viewBox: '0 0 24 24', html: '<path fill="currentColor" d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.42 0 2.13.54 2.39 1.4.12.4.45.7.87.7h.3c.66 0 1.13-.65.9-1.27-.42-1.18-1.4-2.16-2.96-2.54V4.5C12.94 3.67 12.27 3 11.43 3h-.01c-.84 0-1.51.67-1.51 1.51v1.66c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-1.65 0-2.5-.59-2.83-1.43-.15-.39-.49-.68-.9-.68h-.28c-.67 0-1.14.68-.89 1.3.57 1.39 1.9 2.21 3.4 2.53v1.67c0 .84.67 1.51 1.51 1.51h.01c.84 0 1.51-.67 1.51-1.51v-1.65c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>' })),
      el('div', { class: 'income-body' },
        el('div', { class: 'income-source' }, i.source || 'הכנסה'),
        el('div', { class: 'income-date' }, fmt.date(i.date || i.createdAt)),
        i.notes ? el('div', { class: 'income-notes' }, i.notes) : null,
        el('div', { class: 'income-tags' }, ...tags),
      ),
      el('div', { class: 'income-amount' },
        el('div', { class: 'income-amount-main' }, '+' + fmt.money(i.amount)),
        el('div', { class: 'income-amount-tithe' }, `מעשר: ${fmt.money(itTithe)}`),
        el('div', { class: 'income-actions' },
          el('button', { onclick: () => openIncomeModal(i), title: 'ערוך' },
            el('svg', { viewBox: '0 0 24 24', width: 14, height: 14, html: '<path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>' })),
          el('button', { class: 'del', onclick: () => deleteIncome(i), title: 'מחק' },
            el('svg', { viewBox: '0 0 24 24', width: 14, height: 14, html: '<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' })),
        ),
      ),
    ));
  });
}

function openIncomeModal(i) {
  const isEdit = !!i;
  const form = el('form');
  const sourceList = el('datalist', { id: 'income-sources' },
    ...INCOME_SOURCES.map(s => el('option', { value: s }))
  );
  const sourceInp = el('input', { class: 'input', required: true, list: 'income-sources', value: i?.source || '', placeholder: 'לדוגמה: משכורת' });
  const amountInp = el('input', { class: 'input', type: 'number', step: '0.01', required: true, value: i?.amount || 0, placeholder: '0' });
  const dateInp = el('input', { class: 'input', type: 'date', value: i?.date ? fmt.dateInput(i.date) : fmt.dateInput(Date.now()) });
  const notesInp = el('textarea', { class: 'input', placeholder: 'הערות נוספות (אופציונלי)' }, i?.notes || '');
  notesInp.value = i?.notes || '';

  const titheChk = el('input', { type: 'checkbox' });
  if (i?.titheSet) titheChk.checked = true;
  const depChk = el('input', { type: 'checkbox' });
  if (i?.deposited) depChk.checked = true;

  // Live tithe preview
  const tithePreview = el('div', { style: 'font-size: 13px; color: var(--text-3); padding: 8px 12px; background: var(--surface-2); border-radius: 8px;' });
  const updateTithe = () => {
    tithePreview.textContent = `מעשר (10%): ${fmt.money((Number(amountInp.value) || 0) * 0.1)}`;
  };
  amountInp.addEventListener('input', updateTithe);
  updateTithe();

  form.append(
    sourceList,
    field('מקור הכנסה', sourceInp),
    twoCol(field('סכום (₪)', amountInp), field('תאריך', dateInp)),
    tithePreview,
    el('label', { class: 'checkbox-row' }, titheChk, el('span', {}, '✅ המעשר הופרש')),
    el('label', { class: 'checkbox-row' }, depChk, el('span', {}, '🏦 הכסף הופקד לבנק')),
    field('הערות', notesInp),
    el('div', { class: 'modal-footer' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'עדכן' : 'הוסף'),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      source: sourceInp.value.trim(),
      amount: Number(amountInp.value) || 0,
      date: dateInp.value ? new Date(dateInp.value).getTime() : Date.now(),
      notes: notesInp.value.trim(),
      titheSet: titheChk.checked,
      deposited: depChk.checked,
    };
    if (isEdit) {
      db.updateIncome(i.id, data);
      toast('ההכנסה עודכנה', 'success');
    } else {
      db.addIncome(data);
      toast('ההכנסה נוספה', 'success');
    }
    closeModal();
    renderIncome();
    renderDashboard();
  });

  openModal({ title: isEdit ? 'עריכת הכנסה' : 'הכנסה חדשה', body: form });
  sourceInp.focus();
}

function deleteIncome(i) {
  confirmDialog({
    title: 'מחיקת הכנסה',
    message: `למחוק את ההכנסה "${i.source}" בסך ${fmt.money(i.amount)}?`,
    confirmLabel: 'מחק',
    danger: true,
  }).then(ok => {
    if (!ok) return;
    db.deleteIncome(i.id);
    toast('ההכנסה נמחקה');
    renderIncome();
    renderDashboard();
  });
}

/* ===========================================================
   Product Categories Management
   =========================================================== */
function renderProductCategories() {
  const cats = db.getProductCategories();
  const items = db.getItems();
  const grid = $('#product-categories-list');
  grid.innerHTML = '';
  if (cats.length === 0) {
    grid.appendChild(emptyState('🗂️', 'אין קטגוריות', 'הוסף קטגוריה ראשונה'));
    return;
  }
  cats.forEach(c => {
    const count = items.filter(i => i.productCategory === c.name).length;
    grid.appendChild(el('div', { class: 'category-card' },
      el('div', { class: 'ico', style: { background: (c.color || '#7c5cff') + '24', color: c.color || '#a78bfa' } }, c.icon || '📦'),
      el('div', { class: 'name' }, c.name),
      el('div', { class: 'count' }, `${count} מוצרים`),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openProductCategoryModal(c) }, 'ערוך'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => deleteProductCategory(c) }, 'מחק'),
      ),
    ));
  });
}

function openProductCategoryModal(cat) {
  const isEdit = !!cat;
  const form = el('form');
  const nameInp = el('input', { class: 'input', required: true, value: cat?.name || '', placeholder: 'שם קטגוריה' });
  const iconInp = el('input', { class: 'input', value: cat?.icon || '📦', maxlength: 4 });
  const colorInp = el('input', { class: 'input', type: 'color', value: cat?.color || '#7c5cff', style: 'height: 44px; padding: 4px;' });

  form.append(
    field('שם קטגוריה', nameInp),
    twoCol(field('אימוג׳י', iconInp), field('צבע', colorInp)),
    el('div', { class: 'modal-footer' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'עדכן' : 'הוסף'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = { name: nameInp.value.trim(), icon: iconInp.value.trim() || '📦', color: colorInp.value };
    if (isEdit) {
      db.updateProductCategory(cat.id, data);
      toast('הקטגוריה עודכנה', 'success');
    } else {
      db.addProductCategory(data);
      toast('הקטגוריה נוספה', 'success');
    }
    closeModal();
    renderProductCategories();
    populateCategoryFilter();
  });
  openModal({ title: isEdit ? 'עריכת קטגוריה' : 'קטגוריה חדשה', body: form });
  nameInp.focus();
}

function deleteProductCategory(c) {
  const items = db.getItems().filter(i => i.productCategory === c.name);
  if (items.length > 0) {
    toast(`לא ניתן למחוק - יש ${items.length} מוצרים בקטגוריה זו`, 'error');
    return;
  }
  confirmDialog({
    title: 'מחיקת קטגוריה',
    message: `למחוק את "${c.name}"?`,
    confirmLabel: 'מחק',
    danger: true,
  }).then(ok => {
    if (!ok) return;
    db.deleteProductCategory(c.id);
    toast('הקטגוריה נמחקה');
    renderProductCategories();
    populateCategoryFilter();
  });
}
