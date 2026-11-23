// FONDATION : input.js — clavier par KeyboardEvent.code (position physique : ZQSD et WASD sans réglage),
// fronts montants figés par image, détection AZERTY / QWERTY pour les libellés (contrat : ARCHITECTURE.md § B.1).
import { ACTION, ACTION_TOTAL, INPUT, INTERAGIR, STATE, TOUCHES, ZOOM } from './config.js';
import { CAMERA_3P } from './config.js'; // § E5.AB : écarts de la souris sous verrou (caméra, curseur du jeu)
import { SENSIBILITE_SOURIS } from './config.js'; // § E5.AG : réglage « Sensibilité de la souris » (multiplicateur)
// § E5.C : ACTION_TOTAL = ACTION_COUNT + l'action « Interagir » (ACTION_INTERACT, région e5:C-interagir)
const ACTION_COUNT = ACTION_TOTAL;

let ctx = null;
let audio = null;

// Table code → indice de touche suivie. Construite à l'init ; lue dans les gestionnaires (hors chemin chaud).
const codeIndex = Object.create(null);
let keyCount = 0;
let keyDown = new Uint8Array(0);

// Direction : listes d'indices de touches par direction (haut, bas, gauche, droite).
const dirKeys = [[], [], [], []];
// Actions : listes d'indices de touches par action ; et, par touche, l'action qu'elle déclenche (−1 sinon).
const actionKeys = [];
let keyAction = new Int8Array(0);

const edgePending = new Uint8Array(ACTION_COUNT); // fronts montants reçus depuis le dernier poll()
const edgeFrame = new Uint8Array(ACTION_COUNT); // fronts montants de l'image en cours

const prevent = Object.create(null);

let moveX = 0;
let moveY = 0;
let layout = 'unknown';

// § E2.E — molette (zoom de la caméra). Tout dans un tableau typé : aucune allocation par événement ni par image.
const WH_STEPS = 0; // crans en attente (positif = molette vers l'avant = on se rapproche), fraction comprise
const WH_TIME = 1; // horodatage du dernier événement (ms)
const WH = new Float64Array(2);
WH[WH_TIME] = -1e9;
let wheelNotched = 0; // 1 : le geste en cours vient d'une molette crantée (un événement = un cran)

function track(code) {
  if (codeIndex[code] === undefined) codeIndex[code] = keyCount++;
  return codeIndex[code];
}

function anyDown(list) {
  for (let i = 0; i < list.length; i++) if (keyDown[list[i]] === 1) return true;
  return false;
}

function detectLayout(code, key) {
  if (!key) return;
  detecter(code, key.toLowerCase()); // § E5.AM : plus de texte de la Frappe éclair à la touche réglée à refaire
}

function detecter(code, k) {
  if (code === 'KeyW') {
    if (k === 'z') layout = 'azerty';
    else if (k === 'w') layout = 'qwerty';
  } else if (code === 'KeyA') {
    if (k === 'q') layout = 'azerty';
    else if (k === 'a') layout = 'qwerty';
  } else if (code === 'KeyQ') {
    if (k === 'a') layout = 'azerty';
    else if (k === 'q') layout = 'qwerty';
  }
}

/** Chemin commun des vraies touches et de inject(). */
function setKey(code, isDown, key) {
  if (isDown) detectLayout(code, key);
  const k = codeIndex[code];
  if (k === undefined) return;
  if (isDown) {
    if (keyDown[k] === 0) {
      keyDown[k] = 1;
      const a = keyAction[k];
      if (a >= 0) edgePending[a] = 1;
    }
  } else {
    keyDown[k] = 0;
  }
}

/** 16/11 (point 7) : une frappe dans un champ de saisie (pseudo) n'est pas une commande du jeu. */
function saisie(e) {
  const t = e.target;
  if (t === null || t === undefined) return false;
  if (t.tagName === 'INPUT') return t.type === 'text' || t.type === 'search'; // un curseur (range) n'est pas une saisie
  return t.tagName === 'TEXTAREA' || t.isContentEditable === true;
}

