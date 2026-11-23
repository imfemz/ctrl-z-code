// PLAN ADDICTIF, ÉTAPE 3, CHANTIER M : combos.js — les gestes d'attaque du Shinobi et du Bastion (ARCHITECTURE.md § E3.M).
// Retour de Femz du 15/11 (FEMZ_1511F) : « une animation stylé pour shinobi et ses coups de lame, comme un ninja avec des
// shake sur impact, psk la on dirait il a un blaster. pareil quand bastion pose ses tourelles. » ; combos validés à 20h40.
//
// Un COMBO (COMBOS.list, config.js) est une suite de gestes. L'arme DEMANDE un coup (requestF) au lieu de frapper ; le
// geste démarre (anticipation, taille, retour en garde) et c'est à l'image où la lame PASSE (impactAt) que l'arme lit
// impactF(c) === 1 et applique ses dégâts, multipliés par mul(c). juiceF(c, touches) donne l'impact : arrêt sur image,
// secousse (camera : nulle si le réglage de secousse est à 0 ; l'arrêt sur image aussi, § E3.M), son de la banque.
// Le corps du héros montre le DERNIER geste demandé (heros-anim lit `geste`, écrit ici à chaque update).
// Zéro allocation par image : tableaux typés créés au chargement ; aucun flottant passé en argument.
import { COMBO, COMBOS, GESTE } from '../config.js';
import { ARGF, F_V, F_X, F_Z, P, rand } from '../state.js';
import { SFX, TRAUMA } from '../config.js';
import { ANIM_AGENTS } from '../config.js'; // § E5.F : poses clés des gestes, course et poings du Bastion
import { geste as G, foulee as FOULEE, fouleeN as FOULEE_N } from './heros-anim.js';
//#region e5:AF-course-shinobi
import { courseNinja as NJ, NJ13 } from './heros-anim.js'; // § E5.AF.6 : un geste part de la pose ninja
//#endregion e5:AF-course-shinobi

const L = COMBOS.list;
// § E5.F : un combo de plus (poings du Bastion, poussé par la région e5:F-anim-agents) — taille lue sur la liste
const NC = L.length;
const COMBO_COUNT = NC;
const step = new Int32Array(NC); // geste courant (pendant le geste) ou prochain geste (au repos)
const actif = new Uint8Array(NC); // 1 = geste en cours
const fait = new Uint8Array(NC); // 1 = l'impact du geste en cours est passé
const impact = new Uint8Array(NC); // 1 = impact à lire par l'arme (consommé par impactF)
const T = new Float64Array(NC); // s depuis le début du geste
const REPOS = new Float64Array(NC).fill(1e3); // s depuis la fin du dernier geste
const DIR = new Float64Array(NC * 2); // direction du coup (x, z), posée par l'arme avant requestF
/** Direction du prochain coup : l'arme écrit D[0], D[1] (unitaire, monde) avant requestF. */
export const D = new Float64Array(2);
let dernier = -1; // combo qui anime le corps
let clock = 0; // s de simulation (horodatage des mesures)
let camera = null;
let fx = null;
let audio = null;
let world = null;
// 16/11 (point 10) : fente RÉELLE vers la cible pendant l'anticipation (le héros avance, la zone de touche suit) —
// [0] part de la fente déjà faite (0 → 1) du geste en cours, par combo ; sortie de world.resolve
const FENTE = new Float64Array(COMBO_COUNT);
const RES = new Float32Array(2);
const FN = new Float64Array(1); // relevé (tests) : mètres parcourus en fentes depuis le reset
let fentesOn = 1; // tests de géométrie des armes (e3-N) : 0 = gestes sans fente réelle
/** Tests seulement : fentes réelles actives (1, défaut) ou coupées (0) — mesure de portée/arc à héros immobile. */
export function debugFentes(on) {
  fentesOn = on ? 1 : 0;
  return fentesOn;
}

// journal des 32 derniers gestes (tests) : combo, geste, horloge de la demande, horloge de l'impact, arrêt, secousse, touches
const JN = 32;
const jC = new Int8Array(JN);
const jG = new Int8Array(JN);
const jReq = new Float64Array(JN);
const jImp = new Float64Array(JN).fill(-1);
const jHs = new Float64Array(JN);
const jTr = new Float64Array(JN);
const jHits = new Int32Array(JN);
const jIdx = new Int32Array(NC).fill(-1); // entrée du journal du geste en cours, par combo
let jN = 0;

