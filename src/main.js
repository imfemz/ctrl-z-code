// FONDATION : main.js — démarrage, boucle, machine à états, actions de l'interface, persistance
// (contrat : ARCHITECTURE.md § C, § D, § R, § T). Seul module qui importe les autres : il construit ctx.
import {
  ACTION,
  AUDIO,
  BUY,
  CLEAR_PHASE,
  DEBUG,
  LOOP,
  MENU,
  PROGRESSION,
  SCREEN,
  SFX,
  SHAKE,
  SHOP,
  STATE,
  STORAGE,
  UI,
  WAVES,
} from './config.js';
import { P, run, seedRandom } from './state.js';
import * as camera from './camera.js';
import * as render from './render.js';
import * as world from './world.js';
import * as input from './input.js';
import * as verrou from './verrou.js'; // § E5.AB : verrou du pointeur en partie (caméra derrière l'agent, curseur du jeu)
import * as audio from './audio.js';
import * as grid from './grid.js';
import * as damage from './damage.js';
import * as player from './player.js';
import * as enemies from './enemies.js';
import * as boss from './boss.js';
import * as hazards from './hazards.js';
import * as tirsCanon from './tirs-canon.js'; // § E4.J : ancien visuel des balles des robots à canon (maillage « tirs-ennemis »)
import * as events from './events.js';
import * as weapons from './weapons.js';
import * as pickups from './pickups.js';
import * as progression from './progression.js';
import * as waves from './waves.js';
import * as shop from './shop.js';
import * as fx from './fx.js';
import * as soinHeros from './soin-heros.js'; // § E5.Q (B14) : retour propre au soin du héros
import { CAUSE_COUNT, CAUSE_GROUPE, CAUSE_GROUPE_COUNT, CAUSE_TEXTE, RETOURS_GUIDE } from './config.js'; // § E5.Q (C2)
import { MORT_CLAIRE } from './config.js'; // § E5.AK : une phrase par cause à l'écran de fin
import * as ui from './ui.js';
import * as hudVoile from './hud-voile.js'; // § E5.M (B11) : le HUD du haut s'efface quand le boss passe dessous
import * as silhouetteHeros from './silhouette-heros.js'; // § E5.P (B1) : silhouette du héros dans la foule, par-dessus tout
import * as debug from './debug.js';
import * as chests from './chests.js'; // § E2.C : coffres, roulette
import * as disquette from './disquette.js'; // § E4.Q : Sauvegarde lâchée par un boss (disquette au sol)
import { CHESTS, PICK } from './config.js'; // § E2.C
import { charger as chargerModeles, chargerAgent, oublierAgent, avertirSkin } from './rendu/modeles.js';
import * as memoire from './memoire.js'; // § E5.K : attente du modèle de l'agent, contexte WebGL perdu
import * as incident from './incident.js'; // § E5.X2 : erreur pendant une image, sauvegarde abîmée
import { MEMOIRE } from './config.js'; // § E5.X2 : textes de l'avis de sauvegarde
import * as vfx from './vfx/projectiles.js'; // projectiles « toon » (§ Z septies) : lots écrits par weapons et enemies
import { creerAccueil } from './menu/accueil.js'; // écran titre peint (Écran Agents, tâche 7) : fond + agent choisi en vitrine 3D + poussière
import * as agents from './agents.js'; // § E2.D : les trois agents
import * as items from './items.js'; // § E2.F : objets passifs
import * as domeParefeu from './vfx/dome-parefeu.js'; // § E5.B : dôme hexagonal du Pare-feu (1 appel de dessin quand on l'a)
import * as brumeOmbre from './vfx/brume-ombre.js'; // skin ombre (tâche 4) : fumée aux pointes de la cape + sillage de brume
import * as coqueReactive from './vfx/coque-reactive.js'; // § E5.H : visuel de la Coque réactive (1 appel de dessin quand on l'a)
import * as elites from './elites.js'; // § E3.A : élites à modificateurs
import * as barres from './barres-vie.js'; // § E4.H : petite barre de vie des gros robots
import { AGENTS, AGENT_COUNT, AGENT_SCREEN, CHOICES, isBossWave } from './config.js'; // § E2.D
import { isPauseWave, PALIERS_VAGUES } from './config.js'; // § E5.V : la fin d'une vague bascule à la volée, sauf la veille d'un boss
import * as terminal from './terminal.js'; // § E5.V : le terminal posé dans l'arène (vagues 2, 7, 12…)
import { TPRET } from './terminal.js';
import * as props from './props.js'; // § E3.C : décors cassables
import * as inviteInteragir from './invite-interagir.js'; // § E5.C : invite « touche » au-dessus de la borne prête
import { ACTION_INTERACT } from './config.js'; // § E5.C : action « Interagir » (coup de pied sur une borne)
import { skinsDe, SKIN_BASE } from './config.js'; // Écran Agents : skin visé dans la fiche
import { ACTION_FICHE } from './config.js'; // menus « Pile » (19/11) : Tab = fiche de l'agent
import * as utilities from './utilities.js'; // § E3.C : utilitaires
import * as ramassage from './ramassage.js'; // § E5.E.2 : compteurs de ramassage (lus par le récap de ui.js)
import { RECAP_T } from './config.js'; // § E5.X7 (H6) : soin de bascule et relance du boss, dans le récap
import * as combosEtat from './anim/combos.js'; // § E5.E.7 : état des combos (repère du HUD)
import { HAM_GAP, KAT_GAP } from './weapons-agents.js'; // § E5.E.7 : pause avant le prochain combo du katana ; § E5.F.14 : du marteau
import * as cooldowns from './cooldowns.js'; // § E3.H : sources à recharge
import { CARRY } from './config.js'; // § E3.K : survivants reportés
import { REPLI } from './config.js'; // § E4.F : repli puis retour
import { CHEST_FLAG, EFLAG, ENEMY } from './config.js'; // fusion du groupe 1 : coffre de rattrapage des porteuses reportées
import { E } from './state.js'; // § E3.K : robots en vie reportés
import * as evolutions from './evolutions.js'; // § E3.B : évolutions des armes
import * as meta from './meta.js'; // § E3.0.3 : méta-progression (socle 2)
import * as consignes from './consignes.js'; // § E5.L : consignes une fois par profil
import * as mortClaire from './mort-claire.js'; // § E5.AK : cause de la mort évidente (ralenti en solo, caméra, repère)
import * as defis from './defis.js'; // § E4.A : compteurs et succès de la partie
import { META } from './config.js'; // § E4.A : paramètre ?debug&meta=
import { HEROS_IDLE } from './config.js'; // § E4.E.3 : Warrior Idle (fiche et partie)
import { chargerCuit } from './menu/cuit-menu.js'; // § E4.E.3 : pistes cuites de l'idle
import { setIdle as herosSetIdle } from './anim/heros-anim.js'; // § E4.E.3
import { COUP_DE_PIED } from './config.js'; // § E4.O : coup de pied cuit
import * as coupPiedCuit from './anim/coup-pied.js'; // § E4.O
import * as bondCuit from './anim/bond-cuit.js'; // § E5.F : « Jump Attack » du bond du Bastion
import { BOND_CUIT } from './config.js'; // § E5.F
import { IDLES_AGENTS, VITRINE } from './config.js'; // § E5.F : idle de chaque agent ; VITRINE : idles de l'écran Agents
import * as herosIdles from './anim/heros-anim.js'; // § E5.F : setIdleAgent, setIdleMarteau
import { DEFIS } from './config.js'; // § E4.C : noms des succès de la partie au bilan
import * as bilan from './bilan.js'; // § E4.C : bilan par arme de l'écran de fin
import { HUB, META_BUY } from './config.js'; // § E4.B : le hub « Noyau »
import { FUSION_SCREEN } from './config.js'; // § E3.F : moment de fusion
import * as pseudo from './pseudo.js'; // 16/11 (R7)
import * as pauseAgent from './pause-agent.js'; // § E3.I : l'agent en 3D dans la fiche de la pause

const params = new URLSearchParams(location.search);
// Écran Agents, tâche 7 : l'ancienne scène 3D du titre (src/menu/menu.js : héros, boss, grille) n'est plus chargée que
// pour l'OUTIL de cuisson des animations (tests/cuire-anim.mjs : ?fbx= / ?modele= ; banque UAL : ?anim=) — elle y sert
// d'écran titre ; sinon l'écran titre est l'accueil peint (src/menu/accueil.js).
const SCENE_OUTIL = params.has('fbx') || params.has('modele') || params.has('anim');

/** État de la machine (§ D.1). Seul main.js y écrit. */
const game = {
  pauseForcee: false, // § E5.V : crochet de test (debug.forcePause) — la prochaine fin de vague est un arrêt complet
  state: STATE.TITLE,
  returnState: null,
  phase: null,
  stateTime: 0,
  countdown: 0,
  frame: 0,
  debug: params.has(DEBUG.urlFlag),
  // Modèles Blender des unités (§ Z quinquies) : 'chargement' → 'pret' (ou 'erreur'). Lu par start() et l'écran titre.
  modeles: 'chargement',
  // Scène 3D de l'écran titre (§ Z octies) : 'chargement' → 'pret' (ou 'erreur' : fond uni, le jeu reste jouable).
  menu: 'chargement',
  settings: { shake: SHAKE.defaultIntensity, volume: AUDIO.masterVolume, sfx: 1, musique: 1, graphismes: REGLAGES.graphismesDefaut, deplacement: params.has(DEBUG.urlFlag) ? REGLAGES.deplacementDefautDebug : REGLAGES.deplacementDefaut, migrDeplacement: 1, flashs: REGLAGES.flashsDefaut, sensibilite: REGLAGES.sensibilite.defaut }, // § E5.AG : sensibilité de la souris ; § E5.AB.13 : Souris par défaut (tests ?debug : Clavier) ; marque de la migration unique vers Souris (écrite avec les réglages) // sfx, musique, graphismes : réglages de Femz (21/11)
  best: null,
  // § E1.D : le record a été battu PENDANT cette partie (bannière et son joués une fois ; la pastille du HUD passe au cyan)
  recordBeaten: false,
};

const actions = { start, pause, resume, restart, quitToTitle, chooseBonus, buy, finishShopping, setShake, setVolume, setInfosOpen, setSecousses, setVolSfx, setVolMusique, setGraphismes, setDeplacement };
// § E2.C : actions de l'écran du coffre
actions.takeLot = takeLot;
actions.rerollLots = rerollLots;
actions.skipLots = skipLots;
actions.banishLot = banishLot;
actions.armBanish = armBanish; // § E2.C et § E2.D : un seul bouton « Bannir », aiguillé par l'état (CHEST ou LEVELUP)
actions.skipChestAnimation = skipChestAnimation;
// § E2.D : relance, passe et bannissement au choix de niveau
actions.rerollChoices = rerollChoices;
actions.skipChoice = skipChoice;
actions.banishChoice = banishChoice;
actions.closeFusion = closeFusion; // § E3.F
// Écran Agents (tâche 5) : grille des agents (« Jouer » du titre, onglet Agents du Noyau), fiche perso (tâche 6)
actions.agentsOuvrir = agentsOuvrir;
actions.agentFiche = agentFiche;
actions.agentJouer = agentJouer;
actions.agentRetour = agentRetour;
actions.agentSkin = agentSkin;
// § E4.B : le hub « Noyau »
actions.openHub = enterHub;
actions.quitHub = quitHub;
actions.hubPlay = hubPlay;
actions.hubBuy = hubBuy;
actions.hubReset = hubReset;
actions.hubGuard = hubGuard;
// § E5.K (tests, debug.js) : promesse de la lecture en cours du modèle de run.agent (null : rien en lecture). Elle se résout
// à l'arrivée des données ; elles sont posées par l'image suivante (agentsTraiter).
actions.attenteAgent = () => agentsPromesses[creneau(run.agent, skinHeros(run.agent))];

const ctx = {
  canvas: document.getElementById('game'),
  uiRoot: document.getElementById('ui-root'),
  renderer: null, // rempli par render.init
  menu: null, // écran titre (src/menu/accueil.js ; outil de cuisson : src/menu/menu.js), rempli à son arrivée (§ Z octies)
  scene: null, // rempli par render.init
  game,
  actions,
  camera, render, world, input, audio, grid, damage, player, enemies, boss, hazards, events, weapons,
  pickups, progression, waves, shop, fx, ui, debug,
};
ctx.chests = chests; // § E2.C
ctx.disquette = disquette; // § E4.Q (lu par boss, debug)

ctx.agents = agents; // § E2.D (lu par progression, et par les coffres du chantier C : agents.excludes)
ctx.items = items; // § E2.F (lu par damage, progression, chests, ui, debug)
ctx.elites = elites; // § E3.A (lu par waves, damage, debug)
ctx.barres = barres; // § E4.H (lu par debug)
ctx.props = props; // § E3.C (lu par damage.explode, weapons.updateProjectiles)
ctx.utilities = utilities; // § E3.C (lu par damage, player, props, ui)
ctx.ramassage = ramassage; // § E5.E.2 (écrit par pickups, utilities, chests ; lu par ui : récap des ramassages)
ctx.comboHud = { combos: combosEtat, gapLame: weapons.ATT_GAP, gapKatana: KAT_GAP, gapMarteau: HAM_GAP }; // § E5.E.7 : repère de combo du HUD (lecture seule)
ctx.evolutions = evolutions; // § E3.B (lu par damage, weapons, weapons-agents, chests)
ctx.cooldowns = cooldowns; // § E3.H (lu par weapons, weapons-agents, items, ui)
ctx.pseudo = pseudo; // 16/11 (R7) : pseudo du joueur (stockage), lu par ui
ctx.meta = meta; // § E3.0.3 (lu par ui : fiche de la pause, recettes de fusion découvertes — fusion du groupe 2)
ctx.consignes = consignes; // § E5.L : bulles de consigne (lues par ui.js : construites dans le HUD, mises à jour par ui.update)
ctx.defis = defis; // § E4.A (lu par ui : textes des notifications ; par le hub : progression des succès)
ctx.mortClaire = mortClaire; // § E5.AK (lu par debug : crochets des tests)

// Privé à la machine
let savedStateTime = 0; // stateTime de l'état interrompu par PAUSED ou LEVELUP
// § E2.D : bannissement armé (touche B ou bouton « Bannir ») — le prochain choix de carte bannit au lieu de prendre
let banArmed = false;
// § E2.D : l'écran Agents (grille puis fiche, tâches 5 et 6) est sauté en ?debug (les tests lancent le jeu en debug), sauf ?debug&agent=choix
const agentParam = params.get(AGENT_SCREEN.urlParam);
const agentScreenOff = params.has(DEBUG.urlFlag) && agentParam !== AGENT_SCREEN.urlChoice;
// Écran Agents (tâche 5) : vue grille ou fiche ; origine : d'où il a été ouvert (« Retour » de la grille y ramène) ;
// agent : la carte visée (grille) ou l'agent de la fiche ; skinVise : le skin regardé dans la fiche (tâche 6)
const agentView = { vue: 'grille', origine: 'titre', agent: 0, skinVise: null, best: null };
// Écran Agents (tâche 6) : agent montré par la vitrine 3D de la fiche (-1 : aucune). Son modèle est lu s'il ne l'est pas
// (§ E5.K) et GARDÉ tant que sa fiche est ouverte, même s'il n'est pas l'agent de la partie ; libéré à sa fermeture.
let agentVitrine = -1;
let skinVitrine = SKIN_BASE; // skin du modèle montré par la fiche (agentVitrine) : le skin visé s'il est débloqué, sinon la base
const ONGLET_AGENTS = HUB.onglets.findIndex((o) => o.key === 'agents');
const ONGLET_COLLECTION = HUB.onglets.findIndex((o) => o.key === 'collection');
const hubView = { best: 0, agent: 0, tab: ONGLET_COLLECTION }; // § E4.B : vue du hub (vague record, agent de départ, onglet à l'ouverture)
let ongletNoyau = ONGLET_COLLECTION; // onglet du Noyau ouvert avant l'écran Agents (« Retour » y ramène, jamais Agents)
const agentMove = new Int8Array(2); // Écran Agents : direction des flèches à l'image précédente (fronts)
const hubMove = new Int8Array(2); // § E4.B : direction des flèches à l'image précédente (fronts des flèches dans le hub)
const shopMoveMem = new Int8Array(2); // § E4.S.8 : idem dans le marchand (focus des lignes d'achat)
let arrivalStarted = false; // shop.beginArrival() déjà appelé pour cette vague
let carryMergePending = false; // § E4.F.3 : fusion au plafond en attente (faite quand tous les reportés sont garés)
let chestGuard = 0; // § E2.C : stateTime à partir duquel un lot du coffre ouvert peut être pris (fin de la roulette)
let chestBanish = false; // § E2.C : B a été pressé, le prochain 1 / 2 / 3 bannit un lot
// Horodatage de l'image précédente (ms). Dans un tableau typé : une variable de module qui reçoit un flottant à
// chaque image coûte un nombre alloué à chaque écriture (§ V).
const previous = new Float64Array(1).fill(-1);

