// PLAN ADDICTIF, ÉTAPE 2, CHANTIER D : agents.js — les trois agents (contrat : ARCHITECTURE.md § E2.D).
// Un agent = le même modèle de héros avec une teinte d'accent, une arme signature de départ, un profil de stats et un
// passif qui change une règle. Tout passe par « mods » (state.js) : ce module y écrit au début de la partie, APRÈS
// progression.reset() (qui remet mods à zéro) et AVANT weapons.reset() et player.reset() (main.resetAll).
// L'agent courant est run.agent : aucun reset ne le remet à zéro (« Rejouer » le garde).
// Aucune allocation : rien ici ne tourne en combat, sauf excludes() (un entier comparé) et onModsChanged() (à un choix).
// Étape 3, chantier N (§ E3.N) : arsenal de 6 armes par agent ; allows(w) / excludes(w) filtrent les coffres.
import { AGENTS, AGENT_COUNT, ARSENALS, ARSENAL_RULES, CHESTS, PLAYER, WEAPON_COUNT, WEAPON_KEYS, agentSignature } from './config.js';
import { appliquerTextesAgent } from './config.js'; // § E5.X3 : textes propres à l'agent (bond du Bastion)
import { BANS, mods, run } from './state.js';
import { AGENT_OK, WEAPON_OK } from './meta.js'; // § E4.A.5 : verrous de la méta

let ctx = null;
const signatures = new Int8Array(AGENT_COUNT); // arme de départ de chaque agent (WEAPON.*), résolue à l'init
const conv = new Float64Array(1); // part de mods.damageMul posée par « Conversion » (retirée avant d'être recalculée)
// § E3.N : arsenal de chaque agent — inArsenal[a * WEAPON_COUNT + w] = 1 si l'arme w est dans l'arsenal de l'agent a
// (clés résolues à l'init par WEAPON_KEYS.indexOf ; une clé inconnue est ignorée).
const inArsenal = new Uint8Array(AGENT_COUNT * WEAPON_COUNT);
const arsenalList = new Int8Array(AGENT_COUNT * WEAPON_COUNT).fill(-1);
const arsenalSize = new Uint8Array(AGENT_COUNT);
// Femz, 17/11 (ARSENAL_RULES.reservees) : reserveA[w] = agent à qui l'arme w est réservée, -1 si aucune
const reserveA = new Int8Array(WEAPON_COUNT).fill(-1);

export function init(context) {
  ctx = context;
  for (let a = 0; a < AGENT_COUNT; a++) signatures[a] = agentSignature(a);
  inArsenal.fill(0);
  arsenalList.fill(-1);
  for (let a = 0; a < AGENT_COUNT; a++) {
    const keys = ARSENALS[AGENTS[a].key] || [];
    let n = 0;
    for (const k of keys) {
      const w = WEAPON_KEYS.indexOf(k);
      if (w < 0 || inArsenal[a * WEAPON_COUNT + w] === 1) continue;
      inArsenal[a * WEAPON_COUNT + w] = 1;
      arsenalList[a * WEAPON_COUNT + n++] = w;
    }
    // la signature est toujours dans l'arsenal (même si la table l'oublie)
    const s = signatures[a];
    if (inArsenal[a * WEAPON_COUNT + s] === 0) {
      inArsenal[a * WEAPON_COUNT + s] = 1;
      arsenalList[a * WEAPON_COUNT + n++] = s;
    }
    arsenalSize[a] = n;
  }
  reserveA.fill(-1);
  const R = ARSENAL_RULES.reservees || {};
  for (let a = 0; a < AGENT_COUNT; a++) {
    for (const k of R[AGENTS[a].key] || []) {
      const w = WEAPON_KEYS.indexOf(k);
      if (w >= 0) reserveA[w] = a;
    }
  }
}

/** Pose le profil et le passif de l'agent courant dans mods (remis à zéro juste avant par progression.reset()). */
export function reset() {
  if (!(run.agent >= 0 && run.agent < AGENT_COUNT)) run.agent = 0;
  appliquerTextesAgent(run.agent); // § E5.X3
  const A = AGENTS[run.agent];
  const S = A.stats;
  const Pv = A.passive;
  mods.maxHpAdd += S.maxHp - PLAYER.maxHp;
  mods.moveSpeedMul *= S.speedMul;
  mods.damageTakenMul *= S.damageTakenMul;
  mods.dashCdMul *= S.dashCdMul;
  mods.critDashCut = Pv.critDashCut > 0 ? Pv.critDashCut : 0;
  mods.critNear = Pv.critNear > 0 ? Pv.critNear : 0;
  mods.resistToDamage = Pv.resistToDamage > 0 ? Pv.resistToDamage : 0;
  conv[0] = 0;
  onModsChanged();
}

