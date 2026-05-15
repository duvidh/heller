---
name: heller-app
description: Heller budget app development guide. Use whenever working in the heller repo on UI, data model, mobile layout, RTL Hebrew, GitHub Pages deploy, or extending the multi-user budget/shopping/income features. Read this before adding tabs, fields, fixing bugs, or restructuring code.
---

# Heller — Budget Management App Development Skill

This skill is the playbook for working on Heller. Always read it (plus
`/CLAUDE.md`) before editing code. It captures the architecture, the
intentional design choices, the bugs we already fixed (so we don't
re-introduce them), and step-by-step recipes for common tasks.

---

## 1. Architecture at a glance

**Stack:** Pure HTML + CSS + ES Modules. No build, no framework, no server.

**Persistence:** `localStorage`, namespaced per user (`heller_v1.<username>.<entity>`).

**Auth:** Username + SHA-256 hashed password, all client-side. No real
backend. "Multi-user" = multiple users share the same browser, each
with isolated data. A user on a different device sees nothing — there
is no sync.

**Routing:** Tab switching via JS, no URL hash. The active tab lives
in `state.tab` inside `app.js`.

**Rendering:** Imperative. `render<TabName>()` clears a container and
rebuilds DOM via the `el()` helper in `js/ui.js`. No diffing.

---

## 2. Files & responsibilities

| File | What goes here | What does NOT go here |
|------|----------------|----------------------|
| `index.html` | Static structure: auth screen + 6 tabs + modal shell + toast. All tab containers exist in DOM, hidden via `.hidden`. | Inline scripts, inline styles beyond tiny one-offs. |
| `css/styles.css` | Every style. Organized: reset → variables → layout → components → mobile media query at the bottom. | Component-scoped style; everything is global. |
| `js/data.js` | Pure seed data, exported as constants. `DEFAULT_ITEMS` (130 products), `DEFAULT_BUDGET_CATEGORIES`, `PRODUCT_CATEGORIES`, `UNITS`, `INCOME_SOURCES`. | Logic, side effects, imports. |
| `js/storage.js` | Auth (`registerUser`, `loginUser`, `getSession`, `clearSession`), the `db` object with `getItems/setItems/addItem/...` per entity, and `mergeBudgetDefaults()` for migrating existing users. | UI, DOM, rendering. |
| `js/ui.js` | DOM helper `el()`, query helpers `$`/`$$`, `openModal`/`closeModal`/`confirmDialog`, `toast`, `fmt` (money/date), `categorySwatch`. | Business logic. |
| `js/app.js` | Everything else: tab switching, render functions per tab, modal builders, event wiring. | Persistence (always go through `db`). |

---

## 3. Data model (localStorage keys, per user)

```
heller_v1.<username>.shopping             → Item[]
heller_v1.<username>.budget               → BudgetCategory[]
heller_v1.<username>.productCategories    → ProductCategory[]
heller_v1.<username>.weekly               → WeeklyShop[]
heller_v1.<username>.income               → Income[]
```

### Entity shapes

```js
// Shopping item (the "main list")
Item = {
  id, name, productCategory, budgetCategory,
  unit, weeklyQty, monthlyQty, price, total,  // total = monthlyQty * price
}

// Budget
BudgetCategory = {
  id, name, icon, color,
  linkedToShopping?: boolean,   // if true, total = manual items + sum of shopping items whose budgetCategory matches
  items: BudgetItem[],
}
BudgetItem = { id, name, amount }

// Product category (for grouping items in the shopping list UI)
ProductCategory = { id, name, icon, color }

// Weekly shopping snapshot
WeeklyShop = {
  id, name, createdAt,
  items: WeeklyItem[],
}
WeeklyItem = { name, unit, qty, price }   // NO id — they're a frozen snapshot

// Income
Income = {
  id, source, amount, date, notes, titheSet, deposited, createdAt
}
```

### Key invariants

- **Weekly snapshots are isolated.** Changing qty/price inside a
  `WeeklyShop.items[]` MUST NOT touch the main `Item[]`. This is the
  whole point of weekly snapshots and is what the user explicitly
  asked for. Don't refactor weekly items to hold a reference to a
  master `itemId`.