// Modèles des unités (§ Z quinquies) : chargés en arrière-plan dès le démarrage ; posés avant le préchauffage s'ils sont
// déjà là, sinon au début de l'image qui suit leur arrivée (frame), pendant l'écran titre.
let modelesArrives = null; // données de src/rendu/modeles.js, en attente d'être posées
let modelesNouveau = false; // arrivée ou échec à traiter au début de la prochaine image
// Capsule de ravitaillement (§ E1.C) : son modèle arrive après le préchauffage de l'init ; à son arrivée (ou son échec),
// un préchauffage de plus envoie sa géométrie hors combat (§ T). window.__game attend ce moment, comme pour les unités.
let capsuleNouvelle = false; // arrivée ou échec à traiter au début de la prochaine image
// 20/11 : préchauffages SANS BLOCAGE en cours (render.prewarmAsync) — l'écran de chargement attend qu'ils soient finis
let shadersEnAttente = 0;

/**
 * Préchauffage sans bloquer la page (démarrage, arrivée des modèles) : les programmes sont demandés à la carte
 * graphique, qui les compile en parallèle pendant que la page vit (barre, son) ; quand ils sont prêts, le prewarm
 * habituel (rapide alors) envoie les géométries et finit les ombres et les passes, puis l'écran de chargement est prévenu.
 */
function prechaufferSansBloquer() {
  shadersEnAttente++;
  render.prewarmAsync().then(() => {
    shadersEnAttente--;
    render.prewarm();
    pauseAgent.prechauffer(); // programme du portrait de la pause (§ E3.I), si le héros est posé
    tenterPublier();
  });
}
let capsulePosee = false;
let departDemande = false; // « Jouer » demandé pendant le chargement : la partie démarre dès qu'ils sont posés
const modelesInfo = { ms: 0, erreur: '' };
// § E5.K : un seul agent détaillé en mémoire. Un autre agent est lu au moment où il est choisi (demanderModeleAgent) ;
// ses données arrivent dans agentsArrives (traitées au début d'une image, agentsTraiter), l'ancien est alors libéré.
const SKINS_MAX = 4; // skins lisibles en même temps par agent (créneaux de lecture)
for (const ag of AGENTS) {
  // garde d'init : un agent qui aurait plus de skins que de créneaux de lecture se marcherait dessus (créneau agent × skin)
  if (skinsDe(ag.key).length > SKINS_MAX) console.error(`SKINS_MAX (${SKINS_MAX}) trop petit : l'agent ${ag.key} a ${skinsDe(ag.key).length} skins (base comprise)`);
}
const agentsEnLecture = new Uint8Array(AGENT_COUNT * SKINS_MAX); // 1 : lecture en cours (créneau agent × skin)
const agentsArrives = []; // { a, skin, d, erreur } en attente de traitement
const agentsPromesses = new Array(AGENT_COUNT * SKINS_MAX).fill(null); // lecture en cours (résolue à l'arrivée, avant agentsTraiter)
let lancementDemande = null; // état (STATE.*) où « Jouer » attend le modèle de run.agent ; null : rien en attente
const agentsInfo = { lus: 0, liberes: 0, ms: 0 }; // tests (§ E5.K)

// Écran titre (tâche 7 : l'accueil peint ; outil de cuisson : la scène 3D de menu.js) : chargé en arrière-plan après
// render.init (même renderer, UN seul contexte WebGL) ; branché au début de l'image qui suit son arrivée. Affiché aux états
// TITLE et HUB (le Noyau est posé dessus), caché à l'écran Agents (plein écran, opaque) et dès le lancement d'une partie.
let menu = null;
let menuArrive = null;
let menuNouveau = false;
let menuPromesse = null;
const menuInfo = { ms: 0, erreur: '' };
ctx.menuInfo = menuInfo; // lu par debug.snapshot().menu
// § E5.K : lu par debug.snapshot().memoire
const inspectJoueur = {};
ctx.incidentInfo = () => incident.inspect({ sauvegarde: { ...meta.etatSauvegarde() } }); // § E5.X2
ctx.memoireInfo = () =>
  memoire.inspect({
    arrives: agentsArrives.length,
    lus: agentsInfo.lus,
    liberes: agentsInfo.liberes,
    msDernier: agentsInfo.ms,
    enLecture: Array.from(agentsEnLecture),
    lancementDemande,
    charges: (player.inspect(inspectJoueur), inspectJoueur.modelesCharges),
  });
// Racine du jeu (adresse absolue) : les .glb du menu partagent le cache de src/rendu/glb.js avec ceux du jeu (mêmes clés).
const RACINE = new URL('../', import.meta.url).href;

// Vues persistantes passées à l'interface
const titleView = { best: null, layout: 'unknown', shake: 1, volume: 1, loading: true, queued: false, error: '', infosOpen: false };
const pauseView = { shake: 1, volume: 1, layout: 'unknown' };
const overView = { wave: 0, kills: 0, level: 0, time: 0, best: null, isNewBest: false, bilan: null }; // bilan : § E4.C

// ----- Persistance (§ R) : toute lecture et toute écriture sous try / catch -------------------------------------------

let migrationDeplacement = false; // § E5.AB.13 : la migration vient d'avoir lieu (réglages réécrits une fois après la lecture)
function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE.settingsKey);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Number.isFinite(o.shake) && o.shake >= 0 && o.shake <= 1) game.settings.shake = o.shake;
      if (o && Number.isFinite(o.volume) && o.volume >= 0 && o.volume <= 1) game.settings.volume = o.volume;
      if (o && Number.isFinite(o.zoom)) game.settings.zoom = o.zoom; // § E2.E : borné par camera.setZoom (appliquerZoomSauve)
      if (o && typeof o.camera === 'string') game.settings.camera = o.camera; // § E3.L : vérifié par camera.setReglage
      // Réglages de Femz (21/11) : volumes des effets sonores et de la musique (sous le volume général, gardé), graphismes
      const vol = (x) => Number.isFinite(x) && x >= 0 && x <= 1;
      if (o && vol(o.sfx)) game.settings.sfx = o.sfx;
      if (o && vol(o.musique)) game.settings.musique = o.musique;
      if (o && REGLAGES.graphismes.some((g) => g.key === o.graphismes)) game.settings.graphismes = o.graphismes;
      if (o && REGLAGES.deplacement.some((g) => g.key === o.deplacement)) game.settings.deplacement = o.deplacement;
      //#region e5:AB-camera-3p
      // § E5.AB.13 (Femz, 22/11 : « passe tout le monde en souris ») : migration UNIQUE — des réglages enregistrés sans la
      // marque passent en Souris et la marque est écrite ; ensuite un retour en Clavier est gardé (jamais rejouée). Pas en
      // ?debug (les tests gardent leur défaut Clavier).
      if (o && o.migrDeplacement !== 1 && !game.debug) {
        game.settings.deplacement = 'souris';
        migrationDeplacement = true;
      }
      //#endregion e5:AB-camera-3p
      if (o && REGLAGES.flashs.some((g) => g.key === o.flashs)) game.settings.flashs = o.flashs; // § E5.X5
      if (o && Number.isFinite(o.sensibilite) && o.sensibilite >= REGLAGES.sensibilite.min && o.sensibilite <= REGLAGES.sensibilite.max) game.settings.sensibilite = o.sensibilite; // § E5.AG
    }
  } catch (e) {
    /* valeurs par défaut */
  }
  try {
    const raw = localStorage.getItem(STORAGE.bestKey);
    if (raw) {
      const o = JSON.parse(raw);
      const ok =
        o && Number.isFinite(o.wave) && o.wave >= 0 && Number.isFinite(o.kills) && o.kills >= 0 && Number.isFinite(o.level) && o.level >= 1 && Number.isFinite(o.time) && o.time >= 0;
      if (ok) game.best = { wave: o.wave, kills: o.kills, level: o.level, time: o.time };
    }
  } catch (e) {
    /* pas de meilleur score */
  }
}

/** Panneau d'infos de l'écran titre déplié ou replié : un réglage d'affichage, gardé d'une visite à l'autre. */
function loadInfosOpen() {
  try {
    return localStorage.getItem(STORAGE.infosKey) === '1';
  } catch (e) {
    return false; // stockage indisponible : replié
  }
}

function setInfosOpen(open) {
  titleView.infosOpen = !!open;
  try {
    localStorage.setItem(STORAGE.infosKey, open ? '1' : '0');
  } catch (e) {
    /* stockage indisponible : l'état vaut pour cette visite */
  }
}

/** § E4.I : petit réglage d'affichage (catégories repliées, notes de version lues) — chaîne ou null ; try/catch. */
function prefLire(key) {
  try {
    const v = localStorage.getItem(key);
    return typeof v === 'string' ? v : null;
  } catch (e) {
    return null; // stockage indisponible
  }
}

function prefEcrire(key, value) {
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch (e) {
    return false; /* stockage indisponible : vaut pour cette visite */
  }
}
actions.prefLire = prefLire;
actions.prefEcrire = prefEcrire;

function saveSettings() {
  try {
    localStorage.setItem(STORAGE.settingsKey, JSON.stringify(game.settings));
  } catch (e) {
    /* stockage indisponible : le jeu continue */
  }
}

// ----- § E3.L : réglage de caméra (bloc du chantier L) -----------------------------------------------------------------
import { CAMERA } from './config.js'; // § E3.L (import remonté par le module, comme tout import)
import { REGLAGES } from './config.js'; // réglages de Femz (21/11) : graphismes, volumes, secousses
import { CONFORT_FLASHS } from './config.js'; // § E5.X5 : réglage « Flashs »
import { SENSIBILITE_SOURIS } from './config.js'; // § E5.AG : réglage « Sensibilité de la souris »
let cameraASauver = false; // réglage changé en combat : enregistré au prochain écran hors combat (JSON jamais en combat)

/** Au chargement, après loadSave : le réglage sauvé est posé sans transition ; clé inconnue ou absente → par défaut. */
function appliquerCameraSauvee() {
  if (camera.setReglage(game.settings.camera, true) === null) camera.setReglage(CAMERA.reglageDefaut, true);
  game.settings.camera = camera.getReglage();
  window.addEventListener('pagehide', () => {
    if (cameraASauver) saveSettings(); // onglet fermé en pleine partie
  });
}

/** Réglage de caméra choisi (Paramètres, touche C) : l'inclinaison le rejoint en douceur. Rend la clé, ou null. */
function setCamera(cle) {
  const k = camera.setReglage(cle);
  if (k === null) return null;
  game.settings.camera = k;
  const s = game.state;
  if (s === STATE.PLAYING || s === STATE.WAVE_CLEAR || s === STATE.COUNTDOWN) cameraASauver = true;
  else saveSettings();
  ui.refreshCamera && ui.refreshCamera();
  return k;
}
actions.setCamera = setCamera;

/** Une fois par image (handleKeys) : C passe au réglage suivant en partie, en pause et en boutique ; sauvegarde différée. */
function toucheCamera() {
  const s = game.state;
  const enJeu = s === STATE.PLAYING || s === STATE.WAVE_CLEAR || s === STATE.COUNTDOWN;
  if ((enJeu || s === STATE.PAUSED || s === STATE.SHOP) && input.pressed(ACTION.CAMERA)) setCamera(CAMERA.reglages[(camera.view.reglage + 1) % CAMERA.reglages.length].key);
  if (cameraASauver && !enJeu) {
    cameraASauver = false;
    saveSettings();
  }
}

// ----- § E2.E : zoom à la molette (bloc du chantier E) ----------------------------------------------------------------
let zoomCransSauves = 0; // zoom demandé (en crans) au dernier enregistrement

/** Au chargement, après loadSave : le zoom sauvé est posé sans animation ; les réglages portent toujours une clé zoom. */
function appliquerZoomSauve() {
  camera.setZoom(game.settings.zoom, true); // valeur absente ou non finie : refusée, le recul maximum reste
  game.settings.zoom = camera.getZoom();
  zoomCransSauves = camera.getZoomSteps();
}

/** Le zoom demandé a changé depuis le dernier enregistrement : il rejoint les réglages (JSON : jamais en combat). */
function sauverZoom() {
  if (camera.getZoomSteps() === zoomCransSauves) return;
  zoomCransSauves = camera.getZoomSteps();
  game.settings.zoom = camera.getZoom();
  saveSettings();
}

/**
 * Une fois par image, avant camera.update : en partie la molette règle le zoom demandé ; ailleurs (titre, pause,
 * boutique, choix de niveau, fin de partie) elle est sans effet, et c'est là que le zoom est enregistré.
 */
function zoomMolette() {
  const s = game.state;
  if (s === STATE.PLAYING || s === STATE.WAVE_CLEAR || s === STATE.COUNTDOWN) camera.addZoomSteps(input.consumeWheel());
  else {
    input.dropWheel();
    sauverZoom();
  }
}

// § E5.V tâche 3 : record à écrire dans le stockage au prochain moment hors combat (jamais d'écriture en combat)
let recordAEcrire = false;

/**
 * § E5.V tâche 3 — premier moment hors combat (coffre, choix de niveau, fusion, pause, décryptage, compte à rebours,
 * fin de partie) : succès de la partie et record écrits (une bascule à la volée les a seulement évalués).
 */
function horsCombat() {
  defis.flush();
  if (recordAEcrire) {
    recordAEcrire = false;
    saveBest();
  }
}

function saveBest() {
  try {
    localStorage.setItem(STORAGE.bestKey, JSON.stringify(game.best));
  } catch (e) {
    /* stockage indisponible : le jeu continue */
  }
}

/**
 * § E2.D — agent de départ : le dernier choisi (STORAGE.agentKey, un entier). En ?debug sans « agent=choix » : agent 0,
 * ou celui de ?agent=1 / ?agent=2 (les tests ne dépendent pas de ce qu'un autre a laissé dans le stockage).
 */
function loadAgent() {
  if (agentScreenOff) {
    agents.setAgent(agentSauve());
    return;
  }
  const a = agentSauve();
  if (a > 0) agents.setAgent(a); // verrouillé (méta) : refusé, l'agent 0 reste
}

/**
 * § E5.K : l'agent sauvegardé (ou celui de ?agent= en ?debug), sans contrôle des verrous (la méta n'est pas encore lue) :
 * c'est le modèle lu au démarrage. Verrouillé : loadAgent le refuse et le modèle de l'Éclaireur est lu ensuite.
 */
function agentSauve() {
  let a = 0;
  if (agentScreenOff) a = agentParam === null ? 0 : Number(agentParam);
  else {
    try {
      const raw = localStorage.getItem(STORAGE.agentKey);
      if (raw !== null && raw !== '') a = Number(raw);
    } catch (e) {
      /* stockage indisponible : agent 0 */
    }
  }
  return Number.isInteger(a) && a >= 0 && a < AGENT_COUNT ? a : 0;
}

function saveAgent() {
  try {
    localStorage.setItem(STORAGE.agentKey, String(agents.getAgent()));
  } catch (e) {
    /* stockage indisponible : le choix vaut pour cette visite */
  }
}

// ----- Réinitialisation (§ T) ------------------------------------------------------------------------------------------

function pickSeed() {
  if (game.debug) {
    const s = Number(params.get(DEBUG.seedParam));
    return Number.isFinite(s) && params.has(DEBUG.seedParam) ? s | 0 : DEBUG.defaultSeed;
  }
  return (Date.now() ^ ((performance.now() * 1000) | 0)) | 0; // nouvelle à chaque partie hors debug
}

