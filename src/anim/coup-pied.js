// Étape 4, chantier J (ARCHITECTURE.md § E4.J.3) — état du coup de pied sur une borne, partagé sans allocation.
// Écrit par src/props.js (déclenchement au contact, temps simulé, impact), lu par src/anim/heros-anim.js (pose de la
// jambe). Un tableau typé : aucun objet, aucun flottant passé en argument (§ V).
//
// Chantier O (§ E4.O, retour de Femz du 16/11, 21h) : un VRAI coup de pied de combat — l'animation Mixamo « Standing
// Melee Kick », cuite sur le robot de chaque agent (assets/anims/coup-pied-<agent>.json, format « ctrlz-anim-robot/1 »).
// Ce module garde les pistes (Float32Array), les MESURES de l'animation sur le robot posé (image d'impact, portée du
// pied, correction de hauteur — calculées au chargement, hors combat, par cinématique directe sur les pivots du modèle)
// et l'échantillonneur sans allocation lu par heros-anim. props.js (déclenchement, casse) et player.js (freinage,
// planté) lisent COUP et MES ; weapons.js lit armesCoupees().
import { COUP_DE_PIED, DECORS } from '../config.js';

export const C_ACTIF = 0; // 1 = un coup est en cours
export const C_T = 1; // s simulées depuis le départ du coup
export const C_COTE = 2; // jambe qui frappe : 0 gauche, 1 droite
export const C_LACET = 3; // lacet monde de la borne visée (rad, comme P.rot : atan2(dx, dz))
export const C_LOURD = 4; // 1 = coup du Bastion (plus lent, plus lourd)
export const C_IMPACT = 5; // 1 = l'impact a eu lieu
export const C_TA = 6; // fin de l'armé (s)
export const C_TF = 7; // impact = fin de la frappe (s)
export const C_TT = 8; // fin de la tenue (s)
export const C_TR = 9; // fin du retour = fin du coup (s)
// § E4.O — coup cuit
export const C_V2 = 10; // 1 = le coup joue l'animation cuite (sinon le geste calculé du § E4.J)
export const C_AGENT = 11; // agent (AGENT.*) : pistes et réglages
export const C_BX = 12; // centre de la borne visée (monde)
export const C_BZ = 13;
export const C_X0 = 14; // position du héros au départ
export const C_Z0 = 15;
export const C_VX0 = 16; // vitesse du héros au départ (m/s)
export const C_VZ0 = 17;
export const C_PX = 18; // point où le héros se plante (monde) : à D* de la borne
export const C_PZ = 19;
export const C_CAP = 20; // lacet du corps pendant le coup (borne − angle du pied à l'impact)
export const C_SON = 21; // 1 = SFX.COUP_PIED déjà joué
export const C_ANNULE = 22; // 1 = annulé par un dash (props libère la borne)
export const C_LIBRE = 23; // 1 = la touche de déplacement a repris la main (fondu de sortie)
export const COUP = new Float64Array(24);

/** Prépare les temps du coup (lourd : × COUP_DE_PIED.lourd.temps). Écrit COUP[C_TA..C_TR]. */
export function temps(lourd) {
  const D = COUP_DE_PIED.duree;
  const k = lourd === 1 ? COUP_DE_PIED.lourd.temps : 1;
  COUP[C_TA] = D.arme * k;
  COUP[C_TF] = COUP[C_TA] + D.frappe * k;
  COUP[C_TT] = COUP[C_TF] + D.tenue * k;
  COUP[C_TR] = COUP[C_TT] + D.retour * k;
}

export function reset() {
  COUP.fill(0);
}