export function init(ctx) {
  camera = ctx.camera || null;
  fx = ctx.fx || null;
  audio = ctx.audio || null;
  world = ctx.world || null;
  reset();
}

export function reset() {
  step.fill(0);
  actif.fill(0);
  fait.fill(0);
  impact.fill(0);
  T.fill(0);
  REPOS.fill(1e3);
  G.fill(0);
  OUT.fill(0);
  SON.fill(0);
  FOUL_VU[0] = FOULEE_N[0];
  dernier = -1;
  jN = 0;
  jIdx.fill(-1);
  jImp.fill(-1);
  NLAND[0] = 0;
  FENTE.fill(0);
  FN[0] = 0;
  KM[0] = 0; // § E5.F.13
  KATANA_EV[0] = -1;
}

// ----- § E5.F.13 : katana EN MAIN (demande de Femz du 17/11 au soir) --------------------------------------------------
// Le combo du katana se joue lame en main : la main droite saisit la poignée (au-dessus de l'épaule droite, katana du
// dos) à la fin de l'armé du 1er coup lourd, les deux coups lourds et le dégainé (traversée) se font katana en main,
// puis le rengainé lent le remet dans le dos. Événements lus par armes-heros.sync (KATANA_EN_MAIN) : +1 saisie, −1
// rengainé (0 : rien de neuf) — un module d'animation ne dépend pas de armes-heros (pas d'import circulaire).
export const KATANA_EV = new Int8Array(1);
const KM = new Uint8Array(1); // 1 = katana en main (état tenu ici)
const KC = COMBO.KATANA;
const KT = new Float64Array([ANIM_AGENTS.katanaMain ? ANIM_AGENTS.katanaMain.saisie : 1, ANIM_AGENTS.katanaMain ? ANIM_AGENTS.katanaMain.rengaine : 0.85, ANIM_AGENTS.katanaMain ? ANIM_AGENTS.katanaMain.repos : 0.6]);
function katanaMain() {
  const C = L[KC];
  if (actif[KC] === 1) {
    const s = step[KC];
    const g = C.geste[s];
    const t = T[KC];
    const ti = C.impactAt[s] > 0 ? C.impactAt[s] : C.dur[s] * 0.3;
    if (KM[0] === 0 && s < C.geste.length - 1 && t >= ti * GT[g * 6] * KT[0]) {
      KM[0] = 1; // la main est à la poignée (fin de l'armé, × saisie) : le katana passe du dos à la main
      KATANA_EV[0] = 1;
    } else if (KM[0] === 1 && s === C.geste.length - 1) {
      // dernier geste (dégainé) : rengainé — la lame rentre dans le dos à la fraction KT[1] du retour
      const th = ti + (C.dur[s] - ti) * GT[g * 6 + 3];
      if (t >= th + (C.dur[s] - th) * KT[1]) {
        KM[0] = 0;
        KATANA_EV[0] = -1;
      }
    }
  } else if (KM[0] === 1 && REPOS[KC] > KT[2]) {
    KM[0] = 0; // combo interrompu (plus de cible, dash) : il rengaine
    KATANA_EV[0] = -1;
  }
}
/** Combo qui anime le corps (−1 : aucun) — § E5.F.14 : poignet du marteau (armes-heros). */
export function dernierCombo() {
  return dernier;
}
/** Tests : 1 = katana en main d'après le combo. */
export function katanaEnMain() {
  return KM[0];
}

/** Le combo c repart du 1er geste (arme retirée : debug, tests). */
export function resetCombo(c) {
  if (c === KC && KM[0] === 1) {
    KM[0] = 0; // § E5.F.13 : l'arme retirée, le katana rentre dans le dos
    KATANA_EV[0] = -1;
  }
  step[c] = 0;
  actif[c] = 0;
  fait[c] = 0;
  impact[c] = 0;
  T[c] = 0;
  REPOS[c] = 1e3;
  if (dernier === c) {
    dernier = -1;
    G[0] = 0;
  }
}

/** 1 si un geste du combo c est en cours (l'arme attend qu'il finisse avant d'en demander un autre). */
export function busy(c) {
  return actif[c];
}