function resetAll() {
  meta.applyToRun(); // § E4.A.5 : verrous de la méta figés pour la partie, AVANT les tirages (agents, chests, items, utilities)
  game.returnState = null;
  game.phase = null;
  game.countdown = 0;
  game.recordBeaten = false;
  sonVagueLance = false;
  arrivalStarted = false;
  carryMergePending = false; // § E4.F.3
  savedStateTime = 0;
  banArmed = false; // § E2.D
  run.seed = pickSeed();
  run.time = 0;
  run.kills = 0;
  seedRandom(run.seed);
  defis.reset(); // § E4.A : compteurs de la partie à zéro, base des cumuls relue dans la méta
  progression.reset();
  agents.reset(); // § E2.D : profil et passif de l'agent dans mods — après progression (mods à zéro), avant player et weapons
  items.reset(); // § E2.F : plus aucun objet — après agents.reset (part des objets dans mods), avant player.reset
  domeParefeu.reset(); // § E5.B : plus de coup arrêté en mémoire
  coqueReactive.reset(); // § E5.H : plus d'onde ni de fenêtre en mémoire
  brumeOmbre.reset(); // skin ombre : ni fumée ni brume d'une partie précédente
  camera.remettreLacet(); // § E5.AB : lacet d'origine AVANT player.reset (le héros part face au haut de l'écran)
  player.reset();
  soinHeros.reset(); // § E5.Q (B14)
  enemies.reset();
  enemies.warmEventBranches(); // § E1.C : les branches des robots d'événement sont exercées hors combat (voir enemies.js)
  // compteurs de dégâts APRÈS le préchauffage : ses coups de debug (blindé à bouclier, § E4.P : 0,4 compté) ne comptent
  // jamais dans la partie (bilan § E4.C) — 19/11
  damage.reset();
  boss.reset();
  hazards.reset();
  tirsCanon.reset(); // § E4.J
  events.reset(); // événements de vague (§ E1.C) : lumière rendue, anneau dissous, capsule retirée, calendrier à zéro
  weapons.reset();
  pickups.reset();
  chests.reset(); // § E2.C : après weapons.reset (emplacements) ; flux privé des coffres remis à la graine
  disquette.reset(); // § E4.Q : sol vide, rang des boss à 0, flux privé remis à la graine
  evolutions.reset(); // § E3.B : après weapons.reset (plus rien d'évolué) et items.reset
  props.reset(); // § E3.C : plus aucune borne (elles repoussent au début de la vague 1) ; flux privé remis à la graine
  utilities.reset(); // § E3.C : sol vide, effets éteints (MUL à 1)
  cooldowns.reset(); // § E3.H : toutes les sources prêtes, aucune fenêtre ouverte
  chestBanish = false;
  elites.reset(); // § E3.A
  barres.reset(); // § E4.H
  waves.reset();
  shop.reset();
  terminal.reset(); // § E5.V
  game.pauseForcee = false; // § E5.V (crochet de test)
  game.shopOrigine = 'decryptage';
  fx.reset();
  silhouetteHeros.reset(); // § E5.P (B1)
  vfx.reset(); // lots vides, horloge des effets datés à 0
  audio.reset();
  camera.reset();
  mortClaire.reset(); // § E5.AK : plus de ralenti en cours, caméra rendue au héros, flèche cachée
  grid.reset();
  input.reset();
  ui.reset();
  // Les réglages du joueur survivent à toute remise à zéro : main les réapplique lui-même, au lieu de compter sur
  // ce que font ou ne font pas camera.reset() et audio.reset().
  camera.setShakeIntensity(game.settings.shake);
  audio.setMasterVolume(game.settings.volume);
  audio.setSfxVolume(game.settings.sfx);
  audio.setMusiqueVolume(game.settings.musique);
}

// ----- Transitions (§ D.2) ---------------------------------------------------------------------------------------------

function setState(s) {
  game.state = s;
  game.stateTime = 0;
}

// ----- Bande-son (21/11/2026, AUDIO.musique) -----------------------------------------------------------------------------
let pisteJouee = null;
/**
 * Piste voulue selon l'état du jeu : titre, agent, Noyau → restauration ; boutique (décryptage, terminal) → decryptage ;
 * fin → segfault ; combat → boss pendant une vague de boss (dès son compte à rebours), vague sinon. Pause, coffre,
 * fusion, niveau : la piste en cours continue. Chaînes littérales : aucune allocation.
 */
function pisteVoulue() {
  switch (game.state) {
    case STATE.TITLE:
    case STATE.AGENT:
    case STATE.HUB:
      return 'restauration';
    case STATE.SHOP:
      return 'decryptage';
    case STATE.GAMEOVER:
      return 'segfault';
    case STATE.COUNTDOWN:
      return isBossWave(run.wave + 1) ? 'boss' : 'vague';
    case STATE.PLAYING:
    case STATE.WAVE_CLEAR:
      return isBossWave(run.wave) ? 'boss' : 'vague';
    default:
      return pisteJouee;
  }
}

/** T1 : écran titre. */
function enterTitle() {
  setState(STATE.TITLE);
  if (lancementDemande !== null) {
    lancementDemande = null; // § E5.K : « Jouer » en attente abandonné (retour au titre)
    memoire.attente(false);
  }
  game.returnState = null;
  game.phase = null;
  game.countdown = 0;
  ui.setCountdown(0); // « Menu » depuis une pause prise pendant le compte à rebours : le chiffre ne reste pas affiché
  ui.setHudVisible(false);
  titleView.best = game.best;
  titleView.layout = input.getLayout();
  titleView.shake = game.settings.shake;
  titleView.volume = game.settings.volume;
  titleView.sfx = game.settings.sfx; // réglages de Femz (21/11)
  titleView.musique = game.settings.musique;
  titleView.graphismes = game.settings.graphismes;
  titleView.deplacement = game.settings.deplacement;
  titleView.flashs = game.settings.flashs; // § E5.X5
  titleView.sensibilite = game.settings.sensibilite; // § E5.AG
  fillTitleLoading();
  ui.setScreen(SCREEN.TITLE, titleView);
  afficherMenu();
  // nappe d'ambiance au niveau de l'écran titre (avant le premier geste : retenu, la nappe démarre à ce niveau)
  audio.setAmbiance(MENU.son.ambiance, MENU.son.fonduAmbiance);
}

/** Écran titre affiché (TITLE, HUB) : agent choisi relu (vitrine), adaptation de qualité suspendue. */
function afficherMenu() {
  if (menu === null) return;
  menu.afficher();
  render.setAdaptivePaused(true);
}

/** Écran titre caché (partie) : vitrine du titre fermée, calque caché (gardé pour le prochain retour au titre). */
function cacherMenu() {
  if (menu === null) return;
  menu.cacher();
  render.setAdaptivePaused(false);
}

/** État du chargement des modèles, pour l'écran titre (§ Z quinquies). */
function fillTitleLoading() {
  titleView.loading = game.modeles === 'chargement';
  titleView.queued = departDemande;
  titleView.error = game.modeles === 'erreur' ? modelesInfo.erreur : '';
}

/** Entrée en COUNTDOWN (T2, T12, T15) : « 3 » affiché et tic joué tout de suite, sans condition. */
function enterCountdown() {
  setState(STATE.COUNTDOWN);
  game.returnState = null;
  game.phase = null;
  game.countdown = WAVES.countdown.from;
  ui.setCountdown(game.countdown);
  audio.play(SFX.COUNTDOWN_TICK);
  audio.play(SFX.COMPTE_CLIC); // clic du « 3 » (les suivants : postSim)
  if (run.wave === 0) world.materialiser(); // premier compte à rebours de la partie : le héros se compile sur le processeur
}

/**
 * T2. § E2.D : sans identifiant, « Jouer » mène à l'écran Agents (grille, T2 modifié → AGENT) ; avec un
 * identifiant (ou en ?debug, écran sauté), la partie démarre tout de suite avec cet agent (ou l'agent courant).
 */
function start(agentId) {
  if (game.state !== STATE.TITLE) return false;
  if (game.modeles !== 'pret') {
    // Modèles des unités pas encore posés (§ Z quinquies) : la demande est gardée et servie à leur arrivée
    // (modelesTraiter) ; rien ne démarre sans eux (un échec de chargement reste affiché sur l'écran titre).
    if (game.modeles === 'chargement' && !departDemande) {
      departDemande = true;
      fillTitleLoading();
      ui.setScreen(SCREEN.TITLE, titleView);
    }
    return false;
  }
  departDemande = false;
  if (agentId === undefined && !agentScreenOff) return agentsOuvrir('titre');
  if (agentId !== undefined && !agents.setAgent(agentId)) return false;
  launch();
  return true;
}

/** Fin de l'ancien T2 : la scène du menu est cachée, tout est remis à zéro, compte à rebours. */
function launch() {
  // § E5.K : modèle de l'agent pas encore arrivé (lu au moment du choix) — la partie démarre à son arrivée (agentsTraiter)
  if (!demanderModeleAgent()) {
    lancementDemande = game.state;
    memoire.attente(true);
    return;
  }
  lancementDemande = null;
  memoire.attente(false);
  fermerVitrine(); // Écran Agents : partie lancée depuis la fiche (rien si elle n'est pas ouverte)
  cacherMenu();
  audio.setAmbiance(AUDIO.ambiance.gain, MENU.son.fonduLancement); // nappe ramenée au niveau du jeu
  resetAll();
  ui.setScreen(SCREEN.NONE);
  ui.setHudVisible(true);
  enterCountdown();
}

/**
 * T2 (Écran Agents, tâche 5) : l'écran Agents s'ouvre depuis le titre (« Jouer ») ou le Noyau (onglet Agents, récompense
 * « agent » ou « skin » de l'onglet Succès). Sans agent : la grille, carte du dernier agent joué visée ; avec un agent a :
 * sa fiche (skinKey visé s'il existe, sinon le skin choisi). Écran pleine page : la scène derrière n'est pas rendue (F14).
 * Rend faux hors de l'état d'origine attendu.
 */
function agentsOuvrir(origine, a, skinKey) {
  const noyau = origine === 'noyau';
  if (game.state !== (noyau ? STATE.HUB : STATE.TITLE)) return false;
  if (noyau) ongletNoyau = ui.hubOnglet();
  setState(STATE.AGENT);
  agentDeDepart(); // § E4.B : un déblocage gagné à la partie précédente rend l'agent choisissable tout de suite
  const fiche = Number.isInteger(a) && a >= 0 && a < AGENT_COUNT;
  agentView.origine = noyau ? 'noyau' : 'titre';
  agentView.vue = fiche ? 'fiche' : 'grille';
  agentView.agent = fiche ? a : agents.getAgent();
  agentView.skinVise = fiche ? skinVise(agentView.agent, skinKey) : null;
  agentView.best = game.best;
  agentMove.fill(0);
  if (menu !== null) menu.cacher(); // tâche 7 : écran plein écran opaque — l'écran titre (et sa vitrine) est caché
  ui.setScreen(SCREEN.AGENT, agentView);
  if (fiche) ficheVitrine();
  return true;
}

/**
 * Fiche (tâche 6) : la vitrine 3D montre agentView.agent — en silhouette s'il est verrouillé ou si le skin visé l'est.
 * Son modèle est lu s'il n'est pas là (état « Chargement » de la vitrine jusqu'à son arrivée, agentsTraiter le garde).
 * Hors image (ouverture de la fiche, skin visé).
 */
function ficheVitrine() {
  const a = agentView.agent;
  const k = AGENTS[a].key;
  const verrou = meta.agentVerrouille(a) || !meta.skinDebloque(k, agentView.skinVise);
  // skin verrouillé : jamais son modèle (silhouette sur celui de l'agent) ; débloqué : le skin visé, repli compris
  const skin = verrou ? SKIN_BASE : player.skinPour(a, agentView.skinVise);
  if (agentVitrine !== a || skinVitrine !== skin) libererVitrine();
  agentVitrine = a;
  skinVitrine = skin;
  lireModele(a, skin);
  pauseAgent.openVitrine(a, { cadre: 'fiche', verrou, toile: ui.agentsToile(), skin });
}

/** Fiche fermée (retour à la grille, partie lancée) : vitrine fermée, modèle de son agent libéré s'il n'est pas celui de la partie. */
function fermerVitrine() {
  pauseAgent.closeVitrine();
  libererVitrine();
  agentVitrine = -1;
  skinVitrine = SKIN_BASE;
  demanderModeleAgent(); // le skin choisi dans la fiche : le modèle de l'agent de la partie le porte (titre, partie)
}

/** § E5.K : le modèle gardé pour la fiche (agent ≠ celui de la partie) est rendu (données, puis glTF du cache). */
function libererVitrine() {
  const a = agentVitrine;
  if (a < 0) return;
  if (player.libererModele(a, skinVitrine)) { // jamais le modèle posé sur le héros (libererModele refuse)
    oublierAgent(a, undefined, skinVitrine);
    agentsInfo.liberes++;
  }
}

/** Skin regardé dans la fiche de l'agent a : skinKey s'il est un skin de l'agent, sinon son skin choisi. */
function skinVise(a, skinKey) {
  const k = AGENTS[a].key;
  return skinsDe(k).includes(skinKey) ? skinKey : meta.skinChoisi(k);
}

/** Clics et touches de l'écran Agents ignorés pendant AGENT_SCREEN.guardSeconds à l'ouverture. */
function agentGarde() {
  return game.state === STATE.AGENT && game.stateTime >= AGENT_SCREEN.guardSeconds;
}

/** Grille → fiche de l'agent a (verrouillé compris : on la regarde ; « Jouer » y reste refusé). */
function agentFiche(a) {
  if (!agentGarde() || !(Number.isInteger(a) && a >= 0 && a < AGENT_COUNT)) return false;
  agentView.vue = 'fiche';
  agentView.agent = a;
  agentView.skinVise = skinVise(a);
  audio.play(SFX.UI_OPEN);
  ui.refreshScreen(agentView);
  ficheVitrine();
  return true;
}

/**
 * Fiche : clic / Entrée sur la vignette du skin skinKey de l'agent a. Débloqué : il devient le skin choisi (gardé dans la
 * sauvegarde) et la vitrine le montre — vrai. Verrouillé : il est seulement VISÉ (sa condition s'affiche, l'agent en
 * silhouette, « Jouer » part avec le skin choisi et le dit) — faux. Skin inconnu, autre agent que celui de la fiche : faux.
 */
function agentSkin(a, skinKey) {
  if (!agentGarde() || agentView.vue !== 'fiche' || a !== agentView.agent) return false;
  const k = AGENTS[a].key;
  if (!skinsDe(k).includes(skinKey)) return false;
  agentView.skinVise = skinKey;
  const choisi = meta.choisirSkin(k, skinKey);
  audio.play(SFX.UI_CLICK);
  ui.refreshScreen(agentView);
  ficheVitrine();
  if (choisi) demanderModeleAgent(); // le héros de la partie suit le skin choisi (lu hors combat, posé à son arrivée)
  return choisi;
}

/**
 * « Jouer · <agent> » : la partie démarre avec l'agent a (débloqué) et son skin choisi ; il devient l'agent de départ
 * (gardé). Verrouillé, inconnu ou modèles des unités pas encore là : refus (BUY_DENIED), rien ne démarre.
 */
function agentJouer(a) {
  if (!agentGarde()) return false;
  if (!(Number.isInteger(a) && a >= 0 && a < AGENT_COUNT) || game.modeles !== 'pret' || !agents.setAgent(a)) {
    audio.play(SFX.BUY_DENIED);
    return false;
  }
  saveAgent();
  launch();
  audio.play(SFX.AGENT_SELECT); // après resetAll (audio.reset) : le son du choix couvre le « 3 » du compte à rebours
  return true;
}

/** « Retour » (Échap) : fiche → grille (sa carte visée) ; grille → titre, ou Noyau sur l'onglet ouvert avant. */
function agentRetour() {
  if (game.state !== STATE.AGENT) return false;
  audio.play(SFX.UI_CLICK);
  if (agentView.vue === 'fiche') {
    agentView.vue = 'grille';
    agentView.skinVise = null;
    fermerVitrine();
    ui.refreshScreen(agentView);
    return true;
  }
  if (agentView.origine === 'noyau') enterHub(ongletNoyau);
  else enterTitle();
  return true;
}

/**
 * § E4.B : verrous des agents relus de la méta (hors combat : écran des agents, hub) — meta.applyToRun ne tourne sinon
 * qu'à resetAll, APRÈS le choix de l'agent. L'agent courant, s'il est verrouillé (progression réinitialisée), redevient
 * l'Éclaireur.
 */
function agentDeDepart() {
  meta.applyToRun();
  if (!agents.setAgent(agents.getAgent())) {
    agents.setAgent(0);
    saveAgent();
    demanderModeleAgent(); // § E5.K
  }
}

/**
 * T2d (§ E4.B.1) : « Noyau » (bouton ou H) sur l'écran titre → hub ; l'écran titre (fond peint et vitrine de l'agent) reste derrière. Aussi au retour
 * de l'écran Agents ouvert depuis le Noyau (onglet d'avant). Onglet Agents ou absent : la Collection.
 */
function enterHub(tab) {
  if (game.state !== STATE.TITLE && game.state !== STATE.AGENT) return false;
  setState(STATE.HUB);
  agentDeDepart();
  hubView.best = game.best ? game.best.wave : 0;
  hubView.agent = agents.getAgent();
  hubView.tab = Number.isInteger(tab) && tab !== ONGLET_AGENTS && tab >= 0 && tab < HUB.onglets.length ? tab : ONGLET_COLLECTION;
  hubMove.fill(0);
  ui.setScreen(SCREEN.HUB, hubView);
  afficherMenu(); // le Noyau est posé sur l'écran titre (retour de l'écran Agents : il était caché ; agent relu)
  return true;
}

/** T2e : Échap ou « Retour » dans le hub → écran titre (T1). */
function quitHub() {
  if (game.state !== STATE.HUB) return false;
  enterTitle();
  return true;
}

