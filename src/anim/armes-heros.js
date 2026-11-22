// ANIMATIONS v2 — armes portées par le héros (retour de Femz du 13/11 : « pas naturel que le robot tire et que les
// missiles partent de son dos ; les projectiles partent de son corps »). Prototype du 13/11/2026.
//
// 1. VISÉE : quand une arme tire, le bras qui la porte se lève et pointe vers SA cible (épaule : lacet + tangage ;
//    coude tendu), lissé à ~80 ms, tenu ANIM.armes.tenue s après le dernier tir puis il redescend à la marche. Les
//    deux bras visent indépendamment : DROIT = blaster, rail ; GAUCHE = pompe, roquettes. Une cible hors de portée du
//    bras (derrière, de l'autre côté du corps) fait tourner le buste (lacet du corps, borné, lissé).
//    Les cibles sont celles que weapons.js choisit déjà : blaster = le plus proche (queryNearestN), pompe = le robot
//    du cône le plus rempli, rail = le plus solide, roquettes = le point visé du plus gros paquet (avancé).
// 2. BOUCHES : bouche(arme, out) rend la position monde (et la direction) du nœud bouche_<arme> pour la pose VISÉE
//    (bras pointé sur la cible, même si le lissage n'y est pas encore), corrigée du déplacement du héros depuis la
//    dernière pose. weapons.js fait partir projectiles, rayon du rail, plombs et roquettes de là ; un tir naît à la
//    hauteur de la bouche et rejoint sa hauteur de vol sur 1 m (BY[arme]). EMP : plastron ; orbitaux : cœur dorsal.
// 3. RECUL ET ÉCLAIR : à chaque tir, le bras recule (pompe et rail plus fort) et un éclair bref s'allume à la bouche,
//    de la couleur de l'arme ; l'impulsion EMP part du plastron ; les disques orbitaux SORTENT du dos à l'acquisition.
// 4. MODULES : un module d'arme n'apparaît que si l'arme est possédée. Si heros.glb porte des pièces arme_<arme> et des
//    nœuds bouche_<arme> (travail de l'agent Blender en cours), ils sont utilisés ; sinon des modules provisoires
//    (boîte + tube, cotes ci-dessous) sont accrochés aux os des avant-bras.
// Zéro allocation par image ; aucun flottant passé en argument (tableaux typés).
//
// INTÉGRATION :
//   - src/weapons.js (les patches exacts sont dans tests/anim/gen-weapons.mjs, appliqués au prototype) :
//       countShot(w)        → player.armeTir(w)                          (recul, éclair, EMP)
//       fireBlaster         → player.viserRobot(w, targets[0])            après « if (found === 0) return false; »
//       fireShotgun         → player.viserRobot(w, targets[best])
//       fireRail            → player.viserRobot(w, t) pour le premier rayon
//       fireRockets         → VISEE[0] = tx ; VISEE[1] = tz ; player.viserPoint(w)
//       départ de chaque projectile / rayon : if (player.bouche(w, BOUCHE) === 1) { pX = BOUCHE[0] ; pZ = BOUCHE[2] }
//       sync : hauteur des tirs  kHeight + (BY[kind] − kHeight) × max(0, 1 − pTravel)  (idem roquettes, rail : BY)
//       sync des orbitaux : position = lerp(DOS, orbite, DOS[3])
//   - src/player.js : init → armes.init(scene, heros) ; update(dt) → armes.update(dt) (fin de l'étape 7) ;
//     sync → armes.sync() APRÈS heros.sync() (la pose de l'image est faite) ; reset → armes.reset().
//   - import circulaire weapons ↔ armes-heros : `owned` est lu dans weapons.js à l'init (jamais à l'évaluation du module).
//   - clés : ANIM.armes → PLAYER.arms (tenue, lissage, recul par arme, éclair, bornes du bras, buste).
//   - CIBLES DANS LE CÔNE (décision de Femz du 13/11, ANIM.corps.ciblesDansCone = true) : weapons.js choisit les
//     cibles des armes de BRAS parmi celles du cône ±45° autour du buste (lacet lissé) : player.dansCone(i) /
//     dansConeD(D) / dansConeV(V) → 1 ou 0. Blaster : la plus proche DANS le cône passe en tête de targets (requête
//     de 32 candidats) ; pompe : le cône le plus rempli parmi les candidats du cône ; rail : le 1er rayon prend le plus
//     solide du cône ; roquettes : les paquets hors du cône sont écartés (8 demandés), ceux du cône repris s'il en
//     manque. Avant ce filtre, l'arme appelle player.viserBuste(w, i) / viserBustePoint(w) avec la cible qu'elle
//     aurait prise SANS cône : le buste tourne vers elle. Aucune cible dans le cône → player.attente(w) ;
//     return false (recharge prête, la salve part dès que le buste a tourné). Tourelles, EMP, orbitaux : non filtrés.
//     Patches exacts : filtre-* de tests/anim/gen-weapons.mjs. borner(w) reste en garde (0 tir borné mesuré).
//     Mesures : tests/anim-cone.mjs → tests/captures/anim-v3-cone.json.
//   - TOURELLES D'ÉPAULE (13/11) : nombre = max(COUNT blaster, COUNT rail) − 1 (0 à 4), déployées en
//     ANIM.armes.tourelleDeploiement s. Projectile / rayon k ≥ 1 : viserTourelle(k, robot) (ou V + viserTourellePoint(k)
//     si moins de cibles que de tirs), départ boucheTourelle(k) === 1 → B, puis tirTourelle(k, w) (recul + éclair).
//     Le k = 0 reste au bras droit. Patches exacts : cone-blaster, blaster-pompe-bouche, rail-vise, rail-bouche.
//   - pré-visée : lit weapons.fireAcc (export de weapons.js ; __fireAcc dans la copie patchée du prototype).
// INTÉGRÉ (étape « animations », ARCHITECTURE.md § Z sexies) : player.js appelle init / update / sync / reset ;
//   src/weapons.js appelle `api` (mêmes noms que crochets.armes du prototype : les patches de tests/anim/gen-weapons.mjs
//   y ont été appliqués tels quels, `__A` = api).
import * as THREE from 'three';
import { P, E, PRIO } from '../state.js';
import { EFLAG, WEAPON, WEAPON_COUNT, WEAPONS, PALETTE, STAT } from '../config.js';
import * as weapons from '../weapons.js';

// armes possédées (weapons.owned) : lues à l'init — weapons.js importe ce module, son export n'existe pas encore quand
// ce module s'évalue (import circulaire)
let owned = new Uint8Array(WEAPON_COUNT);
// 21/11 (Femz : « génère … un modèle 3D » pour les armes évoluées) : weapons.evolved[w] = id d'évolution + 1. Chaque arme
// qui peut évoluer a sa pièce arme_<nom>_evo dans le .glb de l'agent (outils/blender/armes_evo.py : même parent, même
// pivot que arme_<nom>) ; évoluée, elle prend la place de l'arme de base (échelle de l'os) et recopie sa rotation
// (poignet du marteau). Sans pièce _evo dans le modèle : rien ne change.
let evolved = new Uint8Array(WEAPON_COUNT);
import { ANIM } from './reglages.js';
import * as heros from './heros-anim.js';
import { KATANA_EV, dernierCombo } from './combos.js'; // § E5.F.13 : katana en main (saisie / rengainé) ; § E5.F.14 : poignet
import { COMBO, MARTEAU_COMBO } from '../config.js'; // § E5.F.14
import { createPaintedMaterial } from '../rendu/materiaux.js';

const A = ANIM.armes;
const NW = WEAPON_COUNT; // étape 2 (§ E2.A) : toutes les tables par arme suivent WEAPON_COUNT
const HALF_PI = Math.PI / 2;
const TWO_PI = Math.PI * 2;
// bras qui porte chaque arme : 0 = droit, 1 = gauche, -1 = corps (EMP, orbitaux)
// La monture vient de WEAPONS[w].mount = { node, arm } (config.js, région e2:A-armes-1) : node = suffixe des nœuds
// arme_<node> / bouche_<node> de heros.glb.
const BRAS = new Int8Array(NW).fill(-1);
const NOM = new Array(NW).fill('');
for (let w = 0; w < NW; w++) {
  const m = WEAPONS[w].mount;
  BRAS[w] = m ? m.arm : -1;
  NOM[w] = m ? m.node : WEAPONS[w].key;
}

