// ANIMATIONS v3 — boss en PIÈCES (assets/modeles/boss.glb) : marche lourde, gestes, flammes simulées. Retour de Femz du
// 13/11 : « fais marcher ses jambes, là il bouge tout son corps pareil en un bloc » ; « une vraie simulation de flammes ».
//
// Un SkinnedMesh (un os par pièce : corps, tete, jambe_g/d, bras_g/d → bande_poing_g/d, p2_poing_g/d, p2_bandes,
// p2_fissures, p2_reacteur ; p2_flammes est masqué : remplacé par les particules de flammes.js). Matériau = la version
// peinte du matériau du boss actuel (mêmes uniformes : flash, lueur, fenêtre de révélation autour du joueur).
// La pose de base vient de la simulation du boss (position, cap, penché, soulèvement, écrasement : tableau T de
// boss.js) ; ce module la remplace pour ce qui « bougeait en bloc » :
//   - MARCHE DE COMPAS : phase intégrée sur la vitesse RÉELLE du boss (E.vx, E.vz) ; le modèle n'a pas de genou :
//     la jambe d'appui recule linéairement (pied immobile au sol), la jambe libre revient en se raccourcissant
//     (piston), le bassin descend de L (1 − cos α) pour garder le pied d'appui au sol et roule vers lui, bras en
//     opposition, tête qui suit le cap avec retard et hoche au pas ; à chaque appui : poussière au pied et secousse
//     très légère (≤ ANIM.boss.secoussePas, dans les plafonds de SHAKE, groupe boss) ;
//   - RUÉE : bras rejetés, course (même calage de foulée, cadence élevée) ; VISÉE : bras ramenés ;
//   - FRAPPE : élan des deux poings au-dessus de la tête pendant le télégraphe, abattus d'un coup à l'impact ;
//   - LANCER DU MORTIER : à chaque obus, recul du buste (les cheminées partent en arrière) et bouffée de flammes ;
//   - INVOCATION : bras écartés ; ÉTOURDISSEMENT (passage en phase 2) : bras ballants ;
//   - PHASE 2 : pièces incandescentes visibles, réacteur qui pulse ; flammes simulées aux cheminées, aux fissures et
//     au réacteur (en phase 1 : fumée seule aux cheminées).
// Mesures (tests/anim-boss.mjs) : vitesse du pied d'appui, coût, allocations.
//
// INTÉGRATION (src/boss.js) : init → bossCorps.init(scene, materiauPeint, donnees de chargerPieces('boss.glb')) à la
// place de buildBody / buildOverlay ; update(dt) → bossCorps.update(dt, i) en fin de updateBoss (état, minuteries,
// vitesse) ; sync() → bossCorps.sync(T, état) à la place de l'écriture de mesh.matrix (même formule, rebond et roulis
// recalculés ici) ; startMortar → bossCorps.tirMortier(cheminée) au départ de chaque obus (boss-anim) ; le son d'un
// pas lourd n'existe pas (SFX) : à ajouter avec le lot audio (bossCorps.pas déclenche l'événement). Clés : ANIM.boss →
// BOSS.anim (marche, gestes) et ANIM.flammes → BOSS.phase2.flames.
// INTÉGRÉ (étape « animations », ARCHITECTURE.md § Z sexies) : boss.setModele → init({ scene, materiau, donnees, T,
//   chaud, ancien }) (synchrone ; T = tableau de pose de boss.js, chaud() = phase 2 allumée, ancien = maillage « boss »
//   de boss.js, qui reste l'ancre de pose et de visibilité, sur le calque 7 : jamais dessiné) ; fin de boss.update →
//   update(dt) ; boss.sync, après la matrice de « boss » → sync() ; surPas.f joue SFX.BOSS_STEP (boss.js) ; reset() à
//   chaque reset du boss. Plus d'import de boss.js (cycle) : tout passe par init. Chute (arrivée) : la racine suit la
//   hauteur de chute T[T_PY] et le boss ne marche pas (le prototype lisait T_LIFT et un index de boss −1).
import { MARCHE, COURSE } from './ref-marche.js';
import * as THREE from 'three';
import { E, P } from '../state.js';
import { TRAUMA } from '../config.js';
import * as fx from '../fx.js';
import * as camera from '../camera.js';
import { ANIM } from './reglages.js';
import { chargerPieces } from './pieces.js';
import * as flammes from './flammes.js';

const B = ANIM.boss;
const TWO_PI = Math.PI * 2;
// indices du tableau T de boss.js (lus dans la copie patchée ; à l'intégration, ce module est appelé avec T)
const T_GAIT = 3;
const T_LIFT = 5;
const T_TELE = 10;
const T_PX = 14;
const T_PY = 15;
const T_PZ = 16;
const T_ROT = 17;
const T_TILT = 18;
const T_SQ = 20;
const S_SLAM = 1;
const S_AIM = 2;
const S_RUSH = 3;
const S_CAST = 4;
const S_SUMMON = 5;
const S_STUN = 6;

// état (§ V)
const PH = 0; // phase du pas
const GAIT = 1;
const HEAD = 2; // cap lissé (tête en retard)
const ARMX = 3; // angle des bras (geste) lissé
const ARMZ = 4;
const RECUL = 5; // recul du buste (mortier)
const LAST_STATE = 6;
const IMPACT = 7; // s depuis l'impact de la frappe
const TIME = 8;
const NPAS = 9; // numéro du dernier appui
const DTF = 10; // dt simulé de l'image (flammes)
const S = new Float64Array(11);
/** Cheminées en monde (g : 0..2, d : 3..5), écrites à chaque sync (lu par boss-anim pour le départ des obus). */
export const cheminees = new Float64Array(6);
/**
 * Visière en monde (§ E1.D) : le point d'où part le rayon du balayage laser. Écrite à chaque sync depuis l'os de la
 * tête (le modèle n'a pas de canon : la visière rouge est son « œil »).
 */
export const visiere = new Float64Array(3);
const VIS = new Float64Array([0, 0.35, 0.75]); // visière dans le repère de l'os « tete » (mesurée à l'init)
/** Mesure : vitesse horizontale du pied d'appui (m/s) à la dernière image, et pieds [gx, gy, gz, dx, dy, dz]. */
export const mesure = new Float64Array(8);
const st = { pret: false, actif: false, visible: false, chaud: null };
// état de boss.js donné à init : tableau de pose T, phase 2 allumée (fonction), matériau d'origine (prototype)
const R = { T: new Float64Array(21), chaud: () => false };
let mesh = null;
let ancien = null;
const os = {};
const p2 = [];
let racine = null;
const LOC = new Float64Array(9); // cheminée g, cheminée d (repère du modèle), réacteur
const FISSURES = new Float64Array(3);
let hanche = 1.8;
let cheville = 0.55; // hauteur de la cheville (pivot du pied) : semelle à cheville − 0,55
let genouY = 1.42; // hauteur du genou (pivot du tibia)
const tmpV = new THREE.Vector3();
const PIEDV = new Float64Array(2);
const ANG = new Float64Array(4); // angles des jambes g, d ; longueurs g, d
const GENOU = new Float64Array(2);
// PIED POSÉ (cinématique inverse de la jambe d'appui) : au contact, la cheville est fixée en monde ; pendant tout l'appui,
// cuisse et genou sont calculés pour l'atteindre (deux os : hanche → genou → cheville), pied à plat. Le corps peut
// avancer, tourner (virages), pencher : le pied d'appui ne bouge plus. La jambe libre reste procédurale, et quitte la
// solution d'appui en fondu (15 % du retour).
const PLANTER = new Uint8Array(2);
const CIBLE = new Float64Array(6); // cheville fixée en monde, par jambe
const CIBLE_OK = new Uint8Array(2);
const IK = new Float64Array(6); // dernière solution par jambe : cuisse x, cuisse z, genou
// DÉROULÉ DU PIED (ANIM.boss.deroule) : pendant l'appui, le point fixé au sol est le TALON (attaque), puis le pied à
// plat, puis la POINTE (décollage) ; la cheville en découle. Mémorisé au contact : talon au sol (x, z) et direction
// avant du pied (x, z), par jambe.
// talon, PLANTE (charnière des orteils, pivot du décollage), bout des orteils — m derrière / devant la cheville —
// et hauteur de la charnière au-dessus de la semelle ; mesurés à l'init (sans os d'orteils : plante = bout)
const PIED = new Float64Array([0.4, 1.1, 1.1, 0]);
const TALON = new Float64Array(4);
const AVANT = new Float64Array(4);
const PHI = new Float64Array(2); // tangage du pied par jambe (rad, > 0 = pointe vers le bas)
const LACHE = new Float64Array([-1, -1]); // phase t où le pied a quitté le sol avant la fin du double appui (−1 = non)

/** Cheville par rapport au TALON au sol, pour un tangage phi : composante avant (axe 0) ou hauteur (axe 1). Pointe
 *  relevée (phi < 0) : le pied pivote sur le talon ; talon levé (phi > 0) : il pivote sur la pointe. */
function decalCheville(phi, axe) {
  const c = cheville;
  const ta = PIED[0];
  if (phi <= 0) {
    const a = -phi;
    return axe === 0 ? ta * Math.cos(a) - c * Math.sin(a) : ta * Math.sin(a) + c * Math.cos(a);
  }
  const p = PIED[1];
  return axe === 0 ? ta + p - p * Math.cos(phi) + c * Math.sin(phi) : p * Math.sin(phi) + c * Math.cos(phi);
}

function lisse(x) {
  const u = x < 0 ? 0 : x > 1 ? 1 : x;
  return u * u * (3 - 2 * u);
}

