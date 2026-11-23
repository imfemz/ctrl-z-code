// TISSUS DU SHINOBI (§ E5.I, 18/11/2026) — modèle S12 choisi par Femz le 15/11 : TROIS tissus simulés comme la cape de
// l'Éclaireur (« il a juste la même cape que l'Éclaireur ») :
//   - le PAN ENTRE LES JAMBES : étroit, accroché au bassin devant, effiloché en pointes ;
//   - le PAN DU DOS : plus long, accroché au bas du dos (bassin) ;
//   - la QUEUE DE L'ÉCHARPE : longue et fine, part du cou (buste) et flotte derrière.
// Sombre, liseré orange (accent du Shinobi 0xEF9628) sur les deux bords de chaque tissu. Réglages : TISSUS (config.js,
// région e5:I-tissus). La cape de l'Éclaireur (cape.js) n'est pas touchée ; le Bastion n'a ni cape ni tissus.
//
// SIMULATION : même Verlet maison que cape.js (pas fixe TISSUS.hz, sous-pas aux instants absolus, pose du corps
// INTERPOLÉE entre l'image précédente et la courante — translation et échelle linéaires, rotation sphérique), mais
// DEUX repères d'accroche : le BASSIN (os « corps » : il suit les jambes et le déplacement) pour les deux pans, le BUSTE
// (il suit la visée) pour l'écharpe. Chaque tissu : grille cols × rows de particules (dernière rangée = pointes libres),
// rangée 0 accrochée ; contraintes de structure, cisaillement, flexion, pointes. Forces : gravité, traînée de l'air le
// long de la normale (le tissu flotte en course, gonfle au dash, fouette dans la vrille), souffle de repos.
// Collisions : capsules des bras et des JAMBES (hanche → pied, en monde, écrites chaque image par heros-anim / pause-agent
// dans capsulesMonde ; rayons propres au Shinobi, TISSUS.rayonBras / rayonJambe), bassin (repère du bassin), dos (repère
// du buste, cape_dos du .glb), KATANA porté dans le dos (capsule en monde tirée de l'os arme_katana, rayon 0 quand il
// est caché), un couloir pour le pan devant (il reste entre les cuisses), un plan par tissu (le pan devant reste devant le bassin, le pan du dos et l'écharpe derrière), le sol.
// DOS RÉEL (skins, tâche 2, 22/11) : avec init({ surface }) (src/anim/dos-reel.js), le pan du dos et l'écharpe quittent
// leur plan et les capsules du bassin et de cape_dos (2 à 6 cm derrière le vrai maillage) pour la surface arrière du
// modèle ; leur accroche est posée sur elle ; une adhérence (TISSUS.dosReel = ANIM.cape.dosReel) les presse contre le
// dos à l'arrêt seulement. Le pan devant : voir DEVANT RÉEL ci-dessous. Revue du 22/11 : surface aux jambes LIBRES (les cuisses de l'idle
// sont plus en avant que celles du modèle au repos) — les pièces de dos s'arrêtent sur le côté arrière RÉEL des cuisses et
// des tibias (init({ jambes }), dos-reel.rayonsJambes) et, entre les jambes, derrière leur arrière dans la pose courante
// (entreJambes) : jamais dans la zone du pan devant.
// DEVANT RÉEL (fix de la fusion de 0.5.13, 22/11) : avec init({ devant }) (dos-reel : enveloppe AVANT du torse et de la
// tête), le PAN DEVANT retrouve le plaquage de profil-corps (main b010a50) dans la même méthode : accroches posées sur le
// ventre (TISSUS.devantReel.accroche), aucune particule dans le torse ni la tête, poussée douce vers le corps à l'arrêt
// (TISSUS.devantReel.adherence, effacée en course comme celle du dos). Ses capsules de jambes (0,08–0,09 m + 2 cm : la
// garde des coups de pied), son plan, son couloir et la séparation des pans (butée des pièces de dos) ne changent pas —
// au rayon avant réel des jambes, le pan approchait l'axe de la cuisse à 5,1 cm en fente (seuil de e5-I : 5) sans rien
// gagner au repos.
//
// RENDU : UN maillage pour les trois tissus (1 appel de dessin + 1 dans la carte d'ombre : autant que la cape), indexé,
// double face, matériau de la cape (cape.creerMateriau : même programme, aucun programme de plus) ; couleurs par sommet :
// tissu sombre (bas plus clair, usure) et liseré orange = une bande de sommets à part le long des bords (le bord du
// tissu est rentré d'autant : rien ne se superpose).
//
// API (celle de cape.js, plus le repère du bassin) : init({ scene, dos }), reset(Mbuste), update(Mbuste), sync(),
// setVisible, couper, getMesh, capsulesMonde (0-1 bras, 2-3 cuisses, 4-5 tibias, 6 katana du dos), entree ([0] dt simulé),
// bassin (16 flottants : matrice MONDE du bassin à donner avant reset / update, repère du MODÈLE → monde), inspect,
// lirePositions. Zéro allocation par image : tout l'état est dans des tableaux typés créés au chargement.
import * as THREE from 'three';
import { TISSUS } from '../config.js';
import { creerMateriau } from './cape.js';
import { hauteurDos, LIBRE } from './dos-reel.js';

const T = TISSUS;
const PIECES = T.pieces;
const NP = PIECES.length;
const H = 1 / T.hz;
const H2 = H * H;

// ----- disposition des particules : pièce k → [P0, NX, NY] (NY compte la rangée des pointes)
const P0 = new Int32Array(NP);
const PNX = new Int32Array(NP);
const PNY = new Int32Array(NP);
let N = 0;
for (let k = 0; k < NP; k++) {
  P0[k] = N;
  PNX[k] = PIECES[k].cols;
  PNY[k] = PIECES[k].rows;
  N += PIECES[k].cols * PIECES[k].rows;
}
const pos = new Float32Array(N * 3);
const prev = new Float32Array(N * 3);
const rest = new Float32Array(N * 3); // repère du modèle
const nrm = new Float32Array(N * 3);
const invM = new Float32Array(N);
const rowOf = new Uint8Array(N); // rangée dans sa pièce
const colOf = new Uint8Array(N);
const pieceOf = new Uint8Array(N);
const tipOf = new Uint8Array(N); // 1 : pointe
// réglages par pièce (tableaux typés : lus sur le chemin chaud) : repère (0 bassin, 1 buste), traînée normale,
// tangentielle, gravité, souffle, plan (signe, z), poids des pointes
const PF = new Int8Array(NP);
const PKN = new Float64Array(NP);
const PKT = new Float64Array(NP);
const PG = new Float64Array(NP);
const PSO = new Float64Array(NP);
const PPS = new Int8Array(NP); // signe du plan : +1 « z ≤ lim », −1 « z ≥ lim », 0 aucun
const PPZ = new Float64Array(NP);
const PFL = new Float64Array(NP); // flottement : ondes le long du tissu, ∝ vitesse de l'air (1/s)
// dos réel (skins, tâche 2 ; src/anim/dos-reel.js) : pièces de dos (plan.signe +1 : pan du dos, écharpe) posées sur la
// surface du modèle quand init en reçoit une — DOSR[k] = 1 (Int8) et GK[k] = 1 (Float64, gain de l'adhérence) ; HR[k] =
// demi-écart entre deux rangées (m) ; DRT = marge, adhérence (m/s²), vitesse (m/s), tau (s) ; QT = échange avec
// hauteurDos ; HV = accélération d'adhérence de l'image par repère (0 bassin, 1 buste) ; ADGT[0] = adhérence posée à l'init
const DOSR = new Int8Array(NP);
const GK = new Float64Array(NP);
const HR = new Float64Array(PIECES.map((p) => (T.dosReel.fenetre * p.longueur) / (p.rows - 2) / 2));
const DRT = new Float64Array([T.dosReel.marge, T.dosReel.adherence, T.dosReel.vitesse, T.dosReel.tau]);
const QT = new Float64Array(4);
const HV = new Float64Array(6);
const ADGT = new Float64Array(1);
// devant réel (pan devant) : DEVR[k] = 1 quand init reçoit la surface avant ; DVT = adhérence du pan devant /
// adhérence du dos, écart des accroches au ventre (m)
const DEVR = new Int8Array(NP);
const DVT = new Float64Array(T.devantReel ? [DRT[1] > 0 ? T.devantReel.adherence / DRT[1] : 0, T.devantReel.accroche] : [0, 0]);
let surfV = null;
// jambes RÉELLES pour les pièces de dos (revue du 22/11) : rayon mesuré sur le maillage des capsules cuisse g, d, tibia
// g, d (dos-reel.rayonsJambes), 0 = rayon du config ; les capsules du config (rayonCuisse 0,08, rayonTibia 0,09) gardent
// 2 cm de garde pour le pan DEVANT (coups de pied) : le pan du dos et l'écharpe, eux, s'arrêtent sur la vraie jambe
const JRD = new Float64Array(9); // indice = capsule (NLOC + 2 … NLOC + 5)
let surf = null;
for (let k = 0; k < NP; k++) {
  const p = PIECES[k];
  PF[k] = p.os === 'buste' ? 1 : 0;
  PKN[k] = p.traineeNormale;
  PKT[k] = p.traineeTangente;
  PG[k] = p.gravite;
  PSO[k] = p.souffle;
  PPS[k] = p.plan ? p.plan.signe : 0;
  PPZ[k] = p.plan ? p.plan.z : 0;
  PFL[k] = p.flottement || 0;
}

