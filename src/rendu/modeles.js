// MODÈLES DES UNITÉS — les modèles Blender (.glb) du héros, des six robots, du marchand et du boss, chargés en
// arrière-plan au démarrage (étape « modèles » du grand branchement, ARCHITECTURE.md § Z quinquies ; DA « Clash »,
// docs/da-clash.md). Remplacent les constructeurs procéduraux de player.js, enemies.js, boss.js et shop.js.
//
// Déroulé (main.js) : charger() est lancé avant tout (en même temps que le décor) ; chaque module crée son maillage à
// l'init avec geometrieVide() (zéro sommet, mêmes attributs), puis main appelle les setModele…() des modules quand la
// promesse est tenue — avant le préchauffage si elle l'est déjà, sinon pendant l'écran titre. La partie ne démarre
// qu'ensuite (main.start).
// Données d'un modèle : celles de src/anim/pieces.js chargerPieces — géométrie INDEXÉE (position, normal, color
// linéaire = couleur × AO cuite × dégradé ; pièces émissives à la couleur émissive de leur matériau, comme le rendu
// validé), aEmissive 0/1, piece = index de la pièce, aFx nul), pieces (nom, parent,
// pivot), vides (bouches des armes, accroches de la cape…), echelle. Les pièces restent FIGÉES dans la pose du fichier
// à cette étape : l'animation par pièce (heros-anim, allure, boss-corps) est l'étape suivante, qui lira `piece`.
// Étape « animations » (§ Z sexies) : `piece` est lu par heros-anim (squelette du héros), allure (membres des robots dans
// le shader) et boss-corps (squelette du boss, lu dans « complet » : le fichier entier).
// Aucun appel dans un chemin chaud : init et arrivée des modèles seulement.
import * as THREE from 'three';
import { AGENTS, BOSS, ENEMIES, ENEMY, ENEMY_COUNT, MODELES, PLAYER, SHOP } from '../config.js';
import { CHESTS } from '../config.js'; // types porteurs : modèles élites (17/11)
import { chargerPieces } from '../anim/pieces.js';
import { oublierGltf } from './glb.js';

/** Hauteurs du jeu (m) : chaque modèle est mis à cette hauteur, rapportée à sa hauteur déclarée (config MODELES). */
export function hauteurs() {
  const robots = [];
  for (let t = 0; t < ENEMY_COUNT; t++) robots.push(t === ENEMY.BOSS ? BOSS.height : ENEMIES.types[t].height);
  return {
    heros: PLAYER.height * PLAYER.visualScale,
    robots,
    boss: BOSS.height,
    marchand: MODELES.marchandHauteur * SHOP.merchant.scale,
  };
}

/**
 * Charge les fichiers des unités (en parallèle). Résout { heros (le modèle de l'agent `agent`), agents[AGENT_COUNT] (§ E5.K :
 * SEUL l'agent `agent` est chargé, les autres valent null — chargerAgent les lit à la demande), agent, robots[ENEMY_COUNT]
 * (null pour le boss), boss: { corps, chaud, complet (corps animé, § Z sexies) }, marchand, ms, fichiers } ; rejette si un
 * fichier manque ou est illisible (le jeu affiche alors l'erreur sur l'écran titre). base : adresse du dossier des
 * modèles (défaut : MODELES.dir depuis la racine du jeu). agent : l'agent sélectionné (sauvegardé ; défaut l'Éclaireur).
 */
// Modèles allégés à texture cuite (17/11/2026, outils/blender/cuire.sh, ≈ 2 000 triangles) : le jeu lit <nom>-cuit.glb
// pour le BOSS (comme la horde et les élites, cuites en place). L'écran titre (src/menu/boss-menu.js) garde boss.glb.
// Héros et agents : DÉTAILLÉS partout, en partie comme en gros plan (Femz, 17/11, à la fusion de l'arsenal : « garde
// détaillé le héros et ses armes ») ; heros-cuit.glb et agent-*-cuit.glb retirés.
// § E5.K (18/11, Femz : « charger seulement l'agent choisi en détaillé, au lieu des trois en même temps ») : environ
// 100 000 sommets par agent ; le Chrome d'un PC modeste plantait au chargement des trois. Un seul agent en mémoire : celui
// de la partie ; un autre est lu au moment où il est choisi (chargerAgent), l'ancien libéré (oublierAgent + dispose).
const CUIT = { 'boss.glb': 'boss-cuit.glb' };
const cuit = (f) => CUIT[f] || f;
const baseDefaut = () => new URL('../../' + MODELES.dir, import.meta.url).href;

/** § E5.K : fichier du modèle détaillé de l'agent a (heros.glb pour l'Éclaireur). */
export function fichierAgent(a) {
  const A = AGENTS[a];
  return (A && MODELES.agents[A.key]) || MODELES.heros;
}

/**
 * § E5.K : modèle détaillé de l'agent a (mêmes options que le héros : textures = image des armes PARTAGÉE, lue une fois
 * pour tous, src/anim/pieces.js atlasArmes). Rejette si le fichier manque ou est illisible.
 */
export function chargerAgent(a, base = baseDefaut()) {
  return chargerPieces(base + cuit(fichierAgent(a)), { cible: hauteurs().heros, emissifMateriau: true, textures: true });
}

/** § E5.K : oublie le glTF de l'agent a (cache de glb.js) ; ses données de jeu sont libérées par player (dispose). */
export function oublierAgent(a, base = baseDefaut()) {
  oublierGltf(base + cuit(fichierAgent(a)));
}

