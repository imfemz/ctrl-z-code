// FONDATION : player.js — le joueur : déplacement (axes d'écran → monde), dash invulnérable, régénération,
// maillage (modèle Blender du héros, § Z quinquies), ombre (contrat : ARCHITECTURE.md § B.2).
// Animation (étape « animations », § Z sexies) : le héros est le modèle Blender en pièces, animé par src/anim/ —
// heros-anim (squelette, buste et jambes séparés, pieds posés, dash, images rémanentes, silhouette, cape), reperes (R1
// recharge du dash, R2 santé basse, posés au sol), armes-heros (armes sur les avant-bras, visée, bouches, tourelles).
// La simulation (P) ne change pas : seul le dessin se sépare (P.rot reste le cap du jeu).
import { ACTION, PALETTE, PLAYER, SFX, WORLD } from './config.js';
import { P, PAREFEU_F, mods } from './state.js';
import { AGENT, AGENTS, SKIN_BASE } from './config.js'; // § E2.D : teinte d'accent et passif « Réflexe » de l'agent
import { REGLAGES } from './config.js'; // § E5.AB.14 : clic pour avancer façon LoL (REGLAGES.souris)
import { run } from './state.js';
import * as heros from './anim/heros-anim.js';
import * as reperes from './anim/reperes.js';
import * as armes from './anim/armes-heros.js';
import { ajouterRevele, appliquerTexturesArmes, appliquerTexturesModele, preparerTexturesModele } from './rendu/materiaux.js'; // armes bakées (16/11), modèles cuits (17/11), matérialisation (carte-blender)

import * as dashAgents from './dash-agents.js'; // 16/11 (point 11) : dash propre à chaque agent
import * as pasAgents from './anim/pas-agents.js'; // § E5.G : son des pas, au contact du pied
import { COUP_DE_PIED } from './config.js'; // § E4.O.2 : le joueur s'engage dans le coup de pied
//#region e5:N-combat-guide
import { COMBAT_GUIDE } from './config.js'; // § E5.N (B5) : rayon de dégâts du héros, relu à chaque partie
import { SOIN_HEROS as SOIN, SOIN_SIGNAUX } from './state.js'; // § E5.Q (B14) : tout soin du héros nourrit son retour propre (src/soin-heros.js)
const S_CUMUL = 0; // SOIN_HEROS[0] : PV rendus pas encore signalés
//#endregion

import * as CPV2 from './anim/coup-pied.js';
//#region e5:U-visee-souris
import * as visee from './visee.js';
import * as ombreFrappe from './ombre-frappe.js'; // § E5.AM : ombre de l'agent qui frappe la Frappe éclair // § E5.U : visée à la souris (direction, regard du buste, trait de la Frappe éclair)
//#endregion e5:U-visee-souris
// § E5.X6 (D2, D3) : dash refusé (clic sourd + ping de R1), tampon de l'appui. Horloge et dernier clic en tableau typé.
import { ACTIONS_IMPOSSIBLES } from './config.js';
import { REFUS_X6 } from './state.js';
const X6_TAMPON = ACTIONS_IMPOSSIBLES.dash.tampon;
const X6_GAIN = ACTIONS_IMPOSSIBLES.dash.refusGain;
const X6_ECART = ACTIONS_IMPOSSIBLES.dash.refusEcart;
const X6 = new Float64Array(2); // [0] horloge simulée (s), [1] horloge du dernier clic de refus
let dashFini = 0; // le trajet du dash s'est achevé pendant ce pas
let ctx = null;
let input = null;
let world = null;
let audio = null;
let fx = null;
let debug = null;
let view = null;
let UMUL = null; // § E3.C : utilities.MUL ([0] = vitesse de l'Overclocking), null sans le chantier C

