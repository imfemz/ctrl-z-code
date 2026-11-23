// LOT : progression — XP, niveaux, file de choix, 10 bonus passifs, porte-monnaie (contrat : ARCHITECTURE.md § M).
// XP requise pour passer du niveau n au suivant : round(100 × n^1,5) (xpForLevel, config.js). Chaque niveau gagné
// ajoute un choix en attente ; main présente les écrans un par un (T6 à T9). Un bonus choisi écrit dans « mods »
// (state.js), que lisent player, damage, weapons et pickups : c'est le seul module qui y écrit.
import { BONUS_COUNT, PROGRESSION, SHOP, xpForLevel } from './config.js';
import { P, mods, rand, resetMods, run } from './state.js';
import { CHOICES, TEXTES_N } from './config.js'; // § E2.D : relance, passe, bannissement ; § E4.N : « par niveau »
import { BANS } from './state.js';
import { ARGF, F_V } from './state.js'; // § E5.Z : XP des gemmes passée par le registre des flottants
import { FRAG } from './defis.js'; // § E4.A : fragments gagnés dans la partie (succès « Moissonneur »)
import { RARITIES, chestRarity } from './config.js'; // § E2.F : cartes d'objet (rareté tirée comme celle d'un lot de coffre)
import { lignesCarteO } from './config.js'; // § E5.O : soin, synergie, Conversion (une ligne chacun)
import { synergieArmesX7 } from './config.js'; // § E5.X7 (H12) : armes à critiques dans « Utile avec »
import * as journal from './journal.js'; // § E5.X10 (audit I5) : cartes prises, relances, passes (journal des parties)

let ctx = null;

const stacks = new Uint8Array(BONUS_COUNT);
const REPAIR_ID = -1; // choix de repli quand tous les bonus sont au maximum

// Vue persistante, mise à jour sur place par rollChoices.
const slots = [];
// § E2.F : kind = 'bonus' | 'item' ; pour un objet : rarity, color (rareté du tirage), icon, gain (piles données), now / next
// (valeur affichée avant et après), what (ce que la valeur mesure) ; stacks = piles possédées, maxStacks = 0 (sans limite).
for (let k = 0; k < PROGRESSION.choicesPerLevel; k++) slots.push({ id: 0, key: '', name: '', desc: '', stacks: 0, maxStacks: 0, kind: 'bonus', rarity: 0, rarityName: '', color: '', icon: '', gain: 0, now: '', next: '', what: '' });
const view = { level: 1, pending: 0, choices: [], rerolls: 0, skips: 0, banishes: 0 }; // compteurs : § E2.D
const pool = new Int8Array(BONUS_COUNT);
const shown = new Int8Array(PROGRESSION.choicesPerLevel).fill(-1); // bonus du tirage précédent, qu'une relance évite (§ E2.D)
let rolled = 0; // nombre de choix du tirage en cours ; 0 = aucun tirage à valider
// § E2.F : objets déjà proposés par les cartes du tirage en cours (jamais deux fois le même), offre de travail
const takenItems = new Int16Array(PROGRESSION.choicesPerLevel).fill(-1);
const offer = { id: -1, stacks: 1, name: '', desc: '', icon: '', key: '', rarity: 0, now: '', next: '', what: '', have: -1 }; // have : § E5.L
let itemCards = true; // debug : false = bonus seulement (tests du lot progression, écrits pour les dix bonus)

export function init(context) {
  ctx = context;
}

export function reset() {
  resetMods();
  stacks.fill(0);
  run.level = PROGRESSION.startLevel;
  run.xp = 0;
  XP_REM[0] = 0; // § E5.Z
  run.xpToNext = xpForLevel(run.level);
  run.pendingChoices = 0;
  run.fragments = SHOP.startFragments;
  rolled = 0;
  // § E2.D : compteurs de la partie (communs au choix de niveau et au choix du lot d'un coffre), bannissements levés
  run.rerolls = CHOICES.rerolls;
  run.skips = CHOICES.skips;
  run.banishes = CHOICES.banishes;
  BANS.bonuses.fill(0);
  BANS.items.fill(0);
  BANS.weapons.fill(0);
  shown.fill(-1);
}

