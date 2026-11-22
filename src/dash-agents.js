// Retours de Femz du 16/11/2026, point 11 (ARCHITECTURE.md § E3.Z.11) — un DASH PROPRE À CHAQUE AGENT : même touche,
// même cercle bleu de recharge sous le héros, même esprit (esquiver). Règle de Femz, mot pour mot : « chaque passif ne
// doivent faire que tres peu de degats pour chaque agent, sinon ca deviendrais un autre type d'arme indirectement » —
// l'effet est surtout du CONTRÔLE, les dégâts restent symboliques (mesurés : tests/e3-retours-1611.test.mjs).
//   Éclaireur — GLISSADE PROPULSÉE : le trajet du dash laisse une traînée électrique qui RALENTIT les robots qui la
//               traversent (piqûre minime) ; ses armes tirent pendant la glissade, comme toujours.
//   Bastion   — BOND SISMIQUE : bond plus lent et plus haut, onde de choc à l'atterrissage qui REPOUSSE (dégâts minimes),
//               secousse dosée.
//   Shinobi   — PAS DE L'OMBRE : disparaît dans une bouffée de fumée, réapparaît plus loin (téléportation courte), laisse
//               un LEURRE qui attire les robots proches pendant 1 s (aucun dégât).
// player.js appelle depart() au front de la touche du dash et fin() quand le trajet s'achève ; update(dt) chaque image
// de jeu. Aucune allocation par image (§ V) : tableaux typés créés ici, arguments flottants par ARGF / Q.
import { AGENT, DASH_AGENTS as DA, DMG, DMG_SRC, ENEMY, SFX, TRAUMA, VFX_STYLE } from './config.js';
import { ONDE_BOND, SOIN_BOND } from './config.js'; // § E5.F : onde du bond (ambre depuis le 22/11), soin par robot tué
import { ARGF, E, F_DX, F_DZ, F_SX, F_SZ, F_T, F_V, F_X, F_Z, P, rand, run } from './state.js';
import * as V from './vfx/projectiles.js';

let ctx = null;
const OUT = new Uint16Array(256);
const RES = new Float32Array(2);
// Traînée de la glissade : [0] x0, [1] z0, [2] x1, [3] z1, [4] vie restante (s), [5] prochain tic (s), [6] prochain arc
const TR = new Float64Array(7);
// Leurre du pas de l'ombre : [0] x, [1] z, [2] vie restante (s), [3] prochaine bouffée (s)
const LE = new Float64Array(4);
// Départ du dash courant : [0] x, [1] z, [2] agent (−1 : aucun dash en cours)
const DEP = new Float64Array(3);
/** Vitesse (m/s) et hauteur max (m) du dash courant, lues par player.js (trajet) et heros-anim (bond). */
export const DASH = new Float64Array(3); // [0] vitesse, [1] hauteur du bond, [2] durée totale (s)
// Relevés (tests) : [0] robots ralentis, [1] dégâts de la traînée, [2] robots repoussés par l'onde, [3] dégâts de l'onde,
// [4] téléportations, [5] robots attirés (somme des pas), [6] dégâts du leurre (toujours 0), [7] ondes, [8] traînées
const N = new Float64Array(9);
const seen = new Int32Array(256); // uid des robots déjà piqués à ce tic
DEP[2] = -1;

export function init(context) {
  ctx = context;
}

export function reset() {
  TR.fill(0);
  LE.fill(0);
  DEP.fill(0);
  MK_N[0] = 0; // § E5.F
  SOIN.fill(0);
  TUES.fill(0);
  TOUCHES.fill(0); // § E5.F.14
  DEP[2] = -1;
  DASH[0] = 0;
  DASH[1] = 0;
  DASH[2] = 0;
  N.fill(0);
}

/**
 * Front de la touche du dash (player.js, après la pose de P.dashT, P.dashDirX/Z) : règle le trajet propre à l'agent.
 * Rend la durée du trajet (s) ; 0 pour le pas de l'ombre (le héros est déjà arrivé).
 */
