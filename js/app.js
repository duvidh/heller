// Main application controller
import { db, registerUser, loginUser, getSession, clearSession, mergeBudgetDefaults, periodRange, inPeriod, plannedMultiplier, periodLabel, daysUntilDueDay, paidThisMonth, applyCloudData, collectAllData } from './storage.js';
import { UNITS, INCOME_SOURCES } from './data.js';
import { fmt, $, $$, el, toast, openModal, closeModal, confirmDialog, getCategoryMeta, categorySwatch, renderPeriodFilter } from './ui.js';
import * as cloud from './cloud.js';

/* PWA registration + install prompt */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Show our install banner if user hasn't dismissed
  if (!localStorage.getItem('heller_v1.installDismissed')) {
    showInstallBanner();
  }
});
function showInstallBanner() {
  if (document.getElementById('install-banner')) return;
  const banner = el('div', { id: 'install-banner', class: 'install-banner' },
    el('div', { class: 'install-text' },
      el('strong', {}, '📲 התקן את האפליקציה'),
      el('div', {}, 'לגישה מהירה ועבודה גם בלי אינטרנט'),
    ),
    el('div', { style: 'display:flex; gap:8px;' },
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
        localStorage.setItem('heller_v1.installDismissed', '1');
        banner.remove();
      } }, 'לא עכשיו'),
      el('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
        if (!deferredInstallPrompt) return banner.remove();
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice.catch(() => null);
        deferredInstallPrompt = null;
        banner.remove();
        if (choice?.outcome === 'accepted') toast('האפליקציה מותקנת! 🎉', 'success');
      } }, 'התקן'),
    ),
  );
  document.body.appendChild(banner);
}

/* ===========================================================
   App state
   =========================================================== */
const state = {
  user: null,
  tab: 'dashboard',
  shoppingFilter: { search: '', category: '' },
  period: { type: 'currentMonth' },
};

/* ===========================================================
   Authentication flow
   =========================================================== */
function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#fab-container')?.classList.add('hidden');
}
function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#fab-container')?.classList.remove('hidden');
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
  $('#clear-purchased').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'ניקוי סימונים',
      message: 'לבטל את כל הסימונים של מוצרים שנקנו?',
      confirmLabel: 'נקה',
    });
    if (!ok) return;
    db.clearAllPurchased();
    toast('הסימונים נוקו', 'success');
    renderShopping();
  });

  $('#new-weekly').addEventListener('click', () => openWeeklyModal());
  $('#add-budget-cat').addEventListener('click', () => openBudgetCategoryModal());
  $('#sync-budget-defaults').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'השלמת קטגוריות מהאקסל',
      message: 'הפעולה תוסיף את כל הקטגוריות והסעיפים מהאקסל שעדיין לא קיימים אצלך. סעיפים שכבר קיימים — לא ישתנו.',
      confirmLabel: 'השלם',
    });
    if (!ok) return;
    const { addedCats, addedItems } = mergeBudgetDefaults();
    if (addedCats === 0 && addedItems === 0) {
      toast('הכל מעודכן — אין מה להוסיף');
    } else {
      toast(`נוספו ${addedCats} קטגוריות ו-${addedItems} סעיפים`, 'success');
    }
    renderBudget();
    renderDashboard();
  });
  $('#add-income').addEventListener('click', () => openIncomeModal());
  $('#add-product-category').addEventListener('click', () => openProductCategoryModal());
  $('#add-goal').addEventListener('click', () => openGoalModal());

  // FAB (floating action button)
  $('#fab').addEventListener('click', () => {
    $('#fab-container').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#fab-container')) return;
    $('#fab-container')?.classList.remove('open');
  });
  $$('.fab-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const what = btn.dataset.quick;
      $('#fab-container').classList.remove('open');
      if (what === 'expense') openQuickExpenseModal();
      else if (what === 'income') openIncomeModal();
      else if (what === 'weekly') openWeeklyModal();
    });
  });

  // Settings: backup / restore
  $('#export-data').addEventListener('click', exportBackup);
  $('#import-data').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', importBackup);
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
  $('#fab-container')?.classList.toggle('hidden-by-sidebar', s.classList.contains('open'));
  // Also collapse the FAB menu if it was open
  $('#fab-container')?.classList.remove('open');
}
function closeMobileNav() {
  $('.sidebar')?.classList.remove('open');
  document.querySelector('.sidebar-backdrop')?.classList.remove('show');
  $('#fab-container')?.classList.remove('hidden-by-sidebar');
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
    goals: 'יעדי חיסכון',
    categories: 'קטגוריות',
    settings: 'הגדרות',
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
    case 'goals': renderGoals(); break;
    case 'categories': renderProductCategories(); break;
    case 'settings': renderSettings(); break;
  }
}

/* ===========================================================
   Dashboard
   =========================================================== */