let materiau = null; // matériau peint du héros (profil herosAnime), partagé par le corps, la silhouette et les armes
let modele = null; // données du modèle Blender une fois posé (setModele) ; null : rien n'est dessiné
// Fusion agents-modeles (15/11) : un modèle par agent (MODELES.agents : heros.glb, agent-bastion.glb, agent-shinobi.glb),
// posé par poserAgent() quand run.agent change — hors combat seulement (setModele, reset)
// § E5.K (18/11) : SEUL le modèle de l'agent choisi est en mémoire — les autres entrées valent null tant qu'ils ne sont
// pas choisis (main.js les charge à la demande : ajouterModeleAgent, poserAgentCourant libère les autres)
let modeles = null; // modèles chargés : par agent (ordre de AGENTS), { [skin]: données } (null : pas chargé)
let skinPose = SKIN_BASE; // skin du modèle posé (agentPose)
let skinVoulu = SKIN_BASE; // skin que main.js veut sur l'agent de la partie (meta.skinEffectif, repli compris)
const skinsEchec = new Set(); // 'agent:skin' dont le fichier ne charge pas : le modèle de base les remplace
let agentPose = -1; // agent dont le modèle est posé (−1 : aucun)
const lastDashMul = new Float64Array(1); // mods.dashCdMul au dernier onModsChanged
// § E5.AB.14 — mode « Vue fixe » (clic droit façon LoL, code de 0.5.7) : [0] cible active (0 / 1), [1] x, [2] z, [3] distance
// à l'image d'avant, [4] s sans approcher (bloqué contre un décor : l'ordre tombe), [5] s avant le prochain repère maintenu
const CIBLE = new Float64Array(6);
const CUR = { x: 0, y: 0 }; // curseur (pixels CSS) — objets réutilisés, jamais recréés
const SOL = { x: 0, z: 0 }; // point du sol sous le curseur
const BLOQUE_S = 0.4;
const out2 = new Float32Array(2);
// § E2.D — « Réflexe » : seau à jetons (s) de la recharge du dash retirable par les critiques ; il se remplit de
// critDashCutPerSecond par seconde, plafonné à un critique (mods.critDashCut). [0] seau, [1] total retiré (tests).
const dashCut = new Float64Array(2);
// § E2.D — teinte de l'agent : couleurs de sommet d'origine du héros (copie), accent posé (−1 : celui du fichier)
let couleurs0 = null;
let accentPose = -1;
let accentAnneau = PALETTE.playerAccent;

export function init(context) {
  ctx = context;
  UMUL = ctx.utilities ? ctx.utilities.MUL : null; // § E3.C
  input = ctx.input;
  world = ctx.world;
  audio = ctx.audio;
  fx = ctx.fx;
  debug = ctx.debug;
  view = ctx.camera.view;
  dashAgents.init(ctx);
  pasAgents.init(audio); // § E5.G
  // Maillage : le modèle Blender du héros (assets/modeles/heros.glb, § Z quinquies), animé (§ Z sexies) ; créé par
  // setModele() à son arrivée (main.js) — d'ici là rien n'est dessiné. Avant du modèle = +Z local, pieds à y = 0 ;
  // taille du jeu (PLAYER.height × PLAYER.visualScale, le rayon de collision P.radius ne change pas) appliquée au
  // chargement. Profil peint « herosAnime » : celui du héros, liseré cyan atténué (config.js, région anim:reglages).
  materiau = ajouterRevele(ctx.render.createLitMaterial({ glowColor: PALETTE.playerAccent, profil: 'herosAnime' })); // matérialisation (carte-blender)
  // Repères au sol R1 (recharge du dash) et R2 (santé basse) : posés au sol, test de profondeur (retour de Femz du 13/11)
  reperes.init(ctx.scene, ctx.render); // § E5.X6 (D14) : render pour la copie des crans dessinée par-dessus la foule
  lastDashMul[0] = mods.dashCdMul;
  visee.init(ctx); // § E5.U : la plaque du trait est dans la scène avant le prewarm
  ombreFrappe.init(ctx); // § E5.AM : matériaux de l'ombre de la Frappe éclair (ses maillages au premier héros posé)
}

/**
 * Modèles du héros arrivés (main.js, une fois, avant la première partie) : données de src/rendu/modeles.js (pièces
 * figées dans la pose du fichier). donnees : heros.glb (l'Éclaireur) ; agents : un modèle par agent, dans l'ordre de
 * AGENTS (défaut : heros.glb pour tous). Le modèle de l'agent courant est posé.
 */
export function setModele(donnees, agents = null) {
  modeles = AGENTS.map(() => ({}));
  if (agents) {
    for (let a = 0; a < agents.length; a++) if (agents[a]) modeles[a][agents[a].skin || SKIN_BASE] = agents[a];
  } else for (let a = 0; a < AGENTS.length; a++) modeles[a][SKIN_BASE] = donnees;
  // modèle allégé à texture cuite (17/11, userData.cuit) : atlas + lueurs en alpha, posé par poserAgent (une image par
  // agent) ; sinon l'image des armes bakées (aTex = 1 seulement)
  if (!(donnees && donnees.userData && donnees.userData.cuit)) appliquerTexturesArmes(materiau, donnees && donnees.textures);
  // atlas de chaque agent préparés et envoyés au GPU maintenant (un changement d'agent n'en charge plus aucun)
  for (const m of toutesDonnees()) {
    if (!m.textures || !(m.userData && m.userData.cuit)) continue;
    preparerTexturesModele(m.textures);
    ctx.render.chargerTexture(m.textures.map);
    ctx.render.chargerTexture(m.textures.normalMap);
  }
  agentPose = -1;
  couleurs0 = null;
  // § E5.K : l'agent de la partie s'il est chargé, sinon le seul chargé (main.js charge ensuite celui de run.agent)
  if (modeles[run.agent][skinVoulu]) poserAgent(run.agent, skinVoulu);
  else {
    const a = modeles.findIndex((m) => Object.keys(m).length > 0);
    if (a >= 0) poserAgent(a, Object.keys(modeles[a])[0]);
  }
  heros.setActif(true);
}