// PIÈCES JUMELLES (17/11 au soir, modèles des agents : outils/blender/armes_pieces.armes_agent) : nœuds du .glb sans
// arme à eux, montrés avec une arme — un SkinnedMesh ne change pas un os de parent, d'où deux os pour le katana.
//   arme_lame_d (+ bouche_lame_d)           Shinobi : seconde lame, miroir de arme_lame sur l'avant-bras DROIT ; suit la
//                                           lame (BLADE).
//   arme_katana_main (+ bouche_katana_main) Shinobi : katana DÉGAINÉ, dans le poing droit (enfant de avant_bras_d).
// KATANA_EN_MAIN[0] (écrit par l'animation) : 0 = katana dans le DOS (arme_katana, bouche_katana) ; 1 = dégainé :
// arme_katana caché, arme_katana_main montré, bouche(KATANA) part de bouche_katana_main. Rengainé : remettre 0.
export const KATANA_EN_MAIN = new Uint8Array(1);
const POIGNET = new Float64Array([0, 0.45]); // § E5.F.14 : angle du poignet (rad), lissage par image
const JUMEAUX = [
  ['lame_d', WEAPON.BLADE, 0],
  ['katana_main', WEAPON.KATANA, 0],
];
const jumeaux = new Array(JUMEAUX.length).fill(null); // os arme_<nom>
const jumeauxEvo = new Array(JUMEAUX.length).fill(null); // os arme_<nom>_evo (21/11), ou null
const bouchesJ = new Array(JUMEAUX.length).fill(null); // bouche_<nom> (enfant de l'avant-bras du jumeau)
let boucheKatanaDos = null;
/** Bouche d'une pièce jumelle ('lame_d', 'katana_main') : Object3D enfant de l'avant-bras, ou null (modèle sans). */
export function boucheJumelle(nom) {
  const i = JUMEAUX.findIndex((j) => j[0] === nom);
  return i >= 0 ? bouchesJ[i] : null;
}

// ----- état (tableaux typés) ---------------------------------------------------------------------------------------
// par bras (k = 0 droit, 1 gauche) : cible, temps depuis le dernier tir, poids, lacet et tangage lissés, recul
const TX = new Float64Array(2);
const TZ = new Float64Array(2);
const HOLD = new Float64Array(2).fill(1e3);
const POIDS = new Float64Array(2);
const LACET = new Float64Array(2);
const TANGAGE = new Float64Array(2);
const RECUL = new Float64Array(2);
const FLASH = new Float64Array(NW).fill(1e3); // s depuis le dernier éclair, par arme
const ORDRE = new Float64Array(NW); // rang d'obtention de chaque arme (sync) : la dernière tourelle du dos s'affiche
const AVANT = new Uint8Array(NW); // possession à l'image précédente
const RANG = new Float64Array(1);
// TOURELLES D'ÉPAULE (rang 1 à 4 = tir k = 2 à 5 du blaster et du rail) : visée propre, suivi borné, déploiement
const NT = 4;
const tSocle = new Array(NT).fill(null);
const tCanon = new Array(NT).fill(null);
const tBouche = new Array(NT).fill(null);
const tBaseY = new Float64Array(NT); // hauteur du socle au repos (repère du buste)
const tTX = new Float64Array(NT);
const tTZ = new Float64Array(NT);
const tHold = new Float64Array(NT).fill(1e3);
const tLacet = new Float64Array(NT); // repère du buste
const tTangage = new Float64Array(NT);
const tDeploi = new Float64Array(NT).fill(1e3); // s depuis le début du déploiement (1e3 = déployée ou rangée)
const tVisible = new Uint8Array(NT);
// Identité des agents (22/11, Femz : « les tourelles doivent être collées aux épaulières ») : tourelle dont le socle est
// porté par un haut de bras (épaulières du Bastion solidaires du bras, outils/blender/agent_tripo.py). Elle s'incline
// avec l'épaulière ; son lacet et son tangage (calculés dans le repère du BUSTE) sont ramenés dans le repère du bras.
const tSurBras = new Uint8Array(NT);
const Q_BRAS = new THREE.Quaternion();
const V_VISEE = new THREE.Vector3();
const tRecul = new Float64Array(NT);
const tFlash = new Float64Array(NT).fill(1e3);
const tArme = new Uint8Array(NT); // arme du dernier tir (couleur de l'éclair)
const NTOUR = new Float64Array(1); // tourelles visibles
const ETAT = new Float64Array(4); // [buste, sortie des orbitaux (s), orbitaux possédés à l'image précédente, actif]
const BUSTE = 0;
const SORTIE = 1;
const ORB_AVANT = 2;
const ACT = 3;
/** Entrées / sorties partagées : ACTIF[0], B (bouche : x, y, z, dx, dy, dz), BY (hauteur de bouche par arme),
 *  V (point visé : x, z), DOS (sortie des orbitaux : x, y, z, avancement). */
export const ACTIF = new Float64Array(1);
export const B = new Float64Array(6);
export const BY = new Float64Array(NW);
export const V = new Float64Array(2);
export const DOS = new Float64Array([0, 0, 0, 1]);

// ----- objets ----------------------------------------------------------------------------------------------------
const bouches = new Array(NW).fill(null); // Object3D du nœud bouche_<arme> (enfant d'un os)
const modules = new Array(NW).fill(null); // maillage provisoire, ou os arme_<arme> du .glb
const modulesGlb = new Uint8Array(NW); // 1 = pièce du .glb (visibilité par l'échelle de son os)
const modulesEvo = new Array(NW).fill(null); // os arme_<arme>_evo du .glb (21/11), ou null
let brasOs = [null, null];
let avantOs = [null, null];
let flashes = null;
let flashAttr = null;
const flashCouleur = new Float32Array(NW * 3);
const tmpM = new THREE.Matrix4(); // créé une fois

// Modules provisoires : cotes dans le repère de l'os de l'avant-bras (origine au coude, −Y vers la main, +Z = dessus
// quand le bras vise devant). [arme, os, côté, boîte (l, h, p), centre (x, y, z), tube (rayon, longueur), bouche (x, y, z)]
const PROVISOIRES = [
  [WEAPON.BLASTER, 0, -1, [0.1, 0.26, 0.12], [-0.095, -0.2, 0.0], [0.032, 0.2], [-0.095, -0.5, 0.0]],
  [WEAPON.RAIL, 0, 0, [0.08, 0.36, 0.08], [0, -0.22, 0.1], [0.026, 0.26], [0, -0.6, 0.1]],
  [WEAPON.SHOTGUN, 1, 1, [0.11, 0.24, 0.13], [0.095, -0.2, 0.0], [0.045, 0.16], [0.095, -0.48, 0.0]],
  [WEAPON.ROCKETS, 1, 0, [0.15, 0.2, 0.11], [0, -0.2, 0.11], [0.04, 0.1], [0, -0.36, 0.11]],
];
const CORPS = [
  [WEAPON.EMP, [0, 1.27, 0.2]], // plastron
  [WEAPON.ORBITALS, [0, 1.2, -0.24]], // cœur dorsal
];

