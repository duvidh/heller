// Data persistence + multi-user storage layer
import { DEFAULT_ITEMS, DEFAULT_BUDGET_CATEGORIES, PRODUCT_CATEGORIES } from './data.js';

const NS = 'heller_v1';
const USERS_KEY = `${NS}.users`;
const SESSION_KEY = `${NS}.session`;

/* --------- User management --------- */
export function listUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; }
  catch { return {}; }
}

export function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

async function sha(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

export async function registerUser({ username, password, name }) {
  username = username.trim().toLowerCase();
  if (!username || !password) throw new Error('שם משתמש וסיסמה נדרשים');
  const users = listUsers();
  if (users[username]) throw new Error('שם המשתמש כבר תפוס');
  const passHash = await sha(password);
  users[username] = { username, name: name?.trim() || username, passHash, createdAt: Date.now() };
  saveUsers(users);
  // Initialize user's data
  initUserData(username);
  return users[username];
}

export async function loginUser({ username, password }) {
  username = username.trim().toLowerCase();
  const users = listUsers();
  let user = users[username];

  // Auto-create demo user
  if (!user && username === 'demo' && password === 'demo') {
    await registerUser({ username: 'demo', password: 'demo', name: 'משתמש דמו' });
    user = listUsers()[username];
  }

  if (!user) throw new Error('משתמש לא קיים');
  const passHash = await sha(password);
  if (passHash !== user.passHash) throw new Error('סיסמה שגויה');
  setSession(username);
  return user;
}

export function getSession() {
  const u = localStorage.getItem(SESSION_KEY);
  if (!u) return null;
  const users = listUsers();
  return users[u] || null;
}

export function setSession(username) {
  localStorage.setItem(SESSION_KEY, username);
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/* --------- Per-user data --------- */
function userKey(username, name) {
  return `${NS}.${username}.${name}`;
}

function read(username, name, fallback) {
  try {
    const raw = localStorage.getItem(userKey(username, name));
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}

function write(username, name, data) {
  localStorage.setItem(userKey(username, name), JSON.stringify(data));
}

function uuid() {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function initUserData(username) {
  // Tag default items with IDs
  const items = DEFAULT_ITEMS.map(it => ({ ...it, id: uuid() }));
  write(username, 'shopping', items);

  // Budget categories
  const cats = DEFAULT_BUDGET_CATEGORIES.map(c => ({
    ...c,
    id: uuid(),
    items: (c.items || []).map(i => ({ ...i, id: uuid() })),
  }));
  write(username, 'budget', cats);

  // Product categories
  const pcats = PRODUCT_CATEGORIES.map(c => ({ ...c, id: uuid() }));
  write(username, 'productCategories', pcats);

  // Weekly & Income empty
  write(username, 'weekly', []);
  write(username, 'income', []);
}

// Merge defaults from Excel into user's budget without losing user data.
// - Adds missing top-level categories.
// - For each existing category, adds missing items (matched by name).
export function mergeBudgetDefaults() {
  const username = currentUserName();
  const existing = read(username, 'budget', []);
  const byName = new Map(existing.map(c => [c.name, c]));
  let addedCats = 0, addedItems = 0;

  DEFAULT_BUDGET_CATEGORIES.forEach(def => {
    const cur = byName.get(def.name);
    if (!cur) {
      const fresh = {
        ...def,
        id: uuid(),
        items: (def.items || []).map(i => ({ ...i, id: uuid() })),
      };
      existing.push(fresh);
      addedCats++;
      addedItems += fresh.items.length;
    } else {
      const itemNames = new Set((cur.items || []).map(i => i.name));
      (def.items || []).forEach(i => {
        if (!itemNames.has(i.name)) {
          cur.items = cur.items || [];
          cur.items.push({ ...i, id: uuid() });
          addedItems++;
        }
      });
      // Backfill icon/color/linkedToShopping if missing
      if (def.icon && !cur.icon) cur.icon = def.icon;
      if (def.color && !cur.color) cur.color = def.color;
      if (def.linkedToShopping && cur.linkedToShopping == null) cur.linkedToShopping = true;
    }
  });

  write(username, 'budget', existing);
  return { addedCats, addedItems };
}

/* --------- Data accessors (current session) --------- */
function currentUser() {
  const u = getSession();
  if (!u) throw new Error('לא מחובר');
  return u.username;
}
const currentUserName = currentUser;

export const db = {
  // Shopping items
  getItems() { return read(currentUser(), 'shopping', []); },
  setItems(items) { write(currentUser(), 'shopping', items); },
  addItem(item) {
    const items = this.getItems();
    item.id = uuid();
    item.total = (item.monthlyQty || 0) * (item.price || 0);
    items.push(item);
    this.setItems(items);
    return item;
  },
  updateItem(id, patch) {
    const items = this.getItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch };
    items[idx].total = (items[idx].monthlyQty || 0) * (items[idx].price || 0);
    this.setItems(items);
    return items[idx];
  },
  deleteItem(id) {
    const items = this.getItems().filter(i => i.id !== id);
    this.setItems(items);
  },

  // Budget categories
  getBudget() { return read(currentUser(), 'budget', []); },
  setBudget(cats) { write(currentUser(), 'budget', cats); },
  addBudgetCategory(cat) {
    const cats = this.getBudget();
    cat.id = uuid();
    cat.items = cat.items || [];
    cats.push(cat);
    this.setBudget(cats);
    return cat;
  },
  updateBudgetCategory(id, patch) {
    const cats = this.getBudget();
    const idx = cats.findIndex(c => c.id === id);
    if (idx === -1) return null;
    cats[idx] = { ...cats[idx], ...patch };
    this.setBudget(cats);
    return cats[idx];
  },
  deleteBudgetCategory(id) {
    this.setBudget(this.getBudget().filter(c => c.id !== id));
  },
  addBudgetItem(catId, item) {
    const cats = this.getBudget();
    const cat = cats.find(c => c.id === catId);
    if (!cat) return;
    item.id = uuid();
    cat.items = cat.items || [];
    cat.items.push(item);
    this.setBudget(cats);
  },
  updateBudgetItem(catId, itemId, patch) {
    const cats = this.getBudget();
    const cat = cats.find(c => c.id === catId);
    if (!cat) return;
    const it = cat.items.find(i => i.id === itemId);
    if (it) Object.assign(it, patch);
    this.setBudget(cats);
  },
  deleteBudgetItem(catId, itemId) {
    const cats = this.getBudget();
    const cat = cats.find(c => c.id === catId);
    if (!cat) return;
    cat.items = (cat.items || []).filter(i => i.id !== itemId);
    this.setBudget(cats);
  },

  // Product categories (for shopping list grouping)
  getProductCategories() { return read(currentUser(), 'productCategories', []); },
  setProductCategories(cats) { write(currentUser(), 'productCategories', cats); },
  addProductCategory(cat) {
    const cats = this.getProductCategories();
    cat.id = uuid();
    cats.push(cat);
    this.setProductCategories(cats);
    return cat;
  },
  updateProductCategory(id, patch) {
    const cats = this.getProductCategories();
    const idx = cats.findIndex(c => c.id === id);
    if (idx > -1) {
      const oldName = cats[idx].name;
      cats[idx] = { ...cats[idx], ...patch };
      // Update items that referenced this category
      if (patch.name && patch.name !== oldName) {
        const items = this.getItems();
        items.forEach(i => { if (i.productCategory === oldName) i.productCategory = patch.name; });
        this.setItems(items);
      }
      this.setProductCategories(cats);
    }
  },
  deleteProductCategory(id) {
    this.setProductCategories(this.getProductCategories().filter(c => c.id !== id));
  },

  // Weekly shopping
  getWeekly() { return read(currentUser(), 'weekly', []); },
  setWeekly(list) { write(currentUser(), 'weekly', list); },
  addWeekly(week) {
    const list = this.getWeekly();
    week.id = uuid();
    week.createdAt = Date.now();
    week.items = week.items || [];
    list.unshift(week);
    this.setWeekly(list);
    return week;
  },
  updateWeekly(id, patch) {
    const list = this.getWeekly();
    const idx = list.findIndex(w => w.id === id);
    if (idx > -1) {
      list[idx] = { ...list[idx], ...patch };
      this.setWeekly(list);
      return list[idx];
    }
  },
  deleteWeekly(id) {
    this.setWeekly(this.getWeekly().filter(w => w.id !== id));
  },

  // Income
  getIncome() { return read(currentUser(), 'income', []); },
  setIncome(list) { write(currentUser(), 'income', list); },
  addIncome(inc) {
    const list = this.getIncome();
    inc.id = uuid();
    inc.createdAt = Date.now();
    list.unshift(inc);
    this.setIncome(list);
    return inc;
  },
  updateIncome(id, patch) {
    const list = this.getIncome();
    const idx = list.findIndex(i => i.id === id);
    if (idx > -1) {
      list[idx] = { ...list[idx], ...patch };
      this.setIncome(list);
      return list[idx];
    }
  },
  deleteIncome(id) {
    this.setIncome(this.getIncome().filter(i => i.id !== id));
  },
};

export { uuid };
