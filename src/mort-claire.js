//#region e5:AK-mort-claire
// Cause de la mort évidente (ARCHITECTURE.md § E5.AK ; Femz, 22/11 — testeur : « je sais pas comment je suis mort »).
// Au coup mortel, EN SOLO SEULEMENT (le multi prévu n'aura jamais de ralenti ni de pause globale) :
//   - ralenti : ECHELLE[0] (lu par main, × simDt) vaut MORT_CLAIRE.ralenti.echelle pendant ralenti.duree s réelles, puis
//     PHASE[0] = FINI et main passe à l'écran de fin (enterGameOver, comme avant) ;
//   - caméra : camera.REGARD tire la cible vue vers un point de cadrage héros–source ;
//   - repère : flèche pixel rouge (même recette que la flèche du tuto des bornes, § E5.AE) au-dessus de la source — le
//     robot vivant qui a porté le coup (suivi par son uid), sinon l'endroit d'où le coup est venu (damage.MORT_POS).
// SOLO[0] = 1 aujourd'hui (le jeu est toujours solo) ; le multi devra le mettre à 0 : la mort passe alors directement à la
// suite, rien ne ralentit le monde des autres. En ?debug, tout est coupé sauf demande (forcer(true)) : les tests qui
// attendent GAMEOVER à l'image suivant la mort ne changent pas.
// Allocation (§ V ; piège du § E5.AE règle 9 : un code qui ne sert qu'une seconde par partie n'est jamais « chaud » à ce
// moment-là) : update et sync tournent ENTIERS à chaque image depuis le lancement — toutes les lectures et tous les
// calculs d'abord, l'état ne fait que CHOISIR entre des valeurs déjà calculées ; la passe sur E ne couvre qu'un
// emplacement hors de la mort (le code reste chaud), E.count à l'image de la mort et pendant le ralenti.
import * as THREE from 'three';
import { CAUSE_COUNT, ENEMIES, MORT_CLAIRE, STATE } from './config.js';
import { E, P } from './state.js';
import { MORT_CAUSE, MORT_POS } from './damage.js';
import { REGARD } from './camera.js';
import { FLECHE, dessinerFleche } from './tuto-bornes.js';

const M = MORT_CLAIRE;
const FW = FLECHE.W;
const FH = FLECHE.H;
const ART = FLECHE.ART;
const HALO = FLECHE.HALO;

/** 1 : partie solo (aujourd'hui toujours) ; 0 : multi — jamais de ralenti (contrat § E5.AK, règle 1). */
export const SOLO = new Uint8Array([1]);
/** Multiplicateur du temps simulé, lu par main (simDt × ECHELLE[0]) : 1 hors du ralenti. */
export const ECHELLE = new Float64Array([1]);
/** Phases : héros vivant (ou rien en cours), ralenti en cours, fini (écran de fin, ou ralenti refusé). */
export const VIVANT = 0;
export const RALENTI = 1;
export const FINI = 2;
export const PHASE = new Int32Array(1);
/** dt réel de l'image (s), écrit par main avant update (aucun flottant passé en argument, § V). */
export const DT = new Float64Array(1);
const ACTIF = new Uint8Array([1]); // 0 en ?debug sans demande

// par cause (CAUSE.*) : robot à suivre
const SUIVI_T = Int8Array.from(M.suivi, (s) => s[0]);
const SUIVI_M = Uint8Array.from(M.suivi, (s) => s[1]);
// par type de robot : hauteur de la tête (hauteur + vol du drone), rayon de référence (élites et fusionnés : plus grands)
const TETE = Float64Array.from(ENEMIES.types, (t) => t.height + (t.hover || 0));
const RAYON = Float64Array.from(ENEMIES.types, (t) => t.radius);
// Réglages lus dans la boucle : dans un tableau typé (représentation flottante). Un nombre lu sur un objet de config
// est « étiqueté » : mêlé à un flottant calculé dans un choix (a ? x : config), il force l'emballage du flottant (§ V).
const K = new Float64Array(14);
const K_R2 = 0;
const K_LEVE = 1;
const K_SOL = 2;
const K_ECHELLE = 3;
const K_DUREE = 4;
const K_MONTEE = 5;
const K_DEMI = 6;
const K_POP = 7;
const K_REBOND = 8;
const K_ENTREE = 9;
const K_PX720 = 10;
const K_AMPL = 11;
const K_PERIODE = 12;
const K_UN = 13; // 1, en flottant
K[K_R2] = M.rayonSuivi * M.rayonSuivi;
K[K_LEVE] = M.fleche.leve;
K[K_SOL] = M.fleche.sol;
K[K_ECHELLE] = M.ralenti.echelle;
K[K_DUREE] = M.ralenti.duree;
K[K_MONTEE] = M.cadrage.montee;
K[K_DEMI] = M.cadrage.demiEcartMax;
K[K_POP] = M.fleche.pop;
K[K_REBOND] = M.fleche.rebond;
K[K_ENTREE] = M.fleche.entree;
K[K_PX720] = M.fleche.pxArt720;
K[K_AMPL] = M.fleche.flottement.amplitude;
K[K_PERIODE] = M.fleche.flottement.periode;
K[K_UN] = 1;