function geometrieModule(boite, centre, tube, bouche, couleurArme) {
  const parts = [];
  const lin = (hex) => new THREE.Color(hex);
  const ajoute = (g, hex, em) => {
    const n = g.attributes.position.count;
    const c = lin(hex);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(n).fill(em), 1));
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const b = new THREE.BoxGeometry(boite[0], boite[1], boite[2]);
  b.translate(centre[0], centre[1], centre[2]);
  ajoute(b, 0xede6d6, 0);
  const t = new THREE.CylinderGeometry(tube[0], tube[0], tube[1], 10);
  t.translate(bouche[0], bouche[1] + tube[1] / 2, bouche[2]);
  ajoute(t, 0x323858, 0);
  const r = new THREE.CylinderGeometry(tube[0] * 1.15, tube[0] * 1.15, 0.03, 10); // bague de bouche, couleur de l'arme
  r.translate(bouche[0], bouche[1] + 0.02, bouche[2]);
  ajoute(r, couleurArme, 1);
  const s = new THREE.BoxGeometry(0.02, boite[1] * 0.6, 0.02); // filet cyan (accent du héros)
  s.translate(centre[0] + (centre[0] >= 0 ? 1 : -1) * (boite[0] / 2 + 0.002), centre[1], centre[2] + boite[2] * 0.25);
  ajoute(s, 0x3fe0d0, 1);
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'color', 'aEmissive']) {
    const sz = parts[0].attributes[k].itemSize;
    const a = new Float32Array(n * sz);
    let o = 0;
    for (const p of parts) {
      a.set(p.attributes[k].array, o);
      o += p.attributes[k].array.length;
    }
    g.setAttribute(k, new THREE.BufferAttribute(a, sz));
  }
  g.setAttribute('aFx', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

/**
 * scene ; materiau : matériau peint du héros (le même que son SkinnedMesh : uniformes partagés, lueur du dash et
 * de l'invulnérabilité comprises). Les nœuds du .glb sont lus dans heros.donneesHeros().
 */
export function init({ scene, materiau }) {
  owned = weapons.owned;
  evolved = weapons.evolved;
  const os = heros.os;
  // Rappelé à chaque changement de modèle de l'agent (player.poserAgent, hors combat) : les os de l'ancien squelette
  // sont abandonnés avec lui ; les modules provisoires éventuels sont libérés, les éclairs (scène) réutilisés.
  for (let w = 0; w < NW; w++) {
    const m = modules[w];
    if (m && !modulesGlb[w] && m.isMesh) {
      m.removeFromParent();
      m.geometry.dispose();
      if (m.customDepthMaterial) m.customDepthMaterial.dispose();
    }
  }
  modules.fill(null);
  modulesGlb.fill(0);
  modulesEvo.fill(null);
  jumeauxEvo.fill(null);
  bouches.fill(null);
  tSocle.fill(null);
  tCanon.fill(null);
  tBouche.fill(null);
  brasOs = [os('bras_d'), os('bras_g')];
  avantOs = [os('avant_bras_d'), os('avant_bras_g')];
  for (const b of brasOs) if (b) b.rotation.order = 'YXZ';
  const d = heros.donneesHeros();
  const pivot = (nom) => {
    const p = d.pieces.find((x) => x.nom === nom);
    return p ? p.pivot : [0, 0, 0];
  };
  // 1. pièces et nœuds du .glb, s'ils existent
  for (let w = 0; w < NW; w++) {
    const arme = os('arme_' + NOM[w]);
    if (arme) {
      modules[w] = arme;
      modulesGlb[w] = 1;
      modulesEvo[w] = os('arme_' + NOM[w] + '_evo');
      if (modulesEvo[w]) modulesEvo[w].scale.setScalar(1e-4);
    }
    const v = d.vides['bouche_' + NOM[w]];
    if (v) {
      // arme de bras : la bouche suit l'avant-bras ; arme de corps qui a sa pièce (sentinelle, à la ceinture) : la
      // bouche suit cette pièce ; sinon (EMP, orbitaux) le buste
      const parentNom = BRAS[w] === 0 ? 'avant_bras_d' : BRAS[w] === 1 ? 'avant_bras_g' : arme ? 'arme_' + NOM[w] : null;
      const parent = parentNom ? os(parentNom) : os(null);
      const pv = parentNom ? pivot(parentNom) : [0, 0, 0];
      const o = new THREE.Object3D();
      o.name = 'bouche_' + NOM[w];
      o.position.set(v.position[0] - pv[0], v.position[1] - pv[1], v.position[2] - pv[2]);
      parent.add(o);
      bouches[w] = o;
    }
  }
  // 1 ter. pièces jumelles (lame droite, katana en main) : cachées tant que sync ne les montre pas
  for (let i = 0; i < JUMEAUX.length; i++) {
    const [nom, , k] = JUMEAUX[i];
    jumeaux[i] = os('arme_' + nom);
    jumeauxEvo[i] = os('arme_' + nom + '_evo');
    if (jumeauxEvo[i]) jumeauxEvo[i].scale.setScalar(1e-4);
    bouchesJ[i] = null;
    if (!jumeaux[i]) continue;
    jumeaux[i].scale.setScalar(1e-4);
    const v = d.vides['bouche_' + nom];
    const avant = k === 0 ? 'avant_bras_d' : 'avant_bras_g';
    if (!v || !os(avant)) continue;
    const pv = pivot(avant);
    const o = new THREE.Object3D();
    o.name = 'bouche_' + nom;
    o.position.set(v.position[0] - pv[0], v.position[1] - pv[1], v.position[2] - pv[2]);
    os(avant).add(o);
    bouchesJ[i] = o;
  }
  // 1 bis. tourelles d'épaule du .glb (socle → canon → bouche_tourelle_n)
  for (let n = 0; n < NT; n++) {
    tSocle[n] = os(`tourelle_${n + 1}_socle`);
    tCanon[n] = os(`tourelle_${n + 1}_canon`);
    if (!tSocle[n] || !tCanon[n]) continue;
    tSocle[n].rotation.order = 'YXZ';
    tSurBras[n] = tSocle[n].parent && /^bras_/.test(tSocle[n].parent.name) ? 1 : 0;
    tBaseY[n] = tSocle[n].position.y;
    const v = d.vides[`bouche_tourelle_${n + 1}`];
    const pv = pivot(`tourelle_${n + 1}_canon`);
    const o = new THREE.Object3D();
    o.name = `bouche_tourelle_${n + 1}`;
    if (v) o.position.set(v.position[0] - pv[0], v.position[1] - pv[1], v.position[2] - pv[2]);
    else o.position.set(0, 0, 0.1);
    tCanon[n].add(o);
    tBouche[n] = o;
    tSocle[n].scale.set(1e-4, 1e-4, 1e-4);
  }
  // 2. modules provisoires (si le .glb ne les porte pas encore)
  for (const [w, k, , boite, centre, tube, bouche] of PROVISOIRES) {
    const parent = avantOs[k];
    if (!parent) continue;
    if (!modules[w]) {
      const m = new THREE.Mesh(geometrieModule(boite, centre, tube, bouche, PALETTE.weapon[w]), materiau);
      m.name = 'arme-' + NOM[w];
      m.castShadow = true;
      m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      m.frustumCulled = false;
      m.visible = false;
      parent.add(m);
      modules[w] = m;
    }
    if (!bouches[w]) {
      const o = new THREE.Object3D();
      o.name = 'bouche_' + NOM[w];
      o.position.set(bouche[0], bouche[1], bouche[2]);
      parent.add(o);
      bouches[w] = o;
    }
  }
  for (const [w, p] of CORPS) {
    if (bouches[w]) continue;
    const o = new THREE.Object3D();
    o.name = 'bouche_' + NOM[w];
    o.position.set(p[0], p[1], p[2]);
    os(null).add(o);
    bouches[w] = o;
  }
  boucheKatanaDos = bouches[WEAPON.KATANA]; // après les bouches de repli (CORPS) : jamais null si le katana en a une
  // 3. éclairs de bouche : une instance par arme, additive, de la couleur de l'arme (créés une fois)
  if (flashes !== null) {
    flashes.count = 0;
    reset();
    return;
  }
  const g = new THREE.IcosahedronGeometry(1, 1);
  flashAttr = new THREE.InstancedBufferAttribute(new Float32Array((NW + NT) * 4), 4);
  flashAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aFlash', flashAttr);
  const mat = new THREE.ShaderMaterial({
    vertexShader: `attribute vec4 aFlash; varying vec4 vF; varying vec3 vN;
      void main() { vF = aFlash; vN = normalize( normalMatrix * mat3( instanceMatrix ) * normal );
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: `varying vec4 vF; varying vec3 vN;
      void main() { float c = pow( abs( vN.z ), 1.5 ); gl_FragColor = vec4( vF.rgb * vF.a * ( 0.35 + 1.4 * c ), 1.0 ); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  flashes = new THREE.InstancedMesh(g, mat, NW + NT);
  flashes.name = 'joueur-v2-eclairs';
  flashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flashes.frustumCulled = false;
  flashes.count = 0;
  flashes.renderOrder = 3;
  scene.add(flashes);
  for (let w = 0; w < NW; w++) {
    const c = new THREE.Color(PALETTE.weapon[w]);
    flashCouleur[w * 3] = c.r;
    flashCouleur[w * 3 + 1] = c.g;
    flashCouleur[w * 3 + 2] = c.b;
  }
  reset();
}

export function reset() {
  HOLD.fill(1e3);
  POIDS.fill(0);
  RECUL.fill(0);
  FLASH.fill(1e3);
  ETAT[BUSTE] = 0;
  ETAT[SORTIE] = 1e3;
  ETAT[ORB_AVANT] = owned[WEAPON.ORBITALS];
  DOS[3] = 1;
  heros.visee.fill(0);
}

// ----- API appelée par weapons.js (au moment du tir) ---------------------------------------------------------------
/** Le bras de l'arme w vise le robot d'indice i (aucun flottant en argument). */
export function viserRobot(w, i) {
  const k = BRAS[w];
  if (k < 0 || !(i >= 0)) return;
  TX[k] = E.x[i];
  TZ[k] = E.z[i];
  HOLD[k] = 0;
  WX[w] = TX[k];
  WZ[w] = TZ[k];
  WHOLD[w] = 0;
}
/** Le bras de l'arme w vise le point V[0], V[1]. */
export function viserPoint(w) {
  const k = BRAS[w];
  if (k < 0) return;
  TX[k] = V[0];
  TZ[k] = V[1];
  HOLD[k] = 0;
  WX[w] = TX[k];
  WZ[w] = TZ[k];
  WHOLD[w] = 0;
}
/** Un tir de l'arme w vient de partir : recul du bras, éclair. */
export const tirs = new Int32Array(NW); // tirs par arme depuis le chargement (mesures)
export function tir(w) {
  tirs[w]++;
  FLASH[w] = 0;
  const k = BRAS[w];
  if (k >= 0) RECUL[k] += A.recul[w];
}

// cibles par arme (priorité du buste : rail > roquettes > pompe > blaster ; EMP et orbitaux ne visent pas)
const WX = new Float64Array(NW);
const WZ = new Float64Array(NW);
const WHOLD = new Float64Array(NW).fill(1e3);
const PRIORITE = [WEAPON.RAIL, WEAPON.ROCKETS, WEAPON.SHOTGUN, WEAPON.BLASTER, WEAPON.BLADE, WEAPON.RICOCHET];
const CONE = ANIM.corps.cone;
/** Mesures : tirs passés par le cône du buste, et tirs dont la direction a été ramenée au bord du cône, par arme. */
export const cone = { tirs: new Int32Array(NW), bornes: new Int32Array(NW), attentes: new Int32Array(NW) };

// ----- API des tourelles (weapons.js, tirs k ≥ 2 du blaster et du rail ; k = rang + 1) -----------------------------
/** La tourelle du tir k (k = 1 à 4 en index de projectile : 2e à 5e tir) vise le robot i. */
export function viserTourelle(k, i) {
  const n = k - 1;
  if (n < 0 || n >= NT || !(i >= 0)) return;
  tTX[n] = E.x[i];
  tTZ[n] = E.z[i];
  tHold[n] = 0;
}
/** La tourelle du tir k vise le point V. */
export function viserTourellePoint(k) {
  const n = k - 1;
  if (n < 0 || n >= NT) return;
  tTX[n] = V[0];
  tTZ[n] = V[1];
  tHold[n] = 0;
}
/** Tir de la tourelle du tir k (arme w) : recul, éclair. */
export function tirTourelle(k, w) {
  const n = k - 1;
  if (n < 0 || n >= NT) return;
  tRecul[n] = A.tourelleRecul;
  tFlash[n] = 0;
  tArme[n] = w;
}
/**
 * Bouche de la tourelle du tir k en monde (out : position, direction), pour la pose VISÉE (canon pointé sur sa cible).
 * Renvoie 1 si la tourelle est visible et le prototype actif, sinon 0 (weapons.js garde le départ du bras / centre).
 */
export function boucheTourelle(k, out) {
  const n = k - 1;
  if (ACTIF[0] !== 1 || n < 0 || n >= NT || tVisible[n] === 0 || !tBouche[n]) return 0;
  const so = tSocle[n];
  const ca = tCanon[n];
  const ly = so.rotation.y;
  const lx = ca.rotation.x;
  desirTourelle(n);
  so.rotation.y = DT[0];
  ca.rotation.x = DT[1];
  so.updateMatrixWorld(true);
  const mesh = heros.getMesh();
  const e = tBouche[n].matrixWorld.elements;
  out[0] = e[12] + P.x - mesh.position.x;
  out[1] = e[13];
  out[2] = e[14] + P.z - mesh.position.z;
  const l = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]) || 1;
  out[3] = e[8] / l; // +Z local du canon
  out[4] = e[9] / l;
  out[5] = e[10] / l;
  so.rotation.y = ly;
  ca.rotation.x = lx;
  so.updateMatrixWorld(true);
  return 1;
}
const DT = new Float64Array(2); // lacet (repère du buste) et tangage désirés d'une tourelle
function desirTourelle(n) {
  const yb = heros.corps[1];
  const e = tSocle[n].matrixWorld.elements;
  const dx = tTX[n] - e[12];
  const dz = tTZ[n] - e[14];
  let a = Math.atan2(dx, dz) - yb;
  a -= Math.round(a / TWO_PI) * TWO_PI;
  DT[0] = tHold[n] < A.tourelleTenue ? a : 0;
  const d = Math.sqrt(dx * dx + dz * dz);
  DT[1] = tHold[n] < A.tourelleTenue ? Math.atan2(e[13] - A.hauteurCible, d > 0.5 ? d : 0.5) : 0; // + = vers le bas
}
/** Nombre de tourelles visibles : max(projectiles du blaster, rayons du rail) − 1, armes possédées seulement. */
function tourellesVoulues() {
  let m = 1;
  if (owned[WEAPON.BLASTER] === 1) {
    const c = Math.round(weapons.getStat(WEAPON.BLASTER, STAT.COUNT));
    if (c > m) m = c;
  }
  if (owned[WEAPON.RAIL] === 1) {
    const c = Math.round(weapons.getStat(WEAPON.RAIL, STAT.COUNT));
    if (c > m) m = c;
  }
  return m - 1 > NT ? NT : m - 1;
}

// lacet désiré du bras k vers sa cible, dans le repère du BUSTE (heros.corps[1] = lacet monde du buste), et tangage
const DES = new Float64Array(4); // [lacet bras 0, lacet bras 1, tangage 0, tangage 1]
function desirs() {
  const yb = heros.corps[1];
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? -1 : 1;
    const c = Math.cos(yb);
    const s = Math.sin(yb);
    // épaule ≈ (±0,31 ; 1,39 ; 0) repère du corps
    const ex = P.x + side * 0.31 * c;
    const ez = P.z - side * 0.31 * s;
    const dx = TX[k] - ex;
    const dz = TZ[k] - ez;
    let a = Math.atan2(dx, dz) - yb;
    a -= Math.round(a / TWO_PI) * TWO_PI;
    DES[k] = a;
    const d = Math.sqrt(dx * dx + dz * dz);
    DES[2 + k] = Math.atan2(A.hauteurCible - 1.39, d > 0.5 ? d : 0.5);
  }
}

// pré-visée : un tir est imminent quand la recharge de l'arme sera pleine dans moins de A.preVisee s ; le bras se lève
// alors vers le robot le plus proche à portée (la cible exacte arrive avec le tir et corrige la visée)
const PORTEE2 = new Float64Array(NW);
function preVisee() {
  const acc = weapons.fireAcc || weapons.__fireAcc; // jeu : export de weapons.js ; prototype : copie patchée
  if (!acc) return;
  for (let w = 0; w < NW; w++) {
    const k = BRAS[w];
    if (k < 0 || owned[w] !== 1) continue;
    const rate = weapons.getStat(w, STAT.RATE);
    const reste = rate > 0 ? (1 - acc[w]) / rate : 1e9;
    // le BUSTE se tourne plus tôt (il a plus de chemin à faire que le bras) : A.preViseeBuste ; le bras : A.preVisee
    if (!(reste <= A.preViseeBuste)) continue;
    const brasAussi = reste <= A.preVisee;
    const r = WEAPONS[w].range || weapons.getStat(w, STAT.AREA); // ricochet : portée fixe (sa stat « zone » est le saut)
    PORTEE2[w] = r * r;
    let best = -1;
    let bd = PORTEE2[w];
    let bestCone = -1; // le bras ne vise que dans le cône : la plus proche DANS le cône (ciblesDansCone)
    let bdc = PORTEE2[w];
    const filtre = ANIM.corps.ciblesDansCone;
    for (let i = 0; i < E.count; i++) {
      if (E.alive[i] === 0) continue;
      const dx = E.x[i] - P.x;
      const dz = E.z[i] - P.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) {
        bd = d2;
        best = i;
      }
      if (filtre && d2 < bdc && dansCone(i) === 1) {
        bdc = d2;
        bestCone = i;
      }
    }
    // cible prioritaire à portée (§ E1.D : drone-bouclier du boss) : blaster, rail et roquettes la visent avant toute
    // autre (weapons.js) ; le buste et le bras se tournent donc vers elle, pas vers le robot le plus proche
    if (PRIO[0] > 0 && (w === WEAPON.BLASTER || w === WEAPON.RAIL || w === WEAPON.ROCKETS)) {
      const p = prioritaire(w);
      if (p >= 0) {
        best = p;
        if (filtre && dansCone(p) === 1) bestCone = p;
      }
    }
    if (best >= 0 && WHOLD[w] > 0.05) {
      WX[w] = E.x[best];
      WZ[w] = E.z[best];
      WHOLD[w] = 0;
    }
    const bras = filtre ? bestCone : best;
    if (bras >= 0 && brasAussi && HOLD[k] > 0.05) {
      TX[k] = E.x[bras];
      TZ[k] = E.z[bras];
      HOLD[k] = 0;
    }
  }
}