/** Tangage du pied pour la phase t ∈ [0, 2) d'une jambe (appui [0, 1), retour [1, 2)), > 0 = pointe vers le bas. */
function tangage(t) {
  const D = B.deroule;
  if (!D || !D.actif) return 0;
  if (t < 1) {
    if (t < D.uTalon) return -D.talonAttaque * (1 - lisse(t / D.uTalon));
    if (t > D.uPointe) return D.pointeDecolle * lisse((t - D.uPointe) / (1 - D.uPointe));
    return 0;
  }
  const s = t - 1;
  const sd = D.decolle || 0;
  if (s < sd) return D.pointeDecolle + (D.pointeMax - D.pointeDecolle) * lisse(s / sd); // pointe encore plantée
  const r = (s - sd) / (1 - sd);
  if (r < 0.5) return D.pointeMax + (D.pointeTraine - D.pointeMax) * lisse(r / 0.5);
  return D.pointeTraine + (-D.talonAttaque - D.pointeTraine) * lisse((r - 0.5) / 0.5);
}

const tmpM = new THREE.Matrix4();
const tmpW = new THREE.Vector3();
const tmpA = new THREE.Vector3(); // semelle (marche de référence)

/** Squelette « un os par pièce » (même méthode que heros-anim) ; skinIndex = pièce + 1. */
function squelette(d) {
  const g = d.geometry;
  const n = g.attributes.position.count;
  const piece = g.attributes.piece.array;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    si[i * 4] = piece[i] + 1;
    sw[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  const root = new THREE.Bone();
  const list = [root];
  const objs = d.pieces.map((p) => {
    const b = new THREE.Bone();
    b.name = p.nom;
    os[p.nom] = b;
    list.push(b);
    return b;
  });
  d.pieces.forEach((p, i) => {
    const parent = p.parent >= 0 ? objs[p.parent] : root;
    const pp = p.parent >= 0 ? d.pieces[p.parent].pivot : [0, 0, 0];
    objs[i].position.set(p.pivot[0] - pp[0], p.pivot[1] - pp[1], p.pivot[2] - pp[2]);
    parent.add(objs[i]);
  });
  return { root, list };
}

export function init({ scene, materiau, donnees, T, chaud, ancien: a }) {
  ancien = a;
  R.T = T;
  R.chaud = chaud;
  const d = donnees;
  // bouches des cheminées : base des cônes de p2_flammes, une par côté (le modèle n'a pas de nœud de cheminée)
  const ip = d.pieces.findIndex((p) => p.nom === 'p2_flammes');
  const pos = d.geometry.attributes.position.array;
  const pc = d.geometry.attributes.piece.array;
  for (let c = 0; c < 2; c++) {
    let ymin = 1e9;
    for (let v = 0; v < pc.length; v++) if (pc[v] === ip && (pos[v * 3] > 0) === (c === 0)) ymin = Math.min(ymin, pos[v * 3 + 1]);
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let v = 0; v < pc.length; v++)
      if (pc[v] === ip && (pos[v * 3] > 0) === (c === 0) && pos[v * 3 + 1] < ymin + 0.08) {
        sx += pos[v * 3];
        sz += pos[v * 3 + 2];
        n++;
      }
    LOC[c * 3] = n ? sx / n : (c === 0 ? 0.8 : -0.8);
    LOC[c * 3 + 1] = ymin < 1e8 ? ymin : 5.0;
    LOC[c * 3 + 2] = n ? sz / n : -1.45;
  }
  const re = d.pieces.find((p) => p.nom === 'p2_reacteur');
  LOC.set(re ? re.pivot : [0, 3.62, -1.05], 6);
  // visière : barycentre des sommets émissifs de la face avant de la tête, dans le repère de son os (§ E1.D)
  const it = d.pieces.findIndex((p) => p.nom === 'tete');
  const em = d.geometry.attributes.aEmissive ? d.geometry.attributes.aEmissive.array : null;
  if (it >= 0 && em) {
    let zmax = -1e9;
    for (let v = 0; v < pc.length; v++) if (pc[v] === it && em[v] > 0.5 && pos[v * 3 + 2] > zmax) zmax = pos[v * 3 + 2];
    let vx = 0;
    let vy = 0;
    let vz = 0;
    let n = 0;
    for (let v = 0; v < pc.length; v++)
      if (pc[v] === it && em[v] > 0.5 && pos[v * 3 + 2] > zmax - 0.12) {
        vx += pos[v * 3];
        vy += pos[v * 3 + 1];
        vz += pos[v * 3 + 2];
        n++;
      }
    if (n > 0) {
      const pv = d.pieces[it].pivot;
      VIS[0] = vx / n - pv[0];
      VIS[1] = vy / n - pv[1];
      VIS[2] = vz / n - pv[2];
    } else if (d.vides.visiere) {
      // boss allégé à texture cuite (17/11) : les lueurs de la tête sont dans l'image ; la visière a été mesurée sur le
      // modèle détaillé par outils/blender/cuire_modele.py (même règle) et posée en nœud vide
      const pv = d.pieces[it].pivot;
      const q = d.vides.visiere.position;
      VIS[0] = q[0] - pv[0];
      VIS[1] = q[1] - pv[1];
      VIS[2] = q[2] - pv[2];
    }
  }
  const fi = d.pieces.find((p) => p.nom === 'p2_fissures');
  FISSURES.set(fi ? fi.pivot : [0, 3, 0.8]);
  const jg = d.pieces.find((p) => p.nom === 'jambe_g');
  if (jg) hanche = jg.pivot[1];
  const pg = d.pieces.find((p) => p.nom === 'pied_g');
  if (pg) cheville = pg.pivot[1];
  // déroulé du pied : talon et pointe mesurés sur la géométrie du pied (m derrière / devant la cheville)
  const ipg = d.pieces.findIndex((p) => p.nom === 'pied_g');
  if (ipg >= 0) {
    let zmin = 1e9;
    let zmax = -1e9;
    for (let v = 0; v < pc.length; v++)
      if (pc[v] === ipg) {
        if (pos[v * 3 + 2] < zmin) zmin = pos[v * 3 + 2];
        if (pos[v * 3 + 2] > zmax) zmax = pos[v * 3 + 2];
      }
    PIED[0] = Math.max(0.05, d.pieces[ipg].pivot[2] - zmin);
    PIED[1] = PIED[2] = Math.max(0.05, zmax - d.pieces[ipg].pivot[2]);
    // os d'orteils (Femz, 16/11 : « le pied ne se plie pas comme sur mes réf ») : le décollage pivote à la plante
    const io = d.pieces.findIndex((p) => p.nom === 'orteils_g');
    if (io >= 0) {
      let zo = -1e9;
      for (let v = 0; v < pc.length; v++) if (pc[v] === io && pos[v * 3 + 2] > zo) zo = pos[v * 3 + 2];
      PIED[1] = d.pieces[io].pivot[2] - d.pieces[ipg].pivot[2];
      PIED[2] = Math.max(PIED[1], zo - d.pieces[ipg].pivot[2]);
      PIED[3] = d.pieces[io].pivot[1];
    }
  }
  const kg = d.pieces.find((p) => p.nom === 'tibia_g');
  if (kg) genouY = kg.pivot[1];
  const { root, list } = squelette(d);
  calculerFoulee();
  racine = root;
  // matériau du corps de boss.js (peint, mêmes uniformes : flash, lueur, fenêtre de révélation autour du joueur)
  mesh = new THREE.SkinnedMesh(d.geometry, materiau);
  mesh.name = 'boss-anime';
  mesh.matrixAutoUpdate = false;
  mesh.add(root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mesh.visible = false;
  scene.add(mesh);
  p2.length = 0;
  for (const p of d.pieces) if (p.nom.startsWith('p2_')) p2.push(os[p.nom]);
  flammes.init(scene);
  st.pret = true;
}

/** Reset du boss (boss.js) : particules éteintes, pieds relâchés, pièces de phase 2 réécrites à la prochaine image. */
export function reset() {
  if (!st.pret) return;
  flammes.reset();
  CIBLE_OK.fill(0);
  PLANTER.fill(0);
  S[GAIT] = 0;
  S[IMPACT] = 1e3;
  S[RECUL] = 0;
  st.chaud = null;
}

/** Le boss en pièces est prêt (boss-anim lit alors les cheminées ici). */
export function pret() {
  return st.pret && st.actif;
}

export function setActif(on) {
  st.actif = !!on;
  if (!st.pret) return;
  ancien.layers.set(on ? 7 : 0);
  for (const c of ancien.children) c.layers.set(on ? 7 : 0);
  if (!on) {
    mesh.visible = false;
    flammes.setVisible(false);
  }
}

/** Pas de simulation (après boss.update) : phase du pas, gestes, appuis, flammes. */
export function update(dt) {
  if (!st.pret || !st.actif || !(dt > 0)) return;
  S[TIME] += dt;
  S[DTF] += dt;
  const i = E.bossIndex;
  if (i < 0 || E.alive[i] === 0) {
    flammes.EM.fill(0);
    return;
  }
  const v = Math.sqrt(E.vx[i] * E.vx[i] + E.vz[i] * E.vz[i]);
  const g = v > 0.3 ? 1 : v / 0.3;
  // départ de la ruée (immobile pendant la visée) : l'allure monte en ~50 ms — en 0,3 s, il filait à 26 m/s jambes tendues
  S[GAIT] += (g - S[GAIT]) * (1 - Math.exp(-(B.marcheRef && E.state[i] === S_RUSH ? 25 : 6) * dt));
  if (B.marcheRef) {
    const R = B.ruee || {};
    const cible = E.state[i] === S_RUSH ? 1 : 0;
    RUEE[0] += (cible - RUEE[0]) * (1 - Math.exp(-dt / (R.fondu || 0.12)));
    if (RUEE[0] < 1e-3) RUEE[0] = 0;
    const w = RUEE[0];
    APPUI_EFF = MARCHE.appui + (COURSE.appui - MARCHE.appui) * w;
    const course = Math.min(v * FOULEE_COURSE, 2 * Math.PI * (R.cadence || 2.4)); // rad/s, plafonné
    const base = (v * FOULEE_REF * (1 - w) + course * w) * dt;
    const corr = -ECART_PHASE * FOULEE_REF * Math.min(1, dt / (B.calagePhase || 0.2)) * (1 - w);
    S[PH] += Math.max(0, base + corr);
  } else S[PH] += v * B.foulee * dt;
  // appui : la jambe avant touche le sol quand l'écart est maximal (sin = ±1)
  // appui : début de chaque demi-cycle (t = phase / π entier) — la jambe qui commence sa phase d'appui touche le sol
  const n = Math.floor(S[PH] / Math.PI);
  if (n !== S[NPAS]) {
    S[NPAS] = n;
    if (S[GAIT] > 0.5) appui(n & 1);
  }
  // gestes : cible selon l'état du boss
  const state = E.state[i];
  const T = R.T;
  let ax = 0;
  let az = 0;
  let rate = 8;
  if (state === S_SLAM) {
    const u = T[T_TELE] > 1 ? 1 : T[T_TELE];
    ax = -B.frappeLeve * (u * u * (3 - 2 * u)); // élan : les poings montent au-dessus de la tête
    rate = 10;
  } else if (state === S_RUSH) {
    ax = B.rueeBras;
    az = 0.15;
  } else if (state === S_AIM) {
    ax = 0.35;
  } else if (state === S_SUMMON) {
    az = 0.55;
    ax = -0.4;
  } else if (state === S_STUN) {
    ax = -0.35;
  }
  if (S[LAST_STATE] === S_SLAM && state !== S_SLAM) S[IMPACT] = 0; // la frappe vient de tomber
  S[LAST_STATE] = state;
  S[IMPACT] += dt;
  if (S[IMPACT] < 0.35) {
    ax = -B.frappeImpact; // poings abattus devant lui
    rate = S[IMPACT] < 0.08 ? 40 : 6;
  }
  S[ARMX] += (ax - S[ARMX]) * (1 - Math.exp(-rate * dt));
  S[ARMZ] += (az - S[ARMZ]) * (1 - Math.exp(-8 * dt));
  S[RECUL] *= Math.exp(-dt / 0.12);
  // tête : le cap lissé suit le vrai cap avec retard
  let dr = E.rot[i] - S[HEAD];
  dr -= Math.round(dr / TWO_PI) * TWO_PI;
  S[HEAD] += dr * (1 - Math.exp(-B.teteRetard * dt));
}

/** Son d'un pas lourd (BOSS_STEP, un fichier différent à chaque pas) : intégration → audio.play(SFX.BOSS_STEP, x, z). */
export const surPas = { f: null, n: 0 };

function appui(cote) {
  const pied = cote === 0 ? os.pied_g : os.pied_d;
  const b = cote === 0 ? os.jambe_g : os.jambe_d;
  if (!b) return;
  if (pied) {
    tmpV.set(0, -cheville + 0.03, 0.25);
    pied.localToWorld(tmpV);
  } else {
    tmpV.set(0, -hanche + 0.05, 0.25);
    b.localToWorld(tmpV);
  }
  surPas.n++;
  PLANTER[cote] = 1; // la cheville d'appui sera fixée au sol à la prochaine pose (pied posé)
  if (surPas.f !== null) surPas.f(tmpV.x, tmpV.z, cote);
  for (let k = 0; k < B.poussierePas; k++) fx.spawnPuff(tmpV.x, 0.15, tmpV.z, 0xc8a070);
  camera.addTraumaAt(B.secoussePas, TRAUMA.BOSS, tmpV.x, tmpV.z);
}

// ===== MARCHE DE RÉFÉRENCE (Femz, 16/11 : « regarde comment Walking et Running fonctionnent, ce sera des réf plus
// précises ») : cuisse, genou, pied et orteils suivent les courbes de src/anim/ref-marche.js en fonction de la position
// dans le cycle (jambe droite décalée d'un demi-cycle) ; le bassin se cale pour que le pied d'appui touche le sol ; la
// cinématique inverse ne fait que CLOUER le pied d'appui (talon au contact, puis plante quand le talon se lève).
const DEG = Math.PI / 180;
const RC = (() => {
  const n = MARCHE.n;
  const f = (a) => Float64Array.from(a, (v) => v * DEG);
  return { n, cuisse: f(MARCHE.cuisse), genou: f(MARCHE.genou), pied: f(MARCHE.pied), orteils: f(MARCHE.orteils) };
})();
// RUÉE (16/11, après la validation de Femz) : à 26 m/s le corps avance de plus de 2 m pendant un appui (1,2 fois la jambe)
// — aucun pied ne peut rester cloué. Les courbes de Running sont fondues avec celles de Walking (RUEE[0] : 0 marche,
// 1 ruée, lissé sur B.ruee.fondu), la cadence est plafonnée à B.ruee.cadence cycles/s (sinon 11 cycles/s : jambes qui
// moulinent), le pied d'appui suit la pose (il patine) et le calage de phase est coupé.
const RCC = (() => {
  const f = (a) => Float64Array.from(a, (v) => v * DEG);
  return { n: COURSE.n, cuisse: f(COURSE.cuisse), genou: f(COURSE.genou), pied: f(COURSE.pied), orteils: f(COURSE.orteils) };
})();
const RUEE = new Float64Array(1);
let FOULEE_COURSE = 2.0;
let APPUI_EFF = MARCHE.appui; // part d'appui du cycle, fondue entre la marche et la course
const CMID = (Math.max(...MARCHE.cuisse) + Math.min(...MARCHE.cuisse)) / 2 * DEG; // pour le balancier des bras
const CAMP = (Math.max(...MARCHE.cuisse) - Math.min(...MARCHE.cuisse)) / 2 * DEG;
const POSE = new Float64Array(8); // cuisse, genou, pied, orteils (rad) de la jambe g puis d
const EN_APPUI = new Uint8Array(2);
const FACT_TALON = new Float64Array([1, 1]); // réduction de la pointe relevée décidée avant l'attaque, gardée jusqu'au pied à plat
let FOULEE_REF = 2.0; // rad de phase par mètre, déduit à l'init de la foulée réelle du pied d'appui (pas de glissement)
// CALAGE DE PHASE (« stride warping ») : écart avant / arrière (m) entre la cheville d'appui clouée et celle de la pose de
// référence, mesuré à chaque image ; update() accélère le cycle si la cheville est en retard (le corps a pris de l'avance :
// talon qui roule moins que prévu, virage, changement de vitesse), le ralentit sinon. Sans lui : 12 cm de retard
// constant dès la mise en charge, jambe d'appui tendue (genou 12° au lieu de 30) et trop en arrière en fin d'appui.
let ECART_PHASE = 0;
let Y_BASSIN = NaN; // hauteur de la racine à l'image précédente (vitesse de descente limitée)
const PHI_PREC = new Float64Array(2); // tangage du pied à l'image précédente (limite de vitesse du pied libre)

/** Pose de référence de la jambe k à la position u ∈ [0, 1) du cycle (interpolation linéaire, cycle bouclé). */
function lireRef(k, u) {
  const x = (u - Math.floor(u)) * RC.n;
  const i = Math.floor(x) % RC.n;
  const j = (i + 1) % RC.n;
  const f = x - Math.floor(x);
  POSE[k * 4] = RC.cuisse[i] + (RC.cuisse[j] - RC.cuisse[i]) * f;
  POSE[k * 4 + 1] = RC.genou[i] + (RC.genou[j] - RC.genou[i]) * f;
  POSE[k * 4 + 2] = RC.pied[i] + (RC.pied[j] - RC.pied[i]) * f;
  POSE[k * 4 + 3] = RC.orteils[i] + (RC.orteils[j] - RC.orteils[i]) * f;
  const w = RUEE[0];
  if (w <= 0) return;
  // ruée : la course, même position dans le cycle (les deux réfs commencent au contact du pied)
  const xc = (u - Math.floor(u)) * RCC.n;
  const ic = Math.floor(xc) % RCC.n;
  const jc = (ic + 1) % RCC.n;
  const fc = xc - Math.floor(xc);
  POSE[k * 4] += (RCC.cuisse[ic] + (RCC.cuisse[jc] - RCC.cuisse[ic]) * fc - POSE[k * 4]) * w;
  POSE[k * 4 + 1] += (RCC.genou[ic] + (RCC.genou[jc] - RCC.genou[ic]) * fc - POSE[k * 4 + 1]) * w;
  POSE[k * 4 + 2] += (RCC.pied[ic] + (RCC.pied[jc] - RCC.pied[ic]) * fc - POSE[k * 4 + 2]) * w;
  POSE[k * 4 + 3] += (RCC.orteils[ic] + (RCC.orteils[jc] - RCC.orteils[ic]) * fc - POSE[k * 4 + 3]) * w;
}

/** Foulée de référence : pendant l'appui, le corps avance de ce que la cheville recule sous la hanche (angles de la
 *  réf, jambes du boss) PLUS ce que la cheville avance sur le pied qui roule (talon → plat → plante, point d'appui fixe) ;
 *  le cycle avance de 2π pendant que le boss parcourt cette distance / part d'appui. (1er calcul, faux : talon et plante
 *  pris comme deux appuis distincts → cycle 23 % trop rapide, cuisse bloquée à +22° au lieu de reculer à −16°.) */
function calculerFoulee() {
  const a = hanche - genouY;
  const b = genouY - cheville;
  const ech = B.piedEchelle || 1;
  const phiDe = (u) => {
    lireRef(0, u);
    const sp = Math.sin(POSE[2]) * ech;
    return Math.asin(sp > 1 ? 1 : sp < -1 ? -1 : sp);
  };
  const xa = (u) => {
    lireRef(0, u);
    return a * Math.sin(POSE[0]) + b * Math.sin(POSE[0] - POSE[1]); // cheville − hanche (vers l'avant)
  };
  for (const w of [0, 1]) {
    RUEE[0] = w;
    const ap = w ? COURSE.appui : MARCHE.appui;
    const u1 = ap * 0.98;
    const recul = xa(0) - xa(u1);
    const roule = decalCheville(phiDe(u1), 0) - decalCheville(phiDe(0), 0);
    const D = Math.max(0.2, recul + roule);
    if (w) FOULEE_COURSE = (2 * Math.PI * ap) / D;
    else FOULEE_REF = (2 * Math.PI * ap) / D;
  }
  RUEE[0] = 0;
}

/** Point le plus bas de la semelle de la jambe k (talon, plante, bout des orteils), en monde. */
function semelleY(k) {
  const pied = k === 0 ? os.pied_g : os.pied_d;
  const ort = k === 0 ? os.orteils_g : os.orteils_d;
  tmpA.set(0, -cheville, -PIED[0]).applyMatrix4(pied.matrixWorld);
  let y = tmpA.y;
  tmpA.set(0, -cheville, PIED[1]).applyMatrix4(pied.matrixWorld);
  if (tmpA.y < y) y = tmpA.y;
  if (ort) tmpA.set(0, -PIED[3], PIED[2] - PIED[1]).applyMatrix4(ort.matrixWorld);
  else tmpA.set(0, -cheville, PIED[2]).applyMatrix4(pied.matrixWorld);
  return tmpA.y < y ? tmpA.y : y;
}

/** Marche de référence : poses des deux jambes, bassin calé sur le pied d'appui, pied d'appui cloué au sol. */
function marcheRef(u, g, tilt, roll) {
  const a = hanche - genouY;
  const b = genouY - cheville;
  const jambes = [os.jambe_g, os.jambe_d];
  const tibias = [os.tibia_g, os.tibia_d];
  const pieds = [os.pied_g, os.pied_d];
  const orts = [os.orteils_g, os.orteils_d];
  // 1. poses de référence (gait g : fondu vers la station debout)
  for (let k = 0; k < 2; k++) {
    lireRef(k, k === 0 ? u : u + 0.5);
    const uk = k === 0 ? u : (u + 0.5) % 1;
    const th = POSE[k * 4] * g;
    const kap = POSE[k * 4 + 1] * g + B.genouAppui * (1 - g);
    // pied démesuré (cheville → bout = 93 % de la jambe, réf : 20 %) : on transpose la HAUTEUR gagnée par la pointe, pas
    // l'angle — sinus de l'angle de la réf × ANIM.boss.piedEchelle
    const sp = Math.sin(POSE[k * 4 + 2]) * (B.piedEchelle || 1);
    let phi = Math.asin(sp > 1 ? 1 : sp < -1 ? -1 : sp) * g;
    const appuiK = g > 0.5 && uk < APPUI_EFF;
    if (phi >= 0) FACT_TALON[k] = 1;
    else if (appuiK) phi *= FACT_TALON[k]; // attaque du talon : même inclinaison qu'à la dernière image du passage
    PHI[k] = phi;
    jambes[k].rotation.x = -th - tilt;
    jambes[k].rotation.z = -roll;
    tibias[k].rotation.x = kap;
    pieds[k].rotation.x = phi + th - kap;
    // orteils : pli de la réf, mais jamais plus bas que l'horizontale quand le pied pointe vers le bas (pied démesuré :
    // orteils dans l'axe, leur bout plongeait de 0,5 m et le genou montait à 125°)
    if (orts[k]) orts[k].rotation.x = -Math.max(POSE[k * 4 + 3] * g, phi);
    ANG[k] = th; // balancier des bras (normalisé plus bas)
    const appui = g > 0.5 && uk < APPUI_EFF;
    if (appui && !EN_APPUI[k]) CIBLE_OK[k] = 0; // contact : le pied sera cloué là où la pose l'a posé
    EN_APPUI[k] = appui ? 1 : 0;
  }
  // 2. bassin : la cheville de chaque pied d'appui à la hauteur qu'impose son inclinaison (talon ou plante au sol)
  mesh.updateMatrixWorld(true);
  // double appui : la jambe qui vient de se poser fixe le bassin, celle de derrière s'adapte en levant le talon (étape 3)
  // — avec le min des deux, le bassin tombait au contact et le genou avant sautait de 20 à 43°
  let dy = 1e9;
  let avantPose = -1;
  for (let k = 0; k < 2; k++) {
    const uk = k === 0 ? u : (u + 0.5) % 1;
    if (EN_APPUI[k] && uk < 0.3 && EN_APPUI[1 - k]) avantPose = k;
  }
  for (let k = 0; k < 2; k++) {
    if (!EN_APPUI[k] || (avantPose >= 0 && k !== avantPose)) continue;
    tmpW.setFromMatrixPosition(pieds[k].matrixWorld);
    const d = decalCheville(PHI[k], 1) - tmpW.y;
    if (d < dy) dy = d;
  }
  if (dy === 1e9) {
    // aucun appui (arrêt) : le pied le plus bas touche le sol
    let m = 1e9;
    for (let k = 0; k < 2; k++) {
      const y = semelleY(k);
      if (y < m) m = y;
    }
    dy = -m;
  }
  mesh.matrix.elements[13] += dy;
  mesh.updateMatrixWorld(true);
  // 2 bis. attaque du talon (réf : la jambe avant arrive pointe relevée, le TALON touche en premier) : en fin de passage,
  // le bassin monte juste assez pour que ce talon passe au-dessus du sol ; la jambe d'appui suit en levant SON talon
  // (poussée, étape 3) — sans ça la pointe relevée était rabotée à −2° (réf −37°) et la poussée plafonnait à 20° (réf 58°)
  if (g > 0.5) {
    let leve = 0;
    for (let k = 0; k < 2; k++) {
      const uk = k === 0 ? u : (u + 0.5) % 1;
      if (EN_APPUI[k] || uk < 0.75 || PHI[k] >= 0) continue;
      const m = 0.01 - semelleY(k);
      if (m > leve) leve = m;
    }
    if (leve > 0) {
      mesh.matrix.elements[13] += Math.min(leve, B.leveeBassin || 0.15);
      mesh.updateMatrixWorld(true);
    }
  }
  // 2 ter. descente du bassin limitée (B.bassinDescente m/s) : le talon démesuré qui se met à plat faisait tomber le bassin de
  // 16 cm en 5 images (2,7 m/s, réf ≈ 1) ; le pied avant reste alors pointe relevée un peu plus longtemps (étape 3)
  {
    const dtB = S[DTF] > 0 ? S[DTF] : 1 / 60;
    const y = mesh.matrix.elements[13];
    const yMin = Y_BASSIN - (B.bassinDescente || 1.2) * dtB;
    if (g > 0.5 && y < yMin) {
      mesh.matrix.elements[13] = yMin;
      mesh.updateMatrixWorld(true);
    }
    Y_BASSIN = g > 0.5 ? mesh.matrix.elements[13] : NaN;
  }
  // 3. pied d'appui cloué : TALON mémorisé au contact, cheville déduite de l'inclinaison ; jambe résolue vers elle
  const e = mesh.matrixWorld.elements;
  let ecart = 0;
  let nAppui = 0;
  for (let k = 0; k < 2; k++) {
    const o = k * 3;
    if (!EN_APPUI[k]) continue;
    if (CIBLE_OK[k] === 0 || RUEE[0] > 0.5) {
      // (ruée : le pied d'appui suit la pose à chaque image — il patine, voir RUEE)
      tmpW.setFromMatrixPosition(pieds[k].matrixWorld);
      const n = Math.hypot(e[8], e[10]) || 1;
      AVANT[k * 2] = e[8] / n;
      AVANT[k * 2 + 1] = e[10] / n;
      const f0 = decalCheville(PHI[k], 0);
      TALON[k * 2] = tmpW.x - AVANT[k * 2] * f0;
      TALON[k * 2 + 1] = tmpW.z - AVANT[k * 2 + 1] * f0;
      CIBLE_OK[k] = 1;
    }
    const f = decalCheville(PHI[k], 0);
    CIBLE[o] = TALON[k * 2] + AVANT[k * 2] * f;
    CIBLE[o + 1] = decalCheville(PHI[k], 1);
    CIBLE[o + 2] = TALON[k * 2 + 1] + AVANT[k * 2 + 1] * f;
    tmpW.setFromMatrixPosition(jambes[k].matrixWorld);
    tmpV.set(CIBLE[o] - tmpW.x, CIBLE[o + 1] - tmpW.y, CIBLE[o + 2] - tmpW.z);
    {
      // calage de phase : cheville clouée − cheville de la pose de réf, le long de l'avant du corps
      const n = Math.hypot(e[8], e[10]) || 1;
      const th = POSE[k * 4] * g;
      const kp = POSE[k * 4 + 1] * g;
      ecart += (tmpV.x * e[8] + tmpV.z * e[10]) / n - (a * Math.sin(th) + b * Math.sin(th - kp));
      nAppui++;
    }
    let Dw = tmpV.length();
    const portee = (a + b) * 0.995;
    // poussée : jambe d'appui en fin d'appui hors d'atteinte (bassin relevé en 2 bis) → le talon se lève (pivot sur la
    // plante, cheville vers l'avant et le haut) au lieu de faire glisser le pied
    const ukA = k === 0 ? u : (u + 0.5) % 1;
    const kRef = POSE[k * 4 + 1] * g; // le genou ne se tend pas plus que celui de la réf : c'est le talon qui monte
    const porteeRef = Math.min(portee, Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(kRef)));
    for (let it = 0; it < 30 && Dw > porteeRef && ukA > 0.3 && PHI[k] < (B.pousseeMax || 1.0); it++) {
      PHI[k] = Math.max(0, PHI[k]) + 0.02;
      const f2 = decalCheville(PHI[k], 0);
      CIBLE[o] = TALON[k * 2] + AVANT[k * 2] * f2;
      CIBLE[o + 1] = decalCheville(PHI[k], 1);
      CIBLE[o + 2] = TALON[k * 2 + 1] + AVANT[k * 2 + 1] * f2;
      tmpV.set(CIBLE[o] - tmpW.x, CIBLE[o + 1] - tmpW.y, CIBLE[o + 2] - tmpW.z);
      Dw = tmpV.length();
    }
    // mise en charge, bassin retenu en 2 ter : plutôt que de tendre le genou (17° au lieu de 20 → 63 de la réf, puis
    // rattrapage de 10°/image), le pied reste pointe relevée plus longtemps, pivot sur le talon (« delay the foot »)
    for (let it = 0; it < 30 && Dw > porteeRef && ukA < 0.3 && PHI[k] > -0.6; it++) {
      PHI[k] -= 0.02;
      const f2 = decalCheville(PHI[k], 0);
      CIBLE[o] = TALON[k * 2] + AVANT[k * 2] * f2;
      CIBLE[o + 1] = decalCheville(PHI[k], 1);
      CIBLE[o + 2] = TALON[k * 2 + 1] + AVANT[k * 2 + 1] * f2;
      tmpV.set(CIBLE[o] - tmpW.x, CIBLE[o + 1] - tmpW.y, CIBLE[o + 2] - tmpW.z);
      Dw = tmpV.length();
    }
    if (Dw > portee) {
      // hors d'atteinte (virage serré) : le point d'appui suit juste assez
      tmpV.multiplyScalar(portee / Dw);
      TALON[k * 2] += tmpW.x + tmpV.x - CIBLE[o];
      TALON[k * 2 + 1] += tmpW.z + tmpV.z - CIBLE[o + 2];
    }
    const kap = resoudreJambe(jambes[k], tibias[k], a, b);
    pieds[k].rotation.x = -(tilt + jambes[k].rotation.x + kap) + PHI[k];
    if (orts[k] && PHI[k] > 0) orts[k].rotation.x = -PHI[k]; // talon levé : orteils à plat au sol (pli à la plante)
    IK[o] = jambes[k].rotation.x;
    IK[o + 1] = jambes[k].rotation.z;
    IK[o + 2] = kap;
  }
  ECART_PHASE = nAppui && RUEE[0] <= 0.5 ? ecart / nAppui : 0;
  // 4. pied libre : si la semelle toucherait le sol, la cheville est relevée d'autant (cinématique inverse)
  mesh.updateMatrixWorld(true);
  const dtf = S[DTF] > 0 ? S[DTF] : 1 / 60;
  for (let k = 0; k < 2; k++) {
    if (EN_APPUI[k]) continue;
    const plancher = PHI_PREC[k] - (B.piedVitesse || 4) * dtf; // la pointe ne remonte pas plus vite (à-coup de 15° au décollage)
    for (let it = 0; it < 10; it++) {
      const dS = 0.02 - semelleY(k);
      if (dS <= 0.002) break;
      if (PHI[k] < -0.02) {
        // pointe relevée avant l'attaque : on relève le TALON en réduisant l'inclinaison, la jambe reste tendue (réf)
        PHI[k] *= 0.8;
        lireRef(k, k === 0 ? u : u + 0.5);
        const sp0 = Math.asin(Math.max(-1, Math.min(1, Math.sin(POSE[k * 4 + 2]) * (B.piedEchelle || 1)))) * g;
        FACT_TALON[k] = sp0 < -0.02 ? PHI[k] / sp0 : 1;
        pieds[k].rotation.x = -(tilt + jambes[k].rotation.x + tibias[k].rotation.x) + PHI[k];
        pieds[k].updateMatrixWorld(true);
        continue;
      }
      if (PHI[k] > 0.02 && PHI[k] > plancher + 1e-4) {
        // pointe vers le bas après le décollage : comme une vraie jambe, le pied se relève (pointe remontée) avant que le
        // genou plie ; le pied démesuré raclait le sol et l'IK repliait le genou à 92° (réf 78)
        PHI[k] = Math.max(plancher, PHI[k] * 0.8);
        pieds[k].rotation.x = -(tilt + jambes[k].rotation.x + tibias[k].rotation.x) + PHI[k];
        if (orts[k]) orts[k].rotation.x = -Math.max(POSE[k * 4 + 3] * g, PHI[k]);
        pieds[k].updateMatrixWorld(true);
        continue;
      }
      tmpW.setFromMatrixPosition(pieds[k].matrixWorld);
      const cx = tmpW.x;
      const cy = tmpW.y + dS;
      const cz = tmpW.z;
      tmpW.setFromMatrixPosition(jambes[k].matrixWorld);
      tmpV.set(cx - tmpW.x, cy - tmpW.y, cz - tmpW.z);
      const kap = resoudreJambe(jambes[k], tibias[k], a, b);
      pieds[k].rotation.x = -(tilt + jambes[k].rotation.x + kap) + PHI[k];
      jambes[k].updateMatrixWorld(true);
    }
  }
  PHI_PREC[0] = PHI[0];
  PHI_PREC[1] = PHI[1];
  mesh.updateMatrixWorld(true);
}