/** Données de tous les modèles chargés (hors image : préparation des atlas). */
function toutesDonnees() {
  const l = [];
  for (const m of modeles) for (const k of Object.keys(m)) if (m[k]) l.push(m[k]);
  return l;
}

/** Skin voulu sur l'agent de la partie, repli sur la base si son fichier a échoué (main.js : meta.skinEffectif). */
export function vouloirSkin(skin) {
  skinVoulu = skin;
}

/** Skin réellement montrable : `skin`, ou 'base' si le fichier de ce skin ne charge pas pour l'agent a. */
export function skinPour(a, skin) {
  return skin !== SKIN_BASE && skinsEchec.has(a + ':' + skin) ? SKIN_BASE : skin;
}

/** Le modèle du skin de l'agent a est illisible : plus jamais demandé (repli sur la base). */
export function signalerEchecSkin(a, skin) {
  if (skin !== SKIN_BASE) skinsEchec.add(a + ':' + skin);
}

/** Skin du modèle posé sur le héros ('base' tant que rien n'est posé). */
export function skinCourant() {
  return skinPose;
}

/** § E5.K : le modèle de l'agent a (skin donné, base par défaut) est chargé (vrai) ; faux avant l'arrivée des modèles. */
export function aModeleAgent(a, skin = SKIN_BASE) {
  return modeles !== null && !!modeles[a] && !!modeles[a][skin];
}

/**
 * § E5.K : modèle de l'agent a (et de son skin) arrivé à la demande (main.js, hors combat) — rangé, pas posé
 * (poserAgentCourant). Faux avant l'arrivée des modèles du démarrage.
 */
export function ajouterModeleAgent(a, skin, donnees) {
  if (modeles === null || !(a >= 0 && a < AGENTS.length) || !donnees) return false;
  if (modeles[a][skin] && modeles[a][skin] !== donnees) libererModele(a, skin);
  modeles[a][skin] = donnees;
  return true;
}

/**
 * § E5.K : pose le modèle de run.agent (son skin voulu ; hors combat : titre, écran Agents, Noyau) puis libère tous les
 * autres, sauf `garder` / `gardeSkin` (le modèle montré par la fiche de l'écran Agents, -1 : aucun). Rend les modèles
 * libérés ({ a, skin }, main.js oublie leur glTF). Rien si le modèle de run.agent n'est pas chargé.
 */
export function poserAgentCourant(garder = -1, gardeSkin = SKIN_BASE) {
  if (!aModeleAgent(run.agent, skinVoulu)) return [];
  poserAgent(run.agent, skinVoulu);
  teinter(AGENTS[run.agent].accent);
  const libres = [];
  for (let a = 0; a < modeles.length; a++) {
    for (const k of Object.keys(modeles[a])) {
      if (!(a === garder && k === gardeSkin) && libererModele(a, k)) libres.push({ a, skin: k });
    }
  }
  return libres;
}

/**
 * § E5.K : libère le modèle de l'agent a (jamais celui qui est posé) : portrait de la fiche qui le montrait
 * (pauseAgent.oublier), géométrie rendue au GPU (dispose) et aux ramasse-miettes (plus aucune référence ici). L'image des
 * armes est PARTAGÉE par tous les agents (pieces.js atlasArmes) et par le héros de l'écran titre : jamais libérée.
 * Vrai si un modèle a été libéré.
 */
export function libererModele(a, skin = SKIN_BASE) {
  if (modeles === null || (a === agentPose && skin === skinPose) || !modeles[a] || !modeles[a][skin]) return false;
  const d = modeles[a][skin];
  delete modeles[a][skin];
  if (a === AGENT.ECLAIREUR) couleurs0 = null; // couleurs de CE fichier : relues si l'Éclaireur revient
  if (ctx && ctx.pauseAgent && ctx.pauseAgent.oublier) ctx.pauseAgent.oublier(d.geometry);
  d.geometry.dispose();
  return true;
}

/** § E4.L.1 : données du modèle de l'agent a (pièces, vides, géométrie), null avant l'arrivée des modèles. */
export function modeleAgent(a, skin = SKIN_BASE) {
  if (modeles === null || !modeles[a]) return null;
  return modeles[a][skin] || null; // § E5.K : null si l'agent n'est pas chargé
}

/**
 * Pose le modèle de l'agent a (rien s'il l'est déjà) : maillage, silhouette, images rémanentes, cape (sauf agent
 * sans cape), modules d'armes ; l'ancien héros est libéré (heros.liberer). Hors combat seulement : appelé par
 * setModele et reset (début de partie, Rejouer, retour au titre).
 */
