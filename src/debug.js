import * as dashAgents from './dash-agents.js'; // 16/11 (point 11)
import { lastThrow } from './weapons-agents.js';
import { debugFentes } from './anim/combos.js'; // § E3.Z.10 : fentes réelles coupées pour les tests de géométrie // correctif de l'étape 3 : origine des lancers
// FONDATION : debug.js — actif seulement si l'URL contient ?debug : touches F1 à F6, window.__game (hooks de
// test), snapshot() exact, affichage F5 (contrat : ARCHITECTURE.md § S). Hors debug : aucun écouteur, pas de
// window.__game, et les fonctions lues par les autres modules renvoient leur valeur neutre.
import {
  ACTION,
  AUDIO,
  CAPS,
  DEBUG,
  DMG,
  DMG_SRC,
  ENEMIES,
  HURT,
  PROGRESSION,
  STATE,
  WEAPON_COUNT,
} from './config.js';
import { ARGF, BANS, E, F_SX, F_SZ, F_V, P, mods, run } from './state.js';
import { END_LOOT } from './config.js'; // § E2.G bis
import * as vfx from './vfx/projectiles.js';
import { LOOK as VFX_LOOK } from './vfx/look.js'; // 17/11 : look « pixel + deep glow » des VFX
import * as meta from './meta.js'; // § E3.F : recettes découvertes (tests)
import * as armesHeros from './anim/armes-heros.js';
const skinsInfo = {}; // tests des skins : player.inspect
import { idleInspect as herosIdleInspect, os as herosOs } from './anim/heros-anim.js'; // § E4.E.3 : Warrior Idle en partie

let ctx = null;
let game = null;
let enabled = false;

// Bascules de test (resetAll ne les remet pas à zéro)
let invincible = false;
let frozen = false;
let crit = true;
let knockback = true;
let autoPick = false;
let sandbox = false;
let overlayOn = false;

const errors = [];

// Touches F1 et F6 reçues pendant un écran de choix de bonus : appliquées au retour en PLAYING (§ S)
let pendingFinish = false;
let pendingHorde = false;

// Mesures
const T_COUNT = 4; // 0 image entière, 1 simulate, 2 sync, 3 rendu
const tStart = new Float64Array(T_COUNT);
const tSum = new Float64Array(T_COUNT);
const tN = new Int32Array(T_COUNT);
// Scalaires réécrits à chaque image : dans un tableau typé (une variable de module qui reçoit un flottant coûte
// un nombre alloué à chaque écriture, § V — et les tests mesurent les allocations avec ?debug).
const M_CPU_MAX = 0;
const M_WIN_TIME = 1;
const M_WIN_FRAME_MAX = 2;
const M_OVERLAY_CLOCK = 3;
const M_LAST_NOW = 4;
const meas = new Float64Array(5);
let winFrames = 0;
let frames = 0;
let simFrames = 0;
const perf = { fps: 0, frameMsAvg: 0, frameMsMax: 0, cpuMsAvg: 0, cpuMsMax: 0, simMs: 0, syncMs: 0, renderMs: 0 };

let overlay = null;
let hooks = null; // window.__game, publié par publish() (modèles des unités posés, § Z quinquies)