export async function charger(base = baseDefaut(), { agent = 0 } = {}) {
  const t0 = performance.now();
  const H = hauteurs();
  const url = (f) => base + f;
  const choisi = Number.isInteger(agent) && agent >= 0 && agent < AGENTS.length ? agent : 0;
  const robots = [];
  for (let t = 0; t < ENEMY_COUNT; t++) {
    if (t === ENEMY.BOSS) robots.push(null);
    // textures : modèles allégés à texture cuite (outils/blender/cuire_modele.py, 17/11) — uv + aTex, atlas dans le .glb ;
    // un modèle sans image garde ses couleurs de sommet (aTex = 0)
    else robots.push(chargerPieces(url(MODELES.robots[ENEMIES.types[t].key]), { cible: H.robots[t], emissifMateriau: true, textures: true }));
  }
  // Modèles ÉLITES (17/11) : <type>-elite.glb des types porteurs (CHESTS.carrier.types), allégés à texture cuite ;
  // facultatifs (absents ou illisibles : null, l'élite garde le modèle normal)
  const elitesP = [];
  for (let t = 0; t < ENEMY_COUNT; t++) {
    const k = ENEMIES.types[t].key;
    elitesP.push(CHESTS.carrier.types.includes(t) && MODELES.robots[k]
      ? chargerPieces(url(MODELES.robots[k].replace(/\.glb$/, '-elite.glb')), { cible: H.robots[t], emissifMateriau: true, textures: true }).catch(() => null)
      : Promise.resolve(null));
  }
  // Boss : corps (phase 1) et surcouche de phase 2 lus dans le MÊME fichier (lu une fois : cache de glb.js), la surcouche
  // à l'échelle du corps (une mise à hauteur par phase les décalerait).
  const corps = chargerPieces(url(cuit(MODELES.boss)), { cible: H.boss, phase: 1, emissifMateriau: true, textures: true });
  const chaud = corps.then((c) => chargerPieces(url(cuit(MODELES.boss)), { echelle: c.echelle, phase: 2, emissifMateriau: true }));
  // corps ANIMÉ (étape « animations », § Z sexies) : tout le fichier, pièces de phase 2 comprises (src/anim/boss-corps.js)
  const complet = corps.then((c) => chargerPieces(url(cuit(MODELES.boss)), { echelle: c.echelle, emissifMateriau: true, textures: true }));
  // héros : le modèle détaillé de l'agent CHOISI seulement (§ E5.K) ; textures : armes de l'image partagée (uv + aTex)
  const herosP = chargerAgent(choisi, base);
  const [heros, marchand, c, ch, cp, ...rs] = await Promise.all([
    herosP,
    chargerPieces(url(MODELES.marchand), { cible: H.marchand, emissifMateriau: true }),
    corps,
    chaud,
    complet,
    ...robots.map((p) => p || Promise.resolve(null)),
  ]);
  rs.elites = await Promise.all(elitesP); // lu par enemies.setModeles (robots.elites[t])
  const agents = AGENTS.map((_, a) => (a === choisi ? heros : null));
  const fichiers = 2 + 1 + ENEMY_COUNT - 1;
  return { heros, agents, agent: choisi, robots: rs, boss: { corps: c, chaud: ch, complet: cp }, marchand, ms: performance.now() - t0, fichiers };
}

/**
 * Géométrie vide (zéro sommet) aux attributs du contrat § G.2 : le maillage d'une unité est créé à l'init avec elle,
 * et ne dessine rien tant que son modèle n'est pas arrivé.
 */
export function geometrieVide() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(0), 1));
  return g;
}

const ATTRIBUTS = ['position', 'normal', 'color', 'aEmissive', 'piece', 'uv', 'aTex']; // uv, aTex : modèles à texture cuite

/**
 * Pose un modèle sur un maillage créé avec geometrieVide() : géométrie neuve = attributs du modèle (partagés, pas
 * copiés) + attributs d'INSTANCE du maillage actuel (aFx des InstancedMesh : le tampon que le module écrit déjà) ;
 * l'ancienne géométrie est libérée. `aussi` : autres maillages qui partagent la géométrie (silhouette du joueur).
 * Renvoie la géométrie posée.
 */
export function poser(mesh, donnees, aussi = []) {
  const ancienne = mesh.geometry;
  const src = donnees.geometry;
  const g = new THREE.BufferGeometry();
  for (const k of ATTRIBUTS) if (src.attributes[k]) g.setAttribute(k, src.attributes[k]);
  g.setIndex(src.index);
  for (const k of Object.keys(ancienne.attributes)) {
    const a = ancienne.attributes[k];
    if (a.isInstancedBufferAttribute) g.setAttribute(k, a);
  }
  if (!g.attributes.aFx && !mesh.isInstancedMesh && src.attributes.aFx) g.setAttribute('aFx', src.attributes.aFx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  mesh.geometry = g;
  for (const o of aussi) o.geometry = g;
  ancienne.dispose();
  return g;
}

/** Emprise d'une géométrie : hauteur, rayon au sol (plus grande distance horizontale à l'origine), demi-largeurs. */
export function emprise(geometry) {
  const p = geometry.attributes.position.array;
  let r2 = 0;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const d = x * x + z * z;
    if (d > r2) r2 = d;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const r = (v) => Math.round(v * 1000) / 1000;
  return { hauteur: r(y1 - Math.min(0, y0)), yMin: r(y0), rayonSol: r(Math.sqrt(r2)), x: [r(x0), r(x1)], z: [r(z0), r(z1)] };
}