// ----- § E4.O : pistes cuites et mesures ----------------------------------------------------------------------------
// Ordre des os du format « ctrlz-anim-robot/1 » (heros-menu.cuire) — vérifié au chargement.
export const NOMS = ['racine', 'buste', 'tete', 'bras_g', 'avant_bras_g', 'bras_d', 'avant_bras_d', 'jambe_g', 'tibia_g', 'pied_g', 'orteils_g', 'jambe_d', 'tibia_d', 'pied_d', 'orteils_d'];
export const NB = NOMS.length;
export const I_JAMBE_D = 11;
const cuits = [null, null, null]; // { n, fps, Q: Float32Array(n × NB × 4), R: Float32Array(n × 3) } par agent
/** Mesures par agent (§ E4.O.1), sur le modèle posé : [0] image d'impact (s de l'animation), [1] portée du bout du pied
 *  à l'impact depuis l'origine du héros (m, horizontale), [2] angle de ce point (rad, atan2(x, z) dans le repère du
 *  héros), [3] correction de la cuisse (rad, vers le bas), [4] hauteur du bout du pied à l'impact après correction (m),
 *  [5] hauteur avant correction (m), [6] distance de plantage D* (m, centre de la borne → origine du héros),
 *  [7] 1 = mesures valides. */
export const MES = new Float64Array(3 * 8);
const PIV = new Float64Array(3 * 6); // pivots du modèle posé : jambe_d, tibia_d, pied_d, orteils_d, jambe_g, pied_g
const PV = new Float64Array(1); // 1 = pivots connus
const HAN = new Float64Array(1); // hanche (pivot y de jambe_g)

/** Document « ctrlz-anim-robot/1 » de l'agent a (main.js, au démarrage). Hors combat. */
export function setCuit(a, doc) {
  if (!doc || doc.format !== 'ctrlz-anim-robot/1' || doc.os.join(',') !== NOMS.join(',')) throw new Error('coup de pied : pistes inconnues');
  cuits[a] = { n: doc.n, fps: doc.fps, Q: Float32Array.from(doc.q), R: Float32Array.from(doc.racine), source: doc.source };
  mesurer(a);
}
export function cuitCharge(a) {
  return cuits[a] !== null && MES[a * 8 + 7] === 1;
}
export function cuitInfo(a) {
  const c = cuits[a];
  return c ? { n: c.n, fps: c.fps, source: c.source } : null;
}

/** Pivots du modèle posé (heros-anim.init). Hors combat. Recalcule les mesures des pistes déjà chargées. */
export function setModele(pieces) {
  const noms = ['jambe_d', 'tibia_d', 'pied_d', 'orteils_d', 'jambe_g', 'pied_g'];
  for (let k = 0; k < noms.length; k++) {
    const p = pieces.find((q) => q.nom === noms[k]);
    if (!p) {
      PV[0] = 0;
      return;
    }
    PIV[k * 3] = p.pivot[0];
    PIV[k * 3 + 1] = p.pivot[1];
    PIV[k * 3 + 2] = p.pivot[2];
  }
  HAN[0] = PIV[4 * 3 + 1];
  PV[0] = 1;
  for (let a = 0; a < 3; a++) if (cuits[a] !== null) mesurer(a);
}

