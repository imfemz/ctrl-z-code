// ANIMATIONS v2 — P4 : héros animé sur les pièces du modèle Blender (assets/modeles/heros.glb), prototype du 13/11/2026.
//
// Le .glb arrive en pièces (corps, tete, bras_g/d → avant_bras_g/d, jambe_g/d → tibia_g/d, pivots aux articulations).
// Ici : UN SkinnedMesh (un appel de dessin + son ombre), un os par pièce (poids 1 : attribut `piece` → skinIndex),
// hiérarchie et pivots du .glb. three fait le skinning du matériau peint ET de la carte d'ombre : l'ombre suit les jambes.
//
// Animation (tout est calculé à partir du temps simulé ou d'un état simulé : même pose à 60 et 240 Hz) :
//   - marche : phase = distance parcourue × stride ; cuisses, genoux (pliés pendant le retour de la jambe), bras en
//     balancier opposé, avant-bras pliés en course ; rebond du corps (haut quand la jambe d'appui passe dessous) ;
//   - penché : vitesse + ACCÉLÉRATION le long du cap (il se penche en démarrant, se redresse en freinant) ;
//   - roulis dans les virages (vitesse de rotation du cap × allure) ;
//   - arrêt net : tassement en ressort amorti, analytique (A·e^(−kt)·cos(2πft)) ;
//   - dash : anticipation (ramassé 35 ms, le déplacement part tout de suite), étirement le long de la course, bras
//     rejetés, images rémanentes cyan (émises au temps simulé, interpolées entre deux positions de pas), réception
//     en ressort ;
//   - P1 : invulnérabilité en lueur cyan (plus de blanc), silhouette cyan visible à travers les robots (GreaterDepth) ;
//   - battement de santé basse (reperes.js) et lueur du ping de dash : lus dans `extra`.
// Puis la cape (cape.js) avance sur la pose finale du corps.
//
// INTÉGRATION (src/player.js) :
//   - init : remplacer le maillage de boîtes par heros.init({ scene, donnees: chargerPieces('assets/modeles/heros.glb'),
//     materiau: createPaintedMaterial({ profil: 'heros', glowColor: PALETTE.playerAccent }) }) ; le maillage `mesh` du
//     module devient heros.getMesh() (makeShadowCaster déjà fait ici). L'anneau P1 (PLAYER.marker) est retiré : R1/R2.
//   - update(dt), étape 7, après le cap : heros.update(dt) (remplace le bloc « animation de marche »).
//   - sync() : remplacer position / rotation / uFx par heros.sync() (qui appelle cape.update + cape.sync).
//   - reset() : heros.reset().
//   - clés : ANIM.heros → PLAYER.anim. Coût : tests/anim-perf.mjs.
//   - BUSTE / JAMBES (13/11) : le bassin (racine + jambes) suit le DÉPLACEMENT, le buste (bras, tête, cape, tourelles)
//     suit la VISÉE. Rien à ajouter dans player.js : la visée arrive par armes-heros.js (viseeBuste[0] = 1 tant qu'une
//     arme vise, viseeBuste[1] = lacet monde voulu, tenu ANIM.armes.tenue s, pré-visée 0,45 s avant le tir suivant) ;
//     sans visée, le buste revient sur P.rot en ANIM.corps.retourMarche s. Torsion buste/bassin bornée à ±70°
//     (torsionMax) ; au-delà le bassin change d'état : 0 avant / 1 pas chassés / 2 marche arrière (seuils 60° / 120°,
//     hystérésis 10°), 3 arrêt (pivot sur place par petits pas quand la visée dépasse la torsion max). Pieds posés par
//     cinématique inverse (piedPose) ; lecture : corps[0] lacet du bassin, corps[1] lacet du buste, mesurePieds.
//     P.rot n'est PAS réécrit : le jeu garde son cap (collisions, dash) ; seul le dessin se sépare.
//   - PIEDS (14/11, heros.glb à os de pied : pied_<c> pivot à la cheville, orteils_<c> à la base des orteils) : la
//     cinématique inverse vise la CHEVILLE ; le pied d'appui est posé À PLAT (la cheville compense l'angle du tibia :
//     semelle horizontale) et déroule le pas (ANIM.heros.pied) : attaque du talon, appui à plat, talon qui se lève en
//     pivotant à la base des orteils (orteils fléchis, à plat au sol), pointe relevée pendant le retour. Marche arrière :
//     le même déroulé à l'envers. L'appui est tenu par une ANCRE fixe au sol (talon, projection de la cheville ou base
//     des orteils selon la phase) : rien ne glisse quand le pied roule ni quand la jambe tourne (pivot sur la plante).
//     À l'arrêt les deux pieds restent posés ; le plus éloigné de sous sa hanche revient d'un petit pas (recentrage).
//     Un pied en l'air n'entre jamais dans le sol (la jambe le relève). Longueurs lues sur les pivots du modèle.
//   - Cône de tir ±45° autour du buste : les armes de bras choisissent leurs cibles DANS le cône (armes-heros.js,
//     « CIBLES DANS LE CÔNE » ; patches filtre-* de tests/anim/gen-weapons.mjs).
import { glitchOeil } from './oeil-glitch.js';
import * as THREE from 'three';
import { PLAYER, HEROS_IDLE, COUP_DE_PIED } from '../config.js';
import { COUP, C_ACTIF, C_COTE, C_LACET, C_LOURD, C_T, C_TA, C_TF, C_TR, C_TT } from './coup-pied.js'; // § E4.J
import * as CPV2 from './coup-pied.js'; // § E4.O : coup de pied cuit (pistes, mesures, échantillonneur)
import { P, run } from '../state.js';
import { AGENT, ANIM_AGENTS } from '../config.js'; // § E5.F : course du Bastion, gestes en poses clés
import { ANIM } from './reglages.js';
import * as cape from './cape.js';
import * as tissus from './tissus.js'; // § E5.I : les trois tissus du Shinobi (à la place de la cape)
import { katanaEnMain } from './combos.js'; // § E5.I : katana au dos ou en main, état de l'image
import { hauteur as dashHauteur } from '../dash-agents.js';
import { DASH as DASH_AG } from '../dash-agents.js'; // § E5.F : durée du bond (Jump Attack étiré dessus)
import * as BOND from './bond-cuit.js'; // § E5.F : « Jump Attack » cuit, joué pendant le bond du Bastion
import { BOND_CUIT } from '../config.js';
import { CONTRAINTES } from '../config.js'; // § E5.F : bornes articulaires
import { IDLES_AGENTS } from '../config.js'; // § E5.F : idle de chaque agent
import { COURSE } from './ref-marche.js';
import { RETOURS_GUIDE } from '../config.js'; // § E5.Q (B14) : lueur verte du soin du héros
import { SOIN_HEROS } from '../state.js';
const S_LUEUR = 2; // SOIN_HEROS[2] : s de lueur verte restantes (src/soin-heros.js)

const A = ANIM.heros;
const TWO_PI = Math.PI * 2;

// état (§ V : scalaires réécrits à chaque image → tableau typé)
const PHASE = 0;
const GAIT = 1;
const LEAN = 2;
const ROLL = 3;
const LASTROT = 4;
const LASTVF = 5;
const ACCF = 6;
const STOP_T = 7;
const MOVING = 8;
const DASH_PREV = 9;
const DASH_EL = 10;
const LAND_T = 11;
const GHOST_T = 12;
const TIME = 13;
const FRAME_DT = 14; // dt simulé accumulé depuis le dernier sync (consommé par la cape)
const PX0 = 15; // position au pas précédent (interpolation des images rémanentes)
const PZ0 = 16;
const READY = 17;
const AIMYAW = 18; // lacet monde du buste (visée lissée)
const LOWYAW = 19; // lacet monde du bassin (racine)
const LOCO = 20; // 0 avant, 1 chassés, 2 arrière, 3 arrêt
const ALPHA = 21; // direction du déplacement dans le repère du bassin
const AMPL = 22; // amplitude courante des cuisses
const AIMHOLD = 23; // s depuis la dernière visée active
const PIVOT = 24; // 1 = pivot sur place en cours
const DESC = 25; // descente du bassin demandée par la jambe d'appui la plus éloignée, à la dernière pose (m)
const S = new Float64Array(26);
// Constantes flottantes lues dans un tableau typé : une variable locale qui reçoit tantôt un flottant, tantôt un entier
// littéral (0, 1, −1) est emballée par V8 à chaque image (§ V ; mesuré à l'intégration, scène D : 1,8 Ko par image ici)
const K = new Float64Array([0, 1, -1]);
const C = ANIM.corps;
/** [lacet du bassin, lacet du buste] en monde (lu par armes-heros : visée des bras et cône). */
export const corps = new Float64Array(2);
/** Écrit par armes-heros : [1 = une arme vise, lacet monde de la cible prioritaire]. */
export const viseeBuste = new Float64Array(2);
//#region e5:U-visee-souris
/** § E5.U.4 : écrit par src/visee.js — [0] 1 = le curseur est suivi, [1], [2] direction monde héros → curseur. Le buste
 * la prend quand ni dash, ni geste, ni arme ne l'imposent ; [0] = 0 : comportement d'avant (le buste revient sur P.rot).
 * Le lacet est calculé ici (atan2 dans cette fonction optimisée : mesuré, dans visee.update il allouait ~12 o/image). */
export const regard = new Float64Array(3);
//#endregion e5:U-visee-souris
/**
 * Mesures (relevées après la pose, à chaque sync) : [0] vitesse horizontale du point d'appui du pied le plus lent
 * (m/s : talon, projection de la cheville ou base des orteils selon la phase), [1] état de locomotion, [2] vitesse du
 * héros, puis pour le pied D'APPUI (NaN s'il n'y en a pas) : [3] hauteur de son point le plus bas (m, 0 = posé),
 * [4] écart de hauteur entre les 4 coins de sa semelle (m, 0 = à plat), [5] phase (0 talon, 1 à plat, 2 talon levé ;
 * −1 aucun pied d'appui), [6] point le plus bas des DEUX pieds (m), [7] angle du pied d'appui (monde, rad),
 * [8] angle de ses orteils (local, rad), [9] pied d'appui (0 g, 1 d, −1 aucun), [10] vitesse horizontale de son point
 * d'appui s'il était déjà posé à l'image précédente (NaN à la pose du pied : c'est l'atterrissage, pas un glissement).
 */
export const mesurePieds = new Float64Array(11);
const VAPPUI = new Float64Array(2); // vitesse du point d'appui de chaque pied (mesure)
const APPUI_PREC = new Uint8Array(2); // pied posé à la mesure précédente, même pivot

/** Écrit par reperes.js avant heros.sync : [gonflement du corps, lueur de l'accent]. */
export const extra = new Float64Array(2);
/** Écrit par armes-heros.js : [poids, lacet, tangage, recul] du bras droit, puis du gauche, puis lacet du buste. */
export const visee = new Float64Array(9);
/** § E3.M : écrit par combos.js — geste d'attaque en cours (poids, bras, lacet, levée, torsion, vrille, avance,
 *  accroupi, lacet monde du coup, coude). Poids 0 = aucun geste : la pose est celle d'avant le chantier M. */
export const geste = new Float64Array(24); // § E5.F : 10 → 24 (mode 4 : bras en vrai arc, buste, vol, tête, pas)
/** § E5.F : appuis de la course du Bastion — [1] x, [2] z du pied posé (poussière : combos.js) ; compteur : fouleeN[0]
 *  (entier : une lecture d'élément flottant hors code optimisé crée un nombre sur le tas). */
export const foulee = new Float64Array(3);
/** § E5.G : contacts du pied d'appui (ancre posée au bout d'un retour de jambe, en marche ou en course) — [0] compteur,
 *  [1] x, [2] z de l'ancre, [3] allure (S[GAIT]) ; lu par src/anim/pas-agents.js (son du pas). */
export const pas = new Float64Array(4);
const RETOUR = new Uint8Array(2); // § E5.G : 1 = la jambe k est passée en l'air (retour) en marche depuis son dernier appui
export const fouleeN = new Int32Array(1);
// § E5.F : style de course de l'agent posé (init) — 0 = aucun (Éclaireur, Shinobi : course d'avant au bit près)
const STY = new Float64Array(16);
const ST_ON = 0, ST_PENCHE = 1, ST_LEAN = 2, ST_TETE = 3, ST_EPAULES = 4, ST_ROULIS = 5, ST_BRAS = 6, ST_ECART = 7;
const ST_AVB = 8, ST_TASSE = 10, ST_BASSIN = 11, ST_TDUR = 12;
const FOUL = new Float64Array(4); // [0] temps du dernier appui, [1] appui g à l'image précédente, [2] appui d, [3] pied
const PAS_VU = new Float64Array(1); // dernier pas de fente demandé par combos (geste[23]) déjà lancé
const RECT = new Float64Array(6); // pas de fente : [k*3] 1 = cible fixe, [k*3+1] x, [k*3+2] z
const RECD = new Float64Array(2); // durée du pas en cours, par pied (0 = recentrage ordinaire)
const REPLIE = Float64Array.from(ANIM_AGENTS.shinobi.replie);
const BXZ = new Float64Array(1); // penché du buste d'avant le § E5.F (pivot au sol)
const TORS_EX = new Float64Array(1); // § E5.F : excès de torsion du buste reporté au bassin (rad)
const eB1 = new THREE.Euler(0, 0, 0, 'YXZ');
const eB2 = new THREE.Euler(0, 0, 0, 'YXZ');
const qB1 = new THREE.Quaternion();
const qB2 = new THREE.Quaternion();
const vB1 = new THREE.Vector3();
const vB2 = new THREE.Vector3(); // cuisse, genou repliés pendant la vrille en l'air
let donneesGlb = null;
let racine = null;
let rootBone = null; // § E4.O : os racine (bassin) — écrit seulement par le coup de pied cuit
/** Os d'une pièce (null = os racine du squelette). */
export function os(nom) {
  return nom === null ? racine : bones[nom] || null;
}
/** Pièces et nœuds vides du .glb chargé (pieces.js). */
export function donneesHeros() {
  return donneesGlb;
}

let mesh = null;
let xray = null;
let uFx = null;
//#region e5:Q-retours-guide
// § E5.Q (B14) : couleur de lueur du matériau du héros — la sienne (cyan : invulnérabilité, dash) ou le vert du soin
let uGlow = null;
const glowBase = new THREE.Color();
const glowSoin = new THREE.Color(RETOURS_GUIDE.soin.couleur);
const LUEUR_PAR_S = RETOURS_GUIDE.soin.lueur / RETOURS_GUIDE.soin.duree; // lueur = LUEUR_PAR_S × s restantes
let glowVert = 0; // 1 : uGlow porte le vert du soin
//#endregion e5:Q-retours-guide
let ghosts = null;
let ghostAge = null;
const GCAP = A.ghostCount;
const gX = new Float32Array(GCAP);
const gZ = new Float32Array(GCAP);
const gR = new Float32Array(GCAP);
const gAge = new Float32Array(GCAP); // âge en s (≥ life = libre)
const bones = {};
let actif = true;

const GATHER = A.dashGather;
const STRETCH = A.dashStretch;
const LAND = A.landSquash;

export function getMesh() {
  return mesh;
}

/**
 * Profil peint du héros ANIMÉ : celui du rendu (« heros ») avec un liseré cyan plus faible. Mesuré le 13/11 : le liseré
 * de Fresnel (force 0,8) passe sur les membres bleu nuit dès qu'ils se balancent (faces rasantes) et le héros paraît
 * cyan de la tête aux pieds ; à ANIM.heros.lisere, plaques crème et membres bleu nuit se lisent, le cyan reste aux
 * accents émissifs. INTÉGRATION : à reporter dans RENDER.peint.profils.heros (décision à prendre avec le rendu).
 */
export function profilHeros(PEINT, force = A.lisere) {
  // intégré : le profil « herosAnime » est défini dans config.js (région anim:reglages) ; seul un autre liseré demandé
  // par une page de prototype (?lisere=) le redéfinit
  if (!(PEINT.profils.herosAnime && PEINT.profils.herosAnime.liseré.force === force)) {
    const h = PEINT.profils.heros;
    PEINT.profils.herosAnime = { ...h, liseré: { ...h.liseré, force } };
  }
  return 'herosAnime';
}

// Matériaux propres au héros animé, créés au premier init et réutilisés par les suivants (changement de modèle de
// l'agent : aucun programme recompilé)
let matProfondeur = null;
let matSilhouette = null;
let matRemanences = null;

/**
 * Libère le héros posé (changement de modèle de l'agent, hors combat — player.poserAgent) : maillage, silhouette et
 * images rémanentes retirés de la scène, squelette et géométries libérés (l'ancienne géométrie est réenvoyée au GPU si
 * l'agent revient). Matériaux et cape gardés pour le prochain init(). Rien si aucun héros n'est posé.
 */
export function liberer() {
  if (mesh === null) return;
  mesh.removeFromParent();
  xray.removeFromParent();
  ghosts.removeFromParent();
  mesh.skeleton.dispose();
  ghosts.geometry.dispose(); // index, position, normal de l'ancienne géométrie + aGhost
  ghosts.dispose();
  mesh.geometry.dispose();
  mesh = null;
  xray = null;
  ghosts = null;
  ghostAge = null;
  S[READY] = 0;
}

/**
 * donnees : résultat de chargerPieces (pieces.js) ; materiau : matériau peint du héros (uniformes uFx partagés avec
 * l'ancien joueur dans le prototype) ; avecCape : false pour un agent sans cape (AGENTS[].cape, le Bastion).
 * Rappelable après liberer() avec un autre modèle (mêmes pièces : heros.glb ou agent-<nom>.glb).
 */