function onKeyDown(e) {
  //#region e5:AB-camera-3p
  // § E5.AB.5 : Échap qui vient de rendre le verrou du pointeur — la pause est déjà ouverte par verrou.js : ignorée
  if (e.code === 'Escape' && performance.now() - VP[VP_PERTE] < CAMERA_3P.verrou.echapGardeMs) {
    if (e.cancelable) e.preventDefault();
    return;
  }
  //#endregion e5:AB-camera-3p
  if (saisie(e)) {
    // Entrée ou Échap dans un champ (pseudo) le quittent : la touche suivante revient au jeu
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      if (e.target.blur) e.target.blur();
    }
    return;
  }
  if (captureFn !== null) {
    // 16/11 (point 3) : réglage d'une touche — la prochaine touche est prise par « Touches », pas par le jeu
    e.preventDefault();
    if (e.repeat) return;
    const f = captureFn;
    captureFn = null;
    f(e.code, e.key);
    return;
  }
  if (prevent[e.code] === true && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault(); // § E4.D : Cmd + R reste un rechargement
  if (e.repeat) return;
  audio.unlock();
  setKey(e.code, true, e.key);
}

function onKeyUp(e) {
  setKey(e.code, false, '');
}

function onBlur() {
  keyDown.fill(0);
  edgePending.fill(0);
  droitTenu = 0; // fenêtre quittée : le bouton droit est relâché ailleurs
}

function onPointerDown(e) {
  audio.unlock();
  //#region e5:AB-camera-3p
  // § E5.AB.14 (Femz, 22/11) : mode « Vue fixe » — clic droit au sol, façon LoL (le code de 0.5.7), en partie seulement ;
  // sous verrou, le point est celui du curseur du jeu (clientX / Y y sont figés)
  if (e && e.button === 2 && modeSouris === 0 && enPartie()) {
    if (VP[VP_ACTIF] === 0) {
      SOURIS[S_X] = e.clientX;
      SOURIS[S_Y] = e.clientY;
    }
    droitTenu = 1;
    droitFront = 1;
    if (e.cancelable) e.preventDefault();
  }
  //#endregion e5:AB-camera-3p
}

function onPointerUp(e) {
  if (e.button === 2) droitTenu = 0;
}

let droitTenu = 0; // § E5.AB.14 : bouton droit enfoncé (mode Vue fixe)
let droitFront = 0; // front montant reçu depuis le dernier poll()
let droitFrontImage = 0; // front montant de l'image en cours

/** § E5.AB.14 : bouton droit tenu (mode Vue fixe). */
export function droitEnfonce() {
  return modeSouris === 0 && droitTenu === 1;
}

/** § E5.AB.14 : clic droit pendant cette image (mode Vue fixe). */
export function droitClic() {
  return modeSouris === 0 && droitFrontImage === 1;
}

/** Curseur en pixels CSS (du jeu sous verrou) : x, y écrits dans out. */
export function curseur(out) {
  out.x = SOURIS[S_X];
  out.y = SOURIS[S_Y];
  return out;
}

// ----- Position du curseur (pixels CSS), sans allocation ; § E5.AB : mode Souris = caméra derrière l'agent ----------
const S_X = 0;
const S_Y = 1;
const SOURIS = new Float64Array(2); // dernière position du curseur (pixels CSS) — sous verrou : le curseur du jeu
let modeSouris = 0; // 1 : réglage « Déplacement : Souris » (§ E5.AB : la souris tourne la caméra)

function enPartie() {
  const s = ctx.game.state;
  return s === STATE.PLAYING || s === STATE.WAVE_CLEAR || s === STATE.COUNTDOWN;
}

//#region e5:AB-camera-3p
/** § E5.AB.2 : écart horizontal de la souris (px) cumulé sous verrou en mode Souris, lu par camera.tourner (main). */
export const ROTATION = new Float64Array(1);
// [0] verrou du pointeur pris (écrit par verrou.js) ; [1] horodatage (ms) de sa dernière perte involontaire
const VP_ACTIF = 0;
const VP_PERTE = 1;
const VP = new Float64Array(2);
VP[VP_PERTE] = -1e9;