const S = new Float64Array(12);
const S_T = 0; // s réelles depuis le coup mortel
const S_SX = 1; // source montrée (m) : x, z, hauteur de la pointe
const S_SZ = 2;
const S_SY = 3;
const S_CX = 4; // point de cadrage
const S_CZ = 5;
const S_POIDS = 6; // poids du recadrage écrit dans camera.REGARD
const S_OP = 7; // flèche : opacité, échelle, horloge du flottement, profondeur, visible
const S_SC = 8;
const S_BOB = 9;
const S_PRF = 10;
const S_VIS = 11;
const I = new Int32Array(7);
const I_UID = 0; // uid du robot suivi (0 : aucun)
const I_IDX = 1; // son emplacement à cette image (−1 : aucun, ou détruit)
const I_CAUSE = 2; // cause du coup mortel retenue au début
const I_FLECHE = 3; // 1 : il y a une source à montrer (cause connue)
const I_ROBOT = 4; // 1 : la source est un robot encore en vie
const I_IMAGES = 5; // images jouées pendant le ralenti (mesure)
const I_DEBUTS = 6; // morts vues (mesure)
I[I_IDX] = -1;

let game = null;
let camera = null;
let sprite = null;
let mat = null;
const V = new THREE.Vector3();

/** Crée la flèche (une fois, hors combat, avant le préchauffage). */
export function init(ctx) {
  if (sprite !== null || !ctx || !ctx.scene || !ctx.camera || !ctx.render || !ctx.game) return;
  game = ctx.game;
  camera = ctx.camera;
  ACTIF[0] = ctx.game.debug ? 0 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = FW * ART;
  canvas.height = FH * ART;
  dessinerFleche(canvas.getContext('2d'), M.couleurs, M.halo);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.name = 'mort-claire';
  mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  sprite = new THREE.Sprite(mat);
  sprite.name = 'mort-claire';
  sprite.center.set(0.5, HALO / FH); // ancrée par la pointe du triangle
  sprite.renderOrder = 998; // sous la flèche du tuto (999) et l'invite de la touche (1000)
  sprite.frustumCulled = false;
  sprite.visible = false;
  mat.opacity = 0;
  ctx.scene.add(sprite);
  ctx.render.garderNet(sprite); // hors de l'effet CRT / pixel : nette, devant la scène
}

/** Nouvelle partie : plus rien en cours, caméra rendue au héros, flèche cachée. */
export function reset() {
  PHASE[0] = VIVANT;
  ECHELLE[0] = 1;
  S.fill(0);
  const d = I[I_DEBUTS];
  I.fill(0);
  I[I_IDX] = -1;
  I[I_DEBUTS] = d;
  REGARD.fill(0);
  if (sprite !== null) {
    sprite.visible = false;
    mat.opacity = 0;
  }
}

/** ?debug : ralenti, recadrage et flèche demandés (true) ou coupés (false). Hors debug : toujours actifs. */
export function forcer(on) {
  ACTIF[0] = on ? 1 : 0;
  return ACTIF[0] === 1;
}

/** Tests : partie solo (1) ou multi simulé (0). */
export function solo(on) {
  SOLO[0] = on ? 1 : 0;
  return SOLO[0] === 1;
}