/** L'arme demande un coup (direction dans D). 1 = le geste démarre ; 0 = un geste est déjà en cours. */
export function requestF(c) {
  if (actif[c] === 1) return 0;
  const C = L[c];
  if (REPOS[c] > COMBOS.pauseReset) step[c] = 0; // courte pause sans cible : le combo reprend au 1er coup
  actif[c] = 1;
  fait[c] = 0;
  impact[c] = 0;
  T[c] = 0;
  FENTE[c] = 0;
  SON[c] = 0;
  DIR[c * 2] = D[0];
  DIR[c * 2 + 1] = D[1];
  departF(c); // § E5.F : pose de départ (la pose affichée, ou la garde) et pas du pied avant
  dernier = c;
  const j = jN % JN;
  jC[j] = c;
  jG[j] = C.geste[step[c]];
  jReq[j] = clock;
  jImp[j] = -1;
  jHs[j] = 0;
  jTr[j] = 0;
  jHits[j] = 0;
  jIdx[c] = j;
  jN++;
  if (C.impactAt[step[c]] <= 0) {
    // geste dont l'impact est immédiat (frappe éclair : l'arme a déjà frappé) — pas d'attente
    fait[c] = 1;
    jImp[j] = clock;
  }
  return 1;
}

/** 1 à l'image de l'impact du combo c (une seule fois par geste), sinon 0. */
export function impactF(c) {
  if (impact[c] === 0) return 0;
  impact[c] = 0;
  return 1;
}

/** Geste en cours (ou à venir) du combo c, de 0 à steps − 1. */
export function stepOf(c) {
  return step[c];
}
/** Type de geste (GESTE.*) en cours du combo c. */
export function gesteOf(c) {
  return L[c].geste[step[c]];
}
/** Multiplicateur de dégâts du geste en cours. */
export function mul(c) {
  return L[c].mul[step[c]];
}
/** Arc du geste en cours (degrés ; 0 = l'arc de l'arme). */
export function arcDeg(c) {
  return L[c].arcDeg[step[c]];
}
/** Direction du geste en cours : x (k = 0) ou z (k = 1). */
export function dir(c, k) {
  return DIR[c * 2 + k];
}

const XZ = new Float64Array(2); // position de l'impact (ARGF des autres modules évité : simple lecture de P)
/**
 * Impact du geste en cours du combo c : `touches` robots touchés. Son du geste toujours (le fil de la lame siffle) ;
 * arrêt sur image et secousse seulement au contact (touches > 0), dosés par le réglage de secousse (nuls à 0).
 */
export function juiceF(c, touches) {
  const C = L[c];
  const s = step[c];
  const j = jIdx[c];
  XZ[0] = P.x;
  XZ[1] = P.z;
  // § E5.G : au contact (touches > 0), le coup (sfxTouche) ; son du geste (sfx) seulement s'il n'est pas joué avant
  // (sfxAvance) et que le geste ne touche pas — ou toujours si sfxMelange[s] === 1
  const tc = touches > 0 && C.sfxTouche !== undefined ? C.sfxTouche[s] : -1;
  if (audio !== null && tc >= 0) audio.play(tc, XZ[0], XZ[1]);
  if (audio !== null && C.sfx[s] >= 0 && !(C.sfxAvance > 0) && (tc < 0 || (C.sfxMelange !== undefined && C.sfxMelange[s] === 1))) audio.play(C.sfx[s], XZ[0], XZ[1]); // § E5.F : sfxAvance = joué avant
  if (j >= 0) jHits[j] = touches;
  if (!(touches > 0)) return;
  const k = camera !== null ? camera.getShakeIntensity() : 1;
  if (!(k > 0)) return; // réglage de secousse à 0 : ni secousse, ni arrêt sur image
  const hs = C.hitstop[s];
  const tr = C.trauma[s];
  if (hs > 0 && fx !== null) fx.hitstop(hs);
  if (tr > 0 && camera !== null) camera.addTraumaAt(tr, tr >= COMBOS.traumaFort ? COMBOS.traumaSource[1] : COMBOS.traumaSource[0], XZ[0], XZ[1]);
  if (j >= 0) {
    jHs[j] = hs;
    jTr[j] = tr;
  }
}