function renderDashboard() {
  const period = state.period;

  // Period filter
  const filterContainer = $('#dashboard-period-filter');
  filterContainer.innerHTML = '';
  filterContainer.appendChild(renderPeriodFilter(period, (p) => {
    state.period = p;
    renderDashboard();
  }));

  // Filter data by period
  const allIncomes = db.getIncome();
  const incomes = allIncomes.filter(i => inPeriod(i.date || i.createdAt, period));
  const totalIncome = incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const tithe = incomes.reduce((s, i) => s + ((Number(i.amount) || 0) * 0.1), 0);
  const titheSet = incomes.filter(i => i.titheSet).reduce((s, i) => s + ((Number(i.amount) || 0) * 0.1), 0);

  const cats = db.getBudget();
  const budgetPlanned = cats.reduce((s, c) => s + categoryPlanned(c, period), 0);
  const budgetActual = cats.reduce((s, c) => s + categoryActual(c, period), 0);
  const balance = totalIncome - budgetActual;

  $('#stat-income').textContent = fmt.money(totalIncome);
  $('#stat-income-meta').textContent = `${incomes.length} רשומות • ${periodLabel(period)}`;
  $('#stat-budget').textContent = fmt.money(budgetActual);
  $('#stat-budget-meta') && ($('#stat-budget-meta').textContent = `מתוך ${fmt.money(budgetPlanned)} מתוכנן`);
  $('#stat-balance').textContent = fmt.money(balance);
  $('#stat-balance').style.color = balance >= 0 ? '#34d399' : '#fca5a5';
  $('#stat-tithe').textContent = fmt.money(tithe);
  $('#stat-tithe-meta').textContent = `הופרש: ${fmt.money(titheSet)}`;

  // Budget chart - planned vs actual
  const chart = $('#budget-chart');
  chart.innerHTML = '';
  const decoratedCats = cats.map(c => ({
    ...c,
    planned: categoryPlanned(c, period),
    actual: categoryActual(c, period),
  }));
  const maxVal = Math.max(...decoratedCats.map(c => Math.max(c.planned, c.actual)), 1);
  if (decoratedCats.length === 0) {
    chart.appendChild(emptyState('📊', 'אין נתוני תקציב', 'הוסף קטגוריות בעמוד התקציב'));
  } else {
    decoratedCats.sort((a, b) => b.planned - a.planned).slice(0, 8).forEach(c => {
      const plannedPct = (c.planned / maxVal) * 100;
      const actualPct = (c.actual / maxVal) * 100;
      chart.appendChild(el('div', { class: 'bar-row dual' },
        el('span', { class: 'label' }, `${c.icon || '📦'} ${c.name}`),
        el('div', { class: 'bars' },
          el('div', { class: 'bar bar-planned' },
            el('span', { style: { width: plannedPct + '%', background: gradFor(c.color) } })),
          el('div', { class: 'bar bar-actual' },
            el('span', { style: { width: actualPct + '%' } })),
        ),
        el('div', { class: 'vals' },
          el('div', { class: 'val planned' }, fmt.money(c.planned)),
          el('div', { class: 'val actual' }, fmt.money(c.actual)),
        ),
      ));
    });
  }

  // Recent weeklies (in period)
  const weeklyEl = $('#recent-weeklies');
  weeklyEl.innerHTML = '';
  const allWeeklies = db.getWeekly();
  const weeklies = allWeeklies.filter(w => inPeriod(w.createdAt, period));
  if (weeklies.length === 0) {
    weeklyEl.appendChild(emptyState('🛍️', 'אין קניות שבועיות בתקופה זו', 'התחל קנייה שבועית חדשה'));
  } else {
    weeklies.slice(0, 5).forEach(w => {
      const total = weeklyTotal(w);
      weeklyEl.appendChild(el('div', { class: 'recent-item' },
        el('div', { class: 'left' },
          el('div', {}, el('div', { class: 'name' }, w.name || 'קנייה שבועית'),
                       el('div', { class: 'meta' }, `${fmt.date(w.createdAt)} • ${w.items?.length || 0} פריטים`)),
        ),
        el('div', { class: 'amount' }, fmt.money(total)),
      ));
    });
    const grand = weeklies.reduce((s, w) => s + weeklyTotal(w), 0);
    weeklyEl.appendChild(el('div', { class: 'recent-item', style: { background: 'var(--grad-card)' } },
      el('div', { class: 'left' }, el('div', { class: 'name' }, `סה"כ ${periodLabel(period)}`)),
      el('div', { class: 'amount positive' }, fmt.money(grand)),
    ));
  }

  // Monthly trend (6 months) + Due bills
  renderMonthlyTrend();
  renderDueBills();

  // Recent incomes (in period)
  const incEl = $('#recent-incomes');
  incEl.innerHTML = '';
  if (incomes.length === 0) {
    incEl.appendChild(emptyState('💰', 'אין הכנסות בתקופה זו', 'הוסף הכנסה'));
  } else {
    incomes.slice(0, 6).forEach(i => {
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
      const checkbox = el('input', { type: 'checkbox', class: 'item-checkbox' });
      checkbox.checked = !!it.purchased;
      checkbox.addEventListener('click', (e) => e.stopPropagation());
      checkbox.addEventListener('change', () => {
        db.toggleItemPurchased(it.id);
        renderShopping();
      });

      const row = el('div', { class: 'item-row' + (it.purchased ? ' purchased' : '') },
        checkbox,
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
          el('button', { onclick: (e) => { e.stopPropagation(); openItemModal(it); }, title: 'ערוך' },
            el('svg', { viewBox: '0 0 24 24', width: 16, height: 16, html: '<path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>' })),
          el('button', { class: 'del', onclick: (e) => { e.stopPropagation(); deleteItem(it); }, title: 'מחק' },
            el('svg', { viewBox: '0 0 24 24', width: 16, height: 16, html: '<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' })),
        ),
      );
      // Make whole row clickable to toggle (except buttons)
      row.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target === checkbox) return;
        checkbox.checked = !checkbox.checked;
        db.toggleItemPurchased(it.id);
        renderShopping();
      });
      group.appendChild(row);
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