/**
 * Chaque image, avant postSim (F8), DÈS LE LANCEMENT. Détecte le coup mortel (héros mort dans un état qui simule, rien en
 * cours), retient la source, avance le ralenti, suit le robot, écrit ECHELLE, PHASE et camera.REGARD.
 * SANS BRANCHE hors de la boucle : tout est lu et calculé à chaque appel, l'état choisit entre des valeurs calculées.
 */
export function update() {
  const d0 = DT[0];
  const z0 = d0 - d0;
  const dt = d0 > 0 ? d0 : z0;
  const st = game.state;
  const sim = (st === STATE.PLAYING) | (st === STATE.WAVE_CLEAR) | (st === STATE.COUNTDOWN);
  const mort = P.alive ? 0 : 1;
  const ph0 = PHASE[0];
  const debut = mort & sim & (ph0 === VIVANT ? 1 : 0);
  const ralenti = ph0 === RALENTI ? 1 : 0;
  const actif = ACTIF[0] & SOLO[0];
  const c0 = MORT_CAUSE[0];
  const cause = c0 < CAUSE_COUNT ? c0 : 0;
  const ty = SUIVI_T[cause];
  const md = SUIVI_M[cause];
  // recherche du robot de la cause : à l'image de la mort SEULEMENT. Mesuré (22/11) : faite à chaque image du ralenti,
  // le plus proche « s'améliore » à presque chaque emplacement d'une horde et Maglev emballe `best` (≈ 5 Ko/image)
  const cherche = ((ty >= 0 ? 1 : 0) | (md > 0 ? 1 : 0)) & debut;
  const rx = MORT_POS[0];
  const rz = MORT_POS[1];
  const uid = I[I_UID];
  const X = E.x;
  const Z = E.z;
  const AL = E.alive;
  const SUS = E.sus;
  const TY = E.type;
  const MD = E.mod;
  const UID = E.uid;
  const RAD = E.radius;
  // passe sur E : le robot de la cause le plus proche du point de référence (image de la mort), le robot suivi (ralenti)
  // Passe ENTIÈRE à l'image de la mort, et au ralenti seulement si le robot suivi a changé d'emplacement (compaction de
  // E en fin d'image : rare). Sinon UN emplacement : le suivi (son emplacement d'avant, vérifié par l'uid), ou 0 hors de la
  // mort (le code reste chaud). Mesuré (22/11) : la passe entière à chaque image du ralenti coûtait ≈ 5 Ko/image.
  const n0 = E.count;
  const ci = I[I_IDX];
  const cis = ((ci >= 0 ? 1 : 0) & (ci < n0 ? 1 : 0)) === 1 ? ci : 0;
  const garde = ralenti & (ci >= 0 ? 1 : 0) & (ci < n0 ? 1 : 0) & (UID[cis] === uid ? 1 : 0) & (AL[cis] === 1 ? 1 : 0);
  const perdu = ralenti & (garde === 1 ? 0 : 1) & (uid !== 0 ? 1 : 0) & I[I_ROBOT];
  const entiere = debut | perdu;
  const a0 = garde === 1 ? cis : 0;
  const cis1 = cis + 1; // calculé AVANT le choix : une opération jamais faite avant la mort désoptimiserait update
  const nMin = n0 > 0 ? 1 : 0;
  const nGarde = garde === 1 ? cis1 : nMin;
  const n = entiere === 1 ? n0 : nGarde;
  let best = K[K_R2];
  let bi = -1;
  let ti = -1;
  for (let i = a0; i < n; i++) {
    const v = (AL[i] === 1 ? 1 : 0) & (SUS[i] !== 2 ? 1 : 0);
    const okT = (ty < 0 ? 1 : 0) | (TY[i] === ty ? 1 : 0);
    const okM = (md === 0 ? 1 : 0) | (MD[i] === md ? 1 : 0);
    const dx = X[i] - rx;
    const dz = Z[i] - rz;
    const d2 = dx * dx + dz * dz;
    const m = v & cherche & okT & okM & (d2 < best ? 1 : 0);
    best = m === 1 ? d2 : best;
    bi = m === 1 ? i : bi;
    const u = v & (UID[i] === uid ? 1 : 0) & (uid !== 0 ? 1 : 0);
    ti = u === 1 ? i : ti;
  }
  // robot montré à cette image : celui trouvé (mort) ou celui suivi (ralenti) ; −1 : aucun
  const idxSuite = ralenti === 1 ? ti : -1;
  const idx = debut === 1 ? bi : idxSuite;
  const js = idx >= 0 ? idx : 0;
  const tj = TY[js];
  const tjs = tj < TETE.length ? tj : 0;
  const ux = X[js];
  const uz = Z[js];
  const uy = TETE[tjs] * (RAD[js] / RAYON[tjs]) + K[K_LEVE];
  const uu = UID[js];
  const suit = idx >= 0 ? 1 : 0;
  // source : le robot, sinon (au début) l'endroit du coup, sinon la dernière place connue
  const sx0 = S[S_SX];
  const sz0 = S[S_SZ];
  const sy0 = S[S_SY];
  const sDebut = debut === 1;
  const sSuit = suit === 1;
  const ax = sDebut ? rx : sx0;
  const az = sDebut ? rz : sz0;
  S[S_SX] = sSuit ? ux : ax;
  S[S_SZ] = sSuit ? uz : az;
  const sol = K[K_SOL];
  const ay = sDebut ? sol : sy0;
  S[S_SY] = sSuit ? uy : ay;
  const uid0 = I[I_UID];
  const uidNeuf = suit === 1 ? uu : 0; // AVANT le choix : aucune comparaison faite seulement à l'image de la mort
  I[I_UID] = debut === 1 ? uidNeuf : uid0;
  I[I_IDX] = idx;
  const cause0 = I[I_CAUSE];
  const fl0 = I[I_FLECHE];
  const rb0 = I[I_ROBOT];
  I[I_CAUSE] = debut === 1 ? cause : cause0;
  const connue = cause > 0 ? 1 : 0; // AVANT le choix
  I[I_FLECHE] = debut === 1 ? connue : fl0;
  I[I_ROBOT] = (debut | ralenti) === 1 ? suit : rb0;
  // temps et phases
  const t0 = S[S_T];
  const zero = t0 - t0; // 0, en flottant
  const tdt = t0 + dt; // AVANT le choix (même raison)
  const tSuite = ph0 === VIVANT ? zero : tdt;
  const t1 = debut === 1 ? zero : tSuite;
  S[S_T] = t1;
  const finRal = ralenti & (t1 >= K[K_DUREE] ? 1 : 0);
  const phDebut = actif === 1 ? RALENTI : FINI; // AVANT le choix (même raison)
  const phSuite = finRal === 1 ? FINI : ph0;
  const ph1 = debut === 1 ? phDebut : phSuite;
  const ph = mort === 0 ? VIVANT : ph1;
  PHASE[0] = ph;
  const ech = K[K_ECHELLE];
  const un = K[K_UN];
  ECHELLE[0] = ph === RALENTI ? ech : un;
  const im0 = I[I_IMAGES];
  const im1 = im0 + 1; // AVANT le choix (même raison)
  const imSuite = ralenti === 1 ? im1 : im0;
  I[I_IMAGES] = debut === 1 ? 0 : imSuite;
  I[I_DEBUTS] += debut;
  // caméra : glissé (smoothstep) vers le point de cadrage — milieu héros–source, ou la source à demiEcartMax du centre
  const montre = (ph !== VIVANT ? 1 : 0) & actif & I[I_FLECHE];
  const u0 = t1 / K[K_MONTEE];
  const uc = u0 < un ? u0 : un;
  const lisse = uc * uc * (3 - 2 * uc);
  const w = montre === 1 ? lisse : zero;
  const px = P.x;
  const pz = P.z;
  const ex = S[S_SX] - px;
  const ez = S[S_SZ] - pz;
  const d = Math.sqrt(ex * ex + ez * ez);
  const demi = d * 0.5;
  const dm = K[K_DEMI];
  const k = demi < dm ? demi : dm;
  const q = k / (d > 1e-6 ? d : un);
  const inv = d > 1e-6 ? q : zero;
  S[S_CX] = S[S_SX] - ex * inv;
  S[S_CZ] = S[S_SZ] - ez * inv;
  S[S_POIDS] = w;
  REGARD[0] = w;
  REGARD[1] = S[S_CX];
  REGARD[2] = S[S_CZ];
}