// Générateur privé (placement des hordes de test) : ne décale pas le flux de la simulation.
const seedBox = new Int32Array(1).fill(0x2545f491);
function rnd() {
  const seed = (seedBox[0] + 0x6d2b79f5) | 0;
  seedBox[0] = seed;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function init(context) {
  ctx = context;
  game = ctx.game;
  enabled = new URLSearchParams(location.search).has(DEBUG.urlFlag);
  if (!enabled) return;

  window.addEventListener('error', (e) => errors.push(String(e.message || e.error || 'erreur')));
  window.addEventListener('unhandledrejection', (e) => errors.push('promesse rejetée : ' + String(e.reason)));

  overlay = document.createElement('pre');
  overlay.id = 'debug-overlay';
  overlay.style.cssText =
    'position:fixed;right:8px;bottom:8px;z-index:100;margin:0;padding:6px 8px;font:12px/1.35 ui-monospace,Menlo,monospace;' +
    'color:#e8fbff;background:rgba(10,12,16,0.78);pointer-events:none;display:none;white-space:pre';
  document.body.appendChild(overlay);

  const A = ctx.actions;
  // § E5.K : le modèle d'un agent pas encore chargé est lu à la demande. Les tests jouent les images dans une boucle
  // synchrone (jusqua) où la lecture ne peut pas aboutir : si une lecture est en cours après l'action, la valeur rendue
  // est une promesse résolue à l'arrivée des données (page.evaluate l'attend) ; l'image suivante les pose et lance la partie.
  const apresAgent = (r) => {
    const p = A.attenteAgent ? A.attenteAgent() : null;
    return p ? p.then(() => r) : r;
  };
  hooks = {
    version: 2,
    snapshot,
    // écran titre (null avant son arrivée) : l'accueil peint (src/menu/accueil.js, tâche 7) ; avec ?fbx= / ?modele= /
    // ?anim= (outil de cuisson, tests/cuire-anim.mjs), la scène 3D de src/menu/menu.js (heros.cuire, allerA…)
    menu: () => ctx.menu,
    // tâche 7 : l'accueil peint ({ afficher, cacher, image, etat() → { agent, skin, particules, visible } }) ; null en mode outil
    accueil: () => ctx.accueil || null,
    // Écran Agents : état de la vitrine (pause-agent.inspect().vitrine) ; idles.chargees = idles de vitrine cuits arrivés
    vitrine: () => ({ ...(ctx.pauseAgent ? ctx.pauseAgent.inspect({}).vitrine : {}), idles: { chargees: ctx.pauseAgent ? ctx.pauseAgent.idlesVitrineChargees() : 0 } }),
    // équivalents des touches
    finishWave,
    addFragments,
    addLevels,
    setInvincible(on) {
      invincible = !!on;
      return invincible;
    },
    toggleOverlay,
    spawnHorde,
    // pilotage : mêmes effets, mêmes gardes et même valeur de retour que ctx.actions
    start: (agentId) => apresAgent(A.start(agentId)), // § E2.D : avec un identifiant d'agent, l'écran de choix est sauté
    pause: (vue) => A.pause(vue), // menus « Pile » : 'fiche' = l'inventaire (Tab), sinon le menu (Échap)
    pauseSurFocus: () => A.pauseSurFocus(true), // § E5.S (A18) : perte de focus simulée
    setGraphismes: (k) => A.setGraphismes(k), // tâche 4 : 'auto' | 'elevee' | 'moyenne' | 'basse'
    setFlashs: (k) => A.setFlashs(k), // § E5.X5 : 'normaux' | 'reduits'
    provoquerErreur: (n) => A.provoquerErreur(n), // § E5.X2 : n images lèvent une erreur (filet de la boucle)
    resume: () => A.resume(),
    restart: () => A.restart(),
    // Écran Agents (tâche 5) : grille / fiche (mêmes gardes et mêmes valeurs de retour que ctx.actions)
    agentsOuvrir: (origine, a, skin) => A.agentsOuvrir(origine, a, skin),
    agentFiche: (a) => A.agentFiche(a),
    vitrineCrt: (n) => (ctx.pauseAgent && ctx.pauseAgent.setCrtVitrine ? ctx.pauseAgent.setCrtVitrine(n) : -1), // § E5.AQ : look pixel CRT de la vitrine
    agentJouer: (a) => apresAgent(A.agentJouer(a)),
    agentRetour: () => A.agentRetour(),
    agentSkin: (a, skin) => A.agentSkin(a, skin), // tâche 6 : vrai = choisi ; faux = seulement visé (verrouillé) ou refusé
    // § E2.D : relance / passe / bannissement
    rerollChoices: () => A.rerollChoices(),
    skipChoice: () => A.skipChoice(),
    banishChoice: (index) => A.banishChoice(index),
    armBanish: () => A.armBanish(),
    /** Compteurs de la partie (relances, passes, bannissements), pour les tests : n < 0 laisse la valeur. */
    setChoiceCounters(rerolls, skips, banishes) {
      if (rerolls >= 0) run.rerolls = Math.floor(rerolls);
      if (skips >= 0) run.skips = Math.floor(skips);
      if (banishes >= 0) run.banishes = Math.floor(banishes);
      return [run.rerolls, run.skips, run.banishes];
    },
    /** Force (ou rend, v < 0) le tirage du critique à toujours réussir, pour mesurer « Réflexe » : mods.critChanceAdd = v. */
    setCritChanceAdd(v) {
      mods.critChanceAdd = v;
      return mods.critChanceAdd;
    },
    quitToTitle: () => A.quitToTitle(),
    finishShopping: () => A.finishShopping(),
    chooseBonus: (index) => A.chooseBonus(index),
    buy: (offerId) => A.buy(offerId),
    setShake: (v) => A.setShake(v),
    setVolume: (v) => A.setVolume(v),
    // mise en situation
    sandbox(on) {
      sandbox = !!on;
      ctx.waves.debugHold(sandbox);
      return sandbox;
    },
    /** Étape 1 du plan addictif (§ E1.A) : fixe le chrono restant de la vague en cours (s). */
    /**
     * § E5.V (tests) : la PROCHAINE fin de vague prend le chemin du décryptage (WAVE_CLEAR → … → marchand → compte à
     * rebours) au lieu de basculer, une seule fois, sans changer le numéro de la vague (setNextWave le changerait).
     */
    forcePause(on = true) {
      game.pauseForcee = !!on;
      return true;
    },
    setWaveClock(seconds) {
      if (game.state !== STATE.PLAYING) return false;
      return ctx.waves.debugSetClock(seconds);
    },
    /**
     * La prochaine vague lancée sera la n (pour jouer les vagues 10 à 20 par script). § E5.V : aussi en pleine vague
     * (PLAYING) — la vague en cours compte alors comme la vague n − 1 (sa fin : bascule, ou décryptage si
     * isPauseWave(n − 1)), puisqu'il n'y a plus de marchand dans un palier.
     */
    setNextWave(n) {
      const s = game.state;
      if (!(n >= 1) || (s !== STATE.SHOP && s !== STATE.COUNTDOWN && s !== STATE.WAVE_CLEAR && s !== STATE.PLAYING)) return false;
      run.wave = Math.floor(n) - 1;
      return true;
    },
    /** Étape 1, chantier C (§ E1.C) : lance tout de suite l'événement de vague de clé donnée (EVENTS.types[k].key). */
    startEvent(key) {
      if (game.state !== STATE.PLAYING) return false;
      return ctx.events.debugStart(String(key));
    },
    /** Arrête l'événement en cours (lumière rendue, anneau dissous, capsule retirée), sans toucher aux robots. */
    clearEvent() {
      ctx.events.clear();
      return true;
    },
    /** Étape 1, chantier B (§ E1.B) : met les robots à la révision de la vague n (bac à sable ; startWave le refait). */
    setRevisions(n) {
      ctx.enemies.setRevisions(Math.max(0, Math.floor(n) || 0));
      return true;
    },
    /** Zones au sol des robots (src/hazards.js) : les max premières, en clair (kind = HAZ.*). */
    hazards: (max = 32) => ctx.hazards.list(max),
    /** Tirs ennemis en vol : positions et vitesses (salves des tireurs v2). */
    enemyShots: (max = 64) => ctx.enemies.listProjectiles(max),
    clearEnemies() {
      ctx.enemies.killAll(DMG.NO_LOOT | DMG.SILENT);
      ctx.enemies.clearProjectiles();
      ctx.hazards.clear();
      ctx.events.clear(); // événement de vague en cours (§ E1.C) : lumière rendue, anneau dissous, capsule retirée
      // Les morts sont compactés tout de suite (hors simulation, aucun indice n'est en cours d'usage) : sans
      // cela un spawnHorde(400) appelé juste après butait sur CAPS.enemies et ne créait que 121 robots.
      ctx.enemies.flushDead();
    },
    spawn(type, count, dist = 10, hpMul = 1) {
      let made = 0;
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2;
        if (spawnAt(type, P.x + Math.cos(a) * dist, P.z + Math.sin(a) * dist, hpMul) >= 0) made++;
      }
      return made;
    },
    spawnAt,
    /** Arrivée du boss de la vague donnée (défaut : la vague en cours) : son rang en découle (§ E1.D : 10 → rang 2, 15 → 3…). */
    spawnBoss(wave) {
      ctx.boss.spawn(Number.isFinite(wave) && wave >= 1 ? Math.floor(wave) : Math.max(1, run.wave));
    },
    enemies(max = 64) {
      const out = [];
      for (let i = 0; i < E.count && out.length < max; i++) {
        if (E.alive[i] === 0) continue;
        out.push({
          index: i,
          uid: E.uid[i],
          type: E.type[i],
          x: E.x[i],
          z: E.z[i],
          rot: E.rot[i],
          hp: E.hp[i],
          maxHp: E.maxHp[i],
          slow: E.slow[i],
          kx: E.kx[i],
          kz: E.kz[i],
          // ajoutés à l'intégration (demandés par les lots enemies, juice, waves-shop)
          vx: E.vx[i],
          vz: E.vz[i],
          flash: E.flash[i],
          glow: E.glow[i],
          state: E.state[i],
          timer: E.timer[i],
          dmg: E.dmg[i],
          mul: E.mul[i],
          radius: E.radius[i],
          rarity: E.rarity[i], // § E2.G bis : rareté d'une élite porteuse (0 pour les autres)
          // étape 1 du plan addictif (§ E1.A) : drapeaux EFLAG.* et temps passé hors champ (traînards)
          flags: E.flags[i],
          far: E.far[i],
          // chantier B (§ E1.B) : recharge, bulle-bouclier (PV et durée), cap ou compte d'une révision
          cd: E.cd[i],
          shield: E.shield[i],
          shieldT: E.rev1[i],
          rev0: E.rev0[i],
          // étape 3, chantier K (§ E3.K) : fusion au plafond, veille entre deux vagues
          merged: E.merged[i],
          sus: E.sus[i],
          fis: E.fis[i], // § E4.P : bouclier du blindé fissuré (1) ou intact (0)
        });
      }
      return out;
    },
    // ----- ajoutés à l'intégration (§ S) : ce que les lots devaient faire par import('/src/…') dans la page -----
    /** Porte un coup au robot de l'emplacement index par le vrai pipeline (damage.hitEnemy) ; source au joueur. */
    hurtEnemy(index, amount, flags = DMG.NONE, source = DMG_SRC.DEBUG) {
      if (!(index >= 0 && index < E.count) || E.alive[index] === 0) return 0;
      return ctx.damage.hitEnemy(index, amount, source, flags, P.x, P.z);
    },
    /**
     * § E4.P : coup par le vrai pipeline (damage.hitEnemy) depuis une source (sx, sz) quelconque ; rend le résultat de
     * hitEnemy (montant > 0, 0, −1) et, dans .r, le code de hitEnemyF (2 = atténué par un bouclier de face).
     */
    hurtFrom(index, amount, sx, sz, flags = DMG.NONE, source = DMG_SRC.DEBUG) {
      if (!(index >= 0 && index < E.count) || E.alive[index] === 0) return { amount: 0, r: 0 };
      ARGF[F_V] = amount;
      ARGF[F_SX] = sx;
      ARGF[F_SZ] = sz;
      const r = ctx.damage.hitEnemyF(index, source, flags);
      return { amount: r > 0 ? ctx.damage.LAST[0] : r, r };
    },
    /** § E4.P : oriente le robot index (cap E.rot, rad ; 0 = regarde vers +Z) et vide sa vitesse de rotation. */
    setEnemyRot(index, rot) {
      if (!(index >= 0 && index < E.count)) return false;
      E.rot[index] = rot;
      return true;
    },
    /** Explosion par le vrai pipeline (damage.explode), sans dégâts au joueur ni secousse. */
    explodeAt(x, z, radius, enemyDamage, flags = DMG.NONE, source = DMG_SRC.DEBUG, fxKind = 0) {
      return ctx.damage.explode(x, z, radius, enemyDamage, 0, source, flags, fxKind, 0, 0);
    },
    spawnGem: (x, z, xp) => ctx.pickups.spawnGem(x, z, xp),
    spawnFragment: (x, z, value) => ctx.pickups.spawnFragment(x, z, value),
    /** § E4.K : coupe (false) ou rallume (true) le regroupement en gros butin ; rend l'état. */
    setRegroupement: (on) => ctx.pickups.setRegroupement(on),
    /** Butin au sol : la part pickups du snapshot, avec les max premiers ramassables détaillés. */
    pickups(max = 64) {
      const o = {};
      ctx.pickups.inspect(o, max);
      return o;
    },
    /** XP gagnée comme à la collecte d'une gemme (mêmes niveaux, mêmes choix en attente). */
    addXp(n) {
      const s = game.state;
      if (s !== STATE.PLAYING && s !== STATE.WAVE_CLEAR && s !== STATE.COUNTDOWN) return false;
      ctx.progression.addXp(n);
      return true;
    },
    /** Fixe le solde de fragments (ajoute ou dépense la différence). */
    setFragments(n) {
      const s = game.state;
      if (s === STATE.TITLE || s === STATE.GAMEOVER || !(n >= 0)) return false;
      const d = Math.round(n) - run.fragments;
      if (d > 0) ctx.progression.addFragments(d);
      else if (d < 0) ctx.progression.spendFragments(-d);
      if (s === STATE.SHOP) ctx.ui.refreshScreen(ctx.shop.getView());
      return true;
    },
    /** Choisit, sur l'écran de bonus, la carte dont la clé est key (même garde que chooseBonus). */
    chooseBonusByKey(key) {
      if (game.state !== STATE.LEVELUP) return false;
      const r = {};
      ctx.progression.inspect(r);
      if (!r.roll) return false;
      for (let k = 0; k < r.roll.choices.length; k++) if (r.roll.choices[k].key === key) return ctx.actions.chooseBonus(k);
      return false;
    },
    /** La scène three (lecture : matrices d'instance, maillages). */
    scene: () => ctx.scene,
    /** Rendu peint (§ Z quater) : décor (source, maillages, triangles, textures), végétation, ombres de contact, taches et lumières, carte d'ombre. */
    /** Mesures : coupe ou rétablit le bloom et le diorama ({ bloom, diorama }, booléens ou null). */
    peintRegler: (o) => ctx.render.reglerPeint(o),
    /** Branche look-cel : applique une variante de PEINT.cel (numéro ou réglages) et redessine l'image courante. */
    cel: (v) => {
      const o = ctx.render.reglerCel(v);
      ctx.render.redessiner();
      return o;
    },
    /** Look des VFX (17/11, src/vfx/look.js) : variante (numéro, ou réglages { pixel, pas, tons, glow }) ; redessine. */
    vfxLook: (v) => {
      const o = typeof v === 'number' ? VFX_LOOK.variantes[v | 0] || null : v || null;
      const r = { look: vfx.reglerLook(o), glow: ctx.render.reglerGlow(o ? o.glow : null), fx: ctx.fx.reglerLook(o) };
      ctx.fx.sync(); // tailles des étincelles réécrites pour l'image redessinée
      ctx.render.redessiner();
      return r;
    },
    crt: (v) => {
      const o = ctx.render.reglerCrt(v);
      ctx.render.redessiner();
      return o;
    },
    peint: () => {
      const o = {};
      ctx.world.inspectPeint(o);
      return JSON.parse(JSON.stringify(o));
    },
    freezeEnemies(on) {
      frozen = !!on;
      return frozen;
    },
    setCrit(on) {
      crit = !!on;
      return crit;
    },
    setKnockback(on) {
      knockback = !!on;
      return knockback;
    },
    setAutoPick(on) {
      autoPick = !!on;
      return autoPick;
    },
    hurtPlayer(amount, kind = HURT.CONTACT, cause = 0) {
      return ctx.damage.hitPlayer(amount, kind, P.x, P.z, cause); // § E5.Q : cause facultative (CAUSE.*)
    },
    /** Bande-son (21/11, tests) : la piste courante repart comme à sa fin (fondu de boucle sur son autre lecteur). */
    musiqueBoucle: () => ctx.audio.debugBoucle(),
    killPlayer() {
      const s = game.state;
      if (s !== STATE.PLAYING && s !== STATE.WAVE_CLEAR && s !== STATE.COUNTDOWN) return false;
      ctx.damage.killPlayer();
      return true;
    },
    grantWeapon: (w) => ctx.weapons.unlock(w),
    /** § E4.D : touches réglées, état du stockage, aides affichées (tests/e4-touches.test.mjs). */
    touches: () => ctx.input.inspectTouches({}),
    touchesUI: () => ctx.ui.touchesInspect(),
    setPseudo: (v) => ctx.ui.setPseudo(v),
    pseudo: () => ctx.ui.pseudo(),
    /** Étape 2, chantier A (§ E2.A) : compteurs et relevés des trois armes (rebonds, balayages, tourelles, départs des tirs). */
    e2a: () => ctx.weapons.debugE2A({}),
    e3n: () => ctx.weapons.debugE3N({}), // § E3.N : armes des arsenaux, zone de la lame
    e3m: () => ctx.weapons.debugE3M({}), // § E3.M : combos (gestes, horodatage des impacts, arrêts, secousses)
    champ: () => ctx.weapons.debugChamp({}), // § E3.Z.12 : champ de force des tourelles (rayon, force, poussées, sons)
    dashAgents: () => dashAgents.inspect({}), // § E3.Z.11 : dash propre à chaque agent (ralentis, repoussés, leurre…)
    lancer: () => lastThrow({}), // correctif de l'étape 3 : origine du dernier lancer (grenade, fumigène)
    combos: () => ctx.weapons.debugE3M({}), // § E3.Z.10 : journal des gestes, fentes réelles
    setFentes: (on) => debugFentes(on),
    pauseAgent: () => (ctx.pauseAgent ? ctx.pauseAgent.inspect({}) : null), // § E3.Z.9 : portrait 3D (taille, rotation)
    /** § E4.E.3 : Warrior Idle du héros en partie (poids, temps) et quaternion d'un os du haut du corps. */
    herosIdle: (nom = 'bras_d') => {
      const o = herosIdleInspect({});
      const b = herosOs(nom);
      o.q = b ? [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w] : null;
      return o;
    },
    /** § E4.E.2 : colonne CARACTÉRISTIQUES de la pause (valeurs calculées, textes affichés). */
    carac: () => (ctx.ui.caracInspect ? ctx.ui.caracInspect() : null),
    /** § E4.E.6 : tirs créés par le héros de l'écran titre. */
    menuTirs: () => (ctx.menu && ctx.menu.heros && ctx.menu.heros.etat ? ctx.menu.heros.etat.tirs : null),
    /** § E3.H (fusion du groupe 2) : false = toutes les sources redeviennent continues (tests de mécanique d'arme). */
    setRecharges: (on) => (ctx.cooldowns ? ctx.cooldowns.debugEnable(!!on) : undefined),
    /** Étape 2, chantier B (§ E2.B) : compteurs et relevés des trois armes (nappes, boomerangs, mines, départs des tirs). */
    e2b: () => ctx.weapons.debugE2B({}),
    /** Bouche de l'arme w dans la pose dessinée (nœud bouche_<arme> du héros), en monde. */
    muzzle: (w) => armesHeros.boucheDessinee(w),
    // § E2.C : coffres. Mêmes effets et mêmes gardes que ctx.actions pour takeLot / rerollLots / skipLots / banishLot.
    takeLot: (k, force) => A.takeLot(k, !!force),
    rerollLots: () => A.rerollLots(),
    skipLots: () => A.skipLots(),
    banishLot: (k) => A.banishLot(k),
    skipChestAnimation: () => A.skipChestAnimation(),
    /** Un coffre de plus en attente ; rarities = [r0, r1, r2] impose la rareté de ses lots (−1 ou absent : tirée). */
    openChest(rarities) {
      ctx.chests.debugOpen(rarities);
      return run.chests;
    },
    /** Pose un coffre au sol en (x, z). */
    dropChest(x, z, minRarity = 0, flags = 0) {
      ctx.chests.dropAt(x, z, minRarity, flags);
      return true;
    },
    /** § E2.G bis G1 : réglage de la fin de vague — mode 'aucune' | 'rayon' | 'tout', rayon en m. Rend le réglage. */
    setEndLoot(mode, radius) {
      if (mode === 'aucune' || mode === 'rayon' || mode === 'tout' || mode === 'sol') END_LOOT.mode = mode; // 'sol' : § E5.V
      if (radius > 0) END_LOOT.radius = radius;
      return { mode: END_LOOT.mode, radius: END_LOOT.radius };
    },
    /** § E2.G bis G1 : ramassables créés entre keep(true) et keep(false) gardés en fin de vague (comme le butin du boss). */
    keepLoot(on) {
      if (on) ctx.pickups.beginKeep();
      else ctx.pickups.endKeep();
      return !!on;
    },
    /** Sort tout de suite une élite porteuse (vague active) ; renvoie son indice dans E. */
    spawnCarrier: () => ctx.waves.debugSpawnCarrier(),
    /** Fait du robot d'indice i une élite porteuse (planches, tests). */
    makeCarrier(i, rarity = 0) {
      if (!(i >= 0 && i < E.count) || E.alive[i] === 0) return false;
      ctx.enemies.makeCarrierF(i, rarity | 0);
      return true;
    },
    /** Module d'objets factice : les coffres proposent des lots de genre ITEM (le chantier F n'est pas fusionné). */
    chestItemStub(on) {
      ctx.chests.debugItemStub(!!on);
      return !!on;
    },
    // ----- § E3.A : élites à modificateurs, coffres de 1, 3 ou 5 lots -----
    /** Pose le modificateur m (ELITE_MOD.*) sur le robot i ; rend m, ou 0. */
    setEliteMod: (i, m) => (ctx.elites && i >= 0 && i < E.count ? ctx.elites.applyMod(i, m | 0) : 0),
    /** Relevé du module elites (liste des élites suivies, compteurs). */
    elites: () => (ctx.elites ? ctx.elites.inspect({}) : null),
    // ----- § E4.H : petites barres de vie -----
    /** Barres écrites à la dernière image (part, traîne, opacité, largeur, rectangle à l'écran en px CSS). */
    barres: () => (ctx.barres ? ctx.barres.inspect({}, true) : null),
    /** Coupe ou rallume les barres (mesure des appels de dessin). */
    setBarres: (on) => (ctx.barres ? ctx.barres.setOn(on) : false),
    /** Fusion RÉELLE des excédents au-delà de cap (enemies.mergeExcessF, silencieuse) ; rend le nombre de corps absorbés. */
    mergeExcess(cap) {
      const n = ctx.enemies.mergeExcessF(cap | 0, true);
      ctx.enemies.flushDead();
      return n;
    },
    /** Coffre de `size` lots (1, 3 ou 5) en attente ; rarities impose la rareté de ses lots. */
    openChestSized(rarities, size) {
      ctx.chests.debugOpen(rarities, size);
      return run.chests;
    },
    /** Taille d'un coffre pour une rareté (tirée sur le flux privé des coffres). */
    chestSizeFor: (rarity, isBoss, rank) => ctx.chests.sizeFor(rarity, isBoss, rank),
    /** n coffres de `size` lots tirés hors écran ; apply = tous les lots appliqués (takeAll), sinon retirés. Compact. */
    sampleBigChests(n, size, apply = false) {
      const out = [];
      for (let k = 0; k < n; k++) {
        ctx.chests.debugOpen(null, size);
        ctx.chests.roll();
        const o = {};
        ctx.chests.inspect(o);
        if (apply) ctx.chests.takeAll();
        else ctx.chests.debugDiscard();
        out.push({ size: o.size, big: o.big, min: o.minRarity, r: o.lots.map((l) => l.rarity), kind: o.lots.map((l) => l.kind), id: o.lots.map((l) => l.id) });
      }
      return out;
    },
    // ----- § E4.Q : Sauvegarde lâchée par un boss (disquette) -----
    /** État : disquettes au sol, rang des boss tués, tirages, lâchers, refus (verrou, bannie), ramassages, plafonds. */
    disquettes: () => ctx.disquette.inspect({}),
    /** Chance forcée p ∈ [0, 1] à chaque boss tué ; −1 : la loi 1 / max(30, 75 − 5k). */
    sauvegardeForcer: (p) => ctx.disquette.debugForcer(p),
    /** n tirages au rang k sur une copie du flux privé (graine : celle de la partie, ou `graine`) : { chance, gagnes, n }. */
    sauvegardeTirages: (k, n, graine = null) => ctx.disquette.debugTirages(k, n, graine),
    /** Pose une disquette en (x, z) (son et éclat de chute). */
    lacherDisquette: (x, z) => ctx.disquette.debugLacher(x, z),
    // ----- objets passifs (§ E2.F) -----
    /** Fixe les piles d'un objet (clé de ITEMS ou indice), sans limite d'emplacements. */
    setItem: (key, n) => ctx.items.debugSet(key, n),
    /** Ajoute n piles par le vrai chemin (items.add : refusé si la rangée est pleine et l'objet nouveau). */
    addItem: (id, n = 1) => ctx.items.add(id, n),
    /** État des objets : piles, valeurs, déclenchements, file, fusions possibles. */
    items: () => ctx.items.inspect({}),
    /** Fait la fusion k comme le fera l'étape 3 (rien ne l'appelle dans le jeu à l'étape 2). */
    fuseItems: (k) => ctx.items.debugFuse(k),
    canFuseItems: (k) => ctx.items.canFuse(k),
    /** § E3.F : fusions d'office après des piles posées par setItem (coupées par setItem, rendues ici). */
    setAutoFusion: (on) => ctx.items.setAutoFusion(on),
    /** § E3.F : ferme l'écran de fusion (sans attendre l'animation si force). */
    closeFusion: (force = true) => ctx.actions.closeFusion(force),
    /** § E3.F : oublie les recettes découvertes (méta-progression). */
    clearMeta: () => meta.debugClear(),
    isDiscovered: (kind, id) => meta.isDiscovered(kind, id),
    fusionHint: (id) => ({ mate: ctx.items.fusionMate(id), text: ctx.items.fusionHint(id) }),
    /** § E3.F : plus aucun objet ni objet né (items.reset, comme Rejouer). */
    resetItems: () => ctx.items.reset(),
    /** Cartes d'objet au choix de niveau : false = bonus seulement (tests écrits pour les dix bonus). */
    setItemCards: (on) => ctx.progression.debugItemCards(on),
    /** Bannit (1) ou rend (0) un objet, comme le ferait « Bannir ». */
    banItem(id, on = true) {
      BANS.items[id] = on ? 1 : 0;
      return BANS.items[id];
    },
    /** § E3.N : bannit (ou rend) l'arme w pour la partie (règle de l'arsenal épuisé). */
    banWeapon(w, on = true) {
      BANS.weapons[w] = on ? 1 : 0;
      return BANS.weapons[w];
    },
    /**
     * Tire n choix de niveau HORS écran (statistiques) : pour chacun, les cartes tirées ; take ≥ 0 prend la carte
     * `take` (la dernière si elle n'existe pas), −1 n'en prend aucune. Renvoie les cartes de chaque tirage.
     */
    sampleChoices(n, take = -1) {
      const out = [];
      const before = run.pendingChoices;
      for (let k = 0; k < n; k++) {
        run.pendingChoices = 1;
        const v = ctx.progression.rollChoices();
        out.push(v.choices.map((c) => ({ kind: c.kind, key: c.key, id: c.id, gain: c.kind === 'item' ? c.gain : 0, rarity: c.kind === 'item' ? c.rarity : -1 })));
        if (take >= 0) ctx.progression.applyChoice(Math.min(take, v.choices.length - 1));
      }
      run.pendingChoices = before;
      return out;
    },
    /** Coups portés au robot `index` par le vrai pipeline, n fois de suite, sans le tuer (PV rendus entre deux coups) : mesure des taux de déclenchement. */
    hammerEnemy(index, n, amount = 1) {
      if (!(index >= 0 && index < E.count) || E.alive[index] === 0) return 0;
      let done = 0;
      for (let k = 0; k < n; k++) {
        E.hp[index] = E.maxHp[index];
        if (ctx.damage.hitEnemy(index, amount, DMG_SRC.DEBUG, DMG.NONE, P.x, P.z) > 0) done++;
      }
      E.hp[index] = E.maxHp[index];
      return done;
    },
    /** Statuts d'un robot posés par les objets (virus, feu) et son ralentissement. */
    enemyStatus(index) {
      return { dot0: E.dot0[index], dotT0: E.dotT0[index], dot1: E.dot1[index], dotT1: E.dotT1[index], slow: E.slow[index], slowT: E.slowT[index], hp: E.hp[index], alive: E.alive[index] === 1 };
    },
    /** Fixe les PV du héros (bornés à ses PV max). */
    setPlayerHp(hp) {
      P.hp = Math.max(0, Math.min(P.maxHp, hp));
      return P.hp;
    },
    /** Bac à sable : numéro de vague lu par le tirage des coffres (poids de rareté, calendrier d'armes), sans lancer de vague. */
    setChestWave(n) {
      run.wave = Math.max(1, Math.floor(n));
      return run.wave;
    },
    /** Compteurs de relance, de passe et de bannissement de la partie. */
    setChestCharges(rerolls, skips, banishes) {
      run.rerolls = rerolls | 0;
      run.skips = skips | 0;
      run.banishes = banishes | 0;
      return true;
    },
    /** Tirage de n coffres HORS partie affichée (statistiques) : pour chacun, tire les lots et prend le lot `take` (−1 : au hasard privé). Renvoie les lots tirés et pris. */
    sampleChests(n, take = 0) {
      const out = [];
      for (let k = 0; k < n; k++) {
        ctx.chests.debugOpen(null);
        const before = ctx.weapons.inspectLevels();
        ctx.chests.roll();
        const o = {};
        ctx.chests.inspect(o);
        const pick = take >= 0 ? Math.min(take, o.lots.length - 1) : Math.floor(rnd() * o.lots.length);
        const r = ctx.chests.take(pick);
        out.push({ lots: o.lots, pick, result: r, before, after: ctx.weapons.inspectLevels(), slots: Array.from(ctx.weapons.slots) });
      }
      return out;
    },
    /**
     * § E2.G bis G2 — n porteuses à la vague courante (bac à sable, vague active) : chacune sort par le vrai chemin
     * (waves.spawnCarrier : type puis rareté sur le flux privé), son anneau est écrit par chests.sync (couleur relue dans
     * le tampon GPU), elle est tuée (damage.killEnemy : son coffre tombe), son coffre est ramené en attente
     * (chests.collectAll), tiré (roll) et le lot 0 pris. Renvoie [{ rarity, ring: [r, g, b], lots: [raretés], exact }].
     */
    sampleCarriers(n) {
      const out = [];
      for (let k = 0; k < n; k++) {
        const i = ctx.waves.debugSpawnCarrier();
        if (i < 0) break;
        const rarity = E.rarity[i];
        ctx.chests.sync();
        const o1 = {};
        ctx.chests.inspect(o1);
        ctx.damage.killEnemy(i, 0);
        ctx.enemies.flushDead();
        ctx.chests.collectAll();
        ctx.chests.roll();
        const o = {};
        ctx.chests.inspect(o);
        ctx.chests.take(0);
        out.push({ rarity, ring: o1.auraColors[o1.auraColors.length - 1] || null, rings: o1.auras, lots: o.lots.map((l) => l.rarity), exact: o.exact, minRarity: o.minRarity });
      }
      return out;
    },
    setWeaponOwned: (w, owned) => ctx.weapons.debugSetOwned(w, owned),
    setStatLevel: (w, s, level) => ctx.weapons.debugSetLevel(w, s, level),
    /** § E3.I : état de la pause (fenêtre d'un élément, panneaux repliés) et du portrait 3D. */
    pauseInfo: () => ({ ui: ctx.ui.inspectPause(), agent: ctx.pauseAgent ? ctx.pauseAgent.inspect() : null }),
    /** § E3.I : Échap en pause, comme main.handleKeys (vrai : une fenêtre ou un panneau a été refermé). */
    pauseBack: () => ctx.ui.pauseBack(),
    // § E4.A : méta-progression et succès (tests du chantier A)
    /** Copie de la méta (données, verrous de la partie, partie en cours), des compteurs de defis et de la notification. */
    metaInfo: () => ({ ...ctx.meta.inspect(), defis: ctx.defis.inspect(), toast: ctx.ui.inspectToast() }),
    /** Pose les compteurs qui rendent vraie la condition du succès s (la vérification et la notification suivent le vrai chemin). */
    metaForce: (s) => ctx.defis.debugForce(s),
    /** Préréglage de la méta : 'vierge' | 'depart' | 'tout' (en mémoire) | 'stockage' (relit le stockage). */
    metaPreset: (name) => ctx.meta.debugPreset(name),
    metaBuy: (key) => ctx.meta.buy(key),
    /** Skins (tâche 3) : skin porté et état de déblocage (lecture seule), et choix d'un skin. */
    skinsMeta: (a, s) => ({ choisi: meta.skinChoisi(a), debloque: meta.skinDebloque(a, s) }),
    skinChoisir: (a, s) => meta.choisirSkin(a, s),
    /** Skin effectif (méta) d'un agent ; modèle posé sur le héros (skin, présence d'un os) ; modèles rangés ('agent:skin'). */
    skinEffectif: (a) => meta.skinEffectif(a),
    skinHeros: (os) => ({ skin: ctx.player.skinCourant(), os: os ? !!herosOs(os) : null, charges: (ctx.player.inspect(skinsInfo), skinsInfo.modelesSkins.slice()) }),
    metaCycles: (n) => ctx.meta.debugSetCycles(n),
    metaForSale: () => ctx.meta.forSale([]),
    metaProgress: (s) => ctx.defis.progress(s, {}),
    // § E4.B : le hub (mêmes gardes et mêmes valeurs de retour que ctx.actions et les touches de main.js)
    openHub: (tab) => A.openHub(tab),
    quitHub: () => A.quitHub(),
    hubTab: (t) => ctx.ui.hubTab(t),
    //#region e5:AB-camera-3p
    curseurInfo: () => ctx.ui.curseurInspect(), // § E5.AB.7 : curseur du jeu sous verrou, plaque
    clicInfo: () => ctx.ui.clicInspect(), // § E5.AB.14 : repères du clic au sol (mode Vue fixe)
    verrouInfo: () => ctx.verrou.inspect(), // § E5.AB.5 : état du verrou du pointeur et compteurs
    verrouSimuler: (on = true, refus = false) => ctx.verrou.simuler(on, refus), // tests : verrou simulé (navigateur sans fenêtre)
    verrouPerte: () => ctx.verrou.simulerPerte(), // tests : perte involontaire (Échap du navigateur, focus perdu)
    lacet: (deg, immediat = true) => ctx.camera.setLacet(deg, immediat), // tests : lacet de la caméra (mode Souris)
    deplacement: (cle) => A.setDeplacement(cle), // § E5.AB : réglage « Déplacement » (même chemin que la fenêtre Paramètres)
    //#endregion e5:AB-camera-3p
    sensibilite: (v) => A.setSensibilite(v), // § E5.AG : réglage « Sensibilité de la souris » (même chemin que la fenêtre)
    oublierCurseur: () => ctx.input.oublierCurseur(), // § E5.U : comme au chargement (curseur jamais bougé)
    hubMove: (dx, dy) => ctx.ui.hubMove(dx, dy),
    hubConfirm: () => ctx.ui.hubConfirm(),
    hubBuy: (key) => A.hubBuy(key),
    hubPlay: (a) => apresAgent(A.hubPlay(a)), // § E4.L.1 : a = l'agent de la fiche (sans a : l'agent de départ, comme avant)
    /** Onglet, zone, case visée, cases de la Collection (vues, verrous, recettes révélées), parallaxe. */
    hubInfo: () => ctx.ui.hubInspect(),
    shopFocus: () => ctx.ui.shopInspect(), // § E4.S.8 : focus clavier du marchand v2 { carte, ligne, offre, fini }
    notesInfo: () => ctx.ui.notesInspect(), // § E4.I.6 : notes de version de l'écran titre
    consignes: (on = true) => ctx.ui.consignesForcer(on), // § E5.L : bulles de consigne actives en ?debug (false : coupées)
    consignesInfo: () => ctx.ui.consignesInfo(), // § E5.L : bulle affichée, texte, montrées, vues dans la méta
    // § E5.AE : tuto des bornes de PV (consigne à part : demandée en plus de consignes(true))
    tutoBornes: (on = true) => ctx.consignes.forcerBornes(on),
    tutoBornesInfo: () => ctx.consignes.inspectBornes({}),
    tutoBornesEcran: () => ctx.consignes.ecranBornes(),
    //#region e5:AK-mort-claire
    // § E5.AK : ralenti, recadrage et flèche du coup mortel (coupés en ?debug sauf demande) ; multi simulé (solo false)
    mortClaire: (on = true) => ctx.mortClaire.forcer(on),
    mortClaireSolo: (on = true) => ctx.mortClaire.solo(on),
    mortClaireInfo: () => ctx.mortClaire.inspect({}),
    mortClaireEcran: () => ctx.mortClaire.ecran({}),
    //#endregion e5:AK-mort-claire
    consigneVue: (key) => ctx.meta.consigneVue(key), // § E5.L
    notesToggle: () => ctx.ui.notesToggle(),
    bilanInfo: () => ctx.ui.bilanInspect(), // § E4.C : bilan de l'écran de fin (textes affichés, montée des Cycles)
    /** § E3.I : une pile du bonus `key` par le vrai chemin (tirage + applyChoice), hors écran ; vrai si posée. */
    addBonusStack(key) {
      const before = run.pendingChoices;
      let ok = false;
      for (let t = 0; t < 400 && !ok; t++) {
        run.pendingChoices = 1;
        const v = ctx.progression.rollChoices();
        const k = v.choices.findIndex((c) => c.kind !== 'item' && c.key === key);
        if (k >= 0) ok = ctx.progression.applyChoice(k);
      }
      run.pendingChoices = before;
      return ok;
    },
    /** Copie de la vue de la boutique (prix, soldes, surcharge : § E1.D), telle que l'interface la reçoit. */
    shopView: () => JSON.parse(JSON.stringify(ctx.shop.getView())),
    /** Crans de surcharge d'une arme possédée (§ E1.D), sans passer par la boutique. */
    setOvercharge: (w, n) => ctx.weapons.debugSetOvercharge(w, n),
    /** Identité des agents (planches, 22/11) : position du joueur (m) et, à l'écran (px CSS), du point à y m au-dessus de lui. */
    ecranJoueur(y = 0.9) {
      const o = {};
      ctx.camera.worldToScreen(P.x, y, P.z, o);
      return { x: P.x, z: P.z, sx: o.x, sy: o.y };
    },
    teleport(x, z) {
      ctx.player.teleport(x, z);
      ctx.camera.snapTo(P.x, P.z);
    },
    addTrauma: (amount, source) => ctx.camera.addTrauma(amount, source),
    /** § E2.E : zoom de la molette (borné à [ZOOM.min, ZOOM.max], recalé sur un cran) ; immediat = sans animation. */
    setZoom: (z, immediat = false) => ctx.camera.setZoom(z, immediat),
    press: (code, key = '') => ctx.input.inject(code, true, key),
    release: (code) => ctx.input.inject(code, false, ''),
    errors,
  };
}