/** Robot EFLAG.PRIORITY en vie le plus proche du héros, à portée de l'arme w (PORTEE2[w]) ; −1 sinon (§ E1.D). */
function prioritaire(w) {
  const n = PRIO[0];
  let best = -1;
  let bd = PORTEE2[w];
  for (let q = 1; q <= n; q++) {
    const i = PRIO[q];
    if (i >= E.count || E.alive[i] === 0 || (E.flags[i] & EFLAG.PRIORITY) === 0) continue;
    const dx = E.x[i] - P.x;
    const dz = E.z[i] - P.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) {
      bd = d2;
      best = i;
    }
  }
  return best;
}

// pré-visée des tourelles : quand un tir du blaster est imminent, la tourelle n vise le (n + 2)-ième robot le plus proche
// (le blaster vise les N plus proches, un par projectile : c'est la cible que weapons.js lui attribuera)
const PROCHES = new Int32Array(NT + 1);
const PROCHES_D = new Float64Array(NT + 1);
function procheTourelle(i, m) {
  const dx = E.x[i] - P.x;
  const dz = E.z[i] - P.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= PROCHES_D[m - 1]) return;
  let q = m - 1;
  while (q > 0 && PROCHES_D[q - 1] > d2) {
    PROCHES_D[q] = PROCHES_D[q - 1];
    PROCHES[q] = PROCHES[q - 1];
    q--;
  }
  PROCHES_D[q] = d2;
  PROCHES[q] = i;
}