/** § E5.AB : un écart de la souris sous verrou (mode Souris → caméra ; Clavier → curseur du jeu, borné à la fenêtre). */
function ecartSouris(e) {
  const mx = e.movementX;
  const my = e.movementY;
  const lim = CAMERA_3P.ecartMaxPx;
  if (!(mx < lim && mx > -lim && my < lim && my > -lim)) return; // saut connu à la prise du verrou (et NaN)
  if (modeSouris === 1) {
    ROTATION[0] += mx;
    return;
  }
  // § E5.AB.14 : mode « Vue fixe » — le curseur du jeu, borné à la fenêtre (clic pour avancer, dash)
  const k = CAMERA_3P.curseur.sensibilite * SENSIBILITE_SOURIS.mul; // § E5.AG : × le réglage (1 au milieu : exact)
  let x = SOURIS[S_X] + mx * k;
  let y = SOURIS[S_Y] + my * k;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (x < 0) x = 0;
  else if (x > w) x = w;
  if (y < 0) y = 0;
  else if (y > h) y = h;
  SOURIS[S_X] = x;
  SOURIS[S_Y] = y;
}

/** verrou.js : verrou pris (true) ou rendu ; perdu = rendu sans que le jeu l'ait demandé (Échap, focus perdu). */
export function setVerrou(on, perdu = false) {
  VP[VP_ACTIF] = on ? 1 : 0;
  if (!on && perdu) {
    VP[VP_PERTE] = performance.now();
    edgePending[ACTION.PAUSE] = 0; // la pause est ouverte par verrou.js : le front d'Échap déjà reçu ne la referme pas
  }
  ROTATION[0] = 0;
}

export function getVerrou() {
  return VP[VP_ACTIF] === 1;
}
//#endregion e5:AB-camera-3p

function onPointerMove(e) {
  //#region e5:AB-camera-3p
  if (VP[VP_ACTIF] === 1) {
    ecartSouris(e); // clientX/Y figés sous verrou : seuls movementX/Y bougent
    curseurConnu = 1;
    return;
  }
  //#endregion e5:AB-camera-3p
  SOURIS[S_X] = e.clientX;
  SOURIS[S_Y] = e.clientY;
  //#region e5:U-visee-souris
  curseurConnu = 1; // § E5.U.2 : la visée Souris ne suit le curseur qu'une fois qu'il a bougé
  //#endregion e5:U-visee-souris
}

function onContextMenu(e) {
  if (enPartie() && e.cancelable) e.preventDefault(); // § E5.AB.1 : pas de menu du navigateur en partie (les deux modes)
}

/** Réglage « Déplacement » : true = souris (§ E5.AB : caméra derrière l'agent). */
export function setModeSouris(on) {
  modeSouris = on ? 1 : 0;
  ROTATION[0] = 0;
  if (modeSouris === 1) droitTenu = 0;
}

export function getModeSouris() {
  return modeSouris === 1;
}

//#region e5:U-visee-souris
let curseurConnu = 0; // 1 dès le premier pointermove (avant : position inconnue, la visée suit la marche)
/** § E5.U.2 : curseur en pixels CSS écrit dans T[0], T[1] (tableau typé : aucun flottant passé) ; 0 s'il n'a jamais bougé. */
export function curseurT(T) {
  T[0] = SOURIS[S_X];
  T[1] = SOURIS[S_Y];
  return curseurConnu;
}
/** Tests : oublie le curseur (comme au chargement de la page). */
export function oublierCurseur() {
  curseurConnu = 0;
}
//#endregion e5:U-visee-souris

/**
 * § E2.E — molette, pavé tactile, pincement (wheel + ctrlKey). Hors partie : rien (les listes des menus défilent, le
 * zoom du navigateur reste libre). En partie : l'événement est pris (la page ne défile ni ne zoome) et converti en
 * crans RÉGULIERS quelle que soit la souris :
 *   - molette crantée (deltaMode « lignes » ou « pages », ou deltaY multiple de la signature macOS) : un cran par
 *     événement, quelle que soit l'accélération du système ; vrai jusqu'à la fin du geste ;
 *   - sinon (pavé, molette fine, souris à 100 px le cran) : deltaY / wheelPerStep (pincement : / pinchPerStep),
 *     jamais plus d'un cran par événement ; les fractions se cumulent.
 */