/**
 * Publie window.__game (§ S) : main.js l'appelle une fois les modèles des unités posés (ou leur chargement en échec),
 * § Z quinquies — un test qui attend window.__game et l'état TITLE trouve donc toujours les modèles en place. Sans
 * ?debug : rien.
 */
export function publish() {
  if (enabled && hooks !== null) window.__game = hooks;
}

// ----- Équivalents des touches (mêmes gardes que les touches) --------------------------------------------------------

function finishWave() {
  if (game.state !== STATE.PLAYING) return false;
  ctx.waves.debugFinish();
  return true;
}

/**
 * Touche F1 ou F6 : pendant un écran de choix de bonus pris en plein combat, la demande est gardée et appliquée
 * au retour en PLAYING au lieu d'être perdue (« F6 puis F5 » ne dépend plus de l'image où tombe la touche).
 */
function keyFinishWave() {
  if (game.state === STATE.LEVELUP && game.returnState === STATE.PLAYING) pendingFinish = true;
  else finishWave();
}

function keySpawnHorde() {
  if (game.state === STATE.LEVELUP && game.returnState === STATE.PLAYING) pendingHorde = true;
  else spawnHorde();
}

function addFragments(n = DEBUG.fragmentsBonus) {
  const s = game.state;
  if (s === STATE.TITLE || s === STATE.GAMEOVER) return false;
  ctx.progression.addFragments(n);
  if (s === STATE.SHOP) ctx.ui.refreshScreen(ctx.shop.getView());
  return true;
}

