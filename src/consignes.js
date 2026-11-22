//#region e5:L-textes-guide
// Lot 1 du guide UX (ARCHITECTURE.md § E5.L, règle 8 ; audit A1-A3 du 20/11) — trois consignes au moment où elles
// servent, montrées UNE fois par profil (méta : meta.consigneVue / marquerConsigne, écrite au prochain moment hors
// combat) :
//   'deplacer' : pendant le 3-2-1 de la 1re partie — se déplacer (touches réelles), les armes tirent seules, l'objectif ;
//   'dash'     : au 1er coup reçu (damage.COUPS_RECUS) — la touche réelle du dash ;
//   'terminal' : au 1er terminal posé (terminal.estDisponible) — la touche réelle d'Interagir, ce qu'il apporte.
// Une bulle à la fois (les autres attendent), sous le héros, au-dessus de la barre de PV : elle ne fige rien, ne prend
// aucune touche, se cache sous les écrans de choix et disparaît seule (fondu). Jamais en ?debug sans demande
// (debug : __game.consignes(true)).
// Allocation : le texte d'une bulle est construit à son apparition (une fois par profil) ; update n'alloue rien.
import { CONSIGNES, STATE } from './config.js';
import { P, run } from './state.js';
import { COUPS_RECUS } from './damage.js';
//#region e5:AE-tuto-bornes
import { COUPS_TOUCHE } from './props.js'; // § E5.AE : coups de pied partis à la touche (borne utilisée), en entier
// § E5.AE : borne à l'écran, flèche au-dessus — liaisons directes (aucune lecture de propriété d'un espace de noms : une
// lecture jamais faite avant l'apparition désoptimisait update, mesuré le 22/11)
import { CACHEE, DT as TB_DT, MONTREE, SORTIE, VIS, cacher as cacherFleche, chercherBorne, ecran as ecranFleche, init as initFleche, inspect as inspectFleche, syncFleche } from './tuto-bornes.js';
//#endregion e5:AE-tuto-bornes

const IDS = ['deplacer', 'dash', 'terminal', 'bornes'];
const DEPLACER = 0;
const DASH = 1;
const TERMINAL = 2;
const BORNES = 3; // § E5.AE : 1re partie, borne à l'écran et PV perdus (ou 45 s sans dégât)

let ctx = null;
let box = null;
let forcee = false; // debug : consignes actives malgré ?debug
const T = new Float64Array(4); // [0] s restantes de la bulle (−1 : jusqu'à la fin du 3-2-1) ; [1] s de jeu depuis le 3-2-1 ; [2] s de déplacement ; [3] fondu restant
let cur = -1; // consigne affichée (−1 : aucune)
const file = new Int8Array(4); // consignes en attente
let fileN = 0;
let coupsVus = 0; // COUPS_RECUS au départ de la partie
const montrees = new Uint8Array(4); // montrées pendant cette page (tests)
let cache = false; // bulle cachée par un écran (choix de niveau, coffre, pause…)
//#region e5:AE-tuto-bornes
let forceeBornes = false; // debug : la consigne des bornes active malgré ?debug (demande À PART de __game.consignes)
// [1] s de jeu de la partie (secours) ; [2] 1 = borne frappée pendant la bulle
const TBS = new Float64Array(3);
// Chemin de chaque image pendant la bulle des bornes : aucune lecture de Float64Array (dans le code non optimisé, chaque
// lecture emballe un flottant : mesuré le 22/11) — entiers seulement.
const COUPS_VUS = new Int32Array(1); // COUPS_TOUCHE déjà vus
let fonduOn = 0; // 1 : fondu de sortie de la bulle en cours (miroir entier de T[3] > 0)
const RD = new Float64Array(1); // dt réel de l'image : lu dans un tableau typé par corps et bornes (aucun flottant passé, § V)
let arme = 0; // 1 : le tuto peut encore se montrer dans cette image (la recherche tourne à chaque image : code chaud)
let frais = 0; // 1 : VIS a été calculé au début de CETTE image (sinon : pas de déclenchement)
//#endregion e5:AE-tuto-bornes

/** Construit la bulle (une fois, dans le HUD, par ui.js). el : fabrique de ui.js ; context : le ctx du jeu (main.js). */
export function build(parent, el, context) {
  if (context) ctx = context;
  initFleche(ctx); // § E5.AE : sprite de la flèche (hors combat ; ui.init tourne après la scène, la caméra et le rendu)
  box = el('div', 'sr-consigne');
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  parent.appendChild(box);
  return box;
}

function actives() {
  if (box === null || ctx === null || !ctx.meta) return false;
  return forcee || !(ctx.game && ctx.game.debug);
}

/** Debug et tests : consignes actives en ?debug (true) ou non (false). Rend l'état. */
export function forcer(on) {
  forcee = !!on;
  return forcee;
}