function onWheel(e) {
  const s = ctx.game.state;
  if (s !== STATE.PLAYING && s !== STATE.WAVE_CLEAR && s !== STATE.COUNTDOWN) return;
  if (e.cancelable) e.preventDefault();
  const d = e.deltaY;
  if (!(d < 0 || d > 0)) return; // 0 (défilement horizontal) ou NaN
  const t = e.timeStamp;
  if (!(t - WH[WH_TIME] <= ZOOM.gestureGapMs)) {
    // nouveau geste : la fraction laissée par le précédent est jetée, le caractère « cranté » oublié
    wheelNotched = 0;
    const r = WH[WH_STEPS];
    WH[WH_STEPS] = r < 0 ? Math.ceil(r) : Math.floor(r);
  }
  WH[WH_TIME] = t;
  if (e.deltaMode !== 0 || d % ZOOM.macNotchPx === 0) wheelNotched = 1;
  let c;
  if (wheelNotched === 1) c = d < 0 ? 1 : -1;
  else {
    c = -d / (e.ctrlKey ? ZOOM.pinchPerStep : ZOOM.wheelPerStep);
    if (c > 1) c = 1;
    else if (c < -1) c = -1;
  }
  WH[WH_STEPS] += c;
}

export function init(context) {
  ctx = context;
  audio = ctx.audio;
  // § E4.D : toutes les touches viennent du réglage (défauts d'INPUT, puis le stockage) ; rebuild() fait les tables
  for (let a = 0; a < ACTION_COUNT; a++) actionKeys.push([]);
  for (const L of TOUCHES.lignes) binds[L.id] = defautDe(L);
  const lu = lireStockage();
  const migre = migrerInteragir(lu); // § E5.C.2 : réglage d'avant l'action « Interagir »
  appliquerStockage(lu);
  rebuild();
  if (migre) ecrireStockage(); // une fois : le réglage migré est gardé (plus de E en double à la prochaine visite)

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true }); // déplacement à la souris (Femz, 21/11)
  window.addEventListener('pointerup', onPointerUp); // § E5.AB.14
  window.addEventListener('contextmenu', onContextMenu);
  // § E2.E : sur window (l'interface DOM recouvre le canvas), non passif (preventDefault en partie)
  window.addEventListener('wheel', onWheel, { passive: false });
}

/** Efface les fronts montants ; les touches maintenues restent connues (§ B.1). */
export function reset() {
  edgePending.fill(0);
  edgeFrame.fill(0);
}

/** F2 : calcule les axes et fige les fronts montants de l'image. */
export function poll() {
  for (let a = 0; a < ACTION_COUNT; a++) {
    edgeFrame[a] = edgePending[a];
    edgePending[a] = 0;
  }
  const up = anyDown(dirKeys[0]);
  const down = anyDown(dirKeys[1]);
  const left = anyDown(dirKeys[2]);
  const right = anyDown(dirKeys[3]);
  moveX = (right ? 1 : 0) - (left ? 1 : 0);
  moveY = (up ? 1 : 0) - (down ? 1 : 0);
  droitFrontImage = droitFront; // § E5.AB.14
  droitFront = 0;
}

/** F16 : efface les fronts montants. */
export function endFrame() {
  edgeFrame.fill(0);
}

/**
 * Reporte le front montant d'une action à l'image suivante : pressed(action) y sera de nouveau vrai. Appelé par
 * main quand l'image n'a pas simulé (hitstop) et que l'action n'a donc pu être consommée par personne.
 */
export function requeue(action) {
  edgePending[action] = 1;
}

export function getMoveX() {
  return moveX;
}

export function getMoveY() {
  return moveY;
}

/** La touche de l'action vient d'être enfoncée pendant cette image. */
export function pressed(action) {
  return edgeFrame[action] === 1;
}

/** La touche de l'action est maintenue. */
export function down(action) {
  return anyDown(actionKeys[action]);
}