function addLevels(n = DEBUG.levelBonus) {
  const s = game.state;
  if (s !== STATE.PLAYING && s !== STATE.WAVE_CLEAR && s !== STATE.SHOP && s !== STATE.COUNTDOWN) return false;
  ctx.progression.debugAddLevels(n);
  return true;
}

function toggleOverlay() {
  overlayOn = !overlayOn;
  overlay.style.display = overlayOn ? 'block' : 'none';
  meas[M_OVERLAY_CLOCK] = DEBUG.overlayRefresh; // rafraîchi dès la prochaine image
  return overlayOn;
}

function spawnAt(type, x, z, hpMul = 1) {
  if (!(type >= 0 && type < ENEMIES.types.length)) return -1;
  return ctx.enemies.spawn(type, x, z, hpMul, 1);
}

/** F6 : n robots À L'ÉCRAN, répartis dans le rectangle visible, à plus de hordeMinDist du joueur. */
function spawnHorde(n = DEBUG.hordeCount, type = DEBUG.hordeType, hpMul = 1) {
  if (game.state !== STATE.PLAYING) return 0;
  const view = ctx.camera.view;
  const world = ctx.world;
  const r = ENEMIES.types[type].radius;
  const a1 = view.halfW * DEBUG.hordeViewFraction;
  const b1 = view.halfD * DEBUG.hordeViewFraction;
  const min2 = DEBUG.hordeMinDist * DEBUG.hordeMinDist;
  let made = 0;
  for (let k = 0; k < n; k++) {
    let x = 0;
    let z = 0;
    let ok = false;
    for (let attempt = 0; attempt < 40 && !ok; attempt++) {
      const a = (rnd() * 2 - 1) * a1;
      const b = (rnd() * 2 - 1) * b1;
      x = view.targetX + a * view.rightX + b * view.upX;
      z = view.targetZ + a * view.rightZ + b * view.upZ;
      const dx = x - P.x;
      const dz = z - P.z;
      ok = dx * dx + dz * dz >= min2 && world.isInsideArena(x, z, r) && !world.overlaps(x, z, r);
    }
    if (!ok) continue;
    if (ctx.enemies.spawn(type, x, z, hpMul, 1) < 0) break; // limite de CAPS.enemies
    made++;
  }
  return made;
}