/**
 * « Conversion » : mods.damageMul porte resistToDamage × (1 − mods.damageTakenMul). À rappeler chaque fois que
 * damageTakenMul change (progression.applyChoice, avant weapons.markDirty()). Sans ce passif : rien.
 */
export function onModsChanged() {
  const want = mods.resistToDamage > 0 ? mods.resistToDamage * (1 - mods.damageTakenMul) : 0;
  if (want !== conv[0]) {
    mods.damageMul += want - conv[0];
    conv[0] = want;
  }
}

export function getAgent() {
  return run.agent;
}

/** Choisit l'agent de la PROCHAINE partie (appliqué par reset()). false si l'identifiant n'existe pas. */
export function setAgent(id) {
  if (!Number.isInteger(id) || id < 0 || id >= AGENT_COUNT) return false;
  if (AGENT_OK[id] === 0) return false; // § E4.A.5 : agent verrouillé (méta)
  run.agent = id;
  return true;
}

/** Arme de départ de l'agent courant (WEAPON.*). */
export function getSignature() {
  return signatures[run.agent];
}

/** § E3.N : l'arme w est dans l'arsenal de l'agent courant. */
export function inArsenalOf(w) {
  if (!(w >= 0 && w < WEAPON_COUNT)) return false;
  return inArsenal[run.agent * WEAPON_COUNT + w] === 1;
}

/**
 * § E3.N : l'arsenal de l'agent courant est épuisé — chacune de ses armes est possédée, absorbée ou bannie (lu dans
 * ctx.weapons.owned, ctx.weapons.absorbed si B l'a fusionné, BANS.weapons), et il reste un emplacement libre.
 */
export function arsenalExhausted() {
  if (!ARSENAL_RULES.exhaustedOpensAll) return false;
  const W = ctx && ctx.weapons;
  if (!W || !W.owned) return false;
  if (typeof W.getSlotCount === 'function' && W.getSlotCount() >= CHESTS.weaponSlots) return false;
  const bans = BANS.weapons;
  const absorbed = W.absorbed || null;
  const o = run.agent * WEAPON_COUNT;
  for (let k = 0; k < arsenalSize[run.agent]; k++) {
    const w = arsenalList[o + k];
    if (W.owned[w] === 1) continue;
    if (absorbed !== null && absorbed[w] === 1) continue;
    if (bans !== null && bans[w] === 1) continue;
    if (WEAPON_OK[w] === 0) continue; // § E4.A.5 : une arme verrouillée compte comme indisponible
    return false;
  }
  return true;
}

/** § E3.N : les coffres (et tout ce qui donne une arme) peuvent donner l'arme w à l'agent courant. */
export function allows(w) {
  if (inArsenalOf(w)) return true;
  if (w >= 0 && w < WEAPON_COUNT && reserveA[w] >= 0 && reserveA[w] !== run.agent) return false; // arme réservée à un autre agent
  return arsenalExhausted();
}


/** Ancien nom (étape 2) gardé : vrai si les coffres NE donnent PAS l'arme w (= !allows(w)). */
export function excludes(w) {
  return !allows(w);
}

/** Écrit l'arsenal de l'agent courant (WEAPON.*, signature en premier) dans out ; rend sa taille. */
export function arsenal(out) {
  const n = arsenalSize[run.agent];
  for (let k = 0; k < n; k++) out[k] = arsenalList[run.agent * WEAPON_COUNT + k];
  return n;
}

/** Arsenal de l'agent a (tests, écran de choix). */
export function arsenalOf(a, out) {
  if (!(a >= 0 && a < AGENT_COUNT)) return 0;
  const n = arsenalSize[a];
  for (let k = 0; k < n; k++) out[k] = arsenalList[a * WEAPON_COUNT + k];
  return n;
}

export function inspect(out) {
  const A = AGENTS[run.agent];
  out.id = run.agent;
  out.key = A.key;
  out.name = A.name;
  out.accent = A.accent;
  out.signature = signatures[run.agent];
  out.signatureKey = WEAPON_KEYS[signatures[run.agent]];
  out.signatureWanted = A.signatureKey; // clé du contrat (différente de signatureKey tant que l'arme n'est pas dans le jeu)
  out.passive = A.passive.key;
  out.conversion = conv[0];
  out.signatures = Array.from(signatures);
  const ex = []; // armes que les coffres ne donnent pas à cet agent (hors de son arsenal, § E3.N)
  for (let w = 0; w < WEAPON_KEYS.length; w++) if (excludes(w)) ex.push(w);
  out.excluded = ex;
  const ar = [];
  arsenal(ar);
  out.arsenal = ar; // § E3.N
  out.arsenalKeys = ar.map((w) => WEAPON_KEYS[w]);
  out.arsenalExhausted = arsenalExhausted();
}