/**
 * § E2.E — crans ENTIERS de molette accumulés depuis le dernier appel (positif = vers l'avant) ; la fraction reste en
 * attente. Appelé par main à chaque image de partie. Rend un entier : aucun flottant ne sort (§ V).
 */
export function consumeWheel() {
  const r = WH[WH_STEPS];
  if (r < 1 && r > -1) return 0;
  const n = r < 0 ? Math.ceil(r) : Math.floor(r);
  WH[WH_STEPS] = r - n;
  return n | 0;
}

/** § E2.E — hors partie : ce qui restait de la molette est jeté (elle ne zoomera pas au retour en jeu). */
export function dropWheel() {
  WH[WH_STEPS] = 0;
}

export function getLayout() {
  return layout;
}

/** Simule une touche physique (tests, __game.press / release). key = event.key, pour la détection de disposition. */
export function inject(code, isDown, key = '') {
  setKey(code, isDown, key);
}

export function inspect(out) {
  out.modeSouris = modeSouris === 1; // § E5.R
  out.verrou = VP[VP_ACTIF] === 1; // § E5.AB
  out.curseurX = SOURIS[S_X]; // § E5.AB : curseur (du jeu sous verrou), px CSS
  out.curseurY = SOURIS[S_Y];
  out.curseurConnu = curseurConnu === 1; // § E5.U.2
  out.layout = layout;
  out.moveX = moveX;
  out.moveY = moveY;
}

// ----- § E4.D (étape 4, chantier D) : toutes les touches réglables (pause → « Touches ») -----------------------------
// Tout ce bloc tourne HORS combat (init, réglage en pause) : les allocations y sont permises (§ V).
let captureFn = null;
const binds = Object.create(null); // id de ligne (TOUCHES.lignes) → [principale, secondaire] ('' = case vide)
const LIGNE = Object.create(null); // id → ligne
for (const L of TOUCHES.lignes) LIGNE[L.id] = L;
const RESERVEE = new Set(TOUCHES.reservees);
const CODE_OK = new RegExp('^[A-Za-z0-9]{1,' + TOUCHES.codeMax + '}$');
let stockage = 'ok'; // 'indisponible' dès qu'une lecture ou une écriture lève
let stockageLu = 'defaut'; // ce que la lecture a trouvé : 'v2', 'v1' (frappe éclair de l'étape 3), 'illisible', 'defaut'

function defautDe(L) {
  const src = L.dir !== undefined ? [INPUT.up, INPUT.down, INPUT.left, INPUT.right][L.dir] : INPUT.actions[L.action];
  return [src[0] || '', src[1] || ''];
}

/** Code acceptable pour la ligne id : lettres et chiffres, non réservé (Échap n'est permis que sur « Pause »). */
function codeValide(c, id) {
  if (typeof c !== 'string' || !CODE_OK.test(c)) return false;
  return !RESERVEE.has(c) || (c === TOUCHES.garde && id === 'pause');
}

/** Lit la clé unique (try/catch) ; rend { id: [c0, c1] } ou null. Format v1 (tableau) = la frappe éclair seule. */
function lireStockage() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(TOUCHES.cle);
  } catch {
    stockage = 'indisponible';
    return null;
  }
  if (raw === null) return null;
  let v = null;
  try {
    v = JSON.parse(raw);
  } catch {
    stockageLu = 'illisible';
    return null;
  }
  if (Array.isArray(v)) {
    stockageLu = 'v1';
    return { frappe: v.slice(0, 2) };
  }
  if (v !== null && typeof v === 'object' && v.v === TOUCHES.version && v.touches !== null && typeof v.touches === 'object') {
    stockageLu = 'v2';
    return v.touches;
  }
  stockageLu = 'illisible';
  return null;
}

/**
 * § E5.C.2 — réglage enregistré AVANT l'action « Interagir » (format v1, ou v2 sans ligne « interagir ») : E était la
 * 2e touche par défaut de la frappe éclair. Sans perte ni doublon :
 *   - la frappe éclair perd E seulement si elle garde une autre touche (A par défaut) ; si le joueur l'avait mise sur E
 *     SEUL, ce choix reste ;
 *   - Interagir prend E s'il est libre, sinon la première touche libre de INTERAGIR.repli (F, G, T…).
 * Modifie t sur place ; rend true si une migration a eu lieu (main l'écrit alors une fois). Hors combat (init).
 */