// ----- Boucle --------------------------------------------------------------------------------------------------------

/** F3 : touches F1 à F6 ; choix automatique des bonus si setAutoPick(true). */
export function preUpdate() {
  if (!enabled) return;
  const input = ctx.input;
  if (input.pressed(ACTION.DEBUG_1)) keyFinishWave();
  if (input.pressed(ACTION.DEBUG_2)) addFragments();
  if (input.pressed(ACTION.DEBUG_3)) addLevels();
  if (input.pressed(ACTION.DEBUG_4)) invincible = !invincible;
  if (input.pressed(ACTION.DEBUG_5)) toggleOverlay();
  if (input.pressed(ACTION.DEBUG_6)) keySpawnHorde();
  if (autoPick && game.state === STATE.LEVELUP && game.stateTime >= PROGRESSION.choiceGuardSeconds) ctx.actions.chooseBonus(0);
  if (autoPick && game.state === STATE.FUSION) ctx.actions.closeFusion(true); // § E3.F : le choix automatique ferme aussi l'écran de fusion
  if (autoPick && game.state === STATE.CHEST) { const g = ctx.chests.getView().guarantee; ctx.actions.takeLot(g >= 0 ? g : 0, true); } // § E2.C : le choix automatique prend aussi un lot d'un coffre, sans attendre la roulette ; § E2.S S1 : le lot d'arme garantie s'il y en a un (il était toujours le premier), sinon le premier
  if (pendingFinish || pendingHorde) {
    if (game.state === STATE.PLAYING) {
      if (pendingHorde) spawnHorde();
      if (pendingFinish) finishWave();
      pendingFinish = false;
      pendingHorde = false;
    } else if (game.state !== STATE.LEVELUP) {
      // la partie a quitté le combat entre-temps (pause, mort, menu) : la demande est abandonnée
      pendingFinish = false;
      pendingHorde = false;
    }
  }
}

