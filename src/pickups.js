// LOT : progression — gemmes d'XP (vertes, bleues, violettes selon leur valeur) et fragments : chute et dispersion,
// aimantation dans le rayon de collecte, aspiration de fin de vague, collecte (contrat : ARCHITECTURE.md § M, § E.4,
// § G.2, § G.3). Un InstancedMesh par palier de gemme et un pour les fragments : 4 appels de dessin au plus.
// § E4.K (chantier K) : au-delà d'un seuil au sol, les plus éloignés et les plus anciens glissent vers le centre de leur
// groupe et forment une grosse gemme / un gros fragment qui pulse — mêmes maillages, + 0 appel de dessin.
import * as THREE from 'three';
import { CAPS, ENEMIES, ENEMY, PALETTE, PICKUPS, RENDER, RESOLVE, SFX, SHOP } from './config.js';
import { END_LOOT } from './config.js'; // § E2.G bis G1 : fin de vague sans aspiration d'office
import { GROS_BUTIN, REGROUPEMENT } from './config.js'; // § E4.K : regroupement en gros butin
import { ARGF, F_V, F_X, F_Z, P, mods, rand } from './state.js';
import { RECAP_T } from './config.js'; // § E5.E.2 : récap des ramassages
import { RAM_I, RAM_N, RAM_V } from './ramassage.js';

let progression = null;
let fx = null;
let audio = null;
let world = null;
let render = null;

// ----- Natures -----------------------------------------------------------------------------------------------------
const TIERS = PICKUPS.gemTiers.length; // 0 verte, 1 bleue, 2 violette…
const FRAGMENT = TIERS; // … 3 fragment
const KINDS = TIERS + 1;
const RESTING = 0; // posée (ou en train de retomber, tant que son âge est inférieur à popSeconds)
const ATTRACTED = 1; // attirée par le joueur : ne se repose plus
const GLIDE = 2; // § E4.K : glisse vers le point d'arrivée de son groupe (pGrp)

// ----- Pool privé (suppression immédiate par échange, boucle descendante : § E.4) -----------------------------------
const CAP = CAPS.pickups;
const pX = new Float32Array(CAP);
const pZ = new Float32Array(CAP);
const pVX = new Float32Array(CAP); // vitesse de dispersion pendant la chute (m/s)
const pVZ = new Float32Array(CAP);
const pSpeed = new Float32Array(CAP); // vitesse d'attraction (m/s)
const pValue = new Float64Array(CAP); // XP d'une gemme, fragments d'un fragment : crédité tel qu'il a été lâché
const pAge = new Float32Array(CAP); // s depuis l'apparition (temps simulé : figé en pause)
const pPhase = new Float32Array(CAP); // déphasage de la rotation et du flottement (rad)
const pKind = new Uint8Array(CAP);
const pState = new Uint8Array(CAP);
const pKeep = new Uint8Array(CAP); // § E2.G bis : 1 = toujours aspiré en fin de vague (butin du boss)
// § E4.K : gros butin et regroupement
const pBig = new Uint8Array(CAP); // 1 = grosse gemme / gros fragment
const pN = new Float32Array(CAP); // ramassables d'origine réunis ici (1 pour un ramassable lâché)
const pScl = new Float32Array(CAP); // échelle courante d'un gros (m), qui rejoint sa cible en exponentielle
const pBT = new Float32Array(CAP); // s depuis la naissance du gros (rampe du pouls)
const pGrp = new Uint8Array(CAP); // 0 = hors groupe, g + 1 = membre du groupe g (état GLIDE)
const pSX = new Float32Array(CAP); // départ du glissement
const pSZ = new Float32Array(CAP);
const pIso = new Uint8Array(CAP); // 1 = graine sans voisin : plus jamais graine (reste membre possible)
const GMAX = REGROUPEMENT.groupesMax;
const gOn = new Uint8Array(GMAX);
const gFrag = new Uint8Array(GMAX); // 1 = groupe de fragments
const gM = new Int16Array(GMAX); // membres au lancement
const gX = new Float32Array(GMAX); // point d'arrivée
const gZ = new Float32Array(GMAX);
const gT = new Float32Array(GMAX); // s depuis le lancement
let count = 0;
let keepNext = 0; // drapeau posé sur les ramassables créés entre beginKeep() et endKeep()
let vacuum = false; // aspiration de fin de vague en cours

// Cumuls depuis le reset (lus par le snapshot), minuterie de l'aspiration et valeurs de travail de update().
// Tableau typé : un flottant écrit à chaque image ne vit pas dans un « let » de module (§ V).
const DROPPED_XP = 0;
const DROPPED_FRAG = 1;
const COLLECTED_XP = 2;
const COLLECTED_FRAG = 3;
const MERGED = 4; // ramassables fusionnés dans un autre, pool plein
const VACUUM_T = 5; // s de temps simulé depuis attractAll (minuterie de l'aspiration)
const AUTO_CREDITED = 6; // ramassables crédités d'office par collectAll (jamais arrivés jusqu'au joueur)
const GAIN_XP = 7; // collecte du pas en cours (update) : cumulée ici, créditée en une fois après la boucle
const GAIN_FRAG = 8;
const DT = 9; // pas de temps de l'update en cours, relu d'ici (voir update)
const FRAG_REM = 10; // § E2.F : reste (< 1 fragment) du bonus de l'Aimant à fragments, reporté d'une image à l'autre
// § E2.G bis G1 : fin de vague — butin perdu (valeur et nombre), butin gardé, clignotement (niveau, phase en tours)
const LOST_XP = 11;
const LOST_FRAG = 12;
const LOST_N = 13;
const KEPT_N = 14;
const BLINK = 15; // 0, 1 (lent) ou 2 (rapide) — posé par main à chaque image (waves.lootBlink)
const BLINK_PHASE = 16;
// § E4.K : minuteries de lancement (gemmes, fragments), état « on regroupe » par nature, compteurs, gain de croissance
const REG_T = 17; // 17 gemmes, 18 fragments
const DRAIN = 19; // 19 gemmes, 20 fragments
const LAUNCHED = 21;
const DONE = 22;
const ABSORBED = 23; // ramassables fondus dans un autre par le regroupement
const BIG_COLLECTED = 24;
const GROW_K = 25; // 1 − exp(−dt / croissance), du pas en cours
const BRUT = 26; // compte brut au sol de la nature examinée (groundNet → regroupTick)
const S = new Float64Array(27);