/** Nouvelle partie : bulle retirée, file vidée (une consigne pas encore montrée attend son prochain moment). */
export function reset() {
  cur = -1;
  fileN = 0;
  T.fill(0);
  coupsVus = COUPS_RECUS[0];
  cache = false;
  COUPS_VUS[0] = COUPS_TOUCHE[0]; // § E5.AE
  fonduOn = 0;
  TBS[1] = 0;
  TBS[2] = 0;
  cacherFleche();
  if (box !== null) {
    box.className = 'sr-consigne';
    box.replaceChildren();
  }
}

function libelle(id) {
  const input = ctx.input;
  return input && input.libelle ? input.libelle(id) : id;
}

/** Remplit la bulle : chaque ligne du modèle, les {touche} en touches de clavier (libellé de la touche réglée). */
function remplir(k) {
  const C = CONSIGNES[IDS[k]];
  box.replaceChildren();
  for (const modele of C.lignes) {
    const p = document.createElement('p');
    p.className = 'sr-consigne-ligne';
    const re = /\{(\w+)\}/g;
    let pos = 0;
    let m;
    while ((m = re.exec(modele)) !== null) {
      if (m.index > pos) p.appendChild(document.createTextNode(modele.slice(pos, m.index)));
      const kbd = document.createElement('kbd');
      kbd.className = 'sr-consigne-touche';
      kbd.textContent = libelle(m[1]);
      p.appendChild(kbd);
      pos = m.index + m[0].length;
    }
    if (pos < modele.length) p.appendChild(document.createTextNode(modele.slice(pos)));
    box.appendChild(p);
  }
}

function montrer(k) {
  if (cur >= 0) {
    for (let q = 0; q < fileN; q++) if (file[q] === k) return;
    if (fileN < file.length) file[fileN++] = k;
    return;
  }
  cur = k;
  montrees[k] = 1;
  ctx.meta.marquerConsigne(IDS[k]);
  remplir(k);
  T[0] = k === DEPLACER ? -1 : CONSIGNES[IDS[k]].secondes;
  T[1] = 0;
  T[2] = 0;
  T[3] = 0;
  fonduOn = 0; // § E5.AE
  box.className = 'sr-consigne sr-on sr-consigne-' + IDS[k];
}

function finir() {
  T[3] = CONSIGNES.fonduS;
  fonduOn = 1; // § E5.AE
  box.className = 'sr-consigne sr-sort';
}

/** Chaque image (ui.update, temps réel). Ne lit que des entiers et des tableaux typés. */
export function update(realDt) {
  RD[0] = realDt;
  // § E5.AE : recherche de la borne à l'écran AVANT les déclencheurs (VIS de cette image : jamais l'indice d'une borne
  // retirée depuis) — tant que le tuto était armé à l'image d'avant, ou que la bulle des bornes est là. Un seul appel,
  // chaud dès que le tuto est armé (voir tuto-bornes.js : retour de type complet avant l'apparition).
  const cA = arme === 1;
  const cB0 = cur === BORNES;
  if (cA || cB0) chercherBorne();
  frais = cA ? 1 : 0;
  arme = 0;
  corps();
  // § E5.AE : la flèche suit la bulle des bornes (montrée, cachée net sous un écran, fondu avec la bulle) ; sync tourne
  // à chaque image, flèche cachée ou non (code chaud bien avant la 1re apparition)
  // Un seul appel de chaque, choisi sans branche nouvelle à l'apparition (code optimisé déjà chaud, voir tuto-bornes.js) :
  // la recherche tourne tant que le tuto est armé (bornes, 1re partie) ou que la bulle des bornes est là.
  // (toutes les lectures et comparaisons à chaque image : aucune sautée par un « && », retour de type complet)
  const act = actives();
  const enFondu = fonduOn === 1;
  const cB = cur === BORNES;
  const montree = cB && !cache && act;
  const mode = !montree ? CACHEE : enFondu ? SORTIE : MONTREE;
  TB_DT[0] = realDt;
  syncFleche(mode);
}