/** Chronomètres : k = 0 image entière, 1 simulate, 2 sync, 3 rendu. Sans effet hors debug. */
export function begin(k) {
  if (enabled) tStart[k] = performance.now();
}

export function end(k) {
  if (!enabled) return;
  const d = performance.now() - tStart[k];
  tSum[k] += d;
  tN[k]++;
  if (k === 0 && d > meas[M_CPU_MAX]) meas[M_CPU_MAX] = d;
}

/** F15 : cadence et compteurs ; rafraîchit l'affichage toutes les DEBUG.overlayRefresh s. */
export function postRender(realDt) {
  if (!enabled) return;
  frames++;
  winFrames++;
  // Intervalle RÉEL entre deux images (realDt est borné à LOOP.maxDt : il masquerait une cadence sous 30 i/s).
  const now = performance.now();
  const ms = meas[M_LAST_NOW] > 0 ? now - meas[M_LAST_NOW] : realDt * 1000;
  meas[M_LAST_NOW] = now;
  meas[M_WIN_TIME] += ms / 1000;
  if (ms > meas[M_WIN_FRAME_MAX]) meas[M_WIN_FRAME_MAX] = ms;
  if (meas[M_WIN_TIME] >= DEBUG.fpsWindow) {
    const winTime = meas[M_WIN_TIME];
    perf.fps = winFrames / winTime;
    perf.frameMsAvg = (winTime * 1000) / winFrames;
    perf.frameMsMax = meas[M_WIN_FRAME_MAX];
    perf.cpuMsAvg = tN[0] > 0 ? tSum[0] / tN[0] : 0;
    perf.cpuMsMax = meas[M_CPU_MAX];
    perf.simMs = tN[1] > 0 ? tSum[1] / tN[1] : 0;
    perf.syncMs = tN[2] > 0 ? tSum[2] / tN[2] : 0;
    perf.renderMs = tN[3] > 0 ? tSum[3] / tN[3] : 0;
    simFrames += tN[1];
    meas[M_WIN_TIME] = 0;
    winFrames = 0;
    meas[M_WIN_FRAME_MAX] = 0;
    meas[M_CPU_MAX] = 0;
    tSum.fill(0);
    tN.fill(0);
  }
  if (overlayOn) {
    meas[M_OVERLAY_CLOCK] += realDt;
    if (meas[M_OVERLAY_CLOCK] >= DEBUG.overlayRefresh) {
      meas[M_OVERLAY_CLOCK] = 0;
      drawOverlay();
    }
  }
}