/* --------- Actuals (spent in period) --------- */
function actualForItem(item, period) {
  return (item.payments || [])
    .filter(p => inPeriod(p.date, period))
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

// Weekly shopping totals are the "actual" for linked-to-shopping categories.
function shoppingActualInPeriod(period) {
  return db.getWeekly()
    .filter(w => inPeriod(w.createdAt, period))
    .reduce((sum, w) => sum + weeklyTotal(w), 0);
}

function categoryPlanned(cat, period) {
  const mult = plannedMultiplier(period);
  const itemsTotal = (cat.items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0) * mult;
  if (cat.linkedToShopping) {
    // Linked-to-shopping categories' "planned" still includes the master shopping total
    const shopTotals = computeShoppingTotalsByBudgetCat();
    return itemsTotal + (shopTotals[cat.name] || 0) * mult;
  }
  return itemsTotal;
}

function categoryActual(cat, period) {
  // Manual payments on each item
  let total = (cat.items || []).reduce((s, i) => s + actualForItem(i, period), 0);
  // Plus weekly shopping totals for linked-to-shopping categories
  if (cat.linkedToShopping) {
    // For simplicity: all weekly shopping counts toward מחיה (the only practical case here).
    // If the user has multiple linked categories with overlap, this is approximate.
    if (cat.name === 'מחיה' || cat.name === 'שבת') {
      // Split weekly shopping by item budgetCategory if stored, else lump into מחיה
      total += weeklyActualByCategory(cat.name, period);
    }
  }
  return total;
}

function weeklyActualByCategory(catName, period) {
  // Match each weekly item to its budgetCategory if available; default to 'מחיה'
  return db.getWeekly()
    .filter(w => inPeriod(w.createdAt, period))
    .reduce((sum, w) => {
      return sum + (w.items || []).reduce((s, it) => {
        const itCat = it.budgetCategory || 'מחיה';
        if (itCat !== catName) return s;
        return s + (Number(it.qty) || 0) * (Number(it.price) || 0);
      }, 0);
    }, 0);
}

function progressClass(actual, planned) {
  if (planned === 0) return 'zero';
  const ratio = actual / planned;
  if (ratio < 0.7) return 'under';
  if (ratio < 1.0) return 'near';
  return 'over';
}

/* ===========================================================
   Budget page
   =========================================================== */
function renderBudget() {
  const cats = db.getBudget();
  const period = state.period;

  // Period filter at top
  const filterContainer = $('#budget-period-filter');
  filterContainer.innerHTML = '';
  filterContainer.appendChild(renderPeriodFilter(period, (p) => {
    state.period = p;
    renderBudget();
    renderDashboard();
  }));

  // Grand totals
  const totalPlanned = cats.reduce((s, c) => s + categoryPlanned(c, period), 0);
  const totalActual = cats.reduce((s, c) => s + categoryActual(c, period), 0);

  $('#budget-grand-total').textContent = fmt.money(totalPlanned);
  $('#budget-grand-actual').textContent = fmt.money(totalActual);
  $('#budget-grand-label').textContent =
    period.type === 'currentYear' ? 'תקציב שנתי' : 'תקציב חודשי';
  $('#budget-period-label').textContent = periodLabel(period);

  const overallPct = totalPlanned > 0 ? Math.min(100, (totalActual / totalPlanned) * 100) : 0;
  const overallBar = $('#budget-grand-progress');
  overallBar.innerHTML = '';
  const overallSpan = el('span', { style: { width: overallPct + '%' } });
  overallBar.appendChild(overallSpan);
  overallBar.classList.toggle('over', totalActual > totalPlanned && totalPlanned > 0);

  const list = $('#budget-list');
  list.innerHTML = '';
  if (cats.length === 0) {
    list.appendChild(emptyState('💰', 'אין קטגוריות תקציב', 'הוסף קטגוריה חדשה'));
    return;
  }

  cats.forEach(cat => {
    const planned = categoryPlanned(cat, period);
    const actual = categoryActual(cat, period);
    const pct = planned > 0 ? Math.min(100, (actual / planned) * 100) : 0;
    const isOver = actual > planned && planned > 0;

    const card = el('div', { class: 'budget-cat-card glass' });

    const header = el('div', { class: 'budget-cat-header' },
      el('div', {
        class: 'budget-cat-icon',
        style: { background: (cat.color || '#7c5cff') + '24', color: cat.color || '#a78bfa' }
      }, cat.icon || '📦'),
      el('div', { class: 'budget-cat-name' }, cat.name),
      el('div', { style: 'font-size: 20px; color: var(--text-3);' }, '›'),
    );
    header.addEventListener('click', () => openBudgetCategoryModal(cat));
    card.appendChild(header);

    if (cat.linkedToShopping) {
      card.appendChild(el('span', { class: 'budget-cat-linked-badge' }, '🔗 מסונכרן עם רשימת הקניות'));
    }

    card.appendChild(el('div', { class: 'budget-cat-totals' },
      el('div', { class: 'planned' }, 'מתוכנן: ', el('strong', {}, fmt.money(planned))),
      el('div', { class: 'actual' }, 'בפועל: ', el('strong', {}, fmt.money(actual))),
      el('div', { style: 'margin-inline-start:auto; font-size:13px; font-weight:700; color:' + (isOver ? '#f87171' : (pct > 70 ? '#fbbf24' : '#34d399')) }, Math.round(pct) + '%'),
    ));

    const progressBar = el('div', { class: 'budget-progress' + (isOver ? ' over' : '') });
    progressBar.appendChild(el('span', { style: { width: pct + '%' } }));
    card.appendChild(progressBar);

    const itemsList = el('div', { class: 'budget-items-list' });
    if (cat.linkedToShopping) {
      const shopAct = weeklyActualByCategory(cat.name, period);
      if (shopAct > 0) {
        itemsList.appendChild(el('div', { class: 'budget-item-row', style: 'background: var(--grad-card);' },
          el('span', { class: 'name' }, '🛒 מהקניות השבועיות'),
          el('span', { class: 'amounts' },
            el('span', { class: 'actual-amt under' }, fmt.money(shopAct))
          ),
        ));
      }
    }
    (cat.items || []).forEach(item => {
      const itemPlanned = (Number(item.amount) || 0) * plannedMultiplier(period);
      const itemActual = actualForItem(item, period);
      const isPaid = paidThisMonth(item);
      const daysToDue = item.recurring && item.dueDay ? daysUntilDueDay(item.dueDay) : null;

      // Build name with badges
      const nameCell = el('span', { class: 'name' }, item.name);
      if (item.recurring) {
        if (isPaid) {
          nameCell.appendChild(el('span', { class: 'item-badge paid' }, '✓ שולם'));
        } else if (daysToDue != null) {
          let badgeClass = 'due';
          let text = `📅 בעוד ${daysToDue} ימים`;
          if (daysToDue === 0) { badgeClass = 'due-now'; text = '⚠️ היום!'; }
          else if (daysToDue <= 3) { badgeClass = 'due-soon'; text = `⚠️ בעוד ${daysToDue} ימים`; }
          nameCell.appendChild(el('span', { class: 'item-badge ' + badgeClass }, text));
        }
      }

      const row = el('div', { class: 'budget-item-row' + (isPaid ? ' paid' : '') },
        nameCell,
        el('span', { class: 'amounts' },
          el('span', { class: 'planned-amt' }, fmt.money(itemPlanned)),
          el('span', { class: 'actual-amt ' + progressClass(itemActual, itemPlanned) },
            fmt.money(itemActual)),
        ),
      );
      row.addEventListener('click', () => openBudgetItemModal(cat, item));
      itemsList.appendChild(row);
    });
    card.appendChild(itemsList);
    card.appendChild(el('button', { class: 'budget-add-item', onclick: () => openBudgetItemModal(cat) }, '+ הוסף סעיף'));

    list.appendChild(card);
  });
}

function deleteBudgetCat(cat) {
  closeModal();
  confirmDialog({
    title: 'מחיקת קטגוריה',
    message: `למחוק את הקטגוריה "${cat.name}" וכל הסעיפים שבה?`,
    confirmLabel: 'מחק',
    danger: true,
  }).then(ok => {
    if (!ok) {
      openBudgetCategoryModal(cat);
      return;
    }
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

  const footerButtons = [
    el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
  ];
  if (isEdit) {
    footerButtons.unshift(el('button', {
      type: 'button',
      class: 'btn btn-danger',
      onclick: () => deleteBudgetCat(cat),
    }, 'מחק'));
  }
  footerButtons.push(el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'עדכן' : 'הוסף'));

  form.append(
    field('שם קטגוריה', nameInp),
    twoCol(field('אימוג׳י', iconInp), field('צבע', colorInp)),
    el('label', { class: 'checkbox-row' }, linkedChk, el('span', {}, '🔗 קשור לרשימת הקניות (סה"כ מחושב אוטומטית)')),
    el('div', { class: 'modal-footer' }, ...footerButtons),
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
  // Refresh item from db so payments list is current
  if (isEdit) {
    const fresh = db.getBudget().find(c => c.id === cat.id)?.items.find(i => i.id === item.id);
    if (fresh) item = fresh;
  }

  const form = el('form');
  const nameInp = el('input', { class: 'input', required: true, value: item?.name || '', placeholder: 'לדוגמה: חשמל' });
  const amountInp = el('input', { class: 'input', type: 'number', step: '0.01', required: true, value: item?.amount || 0, placeholder: '0' });
  const recurringChk = el('input', { type: 'checkbox' });
  if (item?.recurring) recurringChk.checked = true;
  const dueDayInp = el('input', { class: 'input', type: 'number', min: 1, max: 31, step: 1, value: item?.dueDay || '', placeholder: '1-31' });

  // Payments section (only for existing items)
  let paymentsSection = null;
  if (isEdit) {
    paymentsSection = el('div', { style: 'border-top: 1px solid var(--border); padding-top: 14px; margin-top: 8px;' });
    paymentsSection.appendChild(el('div', {
      style: 'display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;'
    },
      el('div', {},
        el('div', { style: 'font-size: 14px; font-weight: 700;' }, 'הוצאות בפועל'),
        el('div', { style: 'font-size: 12px; color: var(--text-3);' }, `סה"כ: ${fmt.money((item.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0))}`),
      ),
      el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openPaymentModal(cat, item) }, '+ הוסף תשלום'),
    ));

    const paymentsList = el('div', { class: 'payments-list' });
    const payments = (item.payments || []).slice().sort((a, b) => (b.date || 0) - (a.date || 0));
    if (payments.length === 0) {
      paymentsList.appendChild(el('div', { style: 'font-size: 13px; color: var(--text-3); text-align: center; padding: 16px;' }, 'אין רשומות הוצאה'));
    } else {
      payments.forEach(p => {
        paymentsList.appendChild(el('div', { class: 'payment-row' },
          el('div', {},
            el('div', { class: 'pay-amt' }, fmt.money(p.amount)),
            el('div', { class: 'pay-date' }, fmt.date(p.date)),
          ),
          el('div', { style: 'font-size: 12.5px; color: var(--text-2);' }, p.notes || ''),
          el('button', { type: 'button', class: 'icon-btn', onclick: () => openPaymentModal(cat, item, p) },
            el('svg', { viewBox: '0 0 24 24', width: 14, height: 14, html: '<path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>' })),
          el('button', { type: 'button', class: 'pay-del', onclick: () => {
            db.deletePayment(cat.id, item.id, p.id);
            toast('הוצאה נמחקה');
            closeModal();
            openBudgetItemModal(cat, item);
          } },
            el('svg', { viewBox: '0 0 24 24', width: 12, height: 12, html: '<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' })),
        ));
      });
    }
    paymentsSection.appendChild(paymentsList);
  }

  const footerButtons = [
    el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
  ];
  if (isEdit) {
    footerButtons.unshift(el('button', {
      type: 'button',
      class: 'btn btn-danger',
      onclick: () => deleteBudgetItem(cat, item),
    }, 'מחק'));
  }
  footerButtons.push(el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'עדכן' : 'הוסף'));

  form.append(
    field('שם סעיף', nameInp),
    field('סכום מתוכנן חודשי (₪)', amountInp),
    el('label', { class: 'checkbox-row' }, recurringChk, el('span', {}, '🔁 חוזר כל חודש (חשבון קבוע)')),
    field('יום בחודש לתשלום (אופציונלי)', dueDayInp),
    paymentsSection,
    el('div', { class: 'modal-footer' }, ...footerButtons),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: nameInp.value.trim(),
      amount: Number(amountInp.value) || 0,
      recurring: recurringChk.checked,
      dueDay: dueDayInp.value ? Number(dueDayInp.value) : null,
    };
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

  openModal({ title: isEdit ? `עריכת סעיף: ${item.name}` : `סעיף חדש ב${cat.name}`, body: form });
  nameInp.focus();
}