/** Clics et touches du hub ignorés pendant HUB.guardSeconds à l'ouverture (comme l'écran des agents). */
function hubGuard() {
  return game.state === STATE.HUB && game.stateTime >= HUB.guardSeconds;
}

/**
 * « Jouer · <agent> » au pied du hub : la partie démarre avec l'agent de départ (a : un autre agent, débloqué, qui le
 * devient) — verrouillé ou modèles pas encore chargés : refus (BUY_DENIED), rien ne démarre.
 */
function hubPlay(a) {
  if (!hubGuard()) return false;
  const choisi = Number.isInteger(a) ? a : agents.getAgent();
  if (game.modeles !== 'pret' || !agents.setAgent(choisi)) {
    audio.play(SFX.BUY_DENIED); // modèles pas encore chargés (le titre l'affiche) : rien ne démarre
    return false;
  }
  saveAgent();
  launch();
  audio.play(SFX.AGENT_SELECT);
  return true;
}

/** Onglet Déblocages : achat en Cycles (meta.buy). OK → SFX.UNLOCK ; sinon SFX.BUY_DENIED. Rend META_BUY.*. */
function hubBuy(key) {
  if (!hubGuard()) return META_BUY.NOT_FOR_SALE;
  const r = meta.buy(key);
  audio.play(r === META_BUY.OK ? SFX.UNLOCK : SFX.BUY_DENIED);
  if (r === META_BUY.OK) ui.refreshScreen(hubView);
  return r;
}

/** « Réinitialiser la progression » (après les confirmations de ui-hub) : méta remise à zéro, record et réglages gardés. */
function hubReset() {
  if (!hubGuard()) return false;
  meta.reset();
  agentDeDepart();
  hubView.agent = agents.getAgent();
  audio.play(SFX.UI_CLICK);
  ui.refreshScreen(hubView);
  return true;
}

/** T13 — vue : 'menu' (Échap, par défaut) ou 'fiche' (Tab) : ce que la pause montre en s'ouvrant (menus « Pile »). */
function pause(vue) {
  const s = game.state;
  if (!P.alive) return false; // § E5.AK : héros détruit (ralenti du coup mortel) — la partie est finie, pas de pause
  if (s !== STATE.PLAYING && s !== STATE.WAVE_CLEAR && s !== STATE.COUNTDOWN && s !== STATE.SHOP) return false;
  game.returnState = s;
  savedStateTime = game.stateTime;
  horsCombat(); // § E5.V
  game.state = STATE.PAUSED;
  game.stateTime = 0;
  pauseView.shake = game.settings.shake;
  pauseView.volume = game.settings.volume;
  pauseView.sfx = game.settings.sfx; // réglages de Femz (21/11)
  pauseView.musique = game.settings.musique;
  pauseView.graphismes = game.settings.graphismes;
  pauseView.deplacement = game.settings.deplacement;
  pauseView.flashs = game.settings.flashs; // § E5.X5
  pauseView.sensibilite = game.settings.sensibilite; // § E5.AG
  pauseView.layout = input.getLayout();
  pauseView.vue = vue === 'fiche' ? 'fiche' : 'menu';
  ui.setScreen(SCREEN.PAUSE, pauseView);
  pauseAgent.open(); // § E3.I
  return true;
}

/** § E5.S (A18) : pause à la perte du focus de la fenêtre ; force : tests (debug), sans la garde ?debug. */
function pauseSurFocus(force) {
  if (!REGLAGES.pauseSurFocus || (game.debug && !force)) return false;
  const s = game.state;
  if (s === STATE.PLAYING || s === STATE.WAVE_CLEAR || s === STATE.COUNTDOWN) return pause('menu');
  return false;
}
actions.pauseSurFocus = pauseSurFocus;
//#region e5:AB-camera-3p
/** § E5.AB.5 : verrou du pointeur perdu en partie sans que le jeu l'ait rendu (Échap, perte du focus) → pause. */
actions.pauseVerrou = (echap) => {
  // § E5.AD (fusion 0.5.12) : la pause ouverte par Échap sous verrou sonne comme celle du clavier (UI_OPEN, une fois : pause()
  // refuse une 2e ouverture) ; la pause à la perte du focus reste muette
  if (pause('menu') && echap) audio.play(SFX.UI_OPEN);
};
//#endregion e5:AB-camera-3p

// § E5.X2 (audit I1) : filet de la boucle. Une erreur dans runFrame coupait la boucle de three pour de bon (elle appelle
// frame AVANT de demander l'image suivante). Hors chemin chaud : appelée seulement quand une erreur arrive.
let erreurTest = 0; // debug (provoquerErreur) : nombre d'images qui lèvent une erreur de test
function erreurImage(e) {
  try {
    input.endFrame(); // les fronts de cette image ne sont pas rejoués à la suivante
  } catch (e2) {
    /* rien */
  }
  const avant = game.state;
  try {
    pause('menu'); // sans effet hors partie (titre, Noyau, fin)
  } catch (e3) {
    console.error(e3);
  }
  incident.erreurImage(e, 'état ' + avant);
}
actions.provoquerErreur = (n = 1) => {
  erreurTest = Math.max(0, Math.floor(n));
  return erreurTest;
};

/** T14 */
function resume() {
  if (game.state !== STATE.PAUSED) return false;
  pauseAgent.close(); // § E3.I
  game.state = game.returnState;
  game.stateTime = savedStateTime;
  game.returnState = null;
  if (game.state === STATE.SHOP) ui.setScreen(SCREEN.SHOP, shop.getView());
  else ui.setScreen(SCREEN.NONE);
  return true;
}

/** T15 */
function restart() {
  if (game.state === STATE.GAMEOVER) {
    if (game.stateTime < UI.gameOverGuardSeconds) return false;
  } else if (game.state !== STATE.PAUSED) {
    return false;
  }
  defis.finishRun(); // § E4.A : la partie abandonnée par la pause compte (garde : une fois par partie)
  resetAll();
  ui.setScreen(SCREEN.NONE);
  ui.setHudVisible(true);
  enterCountdown();
  return true;
}

/** T16 */
function quitToTitle() {
  if (game.state !== STATE.PAUSED && game.state !== STATE.GAMEOVER) return false;
  defis.finishRun(); // § E4.A (déjà comptée au game over : la garde de meta.finishRun l'ignore)
  resetAll();
  enterTitle();
  return true;
}

/** T6 / T9 : écran de choix. retour = état à reprendre ensuite. */
function enterLevelUp(returnState) {
  horsCombat(); // § E5.V
  game.returnState = returnState;
  savedStateTime = game.stateTime;
  game.state = STATE.LEVELUP;
  game.stateTime = 0;
  setBanArmed(false); // § E2.D
  ui.setScreen(SCREEN.LEVELUP, progression.rollChoices());
  audio.play(SFX.LEVEL_UP);
}

/** T7 / T8 */
function chooseBonus(index) {
  if (game.state !== STATE.LEVELUP || game.stateTime < PROGRESSION.choiceGuardSeconds) return false;
  if (banArmed) return banishChoice(index); // § E2.D : bannissement armé — la carte choisie est bannie, pas prise
  if (!progression.applyChoice(index)) return false;
  audio.play(SFX.BONUS_PICK);
  return afterChoice();
}

/** T7 / T8, après un choix pris ou passé (§ E2.D : la passe suit le même chemin). */
function afterChoice() {
  if (run.pendingChoices > 0) {
    // T7 : choix suivant, nouveau tirage, nouveau délai de garde
    ui.refreshScreen(progression.rollChoices());
    game.stateTime = 0;
    return true;
  }
  // T8 : retour à l'état interrompu, stateTime et phase restaurés
  game.state = game.returnState;
  game.stateTime = savedStateTime;
  game.returnState = null;
  ui.setScreen(SCREEN.NONE);
  if (game.state === STATE.WAVE_CLEAR && game.phase === CLEAR_PHASE.MERCHANT_IN && !arrivalStarted) {
    arrivalStarted = true;
    shop.beginArrival();
  }
  return true;
}

// ----- Coffres (§ E2.C) : T6b, T9b, T17, T18 ------------------------------------------------------------------------------

/** T6b / T9b : ouverture d'un coffre en attente. retour = état à reprendre ensuite (PLAYING ou WAVE_CLEAR). */
function enterChest(returnState) {
  horsCombat(); // § E5.V
  game.returnState = returnState;
  savedStateTime = game.stateTime;
  game.state = STATE.CHEST;
  game.stateTime = 0;
  chestBanish = false;
  const v = chests.roll();
  v.banishing = false;
  chestGuard = v.revealSeconds;
  ui.setScreen(SCREEN.CHEST, v);
  audio.play(SFX.CHEST_OPEN);
}

/** T17 / T18 : après un lot pris ou un coffre passé. */
function afterChest() {
  chestBanish = false;
  if (run.chests > 0) {
    // T17 : coffre suivant, nouveau tirage, nouvelle roulette
    const v = chests.roll();
    v.banishing = false;
    chestGuard = v.revealSeconds;
    game.stateTime = 0;
    ui.refreshScreen(v);
    audio.play(SFX.CHEST_OPEN);
    return;
  }
  // T18 : retour à l'état interrompu, stateTime et phase restaurés (comme T8)
  game.state = game.returnState;
  game.stateTime = savedStateTime;
  game.returnState = null;
  ui.setScreen(SCREEN.NONE);
}

/** Prend le lot k. force (debug, choix automatique) : sans attendre la fin de la roulette. */
function takeLot(k, force = false) {
  if (game.state !== STATE.CHEST) return PICK.CLOSED;
  if (!force && game.stateTime < chestGuard) return PICK.CLOSED;
  const r = chests.take(k);
  if (r !== PICK.OK) {
    audio.play(SFX.BUY_DENIED);
    return r;
  }
  audio.play(SFX.CHEST_PICK);
  afterChest();
  return r;
}

function rerollLots() {
  if (game.state !== STATE.CHEST || game.stateTime < chestGuard) return PICK.CLOSED;
  const r = chests.reroll();
  if (r !== PICK.OK) {
    audio.play(SFX.BUY_DENIED);
    return r;
  }
  const v = chests.getView();
  v.banishing = false;
  chestBanish = false;
  chestGuard = v.revealSeconds;
  game.stateTime = 0;
  ui.refreshScreen(v);
  audio.play(SFX.REROLL); // fusion de la phase 1 (§ E2.I) : « Relancer » a le même son au coffre qu'au choix de niveau (§ E2.D)
  return r;
}

function skipLots() {
  if (game.state !== STATE.CHEST || game.stateTime < chestGuard) return PICK.CLOSED;
  const r = chests.skip();
  if (r !== PICK.OK) {
    audio.play(SFX.BUY_DENIED);
    return r;
  }
  audio.play(SFX.UI_CLICK);
  afterChest();
  return r;
}

/** B : arme (ou désarme) le bannissement — le prochain 1 / 2 / 3 bannit le lot au lieu de le prendre. */
function armBanishLot() {
  if (game.state !== STATE.CHEST || game.stateTime < chestGuard) return false;
  if (!(run.banishes > 0)) {
    audio.play(SFX.BUY_DENIED);
    return false;
  }
  chestBanish = !chestBanish;
  const v = chests.getView();
  v.banishing = chestBanish;
  ui.refreshScreen(v);
  audio.play(SFX.UI_CLICK);
  return chestBanish;
}

function banishLot(k) {
  if (game.state !== STATE.CHEST || game.stateTime < chestGuard) return PICK.CLOSED;
  const r = chests.banish(k);
  chestBanish = false;
  const v = chests.getView();
  v.banishing = false;
  if (r !== PICK.OK) {
    audio.play(SFX.BUY_DENIED);
    ui.refreshScreen(v);
    return r;
  }
  // le lot banni est tiré de nouveau : la roulette rejoue, courte garde
  chestGuard = v.revealSeconds;
  game.stateTime = 0;
  ui.refreshScreen(v);
  audio.play(SFX.BANISH); // fusion de la phase 1 (§ E2.I) : « Bannir » a le même son au coffre qu'au choix de niveau (§ E2.D)
  return r;
}

/** Entrée : passe l'animation de la roulette (refusé pendant les CHESTS.roulette.unskippable premiers coffres). */
function skipChestAnimation() {
  if (game.state !== STATE.CHEST) return false;
  const v = chests.getView();
  if (v.big && game.stateTime >= chestGuard) return takeLot(0) === PICK.OK; // § E3.A : Entrée prend tout le gros lot
  if (!v.skippable || game.stateTime >= chestGuard - CHESTS.roulette.holdSeconds) return false;
  chestGuard = game.stateTime + CHESTS.roulette.guardSeconds;
  ui.skipChestAnimation();
  return true;
}

/** Touche 1 / 2 / 3 dans l'état CHEST : bannit si B a été pressé, sinon prend. */
function chestKey(k) {
  if (chestBanish) banishLot(k);
  else takeLot(k);
}

/** B ou bouton « Bannir » : le même geste au coffre (§ E2.C) et au choix de niveau (§ E2.D), aiguillé par l'état. */
function armBanish() {
  return game.state === STATE.CHEST ? armBanishLot() : armBanishChoice();
}

// ----- § E3.F : moment de fusion (T6c / T9c, en pause comme un coffre ; T19 au retour) ----------------------------------
let fusionGuard = 0; // s d'état avant que Entrée / clic puisse fermer l'écran
let fusionSkippable = false;

/** T6c / T9c : deux objets à fusionAt piles fusionnent ; l'écran se joue en pause. retour = état à reprendre. */
function enterFusion(returnState) {
  const k = items.pendingFusion();
  if (k < 0 || !items.fuse(k)) return false;
  horsCombat(); // § E5.V
  const v = items.fusionView(k);
  v.first = meta.discover('fusions', k); // première découverte : écrite hors combat (écran en pause)
  fusionSkippable = run.fusions > FUSION_SCREEN.skippableAfter;
  v.skippable = fusionSkippable;
  const S = FUSION_SCREEN;
  fusionGuard = S.slideSeconds + S.mergeSeconds + S.cardSeconds + S.guardSeconds;
  v.guardSeconds = fusionGuard;
  game.returnState = returnState;
  savedStateTime = game.stateTime;
  game.state = STATE.FUSION;
  game.stateTime = 0;
  ui.setScreen(SCREEN.FUSION, v);
  audio.play(SFX.FUSION);
  return true;
}

/** Entrée / clic : passe l'animation (dès la 2e fusion de la partie), puis ferme (T19 : retour à l'état interrompu). force : debug. */
function closeFusion(force = false) {
  if (game.state !== STATE.FUSION) return false;
  if (!force && game.stateTime < fusionGuard) {
    if (!fusionSkippable) return false;
    const S = FUSION_SCREEN;
    const end = S.slideSeconds + S.mergeSeconds + S.cardSeconds;
    if (game.stateTime < end) {
      fusionGuard = game.stateTime + S.guardSeconds;
      game.stateTime = end; // l'écran se cale sur la carte de l'objet né
      fusionGuard = end + S.guardSeconds;
      ui.skipFusion();
    }
    return false;
  }
  game.state = game.returnState;
  game.stateTime = savedStateTime;
  game.returnState = null;
  ui.setScreen(SCREEN.NONE);
  audio.play(SFX.UI_CLICK);
  if (game.state === STATE.WAVE_CLEAR && game.phase === CLEAR_PHASE.MERCHANT_IN && !arrivalStarted) {
    arrivalStarted = true;
    shop.beginArrival();
  }
  return true;
}

// ----- § E2.D : relance, passe, bannissement au choix de niveau (mêmes gardes que chooseBonus) ------------------------

function setBanArmed(on) {
  banArmed = on;
  ui.setBanishArmed(on);
}

/** Relance : nouveau tirage des cartes, nouveau délai de garde. false : pas en LEVELUP, garde, plus de relance. */
function rerollChoices() {
  if (game.state !== STATE.LEVELUP || game.stateTime < PROGRESSION.choiceGuardSeconds) return false;
  const v = progression.rerollChoices();
  if (!v) {
    audio.play(SFX.BUY_DENIED);
    return false;
  }
  setBanArmed(false);
  audio.play(SFX.REROLL);
  ui.refreshScreen(v);
  game.stateTime = 0;
  return true;
}

/** Passe : rien n'est pris, des fragments en compensation ; puis T7 ou T8 comme après un choix. */
function skipChoice() {
  if (game.state !== STATE.LEVELUP || game.stateTime < PROGRESSION.choiceGuardSeconds) return false;
  if (!progression.skipChoice()) {
    audio.play(SFX.BUY_DENIED);
    return false;
  }
  setBanArmed(false);
  audio.play(SFX.UI_CLICK);
  return afterChoice();
}