// ----- Constantes de config mises à plat (lues à chaque image) -------------------------------------------------------
const TAU = Math.PI * 2;
const COLLECT_R = PICKUPS.collectRadius;
const PICKUP_DIST = PICKUPS.pickupDist;
const MAGNET_SPEED = PICKUPS.magnetSpeed;
const MAGNET_ACCEL = PICKUPS.magnetAccel;
const VACUUM_SPEED = PICKUPS.vacuumSpeed;
// Échéance de l'aspiration, en secondes après attractAll : tout le butin est arrivé au joueur avant que main ne
// crédite d'office ce qui reste (SHOP.vacuumMaxSeconds). Rien ne disparaît donc en plein vol.
const VACUUM_ARRIVE = PICKUPS.vacuumArrive * SHOP.vacuumMaxSeconds;
const SCATTER = PICKUPS.scatter;
const SCATTER_MIN2 = PICKUPS.scatterMin * PICKUPS.scatterMin;
const POP = PICKUPS.popSeconds;
const POP_H = PICKUPS.popHeight;
const POP_SCALE = PICKUPS.popScale;
const FLASH = PICKUPS.spawnFlash;
const HOVER = PICKUPS.hoverHeight;
const BOB = PICKUPS.bobAmp;
const BOB_W = PICKUPS.bobHz * TAU;
const ATTRACT_SPIN = PICKUPS.attractSpinMul;
const ATTRACT_GLOW = PICKUPS.attractGlow;
const FLY_H = PICKUPS.flyHeight;
const ABSORB_DIST = PICKUPS.absorbDist;
const ABSORB_SCALE = PICKUPS.absorbScale;
// § E4.K
const R = REGROUPEMENT;
const SEUIL_G = R.seuil.gemmes;
const SEUIL_F = R.seuil.fragments;
const CIBLE_G = R.cible.gemmes;
const CIBLE_F = R.cible.fragments;
const RAYON2 = R.rayon * R.rayon;
const VOISIN2 = R.rayonVoisin * R.rayonVoisin;
const GLISSE = R.glisse;
const B = GROS_BUTIN;
const POULS_W = TAU / B.pouls.periode;
const POULS_A = B.pouls.ampleur;
const LUEUR_MIN = B.pouls.lueurMin;
const LUEUR_D = B.pouls.lueurMax - B.pouls.lueurMin;
const RAMPE = B.pouls.rampe;
const LOG_MAX = Math.log2(R.maxParGroupe);
// § E5.A.6 : signal du butin qui va disparaître (END_LOOT.signal, région e5:A-decisions-1711), relu à chaque image
// (un test peut le changer en cours de partie) : comparaison de chaînes constantes, rien n'est alloué
const SIG_AUCUN = 0;
const SIG_DOUX = 1;
const SIG_CLIGNOTE = 2;
function signalCode() {
  const s = END_LOOT.signal;
  return s === 'aucun' ? SIG_AUCUN : s === 'clignote' || s === undefined ? SIG_CLIGNOTE : SIG_DOUX;
}

// Par nature : seuil d'XP, taille, vitesse de rotation.
const tierMin = new Float32Array(TIERS);
const kindScale = new Float32Array(KINDS);
const kindSpin = new Float32Array(KINDS); // rad/s
for (let k = 0; k < TIERS; k++) {
  tierMin[k] = PICKUPS.gemTiers[k].minXp;
  kindScale[k] = PICKUPS.gemTiers[k].scale;
  kindSpin[k] = PICKUPS.spinHz * TAU;
}
kindScale[FRAGMENT] = PICKUPS.fragment.scale;
kindSpin[FRAGMENT] = PICKUPS.fragmentSpinHz * TAU;
const kindColor = new Int32Array(KINDS); // § E4.K : couleur de l'éclat au ramassage d'un gros
for (let k = 0; k < TIERS; k++) kindColor[k] = PICKUPS.gemTiers[k].color;
kindColor[FRAGMENT] = PICKUPS.fragment.color;

// ----- Rendu : remplis à l'init ---------------------------------------------------------------------------------------
const meshes = []; // un InstancedMesh par nature
const mats = []; // instanceMatrix.array de chaque maillage
const fxs = []; // aFx.array de chaque maillage
const cur = new Int32Array(KINDS); // curseur d'écriture par nature (sync)
// Point de chute d'un nouveau ramassable, résolu sur place par world.resolveMany (aucun flottant passé en argument).
const landX = new Float32Array(1);
const landZ = new Float32Array(1);
const landR = new Float32Array([PICKUPS.landRadius]);
const landMode = new Uint8Array([RESOLVE.GROUND]);

export function init(ctx) {
  progression = ctx.progression;
  fx = ctx.fx;
  audio = ctx.audio;
  world = ctx.world;
  render = ctx.render;

  // Toutes les facettes sont émissives : couleur × PICKUPS.emissiveBoost, sans éclairage. La couleur de sommet est
  // choisie pour que la facette sorte à « couleur de la palette × gain » : gain = emissiveBoost pour les reflets
  // (au-dessus du seuil du bloom), PICKUPS.facets pour les autres (sous le seuil : la teinte du cahier domine).
  const BOOST = PICKUPS.emissiveBoost;
  const F = PICKUPS.facets;
  const work = new THREE.Color();
  const tint = (hex, gain) => work.setHex(hex).multiplyScalar(gain / BOOST).getHex();
  const tri = (parts, ax, ay, az, bx, by, bz, cx, cy, cz, hex) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([ax, ay, az, bx, by, bz, cx, cy, cz]), 3));
    parts.push(render.makePart(g, hex, 1));
  };

  // Gemme : bipyramide à 4 pans, pointe basse à y = 0 (unité : le demi-côté de la ceinture). Une facette de reflet
  // sur quatre : en tournant, la gemme scintille.
  const gem = (hex) => {
    const parts = [];
    const R = 1; // rayon de la ceinture : l'échelle d'un palier (PICKUPS.gemTiers[k].scale) est sa demi-largeur en mètres
    const Y_BELT = 1.7; // hauteur de la ceinture : culasse haute et sombre, que la caméra voit sous la ceinture
    const Y_TOP = 2.9; // hauteur de la pointe haute
    const top = [tint(hex, BOOST), tint(hex, F.base), tint(hex, F.shade), tint(hex, F.base)];
    const bottom = [tint(hex, F.shade), tint(hex, F.dark), tint(hex, F.dark), tint(hex, F.dark)];
    for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * TAU;
      const a1 = ((k + 1) / 4) * TAU;
      const x0 = Math.cos(a0) * R;
      const z0 = Math.sin(a0) * R;
      const x1 = Math.cos(a1) * R;
      const z1 = Math.sin(a1) * R;
      tri(parts, 0, Y_TOP, 0, x1, Y_BELT, z1, x0, Y_BELT, z0, top[k]);
      tri(parts, 0, 0, 0, x0, Y_BELT, z0, x1, Y_BELT, z1, bottom[k]);
    }
    return render.mergeParts(parts);
  };

  // Fragment : plaquette hexagonale cyan (dessus en reflet, chants alternés) avec une puce sombre au centre —
  // silhouette plate, sans confusion possible avec les gemmes dressées.
  const fragment = (hex) => {
    const parts = [];
    const R = 1;
    const Y0 = 0;
    const Y1 = 0.42;
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * TAU;
      const a1 = ((k + 1) / 6) * TAU;
      const x0 = Math.cos(a0) * R;
      const z0 = Math.sin(a0) * R;
      const x1 = Math.cos(a1) * R;
      const z1 = Math.sin(a1) * R;
      tri(parts, 0, Y1, 0, x1, Y1, z1, x0, Y1, z0, tint(hex, F.fragmentTop)); // dessus
      const side = tint(hex, k % 2 === 0 ? F.base : F.dark);
      tri(parts, x0, Y0, z0, x0, Y1, z0, x1, Y1, z1, side); // chant
      tri(parts, x0, Y0, z0, x1, Y1, z1, x1, Y0, z1, side);
    }
    const chip = new THREE.BoxGeometry(0.72, 0.2, 0.72);
    chip.translate(0, Y1 + 0.1, 0);
    parts.push(render.makePart(chip, PALETTE.robotDark, 0));
    return render.mergeParts(parts);
  };

  for (let k = 0; k < KINDS; k++) {
    const isFragment = k === FRAGMENT;
    const hex = isFragment ? PICKUPS.fragment.color : PICKUPS.gemTiers[k].color;
    const material = render.createLitMaterial({ glowColor: hex, emissiveBoost: BOOST }); // une instance par maillage
    const mesh = render.createInstanced(isFragment ? fragment(hex) : gem(hex), material, CAP, {
      name: isFragment ? 'fragments' : 'gemmes-' + k,
    });
    mesh.renderOrder = RENDER.effectsOrder; // intégration : dessiné après l'anneau du joueur (RENDER.effectsOrder)
    meshes.push(mesh);
    mats.push(mesh.instanceMatrix.array);
    fxs.push(mesh.geometry.attributes.aFx.array);
  }
}