/** Cinématique inverse à deux os : tmpV = hanche → cheville voulue (monde) ; pose cuisse et genou (genou vers l'avant). */
function resoudreJambe(cuisse, tibia, a, b) {
  tmpM.extractRotation(mesh.matrixWorld).invert();
  tmpV.applyMatrix4(tmpM);
  let D = tmpV.length();
  if (D > a + b - 1e-4) D = a + b - 1e-4;
  const dy = tmpV.y;
  const dz = tmpV.z;
  const dx = tmpV.x;
  const th = Math.atan2(-dz, -dy); // cuisse tendue pointée sur la cheville
  let cg = (a * a + b * b - D * D) / (2 * a * b);
  cg = cg > 1 ? 1 : cg < -1 ? -1 : cg;
  const kappa = Math.PI - Math.acos(cg); // flexion du genou (0 = tendu)
  let cb = (a * a + D * D - b * b) / (2 * a * D);
  cb = cb > 1 ? 1 : cb < -1 ? -1 : cb;
  const beta = Math.acos(cb);
  cuisse.rotation.x = th - beta;
  cuisse.rotation.z = Math.atan2(dx, Math.sqrt(dy * dy + dz * dz));
  tibia.rotation.x = kappa;
  return kappa;
}

/** Hauteur de cheville sous laquelle la semelle (talon ou pointe) toucherait le sol, pour un tangage phi. */
function hauteurMin(phi) {
  const c = cheville;
  if (phi >= 0) return c * Math.cos(phi) + PIED[1] * Math.sin(phi); // pointe en bas : orteils à plat, la plante est le point bas
  return c * Math.cos(-phi) + PIED[0] * Math.sin(-phi);
}