/** Arme ou désarme le bannissement (touche B, bouton « Bannir »). false : pas en LEVELUP, ou plus de bannissement. */
function armBanishChoice() {
  if (game.state !== STATE.LEVELUP) return false;
  if (!banArmed && run.banishes <= 0) {
    audio.play(SFX.BUY_DENIED);
    return false;
  }
  setBanArmed(!banArmed);
  return true;
}

/** Bannit la carte n° index : elle ne sort plus de la partie ; les cartes sont retirées aussitôt. */
function banishChoice(index) {
  if (game.state !== STATE.LEVELUP || game.stateTime < PROGRESSION.choiceGuardSeconds) return false;
  const v = progression.banishChoice(index);
  if (!v) {
    audio.play(SFX.BUY_DENIED);
    return false;
  }
  setBanArmed(false);
  audio.play(SFX.BANISH);
  ui.refreshScreen(v);
  game.stateTime = 0;
  return true;
}

function buy(offerId) {
  if (game.state !== STATE.SHOP) return BUY.CLOSED;
  const r = shop.buy(offerId);
  audio.play(r === BUY.OK ? SFX.BUY : SFX.BUY_DENIED);
  ui.refreshScreen(shop.getView());
  return r;
}

/** T12 */
function finishShopping() {
  if (game.state !== STATE.SHOP || game.stateTime < SHOP.minOpenSeconds) return false;
  shop.close();
  ui.setScreen(SCREEN.NONE);
  if (game.shopOrigine === 'terminal') {
    // § E5.V : fermé depuis le terminal — retour direct en PLAYING (pas de compte à rebours), le terminal repart
    game.shopOrigine = 'decryptage';
    terminal.consommer();
    game.state = STATE.PLAYING;
    game.stateTime = tempsVagueTerminal;
    return true;
  }
  shop.beginDeparture();
  enterCountdown();
  return true;
}

function setShake(v) {
  if (!Number.isFinite(v)) return false;
  game.settings.shake = v < 0 ? 0 : v > 1 ? 1 : v;
  camera.setShakeIntensity(game.settings.shake);
  saveSettings();
  return true;
}

/** Réglages de Femz (21/11) : secousses Avec / Sans (intensité 1 ou 0). */
function setSecousses(on) {
  return setShake(on ? 1 : 0);
}

function borne01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function setVolSfx(v) {
  if (!Number.isFinite(v)) return false;
  game.settings.sfx = borne01(v);
  audio.setSfxVolume(game.settings.sfx);
  saveSettings();
  return true;
}

function setVolMusique(v) {
  if (!Number.isFinite(v)) return false;
  game.settings.musique = borne01(v);
  audio.setMusiqueVolume(game.settings.musique);
  saveSettings();
  return true;
}

/** § E5.X5 (audit C12) : « Flashs » Normaux / Réduits — CONFORT_FLASHS.reduits, lu par les clignotements. */
function setFlashs(cle) {
  if (!REGLAGES.flashs.some((g) => g.key === cle)) return false;
  game.settings.flashs = cle;
  CONFORT_FLASHS.reduits = cle === 'reduits';
  saveSettings();
  return true;
}
actions.setFlashs = setFlashs;

/** § E5.AG : « Sensibilité de la souris » — multiplicateur des deux vitesses de base (caméra libre, curseur du jeu). */
function setSensibilite(v) {
  if (!Number.isFinite(v)) return false;
  const R = REGLAGES.sensibilite;
  game.settings.sensibilite = v < R.min ? R.min : v > R.max ? R.max : v;
  SENSIBILITE_SOURIS.mul = game.settings.sensibilite; // lu au prochain écart de la souris : appliqué tout de suite
  saveSettings();
  return true;
}
actions.setSensibilite = setSensibilite;

/** « Déplacement » : 'clavier' ou 'souris' (§ E5.AB : caméra derrière l'agent, la souris la tourne, ZQSD pour avancer). */
function setDeplacement(cle) {
  if (!REGLAGES.deplacement.some((g) => g.key === cle)) return false;
  game.settings.deplacement = cle;
  input.setModeSouris(cle === 'souris');
  camera.setOrbite(cle === 'souris'); // § E5.AB.2 : Clavier → le lacet revient à CAMERA.yawDeg
  saveSettings();
  return true;
}

/** « Graphismes » : clé de REGLAGES.graphismes (auto, elevee, moyenne, basse). */
function setGraphismes(cle) {
  const G = REGLAGES.graphismes.find((g) => g.key === cle);
  if (!G) return false;
  game.settings.graphismes = G.key;
  render.setGraphismes(G.niveau);
  saveSettings();
  return true;
}

function setVolume(v) {
  if (!Number.isFinite(v)) return false;
  game.settings.volume = v < 0 ? 0 : v > 1 ? 1 : v;
  audio.setMasterVolume(game.settings.volume);
  saveSettings();
  return true;
}

/**
 * Record battu en cours de partie (§ E1.D), appelé au début de la vague n (T3), juste AVANT waves.startWave. S'il
 * existe un record et que n le dépasse : bannière et son « Nouveau record » la première fois de la partie ; le record
 * est mis à jour et SAUVÉ tout de suite (il tient même si l'onglet est fermé), puis à chaque vague suivante — la
 * pastille du HUD suit la vague. Sans record (toute première partie) : rien, il sera posé au game over.
 * § E1.S (S1) : la bannière « NOUVEAU RECORD : VAGUE N » REMPLACE « Vague N » et le son remplace celui du début de
 * vague — ils partent à la même image. Renvoie true quand l'annonce est faite (startWave se tait alors).
 */
function noteRecord(n) {
  const b = game.best;
  if (!b || n <= b.wave) return false;
  // § E5.V tâche 3 : mis à jour EN PLACE (aucun objet en combat) ; écrit au prochain moment hors combat (horsCombat)
  b.wave = n;
  b.kills = run.kills;
  b.level = run.level;
  b.time = run.time;
  recordAEcrire = true;
  if (game.recordBeaten) return false;
  game.recordBeaten = true;
  ui.showBanner(UI.record.kicker + ' : ' + UI.record.title + n, UI.record.bannerSeconds);
  audio.play(SFX.NEW_BEST);
  return true;
}

/**
 * § E5.V — bascule à la volée (fin d'une vague hors isPauseWave) : la vague suivante démarre dans la même image. Rien
 * n'est figé ni retiré (robots, tirs, zones, butin au sol, élites porteuses, événement en cours) ; pas de WAVE_CLEAR ni
 * de compte à rebours ; bannière « Vague N » (ou le record) par startWave. Fin d'une vague de boss : + 1 relance, zones
 * du boss effacées, son butin aspiré vers le héros (coffre, butin gardé, disquette : Femz, 20/11). Succès évalués sans écriture (écrits hors combat, § E5.V tâche 3).
 */
function basculer() {
  if (isBossWave(run.wave)) {
    run.rerolls += CHOICES.rerollPerBoss; // § E2.D : une vague de boss ne finit qu'à sa mort → +1 relance
    if (CHOICES.rerollPerBoss > 0) ramassage.RAM_N[RECAP_T.RELANCE_BOSS]++; // § E5.X7 (H6) : « Boss détruit · +1 relance » (récap)
    boss.clearHazards();
    // § E5.V (Femz, 20/11 : « aspire ») : le butin du boss vient au héros comme avant les paliers — coffre (et coffres
    // gardés), butin marqué pKeep, disquette ; le reste du sol ne bouge pas
    chests.attirerGardes();
    pickups.attirerGardes();
    disquette.endWave();
  }
  defis.onWaveTick();
  if (PALIERS_VAGUES.soinBascule > 0) {
    // § E5.V (Femz, 20/11) : soin à chaque bascule ; § E5.X7 (H6) : dit dans le récap (« Nouvelle vague · +N PV », PV réels)
    const soin = Math.round(player.heal(PALIERS_VAGUES.soinBascule * P.maxHp));
    if (soin > 0) {
      ramassage.RAM_N[RECAP_T.SOIN_VAGUE]++;
      ramassage.RAM_I[RECAP_T.SOIN_VAGUE] += soin;
    }
  }
  const rec = noteRecord(run.wave + 1);
  waves.startWave(run.wave + 1, rec, true);
  terminal.onWaveStart(run.wave);
}

/**
 * § E5.V (tâche 6) — Interagir à portée du terminal posé (PLAYING) : le décryptage s'ouvre EN PAUSE (STATE.SHOP n'est
 * pas simulé : monde figé), soin et offres du marchand (shop.open). Un seul usage ; à la fermeture, retour direct en
 * PLAYING (finishShopping), sans compte à rebours.
 */
let tempsVagueTerminal = 0;
function ouvrirTerminal() {
  terminal.utiliser();
  horsCombat();
  game.shopOrigine = 'terminal';
  tempsVagueTerminal = game.stateTime;
  setState(STATE.SHOP);
  shop.open();
  ui.setScreen(SCREEN.SHOP, shop.getView());
  audio.play(SFX.UI_CLICK);
}

/**
 * § E4.C : vue du bilan de l'écran de fin (hors combat : alloue). lastRun : rendu de meta.finishRun (null = partie
 * non comptée). Lignes par arme (src/bilan.js), barème des Cycles, solde, succès de la partie et leur récompense.
 */
function bilanVue(lastRun) {
  const v = bilan.compose();
  const B = META.bareme;
  v.compte = lastRun !== null;
  v.wave = lastRun !== null ? lastRun.wave : 0;
  v.boss = lastRun !== null ? lastRun.boss : 0;
  v.elites = lastRun !== null ? lastRun.elites : 0;
  v.bareme = B;
  v.cycles = lastRun !== null ? lastRun.cycles : { vagues: 0, vague: 0, boss: 0, elites: 0, succes: 0, total: 0 };
  v.solde = lastRun !== null ? lastRun.solde : meta.getCycles();
  v.succes = [];
  if (lastRun !== null) {
    for (const key of lastRun.succes) {
      const s = DEFIS.list.findIndex((D) => D.key === key);
      if (s >= 0) v.succes.push({ nom: DEFIS.list[s].name, recompense: defis.rewardText(s) });
    }
  }
  return v;
}

//#region e5:Q-retours-guide
/**
 * § E5.Q (C2) : cause de la défaite (hors combat : alloue). detruit = « Kamikaze (explosion) » (coup mortel, '' si
 * inconnu) ; groupe = type de robot qui a pris le plus de PV dans la partie (à égalité : celui du coup mortel), pct sa
 * part arrondie (au moins 1 %).
 */
function causeVue() {
  const D = damage.DEGATS_CAUSE;
  const mort = damage.MORT_CAUSE[0];
  const parGroupe = new Float64Array(CAUSE_GROUPE_COUNT);
  let total = 0;
  for (let c = 0; c < CAUSE_COUNT; c++) {
    parGroupe[CAUSE_GROUPE[c]] += D[c];
    total += D[c];
  }
  let g = -1;
  const gm = mort > 0 ? CAUSE_GROUPE[mort] : -1;
  for (let k = 0; k < CAUSE_GROUPE_COUNT; k++) {
    if (!(parGroupe[k] > 0)) continue;
    if (g < 0 || parGroupe[k] > parGroupe[g] + 1e-9 || (Math.abs(parGroupe[k] - parGroupe[g]) <= 1e-9 && k === gm)) g = k;
  }
  const pct = g >= 0 && total > 0 ? Math.max(1, Math.round((100 * parGroupe[g]) / total)) : 0;
  return {
    mort,
    detruit: mort > 0 ? CAUSE_TEXTE[mort] : '',
    conseil: mort > 0 ? conseilMort(mort) : '', // § E5.AK : ce qui s'est passé, comment l'éviter
    groupe: g >= 0 ? RETOURS_GUIDE.groupes[g] : '',
    indexGroupe: g,
    pct,
    total,
    parGroupe: Array.from(parGroupe),
  };
}
//#endregion e5:Q-retours-guide

//#region e5:AK-mort-claire
/** § E5.AK : phrase de la cause (hors combat : alloue), touche RÉELLE du dash à la place de {dash}. */
function conseilMort(c) {
  const t = MORT_CLAIRE.conseils[c] || '';
  return t.replace(/\{dash\}/g, input.libelle('dash'));
}
//#endregion e5:AK-mort-claire

/** T4 : mort du joueur. */
function enterGameOver() {
  horsCombat(); // § E5.V : record d'une bascule pas encore écrit
  terminal.forceDepart(); // § E5.V
  setState(STATE.GAMEOVER);
  game.returnState = null;
  game.phase = null;
  game.countdown = 0;
  ui.setCountdown(0);
  events.clear(); // § E1.S : un événement en cours s'arrête (panne : lumière et nappe rendues, l'écran de fin n'est plus dans le noir)
  const lastRun = defis.finishRun(damage.MORT_CAUSE[0]); // § E4.A : succès écrits, Cycles et statistiques (une fois par partie) ; § E5.Q : morts par cause
  const b = game.best;
  // « Mieux » : vague plus haute ; à égalité, plus de kills.
  // § E1.D : un record battu pendant la partie reste un nouveau record à l'écran de fin, même sans un kill de plus.
  const isNewBest = game.recordBeaten || !b || run.wave > b.wave || (run.wave === b.wave && run.kills > b.kills);
  if (isNewBest) {
    game.best = { wave: run.wave, kills: run.kills, level: run.level, time: run.time };
    saveBest();
  }
  overView.wave = run.wave;
  overView.kills = run.kills;
  overView.level = run.level;
  overView.time = run.time;
  overView.best = game.best;
  overView.isNewBest = isNewBest;
  overView.bilan = bilanVue(lastRun); // § E4.C : bilan par arme et Cycles gagnés (hors combat)
  overView.cause = causeVue(); // § E5.Q (C2) : ce qui a détruit le héros (hors combat)
  ui.setScreen(SCREEN.GAMEOVER, overView);
  // « Nouveau record » ne sonne qu'une fois par partie : déjà joué au dépassement, le game over joue son propre son.
  audio.play(isNewBest && !game.recordBeaten ? SFX.NEW_BEST : SFX.GAME_OVER);
}

