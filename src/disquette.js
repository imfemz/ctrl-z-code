// Plan addictif, étape 4, chantier Q — le boss peut lâcher une Sauvegarde (ARCHITECTURE.md § E4.Q).
//
// Femz, 16/11 : « une chance sur 70 d'avoir un totem de ressurection sur le 1er boss, 1 chance sur 50 au 5eme boss etc,
// cap a 1 chance sur 30 » ; « totem de res = sauvegarde ». Au k-ième boss tué de la partie : chance 1 / max(30, 75 − 5k)
// (SAUVEGARDE_BOSS), si la Sauvegarde est débloquée au Noyau (meta.ITEM_OK) et pas bannie (BANS.items).
//
// Au sol : une disquette (modèle Blender assets/modeles/disquette.glb, outils/blender/disquette.py), UN InstancedMesh
// (« disquettes ») : + 1 appel de dessin seulement quand une disquette est au sol. Butin GARDÉ : hors du pool des
// gemmes (le regroupement du chantier K ne la voit pas), toujours aspirée en fin de vague, jamais perdue. Ramassée au
// contact : + 1 niveau de Sauvegarde par items.add (comme une carte) ; rangée pleine : un soin à la place.
//
// Hasard : flux PRIVÉ (mulberry32, graine run.seed ^ SEL), un tirage par boss mort avec butin : ni rand, ni randWave,
// ni les coffres ne changent de nombre de tirages. Allocation (§ V) : onBossDeath, update, sync n'allouent rien.
import { ITEM, SAUVEGARDE_BOSS, SFX, TOAST_SAUVE, MODELES } from './config.js';
import { ARGF, BANS, E, F_X, F_Z, P, run } from './state.js';
import { ITEM_OK } from './meta.js';
import { chargerPieces } from './anim/pieces.js';

const S = SAUVEGARDE_BOSS;
const CAP = S.cap;
const TAU = Math.PI * 2;
const PICK_R2 = S.ramassage * S.ramassage;

let ctx = null;
let render = null;
let audio = null;
let fx = null;
let items = null;
let player = null;
let ui = null;
let mesh = null;
let matArr = null;
let modelReady = false;
let modelSettled = null;

const dX = new Float32Array(CAP);
const dZ = new Float32Array(CAP);
const dAge = new Float32Array(CAP);
const dPull = new Uint8Array(CAP); // 1 = aspirée vers le héros (fin de vague)
let count = 0;
const CLOCK = new Float64Array(1);
const CH = new Float64Array(2); // [0] chance écrite par chanceF ; [1] tirage du dernier boss

// compteurs de la partie (inspect)
let bossTues = 0;
let tirages = 0;
let lachers = 0;
let refusVerrou = 0;
let refusBan = 0;
let ramassees = 0;
let plafonds = 0;
let aspirees = 0;
let auto = 0; // ramassées d'office (fin de l'aspiration, pool plein)