/** Jambe LIBRE (retour, ou lâcher du double appui) : fondu depuis la dernière solution d'appui, cheville relevée au
 *  besoin pour que la semelle reste au-dessus du sol, tangage du déroulé. */
function poserLibre(k, t, sD, tilt, cuisse, tibia, pied, a, b) {
  const o = k * 3;
  // retour : fondu de la dernière solution d'appui vers la pose procédurale, compté depuis le lâcher
  CIBLE_OK[k] = 0;
  const u = (t - (LACHE[k] >= 0 ? LACHE[k] : 1 + sD)) / 0.15;
  if (u < 1) {
    cuisse.rotation.x = IK[o] + (cuisse.rotation.x - IK[o]) * u;
    cuisse.rotation.z = IK[o + 1] + (cuisse.rotation.z - IK[o + 1]) * u;
    tibia.rotation.x = IK[o + 2] + (tibia.rotation.x - IK[o + 2]) * u;
  }
  // pied levé : la cheville garde sa position avant / arrière (pose procédurale) mais jamais plus bas que la hauteur
  // où la semelle toucherait le sol pour le tangage voulu, + un arc de levée ; sinon la jambe est résolue vers ce point
  // (mesuré le 16/11 : le pied libre, jambe tendue vers l'avant, entrait de 15 cm dans le sol avant le contact).
  // Au contact, la cheville est exactement à la hauteur de l'attaque du talon.
  cuisse.updateMatrixWorld(true);
  tmpW.setFromMatrixPosition(pied.matrixWorld);
  // arc de levée : le pied quitte franchement le sol après le lâcher (Femz, 16/11 : orteils qui glissaient au sol),
  // culmine vers le tiers du retour, redescend sur l'attaque du talon
  const sl = (t - 1) / 0.85;
  const levee = sl > 0 && sl < 1 ? (B.deroule ? B.deroule.levee || 0 : 0) * Math.sin(Math.PI * Math.pow(sl, 0.7)) : 0;
  const hmin = hauteurMin(PHI[k]) + 0.02 + levee;
  if (tmpW.y < hmin) {
    const cx = tmpW.x;
    const cz = tmpW.z;
    tmpW.setFromMatrixPosition(cuisse.matrixWorld);
    tmpV.set(cx - tmpW.x, hmin - tmpW.y, cz - tmpW.z);
    const L = (a + b) * 0.99;
    const hz = Math.hypot(tmpV.x, tmpV.z);
    const hmax = L * L > tmpV.y * tmpV.y ? Math.sqrt(L * L - tmpV.y * tmpV.y) : 0;
    // fin du passage (jambe qui se tend vers l'avant, réf : attaque du talon jambe tendue) : la cheville relevée va
    // aussi plus loin devant, sur le cercle de la jambe presque tendue, au lieu de plier le genou ; hors d'atteinte,
    // elle garde sa hauteur et se rapproche de la hanche
    const tendu = (a + b) * 0.97;
    const hTendu = tendu * tendu > tmpV.y * tmpV.y ? Math.sqrt(tendu * tendu - tmpV.y * tmpV.y) : 0;
    const vise = t - 1 > 0.7 && hz > 1e-6 && hz < hTendu ? hTendu : hz > hmax ? hmax : hz;
    if (hz > 1e-6 && vise !== hz) {
      tmpV.x *= vise / hz;
      tmpV.z *= vise / hz;
    }
    resoudreJambe(cuisse, tibia, a, b);
  }
  cuisse.updateMatrixWorld(true);
  tmpW.setFromMatrixPosition(pied.matrixWorld);
  let ph = PHI[k];
  for (let it = 0; it < 10 && hauteurMin(ph) + 0.02 > tmpW.y && Math.abs(ph) > 0.01; it++) ph *= 0.7; // la semelle reste au-dessus du sol
  if (hauteurMin(ph) + 0.02 > tmpW.y) ph = 0;
  pied.rotation.x = -(tilt + cuisse.rotation.x + tibia.rotation.x) + ph;
  // pied qui quitte le sol pointe en bas (réf : « delay the foot ») : les orteils restent à l'horizontale, puis se
  // réalignent quand le pied se relève
  const ort = k === 0 ? os.orteils_g : os.orteils_d;
  if (ort) ort.rotation.x = ph > 0 ? -ph : 0;
}

