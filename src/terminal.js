// Étape 5, chantier V (ARCHITECTURE.md § E5.V, tâches 5-6) — le TERMINAL : au milieu d'un palier (vagues 2, 7, 12… :
// isTerminalWave), le terminal tombe dans l'arène, entre PALIERS_VAGUES.terminal.distMin et distMax du héros,
// dans le champ visible. On y va si on veut : à portée (rayonInteraction), l'invite « Interagir » le montre (props.js lui
// laisse la place : pas de coup de pied) et un appui ouvre le décryptage EN PAUSE (main.ouvrirTerminal). Un seul usage ;
// il repart après `presence` s, après usage, ou avant l'arrivée du marchand du décryptage (forceDepart, T5).
// 22/11 : il a SON modèle (assets/modeles/terminal.glb, outils/blender/terminal.py) — un pupitre qui tombe du ciel,
// reste posé (le héros bute dessus) et remonte ; il ne réquisitionne plus le drone du marchand (un appel de dessin de
// plus, seulement quand il est là). Cercle au sol : l'anneau d'atterrissage de fx, relancé à intervalle tant qu'il est
// posé (aucun lot neuf).
// Zéro allocation en combat : tableaux typés ; le point de pose est tiré une fois par vague (hors chemin chaud d'image).
import * as THREE from 'three';
import { MODELES, PALIERS_VAGUES, PALETTE, SFX, TRAUMA, isTerminalWave } from './config.js';
import { P, run } from './state.js';
import { chargerPieces } from './anim/pieces.js';
import { ACTION_INTERACT } from './config.js'; // § E5.X6 (D5) : Interagir hors de portée relance l'anneau de portée

const ABSENT = 0;
const ARRIVE = 1;
const POSE = 2;
const PART = 3;
const ETATS = ['absent', 'arrive', 'pose', 'part'];
const PULSE_S = 1.2; // s entre deux anneaux au sol tant qu'il est posé

/** [0] = 1 si le héros est à portée du terminal posé et pas encore utilisé ; [1], [2] = sa position (lus par props). */
export const TPRET = new Float64Array(3);

const T = new Float64Array(8); // x, z, temps posé, utilisé (0/1), horloge de l'anneau, arrivées, horloge d'animation, lacet
const TX = 0;
const TZ = 1;
const TPOSE = 2;
const UTIL = 3;
const PULSE = 4;
const ARRIVEES = 5;
const ANIM = 6;
const LACET = 7;
let etat = ABSENT;
let ctx = null;
let mesh = null;
let modelSettled = Promise.resolve();
// § E5.X6 (D5, H7) : [0] appuis sur Interagir hors de portée (terminal posé, pas encore utilisé), [1] à portée (0 / 1),
// lus par le HUD (ui.js) et les tests. Entiers : rien d'alloué.
export const TX6 = new Int32Array(2);

export function init(context) {
  ctx = context;
  const C = PALIERS_VAGUES.terminal;
  const render = ctx.render;
  if (render && !mesh) {
    mesh = new THREE.Mesh(render.emptyModelGeometry(), render.createLitMaterial({ glowColor: PALETTE.merchant }));
    mesh.name = 'terminal';
    render.makeShadowCaster(mesh);
    mesh.receiveShadow = true;
    mesh.visible = false;
    ctx.scene.add(mesh);
    modelSettled = chargerPieces(new URL('../' + MODELES.dir + C.modele, import.meta.url).href, { cible: C.hauteur, emissifMateriau: true }).then(
      (d) => render.setModelGeometry(mesh, d),
      (e) => console.warn('Terminal illisible (il reste utilisable, sans modèle) :', e),
    );
  }
  reset();
}

/** Promesse tenue (jamais rejetée) quand le modèle du terminal est posé ou illisible (préchauffage de main). */
export function whenModelSettled() {
  return modelSettled;
}

export function reset() {
  etat = ABSENT;
  TPRET.fill(0);
  TX6.fill(0); // § E5.X6
  T.fill(0);
  if (mesh) mesh.visible = false;
}