/**
 * F11, chaque image DÈS LE LANCEMENT : flèche au-dessus de la source (pop + fondu d'entrée, flottement), taille fixe à
 * l'écran (profondeur comprise en perspective). Sans branche, comme tuto-bornes.syncFleche.
 */
export function sync() {
  if (sprite === null) return;
  const d0 = DT[0];
  const z0 = d0 - d0;
  const dt = d0 > 0 ? d0 : z0;
  const montre = (PHASE[0] !== VIVANT ? 1 : 0) & ACTIF[0] & SOLO[0] & I[I_FLECHE];
  const t = S[S_T];
  const un = K[K_UN];
  const zero = t - t;
  const qp = t / K[K_POP];
  const q = qp < un ? qp : un;
  const c1 = K[K_REBOND];
  const x = q - 1;
  const sc = 0.35 + 0.65 * (1 + (c1 + 1) * x * x * x + c1 * x * x);
  const ae = t / K[K_ENTREE];
  const aE = ae < un ? ae : un;
  const a = montre === 1 ? aE : zero;
  S[S_BOB] += dt;
  const cam = camera.threeCamera;
  cam.updateMatrixWorld();
  const sx = S[S_SX];
  const sy = S[S_SY];
  const sz = S[S_SZ];
  V.set(sx, sy, sz).applyMatrix4(cam.matrixWorldInverse);
  const vz = -V.z;
  const vmin = vz - vz + 0.01;
  const prof = vz > 0.01 ? vz : vmin;
  const persp = cam.isPerspectiveCamera === true;
  S[S_PRF] = persp ? prof : un;
  const hy = ((((FH * K[K_PX720]) / 720) * 2) / cam.projectionMatrix.elements[5]) * S[S_PRF];
  const unArt = hy / FH;
  const bob = K[K_AMPL] * (0.5 + 0.5 * Math.sin((S[S_BOB] * 6.283185307179586) / K[K_PERIODE]));
  sprite.position.x = sx;
  sprite.position.y = sy + bob * unArt;
  sprite.position.z = sz;
  sprite.scale.x = hy * sc * (FW / FH);
  sprite.scale.y = hy * sc;
  sprite.scale.z = 1;
  S[S_OP] = a;
  S[S_SC] = sc;
  const vis = a > 0.002;
  S[S_VIS] = vis ? un : zero;
  mat.opacity = S[S_VIS] * a;
  sprite.visible = vis;
}