/** Jambe d'appui en cinématique inverse vers sa cheville fixée ; jambe libre en fondu depuis la dernière solution. */
function piedPose(tg, td, tilt) {
  mesh.updateMatrixWorld(true);
  const a = hanche - genouY; // cuisse
  const b = genouY - cheville; // tibia
  // la jambe d'APPUI d'abord : elle peut faire descendre le bassin, la jambe libre est posée ensuite à la bonne hauteur
  for (let kk = 0; kk < 2; kk++) {
    const k = tg < 1 ? kk : 1 - kk;
    const cuisse = k === 0 ? os.jambe_g : os.jambe_d;
    const tibia = k === 0 ? os.tibia_g : os.tibia_d;
    const pied = k === 0 ? os.pied_g : os.pied_d;
    const t = k === 0 ? tg : td;
    const o = k * 3;
    // double appui (réf de Femz : au contact du pied avant, la pointe du pied arrière est encore au sol) : la jambe reste
    // résolue sur sa pointe pendant les premiers « decolle » du retour, puis passe en fondu à la pose procédurale
    const sD = B.deroule && B.deroule.actif ? B.deroule.decolle || 0 : 0;
    if (t < B.deroule.uTalon) LACHE[k] = -1; // nouvel appui : le pied repart planté
    if (t >= 1 + sD || LACHE[k] >= 0) {
      poserLibre(k, t, sD, tilt, cuisse, tibia, pied, a, b);
      continue;
    }
    const roule = B.deroule && B.deroule.actif;
    if (PLANTER[k] === 1 || CIBLE_OK[k] === 0) {
      // contact (ou reprise) : la cheville est fixée là où la pose procédurale l'a posée
      PLANTER[k] = 0;
      tmpW.setFromMatrixPosition(pied.matrixWorld);
      CIBLE[o] = tmpW.x;
      CIBLE[o + 1] = cheville; // la cheville d'un pied posé à plat est à sa hauteur de repos (le pied touche le sol)
      CIBLE[o + 2] = tmpW.z;
      CIBLE_OK[k] = 1;
      if (roule) {
        // déroulé : on mémorise le TALON au sol (la cheville en découle à chaque image) et l'avant du pied
        const e = mesh.matrixWorld.elements;
        const n = Math.hypot(e[8], e[10]) || 1;
        AVANT[k * 2] = e[8] / n;
        AVANT[k * 2 + 1] = e[10] / n;
        const f = decalCheville(PHI[k], 0);
        TALON[k * 2] = tmpW.x - AVANT[k * 2] * f;
        TALON[k * 2 + 1] = tmpW.z - AVANT[k * 2 + 1] * f;
      }
    }
    if (roule) {
      // talon (attaque), pied à plat, puis pointe (décollage) : point fixe au sol → cheville
      const f = decalCheville(PHI[k], 0);
      CIBLE[o] = TALON[k * 2] + AVANT[k * 2] * f;
      CIBLE[o + 1] = decalCheville(PHI[k], 1);
      CIBLE[o + 2] = TALON[k * 2 + 1] + AVANT[k * 2 + 1] * f;
    }
    // bassin : la racine descend juste ce qu'il faut pour que la jambe d'appui (presque tendue) atteigne sa cheville
    tmpW.setFromMatrixPosition(cuisse.matrixWorld);
    {
      const hx = CIBLE[o] - tmpW.x;
      const hz = CIBLE[o + 2] - tmpW.z;
      const L = (a + b) * 0.985;
      const h2 = hx * hx + hz * hz;
      if (h2 < L * L) {
        const besoin = CIBLE[o + 1] + Math.sqrt(L * L - h2); // hauteur de hanche qui atteint la cheville
        const delta = besoin - tmpW.y;
        if (delta < 0) {
          mesh.matrix.elements[13] += delta;
          mesh.updateMatrixWorld(true);
        }
      }
    }
    // vecteur hanche → cheville fixée, dans le repère de la racine (parent de la cuisse)
    tmpW.setFromMatrixPosition(cuisse.matrixWorld);
    tmpV.set(CIBLE[o] - tmpW.x, CIBLE[o + 1] - tmpW.y, CIBLE[o + 2] - tmpW.z);
    if (tmpV.lengthSq() > 4) {
      CIBLE_OK[k] = 0; // téléportation, chute : retour à la pose procédurale
      continue;
    }
    // cible hors d'atteinte (virage serré : la hanche tourne autour de l'axe du corps) : la cheville glisse juste assez
    // vers la hanche pour rester atteignable — le seul glissement restant est celui qu'impose la géométrie
    let Dw = tmpV.length();
    const portee = (a + b) * 0.995;
    if (roule && PHI[k] > 0 && Dw > portee) {
      // déroulé sur la pointe (« delay the foot ») : le talon monte jusqu'à ce que la cheville soit atteignable, la pointe
      // reste plantée — sinon c'est elle qui glisserait (mesuré le 16/11 : 0,6 m/s en fin d'appui)
      for (let it = 0; it < 12 && Dw > portee && PHI[k] < 1.2; it++) {
        PHI[k] += 0.05;
        const f = decalCheville(PHI[k], 0);
        CIBLE[o] = TALON[k * 2] + AVANT[k * 2] * f;
        CIBLE[o + 1] = decalCheville(PHI[k], 1);
        CIBLE[o + 2] = TALON[k * 2 + 1] + AVANT[k * 2 + 1] * f;
        tmpV.set(CIBLE[o] - tmpW.x, CIBLE[o + 1] - tmpW.y, CIBLE[o + 2] - tmpW.z);
        Dw = tmpV.length();
      }
    }
    // (ou trop PRÈS de la hanche : tenir la pointe forcerait le genou au-delà de genouMax — Femz, 16/11 : « la cuisse se
    // plie du mauvais sens » : cuisse à l'horizontale vers l'avant en fin d'appui, genou plié à 140°)
    const kMax = B.deroule.genouMax || 0.6;
    const Dmin = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(kMax));
    // seulement pendant le DOUBLE appui (l'autre pied est posé) : en appui simple, le pied ne lâche jamais
    if (roule && PHI[k] > 0 && t >= 1 && (Dw > portee || Dw < Dmin)) {
      // double appui : la pointe n'est plus atteignable même talon levé → le pied quitte le sol maintenant (il ne glisse
      // pas, il ne s'enfonce pas) ; la jambe garde sa dernière solution, le fondu part de là à l'image suivante
      LACHE[k] = t;
      CIBLE_OK[k] = 0;
      poserLibre(k, t, sD, tilt, cuisse, tibia, pied, a, b); // posée dès l'image du lâcher (sinon pose brute dans le sol)
      continue;
    }
    if (Dw > portee) {
      tmpV.multiplyScalar(portee / Dw);
      const gx = tmpW.x + tmpV.x - CIBLE[o];
      const gz = tmpW.z + tmpV.z - CIBLE[o + 2];
      TALON[k * 2] += gx; // le talon mémorisé glisse avec (sinon il serait rappelé à l'image suivante)
      TALON[k * 2 + 1] += gz;
      CIBLE[o] = tmpW.x + tmpV.x;
      CIBLE[o + 1] = tmpW.y + tmpV.y;
      CIBLE[o + 2] = tmpW.z + tmpV.z;
    }
    const kappa = resoudreJambe(cuisse, tibia, a, b);
    pied.rotation.x = -(tilt + cuisse.rotation.x + kappa) + (roule ? PHI[k] : 0); // à plat, + tangage du déroulé
    const ort = k === 0 ? os.orteils_g : os.orteils_d;
    if (ort) ort.rotation.x = roule && PHI[k] > 0 ? -PHI[k] : 0; // talon levé : les orteils restent à plat au sol (pli à la plante)
    IK[o] = cuisse.rotation.x;
    IK[o + 1] = cuisse.rotation.z;
    IK[o + 2] = kappa;
  }
  mesh.updateMatrixWorld(true);
}