function preViseeTourelles(voulues) {
  const acc = weapons.fireAcc || weapons.__fireAcc;
  if (!acc || owned[WEAPON.BLASTER] !== 1) return;
  const rate = weapons.getStat(WEAPON.BLASTER, STAT.RATE);
  if (!(rate > 0) || (1 - acc[WEAPON.BLASTER]) / rate > A.preVisee) return;
  const r = weapons.getStat(WEAPON.BLASTER, STAT.AREA);
  const m = voulues + 1;
  for (let q = 0; q < m; q++) {
    PROCHES[q] = -1;
    PROCHES_D[q] = r * r;
  }
  // corps de boucle dans une fonction appelée PAR ROBOT (§ Z nonies) : preViseeTourelles ne part que dans la fenêtre de
  // pré-visée, V8 la laisse longtemps en code de base, où chaque flottant de la boucle sur 400 robots était emballé
  // (383 o/image relevés en charge maximale après 60 s) ; procheTourelle, appelée des centaines de fois, est optimisée
  // tout de suite et l'appelant ne manie plus que des entiers
  const A_ = E.alive;
  const SU_ = E.sus;
  for (let i = 0; i < E.count; i++) if (A_[i] === 1 && SU_[i] === 0) procheTourelle(i, m); // § E4.F : ni repli ni garé
  for (let n = 0; n < voulues; n++) {
    const i = PROCHES[n + 1];
    if (i >= 0 && tHold[n] > 0.05) {
      tTX[n] = E.x[i];
      tTZ[n] = E.z[i];
      tHold[n] = 0;
    }
  }
}

/** Pas de simulation (après player.update) : poids, lacets lissés, buste, recul, éclairs, sortie des orbitaux. */
export function update(dt) {
  if (!(dt > 0) || brasOs[0] === null) return;
  PAS[0]++;
  if (A.preVisee > 0 && P.alive) preVisee();
  desirs();
  const up = 1 - Math.exp(-dt / A.lissage);
  const down = 1 - Math.exp(-dt / A.retour);
  // les bras visent dans le cône frontal du buste (±ANIM.corps.cone) ; c'est le BUSTE qui tourne vers la cible
  // prioritaire (heros-anim, viseeBuste), et le bassin suit au-delà de la torsion permise
  const enDash = P.dashT > 0;
  for (let k = 0; k < 2; k++) {
    HOLD[k] += dt;
    const target = HOLD[k] < A.tenue && !enDash ? 1 : 0; // on ne vise pas en dashant
    POIDS[k] += (target - POIDS[k]) * (target > POIDS[k] ? up : down);
    RECUL[k] *= Math.exp(-dt / A.reculRetour);
    let a = DES[k];
    a = a < -CONE ? -CONE : a > CONE ? CONE : a;
    let d = a - LACET[k];
    d -= Math.round(d / TWO_PI) * TWO_PI;
    LACET[k] += d * up;
    TANGAGE[k] += (DES[2 + k] - TANGAGE[k]) * up;
  }
  ETAT[BUSTE] = 0;
  const vb = heros.viseeBuste;
  vb[0] = 0;
  for (let w = 0; w < NW; w++) WHOLD[w] += dt;
  if (ACTIF[0] === 1)
    for (let q = 0; q < PRIORITE.length; q++) {
      const w = PRIORITE[q];
      if (owned[w] !== 1 || WHOLD[w] >= A.tenue) continue;
      vb[0] = 1;
      vb[1] = Math.atan2(WX[w] - P.x, WZ[w] - P.z);
      break;
    }
  for (let w = 0; w < NW; w++) FLASH[w] += dt;
  // tourelles : nombre voulu (déploiement des nouvelles), pré-visée (k-ième robot le plus proche), suivi borné
  const voulues = ACTIF[0] === 1 && P.alive ? tourellesVoulues() : 0;
  NTOUR[0] = voulues;
  for (let n = 0; n < NT; n++) {
    if (!tSocle[n]) continue;
    const vis = n < voulues ? 1 : 0;
    if (vis === 1 && tVisible[n] === 0) tDeploi[n] = 0;
    tVisible[n] = vis;
    tDeploi[n] += dt;
    tHold[n] += dt;
    tFlash[n] += dt;
    tRecul[n] *= Math.exp(-dt / 0.08);
    if (vis === 0) continue;
    desirTourelle(n);
    const k = 1 - Math.exp(-dt / A.tourelleLissage);
    const vmax = A.tourelleVitesse * dt;
    let d = DT[0] - tLacet[n];
    d -= Math.round(d / TWO_PI) * TWO_PI;
    let pas = d * k;
    pas = pas > vmax ? vmax : pas < -vmax ? -vmax : pas;
    tLacet[n] += pas;
    tLacet[n] -= Math.round(tLacet[n] / TWO_PI) * TWO_PI;
    let dp = (DT[1] - tTangage[n]) * k;
    dp = dp > vmax ? vmax : dp < -vmax ? -vmax : dp;
    tTangage[n] += dp;
  }
  if (A.preVisee > 0 && P.alive && voulues > 0) preViseeTourelles(voulues);
  // orbitaux : à l'acquisition, les disques sortent du dos
  const o = owned[WEAPON.ORBITALS];
  if (o === 1 && ETAT[ORB_AVANT] === 0) ETAT[SORTIE] = 0;
  ETAT[ORB_AVANT] = o;
  ETAT[SORTIE] += dt;
  // visée transmise à heros-anim : [poids, lacet, tangage, recul] × 2, buste
  const v = heros.visee;
  const on = ACTIF[0] === 1 ? 1 : 0;
  v[0] = POIDS[0] * on;
  v[1] = LACET[0];
  v[2] = TANGAGE[0];
  v[3] = RECUL[0];
  v[4] = POIDS[1] * on;
  v[5] = LACET[1];
  v[6] = TANGAGE[1];
  v[7] = RECUL[1];
  v[8] = ETAT[BUSTE] * on;
}