// --- quaternions sur tableaux (x, y, z, w) : aucune allocation
const QS = new Float64Array(4 * NB); // pose échantillonnée (repère du héros, sans cap)
export const RS = new Float64Array(3); // position de la racine échantillonnée
const T4 = new Float64Array(16); // brouillon
/** a ← a · b (indices dans des tableaux) */
function qmul(o, oi, a, ai, b, bi) {
  const ax = a[ai];
  const ay = a[ai + 1];
  const az = a[ai + 2];
  const aw = a[ai + 3];
  const bx = b[bi];
  const by = b[bi + 1];
  const bz = b[bi + 2];
  const bw = b[bi + 3];
  o[oi] = aw * bx + ax * bw + ay * bz - az * by;
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
/** v (V[vi..vi+2]) ← q · v */
function qrot(q, qi, V, vi) {
  const x = q[qi];
  const y = q[qi + 1];
  const z = q[qi + 2];
  const w = q[qi + 3];
  const vx = V[vi];
  const vy = V[vi + 1];
  const vz = V[vi + 2];
  const ix = w * vx + y * vz - z * vy;
  const iy = w * vy + z * vx - x * vz;
  const iz = w * vz + x * vy - y * vx;
  const iw = -x * vx - y * vy - z * vz;
  V[vi] = ix * w + iw * -x + iy * -z - iz * -y;
  V[vi + 1] = iy * w + iw * -y + iz * -x - ix * -z;
  V[vi + 2] = iz * w + iw * -z + ix * -y - iy * -x;
}

/**
 * Échantillonne les pistes de l'agent a au temps u (s de l'animation, borné à la durée, sans boucle) dans QS / RS.
 * corr : correction de la cuisse qui frappe (rad, rotation autour de l'axe X du bassin, prémultipliée). Sans allocation.
 */
export function echantillonner(a, u, corr) {
  const c = cuits[a];
  const n = c.n;
  let f = u * c.fps;
  if (f < 0) f = 0;
  if (f > n - 1) f = n - 1;
  const i0 = Math.floor(f);
  const i1 = i0 + 1 < n ? i0 + 1 : i0;
  f -= i0;
  const Q = c.Q;
  for (let k = 0; k < NB; k++) {
    const p = (i0 * NB + k) * 4;
    const q = (i1 * NB + k) * 4;
    let s = Q[p] * Q[q] + Q[p + 1] * Q[q + 1] + Q[p + 2] * Q[q + 2] + Q[p + 3] * Q[q + 3] < 0 ? -1 : 1;
    const x = Q[p] + (s * Q[q] - Q[p]) * f;
    const y = Q[p + 1] + (s * Q[q + 1] - Q[p + 1]) * f;
    const z = Q[p + 2] + (s * Q[q + 2] - Q[p + 2]) * f;
    const w = Q[p + 3] + (s * Q[q + 3] - Q[p + 3]) * f;
    s = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
    const o = k * 4;
    QS[o] = x * s;
    QS[o + 1] = y * s;
    QS[o + 2] = z * s;
    QS[o + 3] = w * s;
  }
  const R = c.R;
  RS[0] = R[i0 * 3] + (R[i1 * 3] - R[i0 * 3]) * f;
  RS[1] = R[i0 * 3 + 1] + (R[i1 * 3 + 1] - R[i0 * 3 + 1]) * f;
  RS[2] = R[i0 * 3 + 2] + (R[i1 * 3 + 2] - R[i0 * 3 + 2]) * f;
  if (corr !== 0) {
    T4[0] = Math.sin(corr * 0.5);
    T4[1] = 0;
    T4[2] = 0;
    T4[3] = Math.cos(corr * 0.5);
    qmul(T4, 4, T4, 0, QS, I_JAMBE_D * 4);
    const o = I_JAMBE_D * 4;
    QS[o] = T4[4];
    QS[o + 1] = T4[5];
    QS[o + 2] = T4[6];
    QS[o + 3] = T4[7];
  }
}
/** Quaternion échantillonné de l'os k (index de NOMS). */
export const POSE = QS;

/** Poids de la correction de hauteur au temps u de l'animation (fenêtre COUP_DE_PIED.v2.correctionFenetre). */
export function poidsCorrection(u) {
  const F = COUP_DE_PIED.v2.correctionFenetre;
  let a = (u - F[0]) / (F[1] - F[0]);
  a = a < 0 ? 0 : a > 1 ? 1 : a;
  let b = (u - F[2]) / (F[3] - F[2]);
  b = b < 0 ? 0 : b > 1 ? 1 : b;
  return a * a * (3 - 2 * a) * (1 - b * b * (3 - 2 * b));
}

// --- cinématique directe du pied qui frappe (repère du héros, origine au sol sous le héros)
const V3 = new Float64Array(12);
/** Bout du pied droit (base des orteils + 9 cm vers l'avant du pied) → BOUT[0..2], cheville g → BOUT[3..5], cheville d → BOUT[6..8]. */
export const BOUT = new Float64Array(9);
function bout() {
  const H = HAN[0];
  // racine du jeu : X = R − Qr·(0, H, 0) ; chaîne jambe_d → tibia_d → pied_d → orteils_d (positions locales = écarts de pivots)
  const Qa = T4; // [0..3] cumul, [4..7] brouillon
  Qa[0] = QS[0];
  Qa[1] = QS[1];
  Qa[2] = QS[2];
  Qa[3] = QS[3];
  V3[0] = 0;
  V3[1] = H;
  V3[2] = 0;
  qrot(Qa, 0, V3, 0);
  const X0 = RS[0] - V3[0];
  const X1 = RS[1] - V3[1];
  const X2 = RS[2] - V3[2];
  // pied gauche (appui) : cheville = X + Qr·(pj_g + Qj_g·(pt_g − pj_g + Qt_g·(pp_g − pt_g))) — tibia_g n'a pas de pivot
  // enregistré ici : on prend la cheville par la chaîne complète de la jambe droite seulement, et la cheville gauche
  // par la même méthode avec les pivots miroirs (x opposé), assez juste pour un contrôle de glissement
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let cote = 0; cote < 2; cote++) {
    const sx = cote === 0 ? 1 : -1; // 1 = droite (pivots enregistrés), −1 = gauche (miroir)
    const jb = cote === 0 ? 11 : 7; // index des os dans NOMS : jambe, tibia, pied, orteils à la suite
    Qa[0] = QS[0];
    Qa[1] = QS[1];
    Qa[2] = QS[2];
    Qa[3] = QS[3];
    px = X0;
    py = X1;
    pz = X2;
    let lx = PIV[0] * sx;
    let ly = PIV[1];
    let lz = PIV[2];
    for (let s = 0; s < 4; s++) {
      // point local (écart au parent) tourné par le cumul des parents
      V3[0] = lx;
      V3[1] = ly;
      V3[2] = lz;
      qrot(Qa, 0, V3, 0);
      px += V3[0];
      py += V3[1];
      pz += V3[2];
      if (cote === 0 && s === 2) {
        BOUT[6] = px;
        BOUT[7] = py;
        BOUT[8] = pz;
      }
      if (cote === 1 && s === 2) {
        BOUT[3] = px;
        BOUT[4] = py;
        BOUT[5] = pz;
      }
      qmul(Qa, 4, Qa, 0, QS, (jb + s) * 4);
      Qa[0] = Qa[4];
      Qa[1] = Qa[5];
      Qa[2] = Qa[6];
      Qa[3] = Qa[7];
      if (s < 3) {
        lx = (PIV[(s + 1) * 3] - PIV[s * 3]) * sx;
        ly = PIV[(s + 1) * 3 + 1] - PIV[s * 3 + 1];
        lz = PIV[(s + 1) * 3 + 2] - PIV[s * 3 + 2];
      } else {
        lx = 0;
        ly = 0;
        lz = 0.09;
      }
    }
    if (cote === 0) {
      // dernier pas : bout des orteils (9 cm devant la base, repère des orteils)
      V3[0] = 0;
      V3[1] = 0;
      V3[2] = 0.09;
      qrot(Qa, 0, V3, 0);
      BOUT[0] = px + V3[0];
      BOUT[1] = py + V3[1];
      BOUT[2] = pz + V3[2];
    }
  }
}