// § E5.Z : reste de l'XP des gemmes (fraction pas encore créditée) — tableau typé : 0 octet par image
const XP_REM = new Float64Array(1);

/**
 * § E5.Z — XP d'une ou plusieurs gemmes ramassées (pickups : collecte de l'image, crédit d'office, fin de vague) :
 * × mods.xpGainMul (carte Apprentissage). L'XP ENTIÈRE est créditée, la fraction est reportée à la gemme suivante
 * (une gemme de 1 XP à +10 % vaut 1,1 : sans report l'arrondi la ramènerait toujours à 1) ; run.xp reste entier.
 * L'XP brute est lue dans ARGF[F_V] (registre des arguments flottants, state.js) : appelé à chaque image où quelque
 * chose est ramassé, un flottant passé en argument serait emballé (§ Z nonies).
 */
export function addGemXpF() {
  const v = ARGF[F_V] * mods.xpGainMul + XP_REM[0];
  const whole = Math.floor(v + 1e-9); // 10 × 1,1 vaut 11,000000000000002 ou 10,999… en flottants : 11 dans les deux cas
  XP_REM[0] = v > whole ? v - whole : 0;
  addXp(whole);
}

/** Ajoute de l'XP ; chaque niveau franchi ajoute un choix en attente. Le surplus est reporté. */
export function addXp(amount) {
  if (!(amount > 0)) return;
  run.xp += amount;
  while (run.xp >= run.xpToNext) {
    run.xp -= run.xpToNext;
    run.level++;
    run.xpToNext = xpForLevel(run.level);
    run.pendingChoices++;
  }
}

export function addFragments(n) {
  if (!(n > 0)) return;
  const k = Math.round(n);
  run.fragments += k;
  FRAG[0] += k; // § E4.A
}

/** false, sans rien retirer, si le solde est insuffisant. */
export function spendFragments(n) {
  if (!(n >= 0) || run.fragments < n) return false;
  run.fragments -= n;
  return true;
}

/**
 * Tire au plus PROGRESSION.choicesPerLevel bonus distincts parmi ceux qui ne sont pas à leur plafond, et mémorise
 * le tirage. Renvoie la vue persistante { level, pending, choices } : level = niveau que CE choix récompense,
 * pending = choix qui resteront après celui-ci. Tous les bonus au plafond : un seul choix, « Réparation ».
 */
export function rollChoices() {
  return roll(false);
}

/**
 * Le tirage. avoid (relance, § E2.D) : les bonus du tirage précédent sont écartés tant qu'il reste assez de bonus
 * pour remplir les cartes sans eux. Un bonus banni (BANS.bonuses) n'entre jamais dans le tirage.
 */