/** Pool vidé, aspiration coupée ; aucune ressource recréée. */
export function reset() {
  count = 0;
  vacuum = false;
  keepNext = 0;
  S.fill(0);
  gOn.fill(0);
  for (let k = 0; k < KINDS; k++) render.commit(meshes[k], 0);
}

/** Palier de couleur d'une gemme selon sa valeur : le plus haut dont minXp est atteint. */
function tierOf(xp) {
  let t = 0;
  for (let k = 1; k < TIERS; k++) if (xp >= tierMin[k]) t = k;
  return t;
}

/**
 * Crédite une valeur au joueur, avec son son. Chemins par événement seulement (crédit d'office, pool plein sans
 * cible, position invalide) : la collecte de chaque image est cumulée dans update().
 */
function credit(kind, value) {
  if (kind === FRAGMENT) {
    S[COLLECTED_FRAG] += value;
    progression.addFragments(value);
    audio.play(SFX.FRAGMENT);
  } else {
    S[COLLECTED_XP] += value;
    ARGF[F_V] = value; // § E5.Z : × mods.xpGainMul, lu dans le registre (aucun flottant en argument)
    progression.addGemXpF();
    audio.play(SFX.GEM);
  }
}

/** Retire l'emplacement i : le dernier prend sa place. */
function remove(i) {
  const last = --count;
  if (i === last) return;
  pX[i] = pX[last];
  pZ[i] = pZ[last];
  pVX[i] = pVX[last];
  pVZ[i] = pVZ[last];
  pSpeed[i] = pSpeed[last];
  pValue[i] = pValue[last];
  pAge[i] = pAge[last];
  pPhase[i] = pPhase[last];
  pKind[i] = pKind[last];
  pState[i] = pState[last];
  pKeep[i] = pKeep[last];
  pBig[i] = pBig[last];
  pN[i] = pN[last];
  pScl[i] = pScl[last];
  pBT[i] = pBT[last];
  pGrp[i] = pGrp[last];
  pSX[i] = pSX[last];
  pSZ[i] = pSZ[last];
  pIso[i] = pIso[last];
}

/**
 * Pool plein : la valeur rejoint le ramassable de même nature le plus proche (aucune XP perdue). Une gemme ainsi
 * grossie change de palier si sa valeur le justifie. Sans ramassable de cette nature : créditée tout de suite.
 */
function merge(kind, x, z, value) {
  const wantFragment = kind === FRAGMENT;
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < count; i++) {
    if ((pKind[i] === FRAGMENT) !== wantFragment) continue;
    const dx = pX[i] - x;
    const dz = pZ[i] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  if (best < 0) {
    credit(kind, value);
    return;
  }
  pValue[best] += value;
  pN[best] += 1;
  if (!wantFragment) pKind[best] = tierOf(pValue[best]);
  S[MERGED]++;
}

/** Nouveau ramassable : il part de (x, z) et retombe, en popSeconds, à un point tiré autour (dispersion). */
function add(kind, x, z, value) {
  if (kind === FRAGMENT) S[DROPPED_FRAG] += value;
  else S[DROPPED_XP] += value;
  if (count >= CAP) {
    merge(kind, x, z, value);
    return;
  }
  // Point de chute : uniforme dans une couronne autour du départ, puis sorti des obstacles et borné à l'arène
  // (une gemme tombée dans un rocher serait invisible).
  const angle = rand() * TAU;
  const dist = SCATTER * Math.sqrt(SCATTER_MIN2 + (1 - SCATTER_MIN2) * rand());
  landX[0] = x + Math.cos(angle) * dist;
  landZ[0] = z + Math.sin(angle) * dist;
  world.resolveMany(landX, landZ, landR, landMode, 1);
  const i = count++;
  if (POP > 0) {
    pX[i] = x;
    pZ[i] = z;
    pVX[i] = (landX[0] - x) / POP;
    pVZ[i] = (landZ[0] - z) / POP;
  } else {
    pX[i] = landX[0];
    pZ[i] = landZ[0];
    pVX[i] = 0;
    pVZ[i] = 0;
  }
  pValue[i] = value;
  pAge[i] = 0;
  pPhase[i] = rand() * TAU;
  pKind[i] = kind;
  pKeep[i] = keepNext;
  pBig[i] = 0;
  pN[i] = 1;
  pScl[i] = 0;
  pBT[i] = 0;
  pGrp[i] = 0;
  pIso[i] = 0;
  // Pendant l'aspiration de fin de vague, tout ce qui apparaît part aussitôt vers le joueur.
  pState[i] = vacuum ? ATTRACTED : RESTING;
  pSpeed[i] = vacuum ? VACUUM_SPEED : 0;
}

/** Appelé par damage à la mort d'un robot : une gemme et, parfois, un fragment. No-op pour le boss (§ J.4). */
export function dropLoot(x, z, type) {
  if (type === ENEMY.BOSS) return;
  const T = ENEMIES.types[type];
  if (!T) return;
  spawnGem(x, z, T.gemXp);
  if (T.fragChance > 0 && rand() < T.fragChance) spawnFragment(x, z, T.fragValue);
}

