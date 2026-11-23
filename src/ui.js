// LOT : ui — HUD et écrans en DOM par-dessus le canvas (contrat : ARCHITECTURE.md § Q ; flèches : § K ; vues : § L, § M).
//
// ui.js n'écoute pas le clavier et ne change jamais l'état du jeu : il affiche ce qu'on lui donne et appelle
// ctx.actions au clic. Le seul son qu'il joue est SFX.UI_CLICK. Il ne tire aucun nombre au hasard.
//
// Règles tenues ici :
//   • focus : chaque bouton porte tabindex="-1" et annule pointerdown (le focus reste sur body, Entrée ne « re-clique »
//     rien) ; les curseurs gardent leur geste natif et rendent le focus à la fin du geste ; un écran masqué est en
//     display: none ;
//   • chemin chaud (update, appelé à chaque image) : lecture de l'état, écriture dans le DOM seulement quand la valeur
//     AFFICHÉE change ; entiers 0 à 999 et transformations des barres pris dans des tables de chaînes créées à
//     l'init ; ni objet, ni tableau, ni fermeture, ni lecture de mise en page. Les flèches de bord d'écran, que le
//     § Q tolère à une chaîne par image, n'en construisent pas non plus : pixels et degrés viennent de tables ;
//   • tout le DOM est créé une fois dans init ; reset() cache et remet à zéro, sans créer de nœud ni d'écouteur.
import { BOSS, CAPS, ENEMIES, EVENTS, PALETTE, PEINT, PROGRESSION, SCREEN, SFX, SHOP, STAT_COUNT, STAT_MAX_LEVEL, STATE, UI, WAVES, WEAPON_COUNT, WEAPONS, waveClockSeconds } from './config.js';
import { E, P, mods, run, SOIN_SIGNAUX } from './state.js';
import { FICHE_STATS, HUD_RETIRE, PICKUPS } from './config.js'; // § E4.E : HUD qui sort du cadre, CARACTÉRISTIQUES de la fiche
import { CHESTS, EFLAG, RARITIES, TRAUMA, WEAPON_COSTS } from './config.js'; // § E2.C : écran du coffre, flèches des porteuses
import { CARRY } from './config.js'; // § E5.X4 (audit F5) : bannières des robots reportés, couleur neutre
const KICKER_RESTE = CARRY.kicker.replace(/ : $/, ''); // surtitres tels que showBanner les coupe (avant « : »)
const KICKER_REGROUPES = CARRY.mergeKicker.replace(/ : $/, '');
import { PALIERS_VAGUES } from './config.js'; // § E5.V : titre « Décryptage », piste du palier
import { BOSS_IDENTITE, bossNomRang } from './config.js'; // 20/11 : « BOSS » = catégorie, le boss 1 = OVERCLOCK
import { AGENTS, AGENT_COUNT, AGENT_SCREEN, CHOICES, PLAYER, PORTRAIT, WEAPON_KEYS, agentSignature } from './config.js'; // § E2.D ; PORTRAIT : planche animée de la fiche (18/11)
import { ELITES } from './config.js'; // § E3.A : gros lot (coffres de 3 ou 5 lots)
import { FUSIONS, ITEMS, ITEM_COUNT, ITEM_ICONS, ITEM_RULES, itemText, TEXTES_N } from './config.js'; // § E2.F : rangée d'objets du HUD, cartes d'objet, fiche
import { UTIL, UTILITIES, UTILITY_ICONS } from './config.js'; // § E3.C : rangée des effets à durée
import { caseSlot, initPuce, paintPuce, piste, pistes, puce, puceStep } from './ui-carte.js'; // § E3.J : composants de l'interface carte mère
import { FUSION_SCREEN, RARITY, UI_CARTE } from './config.js';
import { EVOLUTIONS, EVOLUTION_RULES, EVOLUTION_UI, LOT_EVOLUTION } from './config.js';
import { creerFormule, evolutionDeArme, recetteEvolution, recetteFusion } from './ui-recette.js'; // 21/11 : recette en formule à icônes // 21/11 : une arme évoluée a son nom, son icône et sa case dorée // § E3.F : écran du moment de fusion, indice du choix de niveau
import { RECHARGE, RECHARGES } from './config.js'; // § E3.H : jauge horloge des sources à recharge ; § E4.G : ligne Action
import { TOUCHES } from './config.js'; // § E4.D : toutes les touches réglables (bloc « Touches » de la pause)
import { HUB } from './config.js'; // § E4.B : le hub « Noyau »
import { VITRINE, skinsDe } from './config.js'; // Écran Agents (tâche 5) : fond peint, cartes précalculées, nombre de skins
import { SILHOUETTE } from './config.js'; // § E4.L.2 : silhouette pleine des agents verrouillés
import * as hub from './ui-hub.js'; // § E4.B : construit le hub (comme ui-carte.js pour les composants)
import * as ficheUI from './ui-agents-fiche.js'; // Écran Agents (tâche 6) : la fiche perso
import * as bilanUI from './ui-bilan.js'; // § E4.C : bilan par arme et Cycles de l'écran de fin
import * as notes from './ui-notes.js'; // § E4.I.6 : notes de version de l'écran titre
import { PATCHNOTES_UI } from './config.js'; // § E4.I.6
import { ARME_COULEUR_UI, ICONES_CEL, MONNAIE, montant } from './config.js'; // § E4.S : icônes cel, couleurs d'identité, monnaie
import { HUD_BLOC } from './config.js'; // § E5.E.6 : bloc VAGUE / CHRONO centré en haut
import { COMBO, COMBOS, COMBO_ATTAQUE, COMBO_HUD, MARTEAU_COMBO, WEAPON } from './config.js'; // § E5.E.7 : repère du combo du Shinobi ; § E5.F.14 : marteau du Bastion
import { fragmentsPasse, rareteTexte } from './config.js'; // § E5.L : lot 1 du guide UX (textes et consignes)
import { HUD_PALIERS, MARCHAND_M3, MARCHAND_PHRASES, PIECE, PIECE_CYCLE, RECAP, RECAP_T, palierNiveau, pieceSequence } from './config.js'; // § E5.E : HUD V5, récap, marchand M3, pièce
import { RETOURS_GUIDE } from './config.js'; // § E5.Q : cause de la défaite (C2), éclat de la barre au soin (B14)
import { DECRYPTAGE_X7, HUD_X7 } from './config.js'; // § E5.X7 : soin du marchand, bulles et libellés du HUD, légende de la fiche
// ----- § E5.X6 (lot 7 : le jeu dit quand une action est impossible) — D1 jauge et tremblement de la case de la Frappe
// éclair, D5 / H7 bandeau du terminal (touche à portée, « approchez-vous » sinon, temps restant), F11 marchand (« il manque
// N », prix qui tremble au refus). Compteurs entiers lus à chaque image, DOM écrit seulement quand un entier change.
import { ACTIONS_IMPOSSIBLES as X6C, BUY as X6_BUY } from './config.js';
import { REFUS_X6 } from './state.js';
// (ui.js n'importe que config.js, state.js et ses composants : la jauge de la Frappe passe par weapons.frappeCran et
// les compteurs du terminal par ctx.terminal.TX6)
const X6_TREMBLE = ['sr-x6-tremble-a', 'sr-x6-tremble-b'];
const X6_REFUS_PRIX = ['sr-x6-refus-a', 'sr-x6-refus-b'];
const X6_CLS_TERM = ['sr-pal-lab sr-pal-lab-term', 'sr-pal-lab sr-pal-lab-term sr-pal-loin', 'sr-pal-lab sr-pal-lab-term sr-pal-loin sr-pal-appel'];
// [0] REFUS_X6[0] vu, [1] alternance du tremblement, [2] secondes du terminal écrites, [3] classe du bandeau écrite,
// [4] appels hors de portée vus, [5] alternance du refus au marchand
const x6Vu = new Int32Array(6).fill(-1);
const x6T = new Float64Array(1); // s restantes de la mise en avant de « approchez-vous » (temps réel)
let palX6Sec = null;
let palX6Term = null;

// ----- § E3.H : jauge horloge sur les cases d'arme et d'objet (élément .sr-case-cd du composant de J) ---------------
// Grisée qui se remplit dans le sens d'une horloge (variable CSS --sr-cd, 0 → 1), cachée quand c'est prêt (pleine
// couleur), éclat .sr-case-pret de RECHARGE.flashSeconds au retour. Écrite seulement quand la valeur a bougé de plus de
// 1/RECHARGE.steps (§ E3.0.5, règle 2) ; chaînes préparées au chargement : rien n'est alloué par image.
let cdMod = null;
const CD_STR = [];
for (let k = 0; k <= RECHARGE.steps; k++) CD_STR.push((k / RECHARGE.steps).toFixed(4));
const CD_CLS = ['sr-case-cd', 'sr-case-cd sr-cd-on', 'sr-case-cd sr-case-pret', 'sr-case-cd sr-cd-act'];
// § E4.G : cran > steps = fenêtre d'action en cours, steps + 1 + r (r = ce qui RESTE) : anneau qui se vide (sr-cd-act)
const CD_SLOTS = 16;
const cdLast = new Int16Array(2 * CD_SLOTS).fill(-2); // dernier cran écrit (−1 : pas de jauge), armes puis objets
const cdFlash = new Float64Array(2 * CD_SLOTS); // s d'éclat restantes

/** Cran q (−1 : pas de jauge ; RECHARGE.steps : prête) de la case k (j = k ou CD_SLOTS + k), élément cd. */
function paintCd(cd, j, q, realDt) {
  const last = cdLast[j];
  if (q !== last) {
    cdLast[j] = q;
    if (q < 0) {
      cdFlash[j] = 0;
      cd.className = CD_CLS[0];
    } else if (q > RECHARGE.steps) {
      cdFlash[j] = 0;
      if (last <= RECHARGE.steps) cd.className = CD_CLS[3];
      cd.style.setProperty('--sr-cd', CD_STR[q - RECHARGE.steps - 1]);
    } else if (q < RECHARGE.steps) {
      cdFlash[j] = 0;
      cd.className = CD_CLS[1];
      cd.style.setProperty('--sr-cd', CD_STR[q]);
    } else if (last >= 0 && last < RECHARGE.steps) {
      cdFlash[j] = RECHARGE.flashSeconds; // vient de redevenir prête : petit éclat
      cd.className = CD_CLS[2];
    } else cd.className = CD_CLS[0];
    return;
  }
  if (cdFlash[j] > 0) {
    if (realDt > 0) cdFlash[j] -= realDt;
    if (cdFlash[j] <= 0) {
      cdFlash[j] = 0;
      cd.className = CD_CLS[0];
    }
  }
}

// (cran de la jauge : cooldowns.stepOf et items.slotCooldownStep rendent un entier — fusion du groupe 2, § V)

let ctx = null;
let game = null;
let actions = null;
let audio = null;
let camera = null;
let waves = null;
let weapons = null;
let progressionMod = null; // DA carte mère : cumuls des bonus pour la fiche de l'agent (lecture seule)
// Fiche de l'agent (pause, DA carte mère) : construite une fois, remplie à chaque ouverture de la pause
let ficheNiv, ficheXpFill, ficheXp, fichePied;
const ficheArmes = [];
const ficheBonus = [];
// emplacements des armes autour du portrait : son bras droit à gauche de l'image (blaster, rail), le gauche à droite
// (pompe, roquettes), EMP (plastron) et orbitaux (dos) en bas de chaque colonne. Index = WEAPON.*
// § E2.J : EMPLACEMENTS d'armes (weapons.slots, ordre d'obtention), plus des identifiants d'armes — 12 armes pour 6
// emplacements depuis l'étape 2 : les six cases fixes d'avant ne montraient aucune arme de coffre
const FICHE_GAUCHE = [0, 1, 2];
const FICHE_DROITE = [3, 4, 5];
let player = null;
let root = null;

// ----- Tables de chaînes créées une fois ------------------------------------------------------------------------------

// Entiers 0 à 999 : un compteur qui change n'alloue aucune chaîne. Au-delà : String(n) au moment du changement (§ Y).
const INT = [];
for (let i = 0; i < UI.intCacheSize; i++) INT.push(String(i));
/**
 * Chaîne d'un compteur, pour tout nombre : jamais une chaîne vide. Un nombre non entier (un prix ou un crédit qu'un
 * autre lot aurait fractionné) n'a pas de case dans le cache : il est écrit comme une valeur de stat (« 25,5 »).
 */
function intStr(n) {
  if ((n | 0) === n) return n >= 0 && n < INT.length ? INT[n] : String(n);
  return Number.isInteger(n) ? String(n) : formatValue(n);
}

/** Table « scaleX(k / steps) », k de 0 à steps : une barre qui bouge n'alloue aucune chaîne. */
function scaleTable(step) {
  const steps = Math.max(1, Math.round(1 / step));
  const t = [];
  for (let k = 0; k <= steps; k++) t.push('scaleX(' + k / steps + ')');
  return t;
}
const SCALE_XP = scaleTable(UI.xpBarStep);
const SCALE_HP = scaleTable(UI.hpBarStep);
const SCALE_DASH = scaleTable(UI.dashBarStep);
const SCALE_BOSS = scaleTable(UI.bossBarStep);
const XP_Q = SCALE_XP.length - 1;
const HP_Q = SCALE_HP.length - 1;
const DASH_Q = SCALE_DASH.length - 1;
const BOSS_Q = SCALE_BOSS.length - 1;

// Flèches : chaînes « N px » (0 à UI.arrows.pxCacheSize − 1) et « N deg » (−180 à 180). Hors table (fenêtre de plus
// de 4 096 px) : chaîne construite au moment où la flèche bouge, la tolérance du § Q.
const PX = [];
for (let i = 0; i < UI.arrows.pxCacheSize; i++) PX.push(i + 'px');
const DEG = [];
for (let d = -180; d <= 180; d++) DEG.push(d + 'deg');

const CLS_HP = 'sr-vital sr-vital-hp';
const CLS_HP_LOW = 'sr-vital sr-vital-hp sr-low';
const CLS_DASH = 'sr-vital sr-vital-dash';
const CLS_DASH_CHARGING = 'sr-vital sr-vital-dash sr-charging';
const CLS_SLOT = 'sr-weapon';
const CLS_SLOT_EMPTY = 'sr-weapon sr-empty';

const ARROW_MAX = UI.arrows.max;
// Hauteur du point visé sur le robot (région du lot enemies) ; 1 m si la clé venait à manquer.
const ARROW_HEIGHT = ENEMIES && ENEMIES.common && typeof ENEMIES.common.arrowHeight === 'number' ? ENEMIES.common.arrowHeight : 1;
const RAD2DEG = 180 / Math.PI;
// Échelle de l'interface (UI.scale), recalculée pour le retrait des flèches à partir de la taille de la fenêtre que
// tient camera.view : la même formule que la taille de base posée sur <html> dans init, sans lecture de mise en page.
const REM_PER_HEIGHT = UI.scale.remPx / UI.scale.designHeightPx;
const REM_PER_WIDTH = UI.scale.remPx / UI.scale.designWidthPx;
const INSET_PER_REM = UI.arrows.insetPx / UI.scale.remPx;

// ----- État du module ------------------------------------------------------------------------------------------------

let screen = SCREEN.NONE;
let hudVisible = false;
let countdown = 0;
let bannerText = null;
// File des bannières (§ E1.B) : références de chaînes et durées, taille fixe
const queueText = new Array(CAPS.bannerQueue).fill(null);
const queueSeconds = new Float32Array(CAPS.bannerQueue);
const queueSfx = new Int16Array(CAPS.bannerQueue).fill(-1); // son joué quand la bannière s'affiche (−1 : aucun ; § E1.S)
let queueLen = 0;
let queueHead = 0;
let flipPop = false;
let flipBanner = false;
let flipTouche = false; // DA carte mère : relance de l'animation « PV touchés » (hpRow)
let flipSoin = false; // § E5.Q (B14) : relance de l'éclat vert de la barre de PV (hpSoin)
let hpSoin = null; // § E5.Q (B14) : couche verte dans le remplissage de la barre de PV
let soinVu = 0; // § E5.Q (B14) : SOIN_SIGNAUX[0] déjà montré
const CARTE = PEINT.theme === 'carte-mere';
// images de assets/ui/carte/ (outils/kit_ui_carte.py, outils/curseur_usb.py) lues par ui.css
const KIT_CARTE = ['panneau', 'panneau-actif', 'panneau-eteint', 'panneau-rouge', 'case', 'bouton', 'bouton-cyan', 'bouton-actif', 'rivets', 'curseur', 'curseur@2x'];
let flipBump = false;
let flipSwap = false;
let arrowsShown = 0;
// Flèche de la capsule de ravitaillement (§ E1.C) : une flèche cyan de bord d'écran, à part des flèches des robots.
const BEACON_T = EVENTS.types.find((e) => e.key === 'ravitaillement');
const BEACON = new Float64Array(2); // position de la capsule (events.getBeacon)
const beaconLast = new Int32Array(3).fill(-100000);
let beaconEl = null;
let beaconStyle = null;
let beaconShown = false;
let events = null;

// Minuterie de la bannière : dans un tableau typé (une variable de module qui reçoit un flottant à chaque image
// alloue un nombre à chaque écriture, § V).
const T = new Float64Array(1);
const T_BANNER = 0;

// Dernières valeurs ÉCRITES dans le DOM (entiers). −1 = inconnue : la prochaine image réécrit.
const L_HP = 0;
const L_MAXHP = 1;
const L_HPBAR = 2;
const L_LOW = 3;
const L_XP = 4;
const L_LEVEL = 5;
const L_WAVE = 6;
const L_CLOCK = 7; // secondes affichées par la pastille du chrono (étape 1 du plan addictif, § E1.A)
const L_FRAG = 8;
const L_DASH = 9;
const L_CHARGING = 10;
const L_BOSS = 11; // −1 = barre masquée
const L_CLOCK_STATE = 12; // 0 normal, 1 alerte (clignote sous WAVES.clock.warnSeconds), 2 prolongation (0:00 rouge, fixe)
// § E1.D : record (vague affichée, 0 = aucun ; état 0 / 1 = battu pendant cette partie), boss (rang, bouclier 0 / 1)
const L_RECORD = 13;
const L_RECORD_STATE = 14;
const L_BOSS_RANK = 15;
const L_BOSS_SHIELD = 16;
const L_PUCE = 17; // § E3.J : cran de la puce CPU (ui-carte.puceStep)
const L_PALIER = 18; // § E5.V tâche 7 : état codé de la piste du palier
const last = new Int32Array(19).fill(-1);
const CLS_RECORD = ['sr-chip sr-record', 'sr-chip sr-record sr-record-new'];
const CLS_BOSS = ['sr-boss', 'sr-boss sr-shielded'];
// Libellé de la barre du boss par rang (« BOSS », puis « BOSS v2.0 »… : une mise à jour du programme) et positions des
// repères en pourcentage : chaînes créées une fois.
const BOSS_NAMES = [];
for (let r = 0; r <= 60; r++) BOSS_NAMES.push(bossNomRang(r)); // BOSS_IDENTITE (20/11)
const PERCENT = [];
for (let k = 0; k <= 100; k++) PERCENT.push(k + '%');
// Chrono : « m:ss » de 0 à WAVES.clock.max secondes, chaînes créées une fois (aucune chaîne construite en combat).
const CLOCK_STR = [];
for (let k = 0; k <= WAVES.clock.max; k++) CLOCK_STR.push(Math.floor(k / 60) + ':' + (k % 60 < 10 ? '0' : '') + (k % 60));
const CLS_CLOCK = ['sr-chip sr-clock', 'sr-chip sr-clock sr-clock-warn', 'sr-chip sr-clock sr-clock-over'];
const lastWeaponLevel = new Int16Array(WEAPON_COUNT).fill(-1);
// § E2.C règle 11 : rangée d'armes du HUD = emplacements dans l'ordre d'obtention ; chaînes préparées par arme
const lastSlotWeapon = new Int16Array(16).fill(-2);
const lastSlotEvo = new Int16Array(16).fill(-2); // 21/11 : l'arme d'une case peut évoluer sans changer de case
const SLOT_HREF = WEAPONS.map((W, w) => '#sr-w' + w);
const SLOT_COLOR = WEAPONS.map((W, w) => '#' + (ARME_COULEUR_UI[w] >>> 0).toString(16).padStart(6, '0')); // § E4.S.4
const SLOT_TITLE = WEAPONS.map((W, w) => (UI.weaponIcons[w] || '') + ' ' + W.name);
// 21/11 (retour d'un testeur, relayé par Femz : « j'ai évolué mon arme mais elle est toujours affichée comme Blaster —
// il faudrait que les armes évoluées aient un autre nom + design et que le fond soit en jaune ») : weapons.evolved[w]
// = id d'évolution + 1 ; l'arme prend alors le nom de l'évolution, son icône (sr-e<id>) et une case pleine dorée
// (classe sr-evo : inventaire, HUD, Noyau). Chaînes préparées : rien n'est alloué en combat.
const EVO_HREF = EVOLUTIONS.map((E, id) => '#sr-e' + id);
const EVO_TITLE = EVOLUTIONS.map((E, id) => {
  const w = WEAPON_KEYS.indexOf(E.weapon);
  return (w >= 0 ? UI.weaponIcons[w] || '' : '') + ' ' + E.name;
});
/** Id de l'évolution de l'arme w, −1 si elle n'a pas évolué. */
function evoDe(w) {
  const e = w >= 0 && weapons !== null && weapons.evolved ? weapons.evolved[w] : 0;
  return e > 0 && e <= EVOLUTIONS.length ? e - 1 : -1;
}
function hrefArme(w) {
  const e = evoDe(w);
  return e >= 0 ? EVO_HREF[e] : SLOT_HREF[w];
}
function titreArme(w) {
  const e = evoDe(w);
  return e >= 0 ? EVO_TITLE[e] : SLOT_TITLE[w];
}
const CLS_SLOT_ROOT = 'sr-weapon sr-weapon-root'; // arme signature de l'agent : filet rouge « Root »
// ----- § E5.E.7 (demande de Femz du 17/11) : repère du combo du Shinobi sur la case de son arme -------------------------
// Pendant le combo : un cran par geste (COMBOS.list[c].geste), allumés au fil des gestes. Pendant la pause avant le combo
// suivant (weapons.ATT_GAP, weapons-agents.KAT_GAP, reçus par ctx.comboHud) : la jauge horloge du § E3.H (paintCd),
// quantifiée pour s'écrire ≈ COMBO_HUD.hz fois par seconde. À la fin de la pause : son éclat « prêt ». Tout est entier
// ou tiré de tables créées au chargement : rien d'alloué par image ; une classe n'est écrite que quand elle change.
const COMBO_CRANS_MAX = Math.max(...COMBOS.list.map((C) => C.geste.length));
const CB_DE_ARME = new Int8Array(WEAPON_COUNT).fill(-1);
CB_DE_ARME[WEAPON.BLADE] = COMBO.BLADE;
CB_DE_ARME[WEAPON.KATANA] = COMBO.KATANA;
// § E5.F.14 : le marteau du Bastion enchaîné (sans recharge) a le même repère ; sinon il garde sa jauge de recharge
const MARTEAU_ENCHAINE = MARTEAU_COMBO.actif && MARTEAU_COMBO.enchaine;
if (MARTEAU_ENCHAINE) CB_DE_ARME[WEAPON.HAMMER] = COMBO.HAMMER;
const CB_N = COMBOS.list.map((C) => C.geste.length);
const CLS_COMBO_OFF = 'sr-combo';
const CLS_COMBO = COMBOS.list.map((C, c) => {
  const t = [CLS_COMBO_OFF];
  for (let k = 1; k <= C.geste.length; k++) t.push('sr-combo sr-combo-on sr-combo-n' + C.geste.length + ' sr-combo-k' + k);
  return t;
});
// pause : Q crans (≈ hz par seconde sur la respiration DE CE COMBO), chacun → un cran de la jauge horloge
// (0 … RECHARGE.steps − 1). Respiration : COMBO_ATTAQUE (lame, katana) ou MARTEAU_COMBO (marteau, § E5.F.14).
const CB_RESP = COMBOS.list.map((C, c) => (c === COMBO.HAMMER ? MARTEAU_COMBO.respiration || COMBO_ATTAQUE.respiration : COMBO_ATTAQUE.respiration));
const CB_ACTIF = new Int8Array(COMBOS.list.length).fill(COMBO_ATTAQUE.actif ? 1 : 0);
CB_ACTIF[COMBO.HAMMER] = MARTEAU_ENCHAINE ? 1 : 0;
const CB_Q = new Int16Array(COMBOS.list.length);
const CB_Q_IDX = CB_RESP.map((r, c) => {
  const q = (CB_Q[c] = Math.max(1, Math.round(r * COMBO_HUD.hz)));
  const t = new Int16Array(q);
  for (let i = 0; i < q; i++) t[i] = Math.min(RECHARGE.steps - 1, Math.round((i * RECHARGE.steps) / q));
  return t;
});
const CB_F = new Float64Array(CB_RESP.map((r) => 1 / r)); // flottants lus par image : tableau typé (1 / respiration)
const comboLast = new Int8Array(16); // gestes allumés écrits, par case (0 : crans cachés)
let cbHud = null; // ctx.comboHud : { combos, gapLame, gapKatana, gapMarteau }

/** Cran à passer à paintCd pour la case k (combo cb) ; met à jour les crans du combo si leur nombre allumé change. */
function comboCran(k, cb, node) {
  const C = cbHud.combos;
  const pas = C.stepOf(cb);
  const occ = C.busy(cb);
  let lit = 0;
  let q = RECHARGE.steps; // prêt (rien à dessiner ; éclat si l'on sort de la pause)
  if (occ === 1 || pas !== 0) {
    lit = occ === 1 ? pas + 1 : pas; // geste en cours compté ; q reste « prêt » : le combo qui suit la pause sans attendre
    // (une cible à portée) déclenche l'éclat, comme une arme à recharge qui repart
  } else if (CB_ACTIF[cb] === 1) {
    const g = cb === COMBO.BLADE ? cbHud.gapLame : cb === COMBO.KATANA ? cbHud.gapKatana : cbHud.gapMarteau;
    if (g && g[0] > 0) {
      const Q = CB_Q[cb];
      let i = ((1 - g[0] * CB_F[cb]) * Q) | 0; // part écoulée de la respiration, en Q crans
      if (i < 0) i = 0;
      else if (i >= Q) i = Q - 1;
      q = CB_Q_IDX[cb][i];
    }
  }
  if (lit !== comboLast[k]) {
    comboLast[k] = lit;
    node.className = CLS_COMBO[cb][lit < CB_N[cb] ? lit : CB_N[cb]];
  }
  return q;
}
// § E5.E.1 (HUD V5) : classe du palier de couleur du niveau (HUD_PALIERS) — contour de la case et gros chiffre. Tables
// créées au chargement : update ne change la classe que quand le palier change (jamais à chaque image).
const PAL_MAX_NIV = 64;
const PAL_DE_NIV = new Int8Array(PAL_MAX_NIV + 1);
for (let n = 0; n <= PAL_MAX_NIV; n++) PAL_DE_NIV[n] = palierNiveau(n);
const CLS_SLOT_PAL = HUD_PALIERS.map((p, k) => CLS_SLOT + ' sr-pal-' + k);
const CLS_SLOT_ROOT_PAL = HUD_PALIERS.map((p, k) => CLS_SLOT_ROOT + ' sr-pal-' + k);
const CLS_SLOT_PAL_EVO = CLS_SLOT_PAL.map((c) => c + ' sr-evo'); // 21/11 : arme évoluée, case dorée
const CLS_SLOT_ROOT_PAL_EVO = CLS_SLOT_ROOT_PAL.map((c) => c + ' sr-evo');
const lastSlotPal = new Int8Array(16).fill(-2); // palier affiché par emplacement (−1 : vide ; −2 : à écrire)
// Fusion de la phase 1 (§ E2.I) : la signature est celle de l'AGENT de la partie (agentSignature(run.agent), chantier D),
// lue au moment où un emplacement change — plus WEAPON_COSTS.startWeapon, qui n'est que l'arme de l'Éclaireur.
// Dernière position écrite de chaque flèche : x, y (pixels entiers), angle (degrés entiers).
const arrowLast = new Int32Array(ARROW_MAX * 3).fill(-100000);

// ----- Éléments ------------------------------------------------------------------------------------------------------

let hud, xpFill, hpRow, hpFill, hpNum, hpMaxNum, levelNum, waveNum, clockNum, clockChip, fragNum, dashRow, dashFill, bossBox, bossFill;
let blocVague = null; // § E5.E.6 : crochets du bloc VAGUE / CHRONO (classe selon l'état du chrono)
let blocEtat = null; // § E5.E.6 : « BOSS EN VIE » sous le bloc
// § E5.V tâche 7 (variante B, Femz 20/11) : piste du palier sous le chrono — un segment par vague avant le décryptage
// (plein = passée, en cours = rempli par dixièmes du chrono, vide = à venir ; bord jaune = vague du terminal posé),
// puis le losange du décryptage. Classes construites ici : aucune chaîne fabriquée en combat.
const PAL_N = PALIERS_VAGUES.taille - 1;
const CLS_PAL_SEG = [];
for (let t = 0; t < 2; t++) {
  const b = t ? 'sr-pal-seg sr-pal-t' : 'sr-pal-seg';
  CLS_PAL_SEG.push(b, b + ' sr-pal-f');
  for (let k = 0; k <= 10; k++) CLS_PAL_SEG.push(b + ' sr-pal-c sr-pal-c' + k);
}
const CLS_PALIER = ['sr-palier', 'sr-palier sr-pal-cache', 'sr-palier sr-pal-term'];
let palier = null;
let palSegs = null;
let palTouche = null;
let palToucheTxt = null;
const CONSIGNES_VIDE = { build() {}, update() {}, reset() {}, forcer: () => false, inspect: (o) => o }; // § E5.L : sans module
let consignes = CONSIGNES_VIDE;
let palVague = -1; // § E5.L : vague du libellé écrit
let palDec = null; // § E5.L (A9) : libellé de la piste (« Marchand après la vague 4 »)
const CLS_BLOC = ['sr-bloc-vague', 'sr-bloc-vague sr-bloc-alerte', 'sr-bloc-vague sr-bloc-alerte sr-bloc-boss']; // état du chrono 0, 1, 2
let recordNum, recordChip, bossName, bossTickEnrage; // § E1.D
let bossMod = null;
let hudCarte = null; // § E3.J : calque des pistes et de la puce (porte --sr-puce et --sr-puce-s)
let bannerEl, bannerLabel, bannerKicker, bannerSous, countdownEl;
const screens = {};
const screenList = [];
const weaponSlots = []; // { slot, lv }
const arrowEls = [];
const arrowStyles = []; // le style de chaque flèche, gardé : aucun objet d'enveloppe recréé en cours de jeu

let titleBestCells, titleBestEmpty, titleBestNums, titleRecord;
let infosBox, infosBody;
let infosOpen = false;
let titlePlay, titlePlayLabel, titleStatus; // « Jouer » et l'état du chargement des modèles (§ Z quinquies)
let titleHub = null; // § E4.B.1 : bouton « Noyau »
const sliders = []; // { shake, volume } par écran (titre, pause)
let levelTitle, levelPending, cardsBox;
const bonusCards = []; // { card, use, name, desc, stacks, pips, count }
let shopBalance, shopNext;
const shopCards = []; // { card, state, color, name, desc, buy, buyNum, levelNum, lockNum, rows }
const shopVides = []; // § E4.T.2 : cases des emplacements d'arme libres
let shopVidesVus = -1;
// Marchand « A3 » (Femz, 20/11) : arsenal en cases à gauche, UNE grande carte à droite (l'arme choisie, ses cinq
// améliorations) ; sous l'arme, la description de l'amélioration visée (survol, ou focus clavier).
let shopSel = 0; // arme choisie à la souris (indice dans shopVisibles)
const shopLigneVue = { w: -1, s: -1 }; // ligne survolée à la souris (w = arme, s = rang 0-4, 7 = surcharge)
let shopCompte = null; // « 3 / 6 » au-dessus des cases
let overNums, overFlag, overBest;
let overCause = null; // § E5.Q (C2) : { box, detruit, detruitVal, plus, plusVal }
// § E2.D — barre « Relancer / Passer / Bannir » du choix de niveau
let ficheTitre = null; // fiche de la pause : nom et portrait de l'agent de la partie
let fichePortrait = null;
// Parallaxe : [0, 1] pointeur visé (−1 … 1), [2, 3] pointeur lissé, [4 … 9] décalages ÉCRITS par couche (px, x puis y)
const PLX = new Float64Array(10);
let plxScale = 1; // px réels par px de la fenêtre de référence
let plxOff = false; // prefers-reduced-motion : aucune parallaxe
let levelBar = null; // choiceBar du choix de niveau
// § E2.F : objets passifs — seconde rangée du HUD (sous les armes), cartes d'objet, grille de la fiche
let itemsMod = null;
const itemSlots = []; // { slot, n, use }
const lastItemId = new Int16Array(ITEM_RULES.slots).fill(-2);
const lastItemStacks = new Int32Array(ITEM_RULES.slots).fill(-1);
const lastItemState = new Int8Array(ITEM_RULES.slots).fill(-1);
const CLS_ITEM = ['sr-item', 'sr-item sr-item-wait', 'sr-item sr-empty'];
// icône, couleur du rang et titre de chaque entrée de la rangée (objet, ou objet né d'une fusion : ITEM_COUNT + k)
const ITEM_HREF = ITEMS.map((I) => '#sr-m-' + I.key).concat(FUSIONS.map((F) => '#sr-m-' + F.key)); // § E3.F : icône propre de l'objet né
const ITEM_COLOR = ITEMS.map((I) => hexColor(RARITIES[I.tier].color)).concat(FUSIONS.map(() => hexColor(RARITIES[4].color)));
const ITEM_TITLE = ITEMS.map((I) => I.name).concat(FUSIONS.map((F) => F.name));
// 21/11 : recette d'une arme en formule à icônes — fabrique commune src/ui-recette.js (Noyau compris)
function hexColor(n) {
  return '#' + (n >>> 0).toString(16).padStart(6, '0');
}
const ficheObjets = []; // { cell, use, name, n, val }
let ficheObjetsBox = null;
let banishArmed = false;
const levelCounts = new Int32Array(3);

// ----- Icônes : symboles SVG en ligne (aucun asset externe) ----------------------------------------------------------
// Dessin à facettes dans un carré de 24 : aplats de la couleur courante, facettes secondaires éclaircies par
// l'opacité. sr-w0…5 : les six armes (index = WEAPON.*). sr-b-<clé> : les dix bonus passifs. Les cotes d'un dessin
// restent dans le code, comme celles d'un maillage (§ U.3).

const SVG_NS = 'http://www.w3.org/2000/svg';

const SPRITE =
  // fragment : cristal
  '<symbol id="sr-i-frag" viewBox="0 0 24 24"><path d="M12 1.5 4 9.5l8 13z" fill-opacity=".72"/><path d="M12 1.5l8 8-8 13z"/>' +
  '<path d="M12 1.5l3.6 8L12 13 8.4 9.5z" fill="#fff" fill-opacity=".4"/></symbol>' +
  // verrou
  '<symbol id="sr-i-lock" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M6.5 10V7.5L9.5 3.5h5l3 4V10H20v10.5H4V10zm2.6 0h5.8V8.3L13.3 6h-2.6L9.1 8.3z"/></symbol>' +
  // blaster : un trait lancé
  '<symbol id="sr-w0" viewBox="0 0 24 24"><path d="M9.5 8H17l5.5 4-5.5 4H9.5z"/><path d="M1.5 10.8h6v2.4h-6z" fill-opacity=".65"/>' +
  '<path d="M4 6.4h4.2v1.9H4zM4 15.7h4.2v1.9H4z" fill-opacity=".4"/></symbol>' +
  // disques orbitaux : une orbite, deux disques
  '<symbol id="sr-w1" viewBox="0 0 24 24"><path fill-rule="evenodd" fill-opacity=".45" d="M20.32 15.44l-4.88 4.88H8.56l-4.88-4.88V8.56l4.88-4.88h6.88l4.88 4.88z' +
  'M18.74 14.79V9.21l-3.95-3.95H9.21L5.26 9.21v5.58l3.95 3.95h5.58z"/><path d="M14.4 12l-1.2 2.08h-2.4L9.6 12l1.2-2.08h2.4z"/>' +
  '<path d="M21.4 6.4l-1.6 2.77h-3.2L15 6.4l1.6-2.77h3.2zM9 17.6l-1.6 2.77H4.2L2.6 17.6l1.6-2.77h3.2z"/></symbol>' +
  // fusil à pompe : un cône de plombs
  '<symbol id="sr-w2" viewBox="0 0 24 24"><path d="M2.5 12 20.6 3.2l1.3 2.9zM2.5 12l19.4 5.9-1.3 2.9z" fill-opacity=".6"/>' +
  '<path d="M2.5 12 21.9 7l.5 2.1zM2.5 12l19.9 2.9-.5 2.1z" fill-opacity=".35"/><path d="M2.5 12 22 10.5v3z"/></symbol>' +
  // champ EMP : une aura, un arc
  '<symbol id="sr-w3" viewBox="0 0 24 24"><path fill-rule="evenodd" fill-opacity=".5" d="M21.24 15.83l-5.41 5.41H8.17l-5.41-5.41V8.17l5.41-5.41h7.66l5.41 5.41z' +
  'M19.48 15.1V8.9L15.1 4.52H8.9L4.52 8.9v6.2l4.38 4.38h6.2z"/><path d="M13.4 5.6 7.8 13h3.5l-1 5.4 5.9-7.5h-3.7z"/></symbol>' +
  // fusil à rail : un rayon qui traverse
  '<symbol id="sr-w4" viewBox="0 0 24 24"><path d="M8 11.5l4.5 4.5L8 20.5 3.5 16zM16 3.5 20.5 8 16 12.5 11.5 8z" fill-opacity=".5"/>' +
  '<path d="M1.5 20.6 20.6 1.5l1.9 1.9L3.4 22.5z"/></symbol>' +
  // roquettes
  '<symbol id="sr-w5" viewBox="0 0 24 24"><path d="M21.5 2.5 20 10l-7.5 7.5-6-6L14 4z"/><path d="M6.5 11.5 2 12.5l3.2 3.2zM12.5 17.5l-1 4.5-3.2-3.2z" fill-opacity=".6"/>' +
  '<path d="M7 14l3 3-7.5 4.5z" fill-opacity=".4"/></symbol>' +
  // bonus : blindage renforcé
  '<symbol id="sr-b-maxHp" viewBox="0 0 24 24"><path d="M12 2 3.5 5.2v6.6L12 22z" fill-opacity=".55"/><path d="M12 2l8.5 3.2v6.6L12 22z"/></symbol>' +
  // servomoteurs
  '<symbol id="sr-b-moveSpeed" viewBox="0 0 24 24"><path d="M2 4.5h4.5L13 12l-6.5 7.5H2L8.5 12z" fill-opacity=".55"/><path d="M11 4.5h4.5L22 12l-6.5 7.5H11l6.5-7.5z"/></symbol>' +
  // apprentissage (§ E5.Z, gain d'XP ; l'aimant avant) : une gemme et une flèche qui monte
  '<symbol id="sr-b-xpGain" viewBox="0 0 24 24"><path d="M7 7.5h6l4 4.5-7 10-7-10z" fill-opacity=".6"/><path d="M3 12h14l-7 10z"/>' +
  '<path d="M19 1.5l4 4h-2.5v4h-3v-4H15z"/></symbol>' +
  // viseur
  '<symbol id="sr-b-crit" viewBox="0 0 24 24"><path fill-rule="evenodd" fill-opacity=".6" d="M19.39 15.06l-4.33 4.33H8.94l-4.33-4.33V8.94l4.33-4.33h6.12l4.33 4.33z' +
  'M17.73 14.37V9.63l-3.36-3.36H9.63L6.27 9.63v4.74l3.36 3.36h4.74z"/><path d="M11 1h2v5.5h-2zM11 17.5h2V23h-2zM1 11h5.5v2H1zM17.5 11H23v2h-5.5zM12 9.6l2.4 2.4-2.4 2.4L9.6 12z"/></symbol>' +
  // nanoréparation
  '<symbol id="sr-b-regen" viewBox="0 0 24 24"><path d="M3 9h6v6H3zM15 9h6v6h-6z" fill-opacity=".6"/><path d="M9 3h6v18H9z"/></symbol>' +
  // propulseurs
  '<symbol id="sr-b-dashCd" viewBox="0 0 24 24"><path d="M13.5 1.5 4.5 13.5h6l-2 9 11-13H13z"/></symbol>' +
  // amplificateur
  '<symbol id="sr-b-area" viewBox="0 0 24 24"><path d="M12 8l4 4-4 4-4-4z" fill-opacity=".6"/>' +
  '<path d="M2.5 2.5h7v2.4H4.9v4.6H2.5zM21.5 2.5v7h-2.4V4.9h-4.6V2.5zM2.5 21.5v-7h2.4v4.6h4.6v2.4zM21.5 21.5h-7v-2.4h4.6v-4.6h2.4z"/></symbol>' +
  // surcharge
  '<symbol id="sr-b-damage" viewBox="0 0 24 24"><path d="M22.5 12l-6.25 1.76 3.17 5.66-5.66-3.17L12 22.5l-1.76-6.25-5.66 3.17 3.17-5.66L1.5 12l6.25-1.76-3.17-5.66 5.66 3.17L12 1.5l1.76 6.25 5.66-3.17-3.17 5.66z"/></symbol>' +
  // cadenceur
  '<symbol id="sr-b-fireRate" viewBox="0 0 24 24"><path d="M2 3.5h11l4 2.5-4 2.5H2zM2 15.5h11l4 2.5-4 2.5H2z" fill-opacity=".6"/><path d="M7 9.5h11l4 2.5-4 2.5H7z"/></symbol>' +
  // plaques ablatives
  '<symbol id="sr-b-armor" viewBox="0 0 24 24"><path d="M3 20 12 14.5l9 5.5v2.5l-9-5-9 5z" fill-opacity=".45"/><path d="M3 14.2 12 8.7l9 5.5v3l-9-5.5-9 5.5z" fill-opacity=".7"/>' +
  '<path d="M3 8.5 12 3l9 5.5v3L12 6 3 11.5z"/></symbol>' +
  // bonus sans dessin propre (« Réparation ») : un écrou
  '<symbol id="sr-b-default" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2.5l8.2 4.7v9.6L12 21.5l-8.2-4.7V7.2zM12 8l-3.5 2v4l3.5 2 3.5-2v-4z"/></symbol>';

// DA carte mère : icônes PIXEL 1-bit (réfs de Femz : inventaire pixel art, Octatrack), mêmes identifiants que SPRITE.
// Grilles de 12 × 12 (« # » = pixel allumé, de la couleur courante), converties à l'init en un chemin par icône
// (une ligne de pixels contigus = un rectangle), arêtes nettes (shape-rendering crispEdges).
const GRILLES = {
  // Noyau, résumé des succès (20/11, Femz : « tu as remis une icône déjà utilisée ») : icônes PROPRES — trophée (taux
  // de réussite), sablier (en cours), horloge (temps de jeu) ; avant : crit, zone et régénération du jeu
  'sr-i-trophee': [
    '............',
    '.##########.',
    '#.########.#',
    '#.########.#',
    '#.########.#',
    '.#.######.#.',
    '...######...',
    '....####....',
    '.....##.....',
    '.....##.....',
    '...######...',
    '..########..',
  ],
  'sr-i-sablier': [
    '.##########.',
    '..#......#..',
    '..#.####.#..',
    '...#.##.#...',
    '....#..#....',
    '.....##.....',
    '.....##.....',
    '....#..#....',
    '...#....#...',
    '..#.####.#..',
    '..########..',
    '.##########.',
  ],
  'sr-i-horloge': [
    '....####....',
    '..##....##..',
    '.#........#.',
    '.#...#....#.',
    '#....#.....#',
    '#....#.....#',
    '#....####..#',
    '#..........#',
    '.#........#.',
    '.#........#.',
    '..##....##..',
    '....####....',
  ],
  'sr-i-frag': [
    '.....##.....',
    '....####....',
    '...##..##...',
    '..##....##..',
    '.##......##.',
    '##........##',
    '.##......##.',
    '..##....##..',
    '...##..##...',
    '....####....',
    '.....##.....',
    '............',
  ],
  'sr-i-lock': [
    '....####....',
    '...##..##...',
    '...#....#...',
    '...#....#...',
    '..########..',
    '..########..',
    '..###..###..',
    '..###..###..',
    '..####.###..',
    '..########..',
    '..########..',
    '............',
  ],
  // bonus passifs
  'sr-b-maxHp': [
    '.##########.',
    '.####..####.',
    '.####..####.',
    '.##......##.',
    '.##......##.',
    '..###..###..',
    '..###..###..',
    '...######...',
    '....####....',
    '.....##.....',
    '............',
    '............',
  ],
  'sr-b-moveSpeed': [
    '............',
    '##....##....',
    '.##....##...',
    '..##....##..',
    '...##....##.',
    '....##....##',
    '...##....##.',
    '..##....##..',
    '.##....##...',
    '##....##....',
    '............',
    '............',
  ],
  'sr-b-xpGain': [
    // § E5.Z : gemme (dessin de sr-i-gemme) et flèche qui monte — gain d'XP (l'aimant avant)
    '.........#..',
    '........###.',
    '.......#####',
    '....#####.#.',
    '...#######..',
    '..#########.',
    '.###########',
    '..#########.',
    '....#####...',
    '......#.....',
    '............',
    '............',
  ],
  'sr-b-crit': [
    '.....##.....',
    '...######...',
    '..#..##..#..',
    '.#........#.',
    '.#........#.',
    '####.##.####',
    '####.##.####',
    '.#........#.',
    '.#........#.',
    '..#..##..#..',
    '...######...',
    '.....##.....',
  ],
  'sr-b-regen': [
    '............',
    '....####....',
    '....####....',
    '....####....',
    '############',
    '############',
    '############',
    '....####....',
    '....####....',
    '....####....',
    '............',
    '............',
  ],
  'sr-b-dashCd': [
    '.......##...',
    '......##....',
    '.....##.....',
    '....##......',
    '...#######..',
    '......###...',
    '.....###....',
    '....##......',
    '...##.......',
    '..##........',
    '.##.........',
    '............',
  ],
  'sr-b-area': [
    '####....####',
    '#..........#',
    '#..........#',
    '#....##....#',
    '....####....',
    '...######...',
    '....####....',
    '#....##....#',
    '#..........#',
    '#..........#',
    '####....####',
    '............',
  ],
  'sr-b-damage': [
    '.....##.....',
    '.#...##...#.',
    '..#..##..#..',
    '...######...',
    '...######...',
    '############',
    '############',
    '...######...',
    '...######...',
    '..#..##..#..',
    '.#...##...#.',
    '.....##.....',
  ],
  'sr-b-fireRate': [
    '............',
    '#######.....',
    '########....',
    '#######.....',
    '............',
    '...#######..',
    '...########.',
    '...#######..',
    '............',
    '#######.....',
    '########....',
    '#######.....',
  ],
  'sr-b-armor': [
    '.....##.....',
    '...##..##...',
    '.##......##.',
    '##...##...##',
    '...##..##...',
    '.##......##.',
    '##...##...##',
    '...##..##...',
    '.##......##.',
    '##........##',
    '............',
    '............',
  ],
  'sr-b-default': [
    '....####....',
    '..##....##..',
    '.#........#.',
    '.#...##...#.',
    '#...####...#',
    '#...####...#',
    '.#...##...#.',
    '.#........#.',
    '..##....##..',
    '....####....',
    '............',
    '............',
  ],
};

// § E4.S : icône cel (config.js ICONES_CEL.table) — prioritaire sur la grille de pixels ou l'image 24 px de l'id. Image
// lissée (pas « pixelated ») : 88 px affichés à 44 px en DPR 2, réduits par le navigateur ailleurs.
function symboleCel(id) {
  const f = ICONES_CEL.table[id];
  if (f === undefined) return null;
  return '<symbol id="' + id + '" viewBox="0 0 24 24"><image class="sr-cel" href="' + ICONES_CEL.dossier + f + '.png" width="24" height="24"/></symbol>';
}

/** Symbole SVG d'une grille de pixels : un rectangle par suite de pixels allumés sur une ligne. */
function symbolePixel(id, rangs) {
  const cel = symboleCel(id);
  if (cel !== null) return cel;
  let d = '';
  for (let y = 0; y < rangs.length; y++) {
    const r = rangs[y];
    for (let x = 0; x < r.length; x++) {
      if (r[x] !== '#') continue;
      let n = 1;
      while (x + n < r.length && r[x + n] === '#') n++;
      d += 'M' + x + ' ' + y + 'h' + n + 'v1h-' + n + 'z';
      x += n - 1;
    }
  }
  return '<symbol id="' + id + '" viewBox="0 0 12 12"><path shape-rendering="crispEdges" d="' + d + '"/></symbol>';
}

// Armes : versions pixelisées des VRAIS modèles 3D (Femz 14/11 : « un peu comme les icônes de Vampire Survivors ») —
// rendus par outils/blender/icones_armes.py, pixelisés par outils/pixeliser_icones.py : assets/ui/armes/arme-<index>.png
// (24 × 24, couleurs, contour sombre), affichés au plus proche voisin. Index = WEAPON.*.
function symboleImage(id, src) {
  const cel = symboleCel(id);
  if (cel !== null) return cel;
  return '<symbol id="' + id + '" viewBox="0 0 24 24"><image href="' + src + '" width="24" height="24" style="image-rendering:pixelated"/></symbol>';
}

/**
 * 21/11 : icône d'une évolution (sr-e<id>) — la sienne si ICONES_CEL.table la donne, sinon celle de l'arme de base
 * (la case dorée et le nom suffisent alors à la distinguer, en attendant son dessin).
 */
function symboleEvo(id) {
  const cel = symboleCel('sr-e' + id);
  if (cel !== null) return cel;
  const w = WEAPON_KEYS.indexOf(EVOLUTIONS[id].weapon);
  const f = ICONES_CEL.table['sr-w' + (w >= 0 ? w : 0)];
  if (f === undefined) return symboleImage('sr-e' + id, 'assets/ui/armes/arme-' + (w >= 0 ? w : 0) + '.png');
  return '<symbol id="sr-e' + id + '" viewBox="0 0 24 24"><image class="sr-cel" href="' + ICONES_CEL.dossier + f + '.png" width="24" height="24"/></symbol>';
}

// § E2.F : les 18 icônes d'objet (sr-m-<clé>), pixel 1-bit dans les deux thèmes
const SPRITE_OBJETS = Object.keys(ITEM_ICONS).map((id) => symbolePixel(id, ITEM_ICONS[id])).join('');

const SPRITE_PIXEL =
  SPRITE_OBJETS +
  Object.keys(GRILLES).map((id) => symbolePixel(id, GRILLES[id])).join('') +
  WEAPONS.map((_, i) => symboleImage('sr-w' + i, 'assets/ui/armes/arme-' + i + '.png')).join('') + // une icône par arme (étape 2, § E2.A : 9 armes)
  EVOLUTIONS.map((E, id) => symboleEvo(id)).join('') + // 21/11 : une icône par évolution
  symboleCel('sr-i-pixel'); // § E4.S.9 : la monnaie méta

const BONUS_ICONS = { maxHp: 1, moveSpeed: 1, xpGain: 1, crit: 1, regen: 1, dashCd: 1, area: 1, damage: 1, fireRate: 1, armor: 1 };

// ----- Fabriques (init seulement) ------------------------------------------------------------------------------------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Icône : <svg><use href="#id"></svg>. Renvoie le <svg> ; son <use> est son premier enfant. */
function icon(id) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', 'sr-ic');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG_NS, 'use');
  u.setAttribute('href', '#' + id);
  s.appendChild(u);
  return s;
}

function hex(n) {
  return '#' + (n >>> 0).toString(16).padStart(6, '0');
}

/** Le focus ne quitte jamais body : sans cela Entrée « re-clique » le dernier bouton cliqué (§ Q). */
function noFocus(e) {
  e.preventDefault();
}

/** Rend un élément cliquable sans jamais lui donner le focus. */
function pressable(b, onClick) {
  b.type = 'button';
  b.tabIndex = -1;
  b.addEventListener('pointerdown', noFocus);
  b.addEventListener('mousedown', noFocus);
  b.addEventListener('click', onClick);
  return b;
}

/** Bouton : libellé, et la touche du jeu qui fait la même chose s'il y en a une. */
function button(label, cls, onClick, key) {
  const b = el('button', cls);
  b.appendChild(el('span', 'sr-btn-label', label));
  // § E4.D : '@id' = la touche réglée de la ligne id (TOUCHES.lignes), réécrite par majIndices()
  if (key) b.appendChild(key[0] === '@' ? indice(el('span', 'sr-key', ''), key.slice(1)) : el('span', 'sr-key', key));
  return pressable(b, onClick);
}

// § E5.S (audit A6) : « Recommencer » et « Quitter la partie » ne coupent plus la partie en un clic. 1er clic : le bouton
// s'arme (« Recommencer ? », « Cliquez encore pour confirmer »), 2e clic dans REGLAGES.confirmerSecondes : l'action.
// Désarmé seul après ce délai, et à chaque ouverture de la pause (pauseReset).
const desarmes = [];
function confirmable(label, cls, action) {
  let arme = 0;
  const b = button(label, cls + ' sr-confirmable', null);
  const lab = b.querySelector('.sr-btn-label');
  const sous = el('span', 'sr-btn-sous', 'Appuyez encore pour confirmer'); // § E5.X4 (F2) : souris, clavier ou manette
  // compte à rebours : un filet qui se vide en REGLAGES.confirmerSecondes (animation CSS) ; sa fin désarme le bouton
  // (aucune minuterie dans ui.js, contrat de l'interface)
  const compte = el('span', 'sr-btn-compte');
  compte.style.setProperty('--duree', REGLAGES.confirmerSecondes + 's');
  //#region e5:AN-quitter-pause
  // § E5.AN (22/11) : une fin d'animation plus courte que le délai (durée écrasée — « Réduire les animations » ramenait
  // tout #ui-root à 0,001 s : le bouton se désarmait à l'image qui suit le 1er clic, le 2e clic ré-armait, à l'infini)
  // ne désarme pas : seule la fin du VRAI décompte le fait (ui-pile.css garde sa durée en mouvement réduit)
  compte.addEventListener('animationend', (e) => {
    if (e.elapsedTime >= REGLAGES.confirmerSecondes - 0.05) desarmer();
  });
  //#endregion e5:AN-quitter-pause
  b.append(sous, compte);
  const desarmer = () => {
    if (!arme) return;
    arme = 0;
    b.classList.remove('sr-arme');
    setText(lab, label);
  };
  desarmes.push(desarmer);
  b.addEventListener('click', () => {
    audio.play(SFX.UI_CLICK);
    if (arme) {
      desarmer();
      action();
      return;
    }
    arme = 1;
    b.classList.add('sr-arme');
    setText(lab, label + ' ?');
  });
  return b;
}

/** Clic de navigation : le seul son joué par l'interface. */
function click(action) {
  return () => {
    audio.play(SFX.UI_CLICK);
    action();
  };
}

/** Pastille « libellé + nombre » : seul le nœud du nombre est réécrit, avec une chaîne du cache. */
function chip(label, parent) {
  const c = el('span', 'sr-chip', label);
  const num = el('span', 'sr-num', '0');
  c.appendChild(num);
  parent.appendChild(c);
  return num;
}

/** Cellule « grand nombre, petit libellé ». Renvoie le nœud du nombre. */
function cell(label, parent) {
  const c = el('div', 'sr-cell');
  const num = el('div', 'sr-cell-num sr-num', '0');
  c.append(num, el('div', 'sr-cell-label', label));
  parent.appendChild(c);
  return num;
}

function pips(count, parent) {
  const box = el('span', 'sr-pips');
  const list = [];
  for (let k = 0; k < count; k++) {
    const p = el('i', 'sr-pip');
    box.appendChild(p);
    list.push(p);
  }
  parent.appendChild(box);
  return list;
}

function paintSlider(s) {
  s.value.textContent = s.texte ? s.texte(Number(s.input.value)) : s.input.value + ' %'; // § E5.AG : texte propre au curseur
  s.input.style.setProperty('--v', s.input.value + '%');
}

/**
 * Curseur 0 à 100 %. Geste natif à la souris ; le focus est rendu à la fin du geste (§ Q). texte (§ E5.AG, facultatif) :
 * position 0..100 → texte affiché (sinon « N % »). Écrit au geste et à l'ouverture, jamais par image.
 */
function slider(label, onInput, texte = null) {
  const row = el('div', 'sr-slider');
  const input = el('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.tabIndex = -1;
  input.setAttribute('aria-label', label);
  const s = { row, input, value: el('span', 'sr-slider-value', ''), texte };
  const release = () => input.blur();
  input.addEventListener('input', () => {
    paintSlider(s);
    onInput(Number(input.value) / 100);
  });
  input.addEventListener('change', () => {
    input.blur();
    audio.play(SFX.UI_CLICK); // s'entend au nouveau volume
  });
  input.addEventListener('pointerup', release);
  input.addEventListener('mouseup', release);
  row.append(el('span', 'sr-slider-label', label), s.value, input);
  return s;
}

//#region e5:AB-camera-3p
// ----- § E5.AB.14 (Femz, 22/11 : « l'autre mode ortho doit inclure clic souris LoL ») : repère du clic au sol de 0.5.7,
// rétabli tel quel pour le mode « Vue fixe »
//#endregion e5:AB-camera-3p
// ----- Repère du clic au sol (déplacement à la souris, réglages de Femz, 21/11) : DA FUI, couleur de l'agent ----------
// Trois repères en anneau (clics rapprochés). Chacun : quatre coins pixel qui se referment sur le point puis s'effacent
// (animation CSS rejouée en alternant deux noms), aplati par l'inclinaison de la caméra (posé au sol). Position : même
// projection que les flèches (champ visible, sans la secousse), écrite en variables --x / --y (chaînes de PX).
const CLIC_N = 3;
const clicEls = [];
const CLIC = new Float64Array(CLIC_N * 3); // par repère : vie restante (s), x, z
const clicLast = new Int32Array(CLIC_N * 2).fill(-99999);
let clicProchain = 0;
let clicJeu = 0; // alterne les deux noms d'animation (rejoue sans relire la mise en page)

function construireClic() {
  if (clicEls.length > 0 || !root) return;
  for (let k = 0; k < CLIC_N; k++) {
    const m = el('div', 'sr-clic');
    m.setAttribute('aria-hidden', 'true');
    const sol = el('div', 'sr-clic-sol');
    for (let c = 0; c < 4; c++) sol.appendChild(el('span', 'sr-clic-coin sr-clic-c' + c));
    sol.appendChild(el('span', 'sr-clic-point'));
    m.appendChild(sol);
    m.style.display = 'none';
    root.insertBefore(m, root.firstChild); // sous le HUD : posé au sol
    clicEls.push(m);
  }
}

/** Clic droit au sol (player.js, mode souris) : un repère en (x, z) ; fort = vrai clic (sinon repère maintenu, discret). */
export function marqueurClic(x, z, fort) {
  construireClic();
  if (clicEls.length === 0) return;
  const k = clicProchain;
  clicProchain = (k + 1) % CLIC_N;
  CLIC[k * 3] = REGLAGES.souris.marqueur.secondes;
  CLIC[k * 3 + 1] = x;
  CLIC[k * 3 + 2] = z;
  const m = clicEls[k];
  const A = AGENTS[run.agent] || AGENTS[0];
  m.style.setProperty('--ac', hex(A.accent));
  const v = camera.view;
  m.style.setProperty('--aplat', (v.visHalfD > 0 ? Math.min(1, Math.max(0.3, v.visHalfH / v.visHalfD)) : 0.6).toFixed(3)); // inclinaison de la caméra
  clicJeu ^= 1;
  m.className = 'sr-clic sr-clic-on' + clicJeu + (fort ? ' sr-clic-fort' : '');
  m.style.display = '';
}

function updateClic(realDt) {
  if (clicEls.length === 0) return;
  const view = camera.view;
  const halfW = view.visHalfW;
  const halfH = view.visHalfH;
  const cx = view.widthPx * 0.5;
  const cy = view.heightPx * 0.5;
  const sinP = halfH / view.visHalfD;
  for (let k = 0; k < CLIC_N; k++) {
    if (CLIC[k * 3] <= 0) continue;
    CLIC[k * 3] -= realDt > 0 ? realDt : 0;
    const m = clicEls[k];
    if (CLIC[k * 3] <= 0) {
      m.style.display = 'none';
      continue;
    }
    const vx = CLIC[k * 3 + 1] - view.targetX;
    const vz = CLIC[k * 3 + 2] - view.targetZ;
    const a = vx * view.rightX + vz * view.rightZ;
    const b = (vx * view.upX + vz * view.upZ) * sinP;
    const px = Math.round(cx + (a * cx) / halfW);
    const py = Math.round(cy - (b * cy) / halfH);
    const st = m.style;
    if (clicLast[k * 2] !== px) {
      clicLast[k * 2] = px;
      st.setProperty('--x', px >= 0 && px < PX.length ? PX[px] : px + 'px');
    }
    if (clicLast[k * 2 + 1] !== py) {
      clicLast[k * 2 + 1] = py;
      st.setProperty('--y', py >= 0 && py < PX.length ? PX[py] : py + 'px');
    }
  }
}

/** Tests : repères du clic affichés (vie, x, z, position écran). */
export function clicInspect() {
  const out = [];
  for (let k = 0; k < clicEls.length; k++) if (CLIC[k * 3] > 0) out.push({ vie: CLIC[k * 3], x: CLIC[k * 3 + 1], z: CLIC[k * 3 + 2], px: clicLast[k * 2], py: clicLast[k * 2 + 1] });
  return out;
}


//#region e5:AB-camera-3p
// ----- § E5.AB.7 : curseur du jeu sous verrou du pointeur (mode Clavier) et plaque « Cliquez pour reprendre la souris »
// Réticule de la DA (quatre coins pixel et un point à la couleur de l'agent, lueur en box-shadow, aucun filter), posé au
// QUART de pixel : translate lu dans PXQ (chaînes au quart de pixel, créées une fois) — aucune chaîne créée par image.
// § E5.AB.14 (Femz, 22/11) : dessiné en mode « Vue fixe » (clavier + clic droit façon LoL) sous verrou — il sert au
// clic pour avancer et à la direction du dash ; aucun en mode « Caméra libre ».
const PXQ = [];
const CURS = new Float64Array(2);
const PJ = new Float64Array(6); // § E5.AB.12 : projection d'un point du monde en pixels (camera.ecranT)
const cursDernier = new Int32Array(3).fill(-99999); // quarts de px x, y posés ; agent dont la couleur est posée
let cursEl = null;
let cursOn = false;
let plaqueEl = null;
let plaqueOn = false;

function chaineQuart(q) {
  return q >= 0 && q < PXQ.length ? PXQ[q] : q / 4 + 'px'; // hors table (fenêtre plus grande que l'écran) : rare
}

function construireCurseur() {
  if (cursEl !== null || !root) return;
  const n = 4 * (Math.max(window.screen ? window.screen.width : 0, window.screen ? window.screen.height : 0, window.innerWidth, window.innerHeight) + 8);
  for (let q = PXQ.length; q < n; q++) PXQ.push(q / 4 + 'px');
  cursEl = el('div', 'sr-curseur');
  cursEl.setAttribute('aria-hidden', 'true');
  cursEl.style.setProperty('--taille', CAMERA_3P.curseur.taillePx + 'px');
  for (let c = 0; c < 4; c++) cursEl.appendChild(el('span', 'sr-curseur-coin sr-curseur-c' + c));
  cursEl.appendChild(el('span', 'sr-curseur-point'));
  cursEl.style.display = 'none';
  root.appendChild(cursEl); // par-dessus le HUD
  plaqueEl = el('div', 'sr-verrou-plaque', CAMERA_3P.textes.reprendre);
  plaqueEl.style.display = 'none';
  root.appendChild(plaqueEl);
}

function updateCurseur() {
  const V = ctx.verrou;
  if (!V) return;
  construireCurseur();
  if (cursEl === null) return;
  const plaque = V.plaque();
  if (plaque !== plaqueOn) {
    plaqueOn = plaque;
    plaqueEl.style.display = plaque ? '' : 'none';
  }
  const on = V.curseurVisible();
  if (on !== cursOn) {
    cursOn = on;
    cursEl.style.display = on ? '' : 'none';
  }
  if (!on) return;
  if (cursDernier[2] !== run.agent) {
    cursDernier[2] = run.agent;
    cursEl.style.setProperty('--ac', hex((AGENTS[run.agent] || AGENTS[0]).accent));
  }
  ctx.input.curseurT(CURS);
  const qx = Math.round(CURS[0] * 4) | 0;
  const qy = Math.round(CURS[1] * 4) | 0;
  const st = cursEl.style;
  if (cursDernier[0] !== qx) {
    cursDernier[0] = qx;
    st.setProperty('--x', chaineQuart(qx));
  }
  if (cursDernier[1] !== qy) {
    cursDernier[1] = qy;
    st.setProperty('--y', chaineQuart(qy));
  }
}

/** Tests : curseur du jeu affiché (position posée en px CSS) et plaque. */
export function curseurInspect() {
  return { visible: cursOn, x: cursDernier[0] / 4, y: cursDernier[1] / 4, plaque: plaqueOn, texte: plaqueEl ? plaqueEl.textContent : '' };
}
//#endregion e5:AB-camera-3p

// ----- § E5.R : fenêtre Paramètres (Femz, 21/11 : « réglage ouvre vers une autre fenêtre, met notre nouvelle DA UI glow,
// je veux un truc vraiment propre ») — plein écran comme le Noyau : titre, onglets Général / Son / Commandes, une plaque
// glow par réglage (nom, une ligne d'aide, le contrôle), « Retour ». Ouverte depuis l'accueil et la pause ; Échap la ferme.
const PARAM_ONGLETS = ['Général', 'Son', 'Commandes'];
let paramEl = null;
let paramIdx = 0;
const paramBtns = [];
const paramSecs = [];

function paramLigne(parent, nom, aide, ctrl) {
  const l = el('div', 'sr-param-ligne');
  const t = el('div', 'sr-param-txt');
  const a = el('div', 'sr-param-aide', aide);
  t.append(el('div', 'sr-param-nom', nom), a);
  const c = el('div', 'sr-param-ctrl');
  c.appendChild(ctrl);
  l.append(t, c);
  parent.appendChild(l);
  return a; // § E5.AB.13 : la ligne d'aide (celle du Déplacement suit le choix)
}

// § E5.AG : curseur « Sensibilité de la souris » — position t (0..100) ↔ multiplicateur m, géométrique sur chaque moitié
// (t 0 → min, 50 → 1, 100 → max) ; m arrondi au centième : la valeur affichée est la valeur appliquée
function sensiDePosition(t) {
  const R = REGLAGES.sensibilite;
  const m = t <= 50 ? R.min * Math.pow(1 / R.min, t / 50) : Math.pow(R.max, (t - 50) / 50);
  return Math.round(m * 100) / 100;
}
function positionDeSensi(m) {
  const R = REGLAGES.sensibilite;
  const t = m <= 1 ? (50 * Math.log(m / R.min)) / Math.log(1 / R.min) : 50 + (50 * Math.log(m)) / Math.log(R.max);
  return t < 0 ? 0 : t > 100 ? 100 : Math.round(t);
}
const texteSensi = (t) => Math.round(sensiDePosition(t) * 100) + ' %';

//#region e5:AB-camera-3p
// § E5.AB.13 (Femz, 22/11) : l'aide du réglage Déplacement décrit SEULEMENT l'option choisie, mise à jour au clic
const aidesDeplacement = [];
function aideDeplacement(cle) {
  return cle === 'clavier' ? REGLAGES.aides.deplacementClavier : REGLAGES.aides.deplacementSouris;
}
function majAideDeplacement(cle) {
  const t = aideDeplacement(cle);
  for (let i = 0; i < aidesDeplacement.length; i++) if (aidesDeplacement[i].textContent !== t) aidesDeplacement[i].textContent = t;
}
//#endregion e5:AB-camera-3p

function buildParam() {
  if (!CARTE || paramEl) return;
  const p = el('div', 'sr-param');
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', 'Paramètres');
  p.style.display = 'none';
  const tete = el('div', 'sr-param-tete');
  tete.appendChild(el('h2', null, 'Paramètres'));
  const barre = el('div', 'sr-param-onglets');
  for (let i = 0; i < PARAM_ONGLETS.length; i++) {
    const b = pressable(el('button', 'sr-param-onglet', PARAM_ONGLETS[i]), click(() => paramVoir(i)));
    paramBtns.push(b);
    barre.appendChild(b);
  }
  tete.appendChild(barre);
  const corps = el('div', 'sr-param-corps');
  const gen = el('div', 'sr-param-section');
  const son = el('div', 'sr-param-section');
  const cmd = el('div', 'sr-param-section sr-param-commandes');
  const A = REGLAGES.aides;
  const L = REGLAGES.libelles;
  const graph = choixRow('graphismes', L.graphismes, REGLAGES.graphismes, (k) => actions.setGraphismes(k));
  const deplacement = choixRow('deplacement', L.deplacement, REGLAGES.deplacement, (k) => {
    actions.setDeplacement(k);
    majAideDeplacement(k); // § E5.AB.13
  });
  const secousses = choixRow('secousses', L.secousses, REGLAGES.secousses, (k) => actions.setSecousses(k === 'avec'));
  const flashs = choixRow('flashs', L.flashs, REGLAGES.flashs, (k) => actions.setFlashs(k)); // § E5.X5 (audit C12)
  paramLigne(gen, L.graphismes, A.graphismes, graph.row);
  aidesDeplacement.push(paramLigne(gen, L.deplacement, aideDeplacement(lastSettings && lastSettings.deplacement), deplacement.row));
  paramLigne(gen, L.secousses, A.secousses, secousses.row);
  paramLigne(gen, L.flashs, A.flashs, flashs.row);
  paramLigne(gen, 'Caméra', A.camera, cameraRow());
  const volume = slider(L.volume, (v) => actions.setVolume(v));
  const sfx = slider(L.sfx, (v) => actions.setVolSfx(v));
  const musique = slider(L.musique, (v) => actions.setVolMusique(v));
  paramLigne(son, L.volume, A.volume, volume.row);
  paramLigne(son, L.sfx, A.sfx, sfx.row);
  paramLigne(son, L.musique, A.musique, musique.row);
  // § E5.AG : Commandes commence par la sensibilité de la souris (là où un joueur la cherche ; Général est plein sans défiler)
  const sensi = slider(L.sensibilite, (t) => actions.setSensibilite(sensiDePosition(Math.round(t * 100))), texteSensi);
  sensi.row.classList.add('sr-slider-sensi');
  paramLigne(cmd, L.sensibilite, A.sensibilite, sensi.row);
  sliders.push({ graph, secousses, flashs, deplacement, volume, sfx, musique, sensi });
  // Commandes : le bloc des touches de la pause (§ E4.D), déplacé ici (une seule instance, ses écouteurs suivent)
  const touches = plis.find((x) => x.box.classList.contains('sr-pli-touches'));
  if (touches) {
    touches.box.style.display = '';
    cmd.appendChild(touches.box);
  }
  corps.append(gen, son, cmd);
  paramSecs.push(gen, son, cmd);
  const pied = el('div', 'sr-param-pied');
  pied.appendChild(button('Retour', 'sr-btn sr-param-retour', click(() => paramFermer())));
  p.append(tete, corps, pied);
  root.appendChild(p);
  paramEl = p;
  setSliders(lastSettings);
}

function paramVoir(i) {
  paramIdx = i;
  for (let k = 0; k < paramSecs.length; k++) {
    paramSecs[k].style.display = k === i ? '' : 'none';
    paramBtns[k].classList.toggle('sr-actif', k === i);
    paramBtns[k].setAttribute('aria-selected', k === i ? 'true' : 'false');
  }
  if (i === 2) majTouches(); // § E4.D : libellés des touches à jour (disposition détectée)
  else annulerAttente();
}

/** § E5.R : ouvre la fenêtre Paramètres sur l'onglet i (0 Général, 1 Son, 2 Commandes). Vrai si elle est ouverte. */
export function paramOuvrir(i = 0) {
  if (!paramEl) return false;
  setSliders(lastSettings);
  paramEl.style.display = '';
  paramVoir(i >= 0 && i < PARAM_ONGLETS.length ? i : 0);
  return true;
}

/** § E5.R : ferme la fenêtre Paramètres ; vrai si elle était ouverte (Échap ne fait rien d'autre). */
export function paramFermer() {
  if (!paramEl || paramEl.style.display === 'none') return false;
  annulerAttente();
  paramEl.style.display = 'none';
  return true;
}

export function paramOuvert() {
  return !!paramEl && paramEl.style.display !== 'none';
}

function settingsBlock(parent) {
  // Réglages de Femz (21/11) : Graphismes (Auto / Élevée / Moyenne / Basse), Secousses (Avec / Sans), Effets sonores,
  // Musique, puis Caméra. Les choix sont des boutons comme la ligne Caméra ; les volumes, des curseurs.
  const box = el('div', 'sr-settings');
  const graph = choixRow('graphismes', REGLAGES.libelles.graphismes, REGLAGES.graphismes, (k) => actions.setGraphismes(k));
  const secousses = choixRow('secousses', REGLAGES.libelles.secousses, REGLAGES.secousses, (k) => actions.setSecousses(k === 'avec'));
  const deplacement = choixRow('deplacement', REGLAGES.libelles.deplacement, REGLAGES.deplacement, (k) => {
    actions.setDeplacement(k);
    majAideDeplacement(k); // § E5.AB.13
  });
  const flashs = choixRow('flashs', REGLAGES.libelles.flashs, REGLAGES.flashs, (k) => actions.setFlashs(k)); // § E5.X5 (audit C12)
  const volume = slider(REGLAGES.libelles.volume, (v) => actions.setVolume(v)); // Femz (21/11) : « garde volume général aussi »
  const sfx = slider(REGLAGES.libelles.sfx, (v) => actions.setVolSfx(v));
  const musique = slider(REGLAGES.libelles.musique, (v) => actions.setVolMusique(v));
  box.append(graph.row, secousses.row, flashs.row, deplacement.row, volume.row, sfx.row, musique.row);
  box.appendChild(cameraRow()); // § E3.L : ligne « Caméra »
  parent.appendChild(box);
  sliders.push({ graph, secousses, flashs, deplacement, volume, sfx, musique });
}

/** Ligne de boutons à choix unique (même dessin que « Caméra ») ; init seulement. */
function choixRow(id, label, options, onPick) {
  const row = el('div', 'sr-cam sr-choix sr-choix-' + id);
  row.appendChild(el('span', 'sr-cam-label', label));
  const seg = el('div', 'sr-cam-seg');
  seg.style.setProperty('--nopt', String(options.length)); // tous les choix sur une ligne
  const boutons = [];
  for (let i = 0; i < options.length; i++) {
    const O = options[i];
    const b = pressable(el('button', 'sr-cam-opt', O.label), click(() => {
      onPick(O.key);
      paintChoix(boutons, O.key);
    }));
    b.dataset.reglage = O.key;
    boutons.push(b);
    seg.appendChild(b);
  }
  row.appendChild(seg);
  return { row, boutons };
}

function paintChoix(boutons, cle) {
  for (let i = 0; i < boutons.length; i++) {
    const on = boutons[i].dataset.reglage === cle;
    if (boutons[i].classList.contains('sr-on') !== on) boutons[i].classList.toggle('sr-on', on);
    boutons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

// ----- § E3.L : ligne « Caméra » des réglages (bloc du chantier L) ----------------------------------------------------
import { CAMERA } from './config.js'; // § E3.L (import remonté par le module)
import { REGLAGES } from './config.js'; // réglages de Femz (21/11)
import { CAMERA_3P } from './config.js'; // § E5.AB : curseur du jeu sous verrou
const cameraRows = []; // une ligne par écran qui montre les réglages (titre, pause)

/** « Caméra » : trois boutons Haute / Moyenne / Basse (CAMERA.reglages) ; touche C en partie. Init seulement. */
function cameraRow() {
  const row = el('div', 'sr-cam');
  row.appendChild(el('span', 'sr-cam-label', 'Caméra'));
  row.appendChild(indice(el('span', 'sr-key sr-cam-key', ''), 'camera')); // § E4.D
  const seg = el('div', 'sr-cam-seg');
  const boutons = [];
  for (let i = 0; i < CAMERA.reglages.length; i++) {
    const R = CAMERA.reglages[i];
    const b = pressable(el('button', 'sr-cam-opt', R.label), click(() => actions.setCamera && actions.setCamera(R.key)));
    b.dataset.reglage = R.key;
    boutons.push(b);
    seg.appendChild(b);
  }
  row.appendChild(seg);
  cameraRows.push(boutons);
  paintCamera(boutons);
  return row;
}

function paintCamera(boutons) {
  const k = camera ? camera.view.reglage : CAMERA.reglageDefaut;
  for (let i = 0; i < boutons.length; i++) {
    const on = i === k;
    if (boutons[i].classList.contains('sr-on') !== on) boutons[i].classList.toggle('sr-on', on);
    boutons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

/** Réglage de caméra changé (Paramètres ou touche C) : les lignes « Caméra » suivent. Hors chemin chaud. */
export function refreshCamera() {
  for (let i = 0; i < cameraRows.length; i++) paintCamera(cameraRows[i]);
}

let lastSettings = null; // § E5.R : derniers réglages reçus (titre ou pause), repeints à l'ouverture de la fenêtre
function setSliders(data) {
  if (!data) return;
  lastSettings = data;
  for (let i = 0; i < sliders.length; i++) {
    const s = sliders[i];
    if (typeof data.shake === 'number') paintChoix(s.secousses.boutons, data.shake > 0 ? 'avec' : 'sans');
    if (typeof data.graphismes === 'string') paintChoix(s.graph.boutons, data.graphismes);
    if (typeof data.deplacement === 'string') {
      paintChoix(s.deplacement.boutons, data.deplacement);
      majAideDeplacement(data.deplacement); // § E5.AB.13
    }
    if (typeof data.flashs === 'string' && s.flashs) paintChoix(s.flashs.boutons, data.flashs); // § E5.X5
    if (typeof data.volume === 'number') {
      s.volume.input.value = String(Math.round(data.volume * 100));
      paintSlider(s.volume);
    }
    if (typeof data.sfx === 'number') {
      s.sfx.input.value = String(Math.round(data.sfx * 100));
      paintSlider(s.sfx);
    }
    if (typeof data.musique === 'number') {
      s.musique.input.value = String(Math.round(data.musique * 100));
      paintSlider(s.musique);
    }
    if (typeof data.sensibilite === 'number' && s.sensi) {
      s.sensi.input.value = String(positionDeSensi(data.sensibilite)); // § E5.AG
      paintSlider(s.sensi);
    }
  }
}

// ----- Écritures hors chemin chaud (ouverture ou rafraîchissement d'un écran) ---------------------------------------

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function setClass(node, cls) {
  if (node.className !== cls) node.className = cls;
}

function formatTime(s) {
  const t = Math.max(0, Math.floor(s));
  const r = t % 60;
  return Math.floor(t / 60) + ':' + (r < 10 ? '0' : '') + r;
}

/** Valeur d'une stat : entier tel quel, sinon deux décimales au plus, virgule française. */
function formatValue(v) {
  const r = Math.round(v * 100) / 100;
  if (Number.isInteger(r)) return intStr(r);
  let s = r.toFixed(2);
  if (s.charCodeAt(s.length - 1) === 48) s = s.slice(0, -1);
  return s.replace('.', ',');
}

// ----- Construction ---------------------------------------------------------------------------------------------------

export function init(context) {
  ctx = context;
  game = ctx.game;
  actions = ctx.actions;
  audio = ctx.audio;
  camera = ctx.camera;
  waves = ctx.waves;
  events = ctx.events;
  weapons = ctx.weapons;
  bossMod = ctx.boss;
  progressionMod = ctx.progression;
  itemsMod = ctx.items || null; // § E2.F
  consignes = ctx.consignes || CONSIGNES_VIDE; // § E5.L : bulles de consigne (src/consignes.js, posé par main.js : ui.js n'importe que config, state et ses ui-*)
  cbHud = ctx.comboHud || null; // § E5.E.7 : état des combos (lecture seule)
  cdMod = ctx.cooldowns || null; // § E3.H
  player = ctx.player;
  root = ctx.uiRoot;

  // Palette du cahier, durées et échelle : config.js est la source unique, ui.css n'en garde que le repli.
  const rs = document.documentElement.style;
  // DA du décor (PEINT.theme) : ui.css habille l'interface en « cyber minimaliste » sur la carte mère.
  document.documentElement.dataset.srTheme = PEINT.theme;
  // cadres pixel et curseur de la carte mère chargés dès le départ : sinon chacun ne part qu'à l'ouverture de sa
  // fenêtre, et un rechargement à ce moment-là l'annule (Firefox : requestfailed NS_BINDING_ABORTED)
  if (CARTE) {
    for (const n of KIT_CARTE) new Image().src = 'assets/ui/carte/' + n + '.png';
    // § E5.AB : la planche des menus Pile (pause, Noyau, Paramètres) aussi — sinon elle ne part qu'à la 1re pause, et une
    // pause refermée aussitôt l'annulait (Firefox : requestfailed NS_BINDING_ABORTED, mesuré par fondation.test, 22/11)
    new Image().src = 'assets/ui/fond-systeme.png';
  }
  rs.setProperty('--sr-sand', hex(PALETTE.sand));
  rs.setProperty('--sr-rock', hex(PALETTE.rock));
  rs.setProperty('--sr-rock-dark', hex(PALETTE.rockDark));
  rs.setProperty('--sr-bone', hex(PALETTE.player));
  rs.setProperty('--sr-cyan', hex(PALETTE.playerAccent));
  rs.setProperty('--sr-red', hex(PALETTE.robotEye));
  rs.setProperty('--sr-xp', hex(PALETTE.gemGreen));
  rs.setProperty('--sr-pop-s', UI.countdownPopSeconds + 's');
  rs.setProperty('--sr-screen-s', UI.screenInSeconds + 's');
  rs.setProperty('--sr-bump-s', UI.bumpSeconds + 's');
  rs.setProperty('--sr-clock-blink-s', (1 / UI.clock.blinkHz).toFixed(3) + 's');
  rs.setProperty('--sr-arrow', UI.arrows.sizePx / UI.scale.remPx + 'rem');
  // § E4.E.1 : bloc du bas du HUD qui sort du cadre (pause, écran de fin)
  rs.setProperty('--sr-retire-s', HUD_RETIRE.duree + 's');
  rs.setProperty('--sr-retire-bas', HUD_RETIRE.basRem + 'rem');
  rs.setProperty('--sr-retire-gauche', '-' + HUD_RETIRE.gaucheRem + 'rem');
  // Coefficients arrondis au-dessus (4 décimales) : 16 px tout rond dans la fenêtre de référence, pas 15,98 une fois
  // la taille ramenée aux sous-pixels du navigateur.
  const sc = UI.scale;
  const perVh = Math.ceil((sc.remPx / sc.designHeightPx) * 1e6 - 1e-6) / 1e4;
  const perVw = Math.ceil((sc.remPx / sc.designWidthPx) * 1e6 - 1e-6) / 1e4;
  rs.fontSize = 'clamp(' + sc.minRemPx + 'px, min(' + perVh + 'vh, ' + perVw + 'vw), ' + sc.maxRemPx + 'px)';
  stylesE5(rs); // § E5.E : paliers du HUD, couleurs du récap, pièce de la monnaie (une fois)

  const sprite = document.createElementNS(SVG_NS, 'svg');
  sprite.setAttribute('class', 'sr-sprite');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.innerHTML = CARTE ? SPRITE_PIXEL : SPRITE + SPRITE_OBJETS + symboleCel('sr-i-pixel'); // carte mère : icônes pixel 1-bit
  root.appendChild(sprite);

  buildHud();
  buildEffects(hud); // § E3.C : rangée des effets à durée (Décharge, Overclocking, Puissance de calcul)
  buildToast(); // § E4.A.6 : notification d'un succès

  bannerEl = el('div', 'sr-banner');
  bannerLabel = el('span', 'sr-banner-label', '');
  bannerEl.appendChild(bannerLabel);
  // surtitre (§ E1.B) : posé au-dessus du titre sans entrer dans la colonne (les bandes du glitch restent calées dessus)
  bannerKicker = el('span', 'sr-banner-kicker', '');
  bannerKicker.style.display = 'none';
  bannerEl.appendChild(bannerKicker);
  // § E4.N.3 : ligne d'explication (révisions des robots) — ce qui change pour le joueur, sous le trait
  bannerSous = el('span', 'sr-banner-sous', '');
  bannerEl.appendChild(bannerSous);
  root.appendChild(bannerEl);
  countdownEl = el('div', 'sr-countdown');
  root.appendChild(countdownEl);

  buildTitle();
  buildPause();
  buildLevelUp();
  buildShop();
  buildGameOver();
  buildChest(); // § E2.C
  buildAgents(); // Écran Agents (tâche 5)
  buildFusion(); // § E3.F
  buildHub(); // § E4.B
  buildParam(); // § E5.R : fenêtre Paramètres (après la pause : elle accueille son bloc des touches)
  fabriquerSilhouettes(); // § E4.L.2 : vignettes « silhouette pleine » des agents verrouillés (une fois, hors combat)
  plxInit(); // § E4.B.2 : prefers-reduced-motion, commun aux deux écrans à parallaxe
  majIndices(); // § E4.D : les aides montrent les touches réglées (stockage lu par input.init, appelé avant)
}

function buildHud() {
  hud = el('div', 'sr-hud');
  if (CARTE) buildHudCarte(); // § E3.J : pistes et puce CPU, sous tout le reste du HUD

  const xpBar = el('div', 'sr-xp');
  xpFill = el('div', 'sr-xp-fill');
  xpBar.appendChild(xpFill);
  xpBar.appendChild(el('span', 'sr-xp-lab', 'XP')); // § E5.L (A12) : la barre dit ce qu'elle mesure
  hud.appendChild(xpBar);

  const top = el('div', 'sr-hud-top');
  levelNum = chip('Niv. ', top);
  waveNum = chip('Vague ', top);
  // Étape 1 du plan addictif (§ E1.A) : la pastille « Robots » est devenue le chrono de la vague.
  clockNum = chip('Chrono ', top);
  clockChip = clockNum.parentNode;
  clockChip.className = CLS_CLOCK[0];
  if (CARTE && HUD_BLOC.actif) {
    // § E5.E.6 (bloc « C3 · capsule sans fond », choix de Femz du 17/11) : VAGUE et CHRONO quittent la rangée du haut
    // pour un bloc centré en haut (placés par ui.css, les pastilles restent dans .sr-hud-top : ordre et textes
    // inchangés) ; le mot « Chrono » passe dans son propre nœud, caché par le CSS (le texte de la pastille ne change pas)
    hud.classList.add('sr-hud-bloc'); // le CSS du bloc ne s'applique qu'avec cette classe (HUD_BLOC.actif = false : rangée d'avant)
    waveNum.parentNode.classList.add('sr-chip-vague');
    const lab = clockChip.firstChild;
    clockChip.replaceChild(el('span', 'sr-chip-lab', lab.textContent), lab);
    blocVague = el('div', CLS_BLOC[0]);
    blocVague.setAttribute('aria-hidden', 'true');
    blocEtat = el('div', 'sr-bloc-etat', '');
    hud.append(blocVague, blocEtat);
    // § E5.V tâche 7 : piste du palier
    palier = el('div', CLS_PALIER[1]);
    palier.setAttribute('aria-hidden', 'true');
    const segs = el('div', 'sr-pal-segs');
    palSegs = [];
    for (let k = 0; k < PAL_N; k++) palSegs.push(segs.appendChild(el('i', CLS_PAL_SEG[0])));
    segs.appendChild(el('i', 'sr-pal-dia'));
    const term = el('div', 'sr-pal-lab sr-pal-lab-term', PALIERS_VAGUES.hud.terminal + ' ');
    // § E5.X6 (H7) : « · 24 s » — le temps avant qu'il reparte (secondes écrites quand elles changent)
    const temps = el('span', 'sr-pal-temps');
    palX6Sec = el('span', 'sr-num sr-pal-sec', '');
    temps.append(document.createTextNode(X6C.terminal.separateur.trimStart()), palX6Sec, document.createTextNode(X6C.terminal.unite));
    term.appendChild(temps);
    palX6Term = term;
    palTouche = el('span', 'sr-pal-touche', '');
    term.appendChild(palTouche);
    term.appendChild(el('span', 'sr-pal-approche', X6C.terminal.approchez)); // § E5.X6 (D5) : à la place de la touche, hors de portée
    if (PALIERS_VAGUES.hud.terminalEffet) term.appendChild(el('span', 'sr-pal-effet', PALIERS_VAGUES.hud.terminalEffet.trim())); // § E5.L (A9) : ce qu'il apporte
    palDec = el('div', 'sr-pal-lab sr-pal-lab-dec', PALIERS_VAGUES.hud.decryptage);
    palier.append(segs, palDec, term);
    hud.appendChild(palier);
  }
  const frag = el('span', 'sr-chip sr-frag');
  frag.appendChild(icon('sr-i-frag'));
  if (CARTE) {
    // § E3.J : le faisceau de pistes à gauche des fragments (référence : en haut à droite), sans texte
    const fp = pistes(6, 2.4, 'sr-pistes-frag');
    piste(fp, [96, 14, 70, 14, 62, 6, 34, 6], [3]);
    piste(fp, [96, 24, 52, 24], [1], 'jaune');
    piste(fp, [96, 32, 74, 32, 66, 38, 22, 38], [3]);
    frag.appendChild(fp);
  }
  fragNum = el('span', 'sr-num', '0');
  frag.appendChild(fragNum);
  top.appendChild(frag);
  // § E1.D : le record à battre (« — » sans record) ; il passe au cyan et suit la vague une fois battu pendant la partie.
  // Dernière pastille du document (les quatre premières gardent leur rang), affichée à la suite du chrono : ui.css
  // renvoie la pastille des fragments en fin de rangée (order).
  // Retour de Femz du 16/11/2026 (point 5) : « enleve record vague de l'ui in game, on la deja dans le menu » — la
  // pastille est construite HORS du document (les écritures de update restent, sans effet visible) : le record reste au
  // menu, à l'écran de l'agent et au game over.
  recordNum = chip(UI.record.label, el('div'));
  recordChip = recordNum.parentNode;
  recordChip.className = CLS_RECORD[0];
  recordNum.textContent = UI.record.none;
  hud.appendChild(top);
  consignes.build(hud, el, ctx); // § E5.L : bulle de consigne, sous le héros

  bossBox = el('div', 'sr-boss');
  // 20/11 : « BOSS » (catégorie) en petit au-dessus du nom du boss (bossName : le nom seul, lu par les tests)
  const bossId = el('div', 'sr-boss-name');
  bossId.appendChild(el('span', 'sr-boss-cat', BOSS_IDENTITE.categorie));
  bossName = el('span', 'sr-boss-nom', BOSS_NAMES[1]);
  bossId.appendChild(bossName);
  bossBox.appendChild(bossId);
  const bossBar = el('div', 'sr-boss-bar');
  bossFill = el('div', 'sr-boss-fill');
  bossBar.appendChild(bossFill);
  const phase2 = BOSS && typeof BOSS.phase2At === 'number' ? BOSS.phase2At : 0;
  if (phase2 > 0 && phase2 < 1) {
    const tick = el('div', 'sr-boss-tick');
    tick.style.left = phase2 * 100 + '%';
    bossBar.appendChild(tick);
  }
  // § E1.D : repère du seuil d'enragement (rang 4 et suivants), placé à l'apparition du boss ; étiquette « BOUCLIER »
  // tant qu'un drone-bouclier vit (classe sr-shielded : barre hachurée).
  bossTickEnrage = el('div', 'sr-boss-tick sr-boss-tick-enrage');
  bossTickEnrage.style.display = 'none';
  bossBar.appendChild(bossTickEnrage);
  bossBox.appendChild(bossBar);
  bossBox.appendChild(el('div', 'sr-boss-tag', 'BOUCLIER'));
  hud.appendChild(bossBox);

  const bottom = el('div', 'sr-hud-bottom');
  // Six emplacements d'arme : icône et niveau pour les armes possédées, case creuse sinon.
  const weaponBox = el('div', 'sr-weapons');
  // § E2.C règle 11 : CHESTS.weaponSlots emplacements, remplis dans l'ORDRE D'OBTENTION (weapons.slots) ; l'icône et
  // la couleur d'un emplacement sont posées quand son arme change (update).
  for (let k = 0; k < CHESTS.weaponSlots; k++) {
    if (CARTE) {
      // § E3.J : case de la carte mère (même classe, même ordre d'enfants, plus la jauge cachée de H)
      const c = caseSlot('arme', CLS_SLOT_EMPTY, 'sr-w0');
      // § E5.E.7 : crans du combo (lame de phase, katana), un par geste ; cachés pour les autres armes
      const combo = el('span', 'sr-combo');
      for (let g = 0; g < COMBO_CRANS_MAX; g++) combo.appendChild(el('i'));
      c.root.appendChild(combo);
      weaponBox.appendChild(c.root);
      weaponSlots.push({ slot: c.root, lv: c.n, use: c.use, cd: c.cd, combo });
      continue;
    }
    const slot = el('div', CLS_SLOT_EMPTY);
    const lv = el('span', 'sr-weapon-level sr-num', '1');
    const ic = icon('sr-w0');
    slot.append(ic, lv);
    weaponBox.appendChild(slot);
    weaponSlots.push({ slot, lv, use: ic.firstChild });
  }

  // § E2.F : seconde rangée, SOUS les armes — les objets passifs dans l'ordre d'obtention, avec leur nombre de piles ;
  // liseré à la couleur du rang de l'objet (posé quand l'objet d'un emplacement change, dans update).
  const itemBox = el('div', 'sr-items');
  for (let k = 0; k < ITEM_RULES.slots; k++) {
    if (CARTE) {
      const c = caseSlot('objet', CLS_ITEM[2], 'sr-m-tesla'); // § E3.J
      itemBox.appendChild(c.root);
      itemSlots.push({ slot: c.root, n: c.n, use: c.use, cd: c.cd });
      continue;
    }
    const slot = el('div', CLS_ITEM[2]);
    const n = el('span', 'sr-item-n sr-num', '');
    const ic = icon('sr-m-tesla');
    slot.append(ic, n);
    itemBox.appendChild(slot);
    itemSlots.push({ slot, n, use: ic.firstChild });
  }

  hpRow = el('div', CLS_HP);
  const hpBox = el('div', 'sr-hp');
  hpFill = el('div', 'sr-hp-fill');
  // § E5.Q (B14) : éclat vert du soin — une couche dans le remplissage (elle suit sa largeur), dont seule l'opacité s'anime
  hpSoin = el('div', 'sr-hp-soin');
  hpSoin.style.animationDuration = RETOURS_GUIDE.soin.barre.secondes + 's';
  hpFill.appendChild(hpSoin);
  hpBox.appendChild(hpFill);
  const hpText = el('div', 'sr-hp-text');
  hpNum = el('span', 'sr-hp-now sr-num', '0');
  hpMaxNum = el('span', 'sr-hp-max sr-num', '0');
  hpText.append(hpNum, el('span', 'sr-hp-sep', '/'), hpMaxNum);
  hpRow.append(el('span', 'sr-vital-label', 'PV'), hpBox, hpText);
  if (CARTE) hpRow.insertBefore(el('span', 'sr-barre-coeur'), hpBox); // § E3.J : le cœur pixel de la référence

  dashRow = el('div', CLS_DASH);
  const dashBox = el('div', 'sr-dash');
  dashFill = el('div', 'sr-dash-fill');
  dashBox.appendChild(dashFill);
  dashRow.append(el('span', 'sr-vital-label', 'Dash'), dashBox);

  // Retour de Femz du 16/11/2026 (point 5) : « retire "dash" barre dans l'ui, on a deja le cercle bleu sur le perso » —
  // la barre est construite hors du document (la recharge se lit sur le repère R1 au sol, anim/reperes.js).
  //#region e5:AI-barre-vie
  // § E5.AI (Femz, 22/11 : « plus besoin de l'UI barre de vie en bas de l'écran ») : les PV se lisent sur la barre
  // au-dessus de l'agent (src/barres-vie.js). hpRow est construit hors du document, comme la barre du dash (16/11) :
  // ses écritures dans update restent locales et sans effet. Elle était posée en absolu : rien d'autre ne bouge.
  bottom.append(weaponBox, itemBox);
  //#endregion e5:AI-barre-vie
  hud.appendChild(bottom);
  hudX7(weaponBox, itemBox, frag); // § E5.X7 (A13 / F6) : libellés courts et bulles au survol

  // Flèches de bord d'écran : la DERNIÈRE couche du HUD, donc peinte au-dessus des pastilles, de la barre du boss et
  // des bandes du bas. Une flèche dont la direction croise un de ces blocs doit rester visible : c'est elle qui
  // dit où sont les derniers robots (dessous, elle disparaissait dans une direction sur huit).
  const arrowLayer = el('div', 'sr-arrows');
  for (let k = 0; k < ARROW_MAX; k++) {
    const a = el('div', 'sr-arrow');
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 28 28');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', 'M3 3 26 14 3 25 9 14z');
    s.appendChild(p);
    a.appendChild(s);
    arrowLayer.appendChild(a);
    arrowEls.push(a);
    arrowStyles.push(a.style);
  }
  // Flèche de la capsule de ravitaillement (§ E1.C) : même dessin, cyan (classe sr-beacon), jamais comptée avec les autres.
  {
    const a = el('div', 'sr-arrow sr-beacon');
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 28 28');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', 'M3 3 26 14 3 25 9 14z');
    s.appendChild(p);
    a.appendChild(s);
    arrowLayer.appendChild(a);
    beaconEl = a;
    beaconStyle = a.style;
  }
  buildCarrierBeacons(arrowLayer); // § E2.C : flèches or des élites porteuses
  hud.appendChild(arrowLayer);
  root.appendChild(hud);
}

/**
 * § E3.J — calque « carte mère » du HUD (référence de Femz, FEMZ_1511D) : la puce CPU en haut à gauche et ses pistes
 * (vers le bord, vers la colonne des objets, vers la cartouche VAGUE), les deux faisceaux de part et d'autre de la
 * rangée d'armes. Construit une fois ; en combat, seul le cran de la puce s'écrit (update, sur changement).
 * Unités des pistes : 1/16 rem (= 1 px en 1280 × 720) ; positions dans ui.css.
 */
function buildHudCarte() {
  hudCarte = el('div', 'sr-hud-carte');
  const pp = pistes(8.75, 6, 'sr-pistes-puce');
  piste(pp, [53, 30, 28, 30, 20, 22, 0, 22], [1]);
  piste(pp, [53, 44, 32, 44, 24, 52, 0, 52], [1], 'jaune');
  piste(pp, [84, 68, 84, 86], -1, 'on');
  piste(pp, [115, 33, 140, 33], [0], 'on');
  piste(pp, [115, 42, 124, 42, 130, 48, 140, 48], [3]);
  hudCarte.appendChild(pp);
  hudCarte.appendChild(puce('sr-hud-puce').root);
  for (let k = 0; k < 2; k++) {
    const f = pistes(9, 4, k === 0 ? 'sr-pistes-armes sr-pistes-gauche' : 'sr-pistes-armes sr-pistes-droite');
    piste(f, [144, 24, 120, 24, 110, 14, 52, 14, 44, 6, 30, 6], [5]);
    piste(f, [144, 30, 98, 30, 90, 22, 58, 22], [3], 'jaune');
    piste(f, [144, 34, 18, 34], [1]);
    piste(f, [144, 40, 120, 40, 110, 50, 56, 50, 48, 58, 36, 58], [5]);
    hudCarte.appendChild(f);
  }
  initPuce(hudCarte);
  hud.appendChild(hudCarte);
}

function addScreen(id, node) {
  screens[id] = node;
  screenList.push(node);
  root.appendChild(node);
}

function buildTitle() {
  const title = el('div', 'sr-screen sr-title');

  // Le décor 3D du menu occupe tout l'écran. Logo centré en haut : le logo pixel (assets/logo/ctrlz-logo.png) porte
  // le nom en texte alternatif ; le nom reste aussi dans le h1, non affiché (textContent lu par les tests).
  const h1 = el('h1', 'sr-logo');
  const logo = el('img');
  logo.src = UI.logoSrc;
  logo.alt = UI.title;
  logo.draggable = false;
  h1.append(logo, el('span', 'sr-hidden', UI.title));
  title.appendChild(h1);

  // « Jouer » centré en bas. Modèles des unités en cours de chargement (§ Z quinquies) : il attend, la demande est
  // gardée, et l'état s'affiche dessous.
  const foot = el('div', 'sr-title-foot');
  // menus « Pile » (19/11, Femz) : liste de mots à gauche, AUCUNE touche affichée sur les boutons des menus
  titlePlay = button('Jouer', 'sr-btn sr-primary', click(() => actions.start()));
  titlePlayLabel = titlePlay.querySelector('.sr-btn-label');
  titleStatus = el('p', 'sr-lead sr-title-status', '');
  titleStatus.setAttribute('role', 'status');
  // § E4.B.1 : « Noyau » (le hub) à côté de « Jouer », même style FUI, touche H
  titleHub = button(HUB.bouton, 'sr-btn sr-title-hub', click(() => actions.openHub())); // touche H toujours active (main.js)
  // « Réglages » : déplie le panneau d'infos (record détaillé, règle du jeu, réglages) ; son en-tête n'est plus cliquable
  titleReglages = button('Réglages', 'sr-btn sr-title-reglages', () => {
    audio.play(SFX.UI_CLICK);
    paramOuvrir(0); // § E5.R (Femz, 21/11) : « réglage ouvre vers une autre fenêtre »
  });
  const boutons = el('div', 'sr-title-boutons');
  boutons.append(titlePlay, titleHub, titleReglages);
  // App de bureau (bureau/preload.js) : « Quitter » à côté du Noyau — le jeu y est en plein écran. Absent sur le web.
  if (typeof window !== 'undefined' && window.ctrlzApp && typeof window.ctrlzApp.quitter === 'function') {
    boutons.append(button('Quitter', 'sr-btn sr-title-hub sr-title-quitter', click(() => window.ctrlzApp.quitter())));
  }
  foot.append(buildPseudo(), boutons, titleStatus); // 16/11, point 7 : le pseudo, au-dessus de « Jouer »
  title.appendChild(foot);

  // En bas à droite, repliable : replié, le record seul ; déplié, le détail du meilleur score, la règle du jeu et
  // les réglages. L'état ouvert / replié vient de main.js (titleView.infosOpen), qui le garde d'une visite à l'autre.
  infosBox = el('div', 'sr-infos sr-cadre');
  const head = pressable(el('button', 'sr-infos-head'), () => {
    audio.play(SFX.UI_CLICK);
    setInfosOpen(!infosOpen, true);
  });
  titleRecord = el('span', 'sr-num', '');
  const record = el('span', 'sr-infos-record');
  record.append(el('span', 'sr-infos-label', 'Record'), titleRecord);
  head.append(record, el('span', 'sr-infos-chevron'));
  infosBody = el('div', 'sr-infos-body');
  const best = el('div', 'sr-best');
  titleBestCells = el('div', 'sr-cells');
  titleBestNums = [
    cell('vague atteinte', titleBestCells),
    cell('robots détruits', titleBestCells),
    cell('niveau', titleBestCells),
    cell('temps', titleBestCells),
  ];
  titleBestEmpty = el('div', 'sr-lead', 'Aucune partie terminée pour le moment.');
  best.append(titleBestCells, titleBestEmpty);
  infosBody.append(best, el('div', 'sr-rule'), el('p', 'sr-lead sr-infos-rule', 'Déplacez-vous : vos armes tirent toutes seules. Tenez vague après vague.'));
  infosBox.append(head, infosBody);
  title.appendChild(infosBox);
  setInfosOpen(false, false);
  // § E4.I.6 : notes de version, colonne gauche (parallaxe légère, comme l'écran des agents)
  title.appendChild(notes.build({ el, pressable, audio, SFX, actions }));
  plxBind(title);
  addScreen(SCREEN.TITLE, title);
}

/** Déplie ou replie le panneau d'infos ; au clic, main.js garde l'état pour la visite suivante (STORAGE.infosKey). */
let titleReglages = null; // menus « Pile » : le bouton « Réglages » de l'écran titre (aria-expanded = panneau ouvert)
function setInfosOpen(open, save) {
  infosOpen = open;
  infosBox.classList.toggle('sr-open', open); // classList : garde sr-sans-record (fillTitle)
  if (titleReglages) titleReglages.setAttribute('aria-expanded', open ? 'true' : 'false');
  infosBody.style.display = open ? '' : 'none';
  if (save) actions.setInfosOpen(open);
}

// ----- § E4.D (étape 4, chantier D) : bloc « Touches » de la pause — tableau aligné, toutes les touches réglables -----
// Demande de Femz du 16/11 (10h30) : « amerliore la lisibilité, l'estetique et rend les touches modifiable ». Une ligne
// par action : le nom à gauche, la touche principale et la secondaire à droite dans deux colonnes de largeur fixe.
// Clic sur une touche → « Appuyez sur une touche » → la touche est prise (input.regler : échange en cas de conflit).
// Tout se fait en pause (hors combat) : chaînes et fermetures permises. Le stockage est tenu par input.js.
const touchesUI = { cases: [], statut: null, attente: null, echange: null };
const indices = []; // { span, id } : aides « touche » affichées ailleurs (boutons, cartes, onglets du hub)

/** Enregistre une aide : son texte suivra la touche réglée de la ligne id (majIndices). */
function indice(span, id) {
  indices.push({ span, id });
  return span;
}

/** Réécrit toutes les aides (au réglage, au remplissage du titre et de la pause). */
function majIndices() {
  if (!ctx || !ctx.input || !ctx.input.libelle) return;
  for (const o of indices) setText(o.span, ctx.input.libelle(o.id));
}

function fmt(t, o) {
  return t.replace(/\{(\w)\}/g, (m, k) => (o[k] !== undefined ? o[k] : m));
}

function nomLigne(id) {
  for (const L of TOUCHES.lignes) if (L.id === id) return L.label;
  return id;
}

function libelleCode(code) {
  return code ? ctx.input.keyLabel(code) : TOUCHES.textes.vide;
}

function statutTouches(t) {
  if (touchesUI.statut) setText(touchesUI.statut, t);
}

function keysBlock(parent) {
  const T = TOUCHES.textes;
  const box = el('div', 'sr-touches');
  const cols = el('div', 'sr-touches-cols');
  const colonnes = [el('div', 'sr-touches-col'), el('div', 'sr-touches-col')];
  for (const c of colonnes) {
    const tete = el('div', 'sr-touches-tete');
    tete.append(el('span', 'sr-touches-th sr-touches-th-nom', 'Action'), el('span', 'sr-touches-th', T.principale), el('span', 'sr-touches-th', T.secondaire));
    c.appendChild(tete);
  }
  for (const L of TOUCHES.lignes) {
    const col = colonnes[L.col];
    if (L.groupe) col.appendChild(el('div', 'sr-touches-groupe', L.groupe));
    const row = el('div', 'sr-touches-ligne');
    row.appendChild(el('span', 'sr-touches-nom', L.label));
    for (let s = 0; s < 2; s++) {
      const b = el('button', 'sr-touche');
      b.title = 'Changer la touche : cliquez, puis appuyez sur la touche voulue';
      b.setAttribute('aria-label', L.label + ' · ' + (s === 0 ? T.principale : T.secondaire));
      b.dataset.touche = L.id + ':' + s;
      const o = { btn: b, id: L.id, slot: s, label: L.label };
      // survol : un tic léger de la banque (« Clic.wav » transposé), pas pendant l'attente de cette case
      b.addEventListener('pointerenter', () => {
        if (touchesUI.attente !== o) audio.play(SFX.ROULETTE_TICK);
      });
      pressable(b, () => attendreTouche(o));
      touchesUI.cases.push(o);
      row.appendChild(b);
    }
    col.appendChild(row);
  }
  cols.append(colonnes[0], colonnes[1]);
  const pied = el('div', 'sr-touches-pied');
  touchesUI.statut = el('p', 'sr-touches-statut', T.repos);
  touchesUI.statut.setAttribute('role', 'status');
  const defaut = button(T.boutonDefaut, 'sr-btn sr-touches-defaut', click(() => {
    annulerAttente();
    ctx.input.touchesParDefaut();
    touchesUI.echange = null;
    const qw = ctx.input.getLayout() === 'qwerty';
    statutTouches(fmt(T.defaut, { d: qw ? 'QWERTY : W A S D, Q / E' : 'AZERTY : Z Q S D, A / E' }));
    majTouches();
  }));
  pied.append(touchesUI.statut, el('p', 'sr-touches-garde', T.garde), defaut);
  box.append(cols, pied);
  parent.appendChild(box);
}

/** Clic sur une touche : elle attend la prochaine touche pressée (input.captureKey). Échap annule. */
function attendreTouche(o) {
  const T = TOUCHES.textes;
  annulerAttente();
  touchesUI.echange = null;
  touchesUI.attente = o;
  audio.play(SFX.UI_OPEN);
  statutTouches(fmt(T.attente, { a: o.label }));
  peindreTouches();
  ctx.input.captureKey((code) => {
    touchesUI.attente = null;
    if (code === 'Escape') {
      statutTouches(T.annule);
    } else {
      const r = ctx.input.regler(o.id, o.slot, code);
      if (!r.ok) statutTouches(r.motif === 'seule' ? fmt(T.seule, { a: o.label }) : fmt(T.reservee, { t: libelleCode(code) }));
      else if (r.motif === 'efface') statutTouches(fmt(T.efface, { a: o.label }));
      else if (r.echange !== null) {
        touchesUI.echange = r.echange;
        const b = nomLigne(r.echange.id);
        statutTouches(fmt(r.vide || !r.echange.code ? T.echangeVide : T.echange, { t: libelleCode(code), b, u: libelleCode(r.echange.code) }));
      } else statutTouches(fmt(T.pris, { a: o.label, t: libelleCode(code) }));
    }
    audio.play(SFX.UI_CLICK);
    majTouches();
  });
}

/** Annule une attente en cours (pause refermée, autre case cliquée, « Touches par défaut »). */
function annulerAttente() {
  if (touchesUI.attente === null) return;
  touchesUI.attente = null;
  if (ctx && ctx.input) ctx.input.captureKey(null);
  statutTouches(TOUCHES.textes.repos);
  peindreTouches();
}

function peindreTouches() {
  if (!ctx || !ctx.input || !ctx.input.touches || touchesUI.cases.length === 0) return;
  const t = ctx.input.touches();
  const E = touchesUI.echange;
  for (const o of touchesUI.cases) {
    const code = t[o.id][o.slot];
    const attente = touchesUI.attente === o;
    setText(o.btn, attente ? TOUCHES.textes.attenteCase : libelleCode(code));
    let cls = 'sr-touche';
    if (attente) cls += ' sr-attente';
    else if (E !== null && E.id === o.id && E.slot === o.slot) cls += ' sr-echangee';
    if (!attente && !code) cls += ' sr-vide';
    if (!attente && code.startsWith('Arrow')) cls += ' sr-glyphe';
    setClass(o.btn, cls);
  }
}

function majTouches() {
  peindreTouches();
  majIndices();
}

/** Remplissage de la pause (main : pauseView.layout) : libellés selon la disposition détectée. */
function fillKeys() {
  majTouches();
}

/** Tests (§ E4.D.4) : cases du tableau, ligne d'état, aides affichées ailleurs. Hors chemin chaud. */
export function touchesInspect() {
  return {
    statut: touchesUI.statut ? touchesUI.statut.textContent : '',
    attente: touchesUI.attente ? touchesUI.attente.id + ':' + touchesUI.attente.slot : null,
    cases: touchesUI.cases.map((o) => ({ id: o.id, slot: o.slot, texte: o.btn.textContent, cls: o.btn.className })),
    indices: indices.map((o) => ({ id: o.id, texte: o.span.textContent, ecran: o.span.closest('.sr-screen') ? o.span.closest('.sr-screen').className.split(' ')[1] : '' })),
  };
}

/** Fiche de l'agent (DA carte mère, réfs de Femz : inventaire pixel art, Octatrack) : portrait pixelisé du héros
 *  (assets/ui/agent.png) entre ses six emplacements d'arme, niveau et XP, grille des dix bonus, bilan de la partie. */
function buildFiche() {
  const fiche = el('div', 'sr-fiche sr-facet');
  ficheEl = fiche; // § E4.L.1 : le même nœud sert à la pause et au Noyau
  ficheTitre = el('h2', null, 'Agent'); // § E2.D : le nom de l'agent (majFiche)
  fiche.appendChild(ficheTitre);
  const niv = el('div', 'sr-fiche-niv');
  ficheNiv = el('span', 'sr-num sr-fiche-niv-n', '');
  const lab = el('span', 'sr-fiche-lab', 'NIV.');
  const barre = el('div', 'sr-fiche-xp');
  ficheXpFill = el('div', 'sr-fiche-xp-fill');
  barre.appendChild(ficheXpFill);
  ficheXp = el('span', 'sr-fiche-xp-txt sr-num', '');
  niv.append(lab, ficheNiv, barre, ficheXp);
  const corps = el('div', 'sr-fiche-corps');
  const colonne = (liste) => {
    const c = el('div', 'sr-fiche-col');
    for (const k of liste) {
      // case de l'emplacement k : creuse et sans icône tant qu'aucune arme ne l'occupe (remplie par majFiche)
      const cell = el('div', 'sr-fiche-arme sr-vide');
      const ic = icon('sr-w0');
      ic.firstChild.removeAttribute('href');
      const lvl = el('span', 'sr-fiche-arme-niv sr-num', '');
      cell.append(ic, lvl);
      c.appendChild(cell);
      ficheArmes[k] = { cell, use: ic.firstChild, lvl };
    }
    return c;
  };
  const portrait = el('div', 'sr-fiche-portrait');
  // Femz (21/11) : avant le modèle 3D, la fiche montre la planche animée de l'écran des agents (80 × 120 px d'art),
  // plus la vignette 48 × 68 agrandie (« un ancien look pixel ») ; le cadre coupe la planche à une image
  const fig = el('div', 'sr-fiche-fig');
  const img = el('img');
  img.src = 'assets/ui/agent.png';
  img.alt = '';
  img.draggable = false;
  fig.appendChild(img);
  portrait.appendChild(fig);
  fichePortrait = img; // § E2.D : portrait à la teinte de l'agent (majFiche)
  ficheCanvas3d = el('canvas', 'sr-fiche-3d'); // § E3.I : l'agent en 3D (src/pause-agent.js) ; l'image reste le repli
  ficheCanvas3d.setAttribute('aria-hidden', 'true');
  portrait.appendChild(ficheCanvas3d);
  fichePortraitBox = portrait;
  // § E4.L.1 : bloc « passif » (Noyau seulement : caché en pause par le CSS) — nom et phrase, ou cadenas et condition ;
  // posé sous l'arme signature, à côté du portrait (la fiche du Noyau tient en hauteur en 1280 × 720)
  fichePassif = el('div', 'sr-fiche-passif');
  fichePassifNom = el('div', 'sr-fiche-passif-nom', '');
  fichePassifTxt = el('div', 'sr-fiche-passif-txt', '');
  fichePassifProg = el('div', 'sr-num sr-fiche-passif-prog', '');
  fichePassif.append(fichePassifNom, fichePassifTxt, fichePassifProg);
  const colG = colonne(FICHE_GAUCHE);
  colG.appendChild(fichePassif);
  corps.append(colG, portrait, colonne(FICHE_DROITE));
  const grille = el('div', 'sr-fiche-bonus');
  for (const b of PROGRESSION.bonuses) {
    const cell = el('div', 'sr-fiche-b');
    cell.title = b.name;
    const ic = icon(BONUS_ICONS[b.key] === 1 ? 'sr-b-' + b.key : 'sr-b-default');
    const n = el('span', 'sr-num', '');
    cell.append(ic, n);
    grille.appendChild(cell);
    ficheBonus.push({ cell, n, id: b.id, max: b.maxStacks });
  }
  // § E2.F : les objets passifs de la partie — icône, nom, piles, valeur actuelle
  ficheObjetsBox = el('div', 'sr-fiche-objets');
  for (let k = 0; k < ITEM_RULES.slots; k++) {
    const cell = el('div', 'sr-fiche-o sr-vide');
    const ic = icon('sr-m-tesla');
    const txt = el('div', 'sr-fiche-o-txt');
    const name = el('span', 'sr-fiche-o-nom', '');
    const val = el('span', 'sr-fiche-o-val', '');
    txt.append(name, val);
    const n = el('span', 'sr-num sr-fiche-o-n', '');
    cell.append(ic, txt, n);
    ficheObjetsBox.appendChild(cell);
    ficheObjets.push({ cell, use: ic.firstChild, name, n, val });
  }
  // § E3.I (img2) : plus de ligne du bas « VAGUE · ROBOTS · chrono · fragments » — le HUD la montre déjà
  fiche.append(niv, corps, grille, ficheObjetsBox);
  fiche.appendChild(legendeX7()); // § E5.X7 (A13) : repères du HUD (pause seulement : cachée au Noyau par ui.css)
  ficheCarac = buildCarac(); // § E4.E.2 : colonne CARACTÉRISTIQUES, posée à gauche de la fiche (ui.css)
  fiche.appendChild(ficheCarac.box);
  return fiche;
}

/** Remplit la fiche à l'ouverture de la pause (pas à chaque image : la partie est gelée pendant la pause). */
function majFiche() {
  // § E2.D : la fiche est celle de l'agent de la partie (nom, portrait teinté)
  // Retours de Femz du 16/11/2026 (point 7) : « a la place de "agent / fiche" mettre le type d'agent, ex: shinobi, a la
  // place de shinobi mettre notre pseudo » — la petite ligne (h2::before, attr(data-type)) = le type, le titre = le pseudo
  ficheTitre.dataset.type = AGENTS[run.agent].name.toUpperCase();
  setText(ficheTitre, pseudo());
  remplirCarac(ficheCarac, run.agent, true); // § E4.E.2 : les stats lues dans l'état du jeu
  ficheImage(fichePortrait, run.agent, false); // § E4.L.2 : la fiche a pu montrer une silhouette au Noyau
  setText(ficheNiv, String(run.level));
  const r = run.xpToNext > 0 ? Math.max(0, Math.min(1, run.xp / run.xpToNext)) : 0;
  ficheXpFill.style.transform = 'scaleX(' + r.toFixed(3) + ')';
  setText(ficheXp, intStr(Math.floor(run.xp)) + ' / ' + intStr(Math.floor(run.xpToNext)));
  // § E2.J : case k = arme de l'emplacement k (weapons.slots), comme la rangée d'armes du HUD
  for (let k = 0; k < ficheArmes.length; k++) {
    const a = ficheArmes[k];
    if (!a) continue;
    const w = k < weapons.slots.length ? weapons.slots[k] : -1;
    if (w >= 0) {
      a.cell.className = evoDe(w) >= 0 ? 'sr-fiche-arme sr-evo' : 'sr-fiche-arme';
      a.use.setAttribute('href', hrefArme(w));
      a.cell.style.setProperty('--wc', SLOT_COLOR[w]);
      a.cell.title = titreArme(w);
      setText(a.lvl, String(weapons.getWeaponLevel(w)));
      // look glow (20/11) : filet et lueur de la case à la couleur du PALIER de niveau (HUD_PALIERS, comme le HUD)
      a.cell.style.setProperty('--c', HUD_PALIERS[PAL_DE_NIV[Math.max(1, Math.min(weapons.getWeaponLevel(w), PAL_MAX_NIV))]].couleur);
    } else {
      a.cell.className = 'sr-fiche-arme sr-vide';
      a.use.removeAttribute('href');
      a.cell.style.removeProperty('--wc');
      a.cell.title = '';
      setText(a.lvl, '');
    }
  }
  for (const b of ficheBonus) {
    const k = progressionMod ? progressionMod.getStacks(b.id) : 0;
    b.cell.className = k > 0 ? 'sr-fiche-b' : 'sr-fiche-b sr-vide';
    setText(b.n, k + '/' + b.max);
  }
  // § E2.F : objets passifs (la rangée du HUD, avec le nom et la valeur actuelle de chacun)
  for (let k = 0; k < ficheObjets.length; k++) {
    const o = ficheObjets[k];
    const id = itemsMod ? itemsMod.slots[k] : -1;
    o.cell.className = id >= 0 ? 'sr-fiche-o' : 'sr-fiche-o sr-vide';
    if (id < 0) {
      setText(o.name, '');
      setText(o.val, '');
      setText(o.n, '');
      continue;
    }
    o.use.setAttribute('href', ITEM_HREF[id]);
    o.cell.style.setProperty('--ic', ITEM_COLOR[id]);
    setText(o.name, ITEM_TITLE[id]);
    setText(o.n, '\u00d7' + itemsMod.slotStacks(k));
    // valeur actuelle ; ce qu'elle mesure est dans l'infobulle de la case
    if (id < ITEM_COUNT) {
      setText(o.val, itemText(id, itemsMod.getStacks(id)));
      o.cell.title = ITEMS[id].name + ' — ' + ITEMS[id].what + ' : ' + itemText(id, itemsMod.getStacks(id)) + '. ' + ITEMS[id].desc;
    } else {
      setText(o.val, '');
      o.cell.title = ITEM_TITLE[id] + ' — ' + ITEMS[FUSIONS[id - ITEM_COUNT].a].name + ' + ' + ITEMS[FUSIONS[id - ITEM_COUNT].b].name;
    }
  }
}

function buildPause() {
  const pause = el('div', 'sr-screen sr-pause');
  // Retour de Femz du 16/11/2026 (point 1) : « le menu devrais etre une box au dessus de la box du perso qui est
  // collapse "menu" sinon ya trop d'infos, quand on clique dessus on voit que la fenettre menu en ui avec une croix pour
  // revenir en arriere. » — colonne de gauche = boîte repliée « MENU » posée AU-DESSUS de la fiche ; la fenêtre du menu
  // (le panneau ci-dessous) n'est visible qu'ouverte (classe sr-pause-menu-on), seule, avec une croix (et Échap) pour
  // revenir à la fiche.
  if (CARTE) {
    const gauche = el('div', 'sr-pause-gauche');
    gauche.append(buildMenuPli(), buildFiche());
    pauseGauche = gauche; // § E4.L.1 : hôte de la fiche en pause
    pause.appendChild(gauche);
  }
  // menus « Pile » (19/11, Femz) : Échap ouvre CE menu (liste de mots, barre jaune au survol), Tab la fiche de l'agent.
  // Aucune touche affichée sur les boutons ; plus de croix (Échap reprend la partie, « Fiche de l'agent » y mène).
  const panel = el('div', 'sr-panel sr-facet');
  panel.appendChild(el('h2', null, 'Pause'));
  panel.appendChild(el('p', 'sr-pause-fige', 'Le jeu est figé. Rien ne bouge tant que vous n\u2019avez pas repris.'));
  const col = el('div', 'sr-btn-col');
  col.append(button('Reprendre', 'sr-btn sr-primary', click(() => actions.resume())));
  if (CARTE) col.append(button('Inventaire', 'sr-btn sr-pause-vers-fiche', click(() => setMenuOpen(false)))); // la fiche de l'agent (Femz, 19/11 : « Inventaire »)
  const recommencer = confirmable('Recommencer', 'sr-btn sr-pause-recommencer', () => actions.restart()); // § E5.S (A6) : deux clics
  if (!CARTE) col.append(recommencer); // thème désert : place d'avant
  panel.append(col, el('div', 'sr-rule'));
  // § E3.I (img1) : réglages et touches repliés derrière deux boutons (bloc e3:I-pause en fin de fichier) ; § E5.AG (Femz,
  // 22/11) : en carte mère, plus de bouton « Touches » — le bloc est dans l'onglet Commandes de la fenêtre Paramètres
  buildPlis(panel, () => {}, keysBlock); // § E5.R : « Paramètres » ouvre la fenêtre Paramètres
  const fin = el('div', 'sr-btn-col sr-pause-fin');
  if (CARTE) fin.append(recommencer); // § E5.AG : en bas, juste au-dessus de « Quitter la partie »
  fin.append(confirmable('Quitter la partie', 'sr-btn sr-pause-quitter', () => actions.quitToTitle())); // § E5.S (A6)
  panel.appendChild(fin);
  pause.appendChild(panel);
  pausePanel = panel;
  pauseEl = pause;
  if (CARTE) buildDetail(pause); // § E3.I : fiche d'un élément au clic
  addScreen(SCREEN.PAUSE, pause);
}

function buildLevelUp() {
  const levelup = el('div', 'sr-screen sr-levelup');
  const head = el('div', 'sr-levelup-head');
  levelTitle = el('h2', null, 'Niveau 2');
  levelPending = el('p', 'sr-pending', '');
  head.append(levelTitle, el('p', 'sr-lead', CHOICES.itemText ? CHOICES.itemText.lead : 'Choisissez un bonus.'), levelPending);
  levelup.appendChild(head);

  cardsBox = el('div', 'sr-cards');
  for (let i = 0; i < 3; i++) {
    // La touche 1, 2 ou 3 fait le même choix (main.handleKeys) : le chiffre affiché est celui de la touche.
    const card = pressable(el('button', 'sr-card sr-facet'), () => actions.chooseBonus(i));
    const top = el('div', 'sr-card-top');
    const ic = icon('sr-b-default');
    top.append(ic, indice(el('span', 'sr-key', ''), 'choix' + (i + 1))); // § E4.D
    const name = el('div', 'sr-card-name');
    const desc = el('div', 'sr-card-desc');
    const stacks = el('div', 'sr-card-stacks');
    const list = pips(STAT_MAX_LEVEL, stacks);
    const count = el('span', 'sr-num', '');
    stacks.appendChild(count);
    // § E2.F : étiquette d'une carte d'objet (« MODULE · Optimisé »), vide et masquée pour un bonus
    const tag = el('div', 'sr-card-tag', '');
    // § E3.F : pastille « ? » d'une carte d'objet qui fusionnerait avec un objet possédé (masquée sinon)
    const fuse = el('div', 'sr-card-fuse');
    fuse.append(el('span', 'sr-card-fuse-q', FUSION_SCREEN.unknown), el('span', 'sr-card-fuse-t', ''));
    fuse.style.display = 'none';
    // § E5.L (A10, C18) : barre de rang d'une carte d'objet, comme sur les lots du coffre (« Brut · rareté 1/6 »)
    const rar = el('div', 'sr-lot-rarity sr-card-rarete');
    const rarName = el('span', 'sr-lot-rarity-name', '');
    rar.appendChild(rarName);
    const rarPips = pips(RARITIES.length, rar);
    rar.style.display = 'none';
    card.append(rar, top, tag, name, desc, stacks, fuse);
    cardsBox.appendChild(card);
    bonusCards.push({ card, use: ic.firstChild, name, desc, stacks, pips: list, count, tag, fuse, rar, rarName, rarPips });
  }
  levelup.appendChild(cardsBox);
  // § E2.D : Relancer / Passer / Bannir, avec leurs compteurs (touches R, X, B — main.handleKeys)
  levelBar = choiceBar({ reroll: () => actions.rerollChoices(), skip: () => actions.skipChoice(), banish: () => actions.armBanish() });
  levelup.appendChild(levelBar.node);
  addScreen(SCREEN.LEVELUP, levelup);
}

/**
 * § E2.D — barre « Relancer / Passer / Bannir » : trois boutons avec la touche et le compteur restant. Réutilisable
 * (choix de niveau ici ; choix du lot d'un coffre, chantier C). handlers : { reroll, skip, banish } (banish ARME le
 * bannissement : la carte ou le lot choisi ensuite est banni). Rend { node, fill(rerolls, skips, banishes, armed) }.
 */
export function choiceBar(handlers) {
  const node = el('div', 'sr-choix');
  const L = CHOICES.labels;
  const make = (label, key, fn) => {
    const b = button(label, 'sr-btn sr-choix-btn', fn, key);
    const n = el('span', 'sr-num sr-choix-n', '');
    b.appendChild(n);
    node.appendChild(b);
    return { b, n, label: b.querySelector('.sr-btn-label') };
  };
  const reroll = make(L.reroll, '@relancer', handlers.reroll); // § E4.D : touches réglées
  const skip = make(L.skip, '@passer', handlers.skip);
  const banish = make(L.banish, '@bannir', handlers.banish);
  const paint = (o, count, cls) => {
    setText(o.n, '\u00d7' + (count > 0 ? count : 0));
    setClass(o.b, count > 0 ? cls : cls + ' sr-disabled');
  };
  return {
    node,
    /** § E5.L (C7) : ce que rend une passe, écrit sur le bouton (hors combat). */
    passe(n) {
      setText(skip.label, L.skipGain ? L.skipGain.replace('{n}', intStr(n)) : L.skip);
    },
    fill(rerolls, skips, banishes, armed) {
      paint(reroll, rerolls, 'sr-btn sr-choix-btn');
      paint(skip, skips, 'sr-btn sr-choix-btn');
      paint(banish, banishes, armed ? 'sr-btn sr-choix-btn sr-arme' : 'sr-btn sr-choix-btn');
      setText(banish.label, armed ? L.banishArmed : L.banish);
    },
  };
}

/** § E2.D — bannissement armé ou non : le bouton « Bannir » et les cartes passent au rouge (main.armBanish). */
export function setBanishArmed(on) {
  banishArmed = !!on;
  if (levelBar === null) return;
  levelBar.fill(levelCounts[0], levelCounts[1], levelCounts[2], banishArmed);
  setClass(screens[SCREEN.LEVELUP], banishArmed ? 'sr-screen sr-levelup sr-bannir' : 'sr-screen sr-levelup');
}

function buildShop() {
  const shop = el('div', 'sr-screen sr-shop');

  const head = el('div', 'sr-shop-head');
  const headLeft = el('div');
  const next = el('p', 'sr-shop-next', 'Prochaine vague : ');
  shopNext = el('span', 'sr-num', '');
  next.appendChild(shopNext);
  headLeft.append(el('h2', null, PALIERS_VAGUES.nomDecryptage), next); // § E5.V : « Décryptage » (marchand ou terminal)
  if (PALIERS_VAGUES.explication) headLeft.appendChild(el('p', 'sr-shop-explique', PALIERS_VAGUES.explication)); // § E5.L : « Décryptage » expliqué
  // § E5.X7 (H6, H16) : le soin reçu à l'ouverture (PV réels), puis ce que deviennent les fragments
  shopSoinX7 = el('p', 'sr-shop-explique sr-shop-soin', '');
  headLeft.append(shopSoinX7, el('p', 'sr-shop-explique sr-shop-perdus', DECRYPTAGE_X7.fragments));
  const balance = el('div', 'sr-shop-balance');
  shopBalance = el('span', 'sr-num', '0');
  balance.append(icon('sr-i-frag'), shopBalance, el('span', 'sr-shop-balance-label', 'fragments'));
  shopBalanceBox = balance; // § E4.S.9 : icône + chiffre, « 900 fragments » en bulle (data-bulle)
  head.append(headLeft, balance);
  shop.appendChild(head);

  const grid = el('div', 'sr-shop-grid');
  // Marchand « A3 » : deux colonnes — l'arsenal (cases) à gauche, la carte de l'arme choisie à droite
  const corpsShop = el('div', 'sr-shop-corps');
  const colG = el('div', 'sr-shop-col sr-shop-col-g');
  const etiqG = el('p', 'sr-shop-etiq', 'Arsenal · ');
  shopCompte = el('span', 'sr-num', '');
  etiqG.appendChild(shopCompte);
  const cases = el('div', 'sr-shop-cases');
  colG.append(etiqG, cases);
  const colD = el('div', 'sr-shop-col sr-shop-col-d');
  colD.append(el('p', 'sr-shop-etiq', 'Améliorations'), grid);
  corpsShop.append(colG, colD);
  for (let w = 0; w < WEAPON_COUNT; w++) {
    const card = el('div', 'sr-wcard sr-facet');
    // case de l'arsenal : choisir l'arme (survol ou clic)
    const tile = el('button', 'sr-shop-case');
    tile.type = 'button';
    tile.style.display = 'none';
    const tileN = el('span', 'sr-shop-case-n sr-num', '');
    tile.append(icon('sr-w' + w), tileN);
    tile.addEventListener('pointerenter', () => shopChoisir(w));
    tile.addEventListener('click', () => shopChoisir(w));
    cases.appendChild(tile);
    const cardHead = el('div', 'sr-wcard-head');
    const name = el('div', 'sr-wname', WEAPONS[w].name);

    const level = el('span', 'sr-wlevel');
    const levelN = el('span', 'sr-num', '1');
    level.append(el('span', 'sr-wlevel-lab', 'Niv. '), levelN); // § E5.E.3 : « Niv. » à part (caché dans la pastille M3)

    const lock = el('span', 'sr-wlock');
    const lockN = el('span', 'sr-num', '');
    lock.append(icon('sr-i-lock'), document.createTextNode('Vague '), lockN);

    // offerId = w × 8 + k : k = 0 débloque l'arme, k = 1…5 améliore la stat k − 1 (§ L).
    const buy = pressable(el('button', 'sr-btn sr-buy'), () => actions.buy(w * 8));
    const buyN = el('span', 'sr-num', '');
    buy.append(el('span', 'sr-btn-label', 'Acheter'), icon('sr-i-frag'), buyN, el('span', 'sr-sale-tag', SHOP.sale.label));

    cardHead.append(icon('sr-w' + w), name, level, lock, buy);
    const desc = el('div', 'sr-wdesc', WEAPONS[w].desc);

    const statBox = el('div', 'sr-stats');
    const rows = [];
    for (let s = 0; s < STAT_COUNT; s++) {
      const row = pressable(el('button', 'sr-stat'), () => x6Achat(w * 8 + 1 + s, price)); // § E5.X6 (F11) : refus visible
      row.addEventListener('pointerenter', () => shopVoirLigne(w, s));
      const label = el('span', 'sr-stat-label', WEAPONS[w].statLabels[s]);
      row.appendChild(label);
      const list = pips(STAT_MAX_LEVEL, row);
      const value = el('span', 'sr-stat-value');
      const cur = el('span', 'sr-val-cur', '');
      const nxt = el('span', 'sr-val-next', '');
      const unit = el('span', 'sr-val-unit', '');
      const gain = el('span', 'sr-val-gain sr-num', ''); // § E5.E.3 (M3) : « +2 », écrit par fillShop
      value.append(cur, el('span', 'sr-val-arrow', '→'), nxt, unit, gain);
      const price = el('span', 'sr-stat-price');
      const cost = el('span', 'sr-stat-cost sr-num', '');
      const costIcon = icon('sr-i-frag');
      costIcon.classList.add('sr-stat-cost');
      const manque = el('span', 'sr-stat-manque', ''); // § E5.X6 (F11) : « il manque N » sur une ligne trop chère
      price.append(costIcon, cost, el('span', 'sr-stat-max', 'max'), manque);
      row.append(value, price, el('span', 'sr-sale-tag', SHOP.sale.label));
      statBox.appendChild(row);
      rows.push({ row, label, pips: list, cur, nxt, unit, gain, cost, manque, level: -1, offre: w * 8 + 1 + s });
    }
    // Surcharge (§ E1.D) : la ligne n'existe à l'écran que pour une arme au niveau 21 (offerId = w × 8 + 7). Elle prend
    // alors LA PLACE de la description (même hauteur : la carte ne grandit pas, les rangées restent alignées et la
    // boutique tient toujours dans la fenêtre) — ui.css l'affiche entre l'en-tête et les stats.
    const ocRow = pressable(el('button', 'sr-stat sr-overcharge'), () => x6Achat(w * 8 + 7, ocPrice)); // § E5.X6 (F11)
    ocRow.addEventListener('pointerenter', () => shopVoirLigne(w, 7));
    ocRow.dataset.offre = String(w * 8 + 7);
    const ocLabel = el('span', 'sr-stat-label', SHOP.overcharge.label);
    const ocLevel = el('span', 'sr-oc-level sr-num', '+0');
    const ocValue = el('span', 'sr-stat-value');
    const ocCur = el('span', 'sr-val-cur', '');
    const ocNext = el('span', 'sr-val-next', '');
    const ocGain = el('span', 'sr-val-gain sr-num', ''); // § E5.E.3 (M3)
    ocValue.append(ocCur, el('span', 'sr-val-arrow', '→'), ocNext, el('span', 'sr-val-unit', 'dégâts'), ocGain);
    const ocPrice = el('span', 'sr-stat-price');
    const ocCost = el('span', 'sr-stat-cost sr-num', '');
    const ocIcon = icon('sr-i-frag');
    ocIcon.classList.add('sr-stat-cost');
    const ocManque = el('span', 'sr-stat-manque', ''); // § E5.X6 (F11)
    ocPrice.append(ocIcon, ocCost, ocManque);
    ocRow.append(ocLabel, ocLevel, ocValue, ocPrice, el('span', 'sr-sale-tag', SHOP.sale.label));
    ocRow.style.display = 'none';
    const oc = { row: ocRow, level: ocLevel, cur: ocCur, nxt: ocNext, gain: ocGain, cost: ocCost, manque: ocManque, shown: false, last: -1 };

    // § E4.S.8 — marchand v2 : carte VERTICALE (icône en haut, nom, niveau), puis 2 ou 3 améliorations en UNE ligne
    // chacune avec leur prix (lignesBox) ; les autres et la description longue vont dans le détail (detailBox), montré au
    // survol de la carte ou au focus clavier, SOUS la carte (rangée du haut) ou AU-DESSUS (rangée du bas). Les lignes
    // sont les rangées sr-stat d'avant, DÉPLACÉES d'un bloc à l'autre (hors combat) : mêmes boutons, même achat.
    const lignesBox = el('div', 'sr-wlignes');
    const detailBox = el('div', 'sr-wdetail');
    const longDesc = el('p', 'sr-wdetail-long', WEAPONS[w].detail || WEAPONS[w].desc);
    detailBox.append(longDesc, statBox);
    lignesBox.appendChild(ocRow);
    // sous l'arme : l'amélioration visée — son nom, son effet chiffré, une phrase (MARCHAND_PHRASES)
    const choix = el('div', 'sr-wchoix');
    const choixTitre = el('p', 'sr-wchoix-titre', '');
    const choixEffet = el('p', 'sr-wchoix-effet sr-num', '');
    const choixPhrase = el('p', 'sr-wchoix-phrase', '');
    choix.append(choixTitre, choixEffet, choixPhrase);
    lignesBox.addEventListener('pointerleave', () => shopVoirLigne(-1, -1));
    card.append(cardHead, desc, choix, lignesBox, detailBox);
    card.addEventListener('pointerenter', () => shopSurvol(w));
    grid.appendChild(card);
    shopCards.push({ card, state: -1, color: '', name, desc, buy, buyN, levelN, lockN, rows, oc, lignesBox, statBox, vues: -1, order: -1, tile, tileN, niv: -1, choixTitre, choixEffet, choixPhrase });
  }
  // § E4.T.2 : un emplacement d'arme libre = une case vide de la grille (même aspect que les cases vides du HUD), APRÈS
  // les cartes dans le DOM et sans la classe sr-wcard (tests, focus et achats ne voient que les cartes)
  for (let k = 0; k < CHESTS.weaponSlots; k++) {
    const vide = el('div', 'sr-wvide');
    vide.style.order = String(90 + k);
    vide.setAttribute('aria-hidden', 'true');
    cases.appendChild(vide); // « A3 » : les emplacements libres sont des cases de l'arsenal
    shopVides.push(vide);
  }
  shop.appendChild(corpsShop);

  const foot = el('div', 'sr-shop-foot');
  foot.appendChild(el('p', 'sr-lead', TEXTES_N.marchandPied)); // § E4.N.2 : aide permanente retirée (vide), le pied garde sa place
  shopFiniBtn = button("J'ai fini", 'sr-btn sr-primary', click(() => actions.finishShopping()), '@valider');
  foot.appendChild(shopFiniBtn);
  shop.appendChild(foot);
  addScreen(SCREEN.SHOP, shop);
}

function buildGameOver() {
  const over = el('div', 'sr-screen sr-gameover');
  const panel = el('div', 'sr-panel sr-facet');
  overTitre = el('h2', null, 'Hors service');
  overTitre.dataset.entete = enteteAgent(AGENTS[run.agent].name, pseudo()); // § E4.E.5 : « BASTION · FEMZ / ÉTAT » (ui.css)
  panel.appendChild(overTitre);
  overFlag = el('div', 'sr-over-flag', 'Nouveau meilleur score');
  //#region e5:Q-retours-guide
  // § E5.Q (C2) : ce qui a détruit le héros, et le type de robot qui lui a pris le plus de PV — deux lignes, un effet par ligne
  const causeBox = el('div', 'sr-over-cause');
  const detruit = el('p', 'sr-over-cause-ligne sr-over-cause-mort');
  const detruitVal = el('span', 'sr-over-cause-val', '');
  detruit.append(el('span', 'sr-over-cause-lab', RETOURS_GUIDE.textes.detruit), detruitVal);
  const plus = el('p', 'sr-over-cause-ligne');
  const plusVal = el('span', 'sr-over-cause-val', '');
  const plusPct = el('span', 'sr-over-cause-pct sr-num', '');
  plus.append(el('span', 'sr-over-cause-lab', RETOURS_GUIDE.textes.plus), plusVal, plusPct);
  //#region e5:AK-mort-claire
  // § E5.AK : sous « Détruit par », une phrase — ce qui s'est passé, comment l'éviter (classe à part : pas une « ligne »)
  const conseil = el('p', 'sr-over-cause-conseil', '');
  //#endregion e5:AK-mort-claire
  causeBox.append(detruit, conseil, plus);
  overCause = { box: causeBox, detruit, detruitVal, plus, plusVal, plusPct, conseil };
  //#endregion e5:Q-retours-guide
  const cells = el('div', 'sr-cells');
  overNums = [cell('vague atteinte', cells), cell('robots détruits', cells), cell('niveau', cells), cell('temps', cells)];
  overBest = el('p', 'sr-over-best', '');
  const bilanBox = bilanUI.build({ el, icon, hex, audio, SFX }); // § E4.C : deux blocs FUI sous les quatre cases
  const row = el('div', 'sr-btn-row');
  row.append(
    // § E5.Q (Femz, 21/11 ; règle du 19/11) : plus de touche affichée sur les boutons — Entrée relance toujours
    button('Rejouer', 'sr-btn sr-primary', click(() => actions.restart())),
    button('Menu', 'sr-btn', click(() => actions.quitToTitle())),
  );
  row.classList.add('sr-over-boutons'); // § E5.Q : look glow v2 (ui-pile.css)
  panel.append(overFlag, causeBox, cells, overBest, bilanBox, row);
  over.appendChild(panel);
  addScreen(SCREEN.GAMEOVER, over);
}

// ----- Écran Agents (tâche 5, maquette docs/maquettes-ecran-agents/grille-B2.png) : grille des agents, fiche (tâche 6) ---
// Pleine page sur le fond peint (VITRINE.fonds.grille) : la scène derrière n'est pas rendue (main.js, F14). Une carte par
// agent = image précalculée (VITRINE.cartes : l'agent dans son skin CHOISI, ou sa silhouette s'il est verrouillé) ; rôle,
// nom, arme de départ, « N skins » à partir de 2 ; verrouillé : cadenas, condition et progression du succès qui le
// débloque. Un seul élément jaune : le focus (carte visée, vignette de skin, ou « Retour » / « Jouer »). « Jouer · <agent> »
// en blanc. Aucune touche affichée. Flèches, Entrée, Échap (= Retour) : main.js → agentsBouger / agentsConfirmer /
// actions.agentRetour. La vue FICHE (tâche 6) est construite et remplie par src/ui-agents-fiche.js ; le focus, le pied et
// les touches restent ici. Ouvert depuis le titre, le focus est sur « Jouer · <dernier agent> » (Entrée, Entrée relance).

const AE_RETOUR = AGENT_COUNT; // focus : 0 … AGENT_COUNT − 1 = une carte, puis « Retour », « Jouer », puis les vignettes
const AE_JOUER = AGENT_COUNT + 1;
const AE_SKIN = AGENT_COUNT + 2; // AE_SKIN + k : vignette du skin k de la fiche
const AE = { vue: 'grille', origine: 'titre', focus: 0, vise: 0, verrouFiche: false }; // vise : la carte visée (agent de « Jouer » en grille)
let aeData = null; // dernière vue de main.js (agentView)
let aeFond = null; // couche 0 de la parallaxe : le fond peint
let aeRangee = null; // couche 1 : la rangée des cartes
const aeImgs = []; // couche 2 : les images des cartes
const aeCartes = []; // { card, img, cadenas, role, nom, cond, prog, skins, arme, verrou }
const aePrechargees = []; // images décodées au démarrage (gardées : le navigateur garde leur décodage)
// pointeur à l'ouverture : [x, y] (input.curseurT), [2] = 1 dès qu'il a vraiment bougé (ou s'il n'a jamais bougé sur la page)
const AE_POS = new Float64Array([-1, -1, 0]);
// survol d'une carte : candidate (agent, -1 = aucune), horodatage du dernier mouvement dessus, minuterie en attente (0 = aucune)
const AE_SURVOL = { carte: -1, t: 0, minuterie: 0 };
let aeTete = null;
let aeGrille = null;
let aeFiche = null; // vue fiche (src/ui-agents-fiche.js)
let aeRetour = null;
let aeJouer = null;
let aeJouerLabel = null;

function aeVerrou(a) {
  return !!ctx.meta && ctx.meta.agentVerrouille(a);
}

/** Agent de « Jouer » : la carte visée (grille) ou l'agent de la fiche. */
function aeAgentJouer() {
  return AE.vue === 'fiche' && aeData ? aeData.agent : AE.vise;
}

function buildAgents() {
  const T = AGENT_SCREEN.textes;
  const scr = el('div', 'sr-screen sr-agents-ecran');
  aeFond = el('div', 'sr-ae-fond');
  aeFond.style.backgroundImage = "url('" + VITRINE.fonds.grille + "')";
  scr.appendChild(aeFond);
  aeTete = el('div', 'sr-ae-tete');
  aeTete.append(el('h2', null, AGENT_SCREEN.title), el('p', 'sr-lead', AGENT_SCREEN.lead));
  scr.appendChild(aeTete);
  aeGrille = el('div', 'sr-ae-grille');
  aeRangee = el('div', 'sr-ae-cartes');
  for (let a = 0; a < AGENT_COUNT; a++) {
    const card = pressable(el('button', 'sr-ae-carte'), () => actions.agentFiche(a));
    card.dataset.agent = String(a);
    const boite = el('div', 'sr-ae-carte-img');
    const img = el('img');
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    const cadenas = el('span', 'sr-ae-cadenas');
    cadenas.appendChild(icon('sr-i-lock'));
    boite.append(img, cadenas);
    const bas = el('div', 'sr-ae-carte-bas');
    const role = el('div', 'sr-ae-role', '');
    const nom = el('div', 'sr-ae-nom', AGENTS[a].name);
    const cond = el('div', 'sr-ae-cond', '');
    const prog = el('div', 'sr-ae-prog', '');
    const skins = el('div', 'sr-ae-skins', '');
    const arme = el('div', 'sr-ae-arme');
    arme.appendChild(icon('sr-w' + agentSignature(a)));
    bas.append(role, nom, cond, prog, skins, arme);
    card.append(boite, bas);
    aeRangee.appendChild(card);
    aeImgs.push(img);
    aeCartes.push({ card, img, cadenas, role, nom, cond, prog, skins, arme, verrou: false });
  }
  aeGrille.appendChild(aeRangee);
  scr.appendChild(aeGrille);
  aeFiche = ficheUI.build({ el, icon, pressable, setText, hex, formatValue, meta: ctx.meta, hub, onVignette: aeVignette });
  scr.appendChild(aeFiche);
  const pied = el('div', 'sr-ae-pied');
  aeRetour = button(T.retour, 'sr-btn sr-ae-retour', () => actions.agentRetour());
  aeJouer = button(T.jouer, 'sr-btn sr-ae-jouer', () => actions.agentJouer(aeAgentJouer()));
  aeJouerLabel = aeJouer.querySelector('.sr-btn-label');
  pied.append(aeRetour, aeJouer);
  ficheUI.construirePied(pied);
  scr.appendChild(pied);
  scr.addEventListener('pointermove', aeSouris);
  plxBind(scr);
  addScreen(SCREEN.AGENT, scr);
  // images décodées dès le démarrage (fonds, cartes, vignettes de la fiche) : l'écran et la fiche s'ouvrent sans image longue
  for (const src of aeSources()) {
    const im = new Image();
    im.decoding = 'async';
    im.src = src;
    if (typeof im.decode === 'function') im.decode().catch(() => {});
    aePrechargees.push(im);
  }
}

/** Fonds (grille, fiche), cartes et vignettes de tous les agents (skins, silhouettes). */
function aeSources() {
  const out = [VITRINE.fonds.grille, VITRINE.fonds.agents];
  for (let a = 0; a < AGENT_COUNT; a++) {
    const k = AGENTS[a].key;
    for (const sk of skinsDe(k)) out.push(VITRINE.cartes(k, sk), VITRINE.vignettes(k, sk));
    out.push(VITRINE.cartes(k, 'base', { verrou: true }), VITRINE.vignettes(k, 'base', { verrou: true }));
  }
  return out;
}

/** Vue de main.js (agentView) : { vue, origine, agent, skinVise, best }. Hors combat. */
function fillAgents(data, fresh) {
  const vueChange = AE.vue !== data.vue;
  aeData = data;
  AE.vue = data.vue === 'fiche' ? 'fiche' : 'grille';
  AE.origine = data.origine;
  const fiche1 = AE.vue === 'fiche';
  if (fiche1) AE.verrouFiche = ficheUI.fill(data);
  if (fresh || vueChange) {
    AE.vise = data.agent >= 0 && data.agent < AGENT_COUNT ? data.agent : 0;
    // fiche : la vignette du skin visé ; grille ouverte du titre : « Jouer · <dernier agent> » (Entrée, Entrée relance) ;
    // sinon (Noyau, retour de la fiche) : la carte visée
    AE.focus = fiche1 ? AE_SKIN + ficheUI.indiceVise() : fresh && data.origine === 'titre' ? AE_JOUER : AE.vise;
    // le survol attend un vrai déplacement du pointeur depuis sa position à l'ouverture (aeSouris)
    // (curseur jamais bougé sur la page : pas d'événement de survol sans déplacement à craindre, le 1er compte)
    const connu = ctx.input && ctx.input.curseurT ? ctx.input.curseurT(AE_POS) : 0;
    AE_POS[2] = connu ? 0 : 1;
    AE_SURVOL.carte = -1;
  }
  const T = AGENT_SCREEN.textes;
  const best = data.best ? data.best.wave : 0;
  for (let a = 0; a < AGENT_COUNT; a++) {
    const c = aeCartes[a];
    const A = AGENTS[a];
    const v = aeVerrou(a);
    c.verrou = v;
    const src = VITRINE.cartes(A.key, ctx.meta ? ctx.meta.skinChoisi(A.key) : 'base', { verrou: v });
    if (c.img.getAttribute('src') !== src) c.img.src = src;
    c.card.classList.toggle('sr-verrou', v);
    c.card.setAttribute('aria-disabled', v ? 'true' : 'false');
    setText(c.role, v ? T.verrou : A.role);
    c.nom.style.display = v ? 'none' : '';
    c.arme.style.display = v ? 'none' : '';
    c.cadenas.style.display = v ? '' : 'none';
    const cond = v ? hub.agentCondition(a, best, true) : null;
    setText(c.cond, cond ? cond.texte : '');
    setText(c.prog, cond ? cond.prog : '');
    c.cond.style.display = v ? '' : 'none';
    c.prog.style.display = v ? '' : 'none';
    const n = skinsDe(A.key).length;
    setText(c.skins, !v && n >= 2 ? n + ' ' + T.skins : '');
  }
  aeTete.style.display = fiche1 ? 'none' : '';
  aeGrille.style.display = fiche1 ? 'none' : '';
  ficheUI.montrer(fiche1);
  // agent verrouillé (fiche) : sa condition remplace « Jouer » — le focus n'y reste pas
  aeJouer.style.display = fiche1 && AE.verrouFiche ? 'none' : '';
  if (fiche1 && AE.verrouFiche && AE.focus === AE_JOUER) AE.focus = AE_RETOUR;
  aePeindre();
  if (fresh || vueChange) plxReset(aeFond, aeRangee, aeImgs, AGENT_SCREEN.parallax);
}

/** Focus (une seule chose en jaune), carte visée, « Jouer · <agent> » (refusé tant que l'agent est verrouillé). */
function aePeindre() {
  const grille = AE.vue === 'grille';
  for (let a = 0; a < AGENT_COUNT; a++) {
    const card = aeCartes[a].card;
    card.classList.toggle('sr-focus', grille && AE.focus === a);
    card.classList.toggle('sr-vise', grille && AE.focus >= AGENT_COUNT && AE.vise === a);
  }
  ficheUI.peindreFocus(!grille && AE.focus >= AE_SKIN ? AE.focus - AE_SKIN : -1);
  aeRetour.classList.toggle('sr-focus', AE.focus === AE_RETOUR);
  aeJouer.classList.toggle('sr-focus', AE.focus === AE_JOUER);
  const j = aeAgentJouer();
  setText(aeJouerLabel, AGENT_SCREEN.textes.jouer + ' · ' + AGENTS[j].name);
  const v = aeVerrou(j);
  aeJouer.classList.toggle('sr-refuse', v);
  aeJouer.setAttribute('aria-disabled', v ? 'true' : 'false');
}

/**
 * Survol (pointermove sur l'écran) : la carte survolée devient la carte visée, une vignette de skin, « Retour » ou « Jouer »
 * survolés prennent le focus. Seulement après un VRAI déplacement du pointeur depuis l'ouverture : le curseur resté
 * immobile sur une carte (celui du clic sur « Jouer » du titre) ne vole pas le focus du dernier agent joué (le navigateur
 * envoie des événements de survol quand l'écran apparaît sous lui). Hors combat.
 */
function aeSouris(e) {
  if (screen !== SCREEN.AGENT) return;
  if (AE_POS[2] === 0) {
    if (Math.abs(e.clientX - AE_POS[0]) + Math.abs(e.clientY - AE_POS[1]) < 3) return;
    AE_POS[2] = 1;
  }
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return;
  const c = t.closest('.sr-ae-carte');
  if (c) {
    // une carte traversée par un pointeur en mouvement ne change rien : elle n'est visée qu'après un arrêt (aeSurvolFin)
    AE_SURVOL.carte = Number(c.dataset.agent);
    AE_SURVOL.t = performance.now();
    if (!AE_SURVOL.minuterie) AE_SURVOL.minuterie = setTimeout(aeSurvolFin, AGENT_SCREEN.survolMs);
    return;
  }
  AE_SURVOL.carte = -1;
  if (t.closest('.sr-ae-retour')) aeFocus(AE_RETOUR);
  else if (t.closest('.sr-ae-jouer')) aeFocus(AE_JOUER);
  else {
    const v = t.closest('.sr-ae-vignette');
    if (v && AE.vue === 'fiche') aeFocus(AE_SKIN + Number(v.dataset.k));
  }
}

/** Fin de la minuterie de survol : vise la carte candidate si le pointeur y est resté immobile assez longtemps, sinon attend le reste. */
function aeSurvolFin() {
  AE_SURVOL.minuterie = 0;
  if (AE_SURVOL.carte < 0 || screen !== SCREEN.AGENT) return;
  const reste = AGENT_SCREEN.survolMs - (performance.now() - AE_SURVOL.t);
  if (reste > 1) AE_SURVOL.minuterie = setTimeout(aeSurvolFin, reste);
  else aeViser(AE_SURVOL.carte);
}

/** Survol d'une carte : elle devient la carte visée (grille seulement). */
function aeViser(a) {
  if (screen !== SCREEN.AGENT || AE.vue !== 'grille' || (AE.focus === a && AE.vise === a)) return;
  AE.focus = a;
  AE.vise = a;
  aePeindre();
}

/** Survol de « Retour », « Jouer » ou d'une vignette. */
function aeFocus(f) {
  if (screen !== SCREEN.AGENT || AE.focus === f) return;
  AE.focus = f;
  aePeindre();
}

/** Clic sur la vignette k de la fiche : elle prend le focus, son skin est choisi (débloqué) ou seulement visé. */
function aeVignette(k) {
  if (screen !== SCREEN.AGENT || AE.vue !== 'fiche' || !aeData) return false;
  AE.focus = AE_SKIN + k;
  aePeindre();
  return actions.agentSkin(aeData.agent, ficheUI.cle(k));
}

/**
 * Flèches (main.js, STATE.AGENT) : dx −1 / 1, dy −1 (haut) / 1 (bas). Grille : ← / → d'une carte à l'autre, ↓ vers
 * « Jouer », ↑ du pied vers la carte visée. Fiche : ← / → d'une vignette à l'autre, ↓ vers « Jouer » (« Retour » si
 * l'agent est verrouillé), ↑ du pied vers la vignette du skin visé. Au pied, ← / → entre « Retour » et « Jouer ».
 * Rend le focus.
 */
export function agentsBouger(dx, dy) {
  AE_SURVOL.carte = -1; // le clavier reprend la main : un arrêt de souris en attente ne déplace plus la visée
  if (screen !== SCREEN.AGENT) return -1;
  const f = AE.focus;
  const fiche1 = AE.vue === 'fiche';
  const jouerOk = !(fiche1 && AE.verrouFiche);
  let n = f;
  if (f < AGENT_COUNT) {
    if (dx !== 0) n = Math.max(0, Math.min(AGENT_COUNT - 1, f + dx));
    else if (dy > 0) n = AE_JOUER;
  } else if (f >= AE_SKIN) {
    if (dx !== 0) n = AE_SKIN + Math.max(0, Math.min(ficheUI.nbSkins() - 1, f - AE_SKIN + dx));
    else if (dy > 0) n = jouerOk ? AE_JOUER : AE_RETOUR;
  } else if (dx < 0 && f === AE_JOUER) n = AE_RETOUR;
  else if (dx > 0 && f === AE_RETOUR && jouerOk) n = AE_JOUER;
  else if (dy < 0) n = fiche1 ? AE_SKIN + ficheUI.indiceVise() : AE.vise;
  if (n !== f) {
    AE.focus = n;
    if (n < AGENT_COUNT) AE.vise = n;
    audio.play(SFX.UI_CLICK);
    aePeindre();
  }
  return AE.focus;
}

/** Entrée : carte → sa fiche ; vignette → son skin ; « Retour » ; « Jouer » avec l'agent visé. Rend la valeur de l'action. */
export function agentsConfirmer() {
  AE_SURVOL.carte = -1;
  if (screen !== SCREEN.AGENT) return false;
  if (AE.focus < AGENT_COUNT) return actions.agentFiche(AE.focus);
  if (AE.focus >= AE_SKIN) return aeData ? actions.agentSkin(aeData.agent, ficheUI.cle(AE.focus - AE_SKIN)) : false;
  if (AE.focus === AE_RETOUR) return actions.agentRetour();
  return actions.agentJouer(aeAgentJouer());
}

/** La toile plein écran de la vitrine de la fiche (main.js → pauseAgent.openVitrine). */
export function agentsToile() {
  return ficheUI.getToile();
}

/** src/pause-agent.js : la vitrine attend le modèle de l'agent (vrai : « Chargement ») ou le montre (faux). */
export function setVitrineAttente(on) {
  ficheUI.setAttente(on);
}

/** Tests : { vue, origine, agent, skinVise, focus ('carte' | 'skin' | 'retour' | 'jouer'), cards, jouer, fiche }. */
function agentsInspect() {
  return {
    vue: AE.vue,
    origine: AE.origine,
    agent: aeAgentJouer(),
    skinVise: aeData ? aeData.skinVise : null,
    focus: AE.focus < AGENT_COUNT ? 'carte' : AE.focus >= AE_SKIN ? 'skin' : AE.focus === AE_RETOUR ? 'retour' : 'jouer',
    cards: aeCartes.length,
    jouer: aeJouerLabel ? aeJouerLabel.textContent : '',
    fiche: AE.vue === 'fiche' ? ficheUI.inspect() : null,
  };
}

// ----- Parallaxe commune (§ E2.D, rendue commune au § E4.B.2) : écran des agents et hub -------------------------------
// Un seul écran à la fois suit le pointeur. Trois couches : 0 et 1 glissent dans l'écran ; la couche 2 est DANS la
// couche 1 (portraits dans les cartes, contenu de l'onglet dans le panneau) : son décalage propre est relatif.

let plxL0 = null;
let plxL1 = null;
let plxL2 = []; // nœuds de la couche 2
let plxCfg = AGENT_SCREEN.parallax;

function plxPointer(e) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!(w > 0 && h > 0)) return;
  PLX[0] = Math.max(-1, Math.min(1, (e.clientX / w) * 2 - 1));
  PLX[1] = Math.max(-1, Math.min(1, (e.clientY / h) * 2 - 1));
}

/** Branche le suivi du pointeur sur le nœud d'un écran (à la construction). */
function plxBind(scr) {
  scr.addEventListener('pointermove', plxPointer);
}

/** Couche 2 seule remplacée (onglet du hub changé) : l'ancienne est remise en place, la nouvelle réécrite à l'image suivante. */
function plxSwap2(nodes) {
  for (let k = 0; k < plxL2.length; k++) plxL2[k].style.transform = '';
  plxL2 = nodes;
  PLX[8] = 1e9;
  PLX[9] = 1e9;
}

/** Parallaxe à zéro sur les couches d'un écran : pointeur au centre, couches remises en place. */
function plxReset(l0, l1, l2, cfg) {
  if (plxL0) plxL0.style.transform = '';
  if (plxL1) plxL1.style.transform = '';
  for (let k = 0; k < plxL2.length; k++) plxL2[k].style.transform = '';
  plxL0 = l0;
  plxL1 = l1;
  plxL2 = l2;
  plxCfg = cfg;
  PLX.fill(0);
  l0.style.transform = '';
  l1.style.transform = '';
  for (let k = 0; k < l2.length; k++) l2[k].style.transform = '';
  // Échelle de l'interface, recalculée comme la taille de police posée à l'init (UI.scale) — sans lire la mise en page
  const sc = UI.scale;
  const rem = Math.min((window.innerHeight * sc.remPx) / sc.designHeightPx, (window.innerWidth * sc.remPx) / sc.designWidthPx);
  plxScale = (rem < sc.minRemPx ? sc.minRemPx : rem > sc.maxRemPx ? sc.maxRemPx : rem) / sc.remPx;
}

/** prefers-reduced-motion : lu une fois à l'init, suivi ensuite (aucune parallaxe tant qu'il vaut « reduce »). */
function plxInit() {
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (!mq) return;
  plxOff = mq.matches;
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', (e) => {
    plxOff = e.matches;
    if (plxL0) plxReset(plxL0, plxL1, plxL2, plxCfg);
  });
}

/**
 * Parallaxe de l'écran ouvert (agents ou hub) : les trois couches glissent à l'opposé du pointeur, de layersPx pixels
 * au plus, lissées à rate 1/s. Une couche n'est réécrite (transform: translate3d) que si son décalage change de plus de
 * deadPx. Hors combat : les chaînes construites ici sont tolérées (§ E2.0.5). Coupée si le système demande moins de
 * mouvement.
 */
function plxUpdate(realDt) {
  if (plxOff || plxL0 === null) return;
  const Pm = plxCfg;
  const k = realDt > 0 ? 1 - Math.exp(-Pm.rate * realDt) : 0;
  PLX[2] += (PLX[0] - PLX[2]) * k;
  PLX[3] += (PLX[1] - PLX[3]) * k;
  const dead = Pm.deadPx;
  for (let l = 0; l < 3; l++) {
    const x = -PLX[2] * Pm.layersPx[l] * plxScale;
    const y = -PLX[3] * Pm.layersPx[l] * plxScale;
    const dx = x - PLX[4 + l * 2];
    const dy = y - PLX[5 + l * 2];
    if (dx > dead || dx < -dead || dy > dead || dy < -dead) {
      PLX[4 + l * 2] = x;
      PLX[5 + l * 2] = y;
      if (l === 0) plxL0.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      else if (l === 1) plxL1.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      else {
        // la couche 2 est DANS la couche 1 : son décalage propre = le sien moins celui de la couche 1
        const t = 'translate3d(' + (x - PLX[6]).toFixed(1) + 'px,' + (y - PLX[7]).toFixed(1) + 'px,0)';
        for (let i = 0; i < plxL2.length; i++) plxL2[i].style.transform = t;
      }
    }
  }
}

// ----- § E4.B : le hub (src/ui-hub.js) ----------------------------------------------------------------------------------

function buildHub() {
  const scr = hub.build({
    el, icon, pressable, hex, button, audio, actions, SFX,
    meta: ctx.meta, defis: ctx.defis,
    onTab: (node) => {
      if (screen === SCREEN.HUB) plxSwap2([node]);
    },
    silhouette: appliquerSil, // § E4.L.2 : vignette d'agent verrouillé en silhouette pleine
    // § E5.W : la recette en formule à icônes (src/ui-recette.js) — ui-hub.js n'importe que config.js
    creerFormule,
    recetteEvolution,
    recetteFusion,
  });
  scr.addEventListener('pointerdown', fermerDetailDehors); // § E4.L.1 : la fenêtre d'élément de la fiche au Noyau
  plxBind(scr);
  // § E4.D : touches des onglets (1 à 4) réglables, comme les autres aides
  const ong = scr.querySelectorAll('.sr-hub-onglet > .sr-key');
  for (let t = 0; t < ong.length && t < 4; t++) indice(ong[t], 'choix' + (t + 1));
  addScreen(SCREEN.HUB, scr);
}

function fillHub(data, fresh) {
  hub.fill(data, fresh);
  if (fresh) {
    const L = hub.layers();
    plxReset(L[0], L[1], [L[2]], HUB.parallax);
  }
}

/** § E4.B : navigation du hub, appelée par main.js (STATE.HUB). */
export function hubTab(t) {
  return hub.tab(t, true);
}
export function hubMove(dx, dy) {
  return hub.move(dx, dy);
}
export function hubConfirm() {
  return hub.confirm();
}
/** § E4.L.1 : Échap au Noyau — ferme la fenêtre d'un élément de la fiche si elle est ouverte (vrai), sinon rien. */
export function hubBack() {
  return screen === SCREEN.HUB && closeDetail();
}
/** Onglet ouvert du Noyau (l'écran Agents ouvert depuis le Noyau y ramène au retour). */
export function hubOnglet() {
  return hub.onglet();
}
/** Tests : onglet, zone, case visée, cases de la Collection, et décalage courant des trois couches de parallaxe. */
export function hubInspect() {
  const o = hub.inspect({});
  o.parallax = [PLX[4], PLX[5], PLX[6], PLX[7], PLX[8], PLX[9]];
  o.plxOff = plxOff;
  return o;
}

// ----- Remplissage des écrans (à l'ouverture et au rafraîchissement, jamais par image) -------------------------------

function fillTitle(data) {
  setSliders(data);
  majIndices(); // § E4.D : la disposition a pu être détectée depuis (libellés AZERTY / QWERTY)
  const loading = !!(data && data.loading);
  const error = data && data.error ? data.error : '';
  setText(titlePlayLabel, loading ? 'Chargement…' : 'Jouer');
  setClass(titlePlay, loading || error ? 'sr-btn sr-primary sr-attente' : 'sr-btn sr-primary');
  setText(
    titleStatus,
    error ? 'Les modèles n\u2019ont pas pu être chargés (' + error + '). Rechargez la page.' : loading && data.queued ? 'La partie démarre dès que les modèles sont chargés.' : loading ? 'Chargement des modèles…' : '',
  );
  titleStatus.style.display = error || loading ? '' : 'none';
  const b = data ? data.best : null;
  titleBestCells.style.display = b ? '' : 'none';
  titleBestEmpty.style.display = b ? 'none' : '';
  setText(titleRecord, b ? 'Vague ' + intStr(b.wave) : '');
  infosBox.classList.toggle('sr-sans-record', !b); // menus « Pile » : pas de bloc vide (« Meilleur score — »)
  // Femz, 22/11 : le panneau d'infos ne s'ouvre plus sur l'accueil (record retiré et réglages dans la fenêtre Paramètres,
  // 21/11) ; un état « ouvert » gardé d'une version d'avant, ou le 1er lancement, laissait une plaque vide.
  if (infosOpen) setInfosOpen(false, false);
  if (b) {
    setText(titleBestNums[0], intStr(b.wave));
    setText(titleBestNums[1], intStr(b.kills));
    setText(titleBestNums[2], intStr(b.level));
    setText(titleBestNums[3], formatTime(b.time));
  }
}

function fillLevelUp(data, fresh) {
  setText(levelTitle, 'Niveau ' + data.level);
  setText(levelPending, data.pending > 1 ? 'Encore ' + data.pending + ' choix ensuite.' : data.pending === 1 ? 'Encore un choix ensuite.' : '');
  for (let i = 0; i < bonusCards.length; i++) {
    const c = bonusCards[i];
    const d = data.choices[i];
    c.card.style.display = d ? '' : 'none';
    if (!d) continue;
    // § E2.F : une carte d'objet se distingue d'un bonus — cadre et étiquette à la couleur de sa rareté, icône de
    // l'objet, piles possédées → piles après le choix (pas de crans : un objet s'empile sans limite)
    const isItem = d.kind === 'item';
    setClass(c.card, isItem ? 'sr-card sr-facet sr-card-item' : 'sr-card sr-facet');
    setText(c.tag, isItem ? CHOICES.itemText.tag : ''); // § E5.L : la rareté a sa propre ligne (barre de rang)
    c.tag.style.display = isItem ? '' : 'none';
    c.rar.style.display = isItem ? '' : 'none';
    if (isItem) {
      setText(c.rarName, rareteTexte(d.rarity));
      for (let q = 0; q < c.rarPips.length; q++) setClass(c.rarPips[q], q <= d.rarity ? 'sr-pip sr-on' : 'sr-pip');
    }
    // § E3.F : « ? fusionne avec un module possédé » (recette découverte : le nom de l'objet né)
    const mate = isItem && d.fuseMate === true;
    c.fuse.style.display = mate ? '' : 'none';
    if (mate) setText(c.fuse.lastChild, d.fuseHint ? d.fuseHint : FUSION_SCREEN.hint);
    if (isItem) {
      c.card.style.setProperty('--rc', d.color);
      c.use.setAttribute('href', '#' + d.icon);
      setText(c.name, d.name);
      colorer(c.desc, d.desc); // § E5.E.3 : chiffres et mots clés colorés (M3)
      c.stacks.style.display = '';
      for (let k = 0; k < c.pips.length; k++) c.pips[k].style.display = 'none';
      // § E5.L (C3) : « Possédé ×3 → ×4 », « Nouveau : ×2 » (exemplaires ; « niveau » reste à l'agent et aux armes)
      setText(c.count, d.stacks > 0 ? CHOICES.itemText.possede + '\u00d7' + d.stacks + ' \u2192 \u00d7' + (d.stacks + d.gain) : CHOICES.itemText.nouveau + '\u00d7' + d.gain);
      continue;
    }
    c.use.setAttribute('href', BONUS_ICONS[d.key] === 1 ? '#sr-b-' + d.key : '#sr-b-default');
    setText(c.name, d.name);
    colorer(c.desc, d.desc); // § E5.E.3 : chiffres et mots clés colorés (M3)
    // Crans : ceux déjà pris, puis celui que ce choix allume.
    const max = d.maxStacks > 0 ? d.maxStacks : 0;
    c.stacks.style.display = max > 0 ? '' : 'none';
    for (let k = 0; k < c.pips.length; k++) {
      c.pips[k].style.display = k < max ? '' : 'none';
      setClass(c.pips[k], k < d.stacks ? 'sr-pip sr-on' : k === d.stacks ? 'sr-pip sr-next' : 'sr-pip');
    }
    setText(c.count, d.stacks + ' / ' + max);
  }
  // § E2.D : compteurs de relance, de passe et de bannissement (vue de progression)
  levelCounts[0] = data.rerolls | 0;
  levelCounts[1] = data.skips | 0;
  levelCounts[2] = data.banishes | 0;
  levelBar.passe(fragmentsPasse(run.wave)); // § E5.L (C7) : « Passer : +60 fragments »
  levelBar.fill(levelCounts[0], levelCounts[1], levelCounts[2], banishArmed);
  // Choix suivant d'une série : les cartes rejouent leur entrée, pour qu'on voie que le tirage a changé.
  if (!fresh) {
    flipSwap = !flipSwap;
    cardsBox.style.animation = (flipSwap ? 'sr-swap-a ' : 'sr-swap-b ') + 'var(--sr-screen-s) ease-out backwards';
  } else {
    cardsBox.style.animation = '';
  }
}

const WCARD_CLASS = ['sr-wcard sr-facet sr-locked', 'sr-wcard sr-facet sr-buyable', 'sr-wcard sr-facet sr-owned'];

// ----- § E4.S.8 : marchand v2 — lignes visibles, focus clavier / entrée du jeu (main.js : flèches → shopMove, Entrée →
// shopConfirm). Le focus est { carte, ligne } dans l'ordre d'affichage ; carte = −1 : pas de focus (Entrée = « J'ai
// fini », comme avant) ; carte = SHOP_FINI : le bouton « J'ai fini ». Hors combat : le marchand n'est ouvert qu'entre
// deux vagues, rien n'est compté au budget d'allocation du combat.
const SHOP_LIGNES = 3;
const SHOP_COLS = 3;
const SHOP_FINI = 99;
const shopFocus = { carte: -1, ligne: 0 };
let shopBalanceBox = null;
let shopFiniBtn = null;

/** Cartes affichées (armes possédées), dans l'ordre d'affichage. */
function shopVisibles() {
  const out = [];
  for (let w = 0; w < shopCards.length; w++) if (shopCards[w].state === 2) out.push(shopCards[w]);
  out.sort((a, b) => a.order - b.order);
  return out;
}

/** Boutons d'achat visibles d'une carte, dans l'ordre (les lignes de lignesBox affichées). */
function shopLignes(u) {
  const out = [];
  for (const n of u.lignesBox.children) if (n.style.display !== 'none') out.push(n);
  return out;
}

/** « A3 » : indice (dans shopVisibles) de l'arme montrée dans la grande carte — le focus clavier, sinon le choix souris. */
function shopIndiceMontre(n) {
  if (n === 0) return -1;
  if (shopFocus.carte >= 0 && shopFocus.carte !== SHOP_FINI) return Math.min(shopFocus.carte, n - 1);
  return Math.max(0, Math.min(shopSel, n - 1));
}

/** « A3 » : la carte montrée, sa case d'arsenal en surbrillance, et la description de la ligne visée. */
function shopMontrer(cs) {
  const k = shopIndiceMontre(cs.length);
  for (const u of shopCards) {
    const on = k >= 0 && cs[k] === u;
    u.card.classList.toggle('sr-wcard-sel', on);
    u.tile.classList.toggle('sr-sel', on);
  }
  if (k < 0) return;
  const u = cs[k];
  const w = shopCards.indexOf(u);
  // ligne visée : survol souris de cette carte, sinon focus clavier, sinon la première ligne
  let row = null;
  if (shopLigneVue.w === w) row = shopLigneVue.s === 7 ? u.oc.row : u.rows[shopLigneVue.s] ? u.rows[shopLigneVue.s].row : null;
  if (!row && shopFocus.carte === k) row = shopLignes(u)[shopFocus.ligne] || null;
  if (!row) row = shopLignes(u)[0] || null;
  shopChoixTexte(u, w, row);
}

function shopChoixTexte(u, w, row) {
  if (!row) {
    setText(u.choixTitre, '');
    setText(u.choixEffet, '');
    setText(u.choixPhrase, '');
    return;
  }
  const oc = row === u.oc.row;
  let r = null;
  if (!oc) for (const x of u.rows) if (x.row === row) r = x;
  const lab = oc ? SHOP.overcharge.label : r ? r.label.textContent : '';
  const max = !oc && row.classList.contains('sr-max');
  const gain = oc ? u.oc.gain.textContent : r ? r.gain.textContent : '';
  const modele = MARCHAND_PHRASES[oc ? 'surcharge' : max ? 'max' : lab] || '';
  setText(u.choixTitre, lab);
  //#region e5:O-noms-guide
  // § E5.O : le survoltage chiffre des DÉGÂTS (« +8 % de dégâts »), pas « +8 % survoltage »
  setText(u.choixEffet, max ? 'max' : gain ? gain + ' ' + (oc ? SHOP.overcharge.effet : lab.toLowerCase()) : '');
  //#endregion e5:O-noms-guide
  setText(u.choixPhrase, modele.replace('{a}', WEAPONS[w].name));
}

/** « A3 » : survol ou clic d'une case de l'arsenal — l'arme passe dans la grande carte. */
function shopChoisir(w) {
  const cs = shopVisibles();
  const k = cs.indexOf(shopCards[w]);
  if (k < 0) return;
  if (shopSel === k && (shopFocus.carte < 0 || shopFocus.carte === k)) return;
  shopSel = k;
  if (shopFocus.carte >= 0 && shopFocus.carte !== SHOP_FINI) {
    shopFocus.carte = k;
    shopFocus.ligne = 0;
  }
  shopPeindre();
}

/** « A3 » : ligne survolée (w = −1 : plus aucune) — la description sous l'arme suit. */
function shopVoirLigne(w, s) {
  if (shopLigneVue.w === w && shopLigneVue.s === s) return;
  shopLigneVue.w = w;
  shopLigneVue.s = s;
  shopMontrer(shopVisibles());
}

function shopPeindre() {
  const cs = shopVisibles();
  for (const u of shopCards) {
    u.card.classList.remove('sr-wcard-focus');
    for (const n of u.lignesBox.children) n.classList.remove('sr-focus');
  }
  if (shopFiniBtn) shopFiniBtn.classList.toggle('sr-focus', shopFocus.carte === SHOP_FINI);
  shopMontrer(cs);
  if (shopFocus.carte < 0 || shopFocus.carte === SHOP_FINI || cs.length === 0) return;
  shopFocus.carte = Math.min(shopFocus.carte, cs.length - 1);
  const u = cs[shopFocus.carte];
  const ls = shopLignes(u);
  u.card.classList.add('sr-wcard-focus');
  if (ls.length === 0) return;
  shopFocus.ligne = Math.max(0, Math.min(shopFocus.ligne, ls.length - 1));
  ls[shopFocus.ligne].classList.add('sr-focus');
}

function shopSurvol(w) {
  // le survol à la souris prend le focus de la carte (le clavier repart de là)
  const cs = shopVisibles();
  const k = cs.indexOf(shopCards[w]);
  if (k < 0 || shopFocus.carte === k) return;
  if (shopFocus.carte < 0) return; // pas de focus clavier en cours : la souris seule n'en crée pas
  shopFocus.carte = k;
  shopFocus.ligne = 0;
  shopPeindre();
}

/** § E4.S.8 : flèches (entrée du jeu, ACTION de input.js) : dx ±1 = carte voisine, dy ±1 = ligne voisine (+1 = bas). */
export function shopMove(dx, dy) {
  const cs = shopVisibles();
  if (cs.length === 0) return;
  if (shopFocus.carte < 0) {
    shopFocus.carte = Math.max(0, Math.min(shopSel, cs.length - 1)); // « A3 » : le clavier part de la carte montrée
    shopFocus.ligne = 0;
  } else if (shopFocus.carte === SHOP_FINI) {
    if (dy < 0 || dx < 0) {
      shopFocus.carte = Math.max(0, Math.min(shopSel, cs.length - 1)); // retour sur la carte montrée
      shopFocus.ligne = 99;
    }
  } else if (dx !== 0) {
    const c = shopFocus.carte + dx;
    if (c >= 0 && c < cs.length) shopFocus.carte = c;
  } else if (dy > 0) {
    // « A3 » : une seule carte à l'écran — sous sa dernière ligne, « J'ai fini »
    const n = shopLignes(cs[shopFocus.carte]).length;
    if (shopFocus.ligne < n - 1) shopFocus.ligne++;
    else shopFocus.carte = SHOP_FINI;
  } else if (dy < 0) {
    if (shopFocus.ligne > 0) shopFocus.ligne--;
  }
  if (shopFocus.carte >= 0 && shopFocus.carte !== SHOP_FINI) shopSel = shopFocus.carte;
  if (audio) audio.play(SFX.UI_CLICK);
  shopPeindre();
}

/** § E4.S.8 : Entrée. Renvoie true si le focus a consommé la touche (achat ou « J'ai fini » au focus). */
export function shopConfirm() {
  if (shopFocus.carte < 0) return false;
  if (shopFocus.carte === SHOP_FINI) return false; // main.js finit les achats
  const cs = shopVisibles();
  const u = cs[Math.min(shopFocus.carte, cs.length - 1)];
  if (!u) return false;
  const ls = shopLignes(u);
  if (ls.length) ls[Math.min(shopFocus.ligne, ls.length - 1)].click();
  return true;
}

/** Échap dans le marchand : retire d'abord le focus clavier (renvoie true), sinon main.js ouvre la pause. */
export function shopBack() {
  if (shopFocus.carte < 0) return false;
  shopFocus.carte = -1;
  shopPeindre();
  return true;
}

/** Tests : focus courant { carte, ligne, offre } (offre = data-offre de la ligne au focus, ou −1). */
export function shopInspect() {
  const f = document.querySelector('.sr-wlignes .sr-focus');
  return { carte: shopFocus.carte, ligne: shopFocus.ligne, offre: f ? Number(f.dataset.offre) : -1, fini: shopFocus.carte === SHOP_FINI };
}

/**
 * § E4.S.8 : range les 5 rangées d'une carte — jusqu'à SHOP_LIGNES améliorations NON au maximum dans la carte (celles
 * qu'on peut payer d'abord, puis les autres ; ordre des stats gardé), le reste dans le détail. Un masque de 5 bits
 * évite de redéplacer les nœuds quand rien ne change.
 */
function shopRanger(u, v) {
  let vues = 0;
  let n = 0;
  for (let pass = 0; pass < 2 && n < SHOP_LIGNES; pass++) {
    for (let s = 0; s < STAT_COUNT && n < SHOP_LIGNES; s++) {
      const st = v.stats[s];
      if (st.maxed || vues & (1 << s)) continue;
      if (pass === 0 && !st.affordable) continue;
      vues |= 1 << s;
      n++;
    }
  }
  vues = (1 << STAT_COUNT) - 1; // « A3 » : la grande carte montre TOUTES les améliorations, dans l'ordre (max compris)
  if (u.oc.shown) vues = 0; // niveau 21 : la surcharge seule dans la carte
  if (u.vues === vues) return;
  u.vues = vues;
  for (let s = 0; s < STAT_COUNT; s++) {
    const r = u.rows[s].row;
    r.dataset.offre = String(u.rows[s].offre);
    if (vues & (1 << s)) u.lignesBox.insertBefore(r, u.oc.row);
    else u.statBox.appendChild(r);
  }
}

/** § E5.X6 (F11) : « il manque N » (N = prix − fragments entiers, au moins 1) — marchand ouvert, pas une image de jeu. */
function x6Manque(cost, fragments) {
  const n = Math.max(1, Math.ceil(cost - Math.floor(fragments)));
  return X6C.marchand.manque + intStr(n);
}

/** § E5.X6 (F11) : achat d'une ligne ; refusé (BUY ≠ OK) → le prix tremble en rouge (deux noms : l'animation repart). */
function x6Achat(offre, prix) {
  const r = actions.buy(offre);
  if (r !== X6_BUY.OK && r !== X6_BUY.CLOSED && prix) {
    prix.classList.remove(X6_REFUS_PRIX[x6Vu[5] & 1]);
    x6Vu[5] = (x6Vu[5] + 1) & 1;
    prix.classList.add(X6_REFUS_PRIX[x6Vu[5] & 1]);
  }
  return r;
}

function fillShop(data, fresh) {
  if (fresh) {
    shopFocus.carte = -1;
    shopFocus.ligne = 0;
    shopSel = 0;
    shopLigneVue.w = -1;
  }
  if (shopBalanceBox) shopBalanceBox.dataset.bulle = intStr(Math.floor(data.fragments)) + ' fragments';
  if (shopSoinX7) setText(shopSoinX7, data.soin > 0 ? DECRYPTAGE_X7.soin.replace('{n}', intStr(data.soin)) : DECRYPTAGE_X7.soinPlein); // § E5.X7 (H6)
  // Solde en fragments entiers (ce qu'on peut dépenser : les prix sont entiers), comme la pastille du HUD.
  const balance = intStr(Math.floor(data.fragments));
  if (shopBalance.textContent !== balance) {
    shopBalance.textContent = balance;
    // Le solde rebondit quand il change sous les yeux du joueur (achat), pas à l'ouverture.
    if (fresh) shopBalance.style.animationName = 'none';
    else {
      flipBump = !flipBump;
      shopBalance.style.animationName = flipBump ? 'sr-bump-a' : 'sr-bump-b';
    }
  } else if (fresh) shopBalance.style.animationName = 'none';
  setText(shopNext, intStr(data.nextWave));

  for (let w = 0; w < WEAPON_COUNT; w++) {
    const v = data.weapons[w];
    const u = shopCards[w];
    // § E2.C règle 2 : le marchand n'améliore que les armes possédées — seules leurs cartes sont affichées, dans
    // l'ordre d'obtention (data.slots) ; plus de carte « à acheter » ni « verrouillée ».
    const state = v.owned ? 2 : 0;
    if (u.state !== state) {
      u.state = state;
      u.card.className = WCARD_CLASS[state];
      u.card.style.display = state === 2 ? '' : 'none';
    }
    const order = data.slots ? data.slots.indexOf(w) : w;
    if (u.order !== order) {
      u.order = order;
      u.card.style.order = order >= 0 ? String(order) : '99';
    }
    if (u.color !== v.color) {
      u.color = v.color;
      u.card.style.setProperty('--wc', v.color);
    }
    setText(u.name, v.name);
    setText(u.desc, v.desc);
    if (state === 2) setText(u.levelN, intStr(v.level));
    else if (state === 1) {
      setText(u.buyN, intStr(v.cost));
      // Trop chère : grisée. Le clic reste relié à actions.buy, qui joue le son de refus (§ Q). Soldée : étiquette (§ E1.D).
      setClass(u.buy, (v.affordable ? 'sr-btn sr-buy' : 'sr-btn sr-buy sr-disabled') + (v.onSale ? ' sr-sale' : ''));
    } else setText(u.lockN, intStr(v.unlockWave));

    for (let s = 0; s < STAT_COUNT; s++) {
      const st = v.stats[s];
      const r = u.rows[s];
      setText(r.label, st.label);
      const level = st.level;
      if (r.level !== level || fresh) {
        // Le cran qui vient d'être acheté rebondit ; rien ne rebondit à l'ouverture.
        const gained = !fresh && r.level >= 0 && level === r.level + 1;
        for (let k = 0; k < r.pips.length; k++) {
          setClass(r.pips[k], k < level ? (gained && k === level - 1 ? 'sr-pip sr-on sr-new' : 'sr-pip sr-on') : 'sr-pip');
        }
        r.level = level;
      }
      setText(r.cur, formatValue(st.value));
      setText(r.unit, st.unit || '');
      if (state !== 2) {
        setClass(r.row, 'sr-stat sr-disabled sr-none');
      } else if (st.maxed) {
        setClass(r.row, 'sr-stat sr-disabled sr-max');
        setText(r.gain, '');
      } else {
        setText(r.nxt, st.nextValue === null || st.nextValue === undefined ? '' : formatValue(st.nextValue));
        setText(r.gain, gainTexte(st.value, st.nextValue, st.unit)); // § E5.E.3 : « +2 » puis le nom de la stat
        setText(r.cost, intStr(st.cost));
        setClass(r.row, (st.affordable ? 'sr-stat' : 'sr-stat sr-disabled sr-poor') + (st.onSale ? ' sr-sale' : ''));
      }
      setText(r.manque, state === 2 && !st.maxed && !st.affordable ? x6Manque(st.cost, data.fragments) : ''); // § E5.X6 (F11)
    }
    // Surcharge (§ E1.D) : ligne affichée seulement quand l'arme est au niveau 21 ; le cran acheté rebondit.
    const oc = v.overcharge;
    const o = u.oc;
    const shown = !!(oc && oc.available);
    if (o.shown !== shown) {
      o.shown = shown;
      o.row.style.display = shown ? '' : 'none';
      u.desc.style.display = shown ? 'none' : ''; // la ligne de surcharge prend la place de la description
    }
    if (shown) {
      setText(o.level, '+' + oc.level);
      if (!fresh && o.last >= 0 && oc.level === o.last + 1) {
        flipSwap = !flipSwap;
        o.level.style.animationName = flipSwap ? 'sr-bump-a' : 'sr-bump-b';
      } else if (fresh) o.level.style.animationName = 'none';
      o.last = oc.level;
      setText(o.cur, '+' + oc.percent + ' %');
      setText(o.nxt, '+' + oc.nextPercent + ' %');
      setText(o.gain, gainTexte(oc.percent, oc.nextPercent, '%')); // § E5.E.3 (M3)
      setText(o.cost, intStr(oc.cost));
      setText(o.manque, oc.affordable ? '' : x6Manque(oc.cost, data.fragments)); // § E5.X6 (F11)
      setClass(o.row, (oc.affordable ? 'sr-stat sr-overcharge' : 'sr-stat sr-overcharge sr-disabled sr-poor') + (oc.onSale ? ' sr-sale' : ''));
    } else o.last = -1;
    // « A3 » : case de l'arsenal (visible si l'arme est possédée, même ordre) et couleur du PALIER de niveau (--c) de la
    // case et de la carte (même échelle que les cases d'armes du HUD : HUD_PALIERS)
    u.tile.style.display = state === 2 ? '' : 'none';
    u.tile.style.order = u.card.style.order;
    if (state === 2 && u.niv !== v.level) {
      u.niv = v.level;
      const coul = HUD_PALIERS[PAL_DE_NIV[Math.max(1, Math.min(v.level, PAL_MAX_NIV))]].couleur;
      u.card.style.setProperty('--c', coul);
      u.tile.style.setProperty('--c', coul);
      setText(u.tileN, intStr(v.level));
    }
    if (state === 2) shopRanger(u, v); // § E4.S.8
    u.card.classList.toggle('sr-wcard-bas', order >= SHOP_COLS);
  }
  let possedees = 0;
  for (let w = 0; w < WEAPON_COUNT; w++) if (shopCards[w].state === 2) possedees++;
  const libres = Math.max(0, CHESTS.weaponSlots - possedees);
  if (shopCompte) setText(shopCompte, possedees + ' / ' + CHESTS.weaponSlots);
  if (libres !== shopVidesVus) {
    shopVidesVus = libres;
    for (let k = 0; k < shopVides.length; k++) shopVides[k].style.display = k < libres ? '' : 'none';
  }
  shopPeindre();
}

function fillGameOver(data) {
  overTitre.dataset.entete = enteteAgent(AGENTS[run.agent].name, pseudo()); // § E4.E.5
  setText(overNums[0], intStr(data.wave));
  setText(overNums[1], intStr(data.kills));
  setText(overNums[2], intStr(data.level));
  setText(overNums[3], formatTime(data.time));
  overFlag.style.display = data.isNewBest ? 'block' : 'none';
  const b = data.best;
  setText(overBest, !data.isNewBest && b ? 'Meilleur score : vague ' + b.wave + ', ' + b.kills + ' robots détruits.' : '');
  overBest.style.display = !data.isNewBest && b ? '' : 'none';
  bilanUI.fill(data); // § E4.C
  // § E5.Q (C2) : cause de la défaite (textes composés par main.causeVue à l'entrée de l'écran : hors combat)
  const C = data.cause || null;
  setText(overCause.detruitVal, C && C.detruit ? C.detruit : '');
  overCause.detruit.style.display = C && C.detruit ? '' : 'none';
  setText(overCause.conseil, C && C.conseil ? C.conseil : ''); // § E5.AK
  overCause.conseil.style.display = C && C.detruit && C.conseil ? '' : 'none';
  setText(overCause.plusVal, C && C.groupe ? C.groupe + ' ' : '');
  setText(overCause.plusPct, C && C.groupe ? C.pct + ' %' : '');
  overCause.plus.style.display = C && C.groupe ? '' : 'none';
  overCause.box.style.display = C && (C.detruit || C.groupe) ? '' : 'none';
}

/** § E4.C : ce que montre le bilan de l'écran de fin (tests). */
export function bilanInspect() {
  return bilanUI.inspect({});
}

const NOTES_PLX = { layersPx: [PATCHNOTES_UI.parallaxPx, 0, 0], rate: 8, deadPx: 0.5 }; // § E4.I.6
const plxVide = document.createElement('div'); // couche 1 inutilisée de la parallaxe du titre (hors du DOM)

/** § E4.I.6 : panneau des notes de version (tests). */
export function notesInspect() {
  return notes.inspect({});
}

export function notesToggle() {
  return notes.basculer(true);
}

function fillScreen(id, data, fresh) {
  if (id === SCREEN.TITLE) {
    fillTitle(data);
    if (fresh) plxReset(notes.node(), plxVide, [], NOTES_PLX); // § E4.I.6
  }
  else if (id === SCREEN.PAUSE) {
    setSliders(data);
    fillKeys(data ? data.layout : 'unknown');
    if (CARTE) {
      placerFiche(); // § E4.L.1
      majFiche();
    }
    if (fresh) pauseReset(data); // § E3.I : fenêtre d’élément et panneaux refermés à chaque ouverture de la pause
  }
  else if (!data) return;
  else if (id === SCREEN.LEVELUP) fillLevelUp(data, fresh);
  else if (id === SCREEN.SHOP) fillShop(data, fresh);
  else if (id === SCREEN.GAMEOVER) fillGameOver(data);
  else if (id === SCREEN.CHEST) fillChest(data); // § E2.C
  else if (id === SCREEN.AGENT) fillAgents(data, fresh); // Écran Agents (tâche 5)
  else if (id === SCREEN.FUSION) fillFusion(data); // § E3.F
  else if (id === SCREEN.HUB) fillHub(data, fresh); // § E4.B
}

// ===== Plan addictif, étape 2, chantier C (§ E2.C) : écran du coffre (roulette), flèches des élites porteuses ==========

const CH = CHESTS.roulette;
const CHT = CHESTS.text;
const REEL_ICONS = ['sr-w0', 'sr-i-frag', 'sr-w2', 'sr-w4', 'sr-w1', 'sr-i-frag', 'sr-w5', 'sr-w3'];
const CLS_LOT = ['sr-card sr-facet sr-lot sr-lot-spin', 'sr-card sr-facet sr-lot sr-lot-climb', 'sr-card sr-facet sr-lot sr-lot-shown'];
let chestTitle, chestLead, chestFrags; // § E3.A : titre et phrase du gros lot, pluie de fragments
let chestStops = -1; // § E3.A : bandes du gros lot déjà arrêtées − 1
let chestFragsPlayed = 0;
let flipFrags = false;
const JP = ELITES.jackpot;
let chestBox, chestPending, chestLots, chestFoot, chestHint, chestVox, chestReroll, chestSkip, chestBanish, chestRerollN, chestSkipN, chestBanishN;
const lotCards = []; // { card, state, use, rarName, tag, name, desc, lines[], pips[], tier }
let chestView = null;
let chestSerial = -1;
let chestStage = -2; // −2 : rien ; −1 : les bandes défilent ; k ≥ 0 : palier de rareté atteint
let chestTicks = -1;
let chestReady = false;
let flipVox = false;
const CHEST_T = new Float64Array(1); // s depuis le début de la roulette (temps réel)

function buildChest() {
  const chest = el('div', 'sr-screen sr-chest');
  const head = el('div', 'sr-levelup-head sr-chest-head');
  chestTitle = el('h2', null, CHT.title);
  chestLead = el('p', 'sr-lead', CHT.lead);
  head.append(el('p', 'sr-chest-path', CHT.path), chestTitle, chestLead);
  chestPending = el('p', 'sr-pending', '');
  head.appendChild(chestPending);
  chest.appendChild(head);

  chestLots = el('div', 'sr-cards sr-lots');
  for (let i = 0; i < ELITES.maxLots; i++) { // § E3.A : 5 cartes ; les 4e et 5e ne servent qu'au gros lot
    const card = pressable(el('button', CLS_LOT[0]), () => {
      if (chestView && chestView.banishing) actions.banishLot(i);
      else actions.takeLot(i);
    });
    // bande qui défile (visible tant que le lot n'est pas révélé)
    const reel = el('div', 'sr-lot-reel');
    const strip = el('div', 'sr-lot-strip');
    for (let k = 0; k < REEL_ICONS.length * 2; k++) strip.appendChild(icon(REEL_ICONS[(k + i * 3) % REEL_ICONS.length]));
    reel.appendChild(strip);
    const top = el('div', 'sr-card-top');
    const ic = icon('sr-b-default');
    top.append(ic, indice(el('span', 'sr-key', ''), 'choix' + (i + 1))); // § E4.D
    const rar = el('div', 'sr-lot-rarity');
    const rarName = el('span', 'sr-lot-rarity-name', '');
    rar.appendChild(rarName);
    const list = pips(RARITIES.length, rar);
    const tag = el('div', 'sr-lot-tag', '');
    const name = el('div', 'sr-card-name');
    const desc = el('div', 'sr-card-desc');
    const linesBox = el('div', 'sr-lot-lines');
    const lines = [];
    for (let k = 0; k < STAT_COUNT; k++) {
      const l = el('span', 'sr-lot-line', '');
      linesBox.appendChild(l);
      lines.push(l);
    }
    const rec = creerFormule('sr-evo-recette sr-lot-recette'); // § E5.W : lot d'évolution — la recette en icônes
    rec.racine.style.display = 'none';
    linesBox.prepend(rec.racine);
    card.append(reel, rar, top, tag, name, desc, linesBox);
    chestLots.appendChild(card);
    lotCards.push({ card, state: 0, use: ic.firstChild, rarName, tag, name, desc, lines, rec, pips: list, tier: -1 });
  }
  chest.appendChild(chestLots);

  chestFoot = el('div', 'sr-chest-foot');
  chestReroll = button(CHT.reroll, 'sr-btn', () => actions.rerollLots(), '@relancer');
  chestRerollN = el('span', 'sr-num sr-chest-charge', '0');
  chestReroll.appendChild(chestRerollN);
  chestSkip = button(CHT.skip, 'sr-btn', () => actions.skipLots(), '@passer');
  chestSkipN = el('span', 'sr-num sr-chest-charge', '0');
  chestSkip.appendChild(chestSkipN);
  chestBanish = button(CHT.banish, 'sr-btn', () => actions.armBanish(), '@bannir');
  chestBanishN = el('span', 'sr-num sr-chest-charge', '0');
  chestBanish.appendChild(chestBanishN);
  chestHint = el('p', 'sr-lead sr-chest-hint', '');
  chestFoot.append(chestReroll, chestSkip, chestBanish);
  chest.append(chestFoot, chestHint);

  // Pluie de voxels filaires (lot « Chiffré » et au-dessus) : éléments créés une fois, relancés par une animation CSS.
  chestVox = el('div', 'sr-chest-vox');
  for (let k = 0; k < CH.voxels; k++) {
    const v = el('i', 'sr-vox');
    v.style.left = ((k * 61) % 100) + '%';
    v.style.animationDelay = ((k * 37) % 100) / 250 + 's';
    v.style.setProperty('--vs', 0.5 + ((k * 13) % 10) / 10 + 'rem');
    chestVox.appendChild(v);
  }
  chest.appendChild(chestVox);
  // § E3.A règle 5 : pluie de fragments du gros lot (losanges de mémoire, couleur du plus haut palier)
  chestFrags = el('div', 'sr-chest-frags');
  for (let k = 0; k < JP.frags; k++) {
    const f = el('i', 'sr-chest-frag'); // fusion du groupe 1 : pas « sr-frag », classe de la pastille des fragments du HUD
    f.style.left = ((k * 47 + 7) % 100) + '%';
    f.style.animationDelay = ((k * 29) % 100) / 160 + 's';
    f.style.setProperty('--fs', 0.45 + ((k * 7) % 10) / 14 + 'rem');
    f.style.setProperty('--fd', 1.1 + ((k * 11) % 10) / 12 + 's');
    chestFrags.appendChild(f);
  }
  chest.appendChild(chestFrags);
  chestBox = chest;
  addScreen(SCREEN.CHEST, chest);
}

/** Palier `tier` affiché sur la carte k : couleur et nom de la rareté atteinte, crans allumés (−1 : rien encore). */
function paintLotTier(k, tier) {
  const c = lotCards[k];
  if (c.tier === tier) return;
  c.tier = tier;
  const R = chestView.rarities[tier < 0 ? 0 : tier];
  c.card.style.setProperty('--rc', R.color);
  setText(c.rarName, tier < 0 ? CHT.decoding : rareteTexte(tier)); // § E5.L (C18) : nom et rang
  for (let q = 0; q < c.pips.length; q++) setClass(c.pips[q], q <= tier ? 'sr-pip sr-on' : 'sr-pip');
}

function setLotState(k, state) {
  const c = lotCards[k];
  const cls = CLS_LOT[state] + (chestView && chestView.banishing && state === 2 ? ' sr-lot-ban' : '');
  c.state = state;
  setClass(c.card, cls);
}

function fillChest(data) {
  chestView = data;
  // § E3.A : gros lot — titre, phrase, pas de relance / passe / bannissement
  setText(chestTitle, data.big ? JP.title + ' · ' + data.size + ' LOTS' : CHT.title);
  setText(chestLead, data.big ? JP.lead : CHT.lead);
  chestBox.classList.toggle('sr-chest-big', !!data.big);
  chestBox.classList.toggle('sr-chest-big5', !!data.big && data.size >= 5);
  setText(chestPending, data.pending > 0 ? '+ ' + data.pending + ' ' + CHT.pending : '');
  setText(chestRerollN, '× ' + data.rerolls);
  setText(chestSkipN, '× ' + data.skips);
  setText(chestSkip.querySelector('.sr-btn-label'), CHOICES.labels.skipGain ? CHOICES.labels.skipGain.replace('{n}', intStr(fragmentsPasse(run.wave))) : CHT.skip); // § E5.L (C7)
  setText(chestBanishN, '× ' + data.banishes);
  setClass(chestReroll, data.rerolls > 0 ? 'sr-btn' : 'sr-btn sr-disabled');
  setClass(chestSkip, data.skips > 0 ? 'sr-btn' : 'sr-btn sr-disabled');
  setClass(chestBanish, (data.banishes > 0 ? 'sr-btn' : 'sr-btn sr-disabled') + (data.banishing ? ' sr-armed' : ''));
  for (let k = 0; k < lotCards.length; k++) {
    const c = lotCards[k];
    const d = k < data.count ? data.lots[k] : null;
    c.card.style.display = d ? '' : 'none';
    if (!d) continue;
    c.use.setAttribute('href', '#' + d.icon);
    setText(c.tag, d.tag);
    setText(c.name, d.name);
    colorer(c.desc, d.desc); // § E5.E.3 : chiffres et mots clés colorés (M3)
    const evo = d.kind === LOT_EVOLUTION && d.id >= 0 && d.id < EVOLUTIONS.length; // § E5.W : sa 1re ligne = la recette
    if (evo) c.rec.poser(recetteEvolution(d.id));
    c.rec.racine.style.display = evo ? '' : 'none';
    for (let q = 0; q < c.lines.length; q++) {
      const t = q < d.lines.length && !(evo && q === 0) ? d.lines[q] : '';
      colorer(c.lines[q], t); // § E5.E.3
      c.lines[q].style.display = t ? '' : 'none';
    }
  }
  if (data.serial !== chestSerial) {
    // nouveau tirage : la roulette repart
    chestSerial = data.serial;
    CHEST_T[0] = 0;
    chestStage = -2;
    chestTicks = -1;
    chestReady = false;
    chestBox.classList.remove('sr-chest-ready');
    chestVox.className = 'sr-chest-vox';
    chestFrags.className = 'sr-chest-frags';
    chestStops = -1;
    chestFragsPlayed = 0;
    for (let k = 0; k < data.count; k++) {
      lotCards[k].tier = -2;
      setLotState(k, 0);
      paintLotTier(k, -1);
    }
  } else {
    // même tirage (bannissement armé ou désarmé) : seules les classes changent
    for (let k = 0; k < data.count; k++) setLotState(k, lotCards[k].state);
  }
  setText(chestHint, data.banishing ? CHT.banishing : !chestReady && data.skippable ? CHT.skipAnim : '');
}

/** Roulette (F12, état CHEST seulement — hors combat) : bandes, paliers de rareté, sons, gros lot. */
function updateChest(realDt) {
  const v = chestView;
  if (v !== null && v.big && v.open && v.serial === chestSerial) {
    if (realDt > 0) CHEST_T[0] += realDt;
    updateJackpot(v, CHEST_T[0]);
    return;
  }
  if (v === null || v.serial !== chestSerial || chestReady || !v.open) return;
  if (realDt > 0) CHEST_T[0] += realDt;
  const t = CHEST_T[0];
  if (t < CH.spinSeconds) {
    chestStage = -1;
    const ticks = Math.floor(t / CH.tickSeconds);
    if (ticks !== chestTicks) {
      chestTicks = ticks;
      audio.play(SFX.ROULETTE_TICK);
    }
    return;
  }
  let stage = Math.floor((t - CH.spinSeconds) / CH.stepSeconds);
  if (stage > v.maxRarity) stage = v.maxRarity;
  while (chestStage < stage) {
    // un palier à la fois, même si une image longue en a sauté un : chaque son de rareté est joué
    chestStage = chestStage < 0 ? 0 : chestStage + 1;
    const s = chestStage;
    audio.play(SFX.RARITY_0 + s);
    let big = false;
    for (let k = 0; k < v.count; k++) {
      const r = v.lots[k].rarity;
      if (r >= s) paintLotTier(k, s);
      if (r === s) {
        setLotState(k, 2);
        if (r >= CH.bigFrom) big = true;
      } else if (r > s) setLotState(k, 1);
    }
    if (big) {
      // gros lot : secousse, pluie de voxels de la couleur de la rareté (la simulation est déjà figée en CHEST)
      camera.addTrauma(CH.bigTrauma, TRAUMA.BOSS);
      if (ctx.fx) ctx.fx.hitstop(CH.bigHitstop);
      chestVox.style.setProperty('--rc', v.rarities[s].color);
      flipVox = !flipVox;
      chestVox.className = flipVox ? 'sr-chest-vox sr-vox-a' : 'sr-chest-vox sr-vox-b';
    }
  }
  if (stage >= v.maxRarity && t >= v.revealSeconds - CH.holdSeconds) {
    chestReady = true;
    chestBox.classList.add('sr-chest-ready');
    setText(chestHint, v.banishing ? CHT.banishing : '');
  }
}

/**
 * § E3.A règle 5 — roulette du gros lot (état CHEST, hors combat) : les k bandes défilent, puis s'arrêtent une à une ;
 * chaque arrêt joue le son de sa rareté, transposé d'un demi-ton de plus par bande (arpège qui monte) ; la dernière
 * joue le gros lot (SFX.JACKPOT) et lâche la pluie de fragments (SFX.FRAG_RAIN en série, hauteur qui monte). Arrêt sur
 * image et secousse si le plus haut palier atteint CHESTS.roulette.bigFrom.
 */
function updateJackpot(v, t) {
  if (t < v.firstStop) {
    const ticks = Math.floor(t / CH.tickSeconds);
    if (ticks !== chestTicks) {
      chestTicks = ticks;
      audio.play(SFX.ROULETTE_TICK);
    }
  }
  let stops = t < v.firstStop ? -1 : Math.floor((t - v.firstStop) / v.stagger);
  if (stops > v.count - 1) stops = v.count - 1;
  while (chestStops < stops) {
    chestStops++;
    const k = chestStops;
    const r = v.lots[k].rarity;
    paintLotTier(k, r);
    setLotState(k, 2);
    audio.playPitch(SFX.RARITY_0 + r, k * JP.semitone);
    if (k === v.count - 1) jackpotBurst(v);
  }
  // pluie de fragments : FRAG_RAIN rejoué en série après le dernier arrêt
  if (chestStops === v.count - 1 && chestFragsPlayed < JP.fragSounds) {
    const since = t - (v.firstStop + (v.count - 1) * v.stagger);
    const due = Math.floor(since / JP.fragEvery) + 1;
    while (chestFragsPlayed < due && chestFragsPlayed < JP.fragSounds) {
      audio.playPitch(SFX.FRAG_RAIN, chestFragsPlayed * JP.fragStep);
      chestFragsPlayed++;
    }
  }
  if (!chestReady && t >= v.revealSeconds - JP.holdSeconds && chestStops === v.count - 1) {
    chestReady = true;
    chestBox.classList.add('sr-chest-ready');
    setText(chestHint, JP.take);
  }
}

function jackpotBurst(v) {
  audio.play(SFX.JACKPOT);
  const top = v.maxRarity;
  chestFrags.style.setProperty('--rc', v.rarities[top].color);
  flipFrags = !flipFrags;
  chestFrags.className = flipFrags ? 'sr-chest-frags sr-frags-a' : 'sr-chest-frags sr-frags-b';
  if (top >= CH.bigFrom) {
    camera.addTrauma(CH.bigTrauma, TRAUMA.BOSS);
    if (ctx.fx) ctx.fx.hitstop(CH.bigHitstop);
    chestVox.style.setProperty('--rc', v.rarities[top].color);
    flipVox = !flipVox;
    chestVox.className = flipVox ? 'sr-chest-vox sr-vox-a' : 'sr-chest-vox sr-vox-b';
  }
}

/** Entrée (main.skipChestAnimation) : la roulette saute à sa fin ; seul le son de la plus haute rareté est joué. */
export function skipChestAnimation() {
  const v = chestView;
  if (v === null || chestReady) return;
  if (v.big) {
    // § E3.A : toutes les bandes s'arrêtent d'un coup ; le gros lot sonne une fois
    for (let k = 0; k < v.count; k++) {
      paintLotTier(k, v.lots[k].rarity);
      setLotState(k, 2);
    }
    chestStops = v.count - 1;
    chestFragsPlayed = JP.fragSounds;
    jackpotBurst(v);
    CHEST_T[0] = v.revealSeconds;
    chestReady = true;
    chestBox.classList.add('sr-chest-ready');
    setText(chestHint, JP.take);
    return;
  }
  for (let k = 0; k < v.count; k++) {
    paintLotTier(k, v.lots[k].rarity);
    setLotState(k, 2);
  }
  chestStage = v.maxRarity;
  audio.play(SFX.RARITY_0 + v.maxRarity);
  CHEST_T[0] = v.revealSeconds;
  chestReady = true;
  chestBox.classList.add('sr-chest-ready');
  setText(chestHint, '');
}

// Flèches des élites porteuses (§ E2.C règle 3) : une flèche or sur le bord de l'écran tant que la porteuse est hors
// champ. Même projection et mêmes tables de chaînes que updateBeacon (qui n'est pas touchée) ; champ visible :
// view.visHalfW / visHalfH s'ils existent (chantier E, zoom), sinon view.halfW / halfH.
const CARRIER_MAX = 2;
const carrierEls = [];
const carrierStyles = [];
const carrierLast = new Int32Array(CARRIER_MAX * 3).fill(-100000);
let carriersShown = 0;

function buildCarrierBeacons(layer) {
  for (let k = 0; k < CARRIER_MAX; k++) {
    const a = el('div', 'sr-arrow sr-beacon sr-elite-arrow');
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 28 28');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', 'M3 3 26 14 3 25 9 14z');
    s.appendChild(p);
    a.appendChild(s);
    layer.appendChild(a);
    carrierEls.push(a);
    carrierStyles.push(a.style);
  }
}

function updateCarrierBeacons() {
  let n = 0;
  const count = E.count;
  if (count > 0 && hudVisible) {
    const view = camera.view;
    const halfW = view.visHalfW > 0 ? view.visHalfW : view.halfW;
    const halfH = view.visHalfH > 0 ? view.visHalfH : view.halfH;
    const cx = view.widthPx * 0.5;
    const cy = view.heightPx * 0.5;
    let rem = view.heightPx * REM_PER_HEIGHT;
    if (view.widthPx * REM_PER_WIDTH < rem) rem = view.widthPx * REM_PER_WIDTH;
    if (rem < UI.scale.minRemPx) rem = UI.scale.minRemPx;
    else if (rem > UI.scale.maxRemPx) rem = UI.scale.maxRemPx;
    const inset = rem * INSET_PER_REM;
    let hx = cx - inset;
    let hy = cy - inset;
    if (hx < 1) hx = 1;
    if (hy < 1) hy = 1;
    const sinP = view.halfH / view.halfD;
    const m = CHESTS.carrier.arrowMargin;
    const FL = E.flags;
    const AL = E.alive;
    for (let i = 0; i < count && n < CARRIER_MAX; i++) {
      if (AL[i] === 0 || (FL[i] & EFLAG.ELITE) === 0 || E.sus[i] === 2) continue; // § E4.F : porteuse garée
      let dx = 0;
      let dy = 0;
      if (view.persp === 1) {
        // § E5.AB.12 : perspective — vraie projection en pixels, marge en pixels du champ visible
        PJ[0] = E.x[i];
        PJ[1] = ARROW_HEIGHT;
        PJ[2] = E.z[i];
        camera.ecranT(PJ);
        const mp = m * view.visPxPerMeter;
        if (PJ[5] === 1 && PJ[3] > mp && PJ[3] < view.widthPx - mp && PJ[4] > mp && PJ[4] < view.heightPx - mp) continue;
        dx = PJ[5] === 1 ? PJ[3] - cx : cx - PJ[3];
        dy = PJ[5] === 1 ? PJ[4] - cy : cy - PJ[4];
      } else {
        const vx = E.x[i] - view.targetX;
        const vz = E.z[i] - view.targetZ;
        const a = vx * view.rightX + vz * view.rightZ;
        const b = (vx * view.upX + vz * view.upZ) * sinP + ARROW_HEIGHT * sinP * view.groundPerHeight;
        if (!(a < -halfW + m || a > halfW - m || b < -halfH + m || b > halfH - m)) continue;
        dx = (a * cx) / view.halfW;
        dy = (-b * cy) / view.halfH;
      }
      const ax = dx < 0 ? -dx : dx;
      const ay = dy < 0 ? -dy : dy;
      const t = ax * hy > ay * hx ? hx / ax : ay > 0 ? hy / ay : 0;
      const px = Math.round(cx + dx * t);
      const py = Math.round(cy + dy * t);
      const deg = Math.round(Math.atan2(dy, dx) * RAD2DEG);
      const o = n * 3;
      const st = carrierStyles[n];
      if (carrierLast[o] !== px) {
        carrierLast[o] = px;
        st.setProperty('--x', px >= 0 && px < PX.length ? PX[px] : px + 'px');
      }
      if (carrierLast[o + 1] !== py) {
        carrierLast[o + 1] = py;
        st.setProperty('--y', py >= 0 && py < PX.length ? PX[py] : py + 'px');
      }
      if (carrierLast[o + 2] !== deg) {
        carrierLast[o + 2] = deg;
        st.setProperty('--r', DEG[deg + 180]);
      }
      n++;
    }
  }
  if (n !== carriersShown) {
    for (let k = 0; k < CARRIER_MAX; k++) carrierEls[k].style.display = k < n ? 'block' : 'none';
    carriersShown = n;
  }
}

// ----- API du contrat --------------------------------------------------------------------------------------------------

/** Un seul écran à la fois ; SCREEN.NONE les cache tous (display: none, jamais seulement transparent). */
export function setScreen(id, data) {
  if (id !== SCREEN.PAUSE) annulerAttente(); // § E4.D : une touche attendue ne survit pas à la pause
  screen = id;
  // Aucun élément de l'interface ne garde le focus d'un écran à l'autre (curseur pris puis relâché sans bouger).
  const a = document.activeElement;
  if (a && a !== document.body && root.contains(a)) a.blur();
  const shown = id !== SCREEN.NONE ? screens[id] : null;
  for (let i = 0; i < screenList.length; i++) {
    const node = screenList[i];
    const display = node === shown ? 'flex' : 'none';
    if (node.style.display !== display) node.style.display = display;
  }
  if (shown) fillScreen(id, data, true);
  // § E4.E.1 (demande de Femz du 16/11) : fiche (pause) ou écran de fin ouverts → le bloc du bas du HUD sort du cadre
  // vers le bas (et la colonne d'objets vers la gauche), en glissant ; il revient à la reprise. Hors combat.
  if (hud) hud.classList.toggle('sr-hud-retire', id === SCREEN.PAUSE || id === SCREEN.GAMEOVER);
  bulleX7Cacher(); // § E5.X7 : un écran s'ouvre, la bulle du HUD se ferme
  // En partie (aucun écran), la souris ne sert à rien : son curseur est caché.
  document.documentElement.classList.toggle('sr-en-jeu', !shown);
}

/** Même écran, nouvelles données (boutique après un achat, choix de bonus suivant). */
export function refreshScreen(data) {
  if (screen !== SCREEN.NONE && screens[screen]) fillScreen(screen, data, false);
}

export function setHudVisible(visible) {
  hudVisible = !!visible;
  hud.style.display = hudVisible ? 'block' : 'none';
}

/** 3, 2, 1 ; 0 = masqué. Chaque chiffre « saute » à l'écran (UI.countdownPopSeconds). */
export function setCountdown(n) {
  countdown = n;
  if (n > 0) {
    countdownEl.textContent = intStr(n);
    flipPop = !flipPop;
    countdownEl.style.animation = (flipPop ? 'sr-pop-a' : 'sr-pop-b') + ' var(--sr-pop-s) cubic-bezier(0.2, 0.8, 0.3, 1) both';
    countdownEl.style.display = 'block';
  } else {
    countdownEl.style.display = 'none';
  }
}

/**
 * Bannière à la suite (§ E1.B) : affichée tout de suite si aucune bannière n'est à l'écran, sinon dès que celle en
 * cours s'efface. File fixe de CAPS.bannerQueue références (pleine : la demande est perdue). Renvoie true si prise.
 * sfx (§ E1.S) : son de la bannière (SFX.*), joué à l'image où elle S'AFFICHE — jamais avant elle quand elle attend.
 */
export function queueBanner(text, seconds = WAVES.banner.seconds, sfx = -1) {
  if (!(T[T_BANNER] > 0) && queueLen === 0) {
    showBanner(text, seconds);
    if (sfx >= 0) audio.play(sfx);
    return true;
  }
  if (queueLen >= queueText.length) {
    if (sfx >= 0) audio.play(sfx); // file pleine : la bannière est perdue, pas son alerte
    return false;
  }
  const k = (queueHead + queueLen) % queueText.length;
  queueText[k] = text;
  queueSeconds[k] = seconds;
  queueSfx[k] = sfx;
  queueLen++;
  return true;
}

/**
 * « Vague 3 », « Vague 3 terminée », « BOSS ». Une chaîne construite par bannière : toléré (§ V).
 * Un texte « SURTITRE : TITRE » (§ E1.B : « MISE À JOUR DÉTECTÉE : TIREURS v2.0 ») s'affiche en deux lignes, façon
 * barre de titre à chemin de la DA FUI : le surtitre en petit au-dessus, le titre en grand, en rouge (l'AGI parle).
 */
export function showBanner(text, seconds = WAVES.banner.seconds) {
  const brut = String(text);
  const nl = brut.indexOf('\n'); // § E4.N.3 : « surtitre : libellé\nexplication »
  const full = nl >= 0 ? brut.slice(0, nl) : brut;
  const sous = nl >= 0 ? brut.slice(nl + 1) : '';
  const cut = full.indexOf(' : ');
  const label = cut > 0 ? full.slice(cut + 3) : full;
  const kicker = cut > 0 ? full.slice(0, cut) : '';
  if (!(seconds > 0)) seconds = WAVES.banner.seconds;
  bannerText = text;
  T[T_BANNER] = seconds;
  bannerKicker.textContent = kicker;
  bannerKicker.style.display = kicker ? 'block' : 'none';
  bannerLabel.textContent = label;
  // DA carte mère : copies du texte pour les trois bandes du glitch (ui.css : libellé ::before / ::after, bannière ::before)
  bannerLabel.dataset.texte = label;
  bannerEl.dataset.texte = label;
  // Le trait sous le texte dit de quoi il s'agit : alerte (boss), vague finie, ou vague qui commence.
  // (§ E1.C : le surtitre EVENTS.kickerAlly — ravitaillement — passe la bannière au cyan de l'agent, classe sr-ally)
  bannerEl.className = kicker === KICKER_RESTE || kicker === KICKER_REGROUPES ? 'sr-banner sr-update sr-reste' : kicker === BOSS_IDENTITE.categorie ? 'sr-banner sr-alert' : kicker === EVENTS.kickerAlly || kicker === UI.record.kicker ? 'sr-banner sr-update sr-ally' : kicker ? 'sr-banner sr-update' : label.indexOf('terminée') >= 0 ? 'sr-banner sr-done' : 'sr-banner';
  bannerSous.textContent = sous;
  if (sous) bannerEl.className += ' sr-explique';
  const tIn = seconds * UI.bannerInFraction;
  const tOut = seconds * UI.bannerOutFraction;
  flipBanner = !flipBanner;
  bannerEl.style.animation =
    (flipBanner ? 'sr-ban-in-a ' : 'sr-ban-in-b ') + tIn.toFixed(3) + 's ease-out both, ' +
    (flipBanner ? 'sr-ban-out-a ' : 'sr-ban-out-b ') + tOut.toFixed(3) + 's ease-in ' + (seconds - tOut).toFixed(3) + 's forwards';
  bannerEl.style.display = 'flex';
}

export function reset() {
  setScreen(SCREEN.NONE);
  setCountdown(0);
  resetToast(); // § E4.A.6
  bannerText = null;
  queueLen = 0;
  queueHead = 0;
  queueText.fill(null);
  queueSfx.fill(-1);
  T[T_BANNER] = 0;
  bannerEl.style.display = 'none';
  bossBox.style.display = 'none';
  bossBox.className = CLS_BOSS[0];
  for (let k = 0; k < arrowsShown; k++) arrowEls[k].style.display = 'none';
  arrowsShown = 0;
  arrowLast.fill(-100000);
  beaconEl.style.display = 'none';
  beaconShown = false;
  beaconLast.fill(-100000);
  last.fill(-1);
  lastWeaponLevel.fill(-1);
  lastSlotWeapon.fill(-2); // § E2.C
  lastSlotPal.fill(-2); // § E5.E.1
  recapReset(); // § E5.E.2
  comboLast.fill(-1); // § E5.E.7 : crans réécrits à la prochaine image
  lastItemId.fill(-2); // § E2.F
  lastItemStacks.fill(-1);
  lastItemState.fill(-1);
  for (let k = 0; k < carriersShown; k++) carrierEls[k].style.display = 'none';
  carriersShown = 0;
  carrierLast.fill(-100000);
  consignes.reset(); // § E5.L
}

// ----- Chemin chaud ----------------------------------------------------------------------------------------------------

/**
 * Flèches de bord d'écran (§ K) : pour chaque robot vivant hors champ, une flèche sur le bord de l'écran (retrait
 * UI.arrows.insetPx, à l'échelle de l'interface), dans la direction du robot vue depuis le centre. Au plus
 * UI.arrows.max éléments, et seulement quand waves.shouldShowArrows(). La position passe par trois variables CSS
 * (--x, --y, --r) que lit le transform de .sr-arrow : chacune n'est réécrite que si elle a changé d'un pixel ou d'un
 * degré, avec une chaîne des tables.
 *
 * La projection est celle de camera.worldToScreen(x, ARROW_HEIGHT, z), écrite dans la boucle à partir de camera.view
 * (§ N) : un appel par robot avec des arguments flottants allouerait 12 octets par flottant (§ V, mesuré ici :
 * 185 octets par image pour 9 flèches). À droite : a = v · right. Vers le haut : la part du sol, vue sous l'angle de
 * plongée (sin = halfH / halfD), plus la hauteur du point visé (cos = sin × groundPerHeight). tests/ui.test.mjs
 * compare chaque flèche à camera.worldToScreen : les deux calculs ne peuvent pas diverger sans que le test le voie.
 */
function updateArrows() {
  let n = 0;
  if (waves.shouldShowArrows()) {
    const view = camera.view;
    const halfW = view.visHalfW; // § E2.E : le champ VISIBLE (zoom de la molette), pas le champ de jeu
    const halfH = view.visHalfH;
    const cx = view.widthPx * 0.5;
    const cy = view.heightPx * 0.5;
    let rem = view.heightPx * REM_PER_HEIGHT;
    if (view.widthPx * REM_PER_WIDTH < rem) rem = view.widthPx * REM_PER_WIDTH;
    if (rem < UI.scale.minRemPx) rem = UI.scale.minRemPx;
    else if (rem > UI.scale.maxRemPx) rem = UI.scale.maxRemPx;
    const inset = rem * INSET_PER_REM;
    let hx = cx - inset;
    let hy = cy - inset;
    if (hx < 1) hx = 1;
    if (hy < 1) hy = 1;
    const tx = view.targetX;
    const tz = view.targetZ;
    const rX = view.rightX;
    const rZ = view.rightZ;
    const sinP = halfH / view.visHalfD;
    const uX = view.upX * sinP;
    const uZ = view.upZ * sinP;
    const bY = ARROW_HEIGHT * sinP * view.groundPerHeight;
    const pxA = cx / halfW; // pixels par mètre d'écran
    const pxB = cy / halfH;
    const persp = view.persp; // § E5.AB.12
    const count = E.count;
    const alive = E.alive;
    const ex = E.x;
    const ez = E.z;
    for (let i = 0; i < count && n < ARROW_MAX; i++) {
      if (alive[i] === 0 || E.sus[i] === 2) continue; // § E4.F : garé
      let dx = 0;
      let dy = 0;
      if (persp === 1) {
        // § E5.AB.12 : perspective — vraie projection en pixels
        PJ[0] = ex[i];
        PJ[1] = ARROW_HEIGHT;
        PJ[2] = ez[i];
        camera.ecranT(PJ);
        if (PJ[5] === 1 && PJ[3] >= 0 && PJ[3] <= view.widthPx && PJ[4] >= 0 && PJ[4] <= view.heightPx) continue;
        dx = PJ[5] === 1 ? PJ[3] - cx : cx - PJ[3];
        dy = PJ[5] === 1 ? PJ[4] - cy : cy - PJ[4];
      } else {
        const vx = ex[i] - tx;
        const vz = ez[i] - tz;
        const a = vx * rX + vz * rZ; // m d'écran vers la droite
        const b = vx * uX + vz * uZ + bY; // m d'écran vers le haut
        if (a >= -halfW && a <= halfW && b >= -halfH && b <= halfH) continue; // à l'écran : pas de flèche
        dx = a * pxA;
        dy = -b * pxB;
      }
      const ax = dx < 0 ? -dx : dx;
      const ay = dy < 0 ? -dy : dy;
      // Facteur qui ramène le point sur le rectangle en retrait, le long de la droite centre → robot.
      const t = ax * hy > ay * hx ? hx / ax : ay > 0 ? hy / ay : 0;
      const px = Math.round(cx + dx * t);
      const py = Math.round(cy + dy * t);
      const deg = Math.round(Math.atan2(dy, dx) * RAD2DEG);
      const o = n * 3;
      const st = arrowStyles[n];
      if (arrowLast[o] !== px) {
        arrowLast[o] = px;
        st.setProperty('--x', px >= 0 && px < PX.length ? PX[px] : px + 'px');
      }
      if (arrowLast[o + 1] !== py) {
        arrowLast[o + 1] = py;
        st.setProperty('--y', py >= 0 && py < PX.length ? PX[py] : py + 'px');
      }
      if (arrowLast[o + 2] !== deg) {
        arrowLast[o + 2] = deg;
        st.setProperty('--r', DEG[deg + 180]);
      }
      n++;
    }
  }
  if (n !== arrowsShown) {
    for (let k = arrowsShown; k < n; k++) arrowEls[k].style.display = 'block';
    for (let k = n; k < arrowsShown; k++) arrowEls[k].style.display = 'none';
    arrowsShown = n;
  }
}

/**
 * Flèche de la capsule de ravitaillement (§ E1.C) : tant qu'une capsule attend hors de l'écran, une flèche cyan sur le
 * bord de l'écran la désigne. Même projection et mêmes tables de chaînes que updateArrows ; elle s'efface dès que la
 * capsule est à l'écran.
 */
/**
 * § E5.V tâche 7 — piste du palier (variante B). Cachée en vague de boss (aucun décryptage avant elle) et hors partie.
 * Réécrite seulement quand son état codé change (vague, dixième du chrono, terminal disponible).
 */
function majPalier(shownState, wave, clock) {
  const p = wave > 0 ? (wave - 1) % PALIERS_VAGUES.taille : -1;
  const cache = p < 0 || p >= PAL_N;
  let pas10 = 0;
  if (!cache && shownState !== STATE.COUNTDOWN) {
    const total = waveClockSeconds(wave);
    pas10 = total > 0 ? Math.floor((10 * (total - clock)) / total) : 0;
    if (pas10 < 0) pas10 = 0;
    else if (pas10 > 10) pas10 = 10;
  }
  const term = !cache && ctx.terminal && ctx.terminal.estDisponible() ? 1 : 0;
  const code = cache ? -2 : p * 100 + pas10 * 2 + term;
  if (term === 1) {
    const lab = ctx.libelleInteragir ? ctx.libelleInteragir() : null; // main.js (ui.js n'importe pas invite-interagir)
    if (lab !== palToucheTxt) {
      palToucheTxt = lab;
      palTouche.textContent = lab === null ? '' : lab;
    }
  }
  if (code === last[L_PALIER]) return;
  last[L_PALIER] = code;
  palier.className = CLS_PALIER[cache ? 1 : term ? 2 : 0];
  if (cache) return;
  // § E5.L (A9) : la piste dit ce qui vient en mots de joueur (une chaîne par changement d'état : une fois par vague)
  const H = PALIERS_VAGUES.hud;
  if (H.marchandApres && wave !== palVague) {
    palVague = wave;
    setText(palDec, p >= PAL_N - 1 ? H.marchandFin : H.marchandApres.replace('{v}', intStr(wave - p + PAL_N - 1)));
  }
  const tSeg = PALIERS_VAGUES.terminalDecalage - 1; // segment de la vague du terminal
  for (let k = 0; k < PAL_N; k++) {
    const base = term === 1 && k === tSeg ? 13 : 0;
    palSegs[k].className = CLS_PAL_SEG[base + (k < p ? 1 : k === p ? 2 + pas10 : 0)];
  }
}

/** § E5.X6 (D5, H7) : bandeau du terminal posé — temps restant, touche à portée, « approchez-vous » sinon (mis en avant
 * X6C.terminal.appelS s après un appui hors de portée). Entiers comparés : le DOM n'est écrit qu'aux changements. */
function majTerminalX6(realDt) {
  const dispo = ctx.terminal && ctx.terminal.estDisponible();
  const X6_TERM = ctx.terminal.TX6;
  if (!dispo) {
    x6T[0] = 0;
    x6Vu[4] = X6_TERM[0];
    return;
  }
  const sec = ctx.terminal.secondesRestantes();
  if (sec !== x6Vu[2]) {
    x6Vu[2] = sec;
    palX6Sec.textContent = intStr(sec);
  }
  if (X6_TERM[0] !== x6Vu[4]) {
    if (x6Vu[4] >= 0) x6T[0] = X6C.terminal.appelS;
    x6Vu[4] = X6_TERM[0];
  } else if (x6T[0] > 0 && realDt > 0) x6T[0] = x6T[0] > realDt ? x6T[0] - realDt : 0;
  const etat = X6_TERM[1] === 1 ? 0 : x6T[0] > 0 ? 2 : 1;
  if (etat !== x6Vu[3]) {
    x6Vu[3] = etat;
    palX6Term.className = X6_CLS_TERM[etat];
  }
}

function updateBeacon() {
  let show = false;
  // § E5.V : la capsule garde la priorité ; sinon le terminal posé (pas encore utilisé)
  if (events.getBeacon(BEACON) || (ctx.terminal && ctx.terminal.getBeacon(BEACON))) {
    const view = camera.view;
    const halfW = view.visHalfW; // § E2.E : le champ VISIBLE (zoom de la molette), pas le champ de jeu
    const halfH = view.visHalfH;
    const cx = view.widthPx * 0.5;
    const cy = view.heightPx * 0.5;
    let rem = view.heightPx * REM_PER_HEIGHT;
    if (view.widthPx * REM_PER_WIDTH < rem) rem = view.widthPx * REM_PER_WIDTH;
    if (rem < UI.scale.minRemPx) rem = UI.scale.minRemPx;
    else if (rem > UI.scale.maxRemPx) rem = UI.scale.maxRemPx;
    const inset = rem * INSET_PER_REM;
    let hx = cx - inset;
    let hy = cy - inset;
    if (hx < 1) hx = 1;
    if (hy < 1) hy = 1;
    const sinP = halfH / view.visHalfD;
    const m = BEACON_T.arrowMargin;
    let hors = false;
    let dx = 0;
    let dy = 0;
    if (view.persp === 1) {
      // § E5.AB.12 : perspective — vraie projection en pixels, marge en pixels du champ visible
      PJ[0] = BEACON[0];
      PJ[1] = BEACON_T.height * 0.5;
      PJ[2] = BEACON[1];
      camera.ecranT(PJ);
      const mp = m * view.visPxPerMeter;
      hors = !(PJ[5] === 1 && PJ[3] > mp && PJ[3] < view.widthPx - mp && PJ[4] > mp && PJ[4] < view.heightPx - mp);
      dx = PJ[5] === 1 ? PJ[3] - cx : cx - PJ[3];
      dy = PJ[5] === 1 ? PJ[4] - cy : cy - PJ[4];
    } else {
      const vx = BEACON[0] - view.targetX;
      const vz = BEACON[1] - view.targetZ;
      const a = vx * view.rightX + vz * view.rightZ;
      const b = (vx * view.upX + vz * view.upZ) * sinP + BEACON_T.height * 0.5 * sinP * view.groundPerHeight;
      hors = a < -halfW + m || a > halfW - m || b < -halfH + m || b > halfH - m;
      dx = (a * cx) / halfW;
      dy = (-b * cy) / halfH;
    }
    if (hors) {
      show = true;
      const ax = dx < 0 ? -dx : dx;
      const ay = dy < 0 ? -dy : dy;
      const t = ax * hy > ay * hx ? hx / ax : ay > 0 ? hy / ay : 0;
      const px = Math.round(cx + dx * t);
      const py = Math.round(cy + dy * t);
      const deg = Math.round(Math.atan2(dy, dx) * RAD2DEG);
      if (beaconLast[0] !== px) {
        beaconLast[0] = px;
        beaconStyle.setProperty('--x', px >= 0 && px < PX.length ? PX[px] : px + 'px');
      }
      if (beaconLast[1] !== py) {
        beaconLast[1] = py;
        beaconStyle.setProperty('--y', py >= 0 && py < PX.length ? PX[py] : py + 'px');
      }
      if (beaconLast[2] !== deg) {
        beaconLast[2] = deg;
        beaconStyle.setProperty('--r', DEG[deg + 180]);
      }
    }
  }
  if (show !== beaconShown) {
    beaconShown = show;
    beaconEl.style.display = show ? 'block' : 'none';
  }
}

/** F12 : lit l'état à chaque image, n'écrit dans le DOM que si la valeur affichée change. */
export function update(realDt) {
  updateClic(realDt); // § E5.AB.14 : repères du clic au sol (mode Vue fixe)
  updateCurseur(); // § E5.AB.7 : curseur du jeu sous verrou, plaque « Cliquez pour reprendre la souris »
  if (T[T_BANNER] > 0) {
    // Un realDt non fini ou négatif est ignoré : NaN rendrait la minuterie NaN, et la bannière ne s'effacerait plus.
    if (realDt > 0) T[T_BANNER] -= realDt;
    if (!(T[T_BANNER] > 0)) {
      T[T_BANNER] = 0;
      bannerText = null;
      bannerEl.style.display = 'none';
      if (queueLen > 0) {
        // bannière suivante de la file (§ E1.B)
        const k = queueHead;
        queueHead = (queueHead + 1) % queueText.length;
        queueLen--;
        const text = queueText[k];
        const sfx = queueSfx[k];
        queueText[k] = null;
        queueSfx[k] = -1;
        showBanner(text, queueSeconds[k]);
        if (sfx >= 0) audio.play(sfx); // le son de la bannière part avec elle (§ E1.S)
      }
    }
  }
  if (screen === SCREEN.AGENT || screen === SCREEN.HUB || screen === SCREEN.TITLE) plxUpdate(realDt); // § E2.D, § E4.B.2, § E4.I.6 : parallaxe commune
  updateToast(realDt); // § E4.A.6
  consignes.update(realDt); // § E5.L : bulles de consigne (cachées sous les écrans de choix)
  if (screen === SCREEN.GAMEOVER) bilanUI.update(realDt); // § E4.C : montée des Cycles (hors combat)
  if (!hudVisible) return;
  updateEffects(); // § E3.C
  recapUpdate(realDt); // § E5.E.2

  // PV : nombre, maximum, barre, alerte sous UI.hpLowFraction.
  const hp = Math.ceil(P.hp);
  if (hp !== last[L_HP]) {
    last[L_HP] = hp;
    hpNum.textContent = intStr(hp);
  }
  const maxHp = Math.round(P.maxHp);
  if (maxHp !== last[L_MAXHP]) {
    last[L_MAXHP] = maxHp;
    hpMaxNum.textContent = intStr(maxHp);
  }
  let ratio = P.maxHp > 0 ? P.hp / P.maxHp : 0;
  if (ratio < 0) ratio = 0;
  else if (ratio > 1) ratio = 1;
  const hpBar = Math.ceil(ratio * HP_Q - 1e-6); // arrondi au-dessus : tant qu'il reste des PV, la barre n'est pas vide
  if (hpBar !== last[L_HPBAR]) {
    // DA carte mère : la barre baisse → le bandeau des PV « surgit et clignote » (ui.css, cy-touche-a/b alternés pour
    // relancer l'animation ; chaînes constantes, aucune allocation)
    if (CARTE && hpBar < last[L_HPBAR]) {
      flipTouche = !flipTouche;
      hpRow.style.animationName = flipTouche ? 'cy-touche-a' : 'cy-touche-b';
    }
    last[L_HPBAR] = hpBar;
    hpFill.style.transform = SCALE_HP[hpBar];
  }
  // § E5.Q (B14) : un soin signalé (src/soin-heros.js) relance l'éclat vert de la barre (ui.css, sr-soin-a|b alternés ;
  // chaînes constantes, aucune allocation)
  if (SOIN_SIGNAUX[0] !== soinVu) {
    soinVu = SOIN_SIGNAUX[0];
    flipSoin = !flipSoin;
    hpSoin.style.animationName = flipSoin ? 'sr-soin-a' : 'sr-soin-b';
  }
  const low = ratio < UI.hpLowFraction ? 1 : 0;
  if (low !== last[L_LOW]) {
    last[L_LOW] = low;
    hpRow.className = low === 1 ? CLS_HP_LOW : CLS_HP;
  }

  // XP : la barre n'est réécrite que si elle varie d'au moins UI.xpBarStep.
  ratio = run.xpToNext > 0 ? run.xp / run.xpToNext : 0;
  if (ratio < 0) ratio = 0;
  else if (ratio > 1) ratio = 1;
  const xp = Math.round(ratio * XP_Q);
  if (xp !== last[L_XP]) {
    last[L_XP] = xp;
    xpFill.style.transform = SCALE_XP[xp];
  }

  // Compteurs : la valeur AFFICHÉE est un entier, et c'est elle qu'on compare à la dernière valeur écrite (gardée
  // dans un tableau d'entiers). Comparer la valeur brute réécrirait le nœud à chaque image dès qu'elle n'est pas
  // entière (un crédit de 12,5 fragments), et rien ne s'afficherait.
  const level = Math.floor(run.level);
  if (level !== last[L_LEVEL]) {
    last[L_LEVEL] = level;
    levelNum.textContent = intStr(level);
  }
  // Pastille « Vague » : la vague en cours et, pendant un compte à rebours, celle qu'il annonce (run.wave + 1 : § D.1),
  // y compris sous une pause prise pendant ce compte à rebours. Le premier compte à rebours (run.wave = 0) annonce
  // donc la vague 1, les suivants la vague qui vient : la pastille ne saute plus au départ.
  const shownState = game.state === STATE.PAUSED || game.state === STATE.LEVELUP ? game.returnState : game.state;
  const wave = shownState === STATE.COUNTDOWN ? run.wave + 1 : run.wave;
  if (wave !== last[L_WAVE]) {
    last[L_WAVE] = wave;
    waveNum.textContent = intStr(wave);
  }
  // Chrono de la vague (§ E1.A) : secondes restantes, arrondies au-dessus (« 0:00 » seulement à zéro) ; pendant un
  // compte à rebours, la durée de la vague qu'il annonce. Réécrit quand la seconde affichée change ; l'alerte et la
  // prolongation ne changent que la classe (le clignotement est une animation CSS).
  let clock = shownState === STATE.COUNTDOWN ? waveClockSeconds(run.wave + 1) : waves.getClockCeil();
  if (clock > WAVES.clock.max) clock = WAVES.clock.max;
  if (clock !== last[L_CLOCK]) {
    last[L_CLOCK] = clock;
    clockNum.textContent = CLOCK_STR[clock];
  }
  const clockState = waves.isOvertime() ? 2 : shownState === STATE.PLAYING && clock > 0 && clock <= WAVES.clock.warnSeconds ? 1 : 0;
  if (clockState !== last[L_CLOCK_STATE]) {
    last[L_CLOCK_STATE] = clockState;
    clockChip.className = CLS_CLOCK[clockState];
    if (blocVague !== null) {
      // § E5.E.6 : crochets rouges en alerte et en prolongation ; « BOSS EN VIE » quand le boss tient le chrono à 0:00
      blocVague.className = CLS_BLOC[clockState];
      blocEtat.textContent = clockState === 2 ? HUD_BLOC.bossEnVie : '';
    }
  }
  if (palier !== null) majPalier(shownState, wave, clock);
  if (palX6Term !== null) majTerminalX6(realDt); // § E5.X6 (D5, H7)
  // Record (§ E1.D) : la vague du meilleur score (« — » sans record) ; cyan dès qu'il est battu pendant la partie.
  const best = game.best;
  const record = best ? Math.floor(best.wave) : 0;
  if (record !== last[L_RECORD]) {
    last[L_RECORD] = record;
    recordNum.textContent = record > 0 ? intStr(record) : UI.record.none;
  }
  const recordState = game.recordBeaten ? 1 : 0;
  if (recordState !== last[L_RECORD_STATE]) {
    last[L_RECORD_STATE] = recordState;
    recordChip.className = CLS_RECORD[recordState];
  }
  const frag = Math.floor(run.fragments);
  if (frag !== last[L_FRAG]) {
    last[L_FRAG] = frag;
    fragNum.textContent = intStr(frag);
  }

  // Armes possédées et leur niveau.
  // § E2.C règle 11 : emplacement k = k-ième arme obtenue (weapons.slots) ; rien n'est réécrit tant que rien ne change.
  const wslots = weapons.slots;
  for (let k = 0; k < weaponSlots.length; k++) {
    const w = wslots[k];
    const lv = w >= 0 ? weapons.getWeaponLevel(w) : 0;
    const slot = weaponSlots[k];
    const ev = w >= 0 ? evoDe(w) : -1;
    if (w !== lastSlotWeapon[k] || ev !== lastSlotEvo[k]) {
      lastSlotWeapon[k] = w;
      lastSlotEvo[k] = ev;
      lastWeaponLevel[k] = -1;
      if (comboLast[k] !== 0 && slot.combo) {
        comboLast[k] = 0; // § E5.E.7 : une autre arme dans la case : crans cachés
        slot.combo.className = CLS_COMBO_OFF;
      }
      if (w >= 0) {
        slot.use.setAttribute('href', ev >= 0 ? EVO_HREF[ev] : SLOT_HREF[w]);
        slot.slot.style.setProperty('--wc', SLOT_COLOR[w]);
        slot.slot.setAttribute('aria-label', ev >= 0 ? EVO_TITLE[ev] : SLOT_TITLE[w]); // § E5.X7 : plus de title (la bulle du jeu le remplace)
      }
    }
    if (lv !== lastWeaponLevel[k]) {
      // § E5.E.1 : la classe change avec l'arme, le passage vide ↔ possédée, ou le PALIER de couleur du niveau
      const pal = lv > 0 ? PAL_DE_NIV[lv < PAL_MAX_NIV ? lv : PAL_MAX_NIV] : -1;
      if (lastWeaponLevel[k] < 0 || pal !== lastSlotPal[k]) {
        lastSlotPal[k] = pal;
        const sigk = w === agentSignature(run.agent);
        slot.slot.className = pal < 0 ? CLS_SLOT_EMPTY : ev >= 0 ? (sigk ? CLS_SLOT_ROOT_PAL_EVO[pal] : CLS_SLOT_PAL_EVO[pal]) : sigk ? CLS_SLOT_ROOT_PAL[pal] : CLS_SLOT_PAL[pal];
      }
      if (lv > 0) slot.lv.textContent = intStr(lv);
      lastWeaponLevel[k] = lv;
    }
    // § E3.H : jauge horloge de l'arme en recharge
    // § E5.E.7 : lame de phase, katana (et marteau enchaîné, § E5.F.14) — crans du combo en cours, horloge de la pause avant le combo suivant, éclat « prêt »
    const cb = w >= 0 && lv > 0 && cbHud !== null && slot.combo ? CB_DE_ARME[w] : -1;
    if (cb >= 0 && k < CD_SLOTS) paintCd(slot.cd, k, comboCran(k, cb, slot.combo), realDt);
    else if (slot.cd && w === WEAPON.FLASH && lv > 0 && k < CD_SLOTS) {
      paintCd(slot.cd, k, weapons.frappeCran(RECHARGE.steps), realDt); // § E5.X6 (D1) : jauge horloge de la Frappe éclair
      if (REFUS_X6[0] !== x6Vu[0]) {
        // § E5.X6 (D1) : appui refusé pendant la recharge — l'icône tremble (deux noms : l'animation repart à chaque refus)
        if (x6Vu[0] >= 0 && slot.use) {
          const ic = slot.use.parentNode;
          ic.classList.remove(X6_TREMBLE[x6Vu[1] & 1]);
          x6Vu[1]++;
          ic.classList.add(X6_TREMBLE[x6Vu[1] & 1]);
        }
        x6Vu[0] = REFUS_X6[0];
      }
    } else if (slot.cd && cdMod !== null && k < CD_SLOTS) paintCd(slot.cd, k, w >= 0 && lv > 0 && cdMod.isCooldown(0, w) ? cdMod.stepOf(0, w, RECHARGE.steps) : -1, realDt); // cran entier (§ V)
  }

  // § E2.F : rangée des objets — rien n'est réécrit tant que rien ne change (objet de la case, piles, recharge).
  let puceItems = 0; // § E3.J : objets portés et piles, pour la puce CPU
  let puceStacks = 0;
  if (itemsMod !== null) {
    const islots = itemsMod.slots;
    for (let k = 0; k < itemSlots.length; k++) {
      const id = islots[k];
      const s = itemSlots[k];
      if (id >= 0) {
        puceItems++;
        puceStacks += itemsMod.slotStacks(k);
      }
      if (id !== lastItemId[k]) {
        lastItemId[k] = id;
        lastItemStacks[k] = -1;
        lastItemState[k] = -1;
        if (id >= 0) {
          s.use.setAttribute('href', ITEM_HREF[id]);
          s.slot.style.setProperty('--ic', ITEM_COLOR[id]);
          s.slot.setAttribute('aria-label', ITEM_TITLE[id]); // § E5.X7 : plus de title (la bulle du jeu le remplace)
        }
      }
      const st = id < 0 ? 2 : itemsMod.slotCharging(k) ? 1 : 0;
      if (st !== lastItemState[k]) {
        lastItemState[k] = st;
        s.slot.className = CLS_ITEM[st];
      }
      const n = id < 0 ? 0 : itemsMod.slotStacks(k);
      if (n !== lastItemStacks[k]) {
        lastItemStacks[k] = n;
        s.n.textContent = n > 0 ? intStr(n) : ''; // § E4.T.1 : une case vidée (fusion) perd le chiffre de l'objet parti
      }
      // § E3.H : jauge horloge (Pare-feu, Coque réactive, Sauvegarde, objets en mode recharge)
      if (s.cd && k < CD_SLOTS) paintCd(s.cd, CD_SLOTS + k, id < 0 ? -1 : itemsMod.slotCooldownStep(k, RECHARGE.steps), realDt); // cran entier (§ V)
    }
  }

  // § E3.J : la puce bat plus fort et plus vite avec les objets ; écrite seulement quand son cran change.
  if (hudCarte !== null) {
    const ps = puceStep(puceItems, puceStacks);
    if (ps !== last[L_PUCE]) {
      last[L_PUCE] = ps;
      paintPuce(hudCarte, ps);
    }
  }

  // Recharge du dash, bornée à [0, 1] : le bonus « Propulseurs » pris pendant la recharge raccourcit le
  // dénominateur, et P.dashCd / durée dépasse alors 1 un instant.
  const cd = player.getDashCooldown();
  ratio = cd > 0 ? 1 - P.dashCd / cd : 1;
  if (ratio < 0) ratio = 0;
  else if (ratio > 1) ratio = 1;
  const dash = Math.floor(ratio * DASH_Q + 1e-6); // arrondi en dessous : la barre n'est pleine que quand le dash est prêt
  if (dash !== last[L_DASH]) {
    last[L_DASH] = dash;
    dashFill.style.transform = SCALE_DASH[dash];
    const charging = dash < DASH_Q ? 1 : 0;
    if (charging !== last[L_CHARGING]) {
      last[L_CHARGING] = charging;
      dashRow.className = charging === 1 ? CLS_DASH_CHARGING : CLS_DASH;
    }
  }

  // Barre de vie du boss : apparaît, disparaît, ou varie d'un pas (UI.bossBarStep).
  const b = E.bossIndex;
  const boss = b >= 0 && E.maxHp[b] > 0 ? Math.ceil((E.hp[b] / E.maxHp[b]) * BOSS_Q) : -1;
  if (boss !== last[L_BOSS]) {
    if (boss < 0) bossBox.style.display = 'none';
    else {
      if (last[L_BOSS] < 0) bossBox.style.display = 'flex';
      bossFill.style.transform = SCALE_BOSS[boss > BOSS_Q ? BOSS_Q : boss];
    }
    last[L_BOSS] = boss;
  }
  // § E1.D : libellé par rang (« BOSS v2.0 »), repère du seuil d'enragement, étiquette « BOUCLIER » (drones-boucliers en vie)
  const bossRank = boss >= 0 ? bossMod.getRank() : 0;
  if (bossRank !== last[L_BOSS_RANK]) {
    last[L_BOSS_RANK] = bossRank;
    if (bossRank > 0) {
      bossName.textContent = bossRank < BOSS_NAMES.length ? BOSS_NAMES[bossRank] : bossNomRang(bossRank);
      const en = bossMod.getEnragePercent();
      bossTickEnrage.style.display = en > 0 && en < 100 ? 'block' : 'none';
      if (en > 0 && en < 100) bossTickEnrage.style.left = PERCENT[en];
    }
  }
  const bossShield = boss >= 0 && E.bossShield > 0 ? 1 : 0;
  if (bossShield !== last[L_BOSS_SHIELD]) {
    last[L_BOSS_SHIELD] = bossShield;
    bossBox.className = CLS_BOSS[bossShield];
  }

  updateArrows();
  updateBeacon();
  updateCarrierBeacons(); // § E2.C
  if (screen === SCREEN.CHEST) updateChest(realDt); // § E2.C : roulette (état CHEST, hors combat)
}

export function inspect(out) {
  out.screen = screen;
  out.hudVisible = hudVisible;
  out.countdown = countdown;
  out.banner = bannerText;
  out.bannerQueue = queueLen;
  out.arrows = arrowsShown;
  out.beacon = beaconShown; // flèche cyan de la capsule de ravitaillement affichée (§ E1.C)
  out.beaconPx = beaconShown ? [beaconLast[0], beaconLast[1], beaconLast[2]] : null;
  // § E2.C
  out.carrierArrows = carriersShown;
  out.carrierArrowPx = carriersShown > 0 ? [carrierLast[0], carrierLast[1], carrierLast[2]] : null;
  out.chest = { stage: chestStage, ready: chestReady, serial: chestSerial, time: CHEST_T[0], stops: chestStops, frags: chestFragsPlayed, big: chestBox ? chestBox.classList.contains('sr-chest-big') : false, cards: lotCards.filter((c) => c.card.style.display !== 'none').length }; // § E3.A : stops, frags, big, cards
  out.clock = last[L_CLOCK]; // secondes affichées par la pastille du chrono (−1 : pas encore écrite)
  out.clockText = last[L_CLOCK] >= 0 ? CLOCK_STR[last[L_CLOCK]] : '';
  out.clockState = last[L_CLOCK_STATE]; // 0 normal, 1 alerte, 2 prolongation
  // § E1.D
  out.record = last[L_RECORD]; // vague affichée par la pastille du record (0 = « — »)
  out.recordText = recordNum ? recordNum.textContent : '';
  out.recordNew = last[L_RECORD_STATE] === 1;
  out.bossName = bossName ? bossName.textContent : '';
  out.bossShielded = last[L_BOSS_SHIELD] === 1;
  out.bossEnrageTick = bossTickEnrage && bossTickEnrage.style.display !== 'none' ? bossTickEnrage.style.left : '';
  // § E2.D
  out.agentScreen = screen === SCREEN.AGENT ? agentsInspect() : null; // Écran Agents (tâche 5)
  out.parallax = { off: plxOff, px: [PLX[4], PLX[5], PLX[6], PLX[7], PLX[8], PLX[9]], scale: plxScale };
  out.banishArmed = banishArmed;
  out.puceStep = last[L_PUCE]; // § E3.J : cran de la puce CPU (−1 : pas encore écrit ; 0 … UI_CARTE.puce.steps)
  out.choiceCounters = [levelCounts[0], levelCounts[1], levelCounts[2]];
  out.fusion = fusionBox ? { stage: fusionBox.dataset.stage || '', name: fusionName.textContent, skip: fusionBox.classList.contains('sr-fusion-skip'), first: fusionNew.style.display !== 'none', hints: bonusCards.map((c) => (c.fuse && c.fuse.style.display !== 'none' ? c.fuse.textContent : '')) } : null; // § E3.F
}

// ----- § E3.C : rangée des effets à durée des utilitaires (bloc du chantier C) ---------------------------------------
// Une pastille FUI par effet à durée (icône pixel de l'utilitaire, nom, secondes, barre qui se vide), affichée tant
// que l'effet court ; classe sr-hud-effects, placée par CSS (J pourra la déplacer dans sa mise en page). Écriture au
// DOM seulement quand la valeur affichée change (§ E3.0.5 règle 2).
const EFFECT_IDS = [UTIL.STUN, UTIL.TURBO, UTIL.COMPUTE];
const effects = [];
const effectLast = new Int32Array(EFFECT_IDS.length * 2).fill(-1); // [dixièmes affichés, part de barre en %] par effet
let effectsBox = null;
let effectLeft = null;
let effectTenths = null; // § E3.C (fusion du groupe 1) : dixièmes restants, entiers tenus par utilities.update
let effectPct = null;
const EFFECT_LOW_TENTHS = Math.round(UTILITIES.hud.lowSeconds * 10);

function buildEffects(parent) {
  const util = ctx.utilities || null;
  if (util === null) return;
  effectLeft = util.LEFT;
  effectTenths = util.TENTHS;
  effectPct = util.PCT;
  const sprite = document.createElementNS(SVG_NS, 'svg');
  sprite.setAttribute('class', 'sr-sprite');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.innerHTML = Object.keys(UTILITY_ICONS).map((id) => symbolePixel(id, UTILITY_ICONS[id])).join('');
  root.appendChild(sprite);
  effectsBox = el('div', 'sr-hud-effects');
  for (let k = 0; k < EFFECT_IDS.length; k++) {
    const u = UTILITIES.list[EFFECT_IDS[k]];
    const chipEl = el('div', 'sr-effect');
    chipEl.style.setProperty('--sr-ef', hex(u.color));
    chipEl.style.display = 'none';
    const ic = icon('sr-u-' + u.key);
    const label = el('span', 'sr-effect-name', u.name);
    const num = el('span', 'sr-effect-s sr-num', '');
    const bar = el('div', 'sr-effect-bar');
    const fill = el('div', 'sr-effect-fill');
    bar.appendChild(fill);
    chipEl.append(ic, label, num, bar);
    effectsBox.appendChild(chipEl);
    effects.push({ chipEl, num, fill, id: EFFECT_IDS[k] });
  }
  parent.appendChild(effectsBox);
}

function updateEffects() {
  if (effectsBox === null) return;
  // fusion du groupe 1 : seulement des entiers (utilities.TENTHS / PCT) — rien n'est emballé quand rien ne change
  const TEN = effectTenths;
  for (let k = 0; k < effects.length; k++) {
    const f = effects[k];
    const tenths = TEN[f.id];
    const o = k * 2;
    if (tenths === effectLast[o]) continue;
    const was = effectLast[o];
    effectLast[o] = tenths;
    if (tenths === 0) {
      f.chipEl.style.display = 'none';
      continue;
    }
    if (was <= 0) f.chipEl.style.display = '';
    f.num.textContent = (tenths / 10).toFixed(1) + ' s';
    const pct = effectPct[f.id];
    if (pct !== effectLast[o + 1]) {
      effectLast[o + 1] = pct;
      f.fill.style.transform = 'scaleX(' + pct / 100 + ')';
    }
    const low = tenths <= EFFECT_LOW_TENTHS;
    if (f.chipEl.classList.contains('sr-low') !== low) f.chipEl.classList.toggle('sr-low', low);
  }
}

// ===== Plan addictif, étape 3, chantier F (§ E3.F) : le moment de fusion ===============================================
// En pause (état FUSION) : les deux cases d'objet glissent l'une vers l'autre, se rejoignent dans la puce CPU (qui pulse
// fort, éclair blanc), puis la carte de l'objet né (rareté Noyau) apparaît. Animations CSS sur l'horloge réelle, durées
// tirées de FUSION_SCREEN (variables posées une fois à l'init) ; construit une fois, rempli à chaque fusion (hors combat).
let fusionBox = null;
let fusionTitle, fusionName, fusionCaseA, fusionCaseB, fusionNameA, fusionNameB, fusionUse, fusionRule, fusionKeeps, fusionNew, fusionSlot;

function buildFusion() {
  const F = FUSION_SCREEN;
  const scr = el('div', 'sr-screen sr-fusion');
  const rs = scr.style;
  rs.setProperty('--sr-fu-slide', F.slideSeconds + 's');
  rs.setProperty('--sr-fu-merge', F.mergeSeconds + 's');
  rs.setProperty('--sr-fu-card', F.cardSeconds + 's');
  rs.setProperty('--sr-fu-rc', hex(RARITIES[RARITY.NOYAU].color));
  rs.setProperty('--sr-fu-path', JSON.stringify(F.path)); // surtitre du thème carte mère (h2::before)
  const head = el('div', 'sr-levelup-head sr-fusion-head');
  fusionTitle = el('h2', 'sr-fusion-title', '');
  fusionTitle.append(el('span', 'sr-fusion-kicker', F.kicker));
  fusionName = el('span', 'sr-fusion-name', '');
  fusionTitle.appendChild(fusionName);
  head.append(el('p', 'sr-chest-path', F.path), fusionTitle, el('p', 'sr-lead', F.lead));
  scr.appendChild(head);

  const stage = el('div', 'sr-fusion-stage');
  //#region e5:AL-retrait-cryogel
  // icônes de départ (remplacées à chaque fusion) = Virus + Surchauffe, le Cryogel est retiré
  const a = caseSlot('objet', 'sr-case sr-case-objet sr-fusion-a', 'sr-m-virus');
  const b = caseSlot('objet', 'sr-case sr-case-objet sr-fusion-b', 'sr-m-burn');
  //#endregion e5:AL-retrait-cryogel
  fusionCaseA = a;
  fusionCaseB = b;
  fusionNameA = el('span', 'sr-fusion-ing', '');
  fusionNameB = el('span', 'sr-fusion-ing', '');
  a.root.appendChild(fusionNameA);
  b.root.appendChild(fusionNameB);
  const p = puce('sr-fusion-puce');
  initPuce(p.root);
  paintPuce(p.root, UI_PUCE_MAX);
  const flash = el('div', 'sr-fusion-flash');
  stage.append(el('div', 'sr-fusion-trace'), a.root, p.root, b.root, flash);
  scr.appendChild(stage);

  const card = el('div', 'sr-card sr-facet sr-card-item sr-fusion-card');
  card.style.setProperty('--rc', hex(RARITIES[RARITY.NOYAU].color));
  const top = el('div', 'sr-card-top');
  const ic = icon('sr-m-orage');
  fusionUse = ic.firstChild;
  top.appendChild(ic);
  fusionNew = el('span', 'sr-fusion-new', F.discovered);
  top.appendChild(fusionNew);
  const tag = el('div', 'sr-card-tag', CHOICES.itemText.tag + ' · ' + rareteTexte(RARITY.NOYAU)); // § E5.L (C18)
  const name = el('div', 'sr-card-name', '');
  fusionRule = el('div', 'sr-card-desc', '');
  fusionKeeps = el('div', 'sr-fusion-keeps', '');
  fusionSlot = el('div', 'sr-fusion-slot', F.slotFreed);
  card.append(top, tag, name, fusionRule, fusionKeeps, fusionSlot);
  card._name = name;
  // enveloppe animée : la carte garde l'animation d'ouverture du thème (cy-ouvre), l'enveloppe la cache jusqu'à son tour
  const wrap = el('div', 'sr-fusion-cardwrap');
  wrap.appendChild(card);
  scr.appendChild(wrap);
  const foot = el('div', 'sr-chest-foot sr-fusion-foot');
  foot.appendChild(button(F.close, 'sr-btn', () => actions.closeFusion(), '@valider'));
  scr.appendChild(foot);
  scr._card = card;
  fusionBox = scr;
  addScreen(SCREEN.FUSION, scr);
}
const UI_PUCE_MAX = UI_CARTE.puce.steps; // § E3.F : la puce au cran le plus haut pendant le moment de fusion

function fillFusion(d) {
  setText(fusionName, d.name);
  fusionCaseA.use.setAttribute('href', '#' + d.a.icon);
  fusionCaseB.use.setAttribute('href', '#' + d.b.icon);
  setText(fusionCaseA.n, '×' + d.a.stacks);
  setText(fusionCaseB.n, '×' + d.b.stacks);
  setText(fusionNameA, d.a.name);
  setText(fusionNameB, d.b.name);
  fusionUse.setAttribute('href', '#' + d.icon);
  setText(fusionBox._card._name, d.name);
  setText(fusionRule, d.rule);
  setText(fusionKeeps, FUSION_SCREEN.keeps + ' ' + d.a.name + ' (×' + d.a.stacks + ') et ' + d.b.name + ' (×' + d.b.stacks + ').');
  fusionNew.style.display = d.first ? '' : 'none';
  // relance des animations SANS lecture de mise en page (règle de ui.js, ui.test — fusion du groupe 2) : la classe de
  // lecture est posée, puis chaque animation CSS déjà en cours (2e fusion d'affilée, écran resté affiché) repart de 0.
  // Écran masqué : aucune animation en cours, elles partent d'elles-mêmes quand il s'affiche.
  fusionBox.classList.remove('sr-fusion-skip');
  fusionBox.classList.add('sr-fusion-play');
  const anims = typeof fusionBox.getAnimations === 'function' ? fusionBox.getAnimations({ subtree: true }) : null;
  if (anims !== null) for (let i = 0; i < anims.length; i++) anims[i].currentTime = 0;
  fusionBox.dataset.stage = 'play';
}

/** Entrée (dès la 2e fusion de la partie) : l'animation saute à la carte de l'objet né. */
export function skipFusion() {
  if (fusionBox === null) return;
  fusionBox.classList.add('sr-fusion-skip');
  fusionBox.dataset.stage = 'skip';
}

// ===== § E3.I — écran de pause : fiche d'un élément, panneaux repliés, portrait 3D (bloc du chantier I) ===============
// Tout est construit une fois (buildPause) ; les écritures ont lieu au clic ou à l'ouverture de la pause (hors combat :
// chaînes et lectures de mise en page permises). Échap : main.js appelle pauseBack() avant resume().
import { PAUSE } from './config.js'; // § E3.I (import remonté par le module)
import { cartouche } from './ui-carte.js'; // § E3.I
let ficheCanvas3d = null; // <canvas> 2D du portrait 3D (src/pause-agent.js y recopie le rendu)
let fichePortraitBox = null;
const plis = []; // { btn, box } : « Paramètres », « Touches »
let detailBox = null;
let detailIcon, detailGenre, detailNom, detailRarete, detailNiv, detailEffet, detailRecharge, detailEvo, detailEvoLab;
let detailEvoVal, detailRecette, detailFormule; // 21/11 : recette en formule à icônes (src/ui-recette.js)
let detailAction; // § E4.G : ligne « Action » (fenêtre d'action, niveau actuel → suivant)
const detailLignes = []; // { row, lab, val, niv }
const DETAIL_LIGNES = 6;
// élément affiché : genre (0 aucun, 1 arme, 2 objet, 3 bonus) et indice de la case cliquée
const detailEtat = new Int32Array(2);
// (20/11) boîte ouverte AU SURVOL (souris) : elle n'est pas une étape de navigation — Échap la ferme ET fait son
// travail habituel (fiche → menu, menu → reprise) ; ouverte au toucher, Échap la ferme seulement
let detailSurvol = false;
const D_ARME = 1;
const D_OBJET = 2;
const D_BONUS = 3;

/** img1 : deux boutons repliés ; chaque bouton ouvre son panneau (un seul ouvert à la fois). */
function buildPlis(panel, reglages, touches) {
  const barre = el('div', 'sr-plis');
  const corps = [];
  const ajoute = (label, cls, remplir) => {
    const box = el('div', 'sr-pli ' + cls);
    box.style.display = 'none';
    remplir(box);
    const i = plis.length;
    // § E5.AG (Femz, 22/11) : label null = panneau sans bouton (bloc des touches en carte mère, déplacé par buildParam)
    const btn = label ? button(label, 'sr-btn sr-pli-btn', click(() => togglePli(i))) : null;
    plis.push({ btn, box });
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      barre.appendChild(btn);
    }
    corps.push(box);
  };
  ajoute('Paramètres', 'sr-pli-reglages', reglages);
  ajoute(CARTE ? null : 'Touches', 'sr-pli-touches', touches);
  panel.appendChild(barre);
  for (const b of corps) panel.appendChild(b);
}

function togglePli(i) {
  if (CARTE) return paramOuvrir(i === 0 ? 0 : 2); // § E5.R : Paramètres → Général, Touches → Commandes
  annulerAttente(); // § E4.D
  for (let k = 0; k < plis.length; k++) {
    const open = k === i && plis[k].box.style.display === 'none';
    plis[k].box.style.display = open ? '' : 'none';
    plis[k].btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    plis[k].btn.classList.toggle('sr-on', open);
    // § E4.D : « Touches » ouvert, la fenêtre s'élargit et la colonne Reprendre / Recommencer / Menu se replie
    if (plis[k].box.classList.contains('sr-pli-touches') && pausePanel) pausePanel.classList.toggle('sr-touches-on', open);
  }
  if (plis[i] && plis[i].box.classList.contains('sr-pli-touches')) majTouches();
}

function closePlis() {
  if (CARTE) return paramFermer(); // § E5.R : les replis sont la fenêtre Paramètres (le bloc des touches y vit)
  annulerAttente(); // § E4.D
  if (pausePanel) pausePanel.classList.remove('sr-touches-on');
  let n = 0;
  for (const p of plis) {
    if (p.box.style.display !== 'none') n++;
    p.box.style.display = 'none';
    p.btn.setAttribute('aria-expanded', 'false');
    p.btn.classList.remove('sr-on');
  }
  return n > 0;
}

/** Ligne « Évolution » d'une arme : la recette en formule à icônes si elle est connue, sinon le texte (« ? »). */
function remplirRecette(w, h) {
  const idR = evolutionDeArme(w);
  const connue = idR >= 0 && typeof h === 'string' && h !== '' && h !== EVOLUTION_RULES.hidden;
  if (!connue) {
    evoTexte(typeof h === 'string' && h ? h : h && h.texte ? h.texte : '?');
    return;
  }
  detailFormule.poser(recetteEvolution(idR));
  if (detailEvo.lastChild !== detailRecette) detailEvo.replaceChild(detailRecette, detailEvoVal);
  detailEvo.classList.add('sr-evo-formule');
}
/** Ligne « Évolution / Fusion » en texte simple. */
function evoTexte(t) {
  if (detailEvo.lastChild !== detailEvoVal) detailEvo.replaceChild(detailEvoVal, detailRecette);
  detailEvo.classList.remove('sr-evo-formule');
  setText(detailEvoVal, t);
}
/** § E5.W : fusion f en formule à icônes dans la ligne « Fusion » / « Ingrédients » (même formule que remplirRecette). */
function remplirFusion(f) {
  detailFormule.poser(recetteFusion(f));
  if (detailEvo.lastChild !== detailRecette) detailEvo.replaceChild(detailRecette, detailEvoVal);
  detailEvo.classList.add('sr-evo-formule');
}

/** La fenêtre d'un élément (cadre de la fiche, cartouches de J), cachée ; les cases de la fiche s'y branchent. */
function buildDetail(pause) {
  detailBox = el('div', 'sr-detail sr-facet');
  detailBox.setAttribute('role', 'dialog');
  detailBox.style.display = 'none';
  const tete = el('div', 'sr-detail-tete');
  const ic = icon('sr-w0');
  detailIcon = ic.firstChild;
  const titres = el('div', 'sr-detail-titres');
  detailGenre = el('div', 'sr-detail-genre', '');
  detailNom = el('h3', 'sr-detail-nom', '');
  titres.append(detailGenre, detailNom);
  tete.append(ic, titres);
  const puces = el('div', 'sr-detail-puces');
  detailRarete = cartouche('RARETÉ', 'sr-detail-rarete');
  detailNiv = cartouche('NIV.', 'sr-detail-niv');
  puces.append(detailRarete.root, detailNiv.root);
  const lignes = el('div', 'sr-detail-lignes');
  for (let k = 0; k < DETAIL_LIGNES; k++) {
    const row = el('div', 'sr-detail-ligne');
    const lab = el('span', 'sr-detail-lab', '');
    const val = el('span', 'sr-detail-val sr-num', '');
    const niv = el('span', 'sr-detail-pips sr-num', '');
    row.append(lab, val, niv);
    lignes.appendChild(row);
    detailLignes.push({ row, lab, val, niv });
  }
  detailEffet = el('p', 'sr-detail-effet', '');
  detailRecharge = el('div', 'sr-detail-ligne sr-detail-recharge');
  detailRecharge.append(el('span', 'sr-detail-lab', 'Recharge'), el('span', 'sr-detail-val sr-num', ''));
  detailAction = el('div', 'sr-detail-ligne sr-detail-recharge sr-detail-action'); // § E4.G
  detailAction.append(el('span', 'sr-detail-lab', TEXTES_N.actif), el('span', 'sr-detail-val sr-num', '')); // § E4.N.2
  detailEvo = el('div', 'sr-detail-evo');
  detailEvoLab = el('span', 'sr-detail-lab', 'Évolution');
  detailEvoVal = el('span', 'sr-detail-val', '?');
  // recette connue d'une arme : [icône] arme + [icône] ingrédient / → [icône] évolution (textContent = la phrase entière,
  // « Blaster + Viseur thermique → Canon chiffré », que lisent les tests)
  detailFormule = creerFormule('sr-detail-val sr-evo-recette');
  detailRecette = detailFormule.racine;
  detailEvo.append(detailEvoLab, detailEvoVal);
  detailBox.append(tete, puces, lignes, detailEffet, detailRecharge, detailAction, detailEvo);
  // posée DANS la fiche, à sa droite, par le CSS (ui.css, « .sr-fiche > .sr-detail ») : aucune lecture de mise en page
  // (règle de ui.js, ui.test) — fusion du groupe 2 : placeDetail mesurait fiche et écran par getBoundingClientRect
  const ficheEl = pause.querySelector('.sr-fiche');
  (ficheEl || pause).appendChild(detailBox);
  // cases de la fiche (20/11, Femz) : les infos s'ouvrent AU SURVOL, dans une boîte près du curseur (placerDetail),
  // et se ferment quand le curseur quitte la case. Le clic reste pour le tactile (pas de survol) : il ouvre, ou
  // referme si c'est la même case ; la boîte est alors posée au point touché.
  const brancher = (cell, genre, k) => {
    cell.dataset.detail = genre + ':' + k;
    cell.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      detailSurvol = true;
      if (detailEtat[0] !== genre || detailEtat[1] !== k) toggleDetail(genre, k);
      placerDetail(e);
    });
    cell.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch' && detailEtat[0] === genre && detailEtat[1] === k) placerDetail(e);
    });
    cell.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch' && detailEtat[0] === genre && detailEtat[1] === k) closeDetail();
    });
    cell.addEventListener('click', (e) => {
      if (e.pointerType && e.pointerType !== 'touch') return; // souris : le survol a déjà tout fait
      // ouverture : UI_OPEN (contrat § E3.0.7, branché à la fusion du groupe 2) ; même case = fermeture : le clic
      audio.play(detailEtat[0] === genre && detailEtat[1] === k ? SFX.UI_CLICK : SFX.UI_OPEN);
      detailSurvol = false;
      toggleDetail(genre, k);
      placerDetail(e);
    });
  };
  for (let k = 0; k < ficheArmes.length; k++) if (ficheArmes[k]) brancher(ficheArmes[k].cell, D_ARME, k);
  for (let k = 0; k < ficheObjets.length; k++) brancher(ficheObjets[k].cell, D_OBJET, k);
  for (let k = 0; k < ficheBonus.length; k++) brancher(ficheBonus[k].cell, D_BONUS, k);
  // clic hors de la fenêtre (et hors d'une case de la fiche, qui gère le sien) : fermée, la partie reste en pause
  pause.addEventListener('pointerdown', fermerDetailDehors);
}

/** Clic hors de la fenêtre d'un élément (et hors d'une case de la fiche) : fermée. Pause et Noyau (§ E4.L.1). */
function fermerDetailDehors(e) {
  if (detailEtat[0] === 0) return;
  const t = e.target;
  if (detailBox.contains(t) || (t.closest && t.closest('[data-detail]'))) return;
  closeDetail();
}

/**
 * (20/11) Boîte d'infos près du curseur : coin collé au curseur (décalé de 1 rem), du côté où il reste de la place —
 * à gauche du curseur dans la moitié droite de l'écran ; en hauteur, elle glisse selon la place du curseur dans le
 * cadre (--py) : elle reste entre 10 % et 90 % de la hauteur, jamais coupée (ui-pile.css). Aucune
 * lecture de mise en page : seulement la position du pointeur et la taille de la fenêtre.
 */
function placerDetail(e) {
  if (!detailBox || detailEtat[0] === 0 || !Number.isFinite(e.clientX)) return;
  detailBox.classList.add('sr-detail-curseur');
  // cadre : l'écran. Au Noyau la boîte est sur l'écran du hub (placerFiche), hors des calques transformés : ses
  // coordonnées fixes sont celles du pointeur
  const W = window.innerWidth, H = window.innerHeight, m = 0.1 * H; // marge haute et basse du cadre
  detailBox.classList.toggle('sr-detail-g', e.clientX > W / 2);
  // position du curseur dans le cadre (de la marge haute à la marge basse), de 0 à 1 : voir ui-pile.css
  const py = Math.min(1, Math.max(0, (e.clientY - m) / Math.max(1, H - 2 * m)));
  detailBox.style.setProperty('--py', py.toFixed(3));
  detailBox.style.left = e.clientX + 'px';
  detailBox.style.top = e.clientY + 'px';
}

function toggleDetail(genre, k) {
  if (detailEtat[0] === genre && detailEtat[1] === k) {
    closeDetail();
    return;
  }
  if (!fillDetail(genre, k)) {
    closeDetail(); // case vide : rien à montrer
    return;
  }
  detailEtat[0] = genre;
  detailEtat[1] = k;
  detailBox.style.display = '';
  ficheEl.classList.add('sr-detail-ouvert'); // 16/11, point 2 (écran étroit)
  const cells = ficheEl.querySelectorAll('[data-detail]'); // § E4.L.1 : la fiche peut être au Noyau
  const cle = genre + ':' + k;
  for (const c of cells) c.classList.toggle('sr-detail-on', c.dataset.detail === cle);
}

function closeDetail() {
  if (!detailBox || detailEtat[0] === 0) return false;
  detailEtat[0] = 0;
  detailEtat[1] = -1;
  detailBox.style.display = 'none';
  ficheEl.classList.remove('sr-detail-ouvert');
  const cells = ficheEl.querySelectorAll('.sr-detail-on');
  for (const c of cells) c.classList.remove('sr-detail-on');
  return true;
}


function detailLigne(k, lab, val, niv) {
  const L = detailLignes[k];
  L.row.style.display = '';
  setText(L.lab, lab);
  setText(L.val, val);
  setText(L.niv, niv);
}

function detailRareteSet(nom, couleur) {
  setText(detailRarete.value, rangRarete(nom)); // § E5.L (C18) : « Optimisé · rareté 3/6 »
  detailBox.style.setProperty('--dc', couleur);
}

/** Total d'un bonus à k piles, mis en forme (PAUSE.bonusFormat). */
function bonusTotal(b, k) {
  const v = b.op === 'mul' ? Math.pow(b.value, k) : b.value * k;
  const f = PAUSE.bonusFormat[b.key] || 'pct';
  if (f === 'pv') return '+' + formatValue(v) + ' PV';
  if (f === 'pvs') return '+' + formatValue(v) + ' PV/s';
  if (f === 'pctNeg') return '−' + formatValue((1 - v) * 100) + ' %';
  return '+' + formatValue(v * 100) + ' %';
}

/**
 * § E4.G : lignes « Recharge » et « Action » de la fiche, valeur actuelle → valeur à la prochaine amélioration
 * (« 7,0 s → 6,8 s ») ; une seule valeur au niveau le plus haut (max > 0) ou quand rien ne bouge plus. Hors combat.
 */
function fillSalves(kind, id, n, max) {
  const R = ctx.cooldowns;
  const n1 = max > 0 && n >= max ? n : n + 1;
  const fmt = (v) => formatValue(Math.round(v * 10) / 10) + (Math.round(v * 10) % 10 === 0 ? ',0' : '') + ' s';
  const r0 = fmt(R.rechargeAt(kind, id, n));
  const r1 = fmt(R.rechargeAt(kind, id, n1));
  const a0 = fmt(R.actionAt(kind, id, n));
  const a1 = fmt(R.actionAt(kind, id, n1));
  detailRecharge.style.display = '';
  detailAction.style.display = '';
  setText(detailRecharge.lastChild, r0 === r1 ? r0 : r0 + ' → ' + r1);
  setText(detailAction.lastChild, a0 === a1 ? a0 : a0 + ' → ' + a1);
}

/** Remplit la fenêtre ; faux si la case est vide. Valeurs ACTUELLES lues dans l'état (weapons, items, progression). */
/**
 * (20/11, Femz) Niveau (arme) ou piles (objet, amélioration) en haut à droite de la boîte d'infos, sans cadre, le
 * chiffre à la couleur de son PALIER (HUD_PALIERS : la même échelle que le contour des armes du HUD — gris 1-3, vert
 * 4-6, bleu 7-9, violet, jaune, orange, rouge 19-21) ; data-genre laisse le CSS n'afficher « NIV. » que pour une arme.
 */
const GENRES_DETAIL = ['', 'arme', 'objet', 'bonus'];
function couleurNiveau(genre, n) {
  const p = n >= 1 ? PAL_DE_NIV[Math.min(n, PAL_MAX_NIV)] : 0;
  detailBox.style.setProperty('--nc', n >= 1 ? HUD_PALIERS[p].couleur : 'var(--pile-gris, #8ea69a)');
  detailBox.dataset.genre = GENRES_DETAIL[genre];
}

function fillDetail(genre, k) {
  for (const L of detailLignes) L.row.style.display = 'none';
  detailRecharge.style.display = 'none';
  detailAction.style.display = 'none';
  detailEvo.style.display = 'none';
  detailNiv.root.style.display = '';
  detailRarete.root.style.display = '';
  if (genre === D_ARME) {
    const w = k < weapons.slots.length ? weapons.slots[k] : -1;
    if (w < 0) return false;
    const W = WEAPONS[w];
    const sig = agentSignature(run.agent) === w;
    const evo = evoDe(w); // 21/11 : arme évoluée — son nom, son icône, l'étiquette et la pastille dorées
    setText(detailGenre, evo >= 0 ? (sig ? EVOLUTION_UI.genreSig : EVOLUTION_UI.genre) : sig ? 'ARME · SIGNATURE' : 'ARME');
    setText(detailNom, evo >= 0 ? EVOLUTIONS[evo].name : W.name);
    detailIcon.setAttribute('href', hrefArme(w));
    // 16/11, point 4 : « ARME » n'est pas une rareté — la signature est Root (comme sa case du HUD, CLS_SLOT_ROOT) ;
    // une arme de coffre a la rareté de son lot (chests.weaponRarity) ; sinon (debug) : pas de pastille de rareté
    const rr = sig ? 5 : ctx.chests && ctx.chests.weaponRarity ? ctx.chests.weaponRarity(w) : -1;
    detailRarete.root.style.display = rr >= 0 || evo >= 0 ? '' : 'none';
    if (evo >= 0) detailRareteSet(EVOLUTION_UI.rarete, EVOLUTION_UI.couleur);
    else if (rr >= 0) detailRareteSet(RARITIES[rr].name, hexColor(RARITIES[rr].color));
    else detailBox.style.setProperty('--dc', SLOT_COLOR[w]);
    setText(detailNiv.label, 'NIV.');
    const oc = weapons.getOvercharge ? weapons.getOvercharge(w) : 0;
    setText(detailNiv.value, String(weapons.getWeaponLevel(w)) + (oc > 0 ? ' +' + oc : ''));
    couleurNiveau(D_ARME, weapons.getWeaponLevel(w));
    const labs = W.statLabels || [];
    const units = W.statUnits || [];
    const Rc = ctx.cooldowns;
    const cdW = Rc && Rc.isCooldown(Rc.KIND_WEAPON, w) ? RECHARGES.weapons[WEAPON_KEYS[w]] : null;
    const cache = cdW && cdW.hideStat >= 0 ? cdW.hideStat : -1; // § E4.G : « Durée » du canon lourd = la ligne Action
    for (let s = 0; s < STAT_COUNT && s < DETAIL_LIGNES; s++) {
      if (!labs[s] || s === cache) continue;
      const u = units[s] || '';
      detailLigne(s, labs[s], formatValue(weapons.getStat(w, s)) + (u ? (u.charCodeAt(0) === 47 ? '' : ' ') + u : ''), weapons.getLevel(w, s) + '/' + STAT_MAX_LEVEL);
    }
    const effet = cdW ? (W.detail || W.desc || '') + '\n' + RECHARGE.texteEffet : W.detail || W.desc || ''; // § E4.N.2 : l'explication longue // § E4.G : l'effet, puis les chiffres
    setText(detailEffet, evo >= 0 ? EVOLUTIONS[evo].rule + '\n' + effet : effet); // 21/11 : d'abord ce que l'évolution ajoute
    // recharge (chantier H, branchée à la fusion du groupe 2 : le module s'appelle ctx.cooldowns, pas ctx.recharges) :
    // seulement si l'arme est une source à recharge ; durée au niveau courant (cooldowns.durationOf, jamais sous min)
    const R = ctx.cooldowns;
    if (R && R.isCooldown(R.KIND_WEAPON, w)) {
      fillSalves(R.KIND_WEAPON, w, weapons.getWeaponLevel(w), 21); // § E4.G : niveau actuel → suivant (21 = le plus haut)
    }
    // évolution (chantier B) : « ? » tant que la recette n'est pas découverte ; faite : « Évoluée » + la recette
    const Ev = ctx.evolutions;
    const h = Ev && typeof Ev.hintFor === 'function' ? Ev.hintFor(w) : null;
    detailEvo.style.display = '';
    setText(detailEvoLab, evo >= 0 ? EVOLUTION_UI.faite : 'Évolution');
    remplirRecette(w, h);
    return true;
  }
  if (genre === D_OBJET) {
    const id = itemsMod ? itemsMod.slots[k] : -1;
    if (id < 0) return false;
    detailIcon.setAttribute('href', ITEM_HREF[id]);
    const piles = itemsMod.slotStacks(k);
    setText(detailNiv.label, 'PILES');
    setText(detailNiv.value, '×' + piles);
    couleurNiveau(D_OBJET, piles);
    if (id < ITEM_COUNT) {
      const I = ITEMS[id];
      setText(detailGenre, 'OBJET');
      setText(detailNom, I.name);
      detailRareteSet(RARITIES[I.tier].name, ITEM_COLOR[id]);
      detailLigne(0, I.what, itemText(id, itemsMod.getStacks(id)), '');
      setText(detailEffet, I.pile ? (I.detail || I.desc) + '\n' + I.pile : I.detail || I.desc); // § E4.N.2 // 16/11 (13b)
      const Ri = ctx.cooldowns; // § E4.G : objet en mode recharge — l'effet, puis Recharge et Action (pile actuelle → suivante)
      if (Ri && Ri.isCooldown(Ri.KIND_ITEM, id)) {
        setText(detailEffet, (I.pile ? (I.detail || I.desc) + '\n' + I.pile : I.detail || I.desc) + '\n' + RECHARGE.texteEffet);
        fillSalves(Ri.KIND_ITEM, id, itemsMod.getStacks(id), 0);
      }
      // fusion (chantier F) : l'autre ingrédient et la fusion en « ? » tant qu'elle n'est pas découverte
      // (fusion du groupe 2 : ctx.meta = src/meta.js, posé par main.js — ui.js n'importe que config, state, ui-carte —,
      // et la clé est 'fusions', pas 'fusion')
      for (let f = 0; f < FUSIONS.length; f++) {
        const F = FUSIONS[f];
        if (F.a !== id && F.b !== id) continue;
        //#region e5:AL-retrait-cryogel
        if (F.enabled === false) continue; // fusion fermée (Orage glacé, Cryogel retiré) : pas annoncée
        //#endregion e5:AL-retrait-cryogel
        const vu = ctx.meta ? ctx.meta.isDiscovered('fusions', f) : false;
        detailEvo.style.display = '';
        setText(detailEvoLab, 'Fusion');
        if (vu) remplirFusion(f); // § E5.W : [objet a] + [objet b] → [objet né], en icônes
        else evoTexte('?');
        break;
      }
    } else {
      const F = FUSIONS[id - ITEM_COUNT];
      setText(detailGenre, 'OBJET · FUSION');
      setText(detailNom, F.name);
      detailRareteSet(RARITIES[4].name, ITEM_COLOR[id]);
      detailEvo.style.display = ''; // § E5.W : les ingrédients en formule à icônes (était une ligne « Ingrédients » en phrase)
      setText(detailEvoLab, 'Ingrédients');
      remplirFusion(id - ITEM_COUNT);
      setText(detailEffet, F.rule || '');
    }
    return true;
  }
  if (genre === D_BONUS) {
    const fb = ficheBonus[k];
    if (!fb) return false;
    const b = PROGRESSION.bonuses[k];
    const n = progressionMod ? progressionMod.getStacks(b.id) : 0;
    setText(detailGenre, 'STATISTIQUE');
    setText(detailNom, b.name);
    detailIcon.setAttribute('href', BONUS_ICONS[b.key] === 1 ? '#sr-b-' + b.key : '#sr-b-default');
    // 16/11, point 4 : une statistique n'a pas de rareté (« Système » n'en est pas une) — pas de pastille
    detailRarete.root.style.display = 'none';
    detailBox.style.setProperty('--dc', 'var(--ca-bord, #74e09a)');
    setText(detailNiv.label, 'PILES');
    setText(detailNiv.value, n + '/' + b.maxStacks);
    couleurNiveau(D_BONUS, n);
    detailLigne(0, 'Par niveau', b.desc, ''); // § E4.N.2 (« Par pile » avant)
    detailLigne(1, 'Total actuel', n > 0 ? bonusTotal(b, n) : '—', '');
    setText(detailEffet, b.effet || ''); // 16/11 (13b) : à quoi sert la statistique
    return true;
  }
  return false;
}

/** Ouverture de la pause : fenêtre et panneaux refermés ; libellé de niveau remis (une fenêtre d'objet le change). */
function pauseReset(data) {
  for (let i = 0; i < desarmes.length; i++) desarmes[i](); // § E5.S (A6)
  annulerAttente(); // § E4.D
  closeDetail();
  closePlis();
  // menus « Pile » : Échap ouvre le menu, Tab la fiche (pauseView.vue, main.js)
  setMenuOpen(!(CARTE && !!data && data.vue === 'fiche'));
  if (detailNiv) setText(detailNiv.label, 'NIV.');
}

// ----- Retours de Femz du 16/11/2026, point 1 : boîte « MENU » repliée au-dessus de la fiche -------------------------
let pausePanel = null; // la fenêtre du menu (Reprendre, Inventaire, Paramètres, Recommencer, Quitter la partie : § E5.AG)
let pauseEl = null;
let menuPliBtn = null;
let menuOuvert = 0;

/** Pied de la fiche en pause (menus « Pile ») : « Fermer l'inventaire » (la partie reprend) et « Menu » (la liste). */
function buildMenuPli() {
  const box = el('div', 'sr-pause-menu-pli');
  const fermer = button('Fermer l\u2019inventaire', 'sr-btn sr-fiche-fermer', click(() => actions.resume()));
  menuPliBtn = button('Menu', 'sr-btn sr-menu-pli-btn', click(() => setMenuOpen(true)));
  menuPliBtn.setAttribute('aria-expanded', 'false');
  box.append(fermer, menuPliBtn);
  return box;
}

/** Fenêtre du menu ouverte (on ne voit qu'elle) ou fermée (la fiche et la boîte repliée). */
function setMenuOpen(open) {
  if (!pauseEl) return false;
  const v = open ? 1 : 0;
  if (v === menuOuvert) return false;
  menuOuvert = v;
  if (open) closeDetail();
  else closePlis();
  pauseEl.classList.toggle('sr-pause-menu-on', open);
  if (menuPliBtn) menuPliBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  return true;
}

/** Entrée en pause (main.js) : ouvre la fenêtre du menu si elle est fermée. Vrai si elle vient de s'ouvrir. */
export function pauseConfirm() {
  if (screen !== SCREEN.PAUSE || !CARTE) return false;
  if (menuOuvert === 1) return false;
  audio.play(SFX.UI_CLICK);
  return setMenuOpen(true);
}

/**
 * Échap en pause (main.js, avant resume) : referme la fenêtre d'un élément. Vrai si elle était ouverte (la partie reste
 * en pause), faux sinon (main reprend la partie). Un panneau replié ouvert ne retient pas Échap : il est refermé à la
 * prochaine ouverture de la pause (pauseReset).
 */
export function pauseBack() {
  if (screen !== SCREEN.PAUSE) return false;
  if (detailSurvol) closeDetail();
  else if (closeDetail()) return true;
  if (!CARTE) return false;
  // menus « Pile » (19/11) : dans le menu, Échap referme un panneau ouvert, sinon la partie reprend ; dans la fiche,
  // Échap montre le menu
  if (menuOuvert === 1) return closePlis();
  audio.play(SFX.UI_CLICK);
  return setMenuOpen(true);
}

/** Tab en pause (main.js) : du menu, montre la fiche (vrai) ; de la fiche, faux (main reprend la partie). */
export function pauseFiche() {
  if (screen !== SCREEN.PAUSE || !CARTE || menuOuvert === 0) return false;
  audio.play(SFX.UI_CLICK);
  return setMenuOpen(false);
}

/** Le <canvas> 2D du portrait de la fiche (null hors DA carte mère) et sa boîte, pour src/pause-agent.js. */
export function getPortraitCanvas() {
  return ficheCanvas3d;
}

/** Portrait 3D prêt (vrai) : l'image pixel de repli est cachée ; faux : elle revient. */
export function setPortrait3d(on) {
  if (fichePortraitBox) fichePortraitBox.classList.toggle('sr-3d', !!on);
}

/** Tests : état de la pause (fenêtre ouverte, panneaux, textes de la fenêtre). Hors chemin chaud. */
export function inspectPause(out = {}) {
  out.detail = detailEtat[0] === 0 ? null : { genre: ['', 'arme', 'objet', 'bonus'][detailEtat[0]], k: detailEtat[1] };
  out.plis = plis.map((p) => p.box.style.display !== 'none');
  out.menu = menuOuvert === 1; // 16/11, point 1 : fenêtre du menu ouverte
  return out;
}

// ----- Retours de Femz du 16/11/2026, point 7 : pseudo du joueur (menu principal, fiche de la pause, game over) -------
// Stockage : src/pseudo.js (ui.js ne touche pas au stockage).
import { PSEUDO } from './config.js';
let overTitre = null;
// stockage du pseudo : src/pseudo.js, passé par main.js (ctx.pseudo) — ui.js n'importe que config, state et ui-carte
const pseudoStock = {
  lire: () => (ctx && ctx.pseudo ? ctx.pseudo.lire() : PSEUDO.defaut),
  ecrire: (v) => (ctx && ctx.pseudo ? ctx.pseudo.ecrire(v) : PSEUDO.defaut),
  nettoie: (v) => (ctx && ctx.pseudo ? ctx.pseudo.nettoie(v) : String(v).slice(0, PSEUDO.max)),
};

/** Le pseudo affiché (saisi au menu, sinon PSEUDO.defaut). */
export function pseudo() {
  return pseudoStock.lire();
}

/** Change le pseudo (champ du menu, tests) ; rend la valeur affichée. */
export function setPseudo(v) {
  const p = pseudoStock.ecrire(v);
  if (overTitre) overTitre.dataset.entete = enteteAgent(AGENTS[run.agent].name, p); // § E4.E.5
  return p;
}

/** Champ « PSEUDO » du menu principal (cartouche FUI, 15 caractères au plus). */
function buildPseudo() {
  const box = el('label', 'sr-pseudo sr-cartouche');
  box.appendChild(el('span', 'sr-pseudo-lab', 'Pseudo'));
  const input = el('input', 'sr-pseudo-input');
  input.type = 'text';
  input.maxLength = PSEUDO.max;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = PSEUDO.defaut;
  input.tabIndex = -1; // comme les curseurs : pris au clic, jamais par Tab (règle de focus de l'interface)
  input.setAttribute('aria-label', 'Pseudo (' + PSEUDO.max + ' caractères au plus)');
  const v = pseudo();
  input.value = v === PSEUDO.defaut ? '' : v;
  input.addEventListener('input', () => {
    const n = pseudoStock.nettoie(input.value);
    if (n !== input.value.trim().slice(0, PSEUDO.max)) input.value = n;
    setPseudo(input.value);
  });
  // Entrée ou Échap dans le champ le quittent (input.js : la frappe rend la main au jeu)
  box.appendChild(input);
  return box;
}

// ----- § E4.A.6 : notification d'un succès en partie ------------------------------------------------------------------
// Un cadre FUI (cartouche de la carte mère) en haut à droite, sous la pastille des fragments : « SUCCÈS », le nom, puis
// la récompense. Nœud DOM unique créé à l'init ; textes pris dans defis.toastName / toastReward (construits une fois).
// Une notification à la fois (DEFIS.toastSeconds) ; les suivantes attendent dans une file d'entiers (anneau de 8).
import { DEFIS } from './config.js'; // § E4.A (import remonté par le module)
import { TOAST_SAUVE } from './config.js'; // § E4.Q.3 : notification de la Sauvegarde lâchée par un boss (ids 100, 101)
let toastEl = null;
let toastName = null;
let toastReward = null;
let toastKicker = null; // § E4.Q.3 : « SUCCÈS » ou « OBJET RÉCUPÉRÉ »
const toastQ = new Int8Array(8);
const toastT = new Float64Array(1); // s restantes de la notification affichée (0 : rien)
let toastHead = 0;
let toastLen = 0;
let toastCur = -1;
const CLS_TOAST = ['sr-toast', 'sr-toast sr-toast-on', 'sr-toast sr-toast-on sr-toast-sauve']; // [2] : § E4.Q.3, teinte de l'objet
// [3] / [4] : sortie en fondu (Femz, 17/11 : la notification disparaissait d'un coup) — reste en display: flex le temps
// du fondu (DEFIS.toastInSeconds), puis [0]
const CLS_TOAST_SORT = ['sr-toast sr-toast-on sr-toast-sort', 'sr-toast sr-toast-on sr-toast-sauve sr-toast-sort'];
const toastSort = new Float64Array(1); // s restantes du fondu de sortie (0 : pas en sortie)

function buildToast() {
  toastEl = el('div', CLS_TOAST[0]);
  toastEl.setAttribute('role', 'status');
  toastEl.style.setProperty('--sr-toast-in', DEFIS.toastInSeconds + 's');
  const k = el('span', 'sr-toast-kicker', DEFIS.toastKicker);
  toastKicker = k;
  toastName = el('span', 'sr-toast-name', '');
  toastReward = el('span', 'sr-toast-reward', '');
  toastEl.append(k, toastName, toastReward);
  // § E5.E.2 : la notification et le récap des ramassages partagent la colonne de droite (sous le compteur de
  // fragments) : la notification au-dessus, le récap dessous, empilés par flex — jamais l'un sur l'autre
  const col = el('div', 'sr-col-droite');
  col.appendChild(toastEl);
  hud.appendChild(col);
  buildRecap(col);
}

/** defis.check (en combat) : le succès s est réussi. Affiché tout de suite, ou mis en file. Entiers seulement. */
export function toastSucces(s) {
  if (toastEl === null) return;
  if (toastCur < 0) {
    showToast(s);
    return;
  }
  if (toastLen >= toastQ.length) return; // file pleine (8 succès dans la même notification) : le hub les montrera
  toastQ[(toastHead + toastLen) % toastQ.length] = s;
  toastLen++;
}

function showToast(s) {
  const D = ctx.defis;
  toastCur = s;
  if (s === TOAST_SAUVE.SAUVE || s === TOAST_SAUVE.SAUVE_PLEIN) {
    // § E4.Q.3 : Sauvegarde ramassée (textes fixes de config ; le son est SAUVE_PRISE, joué par disquette.js)
    const plein = s === TOAST_SAUVE.SAUVE_PLEIN;
    toastKicker.textContent = plein ? TOAST_SAUVE.kickerPlein : TOAST_SAUVE.kicker;
    toastName.textContent = plein ? TOAST_SAUVE.nomPlein : TOAST_SAUVE.nom;
    toastReward.textContent = plein ? TOAST_SAUVE.effetPlein : TOAST_SAUVE.effet;
    toastEl.className = CLS_TOAST[2];
    toastT[0] = DEFIS.toastSeconds;
    return;
  }
  toastKicker.textContent = DEFIS.toastKicker;
  toastName.textContent = D.toastName[s];
  toastReward.textContent = D.toastReward[s];
  toastEl.className = CLS_TOAST[1];
  toastT[0] = DEFIS.toastSeconds;
  audio.play(SFX.SUCCES);
}

function updateToast(realDt) {
  if (toastCur < 0) return;
  if (realDt > 0) toastT[0] -= realDt;
  if (toastT[0] > 0) return;
  toastT[0] = 0;
  // fondu de sortie, sauf si une autre notification attend (elle remplace aussitôt celle-ci)
  if (toastLen === 0 && toastSort[0] === 0 && toastEl.className !== CLS_TOAST_SORT[0] && toastEl.className !== CLS_TOAST_SORT[1]) {
    toastSort[0] = DEFIS.toastInSeconds;
    toastEl.className = toastEl.className === CLS_TOAST[2] ? CLS_TOAST_SORT[1] : CLS_TOAST_SORT[0];
    return;
  }
  if (toastSort[0] > 0) {
    toastSort[0] -= realDt > 0 ? realDt : 0;
    if (toastSort[0] > 0) return;
  }
  toastSort[0] = 0;
  toastCur = -1;
  toastEl.className = CLS_TOAST[0];
  if (toastLen > 0) {
    const s = toastQ[toastHead];
    toastHead = (toastHead + 1) % toastQ.length;
    toastLen--;
    showToast(s);
  }
}

function resetToast() {
  if (toastEl === null) return;
  toastHead = 0;
  toastLen = 0;
  toastCur = -1;
  toastT[0] = 0;
  toastSort[0] = 0;
  toastEl.className = CLS_TOAST[0];
}

/** Tests : état de la notification. */
export function inspectToast() {
  return { cur: toastCur, len: toastLen, left: toastT[0], on: toastEl !== null && toastEl.className !== CLS_TOAST[0], kicker: toastKicker ? toastKicker.textContent : '', sauve: toastEl !== null && toastEl.className === CLS_TOAST[2], name: toastName ? toastName.textContent : '', reward: toastReward ? toastReward.textContent : '' };
}

// ===== Étape 5, chantier E (§ E5.E) : maquettes du 17/11 intégrées ====================================================

/**
 * § E5.E — styles tirés de config.js, écrits une fois à l'init : couleur de chaque palier de niveau du HUD (classe
 * sr-pal-<k> → --lc), couleur de chaque type du récap (sr-rc-t<t> → --c), sprite et cadence de la pièce de la monnaie.
 */
function stylesE5(rs) {
  let css = '';
  // (sélecteur plus fort que la couleur par défaut de ui.css : [data-sr-theme] .sr-hud .sr-weapons .sr-weapon)
  for (let k = 0; k < HUD_PALIERS.length; k++) css += '[data-sr-theme] .sr-hud .sr-weapons .sr-weapon.sr-pal-' + k + '{--lc:' + HUD_PALIERS[k].couleur + '}';
  for (let t = 0; t < RECAP.types.length; t++) css += '.sr-rc-l.sr-rc-t' + t + '{--c:' + RECAP.types[t].couleur + '}';
  // pièce : une clé par image de pieceSequence() (décalage d'un nombre ENTIER de cadres, --sr-pc hérité de .sr-px),
  // tenue jusqu'à la clé suivante (step-end, ui.css) ; dernière clé = première image (la boucle reprend sans saut)
  const seq = pieceSequence();
  let t0 = 0;
  css += '@keyframes sr-piece{';
  for (const [f, d] of seq) {
    css += ((100 * t0) / PIECE_CYCLE).toFixed(4) + '%{transform:translateX(calc(var(--sr-pc) * -' + f + '))}';
    t0 += d;
  }
  css += '100%{transform:translateX(calc(var(--sr-pc) * -' + seq[0][0] + '))}}';
  const st = document.createElement('style');
  st.dataset.sr = 'e5-E';
  st.textContent = css;
  document.head.appendChild(st);
  rs.setProperty('--sr-piece-img', 'url("' + PIECE.fichier + '")');
  rs.setProperty('--sr-piece-n', String(PIECE.images));
  rs.setProperty('--sr-piece-d', PIECE_CYCLE.toFixed(3) + 's'); // un tour, arrêts de face compris
  rs.setProperty('--sr-piece-px', PIECE.cadre + 'px'); // un cadre à × 1 (pas de l'arrondi)
  rs.setProperty('--sr-piece-rem', PIECE.cadre / UI.scale.remPx + 'rem'); // un cadre à l'échelle de l'interface
  rs.setProperty('--sr-piece-marge', String((PIECE.cadre - PIECE.art) / 2 / PIECE.cadre)); // part du cadre autour de la pièce
  rs.setProperty('--sr-recap-sortie', RECAP.sortie + 's');
}

// ----- § E5.E.2 : récap des ramassages « R1 flux de lignes » ----------------------------------------------------------
// Colonne de droite, sous le compteur de fragments (et sous la notification des succès) : une ligne par type ramassé
// (icône, nom, effet cumulé, « ×N »), la plus récente en haut, RECAP.lignes au plus. Les ramassages arrivent par deux
// tableaux typés (src/ramassage.js : RAM_N, et RAM_I, la valeur cumulée en entier, qui ne font que croître) ; on
// compare au déjà vu. Rien que des entiers ici : même avant l'optimisation de V8, aucun nombre n'est alloué.
// Chemin chaud (§ V) : nœuds créés une fois (buildRecap) ; textes écrits dans des nœuds texte (.data) avec des chaînes
// précalculées ; compteurs réécrits seulement s'ils changent, au plus RECAP.hz fois par seconde ; une ligne s'efface
// par une CLASSE (transition CSS d'opacité), RECAP.vie s après son dernier ramassage ; minuteries en tableaux typés.
const RC_N = RECAP_T.COUNT;
const RC_L = RECAP.lignes;
const rcVu = new Int32Array(RC_N); // RAM_N déjà vu
const rcVuV = new Int32Array(RC_N); // RAM_I déjà vu
const rcLigneDe = new Int8Array(RC_N).fill(-1); // ligne qui montre le type t (−1 : aucune)
const rcType = new Int8Array(RC_L).fill(-1); // type montré par la ligne k (−1 : libre)
const rcN0 = new Int32Array(RC_L); // RAM_N[t] avant le premier ramassage de la ligne
const rcV0 = new Int32Array(RC_L); // RAM_I[t] avant le premier ramassage de la ligne
const rcAge = new Float64Array(RC_L); // s (temps réel, en partie seulement) depuis le dernier ramassage
const rcEtat = new Int8Array(RC_L); // 0 cachée, 1 visible, 2 en sortie (fondu)
const rcSale = new Uint8Array(RC_L); // compteurs à réécrire à la prochaine écriture
const rcAffN = new Int32Array(RC_L); // « ×N » écrit
const rcAffV = new Int32Array(RC_L); // valeur entière écrite
const rcBump = new Uint8Array(RC_L); // alternance des deux animations du « coup » (relance sans lire la mise en page)
const RC_T = new Float64Array(2); // [0] s depuis la dernière écriture des compteurs, [1] realDt de l'image
const RC_VU = new Int8Array(1).fill(-1); // [0] récap montré (1) ou caché hors partie (0) ; −1 : à écrire
// Flottants lus à chaque image : dans un tableau typé (un flottant nu pour V8, jamais une boîte allouée — § V)
const RC_C = new Float64Array([RECAP.vie, RECAP.vie + RECAP.sortie, 1 / RECAP.hz]); // [0] vie, [1] vie + fondu, [2] période d'écriture
const RC_MAX = RECAP.max | 0;
const RC_MAXK = RECAP.maxK | 0;
const RC_MAXN = RECAP.maxN | 0;
/** Mesures (tests) : [0] écritures de texte, [1] écritures de classe, [2] lignes remontées en tête, [3] fenêtres d'écriture. */
export const RC_STATS = new Int32Array(4);
const rcLignes = []; // { el, use, nom, eff, cnt } — nom, eff, cnt : nœuds texte
// compteurs de src/ramassage.js, reçus par ctx.ramassage (contrat : ui.js n'importe que config.js et state.js…)
let RAM_N = new Int32Array(RECAP_T.COUNT);
let RAM_I = new Int32Array(RECAP_T.COUNT);
let rcBox = null;
// Classes : par type, [visible, coup a, coup b, sortie] ; une ligne libre n'a pas de type
const RC_ETATS = ['', ' sr-rc-bump-a', ' sr-rc-bump-b', ' sr-rc-out'];
const RC_CLS = [];
for (let t = 0; t < RC_N; t++) for (let s = 0; s < 4; s++) RC_CLS.push('sr-rc-l sr-rc-t' + t + RC_ETATS[s]);
const RC_CLS_OFF = 'sr-rc-l sr-rc-off';
const RC_ICONE = RECAP.types.map((T) => '#' + T.icone); // (aplatie plus bas, avec les autres chaînes)
// Chaînes des nombres, créées au chargement : « +N XP », « +N », « +N PV » (N ≤ RECAP.max, puis « +N k »), « ×N »
/**
 * Chaîne « à plat » : une concaténation est une chaîne en corde (ConsString) que V8 aplatit — en allouant — la première
 * fois qu'elle passe au DOM. Utilisée comme clé de propriété, elle est aplatie et internée ICI, une fois, au chargement.
 */
function plat(s) {
  const o = {};
  o[s] = 0;
  for (const k in o) return k;
  return s;
}
function milliers(n) {
  const s = String(n);
  return s.length > 3 ? s.slice(0, s.length - 3) + ' ' + s.slice(s.length - 3) : s;
}
function tableNombres(suffixe) {
  const t = [];
  for (let n = 0; n <= RECAP.max; n++) t.push(plat('+' + milliers(n) + suffixe));
  for (let k = 0; k <= RECAP.maxK; k++) t.push(plat('+' + k + ' k' + suffixe));
  return t;
}
const RC_TXT = { xp: tableNombres(' XP'), frag: tableNombres(''), pv: tableNombres(' PV') };
const RC_X = [''];
for (let n = 1; n <= RECAP.maxN; n++) RC_X.push(n === 1 ? '' : plat('×' + n)); // « ×1 » n'est pas écrit
const RC_X_PLUS = plat('×' + RECAP.maxN + '+');
const RC_NOM = RECAP.types.map((T) => plat(T.nom));
for (let t = 0; t < RC_ICONE.length; t++) RC_ICONE[t] = plat(RC_ICONE[t]);
const RC_TEXTE = RECAP.types.map((T) => (T.effet === 'texte' ? plat(T.texte) : ''));
// type → table de son effet (null : phrase fixe)
const RC_EFF = RECAP.types.map((T) => (T.effet === 'texte' ? null : RC_TXT[T.effet]));
const RC_PRIS_VALEUR = new Uint8Array(RECAP.types.map((T) => (T.effet === 'xp' || T.effet === 'frag' || T.effet === 'pv' ? 1 : 0))); // 'pv' : Femz 20/11 soir, Batteries de 25 à 75 PV (RAM_I = PV réels)

/** v : entier (Smi) ≥ 0. */
function rcNombre(table, v) {
  if (v <= RC_MAX) return table[v < 0 ? 0 : v];
  // milliers par soustraction : une division rend un flottant (alloué tant que la fonction est interprétée)
  let k = 0;
  let r = v;
  while (r >= 1000 && k < RC_MAXK) {
    r -= 1000;
    k++;
  }
  return table[RC_MAX + 1 + k];
}

function buildRecap(parent) {
  if (!RECAP.actif || !ctx.ramassage) return;
  RAM_N = ctx.ramassage.RAM_N;
  RAM_I = ctx.ramassage.RAM_I;
  // symboles propres au récap : gemme (à facettes), grosse gemme (avec son halo), cache de données — pixel 12 × 12,
  // couleur courante (la ligne pose --c)
  const sprite = document.createElementNS(SVG_NS, 'svg');
  sprite.setAttribute('class', 'sr-sprite');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.innerHTML =
    '<symbol id="sr-i-gemme" viewBox="0 0 12 12"><path shape-rendering="crispEdges" d="M5 1h2v1h1v1h1v1h1v2h-1v1h-1v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-2h1v-1h1v-1h1v-1h1z"/><path shape-rendering="crispEdges" fill="#fff" opacity=".55" d="M5 2h1v1h-1v1h-1v1h-1v-1h1v-1h1z"/></symbol>' +
    '<symbol id="sr-i-grosse-gemme" viewBox="0 0 12 12"><path shape-rendering="crispEdges" opacity=".35" d="M0 5h1v-2h1v-1h1v-1h1v-1h4v1h1v1h1v1h1v2h1v2h-1v2h-1v1h-1v1h-1v1h-4v-1h-1v-1h-1v-1h-1v-2h-1z"/><path shape-rendering="crispEdges" d="M5 2h2v1h1v1h1v2h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-2h1v-1h1z"/><path shape-rendering="crispEdges" fill="#fff" opacity=".6" d="M5 3h1v1h-1v1h-1v-1h1z"/></symbol>' +
    '<symbol id="sr-i-cache" viewBox="0 0 12 12"><path shape-rendering="crispEdges" d="M2 2h8v1h1v2h-10v-2h1zM1 6h10v4h-10z"/><path shape-rendering="crispEdges" fill="#06120c" d="M5 6h2v2h-2z"/><path shape-rendering="crispEdges" fill="#fff" opacity=".45" d="M2 3h8v1h-8z"/></symbol>';
  root.appendChild(sprite);
  // chaque chaîne des tables passe une fois par un nœud texte : sa conversion pour le DOM est faite ici, pas en partie
  const essai = document.createTextNode('');
  for (const tab of [RC_TXT.xp, RC_TXT.frag, RC_TXT.pv, RC_X, RC_NOM, RC_TEXTE]) for (let i = 0; i < tab.length; i++) essai.data = tab[i];
  essai.data = RC_X_PLUS;
  rcBox = el('div', 'sr-recap');
  rcBox.setAttribute('aria-hidden', 'true'); // les ramassages sont un retour visuel ; la notification garde role=status
  for (let k = 0; k < RC_L; k++) {
    const l = el('div', RC_CLS_OFF);
    const ic = icon('sr-i-frag');
    const nom = el('span', 'sr-rc-nom');
    const eff = el('span', 'sr-rc-eff');
    const cnt = el('span', 'sr-rc-n sr-num');
    const tNom = document.createTextNode('');
    const tEff = document.createTextNode('');
    const tCnt = document.createTextNode('');
    nom.appendChild(tNom);
    eff.appendChild(tEff);
    cnt.appendChild(tCnt);
    l.append(ic, nom, eff, cnt);
    rcBox.appendChild(l);
    rcLignes.push({ el: l, use: ic.firstChild, nom: tNom, eff: tEff, cnt: tCnt });
  }
  parent.appendChild(rcBox);
}

function rcClasse(k, s) {
  rcLignes[k].el.className = s < 0 ? RC_CLS_OFF : RC_CLS[rcType[k] * 4 + s];
  RC_STATS[1]++;
}

/** Écrit l'effet cumulé et le « ×N » de la ligne k, s'ils ont changé ; true si le compteur a changé. */
function rcEcrire(k) {
  const t = rcType[k];
  const L = rcLignes[k];
  const n = RAM_N[t] - rcN0[k];
  let change = false;
  if (n !== rcAffN[k]) {
    rcAffN[k] = n;
    L.cnt.data = n <= RC_MAXN ? RC_X[n] : RC_X_PLUS;
    RC_STATS[0]++;
    change = true;
  }
  const tab = RC_EFF[t];
  if (tab !== null) {
    const v = RC_PRIS_VALEUR[t] === 1 ? RAM_I[t] - rcV0[k] : 0;
    if (v !== rcAffV[k]) {
      rcAffV[k] = v;
      L.eff.data = rcNombre(tab, v);
      RC_STATS[0]++;
    }
  }
  return change;
}

/** Une ligne pour le type t (libre, sinon celle dont le dernier ramassage est le plus ancien), remontée en tête. */
function rcPrendre(t) {
  let k = -1;
  for (let j = 0; j < RC_L; j++)
    if (rcType[j] < 0) {
      k = j;
      break;
    }
  if (k < 0) {
    k = 0;
    for (let j = 1; j < RC_L; j++) if (rcAge[j] > rcAge[k]) k = j;
    rcLigneDe[rcType[k]] = -1;
  }
  rcType[k] = t;
  rcLigneDe[t] = k;
  rcN0[k] = rcVu[t]; // avant ce ramassage : le compteur affiché part de 1
  rcV0[k] = rcVuV[t];
  rcAffN[k] = -1;
  rcAffV[k] = -1;
  const L = rcLignes[k];
  L.use.setAttribute('href', RC_ICONE[t]);
  L.nom.data = RC_NOM[t];
  L.eff.data = RC_TEXTE[t];
  RC_STATS[0] += 2;
  rcEcrire(k); // une ligne neuve s'écrit tout de suite (ses compteurs suivants : au rythme RECAP.hz)
  if (rcBox.firstChild !== L.el) {
    rcBox.insertBefore(L.el, rcBox.firstChild);
    RC_STATS[2]++;
  }
  return k;
}

function recapUpdate(realDt) {
  if (rcBox === null) return;
  // un écran ouvert (choix de niveau, coffre, marchand, pause…) cache le récap sans rien oublier : ses lignes et leurs
  // minuteries attendent la fermeture (sinon il passait par-dessus l'écran ouvert) ; la fin de vague le garde
  const vu = screen === SCREEN.NONE ? 1 : 0;
  if (vu !== RC_VU[0]) {
    RC_VU[0] = vu;
    rcBox.className = vu === 1 ? 'sr-recap' : 'sr-recap sr-recap-cache';
  }
  // 1. nouveaux ramassages : une ligne par type, sa sortie annulée
  for (let t = 0; t < RC_N; t++) {
    const n = RAM_N[t];
    if (n === rcVu[t]) continue;
    let k = rcLigneDe[t];
    if (k < 0) {
      k = rcPrendre(t);
      rcEtat[k] = 1;
      rcClasse(k, 0);
    } else {
      rcSale[k] = 1;
      if (rcEtat[k] !== 1) {
        rcEtat[k] = 1;
        rcClasse(k, rcBump[k] === 1 ? 1 : 2);
      }
    }
    rcVu[t] = n;
    rcVuV[t] = RAM_I[t];
    rcAge[k] = 0;
  }
  // 2. effacement : RECAP.vie s après le dernier ramassage (temps de jeu seulement), puis la transition CSS
  RC_T[1] = realDt > 0 ? realDt : 0; // relu d'un tableau typé : un flottant nu
  if (RC_T[1] > 0 && vu === 1) {
    for (let k = 0; k < RC_L; k++) {
      if (rcEtat[k] === 0) continue;
      rcAge[k] += RC_T[1];
      if (rcEtat[k] === 1 && rcAge[k] >= RC_C[0]) {
        rcEtat[k] = 2;
        rcClasse(k, 3);
      } else if (rcEtat[k] === 2 && rcAge[k] >= RC_C[1]) {
        rcEtat[k] = 0;
        rcClasse(k, -1);
        rcLigneDe[rcType[k]] = -1;
        rcType[k] = -1;
      }
    }
  }
  // 3. compteurs : au plus RECAP.hz écritures par seconde ; un compteur qui monte donne un petit coup (classe alternée)
  RC_T[0] += RC_T[1];
  if (RC_T[0] < RC_C[2]) return;
  RC_T[0] = 0;
  RC_STATS[3]++;
  for (let k = 0; k < RC_L; k++) {
    if (rcSale[k] === 0) continue;
    rcSale[k] = 0;
    if (rcType[k] < 0) continue;
    if (rcEcrire(k) && rcEtat[k] === 1) {
      rcBump[k] = rcBump[k] === 1 ? 0 : 1;
      rcClasse(k, rcBump[k] === 1 ? 1 : 2);
    }
  }
}

function recapReset() {
  rcVu.set(RAM_N);
  rcVuV.set(RAM_I);
  rcLigneDe.fill(-1);
  rcType.fill(-1);
  rcEtat.fill(0);
  rcSale.fill(0);
  rcAge.fill(0);
  RC_T[0] = 0;
  RC_VU[0] = -1;
  for (let k = 0; k < rcLignes.length; k++) rcLignes[k].el.className = RC_CLS_OFF;
}

/** Tests : lignes du récap dans l'ordre d'affichage { type, nom, effet, n, etat } et mesures d'écriture. */
export function recapInspect() {
  const lignes = [];
  if (rcBox !== null)
    for (const n of rcBox.children) {
      const k = rcLignes.findIndex((L) => L.el === n);
      if (rcEtat[k] === 0) continue;
      lignes.push({ k, type: rcType[k], cle: rcType[k] >= 0 ? RECAP.types[rcType[k]].cle : '', nom: rcLignes[k].nom.data, effet: rcLignes[k].eff.data, n: rcLignes[k].cnt.data, etat: rcEtat[k], age: rcAge[k], classe: n.className });
    }
  return { lignes, stats: { textes: RC_STATS[0], classes: RC_STATS[1], remontees: RC_STATS[2], fenetres: RC_STATS[3] }, noeuds: rcBox ? rcBox.querySelectorAll('*').length + 1 : 0 };
}

// ----- § E5.E.3 : marchand M3, cartes de niveau et lots de coffre — balises colorées écrites par ui.js -------------------
// Chiffres → <b class="sr-n">, mots clés (MARCHAND_M3.motsCles, sans tenir compte de la casse ; bord de mot en lettres
// Unicode) → <b class="sr-k">. Hors combat (écrans en pause) : construit des nœuds, une fois par texte affiché.
const RE_BALISES = new RegExp(
  '((?<![\\p{L}\\d])(?:[+\\u2212-]\\s?|\\u00d7\\s?)?\\d+(?:[.,]\\d+)?(?:\\s?(?:%|s(?![\\p{L}])|m(?![\\p{L}])))?)|(?<![\\p{L}])(' +
    MARCHAND_M3.motsCles
      .slice()
      .sort((a, b) => b.length - a.length)
      .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|') +
    ')(?![\\p{L}])',
  'giu'
);

function baliser(parent, t) {
  RE_BALISES.lastIndex = 0;
  let pos = 0;
  let m;
  while ((m = RE_BALISES.exec(t)) !== null) {
    if (m.index > pos) parent.appendChild(document.createTextNode(t.slice(pos, m.index)));
    parent.appendChild(el('b', m[1] !== undefined ? 'sr-n' : 'sr-k', m[0]));
    pos = m.index + m[0].length;
  }
  if (pos < t.length) parent.appendChild(document.createTextNode(t.slice(pos)));
}

/**
 * Texte d'une carte (desc d'un bonus, d'un objet ou d'un lot) : la phrase d'ambiance (avant « \n », gardée dans le
 * nœud : textContent reste le texte d'origine ; cachée par ui.css dans le style M3) puis la ligne chiffrée, balisée.
 */
function colorer(node, text) {
  if (node.srTexte === text) return;
  node.srTexte = text;
  node.replaceChildren();
  //#region e5:L-textes-guide
  // § E5.L (C1) : la phrase d'effet est AFFICHÉE (bloc à part), puis chaque ligne chiffrée dans son bloc (la ligne de
  // recharge ne se colle plus aux chiffres) ; les « \n » restent dans les nœuds : textContent = texte d'origine
  const i = text.indexOf('\n');
  if (i >= 0) node.appendChild(el('span', 'sr-card-flav', text.slice(0, i + 1)));
  // 21/11 (Femz : « une phrase fixe qui dit ce que fait l'item, puis les stats par ligne en bas en très petit ») :
  // une ligne par chiffre — coupée aux « \n » et aux « · » ; les séparateurs restent dans le nœud (textContent
  // inchangé), masqués par le style
  const s = el('span', i >= 0 ? 'sr-card-stat' : 'sr-card-stat sr-seul'); // sans phrase : la ligne garde la taille du texte
  const reste = i >= 0 ? text.slice(i + 1) : text;
  RE_LIGNES.lastIndex = 0;
  let pos = 0;
  let m;
  while ((m = RE_LIGNES.exec(reste)) !== null) {
    const l = el('span', 'sr-card-stat-l');
    baliser(l, reste.slice(pos, m.index));
    s.append(l, el('span', 'sr-card-sep', m[0]));
    pos = m.index + m[0].length;
  }
  const l = el('span', 'sr-card-stat-l');
  baliser(l, reste.slice(pos));
  s.appendChild(l);
  node.appendChild(s);
  //#endregion e5:L-textes-guide
}
const RE_LIGNES = /\n| · /g;

/** Gain d'une ligne d'achat du marchand : « +2 », « +0,3 /s », « −0,1 s » (vide si rien ne suit). */
function gainTexte(cur, next, unit) {
  if (next === null || next === undefined) return '';
  const d = Math.round((next - cur) * 100) / 100;
  return (d > 0 ? '+' : d < 0 ? '−' : '') + formatValue(d < 0 ? -d : d) + (unit ? ' ' + unit : '');
}

// ===== Plan addictif, étape 4, chantier E (§ E4.E) : en-tête de l'agent, section CARACTÉRISTIQUES ======================

/**
 * § E4.E.5 — en-tête d'un agent : le type (« BASTION »), puis le pseudo s'il en a un (différent du pseudo par défaut
 * et du type, sans tenir compte de la casse). Jamais deux fois le même mot. Hors combat.
 */
export function enteteAgent(type, ps) {
  const t = String(type).toUpperCase();
  const p = String(ps || '').trim();
  const P_ = p.toUpperCase();
  if (!p || P_ === String(PSEUDO.defaut).toUpperCase() || P_ === t) return t;
  return t + ' · ' + P_;
}

let ficheCarac = null; // colonne CARACTÉRISTIQUES de la fiche de la pause
const CARAC_N = FICHE_STATS.lignes.length;
const caracTot = new Float64Array(CARAC_N); // dernières valeurs calculées (tests : comparées à l'état du jeu)
const caracBase = new Float64Array(CARAC_N);
// unité de l'écart en % pour les stats en m/s, m, s : la valeur de référence SANS l'agent (PLAYER.speed, rayon de
// collecte, recharge du dash) — l'écart se lit alors comme les cartes de bonus (« +8 % de vitesse » = +8 %)
const caracRef = new Float64Array(CARAC_N);

/** Construit une colonne CARACTÉRISTIQUES (même fonction pour la pause et le Noyau). Rend { box, rows[] }. */
export function buildCarac() {
  const box = el('div', 'sr-carac sr-facet');
  box.appendChild(el('h3', 'sr-carac-titre', FICHE_STATS.titre));
  const liste = el('div', 'sr-carac-liste');
  const rows = [];
  for (const L of FICHE_STATS.lignes) {
    const row = el('div', L.groupe ? 'sr-carac-ligne sr-carac-groupe' : 'sr-carac-ligne');
    row.dataset.stat = L.id;
    const nom = el('span', 'sr-carac-nom', L.nom);
    const val = el('span', 'sr-carac-val sr-num', '');
    const det = el('span', 'sr-carac-det sr-num', '');
    row.append(nom, val, det);
    liste.appendChild(row);
    rows.push({ row, val, det });
  }
  box.appendChild(liste);
  return { box, rows, tot: new Float64Array(CARAC_N), base: new Float64Array(CARAC_N) };
}

/**
 * Valeurs d'une ligne : base de l'agent a (config : AGENTS[a].stats, passif, PLAYER, PICKUPS) et, si live, le total lu
 * dans l'état du jeu (P, mods) ; sinon total = base (Noyau : l'agent hors partie). Écrit tot[k] et base[k].
 */
export function caracValeurs(a, live, tot, base) {
  const A = AGENTS[a];
  const S = A.stats;
  const Pv = A.passive || {};
  const conv = Pv.resistToDamage > 0 ? Pv.resistToDamage * (1 - S.damageTakenMul) : 0;
  for (let k = 0; k < CARAC_N; k++) {
    const id = FICHE_STATS.lignes[k].id;
    let b = 0;
    let t = 0;
    if (id === 'pvMax') { b = S.maxHp; t = P.maxHp; }
    else if (id === 'regen') { b = 0; t = mods.regenPerSec; }
    else if (id === 'blindage') { b = 1 - S.damageTakenMul; t = 1 - mods.damageTakenMul; }
    else if (id === 'vitesse') { b = PLAYER.speed * S.speedMul; t = PLAYER.speed * mods.moveSpeedMul; caracRef[k] = PLAYER.speed; }
    else if (id === 'degats') { b = 1 + conv; t = mods.damageMul; }
    else if (id === 'cadence') { b = 1; t = mods.fireRateMul; }
    else if (id === 'zone') { b = 1; t = mods.areaMul; }
    else if (id === 'critChance') { b = PLAYER.critChance; t = PLAYER.critChance + mods.critChanceAdd; }
    else if (id === 'critMul') { b = PLAYER.critMul; t = PLAYER.critMul + mods.critMulAdd; }
    else if (id === 'dash') { b = PLAYER.dash.cooldown * S.dashCdMul; t = PLAYER.dash.cooldown * mods.dashCdMul; caracRef[k] = PLAYER.dash.cooldown; }
    else if (id === 'aimant') { b = PICKUPS.collectRadius; t = PICKUPS.collectRadius * mods.pickupRadiusMul; caracRef[k] = PICKUPS.collectRadius; }
    else if (id === 'chance') { b = 0; t = mods.luck; }
    else if (id === 'fragments') { b = 1; t = mods.fragmentMul; }
    else if (id === 'xp') { b = 1; t = mods.xpGainMul; } // § E5.Z : carte Apprentissage
    else if (id === 'berserk') { b = 0; t = mods.berserk; }
    base[k] = b;
    tot[k] = live ? t : b;
  }
}

/** Nombre à la française : décimales seulement si utiles (au plus d). */
function nombreFr(v, d) {
  const r = Math.round(v * 10 ** d) / 10 ** d;
  let s = r.toFixed(d);
  if (d > 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',').replace('-', '−');
}

function signe(v, d, unite) {
  const r = Math.round(v * 10 ** d) / 10 ** d;
  // § E4.L.5 : une valeur nulle après arrondi s'écrit « 0 », sans signe (jamais « −0 » ni « +0 »)
  if (r === 0) return nombreFr(0, d) + unite;
  return (r > 0 ? '+' : '−') + nombreFr(Math.abs(r), d) + unite;
}

/** § E4.L.5 : vrai si l'écart s'écrit « 0 » après l'arrondi d'affichage (il n'est alors pas écrit). */
function ecartNul(txt) {
  return txt === '' || /^[+−]?0(,0+)?( %)?$/.test(txt);
}

/** Texte de la valeur v selon l'écriture fmt de FICHE_STATS (hors combat). */
function caracTexte(fmt, v) {
  if (fmt === 'pv') return nombreFr(v, 0);
  if (fmt === 'pvs') return nombreFr(v, 1) + ' PV/s';
  if (fmt === 'ms') return nombreFr(v, 1) + ' m/s';
  if (fmt === 'm') return nombreFr(v, 1) + ' m';
  if (fmt === 's') return nombreFr(v, 2) + ' s';
  if (fmt === 'pct') return signe((v - 1) * 100, 0, ' %');
  if (fmt === 'pctMoins') return signe(-v * 100, 0, ' %');
  if (fmt === 'chance') return nombreFr(v * 100, 0) + ' %';
  if (fmt === 'mul') return '×' + nombreFr(v, 2);
  return String(v);
}

/** Écart total − base, écrit dans l'unité qui se lit le mieux : points, PV, ou % de la base (m/s, m, s). */
function caracEcart(fmt, t, b, ref) {
  if (fmt === 'pv') return signe(t - b, 0, '');
  if (fmt === 'pvs') return signe(t - b, 1, '');
  if (fmt === 'ms' || fmt === 'm' || fmt === 's') return ref > 0 ? signe(((t - b) / ref) * 100, 0, ' %') : '';
  if (fmt === 'pct' || fmt === 'chance') return signe((t - b) * 100, 0, ' %');
  if (fmt === 'pctMoins') return signe(-(t - b) * 100, 0, ' %');
  if (fmt === 'mul') return signe(t - b, 2, '');
  return '';
}

/** Remplit une colonne CARACTÉRISTIQUES pour l'agent a (live : partie en cours ; sinon les stats de base). */
export function remplirCarac(c, a, live) {
  if (!c) return;
  caracValeurs(a, live, c.tot, c.base);
  for (let k = 0; k < CARAC_N; k++) {
    const L = FICHE_STATS.lignes[k];
    const t = c.tot[k];
    const b = c.base[k];
    setText(c.rows[k].val, caracTexte(L.fmt, t));
    // § E4.L.5 : un écart nul APRÈS l'arrondi d'affichage n'est pas écrit (ni « −0 % », ni « +0 % »)
    const ecart = Math.abs(t - b) < 1e-6 ? '' : caracEcart(L.fmt, t, b, caracRef[k]);
    const egal = ecartNul(ecart);
    // § E4.N.2 : « base … » seulement quand la valeur s'en écarte (sinon c'est la même valeur écrite deux fois)
    setText(c.rows[k].det, egal ? '' : FICHE_STATS.base + ' ' + caracTexte(L.fmt, b) + ' ' + ecart);
    c.rows[k].row.classList.toggle('sr-carac-bonus', !egal);
    if (c === ficheCarac) {
      caracTot[k] = t;
      caracBase[k] = b;
    }
  }
}

/** Tests (§ E4.E.7) : ce qu'affiche la colonne de la pause, ligne par ligne. */
export function caracInspect() {
  if (!ficheCarac) return null;
  return FICHE_STATS.lignes.map((L, k) => ({ id: L.id, nom: L.nom, total: caracTot[k], base: caracBase[k], val: ficheCarac.rows[k].val.textContent, det: ficheCarac.rows[k].det.textContent }));
}

// ===== § E4.L — chantier L : la fiche de la pause, silhouettes pleines (ARCHITECTURE.md § E4.L) =======================
// (Écran Agents, tâche 5 : la fiche n'est plus montrée au Noyau — son onglet Agents ouvre l'écran Agents)
let ficheEl = null; // le nœud .sr-fiche (buildFiche)
let pauseGauche = null; // son hôte en pause (colonne de gauche, sous la boîte MENU)
let fichePassif = null;
let fichePassifNom = null;
let fichePassifTxt = null;
let fichePassifProg = null;
const SIL = []; // data:URL des vignettes silhouette, par agent (fabriquerSilhouettes)
const silImgs = []; // { img, a } : images qui attendent leur silhouette

/** Pose la fiche dans son hôte, la pause (colonne de gauche), avec sa boîte d'infos. Hors combat. */
function placerFiche() {
  if (!ficheEl || !pauseGauche) return;
  if (ficheEl.parentNode !== pauseGauche) pauseGauche.appendChild(ficheEl);
  if (detailBox && detailBox.parentNode !== ficheEl) ficheEl.appendChild(detailBox);
}

/**
 * § E4.L.2 : vignettes « silhouette pleine » — chaque portrait pixel recopié dans un canvas où tout pixel non transparent
 * prend la couleur SILHOUETTE.couleur (alpha gardé). Une fois à l'init ; les images déjà posées en silhouette sont
 * reprises à l'arrivée (onload).
 */
function fabriquerSilhouettes() {
  const r = (SILHOUETTE.couleur >> 16) & 255;
  const g = (SILHOUETTE.couleur >> 8) & 255;
  const b = SILHOUETTE.couleur & 255;
  for (let a = 0; a < AGENT_COUNT; a++) {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth;
      c.height = im.naturalHeight;
      const g2 = c.getContext('2d');
      g2.drawImage(im, 0, 0);
      const d = g2.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
      }
      g2.putImageData(d, 0, 0);
      SIL[a] = c.toDataURL('image/png');
      for (const s of silImgs) {
        if (s.a !== a || s.img.dataset.sil !== '1') continue;
        s.img.src = SIL[a];
        s.img.style.visibility = '';
      }
    };
    im.src = AGENT_SCREEN.portraits[a];
  }
}

/** 18/11 (« A en animé ») : la planche de l'idle de l'agent a (AGENT_SCREEN.planches), jouée en CSS steps (sr-anime). */
function portraitAnime(img, a) {
  if (!img || !(a >= 0 && a < AGENT_COUNT)) return;
  img.dataset.sil = '0';
  img.classList.add('sr-anime');
  img.style.visibility = '';
  if (img.getAttribute('src') !== AGENT_SCREEN.planches[a]) img.src = AGENT_SCREEN.planches[a];
}

/**
 * Femz (21/11) : image de repli de la fiche (avant le portrait 3D) — la planche animée de l'idle (portraitAnime) ;
 * verrouillé : la silhouette pleine, fixe. Hors combat.
 */
function ficheImage(img, a, verrou) {
  if (!img || !(a >= 0 && a < AGENT_COUNT)) return;
  const B = PORTRAIT.boucles[a];
  img.style.setProperty('--n', String(B.images));
  img.style.setProperty('--dur', B.dureeS + 's');
  img.style.setProperty('--dir', B.allerRetour ? 'alternate' : 'normal');
  if (verrou) {
    img.classList.remove('sr-anime');
    appliquerSil(img, a, true);
    return;
  }
  portraitAnime(img, a);
}

/** Vignette img de l'agent a : silhouette pleine si verrouillé, sinon son portrait. Hors combat. */
function appliquerSil(img, a, verrou) {
  if (!img || !(a >= 0 && a < AGENT_COUNT)) return;
  if (!silImgs.some((s) => s.img === img)) silImgs.push({ img, a });
  else for (const s of silImgs) if (s.img === img) s.a = a;
  img.dataset.sil = verrou ? '1' : '0';
  const src = verrou ? SIL[a] || '' : AGENT_SCREEN.portraits[a];
  if (verrou && !SIL[a]) {
    img.style.visibility = 'hidden'; // jamais le vrai portrait d'un verrouillé, même avant la silhouette
    return;
  }
  img.style.visibility = '';
  if (img.getAttribute('src') !== src) img.src = src;
}

/** Tests (§ E4.L) : hôte de la fiche (la pause), nombre de fiches, silhouettes prêtes. */
export function ficheInspect() {
  return { hote: 'pause', fiches: document.querySelectorAll('.sr-fiche').length, silhouettes: SIL.filter(Boolean).length };
}

//#region e5:L-textes-guide
// ===== Lot 1 du guide UX (ARCHITECTURE.md § E5.L, 20/11) : textes compris au 1er lancement ===========================

/** § E5.L : tests (?debug) — consignes actives malgré ?debug, et leur état. */
export function consignesForcer(on) {
  return consignes.forcer(on);
}
export function consignesInfo() {
  return consignes.inspect({});
}

/** § E5.L (A4) : 1er lancement — journal des versions replié (main.js, après la lecture de la méta). */
export function notesPremierLancement() {
  return notes.premierLancement();
}

/** « Optimisé » → « Optimisé · rareté 3/6 » (nom de la DA + rang) ; un nom inconnu reste tel quel. Hors combat. */
function rangRarete(nom) {
  for (let r = 0; r < RARITIES.length; r++) if (RARITIES[r].name === nom) return rareteTexte(r);
  return nom;
}
//#endregion e5:L-textes-guide

// ===== § E5.X7 — lot 11 de l'audit (A13 / F6, H6) : HUD qui dit ce qu'il montre ========================================
// Le HUD garde pointer-events: none ; seules les cases d'arme et d'objet, la pastille des fragments et la puce CPU
// reçoivent le survol (ui.css, bloc § E5.X7). Une SEULE bulle (pointer-events: none), posée dans la case et remplie au survol : les textes
// sont faits à ce moment-là (un geste de la souris, jamais dans update). Le clic droit du déplacement à la souris
// n'est pas gêné : input.js écoute window (l'évènement remonte depuis la case) et lit clientX / clientY.
let bulleX7 = null;
let bulleX7Cle = '';
let shopSoinX7 = null; // § E5.X7 (H6) : « Soin du marchand : +N PV » sous le titre « Décryptage »

function hudX7(weaponBox, itemBox, frag) {
  weaponBox.dataset.lab = HUD_X7.armes; // libellés courts (ui.css : attr(data-lab), pseudo-élément : aucun enfant de plus)
  itemBox.dataset.lab = HUD_X7.objets;
  for (let k = 0; k < weaponBox.children.length; k++) weaponBox.children[k].dataset.x7 = 'a' + k;
  for (let k = 0; k < itemBox.children.length; k++) itemBox.children[k].dataset.x7 = 'o' + k;
  frag.dataset.x7 = 'f';
  const pc = hud.querySelector('.sr-hud-puce');
  if (pc) pc.dataset.x7 = 'p';
  bulleX7 = el('div', 'sr-hud-bulle');
  bulleX7.setAttribute('role', 'tooltip');
  hud.appendChild(bulleX7); // déplacée dans la case survolée (bulleX7Montrer)
  hud.addEventListener('pointerover', (e) => {
    const c = e.target && e.target.closest ? e.target.closest('[data-x7]') : null;
    if (c) bulleX7Montrer(c);
  });
  hud.addEventListener('pointerout', (e) => {
    const c = e.target && e.target.closest ? e.target.closest('[data-x7]') : null;
    if (c && !(e.relatedTarget && c.contains(e.relatedTarget))) bulleX7Cacher();
  });
}

/** Lignes de la bulle de la case c (hors combat : au survol). */
function bulleX7Lignes(cle) {
  const k = Number(cle.slice(1));
  if (cle[0] === 'a') {
    const w = weapons !== null ? weapons.slots[k] : -1;
    if (!(w >= 0)) return ['Case d’arme vide', 'Un coffre peut vous donner une arme.'];
    const ev = evoDe(w);
    return [HUD_X7.arme.replace('{n}', ev >= 0 ? EVOLUTIONS[ev].name : WEAPONS[w].name).replace('{v}', intStr(weapons.getWeaponLevel(w))), ev >= 0 ? EVOLUTIONS[ev].rule : WEAPONS[w].desc];
  }
  if (cle[0] === 'o') {
    const id = itemsMod !== null ? itemsMod.slots[k] : -1;
    if (!(id >= 0)) return ['Case d’objet vide', 'Les cartes de niveau et les coffres donnent des objets.'];
    const t = HUD_X7.objet.replace('{n}', ITEM_TITLE[id]).replace('{v}', intStr(itemsMod.slotStacks(k)));
    if (id >= ITEM_COUNT) return [t, ITEMS[FUSIONS[id - ITEM_COUNT].a].name + ' + ' + ITEMS[FUSIONS[id - ITEM_COUNT].b].name];
    const I = ITEMS[id];
    return [t, I.what.charAt(0).toUpperCase() + I.what.slice(1) + ' : ' + itemText(id, itemsMod.getStacks(id))];
  }
  return cle === 'f' ? HUD_X7.fragments : HUD_X7.puce;
}

function bulleX7Montrer(c) {
  if (bulleX7 === null || screen !== SCREEN.NONE) return;
  const cle = c.dataset.x7;
  bulleX7Cle = cle;
  const lignes = bulleX7Lignes(cle);
  bulleX7.replaceChildren();
  for (let q = 0; q < lignes.length; q++) bulleX7.appendChild(el('div', q === 0 ? 'sr-hud-bulle-t' : 'sr-hud-bulle-l', lignes[q]));
  // placée par ui.css DANS la case survolée (toutes positionnées) : au-dessus d'une arme, à droite d'un objet ou de la
  // puce, sous les fragments — aucune lecture de mise en page dans ui.js (règle contrôlée par tests/ui.test.mjs)
  if (bulleX7.parentNode !== c) c.appendChild(bulleX7);
  bulleX7.className = 'sr-hud-bulle sr-on sr-hud-bulle-' + cle[0];
}

function bulleX7Cacher() {
  if (bulleX7 === null || bulleX7Cle === '') return;
  bulleX7Cle = '';
  bulleX7.className = 'sr-hud-bulle';
}

/** § E5.X7 (A13) : bloc « Repères du HUD » de la fiche (pause). */
function legendeX7() {
  const box = el('div', 'sr-fiche-legende');
  box.appendChild(el('div', 'sr-fiche-legende-t', HUD_X7.legendeTitre));
  for (const l of HUD_X7.legende) box.appendChild(el('div', 'sr-fiche-legende-l', l));
  return box;
}

/** Tests : bulle affichée { cle, texte } (null : cachée) ; sa place se mesure dans le test (.sr-hud-bulle). */
export function bulleX7Inspect() {
  if (bulleX7 === null || bulleX7Cle === '') return null;
  return { cle: bulleX7Cle, texte: [...bulleX7.children].map((n) => n.textContent) };
}