/** Une fois par image (temps simulé : figé pendant un arrêt sur image), AVANT que les armes lisent impactF. */
export function update(dt) {
  if (!(dt >= 0)) return;
  clock += dt;
  for (let c = 0; c < NC; c++) {
    if (actif[c] === 0) {
      REPOS[c] += dt;
      continue;
    }
    const C = L[c];
    const s = step[c];
    T[c] += dt;
    // § E5.F : son en avance sur l'impact (souffle puis choc sur l'image de l'impact)
    if (SON[c] === 0 && C.sfxAvance > 0 && T[c] >= C.impactAt[s] - C.sfxAvance) {
      SON[c] = 1;
      if (audio !== null && C.sfx[s] >= 0) audio.play(C.sfx[s], P.x, P.z);
    }
    // fente réelle (16/11, point 10) : le héros glisse de C.fente[s] m vers la cible entre le début du geste et
    // l'impact (courbe douce) ; jamais dans un obstacle ni hors de l'arène
    const fe = C.fente ? C.fente[s] : 0;
    if (fe > 0 && fentesOn === 1 && FENTE[c] < 1 && world !== null && P.alive) {
      const ti = C.impactAt[s] > 0 ? C.impactAt[s] : C.dur[s] * 0.3;
      const u = lisse(T[c] / ti);
      const du = u - FENTE[c];
      if (du > 0) {
        FENTE[c] = u;
        const m = fe * du;
        world.resolve(P.x + DIR[c * 2] * m, P.z + DIR[c * 2 + 1] * m, P.radius, RES);
        FN[0] += Math.abs(RES[0] - P.x) + Math.abs(RES[1] - P.z);
        P.x = RES[0];
        P.z = RES[1];
      }
    }
    if (fait[c] === 0 && T[c] >= C.impactAt[s]) {
      fait[c] = 1;
      impact[c] = 1;
      const j = jIdx[c];
      if (j >= 0) jImp[j] = clock;
    }
    if (T[c] >= C.dur[s]) {
      if (fait[c] === 0) impact[c] = 1; // garde : un geste ne finit jamais sans son impact
      actif[c] = 0;
      REPOS[c] = 0;
      step[c] = s + 1 < C.geste.length ? s + 1 : 0;
    }
  }
  if (AA_ON === 1) poseNeuve();
  else pose();
  poussiere();
  katanaMain(); // § E5.F.13
}