function migrerInteragir(t) {
  migration = '';
  if (t === null || t.interagir !== undefined) return false;
  const f = t.frappe;
  if (Array.isArray(f) && (f[0] === 'KeyE' || f[1] === 'KeyE')) {
    const autres = f.slice(0, 2).filter((c) => c !== 'KeyE' && codeValide(c, 'frappe'));
    if (autres.length > 0) {
      t.frappe = [autres[0], autres[1] || ''];
      migration = 'frappe-sans-E';
    } else migration = 'frappe-garde-E';
  }
  // touches prises après cette correction : entrées valides du stockage, puis défauts des lignes absentes (comme
  // appliquerStockage, qui fait le vrai partage juste après)
  const pris = new Set();
  for (const L of TOUCHES.lignes) {
    const e = t[L.id];
    if (L.id === 'interagir') continue;
    if (Array.isArray(e)) for (const c of e.slice(0, 2)) if (codeValide(c, L.id)) pris.add(c);
  }
  for (const L of TOUCHES.lignes) if (L.id !== 'interagir' && !Array.isArray(t[L.id])) for (const c of defautDe(L)) if (c !== '' && !pris.has(c)) pris.add(c);
  const choix = ['KeyE', ...INTERAGIR.repli].find((c) => !pris.has(c));
  t.interagir = [choix || '', ''];
  migration += (migration ? ' ; ' : '') + 'interagir=' + (choix || 'aucune');
  return true;
}
let migration = ''; // tests (inspectTouches) : ce que la migration a fait au chargement

/** Les entrées valides du stockage d'abord ; les autres lignes prennent leur défaut, sans les touches déjà prises. */
function appliquerStockage(t) {
  if (t === null) return;
  const pris = new Set();
  const garde = Object.create(null);
  for (const L of TOUCHES.lignes) {
    const e = t[L.id];
    if (!Array.isArray(e)) continue;
    const out = ['', ''];
    for (let i = 0; i < 2; i++) {
      const c = e[i];
      if (codeValide(c, L.id) && !pris.has(c)) {
        out[i] = c;
        pris.add(c);
      }
    }
    if (out[0] !== '' || out[1] !== '') garde[L.id] = out;
  }
  for (const L of TOUCHES.lignes) {
    if (garde[L.id] !== undefined) {
      binds[L.id] = garde[L.id];
      continue;
    }
    const d = defautDe(L).filter((c) => c !== '' && !pris.has(c));
    for (const c of d) pris.add(c);
    binds[L.id] = [d[0] || '', d[1] || ''];
  }
}

function ecrireStockage() {
  try {
    window.localStorage.setItem(TOUCHES.cle, JSON.stringify({ v: TOUCHES.version, touches: binds }));
  } catch {
    stockage = 'indisponible'; // le réglage vaut pour cette visite
  }
}