/**
 * Position sans point au sol (NaN, ±Infinity) : le ramassable ne pourrait ni se voir ni être ramassé, et il
 * retiendrait l'aspiration de fin de vague jusqu'à son maximum. Sa valeur est donc créditée tout de suite.
 */
function creditUnplaced(kind, value) {
  if (kind === FRAGMENT) S[DROPPED_FRAG] += value;
  else S[DROPPED_XP] += value;
  credit(kind, value);
}

/** Une gemme de `xp` points d'expérience ; sa couleur suit sa valeur (PICKUPS.gemTiers). */
export function spawnGem(x, z, xp) {
  if (!(xp > 0) || xp === Infinity) return; // ni nulle, ni négative, ni NaN, ni infinie
  if (x - x !== 0 || z - z !== 0) {
    creditUnplaced(0, xp);
    return;
  }
  add(tierOf(xp), x, z, xp);
}

/**
 * Un fragment électronique de `value` fragments. Le porte-monnaie compte en entiers : la valeur est arrondie ICI,
 * pour que ce qui est au sol soit exactement ce qui sera crédité, par collecte comme par crédit d'office.
 */
export function spawnFragment(x, z, value) {
  const n = Math.round(value);
  if (!(n >= 1) || n === Infinity) return; // ni nulle, ni négative, ni NaN, ni infinie
  if (x - x !== 0 || z - z !== 0) {
    creditUnplaced(FRAGMENT, n);
    return;
  }
  add(FRAGMENT, x, z, n);
}

/**
 * Aspiration de fin de vague : tout vole vers le joueur, où que ce soit — à PICKUPS.vacuumSpeed au moins, plus
 * vite pour le butin trop loin pour arriver à cette vitesse avant l'échéance (VACUUM_ARRIVE, voir update).
 */
export function attractAll() {
  vacuum = true;
  S[VACUUM_T] = 0;
  for (let i = 0; i < count; i++) {
    pState[i] = ATTRACTED;
    pGrp[i] = 0; // § E4.K : tout groupe est quitté
    if (pSpeed[i] < VACUUM_SPEED) pSpeed[i] = VACUUM_SPEED;
  }
  gOn.fill(0);
}

/**
 * § E3.C — Aimant (utilitaire) : TOUT le butin au sol, dans toute l'arène, vole vers le joueur à `speed` m/s au moins
 * (puis accélère comme une attraction normale). Contrairement à attractAll, ce n'est pas l'aspiration de fin de vague :
 * pas d'échéance, et le butin tombé ensuite n'est pas attiré. Aucun flottant créé (speed : lecture de config).
 */
export function magnetAll(speed) {
  for (let i = 0; i < count; i++) {
    pState[i] = ATTRACTED;
    pGrp[i] = 0; // § E4.K : tout groupe est quitté
    if (pSpeed[i] < speed) pSpeed[i] = speed;
  }
  gOn.fill(0);
}

/**
 * § E5.V (Femz, 20/11 : « aspire ») — bascule après un boss : le butin gardé (pKeep : butin du boss) est attiré vers le
 * héros, comme à l'ancienne fin de vague ; le reste ne bouge pas. Le butin gardé n'entre jamais dans un groupe (§ E4.K).
 * Rend le nombre de ramassables nouvellement attirés.
 */
export function attirerGardes() {
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (pKeep[i] !== 1 || pState[i] === ATTRACTED) continue;
    pState[i] = ATTRACTED;
    if (pSpeed[i] < VACUUM_SPEED) pSpeed[i] = VACUUM_SPEED;
    n++;
  }
  return n;
}

/** § E2.G bis G1 règle 2a : les ramassables créés jusqu'à endKeep() sont toujours aspirés en fin de vague (butin du boss). */
export function beginKeep() {
  keepNext = 1;
}
export function endKeep() {
  keepNext = 0;
}

/** Vrai si le ramassable i est gardé en fin de vague (règle 2 : drapeau, déjà attiré, mode 'rayon' ou 'tout'). */
function keptAtEnd(i, radius2) {
  if (pKeep[i] === 1 || pState[i] === ATTRACTED) return true;
  const mode = END_LOOT.mode;
  if (mode === 'tout') return true;
  if (mode === 'rayon') {
    const dx = P.x - pX[i];
    const dz = P.z - pZ[i];
    return dx * dx + dz * dz <= radius2;
  }
  return false;
}

/**
 * § E2.G bis G1 (T5, après la purge des robots) : remplace attractAll. Le butin gardé est aspiré comme avant ; le reste
 * se désintègre dans l'image (voxels de purge, END_LOOT.voxelsPerLoot chacun, au plus maxLootVoxels) et n'est pas
 * crédité. Boucle descendante : un ramassable retiré laisse sa place au dernier.
 */
export function endWave() {
  if (END_LOOT.mode === 'sol') {
    finVagueSol();
    return;
  }
  const r = END_LOOT.radius;
  const radius2 = r * r;
  let voxels = END_LOOT.maxLootVoxels;
  const per = END_LOOT.voxelsPerLoot;
  for (let i = count - 1; i >= 0; i--) {
    if (keptAtEnd(i, radius2)) {
      S[KEPT_N]++;
      continue;
    }
    if (pKind[i] === FRAGMENT) S[LOST_FRAG] += pValue[i];
    else S[LOST_XP] += pValue[i];
    S[LOST_N]++;
    if (voxels > 0 && fx !== null) {
      const n = per < voxels ? per : voxels;
      voxels -= n;
      ARGF[F_X] = pX[i];
      ARGF[F_Z] = pZ[i];
      fx.spawnPurgeLootF(0, n);
    }
    remove(i);
  }
  attractAll();
}

/**
 * § E5.V (Femz, 17/11 : « garde les xp et gemme au sol entre les vagues ») — fin de vague au décryptage, mode 'sol' :
 * rien n'est retiré ni désintégré. Ce qui est déjà gardé (drapeau pKeep : butin du boss…) ou déjà attiré est aspiré vers
 * le héros comme avant ; le reste reste AU SOL, à sa place, et se ramasse à la vague suivante. Les groupes en cours
 * (§ E4.K) sont arrêtés (leurs membres se reposent où ils sont).
 */
function finVagueSol() {
  vacuum = true;
  S[VACUUM_T] = 0;
  for (let i = 0; i < count; i++) {
    if (pGrp[i] !== 0) {
      pGrp[i] = 0;
      if (pState[i] === GLIDE) pState[i] = RESTING;
    }
    if (pKeep[i] === 1 || pState[i] === ATTRACTED) {
      pState[i] = ATTRACTED;
      if (pSpeed[i] < VACUUM_SPEED) pSpeed[i] = VACUUM_SPEED;
      S[KEPT_N]++;
    }
  }
  gOn.fill(0);
}