export function depart(baseSpeed, baseDuration) {
  const a = run.agent;
  DEP[0] = P.x;
  DEP[1] = P.z;
  DEP[2] = a;
  DASH[0] = baseSpeed;
  DASH[1] = 0;
  DASH[2] = baseDuration;
  if (a === AGENT.BASTION) {
    DASH[0] = baseSpeed * DA.bond.vitesseMul;
    DASH[2] = baseDuration * DA.bond.dureeMul;
    DASH[1] = DA.bond.hauteur;
    return DASH[2];
  }
  if (a === AGENT.SHINOBI) {
    ombre();
    // un court « dash » sur place (vitesse quasi nulle, DA.ombre.image > LOOP.maxDt : il survit au player.update qui le
    // pose) : les objets et évolutions qui guettent le dash (Moteur cinétique, Brise-ligne, Surrégime) le voient comme
    // pour les autres agents — § E5.X3 : à 1/60 s il tombait à 0 dans la même image et aucun ne se déclenchait
    DASH[0] = 1e-6;
    DASH[2] = DA.ombre.image;
    return DASH[2];
  }
  return DASH[2];
}

/** Fin du trajet (player.js, P.dashT vient de tomber à 0). */
export function fin() {
  const a = DEP[2];
  DEP[2] = -1;
  DASH[1] = 0;
  if (a === AGENT.ECLAIREUR) {
    const G = DA.glissade;
    TR[0] = DEP[0];
    TR[1] = DEP[1];
    TR[2] = P.x;
    TR[3] = P.z;
    TR[4] = G.vie;
    TR[5] = 0;
    TR[6] = 0;
    N[8]++;
  } else if (a === AGENT.BASTION) onde();
}

/** Hauteur du bond à la part u (0 → 1) du trajet : une cloche (heros-anim, dessin seulement). */
export function hauteur(restant) {
  if (!(DASH[1] > 0) || !(DASH[2] > 0)) return 0;
  const u = 1 - restant / DASH[2];
  return u > 0 && u < 1 ? DASH[1] * 4 * u * (1 - u) : 0;
}

// ----- Bastion : onde de choc à l'atterrissage ------------------------------------------------------------------------
function onde() {
  const B = DA.bond;
  const n = ctx.grid.queryCircle(P.x, P.z, B.rayon, OUT, OUT.length);
  const it = ctx.items; // § E5.X3 : Moteur cinétique du Bastion, à l'atterrissage
  if (it) it.debutBond();
  let k = 0;
  TUES[0] = 0;
  for (let q = 0; q < n; q++) {
    const i = OUT[q];
    if (E.alive[i] === 0 || E.sus[i] !== 0 || E.type[i] === ENEMY.BOSS) continue; // § E4.F : repli (1) ou garé (2)
    const dx = E.x[i] - P.x;
    const dz = E.z[i] - P.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d - E.radius[i] > B.rayon) continue;
    if (it) it.frapperBond(i); // § E5.X3 (rien sans l'objet)
    if (B.degats > 0 && E.alive[i] !== 0) {
      ARGF[F_V] = B.degats;
      ARGF[F_SX] = P.x;
      ARGF[F_SZ] = P.z;
      if (ctx.damage.hitEnemyF(i, DMG_SRC.ITEM, DMG.NO_CRIT | DMG.BYPASS_SHIELD) > 0) N[3] += B.degats;
    }
    if (E.alive[i] === 0) {
      TUES[0]++; // § E5.F : robot tué par le bond (soin du Bastion)
      continue;
    }
    marquerSoin(i); // § E5.F : touché par l'onde — s'il meurt dans la fenêtre, le Bastion se soigne
    ARGF[F_DX] = d > 1e-4 ? dx / d : 1;
    ARGF[F_DZ] = d > 1e-4 ? dz / d : 0;
    ARGF[F_V] = B.recul * (1 - 0.5 * (d / B.rayon));
    ctx.enemies.applyKnockbackF(i);
    ARGF[F_V] = B.ralenti;
    ARGF[F_T] = B.ralentiS;
    ctx.enemies.applySlowF(i);
    k++;
  }
  N[2] += k;
  TOUCHES[0] = k + TUES[0]; // § E5.F.14 : robots touchés par l'onde (tués compris)
  TOUCHES[1] += TOUCHES[0];
  soinBond();
  N[7]++;
  // anneau de choc au sol (style ONDE, couleur du marteau) + poussière, son de frappe au sol, secousse dosée
  V.Q[0] = P.x;
  V.Q[1] = 0.05;
  V.Q[2] = P.z;
  V.Q[3] = B.rayon;
  V.Q[4] = 0;
  V.Q[5] = 0;
  V.Q[6] = 1;
  V.Q[7] = 0;
  V.Q[8] = B.couleur + 0.5;
  V.Q[9] = B.rayon * 1.6;
  if (ONDE_BOND.actif) V.evenement(ONDE_BOND.style); // § E5.F : onde ambre (22/11 ; bleue avant), style « splash » de la référence de Femz
  else V.evenement(VFX_STYLE.ONDE);
  for (let p = 0; p < B.poussiere; p++) {
    const a = (p / B.poussiere) * Math.PI * 2;
    ctx.fx.spawnPuff(P.x + Math.cos(a) * 0.9, 0.15, P.z + Math.sin(a) * 0.9, B.poussiereCouleur);
  }
  ctx.audio.play(SFX.HAMMER, P.x, P.z);
  if (ctx.camera && ctx.camera.addTraumaAt) ctx.camera.addTraumaAt(B.trauma, TRAUMA.FIRE, P.x, P.z);
}

