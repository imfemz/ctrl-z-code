// PLAN ADDICTIF, ÉTAPE 4, CHANTIER A : defis.js — compteurs de la partie et les 21 succès (ARCHITECTURE.md § E4.A.4).
// En combat, rien n'est alloué : compteurs dans des tableaux typés créés à l'import, branchements d'une ligne (entiers
// seulement) dans damage, enemies, weapons, items et progression ; conditions codées par des entiers (DEFI_COND) dans
// des Int32Array remplies à l'init, testées toutes les DEFIS.periode s par tick(dt) (main, en PLAYING). Un succès réussi
// est notifié tout de suite (ui.toastSucces) et ÉCRIT au prochain moment hors combat (flush : début de WAVE_CLEAR, fin
// de partie, pagehide), par meta.grantSucces puis meta.flush.
import {
  AGENTS, DEFIS, DEFI_COND, DEFI_COUNT, DEFI_RECOMP, EFLAG, ENEMY, ENEMY_COUNT, EVOLUTIONS, FUSIONS, ITEM_COUNT, ITEMS,
  UTILITIES, WEAPONS, WEAPON_COUNT, WEAPON_KEYS, ITEM_KEYS, bossRank, skinNom,
} from './config.js';
import { P, run } from './state.js';
import * as meta from './meta.js';

let ctx = null;

// Compteurs de la partie (remis à zéro par reset)
export const killsByType = new Int32Array(ENEMY_COUNT); // robots détruits par type (hors purge)
export const vuRobot = new Uint8Array(ENEMY_COUNT); // Collection : robots rencontrés (enemies.spawn)
export const vuArme = new Uint8Array(WEAPON_COUNT); // armes obtenues (weapons.give)
export const vuObjet = new Uint8Array(ITEM_COUNT); // objets obtenus (items.add)
export const FRAG = new Int32Array(1); // fragments gagnés dans la partie (progression.addFragments)
const C_KILLS = 0;
const C_BOSS = 1;
const C_BOSS_RANG = 2; // rang le plus haut d'un boss détruit
const C_ELITES = 3;
const C_VAGUES = 4; // § E4.I.2 : vagues TERMINÉES dans la partie (entrées en WAVE_CLEAR, mort d'un boss comprise)
const CNT = new Int32Array(5);
const lowHp = new Float64Array(1); // s cumulées sous DEFIS.pvBas × PV max (en PLAYING)
const acc = new Float64Array(1); // s depuis le dernier test des conditions
export const doneRun = new Uint8Array(DEFI_COUNT); // réussi dans cette partie
const already = new Uint8Array(DEFI_COUNT); // réussi avant cette partie : jamais retesté, jamais renotifié
const granted = new Uint8Array(DEFI_COUNT); // déjà passé à meta.grantSucces

// Paramètres des conditions (init)
const COND = new Int32Array(DEFI_COUNT);
const NEED = new Int32Array(DEFI_COUNT);
const ARG = new Int32Array(DEFI_COUNT);
const AGENT_REQ = new Int32Array(DEFI_COUNT);
const FIN = new Uint8Array(DEFI_COUNT);
const baseCumul = new Int32Array(DEFI_COUNT); // part « toutes parties » lue dans la méta au départ de la partie

// Textes des notifications (construits une fois, § E4.0.5) : lus par ui.toastSucces
export const toastName = [];
export const toastReward = [];
const summary = { killsByType, boss: 0, elites: 0, coffres: 0, fragments: 0, vagues: 0, mortCause: 0, mort: false }; // mort : § E5.X10