function poserAgent(a, skin = SKIN_BASE) {
  if (modeles === null || (a === agentPose && skin === skinPose) || !modeles[a] || !modeles[a][skin]) return; // § E5.K : pas chargé → l'agent posé reste
  const donnees = modeles[a][skin];
  // modèle cuit : l'atlas de CET agent sur le matériau partagé (hors combat ; même programme d'un agent à l'autre)
  if (donnees.userData && donnees.userData.cuit) appliquerTexturesModele(materiau, donnees.textures);
  heros.init({ scene: ctx.scene, donnees, materiau, avecCape: AGENTS[a].cape !== false, avecTissus: !!AGENTS[a].tissus, agent: a, skin }); // § E5.I : tissus du Shinobi // SkinnedMesh « joueur », silhouette, images rémanentes, cape
  armes.init({ scene: ctx.scene, materiau }); // modules d'armes, bouches, tourelles, éclairs
  armes.ACTIF[0] = 1; // les tirs partent des bouches (weapons.js lit armes.api)
  ombreFrappe.lier(a); // § E5.AM : l'ombre partage la géométrie et le squelette de CE héros (avant le préchauffage)
  modele = donnees;
  agentPose = a;
  skinPose = skin;
  accentPose = -1;
  // § E2.D : couleurs du fichier de l'Éclaireur, gardées (seul modèle teinté : les agents ont leur accent dans le .glb)
  if (a === AGENT.ECLAIREUR && couleurs0 === null) couleurs0 = new Float32Array(donnees.geometry.attributes.color.array);
  teinter(AGENTS[a].accent);
}

/**
 * § E2.D — teinte d'accent de l'agent : les sommets ÉMISSIFS CYAN du héros (yeux, filets : aEmissive = 1 et couleur
 * du fichier alignée sur PALETTE.playerAccent) prennent la couleur hex, à la luminance qu'ils avaient dans le fichier
 * (rapportée à celle du cyan). Les autres émissifs du maillage (lueurs des armes portées : violet, vert, orange,
 * blanc bleuté — mesuré le 15/11 : 800 sommets sur 1 512) gardent leur couleur, comme tout le reste. Hors combat
 * (setModele, reset) ; rien si la teinte est déjà posée. L'accent du fichier (cyan) redonne les couleurs d'origine.
 */
function teinter(hex) {
  accentAnneau = hex;
  if (agentPose !== AGENT.ECLAIREUR) {
    // Bastion, Shinobi : leur accent est dans les couleurs de sommets de leur .glb (bleu, orange) — rien à teindre
    if (modele !== null) accentPose = hex;
    return;
  }
  if (modele === null || couleurs0 === null || hex === accentPose) return;
  accentPose = hex;
  const g = modele.geometry;
  const c = g.attributes.color;
  const e = g.attributes.aEmissive.array;
  const a = c.array;
  if (hex === PALETTE.playerAccent) a.set(couleurs0);
  else {
    const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const lum = (r, gg, b) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    const r1 = lin(((hex >> 16) & 255) / 255);
    const g1 = lin(((hex >> 8) & 255) / 255);
    const b1 = lin((hex & 255) / 255);
    const h0 = PALETTE.playerAccent;
    const r0 = lin(((h0 >> 16) & 255) / 255);
    const g0 = lin(((h0 >> 8) & 255) / 255);
    const b0 = lin((h0 & 255) / 255);
    const l0 = lum(r0, g0, b0);
    const n0 = Math.sqrt(r0 * r0 + g0 * g0 + b0 * b0);
    const n = c.itemSize;
    for (let i = 0; i < e.length; i++) {
      const k = i * n;
      const cr = couleurs0[k];
      const cg = couleurs0[k + 1];
      const cb = couleurs0[k + 2];
      const nc = Math.sqrt(cr * cr + cg * cg + cb * cb);
      // cyan du fichier : même direction de couleur que l'accent d'origine (cosinus > 0,99)
      if (e[i] > 0 && nc > 0 && (cr * r0 + cg * g0 + cb * b0) / (nc * n0) > 0.99) {
        const f = lum(couleurs0[k], couleurs0[k + 1], couleurs0[k + 2]) / l0;
        a[k] = r1 * f;
        a[k + 1] = g1 * f;
        a[k + 2] = b1 * f;
      } else {
        a[k] = couleurs0[k];
        a[k + 1] = couleurs0[k + 1];
        a[k + 2] = couleurs0[k + 2];
      }
    }
  }
  c.needsUpdate = true;
}