/**
 * Bouche de l'arme w en monde : out[0..2] = position, out[3..5] = direction du canon. Pour une arme de bras : la pose
 * VISÉE (bras pointé sur la cible courante), corrigée du déplacement du héros depuis la dernière pose dessinée.
 * Renvoie 1 si le prototype est actif (sinon 0 : weapons.js garde son départ « centre + direction × muzzle »).
 */
const CACHE = new Float64Array(NW * 7); // [pas, x, y, z, dx, dy, dz] : une salve = un calcul (tous ses projectiles)
const PAS = new Float64Array(1); // numéro du pas de simulation (update)
export function bouche(w, out) {
  const m = bouches[w];
  if (ACTIF[0] !== 1 || m === null) return 0;
  const c = w * 7;
  if (CACHE[c] === PAS[0] && HOLD[BRAS[w] >= 0 ? BRAS[w] : 0] === 0) {
    for (let i = 0; i < 6; i++) out[i] = CACHE[c + 1 + i];
    return 1;
  }
  const k = BRAS[w];
  const mesh = heros.getMesh();
  const dx = P.x - mesh.position.x;
  const dz = P.z - mesh.position.z;
  if (k >= 0) {
    desirs();
    const a = brasOs[k];
    const f = avantOs[k];
    const sx = a.rotation.x;
    const sy = a.rotation.y;
    const sz = a.rotation.z;
    const fx = f.rotation.x;
    const fy = f.rotation.y;
    let lacet = DES[k];
    lacet = lacet < -CONE ? -CONE : lacet > CONE ? CONE : lacet; // dans le cône du buste
    a.rotation.set(-HALF_PI - DES[2 + k], lacet, 0);
    f.rotation.x = 0;
    f.rotation.y = k === 0 ? HALF_PI : -HALF_PI; // pronation de la pose visée (voir heros-anim)
    a.updateMatrixWorld(true);
    ecrire(m, out, dx, dz);
    a.rotation.set(sx, sy, sz);
    f.rotation.x = fx;
    f.rotation.y = fy;
    a.updateMatrixWorld(true);
  } else ecrire(m, out, dx, dz);
  BY[w] = out[1];
  CACHE[c] = PAS[0];
  for (let i = 0; i < 6; i++) CACHE[c + 1 + i] = out[i];
  DERNIERE[w * 3] = out[0] - P.x;
  DERNIERE[w * 3 + 1] = out[1];
  DERNIERE[w * 3 + 2] = out[2] - P.z;
  return 1;
}
const DERNIERE = new Float64Array(NW * 3);
/**
 * § E5.F.13 : bouche DESSINÉE d'une pièce jumelle i (0 lame droite, 1 katana en main) — position monde de la pose
 * affichée (pas la pose visée), corrigée du déplacement du héros depuis cette pose. 0 si absente ou prototype éteint.
 */
export function boucheJ(i, out) {
  const m = bouchesJ[i];
  if (ACTIF[0] !== 1 || m === null || jumeaux[i] === null || !(jumeaux[i].scale.x > 0.5)) return 0;
  const mesh = heros.getMesh();
  ecrire(m, out, P.x - mesh.position.x, P.z - mesh.position.z);
  return 1;
}

/**
 * Cône du buste : la direction D (x, z) d'un tir de l'arme w est ramenée au bord du cône ±ANIM.corps.cone autour de la
 * visée du buste si elle en sort. Renvoie 1 si elle a été modifiée. CHOIX (demande de Femz, deux armes qui visent des
 * cibles opposées) : le buste suit l'arme prioritaire ; l'autre bras ne tire jamais dans le dos du buste — son tir part
 * vers l'avant du cône (il peut manquer sa cible). Mesuré : part des tirs bornés (tests/anim-buste.mjs).
 */
export function borner(w, D) {
  if (ACTIF[0] !== 1 || BRAS[w] < 0) return 0;
  cone.tirs[w]++;
  const yb = heros.corps[1];
  let a = Math.atan2(D[0], D[1]) - yb;
  a -= Math.round(a / TWO_PI) * TWO_PI;
  if (a <= CONE && a >= -CONE) return 0;
  cone.bornes[w]++;
  const b = yb + (a > 0 ? CONE : -CONE);
  D[0] = Math.sin(b);
  D[1] = Math.cos(b);
  return 1;
} // dernière bouche rendue, relative au héros (mesures)

// ----- Cibles DANS le cône (décision de Femz du 13/11, ANIM.corps.ciblesDansCone) -----------------------------------
// weapons.js filtre les cibles des armes de bras (blaster 1er tir, pompe, rail 1er rayon, roquettes) par le cône du
// buste ; le BUSTE, lui, suit la cible que l'arme aurait choisie sans cône (viserBuste), donc il tourne vers elle et la
// salve part dès qu'une cible entre dans le cône. Tourelles, EMP, orbitaux : non concernés.
/** 1 si le robot i est dans le cône ±ANIM.corps.cone autour du lacet (lissé) du buste ; toujours 1 hors prototype. */
export function dansCone(i) {
  if (ACTIF[0] !== 1) return 1;
  let a = Math.atan2(E.x[i] - P.x, E.z[i] - P.z) - heros.corps[1];
  a -= Math.round(a / TWO_PI) * TWO_PI;
  return a <= CONE && a >= -CONE ? 1 : 0;
}
/** Idem pour la direction D (x, z). */
export function dansConeD(D) {
  if (ACTIF[0] !== 1) return 1;
  let a = Math.atan2(D[0], D[1]) - heros.corps[1];
  a -= Math.round(a / TWO_PI) * TWO_PI;
  return a <= CONE && a >= -CONE ? 1 : 0;
}
/** Idem pour le point V (x, z) vu depuis le héros. */
export function dansConeV(V) {
  if (ACTIF[0] !== 1) return 1;
  let a = Math.atan2(V[0] - P.x, V[1] - P.z) - heros.corps[1];
  a -= Math.round(a / TWO_PI) * TWO_PI;
  return a <= CONE && a >= -CONE ? 1 : 0;
}
/** Le BUSTE veut se tourner vers le robot i pour l'arme w (cible choisie sans cône) ; le bras n'est pas touché. */
export function viserBuste(w, i) {
  if (!(i >= 0)) return;
  WX[w] = E.x[i];
  WZ[w] = E.z[i];
  WHOLD[w] = 0;
}
/** Idem vers le point V[0], V[1]. */
export function viserBustePoint(w) {
  WX[w] = V[0];
  WZ[w] = V[1];
  WHOLD[w] = 0;
}
/** Une salve de w est prête mais n'a aucune cible dans le cône : elle attend (une image comptée). */
export function attente(w) {
  cone.attentes[w]++;
}