// § E5.F (demande de Femz du 17/11 : « Bastion doit récupérer de la vie quand il tue des ennemis avec son dash ») :
// chaque robot tué par l'onde du bond rend SOIN_BOND.parRobot PV, au plus SOIN_BOND.max par bond, sans dépasser les PV
// max ; chiffre vert au-dessus de lui et éclat vert (anneau de soin de fx). Pas de son : le seul son de soin de la banque
// est celui du réparateur ennemi (il dirait « un robot se soigne ») ; la frappe au sol a déjà le sien.
export const TUES = new Int32Array(2); // [0] robots tués par la dernière onde, [1] tués ensuite dans la fenêtre (total)
export const SOIN = new Float64Array(4); // [0] PV du dernier soin, [1] total, [2] soins, [3] budget déjà rendu du bond
export const TOUCHES = new Int32Array(2); // § E5.F.14 : [0] robots touchés par la dernière onde, [1] total
function soinBond() {
  SOIN[0] = 0;
  SOIN[3] = 0; // budget du bond : PV déjà rendus pour ce bond (le plafond max vaut par bond)
  if (!SOIN_BOND.actif || !ctx.player) return;
  // § E5.F.14 (Femz, 18/11 : « oui vas-y ») : chaque robot TOUCHÉ par l'onde rend parTouche PV ; chaque robot tué par
  // l'onde ou dans la fenêtre rend parRobot PV EN PLUS ; le tout au plus max par bond
  const pv = TOUCHES[0] * (SOIN_BOND.parTouche > 0 ? SOIN_BOND.parTouche : 0) + TUES[0] * SOIN_BOND.parRobot;
  if (pv > 0) soignerPv(pv);
}
// § E5.F : robots touchés par l'onde, marqués SOIN_BOND.fenetre s — mesuré en vraie partie, l'onde (2 PV, règle de Femz :
// dégâts du dash symboliques) ne tue aucun robot aux vagues 5, 10 et 20 : sans cette fenêtre, le soin ne viendrait jamais.
// Un robot marqué qui meurt dans la fenêtre (par n'importe quelle arme) compte comme tué par le bond.
const MK_CAP = 64;
const MK_I = new Int32Array(MK_CAP);
const MK_U = new Int32Array(MK_CAP);
const MK_T = new Float64Array(MK_CAP);
const MK_N = new Int32Array(1);
function marquerSoin(i) {
  if (!SOIN_BOND.actif || !(SOIN_BOND.fenetre > 0) || MK_N[0] >= MK_CAP) return;
  const k = MK_N[0]++;
  MK_I[k] = i;
  MK_U[k] = E.uid[i];
  MK_T[k] = SOIN_BOND.fenetre;
}
function soinTic(dt) {
  let morts = 0;
  for (let k = MK_N[0] - 1; k >= 0; k--) {
    const i = MK_I[k];
    const mort = E.alive[i] === 0 || E.uid[i] !== MK_U[k] ? 1 : 0;
    MK_T[k] -= dt;
    if (mort === 1) morts++;
    if (mort === 1 || MK_T[k] <= 0) {
      const last = --MK_N[0];
      MK_I[k] = MK_I[last];
      MK_U[k] = MK_U[last];
      MK_T[k] = MK_T[last];
    }
  }
  if (morts > 0) {
    TUES[1] += morts;
    soigner(morts);
  }
}
/** n robots tués par le bond : n × parRobot PV, dans le budget max du bond, jamais au-delà des PV max. */
function soigner(n) {
  soignerPv(n * SOIN_BOND.parRobot);
}
/** pv PV au Bastion, dans le budget max du bond, jamais au-delà des PV max (chiffre vert, éclat). */
function soignerPv(montant) {
  if (!ctx.player) return;
  ARGF[F_V] = montant;
  if (ARGF[F_V] > SOIN_BOND.max - SOIN[3]) ARGF[F_V] = SOIN_BOND.max - SOIN[3];
  if (!(ARGF[F_V] > 0)) return;
  const pv = ctx.player.heal(ARGF[F_V]);
  SOIN[0] += pv;
  SOIN[3] += pv;
  SOIN[1] += pv;
  if (!(pv > 0)) return;
  SOIN[0] = pv;
  SOIN[2]++;
  // § E5.Q (B14) : « +N », lueur verte et éclat de la barre par src/soin-heros.js (player.heal) ; plus l'anneau du
  // réparateur (il signale le soin d'un ROBOT)
}