// ----- pose transmise à heros-anim (geste[]) ------------------------------------------------------------------------
// geste : [0 poids, 1 bras (0 droit, 1 gauche, 2 les deux), 2 lacet du bras (repère du buste), 3 levée du bras (rad, 0 =
// pendant, π/2 = horizontal), 4 torsion du buste en plus, 5 vrille (tour du corps entier, rad), 6 avance (m), 7 accroupi
// (m), 8 lacet monde du coup, 9 coude (rad, plié > 0)]
function lisse(u) {
  return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
}
function pose() {
  const c = dernier;
  if (c < 0 || actif[c] === 0) {
    G[0] = 0;
    return;
  }
  const C = L[c];
  const s = step[c];
  const g = C.geste[s];
  const dur = C.dur[s];
  const ti = C.impactAt[s] > 0 ? C.impactAt[s] : dur * 0.3;
  const t = T[c];
  const PO = COMBOS.pose;
  // phases : anticipation [0, a], taille [a, b] (la lame passe dans l'axe à ti), retour en garde [b, dur]
  const a = ti * 0.55;
  const b = ti + (ti - a);
  let w = 1;
  if (t > b) w = 1 - lisse((t - b) / (dur - b)); // retour en garde : le geste se fond dans la marche / visée
  else if (t < a * 0.5) w = lisse(t / (a * 0.5 + 1e-6));
  // avancement de la taille : −1 (armé) → 0 (à l'image de l'impact) → +1 (fin de la taille)
  let v;
  if (t < a) v = -lisse(t / a);
  else if (t < b) v = -1 + 2 * ((t - a) / (b - a));
  else v = 1;
  G[0] = w;
  G[8] = Math.atan2(DIR[c * 2], DIR[c * 2 + 1]);
  G[5] = 0;
  G[6] = 0;
  G[7] = 0;
  G[9] = 0.15;
  const av = C.avance[s];
  if (av > 0) G[6] = av * lisse(t / (ti + 1e-6)); // pas glissé vers la cible, tenu jusqu'au retour
  if (g === GESTE.TAILLE_G || g === GESTE.TAILLE_D) {
    // taille vive : le bras balaie d'un côté à l'autre, le buste l'accompagne
    const sens = g === GESTE.TAILLE_G ? 1 : -1;
    G[1] = g === GESTE.TAILLE_G ? 1 : 0;
    G[2] = sens * PO.bras * v;
    G[3] = 1.35;
    G[4] = sens * PO.torsion * v;
    G[7] = PO.accroupi * 0.5;
  } else if (g === GESTE.VRILLE) {
    // vrille : bras écartés, le corps fait un tour complet ; la lame passe devant la cible à mi-tour
    G[1] = 2;
    G[2] = 0;
    G[3] = 1.5;
    G[4] = 0;
    const u = t < a ? 0 : t < b ? (t - a) / (b - a) : 1;
    G[5] = 2 * Math.PI * lisse(u);
    // 16/11 (point 10) : vrille EN L'AIR — appuis bas à l'armé, puis le corps décolle pendant le tour (accroupi < 0 = monte)
    G[7] = t < a ? PO.accroupi * 1.4 * lisse(t / a) : -PO.saut * Math.sin(Math.PI * lisse(u));
  } else if (g === GESTE.LOURD || g === GESTE.REVERS) {
    // taille lourde à deux mains (bras droit + gauche ensemble), revers dans l'autre sens
    const sens = g === GESTE.LOURD ? -1 : 1;
    G[1] = 2;
    G[2] = sens * PO.brasLourd * v;
    G[3] = 1.4;
    G[4] = sens * PO.torsionLourd * v;
    G[7] = PO.accroupi;
  } else if (g === GESTE.IAIDO) {
    // dégainé éclair : il rengaine (main à la hanche, accroupi), puis traverse d'un trait, lame tendue derrière lui
    G[1] = 0;
    if (t < a) {
      G[2] = 0.9 * lisse(t / a);
      G[3] = 0.35;
      G[4] = 0.5 * lisse(t / a);
      G[7] = PO.accroupi * 1.6 * lisse(t / a);
      G[9] = 1.2;
    } else {
      const u = lisse((t - a) / (b - a));
      G[2] = 0.9 - 2.3 * u;
      G[3] = 0.35 + 1.15 * u;
      G[4] = 0.5 - 1.1 * u;
      G[7] = PO.accroupi * 1.6 * (1 - u);
      G[9] = 1.2 * (1 - u);
    }
  } else if (g === GESTE.SOL) {
    // frappe au sol : bras droit levé au-dessus de la tête, puis abattu ; accroupi à l'impact
    G[1] = 0;
    G[2] = 0;
    G[3] = t < a ? 0.4 + 2.4 * lisse(t / a) : 2.8 - 2.3 * lisse((t - a) / (b - a));
    G[4] = 0;
    G[7] = t < a ? 0 : PO.accroupi * 2 * lisse((t - a) / (b - a));
  } else if (g === GESTE.POSE) {
    // pose de tourelle : il plonge la main vers la ceinture, puis lance vers l'avant-bas
    G[1] = 0;
    G[2] = -0.4;
    G[3] = t < a ? 0.2 : 0.2 + 1.0 * lisse((t - a) / (b - a));
    G[4] = -0.3 * (t < a ? lisse(t / a) : 1 - lisse((t - a) / (b - a)));
    G[7] = PO.accroupi * 1.2 * (t < b ? lisse(t / b) : 1);
    G[9] = 0.5;
  } else {
    // frappe éclair : arrivée, lame du bras droit tendue derrière lui (la ligne est déjà tranchée)
    G[1] = 0;
    G[2] = -1.2;
    G[3] = 1.3;
    G[4] = -0.5;
    G[7] = PO.accroupi * 1.4 * (1 - lisse(t / dur));
  }
}