export function init({ scene, donnees, materiau, avecCape = true, avecTissus = false, agent = run.agent }) {
  if (mesh !== null) liberer();
  // § E5.F : course « bulldozer » du Bastion (run.agent est l'agent posé : player.poserAgent(run.agent))
  STY.fill(0);
  // § E5.K : `agent` = l'agent du modèle posé (il peut précéder run.agent à l'écran titre, avant son chargement)
  if (ANIM_AGENTS.actif && agent === AGENT.BASTION) {
    const B = ANIM_AGENTS.bastion.course;
    STY[ST_ON] = 1;
    STY[ST_PENCHE] = B.penche;
    STY[ST_LEAN] = B.lean;
    STY[ST_TETE] = B.tete;
    STY[ST_EPAULES] = B.epaules;
    STY[ST_ROULIS] = B.roulis;
    STY[ST_BRAS] = B.bras;
    STY[ST_ECART] = B.brasEcart;
    STY[ST_AVB] = B.avantBras;
    STY[ST_BASSIN] = B.bassin;
    STY[ST_TDUR] = B.tasseDuree;
  }
  for (const k of Object.keys(bones)) delete bones[k];
  const { geometry, pieces, vides } = donnees;
  const n = geometry.attributes.position.count;
  const piece = geometry.attributes.piece.array;
  // skinIndex / skinWeight : réécrits sur place si le modèle a déjà été posé (retour à un agent déjà joué)
  const dejaSi = geometry.attributes.skinIndex;
  const si = dejaSi && dejaSi.count === n ? dejaSi.array : new Uint16Array(n * 4);
  const sw = dejaSi && dejaSi.count === n ? geometry.attributes.skinWeight.array : new Float32Array(n * 4);
  si.fill(0);
  sw.fill(0);
  for (let i = 0; i < n; i++) {
    si[i * 4] = piece[i] + 1; // os 0 = racine
    sw[i * 4] = 1;
  }
  if (si !== (dejaSi && dejaSi.array)) {
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  }
  donneesGlb = { pieces, vides };
  oeilBase = null; // repos de l'œil du casque relu sur le nouveau squelette
  const root = new THREE.Bone();
  root.name = 'racine';
  rootBone = root;
  const buste = new THREE.Bone(); // haut du corps : bras, tête, armes, cape ; le bas (corps = bassin, jambes) suit la racine
  buste.name = 'buste';
  buste.rotation.order = 'YXZ';
  racine = buste; // os(null) = le buste (bouches EMP et orbitaux, cape)
  bones.buste = buste;
  const list = [root];
  const objs = pieces.map((p) => {
    const b = new THREE.Bone();
    b.name = p.nom;
    b.rotation.order = 'XZY';
    bones[p.nom] = b;
    list.push(b);
    return b;
  });
  root.add(buste);
  pieces.forEach((p, i) => {
    // le haut du corps : bras, tête, tourelles d'épaule, katana porté dans le dos (17/11 au soir : sur le bassin, il
    // restait en place quand le buste tourne de 70° pour viser) ; sentinelle et grosse tourelle portées entre les
    // omoplates (§ E5.F.13 : pièces dessinées à 1,36–1,81 m, sur le bassin elles ne suivaient pas la torsion)
    const haut = p.parent < 0 && /^(bras_|tete|tourelle_|arme_katana(_evo)?$|arme_sentinelle(_evo)?$|arme_canon(_evo)?$)/.test(p.nom);
    const parent = p.parent >= 0 ? objs[p.parent] : haut ? buste : root;
    const pp = p.parent >= 0 ? pieces[p.parent].pivot : [0, 0, 0];
    objs[i].position.set(p.pivot[0] - pp[0], p.pivot[1] - pp[1], p.pivot[2] - pp[2]);
    parent.add(objs[i]);
  });
  list.push(buste);
  // torsion répartie sur l'abdomen : les sommets du corps mêlent bassin (os « corps ») et buste selon leur hauteur
  const iCorps = pieces.findIndex((p) => p.nom === 'corps');
  const iBuste = list.length - 1;
  const pos = geometry.attributes.position.array;
  for (let v = 0; v < n; v++) {
    if (piece[v] !== iCorps) continue;
    let u = (pos[v * 3 + 1] - C.abdomen[0]) / (C.abdomen[1] - C.abdomen[0]);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    u = u * u * (3 - 2 * u);
    si[v * 4] = iCorps + 1;
    si[v * 4 + 1] = iBuste;
    sw[v * 4] = 1 - u;
    sw[v * 4 + 1] = u;
  }
  geometry.attributes.skinIndex.needsUpdate = true;
  geometry.attributes.skinWeight.needsUpdate = true;
  mesurerJambes(pieces, piece, pos);
  CPV2.setModele(pieces); // § E4.O : mesures du coup de pied cuit sur CE modèle (hors combat)
  CW.fill(0);
  { // § E4.E.3 : hanche du modèle posé (pivot de la cuisse), pour le Warrior Idle
    const j = pieces.find((p) => p.nom === 'jambe_g');
    IDLE[2] = j ? j.pivot[1] : 0.9;
    IDLE[0] = 0;
    IDLE[3] = 0;
  }
  calerCourse();
  osListe.length = 0;
  for (const n of OS) osListe.push(bones[n] || null);
  mesh = new THREE.SkinnedMesh(geometry, materiau);
  mesh.name = 'joueur'; // le maillage du joueur (tests : scene.getObjectByName('joueur'))
  mesh.rotation.order = 'YXZ';
  mesh.add(root);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (matProfondeur === null) matProfondeur = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mesh.customDepthMaterial = matProfondeur;
  mesh.renderOrder = 2;
  uFx = materiau.userData.uniforms.uFx.value;
  uGlow = materiau.userData.uniforms.uGlowColor ? materiau.userData.uniforms.uGlowColor.value : null; // § E5.Q (B14)
  if (uGlow !== null) glowBase.copy(uGlow);
  glowVert = 0;
  scene.add(mesh);

  // P1 : silhouette visible seulement là où quelque chose est devant le héros (même squelette)
  if (matSilhouette === null) {
    matSilhouette = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x3fe0d0).multiplyScalar(A.xrayShade),
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
      toneMapped: false,
    });
  }
  xray = new THREE.SkinnedMesh(geometry, matSilhouette);
  xray.name = 'joueur-silhouette';
  xray.frustumCulled = false;
  xray.renderOrder = 1.5;
  xray.bind(skeleton, mesh.bindMatrix);
  scene.add(xray);

  // images rémanentes : la géométrie au repos, instanciée, additive, en lueur de contour
  const gg = new THREE.BufferGeometry();
  gg.setIndex(geometry.index);
  gg.setAttribute('position', geometry.attributes.position);
  gg.setAttribute('normal', geometry.attributes.normal);
  ghostAge = new THREE.InstancedBufferAttribute(new Float32Array(GCAP), 1);
  ghostAge.setUsage(THREE.DynamicDrawUsage);
  gg.setAttribute('aGhost', ghostAge);
  if (matRemanences === null) matRemanences = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(A.ghostColor[0] * A.ghostGain, A.ghostColor[1] * A.ghostGain, A.ghostColor[2] * A.ghostGain) } },
    vertexShader: `attribute float aGhost; varying float vA; varying vec3 vN;
      void main() { vA = aGhost; vN = normalize( normalMatrix * mat3( instanceMatrix ) * normal );
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: `uniform vec3 uColor; varying float vA; varying vec3 vN;
      void main() { float f = 1.0 - abs( vN.z ); float k = ( 1.0 - vA ); k *= k;
        gl_FragColor = vec4( uColor * ( 0.08 + 1.1 * f * f ) * k, 1.0 ); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  ghosts = new THREE.InstancedMesh(gg, matRemanences, GCAP);
  ghosts.name = 'joueur-v2-remanences';
  ghosts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ghosts.frustumCulled = false;
  ghosts.count = 0;
  ghosts.renderOrder = 3;
  scene.add(ghosts);
  gAge.fill(1e9);

  // cape
  const vg = vides.cape_epaule_g ? vides.cape_epaule_g.position : [0.192, 1.533, -0.163];
  const vd = vides.cape_epaule_d ? vides.cape_epaule_d.position : [-0.192, 1.533, -0.163];
  const ud = vides.cape_dos ? vides.cape_dos.userData : {};
  const dos = ud.a && ud.b && ud.rayon ? { a: ud.a, b: ud.b, rayon: ud.rayon } : { a: [0, 1.054, -0.029], b: [0, 1.437, -0.029], rayon: 0.153 };
  // la capsule fixe des jambes est remplacée par deux capsules qui suivent les cuisses et les tibias (marche arrière,
  // pas chassés : le buste tourne, les jambes non)
  // agent sans cape (le Bastion, AGENTS[].cape === false) : rien n'est créé, ou la cape déjà créée est coupée
  if (avecCape) cape.init({ scene, ancrageG: vg, ancrageD: vd, dos, jambes: { a: [0, 0.6, 0], b: [0, 0.61, 0], rayon: 0 }, corps: donnees });
  else cape.couper();
  // § E5.I : le Shinobi (AGENTS[].tissus) porte ses trois tissus — pan devant, pan du dos, queue de l'écharpe
  {
    const pc = pieces.find((p) => p.nom === 'corps');
    for (let i = 0; i < 3; i++) TIS_PIV[i] = pc ? pc.pivot[i] : 0;
  }
  S_TIS[0] = avecTissus ? 1 : 0;
  if (avecTissus) tissus.init({ scene, dos, corps: donnees });
  else tissus.couper();
  reset();
  S[READY] = 1;
  setActif(actif); // nouveau maillage : même visibilité que l'ancien
}

// § E5.I : [0] tissus du Shinobi actifs (1 / 0) ; pivot de l'os du bassin (repère du modèle) ; matrice du bassin
const S_TIS = new Int8Array(1);
const TIS_PIV = new Float64Array(3);
const TIS_ZERO = new Float64Array(3); // l'axe du katana est donné dans le repère du modèle (celui du buste)
/** Matrice monde du bassin (os « corps », repère du modèle → monde) et katana au dos, pour tissus.update / reset. */
function tissusEntree() {
  // katana au dos : porté (au dos ou en main) et pas en main D'APRÈS LE COMBO DE CETTE IMAGE — armes-heros n'en montre
  // l'os qu'après heros.sync : lu sur l'os seul, le katana rengainé réapparaissait une image dans l'écharpe
  const k = bones.arme_katana;
  const km = bones.arme_katana_main;
  const ke = bones.arme_katana_evo; // 21/11 : katana évolué (Coupe-circuit), même place
  const kme = bones.arme_katana_main_evo;
  const porte = (k && k.scale.x > 0.5) || (km && km.scale.x > 0.5) || (ke && ke.scale.x > 0.5) || (kme && kme.scale.x > 0.5);
  // (repère du BUSTE, parent de l'os du katana qui ne fait que changer d'échelle : un os caché a une échelle de 1e-4)
  tissus.poserReperes((bones.corps || rootBone).matrixWorld.elements, TIS_PIV, porte && katanaEnMain() === 0 ? bones.buste.matrixWorld.elements : null, TIS_ZERO);
}

export function reset() {
  S.fill(0, 0, READY);
  S[STOP_T] = 1e3;
  S[LAND_T] = 1e3;
  S[LASTROT] = P.rot;
  S[AIMYAW] = P.rot;
  S[LOWYAW] = P.rot;
  S[LOCO] = 3;
  S[AIMHOLD] = 1e3;
  S[PX0] = P.x;
  S[PZ0] = P.z;
  gAge.fill(1e9);
  // pieds : aucun appui (reposés là où la pose les met), aucun fondu ni recentrage en cours
  APPUI.fill(0);
  RETOUR.fill(0); // § E5.G
  DECOL.fill(0);
  REC[0] = REC[3] = -1;
  RECT.fill(0); // § E5.F
  RECD.fill(0);
  FOUL.fill(0);
  LACHE.fill(-1e3);
  PSI[0] = PSI[1] = PSIL[0] = PSIL[1] = RECP[0] = RECP[1] = P.rot;
  THETA.fill(0);
  TAU.fill(0);
  DB[0] = 0;
  if (mesh) {
    pose();
    bras(0, bones.bras_g, bones.avant_bras_g);
    bras(1, bones.bras_d, bones.avant_bras_d);
    jambe(2, bones.jambe_g, bones.tibia_g, bones.pied_g);
    jambe(3, bones.jambe_d, bones.tibia_d, bones.pied_d);
    cape.reset(bones.buste.matrixWorld.elements);
    if (S_TIS[0] === 1) {
      tissusEntree();
      tissus.reset(bones.buste.matrixWorld.elements);
    }
  }
}

export function setActif(on) {
  actif = !!on;
  if (!mesh) return;
  mesh.visible = xray.visible = actif && P.alive;
  ghosts.visible = actif;
  cape.setVisible(actif && P.alive);
  tissus.setVisible(actif && P.alive);
}

/** Pas de simulation (après player.update) : lissages, déclencheurs, émission des images rémanentes. */
export function update(dt) {
  if (!S[READY] || !(dt > 0)) return;
  S[FRAME_DT] += dt;
  S[TIME] += dt;
  const speed = PLAYER.speed;
  const v = Math.sqrt(P.vx * P.vx + P.vz * P.vz);
  const dashing = P.dashT > 0;
  const g = dashing ? K[1] : v / speed > 1 ? K[1] : v / speed;
  S[GAIT] += (g - S[GAIT]) * (1 - Math.exp(-A.gaitRate * dt));
  // ----- buste : visée (arme prioritaire, armes-heros) ou direction de marche ; pendant le dash, le dash
  let cible = P.rot;
  if (dashing) cible = Math.atan2(P.dashDirX, P.dashDirZ);
  else if (geste[0] > 0.01) {
    cible = geste[8]; // § E3.M : le buste fait face au coup pendant le geste
    S[AIMHOLD] = 0;
  } else if (viseeBuste[0] > 0) {
    cible = viseeBuste[1];
    S[AIMHOLD] = 0;
  } else if (regard[0] > 0) {
    cible = Math.atan2(regard[1], regard[2]); // § E5.U.4 : le buste regarde vers le curseur (lissé comme une visée d'arme)
    S[AIMHOLD] = 0;
  } else S[AIMHOLD] += dt;
  let da = cible - S[AIMYAW];
  da -= Math.round(da / TWO_PI) * TWO_PI;
  let step = da * (1 - Math.exp(-dt / (dashing ? 0.04 : S[AIMHOLD] > 0 && viseeBuste[0] === 0 ? C.retourMarche : C.viseeLissage)));
  const smax = C.viseeVitesseMax * dt * (dashing ? 3 : 1);
  step = step > smax ? smax : step < -smax ? -smax : step;
  S[AIMYAW] += step;
  // ----- bassin : état de locomotion selon l'angle θ entre déplacement et visée, avec hystérésis
  const mv = v > 0.5;
  const moveYaw = mv ? Math.atan2(P.vx, P.vz) : S[LOWYAW];
  let th = moveYaw - S[AIMYAW];
  th -= Math.round(th / TWO_PI) * TWO_PI;
  const at = th < 0 ? -th : th;
  const hy = C.hysteresis;
  let loco = S[LOCO];
  if (!mv || dashing) loco = dashing ? 0 : 3;
  else if (loco === 3) loco = at < C.seuils[0] ? 0 : at < C.seuils[1] ? 1 : 2;
  else if (loco === 0 && at > C.seuils[0] + hy) loco = at > C.seuils[1] + hy ? 2 : 1;
  else if (loco === 1 && at < C.seuils[0] - hy) loco = 0;
  else if (loco === 1 && at > C.seuils[1] + hy) loco = 2;
  else if (loco === 2 && at < C.seuils[1] - hy) loco = at < C.seuils[0] - hy ? 0 : 1;
  S[LOCO] = loco;
  let bas = S[LOWYAW];
  if (dashing) bas = cible;
  else if (loco === 0) bas = moveYaw;
  else if (loco === 1) bas = S[AIMYAW] + th * 0.5; // à mi-chemin
  else if (loco === 2) bas = S[AIMYAW]; // marche arrière : le bassin fait face à la visée
  let db = bas - S[LOWYAW];
  db -= Math.round(db / TWO_PI) * TWO_PI;
  const avant = S[LOWYAW];
  if (loco === 3) {
    // arrêt : si la visée dépasse la torsion, le bas pivote sur place (petits pas)
    let rel = S[AIMYAW] - S[LOWYAW];
    rel -= Math.round(rel / TWO_PI) * TWO_PI;
    const lim = C.torsionMax * 0.85;
    if (rel > lim || rel < -lim || S[PIVOT] === 1) {
      S[PIVOT] = rel > 0.08 || rel < -0.08 ? 1 : 0;
      const pmax = C.pivotVitesse * dt;
      S[LOWYAW] += rel > pmax ? pmax : rel < -pmax ? -pmax : rel;
    }
  } else {
    S[PIVOT] = 0;
    S[LOWYAW] += db * (1 - Math.exp(-dt / (dashing ? 0.03 : C.bassinFondu)));
  }
  // torsion bornée : au-delà, c'est le bassin qui tourne. Écrit sans branche (§ Z nonies) : une branche rarement prise
  // (torsion dépassée d'un seul côté) n'a pas de retour de type la première fois qu'elle s'exécute ; V8 désoptimise
  // alors toute la fonction, qui repasse ≈ 8 s en code de base (≈ 2 Ko alloués par image, mesuré en charge maximale).
  let rel = S[AIMYAW] - S[LOWYAW];
  rel -= Math.round(rel / TWO_PI) * TWO_PI;
  const tmax = C.torsionMax;
  const tmin = -tmax;
  const borne = rel > tmax ? tmax : rel < tmin ? tmin : rel;
  S[LOWYAW] += rel - borne; // = S[AIMYAW] − borne quand la torsion dépasse, inchangé sinon
  let tourne = S[LOWYAW] - avant;
  tourne -= Math.round(tourne / TWO_PI) * TWO_PI;
  // ----- jambes : direction du pas dans le repère du bassin, amplitude par état, cadence SANS GLISSEMENT
  // (appui linéaire : le pied recule à la vitesse du corps quand L × A × 2/π × foulée = 1)
  let al = moveYaw - S[LOWYAW];
  al -= Math.round(al / TWO_PI) * TWO_PI;
  S[ALPHA] = al;
  const amp = loco === 3 ? C.pivotPas : C.amplitude[loco === 1 ? 1 : loco === 2 ? 2 : 0];
  S[AMPL] += (amp - S[AMPL]) * (1 - Math.exp(-dt / C.bassinFondu));
  // le pied d'appui avance de L × sin(α) : pour qu'il reste immobile, c'est L × sin(α) qui doit être linéaire (et non α)
  // ⇒ foulée = π / (2 × L × sin A), L = hanche → semelle (C.levier)
  const foulee = Math.PI / (2 * C.levier * Math.sin(S[AMPL]));
  // pied d'appui qui s'éloigne (virage, demi-tour : descente du bassin demandée à la dernière pose au-delà du seuil) :
  // la cadence accélère, le pas se termine plus tôt
  let urg = (S[DESC] - PF[F_CS]) / (PF[F_CP] - PF[F_CS]);
  urg = urg < 0 ? K[0] : urg > 1 ? K[1] : urg * urg * (3 - 2 * urg);
  const cad = 1 + PF[F_CG] * urg;
  if (C.courseRef && JB[5] === 1 && S[PIVOT] !== 1) {
    // course de référence : un cycle par CR_DCYC mètres, recalé sur le pied d'appui (voir poseCourse)
    const base = ((v < speed * 1.15 ? v : speed * 1.15) * dt * TWO_PI) / CR_DCYC[0];
    const corr = ((-CR_ECART[0] * TWO_PI) / CR_DCYC[0]) * (dt < C.calagePhase ? dt / C.calagePhase : K[1]);
    S[PHASE] += (base + corr > 0 ? base + corr : K[0]) * cad;
  } else if (loco === 3) S[PHASE] += (tourne < 0 ? -tourne : tourne) * 2.2 * cad; // petits pas du pivot
  else S[PHASE] += (v < speed * 1.15 ? v : speed * 1.15) * dt * foulee * cad;
  // accélération le long du cap (les sauts de vitesse du dash ne comptent pas)
  const fx = Math.sin(P.rot);
  const fz = Math.cos(P.rot);
  const vf = P.vx * fx + P.vz * fz;
  let af = (vf - S[LASTVF]) / dt / PLAYER.accel;
  if (dashing || S[DASH_PREV] > 0 || S[LAND_T] < 0.1) af = K[0];
  S[LASTVF] = vf;
  if (af > 1) af = K[1];
  else if (af < -1) af = K[2];
  S[ACCF] += (af - S[ACCF]) * (1 - Math.exp(-15 * dt));
  const lean = dashing ? A.dashLean : (A.leanSpeed + STY[ST_LEAN]) * S[GAIT] + A.leanAccel * S[ACCF]; // § E5.F : + Bastion
  S[LEAN] += (lean - S[LEAN]) * (1 - Math.exp(-A.leanRate * dt));
  // roulis : vitesse de rotation du cap
  let d = P.rot - S[LASTROT];
  d -= Math.round(d / TWO_PI) * TWO_PI;
  S[LASTROT] = P.rot;
  let roll = -A.bank * (d / dt) * S[GAIT];
  if (roll > A.bankMax) roll = A.bankMax;
  else if (roll < -A.bankMax) roll = -A.bankMax;
  S[ROLL] += (roll - S[ROLL]) * (1 - Math.exp(-A.bankRate * dt));
  // arrêt net
  if (v > 0.5 * speed && !dashing) S[MOVING] = 1;
  if (S[MOVING] === 1 && v < 0.1 * speed && !dashing) {
    S[MOVING] = 0;
    S[STOP_T] = 0;
  } else S[STOP_T] += dt;
  // dash : début, images rémanentes au temps simulé, réception
  for (let k = 0; k < GCAP; k++) gAge[k] += dt;
  if (dashing) {
    if (S[DASH_PREV] <= 0) {
      S[DASH_EL] = 0;
      S[GHOST_T] = 0;
    }
    // instants d'émission dans ce pas : t ∈ [0, dt] tel que DASH_EL + t = k × ghostEvery
    let t = S[GHOST_T];
    while (t <= dt) {
      let slot = 0;
      for (let k = 1; k < GCAP; k++) if (gAge[k] > gAge[slot]) slot = k;
      const u = dt > 0 ? t / dt : K[1];
      gX[slot] = S[PX0] + (P.x - S[PX0]) * u;
      gZ[slot] = S[PZ0] + (P.z - S[PZ0]) * u;
      gR[slot] = P.rot;
      gAge[slot] = dt - t;
      t += A.ghostEvery;
    }
    S[GHOST_T] = t - dt;
    S[DASH_EL] += dt;
  } else if (S[DASH_PREV] > 0) S[LAND_T] = dt - S[DASH_PREV] > 0 ? dt - S[DASH_PREV] : 0; // fin du dash DANS ce pas
  else S[LAND_T] += dt;
  S[DASH_PREV] = P.dashT;
  S[PX0] = P.x;
  S[PZ0] = P.z;
  // (§ E4.O : le bas et le buste suivent P.rot, que player.js tourne vers la borne pendant le coup — aucun saut de
  // lacet écrit ici : un saut forcé faisait prendre au pied des branches rares, désoptimisées à chaque coup)
}