/** Recul du buste et bouffée de flammes au départ d'un obus de la cheminée c (0 g, 1 d). */
export function tirMortier(c) {
  S[RECUL] += B.reculMortier;
  flammes.bouffee(c, B.bouffeeMortier);
}

/** Après boss.sync : pose, émetteurs de flammes, rendu des particules. */
export function sync() {
  if (!st.pret || !st.actif) return;
  const vis = ancien.visible;
  mesh.visible = vis;
  flammes.setVisible(true);
  const i = E.bossIndex;
  const T = R.T;
  // boss dans E (sinon : chute de l'arrivée, il ne marche pas ; index −1)
  const ia = i >= 0 && E.alive[i] === 1;
  const etat = ia ? E.state[i] : -1;
  const bvx = ia ? E.vx[i] : 0;
  const bvz = ia ? E.vz[i] : 0;
  if (vis) {
    const g = ia ? S[GAIT] : 0;
    const w = S[PH];
    // MARCHE AVEC GENOUX (boss.glb du 13/11, 15 h 16 : cuisse → tibia → pied) : la jambe d'appui, TENDUE, recule
    // linéairement (pied immobile au sol : L × A × 2/π × foulée = 1) ; la jambe libre revient en avant en pliant le
    // genou (pied levé), et se tend juste avant le contact ; le pied reste à plat (cheville = −(hanche + genou)).
    // Sans tibia dans le modèle (boss-v1.glb), repli : la jambe libre se raccourcit (piston).
    // levier de la jambe d'appui : hanche → CHEVILLE (le pied reste à plat sous la cheville ; mesuré : avec hanche →
    // sol, 30 % de foulée en trop et 0,7 m/s de glissement) ; sans pied dans le modèle : hanche → sol
    const Lj = os.pied_g ? hanche - cheville : hanche;
    const A = Math.PI / (2 * Lj * B.foulee);
    let t = (w / Math.PI) % 2;
    if (t < 0) t += 2;
    // jambe gauche : appui pour t ∈ [0, 1) (de +A à −A), retour pour t ∈ [1, 2) ; jambe droite décalée d'un demi-cycle
    const tg = t;
    const td = t < 1 ? t + 1 : t - 1;
    const ag = tg < 1 ? A * (1 - 2 * tg) : A * (-1 + 2 * (3 - 2 * (tg - 1)) * (tg - 1) * (tg - 1));
    const ad = td < 1 ? A * (1 - 2 * td) : A * (-1 + 2 * (3 - 2 * (td - 1)) * (td - 1) * (td - 1));
    const appuiG = tg < 1;
    const aS = appuiG ? ag : ad; // angle de la jambe d'appui
    ANG[0] = ag * g;
    ANG[1] = ad * g;
    // flexion du genou de la jambe libre : maximale au premier tiers du retour, nulle au contact
    const sg = tg < 1 ? 0 : tg - 1;
    const sd = td < 1 ? 0 : td - 1;
    // flexion(x) = sin(π·x / 0,85) sur ]0 ; 0,85[, 0 ailleurs — écrite en ligne (§ V : ni fermeture créée à chaque image, ni
    // flottant passé en argument ; ≈ 90 o/image mesurés avec la fonction fléchée)
    const fg = sg > 0 && sg < 0.85 ? Math.sin((Math.PI * sg) / 0.85) : 0;
    const fd = sd > 0 && sd < 0.85 ? Math.sin((Math.PI * sd) / 0.85) : 0;
    const kg = B.genou * g * fg + B.genouAppui * g;
    const kd = B.genou * g * fd + B.genouAppui * g;
    GENOU[0] = kg;
    GENOU[1] = kd;
    ANG[2] = appuiG || os.tibia_g ? 1 : 1 - B.piston * g * Math.sin(Math.PI * (tg - 1)); // repli sans tibia
    ANG[3] = !appuiG || os.tibia_d ? 1 : 1 - B.piston * g * Math.sin(Math.PI * (td - 1));
    // déroulé du pied : tangage par jambe ; position BASSE juste après le contact (le genou d'appui absorbe le poids)
    const Dr = B.deroule;
    const roule = Dr && Dr.actif;
    PHI[0] = roule ? tangage(tg) * g : 0;
    PHI[1] = roule ? tangage(td) * g : 0;
    const uA = appuiG ? tg : td;
    let bas = roule && uA > 0.03 && uA < 0.5 ? Dr.descente * g * Math.sin((Math.PI * (uA - 0.03)) / 0.47) : 0;
    // attaque du talon : talon au sol pointe relevée, la cheville est plus haute qu'à plat → le bassin monte d'autant,
    // la jambe d'appui arrive TENDUE (sinon le genou plie de 40° au contact, mesuré le 16/11)
    if (roule && uA < Dr.uTalon) bas -= (decalCheville(appuiG ? PHI[0] : PHI[1], 1) - cheville) * g;
    const y = (ia ? T[T_LIFT] : T[T_PY]) - Lj * (1 - Math.cos(aS * g)) - bas + hanche * (1 - Math.cos(T[T_TILT] + S[RECUL] + (etat === S_RUSH ? B.rueePenche : 0))); // le penché pivote au sol : la racine remonte d'autant
    const sn = appuiG ? 1 : -1; // roulis vers la jambe d'appui
    const roll = B.roulis * g * sn * Math.sin(Math.PI * (t % 1));
    const tilt = T[T_TILT] + S[RECUL] + (etat === S_RUSH ? B.rueePenche : 0);
    const c = Math.cos(T[T_ROT]);
    const s = Math.sin(T[T_ROT]);
    const ca = Math.cos(tilt);
    const sa = Math.sin(tilt);
    const cb = Math.cos(roll);
    const sb = Math.sin(roll);
    const sx = 1 + T[T_SQ] * 0.5;
    const sy = 1 - T[T_SQ];
    const e = mesh.matrix.elements;
    e[0] = (c * cb + s * sa * sb) * sx;
    e[1] = ca * sb * sx;
    e[2] = (c * sa * sb - s * cb) * sx;
    e[3] = 0;
    e[4] = (s * sa * cb - c * sb) * sy;
    e[5] = ca * cb * sy;
    e[6] = (s * sb + c * sa * cb) * sy;
    e[7] = 0;
    e[8] = s * ca * sx;
    e[9] = -sa * sx;
    e[10] = c * ca * sx;
    e[11] = 0;
    e[12] = T[T_PX];
    e[13] = y;
    e[14] = T[T_PZ];
    e[15] = 1;
    mesh.matrixWorldNeedsUpdate = true;
    // jambes (pivot à la hanche), bras en opposition + geste, tête en retard
    const arm = B.bras * g / A;
    // le penché et le roulis de la racine pivotent autour du sol : les hanches les compensent, sinon ils déplacent le
    // pied d'appui (mesuré : 7 cm de levée et 0,7 m/s de glissement)
    if (os.jambe_g) {
      os.jambe_g.rotation.x = -ANG[0] - tilt;
      os.jambe_g.rotation.z = -roll;
      os.jambe_g.scale.y = ANG[2];
    }
    if (os.jambe_d) {
      os.jambe_d.rotation.x = -ANG[1] - tilt;
      os.jambe_d.rotation.z = -roll;
      os.jambe_d.scale.y = ANG[3];
    }
    // genou (plier = x positif : le pied part en arrière) ; cheville : pied à plat
    if (os.tibia_g) os.tibia_g.rotation.x = GENOU[0];
    if (os.tibia_d) os.tibia_d.rotation.x = GENOU[1];
    // pied à plat (la hanche a déjà compensé le penché) + tangage du déroulé
    if (os.pied_g) os.pied_g.rotation.x = ANG[0] - GENOU[0] + PHI[0];
    if (os.pied_d) os.pied_d.rotation.x = ANG[1] - GENOU[1] + PHI[1];
    if (B.marcheRef && os.tibia_g && os.pied_g && ia) {
      const u = (((w / (2 * Math.PI)) % 1) + 1) % 1;
      marcheRef(u, g, tilt, roll);
      ANG[0] = A * g * ((ANG[0] / (g || 1) - CMID) / CAMP); // bras : même balancier qu'avant, en phase avec la cuisse
      ANG[1] = A * g * ((ANG[1] / (g || 1) - CMID) / CAMP);
    } else if (os.tibia_g && os.pied_g && ia) piedPose(tg, td, tilt);
    if (os.bras_g) {
      os.bras_g.rotation.x = arm * ANG[0] + S[ARMX]; // en opposition : bras gauche en arrière quand la jambe gauche est devant
      os.bras_g.rotation.z = S[ARMZ];
    }
    if (os.bras_d) {
      os.bras_d.rotation.x = arm * ANG[1] + S[ARMX];
      os.bras_d.rotation.z = -S[ARMZ];
    }
    if (os.tete) {
      let dh = S[HEAD] - T[T_ROT];
      dh -= Math.round(dh / TWO_PI) * TWO_PI;
      os.tete.rotation.y = dh > 0.5 ? 0.5 : dh < -0.5 ? -0.5 : dh;
      os.tete.rotation.x = 0.05 * g * Math.sin(2 * w);
    }
    const hot = R.chaud();
    if (hot !== st.chaud) {
      // pièces de la phase 2 : seulement au changement (aucun appel à argument flottant par image, § V)
      st.chaud = hot;
      for (const b of p2) b.scale.set(hot ? 1 : 1e-4, hot ? 1 : 1e-4, hot ? 1 : 1e-4);
      if (os.p2_flammes) os.p2_flammes.scale.set(1e-4, 1e-4, 1e-4); // remplacé par les flammes simulées
    }
    if (hot && os.p2_reacteur) {
      const k = 1 + 0.08 * Math.sin(S[TIME] * 13);
      os.p2_reacteur.scale.x = k;
      os.p2_reacteur.scale.y = k;
      os.p2_reacteur.scale.z = k;
    }
    mesh.updateMatrixWorld(true);
    // visière en monde (§ E1.D) : départ du rayon du balayage laser
    if (os.tete) {
      const H = os.tete.matrixWorld.elements;
      visiere[0] = H[0] * VIS[0] + H[4] * VIS[1] + H[8] * VIS[2] + H[12];
      visiere[1] = H[1] * VIS[0] + H[5] * VIS[1] + H[9] * VIS[2] + H[13];
      visiere[2] = H[2] * VIS[0] + H[6] * VIS[1] + H[10] * VIS[2] + H[14];
    }
    // cheminées, fissures, réacteur en monde → émetteurs
    const M = mesh.matrixWorld.elements;
    const EM = flammes.EM;
    for (let k = 0; k < 3; k++) {
      const lx = LOC[k * 3];
      const ly = LOC[k * 3 + 1];
      const lz = LOC[k * 3 + 2];
      const wx = M[0] * lx + M[4] * ly + M[8] * lz + M[12];
      const wy = M[1] * lx + M[5] * ly + M[9] * lz + M[13];
      const wz = M[2] * lx + M[6] * ly + M[10] * lz + M[14];
      if (k < 2) {
        cheminees[k * 3] = wx;
        cheminees[k * 3 + 1] = wy;
        cheminees[k * 3 + 2] = wz;
      }
      const o = k * 10;
      EM[o] = wx;
      EM[o + 1] = wy;
      EM[o + 2] = wz;
      EM[o + 3] = bvx;
      EM[o + 4] = 0;
      EM[o + 5] = bvz;
      EM[o + 6] = k < 2 ? (hot ? B.debitCheminee : B.debitFumee) : hot ? B.debitReacteur : 0;
      EM[o + 7] = k < 2 && !hot ? 1 : 0;
      EM[o + 8] = k < 2 ? 0.2 : 0.18;
      EM[o + 9] = k < 2 ? 2.6 : 1.4;
      // fumée qui accompagne le feu des cheminées (émetteurs 3 et 4)
      if (k < 2) {
        const f = (3 + k) * 10;
        EM[f] = wx;
        EM[f + 1] = wy + 0.3;
        EM[f + 2] = wz;
        EM[f + 3] = bvx;
        EM[f + 4] = 0;
        EM[f + 5] = bvz;
        EM[f + 6] = hot ? B.debitFumeeFeu : 0;
        EM[f + 7] = 1;
        EM[f + 8] = 0.25;
        EM[f + 9] = 2.2;
      }
    }
    // fissures du torse : braises
    {
      const lx = FISSURES[0];
      const ly = FISSURES[1];
      const lz = FISSURES[2];
      const o = 5 * 10;
      EM[o] = M[0] * lx + M[4] * ly + M[8] * lz + M[12];
      EM[o + 1] = M[1] * lx + M[5] * ly + M[9] * lz + M[13];
      EM[o + 2] = M[2] * lx + M[6] * ly + M[10] * lz + M[14];
      EM[o + 3] = bvx;
      EM[o + 5] = bvz;
      EM[o + 6] = hot ? B.debitFissures : 0;
      EM[o + 7] = 0;
      EM[o + 8] = 0.5;
      EM[o + 9] = 0.9;
    }
    // mesure : pieds en monde ; vitesse horizontale du pied le plus bas (le pied d'appui) sur l'image
    const dt = S[DTF];
    if (os.jambe_g && os.jambe_d && dt > 0) {
      for (let k = 0; k < 2; k++) {
        const pied = k === 0 ? os.pied_g : os.pied_d;
        if (pied) {
          tmpV.set(0, 0, 0); // la cheville : le point fixé au sol pendant l'appui (pied posé)
          pied.localToWorld(tmpV);
          tmpV.y -= cheville; // hauteur rapportée à la semelle
        } else {
          tmpV.set(0, -hanche + 0.05, 0.1);
          (k === 0 ? os.jambe_g : os.jambe_d).localToWorld(tmpV);
        }
        const o = 2 + k * 3;
        const ex = tmpV.x - mesure[o];
        const ez = tmpV.z - mesure[o + 2];
        PIEDV[k] = Math.sqrt(ex * ex + ez * ez) / dt;
        mesure[o] = tmpV.x;
        mesure[o + 1] = tmpV.y;
        mesure[o + 2] = tmpV.z;
      }
      mesure[0] = PIEDV[0] < PIEDV[1] ? PIEDV[0] : PIEDV[1]; // le pied d'appui = le plus lent des deux
    }
  } else flammes.EM.fill(0);
  flammes.entree[0] = S[DTF]; // dt par tableau (§ V)
  flammes.update();
  S[DTF] = 0;
  flammes.sync();
}