/** F4 : touches selon l'état (§ D.3). Une touche n'agit que sur son front montant. */
function handleKeys() {
  toucheCamera(); // § E3.L
  switch (game.state) {
    case STATE.TITLE:
      if (ui.paramOuvert()) { // § E5.R : fenêtre Paramètres ouverte — Échap la ferme, rien ne lance la partie
        if (input.pressed(ACTION.PAUSE) && ui.paramFermer()) audio.play(SFX.UI_CLICK); // § E5.AD
        break;
      }
      if (input.pressed(ACTION.CONFIRM) || input.pressed(ACTION.DASH)) {
        if (start() && game.state === STATE.AGENT) audio.play(SFX.UI_OPEN); // § E5.AD : écran de l'agent ouvert au clavier
      } else if (input.pressed(ACTION.HUB) && enterHub()) audio.play(SFX.UI_OPEN); // § E4.B.1 ; § E5.AD
      break;
    case STATE.HUB: { // § E4.B.1 : Échap → titre ; 1 à 4 → onglet ; flèches et Entrée dans le hub (fronts calculés ici)
      const mx = input.getMoveX();
      const my = input.getMoveY();
      const fx = mx !== 0 && mx !== hubMove[0] ? mx : 0;
      const fy = my !== 0 && my !== hubMove[1] ? -my : 0; // getMoveY : +1 = haut ; le hub : +1 = vers le bas
      hubMove[0] = mx;
      hubMove[1] = my;
      if (!hubGuard()) break;
      if (input.pressed(ACTION.PAUSE)) {
        if (!ui.hubBack() && quitHub()) audio.play(SFX.UI_CLICK); // § E4.L.1 : Échap ferme d'abord la fenêtre d'un élément de la fiche ; § E5.AD
      } else if (input.pressed(ACTION.CHOICE_1)) ui.hubTab(0);
      else if (input.pressed(ACTION.CHOICE_2)) ui.hubTab(1);
      else if (input.pressed(ACTION.CHOICE_3)) ui.hubTab(2);
      else if (input.pressed(ACTION.CHOICE_4)) ui.hubTab(3);
      else if (input.pressed(ACTION.CONFIRM)) ui.hubConfirm();
      else if (fx !== 0) ui.hubMove(fx, 0);
      else if (fy !== 0) ui.hubMove(0, fy);
      break;
    }
    case STATE.PLAYING:
    case STATE.WAVE_CLEAR:
    case STATE.COUNTDOWN:
      if (input.pressed(ACTION.PAUSE)) {
        if (pause('menu')) audio.play(SFX.UI_OPEN); // § E5.AD
      } else if (input.pressed(ACTION_FICHE) && pause('fiche')) audio.play(SFX.UI_OPEN); // menus « Pile » : Tab ouvre la fiche de l'agent ; § E5.AD
      break;
    case STATE.SHOP: { // § E4.S.8 : flèches (entrée du jeu) → focus d'une ligne d'achat ; Entrée achète la ligne au focus
      const mx = input.getMoveX();
      const my = input.getMoveY();
      const fx = mx !== 0 && mx !== shopMoveMem[0] ? mx : 0;
      const fy = my !== 0 && my !== shopMoveMem[1] ? -my : 0; // getMoveY : +1 = haut ; le marchand : +1 = vers le bas
      shopMoveMem[0] = mx;
      shopMoveMem[1] = my;
      if (input.pressed(ACTION.PAUSE)) {
        if (!ui.shopBack() && pause()) audio.play(SFX.UI_OPEN); // § E5.AD
      } else if (input.pressed(ACTION.CONFIRM)) {
        if (!ui.shopConfirm()) finishShopping();
      } else if (fx !== 0) ui.shopMove(fx, 0);
      else if (fy !== 0) ui.shopMove(0, fy);
      break;
    }
    case STATE.LEVELUP:
      if (input.pressed(ACTION.CHOICE_1)) chooseBonus(0);
      else if (input.pressed(ACTION.CHOICE_2)) chooseBonus(1);
      else if (input.pressed(ACTION.CHOICE_3)) chooseBonus(2);
      else if (input.pressed(ACTION.REROLL)) rerollChoices(); // § E2.D : R relance, X passe, B arme le bannissement
      else if (input.pressed(ACTION.SKIP)) skipChoice();
      else if (input.pressed(ACTION.BANISH)) armBanish();
      break;
    case STATE.AGENT: { // Écran Agents : flèches (focus), Entrée (élément visé), Échap = Retour ; aucune touche dédiée
      const mx = input.getMoveX();
      const my = input.getMoveY();
      const fx = mx !== 0 && mx !== agentMove[0] ? mx : 0;
      const fy = my !== 0 && my !== agentMove[1] ? -my : 0; // getMoveY : +1 = haut ; l'écran : +1 = vers le bas
      agentMove[0] = mx;
      agentMove[1] = my;
      if (!agentGarde()) break;
      if (input.pressed(ACTION.PAUSE)) agentRetour();
      else if (input.pressed(ACTION.CONFIRM)) ui.agentsConfirmer();
      else if (fx !== 0) ui.agentsBouger(fx, 0);
      else if (fy !== 0) ui.agentsBouger(0, fy);
      break;
    }
    case STATE.CHEST: // § E2.C : 1 / 2 / 3 prennent un lot, Entrée passe l'animation, R relance, X passe, B bannit ; Échap ignoré
      if (input.pressed(ACTION.CHOICE_1)) chestKey(0);
      else if (input.pressed(ACTION.CHOICE_2)) chestKey(1);
      else if (input.pressed(ACTION.CHOICE_3)) chestKey(2);
      else if (input.pressed(ACTION.CONFIRM)) skipChestAnimation();
      else if (input.pressed(ACTION.REROLL)) rerollLots();
      else if (input.pressed(ACTION.SKIP)) skipLots();
      else if (input.pressed(ACTION.BANISH)) armBanish();
      break;
    case STATE.FUSION: // § E3.F : Entrée, 1 ou Espace passe l'animation (dès la 2e fusion), puis ferme ; Échap ignoré
      if (input.pressed(ACTION.CONFIRM) || input.pressed(ACTION.CHOICE_1) || input.pressed(ACTION.DASH)) closeFusion();
      break;
    case STATE.PAUSED:
      // § E3.I : Échap referme d'abord la fenêtre d'un élément ou un panneau replié ; menus « Pile » (19/11) : depuis la
      // fiche, Échap montre le menu ; depuis le menu, la partie reprend. Tab : du menu à la fiche, de la fiche à la partie.
      if (ui.paramOuvert()) { // § E5.R : fenêtre Paramètres ouverte — Échap la ferme, la partie reste en pause
        if (input.pressed(ACTION.PAUSE) && ui.paramFermer()) audio.play(SFX.UI_CLICK); // § E5.AD
        break;
      }
      if (input.pressed(ACTION.PAUSE) && !ui.pauseBack()) {
        if (resume()) audio.play(SFX.UI_CLICK); // § E5.AD
      } else if (input.pressed(ACTION_FICHE) && !ui.pauseFiche()) {
        if (resume()) audio.play(SFX.UI_CLICK); // § E5.AD
      } else if (input.pressed(ACTION.CONFIRM)) ui.pauseConfirm(); // 16/11, point 1 : Entrée ouvre la fenêtre du menu
      break;
    case STATE.GAMEOVER:
      if (input.pressed(ACTION.CONFIRM)) restart();
      break;
    default:
      break;
  }
}

/** F8 : temps d'état et transitions automatiques ; la première garde vraie gagne. */
let sonVagueLance = false; // son de début de vague déjà lancé pendant ce compte à rebours (lead)
function postSim(realDt) {
  game.stateTime += realDt;
  switch (game.state) {
    case STATE.COUNTDOWN: {
      if (!P.alive) {
        if (mortClaire.PHASE[0] !== mortClaire.RALENTI) enterGameOver(); // T4 ; § E5.AK : après le ralenti (solo)
        break;
      }
      const C = WAVES.countdown;
      // son de début de vague lancé EN AVANCE (lead du manifeste, outils/preparer_debut_vague.py) : le pic du « Warp In »
      // tombe pile au départ de la vague. Pas de son si la vague bat le record (NEW_BEST le remplace, comme noteRecord).
      const avance = audio.lead(SFX.WAVE_START);
      if (avance > 0 && !sonVagueLance && game.stateTime >= C.from * C.stepSeconds - avance) {
        sonVagueLance = true;
        const b = game.best;
        if (!(b && run.wave + 1 > b.wave && !game.recordBeaten)) audio.play(SFX.WAVE_START);
      }
      if (game.stateTime >= C.from * C.stepSeconds) {
        // T3
        sonVagueLance = false;
        game.countdown = 0;
        ui.setCountdown(0);
        if (C.sonGo) audio.play(SFX.COUNTDOWN_GO);
        const next = run.wave + 1;
        setState(STATE.PLAYING);
        // § E4.F.4 : les reportés (garés) sont comptés par startWave, puis rentrent par les bords, étalés dans le temps
        waves.startWave(next, noteRecord(next)); // § E1.S : record battu → sa bannière et son son tiennent lieu de « Vague n »
        terminal.onWaveStart(next); // § E5.V
        horsCombat(); // § E5.V : fin du compte à rebours, encore hors combat (le record s'écrit comme avant)
      } else {
        const digit = C.from - Math.floor(game.stateTime / C.stepSeconds);
        if (digit !== game.countdown) {
          game.countdown = digit;
          ui.setCountdown(digit);
          audio.playStep(SFX.COUNTDOWN_TICK); // le fichier lancé au « 3 » contient déjà « 2, 1 »
          audio.play(SFX.COMPTE_CLIC); // clic discret sur chaque chiffre (Femz 17/11 : « Glassy Click », pas fort)
        }
      }
      break;
    }
    case STATE.PLAYING:
      if (!P.alive) {
        if (mortClaire.PHASE[0] !== mortClaire.RALENTI) enterGameOver(); // T4 (priorité 1) ; § E5.AK : après le ralenti (solo)
      } else if (waves.isCleared() && !isPauseWave(run.wave) && !game.pauseForcee) {
        basculer(); // § E5.V (priorité 2) : la vague suivante démarre dans cette image, rien n'est figé ni retiré
      } else if (waves.isCleared()) {
        // T5 (priorité 2) — § E5.V : seulement la veille d'un boss (le décryptage) ; game.pauseForcee : crochet de test
        // (debug.forcePause) — cette fin de vague-ci prend le chemin du décryptage, une fois
        game.pauseForcee = false;
        setState(STATE.WAVE_CLEAR);
        game.phase = CLEAR_PHASE.VACUUM;
        terminal.forceDepart(); // § E5.V : il repart avant que le marchand du décryptage arrive
        arrivalStarted = false;
        enemies.fadeProjectiles(REPLI.fadeSeconds); // § E4.F.2 : tirs en vol éteints en rétrécissant (sans effet), plus d'un coup
        boss.clearHazards();
        hazards.fadeOut(REPLI.fadeSeconds); // zones au sol des robots (§ E1.B), éteintes de même (§ E4.F.2)
        events.clear(); // événement de vague en cours (§ E1.C) : lumière rendue, anneau dissous, capsule non prise retirée
        defis.onWaveClear(); // § E4.A : succès de fin de vague, puis écriture (premier moment hors combat de la vague)
        horsCombat(); // § E5.V : record d'une bascule de ce palier
        // § E3.K (remplace la purge du § E1.A règle 9) : les robots en vie SURVIVENT à la fin de vague — en veille
        // jusqu'au départ de la suivante, où ils comptent dans son minimum en vie ; au-delà de CARRY.cap, les excédents
        // sont fusionnés (PV cumulés). enemies.purgeAll reste (mort en lot, I.E.M du chantier C).
        // § E4.F.2 (remplace la veille sur place) : les survivants courent hors champ, puis sont garés ; la fusion au
        // plafond attend qu'ils soient TOUS garés (cas WAVE_CLEAR ci-dessous) : jamais à l'écran
        enemies.beginRetreat();
        lateCarriersDrop(); // § E3.K × § E2.C règle 4 (fusion du groupe 1) : avant chests.endWave (coffres gardés)
        carryMergePending = true;
        const carryN = E.aliveCount;
        // § E2.G bis G1 : le butin resté au sol n'est plus aspiré d'office — seul le butin gardé (boss, rattrapage, déjà
        // attiré ; END_LOOT.mode) l'est ; le reste se désintègre avec les robots et il est perdu
        pickups.endWave();
        chests.endWave();
        disquette.endWave(); // § E4.Q : la disquette est toujours gardée, aspirée vers le héros
        ui.showBanner('Vague ' + run.wave + ' terminée');
        audio.play(SFX.WAVE_CLEAR);
        if (carryN > 0) ui.queueBanner(CARRY.kicker + carryN + (carryN > 1 ? CARRY.banner : CARRY.bannerOne), CARRY.bannerSeconds, SFX.CARRYOVER); // § E3.K
        if (isBossWave(run.wave)) {
          run.rerolls += CHOICES.rerollPerBoss; // § E2.D : une vague de boss ne finit qu'à sa mort → +1 relance
          if (CHOICES.rerollPerBoss > 0) ramassage.RAM_N[RECAP_T.RELANCE_BOSS]++; // § E5.X7 (H6)
        }
      } else if (run.pendingChoices > 0) {
        enterLevelUp(STATE.PLAYING); // T6 (priorité 3)
      } else if (run.chests > 0) {
        enterChest(STATE.PLAYING); // T6b (priorité 4, § E2.C)
      } else if (items.pendingFusion() >= 0) {
        enterFusion(STATE.PLAYING); // T6c (priorité 5, § E3.F)
      } else if (TPRET[0] === 1 && input.pressed(ACTION_INTERACT)) {
        ouvrirTerminal(); // § E5.V (tâche 6, priorité 6) : décryptage en pause depuis le terminal posé
      }
      break;
    case STATE.WAVE_CLEAR:
      if (carryMergePending && enemies.retreatDone()) {
        // § E4.F.3 : tous garés (hors champ) → fusion au plafond, sans voxels (§ E3.K règle 3), bannière à la suite
        carryMergePending = false;
        const carryMerged = enemies.mergeExcessF(CARRY.cap, true);
        if (carryMerged > 0) ui.queueBanner(CARRY.mergeKicker + carryMerged + CARRY.mergeBanner, CARRY.bannerSeconds, SFX.CARRYOVER); // § E3.K ; § E5.AD : avec son son
      }
      if (!P.alive) {
        if (mortClaire.PHASE[0] !== mortClaire.RALENTI) enterGameOver(); // T4 ; § E5.AK : après le ralenti (solo)
      } else if (game.phase === CLEAR_PHASE.VACUUM) {
        // § E4.F.3 : la phase d'aspiration ne finit pas tant qu'un robot est en repli (les écrans suivants figent la scène)
        const done = !carryMergePending && game.stateTime >= SHOP.vacuumMinSeconds && ((pickups.getVacuumCount() === 0 && chests.getGroundCount() === 0 && disquette.getGroundCount() === 0) || game.stateTime >= SHOP.vacuumMaxSeconds);
        if (done) {
          pickups.collectAll(); // ce qui reste est crédité d'office, PUIS on relit les choix en attente
          chests.collectAll(); // § E2.C : de même pour les coffres encore au sol
          disquette.collectAll(); // § E4.Q : de même pour une disquette encore au sol
          game.phase = CLEAR_PHASE.MERCHANT_IN;
          if (run.chests > 0) {
            enterChest(STATE.WAVE_CLEAR); // T9b : les coffres d'abord, puis les choix de niveau, puis le marchand
          } else if (run.pendingChoices > 0) {
            enterLevelUp(STATE.WAVE_CLEAR); // T9 : les choix d'abord, le marchand ensuite (T8)
          } else if (items.pendingFusion() >= 0) {
            enterFusion(STATE.WAVE_CLEAR); // T9c (§ E3.F) : après les coffres et les choix, avant le marchand
          } else {
            arrivalStarted = true; // T10
            shop.beginArrival();
          }
        }
      } else if (run.chests > 0) {
        enterChest(STATE.WAVE_CLEAR); // T9b (phase MERCHANT_IN, § E2.C) : avant T9
      } else if (run.pendingChoices > 0) {
        enterLevelUp(STATE.WAVE_CLEAR); // T9 (phase MERCHANT_IN) : avant T11
      } else if (items.pendingFusion() >= 0) {
        enterFusion(STATE.WAVE_CLEAR); // T9c (phase MERCHANT_IN, § E3.F) : avant T11
      } else if (!arrivalStarted) {
        arrivalStarted = true;
        shop.beginArrival();
      } else if (shop.isArrivalDone()) {
        // T11
        setState(STATE.SHOP);
        game.phase = null;
        game.shopOrigine = 'decryptage'; // § E5.V
        shop.open();
        ui.setScreen(SCREEN.SHOP, shop.getView());
      }
      break;
    default:
      break;
  }
}

/**
 * § E3.K × § E2.C règle 4 / § E2.S S1 (fusion du groupe 1, 15/11/2026). Avant le chantier K, une élite porteuse purgée
 * au chrono lâchait son coffre (gardé, rareté de la porteuse) si le joueur était en retard sur le calendrier d'armes :
 * c'était le coffre de rattrapage. Sans purge, la porteuse survit et gardait ce coffre jusqu'à sa mort dans la vague
 * suivante — les armes arrivaient plus tard (mesuré par K : 5e arme dans 16 parties sur 20 au lieu de 20). Règle de la
 * fusion : en retard, chaque porteuse vivante lâche à zéro le même coffre qu'avant, et elle est reportée comme un robot
 * ordinaire de son type (ni anneau, ni modificateur, ni second coffre) : la menace reste, le coffre n'est pas doublé.
 * Hors combat (une fois par fin de vague) : les appels à flottants sont permis.
 */
function lateCarriersDrop() {
  if (!CHESTS.carrier.lateDrop || !chests.isLate()) return;
  for (let i = 0; i < E.count; i++) {
    if (E.alive[i] === 0 || (E.flags[i] & EFLAG.ELITE) === 0 || E.type[i] === ENEMY.BOSS) continue;
    chests.dropAt(E.x[i], E.z[i], E.rarity[i], CHEST_FLAG.EXACT | CHEST_FLAG.KEEP);
    E.flags[i] &= ~EFLAG.ELITE;
    E.mod[i] = 0;
  }
}

// ----- Boucle (§ C.3) ----------------------------------------------------------------------------------------------------