/** Mesures de l'agent a sur le modèle posé (hors combat). */
function mesurer(a) {
  const c = cuits[a];
  if (c === null || PV[0] !== 1) return;
  const K = COUP_DE_PIED.v2;
  const o = a * 8;
  // 1. image d'impact : bout du pied le plus loin devant (z du héros) dans la fenêtre jouée, SANS correction (la jambe
  // tendue à l'horizontale, en fin d'extension) ; 2. correction de hauteur (bissection : la hauteur du bout du pied
  // décroît quand la cuisse descend) à cette image. (Essai écarté le 16/11 : chercher l'image AVEC la correction
  // ramène l'impact au sommet du coup, pied à 1,8 m — il faudrait 62° de correction : le coup devient un écrasement.)
  let corr = 0;
  let tI = K.clip.debut;
  let h0 = 0;
  for (let passe = 0; passe < K.passesImpact; passe++) {
    let best = -1e9;
    for (let i = 0; i < c.n * 4; i++) {
      const u = i / (c.fps * 4);
      if (u < K.clip.debut || u > K.clip.fin) continue;
      echantillonner(a, u, corr * poidsCorrection(u));
      bout();
      if (BOUT[2] > best) {
        best = BOUT[2];
        tI = u;
      }
    }
    echantillonner(a, tI, 0);
    bout();
    h0 = BOUT[1];
    let lo = 0;
    let hi = K.correctionMax;
    corr = 0;
    if (h0 > K.hauteurImpact && poidsCorrection(tI) > 1e-3) {
      for (let it = 0; it < 24; it++) {
        const m = (lo + hi) * 0.5;
        echantillonner(a, tI, m * poidsCorrection(tI));
        bout();
        if (BOUT[1] > K.hauteurImpact) lo = m;
        else hi = m;
      }
      corr = (lo + hi) * 0.5;
    }
  }
  echantillonner(a, tI, corr * poidsCorrection(tI));
  bout();
  const portee = Math.sqrt(BOUT[0] * BOUT[0] + BOUT[2] * BOUT[2]);
  MES[o] = tI;
  MES[o + 1] = portee;
  MES[o + 2] = Math.atan2(BOUT[0], BOUT[2]);
  MES[o + 3] = corr;
  MES[o + 4] = BOUT[1];
  MES[o + 5] = h0;
  MES[o + 6] = portee + DECORS.radius - K.penetration;
  MES[o + 7] = 1;
}