- **`Item.total` is derived from `monthlyQty * price`**, computed in
  `db.addItem` / `db.updateItem`. Never write `total` directly from
  the UI.
- **Budget totals are derived too.** `computeCategoryBudgetTotal(cat)`
  sums `cat.items[].amount` and, if `linkedToShopping`, adds the
  matching shopping totals via `computeShoppingTotalsByBudgetCat`.

---

## 4. Bugs we already fixed — DON'T repeat them

### 4.1 SVG namespace
`document.createElement('svg')` creates an `HTMLUnknownElement`, not
an SVG element — browsers refuse to render its paths. All dynamic
SVGs go through `el()`, which routes SVG tags to
`createElementNS('http://www.w3.org/2000/svg', tag)`.

The `SVG_TAGS` set in `ui.js` lists every tag we use. If you add a
new SVG tag (e.g. `<filter>`), append it to that set.

### 4.2 `null` becomes the string "null"
`Element.append(child1, null, child2)` stringifies null. So this is wrong:

```js
card.append(header, cat.linkedToShopping ? badge : null, total);
```

Use one of:
```js
card.appendChild(header);
if (cat.linkedToShopping) card.appendChild(badge);
card.appendChild(total);
```
…or use `el()` (which filters `null`/`false` children).

### 4.3 RTL flex sidebar
On mobile we slide the sidebar from the right. It must be anchored
with `right: 0; left: auto;` and translated `translateX(110%)` when
closed. `inset: 0 auto 0 0` (left:0) caused a 80px strip of the panel
to bleed onto the right edge.

### 4.4 Picker grid on narrow screens
A 4-column grid (name 1fr, price 80, qty 70, price 70) doesn't fit on
a 360px viewport — the name got clipped right (which is the start of
RTL text). The picker now stacks: header row (name + price), then a
1fr 1fr grid of labeled qty/price inputs.

### 4.5 Cache busting
GitHub Pages and mobile browsers cache CSS/JS aggressively. After
any deploy, bump `?v=N` on both:
```html
<link rel="stylesheet" href="css/styles.css?v=N" />
<script type="module" src="js/app.js?v=N"></script>
```
Otherwise the user keeps seeing the old version.

### 4.6 Emoji at the start of an RTL placeholder
`placeholder="🔍 חפש מוצר..."` rendered the emoji visually on the
left (= end in RTL), confusing users into thinking the search icon
was at the wrong side. Either drop the emoji or put it at the end of
the string.

---

## 5. Conventions

### Visual language

- **Dark only.** Backgrounds use the gradient orbs + glass surfaces.
  Never introduce a light theme color directly — use the CSS variables.
- **Gradient is `var(--grad-primary)`** (purple → teal). Use it for
  primary CTA, active states, "value" numbers on stat cards.
- **Glassmorphism** via `.glass` (blur + subtle border + dark
  semi-transparent bg). Use it on every card-like surface.
- **Spacing scale:** 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32. Stick to
  these in `gap`, `padding`, `margin`.
- **Radii:** small interactive elements 8–11px, cards 12–18px,
  large cards / modal 18–24px.

### CSS

- Mobile fixes live at the bottom of `styles.css` under
  `@media (max-width: 760px)`.
- Use logical properties for anything direction-sensitive:
  `inset-inline-start`, `padding-inline-end`, `border-inline-start`.
- The breakpoint is **760px** (not 768 or 800). Don't change it.

### JS

- ES modules. Each file `export`s explicit functions.
- No async I/O except `crypto.subtle` for the password hash.
- All persistence flows through `db` in `storage.js`. UI never
  reads/writes `localStorage` directly.
- Every modal that mutates state must call `closeModal()` on submit,
  and the render function for the tab that owns the data.

---

## 6. Recipes

### 6.1 Add a new field to an entity

Example: add `note` to `Item`.

1. **No migration needed for localStorage** — JSON tolerates missing keys.
2. `data.js` → optionally add `note: ''` to default items.
3. `storage.js` → no change (the `db` setters use spread).
4. `app.js` →
   - `openItemModal()`: add an `<input>` for note, default to `item?.note || ''`.
   - `renderShopping()`: render `it.note` somewhere if set.
5. Bump the cache buster.

### 6.2 Add a new tab