function simulate(dt) {
  if (game.state === STATE.PLAYING) run.time += dt; // S1
  if (game.state === STATE.PLAYING) defis.tick(dt); // S1 bis (§ E4.A) : PV bas, conditions des succès toutes les 0,5 s
  vfx.H[0] += dt; // S1 : horloge des VFX datés (temps simulé dans tous les états qui simulent, § Z septies)
  player.update(dt); // S2
  soinHeros.update(dt); // S2 bis (§ E5.Q, B14) : lueur verte, « +N », éclat de la barre — soins de l'image précédente
  waves.update(dt); // S3
  events.update(dt); // S3 bis : événements de vague (§ E1.C) — déclenchement au chrono, essaim, frappes, panne, anneau, capsule
  grid.rebuild(); // S4 : (1) avant le déplacement — sert à la séparation
  enemies.update(dt); // S5
  elites.update(dt); // S5 bis (§ E3.A) : régénération, couveuse, traînée, phase — indices de l'image
  boss.update(dt); // S6
  hazards.update(dt); // S6 bis : zones au sol des robots (§ E1.B) — impacts des obus, tics des flaques
  grid.rebuild(); // S7 : (2) après le déplacement — sert aux armes, exacte
  cooldowns.update(dt); // S8 (§ E3.H) : recharges et fenêtres, avant les armes
  weapons.update(dt); // S8
  items.update(dt); // S8 bis (§ E2.F) : file des déclenchements des objets, statuts, drones — grille exacte de S7
  enemies.updateProjectiles(dt); // S9
  const blink = waves.lootBlink(); // § E2.G bis G1 règle 3 : clignotement du butin qui sera perdu
  pickups.setBlink(blink);
  chests.setBlink(blink);
  pickups.update(dt); // S10
  chests.update(dt); // S10 bis (§ E2.C) : coffres au sol — flottement, aspiration, ramassage
  disquette.update(dt); // S10 bis (§ E4.Q) : disquette au sol — aspiration, ramassage
  props.update(dt); // S8 ter (§ E3.C) : bornes — repousse à la nouvelle vague, contact du héros
  utilities.update(dt); // S8 ter (§ E3.C) : effets à durée, ramassage des utilitaires
  shop.update(dt); // S11
  terminal.update(dt); // S11 bis (§ E5.V) : pose, présence, portée du terminal
  fx.update(dt); // S12
  // skin « Agent de l'ombre » (tâche 4) : fumée aux pointes de la cape et brume au sol, seulement si le héros porte le skin
  {
    const E = brumeOmbre.ENTREE; // tableau typé : aucun flottant passé en argument (§ V)
    const porte = player.skinCourant() === 'ombre';
    E[0] = dt;
    E[1] = porte ? 1 : 0;
    E[2] = P.x;
    E[3] = P.z;
    E[4] = Math.sqrt(P.vx * P.vx + P.vz * P.vz);
    E[5] = P.dashT > 0 ? 1 : 0;
    E[6] = game.settings.graphismes === 'basse' || render.niveau() >= 3 ? 1 : 0; // Basse choisie, ou Auto retombé au niveau 3
    E[7] = P.vx;
    E[8] = P.vz;
    brumeOmbre.update();
  }
  enemies.flushDead(); // S13
}

/** F0 : le pas de temps. Les deux durées sont calculées ICI, puis passées telles quelles à toute l'image. */
function frame(now) {
  if (modelesNouveau) modelesTraiter();
  if (agentsArrives.length > 0) agentsTraiter(); // § E5.K
  if (capsuleNouvelle) capsuleTraiter();
  if (menuNouveau) menuTraiter();
  const frameMs = previous[0] < 0 ? 1000 / 60 : now - previous[0];
  previous[0] = now;
  let realDt = frameMs / 1000;
  if (realDt < 0) realDt = 0;
  else if (realDt > LOOP.maxDt) realDt = LOOP.maxDt;
  game.frame++;
  try {
    runFrame(frameMs, realDt);
  } catch (e) {
    erreurImage(e); // § E5.X2 : la boucle continue, la partie se met en pause, le joueur est prévenu
  }
}

/**
 * F1 à F16. Fonction à part de frame() à dessein : V8 alloue un nombre (12 octets) chaque fois qu'un flottant
 * CALCULÉ sur place est passé à une fonction qu'il n'a pas mise en ligne. Reçues ici en paramètres, frameMs et
 * realDt ne sont emballées qu'une fois, puis transmises aux dix modules sans nouvelle allocation (§ V).
 */
function runFrame(frameMs, realDt) {
  debug.begin(0);
  render.beginFrame(frameMs); // F1
  input.poll(); // F2
  debug.preUpdate(); // F3
  handleKeys(); // F4
  if (erreurTest !== 0) {
    erreurTest--;
    throw new Error('erreur de test (§ E5.X2)');
  }
  fx.updateReal(realDt); // F5
  // F6
  const s = game.state;
  const simulated = s === STATE.PLAYING || s === STATE.WAVE_CLEAR || s === STATE.COUNTDOWN;
  const simDt = simulated ? realDt * fx.getTimeScale() * mortClaire.ECHELLE[0] : 0; // § E5.AK : ralenti du coup mortel (1 sinon)
  // F7 : quand simDt = 0 la simulation n'est pas appelée du tout ; aucun update ne reçoit dt = 0
  if (simDt > 0) {
    debug.begin(1);
    simulate(simDt);
    debug.end(1);
  } else if (s === STATE.GAMEOVER && realDt > 0) {
    fx.update(realDt); // les effets en cours vont jusqu'au bout
    vfx.H[0] += realDt; // de même pour les VFX datés (rayons, explosions, fumée des traînées)
  }
  // § E1.S : le chrono de la vague compte le temps RÉEL — il reçoit ici ce que la simulation n'a pas eu (arrêt sur
  // image, ralenti) ; les deux durées sont passées telles quelles (aucun flottant créé pour l'appel, § V).
  if (s === STATE.PLAYING && realDt > simDt) waves.advanceClock(realDt, simDt);
  //#region e5:AK-mort-claire
  mortClaire.DT[0] = realDt; // § E5.AK : dt lu dans un tableau typé (§ V)
  mortClaire.update(); // coup mortel vu, ralenti, robot suivi, camera.REGARD — chaque image, avant les transitions
  //#endregion e5:AK-mort-claire
  postSim(realDt); // F8
  zoomMolette(); // § E2.E : la molette règle le zoom demandé (en partie seulement), avant que la caméra le rejoigne
  //#region e5:AB-camera-3p
  verrou.update(); // § E5.AB.5 : verrou pris en partie, rendu ailleurs (après les transitions d'état de l'image)
  // § E5.AB.2 : la caméra lit input.ROTATION elle-même (lierRotation) ; hors partie, les écarts sont jetés
  if (game.state !== STATE.PLAYING && game.state !== STATE.WAVE_CLEAR && game.state !== STATE.COUNTDOWN) input.ROTATION[0] = 0;
  //#endregion e5:AB-camera-3p
  camera.update(realDt); // F9
  world.update(realDt); // F10
  // F11
  debug.begin(2);
  player.sync();
  enemies.sync();
  hazards.sync(); // après enemies.sync : les obus en vol s'ajoutent aux tirs ennemis (§ E1.B ; § E4.J : maillage tirs-canon)
  tirsCanon.commit(); // § E4.J : balles (enemies) + obus (hazards), un appel de dessin
  events.sync(); // capsule de ravitaillement (§ E1.C), avant world.sync qui pose son ombre de contact
  boss.sync();
  weapons.sync();
  pickups.sync();
  chests.sync(); // § E2.C : coffres au sol, aura des élites porteuses
  disquette.sync(); // § E4.Q : disquette au sol (chute, balancement, pouls)
  elites.sync(); // § E3.A : icônes des modificateurs, bulles des générateurs de bouclier
  barres.DT[0] = realDt; // § E4.H : dt lu dans un tableau typé (aucun flottant passé en argument, § V)
  barres.DT[1] = simDt; // § E5.AI : attente du fondu de la barre du héros en temps de jeu
  barres.sync(); // § E4.H : petites barres de vie (élites, blindés, fusionnés)
  props.sync(); // § E3.C
  inviteInteragir.DT[0] = realDt; // § E5.C : dt lu dans un tableau typé (§ V)
  inviteInteragir.sync(); // § E5.C : après props.sync (borne prête de l'image)
  mortClaire.sync(); // § E5.AK : flèche au-dessus de la source du coup mortel (cachée hors de la mort)
  utilities.sync(); // § E3.C
  items.sync(); // § E2.F : drones compagnons
  domeParefeu.sync(); // § E5.B : dôme du Pare-feu sur le héros (état lu dans items, source du coup dans damage)
  coqueReactive.sync(); // § E5.H : Coque réactive sur le héros (état lu dans items et cooldowns)
  shop.sync();
  terminal.sync(); // § E5.V (22/11) : modèle du terminal (chute, posé, remontée)
  fx.sync();
  brumeOmbre.sync(); // skin ombre : disques de brume et fumée
  silhouetteHeros.DTUS[0] = realDt * 1e6; // § E5.P (B1) : dt en µs, entier, lu dans un tableau typé (§ V)
  silhouetteHeros.sync(); // § E5.P (B1) : après player.sync (héros posé) et fx.sync, dessinée après les chiffres
  vfx.commit(); // VFX des projectiles (§ Z septies) : traînées, comptes, envoi des lots — avant world.sync qui les lit
  world.sync(); // rendu peint : ombres de contact et lumière émise, après tous les sync (§ Z quater)
  debug.end(2);
  ui.update(realDt); // F12
  hudVoile.update(); // § E5.M (B11)
  // Bande-son (21/11) : la piste suit l'état du jeu ; audio.setMusique seulement quand elle change (fondu enchaîné)
  const piste = pisteVoulue();
  if (piste !== pisteJouee) {
    pisteJouee = piste;
    audio.setMusique(piste);
  }
  audio.update(realDt); // F13
  debug.begin(3);
  // F14 — écran titre À LA PLACE du monde (§ Z octies ; tâche 7 : l'accueil peint, la vitrine de l'agent choisi) ; fond
  // uni tant qu'il n'est pas arrivé
  if (game.state === STATE.AGENT) {
    // Écran Agents : plein écran sur fond peint OPAQUE — la scène derrière (titre, Noyau) n'est pas rendue ; seule la
    // vitrine 3D de la fiche l'est (rien si fermée)
    pauseAgent.renderVitrine(realDt);
    render.noteFrame();
  } else if (game.state === STATE.TITLE || game.state === STATE.HUB) { // § E4.B : l'écran titre (fond peint, vitrine) reste derrière le hub
    pauseAgent.renderVitrine(realDt); // tâche 7 : l'agent choisi de l'écran titre (cadre titre) ; rien si fermée
    if (menu !== null) {
      menu.image(realDt); // accueil : poussière (le fond est un calque CSS) ; outil : la scène 3D
      render.noteFrame();
    } else render.clearScreen();
  } else {
    if (game.state === STATE.PAUSED) pauseAgent.render(realDt); // § E3.I : portrait 3D, AVANT la scène (qui le recouvre)
    render.render();
  }
  debug.end(3);
  debug.end(0);
  debug.postRender(realDt); // F15
  // Simulation figée (hitstop) dans un état qui simule, et l'état n'a pas changé : player.update n'a pas vu
  // l'appui sur Espace. Le front est reporté à l'image suivante au lieu d'être perdu — on esquive justement au
  // moment des gros coups. Seul le dash est reporté : les autres fronts (pause, debug) ont été traités en F3 et
  // F4, et le seraient deux fois.
  if (simulated && simDt === 0 && game.state === s && input.pressed(ACTION.DASH)) input.requeue(ACTION.DASH);
  if (simulated && simDt === 0 && game.state === s && input.pressed(ACTION_INTERACT)) input.requeue(ACTION_INTERACT); // § E5.C : appui sur Interagir pendant un arrêt sur image
  input.endFrame(); // F16
}

// ----- Démarrage ---------------------------------------------------------------------------------------------------------

/** Pose les modèles des unités arrivés : chaque module prend sa géométrie (§ Z quinquies). */
function poserModeles() {
  const d = modelesArrives;
  modelesArrives = null;
  if (d.skinEchoue) player.signalerEchecSkin(d.agent, d.skinEchoue); // le skin du départ ne charge pas : base
  player.vouloirSkin(skinHeros(run.agent));
  player.setModele(d.heros, d.agents); // un modèle par agent (fusion agents-modeles), posé hors combat
  enemies.setModeles(d.robots);
  boss.setModele(d.boss.corps, d.boss.chaud, d.boss.complet); // après enemies : boss-anim reprend le modèle du drone
  shop.setModele(d.marchand);
  modelesInfo.ms = d.ms;
  game.modeles = 'pret';
}

/** Créneau de lecture d'un modèle (agent × skin). */
function creneau(a, skin) {
  const i = skinsDe(AGENTS[a].key).indexOf(skin);
  return a * SKINS_MAX + (i < 0 ? 0 : i);
}

/** Skin du héros de l'agent a : le skin effectif de la méta (choisi ET débloqué), sa base si son fichier ne charge pas. */
function skinHeros(a) {
  return player.skinPour(a, meta.skinEffectif(AGENTS[a].key));
}

/**
 * § E5.K : le modèle de run.agent (et de son skin effectif) est-il là ? Oui : il est posé (hors combat) et tous les autres
 * sont libérés (vrai). Non : sa lecture est lancée si elle ne l'est pas déjà (faux). Modèles du démarrage pas encore posés : faux.
 */
function demanderModeleAgent() {
  if (game.modeles !== 'pret') return false;
  const a = run.agent;
  const skin = skinHeros(a);
  player.vouloirSkin(skin);
  if (player.aModeleAgent(a, skin)) {
    poserAgentCourant();
    return true;
  }
  lireModele(a, skin);
  return false;
}

/** § E5.K : lecture du modèle de l'agent a (skin donné) lancée s'il n'est ni chargé ni déjà en lecture (arrivée : agentsTraiter). */
function lireModele(a, skin = SKIN_BASE) {
  if (game.modeles !== 'pret' || player.aModeleAgent(a, skin)) return;
  const c = creneau(a, skin);
  if (agentsEnLecture[c] === 0) {
    agentsEnLecture[c] = 1;
    const t0 = performance.now();
    agentsPromesses[c] = chargerAgent(a, undefined, skin).then(
      (d) => {
        agentsArrives.push({ a, skin, d, erreur: '', ms: performance.now() - t0 });
      },
      (e) => {
        agentsArrives.push({ a, skin, d: null, erreur: String((e && e.message) || e), ms: 0 });
      },
    );
  }
}

/**
 * § E5.K : pose le modèle de run.agent et libère les autres (données de jeu, puis leur glTF dans le cache de glb.js),
 * sauf celui de la fiche ouverte de l'écran Agents (libéré à sa fermeture, libererVitrine).
 */
function poserAgentCourant() {
  const libres = player.poserAgentCourant(agentVitrine, skinVitrine);
  for (let i = 0; i < libres.length; i++) oublierAgent(libres[i].a, undefined, libres[i].skin);
  agentsInfo.liberes += libres.length;
}

/**
 * § E5.K : début d'une image, après l'arrivée du modèle d'un agent. Celui de run.agent : rangé, posé (les autres libérés),
 * préchauffé ; la partie demandée démarre. Celui de l'agent de la fiche ouverte (écran Agents) : rangé sans être posé, la
 * vitrine le montre à l'image suivante. Un modèle arrivé pour un agent qui n'est ni choisi ni montré est oublié.
 * Un skin dont le fichier ne charge pas : un avertissement, le modèle de base le remplace (lu à sa place).
 */
function agentsTraiter() {
  let pose = false;
  let repli = false;
  while (agentsArrives.length > 0) {
    const r = agentsArrives.shift();
    const c = creneau(r.a, r.skin);
    agentsEnLecture[c] = 0;
    agentsPromesses[c] = null;
    if (r.d === null) {
      if (r.skin !== SKIN_BASE) {
        avertirSkin(r.a, r.skin, r.erreur);
        player.signalerEchecSkin(r.a, r.skin);
        repli = true;
        continue;
      }
      console.error('Modèle de l’agent illisible :', r.erreur);
      if (r.a === run.agent && lancementDemande !== null) memoire.echecAgent(r.erreur);
      continue;
    }
    const heros = r.a === run.agent && r.skin === skinHeros(r.a);
    if (!heros && r.a === agentVitrine && r.skin === skinVitrine && game.state === STATE.AGENT) {
      player.ajouterModeleAgent(r.a, r.skin, r.d); // fiche : gardé (non posé) tant qu'elle est ouverte
      agentsInfo.lus++;
      agentsInfo.ms = r.ms;
      continue;
    }
    if (!heros) {
      r.d.geometry.dispose();
      oublierAgent(r.a, undefined, r.skin);
      continue;
    }
    player.ajouterModeleAgent(r.a, r.skin, r.d);
    agentsInfo.lus++;
    agentsInfo.ms = r.ms;
    pose = true;
  }
  const horsCombat = game.state === STATE.TITLE || game.state === STATE.AGENT || game.state === STATE.HUB;
  if (repli && horsCombat) {
    // le modèle de base prend la place du skin illisible (héros de la partie, puis fiche ouverte) ; s'il est déjà là, il
    // est posé tout de suite : « Jouer » pressé pendant la lecture du skin ne doit pas rester bloqué (pose = vrai)
    if (demanderModeleAgent()) pose = true;
    if (agentVitrine >= 0) {
      const k = AGENTS[agentVitrine].key;
      const verrou = meta.agentVerrouille(agentVitrine) || !meta.skinDebloque(k, agentView.skinVise);
      const skin = verrou ? SKIN_BASE : player.skinPour(agentVitrine, agentView.skinVise);
      if (skin !== skinVitrine) ficheVitrine();
    }
  }
  if (!pose || !player.aModeleAgent(run.agent, skinHeros(run.agent))) return;
  if (!horsCombat) return; // jamais en partie (la lecture n'est lancée que hors combat ; garde)
  poserAgentCourant();
  render.prewarm(); // géométrie du nouvel agent envoyée hors combat
  pauseAgent.prechauffer(); // portrait de la pause sur le modèle chargé
  if (lancementDemande !== null && lancementDemande === game.state) launch();
  else if (lancementDemande !== null) {
    lancementDemande = null;
    memoire.attente(false);
  }
}