// ----- Shinobi : téléportation courte + leurre -------------------------------------------------------------------------
function ombre() {
  const O = DA.ombre;
  const x0 = P.x;
  const z0 = P.z;
  ctx.world.resolve(x0 + P.dashDirX * O.distance, z0 + P.dashDirZ * O.distance, P.radius, RES);
  for (let p = 0; p < O.bouffees; p++) {
    const a = (p / O.bouffees) * Math.PI * 2;
    ctx.fx.spawnPuff(x0 + Math.cos(a) * 0.35, 0.5 + 0.12 * (p & 1), z0 + Math.sin(a) * 0.35, O.fumee);
  }
  P.x = RES[0];
  P.z = RES[1];
  P.vx = P.dashDirX * 6.5 * 0.5; // il réapparaît en mouvement (pas d'arrêt sec)
  P.vz = P.dashDirZ * 6.5 * 0.5;
  for (let p = 0; p < O.bouffees >> 1; p++) {
    const a = (p / (O.bouffees >> 1)) * Math.PI * 2;
    ctx.fx.spawnPuff(P.x + Math.cos(a) * 0.3, 0.6, P.z + Math.sin(a) * 0.3, O.fumee);
  }
  if (P.invulnT < O.invuln) P.invulnT = O.invuln;
  LE[0] = x0;
  LE[1] = z0;
  LE[2] = O.leurreS;
  LE[3] = 0;
  N[4]++;
  ctx.audio.play(SFX.SMOKE, x0, z0);
  ctx.fx.spawnRing(x0, z0, 1.1, O.anneau, 0.5);
}

/** Chaque image de jeu (player.update, après le déplacement) : traînée de la glissade et leurre du pas de l'ombre. */
export function update(dt) {
  if (MK_N[0] > 0) soinTic(dt); // § E5.F
  if (TR[4] > 0) traineeTic(dt);
  if (LE[2] > 0) leurreTic(dt);
}