function openPaymentModal(cat, item, existing) {
  const isEdit = !!existing;
  const form = el('form');
  const amountInp = el('input', { class: 'input', type: 'number', step: '0.01', required: true, value: existing?.amount || '', placeholder: '0' });
  const dateInp = el('input', { class: 'input', type: 'date', value: existing?.date ? fmt.dateInput(existing.date) : fmt.dateInput(Date.now()) });
  const notesInp = el('textarea', { class: 'input', placeholder: 'הערות (אופציונלי)', rows: 2 });
  notesInp.value = existing?.notes || '';

  form.append(
    field('סכום בפועל (₪)', amountInp),
    field('תאריך', dateInp),
    field('הערות', notesInp),
    el('div', { class: 'modal-footer' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { closeModal(); openBudgetItemModal(cat, item); } }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'עדכן' : 'הוסף'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      amount: Number(amountInp.value) || 0,
      date: dateInp.value ? new Date(dateInp.value).getTime() : Date.now(),
      notes: notesInp.value.trim(),
    };
    if (isEdit) {
      db.updatePayment(cat.id, item.id, existing.id, data);
      toast('עודכן', 'success');
    } else {
      db.addPayment(cat.id, item.id, data);
      toast('תשלום נוסף', 'success');
    }
    closeModal();
    openBudgetItemModal(cat, item);
    renderBudget();
    renderDashboard();
  });
  openModal({ title: isEdit ? 'עריכת תשלום' : `תשלום חדש: ${item.name}`, body: form });
  amountInp.focus();
}

function deleteBudgetItem(cat, item) {
  closeModal();
  confirmDialog({
    title: 'מחיקת סעיף',
    message: `למחוק את "${item.name}" וכל ההוצאות הקשורות?`,
    confirmLabel: 'מחק',
    danger: true,
  }).then(ok => {
    if (!ok) {
      // Re-open item modal if cancelled
      openBudgetItemModal(cat, item);
      return;
    }
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
    body.appendChild(el('div', { class: 'isolation-notice' },
      el('svg', { viewBox: '0 0 24 24', width: 16, height: 16, html: '<path fill="currentColor" d="M11 9h2V7h-2v2zm1 11c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm0-18C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1 15h2v-6h-2v6z"/>' }),
      el('span', {}, 'שינויים בקנייה הזו לא משפיעים על רשימת הקניות הקבועה')
    ));
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

        const boughtChk = el('input', { type: 'checkbox', class: 'item-checkbox' });
        boughtChk.checked = !!item.bought;
        const row = el('div', { class: 'weekly-item-row' + (item.bought ? ' bought' : '') },
          boughtChk,
          el('div', { class: 'name' }, item.name, el('div', { style: 'font-size:11px; color:var(--text-3);' }, item.unit || '')),
          qtyInp,
          priceInp,
          totalEl,
          el('button', { class: 'del-btn', onclick: () => { currentWeek.items.splice(idx, 1); persistWeek(); refresh(); } },
            el('svg', { viewBox: '0 0 24 24', width: 14, height: 14, html: '<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' })),
        );
        boughtChk.addEventListener('change', () => {
          item.bought = boughtChk.checked;
          row.classList.toggle('bought', boughtChk.checked);
          persistWeek();
        });
        list.appendChild(row);
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
            else selectedMap.set(it.id, { name: it.name, unit: it.unit, qty: Number(qtyInp.value) || 1, price: Number(priceInp.value) || 0, budgetCategory: it.budgetCategory });
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


/* ===========================================================
   Goals (Savings tracker)
   =========================================================== */
function goalSaved(g) {
  return (g.contributions || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
}

function renderGoals() {
  const goals = db.getGoals();

  // Top stats
  const statsEl = $('#goals-stats');
  statsEl.innerHTML = '';
  const totalTarget = goals.reduce((s, g) => s + (Number(g.target) || 0), 0);
  const totalSaved = goals.reduce((s, g) => s + goalSaved(g), 0);
  const totalLeft = Math.max(0, totalTarget - totalSaved);

  statsEl.appendChild(el('div', { class: 'mini-stat glass' },
    el('div', { class: 'mini-stat-label' }, 'יעדים פעילים'),
    el('div', { class: 'mini-stat-value' }, String(goals.length)),
  ));
  statsEl.appendChild(el('div', { class: 'mini-stat glass' },
    el('div', { class: 'mini-stat-label' }, 'נחסך בסה"כ'),
    el('div', { class: 'mini-stat-value' }, fmt.money(totalSaved)),
  ));
  statsEl.appendChild(el('div', { class: 'mini-stat glass' },
    el('div', { class: 'mini-stat-label' }, 'נשאר ליעדים'),
    el('div', { class: 'mini-stat-value' }, fmt.money(totalLeft)),
  ));

  const list = $('#goals-list');
  list.innerHTML = '';
  if (goals.length === 0) {
    list.appendChild(emptyState('🎯', 'אין יעדים', 'הגדר יעד ראשון כמו "טיסה לחו"ל" או "קרן חירום"'));
    return;
  }

  goals.forEach(g => {
    const saved = goalSaved(g);
    const target = Number(g.target) || 0;
    const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
    const remaining = Math.max(0, target - saved);
    const isComplete = saved >= target && target > 0;
    const daysLeft = g.deadline ? Math.ceil((new Date(g.deadline).getTime() - Date.now()) / (1000*60*60*24)) : null;

    const card = el('div', { class: 'goal-card glass' + (isComplete ? ' complete' : '') });
    card.appendChild(el('div', { class: 'goal-header' },
      el('div', { style: 'font-size: 32px;' }, g.icon || '🎯'),
      el('div', { style: 'flex:1; min-width:0;' },
        el('div', { class: 'goal-name' }, g.name),
        el('div', { class: 'goal-meta' },
          daysLeft != null
            ? (daysLeft >= 0 ? `${daysLeft} ימים ליעד` : `${-daysLeft} ימים אחרי היעד`)
            : (g.notes || ''))
      ),
    ));
    if (isComplete) card.querySelector('.goal-header').appendChild(el('div', { class: 'goal-badge' }, '✓ הושלם'));

    card.appendChild(el('div', { class: 'goal-progress-block' },
      el('div', { class: 'goal-amounts' },
        el('span', { class: 'saved' }, fmt.money(saved)),
        el('span', { class: 'sep' }, ' / '),
        el('span', { class: 'target' }, fmt.money(target)),
        el('span', { class: 'pct' }, Math.round(pct) + '%'),
      ),
      el('div', { class: 'budget-progress big' + (isComplete ? ' done' : '') },
        el('span', { style: { width: pct + '%' } })),
      remaining > 0
        ? el('div', { class: 'goal-remaining' }, `עוד ${fmt.money(remaining)} ליעד 💪`)
        : el('div', { class: 'goal-remaining done' }, '🎉 הגעת ליעד!'),
    ));
    card.appendChild(el('div', { class: 'goal-actions' },
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openContribModal(g) }, '+ הפקדה'),
      el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openGoalModal(g) }, 'עריכה'),
    ));
    list.appendChild(card);
  });
}