function roll(avoid) {
  let n = 0;
  for (let b = 0; b < BONUS_COUNT; b++) {
    if (stacks[b] < PROGRESSION.bonuses[b].maxStacks && BANS.bonuses[b] === 0) pool[n++] = b;
  }
  if (avoid && n - rolled >= PROGRESSION.choicesPerLevel) {
    let m = 0;
    for (let k = 0; k < n; k++) {
      const b = pool[k];
      let seen = false;
      for (let j = 0; j < shown.length; j++) if (shown[j] === b) seen = true;
      if (!seen) pool[m++] = b;
    }
    n = m;
  }
  view.level = run.level - run.pendingChoices + 1;
  view.pending = run.pendingChoices > 0 ? run.pendingChoices - 1 : 0;
  view.rerolls = run.rerolls;
  view.skips = run.skips;
  view.banishes = run.banishes;
  shown.fill(-1);
  takenItems.fill(-1);
  const items = itemCards && ctx.items ? ctx.items : null;
  // view.choices est réécrit sur place (jamais vidé puis rempli par push : règle 5 du § T) ; sa longueur n'est
  // touchée que si le nombre de choix change.
  if (items !== null) {
    // § E2.F : chaque carte est un objet avec la probabilité CHOICES.itemShare, sinon un bonus ; au moins une carte de
    // bonus tant qu'il en reste ; plus de bonus : des objets ; plus rien : « Réparation ».
    const cards = PROGRESSION.choicesPerLevel;
    let made = 0;
    let bonusCards = 0;
    let left = n; // bonus encore tirables (sans remise : les tirés sont rangés en tête du pool)
    for (let k = 0; k < cards; k++) {
      const forceBonus = k === cards - 1 && bonusCards === 0 && left > 0;
      const wantItem = !forceBonus && rand() < CHOICES.itemShare;
      if (wantItem && drawItemCard(made, items)) {
        made++;
        continue;
      }
      if (left > 0) {
        const pick = bonusCards + Math.floor(rand() * left);
        const b = pool[pick];
        pool[pick] = pool[bonusCards];
        pool[bonusCards] = b;
        drawCard(made, b);
        bonusCards++;
        left--;
        made++;
      } else if (!wantItem && drawItemCard(made, items)) made++;
    }
    if (made > 0) {
      rolled = made;
      if (view.choices.length !== rolled) view.choices.length = rolled;
      return view;
    }
    n = 0; // ni bonus ni objet : « Réparation »
  }
  if (n === 0) {
    const s = slots[0];
    s.id = REPAIR_ID;
    s.key = 'repair';
    s.name = 'Réparation';
    s.desc = 'Soigne ' + Math.round(PROGRESSION.fallbackHealFraction * 100) + ' % des PV max';
    s.stacks = 0;
    s.maxStacks = 0;
    s.kind = 'bonus';
    s.icon = 'sr-b-default';
    view.choices[0] = s;
    rolled = 1;
    if (view.choices.length !== rolled) view.choices.length = rolled;
    return view;
  }
  const want = n < PROGRESSION.choicesPerLevel ? n : PROGRESSION.choicesPerLevel;
  for (let k = 0; k < want; k++) {
    // tirage sans remise : échange avec la fin du pool
    const pick = k + Math.floor(rand() * (n - k));
    const b = pool[pick];
    pool[pick] = pool[k];
    pool[k] = b;
    drawCard(k, b);
  }
  rolled = want;
  if (view.choices.length !== rolled) view.choices.length = rolled;
  return view;
}

/**
 * Remplit la carte n° k du tirage avec le bonus b (§ E2.D : fonction à part — le chantier F y ajoutera les cartes
 * d'objet, tirées avec CHOICES.itemShare).
 */
function drawCard(k, b) {
  const B = PROGRESSION.bonuses[b];
  const s = slots[k];
  s.id = B.id;
  s.key = B.key;
  s.name = B.name;
  s.desc = B.effet ? B.effet + '\n' + B.desc + TEXTES_N.parNiveauBonus : B.desc; // 16/11 (13b) : phrase d'effet, puis le chiffre
  //#region e5:O-noms-guide
  // § E5.O : soin du Blindage, synergie (« Utile avec : … ») et gain réel de Conversion, chacun sur sa ligne (ouverture du choix)
  s.desc += lignesCarteO(b, run.agent, mods.damageTakenMul);
  //#endregion e5:O-noms-guide
  // § E5.X7 (H12) : la ligne « Utile avec » de la carte Viseur cite aussi Katana et Fumigènes quand l'arme est possédée
  if (ctx.weapons && ctx.weapons.owned) s.desc += synergieArmesX7(b, ctx.weapons.owned);
  s.stacks = stacks[b];
  s.maxStacks = B.maxStacks;
  s.kind = 'bonus';
  s.icon = 'sr-b-' + B.key;
  view.choices[k] = s;
  shown[k] = b;
}

/**
 * § E2.F — carte d'objet n° k : un objet proposable par items.rollOffer (nouveau si la rangée a de la place, possédé
 * sinon ; jamais banni ; jamais deux fois dans le même tirage), à la rareté tirée comme celle d'un lot de coffre de la
 * vague en cours. false si aucun objet n'est proposable à cette rareté (la carte devient un bonus).
 */