function drawOverlay() {
  const r = {};
  ctx.render.inspect(r);
  const g = {};
  ctx.grid.inspect(g);
  overlay.textContent =
    perf.fps.toFixed(0) + ' i/s   image ' + perf.frameMsAvg.toFixed(1) + ' ms (max ' + perf.frameMsMax.toFixed(1) + ')\n' +
    'calcul ' + perf.cpuMsAvg.toFixed(2) + ' ms   simulation ' + perf.simMs.toFixed(2) + '   sync ' + perf.syncMs.toFixed(2) + '   rendu ' + perf.renderMs.toFixed(2) + '\n' +
    'robots ' + E.aliveCount + ' / ' + E.count + '   tirs ' + ctx.weapons.getProjectileCount() + ' + ' + ctx.enemies.getProjectileCount() +
    '   butin ' + ctx.pickups.getActiveCount() + '   cellules ' + g.cells + '\n' +
    'appels ' + r.calls + '   triangles ' + r.triangles + '   qualité ' + r.qualityLevel + '   ×' + r.pixelRatio.toFixed(2) + '   ' + r.pixels + ' px\n' +
    game.state + (invincible ? '   INVINCIBLE' : '') + (frozen ? '   FIGÉS' : '') + (sandbox ? '   BAC À SABLE' : '');
}