/** § E5.V : ramassables attirés vers le héros (la phase d'aspiration du décryptage n'attend qu'eux en mode 'sol'). */
export function getAttractedCount() {
  let n = 0;
  for (let i = 0; i < count; i++) if (pState[i] === ATTRACTED) n++;
  return n;
}

/** § E5.V : ce que la phase d'aspiration attend — les attirés en mode 'sol', sinon tout le pool. */
export function getVacuumCount() {
  return END_LOOT.mode === 'sol' ? getAttractedCount() : count;
}

/** § E2.G bis G1 règle 3 : niveau de clignotement de l'image (0, 1, 2 ; waves.lootBlink), posé par main avant update. */
export function setBlink(level) {
  S[BLINK] = level;
}

/** Crédite d'office tout ce qui reste, vide le pool et met fin à l'aspiration. */
export function collectAll() {
  if (END_LOOT.mode === 'sol') {
    collectAttires();
    return;
  }
  let xp = 0;
  let fragments = 0;
  for (let i = 0; i < count; i++) {
    if (pKind[i] === FRAGMENT) fragments += pValue[i];
    else xp += pValue[i];
  }
  S[AUTO_CREDITED] += count;
  count = 0;
  gOn.fill(0);
  vacuum = false;
  S[VACUUM_T] = 0;
  if (xp > 0) credit(0, xp);
  if (fragments > 0) credit(FRAGMENT, fragments);
}

/** § E5.V : crédite et retire seulement les ramassables attirés ; le butin au sol reste. Fin de l'aspiration. */
function collectAttires() {
  let xp = 0;
  let fragments = 0;
  for (let i = count - 1; i >= 0; i--) {
    if (pState[i] !== ATTRACTED) continue;
    if (pKind[i] === FRAGMENT) fragments += pValue[i];
    else xp += pValue[i];
    S[AUTO_CREDITED]++;
    remove(i);
  }
  vacuum = false;
  S[VACUUM_T] = 0;
  if (xp > 0) credit(0, xp);
  if (fragments > 0) credit(FRAGMENT, fragments);
}

export function getActiveCount() {
  return count;
}

// ----- § E4.K : regroupement en gros butin -------------------------------------------------------------------------------
// Tout passe par des tableaux typés et des locales numériques : aucun objet, aucune chaîne, aucune fermeture, aucun
// flottant passé en argument (§ V). Un lancement = deux passes sur le pool ; au plus un par nature et par intervalle.

/** Ramassable i éligible à un groupe de la nature `frag` (1 fragments, 0 gemmes) : posé, chute finie, hors groupe, non gardé. */
function eligible(i, frag) {
  return pState[i] === RESTING && pAge[i] >= POP && pGrp[i] === 0 && pKeep[i] === 0 && (pKind[i] === FRAGMENT ? 1 : 0) === frag;
}

/** Ramassables de la nature `frag` au sol (posés ou en glissement, non gardés), moins ce que les groupes en cours vont retirer. */
function groundNet(frag) {
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (pState[i] === ATTRACTED || pKeep[i] === 1) continue;
    if ((pKind[i] === FRAGMENT ? 1 : 0) === frag) n++;
  }
  S[BRUT] = n; // compte brut, relu par regroupTick
  for (let g = 0; g < GMAX; g++) if (gOn[g] === 1 && gFrag[g] === frag) n -= gM[g] - 1;
  return n;
}

/** Marque i membre du groupe g (départ du glissement : sa position actuelle). */
function join(i, g) {
  pGrp[i] = g + 1;
  pState[i] = GLIDE;
  pSX[i] = pX[i];
  pSZ[i] = pZ[i];
}

/**
 * Lance un groupe de la nature `frag` : graine = le plus éloigné du héros et le plus ancien (distance + âge × poidsAge),
 * membres = les éligibles à moins de `rayon` d'elle (au plus maxParGroupe, gros compris) ; arrivée = le plus gros des
 * gros du groupe (il ne bouge pas), sinon le centre du groupe sorti des obstacles. Rend 1 si un groupe est lancé.
 */
function launch(frag) {
  let g = -1;
  for (let k = 0; k < GMAX; k++)
    if (gOn[k] === 0) {
      g = k;
      break;
    }
  if (g < 0) return 0;
  const px = P.x;
  const pz = P.z;
  let seed = -1;
  let best = -1;
  for (let i = 0; i < count; i++) {
    if (pBig[i] === 1 || pIso[i] === 1 || !eligible(i, frag)) continue;
    const dx = pX[i] - px;
    const dz = pZ[i] - pz;
    const score = Math.sqrt(dx * dx + dz * dz) + pAge[i] * R.poidsAge;
    if (score > best) {
      best = score;
      seed = i;
    }
  }
  if (seed < 0) return 0;
  const sx = pX[seed];
  const sz = pZ[seed];
  join(seed, g);
  let m = 1;
  let cx = sx;
  let cz = sz;
  let recv = -1;
  let recvN = -1;
  const max = R.maxParGroupe;
  for (let i = 0; i < count && m < max; i++) {
    if (!eligible(i, frag)) continue;
    const dx = pX[i] - sx;
    const dz = pZ[i] - sz;
    if (dx * dx + dz * dz > RAYON2) continue;
    join(i, g);
    m++;
    cx += pX[i];
    cz += pZ[i];
    if (pBig[i] === 1 && pN[i] > recvN) {
      recvN = pN[i];
      recv = i;
    }
  }
  if (m === 1) {
    // seule dans son rayon : son plus proche voisin éligible, jusqu'à rayonVoisin
    let nb = -1;
    let nd2 = VOISIN2;
    for (let i = 0; i < count; i++) {
      if (i === seed || !eligible(i, frag)) continue;
      const dx = pX[i] - sx;
      const dz = pZ[i] - sz;
      const d2 = dx * dx + dz * dz;
      if (d2 <= nd2) {
        nd2 = d2;
        nb = i;
      }
    }
    if (nb < 0) {
      // isolée : plus jamais graine (elle reste membre possible d'un autre groupe)
      pGrp[seed] = 0;
      pState[seed] = RESTING;
      pIso[seed] = 1;
      return 0;
    }
    join(nb, g);
    m = 2;
    cx += pX[nb];
    cz += pZ[nb];
    if (pBig[nb] === 1) recv = nb;
  }
  if (recv >= 0) {
    gX[g] = pX[recv];
    gZ[g] = pZ[recv];
  } else {
    landX[0] = cx / m;
    landZ[0] = cz / m;
    world.resolveMany(landX, landZ, landR, landMode, 1);
    gX[g] = landX[0];
    gZ[g] = landZ[0];
  }
  gOn[g] = 1;
  gFrag[g] = frag;
  gM[g] = m;
  gT[g] = 0;
  S[LAUNCHED]++;
  return 1;
}