export function reset() {
  pasAgents.reset(); // § E5.G : aucun pas en attente d'une partie à l'autre
  CIBLE.fill(0); // § E5.AB.14 : aucun ordre de clic d'une partie à l'autre
  P.x = 0;
  P.z = 0;
  P.vx = 0;
  P.vz = 0;
  P.moveX = view.upX;
  P.moveZ = view.upZ;
  P.rot = Math.atan2(P.moveX, P.moveZ);
  P.maxHp = PLAYER.maxHp + mods.maxHpAdd;
  P.hp = P.maxHp;
  P.radius = PLAYER.radius;
  P.rayonDegats = COMBAT_GUIDE.heros.rayonDegats; // § E5.N (B5)
  P.alive = true;
  P.dashT = 0;
  P.dashCd = 0;
  P.dashReq = 0; // § E5.X6 (D3)
  X6[0] = 0; // § E5.X6 (D2)
  X6[1] = -1e9;
  dashFini = 0;
  dashAgents.reset();
  P.dashDirX = P.moveX;
  P.dashDirZ = P.moveZ;
  P.invulnT = 0;
  PAREFEU_F[0] = -1; // items.js le réécrit à la première image (Pare-feu)
  lastDashMul[0] = mods.dashCdMul;
  dashCut[0] = mods.critDashCut; // § E2.D : seau plein
  dashCut[1] = 0;
  poserAgent(run.agent); // modèle de l'agent (rien s'il est déjà posé) — reset est toujours hors combat
  // § E2.D : accent de l'agent (rien si déjà posé) ; § E5.K : celui de l'agent POSÉ (run.agent pas encore chargé :
  // main.js ne lance aucune partie avant son arrivée)
  teinter(AGENTS[agentPose >= 0 ? agentPose : run.agent].accent);
  visee.reset(); // § E5.U : visée = direction de marche, trait éteint (avant heros.reset : regard posé)
  heros.reset(); // pose, cape replacée (téléportation), visée
  reperes.reset();
  armes.reset();
}