/** Recalcule les tables du clavier depuis binds (hors combat). L'état « enfoncé » des touches connues est gardé. */
function rebuild() {
  for (const L of TOUCHES.lignes) for (const c of binds[L.id]) if (c !== '') track(c);
  track(TOUCHES.garde);
  const fixes = []; // actions sans ligne au tableau (debug F1 à F6) : touches d'INPUT, fixes
  for (let a = 0; a < ACTION_COUNT; a++) if (!TOUCHES.lignes.some((L) => L.action === a)) fixes.push(a);
  for (const a of fixes) for (const c of INPUT.actions[a]) track(c);
  if (keyDown.length < keyCount) {
    const kd = new Uint8Array(keyCount);
    kd.set(keyDown);
    keyDown = kd;
    keyAction = new Int8Array(keyCount);
  }
  keyAction.fill(-1);
  for (let d = 0; d < 4; d++) dirKeys[d].length = 0;
  for (let a = 0; a < ACTION_COUNT; a++) actionKeys[a] = [];
  for (const L of TOUCHES.lignes) {
    for (const c of binds[L.id]) {
      if (c === '') continue;
      const k = codeIndex[c];
      if (L.dir !== undefined) dirKeys[L.dir].push(k);
      else {
        keyAction[k] = L.action;
        actionKeys[L.action].push(k);
      }
    }
  }
  for (const a of fixes) {
    for (const c of INPUT.actions[a]) {
      const k = codeIndex[c];
      if (keyAction[k] >= 0) continue;
      keyAction[k] = a;
      actionKeys[a].push(k);
    }
  }
  // garde-fou : Échap ouvre TOUJOURS la pause (réservée : aucune autre action ni direction ne peut la prendre)
  const g = codeIndex[TOUCHES.garde];
  if (keyAction[g] !== ACTION.PAUSE) {
    keyAction[g] = ACTION.PAUSE;
    actionKeys[ACTION.PAUSE].push(g);
  }
  for (const k of Object.keys(prevent)) delete prevent[k];
  for (const c of INPUT.preventDefault) prevent[c] = true;
  for (const L of TOUCHES.lignes) for (const c of binds[L.id]) if (c !== '') prevent[c] = true;
  if (ctx !== null && ctx.game.debug) for (const c of INPUT.preventDefaultDebug) prevent[c] = true;
}

/** Touches réglées : copie { id: [principale, secondaire] }. */
export function touches() {
  const out = {};
  for (const L of TOUCHES.lignes) out[L.id] = binds[L.id].slice();
  return out;
}

/**
 * Règle la case slot (0 principale, 1 secondaire) de la ligne id sur code. Une touche déjà prise est ÉCHANGÉE : l'autre
 * ligne reçoit l'ancienne touche de la case (vide si elle l'était, ou si c'était Échap : Échap reste la garde de la
 * pause). TOUCHES.effacer vide la case (refusé si la ligne n'aurait plus aucune touche). Réservée : refusée.
 * Rend { ok, motif ('' | 'efface' | 'seule' | 'reservee' | 'inconnue'), echange: { id, slot, code } | null, vide }.
 */
export function regler(id, slot, code) {
  const R = { ok: false, motif: '', echange: null, vide: false };
  const L = LIGNE[id];
  if (L === undefined || (slot !== 0 && slot !== 1)) {
    R.motif = 'inconnue';
    return R;
  }
  const b = binds[id];
  if (code === TOUCHES.effacer) {
    if (b[1 - slot] === '' && id !== 'pause') {
      R.motif = 'seule';
      return R;
    }
    b[slot] = '';
    R.ok = true;
    R.motif = 'efface';
    rebuild();
    ecrireStockage();
    return R;
  }
  if (!codeValide(code, '')) {
    R.motif = 'reservee';
    return R;
  }
  const ancien = b[slot] === TOUCHES.garde ? '' : b[slot];
  if (b[slot] === code) {
    R.ok = true;
    return R;
  }
  let oid = null;
  let os = -1;
  for (const M of TOUCHES.lignes) {
    const c = binds[M.id];
    if (c[0] === code) {
      oid = M.id;
      os = 0;
      break;
    }
    if (c[1] === code) {
      oid = M.id;
      os = 1;
      break;
    }
  }
  b[slot] = code;
  if (oid !== null) {
    const o = binds[oid];
    o[os] = ancien;
    R.echange = { id: oid, slot: os, code: ancien };
    R.vide = o[0] === '' && o[1] === '' && oid !== 'pause';
  }
  R.ok = true;
  rebuild();
  ecrireStockage();
  return R;
}

/** « Touches par défaut » : les défauts d'INPUT (positions physiques : ZQSD / WASD et A·E / Q·E sont les mêmes codes). */
export function touchesParDefaut() {
  for (const L of TOUCHES.lignes) binds[L.id] = defautDe(L);
  rebuild();
  ecrireStockage();
}

/** Libellé de la touche à afficher pour la ligne id : la principale, sinon la secondaire, sinon « — ». */
export function libelle(id) {
  const b = binds[id];
  if (b === undefined) return TOUCHES.textes.vide;
  const c = b[0] !== '' ? b[0] : b[1];
  if (c !== '') return keyLabel(c);
  return id === 'pause' ? keyLabel(TOUCHES.garde) : TOUCHES.textes.vide;
}