// ----- Bascules lues par les autres modules --------------------------------------------------------------------------

export function isEnabled() {
  return enabled;
}

export function isInvincible() {
  return invincible;
}

export function areEnemiesFrozen() {
  return frozen;
}

export function isCritEnabled() {
  return crit;
}

export function isKnockbackEnabled() {
  return knockback;
}

/** Remplit perf. */
export function inspect(out) {
  out.fps = perf.fps;
  out.frameMsAvg = perf.frameMsAvg;
  out.frameMsMax = perf.frameMsMax;
  out.cpuMsAvg = perf.cpuMsAvg;
  out.cpuMsMax = perf.cpuMsMax;
  out.simMs = perf.simMs;
  out.syncMs = perf.syncMs;
  out.renderMs = perf.renderMs;
  out.frames = frames;
  out.simFrames = simFrames + tN[1];
}

// ----- snapshot() : forme exacte du § S ; un objet neuf par clé, rempli par l'inspect du module responsable ---------

function snapshot() {
  const s = {};
  s.frame = game.frame;
  s.state = game.state;
  s.returnState = game.returnState;
  s.phase = game.phase;
  s.countdown = game.countdown;
  s.stateTime = game.stateTime;
  s.time = run.time;
  s.seed = run.seed;
  s.modeles = game.modeles; // 'chargement' | 'pret' | 'erreur' (§ Z quinquies)
  s.memoire = ctx.memoireInfo ? ctx.memoireInfo() : null; // § E5.K : agents lus / libérés, attente, contexte perdu
  s.incident = ctx.incidentInfo ? ctx.incidentInfo() : null; // § E5.X2 : erreurs attrapées, cartouche, avis, sauvegarde
  // Écran titre 3D (§ Z octies) : statut, durée du chargement, erreur, et l'état de la scène quand elle est là
  s.menu = { statut: game.menu, ms: ctx.menuInfo ? ctx.menuInfo.ms : 0, erreur: ctx.menuInfo ? ctx.menuInfo.erreur : '', scene: ctx.menu ? ctx.menu.etat() : null };
  ctx.input.inspect((s.input = {}));
  ctx.waves.inspect((s.wave = {}));
  ctx.enemies.inspect((s.enemies = {}));
  ctx.boss.inspect((s.boss = {}));
  ctx.hazards.inspect((s.hazards = {})); // zones au sol des ROBOTS (§ E1.B) ; celles du boss : s.boss.hazards
  ctx.events.inspect((s.events = {})); // événement de vague en cours et calendrier (§ E1.C)
  ctx.world.inspect((s.world = {})); // dont light : niveau de la lumière d'ambiance (panne de courant)
  ctx.player.inspect((s.player = {}));
  ctx.progression.inspect((s.progression = {}));
  if (ctx.agents) ctx.agents.inspect((s.agent = {})); // § E2.D : agent courant, signature, passif
  s.mods = {
    maxHpAdd: mods.maxHpAdd,
    moveSpeedMul: mods.moveSpeedMul,
    pickupRadiusMul: mods.pickupRadiusMul,
    xpGainMul: mods.xpGainMul, // § E5.Z
    critChanceAdd: mods.critChanceAdd,
    regenPerSec: mods.regenPerSec,
    dashCdMul: mods.dashCdMul,
    areaMul: mods.areaMul,
    damageMul: mods.damageMul,
    fireRateMul: mods.fireRateMul,
    damageTakenMul: mods.damageTakenMul,
    critDashCut: mods.critDashCut, // § E2.D
    critNear: mods.critNear,
    resistToDamage: mods.resistToDamage,
    critMulAdd: mods.critMulAdd, // § E2.F
    berserk: mods.berserk,
    fragmentMul: mods.fragmentMul,
    luck: mods.luck,
  };
  const w = [];
  for (let k = 0; k < WEAPON_COUNT; k++) w.push({});
  ctx.weapons.inspect(w);
  s.weapons = w;
  ctx.pickups.inspect((s.pickups = {}));
  ctx.shop.inspect((s.shop = {}));
  if (ctx.terminal) ctx.terminal.inspect((s.terminal = {})); // § E5.V
  ctx.chests.inspect((s.chests = {})); // § E2.C : coffres au sol, en attente, lots du coffre ouvert
  if (ctx.items) ctx.items.inspect((s.items = {})); // § E2.F : objets passifs
  if (ctx.elites) ctx.elites.inspect((s.elites = {})); // § E3.A : élites à modificateurs
  if (ctx.barres) ctx.barres.inspect((s.barres = {})); // § E4.H : petites barres de vie (compteurs)
  s.slots = Array.from(ctx.weapons.slots); // § E2.C : armes dans l'ordre d'obtention (−1 = emplacement vide)
  ctx.camera.inspect((s.camera = {}));
  ctx.render.inspect((s.renderer = {}));
  vfx.inspect((s.vfx = {})); // lots des projectiles « toon » (§ Z septies)
  const fx = {};
  ctx.fx.inspect(fx);
  const fxPools = fx.pools || {};
  delete fx.pools;
  const audio = {};
  ctx.audio.inspect(audio);
  const none = { used: 0, cap: 0 };
  s.pools = {
    enemies: { used: E.count, cap: CAPS.enemies },
    enemyProjectiles: { used: ctx.enemies.getProjectileCount(), cap: CAPS.enemyProjectiles },
    playerProjectiles: { used: ctx.weapons.getProjectileCount(), cap: CAPS.playerProjectiles },
    orbitals: { used: w[1].active, cap: CAPS.orbitals },
    beams: { used: w[3].active + w[4].active, cap: CAPS.beams },
    pickups: { used: ctx.pickups.getActiveCount(), cap: CAPS.pickups },
    debris: fxPools.debris || none,
    numbers: fxPools.numbers || none,
    sparks: fxPools.sparks || none,
    rings: fxPools.rings || none,
    telegraphs: { used: s.boss.hazards, cap: CAPS.telegraphs },
    hazards: { used: s.hazards.count, cap: CAPS.hazards },
    bubbles: { used: s.enemies.bubblesShown, cap: CAPS.bubbles },
    audioVoices: { used: audio.voices, cap: AUDIO.maxVoices },
  };
  s.fx = fx;
  ctx.damage.inspect((s.damage = {}));
  if (ctx.cooldowns) s.cooldowns = ctx.cooldowns.inspect({}); // § E3.H : sources à recharge
  s.audio = audio;
  ctx.ui.inspect((s.ui = {}));
  inspect((s.perf = {}));
  s.debug = { invincible, frozen, crit, knockback, autoPick, sandbox, overlay: overlayOn };
  s.settings = { shake: game.settings.shake, volume: game.settings.volume, zoom: game.settings.zoom, sfx: game.settings.sfx, musique: game.settings.musique, graphismes: game.settings.graphismes, deplacement: game.settings.deplacement, sensibilite: game.settings.sensibilite }; // § E5.AG : sensibilite ; zoom : § E2.E ; sfx, musique, graphismes : réglages de Femz (21/11)
  const b = game.best;
  s.best = b ? { wave: b.wave, kills: b.kills, level: b.level, time: b.time } : null;
  s.recordBeaten = !!game.recordBeaten; // § E1.D : record battu pendant cette partie
  s.errors = errors.length;
  return s;
}