/** Petit générateur à part (le terminal ne doit rien tirer des flux de la partie : la suite des vagues reste la même). */
function alea(k) {
  const x = Math.sin((run.seed | 0) * 0.0013 + run.wave * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const PJ = new Float64Array(6); // § E5.AB.12 : projection en pixels (camera.ecranT)
/** Le point (x, z) est-il dans le champ visible (même projection que les flèches de bord d'écran de ui.js) ? */
function dansLeChamp(x, z, marge) {
  const view = ctx.camera && ctx.camera.view;
  if (!view || !(view.visHalfW > 0)) return true;
  //#region e5:AB-camera-3p
  if (view.persp === 1) {
    // § E5.AB.12 : perspective — vraie projection en pixels, marge en pixels du champ visible
    PJ[0] = x;
    PJ[1] = 0;
    PJ[2] = z;
    ctx.camera.ecranT(PJ);
    const mp = marge * view.visPxPerMeter;
    return PJ[5] === 1 && PJ[3] > mp && PJ[3] < view.widthPx - mp && PJ[4] > mp && PJ[4] < view.heightPx - mp;
  }
  //#endregion e5:AB-camera-3p
  const sinP = view.visHalfH / view.visHalfD;
  const vx = x - view.targetX;
  const vz = z - view.targetZ;
  const a = vx * view.rightX + vz * view.rightZ;
  const b = (vx * view.upX + vz * view.upZ) * sinP;
  return a > -view.visHalfW + marge && a < view.visHalfW - marge && b > -view.visHalfH + marge && b < view.visHalfH - marge;
}

/**
 * Début de la vague n (main.js, juste après waves.startWave : bascule et fin du compte à rebours). Vague à terminal :
 * point libre entre distMin et distMax du héros, dans l'arène, hors obstacle, dans le champ si possible ; le drone s'y
 * pose. Rend vrai si un terminal arrive.
 */
export function onWaveStart(n) {
  if (!isTerminalWave(n) || etat !== ABSENT) return false;
  const C = PALIERS_VAGUES.terminal;
  const world = ctx.world;
  const r = 1.2; // m — emprise du terminal posé (avec marge)
  let bx = 0;
  let bz = 0;
  let trouve = 0; // 2 : dans le champ ; 1 : dans l'arène seulement
  for (let k = 0; k < 48 && trouve < 2; k++) {
    const a = alea(k) * Math.PI * 2;
    const d = C.distMin + (C.distMax - C.distMin) * alea(k + 100);
    const x = P.x + Math.sin(a) * d;
    const z = P.z + Math.cos(a) * d;
    if (!world.isInsideArena(x, z, r) || world.overlaps(x, z, r)) continue;
    const champ = dansLeChamp(x, z, 1.5) ? 2 : 1;
    if (champ > trouve) {
      trouve = champ;
      bx = x;
      bz = z;
    }
  }
  if (trouve === 0) return false; // héros coincé : pas de terminal cette fois
  T[TX] = bx;
  T[TZ] = bz;
  T[TPOSE] = 0;
  T[UTIL] = 0;
  T[PULSE] = 0;
  T[ARRIVEES]++;
  T[ANIM] = 0;
  T[LACET] = C.lacet; // écran vers la caméra
  etat = ARRIVE;
  return true;
}

/** S11 bis (après shop.update) : chute, pose, présence, portée, départ. */
export function update(dt) {
  TPRET[0] = 0;
  if (etat === ABSENT) return;
  const C = PALIERS_VAGUES.terminal;
  if (etat === ARRIVE) {
    T[ANIM] += dt;
    if (T[ANIM] >= C.chute) {
      etat = POSE;
      T[TPOSE] = 0;
      T[PULSE] = PULSE_S; // un anneau tout de suite
      if (ctx.audio) ctx.audio.play(SFX.TERMINAL, T[TX], T[TZ]); // § E5.Q ter (Femz, 21/11) : le terminal est disponible
      if (ctx.camera && ctx.camera.addTraumaAt) ctx.camera.addTraumaAt(C.secousse, TRAUMA.KILL, T[TX], T[TZ]);
    }
    return;
  }
  if (etat === POSE) {
    T[TPOSE] += dt;
    if (T[TPOSE] >= C.presence) {
      forceDepart();
      return;
    }
    T[PULSE] += dt;
    if (T[PULSE] >= PULSE_S && ctx.fx) {
      T[PULSE] = 0;
      ctx.fx.spawnRing(T[TX], T[TZ], C.rayonInteraction, PALETTE.merchant);
    }
    const dx = P.x - T[TX];
    const dz = P.z - T[TZ];
    const d2 = dx * dx + dz * dz;
    // le héros bute sur le pupitre (repoussé sur son bord, il glisse autour), comme sur une borne (props.js)
    const rb = C.rayonCorps + P.radius;
    if (P.alive && d2 < rb * rb) {
      const dd = Math.sqrt(d2);
      const ux = dd > 1e-6 ? dx / dd : 0;
      const uz = dd > 1e-6 ? dz / dd : 1;
      P.x = T[TX] + ux * rb;
      P.z = T[TZ] + uz * rb;
    }
    if (T[UTIL] === 0) {
      const R = C.rayonInteraction;
      if (d2 <= R * R) {
        TPRET[0] = 1;
        TPRET[1] = T[TX];
        TPRET[2] = T[TZ];
      } else if (P.alive && ctx.input && ctx.input.pressed(ACTION_INTERACT)) {
        // § E5.X6 (D5) : Interagir hors de portée — l'anneau de portée repart tout de suite, le HUD dit « approchez-vous »
        TX6[0]++;
        T[PULSE] = 0;
        if (ctx.fx) ctx.fx.spawnRing(T[TX], T[TZ], R, PALETTE.merchant);
      }
      TX6[1] = TPRET[0] === 1 ? 1 : 0;
    }
    return;
  }
  // PART : il remonte, puis disparaît
  T[ANIM] += dt;
  if (T[ANIM] >= C.depart) etat = ABSENT;
}

/** Pose du maillage (chute, posé, remontée). Après update, une fois par image ; n'alloue rien. */
export function sync() {
  if (!mesh) return;
  if (etat === ABSENT) {
    mesh.visible = false;
    return;
  }
  const C = PALIERS_VAGUES.terminal;
  let y = 0;
  if (etat === ARRIVE) {
    const u = 1 - T[ANIM] / C.chute; // accélération constante : y = h × (1 − (t/T)²)
    y = C.hauteurChute * (1 - (1 - u) * (1 - u));
  } else if (etat === PART) {
    const u = T[ANIM] / C.depart;
    y = C.hauteurChute * u * u;
  }
  mesh.position.set(T[TX], y, T[TZ]);
  mesh.rotation.y = T[LACET];
  mesh.visible = true;
}

/** Le terminal repart (fin de présence, après usage, décryptage, mort du héros). */
export function forceDepart() {
  TPRET[0] = 0;
  if (etat === ARRIVE || etat === POSE) {
    etat = PART;
    T[ANIM] = 0;
  }
}

/** Le décryptage du terminal vient d'être ouvert : un seul usage, il repartira à la fermeture. */
export function utiliser() {
  T[UTIL] = 1;
  TPRET[0] = 0;
}

/** Fermeture du décryptage ouvert depuis le terminal : il repart. */
export function consommer() {
  T[UTIL] = 1;
  forceDepart();
}

/** Position du terminal posé (out[0] = x, out[1] = z) pour la flèche de bord d'écran ; false sinon. */
export function getBeacon(out) {
  if (etat !== POSE || T[UTIL] === 1) return false;
  out[0] = T[TX];
  out[1] = T[TZ];
  return true;
}

/** Posé et pas encore utilisé (HUD : « Terminal posé »). */
export function estDisponible() {
  return etat === POSE && T[UTIL] === 0;
}

export function estPose() {
  return etat === POSE;
}

/** § E5.X6 (H7) : secondes entières (arrondies au-dessus) avant qu'il reparte seul ; 0 s'il n'est pas posé. Entier (§ V). */
export function secondesRestantes() {
  if (etat !== POSE) return 0;
  const r = Math.ceil(PALIERS_VAGUES.terminal.presence - T[TPOSE]);
  return r > 0 ? r | 0 : 0;
}

/** Tests. */
export function inspect(out = {}) {
  out.etat = ETATS[etat];
  out.x = T[TX];
  out.z = T[TZ];
  out.utilise = T[UTIL] === 1;
  out.pret = TPRET[0] === 1;
  out.pose = T[TPOSE];
  out.arrivees = T[ARRIVEES];
  out.appelsHorsPortee = TX6[0]; // § E5.X6 (D5)
  out.secondesRestantes = secondesRestantes(); // § E5.X6 (H7)
  return out;
}