export function update(dt) {
  if (!P.alive) return;
  // 1. minuteries (celle du dash est décomptée à l'étape 5, avec le déplacement)
  if (P.dashCd > 0) {
    P.dashCd -= dt;
    if (P.dashCd <= 0) {
      P.dashCd = 0;
      audio.play(SFX.DASH_READY);
    }
  }
  if (P.invulnT > 0) {
    P.invulnT -= dt;
    if (P.invulnT < 0) P.invulnT = 0;
  }
  // 1 bis. § E2.D, « Réflexe » : le seau des secondes retirables par les critiques se remplit (plafond : un critique)
  if (mods.critDashCut > 0 && dashCut[0] < mods.critDashCut) {
    dashCut[0] += AGENTS[run.agent].passive.critDashCutPerSecond * dt;
    if (dashCut[0] > mods.critDashCut) dashCut[0] = mods.critDashCut;
  }
  // 2. régénération
  if (mods.regenPerSec > 0 && P.hp < P.maxHp) {
    P.hp += mods.regenPerSec * dt;
    if (P.hp > P.maxHp) P.hp = P.maxHp;
  }
  // 3. direction voulue : axes d'ÉCRAN → monde (personne d'autre ne refait ce calcul)
  const mx = input.getMoveX();
  const my = input.getMoveY();
  const souris = input.getModeSouris(); // § E5.AB : caméra derrière l'agent (ZQSD en axes de la caméra, comme toujours)
  let dirX = mx * view.rightX + my * view.upX;
  let dirZ = mx * view.rightZ + my * view.upZ;
  // § E4.O.2 : coup de pied cuit en cours — la touche de déplacement est ignorée jusqu'au fondu de sortie (le héros
  // s'engage : il freine, se plante à D* de la borne, ne se retourne pas) ; un dash annule le coup (dashAnnule)
  const KC = CPV2.COUP;
  const engage = KC[CPV2.C_ACTIF] === 1 && KC[CPV2.C_V2] === 1 && P.dashT <= 0 && KC[CPV2.C_T] + dt < KC[CPV2.C_TR] - COUP_DE_PIED.v2.liberation ? 1 : 0;
  if (KC[CPV2.C_ACTIF] === 1 && KC[CPV2.C_V2] === 1 && engage === 0) KC[CPV2.C_LIBRE] = 1;
  let moving = (mx !== 0 || my !== 0) && engage === 0;
  //#region e5:AB-camera-3p
  // § E5.AB.14 (Femz, 22/11 : « l'autre mode ortho doit inclure clic souris LoL ») : mode « Vue fixe » — le clic pour
  // avancer de 0.5.7, rétabli tel quel (ZQSD reste actif : une touche de direction fait tomber l'ordre)
  // Déplacement à la souris (Femz, 21/11) : clic droit au sol = le héros y va ; maintenu, il suit le curseur ; une touche
  // de direction reprend la main (l'ordre tombe) ; arrivé à SOURIS.arrivee m, ou bloqué BLOQUE_S s, il s'arrête
  if (!souris) {
    const S = REGLAGES.souris;
    if (mx !== 0 || my !== 0) CIBLE[0] = 0;
    else if (input.droitEnfonce() || input.droitClic()) { // un clic bref (appui et relâche dans la même image) compte
      input.curseur(CUR);
      ctx.camera.screenToGround(CUR.x, CUR.y, SOL);
      if (CIBLE[0] === 0 || input.droitClic()) {
        CIBLE[3] = 1e9;
        CIBLE[4] = 0;
      }
      CIBLE[0] = 1;
      CIBLE[1] = SOL.x;
      CIBLE[2] = SOL.z;
      CIBLE[5] -= dt;
      if (input.droitClic() || CIBLE[5] <= 0) {
        CIBLE[5] = S.marqueur.maintenuSecondes;
        const vraiClic = input.droitClic();
        if (ctx.ui && ctx.ui.marqueurClic) ctx.ui.marqueurClic(SOL.x, SOL.z, vraiClic);
        if (vraiClic) audio.play(SFX.CLIC_DEPLACEMENT); // § E5.Q ter : seulement le vrai clic, pas le repère maintenu
      }
    }
    if (CIBLE[0] === 1 && !moving && engage === 0) {
      const dx = CIBLE[1] - P.x;
      const dz = CIBLE[2] - P.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < CIBLE[3] - 0.002) CIBLE[4] = 0;
      else CIBLE[4] += dt;
      CIBLE[3] = d;
      if (d <= S.arrivee || (CIBLE[4] >= BLOQUE_S && !input.droitEnfonce())) CIBLE[0] = 0;
      else {
        dirX = dx / d;
        dirZ = dz / d;
        moving = true;
      }
    }
  } else CIBLE[0] = 0;
  //#endregion e5:AB-camera-3p
  if (moving) {
    const l = Math.sqrt(dirX * dirX + dirZ * dirZ);
    dirX /= l;
    dirZ /= l;
    P.moveX = dirX;
    P.moveZ = dirZ;
  }
  // 4. dash
  // § E5.X6 (D3) : l'appui est gardé X6_TAMPON s (P.dashReq) et part dès que la recharge finit ; décompté APRÈS le test
  // (pas à l'image de l'appui) : un appui fait à ≤ X6_TAMPON s de la fin part toujours, à toute cadence
  X6[0] += dt;
  const appuiDash = input.pressed(ACTION.DASH);
  if (appuiDash) P.dashReq = X6_TAMPON;
  if (P.dashReq > 0 && P.dashCd <= 0 && P.dashT <= 0 && (engage === 0 || COUP_DE_PIED.v2.dashAnnule)) {
    P.dashReq = 0; // § E5.X6 (D3) : demande consommée
    if (KC[CPV2.C_ACTIF] === 1 && KC[CPV2.C_V2] === 1) {
      CPV2.annuler(); // § E4.O.2 : le dash annule le coup, dans la direction de la touche tenue
      if ((mx !== 0 || my !== 0) && !moving) {
        const l = Math.sqrt(dirX * dirX + dirZ * dirZ);
        P.moveX = dirX / l;
        P.moveZ = dirZ / l;
      }
    }
    const D = PLAYER.dash;
    P.dashCd = getDashCooldown();
    P.dashDirX = P.moveX;
    P.dashDirZ = P.moveZ;
    //#region e5:AB-camera-3p
    if (souris) {
      // § E5.AB.4 : la direction ZQSD tenue (axes de la caméra), sinon l'avant de la caméra
      if (mx !== 0 || my !== 0) {
        const l = Math.sqrt(dirX * dirX + dirZ * dirZ);
        P.dashDirX = dirX / l;
        P.dashDirZ = dirZ / l;
      } else {
        P.dashDirX = view.upX;
        P.dashDirZ = view.upZ;
      }
      P.moveX = P.dashDirX;
      P.moveZ = P.dashDirZ;
    } else if (mx === 0 && my === 0) {
      // § E5.AB.14 : mode « Vue fixe » sans touche de direction — le dash part vers le curseur (0.5.7), sauf curseur sur le héros
      input.curseur(CUR);
      ctx.camera.screenToGround(CUR.x, CUR.y, SOL);
      const dx = SOL.x - P.x;
      const dz = SOL.z - P.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > REGLAGES.souris.dashMin) {
        P.dashDirX = dx / d;
        P.dashDirZ = dz / d;
        P.moveX = P.dashDirX;
        P.moveZ = P.dashDirZ;
      }
    }
    //#endregion e5:AB-camera-3p
    fx.spawnRing(P.x, P.z, D.ringRadius, accentAnneau); // § E2.D : anneau à la teinte de l'agent
    // 16/11 (point 11) : trajet propre à l'agent — glissade (Éclaireur), bond (Bastion), téléportation (Shinobi : 0 s,
    // il est déjà arrivé) ; même recharge, même invulnérabilité
    P.dashT = dashAgents.depart(D.speed, D.duration);
    const inv = (P.dashT > 0 ? P.dashT : D.duration) + D.invulnExtra;
    if (P.invulnT < inv) P.invulnT = inv;
    if (run.agent !== AGENT.SHINOBI) audio.play(SFX.PLAYER_DASH); // le pas de l'ombre joue sa fumée
  } else if (appuiDash && P.dashCd > P.dashReq) {
    // § E5.X6 (D2) : appui refusé (recharge plus longue que le tampon, ou dash en cours) — R1 pingue en rouge à chaque
    // refus ; clic sourd (BUY_DENIED adouci) au plus un toutes les X6_ECART s
    REFUS_X6[1]++;
    reperes.entree[1] = 1;
    if (X6[0] - X6[1] >= X6_ECART) {
      X6[1] = X6[0];
      audio.playGain(SFX.BUY_DENIED, X6_GAIN);
    }
  }
  if (!appuiDash && P.dashReq > 0) P.dashReq = P.dashReq > dt ? P.dashReq - dt : 0; // § E5.X6 (D3)
  // 5. vitesse et déplacement. Le pas est partagé entre le dash (le temps de dash qui reste, au plus) et la
  // marche (le reste du pas) : le dash parcourt exactement dash.speed × dash.duration, à toute cadence.
  let nx = P.x;
  let nz = P.z;
  let walkDt = dt;
  const speed = PLAYER.speed * mods.moveSpeedMul * (UMUL !== null ? UMUL[0] : 1); // § E3.C : Overclocking (UMUL[0])
  if (P.dashT > 0) {
    const t = P.dashT < dt ? P.dashT : dt;
    const ds = dashAgents.DASH[0] > 0 ? dashAgents.DASH[0] : PLAYER.dash.speed; // 16/11 (point 11) : vitesse de l'agent
    nx += P.dashDirX * ds * t;
    nz += P.dashDirZ * ds * t;
    P.vx = P.dashDirX * ds;
    P.vz = P.dashDirZ * ds;
    P.dashT -= t;
    walkDt = dt - t;
    if (P.dashT <= 1e-9) {
      // Fin du dash : l'élan est ramené tout de suite à la vitesse de marche. Sans cela la décélération à
      // PLAYER.accel ajoute 24² / (2 × 70) ≈ 4 m de glissade et le dash parcourt 8 m au lieu de 4,3 (mesuré).
      P.dashT = 0;
      P.vx = P.dashDirX * speed;
      P.vz = P.dashDirZ * speed;
      dashFini = 1;
    }
  }
  if (engage === 1 && P.dashT <= 0) {
    // § E4.O.2 : freinage en Hermite de la position de départ (avec sa vitesse) au point de plantage (vitesse nulle)
    // pendant fonduEntree, puis planté. Exact à toute cadence (position écrite, pas intégrée).
    const tau = COUP_DE_PIED.v2.fonduEntree;
    let u = (KC[CPV2.C_T] + dt) / tau;
    if (u > 1) u = 1;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const d00 = (6 * u2 - 6 * u) / tau;
    const d10 = 3 * u2 - 4 * u + 1;
    const d01 = (-6 * u2 + 6 * u) / tau;
    nx = h00 * KC[CPV2.C_X0] + h10 * tau * KC[CPV2.C_VX0] + h01 * KC[CPV2.C_PX];
    nz = h00 * KC[CPV2.C_Z0] + h10 * tau * KC[CPV2.C_VZ0] + h01 * KC[CPV2.C_PZ];
    P.vx = d00 * KC[CPV2.C_X0] + d10 * KC[CPV2.C_VX0] + d01 * KC[CPV2.C_PX];
    P.vz = d00 * KC[CPV2.C_Z0] + d10 * KC[CPV2.C_VZ0] + d01 * KC[CPV2.C_PZ];
    if (u >= 1) {
      P.vx = 0;
      P.vz = 0;
    }
    walkDt = 0;
  }
  if (walkDt > 0) {
    const vx0 = P.vx;
    const vz0 = P.vz;
    const tx = moving ? dirX * speed : 0;
    const tz = moving ? dirZ * speed : 0;
    const ax = tx - vx0;
    const az = tz - vz0;
    const al = Math.sqrt(ax * ax + az * az);
    const step = PLAYER.accel * walkDt;
    if (al <= step) {
      P.vx = tx;
      P.vz = tz;
    } else {
      P.vx = vx0 + (ax / al) * step;
      P.vz = vz0 + (az / al) * step;
    }
    // vitesse moyenne du pas (trapèze) : exact pour une accélération constante, donc indépendant de la cadence
    nx += (vx0 + P.vx) * 0.5 * walkDt;
    nz += (vz0 + P.vz) * 0.5 * walkDt;
  }
  // 6. obstacles et bords de l'arène
  world.resolve(nx, nz, P.radius, out2);
  P.x = out2[0];
  P.z = out2[1];
  // 16/11 (point 11) : fin du trajet (traînée, onde) à la position finale ; effets en cours (traînée, leurre)
  if (dashFini === 1) {
    dashFini = 0;
    dashAgents.fin();
  }
  dashAgents.update(dt);
  // 7. cap : rejoint la direction de déplacement (§ E4.O.2 : pendant le coup cuit, celle de la borne, sans demi-tour)
  if (engage === 1) {
    P.moveX = Math.sin(KC[CPV2.C_LACET]);
    P.moveZ = Math.cos(KC[CPV2.C_LACET]);
  }
  const target = Math.atan2(P.moveX, P.moveZ);
  let d = target - P.rot;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  P.rot += d * (1 - Math.exp(-PLAYER.turnRate * dt));
  // 8. animation (temps simulé) : corps (buste / bassin, marche, dash), puis repères au sol (le ping de R1 part du même
  // pas que SFX.DASH_READY, étape 1), puis visée des bras (lit la recharge des armes)
  visee.update(); // § E5.U : direction héros → curseur (après le déplacement), regard du buste, lue par la Frappe éclair
  heros.update(dt);
  pasAgents.update(); // § E5.G : un contact du pied (pose de l'image précédente) → son du pas
  reperes.entree[0] = getDashCooldown();
  reperes.update(dt);
  armes.update(dt);
}