function ecrire(m, out, dx, dz) {
  const e = m.matrixWorld.elements;
  out[0] = e[12] + dx;
  out[1] = e[13];
  out[2] = e[14] + dz;
  // direction du canon : −Y local de l'os porteur (vers la main)
  const l = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]) || 1;
  out[3] = -e[4] / l;
  out[4] = -e[5] / l;
  out[5] = -e[6] / l;
}

/** Après heros.sync : modules possédés, éclairs, point de sortie des orbitaux. */
export function sync() {
  if (brasOs[0] === null) return;
  const on = ACTIF[0] === 1 && P.alive;
  // Femz (17/11) : sentinelle et grosse tourelle se portent au même endroit (entre les omoplates) : une seule à la
  // fois, la DERNIÈRE obtenue. Rang d'obtention = compteur au passage de « non possédée » à « possédée ».
  for (let w = 0; w < NW; w++) {
    if (owned[w] === 1 && AVANT[w] === 0) ORDRE[w] = ++RANG[0];
    AVANT[w] = owned[w];
  }
  const cache = owned[WEAPON.TURRET] === 1 && owned[WEAPON.CANNON] === 1
    ? (ORDRE[WEAPON.TURRET] > ORDRE[WEAPON.CANNON] ? WEAPON.CANNON : WEAPON.TURRET) : -1;
  // § E5.F.13 : saisie / rengainé écrits par le combo du katana (combos.KATANA_EV : +1, −1 ; 0 = rien de neuf)
  if (KATANA_EV[0] !== 0) {
    KATANA_EN_MAIN[0] = KATANA_EV[0] > 0 ? 1 : 0;
    KATANA_EV[0] = 0;
  }
  const enMain = KATANA_EN_MAIN[0] === 1 && jumeaux[1] !== null; // katana dégainé (pièce jumelle présente)
  heros.IDLE_MARTEAU[0] = on && owned[WEAPON.HAMMER] === 1 ? 1 : 0; // § E5.F.13 : il tient le marteau → Great Sword Idle
  // § E5.F.14 (Femz, 18/11 : « fixe la tête du marteau, on dirait qu'elle flotte sur sa rotation ») : tenu comme au repos
  // (manche à 75° de l'avant-bras, vers l'avant), le marteau restait figé sur le poing pendant les coups — la tête
  // tournait autour de l'avant-bras, en retard ou à côté de l'arc du coup. Pendant le combo, le POIGNET casse : le manche
  // passe dans le prolongement du bras (rotation de arme_marteau autour du poing, son pivot), la tête mène l'arc ; mêlé
  // par le poids du geste, lissé.
  const mh = modules[WEAPON.HAMMER];
  if (mh !== null && modulesGlb[WEAPON.HAMMER] === 1) {
    const cible = dernierCombo() === COMBO.HAMMER ? heros.geste[0] * MARTEAU_COMBO.poignet : 0;
    POIGNET[0] += (cible - POIGNET[0]) * POIGNET[1];
    mh.rotation.x = POIGNET[0];
  }
  for (let w = 0; w < NW; w++) {
    const m = modules[w];
    if (m === null) continue;
    const vis = on && owned[w] === 1 && w !== cache && !(enMain && w === WEAPON.KATANA);
    const me = modulesEvo[w];
    const ev = me !== null && evolved[w] > 0; // 21/11 : la pièce évoluée remplace l'arme de base
    if (modulesGlb[w] === 1) m.scale.setScalar(vis && !ev ? 1 : 1e-4);
    else m.visible = vis;
    if (me !== null) {
      me.scale.setScalar(vis && ev ? 1 : 1e-4);
      me.quaternion.copy(m.quaternion);
    }
  }
  for (let i = 0; i < JUMEAUX.length; i++) {
    const j = jumeaux[i];
    if (j === null) continue;
    const w = JUMEAUX[i][1];
    const visJ = on && owned[w] === 1 && (w !== WEAPON.KATANA || enMain);
    const je = jumeauxEvo[i];
    const evJ = je !== null && evolved[w] > 0;
    j.scale.setScalar(visJ && !evJ ? 1 : 1e-4);
    if (je !== null) {
      je.scale.setScalar(visJ && evJ ? 1 : 1e-4);
      je.quaternion.copy(j.quaternion);
    }
  }
  bouches[WEAPON.KATANA] = enMain && bouchesJ[1] !== null ? bouchesJ[1] : boucheKatanaDos;
  // tourelles : pose (lacet sur le socle, tangage sur le canon, recul), déploiement (montée + un tour), rangement
  for (let n = 0; n < NT; n++) {
    const so = tSocle[n];
    if (!so) continue;
    const vis = on && tVisible[n] === 1;
    let u = vis ? (tDeploi[n] < A.tourelleDeploiement ? tDeploi[n] / A.tourelleDeploiement : 1) : 0;
    u = u * u * (3 - 2 * u);
    const sc = vis ? 1e-4 + (1 - 1e-4) * u : 1e-4;
    so.scale.x = sc;
    so.scale.y = sc;
    so.scale.z = sc;
    so.position.y = tBaseY[n] - 0.12 * (1 - u);
    if (tSurBras[n] === 1) {
      // direction de visée (repère du buste) exprimée dans le repère du bras (parent direct du socle, enfant du buste)
      Q_BRAS.copy(so.parent.quaternion).invert();
      V_VISEE.set(Math.sin(tLacet[n]), 0, Math.cos(tLacet[n])).applyQuaternion(Q_BRAS);
      so.rotation.y = Math.atan2(V_VISEE.x, V_VISEE.z) + (1 - u) * TWO_PI;
      tCanon[n].rotation.x = tTangage[n] - Math.asin(V_VISEE.y < -1 ? -1 : V_VISEE.y > 1 ? 1 : V_VISEE.y); // + = vers le bas
    } else {
      so.rotation.y = tLacet[n] + (1 - u) * TWO_PI;
      tCanon[n].rotation.x = tTangage[n];
    }
    tCanon[n].position.z = -tRecul[n];
  }
  // orbitaux : point de sortie (cœur dorsal) et avancement
  const d = bouches[WEAPON.ORBITALS];
  if (on && d !== null && ETAT[SORTIE] < A.sortieOrbitaux) {
    const e = d.matrixWorld.elements;
    DOS[0] = e[12];
    DOS[1] = e[13];
    DOS[2] = e[14];
    const u = ETAT[SORTIE] / A.sortieOrbitaux;
    DOS[3] = 1 - (1 - u) * (1 - u) * (1 - u); // sortie rapide, arrivée douce
  } else DOS[3] = 1;
  // éclairs
  let n = 0;
  if (on) {
    const arr = flashes.instanceMatrix.array;
    const fa = flashAttr.array;
    for (let w = 0; w < NW; w++) {
      const emp = w === WEAPON.EMP;
      const vie = emp ? A.eclairEmp : A.eclair;
      const t = FLASH[w];
      const m = bouches[w];
      if (t >= vie || m === null || w === WEAPON.ORBITALS) continue;
      if (emp && weapons.EMP_STYLE[0] !== 0) continue; // § E5.EMP : rien au plastron dans les variantes du champ
      const u = t / vie;
      const e = m.matrixWorld.elements;
      const sc = (emp ? A.tailleEmp : A.taille[w]) * (0.7 + (emp ? 2.2 : 0.8) * u);
      const o = n * 16;
      arr[o] = sc;
      arr[o + 1] = 0;
      arr[o + 2] = 0;
      arr[o + 3] = 0;
      arr[o + 4] = 0;
      arr[o + 5] = sc;
      arr[o + 6] = 0;
      arr[o + 7] = 0;
      arr[o + 8] = 0;
      arr[o + 9] = 0;
      arr[o + 10] = sc;
      arr[o + 11] = 0;
      arr[o + 12] = e[12];
      arr[o + 13] = e[13];
      arr[o + 14] = e[14];
      arr[o + 15] = 1;
      const g = A.gainEclair * (1 - u) * (1 - u);
      fa[n * 4] = flashCouleur[w * 3] * g;
      fa[n * 4 + 1] = flashCouleur[w * 3 + 1] * g;
      fa[n * 4 + 2] = flashCouleur[w * 3 + 2] * g;
      fa[n * 4 + 3] = 1;
      n++;
    }
    // éclairs des tourelles
    for (let q = 0; q < NT; q++) {
      const t = tFlash[q];
      if (t >= A.eclair || !tBouche[q] || tVisible[q] === 0) continue;
      const u = t / A.eclair;
      const e = tBouche[q].matrixWorld.elements;
      const sc = A.tourelleEclair * (0.7 + 0.8 * u);
      const o = n * 16;
      arr[o] = sc;
      arr[o + 1] = 0;
      arr[o + 2] = 0;
      arr[o + 3] = 0;
      arr[o + 4] = 0;
      arr[o + 5] = sc;
      arr[o + 6] = 0;
      arr[o + 7] = 0;
      arr[o + 8] = 0;
      arr[o + 9] = 0;
      arr[o + 10] = sc;
      arr[o + 11] = 0;
      arr[o + 12] = e[12];
      arr[o + 13] = e[13];
      arr[o + 14] = e[14];
      arr[o + 15] = 1;
      const g = A.gainEclair * (1 - u) * (1 - u);
      const w = tArme[q];
      fa[n * 4] = flashCouleur[w * 3] * g;
      fa[n * 4 + 1] = flashCouleur[w * 3 + 1] * g;
      fa[n * 4 + 2] = flashCouleur[w * 3 + 2] * g;
      fa[n * 4 + 3] = 1;
      n++;
    }
    if (n) {
      flashes.instanceMatrix.needsUpdate = true;
      flashAttr.needsUpdate = true;
    }
  }
  flashes.count = n;
}