// contraintes
const MAXC = N * 8;
const cA = new Uint16Array(MAXC);
const cB = new Uint16Array(MAXC);
const cL = new Float32Array(MAXC);
const cK = new Float32Array(MAXC);
let nC = 0;

// capsules du corps (repère du modèle) : 0 bassin (repère bassin), 1 dos (buste)
const NLOC = 2;
const capLocal = new Float32Array(NLOC * 7);
const capFrame = new Int8Array([0, 1]);
// capsules EN MONDE données à chaque image : 0-1 bras (épaule → main), 2-3 cuisses (hanche → genou), 4-5 tibias
// (genou → pied) — deux capsules par jambe : genou plié, une seule capsule hanche → pied coupait le genou
const NDYN = 7; // + 6 : katana porté dans le dos (os arme_katana), rayon 0 s'il est caché
const NCAP = NLOC + NDYN;
const capDyn0 = new Float32Array(NDYN * 7);
const capDyn1 = new Float32Array(NDYN * 7);
/** Capsules EN MONDE pour l'image courante (k × 7 : a, b, rayon ; rayon 0 = aucune ; 0-1 bras, 2-3 cuisses, 4-5 tibias, 6 katana), avant update(). */
export const capsulesMonde = capDyn1;
const RAYON_DYN = new Float32Array([T.rayonBras, T.rayonBras, T.rayonCuisse, T.rayonCuisse, T.rayonTibia, T.rayonTibia, T.katana.rayon]);
// réglages lus sur le chemin chaud (§ V : tableaux typés) : marge, souffle (rad/s), conservation, flottement (rad/s)
const RG = new Float64Array([T.marge, T.souffleHz * 6.283185307, 1 - T.amortissement, T.flottementHz * 6.283185307, T.tente.jambes, T.tente.katana]);
// poussées dirigées : CAPDIR[capsule × NP + pièce] = +1 vers l'avant, −1 vers l'arrière de l'axe z du repère CAPFR[capsule]
// (0 bassin, 1 buste), 0 = radiale. Capsules : 0 bassin, 1 dos, 2-3 bras, 4-5 cuisses, 6-7 tibias, 8 katana.
const CAPDIR = new Int8Array(NCAP * NP);
const CAPFR = new Int8Array(NCAP);
const FZ = new Float64Array(6);
for (let k = 0; k < NP; k++) {
  const p = PIECES[k];
  if (p.devantJambes) for (let c = NLOC + 2; c < NLOC + 6; c++) CAPDIR[c * NP + k] = 1;
  if (p.derriereKatana) CAPDIR[(NLOC + 6) * NP + k] = -1;
}
CAPFR[NLOC + 6] = 1;
const PCO = new Float64Array(PIECES.map((p) => (p.couloir ? p.couloir : 0))); // demi-largeur du couloir (x du repère), 0 aucun
const capW = new Float32Array(NCAP * 7); // en monde, au sous-pas courant

// matrices des deux repères (0 bassin, 1 buste), colonne majeure : image précédente, courante, interpolée
const M0 = new Float32Array(32);
const M1 = new Float32Array(32);
const MI = new Float32Array(32);
const D0 = new Float64Array(20);
const D1 = new Float64Array(20);
/** Matrice MONDE du bassin (repère du modèle → monde), à écrire avant reset() et update(). */
export const bassin = new Float32Array(16);

function decompose(M, mo, D, d) {
  D[d] = M[mo + 12];
  D[d + 1] = M[mo + 13];
  D[d + 2] = M[mo + 14];
  const sx = Math.sqrt(M[mo] * M[mo] + M[mo + 1] * M[mo + 1] + M[mo + 2] * M[mo + 2]) || 1;
  const sy = Math.sqrt(M[mo + 4] * M[mo + 4] + M[mo + 5] * M[mo + 5] + M[mo + 6] * M[mo + 6]) || 1;
  const sz = Math.sqrt(M[mo + 8] * M[mo + 8] + M[mo + 9] * M[mo + 9] + M[mo + 10] * M[mo + 10]) || 1;
  D[d + 3] = sx;
  D[d + 4] = sy;
  D[d + 5] = sz;
  const m11 = M[mo] / sx, m12 = M[mo + 4] / sy, m13 = M[mo + 8] / sz;
  const m21 = M[mo + 1] / sx, m22 = M[mo + 5] / sy, m23 = M[mo + 9] / sz;
  const m31 = M[mo + 2] / sx, m32 = M[mo + 6] / sy, m33 = M[mo + 10] / sz;
  const tr = m11 + m22 + m33;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1.0);
    D[d + 9] = 0.25 / s;
    D[d + 6] = (m32 - m23) * s;
    D[d + 7] = (m13 - m31) * s;
    D[d + 8] = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    D[d + 9] = (m32 - m23) / s;
    D[d + 6] = 0.25 * s;
    D[d + 7] = (m12 + m21) / s;
    D[d + 8] = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    D[d + 9] = (m13 - m31) / s;
    D[d + 6] = (m12 + m21) / s;
    D[d + 7] = 0.25 * s;
    D[d + 8] = (m23 + m32) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    D[d + 9] = (m21 - m12) / s;
    D[d + 6] = (m13 + m31) / s;
    D[d + 7] = (m23 + m32) / s;
    D[d + 8] = 0.25 * s;
  }
}