/**
 * Fin du glissement du groupe g : tous ses membres sont au point d'arrivée. Le receveur (le plus gros des gros, sinon le
 * premier) prend la somme des valeurs et des pièces ; les autres sont retirés là où il est. Boucle descendante.
 */
function finish(g) {
  const tag = g + 1;
  let recv = -1;
  let score = -1;
  let total = 0;
  let pieces = 0;
  let m = 0;
  for (let i = 0; i < count; i++) {
    if (pGrp[i] !== tag) continue;
    m++;
    total += pValue[i];
    pieces += pN[i];
    const sc = pBig[i] === 1 ? 1e9 + pN[i] : 0;
    if (sc > score) {
      score = sc;
      recv = i;
    }
  }
  gOn[g] = 0;
  if (m === 0) return;
  pGrp[recv] = 0;
  pState[recv] = RESTING;
  pX[recv] = gX[g];
  pZ[recv] = gZ[g];
  if (m === 1) return;
  if (pBig[recv] === 0) {
    pBig[recv] = 1;
    pScl[recv] = kindScale[pKind[recv]]; // naît à la taille de son palier, puis grossit (jamais de saut)
    pBT[recv] = 0;
  }
  pValue[recv] = total;
  pN[recv] = pieces;
  pIso[recv] = 0;
  if (pKind[recv] !== FRAGMENT) pKind[recv] = tierOf(total);
  for (let i = count - 1; i >= 0; i--) if (pGrp[i] === tag) remove(i);
  S[ABSORBED] += m - 1;
  S[DONE]++;
}

/** Au plus un groupe lancé par nature toutes les `intervalle` s, tant que la nature est au-dessus de sa cible. */
function regroupTick() {
  const dt = S[DT];
  for (let f = 0; f < 2; f++) {
    S[REG_T + f] += dt;
    if (S[REG_T + f] < R.intervalle) continue;
    S[REG_T + f] = 0;
    const net = groundNet(f);
    const brut = S[BRUT];
    if (brut > (f === 1 ? SEUIL_F : SEUIL_G)) S[DRAIN + f] = 1;
    if (net <= (f === 1 ? CIBLE_F : CIBLE_G)) {
      S[DRAIN + f] = 0;
      continue;
    }
    if (S[DRAIN + f] === 1) launch(f);
  }
}

/** Debug (§ E4.K.4) : coupe ou rallume la règle (mesure de l'avant, tests du pool plein). */
export function setRegroupement(on) {
  R.actif = !!on;
  return R.actif;
}