/** Pose échantillonnée de l'agent a au temps u avec sa correction (heros-anim, tests) ; écrit QS, RS, BOUT. */
export function poseA(a, u) {
  echantillonner(a, u, MES[a * 8 + 3] * poidsCorrection(u));
  bout();
}

/** Temps du coup cuit de l'agent a (s simulées) : impact, fin. Écrit COUP[C_TA..C_TR]. */
export function tempsV2(a) {
  const K = COUP_DE_PIED.v2;
  const v = K.agents[a].vitesse;
  const tI = (MES[a * 8] - K.clip.debut) / v;
  const fin = (K.clip.fin - K.clip.debut) / v;
  COUP[C_TA] = tI * 0.6;
  COUP[C_TF] = tI;
  COUP[C_TT] = tI;
  COUP[C_TR] = fin;
}

/** § E4.O.3 : armes du héros coupées pendant TOUT le coup. */
export function armesCoupees() {
  return COUP[C_ACTIF] === 1;
}

/** § E4.O.2 : un dash annule le coup (props libère la borne à son update). */
export function annuler() {
  if (COUP[C_ACTIF] !== 1) return;
  COUP[C_ACTIF] = 0;
  COUP[C_ANNULE] = 1;
}

export function inspect(out = {}) {
  out.coup = Array.from(COUP);
  out.mesures = [0, 1, 2].map((a) => ({
    charge: cuits[a] !== null,
    valide: MES[a * 8 + 7] === 1,
    impact: MES[a * 8],
    portee: MES[a * 8 + 1],
    angle: MES[a * 8 + 2],
    correction: MES[a * 8 + 3],
    hauteur: MES[a * 8 + 4],
    hauteurAvant: MES[a * 8 + 5],
    dStar: MES[a * 8 + 6],
  }));
  return out;
}