function openGoalModal(goal) {
  const isEdit = !!goal;
  const form = el('form');
  const nameInp = el('input', { class: 'input', required: true, value: goal?.name || '', placeholder: 'לדוגמה: טיסה לחו"ל' });
  const iconInp = el('input', { class: 'input', value: goal?.icon || '🎯', maxlength: 4 });
  const targetInp = el('input', { class: 'input', type: 'number', step: '1', required: true, value: goal?.target || 0, placeholder: '0' });
  const deadlineInp = el('input', { class: 'input', type: 'date', value: goal?.deadline ? fmt.dateInput(goal.deadline) : '' });
  const notesInp = el('textarea', { class: 'input', rows: 2, placeholder: 'הערות' });
  notesInp.value = goal?.notes || '';

  let contribSection = null;
  if (isEdit && goal.contributions && goal.contributions.length > 0) {
    contribSection = el('div', { style: 'border-top: 1px solid var(--border); padding-top: 12px;' });
    contribSection.appendChild(el('div', { style: 'font-size: 13px; font-weight: 700; margin-bottom: 8px;' }, 'הפקדות'));
    const ul = el('div', { class: 'payments-list' });
    goal.contributions.slice().sort((a,b) => (b.date||0) - (a.date||0)).forEach(c => {
      ul.appendChild(el('div', { class: 'payment-row' },
        el('div', {},
          el('div', { class: 'pay-amt' }, fmt.money(c.amount)),
          el('div', { class: 'pay-date' }, fmt.date(c.date)),
        ),
        el('div', { style: 'font-size: 12.5px; color: var(--text-2);' }, c.notes || ''),
        el('div', {}),
        el('button', { type: 'button', class: 'pay-del', onclick: () => {
          db.deleteContribution(goal.id, c.id);
          toast('ההפקדה נמחקה');
          closeModal();
          openGoalModal(db.getGoals().find(x => x.id === goal.id));
        } },
          el('svg', { viewBox: '0 0 24 24', width: 12, height: 12, html: '<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' })),
      ));
    });
    contribSection.appendChild(ul);
  }

  const footer = [
    el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
  ];
  if (isEdit) {
    footer.unshift(el('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
      closeModal();
      const ok = await confirmDialog({ title: 'מחיקת יעד', message: `למחוק את "${goal.name}"?`, confirmLabel: 'מחק', danger: true });
      if (!ok) { openGoalModal(goal); return; }
      db.deleteGoal(goal.id);
      toast('היעד נמחק');
      renderGoals();
    } }, 'מחק'));
  }
  footer.push(el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'עדכן' : 'הוסף'));

  form.append(
    field('שם היעד', nameInp),
    twoCol(field('אימוג׳י', iconInp), field('סכום יעד (₪)', targetInp)),
    field('תאריך יעד (אופציונלי)', deadlineInp),
    field('הערות', notesInp),
    contribSection,
    el('div', { class: 'modal-footer' }, ...footer),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: nameInp.value.trim(),
      icon: iconInp.value.trim() || '🎯',
      target: Number(targetInp.value) || 0,
      deadline: deadlineInp.value ? new Date(deadlineInp.value).getTime() : null,
      notes: notesInp.value.trim(),
    };
    if (isEdit) {
      db.updateGoal(goal.id, data);
      toast('היעד עודכן', 'success');
    } else {
      db.addGoal(data);
      toast('היעד נוסף', 'success');
    }
    closeModal();
    renderGoals();
  });

  openModal({ title: isEdit ? 'עריכת יעד' : 'יעד חדש', body: form });
  nameInp.focus();
}