// angles des os (x, z) par articulation : écrits dans des tableaux typés, puis recopiés dans les os en une boucle
// (§ V : un appel de fonction qui reçoit des flottants les emballe — mesuré : 180 o/image avec rot(nom, x, z))
const OS = ['jambe_g', 'jambe_d', 'tibia_g', 'tibia_d', 'bras_g', 'bras_d', 'avant_bras_g', 'avant_bras_d', 'tete'];
const [JG, JD, TG, TD, BG, BD, ABG, ABD, TETE] = OS.map((_, i) => i);
const angX = new Float64Array(OS.length);
const angY = new Float64Array(OS.length);
const angZ = new Float64Array(OS.length);
const HALF_PI = Math.PI / 2;
const osListe = [];

// bras en capsules pour la cape : de l'épaule à la main (os de l'avant-bras + MAIN_LOCAL), en monde, écrits
// directement dans cape.capsulesMonde (aucun flottant passé en argument)
const MAIN_LOCAL = new Float64Array([0.0, -0.4, 0.04]);
function bras(k, a, b) {
  if (!a || !b) return;
  const ea = a.matrixWorld.elements;
  const eb = b.matrixWorld.elements;
  const x = MAIN_LOCAL[0];
  const y = MAIN_LOCAL[1];
  const z = MAIN_LOCAL[2];
  const c = cape.capsulesMonde;
  const o = k * 7;
  c[o] = ea[12];
  c[o + 1] = ea[13] - 0.05;
  c[o + 2] = ea[14];
  c[o + 3] = eb[0] * x + eb[4] * y + eb[8] * z + eb[12];
  c[o + 4] = eb[1] * x + eb[5] * y + eb[9] * z + eb[13];
  c[o + 5] = eb[2] * x + eb[6] * y + eb[10] * z + eb[14];
  c[o + 6] = A.brasRayon;
  for (let j = 0; j < 7; j++) tissus.capsulesMonde[o + j] = c[o + j]; // § E5.I
}

// jambe en capsule pour la cape : de la hanche (os de la cuisse) au pied (os du pied + PIED_LOCAL ; sans os de pied :
// os du tibia + TIBIA_PIED)
const PIED_LOCAL = new Float64Array(A.pied.capeLocal);
const TIBIA_PIED = new Float64Array([0.0, -0.53, 0.06]);
function jambe(k, a, b, p) {
  if (!a || !b) return;
  const ea = a.matrixWorld.elements;
  const eb = p ? p.matrixWorld.elements : b.matrixWorld.elements;
  const L = p ? PIED_LOCAL : TIBIA_PIED;
  const x = L[0];
  const y = L[1];
  const z = L[2];
  const c = cape.capsulesMonde;
  const o = k * 7;
  c[o] = ea[12];
  c[o + 1] = ea[13];
  c[o + 2] = ea[14];
  c[o + 3] = eb[0] * x + eb[4] * y + eb[8] * z + eb[12];
  c[o + 4] = eb[1] * x + eb[5] * y + eb[9] * z + eb[13];
  c[o + 5] = eb[2] * x + eb[6] * y + eb[10] * z + eb[14];
  c[o + 6] = A.jambeRayon;
  // § E5.I : tissus — cuisse (hanche → genou, capsule k) et tibia (genou → pied, capsule k + 2)
  const t = tissus.capsulesMonde;
  const ek = b.matrixWorld.elements;
  t[o] = c[o];
  t[o + 1] = c[o + 1];
  t[o + 2] = c[o + 2];
  t[o + 3] = ek[12];
  t[o + 4] = ek[13];
  t[o + 5] = ek[14];
  t[o + 6] = 1;
  t[o + 14] = ek[12];
  t[o + 15] = ek[13];
  t[o + 16] = ek[14];
  t[o + 17] = c[o + 3];
  t[o + 18] = c[o + 4];
  t[o + 19] = c[o + 5];
  t[o + 20] = 1;
}

// ===== PIEDS ======================================================================================================
// Réglages copiés à l'init du module (§ V : rien n'est lu dans ANIM sur le chemin chaud)
const PD = A.pied;
const PF = new Float64Array([PD.attaque, PD.decollement, PD.talon, PD.poussee, PD.degagement, PD.relache, PD.fondu, PD.marge, PD.dash[0], PD.dash[1], PD.recentrage.seuil, PD.recentrage.duree, PD.recentrage.levee, PD.approche, PD.lacetMax, PD.lacetFondu, PD.pose, PD.hauteur, PD.portee.descenteMax, PD.portee.seuil, PD.portee.plein, PD.portee.gain]);
const [F_ATT, F_DEC, F_TAL, F_POU, F_DEG, F_REL, F_FON, F_MAR, F_DG, F_DD, F_SEU, F_DUR, F_LEV, F_APP, F_LAC, F_LAF, F_POS, F_HAU, F_DMX, F_CS, F_CP, F_CG] = PF.map((_, i) => i);
// Jambe lue sur le modèle (mesurerJambes) : [0] cuisse (hanche → genou), [1] tibia (genou → cheville), [2] genou en
// avant de la hanche (rad), [3] cheville en arrière du genou (rad), [4] cheville au-dessus de la semelle, [5] os de pied
// présents (1 / 0), [6] base des orteils devant la cheville, [7] base des orteils au-dessus de la semelle
const JB = new Float64Array([0.35, 0.53, 0, 0, 0.037, 0, 0.118, 0.033]);
const TALON = new Float64Array([-0.16, -0.16]); // arrière du talon (au sol) par rapport à la cheville, par pied
// points de contrôle de la semelle, par pied : 4 coins du dessous du pied (repère de l'os du pied), 2 bouts des
// orteils (repère de l'os des orteils) — 6 × (x, y, z)
const ECH = new Float64Array(2 * 18);
// TOUS les sommets (sans doublon) de chaque pied, dans le repère de leur os : pied g, orteils g, pied d, orteils d ;
// PVO = début de chaque groupe dans PV (5 bornes). Le point le plus bas d'un pied en l'air est cherché sur eux (contrôle
// du 14/11 : avec 6 points, l'arrière du talon pointe relevée et le bout des orteils pointe tendue passaient sous le sol)
let PV = new Float64Array(0);
const PVO = new Int32Array(5);
const PSIL = new Float64Array(2); // lacet du pied au moment où il quitte le sol (fondu vers la jambe)
const RECP = new Float64Array(2); // lacet du pied au début d'un recentrage
const tmpC = new THREE.Vector3();
const THETA = new Float64Array(2); // angle du pied en monde (+ = pointe vers le bas)
const TAU = new Float64Array(2); // angle des orteils (local au pied, < 0 = relevés par rapport au pied)
const PH = new Float64Array(2); // phase des jambes g, d (0..1 appui, 1..2 retour)
/** § E4.J : [poids du coup de pied, jambe qui frappe (0 g, 1 d), part « frappe » × poids] — écrit par pose(). */
export const KW = new Float64Array(3);
const DB = new Float64Array(1); // poids de la pose de dash
const APPUI = new Uint8Array(2); // 1 = pied posé, son ancre est valide
const DECOL = new Uint8Array(2); // 1 = ancre hors de portée : le pied a décollé en la suivant (il n'est plus l'appui)
const ANC = new Float64Array(6); // ancre au sol (monde) par pied
const ANC_T = new Int8Array(2); // 0 talon, 1 projection de la cheville (à plat), 2 base des orteils
const PSI = new Float64Array(2); // lacet monde du pied (axe de la jambe, image précédente)
const LACHE = new Float64Array(2); // instant (temps simulé) où l'appui a été lâché
const REC = new Float64Array(6); // recentrage par pied : t0 (−1 = aucun), x0, z0
const CIB = new Float64Array(6); // cible de la cheville (monde) par pied
const FU = new Float64Array(2); // cheville par rapport à l'ancre : [avant le long du pied, hauteur]
const BAS = new Float64Array(2); // point le plus bas de chaque pied (m)
/** Compteur (mesure) : ancres déplacées parce que la cheville était hors d'atteinte. */
export const CLAMP = new Float64Array(1);
const IKS = new Float64Array(8); // dernière solution d'appui, par jambe : cuisse x, cuisse z, torsion de la cuisse (y), genou
const REF = new Float64Array(2 * 9); // points d'appui (talon, cheville, base des orteils) de chaque pied, image précédente
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const qT = new THREE.Quaternion();
const qD = new THREE.Quaternion();
const mIK = new THREE.Matrix4(); // rotation de la cuisse (résolution)
const mBaseT = new THREE.Matrix4(); // (X, cuisse du modèle, X × cuisse)ᵀ — écrite par mesurerJambes
const SEMELLE = new THREE.Vector3(0, -0.53, 0.0); // sans os de pied : point de la semelle dans le repère du tibia