export function inspect(out) {
  out.poids = [POIDS[0], POIDS[1]];
  out.lacetDeg = [(LACET[0] * 180) / Math.PI, (LACET[1] * 180) / Math.PI];
  out.busteDeg = (ETAT[BUSTE] * 180) / Math.PI;
  out.modules = modules.map((m, w) => (m ? { arme: NOM[w], glb: modulesGlb[w] === 1, visible: modulesGlb[w] ? m.scale.x > 0.5 : m.visible } : null)).filter(Boolean);
  out.evo = modulesEvo.map((m, w) => (m ? { arme: NOM[w], visible: m.scale.x > 0.5, evoluee: evolved[w] > 0 } : null)).filter(Boolean); // 21/11
  out.bouchesGlb = bouches.map((b, w) => (b ? NOM[w] : null)).filter(Boolean);
  out.eclairs = flashes ? flashes.count : 0;
  out.tourelles = { visibles: NTOUR[0], lacetDeg: Array.from(tLacet).map((x) => +((x * 180) / Math.PI).toFixed(1)), cibles: Array.from(tTX).map((x, n) => [+x.toFixed(1), +tTZ[n].toFixed(1)]) };
  out.tirs = Array.from(tirs);
  out.cone = { tirs: Array.from(cone.tirs), bornes: Array.from(cone.bornes), attentes: Array.from(cone.attentes) };
  // dernière bouche rendue à weapons.js, par arme : décalage horizontal par rapport au centre du héros, hauteur (m)
  out.bouches = NOM.map((n, w) => ({ arme: n, dxz: +Math.hypot(DERNIERE[w * 3], DERNIERE[w * 3 + 2]).toFixed(3), y: +DERNIERE[w * 3 + 1].toFixed(3) }));
}

// ----- prototype (tests/anim/proto.js) -------------------------------------------------------------------------------
export function brancher({ crochets, heros: h }) {
  const C = crochets.armes;
  // les tableaux partagés sont ceux des crochets (le module patché de weapons.js les lit)
  ACTIF_PROXY.c = C;
  init({ scene: h.getMesh().parent, materiau: h.getMesh().material });
  C.viserRobot = viserRobot;
  C.viserPoint = (w) => {
    V[0] = C.V[0];
    V[1] = C.V[1];
    viserPoint(w);
  };
  C.bouche = (w) => {
    const r = bouche(w, C.B);
    C.BY[w] = BY[w];
    return r;
  };
  C.tir = tir;
  C.borner = (w) => borner(w, C.D);
  C.FILTRE[0] = ANIM.corps.ciblesDansCone ? 1 : 0;
  C.dansCone = dansCone;
  C.dansConeD = () => dansConeD(C.D);
  C.dansConeV = () => dansConeV(C.V);
  C.viserBuste = viserBuste;
  C.viserBustePoint = (w) => {
    V[0] = C.V[0];
    V[1] = C.V[1];
    viserBustePoint(w);
  };
  C.attente = attente;
  C.viserTourelle = viserTourelle;
  C.viserTourellePoint = (k) => {
    V[0] = C.V[0];
    V[1] = C.V[1];
    viserTourellePoint(k);
  };
  C.boucheTourelle = (k) => boucheTourelle(k, C.B);
  C.tirTourelle = tirTourelle;
}
const ACTIF_PROXY = { c: null };
export function protoSetApres(on) {
  ACTIF[0] = on ? 1 : 0;
  if (ACTIF_PROXY.c) ACTIF_PROXY.c.ACTIF[0] = ACTIF[0];
  if (!on) {
    heros.visee.fill(0);
    DOS[3] = 1;
  }
}
export function protoUpdate(dt) {
  update(dt);
}
export function protoSync() {
  sync();
  if (ACTIF_PROXY.c) ACTIF_PROXY.c.DOS.set(DOS);
}
export const protoInspect = inspect;
/** Mesures : bouche de l'arme w dans la pose DESSINÉE (matrice monde actuelle de son nœud). */
export function boucheDessinee(w) {
  const e = bouches[w].matrixWorld.elements;
  return [e[12], e[13], e[14]];
}

// ----- Interface de weapons.js (jeu intégré) ------------------------------------------------------------------------
// Mêmes noms et même forme que crochets.armes du prototype (tests/anim/crochets.js) : weapons.js l'importe sous le nom
// `__A` et l'appelle exactement comme la copie patchée par tests/anim/gen-weapons.mjs. Tableaux partagés : ACTIF (1 une
// fois le héros posé), B (bouche), BY, V (point visé), D (direction d'un tir à borner), DOS (sortie des orbitaux),
// FILTRE (1 = cibles des armes de bras DANS le cône du buste : ANIM.corps.ciblesDansCone).
const D_ = new Float64Array(2);
const FILTRE = new Float64Array([ANIM.corps.ciblesDansCone ? 1 : 0]);
export const api = {
  ACTIF,
  B,
  BY,
  V,
  D: D_,
  DOS,
  FILTRE,
  viserRobot,
  viserPoint,
  bouche: (w) => bouche(w, B),
  tir,
  borner: (w) => borner(w, D_),
  dansCone,
  dansConeD: () => dansConeD(D_),
  dansConeV: () => dansConeV(V),
  viserBuste,
  viserBustePoint,
  attente,
  viserTourelle,
  viserTourellePoint,
  boucheTourelle: (k) => boucheTourelle(k, B),
  tirTourelle,
  boucheLameD: () => boucheJ(0, B), // § E5.F.13 : seconde lame (bras droit), pose dessinée
};