function openContribModal(goal) {
  const form = el('form');
  const amountInp = el('input', { class: 'input', type: 'number', step: '0.01', required: true, value: '', placeholder: '0' });
  const dateInp = el('input', { class: 'input', type: 'date', value: fmt.dateInput(Date.now()) });
  const notesInp = el('textarea', { class: 'input', rows: 2, placeholder: 'הערות' });

  form.append(
    field(`כמה הופקד ליעד "${goal.name}"?`, amountInp),
    field('תאריך', dateInp),
    field('הערות', notesInp),
    el('div', { class: 'modal-footer' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, 'הוסף הפקדה'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    db.addContribution(goal.id, {
      amount: Number(amountInp.value) || 0,
      date: dateInp.value ? new Date(dateInp.value).getTime() : Date.now(),
      notes: notesInp.value.trim(),
    });
    closeModal();
    toast('הפקדה נוספה ליעד 🎯', 'success');
    renderGoals();
  });
  openModal({ title: '+ הפקדה', body: form });
  amountInp.focus();
}

/* ===========================================================
   Settings: Backup / Restore / Tithe report
   =========================================================== */
function renderSettings() {
  renderCloudCard();
  renderTitheReport();
}

function renderTitheReport() {
  const container = $('#tithe-report');
  container.innerHTML = '';
  const period = state.period;
  const incomes = db.getIncome().filter(i => inPeriod(i.date || i.createdAt, period));
  const total = incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const tithe = total * 0.1;
  const titheSet = incomes.filter(i => i.titheSet).reduce((s, i) => s + ((Number(i.amount) || 0) * 0.1), 0);
  const titheNotSet = Math.max(0, tithe - titheSet);

  container.appendChild(renderPeriodFilter(period, (p) => { state.period = p; renderSettings(); renderDashboard(); }));
  container.appendChild(el('div', { class: 'tithe-summary' },
    titheRow('סה"כ הכנסות בתקופה', fmt.money(total), 'income'),
    titheRow('חובת מעשר (10%)', fmt.money(tithe), 'planned'),
    titheRow('הופרש בפועל', fmt.money(titheSet), 'success'),
    titheRow('נותר להפריש', fmt.money(titheNotSet), titheNotSet > 0 ? 'warning' : 'success'),
  ));

  if (incomes.length > 0) {
    container.appendChild(el('div', { style: 'margin-top: 14px; font-size: 13px; font-weight: 700;' }, 'פירוט'));
    const ul = el('div', { class: 'tithe-list' });
    incomes.forEach(i => {
      const t = (Number(i.amount) || 0) * 0.1;
      ul.appendChild(el('div', { class: 'tithe-row' + (i.titheSet ? ' done' : '') },
        el('div', { class: 'name' }, i.source || 'הכנסה'),
        el('div', { class: 'date' }, fmt.date(i.date || i.createdAt)),
        el('div', { class: 'amt' }, fmt.money(t)),
        el('div', {}, i.titheSet ? '✓ הופרש' : '○ פתוח'),
      ));
    });
    container.appendChild(ul);
  }
}

function titheRow(label, value, kind) {
  return el('div', { class: 'tithe-summary-row ' + (kind || '') },
    el('span', { class: 'label' }, label),
    el('strong', {}, value),
  );
}

async function exportBackup() {
  const data = db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `heller-backup-${data.user}-${today}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('הגיבוי הורד 💾', 'success');
}

async function importBackup(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const ok = await confirmDialog({
      title: 'שחזור מגיבוי',
      message: `שחזור יחליף את כל הנתונים הנוכחיים שלך עם הנתונים מהקובץ "${file.name}". להמשיך?`,
      confirmLabel: 'שחזר',
      danger: true,
    });
    if (!ok) return;
    db.importAll(payload);
    toast('הנתונים שוחזרו 🎉', 'success');
    renderAll();
  } catch (err) {
    toast('שגיאה בקריאת הקובץ: ' + err.message, 'error');
  }
}

/* ===========================================================
   Quick expense (from FAB)
   =========================================================== */
function openQuickExpenseModal() {
  const cats = db.getBudget();
  if (cats.length === 0) {
    toast('הוסף קודם קטגוריה בעמוד התקציב', 'error');
    return;
  }

  const form = el('form');
  const catSel = el('select', { class: 'select', required: true },
    ...cats.map(c => el('option', { value: c.id }, `${c.icon || ''} ${c.name}`))
  );
  // Item dropdown - changes when category changes
  const itemSel = el('select', { class: 'select', required: true });
  const newItemInp = el('input', { class: 'input', placeholder: 'או הקלד שם סעיף חדש' });
  function refreshItems() {
    const cat = cats.find(c => c.id === catSel.value);
    itemSel.innerHTML = '';
    (cat?.items || []).forEach(i => {
      itemSel.appendChild(el('option', { value: i.id }, i.name));
    });
    if ((cat?.items || []).length === 0) {
      itemSel.appendChild(el('option', { value: '' }, '— אין סעיפים, הוסף חדש למטה —'));
      itemSel.disabled = true;
    } else {
      itemSel.appendChild(el('option', { value: '__new__' }, '+ סעיף חדש'));
      itemSel.disabled = false;
    }
  }
  catSel.addEventListener('change', refreshItems);
  refreshItems();

  const amountInp = el('input', { class: 'input', type: 'number', step: '0.01', required: true, placeholder: '0' });
  const dateInp = el('input', { class: 'input', type: 'date', value: fmt.dateInput(Date.now()) });
  const notesInp = el('textarea', { class: 'input', rows: 2, placeholder: 'הערות' });

  form.append(
    field('קטגוריה', catSel),
    field('סעיף', itemSel),
    field('או סעיף חדש', newItemInp),
    field('סכום (₪)', amountInp),
    field('תאריך', dateInp),
    field('הערות', notesInp),
    el('div', { class: 'modal-footer' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, 'הוסף הוצאה'),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const catId = catSel.value;
    let itemId = itemSel.value;
    const newName = newItemInp.value.trim();

    // If user typed a new item name OR chose "+ סעיף חדש"
    if (newName || itemId === '__new__') {
      const name = newName || prompt('שם הסעיף החדש:');
      if (!name) return;
      // Create item via db
      const fresh = { name, amount: 0 };
      db.addBudgetItem(catId, fresh);
      // Find the newly created item
      const cat = db.getBudget().find(c => c.id === catId);
      const created = cat.items[cat.items.length - 1];
      itemId = created.id;
    }

    if (!itemId || itemId === '__new__') {
      toast('בחר סעיף', 'error');
      return;
    }

    db.addPayment(catId, itemId, {
      amount: Number(amountInp.value) || 0,
      date: dateInp.value ? new Date(dateInp.value).getTime() : Date.now(),
      notes: notesInp.value.trim(),
    });
    closeModal();
    toast('ההוצאה נרשמה ✓', 'success');
    renderCurrent();
  });

  openModal({ title: '💸 הוצאה מהירה', body: form });
  amountInp.focus();
}

/* ===========================================================
   Monthly trend chart on dashboard
   =========================================================== */
function renderMonthlyTrend() {
  const container = $('#monthly-trend');
  if (!container) return;
  container.innerHTML = '';

  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = d.getTime();
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1;
    months.push({
      label: ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'][d.getMonth()],
      year: d.getFullYear(),
      start, end,
    });
  }

  // Compute income + expenses per month
  const allIncomes = db.getIncome();
  const allWeekly = db.getWeekly();
  const allBudget = db.getBudget();
  let maxVal = 1;
  const computed = months.map(m => {
    const period = { type: 'custom', start: m.start, end: m.end };
    const income = allIncomes.filter(i => inPeriod(i.date || i.createdAt, period))
                             .reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const weekly = allWeekly.filter(w => inPeriod(w.createdAt, period))
                            .reduce((s, w) => s + weeklyTotal(w), 0);
    const payments = allBudget.reduce((s, c) => s + (c.items || []).reduce((ss, it) => {
      return ss + (it.payments || []).filter(p => inPeriod(p.date, period)).reduce((sss, p) => sss + (Number(p.amount) || 0), 0);
    }, 0), 0);
    const expenses = weekly + payments;
    maxVal = Math.max(maxVal, income, expenses);
    return { ...m, income, expenses };
  });

  computed.forEach(m => {
    const incomeH = (m.income / maxVal) * 100;
    const expenseH = (m.expenses / maxVal) * 100;
    container.appendChild(el('div', { class: 'month-col' },
      el('div', { class: 'bars-vertical' },
        el('div', {
          class: 'bar income',
          style: { height: incomeH + '%' },
          title: 'הכנסות: ' + fmt.money(m.income),
        }),
        el('div', {
          class: 'bar expense',
          style: { height: expenseH + '%' },
          title: 'הוצאות: ' + fmt.money(m.expenses),
        }),
      ),
      el('div', { class: 'month-label' }, m.label),
    ));
  });

  // Legend
  const legend = $('#monthly-trend-legend');
  if (legend) {
    legend.innerHTML = '';
    legend.appendChild(el('span', { class: 'legend-item' }, el('span', { class: 'dot income' }), 'הכנסות'));
    legend.appendChild(el('span', { class: 'legend-item' }, el('span', { class: 'dot expense' }), 'הוצאות'));
  }
}

function renderDueBills() {
  const container = $('#due-bills');
  if (!container) return;
  container.innerHTML = '';
  const cats = db.getBudget();
  const bills = [];
  cats.forEach(cat => {
    (cat.items || []).forEach(item => {
      if (!item.recurring || !item.dueDay) return;
      if (paidThisMonth(item)) return; // already paid
      const days = daysUntilDueDay(item.dueDay);
      bills.push({ cat, item, days });
    });
  });
  bills.sort((a, b) => a.days - b.days);

  // Show only bills due in <= 14 days
  const urgent = bills.filter(b => b.days <= 14);
  if (urgent.length === 0) {
    container.parentElement.style.display = 'none';
    return;
  }
  container.parentElement.style.display = '';

  urgent.forEach(({ cat, item, days }) => {
    let cls = 'due-bill';
    let text = `בעוד ${days} ימים`;
    if (days === 0) { cls += ' due-now'; text = '⚠️ היום!'; }
    else if (days <= 3) { cls += ' due-soon'; text = `⚠️ בעוד ${days} ימים`; }
    container.appendChild(el('div', {
      class: cls,
      onclick: () => openBudgetItemModal(cat, item),
    },
      el('div', { class: 'left' },
        el('div', { class: 'name' }, `${cat.icon || '📦'} ${item.name}`),
        el('div', { class: 'meta' }, `${cat.name} • יום ${item.dueDay} בחודש`),
      ),
      el('div', { class: 'right' },
        el('div', { class: 'days' }, text),
        el('div', { class: 'amt' }, fmt.money(item.amount)),
      ),
    ));
  });
}

/* ===========================================================
   Cloud sync UI (Firebase)
   =========================================================== */
function renderCloudCard() {
  const statusEl = $('#cloud-status');
  const actionsEl = $('#cloud-actions');
  if (!statusEl || !actionsEl) return;
  statusEl.innerHTML = '';
  actionsEl.innerHTML = '';

  const cfg = cloud.getStoredConfig();
  const authState = cloud.getCurrentAuthState();

  if (!cfg) {
    statusEl.appendChild(el('div', { class: 'cloud-pill off' }, '⚪ לא מחובר — אין סנכרון'));
    actionsEl.appendChild(el('button', { class: 'btn btn-primary', onclick: openConfigureCloudModal }, 'התחבר לסנכרון'));
    return;
  }

  if (!authState) {
    statusEl.appendChild(el('div', { class: 'cloud-pill warning' }, '🔧 Firebase מוגדר — צריך להתחבר'));
    actionsEl.appendChild(el('button', { class: 'btn btn-primary', onclick: openSignInModal }, 'התחברות / רישום'));
    actionsEl.appendChild(el('button', { class: 'btn btn-secondary', onclick: resetCloudConfig }, 'איפוס הגדרות Firebase'));
    return;
  }

  // Connected and signed in
  statusEl.appendChild(el('div', { class: 'cloud-pill connected' },
    '✅ מחובר כ-', el('strong', {}, authState.email)
  ));
  statusEl.appendChild(el('div', { class: 'cloud-hint' },
    `הנתונים מסונכרנים אוטומטית. אשתך מתחברת מטלפון אחר עם אותו אימייל וסיסמה ורואה את אותו דבר.`
  ));
  actionsEl.appendChild(el('button', { class: 'btn btn-secondary', onclick: doSyncNow }, '🔄 סנכרן עכשיו'));
  actionsEl.appendChild(el('button', { class: 'btn btn-secondary', onclick: doSignOutCloud }, 'התנתק מהענן'));
  actionsEl.appendChild(el('button', { class: 'btn btn-danger', onclick: resetCloudConfig }, 'איפוס הגדרות'));
}

function openConfigureCloudModal() {
  const form = el('form');
  const ta = el('textarea', {
    class: 'input',
    rows: 12,
    required: true,
    placeholder: 'הדבק כאן את האובייקט firebaseConfig מאתר Firebase…\n\nconst firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  databaseURL: "...",\n  projectId: "...",\n  ...\n};'
  });
  const err = el('div', { style: 'color: #fca5a5; font-size: 13px; min-height: 18px;' });

  form.append(
    field('Firebase Config', ta),
    err,
    el('div', { class: 'modal-footer' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, 'שמור והמשך'),
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    let config = null;
    try {
      config = parseFirebaseConfig(ta.value);
    } catch (e) {
      err.textContent = e.message;
      return;
    }
    const valErr = cloud.validateConfig(config);
    if (valErr) { err.textContent = valErr; return; }
    try {
      cloud.storeConfig(config);
      await cloud.initWithConfig(config);
      toast('Firebase מוגדר ✓', 'success');
      closeModal();
      renderCloudCard();
      openSignInModal();
    } catch (e) {
      err.textContent = 'שגיאה: ' + (e.message || e);
    }
  });

  openModal({ title: 'הגדרת Firebase', body: form, large: true });
  ta.focus();
}

// Accept anything: raw JSON, `const firebaseConfig = {...}`, or the full
// Firebase setup snippet that includes import statements and comments.
function parseFirebaseConfig(text) {
  text = (text || '').trim();
  if (!text) throw new Error('שדה ריק');

  // 1. Try parsing the entire input as JSON
  try {
    const r = JSON.parse(text);
    if (r && typeof r === 'object' && r.apiKey) return r;
  } catch {}

  // 2. Locate "firebaseConfig" in the snippet and look for the object after it
  let searchFrom = 0;
  const idx = text.indexOf('firebaseConfig');
  if (idx !== -1) {
    const eq = text.indexOf('=', idx);
    if (eq !== -1) searchFrom = eq;
  }

  // 3. Extract the first balanced {...} block (string-aware, brace-counting)
  const obj = extractObjectBlock(text, searchFrom);
  if (!obj) {
    throw new Error('לא מצאתי את האובייקט { apiKey: ... } בטקסט. הדבק את כל הבלוק שמתחיל ב "const firebaseConfig = {" עד "}".');
  }

  // 4. Parse as JSON first
  try { return JSON.parse(obj); } catch {}

  // 5. Parse as JS literal (handles unquoted keys, trailing commas, single quotes)
  try {
    return Function('"use strict";return (' + obj + ')')();
  } catch (e) {
    throw new Error('הצלחתי למצוא את האובייקט אבל לא להמיר אותו. ודא שהעתקת את כל הבלוק נכון.');
  }
}

function extractObjectBlock(text, startFrom = 0) {
  const startIdx = text.indexOf('{', startFrom);
  if (startIdx === -1) return null;
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.substring(startIdx, i + 1);
    }
  }
  return null;
}

function openSignInModal() {
  const form = el('form');
  const tabBtns = el('div', { class: 'auth-tabs' },
    el('button', { type: 'button', class: 'auth-tab active', dataset: { mode: 'signin' } }, 'התחברות'),
    el('button', { type: 'button', class: 'auth-tab', dataset: { mode: 'signup' } }, 'יצירת חשבון')
  );
  let mode = 'signin';
  tabBtns.querySelectorAll('.auth-tab').forEach(b => b.addEventListener('click', () => {
    tabBtns.querySelectorAll('.auth-tab').forEach(x => x.classList.toggle('active', x === b));
    mode = b.dataset.mode;
    submitBtn.textContent = mode === 'signin' ? 'התחבר' : 'צור חשבון משותף';
  }));

  const emailInp = el('input', { class: 'input', type: 'email', required: true, placeholder: 'family@example.com', autocomplete: 'email' });
  const passInp = el('input', { class: 'input', type: 'password', required: true, minlength: 6, placeholder: 'לפחות 6 תווים', autocomplete: 'current-password' });
  const err = el('div', { style: 'color: #fca5a5; font-size: 13px; min-height: 18px;' });
  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'התחבר');

  form.append(
    tabBtns,
    el('div', { style: 'font-size:12.5px; color:var(--text-3); margin-bottom:8px;' },
      'הכניסו את שניכם את אותם אימייל וסיסמה — זה הופך אתכם לחשבון משותף.'),
    field('אימייל', emailInp),
    field('סיסמה', passInp),
    err,
    submitBtn,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = '...';
    try {
      const fn = mode === 'signin' ? cloud.signIn : cloud.signUp;
      await fn(emailInp.value.trim(), passInp.value);
      closeModal();
      toast(mode === 'signin' ? 'מחובר ✓' : 'חשבון נוצר ומחובר ✓', 'success');
      await onCloudConnected();
    } catch (e) {
      err.textContent = humanFirebaseError(e);
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'signin' ? 'התחבר' : 'צור חשבון משותף';
    }
  });

  openModal({ title: '☁️ חיבור לחשבון משותף', body: form });
  emailInp.focus();
}

function humanFirebaseError(e) {
  const code = e?.code || '';
  if (code.includes('operation-not-allowed'))
    return 'שיטת Email/Password לא הופעלה ב-Firebase. כנס ל-Firebase Console → Authentication → Sign-in method → לחץ על "Email/Password" → Enable → Save. אחר כך נסה שוב.';
  if (code.includes('email-already-in-use')) return 'אימייל כבר רשום — נסה "התחברות"';
  if (code.includes('invalid-email')) return 'אימייל לא תקין';
  if (code.includes('weak-password')) return 'סיסמה חלשה — נסה לפחות 6 תווים';
  if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'אימייל או סיסמה שגויים';
  if (code.includes('user-not-found')) return 'משתמש לא קיים — עבור ללשונית "יצירת חשבון"';
  if (code.includes('network-request-failed')) return 'בעיית חיבור לאינטרנט';
  if (code.includes('too-many-requests')) return 'יותר מדי ניסיונות — נסה שוב מאוחר יותר';
  if (code.includes('configuration-not-found') || code.includes('admin-restricted-operation'))
    return 'Firebase Authentication לא מוגדר. ודא ש-Email/Password מופעל ב-Sign-in method.';
  return e?.message || 'שגיאה לא ידועה';
}

async function onCloudConnected() {
  // Decide: pull or push?
  // - If cloud has data, ask user whether to pull or push (overwrite).
  // - If cloud is empty, push local.
  const remote = await cloud.pull();
  const session = getSession();
  if (!session) return;
  const local = collectAllData(session.username);
  const localHasData = Object.values(local).some(v => Array.isArray(v) && v.length > 0);
  const remoteHasData = remote && Object.keys(remote).some(k => k !== '_meta' && Array.isArray(remote[k]) && remote[k].length > 0);

  if (remoteHasData && localHasData) {
    const choice = await chooseSyncDirection();
    if (choice === 'pull') {
      applyCloudData(session.username, remote);
      toast('נתונים נטענו מהענן', 'success');
    } else if (choice === 'push') {
      await cloud.push(local);
      toast('הנתונים המקומיים הועלו לענן', 'success');
    }
  } else if (remoteHasData) {
    applyCloudData(session.username, remote);
    toast('נתונים נטענו מהענן', 'success');
  } else {
    await cloud.push(local);
    toast('הנתונים שלך הועלו לענן 🚀', 'success');
  }

  // Subscribe to remote changes from other devices
  cloud.watchRemote((data) => {
    applyCloudData(session.username, data);
    renderAll();
    toast('נתונים סונכרנו ממכשיר אחר 🔄', 'success');
  });

  renderAll();
  renderCloudCard();
}

function chooseSyncDirection() {
  return new Promise((resolve) => {
    const body = el('div', {},
      el('p', { style: 'margin: 4px 0 14px; color: var(--text-2);' },
        'גם במכשיר הזה וגם בענן יש נתונים. איזה צד שומרים?'),
      el('div', { style: 'display:flex; flex-direction:column; gap:10px;' },
        el('button', { class: 'btn btn-primary', onclick: () => { closeModal(); resolve('pull'); } },
          '⬇️  השתמש בנתונים מהענן (יחליף את המקומיים)'),
        el('button', { class: 'btn btn-secondary', onclick: () => { closeModal(); resolve('push'); } },
          '⬆️  העלה את הנתונים המקומיים לענן (יחליף את הענן)'),
        el('button', { class: 'btn btn-ghost', onclick: () => { closeModal(); resolve('cancel'); } },
          'בטל — אל תסנכרן כעת'),
      ),
    );
    openModal({ title: 'יש התנגשות נתונים', body, onClose: () => resolve('cancel') });
  });
}

async function doSyncNow() {
  const session = getSession();
  if (!session) return;
  toast('מסנכרן...');
  const remote = await cloud.pull();
  if (remote) {
    applyCloudData(session.username, remote);
    renderAll();
  }
  await cloud.push(collectAllData(session.username));
  toast('סונכרן ✓', 'success');
  renderCloudCard();
}

async function doSignOutCloud() {
  await cloud.signOutCloud();
  toast('התנתקת מהענן');
  renderCloudCard();
}

async function resetCloudConfig() {
  const ok = await confirmDialog({
    title: 'איפוס הגדרות Firebase',
    message: 'הפעולה תמחק את הגדרות Firebase במכשיר הזה (אבל הנתונים בענן יישמרו). תוכל להגדיר מחדש או להתחבר בחזרה. להמשיך?',
    confirmLabel: 'אפס',
    danger: true,
  });
  if (!ok) return;
  await cloud.signOutCloud().catch(() => {});
  cloud.clearStoredConfig();
  toast('הגדרות אופסו');
  // Reload to clear in-memory Firebase state
  setTimeout(() => location.reload(), 500);
}

/* Cloud bootstrap — runs once at app load */
(async function bootCloud() {
  const state = await cloud.autoBoot();
  if (state) {
    // Auto-subscribe and pull on app start
    const session = getSession();
    if (session) {
      try {
        const remote = await cloud.pull();
        if (remote) applyCloudData(session.username, remote);
        cloud.watchRemote((data) => {
          applyCloudData(session.username, data);
          renderAll();
        });
      } catch (e) {
        console.warn('cloud boot pull failed', e);
      }
    }
  }
})();