// ----- § E5.F : POSES CLÉS (retour de Femz du 17/11 : « ça manque d'énergie ») ------------------------------------------
// Un geste = armé A (atteint vite, courbe qui freine), tenue éventuelle (dégainé : temps d'arrêt), frappe vers I
// (courbe qui ACCÉLÈRE : la lame est à pleine vitesse à l'image de l'impact), fin de geste F (courbe « back » : elle
// dépasse puis revient), tenue éventuelle, retour vers R (ou la garde). Entre deux coups d'un combo la pose part de la
// pose affichée (OUT) : aucun retour mou à la marche entre les coups ; après le dernier, la garde est tenue puis fondue.
// Sorties dans G (heros-anim) : mode 4 = bras indépendants en vrai arc (φ, λ), buste penché / roulis, bassin, vol,
// tête, pas du pied avant. Zéro allocation : poses copiées dans des tableaux typés au chargement.
const SH = ANIM_AGENTS.shinobi;
const AA_ON = ANIM_AGENTS.actif ? 1 : 0;
const NP = 13; // valeurs d'une pose (config.js, région e5:F-anim-agents)
const NG = 16; // types de gestes couverts (GESTE.* et GESTE_POING.*)
const GDEF = new Uint8Array(NG); // 1 = geste reposé ici (sinon : l'ancien dessin du § E3.M)
const GA = new Float64Array(NG * NP);
const GI = new Float64Array(NG * NP);
const GF = new Float64Array(NG * NP);
const GR = new Float64Array(NG * NP); // retour (R, sinon la garde)
const GGA = new Float64Array(NG * NP); // garde de départ (sortie de la marche)
const GT = new Float64Array(NG * 6); // aFrac, sFrac, fFrac, hFrac, vrille (0/1), pied du pas (0, 1 g, 2 d)
for (let g = 0; g < NG; g++) {
  const d = SH.gestes[g];
  if (!d) continue;
  GDEF[g] = 1;
  const ga = d.garde || SH.garde;
  for (let k = 0; k < NP; k++) {
    GA[g * NP + k] = d.A[k];
    GI[g * NP + k] = d.I[k];
    GF[g * NP + k] = d.F[k];
    GR[g * NP + k] = (d.R || ga)[k];
    GGA[g * NP + k] = ga[k];
  }
  GT[g * 6] = d.aFrac || SH.armeFrac;
  GT[g * 6 + 1] = d.sFrac || GT[g * 6];
  GT[g * 6 + 2] = d.fFrac || 0.55;
  GT[g * 6 + 3] = d.hFrac || GT[g * 6 + 2];
  GT[g * 6 + 4] = d.vrille ? 1 : 0;
  GT[g * 6 + 5] = d.pas || 0;
}
const ZU = new Float64Array([0, 1]);
const OUT = new Float64Array(NP); // pose affichée à la dernière image
const START = new Float64Array(NP); // pose au début du geste en cours
const SON = new Uint8Array(NC); // son du geste en cours déjà joué (sfxAvance)
const OUTW = new Float64Array(1); // poids affiché à la dernière image
const FOUL_VU = new Int32Array(1); // dernier appui du Bastion déjà poussiéré
const SH_F = new Float64Array([SH.depasse, SH.gardeTenue, SH.gardeFondu, SH.saut, SH.pas.longueur, 0, 0.05]); // [6] durée minimale d'un pas
const CB_B = ANIM_AGENTS.bastion.course;

function departF(c) {
  const g = L[c].geste[step[c]];
  if (AA_ON === 0 || g >= NG || GDEF[g] === 0) return;
  // pose de départ : celle qu'on voit (enchaînement), ou la garde du geste si le corps était à la marche
  const vu = OUTW[0] > 0.5 && dernier >= 0 && G[1] === 4;
  for (let k = 0; k < NP; k++) START[k] = vu ? OUT[k] : GGA[g * NP + k];
  //#region e5:AF-course-shinobi
  // § E5.AF.6 : sorti de la course ninja, le geste part de la pose ninja (mêlée à la garde par le poids w) — l'armé balaie
  // les bras de derrière vers devant au lieu d'un saut d'une image vers la garde
  if (!vu && NJ[2] > 0) for (let k = 0; k < NP; k++) START[k] += (NJ13[k] - START[k]) * NJ[2];
  //#endregion e5:AF-course-shinobi
  // pas du pied avant (fente) : le pied du côté du coup avance jusqu'à l'impact (heros-anim : recentrer)
  const pied = GT[g * 6 + 5];
  if (pied > 0) {
    const C = L[c];
    G[20] = pied;
    G[21] = C.fente[step[c]] + SH_F[4]; // fente : posée pour chaque combo (config, régions e3:Z et e5:F)
    G[22] = C.impactAt[step[c]];
    if (G[22] < SH_F[6]) G[22] = SH_F[6];
    G[23] += 1;
  }
}

// § V : aucun flottant passé en argument ni rendu (emballé par V8) — facteur de mélange dans EM[0]
const EM = new Float64Array(1);