function traineeTic(dt) {
  const G = DA.glissade;
  TR[4] -= dt;
  TR[5] -= dt;
  TR[6] -= dt;
  const dx = TR[2] - TR[0];
  const dz = TR[3] - TR[1];
  const L = Math.sqrt(dx * dx + dz * dz);
  if (TR[6] <= 0 && L > 0.2) {
    // arcs électriques le long de la traînée (style ARC de l'EMP, bleu) : deux segments au hasard sur la ligne
    TR[6] = G.arcEvery;
    for (let k = 0; k < 2; k++) {
      const u = rand() * 0.8;
      V.Q[0] = TR[0] + dx * u;
      V.Q[1] = 0.12;
      V.Q[2] = TR[1] + dz * u;
      V.Q[4] = dx / L;
      V.Q[5] = 0;
      V.Q[6] = dz / L;
      V.Q[7] = L * (0.15 + rand() * 0.2);
      V.arc(0);
    }
  }
  if (TR[5] > 0) return;
  TR[5] = G.tic;
  if (L < 0.2) return;
  const n = ctx.grid.querySegment(TR[0], TR[1], TR[2], TR[3], G.demiLargeur, OUT, OUT.length);
  for (let q = 0; q < n; q++) {
    const i = OUT[q];
    if (E.alive[i] === 0 || E.sus[i] !== 0 || E.type[i] === ENEMY.BOSS) continue; // § E4.F : repli (1) ou garé (2)
    ARGF[F_V] = G.ralenti;
    ARGF[F_T] = G.ralentiS;
    ctx.enemies.applySlowF(i);
    N[0]++;
    if (G.degats > 0) {
      ARGF[F_V] = G.degats;
      ARGF[F_SX] = E.x[i];
      ARGF[F_SZ] = E.z[i];
      if (ctx.damage.hitEnemyF(i, DMG_SRC.ITEM, DMG.NO_CRIT | DMG.NO_NUMBER | DMG.BYPASS_SHIELD | DMG.NO_IMPACT) > 0) N[1] += G.degats;
    }
  }
}

function leurreTic(dt) {
  const O = DA.ombre;
  LE[2] -= dt;
  LE[3] -= dt;
  if (LE[3] <= 0) {
    LE[3] = O.bouffeeEvery;
    ctx.fx.spawnPuff(LE[0], 0.7, LE[1], O.fumee);
  }
  // les robots proches sont tirés vers le leurre (impulsion / masse, comme un recul inversé) : ils perdent le héros 1 s
  const n = ctx.grid.queryCircle(LE[0], LE[1], O.leurreRayon, OUT, OUT.length);
  let k = 0;
  for (let q = 0; q < n; q++) {
    const i = OUT[q];
    if (E.alive[i] === 0 || E.sus[i] !== 0 || E.type[i] === ENEMY.BOSS) continue; // § E4.F : repli (1) ou garé (2)
    const dx = LE[0] - E.x[i];
    const dz = LE[1] - E.z[i];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.6 || d > O.leurreRayon) continue;
    ARGF[F_DX] = dx / d;
    ARGF[F_DZ] = dz / d;
    ARGF[F_V] = O.attraction * dt;
    ctx.enemies.applyKnockbackF(i);
    k++;
  }
  N[5] += k;
}

/** Tests : relevés et état. */
export function inspect(out = {}) {
  out.ralentis = N[0];
  out.degatsTrainee = N[1];
  out.repousses = N[2];
  out.degatsOnde = N[3];
  out.teleports = N[4];
  out.attires = N[5];
  out.degatsLeurre = N[6];
  out.ondes = N[7];
  out.trainees = N[8];
  out.trainee = TR[4] > 0 ? { x0: TR[0], z0: TR[1], x1: TR[2], z1: TR[3], vie: TR[4] } : null;
  out.leurre = LE[2] > 0 ? { x: LE[0], z: LE[1], vie: LE[2] } : null;
  out.dash = { vitesse: DASH[0], hauteur: DASH[1], duree: DASH[2] };
  out.soin = { dernier: SOIN[0], total: SOIN[1], soins: SOIN[2], tuesOnde: TUES[0], tuesFenetre: TUES[1], marques: MK_N[0], touches: TOUCHES[1] }; // § E5.F
  return out;
}