/**
 * Début d'une image, après l'arrivée (ou l'échec) des modèles pendant l'écran titre : pose, préchauffage (géométries
 * envoyées, programmes déjà compilés : la même image est ensuite rendue normalement), crochets de test publiés, écran
 * titre mis à jour et partie lancée si elle avait été demandée.
 */
function modelesTraiter() {
  modelesNouveau = false;
  if (modelesArrives !== null) {
    poserModeles();
    demanderModeleAgent(); // § E5.K : agent de la partie ≠ celui lu au démarrage (verrouillé) → lu maintenant
    if (agentVitrine >= 0) lireModele(agentVitrine, skinVitrine); // fiche de l'écran Agents ouverte pendant le chargement
    prechaufferSansBloquer(); // 20/11 : les programmes des modèles compilés sans figer la page (puis prewarm + portrait)
  }
  tenterPublier();
  if (game.state === STATE.TITLE) {
    fillTitleLoading();
    ui.setScreen(SCREEN.TITLE, titleView);
    if (departDemande && game.modeles === 'pret') start();
  }
}

/**
 * window.__game n'est publié qu'une fois les modèles des unités ET la scène du menu arrivés (ou en échec) : un test qui
 * attend window.__game ne mesure jamais une image pendant que le menu se construit (§ Z octies).
 */
function tenterPublier() {
  // § E5.J : étapes du démarrage pour l'écran de chargement (src/chargement.js) ; prêt = les trois conditions ci-dessous
  window.dispatchEvent(
    new CustomEvent('sr-chargement', { detail: { modeles: game.modeles, menu: game.menu, capsule: capsulePosee && shadersEnAttente === 0, erreur: modelesInfo.erreur || '' } }),
  );
  if (game.modeles !== 'chargement' && game.menu !== 'chargement' && capsulePosee && shadersEnAttente === 0) debug.publish();
}

/** Début d'une image, après l'arrivée (ou l'échec) du modèle de la capsule de ravitaillement : géométrie envoyée par un préchauffage. */
function capsuleTraiter() {
  capsuleNouvelle = false;
  capsulePosee = true;
  render.prewarm();
  tenterPublier();
}

/** Début d'une image, après l'arrivée (ou l'échec) de la scène du menu : branchement, affichage si l'écran titre est là. */
function menuTraiter() {
  menuNouveau = false;
  if (menuArrive !== null) {
    menu = menuArrive;
    menuArrive = null;
    ctx.menu = menu;
    ctx.accueil = SCENE_OUTIL ? null : menu; // debug.accueil()
    game.menu = 'pret';
    if (game.state === STATE.TITLE || game.state === STATE.HUB) afficherMenu(); // § E4.B : le hub garde l'écran titre ; l'écran Agents le cache
  }
  tenterPublier();
}

/** Écran titre (promesse : l'accueil, ou la scène 3D en mode outil), pour les pages de prototype (tests/menu). */
export function menuIntegre() {
  return menuPromesse;
}

async function boot() {
  // Modèles des unités (§ Z quinquies) : chargés en arrière-plan, en même temps que le décor ; l'écran titre s'affiche
  // sans les attendre. Lents : rien ne casse, « Jouer » attend ; absents ou illisibles : erreur affichée sur l'écran titre.
  const modelesPromesse = chargerModeles(undefined, { agent: agentSauve() }); // la méta n'est pas lue : le skin choisi est lu ensuite (demanderModeleAgent) // § E5.K : l'agent choisi seulement
  modelesPromesse.then(
    (d) => {
      modelesArrives = d;
      modelesNouveau = true;
    },
    (e) => {
      game.modeles = 'erreur';
      modelesInfo.erreur = String((e && e.message) || e);
      modelesNouveau = true;
      console.error('Modèles des unités illisibles :', e);
    },
  );
  // Rendu peint (§ Z quater) : le décor modélisé sous Blender est chargé AVANT toute init (le monde est construit
  // d'un coup, son ombre figée cuite avant le prewarm). preload ne lève jamais (repli : décor procédural).
  await world.preload();
  // Ordre des init : fixe (§ C.1).
  camera.init(ctx);
  render.init(ctx);
  memoire.brancher(ctx.canvas, () => pause('menu')); // § E5.K : contexte WebGL perdu → message + Recharger ; § E5.X2 : partie en pause
  // Écran titre (tâche 7) : l'accueil peint ; outil de cuisson (SCENE_OUTIL) : la scène 3D de menu.js, importée à la
  // demande (ses modules — héros, boss, décor — ne sont jamais chargés sinon). Renderer du jeu, son par audio.js.
  const tMenu = performance.now();
  menuPromesse = SCENE_OUTIL
    ? import('./menu/menu.js').then((m) => m.creerMenu({ renderer: ctx.renderer, base: RACINE, audio }))
    : creerAccueil({ renderer: ctx.renderer, base: RACINE, audio });
  menuPromesse.then(
    (m) => {
      menuArrive = m;
      menuInfo.ms = performance.now() - tMenu;
      menuNouveau = true;
    },
    (e) => {
      game.menu = 'erreur';
      menuInfo.erreur = String((e && e.message) || e);
      menuNouveau = true;
      // Même cause qu'un modèle d'unité absent (heros.glb, boss.glb, lus aussi par le menu) : déjà signalée par le jeu,
      // pas de second message ; sinon (décor du menu absent…) l'erreur est écrite. Le jeu reste jouable sur fond uni.
      modelesPromesse.then(
        () => console.error('Scène de l’écran titre illisible :', e),
        () => {},
      );
    },
  );
  world.init(ctx);
  vfx.init(ctx.scene); // les 5 lots des projectiles « toon », avant les modules qui y écrivent (weapons, enemies)
  input.init(ctx);
  audio.init(ctx);
  grid.init(ctx);
  damage.init(ctx);
  player.init(ctx);
  tirsCanon.init(render); // § E4.J : avant enemies et hazards, qui y écrivent
  enemies.init(ctx);
  boss.init(ctx);
  hazards.init(ctx);
  weapons.init(ctx);
  pickups.init(ctx);
  progression.init(ctx);
  agents.init(ctx); // § E2.D
  waves.init(ctx);
  shop.init(ctx);
  ctx.terminal = terminal; // § E5.V (lu par ui.js : flèche de bord d'écran, piste du palier)
  ctx.libelleInteragir = inviteInteragir.libelle; // § E5.V tâche 7 : touche réelle dans « Terminal posé [E] »
  terminal.init(ctx);
  chests.init(ctx); // § E2.C : avant world.initLate
  disquette.init(ctx); // § E4.Q : avant world.initLate (tache de lumière trouvée par son nom)
  elites.init(ctx); // § E3.A
  barres.init(ctx); // § E4.H
  items.init(ctx); // § E2.F : avant world.initLate (ombre de contact des drones)
  domeParefeu.init(ctx); // § E5.B : après items (lit son état), avant le préchauffage (programme compilé hors combat)
  coqueReactive.init(ctx); // § E5.H : idem (lit items et ctx.cooldowns, posé plus haut)
  events.init(ctx); // avant world.initLate : l'ombre de contact retrouve la capsule par son nom
  utilities.init(ctx); // § E3.C
  cooldowns.init(ctx); // § E3.H : après weapons et items (niveaux, piles)
  props.init(ctx); // § E3.C : après utilities (lâche des utilitaires)
  inviteInteragir.init(ctx); // § E5.C : avant le préchauffage (programme du sprite compilé hors combat)
  mortClaire.init(ctx); // § E5.AK : flèche du coup mortel, avant le préchauffage (programme du sprite compilé hors combat)
  evolutions.init(ctx); // § E3.B : après weapons et items (recettes résolues par clé)
  defis.init(ctx); // § E4.A : conditions et textes des succès (lit chests, weapons, items, damage, ui par ctx)
  if (game.debug) window.__e3c = { props, utilities, ctx }; // § E3.C : crochets des tests du chantier (debug seulement)
  // § E2.C : le modèle du coffre arrive de la même façon ; un seul préchauffage quand ils sont tous là.
  // Fusion de la phase 1 (§ E2.I) : le modèle des sentinelles (§ E2.A, chargé par weapons.init) attend avec eux — sa
  // géométrie est envoyée par ce préchauffage, pas à la première tourelle posée en plein combat.
  Promise.all([events.whenModelSettled(), chests.whenModelSettled(), disquette.whenModelSettled(), weapons.whenTurretModelSettled(), items.whenModelSettled(), terminal.whenModelSettled()]).then(() => {
    capsuleNouvelle = true;
  });
  props.whenModelSettled().then(() => {
    capsuleNouvelle = true; // § E3.C : la géométrie de la borne est envoyée par un préchauffage de plus, hors combat
  });
  fx.init(ctx);
  brumeOmbre.init(ctx.scene); // skin ombre (tâche 4) : pool de brume et fumée, vides tant que le héros ne porte pas le skin
  soinHeros.init(ctx); // § E5.Q (B14) : après fx (le « +N » passe par fx.spawnHealNumberF)
  silhouetteHeros.init(ctx); // § E5.P (B1) : après fx.init (les chiffres d'abord dans la scène nette)
  verrou.init(ctx); // § E5.AB (après input.init : il écrit l'état du verrou dans input)
  ctx.verrou = verrou; // lu par ui.js (curseur du jeu, plaque) et debug
  ui.init(ctx);
  pauseAgent.init(ctx); // § E3.I
  ctx.pauseAgent = pauseAgent; // § E3.I (lu par debug)
  // § E4.E.3 : Warrior Idle (pistes cuites) — portrait de la fiche et héros immobile en partie ; sans le fichier, les
  // idles calculés restent (repli)
  chargerCuit(HEROS_IDLE.fichier).then(
    (c) => {
      herosSetIdle(c);
      pauseAgent.setIdle(c);
    },
    () => {},
  );
  // § E5.F : idle propre au Bastion et au Shinobi (Mixamo, cuits sur leur robot) ; l'Éclaireur garde Warrior Idle
  IDLES_AGENTS.fichiers.forEach((f, a) => {
    if (!f) return;
    chargerCuit(f).then(
      (c) => {
        herosIdles.setIdleAgent(a, c);
        pauseAgent.setIdleAgent(a, c);
      },
      () => {},
    );
  });
  // Écran Agents : idles de vitrine (rangés seulement dans pauseAgent, joués en mode vitrine ; la pause garde les siens)
  VITRINE.idles.forEach((f, a) => {
    chargerCuit(f).then(
      (c) => pauseAgent.setIdleVitrine(a, c),
      () => {},
    );
  });
  if (IDLES_AGENTS.marteau.fichier) {
    chargerCuit(IDLES_AGENTS.marteau.fichier).then(
      (c) => {
        herosIdles.setIdleMarteau(c);
        pauseAgent.setIdleMarteau(c); // § E5.F.13 : fiche de pause, Bastion qui tient le marteau
      },
      () => {},
    );
  }
  // § E4.O : coup de pied cuit (« Standing Melee Kick », Mixamo), une piste par agent ; sans fichier, le geste calculé
  // du § E4.J reste (repli)
  if (COUP_DE_PIED.v2 && COUP_DE_PIED.v2.actif) {
    COUP_DE_PIED.v2.fichiers.forEach((f, a) => {
      fetch(f)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(f))))
        .then((doc) => coupPiedCuit.setCuit(a, doc))
        .catch(() => {});
    });
  }
  // § E5.F : bond du Bastion (« Jump Attack » cuit) ; sans fichier, le bond en cloche du 16/11 reste
  if (BOND_CUIT.actif)
    fetch(BOND_CUIT.fichier)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(BOND_CUIT.fichier))))
      .then((doc) => bondCuit.setCuit(doc))
      .catch(() => {});
  debug.init(ctx);
  world.initLate(); // ombres de contact et lumière émise : retrouvent les maillages de tous les modules
  if (modelesArrives !== null) {
    modelesNouveau = false;
    poserModeles(); // déjà là (le cas courant en local) : posés avant le préchauffage
  }

  resetAll();
  render.resize();
  world.update(0); // la caméra d'ombre est en place avant l'image de préchauffage
  prechaufferSansBloquer(); // 20/11 : sans bloquer la page (puis prewarm + portrait de la pause, quand c'est prêt)
  loadSave();
  if (migrationDeplacement) saveSettings(); // § E5.AB.13 : la marque est écrite tout de suite (la migration ne rejoue jamais)
  // § E4.A : sans ?debug, la méta du stockage ; en ?debug, ?meta=tout (défaut : tout débloqué, rien d'écrit),
  // vierge, depart, ou stockage (tests de persistance)
  meta.load(game.debug ? params.get(META.urlParam) || META.debugDefaut : null);
  { // § E5.X2 (audit I2) : sauvegarde abîmée → avis au titre
    const sv = meta.etatSauvegarde();
    if (sv.abimee) incident.avis(sv.reprise ? MEMOIRE.textes.sauvegardeReprise : MEMOIRE.textes.sauvegardePerdue);
  }
  // § E4.A.6 : un succès réussi en pleine vague est gardé. § E4.T.5 b : onglet fermé pour de bon (persisted faux) =
  // « Quitter » : la partie est comptée (vagues terminées et succès payés, une fois : garde de meta.finishRun) ; page mise
  // dans le cache de retour arrière (persisted vrai, elle peut revenir) : succès et « vu » écrits seulement, comme avant.
  window.addEventListener('pagehide', (e) => {
    if (e.persisted) defis.flush();
    else defis.finishRun();
  });
  appliquerZoomSauve(); // § E2.E
  appliquerCameraSauvee(); // § E3.L
  window.addEventListener('pagehide', sauverZoom); // § E2.E : onglet fermé en pleine partie
  titleView.infosOpen = loadInfosOpen();
  //#region e5:L-textes-guide
  // § E5.L (A4) : 1er lancement (méta du stockage sans partie ni consigne vue) — la règle du jeu dépliée, le journal des
  // versions replié ; un choix déjà fait par le joueur (clé d'affichage enregistrée) l'emporte. Rien n'est écrit.
  if (meta.premierLancement()) {
    // (Femz, 22/11) la règle du jeu n'est plus dépliée sur l'accueil : son panneau n'y a plus de contenu visible
    ui.notesPremierLancement();
  }
  //#endregion e5:L-textes-guide
  loadAgent(); // § E2.D : dernier agent choisi (appliqué au prochain resetAll)
  demanderModeleAgent(); // § E5.K : modèles déjà posés et agent ≠ celui lu au démarrage (verrouillé) → lu maintenant
  camera.setShakeIntensity(game.settings.shake);
  audio.setMasterVolume(game.settings.volume);
  audio.setSfxVolume(game.settings.sfx); // réglages de Femz (21/11)
  audio.setMusiqueVolume(game.settings.musique);
  render.setGraphismes(REGLAGES.graphismes.find((g) => g.key === game.settings.graphismes).niveau);
  input.setModeSouris(game.settings.deplacement === 'souris'); // déplacement à la souris (Femz, 21/11)
  camera.setOrbite(game.settings.deplacement === 'souris'); // § E5.AB : caméra derrière l'agent
  camera.lierRotation(input.ROTATION); // § E5.AB.2
  CONFORT_FLASHS.reduits = game.settings.flashs === 'reduits'; // § E5.X5 : réglage sauvé
  SENSIBILITE_SOURIS.mul = game.settings.sensibilite; // § E5.AG : réglage sauvé
  enterTitle(); // T1
  tenterPublier(); // sinon à l'arrivée des modèles et du menu (modelesTraiter, menuTraiter)

  // Bande-son (21/11, demande de Femz) : hors du premier plan (fenêtre réduite, cachée ou sans le focus), la musique
  // s'éteint en fondu ; elle revient au retour.
  const premierPlan = () => audio.setPremierPlan(!document.hidden && document.hasFocus());
  window.addEventListener('blur', premierPlan);
  window.addEventListener('focus', premierPlan);
  document.addEventListener('visibilitychange', premierPlan);
  premierPlan();

  // Onglet masqué : pause automatique (sauf dans la boutique, déjà figée).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !LOOP.autoPauseOnHide) return;
    const s = game.state;
    if (s === STATE.PLAYING || s === STATE.WAVE_CLEAR || s === STATE.COUNTDOWN) pause();
  });
  // § E5.S (audit A18) : la fenêtre perd le focus (Alt-Tab, clic hors de l'app) → pause, comme l'onglet masqué. En solo
  // seulement (le multi n'aura jamais de pause globale) ; pas en ?debug (les tests pilotent plusieurs pages).
  window.addEventListener('blur', () => pauseSurFocus(false));

  ctx.renderer.setAnimationLoop(frame); // une seule boucle
}

boot();