/** MI[f] = pose du repère f interpolée à S[ALPHA] (même calcul que cape.js). */
function interpoler(f) {
  const t = S[ALPHA];
  const d = f * 10;
  const o = f * 16;
  let bx = D1[d + 6], by = D1[d + 7], bz = D1[d + 8], bw = D1[d + 9];
  const ax = D0[d + 6], ay = D0[d + 7], az = D0[d + 8], aw = D0[d + 9];
  let c = ax * bx + ay * by + az * bz + aw * bw;
  if (c < 0) {
    c = -c;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0 = 1 - t;
  let k1 = t;
  if (c < 0.9995) {
    const a = Math.acos(c);
    const sa = Math.sin(a);
    k0 = Math.sin((1 - t) * a) / sa;
    k1 = Math.sin(t * a) / sa;
  }
  let x = ax * k0 + bx * k1, y = ay * k0 + by * k1, z = az * k0 + bz * k1, w = aw * k0 + bw * k1;
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  x /= l;
  y /= l;
  z /= l;
  w /= l;
  const sx = D0[d + 3] + (D1[d + 3] - D0[d + 3]) * t;
  const sy = D0[d + 4] + (D1[d + 4] - D0[d + 4]) * t;
  const sz = D0[d + 5] + (D1[d + 5] - D0[d + 5]) * t;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  MI[o] = (1 - (yy + zz)) * sx;
  MI[o + 1] = (xy + wz) * sx;
  MI[o + 2] = (xz - wy) * sx;
  MI[o + 3] = 0;
  MI[o + 4] = (xy - wz) * sy;
  MI[o + 5] = (1 - (xx + zz)) * sy;
  MI[o + 6] = (yz + wx) * sy;
  MI[o + 7] = 0;
  MI[o + 8] = (xz + wy) * sz;
  MI[o + 9] = (yz - wx) * sz;
  MI[o + 10] = (1 - (xx + yy)) * sz;
  MI[o + 11] = 0;
  MI[o + 12] = D0[d] + (D1[d] - D0[d]) * t;
  MI[o + 13] = D0[d + 1] + (D1[d + 1] - D0[d + 1]) * t;
  MI[o + 14] = D0[d + 2] + (D1[d + 2] - D0[d + 2]) * t;
  MI[o + 15] = 1;
}

// scalaires (§ V : jamais dans un let)
const ACC = 0;
const TIME = 1;
const STEPS = 2;
const TOTAL = 3;
const ALPHA = 4;
const DALPHA = 5; // durée d'un sous-pas en part de l'image (H / dt)
const AMID = 6; // instant du milieu du sous-pas
const ADH = 7; // adhérence au dos de l'image (0..1 : 1 à l'arrêt, 0 au-delà de dosReel.vitesse), lissée
const S = new Float64Array(8);
/** [0] dt simulé de l'image. */
export const entree = new Float64Array(1);
const st = { pret: false, visible: true };

// ----- maillage : par pièce, tissu NX × (NY − 1), milieux du bas (NX − 1), pointes (NX), liseré 2 bords × (NY − 1) × 2
const V0 = new Int32Array(NP); // 1er sommet de la pièce
const VMID = new Int32Array(NP);
const VTIP = new Int32Array(NP);
const VLIS = new Int32Array(NP);
let NV = 0;
for (let k = 0; k < NP; k++) {
  const nx = PNX[k];
  const ny = PNY[k];
  V0[k] = NV;
  VMID[k] = NV + nx * (ny - 1);
  VTIP[k] = VMID[k] + nx - 1;
  VLIS[k] = VTIP[k] + nx;
  NV = VLIS[k] + 2 * (ny - 1) * 2;
}
const LISF = new Float32Array(NP); // part de l'écart entre colonnes prise par le liseré, au bord
let mesh = null;
let posAttr = null;
let nrmAttr = null;
let tris = null;
let nTris = 0;

export function getMesh() {
  return mesh;
}

function addC(a, b, k) {
  const dx = rest[b * 3] - rest[a * 3];
  const dy = rest[b * 3 + 1] - rest[a * 3 + 1];
  const dz = rest[b * 3 + 2] - rest[a * 3 + 2];
  cA[nC] = a;
  cB[nC] = b;
  cL[nC] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  cK[nC] = k;
  nC++;
}

const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Disposition de repos, contraintes, capsules. dos : { a, b, rayon } (cape_dos du .glb) ou null. Hors combat. */
function disposer(dos, surface, devant) {
  nC = 0;
  surf = surface;
  surfV = surface !== null ? devant : null;
  ADGT[0] = surface !== null ? DRT[1] : 0;
  for (let k = 0; k < NP; k++) {
    const p = PIECES[k];
    DOSR[k] = surface !== null && p.plan && p.plan.signe > 0 ? 1 : 0;
    DEVR[k] = surfV !== null && p.plan && p.plan.signe < 0 ? 1 : 0;
    GK[k] = DOSR[k] - DVT[0] * DEVR[k]; // pan devant : adhérence vers l'ARRIÈRE du bassin (vers le ventre et les cuisses)
    const nx = PNX[k];
    const ny = PNY[k];
    const tip = ny - 1;
    const cote = norm3(p.cote);
    const bas = norm3(p.bas);
    const o = P0[k];
    for (let r = 0; r < tip; r++) {
      const t = r / (tip - 1);
      const hw = p.largeurHaut / 2 + (p.largeurBas / 2 - p.largeurHaut / 2) * t;
      for (let c = 0; c < nx; c++) {
        const i = o + r * nx + c;
        const u = c / (nx - 1);
        const l = hw * (1 - 2 * u);
        const d = t * p.longueur;
        rest[i * 3] = p.haut[0] + cote[0] * l + bas[0] * d;
        rest[i * 3 + 1] = p.haut[1] + cote[1] * l + bas[1] * d;
        rest[i * 3 + 2] = p.haut[2] + cote[2] * l + bas[2] * d;
        invM[i] = r === 0 ? 0 : 1;
        rowOf[i] = r;
        colOf[i] = c;
        pieceOf[i] = k;
        tipOf[i] = 0;
      }
    }
    for (let c = 0; c < nx; c++) {
      const a = o + (tip - 1) * nx + c;
      const i = o + tip * nx + c;
      const L = p.pointes[c % p.pointes.length];
      const dl = p.decalagePointes[c % p.decalagePointes.length];
      rest[i * 3] = rest[a * 3] + bas[0] * L + cote[0] * dl;
      rest[i * 3 + 1] = rest[a * 3 + 1] + bas[1] * L + cote[1] * dl;
      rest[i * 3 + 2] = rest[a * 3 + 2] + bas[2] * L + cote[2] * dl;
      invM[i] = p.poidsPointes;
      rowOf[i] = tip;
      colOf[i] = c;
      pieceOf[i] = k;
      tipOf[i] = 1;
    }
    if (DOSR[k] === 1) {
      // dos réel : la pièce entière glisse le long de z jusqu'à ce que son accroche touche la surface (moins la marge) —
      // forme et longueurs inchangées ; l'accroche du config était 2 à 2,5 cm derrière le vrai dos
      QT[0] = p.haut[0];
      QT[1] = p.haut[1];
      QT[3] = HR[k];
      hauteurDos(surface, QT);
      const dz = QT[2] - DRT[0] - p.haut[2];
      for (let i = o; i < o + nx * ny; i++) rest[i * 3 + 2] += dz;
    }
    if (DEVR[k] === 1)
      // devant réel : chaque COLONNE glisse le long de z jusqu'à ce que son accroche soit à devantReel.accroche du ventre
      // (surface rangée en −z : devant du corps = −QT[2] ; lue au point même de l'accroche, comme profil-corps posait
      // les siennes) — longueurs des colonnes inchangées ; hors du torse (LIBRE), la colonne ne bouge pas
      for (let c = 0; c < nx; c++) {
        const a = o + c;
        QT[0] = rest[a * 3];
        QT[1] = rest[a * 3 + 1];
        QT[3] = 0;
        hauteurDos(surfV, QT);
        if (!(QT[2] < LIBRE * 0.5)) continue;
        const dz = -QT[2] + DVT[1] - rest[a * 3 + 2];
        for (let r = 0; r < ny; r++) rest[(a + r * nx) * 3 + 2] += dz;
      }
    const id = (r, c) => o + r * nx + c;
    for (let r = 0; r < tip; r++)
      for (let c = 0; c < nx; c++) {
        if (c + 1 < nx) addC(id(r, c), id(r, c + 1), p.raideur);
        if (r + 1 < tip) addC(id(r, c), id(r + 1, c), p.raideur);
        if (r + 1 < tip && c + 1 < nx) {
          addC(id(r, c), id(r + 1, c + 1), p.raideurCisaillement);
          addC(id(r, c + 1), id(r + 1, c), p.raideurCisaillement);
        }
        if (c + 2 < nx) addC(id(r, c), id(r, c + 2), p.raideurFlexion);
        if (r + 2 < tip) addC(id(r, c), id(r + 2, c), p.raideurFlexion);
      }
    for (let c = 0; c < nx; c++) {
      addC(id(tip - 1, c), id(tip, c), p.raideurPointe);
      addC(id(tip - 2, c), id(tip, c), p.raideurFlexion * 1.5);
    }
    // liseré : largeur fixe (m) rapportée à l'écart moyen entre deux colonnes
    const ecart = (p.largeurHaut + p.largeurBas) / 2 / (nx - 1);
    LISF[k] = Math.min(0.45, T.lisere.largeur / ecart);
  }
  const setCap = (k, a, b, rr) => {
    capLocal[k * 7] = a[0];
    capLocal[k * 7 + 1] = a[1];
    capLocal[k * 7 + 2] = a[2];
    capLocal[k * 7 + 3] = b[0];
    capLocal[k * 7 + 4] = b[1];
    capLocal[k * 7 + 5] = b[2];
    capLocal[k * 7 + 6] = rr;
  };
  setCap(0, T.bassin.a, T.bassin.b, T.bassin.rayon);
  const D = dos || T.dos;
  setCap(1, D.a, D.b, D.rayon);
}

/** Crée (une fois) le maillage des trois tissus ; rappelable au changement de modèle (hors combat). */
export function init({ scene, dos = null, material = null, surface = null, jambes = null, katana = null, devant = null }) {
  disposer(dos, surface, devant);
  // katana du dos relu sur le modèle (dos-reel.axeKatana) ; TISSUS.katana seulement sans pièce arme_katana
  const K = katana || T.katana;
  for (let i = 0; i < 3; i++) {
    KAT[i] = K.a[i];
    KAT[3 + i] = K.b[i];
  }
  RAYON_DYN[6] = K.rayon;
  KATANA_UTILISE.set(KAT);
  KATANA_UTILISE[6] = K.rayon;
  JRD.fill(0);
  if (surface !== null && jambes) for (let j = 0; j < 4; j++) JRD[NLOC + 2 + j] = jambes[j];
  if (mesh !== null) {
    if (mesh.parent !== scene) scene.add(mesh);
    mesh.visible = false;
    st.pret = true;
    return;
  }
  const g = new THREE.BufferGeometry();
  posAttr = new THREE.BufferAttribute(new Float32Array(NV * 3), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  nrmAttr = new THREE.BufferAttribute(new Float32Array(NV * 3), 3);
  nrmAttr.setUsage(THREE.DynamicDrawUsage);
  const col = new Float32Array(NV * 3);
  const base = new THREE.Color(T.couleur);
  const lis = new THREE.Color(T.lisere.couleur);
  const idx = [];
  for (let k = 0; k < NP; k++) {
    const nx = PNX[k];
    const ny = PNY[k];
    const tip = ny - 1;
    const v0 = V0[k];
    const coul = (v, c, f) => {
      col[v * 3] = c.r * f;
      col[v * 3 + 1] = c.g * f;
      col[v * 3 + 2] = c.b * f;
    };
    for (let r = 0; r < tip; r++) for (let c = 0; c < nx; c++) coul(v0 + r * nx + c, base, 1 + T.degrade * (r / tip));
    for (let c = 0; c < nx - 1; c++) coul(VMID[k] + c, base, 1 + T.degrade * ((tip - 1) / tip));
    for (let c = 0; c < nx; c++) coul(VTIP[k] + c, base, 1 + T.degrade);
    for (let v = VLIS[k]; v < VLIS[k] + 4 * (ny - 1); v++) coul(v, lis, T.lisere.gain);
    for (let r = 0; r < tip - 1; r++)
      for (let c = 0; c < nx - 1; c++) {
        const a = v0 + r * nx + c;
        const b = a + 1;
        const d = a + nx;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    const R = v0 + (tip - 1) * nx;
    for (let c = 0; c < nx; c++) {
      const A = R + c;
      const Tt = VTIP[k] + c;
      if (c > 0) idx.push(VMID[k] + c - 1, A, Tt);
      if (c < nx - 1) idx.push(A, VMID[k] + c, Tt);
    }
    // liseré : bord gauche (s = 0 : extérieur = colonne « a ») puis bord droit (s = 1 : intérieur = colonne « a »)
    for (let s = 0; s < 2; s++) {
      const L0 = VLIS[k] + s * 2 * (ny - 1);
      for (let r = 0; r < tip - 1; r++) {
        const o0 = L0 + r * 2;
        const i0 = o0 + 1;
        const o1 = o0 + 2;
        const i1 = o0 + 3;
        if (s === 0) idx.push(o0, o1, i0, i0, o1, i1);
        else idx.push(i0, i1, o0, o0, i1, o1);
      }
    }
  }
  tris = new Uint16Array(idx);
  nTris = tris.length / 3;
  g.setIndex(new THREE.BufferAttribute(tris, 1));
  g.setAttribute('position', posAttr);
  g.setAttribute('normal', nrmAttr);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(NV), 1));
  g.setAttribute('aFx', new THREE.BufferAttribute(new Float32Array(NV * 2), 2));
  mesh = new THREE.Mesh(g, material || creerMateriau());
  mesh.name = 'joueur-tissus';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mesh.renderOrder = 2.5; // comme la cape : après la silhouette du héros
  mesh.visible = false;
  scene.add(mesh);
  st.pret = true;
}

// x' = M · x (point), M colonne majeure à l'offset mo
function xf(M, mo, src, si, dst, di) {
  const x = src[si];
  const y = src[si + 1];
  const z = src[si + 2];
  dst[di] = M[mo] * x + M[mo + 4] * y + M[mo + 8] * z + M[mo + 12];
  dst[di + 1] = M[mo + 1] * x + M[mo + 5] * y + M[mo + 9] * z + M[mo + 13];
  dst[di + 2] = M[mo + 2] * x + M[mo + 6] * y + M[mo + 10] * z + M[mo + 14];
}

const KAT = new Float64Array([...T.katana.a, ...T.katana.b]); // axe du katana du dos (repère du modèle) ; réécrit à init() depuis le modèle
/** Capsule du katana réellement utilisée (a, b, rayon ; repère du modèle) : lue par les tests. */
export const KATANA_UTILISE = new Float64Array(7);
/**
 * Repères de l'image, avant reset() / update() : eCorps = matrixWorld.elements de l'os du bassin, piv = son pivot
 * (repère du modèle, Float64Array(3)) ; eKatana = matrice d'un repère où l'axe du katana (TISSUS.katana, repère du
 * modèle) est donné moins kpiv — le buste et kpiv nul en pratique — ou null quand le katana n'est pas au dos. Calcul à la main : aucun flottant passé en argument (§ V).
 */
export function poserReperes(eCorps, piv, eKatana, kpiv) {
  for (let i = 0; i < 12; i++) bassin[i] = eCorps[i];
  for (let i = 0; i < 3; i++) bassin[12 + i] = eCorps[12 + i] - eCorps[i] * piv[0] - eCorps[4 + i] * piv[1] - eCorps[8 + i] * piv[2];
  bassin[15] = 1;
  if (eKatana === null) {
    capDyn1[48] = 0;
    return;
  }
  for (let j = 0; j < 2; j++) {
    const x = KAT[j * 3] - kpiv[0];
    const y = KAT[j * 3 + 1] - kpiv[1];
    const z = KAT[j * 3 + 2] - kpiv[2];
    for (let i = 0; i < 3; i++) capDyn1[42 + j * 3 + i] = eKatana[i] * x + eKatana[4 + i] * y + eKatana[8 + i] * z + eKatana[12 + i];
  }
  capDyn1[48] = 1;
}

export function setCapsuleMonde(k, ax, ay, az, bx, by, bz, rayon) {
  const o = k * 7;
  capDyn1[o] = ax;
  capDyn1[o + 1] = ay;
  capDyn1[o + 2] = az;
  capDyn1[o + 3] = bx;
  capDyn1[o + 4] = by;
  capDyn1[o + 5] = bz;
  capDyn1[o + 6] = rayon;
}

/** Replace les tissus au repos (Mbuste : matrice monde du buste ; bassin : écrit avant). */
export function reset(Mb) {
  for (let i = 0; i < 16; i++) {
    M1[i] = bassin[i];
    M1[16 + i] = Mb[i];
  }
  M0.set(M1);
  capDyn0.set(capDyn1);
  for (let p = 0; p < N; p++) {
    xf(M1, PF[pieceOf[p]] * 16, rest, p * 3, pos, p * 3);
    prev[p * 3] = pos[p * 3];
    prev[p * 3 + 1] = pos[p * 3 + 1];
    prev[p * 3 + 2] = pos[p * 3 + 2];
  }
  S[ACC] = 0;
  S[TOTAL] = 0;
  S[TIME] = 0;
  S[ADH] = 1;
  normales();
}

function normales() {
  for (let k = 0; k < NP; k++) {
    const nx = PNX[k];
    const ny = PNY[k];
    const o = P0[k];
    for (let r = 0; r < ny; r++)
      for (let c = 0; c < nx; c++) {
        const rr = r === ny - 1 ? ny - 2 : r;
        const l = (o + rr * nx + (c > 0 ? c - 1 : c)) * 3;
        const rt = (o + rr * nx + (c < nx - 1 ? c + 1 : c)) * 3;
        const u = (o + (rr > 0 ? rr - 1 : rr) * nx + c) * 3;
        const d = (o + (rr < ny - 2 ? rr + 1 : rr) * nx + c) * 3;
        const ax = pos[rt] - pos[l];
        const ay = pos[rt + 1] - pos[l + 1];
        const az = pos[rt + 2] - pos[l + 2];
        const bx = pos[d] - pos[u];
        const by = pos[d + 1] - pos[u + 1];
        const bz = pos[d + 2] - pos[u + 2];
        const nX = ay * bz - az * by;
        const nY = az * bx - ax * bz;
        const nZ = ax * by - ay * bx;
        const n = Math.sqrt(nX * nX + nY * nY + nZ * nZ) + 1e-12;
        const q = (o + r * nx + c) * 3;
        nrm[q] = nX / n;
        nrm[q + 1] = nY / n;
        nrm[q + 2] = nZ / n;
      }
  }
}

// Collisions, une fonction par sorte (chacune courte : un seul gros corps à plusieurs boucles chaudes était sans cesse
// désoptimisé « pour OSR » dans Chromium — mesuré au --trace-deopt — et, interprété, il emballait ses flottants)
function collisions() {
  plans();
  if (surf !== null) {
    dosReel();
    entreJambes();
    butee();
  }
  if (surfV !== null) devantReel();
  couloirs();
  capsules();
  sol();
}

function plans() {
  // plan de chaque tissu, dans le repère de son os (axe z du modèle = l'avant)
  for (let k = 0; k < NP; k++) {
    const sg = PPS[k];
    if (sg === 0 || DOSR[k] === 1) continue; // pièce de dos : la surface du dos réel remplace son plan
    const mo = PF[k] * 16;
    const zx = MI[mo + 8];
    const zy = MI[mo + 9];
    const zz = MI[mo + 10];
    const sz = Math.sqrt(zx * zx + zy * zy + zz * zz) + 1e-12;
    const nx = (zx / sz) * sg;
    const ny = (zy / sz) * sg;
    const nz = (zz / sz) * sg;
    const lim = PPZ[k] * sz * sg;
    const ox = MI[mo + 12];
    const oy = MI[mo + 13];
    const oz = MI[mo + 14];
    const a = P0[k] + PNX[k];
    const b = P0[k] + PNX[k] * PNY[k];
    for (let p = a; p < b; p++) {
      const i = p * 3;
      const d = (pos[i] - ox) * nx + (pos[i + 1] - oy) * ny + (pos[i + 2] - oz) * nz - lim;
      if (d > 0) {
        pos[i] -= nx * d;
        pos[i + 1] -= ny * d;
        pos[i + 2] -= nz * d;
      }
    }
  }
}

/**
 * Dos réel : pour les pièces de dos, dans le repère de leur os, aucune particule libre devant la surface du dos moins la
 * marge ; au-delà, ramenée le long de l'axe avant de l'os (position seule, comme le plan qu'elle remplace).
 */
function dosReel() {
  for (let k = 0; k < NP; k++) {
    if (DOSR[k] === 0) continue;
    const mo = PF[k] * 16;
    const sx = Math.sqrt(MI[mo] * MI[mo] + MI[mo + 1] * MI[mo + 1] + MI[mo + 2] * MI[mo + 2]) + 1e-12;
    const sy = Math.sqrt(MI[mo + 4] * MI[mo + 4] + MI[mo + 5] * MI[mo + 5] + MI[mo + 6] * MI[mo + 6]) + 1e-12;
    const sz = Math.sqrt(MI[mo + 8] * MI[mo + 8] + MI[mo + 9] * MI[mo + 9] + MI[mo + 10] * MI[mo + 10]) + 1e-12;
    const ox = MI[mo + 12];
    const oy = MI[mo + 13];
    const oz = MI[mo + 14];
    QT[3] = HR[k];
    const a = P0[k] + PNX[k];
    const b = P0[k] + PNX[k] * PNY[k];
    for (let p = a; p < b; p++) {
      const i = p * 3;
      const px = pos[i] - ox;
      const py = pos[i + 1] - oy;
      const pz = pos[i + 2] - oz;
      QT[0] = (px * MI[mo] + py * MI[mo + 1] + pz * MI[mo + 2]) / (sx * sx);
      QT[1] = (px * MI[mo + 4] + py * MI[mo + 5] + pz * MI[mo + 6]) / (sy * sy);
      const zl = (px * MI[mo + 8] + py * MI[mo + 9] + pz * MI[mo + 10]) / (sz * sz);
      hauteurDos(surf, QT);
      const d = zl - QT[2] + DRT[0];
      if (d > 0) {
        const f = d / sz;
        pos[i] -= MI[mo + 8] * f;
        pos[i + 1] -= MI[mo + 9] * f;
        pos[i + 2] -= MI[mo + 10] * f;
      }
    }
  }
}

/**
 * Devant réel : pour le pan devant, dans le repère de son os (bassin), aucune particule libre DANS le torse ou la tête :
 * z ≥ devant du corps + marge (surface rangée en −z, lue par hauteurDos comme celle du dos) ; ramenée le long de l'axe
 * avant. Cases LIBRES (sous l'entrejambe, sur les jambes) : rien — les capsules des jambes tiennent le pan.
 */
function devantReel() {
  for (let k = 0; k < NP; k++) {
    if (DEVR[k] === 0) continue;
    const mo = PF[k] * 16;
    const sx = Math.sqrt(MI[mo] * MI[mo] + MI[mo + 1] * MI[mo + 1] + MI[mo + 2] * MI[mo + 2]) + 1e-12;
    const sy = Math.sqrt(MI[mo + 4] * MI[mo + 4] + MI[mo + 5] * MI[mo + 5] + MI[mo + 6] * MI[mo + 6]) + 1e-12;
    const sz = Math.sqrt(MI[mo + 8] * MI[mo + 8] + MI[mo + 9] * MI[mo + 9] + MI[mo + 10] * MI[mo + 10]) + 1e-12;
    const ox = MI[mo + 12];
    const oy = MI[mo + 13];
    const oz = MI[mo + 14];
    QT[3] = HR[k];
    const a = P0[k] + PNX[k];
    const b = P0[k] + PNX[k] * PNY[k];
    for (let p = a; p < b; p++) {
      const i = p * 3;
      const px = pos[i] - ox;
      const py = pos[i + 1] - oy;
      const pz = pos[i + 2] - oz;
      QT[0] = (px * MI[mo] + py * MI[mo + 1] + pz * MI[mo + 2]) / (sx * sx);
      QT[1] = (px * MI[mo + 4] + py * MI[mo + 5] + pz * MI[mo + 6]) / (sy * sy);
      const zl = (px * MI[mo + 8] + py * MI[mo + 9] + pz * MI[mo + 10]) / (sz * sz);
      hauteurDos(surfV, QT);
      const d = -zl - QT[2] + DRT[0]; // −z de la particule devant −z du corps (moins la marge) : dans le torse
      if (d > 0) {
        const f = d / sz;
        pos[i] += MI[mo + 8] * f;
        pos[i + 1] += MI[mo + 9] * f;
        pos[i + 2] += MI[mo + 10] * f;
      }
    }
  }
}

// jambes dans le repère d'un os (bassin ou buste) au sous-pas courant (entreJambes) : cuisse g, d, tibia g, d → a(3), b(3)
const JL = new Float64Array(24);
/**
 * Entre les jambes (pièces de dos, surface aux jambes libres) : une particule dont le x (repère du bassin) tombe entre les
 * axes des deux jambes, à une hauteur couverte par elles, reste derrière l'arrière de la jambe la plus en arrière à cette
 * hauteur (axe − rayon réel − marge) — le pan du dos ne passe jamais entre les jambes ni dans la zone du pan devant ;
 * jambes lues dans la pose COURANTE (capsules des cuisses et des tibias), pas figées au repos du modèle.
 */
function entreJambes() {
  if (!(capW[(NLOC + 2) * 7 + 6] > 0) || !(capW[(NLOC + 3) * 7 + 6] > 0)) return;
  for (let f = 0; f < 2; f++) {
    const mo = f * 16;
    const sx = Math.sqrt(MI[mo] * MI[mo] + MI[mo + 1] * MI[mo + 1] + MI[mo + 2] * MI[mo + 2]) + 1e-12;
    const sy = Math.sqrt(MI[mo + 4] * MI[mo + 4] + MI[mo + 5] * MI[mo + 5] + MI[mo + 6] * MI[mo + 6]) + 1e-12;
    const sz = Math.sqrt(MI[mo + 8] * MI[mo + 8] + MI[mo + 9] * MI[mo + 9] + MI[mo + 10] * MI[mo + 10]) + 1e-12;
    const ox = MI[mo + 12];
    const oy = MI[mo + 13];
    const oz = MI[mo + 14];
    for (let j = 0; j < 4; j++) {
      const o = (NLOC + 2 + j) * 7;
      for (let e = 0; e < 2; e++) {
        const px = capW[o + e * 3] - ox;
        const py = capW[o + e * 3 + 1] - oy;
        const pz = capW[o + e * 3 + 2] - oz;
        JL[j * 6 + e * 3] = (px * MI[mo] + py * MI[mo + 1] + pz * MI[mo + 2]) / (sx * sx);
        JL[j * 6 + e * 3 + 1] = (px * MI[mo + 4] + py * MI[mo + 5] + pz * MI[mo + 6]) / (sy * sy);
        JL[j * 6 + e * 3 + 2] = (px * MI[mo + 8] + py * MI[mo + 9] + pz * MI[mo + 10]) / (sz * sz);
      }
    }
    for (let k = 0; k < NP; k++) {
      if (DOSR[k] === 0 || PF[k] !== f) continue;
      const a = P0[k] + PNX[k];
      const b = P0[k] + PNX[k] * PNY[k];
      for (let p = a; p < b; p++) {
        const i = p * 3;
        const px = pos[i] - ox;
        const py = pos[i + 1] - oy;
        const pz = pos[i + 2] - oz;
        const x = (px * MI[mo] + py * MI[mo + 1] + pz * MI[mo + 2]) / (sx * sx);
        const y = (px * MI[mo + 4] + py * MI[mo + 5] + pz * MI[mo + 6]) / (sy * sy);
        const z = (px * MI[mo + 8] + py * MI[mo + 9] + pz * MI[mo + 10]) / (sz * sz);
        // jambe s (0 g, 1 d) à la hauteur y : cuisse au-dessus du genou, tibia en dessous ; hors des deux : rien
        KJ[0] = 0;
        for (let s = 0; s < 2; s++) {
          const c = y >= JL[s * 6 + 4] ? s : 2 + s; // b de la cuisse = genou
          const ay = JL[c * 6 + 1];
          const dyc = JL[c * 6 + 4] - ay;
          let u = (y - ay) / (Math.abs(dyc) > 1e-6 ? dyc : 1e-6);
          if (u < -0.05 || u > 1.05) continue;
          u = (Math.abs(u) - Math.abs(u - 1) + 1) * 0.5;
          const r = JRD[NLOC + 2 + c] > 0 ? JRD[NLOC + 2 + c] : RAYON_DYN[2 + c];
          KJ[1 + s] = JL[c * 6] + (JL[c * 6 + 3] - JL[c * 6]) * u; // x de l'axe
          KJ[3 + s] = JL[c * 6 + 2] + (JL[c * 6 + 5] - JL[c * 6 + 2]) * u - r; // arrière de la jambe
          KJ[0] += 1;
        }
        if (KJ[0] < 2) continue;
        const xmin = KJ[1] < KJ[2] ? KJ[1] : KJ[2];
        const xmax = KJ[1] < KJ[2] ? KJ[2] : KJ[1];
        if (x <= xmin || x >= xmax) continue;
        const d = z - (KJ[3] < KJ[4] ? KJ[3] : KJ[4]) + DRT[0];
        if (d > 0) {
          const g = d / sz;
          pos[i] -= MI[mo + 8] * g;
          pos[i + 1] -= MI[mo + 9] * g;
          pos[i + 2] -= MI[mo + 10] * g;
        }
      }
    }
  }
}
const KJ = new Float64Array(5); // jambes à la hauteur d'une particule : nombre, x des axes g, d, arrière g, d

// Butée du pan devant (2e revue du 22/11) : entreJambes ne borne rien quand une jambe ne couvre pas la hauteur de la
// particule (fente, cuisse levée presque à l'horizontale) et suit l'arrière des jambes quand elles passent toutes deux
// devant. Butée INDÉPENDANTE des jambes, dans le repère du BASSIN, pour toutes les pièces de dos : sous l'accroche du pan
// devant (y < haut.y) et dans son couloir élargi de la marge (|x| ≤ couloir + marge), z ≤ plan du pan devant − marge.
// BUT = [active (1/0), demi-largeur, z max, y max], tirée de la pièce « pan » de TISSUS (aucune valeur à part).
const PAN = PIECES.find((p) => p.couloir && p.plan && p.plan.signe < 0);
const BUT = new Float64Array(PAN ? [1, PAN.couloir + T.marge, PAN.plan.z - T.marge, PAN.haut[1]] : [0, 0, 0, 0]);
function butee() {
  if (BUT[0] === 0) return;
  const sx = Math.sqrt(MI[0] * MI[0] + MI[1] * MI[1] + MI[2] * MI[2]) + 1e-12;
  const sy = Math.sqrt(MI[4] * MI[4] + MI[5] * MI[5] + MI[6] * MI[6]) + 1e-12;
  const sz = Math.sqrt(MI[8] * MI[8] + MI[9] * MI[9] + MI[10] * MI[10]) + 1e-12;
  const ox = MI[12];
  const oy = MI[13];
  const oz = MI[14];
  for (let p = 0; p < N; p++) {
    if (invM[p] === 0 || DOSR[pieceOf[p]] === 0) continue;
    const i = p * 3;
    const px = pos[i] - ox;
    const py = pos[i + 1] - oy;
    const pz = pos[i + 2] - oz;
    const x = (px * MI[0] + py * MI[1] + pz * MI[2]) / (sx * sx);
    const y = (px * MI[4] + py * MI[5] + pz * MI[6]) / (sy * sy);
    if (y >= BUT[3] || x > BUT[1] || x < -BUT[1]) continue;
    const d = (px * MI[8] + py * MI[9] + pz * MI[10]) / (sz * sz) - BUT[2];
    if (d > 0) {
      const g = d / sz;
      pos[i] -= MI[8] * g;
      pos[i + 1] -= MI[9] * g;
      pos[i + 2] -= MI[10] * g;
    }
  }
}

function couloirs() {
  // couloir (pan devant) : |x| du repère de son os borné — il reste ENTRE les cuisses, jamais sur leur côté
  for (let k = 0; k < NP; k++) {
    const cw = PCO[k];
    if (cw === 0) continue;
    const mo = PF[k] * 16;
    const xx = MI[mo];
    const xy = MI[mo + 1];
    const xz = MI[mo + 2];
    const sx = Math.sqrt(xx * xx + xy * xy + xz * xz) + 1e-12;
    const nx = xx / sx;
    const ny = xy / sx;
    const nz = xz / sx;
    const lim = cw * sx;
    const ox = MI[mo + 12];
    const oy = MI[mo + 13];
    const oz = MI[mo + 14];
    const a = P0[k] + PNX[k];
    const b = P0[k] + PNX[k] * PNY[k];
    for (let p = a; p < b; p++) {
      const i = p * 3;
      const d = (pos[i] - ox) * nx + (pos[i + 1] - oy) * ny + (pos[i + 2] - oz) * nz;
      // (deux branches plutôt qu'un « ? : 0 » : un entier mêlé aux flottants ferait emballer la valeur, § V)
      if (d > lim) {
        const e = d - lim;
        pos[i] -= nx * e;
        pos[i + 1] -= ny * e;
        pos[i + 2] -= nz * e;
      } else if (d < -lim) {
        const e = d + lim;
        pos[i] -= nx * e;
        pos[i + 1] -= ny * e;
        pos[i + 2] -= nz * e;
      }
    }
  }
}

function capsules() {
  const mg = RG[0];
  // axes avant (z) des deux repères, normalisés : sens des poussées dirigées
  for (let f = 0; f < 2; f++) {
    const mo = f * 16;
    const zx = MI[mo + 8];
    const zy = MI[mo + 9];
    const zz = MI[mo + 10];
    const l = Math.sqrt(zx * zx + zy * zy + zz * zz) + 1e-12;
    FZ[f * 3] = zx / l;
    FZ[f * 3 + 1] = zy / l;
    FZ[f * 3 + 2] = zz / l;
  }
  for (let k = 0; k < NCAP; k++) {
    const o = k * 7;
    if (!(capW[o + 6] > 0)) continue;
    const ax = capW[o];
    const ay = capW[o + 1];
    const az = capW[o + 2];
    const bx = capW[o + 3] - ax;
    const by = capW[o + 4] - ay;
    const bz = capW[o + 5] - az;
    const bb = bx * bx + by * by + bz * bz + 1e-12;
    const bl = Math.sqrt(bb);
    const ux = bx / bl;
    const uy = by / bl;
    const uz = bz / bl;
    const rr = capW[o + 6] + mg;
    const r2 = rr * rr;
    // katana (vers l'arrière du buste) et jambes (vers l'avant du bassin) : collision « par-dessus » des pièces visées
    // (CAPDIR) ; une jambe presque dans l'axe avant (coup de pied tendu devant) reste radiale
    const fr = k === KCAP ? 1 : 0;
    const sgn = k === KCAP ? -1 : 1;
    const fux = FZ[fr * 3] * sgn;
    const fuy = FZ[fr * 3 + 1] * sgn;
    const fuz = FZ[fr * 3 + 2] * sgn;
    const par = (ux * fux + uy * fuy + uz * fuz) * (ux * fux + uy * fuy + uz * fuz);
    if (k === KCAP || (k >= NLOC + 2 && k < NLOC + 6 && JD[0] === 1 && par < 0.6)) {
      KS[0] = ax;
      KS[1] = ay;
      KS[2] = az;
      KS[3] = bx;
      KS[4] = by;
      KS[5] = bz;
      KS[6] = rr;
      KS[7] = fux;
      KS[8] = fuy;
      KS[9] = fuz;
      KS[10] = k === KCAP ? RG[5] : RG[4];
      KI[0] = k;
      dessus();
      continue;
    }
    for (let p = 0; p < N; p++) {
      if (invM[p] === 0) continue;
      if (k < NLOC && DOSR[pieceOf[p]] === 1) continue; // bassin et cape_dos : remplacés par le dos réel
      const i = p * 3;
      const px = pos[i] - ax;
      const py = pos[i + 1] - ay;
      const pz = pos[i + 2] - az;
      // borne [0, 1] SANS branche ni constante entière : (|x| − |x − 1| + 1) / 2. Un « Math.max(0, …) » ou un
      // « if (t < 0) t = … » laissait une valeur à deux origines que Chromium (Maglev) emballait : octets alloués, § V
      const t0 = (px * bx + py * by + pz * bz) / bb;
      const t = (Math.abs(t0) - Math.abs(t0 - 1) + 1) * 0.5;
      const dx = px - bx * t;
      const dy = py - by * t;
      const dz = pz - bz * t;
      const d2 = dx * dx + dy * dy + dz * dz;
      const jr = JRD[k] * DOSR[pieceOf[p]]; // pièce de dos sur une jambe mesurée : la vraie jambe + marge du dos réel
      const rq = jr > 0 ? jr + DRT[0] : rr;
      if (d2 < rq * rq) {
        const d = Math.sqrt(d2) + 1e-9;
        const f = (rq - d) / d;
        pos[i] += dx * f;
        pos[i + 1] += dy * f;
        pos[i + 2] += dz * f;
      }
    }
  }
}

function sol() {
  for (let p = 0; p < N; p++) {
    const i = p * 3 + 1;
    if (pos[i] < 0.02) {
      pos[i] = 0.02;
      prev[i - 1] += (pos[i - 1] - prev[i - 1]) * 0.5;
      prev[i + 1] += (pos[i + 1] - prev[i + 1]) * 0.5;
    }
  }
}

const KCAP = NLOC + 6; // capsule du katana du dos
const KS = new Float64Array(11); // a, b − a, rayon + marge, f (aucun flottant passé en argument, § V)
const KI = new Int32Array(1); // capsule traitée par dessus()
const JD = new Int8Array([PIECES.some((p) => p.devantJambes) ? 1 : 0]);
/**
 * Collision « par-dessus » le long de f (KS[7..9]) pour les pièces visées par CAPDIR[capsule KI[0]] : le pan du dos et
 * l'écharpe passent TOUJOURS par l'arrière du katana du dos (f = −z du buste), le pan devant TOUJOURS devant les cuisses
 * et les tibias (f = +z du bassin). Toute particule dont l'empreinte (vue le long de f) tombe sur la capsule est poussée
 * le long de f jusqu'à sa surface extérieure — même si elle était passée de l'autre côté (un fouet ou un coup de pied
 * déplace un point de plus que le diamètre du membre en un sous-pas) ; autour, une « tente » de TISSUS.tente m garde
 * aussi les voisines du bon côté (sinon une arête entre deux particules de part et d'autre passait sous le membre).
 * Bouts de la capsule et autres pièces : poussée radiale. Aucun argument (§ V) : KS, KI.
 */
function dessus() {
  const ax = KS[0];
  const ay = KS[1];
  const az = KS[2];
  const bx = KS[3];
  const by = KS[4];
  const bz = KS[5];
  const rr = KS[6];
  const fx = KS[7];
  const fy = KS[8];
  const fz = KS[9];
  const kc = KI[0] * NP;
  const W = KS[10];
  // axe projeté dans le plan perpendiculaire à f
  const bf = bx * fx + by * fy + bz * fz;
  const vx = bx - bf * fx;
  const vy = by - bf * fy;
  const vz = bz - bf * fz;
  const vv = vx * vx + vy * vy + vz * vz + 1e-12;
  const r2 = rr * rr;
  const rw = rr + W;
  const rw2 = rw * rw;
  for (let p = 0; p < N; p++) {
    if (invM[p] === 0) continue;
    const i = p * 3;
    const qx = pos[i] - ax;
    const qy = pos[i + 1] - ay;
    const qz = pos[i + 2] - az;
    const qf = qx * fx + qy * fy + qz * fz;
    if (CAPDIR[kc + pieceOf[p]] === 0) {
      const u0 = (qx * bx + qy * by + qz * bz) / (bx * bx + by * by + bz * bz + 1e-12);
      const u = (Math.abs(u0) - Math.abs(u0 - 1) + 1) * 0.5; // borne [0, 1] sans branche (voir capsules)
      const dx = qx - bx * u;
      const dy = qy - by * u;
      const dz = qz - bz * u;
      const d2 = dx * dx + dy * dy + dz * dz;
      // pièce de dos sur une jambe mesurée : la vraie jambe + la marge du dos réel
      const jr = JRD[KI[0]] * DOSR[pieceOf[p]];
      const rq = jr > 0 ? jr + DRT[0] : rr;
      if (d2 < rq * rq) {
        const d = Math.sqrt(d2) + 1e-9;
        const f = (rq - d) / d;
        pos[i] += dx * f;
        pos[i + 1] += dy * f;
        pos[i + 2] += dz * f;
      }
      continue;
    }
    // empreinte (vue le long de f : un « stade », bouts arrondis) : distance au segment projeté ; hauteur le long de f
    const t0 = ((qx - qf * fx) * vx + (qy - qf * fy) * vy + (qz - qf * fz) * vz) / vv;
    const t = (Math.abs(t0) - Math.abs(t0 - 1) + 1) * 0.5;
    const lx = qx - qf * fx - vx * t;
    const ly = qy - qf * fy - vy * t;
    const lz = qz - qf * fz - vz * t;
    const l2 = lx * lx + ly * ly + lz * lz;
    if (l2 >= rw2) continue;
    const l = Math.sqrt(l2);
    const tente = rr * (1 - l / rw);
    const dr = r2 - l2;
    const c = Math.sqrt((Math.abs(dr) + dr) * 0.5); // surface de la capsule (0 hors de son empreinte)
    const besoin = (tente + c + Math.abs(tente - c)) * 0.5 + bf * t; // la plus haute des deux, sans branche
    if (qf < besoin) {
      const e = besoin - qf;
      pos[i] += fx * e;
      pos[i + 1] += fy * e;
      pos[i + 2] += fz * e;
    }
  }
}

/** Capsules des membres (bras, jambes, katana) à l'instant S[ia] de l'image (0 : image précédente, 1 : courante). */
function capsDyn(ia) {
  const al = S[ia];
  for (let k = 0; k < NDYN; k++) {
    const o = k * 7;
    for (let j = 0; j < 6; j++) capW[NLOC * 7 + o + j] = capDyn0[o + j] + (capDyn1[o + j] - capDyn0[o + j]) * al;
    capW[NLOC * 7 + o + 6] = capDyn1[o + 6] > 0 ? RAYON_DYN[k] : 0;
  }
}

function sousPas() {
  interpoler(0);
  interpoler(1);
  // adhérence (dos réel, à l'arrêt) : le long de l'avant de chaque repère (axe z de MI normalisé)
  for (let f = 0; f < 2; f++) {
    const mo = f * 16;
    const l = Math.sqrt(MI[mo + 8] * MI[mo + 8] + MI[mo + 9] * MI[mo + 9] + MI[mo + 10] * MI[mo + 10]) + 1e-12;
    const g = (ADGT[0] * S[ADH]) / l;
    HV[f * 3] = MI[mo + 8] * g;
    HV[f * 3 + 1] = MI[mo + 9] * g;
    HV[f * 3 + 2] = MI[mo + 10] * g;
  }
  for (let k = 0; k < NLOC; k++) {
    const mo = capFrame[k] * 16;
    xf(MI, mo, capLocal, k * 7, capW, k * 7);
    xf(MI, mo, capLocal, k * 7 + 3, capW, k * 7 + 3);
    const sx = Math.sqrt(MI[mo] * MI[mo] + MI[mo + 1] * MI[mo + 1] + MI[mo + 2] * MI[mo + 2]);
    const sz = Math.sqrt(MI[mo + 8] * MI[mo + 8] + MI[mo + 9] * MI[mo + 9] + MI[mo + 10] * MI[mo + 10]);
    capW[k * 7 + 6] = capLocal[k * 7 + 6] * 0.5 * (sx + sz);
  }
  S[AMID] = S[ALPHA] - S[DALPHA] * 0.5;
  if (S[AMID] < 0) S[AMID] -= S[AMID];
  capsDyn(AMID); // membres à mi-chemin du sous-pas (passe de collision en plus : un coup de pied ne saute plus le tissu)
  const t = S[TIME];
  const w = RG[1];
  const keep = RG[2];
  const wf = RG[3];
  for (let p = 0; p < N; p++) {
    const i = p * 3;
    const k = pieceOf[p];
    if (invM[p] === 0) {
      xf(MI, PF[k] * 16, rest, i, pos, i);
      prev[i] = pos[i];
      prev[i + 1] = pos[i + 1];
      prev[i + 2] = pos[i + 2];
      continue;
    }
    const vx = (pos[i] - prev[i]) / H;
    const vy = (pos[i + 1] - prev[i + 1]) / H;
    const vz = (pos[i + 2] - prev[i + 2]) / H;
    const r = rowOf[p];
    const c = colOf[p];
    const so = PSO[k];
    const ph = 1.7 * k;
    const wx = so * (0.55 + 0.45 * Math.sin(w * t + 0.55 * r + ph)) * 0.8;
    const wz = so * 0.6 * Math.sin(1.63 * w * t + 0.9 * c + 0.3 * r + ph);
    const rx = vx - wx;
    const ry = vy;
    const rz = vz - wz;
    const nx = nrm[i];
    const ny = nrm[i + 1];
    const nz = nrm[i + 2];
    const vn = rx * nx + ry * ny + rz * nz;
    const kN = PKN[k];
    const kT = PKT[k];
    const tip = tipOf[p] === 1 ? 1.4 : 1;
    // flottement : en course et au dash, des ondes courent le long du tissu (pas une planche rigide dans le vent)
    const vit = Math.sqrt(rx * rx + ry * ry + rz * rz);
    const fl = PFL[k] * vit * Math.sin(wf * t - 1.15 * r + 0.8 * c + ph);
    const hv = PF[k] * 3;
    const gk = GK[k];
    const ax = (-kN * vn * nx - kT * rx) * tip + fl * nx + HV[hv] * gk;
    const ay = (-kN * vn * ny - kT * ry) * tip - PG[k] + fl * ny + HV[hv + 1] * gk;
    const az = (-kN * vn * nz - kT * rz) * tip + fl * nz + HV[hv + 2] * gk;
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    pos[i] = x + (x - prev[i]) * keep + ax * H2;
    pos[i + 1] = y + (y - prev[i + 1]) * keep + ay * H2;
    pos[i + 2] = z + (z - prev[i + 2]) * keep + az * H2;
    prev[i] = x;
    prev[i + 1] = y;
    prev[i + 2] = z;
  }
  collisions();
  capsDyn(ALPHA);
  for (let it = 0; it < T.iterations; it++) {
    for (let k = 0; k < nC; k++) {
      const a = cA[k] * 3;
      const b = cB[k] * 3;
      const wa = invM[cA[k]];
      const wb = invM[cB[k]];
      const ws = wa + wb;
      if (ws === 0) continue;
      const dx = pos[b] - pos[a];
      const dy = pos[b + 1] - pos[a + 1];
      const dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-9;
      const f = ((d - cL[k]) / (d * ws)) * cK[k];
      pos[a] += dx * f * wa;
      pos[a + 1] += dy * f * wa;
      pos[a + 2] += dz * f * wa;
      pos[b] -= dx * f * wb;
      pos[b + 1] -= dy * f * wb;
      pos[b + 2] -= dz * f * wb;
    }
    collisions();
  }
  normales();
  S[TIME] = t + H;
  S[TOTAL] += 1;
}

/**
 * Avance les tissus de entree[0] s simulées. Mb = matrice monde du buste À LA FIN de ce dt ; `bassin` écrit avant.
 */
export function update(Mb) {
  if (!st.pret) return;
  const dt = entree[0];
  M0.set(M1);
  for (let i = 0; i < 16; i++) {
    M1[i] = bassin[i];
    M1[16 + i] = Mb[i];
  }
  capDyn0.set(capDyn1);
  const jx = M1[28] - M0[28];
  const jz = M1[30] - M0[30];
  if (jx * jx + jz * jz > T.teleport * T.teleport) {
    reset(Mb);
    return;
  }
  S[STEPS] = 0;
  if (!(dt > 0)) return;
  // adhérence : 1 à l'arrêt, 0 dès dosReel.vitesse (vitesse horizontale du buste) ; tombe aussitôt, revient en tau s
  const v = Math.sqrt(jx * jx + jz * jz) / dt;
  const cible = 1 - v / DRT[2];
  const c0 = (Math.abs(cible) - Math.abs(cible - 1) + 1) * 0.5;
  if (c0 < S[ADH]) S[ADH] = c0;
  else S[ADH] += (c0 - S[ADH]) * (1 - Math.exp(-dt / DRT[3]));
  decompose(M0, 0, D0, 0);
  decompose(M0, 16, D0, 10);
  decompose(M1, 0, D1, 0);
  decompose(M1, 16, D1, 10);
  let acc = S[ACC];
  let tk = H - acc;
  let n = 0;
  while (tk <= dt + 1e-9 && n < T.maxSubsteps) {
    S[ALPHA] = tk / dt;
    S[DALPHA] = H / dt;
    sousPas();
    tk += H;
    n++;
  }
  acc = dt - (tk - H);
  if (acc < 0) acc = 0;
  if (acc >= H) acc = H * 0.999;
  S[ACC] = acc;
  S[STEPS] = n;
  // rangées accrochées : à la pose de FIN d'image (le dernier sous-pas tombe jusqu'à 1/hz avant : 4 cm de retard à la
  // course, le haut du pan devant entrait dans la cuisse) ; le sous-pas suivant les replace de toute façon
  for (let p = 0; p < N; p++) {
    if (invM[p] !== 0) continue;
    const i = p * 3;
    xf(M1, PF[pieceOf[p]] * 16, rest, i, pos, i);
  }
}

/** Écrit positions et normales lissées dans le maillage. */
export function sync() {
  if (!st.pret) return;
  mesh.visible = st.visible;
  if (!st.visible) return;
  const P = posAttr.array;
  const Nn = nrmAttr.array;
  for (let k = 0; k < NP; k++) {
    const nx = PNX[k];
    const ny = PNY[k];
    const tip = ny - 1;
    const o = P0[k];
    const v0 = V0[k];
    const f = LISF[k];
    // tissu : les colonnes du bord sont rentrées de la largeur du liseré
    for (let r = 0; r < tip; r++)
      for (let c = 0; c < nx; c++) {
        const s = (o + r * nx + c) * 3;
        const v = (v0 + r * nx + c) * 3;
        if (c === 0 || c === nx - 1) {
          const q = c === 0 ? s + 3 : s - 3;
          P[v] = pos[s] + (pos[q] - pos[s]) * f;
          P[v + 1] = pos[s + 1] + (pos[q + 1] - pos[s + 1]) * f;
          P[v + 2] = pos[s + 2] + (pos[q + 2] - pos[s + 2]) * f;
        } else {
          P[v] = pos[s];
          P[v + 1] = pos[s + 1];
          P[v + 2] = pos[s + 2];
        }
      }
    // creux entre deux pointes : remonte un peu au-dessus de la dernière rangée (la découpe se lit)
    const R = o + (tip - 1) * nx;
    for (let c = 0; c < nx - 1; c++) {
      const a = (R + c) * 3;
      const v = (VMID[k] + c) * 3;
      const ux = pos[a] + pos[a + 3] - pos[a - nx * 3] - pos[a - nx * 3 + 3];
      const uy = pos[a + 1] + pos[a + 4] - pos[a - nx * 3 + 1] - pos[a - nx * 3 + 4];
      const uz = pos[a + 2] + pos[a + 5] - pos[a - nx * 3 + 2] - pos[a - nx * 3 + 5];
      const kk = 0.5 - 0.18 * (c & 1 ? 1.3 : 0.8);
      P[v] = (pos[a] + pos[a + 3]) * 0.5 - ux * (0.5 - kk);
      P[v + 1] = (pos[a + 1] + pos[a + 4]) * 0.5 - uy * (0.5 - kk);
      P[v + 2] = (pos[a + 2] + pos[a + 5]) * 0.5 - uz * (0.5 - kk);
    }
    for (let c = 0; c < nx; c++) {
      const s = (o + tip * nx + c) * 3;
      const v = (VTIP[k] + c) * 3;
      P[v] = pos[s];
      P[v + 1] = pos[s + 1];
      P[v + 2] = pos[s + 2];
    }
    // liseré : bord extérieur = la particule du bord, bord intérieur = le sommet rentré du tissu
    for (let sd = 0; sd < 2; sd++) {
      const c = sd === 0 ? 0 : nx - 1;
      const L0 = VLIS[k] + sd * 2 * (ny - 1);
      for (let r = 0; r < tip; r++) {
        const s = (o + r * nx + c) * 3;
        const vo = (L0 + r * 2) * 3;
        const vi = vo + 3;
        const vt = (v0 + r * nx + c) * 3;
        P[vo] = pos[s];
        P[vo + 1] = pos[s + 1];
        P[vo + 2] = pos[s + 2];
        P[vi] = P[vt];
        P[vi + 1] = P[vt + 1];
        P[vi + 2] = P[vt + 2];
      }
    }
  }
  Nn.fill(0);
  for (let t = 0; t < nTris; t++) {
    const a = tris[t * 3] * 3;
    const b = tris[t * 3 + 1] * 3;
    const c = tris[t * 3 + 2] * 3;
    const ux = P[b] - P[a];
    const uy = P[b + 1] - P[a + 1];
    const uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a];
    const vy = P[c + 1] - P[a + 1];
    const vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    Nn[a] += nx;
    Nn[a + 1] += ny;
    Nn[a + 2] += nz;
    Nn[b] += nx;
    Nn[b + 1] += ny;
    Nn[b + 2] += nz;
    Nn[c] += nx;
    Nn[c + 1] += ny;
    Nn[c + 2] += nz;
  }
  for (let v = 0; v < NV; v++) {
    const o = v * 3;
    const l = Math.sqrt(Nn[o] * Nn[o] + Nn[o + 1] * Nn[o + 1] + Nn[o + 2] * Nn[o + 2]) + 1e-12;
    Nn[o] /= l;
    Nn[o + 1] /= l;
    Nn[o + 2] /= l;
  }
  posAttr.needsUpdate = true;
  nrmAttr.needsUpdate = true;
}

