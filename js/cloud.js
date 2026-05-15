// Cloud sync via Firebase Realtime Database.
// Lazy-loads the Firebase SDK from the official CDN only when needed.

const CONFIG_KEY = 'heller_v1.firebaseConfig';
const DEVICE_KEY = 'heller_v1.deviceId';

let fb = null;     // firebase modules
let fbApp = null;
let fbAuth = null;
let fbDb = null;
let currentUid = null;
let watchUnsub = null;
let pushTimer = null;
let listeners = { authChange: [], remoteData: [] };

function ensureDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = 'd-' + Math.random().toString(36).slice(2, 11) + '-' + Date.now().toString(36);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getStoredConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)); }
  catch { return null; }
}
export function storeConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}
export function clearStoredConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

async function loadSDK() {
  if (fb) return fb;
  const VERSION = '10.13.2';
  const base = `https://www.gstatic.com/firebasejs/${VERSION}`;
  const [app, auth, db] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-database.js`),
  ]);
  fb = { ...app, ...auth, ...db };
  return fb;
}

// Initialize Firebase with the given config. Resolves once auth state is known.
export async function initWithConfig(config) {
  await loadSDK();
  if (fbApp) {
    // Already initialized — recreate from new config requires reload
    return getCurrentAuthState();
  }
  fbApp = fb.initializeApp(config);
  fbAuth = fb.getAuth(fbApp);
  fbDb = fb.getDatabase(fbApp);
  return new Promise((resolve) => {
    fb.onAuthStateChanged(fbAuth, (user) => {
      currentUid = user ? user.uid : null;
      listeners.authChange.forEach(cb => { try { cb(user); } catch {} });
      resolve(user ? { uid: user.uid, email: user.email } : null);
    });
  });
}

export function getCurrentAuthState() {
  if (!fbAuth) return null;
  const u = fbAuth.currentUser;
  return u ? { uid: u.uid, email: u.email } : null;
}

export async function signUp(email, password) {
  if (!fbAuth) throw new Error('Firebase לא מוגדר');
  const cred = await fb.createUserWithEmailAndPassword(fbAuth, email, password);
  return cred.user;
}

export async function signIn(email, password) {
  if (!fbAuth) throw new Error('Firebase לא מוגדר');
  const cred = await fb.signInWithEmailAndPassword(fbAuth, email, password);
  return cred.user;
}

export async function signOutCloud() {
  if (watchUnsub) { watchUnsub(); watchUnsub = null; }
  if (fbAuth) await fb.signOut(fbAuth);
  currentUid = null;
}

export function isConnected() { return !!currentUid; }
export function getCurrentEmail() { return fbAuth?.currentUser?.email || null; }

/* ---------- Data sync ---------- */

// Debounced push (waits 800ms after last call)
export function queuePush(dataGetter) {
  if (!currentUid) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try { await push(dataGetter()); } catch (e) { console.warn('push failed', e); }
  }, 800);
}

export async function push(data) {
  if (!currentUid) return;
  const dataRef = fb.ref(fbDb, `users/${currentUid}/data`);
  await fb.set(dataRef, {
    ...data,
    _meta: {
      lastModified: Date.now(),
      deviceId: ensureDeviceId(),
    },
  });
}

export async function pull() {
  if (!currentUid) return null;
  const dataRef = fb.ref(fbDb, `users/${currentUid}/data`);
  const snap = await fb.get(dataRef);
  return snap.val();
}

export function watchRemote(callback) {
  if (!currentUid) return;
  if (watchUnsub) watchUnsub();
  const dataRef = fb.ref(fbDb, `users/${currentUid}/data`);
  const ownDevice = ensureDeviceId();
  watchUnsub = fb.onValue(dataRef, (snap) => {
    const data = snap.val();
    if (!data) return;
    // Ignore writes that came from this same device
    if (data._meta && data._meta.deviceId === ownDevice) return;
    try { callback(data); } catch (e) { console.warn(e); }
  });
  return watchUnsub;
}

export function onAuthChange(cb) {
  listeners.authChange.push(cb);
  return () => {
    listeners.authChange = listeners.authChange.filter(x => x !== cb);
  };
}

// Try to bootstrap from stored config on app load.
export async function autoBoot() {
  const config = getStoredConfig();
  if (!config) return null;
  try {
    return await initWithConfig(config);
  } catch (e) {
    console.warn('Firebase autoBoot failed:', e);
    return null;
  }
}

// Validate that an object looks like a Firebase config
export function validateConfig(config) {
  if (!config || typeof config !== 'object') return 'הקובץ אינו אובייקט תקין';
  const required = ['apiKey', 'authDomain', 'databaseURL', 'projectId'];
  for (const k of required) {
    if (!config[k]) return `חסר שדה: ${k}`;
  }
  if (!String(config.databaseURL).includes('firebaseio.com') &&
      !String(config.databaseURL).includes('firebasedatabase.app')) {
    return 'databaseURL לא נראה כתובת Firebase RTDB. ודא שיצרת Realtime Database.';
  }
  return null;
}