/** Nom affiché de la récompense d'une clé ('agent:bastion' → 'Bastion'). Hors combat. */
export function rewardName(key) {
  const i = key.indexOf(':');
  const kind = key.slice(0, i);
  const k = key.slice(i + 1);
  if (kind === 'agent') return (AGENTS.find((a) => a.key === k) || { name: k }).name;
  if (kind === 'arme') return WEAPONS[WEAPON_KEYS.indexOf(k)] ? WEAPONS[WEAPON_KEYS.indexOf(k)].name : k;
  if (kind === 'objet') return ITEMS[ITEM_KEYS.indexOf(k)] ? ITEMS[ITEM_KEYS.indexOf(k)].name : k;
  if (kind === 'util') {
    const u = UTILITIES.list.find((x) => x.key === k);
    const n = u ? u.name.toLowerCase() : k;
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  if (kind === 'evo') return (EVOLUTIONS.find((e) => e.key === k) || { name: k }).name;
  if (kind === 'fusion') return (FUSIONS.find((f) => f.key === k) || { name: k }).name;
  if (kind === 'skin') {
    const j = k.indexOf(':');
    return skinNom(k.slice(0, j), k.slice(j + 1));
  }
  return k;
}

/** Ligne de récompense de la notification (« Agent débloqué : Bastion », « En vente : Berserk »…). Hors combat. */
export function rewardText(s) {
  const D = DEFIS.list[s];
  const pre = D.sorte === DEFI_RECOMP.DEBLOQUE && D.reward.startsWith('agent:') ? 'Agent débloqué : ' : D.reward.startsWith('skin:') ? 'Skin débloqué : ' : DEFIS.rewardPrefix[D.sorte];
  return pre + rewardName(D.reward);
}

export function init(context) {
  ctx = context;
  for (let s = 0; s < DEFI_COUNT; s++) {
    const D = DEFIS.list[s];
    COND[s] = D.cond;
    NEED[s] = D.n;
    ARG[s] = D.arg;
    AGENT_REQ[s] = D.agent;
    FIN[s] = D.finVague ? 1 : 0;
    toastName[s] = D.name;
    toastReward[s] = rewardText(s);
  }
}

/** main.resetAll (hors combat) : tout à zéro, base des cumuls relue, succès déjà réussis sautés. */
export function reset() {
  killsByType.fill(0);
  vuRobot.fill(0);
  vuArme.fill(0);
  vuObjet.fill(0);
  FRAG[0] = 0;
  CNT.fill(0);
  lowHp[0] = 0;
  acc[0] = 0;
  doneRun.fill(0);
  granted.fill(0);
  const S = meta.getStats();
  for (let s = 0; s < DEFI_COUNT; s++) {
    already[s] = meta.hasSucces(s) ? 1 : 0;
    const c = COND[s];
    baseCumul[s] =
      c === DEFI_COND.KILLS_CUMUL ? S.kills : c === DEFI_COND.KILLS_TYPE ? S.killsByType[ARG[s]] || 0 : c === DEFI_COND.COFFRES ? S.coffres : c === DEFI_COND.ELITES ? S.elites : 0;
  }
  meta.beginRun();
}

/** damage.killEnemyF / killBatchF (hors purge) : un robot de type t détruit ; eflags = E.flags du robot. Entiers. */
export function onKillF(t, eflags) {
  CNT[C_KILLS]++;
  killsByType[t]++;
  if ((eflags & EFLAG.ELITE) !== 0) CNT[C_ELITES]++;
  if (t === ENEMY.BOSS) {
    CNT[C_BOSS]++;
    const r = bossRank(run.wave);
    if (r > CNT[C_BOSS_RANG]) CNT[C_BOSS_RANG] = r;
  }
}

function coffresOuverts() {
  const o = ctx.chests.openedBySize;
  let n = 0;
  for (let k = 0; k < o.length; k++) n += o[k];
  return n;
}

function armesEnMain() {
  const o = ctx.weapons.owned;
  let n = 0;
  for (let w = 0; w < WEAPON_COUNT; w++) n += o[w];
  return n;
}

function objetsEnMain() {
  let n = 0;
  for (let i = 0; i < ITEM_COUNT; i++) if (ctx.items.getStacks(i) > 0) n++;
  return n;
}

/** Valeur entière de la condition du succès s (comparée à NEED[s]). */
function value(s) {
  switch (COND[s]) {
    case DEFI_COND.VAGUE:
      return run.wave;
    case DEFI_COND.KILLS_CUMUL:
      return baseCumul[s] + CNT[C_KILLS];
    case DEFI_COND.KILLS_TYPE:
      return baseCumul[s] + killsByType[ARG[s]];
    case DEFI_COND.KILLS_SOURCE:
      return ctx.damage.killsBySource[ARG[s]];
    case DEFI_COND.BOSS:
      return CNT[C_BOSS];
    case DEFI_COND.BOSS_RANG:
      return CNT[C_BOSS_RANG];
    case DEFI_COND.COFFRES:
      return baseCumul[s] + coffresOuverts();
    case DEFI_COND.ARMES_EN_MAIN:
      return armesEnMain();
    case DEFI_COND.OBJETS_EN_MAIN:
      return objetsEnMain();
    case DEFI_COND.PV_BAS:
      return P.alive ? lowHp[0] | 0 : 0;
    case DEFI_COND.JACKPOT:
      return ctx.chests.openedBySize[5] | 0;
    case DEFI_COND.FRAGMENTS:
      return FRAG[0];
    case DEFI_COND.FUSION:
      return run.fusions;
    case DEFI_COND.ELITES:
      return baseCumul[s] + CNT[C_ELITES];
    case DEFI_COND.EVOLUTIONS:
      return meta.evolutionCount();
    case DEFI_COND.ARME_SEULE: {
      const w = ARG[s];
      return ctx.weapons.owned[w] === 1 && armesEnMain() === 1 && ctx.weapons.absorbed[w] === 0 ? run.wave : 0;
    }
    default:
      return 0;
  }
}

function check(finVague) {
  for (let s = 0; s < DEFI_COUNT; s++) {
    if (already[s] === 1 || doneRun[s] === 1) continue;
    if (FIN[s] === 1 && !finVague) continue;
    if (AGENT_REQ[s] >= 0 && AGENT_REQ[s] !== run.agent) continue;
    if (value(s) >= NEED[s]) {
      doneRun[s] = 1;
      ctx.ui.toastSucces(s); // notification et son (file de l'interface : une à la fois)
    }
  }
}

/** main, en PLAYING : temps sous les PV bas ; conditions testées toutes les DEFIS.periode s. */
export function tick(dt) {
  if (P.alive && P.hp < DEFIS.pvBas * P.maxHp) lowHp[0] += dt;
  acc[0] += dt;
  if (acc[0] < DEFIS.periode) return;
  acc[0] = 0;
  check(false);
}

/** § E5.V : fin d'une vague par bascule à la volée (EN combat) : succès de fin de vague évalués, SANS écriture
 *  (flush au prochain moment hors combat : main.horsCombat). */
export function onWaveTick() {
  CNT[C_VAGUES]++; // § E4.I.2 : une vague terminée de plus
  check(true);
}

/** Début de WAVE_CLEAR (hors combat) : succès de fin de vague (« puis survivre à la vague »), puis écriture. */
export function onWaveClear() {
  CNT[C_VAGUES]++; // § E4.I.2 : une vague terminée de plus (la monnaie paie les vagues terminées)
  check(true);
  flush();
}

/** Hors combat : succès neufs passés à la méta (récompense, Cycles de la partie), Collection, écriture. */
export function flush() {
  for (let s = 0; s < DEFI_COUNT; s++) {
    if (doneRun[s] === 1 && granted[s] === 0) {
      granted[s] = 1;
      meta.grantSucces(s);
    }
  }
  for (let t = 0; t < ENEMY_COUNT; t++) if (vuRobot[t] === 1) meta.see('robot:' + t);
  for (let w = 0; w < WEAPON_COUNT; w++) if (vuArme[w] === 1) meta.see('arme:' + WEAPON_KEYS[w]);
  for (let i = 0; i < ITEM_COUNT; i++) if (vuObjet[i] === 1) meta.see('objet:' + ITEM_KEYS[i]);
  meta.flush();
}

/**
 * Fin de partie (une fois : garde de meta.finishRun) : écriture des succès, puis Cycles et statistiques. mortCause :
 * § E5.Q, cause du coup mortel (CAUSE.*, damage.MORT_CAUSE) quand la partie finit par la mort du héros, 0 sinon.
 */
export function finishRun(mortCause = 0) {
  if (meta.isRunCounted()) return null;
  flush();
  summary.mortCause = mortCause;
  summary.mort = arguments.length > 0; // § E5.X10 : seul enterGameOver passe la cause (quitter, recommencer, fermer : abandon)
  summary.boss = CNT[C_BOSS];
  summary.elites = CNT[C_ELITES];
  summary.coffres = coffresOuverts();
  summary.fragments = FRAG[0];
  summary.vagues = CNT[C_VAGUES];
  return meta.finishRun(run, summary);
}

/** Progression chiffrée du succès s pour le hub : { valeur, seuil, fait } (hors combat). */
export function progress(s, out = {}) {
  out.seuil = NEED[s];
  out.fait = meta.hasSucces(s) || doneRun[s] === 1;
  out.valeur = Math.min(NEED[s], value(s));
  return out;
}

/** Tests (__game.metaForce) : pose les compteurs qui rendent la condition du succès s vraie. Rend false si impossible. */
export function debugForce(s) {
  if (!(s >= 0 && s < DEFI_COUNT)) return false;
  const n = NEED[s];
  switch (COND[s]) {
    case DEFI_COND.VAGUE:
    case DEFI_COND.ARME_SEULE:
      if (run.wave < n) run.wave = n; // test seulement : la vague affichée change, pas le calendrier en cours
      break;
    case DEFI_COND.KILLS_CUMUL:
      CNT[C_KILLS] = Math.max(CNT[C_KILLS], n - baseCumul[s]);
      break;
    case DEFI_COND.KILLS_TYPE:
      killsByType[ARG[s]] = Math.max(killsByType[ARG[s]], n - baseCumul[s]);
      break;
    case DEFI_COND.KILLS_SOURCE:
      ctx.damage.killsBySource[ARG[s]] = Math.max(ctx.damage.killsBySource[ARG[s]], n);
      break;
    case DEFI_COND.BOSS:
      CNT[C_BOSS] = Math.max(CNT[C_BOSS], n);
      break;
    case DEFI_COND.BOSS_RANG:
      CNT[C_BOSS_RANG] = Math.max(CNT[C_BOSS_RANG], n);
      break;
    case DEFI_COND.COFFRES:
      ctx.chests.openedBySize[1] += Math.max(0, n - baseCumul[s] - coffresOuverts());
      break;
    case DEFI_COND.ARMES_EN_MAIN:
      for (let w = 0; w < WEAPON_COUNT && armesEnMain() < n; w++) if (ctx.weapons.owned[w] === 0) ctx.weapons.unlock(w);
      break;
    case DEFI_COND.OBJETS_EN_MAIN:
      //#region e5:AL-retrait-cryogel
      for (let i = 0; i < ITEM_COUNT && objetsEnMain() < n; i++) if (ctx.items.getStacks(i) === 0 && ITEMS[i].retire !== true) ctx.items.add(i, 1); // jamais le Cryogel (retiré)
      //#endregion e5:AL-retrait-cryogel
      break;
    case DEFI_COND.PV_BAS:
      lowHp[0] = Math.max(lowHp[0], n);
      break;
    case DEFI_COND.JACKPOT:
      ctx.chests.openedBySize[5] = Math.max(1, ctx.chests.openedBySize[5]);
      break;
    case DEFI_COND.FRAGMENTS:
      FRAG[0] = Math.max(FRAG[0], n);
      break;
    case DEFI_COND.FUSION:
      run.fusions = Math.max(run.fusions, n);
      break;
    case DEFI_COND.ELITES:
      CNT[C_ELITES] = Math.max(CNT[C_ELITES], n - baseCumul[s]);
      break;
    case DEFI_COND.EVOLUTIONS:
      for (let k = 0; k < EVOLUTIONS.length && meta.evolutionCount() < n; k++) meta.discover('evolutions', k);
      break;
    default:
      return false;
  }
  return value(s) >= n;
}

export function inspect(out = {}) {
  out.killsByType = Array.from(killsByType);
  out.kills = CNT[C_KILLS];
  out.boss = CNT[C_BOSS];
  out.bossRang = CNT[C_BOSS_RANG];
  out.elites = CNT[C_ELITES];
  out.vagues = CNT[C_VAGUES];
  out.fragments = FRAG[0];
  out.lowHp = lowHp[0];
  out.doneRun = Array.from(doneRun);
  out.already = Array.from(already);
  out.granted = Array.from(granted);
  out.vuRobot = Array.from(vuRobot);
  out.vuArme = Array.from(vuArme);
  out.vuObjet = Array.from(vuObjet);
  out.values = [];
  for (let s = 0; s < DEFI_COUNT; s++) out.values.push(value(s));
  out.toastName = toastName.slice();
  out.toastReward = toastReward.slice();
  return out;
}