/**
 * F11 : repères au sol (ils écrivent le gonflement du corps et la lueur du ping), pose du héros et de sa cape, puis
 * armes (après la pose : bouches et éclairs). Invulnérabilité en lueur cyan (heros-anim), plus de clignotement blanc.
 */
export function sync() {
  reperes.sync();
  if (modele === null) return;
  heros.sync();
  armes.sync();
}

/** P.maxHp = PLAYER.maxHp + mods.maxHpAdd (les PV courants ne bougent pas). */
export function onModsChanged() {
  P.maxHp = PLAYER.maxHp + mods.maxHpAdd;
  if (P.hp > P.maxHp) P.hp = P.maxHp;
  // Intégration (demandé par le lot progression) : « Propulseurs » pris pendant une recharge raccourcit aussi le temps
  // qui reste, dans le même rapport que la recharge complète.
  const m = mods.dashCdMul;
  if (P.dashCd > 0 && lastDashMul[0] > 0 && m !== lastDashMul[0]) P.dashCd *= m / lastDashMul[0];
  lastDashMul[0] = m;
}

/** Soigne ; renvoie les PV rendus (borné à P.maxHp). § E5.Q (B14) : les PV rendus nourrissent src/soin-heros.js. */
export function heal(amount) {
  if (!P.alive || !(amount > 0)) return 0;
  const before = P.hp;
  P.hp += amount;
  if (P.hp > P.maxHp) P.hp = P.maxHp;
  if (P.hp > before) {
    SOIN[S_CUMUL] += P.hp - before; // lueur verte, « +N », éclat de la barre (soin-heros.update)
    SOIN_SIGNAUX[2] = 1;
  }
  return P.hp - before;
}