// ----- prototype ----------------------------------------------------------------------------------------------------
export async function brancher({ scene, crochets }) {
  const { peindre } = await import('../rendu/materiaux.js');
  const boss = await import('../boss.js'); // copie patchée (tests/anim/gen-boss.mjs) : __T, __ignited, __matOrig
  const ancienBoss = scene.getObjectByName('boss');
  if (!ancienBoss) return;
  const donnees = await chargerPieces('/assets/modeles/boss.glb');
  init({ scene, materiau: peindre(boss.__matOrig || ancienBoss.material, { profil: 'boss' }), donnees, T: boss.__T, chaud: () => boss.__ignited, ancien: ancienBoss });
  surPas.f = (x, z, cote) => {
    crochets.enregistrerSon('BOSS_STEP', x, z);
    PAS_JOURNAL.push(cote); // mesure du calage (tests/anim-boss.mjs)
  };
  crochets.bossUpdate = (dt) => update(dt);
  crochets.bossSync = () => sync();
}
export function protoSetApres(on) {
  setActif(on);
}
/** Mesures : pas posés depuis le dernier relevé (côté 0 = g, 1 = d). */
export const PAS_JOURNAL = [];
/** Visière dans le repère de l'os de la tête (mesure de l'init) : lu par les tests (§ E1.D). */
export function visiereLocale() {
  return [VIS[0], VIS[1], VIS[2]];
}
export function protoInspect(out) {
  out.pas = PAS_JOURNAL.splice(0, PAS_JOURNAL.length);
  out.pieds = [mesure[3], mesure[6]]; // hauteur des pieds g, d (m)
  out.piedsXZ = [mesure[2], mesure[4], mesure[5], mesure[7]]; // chevilles g (x, z), d (x, z)
  out.etatBoss = E.bossIndex >= 0 ? E.state[E.bossIndex] : -1;
  if (mesh && os.pied_g) {
    const ag = new THREE.Vector3().setFromMatrixPosition(os.pied_g.matrixWorld);
    const ad = new THREE.Vector3().setFromMatrixPosition(os.pied_d.matrixWorld);
    // déroulé : talon et pointe de chaque semelle en monde (x, y, z) — pénétration du sol, glissement du point d'appui
    const sem = [];
    const plantes = [];
    for (const [p, o] of [[os.pied_g, os.orteils_g], [os.pied_d, os.orteils_d]]) {
      const v = new THREE.Vector3(0, -cheville, -PIED[0]).applyMatrix4(p.matrixWorld);
      sem.push(+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4));
      if (o) v.set(0, -PIED[3], PIED[2] - PIED[1]).applyMatrix4(o.matrixWorld);
      else v.set(0, -cheville, PIED[2]).applyMatrix4(p.matrixWorld);
      sem.push(+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4));
      v.set(0, -cheville, PIED[1]).applyMatrix4(p.matrixWorld);
      plantes.push(+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4));
    }
    out.semelles = sem; // talon g, bout des orteils g, talon d, bout des orteils d
    out.plantes = plantes; // charnière des orteils au sol, g puis d
    // articulations en monde (hanche, genou, cheville par jambe) et cap : schéma en bâtons des tests
    const art = [];
    for (const o of [os.jambe_g, os.tibia_g, os.pied_g, os.jambe_d, os.tibia_d, os.pied_d]) {
      const v = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      art.push(+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4));
    }
    out.articulations = art;
    const e = mesh.matrixWorld.elements;
    out.avant = [e[8], e[10]];
    out.tangage = [PHI[0], PHI[1]];
    out.ik = { ok: Array.from(CIBLE_OK), cible: Array.from(CIBLE).map((x) => +x.toFixed(2)), chevG: [ag.x, ag.y, ag.z].map((x) => +x.toFixed(2)), chevD: [ad.x, ad.y, ad.z].map((x) => +x.toFixed(2)), ik: Array.from(IK).map((x) => +x.toFixed(2)), cuisseD: [os.jambe_d.rotation.x, os.jambe_d.rotation.z].map((x) => +x.toFixed(2)), tibiaD: +os.tibia_d.rotation.x.toFixed(2) };
  }
  if (mesh) out.debug = { va: mesure[0], racineY: mesh.matrix.elements[13], racineZ: mesh.matrix.elements[14], racineX: mesh.matrix.elements[12], piedD: [mesure[5], mesure[6], mesure[7]], angD: ANG[1], genouD: GENOU[1], phase: S[PH], gait: S[GAIT], cap: R.T[T_ROT], capVitesse: E.bossIndex >= 0 ? Math.atan2(E.vx[E.bossIndex], E.vz[E.bossIndex]) : 0, penche: R.T[T_TILT] };
  out.piedAppuiVitesse = mesure[0];
  out.gait = S[GAIT];
  const f = {};
  flammes.inspect(f);
  out.flammes = f;
}