const SEL = 0x5a17e3c1;
const seed = new Int32Array(1);
function mulberry(st) {
  const s = (st[0] + 0x6d2b79f5) | 0;
  st[0] = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Chance au k-ième boss tué, écrite dans CH[0] (aucun flottant rendu) : 1 / max(plancher, base − parRang × k). */
export function chanceF(k) {
  const d = S.base - S.parRang * k;
  CH[0] = 1 / (d > S.plancher ? d : S.plancher);
}

export function init(context) {
  ctx = context;
  render = ctx.render;
  audio = ctx.audio;
  fx = ctx.fx || null;
  items = ctx.items || null;
  player = ctx.player || null;
  const material = render.createLitMaterial({ glowColor: S.couleur });
  // § E5.A.5 « deep glow » (décision de Femz du 17/11) : même couleur, mais la lueur de SON matériau (couleur × aFx.y) et
  // l'émissif de sa bande passent au-dessus du seuil du bloom : le bloom à 5 niveaux étale un halo doux autour d'elle,
  // qui respire avec le pouls. Aucun maillage ni appel de dessin en plus (le reflet au sol est la tache de lumières.js).
  const H = S.halo;
  if (H && material.userData.uniforms) {
    const u = material.userData.uniforms;
    if (u.uGlowColor && H.gain > 0) u.uGlowColor.value.multiplyScalar(H.gain);
    if (u.uEmissiveBoost && H.bande > 0) u.uEmissiveBoost.value = H.bande;
  }
  mesh = render.createInstanced(render.emptyModelGeometry(), material, CAP, { castShadow: true, name: 'disquettes' });
  mesh.receiveShadow = true;
  matArr = mesh.instanceMatrix.array;
  modelSettled = chargerPieces(new URL('../' + MODELES.dir + S.modele, import.meta.url).href, { cible: S.hauteur, emissifMateriau: true }).then(
    (d) => {
      render.setModelGeometry(mesh, d);
      modelReady = true;
    },
    (e) => console.warn('Disquette illisible (elle reste ramassable, sans modèle) :', e),
  );
}

/** Promesse tenue (jamais rejetée) quand le modèle est posé ou illisible (préchauffage de main). */
export function whenModelSettled() {
  return modelSettled;
}

/** Départ de partie (resetAll) : sol vide, rang des boss à 0, flux remis à la graine. */
export function reset() {
  count = 0;
  CLOCK[0] = 0;
  bossTues = 0;
  tirages = 0;
  lachers = 0;
  refusVerrou = 0;
  refusBan = 0;
  ramassees = 0;
  plafonds = 0;
  aspirees = 0;
  auto = 0;
  seed[0] = (run.seed ^ SEL) | 0;
  if (mesh !== null) render.commit(mesh, 0);
}

/** Pose une disquette en ARGF[F_X], ARGF[F_Z] (son, éclat). Pool plein : ramassée d'office. */
function poserF() {
  if (count >= CAP) {
    auto++;
    prendre();
    return;
  }
  const i = count++;
  dX[i] = ARGF[F_X];
  dZ[i] = ARGF[F_Z];
  dAge[i] = 0;
  dPull[i] = 0;
  lachers++;
  audio.play(SFX.SAUVE_CHUTE, dX[i], dZ[i]);
  if (fx !== null && fx.spawnSauvegardeF) fx.spawnSauvegardeF(0);
}

/**
 * boss.onDeath, dans le bloc du butin (mort avec butin) : rang k du boss, UN tirage du flux privé, puis la disquette si
 * le tirage gagne et que la Sauvegarde est lâchable. i : indice du boss dans E (position lue dans E.x / E.z).
 */
export function onBossDeath(i) {
  bossTues++;
  tirages++;
  chanceF(bossTues);
  const p = S.forcer >= 0 ? S.forcer : CH[0];
  CH[1] = mulberry(seed);
  if (!(CH[1] < p)) return;
  if (ITEM_OK[ITEM.SAVE] === 0 && !S.siVerrouillee) {
    refusVerrou++;
    return;
  }
  if (BANS.items[ITEM.SAVE] === 1 && !S.siBannie) {
    refusBan++;
    return;
  }
  // à S.ecart du centre du boss, côté héros (le coffre du boss tombe au centre)
  let dx = P.x - E.x[i];
  let dz = P.z - E.z[i];
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > 1e-3) {
    dx /= d;
    dz /= d;
  } else {
    dx = 0;
    dz = 1;
  }
  ARGF[F_X] = E.x[i] + dx * S.ecart;
  ARGF[F_Z] = E.z[i] + dz * S.ecart;
  poserF();
}

/** Ramassage : + 1 niveau de Sauvegarde (items.add, comme une carte) ; rangée pleine : soin à la place. */
function prendre() {
  ramassees++;
  audio.play(SFX.SAUVE_PRISE);
  if (fx !== null && fx.spawnSauvegardeF) {
    ARGF[F_X] = P.x;
    ARGF[F_Z] = P.z;
    fx.spawnSauvegardeF(1);
  }
  ui = ctx.ui || null;
  if (items !== null && items.add(ITEM.SAVE, 1)) {
    if (ui !== null && ui.toastSucces) ui.toastSucces(TOAST_SAUVE.SAUVE);
    return;
  }
  plafonds++;
  if (player !== null) player.heal(S.plafond.soin * P.maxHp);
  if (ui !== null && ui.toastSucces) ui.toastSucces(TOAST_SAUVE.SAUVE_PLEIN);
}

function removeAt(i) {
  const last = --count;
  dX[i] = dX[last];
  dZ[i] = dZ[last];
  dAge[i] = dAge[last];
  dPull[i] = dPull[last];
}

/** Fin de vague (avec chests.endWave) : toujours gardée, aspirée vers le héros. */
export function endWave() {
  for (let i = 0; i < count; i++) {
    if (dPull[i] === 0) aspirees++;
    dPull[i] = 1;
  }
}

/** Fin de l'aspiration (avec chests.collectAll) : ce qui reste au sol est ramassé d'office. */
export function collectAll() {
  while (count > 0) {
    auto++;
    removeAt(count - 1);
    prendre();
  }
}

export function getGroundCount() {
  return count;
}