/** S10 : chute, aimantation, collecte. Boucle descendante : un ramassable collecté laisse sa place au dernier. */
export function update(dtBoxed) {
  // Un argument flottant arrive « emballé » dans un objet ; relu depuis un tableau typé, dt est un flottant nu pour
  // tous les étages de V8. Sans cela, « dt < left ? dt : left » (dernière image d'une chute) mêlait le flottant emballé
  // et un flottant calculé, et V8 allouait un nombre de 12 octets par ramassable qui se pose (mesuré : 24 à 36 octets
  // par image pour deux butins par image ; 0 depuis).
  S[DT] = dtBoxed;
  const dt = S[DT];
  // Aspiration : « rush » = 1 / temps qu'il reste avant l'échéance, ce pas compris. Un ramassable à la distance d
  // qui vole à d × rush arrive pile à l'échéance ; au dernier pas (reste ≤ dt) il franchit toute la distance.
  let rush = 0;
  if (vacuum) {
    const left = VACUUM_ARRIVE - S[VACUUM_T];
    rush = 1 / (left > dt ? left : dt);
    S[VACUUM_T] += dt;
  }
  if (S[BLINK] > 0) {
    // § E5.A.6 : signal 'doux' (défaut) = lent pouls de la lueur, à END_LOOT.doux.hz puis hzFin sous fastSeconds ;
    // 'clignote' = l'ancien clignotement (§ E2.G bis G1) ; 'aucun' = rien (phase tenue à 0)
    const sig = signalCode();
    const hz = sig === SIG_DOUX ? (S[BLINK] >= 2 ? END_LOOT.doux.hzFin : END_LOOT.doux.hz) : sig === SIG_CLIGNOTE ? (S[BLINK] >= 2 ? END_LOOT.fastHz : END_LOOT.blinkHz) : 0;
    S[BLINK_PHASE] += dt * hz;
    if (S[BLINK_PHASE] >= 1) S[BLINK_PHASE] -= Math.floor(S[BLINK_PHASE]);
  } else S[BLINK_PHASE] = 0;
  if (count === 0) return;
  // § E4.K : lancement des groupes (étalé), horloge des groupes en cours, gain de croissance des gros
  if (!vacuum && R.actif) regroupTick();
  let anyGroup = 0;
  for (let g = 0; g < GMAX; g++)
    if (gOn[g] === 1) {
      gT[g] += dt;
      anyGroup = 1;
    }
  S[GROW_K] = 1 - Math.exp(-dt / B.croissance);
  const growK = S[GROW_K];
  const px = P.x;
  const pz = P.z;
  const radius = COLLECT_R * mods.pickupRadiusMul;
  const radius2 = radius * radius;
  // Collecte de ce pas : cumulée dans le tableau S et créditée en une fois après la boucle (un appel par image où
  // quelque chose est ramassé, au lieu d'un appel à argument flottant par ramassable : § V).
  S[GAIN_XP] = 0;
  S[GAIN_FRAG] = 0;
  for (let i = count - 1; i >= 0; i--) {
    const age = pAge[i];
    pAge[i] = age + dt;
    if (pBig[i] === 1) {
      // § E4.K : l'échelle rejoint sa cible (naissance, butin reçu) en exponentielle — jamais de saut
      pBT[i] += dt;
      const frag = pKind[i] === FRAGMENT;
      const l = Math.log2(pN[i]) - LOG_MAX;
      let tgt = (frag ? B.fragment.echelle : B.gemme.echelle) + (l > 0 ? l * (frag ? B.fragment.parDoublement : B.gemme.parDoublement) : 0);
      const tMax = frag ? B.fragment.echelleMax : B.gemme.echelleMax;
      if (tgt > tMax) tgt = tMax;
      pScl[i] += (tgt - pScl[i]) * growK;
    }
    if (pState[i] === GLIDE) {
      const rx = px - pX[i];
      const rz = pz - pZ[i];
      if (rx * rx + rz * rz > radius2) {
        // § E4.K : glissement vers le point d'arrivée du groupe (smoothstep : vitesse nulle aux deux bouts)
        const g = pGrp[i] - 1;
        let u = gT[g] / GLISSE;
        if (u > 1) u = 1;
        const e = u * u * (3 - 2 * u);
        pX[i] = pSX[i] + (gX[g] - pSX[i]) * e;
        pZ[i] = pSZ[i] + (gZ[g] - pSZ[i]) * e;
        continue;
      }
      pState[i] = ATTRACTED; // le héros passe dans le rayon : il quitte son groupe et part vers lui
      pSpeed[i] = MAGNET_SPEED;
      pGrp[i] = 0;
    }
    if (pState[i] === RESTING) {
      if (age < POP) {
        // Chute : la dernière image ne consomme que ce qui reste du saut (point de chute exact à toute cadence).
        const left = POP - age;
        const t = dt < left ? dt : left;
        pX[i] += pVX[i] * t;
        pZ[i] += pVZ[i] * t;
        continue;
      }
      const rx = px - pX[i];
      const rz = pz - pZ[i];
      if (rx * rx + rz * rz > radius2) continue;
      pState[i] = ATTRACTED; // le joueur est passé dans le rayon de collecte
      pSpeed[i] = MAGNET_SPEED;
    }
    const dx = px - pX[i];
    const dz = pz - pZ[i];
    const d = Math.sqrt(dx * dx + dz * dz);
    let speed = pSpeed[i];
    if (vacuum) {
      // vacuumSpeed pour le butin proche ; le butin lointain va à la vitesse qui l'amène au joueur à l'échéance
      // (il ne ralentit jamais : la vitesse acquise est gardée si le joueur vient à sa rencontre)
      if (speed < VACUUM_SPEED) speed = VACUUM_SPEED;
      const needed = d * rush;
      if (speed < needed) speed = needed;
    } else {
      speed += MAGNET_ACCEL * dt;
    }
    pSpeed[i] = speed;
    const step = speed * dt;
    if (d - step <= PICKUP_DIST) {
      // ramassé : le son part tout de suite, la valeur rejoint le cumul du pas (aucun flottant passé en argument)
      if (pKind[i] === FRAGMENT) {
        S[GAIN_FRAG] += pValue[i];
        audio.play(SFX.FRAGMENT);
      } else {
        S[GAIN_XP] += pValue[i];
        audio.play(SFX.GEM);
      }
      if (pBig[i] === 1) {
        // § E4.K.3 : gros butin — toute sa valeur dans le cumul du pas, son plus riche et petit éclat de sa couleur
        S[BIG_COLLECTED]++;
        audio.play(SFX.GROS_BUTIN);
        if (fx !== null) {
          ARGF[F_X] = pX[i];
          ARGF[F_Z] = pZ[i];
          fx.spawnGrosButinF(kindColor[pKind[i]]);
        }
      }
      // § E5.E.2 : récap des ramassages du HUD (type : gemme de son palier, fragment, ou gros butin) — deux tableaux typés
      {
        const fr = pKind[i] === FRAGMENT;
        const t = pBig[i] === 1 ? (fr ? RECAP_T.GROS_FRAGMENT : RECAP_T.GROSSE_GEMME) : fr ? RECAP_T.FRAGMENTS : RECAP_T.GEMME + pKind[i];
        RAM_N[t]++;
        RAM_V[t] += fr ? pValue[i] * mods.fragmentMul : pValue[i] * mods.xpGainMul; // § E5.Z : XP gagnée
        RAM_I[t] = RAM_V[t] | 0;
      }
      remove(i);
      continue;
    }
    const k = step / d;
    pX[i] += dx * k;
    pZ[i] += dz * k;
  }
  // § E4.K : groupes arrivés (après la boucle : les retraits de finish ne croisent pas son parcours)
  if (anyGroup === 1) for (let g = 0; g < GMAX; g++) if (gOn[g] === 1 && gT[g] >= GLISSE) finish(g);
  if (S[GAIN_XP] > 0) {
    S[COLLECTED_XP] += S[GAIN_XP];
    ARGF[F_V] = S[GAIN_XP]; // § E5.Z : × mods.xpGainMul, lu dans le registre (aucun flottant en argument)
    progression.addGemXpF();
  }
  if (S[GAIN_FRAG] > 0) {
    // § E2.F — Aimant à fragments : mods.fragmentMul ; le bonus est crédité en fragments ENTIERS, le reste est reporté
    // (un fragment ramassé seul vaut 1,08 : sans report, l'arrondi le ramènerait toujours à 1)
    if (mods.fragmentMul !== 1) {
      const bonus = S[GAIN_FRAG] * (mods.fragmentMul - 1) + S[FRAG_REM];
      const whole = Math.floor(bonus + 1e-9); // 100 × (1,4 − 1) vaut 39,999… en flottants : 40 fragments, pas 39
      S[FRAG_REM] = bonus > whole ? bonus - whole : 0;
      S[GAIN_FRAG] += whole;
    }
    S[COLLECTED_FRAG] += S[GAIN_FRAG];
    progression.addFragments(S[GAIN_FRAG]);
  }
}

/** F11 : une passe sur le pool, un curseur par nature ; matrices et aFx écrits en ligne (§ G.3). */
export function sync() {
  cur.fill(0);
  const px = P.x;
  const pz = P.z;
  // § E2.G bis G1 règle 3 : phase « éteinte » du clignotement (seconde moitié de chaque période), pour le butin perdu —
  // seulement en signal 'clignote' (l'ancien, gardé pour comparer). § E5.A.6 (décision de Femz du 17/11 : « retire le
  // truc qui fait glitcher, grossir et rapetisser vite les gemmes et fragments ») : signal 'doux' par défaut, la LUEUR
  // du butin perdu monte et redescend lentement (0 → doux.lueur → 0, cosinus : jamais de saut), taille inchangée.
  const sig = signalCode();
  const off = sig === SIG_CLIGNOTE && S[BLINK] > 0 && S[BLINK_PHASE] >= 0.5 && !vacuum;
  const doux = sig === SIG_DOUX && S[BLINK] > 0 && !vacuum ? END_LOOT.doux.lueur * (0.5 - 0.5 * Math.cos(TAU * S[BLINK_PHASE])) : 0;
  const rB = END_LOOT.radius;
  const blinkR2 = rB * rB;
  for (let i = 0; i < count; i++) {
    const kind = pKind[i];
    const k = cur[kind]++;
    const age = pAge[i];
    const phase = pPhase[i];
    let scale = kindScale[kind];
    let y = HOVER + BOB * Math.sin(age * BOB_W + phase);
    let rot = age * kindSpin[kind] + phase;
    let flash = 0;
    let glow = 0;
    const big = pBig[i] === 1;
    if (big) {
      // § E4.K.2 : gros butin — taille et lueur respirent en phase (lent) ; l'ampleur monte à sa naissance
      let ramp = pBT[i] / RAMPE;
      if (ramp > 1) ramp = 1;
      const sn = Math.sin(age * POULS_W + phase);
      scale = pScl[i] * (1 + POULS_A * ramp * sn);
      glow = (LUEUR_MIN + LUEUR_D * (0.5 + 0.5 * sn)) * ramp;
    }
    if (age < POP) {
      // saut d'apparition : arc, éclair blanc qui s'éteint, taille qui monte
      const u = age / POP;
      y += POP_H * 4 * u * (1 - u);
      scale *= POP_SCALE + (1 - POP_SCALE) * u;
      flash = FLASH * (1 - u) * (1 - u);
    }
    if (off && !keptAtEnd(i, blinkR2)) {
      scale *= END_LOOT.blinkScale;
      flash = END_LOOT.blinkFlash;
    }
    if (doux > glow && !keptAtEnd(i, blinkR2)) glow = doux; // § E5.A.6 : le gros butin garde son pouls s'il est plus fort
    if (pState[i] === ATTRACTED) {
      // attirée : elle tourne plus vite, s'éclaire, monte vers le buste du joueur et rétrécit en arrivant
      rot *= ATTRACT_SPIN;
      if (glow < ATTRACT_GLOW) glow = ATTRACT_GLOW;
      const dx = px - pX[i];
      const dz = pz - pZ[i];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < ABSORB_DIST) {
        const near = 1 - d / ABSORB_DIST;
        y += (FLY_H - y) * near;
        scale *= 1 - (1 - ABSORB_SCALE) * near;
      }
    }
    const c = Math.cos(rot) * scale;
    const s = Math.sin(rot) * scale;
    const m = mats[kind];
    const o = k * 16;
    m[o] = c;
    m[o + 1] = 0;
    m[o + 2] = -s;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = scale;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = s;
    m[o + 9] = 0;
    m[o + 10] = c;
    m[o + 11] = 0;
    m[o + 12] = pX[i];
    m[o + 13] = y;
    m[o + 14] = pZ[i];
    m[o + 15] = 1;
    const f = fxs[kind];
    f[k * 2] = flash;
    f[k * 2 + 1] = glow;
  }
  for (let t = 0; t < KINDS; t++) render.commit(meshes[t], cur[t]);
}