/** Tests : stockage, format lu, touches, attente d'une touche. */
export function inspectTouches(out = {}) {
  out.stockage = stockage;
  out.lu = stockageLu;
  out.touches = touches();
  out.attente = captureFn !== null;
  out.migration = migration; // § E5.C.2
  return out;
}

/**
 * § E5.C : code réglé de la ligne id (la principale, sinon la secondaire, sinon ''), SANS allocation (la chaîne
 * gardée dans le réglage) — lu à chaque image par l'invite « Interagir » pour savoir si son dessin est à refaire.
 */
export function codeDe(id) {
  const b = binds[id];
  if (b === undefined) return '';
  return b[0] !== '' ? b[0] : b[1];
}

/** Codes (KeyboardEvent.code) de l'action a. */
export function actionCodes(a) {
  const out = [];
  for (const code of Object.keys(codeIndex)) if (keyAction[codeIndex[code]] === a) out.push(code);
  return out;
}

/**
 * API de test (debug bindStrike, e3-retours-1611) : remplace les touches de l'action a par `codes`. Garde la règle de
 * l'étape 3 : une touche déjà prise par une autre ligne (déplacement compris) ou réservée est REFUSÉE (rend false).
 * Le tableau « Touches » passe par regler() (échange). garder : écrit le réglage dans le navigateur.
 */
export function bindAction(a, codes, garder = true) {
  const L = TOUCHES.lignes.find((M) => M.action === a);
  if (L === undefined || codes.length < 1 || codes.length > 2) return false;
  for (const code of codes) {
    if (!codeValide(code, L.id)) return false;
    for (const M of TOUCHES.lignes) if (M !== L && (binds[M.id][0] === code || binds[M.id][1] === code)) return false;
  }
  binds[L.id] = [codes[0], codes[1] || ''];
  rebuild();
  if (garder) ecrireStockage();
  return true;
}

/** La prochaine touche pressée est passée à fn(code, key) au lieu du jeu (réglage dans « Touches »). null : annule. */
export function captureKey(fn) {
  captureFn = typeof fn === 'function' ? fn : null;
}

const AZ_PONCT = { KeyM: ',', Comma: ';', Period: ':', Slash: '!', Semicolon: 'M', Quote: 'Ù', BracketLeft: '^', BracketRight: '$', Backquote: '²', Minus: ')', Equal: '=', Backslash: '*', IntlBackslash: '<' };
const QW_PONCT = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`', Minus: '-', Equal: '=', Backslash: '\\', IntlBackslash: '\\' };
const NOMS = {
  Space: 'Espace', Enter: 'Entrée', NumpadEnter: 'Entrée pavé', Escape: 'Échap', Backspace: 'Retour', Tab: 'Tab',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'Maj g.', ShiftRight: 'Maj d.', ControlLeft: 'Ctrl g.', ControlRight: 'Ctrl d.', AltLeft: 'Alt g.', AltRight: 'Alt d.',
  Insert: 'Inser', Delete: 'Suppr', Home: 'Début', End: 'Fin', PageUp: 'Page ↑', PageDown: 'Page ↓',
  NumpadAdd: 'Pavé +', NumpadSubtract: 'Pavé −', NumpadMultiply: 'Pavé ×', NumpadDivide: 'Pavé ÷', NumpadDecimal: 'Pavé ,',
};

/** Libellé d'une touche physique selon la disposition détectée (KeyQ = « A » en AZERTY ; inconnue : comme AZERTY). */
export function keyLabel(code) {
  const az = layout !== 'qwerty';
  if (code === 'KeyQ') return az ? 'A' : 'Q';
  if (code === 'KeyA') return az ? 'Q' : 'A';
  if (code === 'KeyW') return az ? 'Z' : 'W';
  if (code === 'KeyZ') return az ? 'W' : 'Z';
  const p = (az ? AZ_PONCT : QW_PONCT)[code];
  if (p !== undefined) return p;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad') && code.length === 7) return 'Pavé ' + code.slice(6);
  if (NOMS[code] !== undefined) return NOMS[code];
  return code;
}