export function setVisible(v) {
  st.visible = !!v;
  if (mesh) mesh.visible = st.visible && st.pret;
}

/**
 * Agent sans tissus (Éclaireur, Bastion) : ni simulés ni dessinés. Le maillage sort de la scène et ses tampons du GPU
 * sont rendus (dispose) : changer d'agent ne laisse rien derrière ; init() le remet (three renvoie les tampons au GPU).
 */
export function couper() {
  st.pret = false;
  if (mesh) {
    mesh.visible = false;
    if (mesh.parent) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
  }
}

/** Positions des particules (copie). */
export function lirePositions(out) {
  out.set(pos);
  return out;
}

/** Disposition (tests) : par pièce, nom, 1re particule, colonnes, rangées. */
export const disposition = PIECES.map((p, k) => ({ nom: p.nom, p0: P0[k], cols: PNX[k], rows: PNY[k], os: p.os }));

// inspect (tests seulement) : positions des particules dans le repère de leur os à l'inspect précédent
const INS = new Float64Array(1);
const LOCP = new Float32Array(N * 3);
const mInv = new THREE.Matrix4();
const vIns = new THREE.Vector3();
export function inspect(out) {
  out.active = st.pret;
  out.creee = mesh !== null;
  out.visible = mesh !== null && mesh.visible;
  out.particules = N;
  out.contraintes = nC;
  out.triangles = nTris;
  out.sommets = NV;
  out.sousPas = S[STEPS];
  out.sousPasTotal = S[TOTAL];
  out.temps = S[TIME];
  out.katana = capDyn1[6 * 7 + 6] > 0;
  // hauteur moyenne des pointes de chaque tissu (m, monde)
  out.yPointes = PIECES.map((p, k) => {
    let y = 0;
    const o = P0[k] + (PNY[k] - 1) * PNX[k];
    for (let c = 0; c < PNX[k]; c++) y += pos[(o + c) * 3 + 1];
    return y / PNX[k];
  });
  // vitesse moyenne des pointes DANS le repère de leur os (m/s) depuis l'inspect précédent : le tissu réagit
  const dtI = S[TIME] - INS[0];
  INS[0] = S[TIME];
  out.vitessePointes = PIECES.map((p, k) => {
    mInv.fromArray(M1, PF[k] * 16).invert();
    let v = 0;
    const o = P0[k] + (PNY[k] - 1) * PNX[k];
    for (let c = 0; c < PNX[k]; c++) {
      const i = (o + c) * 3;
      vIns.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(mInv);
      const j = (o + c) * 3;
      if (dtI > 0) v += Math.hypot(vIns.x - LOCP[j], vIns.y - LOCP[j + 1], vIns.z - LOCP[j + 2]) / dtI;
      LOCP[j] = vIns.x;
      LOCP[j + 1] = vIns.y;
      LOCP[j + 2] = vIns.z;
    }
    return v / PNX[k];
  });
  // écart moyen des pointes à leur place de repos dans le repère de l'os (m) : le tissu réagit (course, dash, combos)
  const q = new Float32Array(3);
  out.ecartPointes = PIECES.map((p, k) => {
    let e = 0;
    const o = P0[k] + (PNY[k] - 1) * PNX[k];
    for (let c = 0; c < PNX[k]; c++) {
      const i = (o + c) * 3;
      xf(M1, PF[k] * 16, rest, i, q, 0);
      e += Math.hypot(pos[i] - q[0], pos[i + 1] - q[1], pos[i + 2] - q[2]);
    }
    return e / PNX[k];
  });
}