/** OUT = mélange de deux poses (tableaux typés, décalages a et b) par e. */
function melange(X, a, Y, b) {
  const e = EM[0];
  for (let k = 0; k < NP; k++) OUT[k] = X[a + k] + (Y[b + k] - X[a + k]) * e;
}

function poseNeuve() {
  const c = dernier;
  if (c < 0) {
    G[0] = 0;
    OUTW[0] = 0;
    return;
  }
  const C = L[c];
  // constantes flottantes lues dans un tableau typé (§ V : une locale tantôt entière tantôt flottante est emballée)
  let w = ZU[1];
  let h = ZU[0]; // hauteur du vol (m)
  let air = ZU[0];
  let vr = ZU[0]; // tour de la vrille (rad)
  if (actif[c] === 1) {
    const s = step[c];
    const g = C.geste[s];
    if (g >= NG || GDEF[g] === 0) {
      for (let k = 10; k < 20; k++) G[k] = 0;
      OUTW[0] = 0;
      pose(); // gestes du Bastion (marteau, pose) et frappe éclair : le dessin du § E3.M
      return;
    }
    const dur = C.dur[s];
    const ti = C.impactAt[s] > 0 ? C.impactAt[s] : dur * 0.3;
    const o = g * 6;
    const ta = ti * GT[o];
    const ts = ti * GT[o + 1] > ta ? ti * GT[o + 1] : ta;
    const tf = ti + (dur - ti) * GT[o + 2];
    const th = ti + (dur - ti) * GT[o + 3] > tf ? ti + (dur - ti) * GT[o + 3] : tf;
    const t = T[c];
    const b = g * NP;
    if (t < ta) {
      const u = 1 - t / ta;
      EM[0] = 1 - u * u * u;
      melange(START, 0, GA, b); // arrive vite et freine : anticipation franche
    } else if (t < ts) {
      EM[0] = ZU[0];
      melange(GA, b, GA, b); // temps d'arrêt (dégainé) : tension, le corps descend encore un peu
      OUT[9] += 0.03 * ((t - ta) / (ts - ta));
    } else if (t < ti) {
      const u = (t - ts) / (ti - ts);
      EM[0] = u * u;
      melange(GA, b, GI, b); // frappe : accélère jusqu'à l'impact
    } else if (t < tf) {
      // courbe « back » : dépasse F puis revient (SH_F[0] = force du dépassement)
      const v = (t - ti) / (tf - ti) - 1;
      EM[0] = 1 + (SH_F[0] + 1) * v * v * v + SH_F[0] * v * v;
      melange(GI, b, GF, b); // fin de geste : dépasse puis revient
    } else if (t < th) {
      EM[0] = ZU[0];
      melange(GF, b, GF, b);
    } else {
      const u = (t - th) / (dur - th);
      EM[0] = u * u * (3 - 2 * u);
      melange(GF, b, GR, b); // retour en garde (dégainé : rengainé lent)
    }
    if (GT[o + 4] === 1) {
      // vrille : décolle après l'armé, un tour entier en l'air, se reçoit à la fin du geste
      let u = (t - ta) / (tf - ta);
      u = u < 0 ? ZU[0] : u > 1 ? ZU[1] : u;
      air = Math.sin(Math.PI * u);
      h = SH_F[3] * air;
      vr = 2 * Math.PI * (u * u * (3 - 2 * u));
    }
  } else {
    // garde tenue après le dernier coup, puis fondu vers la marche / la visée
    const r = REPOS[c];
    if (r >= SH_F[1] + SH_F[2] || G[1] !== 4) {
      G[0] = 0;
      OUTW[0] = 0;
      return;
    }
    if (r > SH_F[1]) {
      const u = (r - SH_F[1]) / SH_F[2];
      w = 1 - u * u * (3 - 2 * u);
    }
  }
  OUTW[0] = w;
  G[0] = w;
  G[1] = 4;
  G[2] = 0;
  G[3] = 0;
  G[4] = OUT[6];
  G[5] = OUT[10] + vr;
  G[6] = OUT[12];
  G[7] = OUT[9] - h;
  G[8] = Math.atan2(DIR[c * 2], DIR[c * 2 + 1]);
  G[9] = 0;
  G[10] = OUT[7];
  G[11] = OUT[8];
  G[12] = air;
  G[13] = OUT[11];
  G[14] = OUT[0];
  G[15] = OUT[1];
  G[16] = OUT[2];
  G[17] = OUT[3];
  G[18] = OUT[4];
  G[19] = OUT[5];
}