/**
 * § E2.D, « Réflexe » : un coup critique vient de tomber (damage.hitEnemyF). Retire à la recharge du dash en cours
 * min(mods.critDashCut, seau) secondes — aucun argument, aucun flottant passé (§ V). Le dash qui devient prêt ici
 * sonne à l'image suivante (étape 1 de update), comme une recharge normale.
 */
export function critDashCutF() {
  if (!(P.dashCd > 0)) return;
  let cut = mods.critDashCut < dashCut[0] ? mods.critDashCut : dashCut[0];
  if (cut > P.dashCd) cut = P.dashCd;
  if (!(cut > 0)) return;
  dashCut[0] -= cut;
  dashCut[1] += cut;
  P.dashCd -= cut;
  if (P.dashCd < 1e-6) P.dashCd = 1e-6; // prêt à la prochaine image : update() le ramène à 0 et joue SFX.DASH_READY
}

export function getDashCooldown() {
  return PLAYER.dash.cooldown * mods.dashCdMul;
}

/** Debug seulement : place le joueur (borné à l'arène), vitesse nulle. */
export function teleport(x, z) {
  const lim = WORLD.half - P.radius;
  P.x = x > lim ? lim : x < -lim ? -lim : x;
  P.z = z > lim ? lim : z < -lim ? -lim : z;
  P.vx = 0;
  P.vz = 0;
}

export function inspect(out) {
  out.x = P.x;
  out.z = P.z;
  out.moveX = P.moveX; // dernière direction de marche, unitaire (§ E3.N : frappe éclair, grosse tourelle)
  out.moveZ = P.moveZ;
  out.hp = P.hp;
  out.maxHp = P.maxHp;
  out.alive = P.alive;
  out.dashing = P.dashT > 0;
  out.dashCd = P.dashCd;
  out.invuln = P.invulnT;
  out.invincible = debug.isInvincible();
  out.modele = modele !== null; // modèle Blender posé (§ Z quinquies)
  out.accent = accentPose; // § E2.D : teinte posée sur les sommets émissifs (−1 : pas de modèle)
  out.agentModele = agentPose; // agent dont le modèle est posé (−1 : aucun)
  out.modelesCharges = modeles === null ? [] : modeles.map((m) => Object.keys(m).length > 0);
  out.modelesSkins = modeles === null ? [] : modeles.flatMap((m, a) => Object.keys(m).map((k) => a + ':' + k));
  out.skinModele = skinPose; // § E5.K : un seul vrai hors changement d'agent
  out.sommets = modele !== null ? modele.geometry.attributes.position.count : 0;
  out.dashCut = dashCut[1]; // § E2.D : secondes de recharge du dash retirées par « Réflexe » depuis le début de la partie
  out.dashCutBucket = dashCut[0];
  visee.inspect((out.visee = {})); // § E5.U
}