function drawItemCard(k, items) {
  const r = chestRarity(run.wave > 0 ? run.wave : 1, rand(), 0);
  offer.id = -1;
  if (!items.rollOffer(r, offer, rand, takenItems) || offer.id < 0) return false;
  const s = slots[k];
  s.id = offer.id;
  s.key = offer.key;
  s.name = offer.name;
  s.desc = offer.desc;
  s.stacks = offer.have >= 0 ? offer.have : items.getStacks(offer.id); // § E5.L : un objet fusionné compte les exemplaires de son 1er ingrédient
  s.maxStacks = 0;
  s.kind = 'item';
  s.rarity = r;
  s.rarityName = RARITIES[r].name;
  s.color = '#' + RARITIES[r].color.toString(16).padStart(6, '0');
  s.icon = offer.icon;
  s.gain = offer.stacks;
  s.now = offer.now;
  s.next = offer.next;
  s.what = offer.what;
  s.fuseMate = items.fusionMate ? items.fusionMate(offer.id) : false; // § E3.F : indice « ? » (fusionne avec un objet possédé)
  s.fuseHint = items.fusionHint ? items.fusionHint(offer.id) : '';
  view.choices[k] = s;
  takenItems[k] = offer.id;
  return true;
}

/** Debug : cartes d'objet au choix de niveau (true par défaut) ; false = bonus seulement, comme avant le chantier F. */
export function debugItemCards(on) {
  itemCards = !!on;
  return itemCards;
}

/**
 * Relance (§ E2.D) : retire de nouveau les cartes du choix en cours. false, sans rien consommer : aucun tirage en
 * cours, ou plus de relance. Renvoie sinon la vue du nouveau tirage.
 */
export function rerollChoices() {
  if (rolled <= 0 || run.pendingChoices <= 0 || run.rerolls <= 0) return false;
  run.rerolls--;
  journal.relance(); // § E5.X10 : stats.relances
  return roll(true);
}

/**
 * Passe (§ E2.D) : ne rien prendre. Compensation : CHOICES.skipFragmentsPerWave fragments × numéro de la vague
 * (vague 1 au moins). Le choix en attente est consommé. false, sans rien consommer : aucun tirage, plus de passe.
 */
export function skipChoice() {
  if (rolled <= 0 || run.pendingChoices <= 0 || run.skips <= 0) return false;
  run.skips--;
  journal.passe(); // § E5.X10
  addFragments(CHOICES.skipFragmentsPerWave * (run.wave > 1 ? run.wave : 1));
  run.pendingChoices--;
  rolled = 0;
  return true;
}

/**
 * Bannissement (§ E2.D) : le bonus de la carte n° index ne sort plus de la partie ; les cartes sont retirées aussitôt
 * (sans coûter de relance). false, sans rien consommer : index hors tirage, « Réparation », plus de bannissement.
 * Renvoie sinon la vue du nouveau tirage.
 */
export function banishChoice(index) {
  if (run.pendingChoices <= 0 || run.banishes <= 0) return false;
  if (!Number.isInteger(index) || index < 0 || index >= rolled) return false;
  const c = view.choices[index];
  if (!c || c.id === REPAIR_ID) return false;
  if (c.kind === 'item') BANS.items[c.id] = 1; // § E2.F : un objet banni ne sort plus, ni ici ni des coffres
  else BANS.bonuses[c.id] = 1;
  run.banishes--;
  return roll(false);
}

/** Le bonus est banni pour cette partie (§ E2.D). */
export function isBanished(bonusId) {
  return bonusId >= 0 && bonusId < BONUS_COUNT && BANS.bonuses[bonusId] === 1;
}

/**
 * Applique le bonus n° index du tirage courant : empilement, effet réel dans mods (op 'add' → +=, op 'mul' → ×=),
 * run.pendingChoices--, puis weapons.markDirty() (stats effectives à recalculer) et player.onModsChanged() (PV max).
 * Un tirage ne sert qu'une fois : sans nouveau rollChoices(), un second appel est refusé. Refusé aussi, sans rien
 * consommer : tout index qui n'est pas un entier de 0 à (nombre de cartes − 1).
 */