/** Tests : état complet (hors combat : alloue). */
export function inspect(out = {}) {
  out.phase = ['vivant', 'ralenti', 'fini'][PHASE[0]];
  out.echelle = ECHELLE[0];
  out.actif = ACTIF[0] === 1;
  out.solo = SOLO[0] === 1;
  out.t = S[S_T];
  out.images = I[I_IMAGES];
  out.debuts = I[I_DEBUTS];
  out.cause = I[I_CAUSE];
  out.source = { x: S[S_SX], y: S[S_SY], z: S[S_SZ] };
  out.robot = I[I_ROBOT] === 1;
  out.uid = I[I_UID];
  out.idx = I[I_IDX];
  out.fleche = I[I_FLECHE] === 1;
  out.cadrage = { x: S[S_CX], z: S[S_CZ], poids: S[S_POIDS] };
  out.regard = Array.from(REGARD);
  out.sprite = sprite === null ? null : { visible: sprite.visible, opacite: mat.opacity, x: sprite.position.x, y: sprite.position.y, z: sprite.position.z, scaleY: sprite.scale.y, echelle: S[S_SC] };
  return out;
}

/** Tests et captures : position à l'écran (px CSS) de la pointe de la flèche et du pied de la source. */
export function ecran(out = {}) {
  if (camera === null || sprite === null) return out;
  const cam = camera.threeCamera;
  cam.updateMatrixWorld();
  const el = document.querySelector('canvas');
  const r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const px = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(cam);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, ndc: [v.x, v.y, v.z] };
  };
  out.pointe = px(sprite.position.x, sprite.position.y, sprite.position.z);
  out.source = px(S[S_SX], 0, S[S_SZ]);
  out.heros = px(P.x, 0, P.z);
  out.vue = { w: r.width, h: r.height };
  return out;
}
//#endregion e5:AK-mort-claire