1. `index.html`:
   - Add a `<section class="page hidden" id="page-<name>">` inside `<main>`.
   - Add a button `<button class="nav-item" data-tab="<name>">…</button>` in the sidebar nav, and (if it belongs there) in `.bottom-nav`.
   - Add a title entry to `titles` in `switchTab()`.
2. `app.js`:
   - Create `render<Name>()` and call it from `renderCurrent()` switch.
   - If it needs its own data, add getter/setter on `db`.
3. Bump cache buster.

### 6.3 Add a new chart or stat

The dashboard chart is just a list of `bar-row` divs. To add a chart,
build a similar structure or reuse the pattern in
`renderDashboard()`. Don't introduce a chart library — they bloat the
bundle and break offline.

### 6.4 Reset / sync defaults for existing users

`mergeBudgetDefaults()` in `storage.js` is the pattern: walk the
default array, add anything missing by name, don't overwrite the
user's existing values. Use the same shape if you ever need to merge
defaults for items or product categories.

### 6.5 Adding a new modal

```js
function openMyModal(maybeEditTarget) {
  const isEdit = !!maybeEditTarget;
  const form = el('form');
  // ... inputs
  form.append(
    field('Label', input),
    el('div', { class: 'modal-footer' },
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: closeModal }, 'ביטול'),
      el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'עדכן' : 'הוסף'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // ... db.add/update
    closeModal();
    toast('...', 'success');
    renderCurrent(); // or the specific render for that tab
  });
  openModal({ title: isEdit ? '...' : '...', body: form });
  input.focus();
}
```

---

## 7. Testing checklist before pushing

- [ ] Open auth screen, login as `demo` / `demo`. Should succeed.
- [ ] Bottom nav works on mobile (Chrome devtools, iPhone 12 viewport).
- [ ] Hamburger button visible at **top right** on mobile.
- [ ] Sidebar slides in from the right, fully off-screen when closed.
- [ ] Shopping page: search filters, category filter works, totals
      per category sum the visible items.
- [ ] Weekly shopping: create one, add via picker, add an ad-hoc
      item, change qty in detail — verify main shopping list
      unchanged.
- [ ] Budget page: "השלם מהאקסל" doesn't duplicate existing items;
      linked categories sum correctly.
- [ ] Income page: tithe preview updates as you type the amount.
- [ ] No `null` strings rendered anywhere.
- [ ] No broken icon squares (every action button has a visible SVG).
- [ ] `node --check` passes for every JS file.

---

## 8. Roadmap candidates (financial-advisor lens)

Not implemented yet, but worth proposing when the user asks "what
next?":

1. **Period filter** — view "this month / last month / specific month".
   Today all data is "all time".
2. **Actual vs. budget** — show `[planned: ₪X, spent: ₪Y, %used]` per
   category, sourcing "spent" from weekly shopping + manual expense
   entries.
3. **Goals / savings tracker** — name, target, current, target date,
   progress bar.
4. **Recurring bills** — mark a budget item as monthly recurring with
   a due day; surface "due in 3 days" badges.
5. **Export/Import** — JSON download for backup, JSON upload to
   restore. Optional: CSV/Excel.
6. **PWA** — manifest + service worker so it installs and works
   offline. Right now `?v=N` cache-busting is fragile.
7. **Cloud sync** — Firebase free tier or Supabase. Currently
   "multi-user" works only on a single device.
8. **Receipt OCR** — `<input capture="environment">` + a small OCR
   service to auto-create weekly items.
9. **Tithe history & reports** — who you gave to, when, running
   totals, exportable for tax purposes.
10. **Charts** — small inline bar/donut SVGs (don't bring in Chart.js).

---

## 9. Decision log

- **Why no framework?** Single deliverable, zero build, works on
  GitHub Pages with no config, easy for the user to host elsewhere.
- **Why localStorage and not IndexedDB?** Total data per user is
  tiny (KB-scale). The complexity isn't worth it.
- **Why no API?** Anonymous users from the web shouldn't need to
  trust a server with their financial data. Trade-off: no sync.
- **Why SHA-256 of password?** Honesty signal — we don't store the
  plaintext. It's not a real security boundary (anyone with the
  device can read the hash). The real protection is the user's
  device.