/** Longueurs de la jambe, talon et points de la semelle, lus sur les pivots et les sommets du modèle (init). */
function mesurerJambes(pieces, piece, pos) {
  const pv = (nom) => {
    const p = pieces.find((q) => q.nom === nom);
    return p ? p.pivot : null;
  };
  const ph = pv('jambe_g');
  const pg = pv('tibia_g');
  const pc = pv('pied_g');
  const po = pv('orteils_g');
  if (ph && pg) {
    JB[0] = Math.hypot(ph[1] - pg[1], ph[2] - pg[2]);
    JB[2] = Math.atan2(pg[2] - ph[2], ph[1] - pg[1]);
  }
  {
    const c = Math.cos(JB[2]);
    const sn = Math.sin(JB[2]);
    // colonnes X = (1, 0, 0), u0 = (0, −cos e1, sin e1), X × u0 = (0, −sin e1, −cos e1) ; transposée
    mBaseT.set(1, 0, 0, 0, 0, -c, sn, 0, 0, -sn, -c, 0, 0, 0, 0, 1);
  }
  if (!(pg && pc && po)) {
    // modèle sans os de pied (heros-v6.glb et avant) : la « cheville » est le point de la semelle du tibia
    JB[1] = -SEMELLE.y;
    JB[3] = 0;
    JB[4] = C.genouY + SEMELLE.y;
    JB[5] = 0;
    return;
  }
  JB[1] = Math.hypot(pg[1] - pc[1], pg[2] - pc[2]);
  JB[3] = Math.atan2(pg[2] - pc[2], pg[1] - pc[1]);
  JB[4] = pc[1];
  JB[5] = 1;
  JB[6] = po[2] - pc[2];
  JB[7] = po[1];
  // dessous du pied et des orteils : sommets à moins de 6 mm du sol
  const COINS = [[1, -1], [-1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < 2; k++) {
    const c = k === 0 ? 'g' : 'd';
    const ip = pieces.findIndex((p) => p.nom === 'pied_' + c);
    const io = pieces.findIndex((p) => p.nom === 'orteils_' + c);
    const pp = pieces[ip].pivot;
    const pt = pieces[io].pivot;
    const sc = [-1e9, -1e9, -1e9, -1e9, -1e9, -1e9];
    let zmin = 1e9;
    for (let v = K[0]; v < piece.length; v++) {
      const y = pos[v * 3 + 1];
      if (y > 0.006 || (piece[v] !== ip && piece[v] !== io)) continue;
      const x = pos[v * 3];
      const z = pos[v * 3 + 2];
      if (piece[v] === ip) {
        if (z < zmin) zmin = z;
        for (let j = 0; j < 4; j++) {
          const s = COINS[j][0] * x + COINS[j][1] * z;
          if (s > sc[j]) {
            sc[j] = s;
            ECH.set([x - pp[0], y - pp[1], z - pp[2]], k * 18 + j * 3);
          }
        }
      } else {
        for (let j = 0; j < 2; j++) {
          const s = (j === 0 ? 1 : -1) * x + 3 * z; // les deux bouts des orteils (devant, côtés)
          if (s > sc[4 + j]) {
            sc[4 + j] = s;
            ECH.set([x - pt[0], y - pt[1], z - pt[2]], k * 18 + 12 + j * 3);
          }
        }
      }
    }
    TALON[k] = zmin - pp[2];
  }
  // tous les sommets des pieds (init : allocations permises), dédoublonnés au dixième de millimètre
  const L = [];
  for (let k = 0; k < 4; k++) {
    const c = k < 2 ? 'g' : 'd';
    const ipc = pieces.findIndex((p) => p.nom === ((k & 1) === 0 ? 'pied_' : 'orteils_') + c);
    const pp = pieces[ipc].pivot;
    const vus = new Set();
    PVO[k] = L.length;
    for (let v = 0; v < piece.length; v++) {
      if (piece[v] !== ipc) continue;
      const x = pos[v * 3];
      const y = pos[v * 3 + 1];
      const z = pos[v * 3 + 2];
      const cle = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      L.push(x - pp[0], y - pp[1], z - pp[2]);
    }
  }
  PVO[4] = L.length;
  PV = new Float64Array(L);
}

/** Cheville par rapport à l'ancre du pied k (type typ, angle THETA[k]) : FU = [avant le long du pied, hauteur]. */
function decalage(k, typ) {
  const th = THETA[k];
  const hc = JB[4];
  if (typ === 1) {
    FU[0] = K[0];
    FU[1] = hc;
    return;
  }
  const s = Math.sin(th);
  const c = Math.cos(th);
  if (typ === 0) {
    // pivot : arrière du talon, au sol
    const zh = TALON[k];
    FU[0] = hc * s - zh * c;
    FU[1] = hc * c + zh * s;
  } else {
    // pivot : base des orteils (à JB[7] du sol)
    const h = hc - JB[7];
    FU[0] = h * s - JB[6] * c;
    FU[1] = h * c + JB[6] * s;
  }
}

/** Ancre du pied k ramenée à la projection de la cheville (type 1), puis au type typ (même lacet, angle ≈ 0). */
function convertir(k, typ) {
  const o = k * 3;
  const fx = Math.sin(PSI[k]) * mesh.scale.x;
  const fz = Math.cos(PSI[k]) * mesh.scale.z;
  const ta = ANC_T[k];
  const d0 = ta === 0 ? TALON[k] : ta === 2 ? JB[6] : K[0];
  const d1 = typ === 0 ? TALON[k] : typ === 2 ? JB[6] : K[0];
  ANC[o] += fx * (d1 - d0);
  ANC[o + 2] += fz * (d1 - d0);
  ANC[o + 1] = typ === 2 ? JB[7] : K[0];
  ANC_T[k] = typ;
}

/**
 * Pied posé k : son lacet reste figé tant que l'écart avec le bassin ne dépasse pas lacetMax ; au-delà, il pivote du
 * surplus sur un point fixe du sol — la plante (base des orteils) quand il est à plat, son ancre (talon, base des
 * orteils) sinon. Aucun point du pied ne glisse : il tourne autour d'un point posé.
 */
function pivoterPlante(k) {
  let d = S[LOWYAW] - PSI[k];
  d -= Math.round(d / TWO_PI) * TWO_PI;
  const lim = PF[F_LAC];
  let ex = K[0];
  if (d > lim) ex = d - lim;
  else if (d < -lim) ex = d + lim;
  else return;
  const o = k * 3;
  if (ANC_T[k] === 1) {
    const l = JB[6];
    const bx = ANC[o] + Math.sin(PSI[k]) * mesh.scale.x * l;
    const bz = ANC[o + 2] + Math.cos(PSI[k]) * mesh.scale.z * l;
    PSI[k] += ex;
    ANC[o] = bx - Math.sin(PSI[k]) * mesh.scale.x * l;
    ANC[o + 2] = bz - Math.cos(PSI[k]) * mesh.scale.z * l;
  } else PSI[k] += ex;
}

/**
 * Cinématique inverse de la jambe k vers CIB (cheville, monde) : cuisse (x, z) et genou. Les pivots du modèle ne sont
 * pas alignés (genou 1 cm devant la hanche, cheville 1 cm derrière le genou) : angles corrigés de JB[2], JB[3].
 */
function resoudre(k) {
  const cuisse = k === 0 ? bones.jambe_g : bones.jambe_d;
  const tibia = k === 0 ? bones.tibia_g : bones.tibia_d;
  const o = k * 3;
  const a = JB[0];
  const b = JB[1];
  tmpB.setFromMatrixPosition(cuisse.matrixWorld);
  tmpA.set(CIB[o] - tmpB.x, CIB[o + 1] - tmpB.y, CIB[o + 2] - tmpB.z);
  // repère du maillage, ÉCHELLE comprise (tassement de l'arrêt, réception, respiration : sans elle la cheville manquait
  // sa cible de plusieurs cm) : les longueurs a, b sont celles du modèle
  tmpA.applyQuaternion(qT.copy(mesh.quaternion).invert());
  tmpA.x /= mesh.scale.x;
  tmpA.y /= mesh.scale.y;
  tmpA.z /= mesh.scale.z;
  const L0 = tmpA.length();
  let D = L0;
  if (D > a + b - 1e-4) D = a + b - 1e-4;
  let cb = (a * a + D * D - b * b) / (2 * a * D);
  cb = cb > 1 ? K[1] : cb < -1 ? K[2] : cb;
  const sb = Math.sqrt(1 - cb * cb);
  // plan de flexion : il contient la direction hanche → cheville (t) et l'AVANT du bassin (p, +Z rendu perpendiculaire
  // à t) : le genou ressort devant. Cuisse d = t cos β + p sin β, charnière du genou n = p × t. La rotation de la cuisse
  // est la base exacte (n, d, n × d) ← (X, cuisse du modèle, X × cuisse) : elle porte la TORSION de la cuisse sur son
  // axe (rotation.y) qui aligne la charnière sur n — sans elle, une jambe écartée (pas chassés : cuisse.z ≠ 0) pliait
  // hors du plan et la cheville manquait sa cible (pied d'appui qui glissait) — et le décalage des pivots du modèle
  // (genou 1 cm devant la hanche, cheville 1 cm derrière le genou).
  const tx = tmpA.x / L0;
  const ty = tmpA.y / L0;
  const tz = tmpA.z / L0;
  // avant de la jambe : celui du bassin (+Z du maillage) ; pied POSÉ : l'avant du pied (lacet figé) — le genou reste
  // au-dessus des orteils et c'est la hanche qui tourne quand le bassin tourne
  let fx = K[0];
  let fy = K[0];
  let fz = K[1];
  if (APPUI[k] === 1 && JB[5] === 1) {
    tmpC.x = Math.sin(PSI[k]);
    tmpC.y = K[0];
    tmpC.z = Math.cos(PSI[k]);
    tmpC.applyQuaternion(qT);
    fx = tmpC.x / mesh.scale.x;
    fy = tmpC.y / mesh.scale.y;
    fz = tmpC.z / mesh.scale.z;
  }
  const ft = fx * tx + fy * ty + fz * tz;
  let px = fx - ft * tx;
  let py = fy - ft * ty;
  let pz = fz - ft * tz;
  const pn = Math.sqrt(px * px + py * py + pz * pz);
  px /= pn;
  py /= pn;
  pz /= pn;
  const dx = tx * cb + px * sb;
  const dy = ty * cb + py * sb;
  const dz = tz * cb + pz * sb;
  const nx = py * tz - pz * ty;
  const ny = pz * tx - px * tz;
  const nz = px * ty - py * tx;
  const e = mIK.elements;
  e[0] = nx;
  e[1] = ny;
  e[2] = nz;
  e[4] = dx;
  e[5] = dy;
  e[6] = dz;
  e[8] = ny * dz - nz * dy;
  e[9] = nz * dx - nx * dz;
  e[10] = nx * dy - ny * dx;
  mIK.multiply(mBaseT);
  cuisse.rotation.setFromRotationMatrix(mIK);
  // genou : la direction genou → cheville, dans le repère de la cuisse (Rᵀ), autour de la charnière X
  const sx = tmpA.x - a * dx;
  const sy = tmpA.y - a * dy;
  const sz = tmpA.z - a * dz;
  const r = mIK.elements;
  const cy = r[4] * sx + r[5] * sy + r[6] * sz;
  const cz = r[8] * sx + r[9] * sy + r[10] * sz;
  tibia.rotation.x = Math.atan2(-cz, -cy) - JB[3];
  const q = k * 4;
  IKS[q] = cuisse.rotation.x;
  IKS[q + 1] = cuisse.rotation.z;
  IKS[q + 2] = cuisse.rotation.y;
  IKS[q + 3] = tibia.rotation.x;
}

/**
 * Orientation du pied k : angle THETA[k] en monde dans le lacet de la jambe (axe X du tibia projeté au sol), la
 * cheville compense le tibia ; orteils à TAU[k]. Pendant le dash (poids DB) : angles locaux de ANIM.heros.pied.dash.
 */
function orienter(k) {
  const tibia = k === 0 ? bones.tibia_g : bones.tibia_d;
  const pied = k === 0 ? bones.pied_g : bones.pied_d;
  const ort = k === 0 ? bones.orteils_g : bones.orteils_d;
  if (!pied || !tibia) return;
  if (APPUI[k] === 0) {
    // pied en l'air : lacet de la jambe (axe X du tibia projeté au sol), rejoint en fondu depuis le lacet qu'il avait
    // posé. Pied posé : lacet FIGÉ (fixé à la pose, changé seulement par le pivot sur la plante, piedPose)
    const e = tibia.matrixWorld.elements;
    const lj = Math.atan2(-e[2], e[0]);
    let u = (S[TIME] - LACHE[k]) / PF[F_LAF];
    if (u < 1) {
      let d = lj - PSIL[k];
      d -= Math.round(d / TWO_PI) * TWO_PI;
      u = u * u * (3 - 2 * u);
      PSI[k] = PSIL[k] + d * u;
    } else PSI[k] = lj;
  }
  // pied voulu en monde (lacet de la jambe, angle THETA), ramené dans le repère du tibia : (maillage · cuisse · tibia)⁻¹
  // — produit des quaternions (os sans échelle ; l'échelle du maillage, presque uniforme, garde le sol horizontal).
  // Écrit à la main dans des tableaux typés (§ V : les méthodes de three à arguments flottants allouaient ≈ 40 o/image)
  const cuisse = k === 0 ? bones.jambe_g : bones.jambe_d;
  qmul(QA, mesh.quaternion, cuisse.quaternion);
  qmulA(QA, tibia.quaternion);
  const hy = PSI[k] * 0.5;
  const hx = THETA[k] * 0.5;
  const cy = Math.cos(hy);
  const sy = Math.sin(hy);
  const cx = Math.cos(hx);
  const sx = Math.sin(hx);
  // Qd = Ry(ψ) · Rx(θ) ; local = conj(QA) · Qd
  const dx = cy * sx;
  const dy = sy * cx;
  const dz = -sy * sx;
  const dw = cy * cx;
  const ax = -QA[0];
  const ay = -QA[1];
  const az = -QA[2];
  const aw = QA[3];
  QP[0] = aw * dx + ax * dw + ay * dz - az * dy;
  QP[1] = aw * dy - ax * dz + ay * dw + az * dx;
  QP[2] = aw * dz + ax * dy - ay * dx + az * dw;
  QP[3] = aw * dw - ax * dx - ay * dy - az * dz;
  const db = DB[0];
  if (db > 0) piedDash(k);
  if (APPUI[k] === 1) aplomb(k, tibia);
  // écrit sans appel à arguments flottants (§ V : quaternion.set(x, y, z, w) emballait ses arguments ; mesuré le 14/11,
  // `orienter` ≈ 170–200 o/image en scène D quand la fonction a grossi)
  const q = pied.quaternion;
  q._x = QP[0];
  q._y = QP[1];
  q._z = QP[2];
  q._w = QP[3];
  q._onChangeCallback();
  if (ort) {
    const r = ort.rotation;
    r._x = TAU[k] * (1 - db);
    r._onChangeCallback();
  }
}

const QP = new Float64Array(4); // quaternion local du pied en cours de calcul (orienter, piedDash, aplomb)
/** Dash : quaternion local du pied QP vers l'angle local ANIM.heros.pied.dash (lerp normalisé, poids db). */
function piedDash(k) {
  const db = DB[0];
  const h = (k === 0 ? PF[F_DG] : PF[F_DD]) * 0.5;
  const ch = Math.cos(h);
  const sh = Math.sin(h);
  const s2 = QP[3] * ch + QP[0] * sh < 0 ? K[2] : K[1];
  QP[0] += (sh * s2 - QP[0]) * db;
  QP[1] -= QP[1] * db;
  QP[2] -= QP[2] * db;
  QP[3] += (ch * s2 - QP[3]) * db;
  const n = Math.sqrt(QP[0] * QP[0] + QP[1] * QP[1] + QP[2] * QP[2] + QP[3] * QP[3]);
  QP[0] /= n;
  QP[1] /= n;
  QP[2] /= n;
  QP[3] /= n;
}

/**
 * Pied posé k : l'échelle du maillage (tassement de l'arrêt, réception) n'est pas uniforme et cisaille le pied dès que
 * son lacet n'est pas celui du bassin (semelle inclinée, orteils jusqu'à 5 mm sous le sol). Correction au premier ordre
 * de QP, dans le repère du pied : tangage a (axe X) et roulis b (axe Z) qui remettent l'axe Z du pied à l'angle voulu
 * THETA et son axe X à l'horizontale, mesurés sur la matrice monde du tibia × rotation du pied. QP ← QP · Rx(a) · Rz(b).
 */
function aplomb(k, tibia) {
  const x = QP[0];
  const y = QP[1];
  const z = QP[2];
  const w = QP[3];
  const t = tibia.matrixWorld.elements;
  const x0 = 1 - 2 * (y * y + z * z);
  const x1 = 2 * (x * y + w * z);
  const x2 = 2 * (x * z - w * y);
  const y0 = 2 * (x * y - w * z);
  const y1 = 1 - 2 * (x * x + z * z);
  const y2 = 2 * (y * z + w * x);
  const z0 = 2 * (x * z + w * y);
  const z1 = 2 * (y * z - w * x);
  const z2 = 1 - 2 * (x * x + y * y);
  const exy = t[1] * x0 + t[5] * x1 + t[9] * x2;
  const eyy = t[1] * y0 + t[5] * y1 + t[9] * y2;
  const ezx = t[0] * z0 + t[4] * z1 + t[8] * z2;
  const ezy = t[1] * z0 + t[5] * z1 + t[9] * z2;
  const ezz = t[2] * z0 + t[6] * z1 + t[10] * z2;
  const nz = Math.sqrt(ezx * ezx + ezy * ezy + ezz * ezz);
  const ha = ((ezy + Math.sin(THETA[k]) * nz) / eyy) * 0.5;
  const hb = (-exy / eyy) * 0.5;
  const sa = Math.sin(ha);
  const ca = Math.cos(ha);
  const sb = Math.sin(hb);
  const cb = Math.cos(hb);
  const rx = sa * cb;
  const ry = -sa * sb;
  const rz = ca * sb;
  const rw = ca * cb;
  QP[0] = w * rx + x * rw + y * rz - z * ry;
  QP[1] = w * ry - x * rz + y * rw + z * rx;
  QP[2] = w * rz + x * ry - y * rx + z * rw;
  QP[3] = w * rw - x * rx - y * ry - z * rz;
}

const QA = new Float64Array(4);
/** o = a · b (quaternions de three) dans un tableau typé. */
function qmul(o, a, b) {
  const ax = a._x;
  const ay = a._y;
  const az = a._z;
  const aw = a._w;
  const bx = b._x;
  const by = b._y;
  const bz = b._z;
  const bw = b._w;
  o[0] = ax * bw + aw * bx + ay * bz - az * by;
  o[1] = ay * bw + aw * by + az * bx - ax * bz;
  o[2] = az * bw + aw * bz + ax * by - ay * bx;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
}
/** o = o · b. */
function qmulA(o, b) {
  const ax = o[0];
  const ay = o[1];
  const az = o[2];
  const aw = o[3];
  const bx = b._x;
  const by = b._y;
  const bz = b._z;
  const bw = b._w;
  o[0] = ax * bw + aw * bx + ay * bz - az * by;
  o[1] = ay * bw + aw * by + az * bx - ax * bz;
  o[2] = az * bw + aw * bz + ax * by - ay * bx;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Sommet le plus bas du pied k, orteils compris (monde) → BAS[k]. Matrices des os du pied à jour. */
function basPied(k) {
  const pied = k === 0 ? bones.pied_g : bones.pied_d;
  const ort = k === 0 ? bones.orteils_g : bones.orteils_d;
  const ep = pied.matrixWorld.elements;
  const eo = ort.matrixWorld.elements;
  let m = 1e9;
  const a0 = PVO[k * 2];
  const a1 = PVO[k * 2 + 1];
  const a2 = PVO[k * 2 + 2];
  for (let i = a0; i < a1; i += 3) {
    const y = ep[1] * PV[i] + ep[5] * PV[i + 1] + ep[9] * PV[i + 2] + ep[13];
    if (y < m) m = y;
  }
  for (let i = a1; i < a2; i += 3) {
    const y = eo[1] * PV[i] + eo[5] * PV[i + 1] + eo[9] * PV[i + 2] + eo[13];
    if (y < m) m = y;
  }
  BAS[k] = m;
}

/** Repos : le pied le plus éloigné de sous sa hanche (au-delà du seuil) revient d'un petit pas ; un seul à la fois. */
function recentrer() {
  // § E5.F : pas de fente demandé par un geste (combos.js : geste[20] pied, [21] longueur, [22] durée, [23] compteur) —
  // le pied du côté du coup part vers devant la hanche dans l'axe du coup et se pose à l'impact ; l'autre reste
  if (geste[23] !== PAS_VU[0]) {
    PAS_VU[0] = geste[23];
    const k = geste[20] === 1 ? 0 : 1;
    const o = k * 3;
    const cuisse = k === 0 ? bones.jambe_g : bones.jambe_d;
    // pas si l'autre pied fait déjà un pas (un pied au moins reste posé : mesure des pieds, équilibre)
    if (cuisse && APPUI[k] === 1 && geste[20] > 0 && REC[(1 - k) * 3] < 0 && APPUI[1 - k] === 1 && DECOL[1 - k] === 0) {
      const e = cuisse.matrixWorld.elements;
      REC[o] = S[TIME];
      REC[o + 1] = ANC[o];
      REC[o + 2] = ANC[o + 2];
      RECP[k] = PSI[k];
      RECT[o] = 1;
      RECT[o + 1] = e[12] + Math.sin(geste[8]) * geste[21];
      RECT[o + 2] = e[14] + Math.cos(geste[8]) * geste[21];
      RECD[k] = geste[22];
    }
  }
  let best = -1;
  let dmax = PF[F_SEU];
  const enCours = REC[0] >= 0 || REC[3] >= 0;
  for (let k = 0; k < 2; k++) {
    const cuisse = k === 0 ? bones.jambe_g : bones.jambe_d;
    if (!cuisse || APPUI[k] === 0) continue;
    const o = k * 3;
    const e = cuisse.matrixWorld.elements;
    if (REC[o] >= 0) {
      let u = (S[TIME] - REC[o]) / (RECD[k] > 0 ? RECD[k] : PF[F_DUR]);
      // pendant le petit pas, le pied (levé) reprend aussi le lacet du bassin
      let dl = S[LOWYAW] - RECP[k];
      dl -= Math.round(dl / TWO_PI) * TWO_PI;
      const cx = RECT[o] === 1 ? RECT[o + 1] : e[12]; // § E5.F : pas de fente = cible fixe devant
      const cz = RECT[o] === 1 ? RECT[o + 2] : e[14];
      if (u >= 1) {
        ANC[o] = cx;
        ANC[o + 2] = cz;
        PSI[k] = RECP[k] + dl;
        REC[o] = -1;
        RECT[o] = 0;
        RECD[k] = 0;
      } else {
        u = u * u * (3 - 2 * u);
        ANC[o] = REC[o + 1] + (cx - REC[o + 1]) * u;
        ANC[o + 2] = REC[o + 2] + (cz - REC[o + 2]) * u;
        PSI[k] = RECP[k] + dl * u;
      }
      continue;
    }
    const dx = ANC[o] - e[12];
    const dz = ANC[o + 2] - e[14];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (!enCours && d > dmax) {
      dmax = d;
      best = k;
    }
  }
  if (best >= 0) {
    const o = best * 3;
    RECT[o] = 0; // § E5.F : recentrage ordinaire (cible : sous la hanche)
    RECD[best] = 0;
    REC[o] = S[TIME];
    REC[o + 1] = ANC[o];
    REC[o + 2] = ANC[o + 2];
    RECP[best] = PSI[best];
  }
}

// PIED POSÉ (même méthode que le boss) : au début de l'appui, une ANCRE est fixée au sol ; pendant l'appui, cuisse et
// genou (hanche → genou → cheville) sont calculés pour que la cheville soit là où le pied, roulé de THETA autour de
// son ancre, la met ; le bassin descend s'il le faut. Marche avant, arrière, pas chassés, fondus entre états, pivot sur
// place, repos : le pied d'appui ne glisse pas. La jambe libre reste procédurale et quitte la solution d'appui en
// fondu ; un pied en l'air ne passe jamais sous le sol. mode : 0 aucun appui (dash, réception), 1 marche, 2 repos.
function piedPose(mode) {
  mesh.updateMatrixWorld(true);
  const a = JB[0];
  const b = JB[1];
  const avecPied = JB[5] === 1;
  // 1. ancres : pose (début d'appui) ou changement de pivot
  for (let k = 0; k < 2; k++) {
    const cuisse = k === 0 ? bones.jambe_g : bones.jambe_d;
    const tibia = k === 0 ? bones.tibia_g : bones.tibia_d;
    if (!cuisse || !tibia) continue;
    const o = k * 3;
    // § E4.J : la jambe qui donne le coup de pied n'est pas un appui (elle frappe en l'air)
    const appui = (mode === 1 ? PH[k] < 1 : mode === 2) && !(KW[0] > 0.001 && KW[1] === k);
    if (!appui) {
      if (APPUI[k] === 1) {
        APPUI[k] = 0;
        LACHE[k] = S[TIME];
        PSIL[k] = PSI[k];
      }
      // § E5.G : retour de jambe en marche ; dash, vrille en l'air, réception (mode 0) : aucun pas à la reprise d'appui
      if (mode !== 1) RETOUR[k] = 0;
      else if (PH[k] >= 1) RETOUR[k] = 1;
      REC[o] = -1;
      continue;
    }
    const th = THETA[k];
    const typ = th < -1e-4 ? 0 : th > 1e-4 ? 2 : 1;
    if (APPUI[k] === 0) {
      // cheville de la pose procédurale → ancre du pivot courant, au sol ; le lacet du pied est figé à celui de la jambe
      if (avecPied) {
        tmpA.setFromMatrixPosition((k === 0 ? bones.pied_g : bones.pied_d).matrixWorld);
        const e = tibia.matrixWorld.elements;
        PSI[k] = Math.atan2(-e[2], e[0]);
      } else tibia.localToWorld(tmpA.copy(SEMELLE));
      decalage(k, typ);
      ANC[o] = tmpA.x - Math.sin(PSI[k]) * mesh.scale.x * FU[0];
      ANC[o + 2] = tmpA.z - Math.cos(PSI[k]) * mesh.scale.z * FU[0];
      ANC[o + 1] = typ === 2 ? JB[7] : K[0];
      ANC_T[k] = typ;
      APPUI[k] = 1;
      REC[o] = -1;
      if (avecPied) pivoterPlante(k);
      // § E5.G : le pied touche le sol au bout de son retour → un pas (son : pas-agents.js)
      if (mode === 1 && RETOUR[k] === 1) {
        pas[1] = ANC[o];
        pas[2] = ANC[o + 2];
        pas[3] = S[GAIT];
        pas[0] += 1;
      }
      RETOUR[k] = 0;
    } else if (typ !== ANC_T[k]) convertir(k, typ);
    // le pied pivote sur son point d'appui ; pas à l'image où ce point change (le pied roule : les sommets au sol ne
    // sont pas encore ceux du nouveau point — mesuré : orteils balayés de 3 cm quand le talon devenait le pivot)
    else if (avecPied && REC[o] < 0) pivoterPlante(k);
  }
  if (mode === 2) recentrer();
  // 2. chevilles d'appui : bassin, portée, cinématique inverse ; jambes libres : fondu depuis la dernière solution
  let desc = K[0];
  for (let k = 0; k < 2; k++) {
    const cuisse = k === 0 ? bones.jambe_g : bones.jambe_d;
    const tibia = k === 0 ? bones.tibia_g : bones.tibia_d;
    if (!cuisse || !tibia) continue;
    const o = k * 3;
    if (APPUI[k] === 0) {
      if (mode !== 0) {
        let u = (S[TIME] - LACHE[k]) / PF[F_FON];
        if (u < 1) {
          u = u * u * (3 - 2 * u);
          const q = k * 4;
          cuisse.rotation.x = IKS[q] + (cuisse.rotation.x - IKS[q]) * u;
          cuisse.rotation.z = IKS[q + 1] + (cuisse.rotation.z - IKS[q + 1]) * u;
          cuisse.rotation.y = IKS[q + 2] + (cuisse.rotation.y - IKS[q + 2]) * u;
          tibia.rotation.x = IKS[q + 3] + (tibia.rotation.x - IKS[q + 3]) * u;
        }
      }
      continue;
    }
    decalage(k, ANC_T[k]);
    // le pied est à l'échelle du maillage (tassement de l'arrêt, réception) : décalages mis à l'échelle, sinon la
    // semelle flottait (ou s'enfonçait) d'autant
    const fx = Math.sin(PSI[k]) * mesh.scale.x;
    const fz = Math.cos(PSI[k]) * mesh.scale.z;
    CIB[o] = ANC[o] + fx * FU[0];
    CIB[o + 1] = (ANC[o + 1] + FU[1]) * mesh.scale.y;
    CIB[o + 2] = ANC[o + 2] + fz * FU[0];
    if (REC[o] >= 0) {
      const u = (S[TIME] - REC[o]) / (RECD[k] > 0 ? RECD[k] : PF[F_DUR]); // § E5.F : durée du pas de fente
      if (u < 1) CIB[o + 1] += PF[F_LEV] * Math.sin(Math.PI * u); // petit pas (ou pas de fente) : le pied se lève
    }
    tmpB.setFromMatrixPosition(cuisse.matrixWorld);
    const hx = CIB[o] - tmpB.x;
    const hz = CIB[o + 2] - tmpB.z;
    const L = (a + b) * 0.985 * mesh.scale.y;
    const h2 = hx * hx + hz * hz;
    // descente voulue pour garder la cheville à portée ; au-delà de la portée horizontale, la plus grande (hanche à la
    // hauteur de la cheville). Bornée à descenteMax et CONTINUE : avant le 14/11, elle sautait à zéro dès que le pied
    // passait hors de portée horizontale — le bassin remontait d'un coup et le pied d'appui était tiré en l'air (22 cm)
    // pendant une image, aux changements de direction
    const dk = h2 < L * L ? CIB[o + 1] + Math.sqrt(L * L - h2) - tmpB.y : CIB[o + 1] - tmpB.y;
    if (-dk > desc) desc = -dk;
  }
  // le bassin descend UNE fois, pour la jambe qui en demande le plus, AVANT de résoudre les deux jambes (avant le 14/11 :
  // descendu pour la jambe droite après que la gauche était résolue, le pied gauche s'enfonçait d'autant — 8 mm mesurés
  // à l'arrêt)
  if (desc > 0) {
    mesh.position.y -= desc > PF[F_DMX] ? PF[F_DMX] : desc;
    mesh.updateMatrixWorld(true);
  }
  for (let k = 0; k < 2; k++) {
    const cuisse = k === 0 ? bones.jambe_g : bones.jambe_d;
    if (!cuisse || APPUI[k] === 0) continue;
    const o = k * 3;
    tmpB.setFromMatrixPosition(cuisse.matrixWorld);
    // portée, dans le repère du maillage (échelle comprise : longueurs du modèle)
    tmpA.set(CIB[o] - tmpB.x, CIB[o + 1] - tmpB.y, CIB[o + 2] - tmpB.z);
    qD.copy(mesh.quaternion).invert();
    tmpA.applyQuaternion(qD);
    tmpA.x /= mesh.scale.x;
    tmpA.y /= mesh.scale.y;
    tmpA.z /= mesh.scale.z;
    const Dw = tmpA.length();
    const portee = (a + b) * 0.995;
    DECOL[k] = 0;
    if (Dw > portee) {
      // hors d'atteinte (fin d'appui dans un virage serré, téléportation) : la jambe se tend vers l'ancre et le pied
      // décolle en la suivant — l'ancre ne bouge pas (avant le 14/11 elle était déplacée : le pied, tiré en l'air,
      // retombait à l'image suivante). Le pied reprend son retour à la fin de l'appui
      tmpA.multiplyScalar(portee / Dw);
      tmpA.x *= mesh.scale.x;
      tmpA.y *= mesh.scale.y;
      tmpA.z *= mesh.scale.z;
      tmpA.applyQuaternion(mesh.quaternion);
      CLAMP[0]++;
      DECOL[k] = 1;
      CIB[o] = tmpB.x + tmpA.x;
      CIB[o + 1] = tmpB.y + tmpA.y;
      CIB[o + 2] = tmpB.z + tmpA.z;
    }
    resoudre(k);
  }
  S[DESC] = desc;
  mesh.updateMatrixWorld(true);
  if (!avecPied) return;
  // 2 bis. fin du retour (marche) : garde au sol, puis descente vers le point de pose. Horizontalement la cheville suit
  // la pose procédurale (la cuisse s'y rétracte : vitesse au sol nulle à la pose) ; verticalement, hauteur de pose yc
  // (talon au sol à l'attaque, base des orteils en marche arrière, semelle à plat de côté) + garde au sol qui ne
  // s'efface qu'en fin de retour (le pied ne descend que lorsqu'il ralentit) — courbe douce : il touche le sol à la pose
  if (mode === 1 && CR_ON[0] === 0) {
    const hau = PF[F_HAU] * (S[PIVOT] === 1 ? K[1] : S[GAIT] < 1 ? S[GAIT] : K[1]);
    for (let k = 0; k < 2; k++) {
      const s = PH[k] - 1;
      if (APPUI[k] === 1 || s <= PF[F_APP]) continue;
      let e = (s - PF[F_POS]) / (1 - PF[F_POS]);
      e = e < 0 ? K[0] : e > 1 ? K[1] : e * e * (3 - 2 * e);
      const th = THETA[k];
      const typ = th < -1e-4 ? 0 : th > 1e-4 ? 2 : 1;
      decalage(k, typ);
      const yc = ((typ === 2 ? JB[7] : K[0]) + FU[1]) * mesh.scale.y;
      const o = k * 3;
      tmpA.setFromMatrixPosition((k === 0 ? bones.pied_g : bones.pied_d).matrixWorld);
      let y = tmpA.y + (yc - tmpA.y) * e;
      const garde = yc + hau * (1 - e);
      if (y < garde) y = garde;
      CIB[o] = tmpA.x;
      CIB[o + 1] = y;
      CIB[o + 2] = tmpA.z;
      resoudre(k);
    }
    mesh.updateMatrixWorld(true);
  }
  // 3. pieds : à plat ou roulés (la cheville compense), puis aucun pied en l'air sous le sol
  orienter(0);
  orienter(1);
  mesh.updateMatrixWorld(true);
  for (let k = 0; k < 2; k++) {
    if (APPUI[k] === 1) continue;
    const pied = k === 0 ? bones.pied_g : bones.pied_d;
    // deux passes au plus : pendant le dash et la réception, le pied suit en partie le tibia (angles locaux), il
    // tourne quand la jambe se relève
    for (let n = 0; n < 3; n++) {
      basPied(k);
      if (BAS[k] >= PF[F_MAR] - 0.001) break;
      const o = k * 3;
      tmpA.setFromMatrixPosition(pied.matrixWorld);
      CIB[o] = tmpA.x;
      CIB[o + 1] = tmpA.y + PF[F_MAR] - BAS[k];
      CIB[o + 2] = tmpA.z;
      resoudre(k);
      (k === 0 ? bones.jambe_g : bones.jambe_d).updateMatrixWorld(true);
      orienter(k);
      pied.updateMatrixWorld(true);
    }
  }
  mesh.updateMatrixWorld(true);
}

/**
 * Mesures (après la pose) : vitesse du point d'appui de chaque pied (talon, cheville projetée ou base des orteils selon
 * la phase, comparé au MÊME point à l'image précédente), hauteurs de la semelle — voir mesurePieds.
 */
function piedsMesure() {
  const dt = S[FRAME_DT];
  let vmin = 1e9;
  let k0 = -1;
  mesurePieds[6] = 1e9;
  for (let k = 0; k < 2; k++) {
    const pied = k === 0 ? bones.pied_g : bones.pied_d;
    const tibia = k === 0 ? bones.tibia_g : bones.tibia_d;
    if (!tibia) continue;
    const typ = APPUI[k] === 1 ? ANC_T[k] : 1;
    const r = k * 9;
    let v = 0;
    for (let j = 0; j < 3; j++) {
      // j = 0 talon (au sol, sous l'arrière du pied), 1 projection de la cheville, 2 base des orteils
      let x;
      let z;
      if (pied) {
        const e = j === 2 ? (k === 0 ? bones.orteils_g : bones.orteils_d).matrixWorld.elements : pied.matrixWorld.elements;
        const ly = j === 2 ? K[0] : -JB[4];
        const lz = j === 0 ? TALON[k] : K[0];
        x = e[4] * ly + e[8] * lz + e[12];
        z = e[6] * ly + e[10] * lz + e[14];
      } else {
        const e = tibia.matrixWorld.elements;
        x = e[4] * SEMELLE.y + e[12];
        z = e[6] * SEMELLE.y + e[14];
      }
      if (j === typ) {
        const ex = x - REF[r + j * 3];
        const ez = z - REF[r + j * 3 + 2];
        v = dt > 0 ? Math.sqrt(ex * ex + ez * ez) / dt : K[0];
      }
      REF[r + j * 3] = x;
      REF[r + j * 3 + 2] = z;
    }
    if (v < vmin) vmin = v;
    const posee = APPUI[k] === 1 && DECOL[k] === 0 ? 1 : 0;
    VAPPUI[k] = posee === 1 && APPUI_PREC[k] === 1 ? v : NaN;
    APPUI_PREC[k] = posee;
    if (pied) {
      basPied(k);
      if (BAS[k] < mesurePieds[6]) mesurePieds[6] = BAS[k];
    }
    if (APPUI[k] === 1 && DECOL[k] === 0 && (k0 < 0 || REC[k0 * 3] >= 0)) k0 = k;
  }
  mesurePieds[0] = vmin;
  mesurePieds[1] = S[LOCO];
  mesurePieds[2] = Math.sqrt(P.vx * P.vx + P.vz * P.vz);
  if (k0 < 0 || JB[5] !== 1) {
    for (let i = 3; i < 9; i++) if (i !== 6) mesurePieds[i] = NaN;
    mesurePieds[5] = -1;
    mesurePieds[9] = -1;
    mesurePieds[10] = NaN;
    return;
  }
  const ep = (k0 === 0 ? bones.pied_g : bones.pied_d).matrixWorld.elements;
  let lo = 1e9;
  let hi = -1e9;
  for (let j = 0; j < 4; j++) {
    const q = k0 * 18 + j * 3;
    const y = ep[1] * ECH[q] + ep[5] * ECH[q + 1] + ep[9] * ECH[q + 2] + ep[13];
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  mesurePieds[3] = BAS[k0];
  mesurePieds[4] = hi - lo;
  mesurePieds[5] = ANC_T[k0];
  mesurePieds[7] = THETA[k0];
  mesurePieds[8] = TAU[k0];
  mesurePieds[9] = k0;
  mesurePieds[10] = VAPPUI[k0];
}

// ===== COURSE DE RÉFÉRENCE (16/11/2026, Running.fbx de Femz : « des réf plus précises, même pour les héros ») =========
// Cuisse, genou, pied, orteils et hauteur du bassin suivent les courbes COURSE de src/anim/ref-marche.js selon la
// position dans le cycle (jambe droite décalée d'un demi-cycle). Le système de pieds ci-dessus (ancres, déroulé, garde au
// sol, cinématique inverse du pied d'appui) ne change pas : seule la phase PH[k] est recalée sur la part d'appui de la
// réf (29 % : la course a une phase de vol). Marche arrière : la course jouée à l'envers (sans glissement elle aussi) ;
// chassés : amplitude des cuisses réduite comme avant (S[AMPL]) ; pivot sur place : ancien système. CALAGE DE PHASE
// (comme le boss) : le cycle accélère quand la cheville d'appui clouée est en retard sur la pose de la réf, ralentit sinon.
// Réglages : ANIM.corps.courseRef, calagePhase.
const DEG = Math.PI / 180;
const CR_N = COURSE.n;
const CR_AP = COURSE.appui;
const CR_C = Float64Array.from(COURSE.cuisse, (v) => v * DEG);
const CR_G = Float64Array.from(COURSE.genou, (v) => v * DEG);
const CR_P = Float64Array.from(COURSE.pied, (v) => v * DEG);
const CR_O = Float64Array.from(COURSE.orteils, (v) => v * DEG);
const CR_B = Float64Array.from(COURSE.bassin);
const CR_MID = ((Math.max(...COURSE.cuisse) + Math.min(...COURSE.cuisse)) / 2) * DEG; // milieu du balancier (bras)
const CR_IN = new Float64Array(9); // entrées (§ V : pas de flottants en arguments) : w lu, puis u, g, wk, db, ca, sa, chasse, sc
const CRP = new Float64Array(5); // pose lue : cuisse, genou, pied, orteils (rad), bassin (longueurs de jambe)
const CR_X = new Float64Array(2); // cheville de la pose de réf, devant la hanche dans le sens du déplacement (m)
const CR_L = new Float64Array(5); // sorties : balancier g, d (rad), bassin (m), PH g, PH d
const CR_DCYC = new Float64Array([2.5]); // m parcourus par cycle (calerCourse)
const CR_H = new Float64Array([0, 1.107]); // hanche moyenne en course, hanche debout (m)
const CR_ECART = new Float64Array(1); // cheville clouée − cheville de la réf (m), moyenne des pieds d'appui
// hauteur de la hanche sur le cycle (m, 96 points) : pendant chaque appui, celle qu'impose la pose de réf de la jambe
// d'appui (cheville à sa hauteur d'appui) ; pendant le vol, la courbe du bassin de la réf, raccordée aux deux bouts.
// (La courbe du bassin seule, sur les proportions du héros, mettait la cheville d'appui 2 cm sous le sol au contact et
// 2 cm au-dessus au décollage : genou trop plié puis trop tendu.)
const CR_M = 96;
const CR_HC = new Float64Array(CR_M);
const CR_ARR = new Uint8Array(1); // course jouée à l'envers à l'image précédente
const CR_ON = new Uint8Array(1); // course de référence active à cette image (piedPose : pas d'approche du pied)

/** Pose de la réf à la position CR_IN[0] ∈ [0, 1) du cycle (interpolation linéaire, cycle bouclé) → CRP. */
function lireCourse() {
  const w = CR_IN[0];
  const x = (w - Math.floor(w)) * CR_N;
  const i = Math.floor(x) % CR_N;
  const j = (i + 1) % CR_N;
  const f = x - Math.floor(x);
  CRP[0] = CR_C[i] + (CR_C[j] - CR_C[i]) * f;
  CRP[1] = CR_G[i] + (CR_G[j] - CR_G[i]) * f;
  CRP[2] = CR_P[i] + (CR_P[j] - CR_P[i]) * f;
  CRP[3] = CR_O[i] + (CR_O[j] - CR_O[i]) * f;
  CRP[4] = CR_B[i] + (CR_B[j] - CR_B[i]) * f;
}

/** Hauteur de la cheville au-dessus du sol pour un pied d'appui d'angle th (talon, à plat ou base des orteils au sol). */
function chevilleAppui(th) {
  const s = Math.sin(th);
  const c = Math.cos(th);
  if (th < 0) return JB[4] * c + TALON[0] * s;
  if (th > 0) return (JB[4] - JB[7]) * c + JB[6] * s + JB[7];
  return JB[4];
}

/** Init (après mesurerJambes) : hauteur moyenne de la hanche en course et longueur du cycle, sur les jambes du modèle. */
function calerCourse() {
  const a = JB[0];
  const b = JB[1];
  CR_H[1] = JB[4] + a * Math.cos(JB[2]) + b * Math.cos(JB[3]);
  let h = 0;
  let m = 0;
  for (let i = 0; i / CR_N < CR_AP; i++) {
    CR_IN[0] = i / CR_N;
    lireCourse();
    h += chevilleAppui(CRP[2]) + a * Math.cos(CRP[0]) + b * Math.cos(CRP[0] - CRP[1]) - CRP[4] * (a + b);
    m++;
  }
  CR_H[0] = h / m;
  // hanche voulue sur le cycle : appui de la jambe g [0, ap), de la jambe d [0,5, 0,5 + ap) ; vol : bassin + correction
  // interpolée entre la fin d'un appui et le début du suivant
  const hipAppui = (w) => {
    CR_IN[0] = w;
    lireCourse();
    return chevilleAppui(CRP[2]) + a * Math.cos(CRP[0]) + b * Math.cos(CRP[0] - CRP[1]);
  };
  const hipBassin = (w) => {
    CR_IN[0] = w;
    lireCourse();
    return CR_H[0] + CRP[4] * (a + b);
  };
  const cFin = hipAppui(CR_AP) - hipBassin(CR_AP); // fin d'appui g (et d, décalée d'un demi-cycle)
  const cDeb = hipAppui(0) - hipBassin(0.5); // début d'appui d à 0,5 (même pose que g à 0)
  const cDeb0 = hipAppui(0) - hipBassin(0);
  for (let i = 0; i < CR_M; i++) {
    const w = i / CR_M;
    if (w < CR_AP) CR_HC[i] = hipAppui(w);
    else if (w >= 0.5 && w < 0.5 + CR_AP) CR_HC[i] = hipAppui(w - 0.5);
    else {
      const debut = w < 0.5 ? CR_AP : 0.5 + CR_AP;
      const fin = w < 0.5 ? 0.5 : 1;
      const f = (w - debut) / (fin - debut);
      const c0 = w < 0.5 ? cFin : hipAppui(CR_AP) - hipBassin(0.5 + CR_AP);
      const c1 = w < 0.5 ? cDeb : cDeb0;
      CR_HC[i] = hipBassin(w) + c0 + (c1 - c0) * f;
    }
  }
  // pendant l'appui, le corps avance de ce que la cheville recule sous la hanche + ce qu'elle avance quand le pied roule
  // sur la base des orteils ; le cycle avance de 2π pendant ce trajet / part d'appui
  CR_IN[0] = 0;
  lireCourse();
  const x0 = a * Math.sin(CRP[0]) + b * Math.sin(CRP[0] - CRP[1]);
  CR_IN[0] = CR_AP * 0.98;
  lireCourse();
  const x1 = a * Math.sin(CRP[0]) + b * Math.sin(CRP[0] - CRP[1]);
  const p = CRP[2] > 0 ? CRP[2] : 0;
  const roule = JB[6] * (1 - Math.cos(p)) + (JB[4] - JB[7]) * Math.sin(p);
  const d = x0 - x1 + roule;
  CR_DCYC[0] = d > 0.2 ? d / CR_AP : 2.5;
}

/** Angles des jambes (angX, angZ), pieds (THETA, TAU) et sorties CR_L ; entrées dans CR_IN[1..8] : position u du
 *  cycle, allure g, poids de la marche wk et du dash db, cos / sin de la direction du pas, écart des chassés, amplitude. */
function poseCourse() {
  const u = CR_IN[1];
  const g = CR_IN[2];
  const wk = CR_IN[3];
  const db = CR_IN[4];
  const ca = CR_IN[5];
  const sa = CR_IN[6];
  const chasse = CR_IN[7];
  const sc = CR_IN[8];
  const a = JB[0];
  const b = JB[1];
  const arr = CR_ARR[0] === 1; // marche arrière : la course jouée à l'envers
  const ecart = JB[2] + JB[3]; // flexion du genou au repos (pivots du modèle)
  for (let k = 0; k < 2; k++) {
    let uk = u + k * 0.5;
    uk -= Math.floor(uk);
    let w = arr ? CR_AP - uk : uk;
    w -= Math.floor(w);
    CR_IN[0] = w;
    lireCourse();
    const th = CRP[0] * g * (sc < 1 ? sc : K[1]);
    const kp = CRP[1] * g;
    const thm = arr ? -th : th; // cuisse le long du déplacement
    const ij = k === 0 ? JG : JD;
    const it = k === 0 ? TG : TD;
    const ch = k === 0 ? chasse : -chasse;
    // la cuisse de la réf penche en moyenne de CR_MID vers l'avant (le genou monte DEVANT) : ce biais reste dans l'axe
    // du corps, seule l'oscillation osc suit la direction du pas α — en chassés, appliqué de côté, il poussait les deux
    // jambes du même côté et elles se croisaient. Avant / arrière : identique (tx = th).
    const biais = CR_MID * g * (sc < 1 ? sc : K[1]);
    const osc = thm - (arr ? -biais : biais);
    const tx = osc * ca + biais; // cuisse dans l'axe du corps (+ = en avant)
    const tz = osc * sa; // cuisse sur le côté
    // cuisse en monde = tx (le pivot du genou est en avant de la hanche de JB[2] au repos) ; genou : flexion kp
    angX[ij] = (g * JB[2] - tx) * wk + (k === 0 ? -0.55 : 0.45) * db - S[LEAN] * wk;
    angZ[ij] = (tz + ch) * wk - S[ROLL] * wk;
    angX[it] = (kp - g * ecart) * wk + (k === 0 ? 0.5 : 0.9) * db;
    // cheville de la pose de réf, devant la hanche le long du déplacement (axe du corps × cos α + côté × sin α)
    const fx = a * Math.sin(tx) + b * Math.sin(tx - kp);
    const fz = Math.sin(tz) * (a * Math.cos(tx) + b * Math.cos(tx - kp));
    CR_X[k] = fx * ca + fz * sa;
    CR_L[k] = osc;
    const appui = uk < CR_AP;
    const t = CRP[2] * g * wk;
    THETA[k] = t;
    TAU[k] = appui ? (t > 0 ? -t : K[0]) : -CRP[3] * g * wk; // au sol : orteils à plat ; en l'air : pli de la réf
    CR_L[3 + k] = appui ? uk / CR_AP : 1 + (uk - CR_AP) / (1 - CR_AP);
  }
  // bassin (cycle de la jambe gauche ; marche arrière : lu à l'envers comme les jambes)
  let w0 = arr ? CR_AP - u : u;
  w0 -= Math.floor(w0);
  const x = w0 * CR_M;
  const i = Math.floor(x) % CR_M;
  const f = x - Math.floor(x);
  CR_L[2] = (CR_HC[i] + (CR_HC[(i + 1) % CR_M] - CR_HC[i]) * f - CR_H[1]) * g;
}

/** Après piedPose : écart (m) entre la cheville d'appui clouée et celle de la pose de réf, le long du déplacement. */
function ecartCourse() {
  const vx = P.vx;
  const vz = P.vz;
  const n = Math.sqrt(vx * vx + vz * vz);
  let e = K[0];
  let m = 0;
  if (n > 0.5) {
    for (let k = 0; k < 2; k++) {
      if (APPUI[k] === 0 || DECOL[k] === 1 || PH[k] >= 1) continue;
      const cuisse = k === 0 ? bones.jambe_g : bones.jambe_d;
      tmpB.setFromMatrixPosition(cuisse.matrixWorld);
      const o = k * 3;
      e += ((CIB[o] - tmpB.x) * vx + (CIB[o + 2] - tmpB.z) * vz) / n - CR_X[k] * mesh.scale.y;
      m++;
    }
  }
  CR_ECART[0] = m > 0 ? e / m : K[0];
}

function pose() {
  const g = S[GAIT];
  const ph = S[PHASE];
  const dashing = P.dashT > 0;
  // poids de la pose de dash (montée immédiate, retour en 0,15 s)
  // (montée en 40 ms : une pose qui saute d'un coup entre deux images serait vue différemment par la cape à 60 et
  // à 240 Hz, qui interpole le corps entre deux images)
  const db = dashing ? (S[DASH_EL] < 0.04 ? S[DASH_EL] / 0.04 : 1) : S[LAND_T] < 0.15 ? 1 - S[LAND_T] / 0.15 : 0;
  const wk = 1 - db;
  // ----- jambes : onde « triangle » (appui linéaire = pied immobile au sol), dans la direction du pas α (repère du
  // bassin) : avant, arrière (cycle inversé de lui-même : cos α < 0), côté (chassés : écartées, sans se croiser)
  const Am = S[AMPL];
  let t = (ph / Math.PI) % 2;
  if (t < 0) t += 2;
  const tg = t;
  const td = t < 1 ? t + 1 : t - 1;
  // u = position du pied le long du pas, −1..1 (linéaire pendant l'appui) ; angle de cuisse = asin(u × sin A) / A, rapporté
  // à A (multiplié par Am plus bas) : le pied d'appui recule exactement à la vitesse du corps
  // retour (s = t − 1) : courbe d'Hermite de −1 à 1 dont la pente aux deux bouts est celle de l'appui (−2) — le pied
  // finit le retour en reculant à la vitesse du corps (la cuisse se rétracte, 9 % de dépassement) : vitesse au sol nulle
  // à la pose comme au décollage (avant le 14/11 : pente nulle, le pied arrivait à la vitesse du corps)
  const sg = tg - 1;
  const sd = td - 1;
  const ug = tg < 1 ? 1 - 2 * tg : ((-8 * sg + 12) * sg - 2) * sg - 1;
  const ud = td < 1 ? 1 - 2 * td : ((-8 * sd + 12) * sd - 2) * sd - 1;
  const sA = Math.sin(S[AMPL]);
  let lg = S[AMPL] > 1e-3 ? Math.asin(ug * sA) / S[AMPL] : ug;
  let ld = S[AMPL] > 1e-3 ? Math.asin(ud * sA) / S[AMPL] : ud;
  const pivot = S[LOCO] === 3;
  const gl = pivot ? (S[PIVOT] === 1 ? 1 : 0) : g;
  const ca = Math.cos(S[ALPHA]);
  const sa = Math.sin(S[ALPHA]);
  const chasse = S[LOCO] === 1 ? C.ecartChasses * (sa < 0 ? -sa : sa) : 0;
  // le penché et le roulis de la racine pivotent au sol : compensés aux hanches (sinon le pied d'appui glisse)
  angX[JG] = (-Am * lg * ca * gl) * wk - 0.55 * db - S[LEAN] * wk;
  angZ[JG] = (Am * lg * sa * gl + chasse) * wk - S[ROLL] * wk;
  angX[JD] = (-Am * ld * ca * gl) * wk + 0.45 * db - S[LEAN] * wk;
  angZ[JD] = (Am * ld * sa * gl - chasse) * wk - S[ROLL] * wk;
  // genou : la jambe libre plie (retour), la jambe d'appui reste presque tendue
  // genou du retour : se plie vite au décollage, au plus plié à 40 % du retour, tendu (à vitesse nulle) dès 85 % — la
  // fin du retour ne doit qu'à la cuisse (avant : pente −π × genou à la pose, le pied fouettait vers l'avant à ≈ 12 m/s
  // par rapport au bassin au moment de toucher le sol)
  const kg = tg < 1 || sg >= 0.85 ? K[0] : sg < 0.4 ? Math.sin(Math.PI * sg / 0.8) : 0.5 + 0.5 * Math.cos((Math.PI * (sg - 0.4)) / 0.45);
  const kd = td < 1 || sd >= 0.85 ? K[0] : sd < 0.4 ? Math.sin(Math.PI * sd / 0.8) : 0.5 + 0.5 * Math.cos((Math.PI * (sd - 0.4)) / 0.45);
  angX[TG] = (C.genou * kg + 0.06) * gl * wk + 0.5 * db;
  angX[TD] = (C.genou * kd + 0.06) * gl * wk + 0.9 * db;
  const aAppui = Am * (tg < 1 ? lg : ld) * gl; // angle de la cuisse d'appui
  // ----- pieds : angle en monde (+ = pointe vers le bas) et orteils, selon la phase de chaque jambe. Le déroulé est
  // écrit pour la marche AVANT (temps w) ; en marche arrière (cos α < 0) il est joué à l'envers (w = 1 − part).
  // Amplitude : part avant / arrière du pas × allure × amplitude du pas (petits pas du pivot : déroulé réduit).
  {
    const sp = S[AMPL] / C.amplitude[0];
    const mp = gl * wk * (sp < 1 ? sp : 1) * (ca < 0 ? -ca : ca);
    for (let k = 0; k < 2; k++) {
      const t = k === 0 ? tg : td;
      let th = K[0];
      let tau = K[0];
      if (t < 1) {
        const w = ca >= 0 ? t : 1 - t;
        if (w < PF[F_ATT]) {
          const q = w / PF[F_ATT];
          th = -PF[F_TAL] * (1 - q * q * (3 - 2 * q)); // attaque du talon : la pointe se pose
        } else if (w > PF[F_DEC]) {
          const q = (w - PF[F_DEC]) / (1 - PF[F_DEC]);
          th = PF[F_POU] * q * q; // poussée : le talon se lève
        }
        th *= mp;
        tau = th > 0 ? -th : K[0]; // orteils à plat au sol
      } else {
        const w = ca >= 0 ? t - 1 : 2 - t;
        if (w < 0.5) {
          const q = w * 2;
          th = PF[F_POU] + (-PF[F_DEG] - PF[F_POU]) * q * q * (3 - 2 * q);
        } else {
          const q = (w - 0.5) * 2;
          th = -PF[F_DEG] + (PF[F_DEG] - PF[F_TAL]) * q * q * (3 - 2 * q);
        }
        if (w < PF[F_REL]) {
          const q = w / PF[F_REL];
          tau = -PF[F_POU] * (1 - q * q * (3 - 2 * q));
        }
        th *= mp;
        tau *= mp;
      }
      THETA[k] = th;
      TAU[k] = tau;
    }
  }
  // course de référence : remplace jambes, pieds et bassin calculés ci-dessus (pivot sur place : inchangé)
  const course = C.courseRef && JB[5] === 1 && S[PIVOT] !== 1;
  CR_ON[0] = course ? 1 : 0;
  if (course) {
    let u = ph / TWO_PI;
    u -= Math.floor(u);
    // marche arrière (état 2, avec hystérésis) : la course jouée à l'envers. Au changement, la phase est retournée
    // (u → appui − u) : même pose, chaque pied garde son appui ou son retour (sans ça, un pied posé changeait de pose
    // d'un coup : sommets 8 mm sous le sol en zigzag)
    const arr = S[LOCO] === 2 ? 1 : 0;
    if (arr !== CR_ARR[0]) {
      CR_ARR[0] = arr;
      let u2 = CR_AP - u;
      u2 -= Math.floor(u2);
      S[PHASE] += (u2 - u) * TWO_PI;
      u = u2;
    }
    CR_IN[1] = u;
    CR_IN[2] = g;
    CR_IN[3] = wk;
    CR_IN[4] = db;
    CR_IN[5] = ca;
    CR_IN[6] = sa;
    CR_IN[7] = chasse;
    CR_IN[8] = S[AMPL] / C.amplitude[0];
    poseCourse();
    const am = Am > 1e-3 ? Am : K[1];
    lg = CR_L[0] / am; // bras : balancier en phase avec la cuisse
    ld = CR_L[1] / am;
  }
  // ----- § E4.J : coup de pied sur une borne (props.js déclenche et casse ; ici, la jambe) — par-dessus la marche :
  // armé (cuisse levée, genou plié), frappe (jambe tendue vers la borne, impact à la fin), tenue, retour. La jambe du
  // côté de la borne frappe, l'autre garde son appui ou sa marche ; bras, visée et tirs ne changent pas.
  KW[0] = 0;
  KW[2] = 0;
  if (COUP[C_ACTIF] === 1 && !dashing && COUP[CPV2.C_V2] !== 1) {
    let be = COUP[C_LACET] - S[LOWYAW];
    be -= Math.round(be / TWO_PI) * TWO_PI;
    const sb = Math.sin(be);
    const cb = Math.cos(be);
    if (COUP[C_COTE] < 0) COUP[C_COTE] = sb > COUP_DE_PIED.coteSeuil ? K[0] : K[1]; // + sin = côté gauche du bassin
    const kc = COUP[C_COTE] === 0 ? 0 : 1;
    const t = COUP[C_T];
    const CP = COUP_DE_PIED;
    const lv = COUP[C_LOURD] === 1 ? CP.lourd.levee : K[1];
    let w = K[1];
    let lift = CP.leveeFrappe;
    let knee = CP.genouFrappe;
    let pt = CP.pointe;
    let fr = K[1]; // part « frappe » (recul du buste)
    if (t < COUP[C_TA]) {
      const q = t / COUP[C_TA];
      w = q * q * (3 - 2 * q);
      lift = CP.leveeArme;
      knee = CP.genouArme;
      pt = K[0];
      fr = K[0];
    } else if (t < COUP[C_TF]) {
      const q = (t - COUP[C_TA]) / (COUP[C_TF] - COUP[C_TA]);
      const e = 1 - (1 - q) * (1 - q); // part vite, arrive en freinant sur la borne
      lift = CP.leveeArme + (CP.leveeFrappe - CP.leveeArme) * e;
      knee = CP.genouArme + (CP.genouFrappe - CP.genouArme) * e;
      pt = CP.pointe * e;
      fr = e;
    } else if (t >= COUP[C_TT]) {
      const q = t < COUP[C_TR] ? (t - COUP[C_TT]) / (COUP[C_TR] - COUP[C_TT]) : K[1];
      w = 1 - q * q * (3 - 2 * q);
      knee = CP.genouFrappe + (CP.genouArme * 0.6 - CP.genouFrappe) * q; // le genou se replie en redescendant
      fr = 1 - q;
    }
    lift *= lv;
    const J = kc === 0 ? JG : JD;
    const Tb = kc === 0 ? TG : TD;
    angX[J] = angX[J] * (1 - w) + -lift * cb * w;
    angZ[J] = angZ[J] * (1 - w) + lift * sb * CP.lateral * w;
    angX[Tb] = angX[Tb] * (1 - w) + knee * w;
    THETA[kc] = THETA[kc] * (1 - w) + pt * w;
    TAU[kc] *= 1 - w;
    KW[0] = w;
    KW[1] = kc;
    KW[2] = fr * w;
  }
  // ----- bras : balancier en opposition avec la jambe du même côté (repère du buste)
  const idle = 1 - g;
  const br = Math.sin(TWO_PI * A.breatheHz * S[TIME]);
  const arm = (A.armSwing / 0.58) * g * (pivot ? 0 : 1) * (STY[ST_ON] === 1 ? STY[ST_BRAS] : K[1]); // § E5.F : Bastion, bras larges
  angX[BG] = (arm * Am * lg * ca + 0.03 * idle * br) * wk + A.dashArms * db;
  angZ[BG] = (A.armOut + 0.02 * idle * br) * wk + 0.25 * db;
  angX[BD] = (arm * Am * ld * ca - 0.03 * idle * br) * wk + A.dashArms * db;
  angZ[BD] = -(A.armOut + 0.02 * idle * br) * wk - 0.25 * db;
  if (STY[ST_ON] === 1) {
    // § E5.F : carrure du Bastion — bras écartés du corps à la course
    angZ[BG] += STY[ST_ECART] * g * wk;
    angZ[BD] -= STY[ST_ECART] * g * wk;
  }
  const fa = -(A.forearmIdle + ((STY[ST_ON] === 1 ? STY[ST_AVB] : A.forearmRun) - A.forearmIdle) * g);
  angX[ABG] = fa * wk - 0.3 * db;
  angX[ABD] = fa * wk - 0.3 * db;
  angX[TETE] = -0.5 * S[LEAN] + 0.015 * idle * br; // la tête compense : le regard reste à l'horizon
  if (STY[ST_ON] === 1) angX[TETE] += (STY[ST_TETE] - STY[ST_PENCHE]) * g; // § E5.F : tête basse (buste penché compensé en partie)
  angZ[TETE] = -0.4 * S[ROLL];
  // visée (armes-heros.js) : le bras qui tire se lève vers sa cible, coude tendu, recul ; mêlé à la marche par son poids
  angY.fill(0);
  for (let k = 0; k < 2; k++) {
    const w = visee[k * 4];
    if (!(w > 0.001)) continue;
    const ib = k === 0 ? BD : BG;
    const ia = k === 0 ? ABD : ABG;
    const rec = visee[k * 4 + 3];
    angX[ib] = angX[ib] * (1 - w) + (-HALF_PI - visee[k * 4 + 2] - 0.5 * rec) * w;
    angY[ib] = visee[k * 4 + 1] * w;
    angZ[ib] *= 1 - w;
    angX[ia] = angX[ia] * (1 - w) + -0.9 * rec * w; // le coude se replie sous le recul
    // pronation : l'avant-bras tourne sur son axe pour mettre le dos de la main (où sont fixés les modules d'arme)
    // vers le ciel ; les bouches pointent alors vers l'avant (agent Blender : g −90°, d +90°)
    angY[ia] = (k === 0 ? HALF_PI : -HALF_PI) * w;
  }
  // § E3.M : geste d'attaque (combos.js) par-dessus la marche et la visée, mêlé par son poids
  const gw = geste[0];
  if (gw > 0.001 && P.dashT <= 0 && geste[1] === 4) {
    // § E5.F : bras en VRAI arc — direction voulue (levée φ, lacet λ dans le repère du buste) convertie en angles X et Z
    // de l'ordre d'Euler XZY des bras (le lacet Y de cet ordre ne fait que tourner l'os sur lui-même : § E5.F)
    for (let k = 0; k < 2; k++) {
      const ib = k === 0 ? BD : BG;
      const ia = k === 0 ? ABD : ABG;
      const phi = geste[k === 0 ? 14 : 17];
      const lam = geste[k === 0 ? 15 : 18];
      const sp = Math.sin(phi);
      const dx = sp * Math.sin(lam);
      const dy = -Math.cos(phi);
      const dz = sp * Math.cos(lam);
      const zz = Math.asin(dx > 1 ? K[1] : dx < -1 ? K[2] : dx);
      const xx = Math.atan2(-dz, -dy);
      angX[ib] = angX[ib] * (1 - gw) + xx * gw;
      angZ[ib] = angZ[ib] * (1 - gw) + zz * gw;
      angY[ib] *= 1 - gw;
      angX[ia] = angX[ia] * (1 - gw) + -geste[k === 0 ? 16 : 19] * gw;
      angY[ia] *= 1 - gw;
    }
    angX[TETE] += (geste[13] - 0.7 * geste[10]) * gw;
    if (geste[12] > 0) {
      // vrille en l'air : jambes repliées (aucun appui, piedPose mode 0)
      const q = geste[12] * gw;
      angX[JG] = angX[JG] * (1 - q) - REPLIE[0] * q;
      angX[JD] = angX[JD] * (1 - q) - REPLIE[0] * 0.75 * q;
      angX[TG] = angX[TG] * (1 - q) + REPLIE[1] * q;
      angX[TD] = angX[TD] * (1 - q) + REPLIE[1] * 0.85 * q;
    }
  } else if (gw > 0.001 && P.dashT <= 0) {
    for (let k = 0; k < 2; k++) {
      if (geste[1] !== 2 && geste[1] !== (k === 0 ? 0 : 1)) continue;
      const ib = k === 0 ? BD : BG;
      const ia = k === 0 ? ABD : ABG;
      const cote = k === 0 ? -1 : 1; // bras écartés pour la vrille, chacun de son côté
      angX[ib] = angX[ib] * (1 - gw) + -geste[3] * gw;
      angY[ib] = angY[ib] * (1 - gw) + (geste[1] === 2 && geste[2] === 0 ? 0 : geste[2]) * gw;
      angZ[ib] = angZ[ib] * (1 - gw) + (geste[1] === 2 && geste[2] === 0 ? cote * 0.25 : 0) * gw;
      angX[ia] = angX[ia] * (1 - gw) + -geste[9] * gw;
    }
  }
  for (let k = 0; k < osListe.length; k++) {
    const b = osListe[k];
    if (b === null) continue;
    b.rotation.x = angX[k];
    b.rotation.y = angY[k];
    b.rotation.z = angZ[k];
  }
  // buste : torsion par rapport au bassin (bornée dans update) ; penché en avant en marche arrière
  let tor = S[AIMYAW] - S[LOWYAW];
  tor -= Math.round(tor / TWO_PI) * TWO_PI;
  const bu = bones.buste;
  bu.rotation.y = tor + (gw > 0.001 && P.dashT <= 0 ? geste[4] * gw : 0); // § E3.M : torsion du geste
  bu.rotation.x = (S[LOCO] === 2 ? C.penchArriere * g : 0) + COUP_DE_PIED.recul * KW[2]; // § E4.J : recul du buste à la frappe
  BXZ[0] = bu.rotation.x; // § E5.F : penché d'avant ce chantier (pivot inchangé, au sol)
  if (gw > 0.001 && P.dashT <= 0 && geste[1] === 4) {
    bu.rotation.x += geste[10] * gw; // § E5.F : buste penché dans le coup
    bu.rotation.z = geste[11] * gw;
  } else bu.rotation.z = K[0];
  if (STY[ST_ON] === 1 && course) {
    // § E5.F : Bastion — buste penché en avant, épaules qui roulent (en opposition avec les jambes), le buste bascule
    // sur la jambe d'appui (appui gauche au début du cycle, centré à 0,14)
    let u = ph / TWO_PI;
    u -= Math.floor(u);
    const ga = g * wk * (1 - (gw > 0.001 ? gw : 0) * 0.5);
    bu.rotation.x += STY[ST_PENCHE] * g * wk;
    bu.rotation.y += STY[ST_EPAULES] * lg * ga;
    bu.rotation.z -= STY[ST_ROULIS] * Math.cos(TWO_PI * (u - 0.14)) * ga;
  }
  // § E5.F (contraintes) : la torsion du buste est bornée par contraindre() (CONTRAINTES, buste y). Essai écarté : reporter
  // l'excès au bassin tordait les jambes aux pieds cloués jusqu'à 141° (relevé tests/e5-F-contraintes.mjs)
  TORS_EX[0] = K[0];
  // § E5.F (retour de Femz du 17/11, croquis : « tu cambres son dos du mauvais sens ») : l'os du buste a son pivot AU SOL ;
  // le penché et le roulis ajoutés ici tournaient donc le haut du corps autour des pieds — il glissait d'un bloc devant
  // le bassin (54 cm mesurés de profil) et l'abdomen, mêlé bassin / buste, faisait ventre en avant. Ils pivotent
  // maintenant à l'abdomen (hanche + 8,3 cm, comme l'idle) : le point de l'abdomen reste où le penché d'avant le met.
  // Sans penché ni roulis ajoutés, le décalage vaut exactement 0 (Éclaireur et Shinobi à la course : inchangés).
  {
    const T = IDLE[2] + 0.083;
    eB1.set(BXZ[0], bu.rotation.y, K[0]);
    eB2.set(bu.rotation.x, bu.rotation.y, bu.rotation.z);
    qB1.setFromEuler(eB1);
    qB2.setFromEuler(eB2);
    vB1.set(0, T, 0).applyQuaternion(qB1);
    vB2.set(0, T, 0).applyQuaternion(qB2);
    bu.position.set(vB1.x - vB2.x, vB1.y - vB2.y, vB1.z - vB2.z);
  }
  corps[0] = S[LOWYAW];
  corps[1] = S[AIMYAW];

  // échelle : respiration, arrêt, dash, réception, battement de santé basse
  let sx = 1;
  let sy = 1 + A.breathe * idle * br;
  let sz = 1;
  const ts = S[STOP_T];
  if (ts < 1) {
    const q = A.stopSquash * Math.exp(-A.stopDamp * ts) * Math.cos(TWO_PI * A.stopHz * ts);
    sy *= 1 - q;
    sx *= 1 + q * 0.5;
    sz *= 1 + q * 0.5;
  }
  if (dashing) {
    const el = S[DASH_EL];
    const k = el < A.dashAnticipation ? 0 : Math.min(1, (el - A.dashAnticipation) / 0.03);
    const g0 = el < 0.02 ? el / 0.02 : 1; // le ramassé s'installe en 20 ms
    sx *= 1 + (GATHER[0] - 1) * g0 + (STRETCH[0] - GATHER[0]) * k;
    sy *= 1 + (GATHER[1] - 1) * g0 + (STRETCH[1] - GATHER[1]) * k;
    sz *= 1 + (GATHER[2] - 1) * g0 + (STRETCH[2] - GATHER[2]) * k;
  } else if (S[LAND_T] < 1) {
    const t = S[LAND_T];
    const e = Math.exp(-A.landDamp * t) * Math.cos(TWO_PI * A.landHz * t);
    sx *= 1 + (LAND[0] - 1) * e;
    sy *= 1 + (LAND[1] - 1) * e;
    sz *= 1 + (LAND[2] - 1) * e;
  }
  const sw = 1 + extra[0];
  // § E5.F : Bastion — chaque appui de la course tasse le corps et enfonce le bassin (le genou d'appui plie) ; compte
  // l'appui (poussière : combos.js)
  let dip = K[0];
  if (STY[ST_ON] === 1) {
    for (let k = 0; k < 2; k++) {
      const st = course && CR_L[3 + k] < 1 ? 1 : 0;
      if (st === 1 && FOUL[1 + k] === 0 && g > 0.5 && P.dashT <= 0) {
        FOUL[0] = S[TIME];
        const pd = k === 0 ? bones.pied_g : bones.pied_d;
        if (pd) {
          tmpA.setFromMatrixPosition(pd.matrixWorld);
          foulee[1] = tmpA.x;
          foulee[2] = tmpA.z;
          fouleeN[0] += 1;
        }
      }
      FOUL[1 + k] = st;
    }
    const tt = S[TIME] - FOUL[0];
    if (tt < STY[ST_TDUR] && tt >= 0) dip = Math.sin((Math.PI * tt) / STY[ST_TDUR]) * g * wk;
    // (pas d'écrasement d'échelle : sous une échelle non uniforme, le pied d'appui qui roule se déforme et glisse —
    // mesuré par anim-pieds ; le tassement passe par le bassin qui s'enfonce, le genou d'appui plie)
  }
  // le bassin descend avec l'angle de la cuisse d'appui (pied d'appui au sol), et la racine porte le lacet du BAS
  const bob = ((course ? CR_L[2] : -C.levier * (1 - Math.cos(aAppui)) * C.descente) + C.hanche * (1 - Math.cos(S[LEAN])) + C.hanche * (1 - Math.cos(S[ROLL]))) * wk - STY[ST_BASSIN] * dip;
  // § E3.M : pas glissé vers le coup (avance), accroupi, vrille (tour entier du corps) — dessin seulement
  if (gw > 0.001 && P.dashT <= 0) {
    const av = geste[6] * gw;
    mesh.position.set(P.x + Math.sin(geste[8]) * av, bob - geste[7] * gw, P.z + Math.cos(geste[8]) * av);
    mesh.rotation.set(S[LEAN], S[LOWYAW] + geste[5] + TORS_EX[0], S[ROLL]);
  } else {
    // 16/11 (point 11) : bond sismique du Bastion — le corps monte en cloche pendant le trajet (dessin seulement)
    mesh.position.set(P.x, bob + (P.dashT > 0 ? dashHauteur(P.dashT) : 0), P.z);
    mesh.rotation.set(S[LEAN], S[LOWYAW] + TORS_EX[0], S[ROLL]);
  }
  mesh.scale.set(sx * sw, sy * sw, sz * sw);
  // pieds : marche (pied d'appui posé, déroulé du pas), repos (deux pieds posés), aucun appui pendant le dash et le début
  // de la réception
  PH[0] = course ? CR_L[3] : tg;
  PH[1] = course ? CR_L[4] : td;
  DB[0] = db;
  const modePied = P.dashT > 0 || S[LAND_T] <= 0.15 || (gw > 0.001 && geste[12] > 0.3 && geste[1] === 4) ? 0 : g > 0.05 || S[PIVOT] === 1 ? 1 : 2; // § E5.F : vrille en l'air sans appui
  if (modePied !== 2) PAS_VU[0] = geste[23]; // § E5.F : un pas de fente ne vaut qu'à l'arrêt (sinon la course fait les pas)
  piedPose(modePied);
  if (course) ecartCourse();
  else CR_ECART[0] = 0;
  mesh.updateMatrixWorld(true);
}

/** Après player.sync : pose, lueur (P1 + ping), cape, images rémanentes. */
// œil en V du casque (pièce « oeil ») : rafales de glitch, voir oeil-glitch.js
let oeilBase = null;

// ----- § E4.E.3 : WARRIOR IDLE en partie (demande de Femz du 16/11, 10h55) ------------------------------------------
// Pistes cuites (cuit-menu.js) posées sur le HAUT du corps (buste, bras, avant-bras, tête) par-dessus la pose calculée,
// quand le héros est à l'arrêt, hors dash, hors geste de combo et quand aucune arme ne vise (la visée et les bouches
// restent celles du combat). Les jambes gardent leurs pieds posés (cinématique inverse). Fondu exponentiel
// (HEROS_IDLE.fonduS) : aucun à-coup. Le squelette cuit (écran titre) a sa racine à la hanche et son buste 8,3 cm
// au-dessus ; celui du jeu les a à l'origine : la position du buste compense (X = H + Qr·(T − H) − Q·T).
// Aucune allocation par image.
let idleCuit = null;
// § E5.F : idle PROPRE à chaque agent (IDLES_AGENTS, config.js) — [agent] ; repli : idleCuit (Warrior Idle). Le Bastion
// qui TIENT le marteau (IDLE_MARTEAU[0] = 1, posé par le branchement du modèle du marteau) joue idleMarteau.
const idlesAgents = [null, null, null];
let idleMarteau = null;
/** § E5.F : 1 = le Bastion tient le marteau en main droite (écrit par le branchement du modèle — pas encore là). */
export const IDLE_MARTEAU = new Uint8Array(1);
/** § E5.F : idle cuit de l'agent a (main.js, au chargement). */
export function setIdleAgent(a, c) {
  idlesAgents[a] = c;
}
/** § E5.F : idle du Bastion qui tient le marteau (« Great Sword Idle »). */
export function setIdleMarteau(c) {
  idleMarteau = c;
}
function idleCourant() {
  const a = run.agent;
  if (a === AGENT.BASTION && IDLE_MARTEAU[0] === 1 && idleMarteau !== null && IDLES_AGENTS.marteau.actif) return idleMarteau;
  const c = a >= 0 && a < 3 ? idlesAgents[a] : null;
  return c !== null ? c : idleCuit;
}
const IDLE = new Float64Array(4); // [0] poids du haut, [1] temps de l'idle (s), [2] hanche H (m), [3] position du buste écrite (0 / 1)
const IDLE_NOMS = ['bras_g', 'avant_bras_g', 'bras_d', 'avant_bras_d', 'tete'];
const idleOs = {}; // cibles d'échantillonnage (objets à part : les os du héros ne sont écrits que par le mélange)
const idleRacine = new THREE.Object3D();
for (const n of ['buste', ...IDLE_NOMS, 'jambe_g', 'tibia_g', 'pied_g', 'orteils_g', 'jambe_d', 'tibia_d', 'pied_d', 'orteils_d']) idleOs[n] = new THREE.Object3D();
const qIdle = new THREE.Quaternion();
const vIdle = new THREE.Vector3();
const vIdle2 = new THREE.Vector3();
/** Animation cuite de l'idle (main.js, à son arrivée ; null : idle calculé seul). */
export function setIdle(c) {
  idleCuit = c;
}
function appliquerIdle(dt) {
  const cuitIdle = idleCourant(); // § E5.F : idle de l'agent
  if (cuitIdle === null || !HEROS_IDLE.actif) return;
  const sp = Math.hypot(P.vx, P.vz);
  const vise = viseeBuste[0] > 0 || visee[0] > 0.001 || visee[4] > 0.001;
  const veut = P.alive && P.dashT <= 0 && sp < HEROS_IDLE.vitesseArret && !(geste[0] > 0.001) && !vise && !(CW[0] > 0) && COUP[C_ACTIF] !== 1 ? 1 : 0;
  if (dt > 0) IDLE[0] += (veut - IDLE[0]) * (1 - Math.exp(-dt / HEROS_IDLE.fonduS));
  if (veut === 0 && IDLE[0] < 1e-3) IDLE[0] = 0;
  IDLE[1] = veut > 0 || IDLE[0] > 0 ? IDLE[1] + dt : 0;
  const w = IDLE[0];
  const bu = bones.buste;
  // § E5.F : jambes et pieds du CLIP (Shinobi, IDLES_AGENTS.jambesClip) — racine, buste, jambes du clip, hauteur recalée
  const jambes = IDLES_AGENTS.jambesClip[run.agent] === true && rootBone !== null ? 1 : 0;
  if (w <= 0) {
    // (§ E5.F : plus de remise à zéro de la position du buste ici — pose() l'écrit à chaque image ; la remettre à zéro
    // effaçait la compensation du penché de course du Bastion)
    if (IDLE[3] !== 0) IDLE[3] = 0;
    if (IDLE_J[0] === 1) {
      rootBone.quaternion.identity();
      rootBone.position.set(0, 0, 0);
      IDLE_J[0] = 0;
      mesh.updateMatrixWorld(true);
    }
    return;
  }
  cuitIdle.echantillonner(IDLE[1], idleOs, idleRacine, 0);
  const H = IDLE[2];
  const T = H + 0.083; // pivot du buste du squelette cuit (heros-menu : TAILLE)
  // § E5.F (retour de Femz du 17/11 : « le dos du Bastion se plie toujours bizarrement quand il COMMENCE sa course ») :
  // la position du buste était REMPLACÉE par celle de l'idle × w, alors que sa rotation était mélangée. Pendant le fondu
  // idle → course, le penché de course (pivot à l'abdomen, compensé par la position) tournait donc autour des pieds :
  // le haut du corps partait en avant d'un bloc, l'abdomen se pliait. La position est maintenant MÉLANGÉE comme la
  // rotation (même règle que le coup de pied et le bond), et le roulis de pose() n'est plus effacé.
  const bx = bu.position.x;
  const by = bu.position.y;
  const bz = bu.position.z;
  const wl = jambes === 1 && IDLES_AGENTS.jambesExp > 1 ? Math.pow(w, IDLES_AGENTS.jambesExp) : w; // § E5.F.14
  if (jambes === 1) {
    // racine du clip (bassin), puis buste local (pivot 8,3 cm au-dessus de la hanche, comme le coup de pied)
    // § E5.F.14 : bassin et jambes mêlés par wl = w^jambesExp — le mélange jambes du clip / pieds cloués de la course (où
    // les semelles glissent) dure moins longtemps : à l'arrêt les pieds restent cloués plus longtemps, au départ ils le
    // redeviennent plus tôt
    const rb = rootBone;
    rb.quaternion.identity();
    rb.quaternion.slerp(idleRacine.quaternion, wl);
    vIdle.set(0, H, 0).applyQuaternion(rb.quaternion);
    const R = idleRacine.position;
    rb.position.set(R.x * wl - vIdle.x, H + (R.y - H) * wl - vIdle.y, R.z * wl - vIdle.z);
    IDLE_J[0] = 1;
    bu.quaternion.slerp(idleOs.buste.quaternion, w);
    vIdle2.set(0, T, 0).applyQuaternion(bu.quaternion);
    bu.position.set(bx + (-vIdle2.x - bx) * w, by + (T - vIdle2.y - by) * w, bz + (-vIdle2.z - bz) * w);
    for (let k = 0; k < IDLE_JAMBES.length; k++) {
      const b = bones[IDLE_JAMBES[k]];
      if (b) b.quaternion.slerp(idleOs[IDLE_JAMBES[k]].quaternion, wl);
    }
  } else {
    // buste : orientation du torse dans le repère du héros (racine × buste de l'anim), le bassin du jeu restant droit
    qIdle.multiplyQuaternions(idleRacine.quaternion, idleOs.buste.quaternion);
    bu.quaternion.slerp(qIdle, w);
    vIdle.set(0, T - H, 0).applyQuaternion(idleRacine.quaternion);
    vIdle2.set(0, T, 0).applyQuaternion(qIdle);
    const px = vIdle.x - vIdle2.x;
    const py = H + vIdle.y - vIdle2.y;
    const pz = vIdle.z - vIdle2.z;
    bu.position.set(bx + (px - bx) * w, by + (py - by) * w, bz + (pz - bz) * w);
  }
  IDLE[3] = 1;
  for (let k = 0; k < IDLE_NOMS.length; k++) {
    const b = bones[IDLE_NOMS[k]];
    if (b) b.quaternion.slerp(idleOs[IDLE_NOMS[k]].quaternion, w);
  }
  mesh.updateMatrixWorld(true);
  if (jambes === 1 && JB[5] === 1) {
    // contact au sol gardé : le point le plus bas des deux pieds est posé sur le sol (décalage vertical seul, angles du clip
    // intacts) ; mêlé par le poids de l'idle (la course reprend ses pieds cloués)
    basPied(0);
    basPied(1);
    const bas = BAS[0] < BAS[1] ? BAS[0] : BAS[1];
    // sous le sol : relevé EN ENTIER quel que soit le poids — pendant le fondu idle ↔ course, les jambes mêlées du clip
    // et de la course passaient jusqu'à 10 cm sous le sol (anim-pieds, Shinobi : 28 contrôles en échec sans, 11 avec,
    // il reste des semelles qui glissent pendant le fondu) ; au-dessus du sol : mêlé par le poids
    mesh.position.y -= bas < 0 ? bas : bas * wl; // § E5.F.14 : au poids des jambes
    mesh.updateMatrixWorld(true);
  }
}
const IDLE_JAMBES = ['jambe_g', 'tibia_g', 'pied_g', 'orteils_g', 'jambe_d', 'tibia_d', 'pied_d', 'orteils_d'];
const IDLE_J = new Uint8Array(1); // § E5.F : 1 = la racine porte l'idle (jambes du clip)
/** Tests (§ E4.E.7) : poids de l'idle cuit et temps. */
export function idleInspect(out = {}) {
  out.charge = idleCuit !== null;
  out.poids = IDLE[0];
  out.temps = IDLE[1];
  const c = idleCourant(); // § E5.F : idle de l'agent posé
  out.source = c ? c.source : null;
  return out;
}

// ----- § E4.O : COUP DE PIED CUIT (« Standing Melee Kick », Mixamo, retour de Femz du 16/11, 21h) ------------------
// Les 15 pistes de l'agent (coup-pied.js) remplacent la pose calculée, mêlées par un poids w (fondu d'entrée et de
// sortie ; à l'annulation par un dash, fondu court depuis la dernière image jouée). Racine cuite à la hanche, racine
// du jeu aux pieds : position de la racine X = lerp(hanche du jeu, hanche cuite, w) − Q·(0, H, 0) ; buste : comme
// l'idle (pivot 8,3 cm au-dessus de la hanche). Corps tourné vers la borne (C_CAP), penché et roulis du jeu effacés.
// Pied d'appui (gauche) ANCRÉ : sa cheville est relevée au premier instant de poids plein, puis la position dessinée
// est corrigée pour qu'elle ne bouge plus ; la plus basse des deux chevilles est posée à sa hauteur de repos.
// Aucune allocation par image (tableaux typés, écritures directes des quaternions).
const CW = new Float64Array(10); // [0] poids, [1] temps de l'animation (s), [2] agent, [3] cap, [4] ancre posée (0/1), [5] ancre x, [6] ancre z, [7] écrit (0/1), [8] dernier poids d'ancrage, [9] cheville de repos (m)
export const coupMesure = new Float64Array(12); // tests : [0] poids, [1] u, [2..4] cheville d'appui monde, [5..7] bout du pied monde, [8] écart ancre (m), [9] lacet du maillage, [10] torsion bassin (rad), [11] torsion buste/bassin (rad)
const OSC = new Array(15).fill(null);
function osCoup() {
  for (let k = 0; k < CPV2.NB; k++) OSC[k] = k === 0 ? rootBone : bones[CPV2.NOMS[k]] || null;
}
const QB = new Float64Array(4);
function ecrireQ(o, i, w) {
  // nlerp de la rotation actuelle de l'os o vers la pose cuite k (hémisphère corrigé), écrite sans appel flottant
  const q = o.quaternion;
  const P2 = CPV2.POSE;
  const j = i * 4;
  let tx = P2[j];
  let ty = P2[j + 1];
  let tz = P2[j + 2];
  let tw = P2[j + 3];
  if (q._x * tx + q._y * ty + q._z * tz + q._w * tw < 0) {
    tx = -tx;
    ty = -ty;
    tz = -tz;
    tw = -tw;
  }
  const x = q._x + (tx - q._x) * w;
  const y = q._y + (ty - q._y) * w;
  const z = q._z + (tz - q._z) * w;
  const ww = q._w + (tw - q._w) * w;
  const n = 1 / Math.sqrt(x * x + y * y + z * z + ww * ww);
  q._x = x * n;
  q._y = y * n;
  q._z = z * n;
  q._w = ww * n;
  q._onChangeCallback();
}
function appliquerCoup(dt) {
  const K = COUP_DE_PIED.v2;
  if (!K || rootBone === null) return;
  const actif = COUP[C_ACTIF] === 1 && COUP[CPV2.C_V2] === 1;
  if (actif) {
    const a = COUP[CPV2.C_AGENT];
    const t = COUP[C_T];
    const D = COUP[C_TR];
    let wi = t / K.fonduEntree;
    wi = wi > 1 ? 1 : wi < 0 ? 0 : wi;
    let wo = (D - t) / K.fonduSortie;
    wo = wo > 1 ? 1 : wo < 0 ? 0 : wo;
    wi = wi * wi * (3 - 2 * wi);
    wo = wo * wo * (3 - 2 * wo);
    CW[0] = wi < wo ? wi : wo;
    CW[1] = K.clip.debut + t * K.agents[a].vitesse;
    CW[2] = a;
    CW[3] = COUP[CPV2.C_CAP];
  } else if (CW[0] > 0) {
    // fin ou annulation : fondu court depuis la dernière image jouée
    CW[0] -= dt / K.fonduAnnule;
    if (CW[0] < 0) CW[0] = 0;
  }
  const w = CW[0];
  if (!(w > 0)) {
    if (CW[7] === 1) {
      rootBone.quaternion.identity();
      rootBone.position.set(0, 0, 0);
      // § E5.F : la position du buste n'est plus remise à 0 ici — pose() l'écrit à chaque image (pivot du penché à
      // l'abdomen) ; la remettre à 0 APRÈS pose() faisait sauter la tête de 46 cm pendant une image en fin de coup / bond.
      // Même chose pour le roulis (rotation.z) : pose() l'écrit à chaque image, le remettre à 0 ici le coupait une image
      CW[7] = 0;
      CW[4] = 0;
      KW[0] = 0;
      mesh.updateMatrixWorld(true);
    }
    return;
  }
  if (OSC[1] !== bones.buste) osCoup();
  const a = CW[2];
  CPV2.poseA(a, CW[1]);
  CW[7] = 1;
  // racine : rotation, puis position (hanche du jeu (0, H, 0) → hanche cuite RS)
  const H = IDLE[2];
  const rb = rootBone;
  rb.quaternion._x = 0;
  rb.quaternion._y = 0;
  rb.quaternion._z = 0;
  rb.quaternion._w = 1;
  ecrireQ(rb, 0, w);
  const RS = CPV2.RS;
  vIdle.set(0, H, 0).applyQuaternion(rb.quaternion);
  rb.position.set(RS[0] * w - vIdle.x, H + (RS[1] - H) * w - vIdle.y, RS[2] * w - vIdle.z);
  // buste : rotation, puis position (pivot 8,3 cm au-dessus de la hanche, comme l'idle)
  const bu = bones.buste;
  const bx = bu.position.x;
  const by = bu.position.y;
  const bz = bu.position.z;
  ecrireQ(bu, 1, w);
  const T = H + 0.083;
  vIdle2.set(0, T, 0).applyQuaternion(bu.quaternion);
  bu.position.set(bx + (-vIdle2.x - bx) * w, by + (T - vIdle2.y - by) * w, bz + (-vIdle2.z - bz) * w);
  for (let k = 2; k < CPV2.NB; k++) {
    const o = OSC[k];
    if (o !== null) ecrireQ(o, k, w);
  }
  // corps tourné vers la borne ; penché et roulis effacés
  let dy = CW[3] - S[LOWYAW];
  dy -= Math.round(dy / TWO_PI) * TWO_PI;
  mesh.rotation.x = S[LEAN] * (1 - w);
  mesh.rotation.y = S[LOWYAW] + dy * w;
  mesh.rotation.z = S[ROLL] * (1 - w);
  mesh.position.x = P.x;
  mesh.position.z = P.z;
  mesh.position.y *= 1 - w;
  mesh.updateMatrixWorld(true);
  // pied d'appui ancré (cheville gauche) et chevilles posées
  const pg = bones.pied_g;
  const pd = bones.pied_d;
  if (pg && pd) {
    if (CW[9] === 0) CW[9] = pg.parent ? pivotY(pg) : 0.1;
    tmpA.setFromMatrixPosition(pg.matrixWorld);
    tmpB.setFromMatrixPosition(pd.matrixWorld);
    if (K.ancrage) {
      if (CW[4] === 0 && w >= 0.999 && actif) {
        CW[4] = 1;
        CW[5] = tmpA.x;
        CW[6] = tmpA.z;
      }
      if (CW[4] === 1) {
        mesh.position.x += (CW[5] - tmpA.x) * w;
        mesh.position.z += (CW[6] - tmpA.z) * w;
      }
    }
    const bas = tmpA.y < tmpB.y ? tmpA.y : tmpB.y;
    mesh.position.y += (CW[9] - bas) * w;
    mesh.updateMatrixWorld(true);
    tmpA.setFromMatrixPosition(pg.matrixWorld);
    coupMesure[2] = tmpA.x;
    coupMesure[3] = tmpA.y;
    coupMesure[4] = tmpA.z;
    coupMesure[8] = CW[4] === 1 ? Math.hypot(tmpA.x - CW[5], tmpA.z - CW[6]) : 0;
    const po = bones.orteils_d || pd;
    tmpB.set(0, 0, 0.09).applyMatrix4(po.matrixWorld);
    coupMesure[5] = tmpB.x;
    coupMesure[6] = tmpB.y;
    coupMesure[7] = tmpB.z;
  }
  coupMesure[0] = w;
  coupMesure[1] = CW[1];
  coupMesure[9] = mesh.rotation.y;
  KW[0] = w;
  KW[1] = 1; // la jambe droite frappe (celle de l'animation)
  KW[2] = 0;
}
// ----- § E5.F : BOND DU BASTION (« Jump Attack », Mixamo, cuit sur son robot : bond-cuit.js) ------------------------
// Pendant le dash du Bastion, la fenêtre [debut, impact] du clip est étirée sur la durée du dash (la frappe au sol tombe
// sur la dernière image du dash = l'onde de dash-agents) ; après, la reprise est jouée à la même vitesse pendant le
// fondu vers la course. Racine : hauteur de la hanche cuite (son saut), position horizontale = celle du jeu (le jeu
// fait le trajet). Même écriture que le coup de pied (nlerp par os, racine et buste compensés).
const BW = new Float64Array(6); // [0] poids, [1] temps du clip (s), [2] vitesse de lecture, [3] écrit (0/1), [4] dash vu (0/1)
export const bondMesure = new Float64Array(4); // tests : [0] poids, [1] temps du clip, [2] vitesse, [3] hauteur de hanche (m)
const WB = new Float64Array(1); // poids du bond (§ V : pas de flottant en argument)
function ecrireQB(o, i) {
  const w = WB[0];
  const q = o.quaternion;
  const P2 = BOND.POSE;
  const j = i * 4;
  let tx = P2[j];
  let ty = P2[j + 1];
  let tz = P2[j + 2];
  let tw = P2[j + 3];
  if (q._x * tx + q._y * ty + q._z * tz + q._w * tw < 0) {
    tx = -tx;
    ty = -ty;
    tz = -tz;
    tw = -tw;
  }
  const x = q._x + (tx - q._x) * w;
  const y = q._y + (ty - q._y) * w;
  const z = q._z + (tz - q._z) * w;
  const ww = q._w + (tw - q._w) * w;
  const n = 1 / Math.sqrt(x * x + y * y + z * z + ww * ww);
  q._x = x * n;
  q._y = y * n;
  q._z = z * n;
  q._w = ww * n;
  q._onChangeCallback();
}
function appliquerBond() {
  if (rootBone === null || !BOND_CUIT.actif || run.agent !== AGENT.BASTION || BOND.charge() === 0) return;
  const K = BOND_CUIT;
  const dashing = P.dashT > 0;
  let w = K0[0];
  if (dashing && DASH_AG[2] > 0) {
    const el = DASH_AG[2] - P.dashT;
    BW[2] = (K.clip.impact - K.clip.debut) / DASH_AG[2];
    BW[1] = K.clip.debut + (el > 0 ? el : 0) * BW[2];
    BW[4] = 1;
    w = el / K.fonduEntree;
    w = w > 1 ? K0[1] : w < 0 ? K0[0] : w;
  } else if (BW[4] === 1) {
    const t = S[LAND_T];
    BW[1] = K.clip.impact + t * BW[2] * K.reprise;
    if (BW[1] > K.clip.sortie) BW[1] = K.clip.sortie;
    w = 1 - t / K.fonduSortie;
    if (w <= 0) {
      w = K0[0];
      BW[4] = 0;
    } else w = w * w * (3 - 2 * w);
  }
  BW[0] = w;
  if (!(w > 0)) {
    if (BW[3] === 1) {
      rootBone.quaternion.identity();
      rootBone.position.set(0, 0, 0); // § E5.F : buste.position écrite par pose() (voir appliquerCoup)
      BW[3] = 0;
      mesh.updateMatrixWorld(true);
    }
    bondMesure[0] = 0;
    return;
  }
  if (OSC[1] !== bones.buste) osCoup();
  BOND.U[0] = BW[1];
  BOND.echantillonner();
  WB[0] = w;
  BW[3] = 1;
  const H = IDLE[2];
  const rb = rootBone;
  rb.quaternion._x = 0;
  rb.quaternion._y = 0;
  rb.quaternion._z = 0;
  rb.quaternion._w = 1;
  ecrireQB(rb, 0);
  const hy = H + (BOND.RS[1] - BOND.MES[0]) * K.hauteur;
  vIdle.set(0, H, 0).applyQuaternion(rb.quaternion);
  rb.position.set(-vIdle.x, H + (hy - H) * w - vIdle.y, -vIdle.z); // hanche à (0, hy) : X = R − Q·(0, H, 0)
  const bu = bones.buste;
  const bx = bu.position.x;
  const by = bu.position.y;
  const bz = bu.position.z;
  ecrireQB(bu, 1);
  const T = H + 0.083;
  vIdle2.set(0, T, 0).applyQuaternion(bu.quaternion);
  bu.position.set(bx + (-vIdle2.x - bx) * w, by + (T - vIdle2.y - by) * w, bz + (-vIdle2.z - bz) * w);
  for (let k = 2; k < CPV2.NB; k++) {
    const o = OSC[k];
    if (o !== null) ecrireQB(o, k);
  }
  mesh.rotation.x = S[LEAN] * (1 - w);
  mesh.rotation.z = S[ROLL] * (1 - w);
  mesh.position.y *= 1 - w;
  const sc = 1 + extra[0];
  mesh.scale.set(mesh.scale.x + (sc - mesh.scale.x) * w, mesh.scale.y + (sc - mesh.scale.y) * w, mesh.scale.z + (sc - mesh.scale.z) * w);
  mesh.updateMatrixWorld(true);
  if (JB[5] === 1) {
    // § E5.F : jamais un pied sous le sol pendant le bond et son fondu de sortie (pied qui redescend vite vers sa
    // course : 2,8 cm sous le sol une image, anim-pieds, horde, Bastion) — corps relevé d'autant, rien d'autre
    basPied(0);
    basPied(1);
    const bas = BAS[0] < BAS[1] ? BAS[0] : BAS[1];
    if (bas < 0) {
      mesh.position.y -= bas;
      mesh.updateMatrixWorld(true);
    }
  }
  bondMesure[0] = w;
  bondMesure[1] = BW[1];
  bondMesure[2] = BW[2];
  bondMesure[3] = hy;
}
const K0 = new Float64Array([0, 1]);

// ----- § E5.F : CONTRAINTES ARTICULAIRES (retour de Femz du 17/11 : « rajoute des contraintes au corps, là il se plie
// inhumainement le dos ») — à la fin de la pose, quelle qu'en soit la source, chaque os est ramené dans ses bornes
// (angles d'Euler de l'os dans SON ordre : racine XYZ, buste YXZ, pièces XZY). Réglages : CONTRAINTES (config.js,
// région e5:F-anim-agents). Relevés : contraintesInspect (min / max bruts, corrections). Aucune allocation.
const CJ_NOMS = CONTRAINTES.os.map((o) => o.nom);
const CJN = CJ_NOMS.length;
const CJ_B = new Float64Array(CJN * 6); // bornes x min, x max, y min, y max, z min, z max
CONTRAINTES.os.forEach((o, j) => {
  for (let k = 0; k < 6; k++) CJ_B[j * 6 + k] = o.b[k];
});
const CJ_M = new Float64Array(CJN * 6); // relevé : min / max BRUTS (avant correction) par axe
const CJ_N = new Int32Array(CJN); // relevé : images corrigées par os
const CJ_O = new Array(CJN).fill(null);
const CJ_ON = new Uint8Array([CONTRAINTES.actif ? 1 : 0, CONTRAINTES.corriger ? 1 : 0]);
function contraintesReset() {
  for (let j = 0; j < CJN; j++) {
    CJ_M[j * 6] = CJ_M[j * 6 + 2] = CJ_M[j * 6 + 4] = 1e9;
    CJ_M[j * 6 + 1] = CJ_M[j * 6 + 3] = CJ_M[j * 6 + 5] = -1e9;
  }
  CJ_N.fill(0);
}
contraintesReset();
function contraindre() {
  if (CJ_ON[0] === 0 || mesh === null) return;
  if (CJ_O[1] !== bones.buste) for (let j = 0; j < CJN; j++) CJ_O[j] = CJ_NOMS[j] === 'racine' ? rootBone : bones[CJ_NOMS[j]] || null;
  let touche = 0;
  for (let j = 0; j < CJN; j++) {
    const o = CJ_O[j];
    if (o === null) continue;
    const r = o.rotation;
    const q = j * 6;
    let x = r.x;
    let y = r.y;
    let z = r.z;
    if (x < CJ_M[q]) CJ_M[q] = x;
    if (x > CJ_M[q + 1]) CJ_M[q + 1] = x;
    if (y < CJ_M[q + 2]) CJ_M[q + 2] = y;
    if (y > CJ_M[q + 3]) CJ_M[q + 3] = y;
    if (z < CJ_M[q + 4]) CJ_M[q + 4] = z;
    if (z > CJ_M[q + 5]) CJ_M[q + 5] = z;
    if (CJ_ON[1] === 0) continue;
    let c = 0;
    if (x < CJ_B[q]) { x = CJ_B[q]; c = 1; } else if (x > CJ_B[q + 1]) { x = CJ_B[q + 1]; c = 1; }
    if (y < CJ_B[q + 2]) { y = CJ_B[q + 2]; c = 1; } else if (y > CJ_B[q + 3]) { y = CJ_B[q + 3]; c = 1; }
    if (z < CJ_B[q + 4]) { z = CJ_B[q + 4]; c = 1; } else if (z > CJ_B[q + 5]) { z = CJ_B[q + 5]; c = 1; }
    if (c === 1) {
      r.set(x, y, z);
      CJ_N[j]++;
      touche = 1;
    }
  }
  if (touche === 1) mesh.updateMatrixWorld(true);
}
/** Tests : bornes, min / max bruts et corrections par os ; reset = 1 remet le relevé à zéro. */
export function contraintesInspect(out = {}, reset = 0) {
  out.os = CJ_NOMS.slice();
  out.bornes = Array.from(CJ_B);
  out.mesure = Array.from(CJ_M);
  out.corrections = Array.from(CJ_N);
  out.corriger = CJ_ON[1];
  if (reset) contraintesReset();
  return out;
}
/** Tests : 1 = corriger (défaut), 0 = mesurer seulement. */
export function contraintesCorriger(on) {
  CJ_ON[1] = on ? 1 : 0;
  return CJ_ON[1];
}

/** Hauteur de repos de la cheville (pivot du pied dans le repère du modèle). */
function pivotY(o) {
  const p = donneesGlb ? donneesGlb.pieces.find((q) => q.nom === o.name) : null;
  return p ? p.pivot[1] : 0.1;
}
/** Tests (§ E4.O.6) : poids du coup cuit et mesures. */
export function coupInspect(out = {}) {
  out.poids = CW[0];
  out.u = CW[1];
  out.agent = CW[2];
  out.cap = CW[3];
  out.ancre = CW[4];
  out.mesure = Array.from(coupMesure);
  const q = rootBone ? rootBone.quaternion : null;
  out.racine = q ? [q.x, q.y, q.z, q.w] : null;
  return out;
}

export function sync() {
  if (!S[READY] || !actif) return;
  const alive = P.alive;
  mesh.visible = xray.visible = alive;
  cape.setVisible(alive);
  tissus.setVisible(alive);
  if (!alive) {
    ghosts.count = 0;
    S[FRAME_DT] = 0;
    return;
  }
  pose();
  appliquerIdle(S[FRAME_DT]); // § E4.E.3 : Warrior Idle à l'arrêt
  appliquerCoup(S[FRAME_DT]); // § E4.O : coup de pied cuit, tout le corps
  appliquerBond(); // § E5.F : bond du Bastion, « Jump Attack » cuit
  contraindre(); // § E5.F : bornes articulaires, après TOUT ce qui pose le corps (procédural, clips cuits, mélanges)
  if (bones.oeil) {
    if (!oeilBase) oeilBase = bones.oeil.position.clone();
    glitchOeil(bones.oeil, oeilBase, S[TIME]);
  }
  // P1 : clignotement d'invulnérabilité en lueur cyan (le blanc reste aux robots touchés et aux tirs)
  const blink = P.invulnT > 0 && P.dashT <= 0 && (Math.floor(P.invulnT * 18) & 1) === 0;
  let glow = P.dashT > 0 ? A.dashGlow : blink ? A.invulnGlow : 0;
  if (extra[1] > glow) glow = extra[1];
  // § E5.Q (B14) : soin du héros — le corps s'éclaire en vert, sauf pendant le dash et l'invulnérabilité (cyan devant)
  let vert = 0;
  if (uGlow !== null && SOIN_HEROS[S_LUEUR] > 0 && P.dashT <= 0 && P.invulnT <= 0 && extra[1] <= 0) {
    const g = LUEUR_PAR_S * SOIN_HEROS[S_LUEUR];
    if (g > glow) {
      glow = g;
      vert = 1;
    }
  }
  if (vert !== glowVert) {
    glowVert = vert;
    uGlow.copy(vert === 1 ? glowSoin : glowBase);
  }
  uFx.set(0, glow);
  bras(0, bones.bras_g, bones.avant_bras_g);
  bras(1, bones.bras_d, bones.avant_bras_d);
  jambe(2, bones.jambe_g, bones.tibia_g, bones.pied_g);
  jambe(3, bones.jambe_d, bones.tibia_d, bones.pied_d);
  piedsMesure();
  cape.entree[0] = S[FRAME_DT];
  cape.update(bones.buste.matrixWorld.elements); // la cape est accrochée au BUSTE : elle suit sa rotation
  if (S_TIS[0] === 1) {
    // § E5.I : tissus du Shinobi — pans sur le BASSIN, écharpe sur le BUSTE ; capsule du katana s'il est au dos
    tissusEntree();
    tissus.entree[0] = S[FRAME_DT];
    tissus.update(bones.buste.matrixWorld.elements);
    tissus.sync();
  }
  S[FRAME_DT] = 0;
  cape.sync();
  // images rémanentes
  const arr = ghosts.instanceMatrix.array;
  const ag = ghostAge.array;
  let n = 0;
  for (let k = 0; k < GCAP; k++) {
    const a = gAge[k];
    if (a >= A.ghostLife) continue;
    const u = a / A.ghostLife;
    const c = Math.cos(gR[k]);
    const s = Math.sin(gR[k]);
    const k2 = 1 - 0.12 * u;
    const sx = STRETCH[0] * k2;
    const sy = STRETCH[1] * k2;
    const sz = STRETCH[2] * k2;
    const o = n * 16;
    arr[o] = c * sx;
    arr[o + 1] = 0;
    arr[o + 2] = -s * sx;
    arr[o + 3] = 0;
    arr[o + 4] = 0;
    arr[o + 5] = sy;
    arr[o + 6] = 0;
    arr[o + 7] = 0;
    arr[o + 8] = s * sz;
    arr[o + 9] = 0;
    arr[o + 10] = c * sz;
    arr[o + 11] = 0;
    arr[o + 12] = gX[k];
    arr[o + 13] = 0;
    arr[o + 14] = gZ[k];
    arr[o + 15] = 1;
    ag[n] = u;
    n++;
  }
  ghosts.count = n;
  if (n) {
    ghosts.instanceMatrix.needsUpdate = true;
    ghostAge.needsUpdate = true;
  }
}

export function inspect(out) {
  out.oeil = bones.oeil ? { x: bones.oeil.position.x, sx: bones.oeil.scale.x, sy: bones.oeil.scale.y, t: S[TIME] } : null;
  out.allure = S[GAIT];
  out.phase = S[PHASE];
  out.penche = S[LEAN];
  out.roulis = S[ROLL];
  out.arretT = S[STOP_T];
  out.receptionT = S[LAND_T];
  out.remanences = ghosts ? ghosts.count : 0;
  out.echelle = mesh ? [mesh.scale.x, mesh.scale.y, mesh.scale.z] : null;
  out.pieds = [mesurePieds[0], mesurePieds[1], mesurePieds[2]]; // vitesse du pied d'appui, état (0 avant, 1 chassés, 2 arrière, 3 arrêt), vitesse
  out.appui = Array.from(mesurePieds); // détail (voir mesurePieds) : hauteurs de la semelle, phase, angles du pied
  out.torsionDeg = ((S[AIMYAW] - S[LOWYAW]) * 180) / Math.PI;
  out.course = { jambe: Array.from(JB), talon: TALON[0], hanche: Array.from(CR_H), cycle: CR_DCYC[0], ecart: CR_ECART[0] }; // course de référence (16/11)
  const c = {};
  cape.inspect(c);
  out.cape = c;
  const t = {};
  tissus.inspect(t); // § E5.I
  out.tissus = t;
}
