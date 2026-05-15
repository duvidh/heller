# Heller — Budget Management App

> **קרא את הקובץ הזה לפני כל שינוי בקוד.** הוא מסכם את הארכיטקטורה, המוסכמות והבאגים הידועים כדי שלא תתחיל מאפס בכל שיחה.

For deeper how-to (adding a tab, adding a field, common pitfalls), see
**`.claude/skills/heller-app/SKILL.md`**.

## מה זה

אפליקציית web סטטית לניהול תקציב משפחתי. רבת-משתתפים (לכל אחד נתונים משלו ב-localStorage), RTL עברית, dark theme, רספונסיבי, ללא build step.

מתארחת ב-GitHub Pages: https://duvidh.github.io/heller/

## ענף עבודה

`claude/budget-management-app-adIHy` (זה גם ענף ברירת המחדל של המאגר).

## מבנה קבצים

```
heller/
├── index.html              ← מבנה ה-HTML היחיד, כל הלשוניות
├── css/
│   └── styles.css          ← כל ה-CSS (מובייל-first, RTL, dark)
├── js/
│   ├── data.js             ← seed data (130 מוצרים, קטגוריות) מאקסל
│   ├── storage.js          ← localStorage layer + auth + db API
│   ├── ui.js               ← el(), modal, toast, fmt
│   └── app.js              ← main controller, render-per-tab, modals
├── .claude/
│   └── skills/heller-app/
│       └── SKILL.md        ← מדריך מפורט להמשך פיתוח
└── CLAUDE.md               ← הקובץ הזה
```

## הרצה מקומית

```bash
python3 -m http.server 8000
# פתח http://localhost:8000
```

לא לפתוח את `index.html` ישירות (`file://`) — ES modules דורשים שרת.

## אחרי שינוי CSS/JS

תמיד להגדיל את ה-cache-buster ב-`index.html`:
```html
<link rel="stylesheet" href="css/styles.css?v=N" />
<script type="module" src="js/app.js?v=N"></script>
```
אחרת המשתמש בנייד יראה את הגרסה הישנה (GitHub Pages CDN + browser cache).

## דחיפה

הענף הוא ברירת המחדל ב-GitHub Pages. כל push לענף → deploy אוטומטי תוך 1-2 דקות.

```bash
git add -A
git commit -m "..."
git push -u origin claude/budget-management-app-adIHy
```

## דברים שלא לעשות

- אל תכניס `_$_` או placeholders מ-LTR. כל הטקסטים בעברית.
- אל תשתמש ב-`document.createElement('svg')` — ראה SKILL.md חלק "SVG namespace".
- אל תעביר `null` כ-child ל-`Element.append()` — הופך לטקסט "null".
- אל תוסיף emoji בתחילת `placeholder` של input ב-RTL — קופץ לצד הלא נכון.
- אל תשנה את `id` של אלמנטים שיש להם event listener ב-app.js בלי לעדכן את ה-JS.

## דברים שכן

- כל סלקטור CSS חדש שמיקום-תלוי — השתמש ב-logical props (`inset-inline-start`, `padding-inline-end`).
- בכל מודאל חדש — תמיד `closeModal()` בטיפול ב-submit ו-cancel.
- כל נתון חדש שאתה שומר → תוסיף getter/setter ל-`db` ב-`storage.js`.
- אחרי שינוי schema של data — חשוב לחשוב על משתמשים קיימים (migration / merge defaults).