export function applyChoice(index) {
  if (run.pendingChoices <= 0) return false;
  // Un index est un entier du tirage en cours, rien d'autre : null, true, '', [] ou 1,7 seraient convertis en 0 ou 1
  // par une comparaison numérique et prendraient une carte en silence (un clic hors carte, par exemple).
  if (!Number.isInteger(index) || index < 0 || index >= rolled) return false;
  const c = view.choices[index];
  if (!c) return false;
  let heal = 0;
  if (c.kind === 'item') {
    // § E2.F : carte d'objet — les piles affichées sont posées (items.add recalcule armes et PV max)
    if (!ctx.items || !ctx.items.add(c.id, c.gain)) return false;
  } else if (c.id === REPAIR_ID) {
    heal = PROGRESSION.fallbackHealFraction * P.maxHp;
  } else {
    const B = PROGRESSION.bonuses[c.id];
    if (stacks[c.id] >= B.maxStacks) return false;
    stacks[c.id]++;
    if (B.op === 'mul') mods[B.mod] *= B.value;
    else mods[B.mod] += B.value;
    if (B.heal > 0) heal = B.heal;
  }
  run.pendingChoices--;
  rolled = 0; // ce tirage est consommé : il faut un nouveau rollChoices() avant le choix suivant
  if (ctx.agents) ctx.agents.onModsChanged(); // § E2.D : « Conversion » suit mods.damageTakenMul, avant le recalcul des armes
  if (ctx.items) ctx.items.onModsChanged(); // § E2.F : la borne de PV max de l'Overclock suit les bonus
  ctx.weapons.markDirty();
  ctx.player.onModsChanged();
  if (heal > 0) ctx.player.heal(heal); // après onModsChanged : le soin est borné aux NOUVEAUX PV max
  journal.carte(c.name, journal.SORTE.NIVEAU); // § E5.X10 : nom déjà fait (bonus, objet, « Réparation ») : rien d'alloué
  return true;
}

export function getStacks(bonusId) {
  return bonusId >= 0 && bonusId < BONUS_COUNT ? stacks[bonusId] : 0;
}

/** F3 : +n niveaux, autant de choix en attente. */
export function debugAddLevels(n) {
  const k = Math.max(0, Math.round(n));
  run.level += k;
  run.xpToNext = xpForLevel(run.level);
  if (run.xp >= run.xpToNext) run.xp = run.xpToNext - 1;
  run.pendingChoices += k;
}

/**
 * Part du snapshot : { level, xp, xpToNext, pendingChoices, fragments, kills, bonuses } (contrat), plus le tirage
 * en cours pour les tests : roll = { level, pending, choices: [{ id, key, name, stacks, maxStacks }] }, ou null
 * quand aucun tirage n'attend de choix.
 */
export function inspect(out) {
  out.level = run.level;
  out.xp = run.xp;
  out.xpToNext = run.xpToNext;
  out.pendingChoices = run.pendingChoices;
  out.fragments = run.fragments;
  out.kills = run.kills;
  const bonuses = {};
  for (let b = 0; b < BONUS_COUNT; b++) bonuses[PROGRESSION.bonuses[b].key] = stacks[b];
  out.bonuses = bonuses;
  if (rolled > 0) {
    const choices = [];
    for (let k = 0; k < rolled; k++) {
      const c = view.choices[k];
      choices.push({ id: c.id, key: c.key, name: c.name, stacks: c.stacks, maxStacks: c.maxStacks, kind: c.kind, gain: c.kind === 'item' ? c.gain : 0, rarity: c.kind === 'item' ? c.rarity : 0 });
    }
    out.roll = { level: view.level, pending: view.pending, choices };
  } else {
    out.roll = null;
  }
  // § E2.D
  out.rerolls = run.rerolls;
  out.skips = run.skips;
  out.banishes = run.banishes;
  const banned = [];
  for (let b = 0; b < BONUS_COUNT; b++) if (BANS.bonuses[b] === 1) banned.push(PROGRESSION.bonuses[b].key);
  out.banned = banned;
  out.itemCards = itemCards; // § E2.F
}