/** S10 bis (après chests.update) : aspiration, ramassage au contact du héros. */
export function update(dt) {
  CLOCK[0] += dt;
  for (let i = count - 1; i >= 0; i--) {
    dAge[i] += dt;
    const dx = P.x - dX[i];
    const dz = P.z - dZ[i];
    const d2 = dx * dx + dz * dz;
    if (P.alive && d2 <= PICK_R2) {
      removeAt(i);
      prendre();
      continue;
    }
    if (dPull[i] === 1 && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      let step = S.aspiration * dt;
      if (step > d) step = d;
      dX[i] += (dx / d) * step;
      dZ[i] += (dz / d) * step;
    }
  }
}

/** F11 : disquettes au sol — chute en rebond, flottement, balancement face caméra, pouls (échelle et lueur). */
export function sync() {
  if (count === 0) {
    render.commit(mesh, 0);
    return;
  }
  const fxArr = mesh.geometry.attributes.aFx.array;
  const PU = S.pouls;
  const C = S.chute;
  const ci = Math.cos(S.inclinaison);
  const si = Math.sin(S.inclinaison);
  for (let i = 0; i < count; i++) {
    const a = dAge[i];
    let u = a / C.secondes;
    if (u > 1) u = 1;
    // chute amortie : de C.hauteur au survol en C.secondes (vitesse nulle à l arrivée), échelle qui s ouvre de 0,55 à 1
    const fall = (1 - u) * (1 - u) * C.hauteur;
    const pop = 0.55 + 0.45 * (u < 1 ? 1 - (1 - u) * (1 - u) * (1 + 1.7 * u) : 1);
    const ph = Math.sin((a * TAU) / PU.periode);
    const s = pop * (1 + PU.ampleur * ph);
    fxArr[i * 2] = u < 1 ? C.flash * (1 - u) : 0;
    fxArr[i * 2 + 1] = PU.lueurMin + (PU.lueurMax - PU.lueurMin) * (0.5 + 0.5 * ph);
    const y = S.survol + S.flotte * Math.sin(a * S.flotteHz * TAU) + fall;
    const yaw = S.balance * Math.sin(a * S.balanceHz * TAU);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // M = T · Ry(yaw) · Rx(−inclinaison) · S : debout, penchée en arrière (face +Z vers la caméra), balancée
    const o = i * 16;
    matArr[o] = cy * s;
    matArr[o + 1] = 0;
    matArr[o + 2] = -sy * s;
    matArr[o + 3] = 0;
    matArr[o + 4] = -sy * si * s;
    matArr[o + 5] = ci * s;
    matArr[o + 6] = -cy * si * s;
    matArr[o + 7] = 0;
    matArr[o + 8] = sy * ci * s;
    matArr[o + 9] = si * s;
    matArr[o + 10] = cy * ci * s;
    matArr[o + 11] = 0;
    matArr[o + 12] = dX[i];
    matArr[o + 13] = y;
    matArr[o + 14] = dZ[i];
    matArr[o + 15] = 1;
  }
  render.commit(mesh, modelReady ? count : 0);
}

// ----- debug et tests ---------------------------------------------------------------------------------------------------

/** Chance forcée p ∈ [0, 1] ; −1 : la loi. */
export function debugForcer(p) {
  S.forcer = Number.isFinite(p) && p >= 0 && p <= 1 ? p : -1;
}

/** n tirages au rang k sur une COPIE du flux (la partie n'est pas touchée) : { chance, gagnes, n }. Hors combat. */
export function debugTirages(k, n, graine = null) {
  const st = new Int32Array(1);
  st[0] = graine === null ? seed[0] : (graine ^ SEL) | 0;
  chanceF(k);
  const p = CH[0];
  let g = 0;
  for (let j = 0; j < n; j++) if (mulberry(st) < p) g++;
  return { chance: p, gagnes: g, n };
}

/** Pose une disquette en (x, z) (tests, planches). */
export function debugLacher(x, z) {
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  poserF();
}

export function inspect(out = {}) {
  out.count = count;
  out.modelReady = modelReady;
  out.bossTues = bossTues;
  out.tirages = tirages;
  out.lachers = lachers;
  out.refusVerrou = refusVerrou;
  out.refusBan = refusBan;
  out.ramassees = ramassees;
  out.plafonds = plafonds;
  out.aspirees = aspirees;
  out.auto = auto;
  out.dernierTirage = CH[1];
  out.forcer = S.forcer;
  out.sol = [];
  for (let i = 0; i < count; i++) out.sol.push({ x: dX[i], z: dZ[i], age: dAge[i], aspiree: dPull[i] === 1 });
  out.visible = mesh !== null && mesh.visible;
  out.instances = mesh !== null ? mesh.count : 0;
  return out;
}