function corps() {
  const realDt = RD[0];
  if (!actives()) return;
  const s = ctx.game.state;
  const enJeu = s === STATE.PLAYING || s === STATE.COUNTDOWN || s === STATE.WAVE_CLEAR;
  // fondu de sortie en cours
  if (T[3] > 0) {
    T[3] -= realDt > 0 ? realDt : 0;
    if (T[3] <= 0) {
      T[3] = 0;
      fonduOn = 0; // § E5.AE
      cur = -1;
      box.className = 'sr-consigne';
      if (fileN > 0) {
        const k = file[0];
        for (let q = 1; q < fileN; q++) file[q - 1] = file[q];
        fileN--;
        montrer(k);
      }
    }
    return;
  }
  // déclencheurs (une fois par profil)
  const M = ctx.meta;
  if (s === STATE.COUNTDOWN && run.wave === 0 && montrees[DEPLACER] === 0 && !M.consigneVue(IDS[DEPLACER])) montrer(DEPLACER);
  if (s === STATE.PLAYING) {
    if (COUPS_RECUS[0] !== coupsVus) {
      coupsVus = COUPS_RECUS[0];
      if (montrees[DASH] === 0 && !M.consigneVue(IDS[DASH])) montrer(DASH);
    }
    if (montrees[TERMINAL] === 0 && ctx.terminal && ctx.terminal.estDisponible() && !M.consigneVue(IDS[TERMINAL])) montrer(TERMINAL);
    //#region e5:AE-tuto-bornes
    bornes(M);
    //#endregion e5:AE-tuto-bornes
  }
  if (cur < 0) return;
  // cachée (sans compter le temps) sous un écran de choix, la pause, le marchand
  const cacher = !enJeu;
  if (cacher !== cache) {
    cache = cacher;
    box.className = cacher ? 'sr-consigne' : 'sr-consigne sr-on sr-consigne-' + IDS[cur];
  }
  if (cacher || !(realDt > 0)) return;
  if (cur === DEPLACER) {
    if (s === STATE.COUNTDOWN) return; // tout le 3-2-1
    T[1] += realDt;
    if (P.vx !== 0 || P.vz !== 0) T[2] += realDt;
    const C = CONSIGNES.deplacer;
    if (T[1] >= C.jeuMax || T[2] >= C.bougeS) finir();
    return;
  }
  T[0] -= realDt;
  if (T[0] <= 0) finir();
}

//#region e5:AE-tuto-bornes
/**
 * § E5.AE : consigne des bornes de PV (en PLAYING). Borne utilisée (coup de pied parti à la touche) : marquée vue sans
 * être montrée, ou, pendant la bulle, fin apresCoupS s après le coup. Déclencheur : 1re partie, bulle libre, borne à
 * l'écran, et PV perdus — ou secoursS s de jeu sans dégât.
 */
function bornes(M) {
  if (!forceeBornes && ctx.game && ctx.game.debug) return; // ?debug : demande à part (__game.tutoBornes)
  const C = CONSIGNES.bornes;
  if (COUPS_TOUCHE[0] !== COUPS_VUS[0]) {
    COUPS_VUS[0] = COUPS_TOUCHE[0];
    M.marquerConsigne(IDS[BORNES]);
    if (cur === BORNES && TBS[2] === 0) {
      TBS[2] = 1;
      if (T[0] > C.apresCoupS) T[0] = C.apresCoupS;
    }
  }
  if (cur >= 0 || montrees[BORNES] === 1) return;
  if (M.getStats().parties !== 0 || M.consigneVue(IDS[BORNES])) return;
  // (dt lu ici, après les retours de la bulle affichée : ce chemin-là ne lit aucun flottant non entier)
  const realDt = RD[0];
  if (realDt > 0) TBS[1] += realDt;
  // armé : la recherche tourne à chaque image (update, avant corps : ≤ CAPS.props projections, 1re partie seulement) —
  // le code est optimisé avant le déclencheur. VIS est celui de cette image s'il a été calculé (armé à l'image d'avant :
  // la 1re image armée ne déclenche pas, 17 ms de retard au plus).
  arme = 1;
  if (!(P.hp < P.maxHp) && TBS[1] < C.secoursS) return;
  if (frais === 1 && VIS[0] >= 0) montrer(BORNES);
}

/** Debug et tests : consigne des bornes active en ?debug (true) ou non (false), à part des trois autres. Rend l'état. */
export function forcerBornes(on) {
  forceeBornes = !!on;
  return forceeBornes;
}

/** Tests : consigne des bornes, flèche, borne désignée. */
export function inspectBornes(out = {}) {
  out.forcee = forceeBornes;
  out.cur = cur >= 0 ? IDS[cur] : null;
  out.montree = montrees[BORNES] === 1;
  out.vue = ctx && ctx.meta ? ctx.meta.consigneVue(IDS[BORNES]) : false;
  out.parties = ctx && ctx.meta ? ctx.meta.getStats().parties : -1;
  out.reste = cur === BORNES ? T[0] : 0;
  out.tempsJeu = TBS[1];
  out.arme = arme === 1;
  out.frappee = TBS[2] === 1;
  out.texte = box !== null && cur === BORNES ? box.textContent : '';
  out.fleche = inspectFleche({});
  return out;
}

/** Tests et planches : pointe de la flèche et borne désignée, en px CSS. */
export function ecranBornes() {
  return ecranFleche({});
}
//#endregion e5:AE-tuto-bornes

/** Tests : consigne affichée, texte, file, montrées pendant la page, vues dans la méta. */
export function inspect(out = {}) {
  out.actives = actives();
  out.cur = cur >= 0 ? IDS[cur] : null;
  out.texte = box !== null && cur >= 0 ? box.textContent : '';
  out.visible = box !== null && (box.className.indexOf('sr-on') >= 0);
  out.file = Array.from(file.subarray(0, fileN), (k) => IDS[k]);
  out.montrees = IDS.filter((_, k) => montrees[k] === 1);
  out.vues = ctx && ctx.meta ? IDS.filter((id) => ctx.meta.consigneVue(id)) : [];
  out.coups = COUPS_RECUS[0];
  return out;
}
//#endregion e5:L-textes-guide