/**
 * Part du snapshot : { active, gems, fragments, vacuum } (contrat), plus des mesures pour les tests — compte par
 * nature, valeur au sol, cumuls lâchés / collectés / fusionnés / crédités d'office, rayon de collecte effectif,
 * minuterie et échéance de l'aspiration, et le détail des `sampleMax` premiers ramassables (PICKUPS.debugSample
 * dans le snapshot ; un test peut en demander davantage en appelant inspect lui-même).
 */
export function inspect(out, sampleMax = PICKUPS.debugSample) {
  const byKind = [];
  for (let k = 0; k < KINDS; k++) byKind.push(0);
  let attracted = 0;
  let xp = 0;
  let fragmentValue = 0;
  for (let i = 0; i < count; i++) {
    byKind[pKind[i]]++;
    if (pState[i] === ATTRACTED) attracted++;
    if (pKind[i] === FRAGMENT) fragmentValue += pValue[i];
    else xp += pValue[i];
  }
  out.active = count;
  out.gems = count - byKind[FRAGMENT];
  out.fragments = byKind[FRAGMENT];
  out.vacuum = vacuum;
  out.byKind = byKind; // [vertes, bleues, violettes, fragments]
  out.attracted = attracted;
  out.xpOnGround = xp;
  out.fragmentsOnGround = fragmentValue;
  out.droppedXp = S[DROPPED_XP];
  out.droppedFragments = S[DROPPED_FRAG];
  out.collectedXp = S[COLLECTED_XP];
  out.collectedFragments = S[COLLECTED_FRAG];
  out.merged = S[MERGED];
  out.autoCredited = S[AUTO_CREDITED]; // crédités d'office par collectAll, sans être arrivés au joueur
  out.collectRadius = COLLECT_R * mods.pickupRadiusMul;
  out.vacuumTime = S[VACUUM_T]; // s simulées depuis attractAll
  out.vacuumArrive = VACUUM_ARRIVE; // échéance de l'aspiration (s)
  // § E2.G bis G1 : fin de vague
  out.lostXp = S[LOST_XP];
  out.lostFragments = S[LOST_FRAG];
  out.lostCount = S[LOST_N];
  out.keptCount = S[KEPT_N];
  out.blink = S[BLINK];
  out.blinkPhase = S[BLINK_PHASE];
  let keepFlag = 0;
  for (let i = 0; i < count; i++) if (pKeep[i] === 1) keepFlag++;
  out.keepFlagged = keepFlag;
  // § E4.K : gros butin et regroupement
  let big = 0;
  let bigFrag = 0;
  let gliding = 0;
  for (let i = 0; i < count; i++) {
    if (pBig[i] === 1) {
      big++;
      if (pKind[i] === FRAGMENT) bigFrag++;
    }
    if (pState[i] === GLIDE) gliding++;
  }
  let groups = 0;
  for (let g = 0; g < GMAX; g++) groups += gOn[g];
  out.big = big;
  out.bigByNature = [big - bigFrag, bigFrag]; // [gemmes, fragments]
  out.gliding = gliding;
  out.groups = groups;
  out.regroupOn = R.actif;
  out.regroupLaunched = S[LAUNCHED];
  out.regroupDone = S[DONE];
  out.regroupAbsorbed = S[ABSORBED];
  out.bigCollected = S[BIG_COLLECTED];
  out.drain = [S[DRAIN], S[DRAIN + 1]];
  // Détail des premiers ramassables : leur état, et « draw » = ce que le dernier sync() a écrit pour eux dans les
  // tampons envoyés au GPU (matrice d'instance et aFx), relu tel quel. sync() range les instances dans l'ordre du
  // pool, un curseur par nature : le même parcours retrouve l'emplacement de chacun. draw.x et draw.z diffèrent de
  // x et z tant qu'aucun sync() n'a suivi la création ou un déplacement.
  const sample = [];
  const n = count < sampleMax ? count : sampleMax;
  const slot = [];
  for (let k = 0; k < KINDS; k++) slot.push(0);
  for (let i = 0; i < n; i++) {
    const kind = pKind[i];
    const k = slot[kind]++;
    const m = mats[kind];
    const o = k * 16;
    const f = fxs[kind];
    sample.push({
      x: pX[i],
      z: pZ[i],
      kind,
      value: pValue[i],
      state: pState[i],
      age: pAge[i],
      speed: pSpeed[i],
      phase: pPhase[i],
      keep: pKeep[i] === 1,
      big: pBig[i] === 1, // § E4.K
      n: pN[i],
      grp: pGrp[i],
      scl: pScl[i],
      bigT: pBT[i],
      draw: {
        visible: k < meshes[kind].count,
        x: m[o + 12],
        y: m[o + 13], // hauteur de la pointe basse (m)
        z: m[o + 14],
        scale: m[o + 5],
        rot: Math.atan2(m[o + 8], m[o]), // rad, dans ]−π ; π]
        flash: f[k * 2], // aFx.x : éclair blanc
        glow: f[k * 2 + 1], // aFx.y : lueur
      },
    });
  }
  out.sample = sample;
}