/** § E5.F : poussière à chaque appui de la course du Bastion (heros-anim compte les appuis). Pool des étincelles. */
function poussiere() {
  if (FOULEE_N[0] === FOUL_VU[0]) return;
  FOUL_VU[0] = FOULEE_N[0];
  if (fx === null || !(CB_B.poussiere > 0)) return;
  for (let k = 0; k < CB_B.poussiere; k++) {
    const a = ((k + FOUL_VU[0] * 0.37) * 2 * Math.PI) / CB_B.poussiere; // sans rand() (un flottant rendu est emballé)
    ARGF[F_X] = FOULEE[1] + Math.cos(a) * 0.12;
    ARGF[F_V] = 0.08;
    ARGF[F_Z] = FOULEE[2] + Math.sin(a) * 0.12;
    fx.spawnPuffF(CB_B.poussiereCouleur);
  }
  if (CB_B.secousse > 0 && camera !== null && camera.getShakeIntensity() > 0) camera.addTraumaAt(CB_B.secousse, TRAUMA.FIRE, FOULEE[1], FOULEE[2]);
}

// ----- pose d'une tourelle (sentinelle, grosse tourelle) ----------------------------------------------------------------
/** Point d'atterrissage d'une tourelle : l'arme écrit PL[0] = x, PL[1] = z avant landF. */
export const PL = new Float64Array(2);
const NLAND = new Int32Array(1);
/** La tourelle touche le sol en PL : secousse au sol, couronne de poussière, son « plantée ». */
export function landF() {
  const DP = COMBOS.deploy;
  NLAND[0]++;
  for (let k = 0; k < DP.puffs; k++) {
    const a = ((k + rand() * 0.5) * 2 * Math.PI) / DP.puffs;
    ARGF[F_X] = PL[0] + Math.cos(a) * DP.ring * 0.5;
    ARGF[F_V] = 0.15;
    ARGF[F_Z] = PL[1] + Math.sin(a) * DP.ring * 0.5;
    if (fx !== null) fx.spawnPuffF(DP.puffColor);
  }
  if (audio !== null) audio.play(SFX.TURRET_PLANT, PL[0], PL[1]);
  if (camera !== null && camera.getShakeIntensity() > 0) camera.addTraumaAt(DP.trauma, TRAUMA.FIRE, PL[0], PL[1]);
}
/** Déploiement après l'atterrissage (0 → 1 en COMBOS.deploy.unfold s) : entrée DEPLOI[2] = s depuis l'atterrissage ;
 *  sorties DEPLOI[0] = échelle verticale (montée + rebond), DEPLOI[1] = échelle horizontale. */
export const DEPLOI = new Float64Array(3);
export function unfoldF() {
  let u = DEPLOI[2] / COMBOS.deploy.unfold;
  if (!(u > 0)) u = 0;
  if (u > 1) u = 1;
  // écrasé à l'atterrissage, il se dresse au-delà de sa taille puis se pose (pièces qui s'ouvrent : les bras du socle
  // s'écartent = l'échelle horizontale passe par 1,12)
  const up = u < 0.6 ? 0.55 + (1.15 - 0.55) * lisse(u / 0.6) : 1.15 - 0.15 * lisse((u - 0.6) / 0.4);
  DEPLOI[0] = up;
  DEPLOI[1] = u < 0.5 ? 1.2 - 0.08 * lisse(u / 0.5) : 1.12 - 0.12 * lisse((u - 0.5) / 0.5);
}

/** Tests et ?debug : état, journal des gestes (du plus ancien au plus récent). */
export function inspect(out = {}) {
  out.step = Array.from(step);
  out.actif = Array.from(actif);
  out.dernier = dernier;
  out.clock = clock;
  out.geste = Array.from(G);
  const n = jN < JN ? jN : JN;
  const j0 = jN - n;
  const list = [];
  for (let q = 0; q < n; q++) {
    const j = (j0 + q) % JN;
    list.push({ combo: jC[j], geste: jG[j], req: +jReq[j].toFixed(4), imp: +jImp[j].toFixed(4), hitstop: jHs[j], trauma: jTr[j], hits: jHits[j] });
  }
  out.journal = list;
  out.total = jN;
  out.atterrissages = NLAND[0];
  out.fentes = FN[0]; // 16/11, point 10 : mètres parcourus en fentes réelles
  return out;
}
