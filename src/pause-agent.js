// § E3.I — l'agent en 3D TEMPS RÉEL dans la fiche de la pause (ARCHITECTURE.md § E3.I bis, point 4), et sa VITRINE de l'écran
// Agents et de l'écran titre (plus bas). Le portrait du Noyau (§ E4.L) n'existe plus : l'onglet Agents ouvre l'écran Agents.
//
// Même renderer que le jeu (aucun 2e contexte WebGL), SCÈNE À PART (scenePortrait : soleil et ciel du jeu, un liseré à
// l'accent de l'agent) — pas un calque de la scène du jeu : un 2e état de lumières sur la même scène ferait recalculer
// les clés de programme de chaque matériau à chaque image (voir sceneNets, render.js).
// Maillage : un SkinnedMesh NEUF sur la géométrie du MODÈLE DE L'AGENT montré (§ E4.L.1 : player.modeleAgent(a) ; en
// pause, c'est la géométrie du héros posé), avec un squelette du même ordre d'os que heros.init (racine, une pièce par os,
// buste) et le matériau peint (profil herosAnime). Animation : Warrior Idle cuit (§ E4.E.3), l'idle en code en repli.
// Armes : en pause, l'échelle de chaque os arme_* / tourelle_* du héros du jeu est recopiée ; en vitrine, seule l'arme
// signature de l'agent est portée. Agent verrouillé (§ E4.L.2) : SILHOUETTE PLEINE (matériau uni, sans arme, cape comprise).
// Cape (§ E4.L.3) : une instance à part de src/anim/cape.js (« cape.js?portrait »), jamais la cape du héros en partie.
// Tissus du Shinobi (§ E5.I) : de même, une instance à part de src/anim/tissus.js (« tissus.js?portrait »).
// Rendu (pause, appelé par main.js AVANT la scène) : basse définition (PAUSE.pixel px CSS par pixel d'art) dans
// le coin bas-gauche du canvas du jeu (viewport + scissor, fond transparent), recopié par drawImage dans le <canvas> 2D
// de la fiche ; la scène du jeu (ou du titre) est ensuite rendue par-dessus tout le canvas.
// Écran Agents (tâche 3) : la VITRINE — le même maillage, la même scène et le même renderer en grand et en pleine
// définition (VITRINE.pixel), éclairé en lum-b5 (VITRINE.lumiere), cadré « fiche » ou « titre » (VITRINE.cadres), posé sur
// un halo de lumière et une ombre de contact (disque de sol, aucun cercle), racine verrouillée en x / z. openVitrine /
// renderVitrine / closeVitrine ; une seule chose ouverte à la fois (vitrine OU portrait de la pause).
// Aucune allocation par image dans ce module : vecteurs et tableaux créés à la construction.
import * as THREE from 'three';
import { SKIN_BASE, skinLisere, skinsDe } from './config.js';
import { AGENTS, ANIM, PAUSE, PORTRAIT_CAPE, SILHOUETTE, VITRINE, WEAPONS, WEAPON_KEYS } from './config.js';
import { uniformsPeints } from './rendu/materiaux.js';
import { envoyer } from './rendu/envois.js';
import { IDLES_AGENTS } from './config.js'; // § E5.F.13 : idle du marteau
import { run } from './state.js';
import * as heros from './anim/heros-anim.js';
import { surfaceDos, profilBras, profilJambe, rayonsJambes, axeKatana } from './anim/dos-reel.js'; // skins, tâche 2 : cape et tissus du portrait sur le dos réel, bras réels
import { PEINT } from './rendu/reglages.js';

let ctx = null;
let renderer = null;
let ui = null;
let scene = null;
let cam = null;
let soleil = null;
let ciel = null;
let rim = null;
let mat = null;
let matSil = null; // § E4.L.2 : corps de la silhouette (couleur unie, sans lumière)
let matSilCape = null; // § E4.L.2 : cape de la silhouette (même couleur, double face)
let mesh = null;
let geoPosee = null; // géométrie sur laquelle le portrait est construit (autre agent → reconstruit)
let skinM = SKIN_BASE; // skin du modèle sur lequel le portrait est construit (liseré, reconstruction au changement)
let skinPause = SKIN_BASE; // skin porté par le héros de la pause
let vitrineSkin = SKIN_BASE; // skin montré par la vitrine (fiche, titre)
let dPosee = null; // § E5.K : données (pièces, vides) du modèle du portrait construit
let fixe = false; // § E5.K : la fiche montre l'image fixe d'un agent pas chargé
// 21/11 (Femz : « les perso sont décentrés ») : à chaque ouverture, la caméra se recentre sur la silhouette POSÉE (vue
// 3/4, idle) et non sur l'axe du modèle — le Shinobi, penché lame en avant, tombait ≈ 48 px (2560) à gauche
let recentrer = false;
const BB_POSE = new THREE.Box3();
let toile = null; // <canvas> 2D de la fiche
let g2d = null;
const os = {}; // nom → os du portrait
const copieSrc = []; // os du héros du jeu (arme_*, tourelle_*)
const copieDst = []; // os du portrait de même nom
const armesDst = []; // os d'arme du portrait (arme_*, tourelle_*_socle) : vitrine et silhouette
let oRacine = null;
let oBuste = null;
let oBrasG = null;
let oBrasD = null;
let oTete = null;
const VP = new THREE.Vector4(); // région du canvas (px CSS, origine en bas à gauche)
const SAUVE_VP = new THREE.Vector4();
const SAUVE_SC = new THREE.Vector4();
const SAUVE_CLEAR = new THREE.Color();
// [0] temps de l'idle (s), [1] vue 3/4 (rad), [2] hauteur visée (m), [3] rotation donnée à la souris / au doigt (rad),
// [4] x du pointeur au dernier mouvement (px), [5] glisser en cours (0 / 1)
const T = new Float64Array(6);
// [0] largeur, [1] hauteur du portrait en pixels d'art, [2] hauteur du tampon de dessin, [3] portrait ouvert (0 / 1),
// [4] taille à relire (0 / 1), [5] images rendues depuis le chargement
const N = new Int32Array(6);
// § E4.L : [0] agent montré, [1] mode (0 pause, 2 vitrine), [2] verrouillé (silhouette), [3] cape active, [4] replacer la cape
const M = new Int32Array(5).fill(-1);
const MODE_PAUSE = 0;
const MODE_VITRINE = 2; // Écran Agents et écran titre (1 : l'ancien portrait du Noyau, retiré avec son onglet Agents, tâche 6)
const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

// ----- Écran Agents : vitrine (tâche 3) -----
let camV = null; // caméra de la vitrine (cadre fiche ou titre)
let soleilV = null; // « contre » de lum-b5 : remplace le soleil (une seule directionnelle visible, même clé de programme)
let spotV = null; // projecteur de lum-b5 : TOUJOURS dans la scène, intensité 0 hors vitrine (clé de programme fixe)
let sol = null; // disque du sol : halo de lumière + ombre de contact
let solMat = null;
let toileV = null; // <canvas> 2D de la vitrine (fourni par l'écran qui l'affiche)
let g2dV = null;
const CADRES_V = ['fiche', 'titre'];
// [0] ouverte (0 / 1), [1] agent, [2] cadre (0 fiche, 1 titre), [3] verrouillé (silhouette), [4] taille à relire,
// [5] images rendues, [6] modèle de l'agent absent (rien de rendu tant qu'il n'est pas chargé)
const VN = new Int32Array(7);
// [0..3] région rendue dans la toile (x, y, largeur, hauteur ; px de la toile), [4] largeur, [5] hauteur rendues dans le
// canvas du jeu (≤ tampon de dessin), [6] largeur, [7] hauteur du tampon de dessin à la mesure, [8] largeur, [9] hauteur
// de la toile
const VB = new Int32Array(10);
// [0] temps de l'idle (s), [1] rotation du corps en plus de la vue 3/4 (rad), [2] échelle tampon / région (≤ 1),
// [3] lacet du disque de sol (rad), [4] x, [5] y du point principal dans la toile (px)
const VT = new Float64Array(6);
const VPV = new THREE.Vector4(); // région du canvas du jeu (px CSS, origine en bas à gauche)
const PROJ = new THREE.Vector3();
// uniformes partagés du matériau peint (lus aussi par le décor du jeu) : posés pour le rendu de la vitrine, puis RENDUS
const PT = uniformsPeints.uSrPtTex.value;
const PD = PT.image.data;
const PD_V = new Float32Array(PD.length); // lumières ponctuelles de lum-b5 (monde), écrites à l'ouverture
const PD_SAUVE = new Float32Array(PD.length);
// [0] wrap (uSrLum.x), [1] aplat du ciel (uSrCel.z), [2] force du liseré (uSrCel.w), [3..5] couleur du liseré
// (uSrCelBord.rgb), [6] seuil du liseré (uSrCelBord.w ; NaN : celui du jeu)
const U_V = new Float64Array(7);
const U_SAUVE = new Float64Array(7);
// § E4.E.3 : Warrior Idle (pistes cuites, main.js → setIdle) ; null : l'idle en code (PAUSE.idle) reste le repli
let idleCuit = null;
const HT = new Float64Array(2); // [0] hanche H, [1] pivot du buste T du squelette cuit (m)
const qV = new THREE.Vector3();
const qV2 = new THREE.Vector3();
// § E4.L.3 : cape du portrait (instance à part, chargée à l'init)
let capeMod = null;
let capeMesh = null;
let capeMat = null; // matériau peint de la cape du portrait (rendu à la cape hors silhouette)
// § E5.I : tissus du Shinobi du portrait (instance à part) ; [0] actifs (1 / 0), [1] replacer
let tisMod = null; // jeu de tissus du modèle montré (celui de son skin)
let tisMesh = null;
let tisMat = null;
// skin ombre (tâche 3) : deux instances, [0] tissus.js?portrait (base), [1] tissus.js?portrait-ombre (cape gothique) ;
// leurs maillages et matériaux peints
const TIS_MODS = [null, null];
const TIS_MESHS = [null, null];
const TIS_MATS = [null, null];
const TIS = new Int8Array(2);
const TIS_PIV = new Float64Array(3); // pivot de l'os du bassin
const TIS_ZERO = new Float64Array(3); // axe du katana : repère du modèle (celui du buste)
const MAIN_LOCAL = new Float64Array([0.0, -0.4, 0.04]); // mêmes points que heros-anim (bras → capsules de la cape)
const PIED_LOCAL = new Float64Array(ANIM.heros.pied.capeLocal);
const TIBIA_PIED = new Float64Array([0.0, -0.53, 0.06]);
/** § E4.E.3 : animation cuite de l'idle (Warrior Idle). */
export function setIdle(c) {
  idleCuit = c;
}
// § E5.F : idle propre à chaque agent montré (Bastion, Shinobi) ; repli : idleCuit
const idlesAgents = [null, null, null];
export function setIdleAgent(a, c) {
  idlesAgents[a] = c;
}
// Écran Agents : idle de vitrine propre à chaque agent (Offensive / Holding / Fight Idle), joué en mode vitrine seulement
const idlesVitrine = [null, null, null];
export function setIdleVitrine(a, c) {
  idlesVitrine[a] = c;
}
/** Nombre d'idles de vitrine chargés (debug). */
export function idlesVitrineChargees() {
  return idlesVitrine.filter((c) => c !== null).length;
}
/** § E5.F.13 : idle du Bastion qui tient le marteau (« Great Sword Idle »), montré quand le héros en partie le tient. */
let idleMarteauP = null;
export function setIdleMarteau(c) {
  idleMarteauP = c;
}

export function init(context) {
  ctx = context;
  renderer = ctx.renderer;
  ui = ctx.ui;
  window.addEventListener('resize', () => {
    N[4] = 1;
  });
  brancherRotationVitrine(); // § E5.AQ
  if (crtDuChargement() > 0) setCrtVitrine(crtDuChargement()); // § E5.AQ
  // § E4.L.3 : un module ES par adresse — cette cape ne partage aucun état avec celle du héros (cape.js) ni du titre
  import('./anim/cape.js?portrait').then(
    (m) => {
      capeMod = m;
      if (scene !== null && mesh !== null) prechauffer(); // son programme compilé hors combat, comme le reste
    },
    () => {},
  );
  // § E5.I : tissus du Shinobi du portrait (matériau de la cape : même programme, rien de plus à compiler)
  import('./anim/tissus.js?portrait').then(
    (m) => {
      TIS_MODS[0] = m;
      if (tisMod === null) tisMod = m;
      M[0] = -1; // l'habillage suivant pose les tissus si l'agent montré en porte
    },
    () => {},
  );
  import('./anim/tissus.js?portrait-ombre').then(
    (m) => {
      TIS_MODS[1] = m;
      M[0] = -1; // idem : le skin ombre montré prend sa cape
    },
    () => {},
  );
}

/** Scène, lumières, caméra et matériaux : une fois, à la première pause (hors combat). */
function creerScene() {
  scene = new THREE.Scene();
  const L = PAUSE.lumiere;
  soleil = new THREE.DirectionalLight(PEINT.soleil.couleur, PEINT.soleil.intensite * L.soleil);
  // le soleil du jeu est donné par rapport à l'écran (gauche × depuisGauche + vers la caméra × versCamera, puis
  // élévation) : même règle ici, la caméra du portrait regardant vers −Z
  const S = PEINT.soleil;
  let hx = -S.depuisGauche;
  let hz = S.versCamera;
  const hl = Math.hypot(hx, hz);
  hx /= hl;
  hz /= hl;
  const el = (S.elevationDeg * Math.PI) / 180;
  soleil.position.set(hx * Math.cos(el) * 8, Math.sin(el) * 8, hz * Math.cos(el) * 8);
  soleil.castShadow = true;
  soleil.shadow.mapSize.set(PAUSE.ombre, PAUSE.ombre);
  const sc = soleil.shadow.camera;
  sc.left = -1.6;
  sc.right = 1.6;
  sc.top = 2.4;
  sc.bottom = -0.4;
  sc.near = 0.5;
  sc.far = 20;
  soleil.shadow.bias = PEINT.ombre ? PEINT.ombre.bias : -0.0004;
  soleil.shadow.normalBias = PEINT.ombre ? PEINT.ombre.normalBias : 0.03;
  scene.add(soleil, soleil.target);
  ciel = new THREE.HemisphereLight(PEINT.ciel.couleur, PEINT.ciel.sol, PEINT.ciel.intensite * L.ciel);
  scene.add(ciel);
  rim = new THREE.PointLight(0xffffff, L.rim, L.rimDistance, 2);
  rim.position.set(1.4, 2.2, -2.2); // derrière, en haut à droite : liseré à l'accent de l'agent
  scene.add(rim);
  cam = new THREE.PerspectiveCamera(PAUSE.camera.fov, 0.75, 0.1, 50);
  mat = ctx.render.createLitMaterial({ glowColor: AGENTS[run.agent].accent, profil: 'herosAnime' });
  // § E4.L.2 : silhouette pleine — une couleur, ni lumière, ni brouillard, ni courbe de tons
  matSil = new THREE.MeshBasicMaterial({ color: SILHOUETTE.couleur, toneMapped: false, fog: false });
  matSilCape = new THREE.MeshBasicMaterial({ color: SILHOUETTE.couleur, toneMapped: false, fog: false, side: THREE.DoubleSide });
  // Écran Agents : lumières de la vitrine. soleilV (ombres, carte VITRINE.ombre) et le soleil de la pause ne sont jamais
  // visibles ensemble ; spotV reste dans la scène à intensité 0 hors vitrine : la pause et la vitrine ont la MÊME clé de
  // programme (aucune recompilation ni changement de programme en passant de l'une à l'autre)
  soleilV = new THREE.DirectionalLight(0xffffff, 1);
  soleilV.castShadow = true;
  soleilV.shadow.mapSize.set(VITRINE.ombre, VITRINE.ombre);
  const co = VITRINE.lumiere.contre.cadreOmbre;
  const sv = soleilV.shadow.camera;
  sv.left = -co;
  sv.right = co;
  sv.top = co;
  sv.bottom = -co;
  sv.near = 0.5;
  sv.far = 20;
  sv.updateProjectionMatrix();
  soleilV.shadow.bias = soleil.shadow.bias;
  soleilV.shadow.normalBias = soleil.shadow.normalBias;
  soleilV.visible = false;
  scene.add(soleilV, soleilV.target);
  spotV = new THREE.SpotLight(0xffffff, 0, 12, 0.24, 0.85, 2);
  scene.add(spotV, spotV.target);
  camV = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  sol = creerSol();
  scene.add(sol);
}

/**
 * Écran Agents : disque du sol de la vitrine — halo de lumière du projecteur et ombre de contact (douce, plus noire sous
 * chaque pied), en ALPHA PRÉMULTIPLIÉ sur le fond transparent de la vitrine : recopiée sur le décor peint, l'ombre
 * l'assombrit (× (1 − a)) et le halo l'éclaircit. Rendu en premier, sans test de profondeur : l'agent passe toujours devant.
 * Repère du disque : (x, z) au sol autour des pieds, z vers la caméra (lacet VT[3]).
 */
function creerSol() {
  const S = VITRINE.sol;
  const F = S.flaque;
  const O = S.ombre;
  const P = S.pieds;
  solMat = new THREE.ShaderMaterial({
    uniforms: {
      uPieds: { value: new THREE.Vector4(99, 99, 99, 99) },
      uFlaque: { value: new THREE.Vector4(F.force, F.rayon, F.puissance, F.avance) },
      uFlaqueE: { value: F.ecrasement },
      uOmbre: { value: new THREE.Vector4(O.force, O.rayon, O.puissance, O.ecrasement) },
      uPied: { value: new THREE.Vector4(P.force, P.rayon, P.ecrasement, S.alphaMax) },
      uCouleur: { value: new THREE.Vector3(F.couleur[0], F.couleur[1], F.couleur[2]) },
      // région rendue (px du tampon, viewport en 0, 0) et fondus de bord (part de la largeur, part de la hauteur en bas) :
      // le halo, plus large que la région, s'efface avant ses bords au lieu de s'y couper en rectangle (tâche 6)
      uVue: { value: new THREE.Vector4(1, 1, S.fonduBord[0], S.fonduBord[1]) },
    },
    vertexShader: `varying vec2 vP;
void main() {
  vP = vec2( position.x, - position.y );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
    fragmentShader: `uniform vec4 uPieds; uniform vec4 uFlaque; uniform float uFlaqueE; uniform vec4 uOmbre; uniform vec4 uPied; uniform vec3 uCouleur; uniform vec4 uVue;
varying vec2 vP;
void main() {
  float rf = length( vec2( vP.x, ( vP.y - uFlaque.w ) * uFlaqueE ) );
  float ap = uFlaque.x * pow( max( 0.0, 1.0 - rf / uFlaque.y ), uFlaque.z );
  float ro = length( vec2( vP.x, vP.y * uOmbre.w ) );
  float ao = uOmbre.x * pow( max( 0.0, 1.0 - ro / uOmbre.y ), uOmbre.z );
  float b1 = uPied.x * max( 0.0, 1.0 - length( vec2( vP.x - uPieds.x, ( vP.y - uPieds.y ) * uPied.z ) ) / uPied.y );
  float b2 = uPied.x * max( 0.0, 1.0 - length( vec2( vP.x - uPieds.z, ( vP.y - uPieds.w ) * uPied.z ) ) / uPied.y );
  float as = 1.0 - ( 1.0 - ao ) * ( 1.0 - b1 ) * ( 1.0 - b2 );
  float a = min( 1.0 - ( 1.0 - ap ) * ( 1.0 - as ), uPied.w );
  vec2 q = gl_FragCoord.xy / uVue.xy;
  float bord = smoothstep( 0.0, uVue.z, q.x ) * smoothstep( 0.0, uVue.z, 1.0 - q.x ) * smoothstep( 0.0, uVue.w, q.y );
  gl_FragColor = vec4( uCouleur * ap * ( 1.0 - as ), a ) * bord;
}`,
    transparent: false, // liste opaque : dessiné AVANT l'agent (renderOrder), le mélange vient de CustomBlending
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(S.taille, S.taille, 1, 1), solMat);
  m.name = 'vitrine-sol';
  m.rotation.order = 'YXZ';
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.002;
  m.renderOrder = -10;
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  m.visible = false;
  return m;
}

/** Données du modèle de l'agent a (pièces, vides, géométrie) ; en repli, le héros posé. */
function donneesAgent(a, skin = SKIN_BASE) {
  // § E5.K : seuls l'agent CHOISI et celui de la fiche de l'écran Agents sont chargés (player.modeleAgent : null pour un
  // autre) — jamais montré sur le modèle d'un autre
  if (ctx.player && ctx.player.modeleAgent) {
    const d = ctx.player.modeleAgent(a, skin);
    return d && d.geometry ? d : null;
  }
  const hm = heros.getMesh(); // page sans module player (prototype) : le héros posé
  const h = heros.donneesHeros();
  return hm && h ? { geometry: hm.geometry, pieces: h.pieces, vides: h.vides } : null;
}

/**
 * skinIndex / skinWeight d'un modèle jamais posé par heros.init (§ E4.L.1) : MÊMES valeurs que heros.init (os 0 =
 * racine, os k + 1 = pièce k, os buste en dernier ; torsion de l'abdomen répartie corps / buste) — heros.init les
 * réécrit à l'identique sur les mêmes tableaux.
 */
function ecrirePeau(geometry, pieces) {
  if (geometry.attributes.skinIndex) return;
  const n = geometry.attributes.position.count;
  const piece = geometry.attributes.piece.array;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    si[i * 4] = piece[i] + 1;
    sw[i * 4] = 1;
  }
  const iCorps = pieces.findIndex((p) => p.nom === 'corps');
  const iBuste = pieces.length + 1;
  const pos = geometry.attributes.position.array;
  const ab = ANIM.corps.abdomen;
  for (let v = 0; v < n; v++) {
    if (piece[v] !== iCorps) continue;
    let u = (pos[v * 3 + 1] - ab[0]) / (ab[1] - ab[0]);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    u = u * u * (3 - 2 * u);
    si[v * 4] = iCorps + 1;
    si[v * 4 + 1] = iBuste;
    sw[v * 4] = 1 - u;
    sw[v * 4 + 1] = u;
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
}

/** Squelette du portrait sur la géométrie du modèle de l'agent a. Faux si aucun modèle n'est arrivé. Hors combat. */
function construire(a, skin = SKIN_BASE) {
  const d = donneesAgent(a, skin);
  if (!d) return false;
  skinM = skin;
  if (geoPosee === d.geometry && mesh !== null) return true;
  if (mesh !== null) {
    mesh.removeFromParent();
    mesh.skeleton.dispose();
    mesh = null;
  }
  for (const k of Object.keys(os)) delete os[k];
  copieSrc.length = 0;
  copieDst.length = 0;
  armesDst.length = 0;
  const { pieces, vides } = d;
  ecrirePeau(d.geometry, pieces);
  const root = new THREE.Bone();
  root.name = 'racine';
  const buste = new THREE.Bone();
  buste.name = 'buste';
  buste.rotation.order = 'YXZ';
  const list = [root];
  const objs = pieces.map((p) => {
    const b = new THREE.Bone();
    b.name = p.nom;
    b.rotation.order = 'XZY';
    os[p.nom] = b;
    list.push(b);
    return b;
  });
  root.add(buste);
  pieces.forEach((p, i) => {
    const haut = p.parent < 0 && /^(bras_|tete|tourelle_|col_echarpe$|arme_katana(_evo)?$|arme_sentinelle(_evo)?$|arme_canon(_evo)?$)/.test(p.nom); // comme heros-anim (katana du dos, tourelles du dos)
    const parent = p.parent >= 0 ? objs[p.parent] : haut ? buste : root;
    const pp = p.parent >= 0 ? pieces[p.parent].pivot : [0, 0, 0];
    objs[i].position.set(p.pivot[0] - pp[0], p.pivot[1] - pp[1], p.pivot[2] - pp[2]);
    parent.add(objs[i]);
  });
  list.push(buste);
  mesh = new THREE.SkinnedMesh(d.geometry, mat);
  mesh.name = 'pause-agent';
  mesh.rotation.order = 'YXZ';
  mesh.add(root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  mesh.frustumCulled = false;
  piedsSommets(d); // § E5.AP
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  geoPosee = d.geometry;
  dPosee = d;
  oRacine = root;
  oBuste = buste;
  os.buste = buste; // § E4.E.3 : piste « buste » des animations cuites
  { // § E4.E.3 : hanche et pivot du buste du squelette cuit (heros-menu : HANCHE, TAILLE = HANCHE + 8,3 cm)
    const j = pieces.find((p) => p.nom === 'jambe_g');
    HT[0] = j ? j.pivot[1] : 0.9;
    HT[1] = HT[0] + 0.083;
  }
  oBrasG = os.bras_g || null;
  oBrasD = os.bras_d || null;
  oTete = os.tete || null;
  // os dont l'échelle dit si l'arme est portée (armes-heros : 1 portée, 1e-4 rangée ; tourelles déployées)
  for (const p of pieces) {
    if (!/^(arme_|tourelle_\d+_socle)/.test(p.nom)) continue;
    armesDst.push(os[p.nom]);
    const src = heros.os(p.nom);
    if (!src) continue;
    copieSrc.push(src);
    copieDst.push(os[p.nom]);
  }
  // cadrage : le modèle entier (boîte englobante de la géométrie), vue 3/4
  if (!d.geometry.boundingBox) d.geometry.computeBoundingBox();
  const bb = d.geometry.boundingBox;
  const h = bb.max.y - bb.min.y;
  T[2] = bb.min.y + h * 0.5;
  T[1] = (PAUSE.camera.vueDeg * Math.PI) / 180;
  const C = PAUSE.camera;
  const dist = (h * C.marge * 0.5) / Math.tan((C.fov * Math.PI) / 360);
  const pl = (C.plongeeDeg * Math.PI) / 180;
  cam.position.set(0, T[2] + Math.sin(pl) * dist, Math.cos(pl) * dist);
  cam.lookAt(0, T[2], 0);
  soleil.target.position.set(0, T[2], 0);
  soleil.target.updateMatrixWorld();
  M[0] = -1; // la cape et l'habillage sont repris par habiller()
  M[3] = -1;
  TIS[0] = -1; // § E5.I : tissus aussi
  return true;
}

/**
 * § E4.L : agent a montré (mode, verrou) — matériaux, liseré, armes, cape. Hors combat (ouverture, changement d'agent).
 */
function habiller(a, mode, verrou) {
  const change = M[0] !== a;
  M[0] = a;
  M[1] = mode;
  M[2] = verrou ? 1 : 0;
  mesh.material = verrou ? matSil : mat;
  mesh.castShadow = !verrou;
  const lisere = skinLisere(AGENTS[a].key, skinM, AGENTS[a].accent); // liseré propre au skin (carmin de l'ombre), sinon l'accent de l'agent
  mat.userData.uniforms.uGlowColor.value.setHex(lisere);
  rim.color.setHex(lisere);
  // armes : en pause, celles du héros du jeu (refreshWeapons à chaque image) ; en vitrine, la signature seule ; une
  // silhouette n'en porte aucune
  if (mode !== MODE_PAUSE || verrou) {
    const w = WEAPON_KEYS.indexOf(AGENTS[a].signatureKey);
    const mt = w >= 0 ? WEAPONS[w].mount : null;
    const nom = w >= 0 ? 'arme_' + (mt ? mt.node : WEAPONS[w].key) : '';
    // jumelle « _d » (lame droite du Shinobi, armes-heros.js JUMEAUX) : portée avec sa signature
    for (let i = 0; i < armesDst.length; i++) armesDst[i].scale.setScalar(!verrou && (armesDst[i].name === nom || armesDst[i].name === nom + '_d') ? 1 : 1e-4);
  }
  // cape (§ E4.L.3) : l'agent sans cape (Bastion) n'en a pas ; replacée au changement d'agent
  if (capeMod !== null && (change || M[3] < 0)) {
    const d = dPosee; // § E5.K : le modèle du portrait construit (préchauffage : celui qui est chargé)
    if (AGENTS[a].cape !== false && d) {
      const v = d.vides || {};
      const vg = v.cape_epaule_g ? v.cape_epaule_g.position : [0.192, 1.533, -0.163];
      const vd = v.cape_epaule_d ? v.cape_epaule_d.position : [-0.192, 1.533, -0.163];
      const ud = v.cape_dos ? v.cape_dos.userData : {};
      const dos = ud.a && ud.b && ud.rayon ? { a: ud.a, b: ud.b, rayon: ud.rayon } : { a: [0, 1.054, -0.029], b: [0, 1.437, -0.029], rayon: 0.153 };
      capeMod.init({ scene, ancrageG: vg, ancrageD: vd, dos, jambes: { a: [0, 0.6, 0], b: [0, 0.61, 0], rayon: 0 }, surface: surfaceDos(d.geometry, d.pieces), bras: [profilBras(d.geometry, d.pieces, 'bras_g', 'avant_bras_g', MAIN_LOCAL), profilBras(d.geometry, d.pieces, 'bras_d', 'avant_bras_d', MAIN_LOCAL)], jambesReelles: [profilJambe(d.geometry, d.pieces, 'g', PIED_LOCAL), profilJambe(d.geometry, d.pieces, 'd', PIED_LOCAL)] });
      if (capeMesh === null) {
        capeMesh = capeMod.getMesh();
        capeMesh.name = 'portrait-cape';
        capeMat = capeMesh.material;
      }
      capeMod.setVisible(true);
      M[3] = 1;
    } else {
      capeMod.couper();
      M[3] = 0;
    }
    M[4] = 1;
  }
  if (capeMesh !== null) {
    capeMesh.material = verrou ? matSilCape : capeMat;
    capeMesh.castShadow = !verrou;
  }
  // skin ombre (tâche 3) : le jeu de tissus du skin du modèle montré (repli sur la base tant que le sien n'est pas lu)
  {
    const j = skinM === 'ombre' && TIS_MODS[1] !== null ? 1 : 0;
    if (TIS_MODS[j] !== null && tisMod !== TIS_MODS[j]) {
      if (tisMod !== null) tisMod.couper();
      tisMod = TIS_MODS[j];
      tisMesh = TIS_MESHS[j];
      tisMat = TIS_MATS[j];
      TIS[0] = -1;
    }
  }
  // § E5.I : tissus du Shinobi (pan devant, pan du dos, queue de l'écharpe) ; silhouette unie si l'agent est verrouillé
  if (tisMod !== null && (change || TIS[0] < 0 || (TIS[0] === 0 && AGENTS[a].tissus))) {
    const d = dPosee;
    if (AGENTS[a].tissus && d) {
      const ud = (d.vides || {}).cape_dos ? d.vides.cape_dos.userData : {};
      const pc = d.pieces.find((p) => p.nom === 'corps');
      for (let i = 0; i < 3; i++) TIS_PIV[i] = pc ? pc.pivot[i] : 0;
      const vi = d.vides || {};
      const epaules = vi.cape_epaule_g && vi.cape_epaule_d ? { g: vi.cape_epaule_g.position, d: vi.cape_epaule_d.position } : null;
      tisMod.init({ scene, dos: ud.a && ud.b && ud.rayon ? { a: ud.a, b: ud.b, rayon: ud.rayon } : null, surface: surfaceDos(d.geometry, d.pieces, 'libres'), jambes: rayonsJambes(d.geometry, d.pieces, PIED_LOCAL), devant: surfaceDos(d.geometry, d.pieces, 'libres', 'devant'), epaules, surfaceRepos: surfaceDos(d.geometry, d.pieces), katana: skinM === 'ombre' ? axeKatana(d.geometry, d.pieces) : null });
      if (tisMesh === null) {
        tisMesh = tisMod.getMesh();
        tisMesh.name = 'portrait-tissus';
        tisMat = tisMesh.material;
        const j = TIS_MODS.indexOf(tisMod);
        TIS_MESHS[j] = tisMesh;
        TIS_MATS[j] = tisMat;
      }
      tisMod.setVisible(true);
      TIS[0] = 1;
    } else {
      tisMod.couper();
      TIS[0] = 0;
    }
    TIS[1] = 1;
  }
  if (tisMesh !== null) {
    tisMesh.material = verrou ? matSilCape : tisMat;
    tisMesh.castShadow = !verrou;
  }
}

/** Taille du portrait (pixels d'art) relue sur le <canvas> de la fiche : à l'ouverture et après un redimensionnement. */
function mesurer() {
  const cw = toile.clientWidth;
  const ch = toile.clientHeight;
  // 21/11 (capture de Femz : portrait en 8 × 8 pixels géants) — menus « Pile » : la pause s'ouvre sur le MENU, la fiche
  // (et sa toile) est cachée ; mesurée là, la toile valait 0 px → plancher de 8 pixels d'art, jamais relu à l'ouverture
  // de l'inventaire. Toile cachée : pas de mesure, ni de rendu ; la taille est relue à la prochaine image.
  if (cw === 0 || ch === 0) {
    N[4] = 1;
    return false;
  }
  N[4] = 0;
  const px = PAUSE.pixel;
  const w = Math.max(8, Math.round(cw / px));
  const h = Math.max(8, Math.round(ch / px));
  if (toile.width !== w) toile.width = w;
  if (toile.height !== h) toile.height = h;
  g2d.imageSmoothingEnabled = false;
  N[0] = w;
  N[1] = h;
  const pr = renderer.getPixelRatio();
  VP.set(0, 0, w / pr, h / pr);
  N[2] = renderer.domElement.height;
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  return true;
}

/** Un rendu de la scène du portrait dans un seul pixel (préchauffage : programmes compilés, géométries envoyées). */
function rendrePixel(camera) {
  const rt = renderer.getRenderTarget();
  renderer.getViewport(SAUVE_VP);
  renderer.getScissor(SAUVE_SC);
  const scissor = renderer.getScissorTest();
  VP.set(0, 0, 1, 1);
  renderer.setRenderTarget(null);
  renderer.setViewport(VP);
  renderer.setScissor(VP);
  renderer.setScissorTest(true);
  renderer.render(scene, camera);
  renderer.setScissorTest(scissor);
  renderer.setViewport(SAUVE_VP);
  renderer.setScissor(SAUVE_SC);
  renderer.setRenderTarget(rt);
  N[4] = 1; // VP a servi au pixel : la taille du portrait est relue à la prochaine image
}

/**
 * Préchauffage (main.modelesTraiter, écran titre, juste après render.prewarm) : scène, maillage et programmes du portrait
 * compilés AVANT la partie — peint, cape du portrait (§ E4.L.3) et silhouette (§ E4.L.2). Sans lui, la 1re pause
 * compilait un programme de plus : fondation.test (« programmes compilés stables depuis l'écran titre ») passait de 73 à
 * 74 — mesuré à la fusion du groupe 2 (16/11/2026). Rien n'est rendu ni affiché ici.
 */
export function prechauffer() {
  if (scene === null) creerScene();
  // un agent à cape (l'Éclaireur) : le programme de la cape est compilé même si l'agent courant est le Bastion
  // § E5.K : sur le modèle CHARGÉ (celui de l'agent choisi), habillé en Éclaireur le temps du préchauffage
  let charge = 0;
  let chargeSkin = SKIN_BASE;
  if (ctx.player && ctx.player.aModeleAgent) {
    charge = -1;
    for (let a = 0; a < AGENTS.length && charge < 0; a++) {
      const l = skinsDe(AGENTS[a].key);
      for (let i = 0; i < l.length && charge < 0; i++) if (ctx.player.aModeleAgent(a, l[i])) [charge, chargeSkin] = [a, l[i]];
    }
    if (charge < 0) return;
  }
  const skin0 = skinM; // le portrait construit avant le préchauffage (repris à la fin)
  if (!construire(charge, chargeSkin)) return;
  const a0 = M[0];
  const m0 = M[1];
  const v0 = M[2];
  lumieresPause();
  habiller(0, MODE_PAUSE, false);
  if (M[3] === 1) capeMod.sync();
  // un vrai rendu, par le même chemin que render() (canvas, viewport + scissor, ombre du soleil) dans un seul pixel :
  // renderer.compile seul ne suffit pas (mesuré : le programme de la 1re pause était encore neuf). L'image suivante du
  // jeu recouvre tout le canvas.
  rendrePixel(cam);
  habiller(0, MODE_PAUSE, true); // silhouette : corps et cape unis
  rendrePixel(cam);
  // Écran Agents : vitrine — sol (son programme), lumières lum-b5 (même clé de programme que la pause) et sa carte d'ombre
  habiller(0, MODE_VITRINE, false);
  lumieresVitrine(0, 0);
  sol.visible = true;
  cadrerVitrine(64, 64, 0, 0);
  camV.clearViewOffset();
  rendrePixel(camV);
  lumieresPause();
  VN[4] = 1; // la vitrine ouverte (s'il y en a une) se recadre et se rhabille (M[0] = −1 ci-dessous)
  habiller(0, MODE_PAUSE, false);
  if (a0 >= 0 && (a0 !== 0 || skin0 !== chargeSkin) && construire(a0, skin0)) habiller(a0, m0, v0 === 1);
  M[0] = -1; // § E5.K : l'habillage du préchauffage n'est pas celui d'un agent montré (la prochaine ouverture le refait)
  M[4] = 1;
}

/**
 * § E5.K : le modèle de géométrie g est libéré (player.libererModele, changement d'agent) — le portrait construit dessus
 * est défait (squelette libéré, plus aucune référence) ; il sera reconstruit sur le modèle chargé à la prochaine ouverture.
 */
export function oublier(g) {
  if (mesh === null || geoPosee !== g) return;
  mesh.removeFromParent();
  mesh.skeleton.dispose();
  mesh = null;
  geoPosee = null;
  dPosee = null;
  M[0] = -1;
  if (VN[0] === 1 && g2dV) g2dV.clearRect(0, 0, toileV.width, toileV.height); // vitrine : rien tant que rien n'est reconstruit
  if (N[3] === 1) {
    N[3] = 0;
    fixe = true;
    if (g2d) g2d.clearRect(0, 0, toile.width, toile.height);
    if (ui && ui.setPortrait3d) ui.setPortrait3d(false); // l'image fixe revient tant que rien n'est reconstruit
  }
}

/** Ouverture de la pause (main.pause) : l'agent de la partie, de face. Construit au premier appel, puis réutilise. */
export function open() {
  ouvrir(run.agent, MODE_PAUSE, false);
}

function ouvrir(a, mode, verrou) {
  if (VN[0] === 1) closeVitrine(); // une seule chose ouverte : la vitrine ou le portrait
  if (toile === null) {
    toile = ui.getPortraitCanvas ? ui.getPortraitCanvas() : null;
    if (toile === null) return; // pas de fiche (thème désert)
    g2d = toile.getContext('2d', { alpha: true });
    brancherRotation(toile);
  }
  T[3] = 0;
  T[5] = 0;
  if (scene === null) creerScene();
  lumieresPause();
  skinPause = mode === MODE_PAUSE && ctx.player && ctx.player.skinCourant ? ctx.player.skinCourant() : SKIN_BASE;
  if (!construire(a, skinPause)) {
    // § E5.K : agent pas chargé — IMAGE FIXE : le portrait pixel de la fiche (AGENT_SCREEN.portraits), aucun rendu 3D
    N[3] = 0;
    M[0] = a;
    M[1] = mode;
    M[2] = verrou ? 1 : 0;
    fixe = true;
    if (g2d) g2d.clearRect(0, 0, toile.width, toile.height); // aucune image 3D périmée (autre agent) sous l'image fixe
    ui.setPortrait3d(false);
    return;
  }
  fixe = false;
  habiller(a, mode, verrou);
  M[4] = 1; // cape replacée sans fouet (ouverture)
  TIS[1] = 1; // § E5.I : tissus aussi
  N[3] = 1;
  N[4] = 1;
  recentrer = true;
  ui.setPortrait3d(true);
}

/**
 * Caméra centrée sur la silhouette posée : boîte des sommets APRÈS la peau (os de l'idle, armes rangées réduites à leur
 * os), en monde ; la caméra regarde vers −Z, l'axe horizontal de l'image est donc X. Une fois par ouverture (après le
 * premier poser()), hors combat ; le glisser fait ensuite tourner l'agent sur son axe, la caméra ne bouge plus.
 */
function centrerSurPose() {
  mesh.updateMatrixWorld(true);
  BB_POSE.setFromObject(mesh, true);
  if (BB_POSE.isEmpty()) return;
  const xc = (BB_POSE.min.x + BB_POSE.max.x) * 0.5;
  cam.position.x = xc;
  cam.lookAt(xc, T[2], 0);
}

/** Reprise : plus de rendu du portrait (ressources gardées pour la prochaine ouverture). */
export function close() {
  N[3] = 0;
  fixe = false;
}

/** Recopie l'échelle des os d'armes du héros du jeu : une arme gagnée apparaît sur le portrait (pause seulement). */
export function refreshWeapons() {
  if (M[1] !== MODE_PAUSE || M[2] === 1) return;
  for (let i = 0; i < copieDst.length; i++) copieDst[i].scale.copy(copieSrc[i].scale);
}

/** Idle : respiration du buste, balancier des bras, tête, lent pivot autour de la vue 3/4 (temps réel de la pause). */
function poser() {
  if (idleCuit !== null || idlesAgents[M[0]] !== null) {
    // § E5.F.13 : l'agent montré est celui de la partie et il tient le marteau → « Great Sword Idle »
    const marteau = idleMarteauP !== null && IDLES_AGENTS.marteau.actif && heros.IDLE_MARTEAU[0] === 1 && M[0] === run.agent;
    poserCuit(marteau ? idleMarteauP : idlesAgents[M[0]] !== null && idlesAgents[M[0]] !== undefined ? idlesAgents[M[0]] : idleCuit, 0, false); // § E5.F
    mesh.rotation.y = -T[1] + T[3];
    return;
  }
  poserCode(T[0], T[3]);
}

/** Idle en code (repli sans animation cuite) au temps t, rotation rot en plus de la vue 3/4. */
function poserCode(t, rot) {
  const I = PAUSE.idle;
  const s = Math.sin((TAU * t) / I.souffleS);
  oRacine.position.y = I.racine * (s - 1) * 0.5;
  oBuste.rotation.x = I.buste * s;
  if (oBrasG) oBrasG.rotation.z = I.bras * (0.6 + 0.4 * s);
  if (oBrasD) oBrasD.rotation.z = -I.bras * (0.6 + 0.4 * s);
  if (oTete) oTete.rotation.y = I.tete * Math.sin((TAU * t) / I.teteS);
  mesh.rotation.y = -T[1] + I.pivot * Math.sin((TAU * t) / I.pivotS) + rot;
}

/**
 * § E4.E.3 — Warrior Idle : pistes cuites (squelette de l'écran titre : racine à la hanche, buste 8,3 cm au-dessus) sur
 * le squelette du portrait (racine et buste à l'origine) : racine = Pm − Qr·H, buste = T − Qb·T (mêmes points du corps).
 * Temps de la pause (h = 0 : T[0]) ou de la vitrine (h = 1 : VT[0]), passé par c.temps : aucun flottant en argument (§ V).
 */
function poserCuit(c, h, verrou) {
  //#region e5:AP-pieds-menus
  // § E5.AP : en vitrine (verrou = 1), la hanche n'est plus clouée en x / z (les pieds glissaient de tout le balancement du
  // bassin) : le x / z du clip est gardé, puis la correction précalculée (ancrerPieds) pose les pieds au sol et les y tient
  if (verrou && (ancClip !== c || ancGeo !== geoPosee)) {
    ANC_MS[0] = performance.now();
    ancrerPieds(c);
    ANC_MS[0] = performance.now() - ANC_MS[0]; // durée du précalcul (ms, tests) : une fois par clip et par modèle
  }
  //#endregion
  c.temps[0] = h === 1 ? VT[0] : T[0];
  c.echantillonner(null, os, oRacine, 0);
  hancheDuClip();
  if (verrou) appliquerAncre(c); // § E5.AP
}

/** Racine et buste du squelette cuit (racine à la hanche, buste 8,3 cm au-dessus) ramenés sur ceux du portrait. */
function hancheDuClip() {
  qV.set(0, HT[0], 0).applyQuaternion(oRacine.quaternion);
  oRacine.position.sub(qV);
  qV2.set(0, HT[1], 0).applyQuaternion(oBuste.quaternion);
  oBuste.position.set(-qV2.x, HT[1] - qV2.y, -qV2.z);
}

//#region e5:AP-pieds-menus
// § E5.AP — pieds de la vitrine posés au sol. Correction de racine (dx, dy, dz) par image du clip de vitrine, précalculée
// hors image sur les SOMMETS RÉELS des pieds (pièces pied_* et orteils_*, coordonnées dans le repère de leur os), puis lue
// à chaque image entre deux images du clip. Tableaux préalloués : aucun objet créé, ni au précalcul ni par image.
const ANC_MAX = 2048; // échantillons au plus (le plus long, Offensive Idle : 317 images × ANC_SUR = 1 268)
// suréchantillonnage du précalcul : ANC_SUR échantillons par image du clip. À 1, l'écran à 60 i/s interpolait entre deux
// images du clip (30 i/s) une IK qui n'est exacte qu'aux images : la pointe glissait jusqu'à 0,3 m/s (Fight Idle, mesuré)
const ANC_SUR = 4;
const ANC = new Float64Array(ANC_MAX * 3); // par image : dx, dy, dz (m, repère du maillage)
// par image : bas g, bas d, centre x g, z g, x d, z d (sommets des pieds), hanche x, z (racine du clip)
const ANC_B = new Float64Array(ANC_MAX * 8);
const ANC_MS = new Float64Array(1); // durée du dernier précalcul (ms)
const ANC_N = new Int32Array(1); // images de la correction (0 : aucune, l'ancien calage s'applique)
// tests (inspect().vitrine.ancre), en m : [0] glissement résiduel max d'un pied posé (après correction), [1] excursion max
// d'un pied posé avec le x / z du clip seul, [2] excursion max d'un pied posé hanche clouée (ancien calage), [3] bas des
// pieds au-dessus du sol sans recalage (min), [4] (max), [5] balancement de la hanche après correction (écart max à 0)
const ANC_INFO = new Float64Array(6);
const ANC_POIDS = new Float64Array([0.01, 0.025]); // pied posé : à moins de [0] m au-dessus du plus bas (poids 1), 0 à [1]
// référence d'un pied : centre de ses sommets à moins de ANC_ZONE m au-dessus de son point le plus bas. Mesuré (sonde) : une
// zone de 1 cm glisse du talon à la pointe quand le pied se déroule, et la tenir fait glisser le pied (Shinobi : 0,146 m/s
// au contact) ; le centre du pied ENTIER (pied rigide, orientation du clip) est la référence retenue
const ANC_ZONE = 10;
const ANC_L = new Float64Array(ANC_MAX * 2); // lissage de la correction horizontale (tampon)
const ANC_W = new Float64Array(ANC_MAX * 2); // par image : poids « posé » g, d
const ANC_P = new Float64Array(ANC_MAX * 4);
const ANC_PH = new Int32Array(ANC_MAX * 2); // par image : numéro de la phase d'appui du pied g, d (−1 : levé)
const PQ = new Float64Array(ANC_MAX * 8); // par image : orientation (monde, corps non tourné) du pied g, d — clip
const PHQ = new Float64Array(ANC_MAX * 8); // par phase (numéro) : orientation moyenne du pied g, d pendant la phase
const qPQ = new THREE.Quaternion(); // par image : ancre de la phase d'appui g (x, z), d (x, z) — repère du clip
let ancClip = null;
let ancGeo = null;
// par pied (g, d) : [os, Float32Array des sommets (x, y, z dans le repère de l'os), os, …] — construire()
const PIEDS_V = [[], []];

/** Sommets des pieds dans le repère de leur os (inverse de liaison du squelette du portrait). Hors image (construire). */
function piedsSommets(d) {
  const pc = d.geometry.attributes.piece.array;
  const pos = d.geometry.attributes.position.array;
  const inv = mesh.skeleton.boneInverses;
  const v = new THREE.Vector3();
  for (let k = 0; k < 2; k++) {
    PIEDS_V[k].length = 0;
    for (const nom of ['pied_', 'orteils_']) {
      const ip = d.pieces.findIndex((p) => p.nom === nom + 'gd'[k]);
      if (ip < 0) continue;
      let n = 0;
      for (let i = 0; i < pc.length; i++) if (pc[i] === ip) n++;
      const l = new Float32Array(n * 3);
      let j = 0;
      for (let i = 0; i < pc.length; i++) {
        if (pc[i] !== ip) continue;
        v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(inv[ip + 1]);
        l[j++] = v.x;
        l[j++] = v.y;
        l[j++] = v.z;
      }
      PIEDS_V[k].push(os[nom + 'gd'[k]], l);
    }
  }
  ancClip = null; // géométrie changée : correction à refaire
}

/**
 * Pied k : bas (y min) et centre x, z de sa ZONE DE CONTACT (sommets à moins de ANC_ZONE m au-dessus de son bas : la
 * semelle quand il est à plat, la pointe quand il se déroule), écrits dans ANC_B à l'offset o (o + k, o + 2 + 2k, o + 3 + 2k).
 */
function mesurerPied(k, o) {
  const L = PIEDS_V[k];
  let bas = 1e9;
  for (let p = 0; p < L.length; p += 2) {
    const e = L[p].matrixWorld.elements;
    const l = L[p + 1];
    for (let i = 0; i < l.length; i += 3) {
      const wy = e[1] * l[i] + e[5] * l[i + 1] + e[9] * l[i + 2] + e[13];
      if (wy < bas) bas = wy;
    }
  }
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (let p = 0; p < L.length; p += 2) {
    const e = L[p].matrixWorld.elements;
    const l = L[p + 1];
    for (let i = 0; i < l.length; i += 3) {
      const x = l[i];
      const y = l[i + 1];
      const z = l[i + 2];
      if (e[1] * x + e[5] * y + e[9] * z + e[13] > bas + ANC_ZONE) continue;
      sx += e[0] * x + e[4] * y + e[8] * z + e[12];
      sz += e[2] * x + e[6] * y + e[10] * z + e[14];
      n++;
    }
  }
  ANC_B[o + k] = bas;
  ANC_B[o + 2 + 2 * k] = sx / n;
  ANC_B[o + 3 + 2 * k] = sz / n;
}

/** Poids « posé » d'un pied à h m au-dessus du pied le plus bas (1 → 0 entre ANC_POIDS[0] et [1]). */
function poidsPose(h) {
  return h <= ANC_POIDS[0] ? 1 : h >= ANC_POIDS[1] ? 0 : (ANC_POIDS[1] - h) / (ANC_POIDS[1] - ANC_POIDS[0]);
}

/**
 * Précalcul de la correction du clip c sur le squelette de la vitrine (§ E5.AP, point 2). Hors image : à l'ouverture, à
 * l'arrivée de l'idle de vitrine, au changement d'agent. Pose le squelette image par image (corps non tourné : repère du
 * maillage), mesure les pieds, puis : dy pose le plus bas sur y = 0 ; dx, dz tiennent les pieds posés sur leur ancre
 * (moyenne de leur centre quand ils sont posés) ; constante : hanche à x = z = 0 en moyenne.
 */
function ancrerPieds(c) {
  ancClip = c;
  ancGeo = geoPosee;
  ANC_N[0] = 0;
  const n = c.n * ANC_SUR;
  if (n >= ANC_MAX || n < 2 || PIEDS_V[0].length === 0 || PIEDS_V[1].length === 0) return;
  const ry = mesh.rotation.y;
  mesh.rotation.y = 0;
  const t0 = c.temps[0];
  for (let i = 0; i < n; i++) {
    c.temps[0] = i / (c.fps * ANC_SUR);
    c.echantillonner(null, os, oRacine, 0);
    const o = i * 8;
    ANC_B[o + 6] = oRacine.position.x; // hanche (point de hanche du clip)
    ANC_B[o + 7] = oRacine.position.z;
    hancheDuClip();
    mesh.updateMatrixWorld(true);
    mesurerPied(0, o);
    mesurerPied(1, o);
    for (let k = 0; k < 2; k++) {
      const pd = os[k === 0 ? 'pied_g' : 'pied_d'];
      if (!pd) continue;
      pd.getWorldQuaternion(qPQ);
      PQ[i * 8 + k * 4] = qPQ.x;
      PQ[i * 8 + k * 4 + 1] = qPQ.y;
      PQ[i * 8 + k * 4 + 2] = qPQ.z;
      PQ[i * 8 + k * 4 + 3] = qPQ.w;
    }
  }
  c.temps[0] = t0;
  mesh.rotation.y = ry;
  // ANCRES PAR PHASE D'APPUI : l'Offensive Idle de l'Éclaireur fait de vrais pas (pied levé jusqu'à 24 cm, reposé ailleurs) —
  // une ancre fixe par pied tirait le pied reposé vers son ancienne place (11 cm, mesuré). Une phase = images consécutives
  // (en boucle) où le pied a un poids > 0 ; son ancre = la moyenne pondérée de son centre sur la phase (repère du clip).
  ANC_INFO[3] = 1e9;
  ANC_INFO[4] = -1e9;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const b = ANC_B[o] < ANC_B[o + 1] ? ANC_B[o] : ANC_B[o + 1];
    if (b < ANC_INFO[3]) ANC_INFO[3] = b;
    if (b > ANC_INFO[4]) ANC_INFO[4] = b;
    ANC_W[i * 2] = poidsPose(ANC_B[o] - b);
    ANC_W[i * 2 + 1] = poidsPose(ANC_B[o + 1] - b);
  }
  for (let k = 0; k < 2; k++) {
    // début de parcours : une image où le pied est levé (sinon toute la boucle est une seule phase, départ en 0)
    let i0 = 0;
    for (let i = 0; i < n; i++) {
      if (ANC_W[i * 2 + k] === 0) {
        i0 = i;
        break;
      }
    }
    let j = 0;
    while (j < n) {
      const i = (i0 + j) % n;
      if (ANC_W[i * 2 + k] === 0) {
        ANC_P[i * 4 + 2 * k] = 0;
        ANC_P[i * 4 + 2 * k + 1] = 0;
        ANC_PH[i * 2 + k] = -1;
        j++;
        continue;
      }
      // phase [j, j + l[ (indices en boucle depuis i0)
      let l = 0;
      let sx = 0;
      let sz = 0;
      let sw = 0;
      while (j + l < n && ANC_W[((i0 + j + l) % n) * 2 + k] > 0) {
        const q = (i0 + j + l) % n;
        const w = ANC_W[q * 2 + k];
        sx += w * ANC_B[q * 8 + 2 + 2 * k];
        sz += w * ANC_B[q * 8 + 3 + 2 * k];
        sw += w;
        l++;
      }
      // orientation moyenne du pied sur la phase (quaternions alignés sur le 1er, pondérés, normalisés)
      const q0 = ((i0 + j) % n) * 8 + k * 4;
      let mx = 0, my = 0, mz = 0, mw = 0;
      for (let m = 0; m < l; m++) {
        const q = ((i0 + j + m) % n) * 8 + k * 4;
        const w = ANC_W[((i0 + j + m) % n) * 2 + k];
        const sg = PQ[q] * PQ[q0] + PQ[q + 1] * PQ[q0 + 1] + PQ[q + 2] * PQ[q0 + 2] + PQ[q + 3] * PQ[q0 + 3] < 0 ? -w : w;
        mx += sg * PQ[q];
        my += sg * PQ[q + 1];
        mz += sg * PQ[q + 2];
        mw += sg * PQ[q + 3];
      }
      const ml = Math.sqrt(mx * mx + my * my + mz * mz + mw * mw) || 1;
      const ph = (i0 + j) % n; // numéro de la phase : sa 1re image
      PHQ[ph * 8 + k * 4] = mx / ml;
      PHQ[ph * 8 + k * 4 + 1] = my / ml;
      PHQ[ph * 8 + k * 4 + 2] = mz / ml;
      PHQ[ph * 8 + k * 4 + 3] = mw / ml;
      for (let m = 0; m < l; m++) {
        const q = (i0 + j + m) % n;
        ANC_P[q * 4 + 2 * k] = sx / sw;
        ANC_P[q * 4 + 2 * k + 1] = sz / sw;
        ANC_PH[q * 2 + k] = ph;
      }
      j += l;
    }
  }
  let h0 = 0;
  let h1 = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const p0 = ANC_W[i * 2];
    const p1 = ANC_W[i * 2 + 1];
    const s = p0 + p1; // ≥ 1 : le pied le plus bas a le poids 1
    ANC[i * 3] = (p0 * (ANC_P[i * 4] - ANC_B[o + 2]) + p1 * (ANC_P[i * 4 + 2] - ANC_B[o + 4])) / s;
    ANC[i * 3 + 1] = -(ANC_B[o] < ANC_B[o + 1] ? ANC_B[o] : ANC_B[o + 1]); // le plus bas des deux pieds sur y = 0
    ANC[i * 3 + 2] = (p0 * (ANC_P[i * 4 + 1] - ANC_B[o + 3]) + p1 * (ANC_P[i * 4 + 3] - ANC_B[o + 5])) / s;
    h0 += ANC_B[o + 6] + ANC[i * 3];
    h1 += ANC_B[o + 7] + ANC[i * 3 + 2];
  }
  // lissage circulaire de la correction horizontale (noyau binomial 1 4 6 4 1, deux passes) : un pied qui quitte le sol
  // retire son terme d'un coup (jusqu'à 1,6 cm en une image, mesuré sur l'Offensive Idle) — étalé sur une dizaine d'images
  for (let passe = 0; passe < 2 * ANC_SUR * ANC_SUR; passe++) { // même largeur en temps quel que soit ANC_SUR
    for (let i = 0; i < n; i++) {
      const a2 = ((i - 2 + n) % n) * 3;
      const a1 = ((i - 1 + n) % n) * 3;
      const c0 = i * 3;
      const b1 = ((i + 1) % n) * 3;
      const b2 = ((i + 2) % n) * 3;
      ANC_L[i * 2] = (ANC[a2] + 4 * ANC[a1] + 6 * ANC[c0] + 4 * ANC[b1] + ANC[b2]) / 16;
      ANC_L[i * 2 + 1] = (ANC[a2 + 2] + 4 * ANC[a1 + 2] + 6 * ANC[c0 + 2] + 4 * ANC[b1 + 2] + ANC[b2 + 2]) / 16;
    }
    for (let i = 0; i < n; i++) {
      ANC[i * 3] = ANC_L[i * 2];
      ANC[i * 3 + 2] = ANC_L[i * 2 + 1];
    }
  }
  h0 = 0;
  h1 = 0;
  for (let i = 0; i < n; i++) {
    h0 += ANC_B[i * 8 + 6] + ANC[i * 3];
    h1 += ANC_B[i * 8 + 7] + ANC[i * 3 + 2];
  }
  h0 /= n;
  h1 /= n;
  // constante : hanche centrée en moyenne (cadrage d'avant) ; mesures pour les tests (pieds de poids 1 seulement) :
  // [0] écart max à l'ancre de sa phase après correction, [1] même écart avec le x / z du clip seul, [2] avec la hanche
  // clouée (ancre de la phase prise dans le repère de la hanche), [5] balancement de la hanche
  let r = 0;
  let ex = 0;
  let eh = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    ANC[i * 3] -= h0;
    ANC[i * 3 + 2] -= h1;
    for (let k = 0; k < 2; k++) {
      if (ANC_W[i * 2 + k] < 1) continue;
      const ax = ANC_P[i * 4 + 2 * k] - h0;
      const az = ANC_P[i * 4 + 2 * k + 1] - h1;
      const cx = ANC_B[o + 2 + 2 * k];
      const cz = ANC_B[o + 3 + 2 * k];
      const d = Math.hypot(cx + ANC[i * 3] - ax, cz + ANC[i * 3 + 2] - az);
      if (d > r) r = d;
      const dc = Math.hypot(cx - ANC_P[i * 4 + 2 * k], cz - ANC_P[i * 4 + 2 * k + 1]);
      if (dc > ex) ex = dc;
    }
    eh = Math.max(eh, Math.hypot(ANC_B[o + 6] + ANC[i * 3], ANC_B[o + 7] + ANC[i * 3 + 2]));
  }
  ANC_INFO[0] = r;
  ANC_INFO[1] = ex;
  ANC_INFO[5] = eh;
  // hanche clouée (ancien calage) : écart max du (centre − hanche) à sa moyenne sur la phase
  let ev = 0;
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < n; i++) {
      if (ANC_W[i * 2 + k] < 1) continue;
      // moyenne de (centre − hanche) sur la phase de l'image i : images voisines de même ancre
      let sx = 0;
      let sz = 0;
      let m = 0;
      for (let q = 0; q < n; q++) {
        if (ANC_W[q * 2 + k] > 0 && ANC_P[q * 4 + 2 * k] === ANC_P[i * 4 + 2 * k] && ANC_P[q * 4 + 2 * k + 1] === ANC_P[i * 4 + 2 * k + 1]) {
          sx += ANC_B[q * 8 + 2 + 2 * k] - ANC_B[q * 8 + 6];
          sz += ANC_B[q * 8 + 3 + 2 * k] - ANC_B[q * 8 + 7];
          m++;
        }
      }
      ev = Math.max(ev, Math.hypot(ANC_B[i * 8 + 2 + 2 * k] - ANC_B[i * 8 + 6] - sx / m, ANC_B[i * 8 + 3 + 2 * k] - ANC_B[i * 8 + 7] - sz / m));
    }
  }
  ANC_INFO[2] = ev;
  ANC_N[0] = n;
  jambesIK(c, n, h0, h1);
}

/**
 * Tests (§ E5.AP, sonde) : sommets réels des deux pieds à chaque image du clip c de la vitrine ouverte, x / z du clip
 * gardés, SANS correction, corps non tourné — [image][pied][x, y, z…] aplati (Float32), et le nombre de sommets par pied.
 * Hors image (appel de test seulement) ; la pose courante est refaite à l'image suivante.
 */
export function ancreSommets(corrige, pas = 1) {
  const a = VN[1];
  const c = idlesVitrine[a] !== null ? idlesVitrine[a] : idlesAgents[a] !== null ? idlesAgents[a] : idleCuit;
  if (c === null || mesh === null) return null;
  const nv = [0, 0];
  for (let k = 0; k < 2; k++) for (let p = 1; p < PIEDS_V[k].length; p += 2) nv[k] += PIEDS_V[k][p].length / 3;
  const n = c.n * pas; // pas : échantillons par image du clip (1 = aux images)
  const out = new Float32Array(n * (nv[0] + nv[1]) * 3);
  const ry = mesh.rotation.y;
  mesh.rotation.y = 0;
  const t0 = c.temps[0];
  let j = 0;
  for (let i = 0; i < n; i++) {
    c.temps[0] = i / (c.fps * pas);
    c.echantillonner(null, os, oRacine, 0);
    hancheDuClip();
    if (corrige) appliquerAncre(c); // pose réelle de la vitrine (translation + IK)
    mesh.updateMatrixWorld(true);
    for (let k = 0; k < 2; k++) {
      const L = PIEDS_V[k];
      for (let p = 0; p < L.length; p += 2) {
        const e = L[p].matrixWorld.elements;
        const l = L[p + 1];
        for (let v = 0; v < l.length; v += 3) {
          out[j++] = e[0] * l[v] + e[4] * l[v + 1] + e[8] * l[v + 2] + e[12];
          out[j++] = e[1] * l[v] + e[5] * l[v + 1] + e[9] * l[v + 2] + e[13];
          out[j++] = e[2] * l[v] + e[6] * l[v + 1] + e[10] * l[v + 2] + e[14];
        }
      }
    }
  }
  c.temps[0] = t0;
  mesh.rotation.y = ry;
  return { n, fps: c.fps * pas, nv, sommets: out };
}

/** Tests (§ E5.AP) : mesures brutes du précalcul, 8 nombres par image du clip (voir ANC_B), et la correction (3 par image). */
export function ancreBrut() {
  const n = ANC_N[0] / ANC_SUR; // aux images du clip (un échantillon sur ANC_SUR)
  const b = [];
  const cc = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 8; j++) b.push(ANC_B[i * ANC_SUR * 8 + j]);
    for (let j = 0; j < 3; j++) cc.push(ANC[i * ANC_SUR * 3 + j]);
  }
  return { n, b, c: cc };
}

// § E5.AP (2e temps) — CINÉMATIQUE INVERSE DES JAMBES, précalculée. La translation du corps ne peut tenir qu'un point : le
// transfert Mixamo → robot fait aussi glisser les pieds L'UN PAR RAPPORT À L'AUTRE (Offensive Idle : 4,9 cm pendant un
// appui, x / z du clip seul ; 4,7 cm après la translation). Pour chaque image du clip et chaque pied posé (poids > 0), le
// pied est ramené sur l'ancre de sa phase (écart × poids) par une IK à deux os (hanche → genou → cheville, genou dans le
// plan du genou du clip), le pied gardant son orientation du clip. Rotations locales de jambe_*, tibia_*, pied_* rangées
// par image (IKQ), interpolées à chaque image (slerp écrit champ par champ : aucune allocation, aucun flottant passé en
// argument). Même règle qu'en jeu (piedPose : pieds cloués par IK).
const IK_OS = ['jambe_g', 'tibia_g', 'pied_g', 'jambe_d', 'tibia_d', 'pied_d'];
const IKQ = new Float32Array(ANC_MAX * 24); // par image : 6 os × quaternion local (x, y, z, w)
const IK_N = new Int32Array(1); // images de l'IK (0 : aucune)
const IK_B = []; // os de IK_OS (construire → jambesIK)
const vIH = new THREE.Vector3();
const vIK = new THREE.Vector3();
const vIA = new THREE.Vector3();
const vIT = new THREE.Vector3();
const vIU = new THREE.Vector3();
const vIP = new THREE.Vector3();
const vIK2 = new THREE.Vector3();
const vIX = new THREE.Vector3();
const vIY = new THREE.Vector3();
const qIA = new THREE.Quaternion();
const qIB = new THREE.Quaternion();
const qIF = new THREE.Quaternion();
const qIP = new THREE.Quaternion();

/** IK de la jambe k (0 g, 1 d) : cheville déplacée de (dx, 0, dz) en monde (IK_D), pied gardant son orientation. */
const IK_D = new Float64Array(2);
function ikJambe(k) {
  const J = IK_B[k * 3];
  const T = IK_B[k * 3 + 1];
  const P = IK_B[k * 3 + 2];
  J.getWorldPosition(vIH);
  T.getWorldPosition(vIK);
  P.getWorldPosition(vIA);
  P.getWorldQuaternion(qIF);
  vIT.copy(vIA);
  vIT.x += IK_D[0];
  vIT.z += IK_D[1];
  const l1 = vIH.distanceTo(vIK);
  const l2 = vIK.distanceTo(vIA);
  vIU.subVectors(vIT, vIH);
  let d = vIU.length();
  if (d < 1e-6) return;
  vIU.multiplyScalar(1 / d);
  d = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, d));
  // plan du genou : genou du clip (perpendiculaire à hanche → cheville) + un léger biais vers l'avant de la cuisse (son axe
  // +z). Sans ce biais, une jambe presque tendue (Holding Idle du Bastion) donnait un plan qui basculait d'un échantillon à
  // l'autre : exact aux échantillons, mais l'interpolation entre deux jambes opposées faisait glisser le pied (mesuré)
  vIP.subVectors(vIK, vIH);
  vIP.addScaledVector(vIU, -vIP.dot(vIU));
  J.getWorldQuaternion(qIB);
  vIX.set(0, 0, 1).applyQuaternion(qIB);
  vIX.addScaledVector(vIU, -vIX.dot(vIU));
  vIP.addScaledVector(vIX, 0.02);
  if (vIP.lengthSq() < 1e-12) vIP.set(0, 0, 1).addScaledVector(vIU, -vIU.z);
  vIP.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  vIK2.copy(vIH).addScaledVector(vIU, a).addScaledVector(vIP, h);
  // cuisse : hanche → genou visé
  qIA.setFromUnitVectors(vIX.subVectors(vIK, vIH).normalize(), vIY.subVectors(vIK2, vIH).normalize());
  J.getWorldQuaternion(qIB).premultiply(qIA);
  J.parent.getWorldQuaternion(qIP).invert();
  J.quaternion.multiplyQuaternions(qIP, qIB);
  J.updateMatrixWorld(true);
  // tibia : genou → cheville visée
  T.getWorldPosition(vIK);
  P.getWorldPosition(vIA);
  vIT.copy(vIH).addScaledVector(vIU, d);
  qIA.setFromUnitVectors(vIX.subVectors(vIA, vIK).normalize(), vIY.subVectors(vIT, vIK).normalize());
  T.getWorldQuaternion(qIB).premultiply(qIA);
  T.parent.getWorldQuaternion(qIP).invert();
  T.quaternion.multiplyQuaternions(qIP, qIB);
  T.updateMatrixWorld(true);
  // pied : orientation du clip gardée en monde
  P.parent.getWorldQuaternion(qIP).invert();
  P.quaternion.multiplyQuaternions(qIP, qIF);
  P.updateMatrixWorld(true);
}

/**
 * Précalcul de l'IK (après ancrerPieds : ANC, ANC_W, ANC_P prêts ; h0, h1 = constante de centrage). Hors image. Range
 * aussi dans ANC_INFO[0] l'écart max d'un pied posé (poids 1) à son ancre APRÈS l'IK.
 */
function jambesIK(c, n, h0, h1) {
  IK_N[0] = 0;
  IK_B.length = 0;
  for (const nom of IK_OS) {
    if (!os[nom] || !os[nom].parent) return;
    IK_B.push(os[nom]);
  }
  const ry = mesh.rotation.y;
  mesh.rotation.y = 0;
  const t0 = c.temps[0];
  const o2 = (ANC_MAX - 1) * 8; // mesures de travail (au-delà des images du clip)
  let r = 0;
  for (let i = 0; i < n; i++) {
    c.temps[0] = i / (c.fps * ANC_SUR);
    c.echantillonner(null, os, oRacine, 0);
    hancheDuClip();
    oRacine.position.x += ANC[i * 3];
    oRacine.position.y += ANC[i * 3 + 1];
    oRacine.position.z += ANC[i * 3 + 2];
    mesh.updateMatrixWorld(true);
    for (let k = 0; k < 2; k++) {
      const w = ANC_W[i * 2 + k];
      if (w <= 0) continue;
      // pied rigide pendant l'appui : orientation = celle du clip mêlée à la moyenne de la phase par le poids (le Fight Idle
      // fait pivoter le pied gauche sur lui-même, pointe qui glisse à 0,3 m/s, centre immobile — mesuré)
      const P = IK_B[k * 3 + 2];
      const ph = ANC_PH[i * 2 + k] * 8 + k * 4;
      P.getWorldQuaternion(qIF);
      qPQ.set(PHQ[ph], PHQ[ph + 1], PHQ[ph + 2], PHQ[ph + 3]);
      qIF.slerp(qPQ, w);
      P.parent.getWorldQuaternion(qIP).invert();
      P.quaternion.multiplyQuaternions(qIP, qIF);
      P.updateMatrixWorld(true);
      mesurerPied(k, o2);
      IK_D[0] = (ANC_P[i * 4 + 2 * k] - h0 - ANC_B[o2 + 2 + 2 * k]) * w;
      IK_D[1] = (ANC_P[i * 4 + 2 * k + 1] - h1 - ANC_B[o2 + 3 + 2 * k]) * w;
      if (IK_D[0] * IK_D[0] + IK_D[1] * IK_D[1] > 1e-10) ikJambe(k);
      if (w >= 1) {
        mesurerPied(k, o2);
        const e = Math.hypot(ANC_P[i * 4 + 2 * k] - h0 - ANC_B[o2 + 2 + 2 * k], ANC_P[i * 4 + 2 * k + 1] - h1 - ANC_B[o2 + 3 + 2 * k]);
        if (e > r) r = e;
      }
    }
    // pieds tournés à l'orientation de la phase : une pointe ou un talon peut passer sous le sol (Éclaireur : −11 mm,
    // mesuré) — le plus bas des deux pieds est reposé sur y = 0 (la racine monte, les rotations de l'IK ne changent pas)
    mesurerPied(0, o2);
    mesurerPied(1, o2);
    ANC[i * 3 + 1] -= ANC_B[o2] < ANC_B[o2 + 1] ? ANC_B[o2] : ANC_B[o2 + 1];
    for (let b = 0; b < 6; b++) {
      const q = IK_B[b].quaternion;
      const o = (i * 6 + b) * 4;
      IKQ[o] = q.x;
      IKQ[o + 1] = q.y;
      IKQ[o + 2] = q.z;
      IKQ[o + 3] = q.w;
    }
  }
  c.temps[0] = t0;
  mesh.rotation.y = ry;
  ANC_INFO[0] = r;
  IK_N[0] = n;
}

/** Correction de l'image courante du clip (temps c.temps[0], interpolée comme echantillonner) ajoutée à la racine. */
function appliquerAncre(c) {
  const n = ANC_N[0];
  if (n === 0 || n !== c.n * ANC_SUR) {
    // pas de correction (clip trop long, pieds absents) : l'ancien calage, hanche clouée en x / z
    oRacine.position.x = -qV.x; // qV = Qr·H (hancheDuClip) : hanche du clip à x = z = 0
    oRacine.position.z = -qV.z;
    return;
  }
  let u = (c.temps[0] % c.duree) * c.fps * ANC_SUR;
  if (u < 0) u += n;
  const i0 = Math.floor(u) % n;
  const i1 = (i0 + 1) % n;
  const f = u - Math.floor(u);
  const a = i0 * 3;
  const b = i1 * 3;
  const p = oRacine.position;
  p.x += ANC[a] + (ANC[b] - ANC[a]) * f;
  p.y += ANC[a + 1] + (ANC[b + 1] - ANC[a + 1]) * f;
  p.z += ANC[a + 2] + (ANC[b + 2] - ANC[a + 2]) * f;
  if (IK_N[0] !== n) return;
  // jambes de l'IK précalculée : slerp entre les deux images du clip (mêmes seuils que three), champ par champ
  for (let k = 0; k < 6; k++) {
    const oa = (i0 * 6 + k) * 4;
    const ob = (i1 * 6 + k) * 4;
    const ax = IKQ[oa], ay = IKQ[oa + 1], az = IKQ[oa + 2], aw = IKQ[oa + 3];
    let bx = IKQ[ob], by = IKQ[ob + 1], bz = IKQ[ob + 2], bw = IKQ[ob + 3];
    let cs = ax * bx + ay * by + az * bz + aw * bw;
    if (cs < 0) {
      cs = -cs;
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    let k0 = 1 - f;
    let k1 = f;
    if (cs < 0.9995) {
      const sn = Math.sqrt(1 - cs * cs);
      const ang = Math.atan2(sn, cs);
      k0 = Math.sin((1 - f) * ang) / sn;
      k1 = Math.sin(f * ang) / sn;
    }
    let x = ax * k0 + bx * k1, y = ay * k0 + by * k1, z = az * k0 + bz * k1, w = aw * k0 + bw * k1;
    const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
    const q = IK_B[k].quaternion;
    q._x = x / l;
    q._y = y / l;
    q._z = z / l;
    q._w = w / l;
    q._onChangeCallback();
  }
}
//#endregion

// § E4.L.3 : capsules des bras et des jambes en MONDE pour la cape du portrait — mêmes points et rayons que heros-anim
// (bras : épaule → main ; jambe : hanche → pied), écrits dans capsulesMonde (aucun flottant passé en argument)
function capsuleBras(k, a, b) {
  const c = capeMod.capsulesMonde;
  const o = k * 7;
  if (!a || !b) {
    c[o + 6] = 0;
    if (tisMod !== null) tisMod.capsulesMonde[o + 6] = 0;
    if (tisMod !== null && k >= 2) tisMod.capsulesMonde[o + 20] = 0;
    return;
  }
  const ea = a.matrixWorld.elements;
  const eb = b.matrixWorld.elements;
  const x = MAIN_LOCAL[0];
  const y = MAIN_LOCAL[1];
  const z = MAIN_LOCAL[2];
  c[o] = ea[12];
  c[o + 1] = ea[13] - 0.05;
  c[o + 2] = ea[14];
  c[o + 3] = eb[0] * x + eb[4] * y + eb[8] * z + eb[12];
  c[o + 4] = eb[1] * x + eb[5] * y + eb[9] * z + eb[13];
  c[o + 5] = eb[2] * x + eb[6] * y + eb[10] * z + eb[14];
  c[o + 6] = ANIM.heros.brasRayon;
  if (tisMod !== null) for (let j = 0; j < 7; j++) tisMod.capsulesMonde[o + j] = c[o + j]; // § E5.I
}
function capsuleJambe(k, a, b, p) {
  const c = capeMod.capsulesMonde;
  const o = k * 7;
  if (!a || !b) {
    c[o + 6] = 0;
    if (tisMod !== null) tisMod.capsulesMonde[o + 6] = 0;
    if (tisMod !== null && k >= 2) tisMod.capsulesMonde[o + 20] = 0;
    return;
  }
  const ea = a.matrixWorld.elements;
  const eb = p ? p.matrixWorld.elements : b.matrixWorld.elements;
  const L = p ? PIED_LOCAL : TIBIA_PIED;
  c[o] = ea[12];
  c[o + 1] = ea[13];
  c[o + 2] = ea[14];
  c[o + 3] = eb[0] * L[0] + eb[4] * L[1] + eb[8] * L[2] + eb[12];
  c[o + 4] = eb[1] * L[0] + eb[5] * L[1] + eb[9] * L[2] + eb[13];
  c[o + 5] = eb[2] * L[0] + eb[6] * L[1] + eb[10] * L[2] + eb[14];
  c[o + 6] = ANIM.heros.jambeRayon;
  if (tisMod !== null) {
    // § E5.I : tissus — cuisse (hanche → genou, capsule k) et tibia (genou → pied, capsule k + 2)
    const t = tisMod.capsulesMonde;
    const ek = b.matrixWorld.elements;
    for (let j = 0; j < 3; j++) {
      t[o + j] = c[o + j];
      t[o + 3 + j] = ek[12 + j];
      t[o + 14 + j] = ek[12 + j];
      t[o + 17 + j] = c[o + 3 + j];
    }
    t[o + 6] = 1;
    t[o + 20] = 1;
  }
}
function capsules() {
  capsuleBras(0, os.bras_g, os.avant_bras_g);
  capsuleBras(1, os.bras_d, os.avant_bras_d);
  capsuleJambe(2, os.jambe_g, os.tibia_g, os.pied_g);
  capsuleJambe(3, os.jambe_d, os.tibia_d, os.pied_d);
}

/** Cape du portrait : replacée (M[4]) puis simulée à pas fixe, ou avancée de dt. Après poser(). */
function capeAvance(dt) {
  tissusAvance(dt);
  if (M[3] !== 1 || capeMod === null) return;
  mesh.updateMatrixWorld(true);
  capsules();
  if (M[4] === 1) {
    M[4] = 0;
    capeMod.reset(oBuste.matrixWorld.elements);
    const n = Math.round(PORTRAIT_CAPE.capePreSim / PORTRAIT_CAPE.capePasS);
    capeMod.entree[0] = PORTRAIT_CAPE.capePasS;
    for (let k = 0; k < n; k++) capeMod.update(oBuste.matrixWorld.elements);
  } else {
    capeMod.entree[0] = dt;
    capeMod.update(oBuste.matrixWorld.elements);
  }
  capeMod.sync();
}

/** § E5.I : tissus du Shinobi du portrait — replacés (TIS[1]) puis simulés à pas fixe, ou avancés de dt. */
function tissusAvance(dt) {
  if (TIS[0] !== 1 || tisMod === null) return;
  mesh.updateMatrixWorld(true);
  if (capeMod !== null) capsules(); // bras et jambes (copiés dans les capsules des tissus)
  const k = os.arme_katana;
  tisMod.poserReperes((os.corps || oRacine).matrixWorld.elements, TIS_PIV, k && k.scale.x > 0.5 ? oBuste.matrixWorld.elements : null, TIS_ZERO);
  if (TIS[1] === 1) {
    TIS[1] = 0;
    tisMod.reset(oBuste.matrixWorld.elements);
    const n = Math.round(PORTRAIT_CAPE.capePreSim / PORTRAIT_CAPE.capePasS);
    tisMod.entree[0] = PORTRAIT_CAPE.capePasS;
    for (let k = 0; k < n; k++) tisMod.update(oBuste.matrixWorld.elements);
  } else {
    tisMod.entree[0] = dt;
    tisMod.update(oBuste.matrixWorld.elements);
  }
  tisMod.sync();
}

// Retour de Femz du 16/11/2026 (point 9) : « on clique dessus et qu'on bouge la souris on peux faire tourner la vue du
// perso en 3D » — clic maintenu (ou doigt) + glisser = rotation autour de l'axe vertical ; § E4.E.4 : relâché, il garde
// son angle. Écouteurs posés une fois, hors chemin chaud (événements de pointeur).
function brancherRotation(c) {
  c.style.touchAction = 'none';
  c.addEventListener('pointerdown', (e) => {
    T[5] = 1;
    T[4] = e.clientX;
    try {
      c.setPointerCapture(e.pointerId);
    } catch {
      // capture refusée (pointeur déjà relâché) : le glisser marche tant que le pointeur reste sur le portrait
    }
    e.stopPropagation(); // le clic sur le portrait ne referme pas la fenêtre d'un élément
  });
  c.addEventListener('pointermove', (e) => {
    if (T[5] === 0) return;
    T[3] += (e.clientX - T[4]) * PAUSE.rotation.radParPx;
    T[4] = e.clientX;
  });
  const fin = () => {
    T[5] = 0;
  };
  c.addEventListener('pointerup', fin);
  c.addEventListener('pointercancel', fin);
  c.addEventListener('lostpointercapture', fin);
}

/** F14, pause seulement (la vitrine a renderVitrine), AVANT la scène du jeu ou du titre (qui recouvre la région du canvas utilisée ici). */
export function render(realDt) {
  if (N[3] === 0 || mesh === null || M[1] === MODE_VITRINE) return;
  if (M[1] === MODE_PAUSE && (heros.getMesh() === null || heros.getMesh().geometry !== geoPosee)) {
    skinPause = ctx.player && ctx.player.skinCourant ? ctx.player.skinCourant() : SKIN_BASE;
    if (!construire(run.agent, skinPause)) return;
    habiller(run.agent, MODE_PAUSE, false);
  }
  if ((N[4] === 1 || N[2] !== renderer.domElement.height) && !mesurer()) return; // toile cachée (menu)
  T[0] += realDt;
  // relâché : retour doux vers la vue 3/4 (exponentielle, indépendante de la cadence), par le plus court chemin
  // § E4.E.4 (demande de Femz du 16/11, 10h55) : PAUSE.rotation.retourS = 0 → plus de retour, le portrait garde l'angle
  if (T[5] === 0 && T[3] !== 0 && PAUSE.rotation.retourS > 0) {
    T[3] -= Math.round(T[3] / TAU) * TAU;
    T[3] *= Math.exp(-realDt / PAUSE.rotation.retourS);
    if (Math.abs(T[3]) < 1e-4) T[3] = 0;
  }
  poser();
  refreshWeapons();
  if (recentrer) {
    recentrer = false;
    centrerSurPose();
  }
  capeAvance(realDt);
  renderer.getViewport(SAUVE_VP);
  renderer.getScissor(SAUVE_SC);
  const scissor = renderer.getScissorTest();
  renderer.getClearColor(SAUVE_CLEAR);
  const alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(null);
  renderer.setViewport(VP);
  renderer.setScissor(VP);
  renderer.setScissorTest(true);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);
  renderer.render(scene, cam);
  g2d.clearRect(0, 0, N[0], N[1]);
  g2d.drawImage(renderer.domElement, 0, N[2] - N[1], N[0], N[1], 0, 0, N[0], N[1]);
  renderer.setScissorTest(scissor);
  renderer.setViewport(SAUVE_VP);
  renderer.setScissor(SAUVE_SC);
  renderer.setClearColor(SAUVE_CLEAR, alpha);
  N[5]++;
}

// ======================================= Écran Agents : vitrine (tâche 3) =======================================

/** Jeu de lumière de l'agent a : VITRINE.lumiere, surchargé par VITRINE.lumiere.parAgent[a] (fusion d'un niveau). Hors image. */
function lumiereDe(a) {
  const L = VITRINE.lumiere;
  const o = L.parAgent ? L.parAgent[a] : null;
  if (!o) return L;
  const r = {};
  for (const k of Object.keys(L)) {
    const b = L[k];
    const v = o[k];
    if (v === undefined) r[k] = b;
    else if (b && v && typeof b === 'object' && typeof v === 'object' && !Array.isArray(b) && !Array.isArray(v)) r[k] = { ...b, ...v };
    else r[k] = v;
  }
  return r;
}

/** Lumières du portrait de la pause (soleil et ciel du jeu ; projecteur éteint, sol caché). Hors image. */
function lumieresPause() {
  soleil.visible = true;
  soleilV.visible = false;
  spotV.intensity = 0;
  sol.visible = false;
  ciel.color.set(PEINT.ciel.couleur);
  ciel.groundColor.set(PEINT.ciel.sol);
  ciel.intensity = PEINT.ciel.intensite * PAUSE.lumiere.ciel;
}

/**
 * Lumières lum-b5 de la vitrine pour l'agent a, cadre c (0 fiche, 1 titre) : contre (1re directionnelle, ombres), projecteur,
 * ciel, liseré ; valeurs des uniformes partagés (U_V) et des lumières ponctuelles du monde (PD_V) préparées ici, posées à
 * chaque rendu puis rendues. Lumières tournées de lumiereRotDeg avec la caméra (titre). Hors image (ouverture).
 */
function lumieresVitrine(a, c) {
  const L = lumiereDe(a);
  const C = c === 1 ? VITRINE.cadres.titre : VITRINE.cadres.fiche;
  const t = C.lumiereRotDeg * RAD;
  const cs = Math.cos(t);
  const sn = Math.sin(t);
  let cx = 0;
  let cy = 1.06;
  let cz = 0;
  if (c === 1) {
    cx = C.cible[0];
    cy = C.cible[1];
    cz = C.cible[2];
  } else {
    cx = C.xCentre[a];
    cy = C.yBas + C.hRef * 0.5;
  }
  soleil.visible = false;
  soleilV.visible = true; // ombres toujours portées (castShadow fixe : la clé de programme ne change pas)
  const K = L.contre;
  soleilV.color.set(K.c);
  soleilV.intensity = K.i;
  soleilV.position.set(cx + K.p[0] * cs + K.p[2] * sn, cy + K.p[1], cz - K.p[0] * sn + K.p[2] * cs);
  soleilV.target.position.set(cx, cy, cz);
  soleilV.updateMatrixWorld(true);
  soleilV.target.updateMatrixWorld(true);
  const S = L.spot;
  spotV.color.set(S.c);
  spotV.intensity = S.i;
  spotV.distance = S.dist;
  spotV.angle = S.angle;
  spotV.penumbra = S.pen;
  spotV.decay = 2;
  spotV.position.set(S.p[0] * cs + S.p[2] * sn, S.p[1], -S.p[0] * sn + S.p[2] * cs);
  spotV.target.position.set(S.vise[0] * cs + S.vise[2] * sn, S.vise[1], -S.vise[0] * sn + S.vise[2] * cs);
  spotV.updateMatrixWorld(true);
  spotV.target.updateMatrixWorld(true);
  ciel.color.set(L.ciel.c);
  ciel.groundColor.set(L.ciel.sol);
  ciel.intensity = L.ciel.i;
  rim.color.set(K.c);
  U_V[0] = L.wrap;
  U_V[1] = L.aplatCiel;
  U_V[2] = L.bord.force;
  U_V[3] = L.bord.c[0];
  U_V[4] = L.bord.c[1];
  U_V[5] = L.bord.c[2];
  U_V[6] = L.bord.seuil === undefined ? NaN : L.bord.seuil;
  const NL = PT.image.width;
  for (let k = 0; k < NL; k++) {
    const o = k * 4;
    const q = (NL + k) * 4;
    const P = L.points[k];
    if (P) {
      PD_V[o] = P.p[0] * cs + P.p[2] * sn;
      PD_V[o + 1] = P.p[1];
      PD_V[o + 2] = -P.p[0] * sn + P.p[2] * cs;
      PD_V[o + 3] = P.r;
      PD_V[q] = P.c[0] * P.i;
      PD_V[q + 1] = P.c[1] * P.i;
      PD_V[q + 2] = P.c[2] * P.i;
      PD_V[q + 3] = 2;
    } else {
      PD_V[o] = 0;
      PD_V[o + 1] = -50; // repos : sous le sol, couleur nulle (comme materiaux.js)
      PD_V[o + 2] = 0;
      PD_V[o + 3] = PD[o + 3];
      PD_V[q] = 0;
      PD_V[q + 1] = 0;
      PD_V[q + 2] = 0;
      PD_V[q + 3] = PD[q + 3];
    }
  }
}

/**
 * Caméra de la vitrine sur une toile de W × H px, agent a, cadre c — fiche : caméra du portrait outil.cadre(hRef, yBas)
 * (fov 24° sur hRef m, plongée), hRef cadré sur part de la hauteur, point principal en centre ; titre : caméra de repos de
 * l'écran titre (position relative aux pieds, quaternion, fov, filmOffset), rapprochée de rapprochement[a]. Pose aussi la
 * rotation du corps (VT[1]) et le lacet / l'inclinaison du disque de sol. Hors image.
 */
function cadrerVitrine(W, H, a, c) {
  camV.aspect = W / H;
  if (c === 1) {
    const C = VITRINE.cadres.titre;
    const k = 1 / C.rapprochement[a];
    camV.fov = C.fov;
    camV.filmGauge = C.filmGauge;
    camV.filmOffset = C.filmOffset;
    camV.position.set(C.position[0] * k, C.position[1] * k, C.position[2] * k);
    camV.quaternion.set(C.quaternion[0], C.quaternion[1], C.quaternion[2], C.quaternion[3]);
    VT[4] = W * 0.5;
    VT[5] = H * 0.5;
    VT[1] = C.rotationDeg[a] * RAD;
    sol.rotation.x = -Math.PI / 2 + C.inclinaisonSolDeg * RAD;
  } else {
    const C = VITRINE.cadres.fiche;
    const tf = Math.tan(C.fov * 0.5 * RAD);
    camV.fov = (2 * Math.atan(tf / C.part)) / RAD; // fov de la toile entière : hRef couvre part de sa hauteur
    camV.filmOffset = 0;
    const dist = (C.hRef * 0.5) / tf;
    const vy = C.yBas + C.hRef * 0.5;
    const pl = C.plongeeDeg * RAD;
    const xc = C.xCentre[a];
    camV.position.set(xc, vy + Math.sin(pl) * dist, Math.cos(pl) * dist);
    camV.lookAt(xc, vy, 0);
    VT[4] = C.centre[0] * W;
    VT[5] = C.centre[1] * H;
    VT[1] = C.rotationDeg[a] * RAD;
    sol.rotation.x = -Math.PI / 2 + C.inclinaisonSolDeg * RAD;
  }
  VT[3] = Math.atan2(camV.position.x, camV.position.z); // le disque fait face à la caméra (halo avancé vers elle)
  sol.rotation.y = VT[3];
  camV.updateProjectionMatrix();
  camV.updateMatrixWorld(true);
}

/**
 * Taille de la toile (px CSS / VITRINE.pixel), caméra, RÉGION rendue (volume du cadre projeté : rien hors d'elle n'est
 * dessiné) et taille de rendu BORNÉE au tampon de dessin du jeu (la région est rendue dans son coin bas-gauche puis
 * recopiée, agrandie si le tampon est plus petit). À l'ouverture, après un redimensionnement ou un changement de tampon.
 */
function mesurerVitrine() {
  const cw = toileV.clientWidth;
  const ch = toileV.clientHeight;
  if (cw === 0 || ch === 0) {
    VN[4] = 1; // toile cachée : rien de rendu, taille relue à la prochaine image
    return false;
  }
  VN[4] = 0;
  const px = VITRINE.pixel;
  const W = Math.max(8, Math.round(cw / px));
  const H = Math.max(8, Math.round(ch / px));
  if (toileV.width !== W) toileV.width = W;
  if (toileV.height !== H) toileV.height = H;
  g2dV.clearRect(0, 0, W, H);
  const a = VN[1];
  const c = VN[2];
  cadrerVitrine(W, H, a, c);
  const C = c === 1 ? VITRINE.cadres.titre : VITRINE.cadres.fiche;
  const vol = C.volume;
  const xc = c === 1 ? 0 : C.xCentre[a];
  camV.setViewOffset(W, H, W * 0.5 - VT[4], H * 0.5 - VT[5], W, H); // vue = la toile entière (point principal posé)
  let x0 = W;
  let y0 = H;
  let x1 = 0;
  let y1 = 0;
  for (let k = 0; k < 8; k++) {
    PROJ.set(xc + (k & 1 ? vol.rayon : -vol.rayon), k & 2 ? vol.haut : vol.bas, k & 4 ? vol.rayon : -vol.rayon).project(camV);
    const u = (PROJ.x + 1) * 0.5 * W;
    const v = (1 - PROJ.y) * 0.5 * H;
    if (u < x0) x0 = u;
    if (u > x1) x1 = u;
    if (v < y0) y0 = v;
    if (v > y1) y1 = v;
  }
  const bx = Math.max(0, Math.floor(x0));
  const by = Math.max(0, Math.floor(y0));
  const bw = Math.max(1, Math.min(W, Math.ceil(x1)) - bx);
  const bh = Math.max(1, Math.min(H, Math.ceil(y1)) - by);
  camV.setViewOffset(W, H, bx + W * 0.5 - VT[4], by + H * 0.5 - VT[5], bw, bh);
  const bufW = renderer.domElement.width;
  const bufH = renderer.domElement.height;
  const s = Math.min(1, bufW / bw, bufH / bh);
  const gw = Math.max(1, Math.min(bufW, Math.floor(bw * s)));
  const gh = Math.max(1, Math.min(bufH, Math.floor(bh * s)));
  const pr = renderer.getPixelRatio();
  VPV.set(0, 0, gw / pr, gh / pr);
  solMat.uniforms.uVue.value.x = gw; // le sol s'efface avant les bords de la région (gl_FragCoord en px du tampon)
  solMat.uniforms.uVue.value.y = gh;
  g2dV.imageSmoothingEnabled = s < 0.999; // agrandie : lissée ; à l'échelle : pixel pour pixel
  VB[0] = bx;
  VB[1] = by;
  VB[2] = bw;
  VB[3] = bh;
  VB[4] = gw;
  VB[5] = gh;
  VB[6] = bufW;
  VB[7] = bufH;
  VB[8] = W;
  VB[9] = H;
  VT[2] = s;
  crtTaille(gw, gh, s); // § E5.AQ
  return true;
}

/** Pieds (os pied_*, point VITRINE.sol.pieds.local) dans le repère du disque de sol : flaques de contact. */
function piedsSol() {
  const u = solMat.uniforms.uPieds.value;
  const L = VITRINE.sol.pieds.local;
  const c = Math.cos(VT[3]);
  const s = Math.sin(VT[3]);
  let xg = 99;
  let zg = 99;
  let xd = 99;
  let zd = 99;
  if (os.pied_g) {
    const e = os.pied_g.matrixWorld.elements;
    const x = e[0] * L[0] + e[4] * L[1] + e[8] * L[2] + e[12];
    const z = e[2] * L[0] + e[6] * L[1] + e[10] * L[2] + e[14];
    xg = x * c - z * s;
    zg = x * s + z * c;
  }
  if (os.pied_d) {
    const e = os.pied_d.matrixWorld.elements;
    const x = e[0] * L[0] + e[4] * L[1] + e[8] * L[2] + e[12];
    const z = e[2] * L[0] + e[6] * L[1] + e[10] * L[2] + e[14];
    xd = x * c - z * s;
    zd = x * s + z * c;
  }
  // § E5.AQ : champ par champ (Vector4.set reçoit 4 flottants : emballés par V8 quand l'appel n'est pas en ligne, § V ;
  // 802 o/image relevés une fois par tests/vitrine-rotation-crt)
  u.x = xg;
  u.y = zg;
  u.z = xd;
  u.w = zd;
}

/** Uniformes partagés et lumières du monde de lum-b5 posés (valeurs du jeu gardées dans U_SAUVE / PD_SAUVE). */
function uniformesVitrine() {
  const U = uniformsPeints;
  const b = U.uSrCelBord.value;
  U_SAUVE[0] = U.uSrLum.value.x;
  U_SAUVE[1] = U.uSrCel.value.z;
  U_SAUVE[2] = U.uSrCel.value.w;
  U_SAUVE[3] = b.x;
  U_SAUVE[4] = b.y;
  U_SAUVE[5] = b.z;
  U_SAUVE[6] = b.w;
  U.uSrLum.value.x = U_V[0];
  U.uSrCel.value.z = U_V[1];
  U.uSrCel.value.w = U_V[2];
  b.set(U_V[3], U_V[4], U_V[5], U_V[6] === U_V[6] ? U_V[6] : U_SAUVE[6]);
  PD_SAUVE.set(PD);
  PD.set(PD_V);
  envoyer(PT); // texSubImage2D direct (envois.js) : aucune allocation
}

/** Uniformes et lumières du monde du jeu RENDUS (juste après le rendu de la vitrine). */
function uniformesRendus() {
  const U = uniformsPeints;
  U.uSrLum.value.x = U_SAUVE[0];
  U.uSrCel.value.z = U_SAUVE[1];
  U.uSrCel.value.w = U_SAUVE[2];
  U.uSrCelBord.value.set(U_SAUVE[3], U_SAUVE[4], U_SAUVE[5], U_SAUVE[6]);
  PD.set(PD_SAUVE);
  envoyer(PT);
}

/** Pose de la vitrine : idle de vitrine de l'agent (repli : celui du portrait, puis l'idle en code), racine verrouillée. */
function poserVitrine() {
  const a = VN[1];
  const c = idlesVitrine[a] !== null ? idlesVitrine[a] : idlesAgents[a] !== null ? idlesAgents[a] : idleCuit;
  if (c !== null) {
    poserCuit(c, 1, true);
    mesh.rotation.y = -T[1] + VT[1] + VR[0]; // § E5.AQ : + rotation donnée au glisser
  } else poserCode(VT[0], VT[1] + VR[0]);
}

//#region e5:AQ-rotation-vitrine
// § E5.AQ — Femz, 23/11 : « pouvoir cliquer et les faire tourner comme avant ». Même ressenti que le portrait du Noyau et
// de la pause (§ E4.E.4, brancherRotation) : clic maintenu (ou doigt) + glisser horizontal = rotation autour de l'axe
// vertical, PAUSE.rotation.radParPx rad par px CSS, sans inertie ; relâché, l'agent garde son angle ; de face à chaque
// ouverture de la vitrine (autre agent, titre → fiche, retour). La toile est sans clic (pointer-events: none, les menus
// passent au-dessus) : un seul écouteur sur la fenêtre, posé une fois ; un appui ne fait tourner que s'il tombe dans la
// région rendue de l'agent (VB, volume du cadre projeté) et pas sur un bouton, un lien ou un champ. Événements de pointeur
// seulement : rien par image.
// [0] rotation donnée au glisser (rad), [1] x du pointeur au dernier mouvement (px), [2] glisser en cours (0 / 1)
const VR = new Float64Array(3);
const NON_GLISSER = 'button, a, input, select, textarea, label, [role="button"], [contenteditable]';

/** Appui (x, y px CSS) dans la région rendue de l'agent de la vitrine ouverte et affichée. */
function dansAgent(x, y) {
  if (VN[0] !== 1 || VN[6] === 1 || toileV === null || VB[8] === 0 || VB[2] <= 1) return false;
  const r = toileV.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const u = ((x - r.left) * VB[8]) / r.width;
  const v = ((y - r.top) * VB[9]) / r.height;
  return u >= VB[0] && u <= VB[0] + VB[2] && v >= VB[1] && v <= VB[1] + VB[3];
}

function brancherRotationVitrine() {
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !dansAgent(e.clientX, e.clientY)) return;
    if (e.target && e.target.closest && e.target.closest(NON_GLISSER)) return;
    VR[2] = 1;
    VR[1] = e.clientX;
  });
  window.addEventListener('pointermove', (e) => {
    if (VR[2] === 0) return;
    if (VN[0] !== 1) {
      VR[2] = 0;
      return;
    }
    VR[0] += (e.clientX - VR[1]) * PAUSE.rotation.radParPx;
    VR[1] = e.clientX;
  });
  const fin = () => {
    VR[2] = 0;
  };
  window.addEventListener('pointerup', fin);
  window.addEventListener('pointercancel', fin);
  window.addEventListener('blur', fin);
}
//#endregion

/** Construit et habille la vitrine sur l'agent VN[1] (lumières lum-b5, armes, sol). Faux si son modèle n'est pas chargé. */
function habillerVitrine() {
  const a = VN[1];
  if (!construire(a, vitrineSkin)) {
    if (VN[6] === 0 && g2dV) g2dV.clearRect(0, 0, toileV.width, toileV.height);
    attenteVitrine(1);
    return false;
  }
  attenteVitrine(0);
  const verrou = VN[3] === 1;
  habiller(a, MODE_VITRINE, verrou);
  if (!verrou) {
    const noms = VITRINE.armes[a] || [];
    for (let i = 0; i < armesDst.length; i++) armesDst[i].scale.setScalar(noms.includes(armesDst[i].name) ? 1 : 1e-4);
  }
  M[4] = 1; // cape et tissus replacés sans fouet
  TIS[1] = 1;
  lumieresVitrine(a, VN[2]);
  sol.visible = true;
  VN[4] = 1;
  return true;
}

/**
 * Écran Agents : état « Chargement » de la vitrine (1 : le modèle de l'agent n'est pas encore là, rien n'est rendu ; 0 :
 * rendu). Dit à l'écran qui l'affiche (ui.setVitrineAttente) seulement quand il change. Hors image (ouverture, arrivée).
 */
function attenteVitrine(on) {
  if (VN[6] === on) return;
  VN[6] = on;
  if (ui && ui.setVitrineAttente) ui.setVitrineAttente(on === 1);
}

/**
 * Écran Agents : ouvre la vitrine — agent a, opts.cadre 'fiche' | 'titre', opts.verrou (silhouette), opts.toile (<canvas>
 * 2D placé par l'écran, en général plein écran : le cadre est relatif à elle). Ferme le portrait de la pause.
 * Agent dont le modèle n'est pas chargé (§ E5.K) : rien n'est rendu (inspect().vitrine.attente) jusqu'à son arrivée.
 */
export function openVitrine(a, opts = {}) {
  if (!(a >= 0 && a < AGENTS.length)) {
    closeVitrine();
    return;
  }
  if (opts.toile && opts.toile !== toileV) {
    reduireToile(); // l'ancienne toile (fiche ↔ titre) ne garde pas son tampon
    toileV = opts.toile;
    g2dV = toileV.getContext('2d', { alpha: true });
  }
  if (toileV === null) return;
  if (N[3] === 1 || fixe) close();
  if (scene === null) creerScene();
  if (VN[1] !== a || VN[0] === 0) {
    VT[0] = 0;
    VR[0] = 0; // § E5.AQ : de face à l'ouverture (§ E4.E.4)
    VR[2] = 0;
  } // autre agent ou vitrine fermée : l'idle repart de zéro (titre → fiche : accueil.cacher() ferme la vitrine avant)
  VN[0] = 1;
  vitrineSkin = ctx.player && ctx.player.skinPour ? ctx.player.skinPour(a, opts.skin || SKIN_BASE) : SKIN_BASE; // repli sur la base si le fichier du skin ne charge pas
  VN[1] = a;
  VN[2] = opts.cadre === 'titre' ? 1 : 0;
  VN[3] = opts.verrou ? 1 : 0;
  VN[4] = 1;
  habillerVitrine();
}

/** Écran titre (tâche 7) : la vitrine est ouverte en cadre « titre » (l'accueil ne ferme que la sienne). Sans allocation. */
export function vitrineTitre() {
  return VN[0] === 1 && VN[2] === 1;
}

/** Écran titre (tâche 7) : la vitrine ouverte attend le modèle de son agent (rien de rendu). Sans allocation, à chaque image. */
export function vitrineAttente() {
  return VN[0] === 1 && VN[6] === 1;
}

/** Écran Agents : ferme la vitrine (toile vidée, lumières de la pause remises ; ressources gardées). */
export function closeVitrine() {
  if (VN[0] === 0) return;
  VN[0] = 0;
  attenteVitrine(0);
  if (g2dV) g2dV.clearRect(0, 0, toileV.width, toileV.height);
  reduireToile(); // une toile plein écran garde ≈ 15 Mo de tampon à 2560 × 1440 : 8 × 8 tant qu'elle ne sert pas (mesurerVitrine la reprend)
  if (scene !== null) lumieresPause();
}

/** Remet la toile de la vitrine à 8 × 8 (libère son tampon). */
function reduireToile() {
  if (toileV !== null && (toileV.width !== 8 || toileV.height !== 8)) {
    toileV.width = 8;
    toileV.height = 8;
  }
}

/**
 * Écran Agents : une image de la vitrine (main.js, états TITLE / AGENT / HUB, AVANT la scène du titre qui recouvre le
 * canvas). Rendue dans le coin bas-gauche du canvas du jeu (viewport + scissor, fond transparent), uniformes partagés posés
 * puis rendus, recopiée dans la région de la toile. Aucune allocation.
 */
export function renderVitrine(realDt) {
  if (VN[0] === 0) return;
  if ((mesh === null || VN[6] === 1 || M[1] !== MODE_VITRINE || M[0] !== VN[1] || skinM !== vitrineSkin) && !habillerVitrine()) return;
  if ((VN[4] === 1 || VB[6] !== renderer.domElement.width || VB[7] !== renderer.domElement.height) && !mesurerVitrine()) return;
  VT[0] += realDt;
  poserVitrine();
  capeAvance(realDt);
  if (M[3] !== 1 && TIS[0] !== 1) mesh.updateMatrixWorld(true);
  piedsSol();
  renderer.getViewport(SAUVE_VP);
  renderer.getScissor(SAUVE_SC);
  const scissor = renderer.getScissorTest();
  renderer.getClearColor(SAUVE_CLEAR);
  const alpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  if (CRT_N[1] === 1) {
    // § E5.AQ : look pixel CRT — l'agent en basse définition dans crtRT (un texel = un gros pixel), puis la passe CRT
    renderer.setRenderTarget(crtRT);
    renderer.clear(true, true, false);
    uniformesVitrine();
    try {
      renderer.render(scene, camV);
    } finally {
      uniformesRendus();
    }
    renderer.setRenderTarget(null);
    renderer.setViewport(VPV);
    renderer.setScissor(VPV);
    renderer.setScissorTest(true);
    renderer.clear(true, true, false);
    renderer.render(crtScene, crtCam);
  } else {
    renderer.setRenderTarget(null);
    renderer.setViewport(VPV);
    renderer.setScissor(VPV);
    renderer.setScissorTest(true);
    renderer.clear(true, true, false);
    uniformesVitrine();
    try {
      renderer.render(scene, camV);
    } finally {
      uniformesRendus(); // même si le rendu lève : le décor du jeu retrouve ses uniformes et ses lumières du monde
    }
  }
  g2dV.clearRect(VB[0], VB[1], VB[2], VB[3]);
  g2dV.drawImage(renderer.domElement, 0, VB[7] - VB[5], VB[4], VB[5], VB[0], VB[1], VB[2], VB[3]);
  renderer.setScissorTest(scissor);
  renderer.setViewport(SAUVE_VP);
  renderer.setScissor(SAUVE_SC);
  renderer.setClearColor(SAUVE_CLEAR, alpha);
  VN[5]++;
}

//#region e5:AQ-crt-vitrine
// § E5.AQ — looks pixel CRT de la vitrine (VITRINE.crt, propositions à Femz). L'agent est rendu dans crtRT à la taille
// de la région ÷ côté du gros pixel (moins de pixels que le rendu net), puis un quadrilatère plein-région le recopie dans
// le canvas du jeu (même coin bas-gauche, même recopie dans la toile) en posant lignes, grille RVB, aberration, lueur et
// postérisation tramée — mêmes formules que le CRT de la partie (src/rendu/post.js) pour les lignes « cos » ; profil
// gaussien, triades et lueur de l'écran de chargement (crt.py) pour les autres. Tampon linéaire en demi-flottants : la
// conversion vers l'écran (sRGB) est faite par le quadrilatère, comme le faisait le rendu direct. Alpha gardé (l'agent
// reste détouré sur le fond peint). Tout est créé à la 1re activation (hors image) ; par image : 2 rendus, 0 allocation.
// [0] variante choisie, [1] passe active (variante non nulle ET objets prêts)
const CRT_N = new Int32Array(2);
let crtRT = null;
let crtScene = null;
let crtCam = null;
let crtMat = null;
const CRT_FRAG = `
  uniform sampler2D tSrc; uniform vec2 uSrc; uniform vec2 uOut; uniform float uScan; uniform float uScanPx; uniform float uScanY0; uniform float uScanS; uniform float uGauss;
  uniform float uMask; uniform float uChroma; uniform float uLueur; uniform float uNiveaux;
  float crtBayer2( vec2 a ) { a = floor( a ); return fract( dot( a, vec2( 0.5, a.y * 0.75 ) ) ); }
  float crtBayer( vec2 a ) { return crtBayer2( 0.5 * a ) * 0.25 + crtBayer2( a ); }
  vec4 lire( vec2 c ) { return texture2D( tSrc, ( floor( c ) + 0.5 ) / uSrc ); }
  void main() {
    vec2 uv = gl_FragCoord.xy / uOut;           // région rendue (coin bas-gauche du canvas)
    vec2 cel = uv * uSrc;                       // position dans la grille des gros pixels (= texels de crtRT)
    vec4 c = lire( cel );
    if ( uChroma > 0.0 ) {                      // aberration (en gros pixels) : rouge vers l'extérieur, bleu vers l'intérieur
      vec2 o = ( uv - 0.5 ) * 2.0 * uChroma;
      vec4 r = lire( cel + o );
      vec4 b = lire( cel - o );
      c.r = r.r; c.b = b.b; c.a = max( c.a, max( r.a, b.a ) * 0.85 );
    }
    vec3 col = c.rgb;
    if ( uLueur > 0.0 ) {                       // lueur des phosphores : voisins à 1 gros pixel
      vec3 h = lire( cel + vec2( 1.0, 0.0 ) ).rgb + lire( cel - vec2( 1.0, 0.0 ) ).rgb + lire( cel + vec2( 0.0, 1.0 ) ).rgb + lire( cel - vec2( 0.0, 1.0 ) ).rgb;
      col += uLueur * 0.25 * h;
    }
    if ( uNiveaux > 0.0 ) {                     // postérisation tramée (sur l'alpha prémultiplié : divisé puis remultiplié)
      float a = max( c.a, 1e-4 );
      vec3 gp = pow( clamp( col / a, 0.0, 1.0 ), vec3( 1.0 / 2.2 ) ) * ( uNiveaux - 1.0 );
      gp = floor( gp + crtBayer( cel ) ) / ( uNiveaux - 1.0 );
      col = pow( gp, vec3( 2.2 ) ) * a;
    }
    if ( uScan > 0.0 ) {                        // lignes de période uScanPx (px de la toile = px d'écran), comptées depuis
      // le HAUT de la toile comme le calque CSS du décor (variante « plein ») : même trame, même phase, pas de moiré
      float ph = fract( ( uScanY0 - gl_FragCoord.y / uScanS - 0.5 ) / uScanPx ); // creux au centre des rangées kP
      float ligne = uGauss > 0.5 ? exp( -pow( ( ph - 0.5 ) / 0.36, 2.0 ) ) : pow( 0.5 - 0.5 * cos( ph * 6.2831853 ), 0.6 );
      col *= mix( 1.0, ligne, uScan ) * ( 1.0 + uScan * 0.45 );
    }
    if ( uMask > 0.0 ) {                        // triades RVB verticales dans chaque gros pixel
      float k = floor( fract( cel.x ) * 3.0 );
      vec3 m = k < 0.5 ? vec3( 1.0, 0.32, 0.32 ) : k < 1.5 ? vec3( 0.32, 1.0, 0.32 ) : vec3( 0.32, 0.32, 1.0 );
      col *= mix( vec3( 1.0 ), m * 1.6, uMask );
    }
    gl_FragColor = vec4( col, c.a );
    #include <colorspace_fragment>
  }`;

/** Objets de la passe (1re activation, hors image). */
function crtCreer() {
  if (crtRT !== null) return;
  crtRT = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  crtMat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: crtRT.texture },
      uSrc: { value: new THREE.Vector2(8, 8) },
      uOut: { value: new THREE.Vector2(8, 8) },
      uScan: { value: 0 },
      uScanPx: { value: 4 },
      uScanY0: { value: 0 },
      uScanS: { value: 1 },
      uGauss: { value: 0 },
      uMask: { value: 0 },
      uChroma: { value: 0 },
      uLueur: { value: 0 },
      uNiveaux: { value: 0 },
    },
    vertexShader: 'void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
    fragmentShader: CRT_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), crtMat);
  q.frustumCulled = false;
  crtScene = new THREE.Scene();
  crtScene.add(q);
  crtCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
}

/** Variante n de VITRINE.crt (0 : rendu net). Hors image ; la toile se remesure (taille du tampon de la passe). */
export function setCrtVitrine(n) {
  const V = VITRINE.crt;
  const k = V && V.variantes[n | 0] ? n | 0 : 0;
  CRT_N[0] = k;
  const v = k > 0 ? V.variantes[k] : null;
  if (v !== null) {
    crtCreer();
    const u = crtMat.uniforms;
    u.uScan.value = v.scan || 0;
    u.uGauss.value = v.ligne === 'gauss' ? 1 : 0;
    u.uMask.value = v.mask || 0;
    u.uLueur.value = v.lueur || 0;
    u.uNiveaux.value = v.niveaux || 0;
  }
  CRT_N[1] = 0; // reprise par crtTaille à la prochaine mesure
  VN[4] = 1;
  // lignes sur tout l'écran (calque CSS, ui-pile.css) : attribut lu par la feuille de style, rien par image
  const html = document.documentElement;
  if (v !== null && v.plein) {
    html.dataset.srVitrineCrt = String(k);
    html.style.setProperty('--sr-vitrine-crt-p', (v.scanPx || v.pixel || 4) + 'px');
    html.style.setProperty('--sr-vitrine-crt-a', String(Math.min(0.6, v.scan || 0.3))); // joint : (1 − scan) du milieu, comme l'agent
  } else delete html.dataset.srVitrineCrt;
  return k;
}

/** Taille de crtRT pour une région de gw × gh px du tampon à l'échelle s (mesurerVitrine). Hors image. */
function crtTaille(gw, gh, s) {
  const k = CRT_N[0];
  const v = k > 0 && VITRINE.crt ? VITRINE.crt.variantes[k] : null;
  if (v === null || crtRT === null) {
    CRT_N[1] = 0;
    return;
  }
  const px = Math.max(1, (v.pixel || 1) * s); // gros pixel en pixels du tampon (région agrandie de 1 / s à la recopie)
  const w = Math.max(1, Math.round(gw / px));
  const h = Math.max(1, Math.round(gh / px));
  if (crtRT.width !== w || crtRT.height !== h) crtRT.setSize(w, h);
  crtMat.uniforms.uSrc.value.set(w, h);
  crtMat.uniforms.uOut.value.set(gw, gh);
  crtMat.uniforms.uScanPx.value = Math.max(1, v.scanPx || v.pixel || 1); // px de la toile
  crtMat.uniforms.uScanY0.value = VB[1] + VB[3]; // bas de la région rendue dans la toile (px depuis son haut)
  crtMat.uniforms.uScanS.value = s; // px du tampon par px de la toile
  crtMat.uniforms.uChroma.value = (v.chroma || 0) / Math.max(1, v.pixel || 1); // px d'écran → gros pixels
  solMat.uniforms.uVue.value.x = w; // le sol s'efface aux bords de la région : ici en texels de crtRT
  solMat.uniforms.uVue.value.y = h;
  g2dV.imageSmoothingEnabled = false; // gros pixels nets même si la région est agrandie
  CRT_N[1] = 1;
}

/** Variante du chargement : ?vitrineCrt=N, sinon VITRINE.crt.actif. */
function crtDuChargement() {
  const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('vitrineCrt') : null;
  return q !== null ? Number(q) | 0 : VITRINE.crt ? VITRINE.crt.actif | 0 : 0;
}
//#endregion

/** Tests : état de la vitrine (hanche : point de hanche du clip, en monde). */
function inspectVitrine() {
  const a = VN[1];
  const c = idlesVitrine[a] || idlesAgents[a] || idleCuit;
  let hanche = null;
  if (mesh !== null && oRacine !== null && M[1] === MODE_VITRINE) {
    mesh.updateMatrixWorld(true);
    hanche = oRacine.localToWorld(new THREE.Vector3(0, HT[0], 0)).toArray();
  }
  return {
    ouverte: VN[0] === 1,
    agent: a,
    cadre: CADRES_V[VN[2]],
    largeur: VB[4],
    hauteur: VB[5],
    pixel: VITRINE.pixel,
    boite: [VB[0], VB[1], VB[2], VB[3]],
    tampon: [VB[6], VB[7]],
    toile: [VB[8], VB[9]],
    echelle: VT[2],
    images: VN[5],
    temps: VT[0],
    verrou: VN[3] === 1,
    attente: VN[6] === 1,
    idle: c ? c.source : 'code',
    hanche,
    sol: sol !== null && sol.visible,
    rotation: VR[0], // § E5.AQ : rotation donnée au glisser (rad)
    crt: CRT_N[0], // § E5.AQ : variante du look pixel CRT (0 : net)
    crtActif: CRT_N[1] === 1,
    crtTampon: crtRT === null ? null : [crtRT.width, crtRT.height],
    glisse: VR[2] === 1,
    // § E5.AP : correction des pieds (images du clip ; glissement résiduel, excursions clip seul / hanche clouée, bas des
    // pieds sans recalage, balancement de la hanche — m)
    ancre: { images: ANC_N[0], residuel: ANC_INFO[0], clipSeul: ANC_INFO[1], hancheClouee: ANC_INFO[2], basMin: ANC_INFO[3], basMax: ANC_INFO[4], hanche: ANC_INFO[5], ms: ANC_MS[0] },
  };
}

/** Tests : état du portrait. */
export function inspect(out = {}) {
  out.ouvert = N[3] === 1;
  out.statique = fixe; // § E5.K : agent pas chargé (image fixe)
  out.construit = mesh !== null;
  out.taille = [N[0], N[1]];
  out.images = N[5];
  out.temps = T[0];
  out.rotation = T[3]; // 16/11, point 9 : rotation donnée au pointeur (rad)
  out.glisse = T[5] === 1;
  out.armes = copieDst.filter((o) => o.scale.x > 0.5).map((o) => o.name);
  out.armesPortees = armesDst.filter((o) => o.scale.x > 0.5).map((o) => o.name); // § E4.L : vitrine et silhouette
  out.armesJeu = copieSrc.filter((o) => o.scale.x > 0.5).map((o) => o.name);
  out.agent = M[0] >= 0 ? M[0] : run.agent; // § E4.L : l'agent MONTRÉ
  out.mode = M[1] === MODE_VITRINE ? 'vitrine' : 'pause';
  out.silhouette = M[2] === 1;
  out.materiau = mesh === null ? null : mesh.material === matSil ? 'silhouette' : 'peint';
  out.cape = M[3] === 1 && capeMesh !== null && capeMesh.visible && capeMesh.parent === scene;
  out.capeMateriau = capeMesh === null ? null : capeMesh.material === matSilCape ? 'silhouette' : 'peint';
  if (capeMod !== null && out.cape) {
    const c = {};
    capeMod.inspect(c);
    out.capeInfo = { sousPasTotal: c.sousPasTotal, yPointes: c.yPointes, penetrationBras: c.penetrationBras };
  }
  out.tissus = TIS[0] === 1 && tisMesh !== null && tisMesh.visible && tisMesh.parent === scene; // § E5.I
  out.tissusMateriau = tisMesh === null ? null : tisMesh.material === matSilCape ? 'silhouette' : 'peint';
  if (tisMod !== null && out.tissus) {
    const c = {};
    tisMod.inspect(c);
    out.tissusInfo = { sousPasTotal: c.sousPasTotal, yPointes: c.yPointes, katana: c.katana };
  }
  out.skin = skinM; // skin du modèle montré (portrait, vitrine)
  out.geometrieAgent = mesh !== null && !!ctx.player && !!ctx.player.modeleAgent && ctx.player.modeleAgent(out.agent, skinM) !== null && mesh.geometry === ctx.player.modeleAgent(out.agent, skinM).geometry;
  out.idle = idleCuit !== null ? idleCuit.source : 'code'; // § E4.E.3
  if (mesh !== null && os.bras_d) out.qBrasD = [os.bras_d.quaternion.x, os.bras_d.quaternion.y, os.bras_d.quaternion.z, os.bras_d.quaternion.w];
  out.geometrieDuHeros = mesh !== null && heros.getMesh() !== null && mesh.geometry === heros.getMesh().geometry;
  out.objets = scene === null ? 0 : scene.children.filter((o) => o.isMesh && o.visible).length; // maillages dessinés (§ E4.L.3 : +1 avec la cape)
  out.vitrine = inspectVitrine(); // Écran Agents
  return out;
}

/**
 * OUTIL de génération des portraits des cartes d'agents (outils/portraits_agents.mjs, 18/11/2026) — jamais appelé en
 * jeu : toile de sortie imposée, temps de l'idle, rotation du corps, armes portées, cadrage commun aux trois agents
 * (hauteur cadrée hRef depuis yBas, centre visé xCentre), scène (pour poser un accessoire dans le cadre).
 */
export const outil = {
  toile(c) {
    toile = c;
    g2d = c.getContext('2d', { alpha: true });
    N[4] = 1;
  },
  temps(t) {
    T[0] = t;
  },
  rotation(r) {
    T[3] = r;
  },
  armes(noms) {
    for (let i = 0; i < armesDst.length; i++) armesDst[i].scale.setScalar(noms.includes(armesDst[i].name) ? 1 : 1e-4);
  },
  cadre(hRef, yBas = 0, xCentre = 0) {
    recentrer = false; // l'outil impose son cadrage
    const C = PAUSE.camera;
    T[2] = yBas + hRef * 0.5;
    const dist = (hRef * 0.5) / Math.tan((C.fov * Math.PI) / 360);
    const pl = (C.plongeeDeg * Math.PI) / 180;
    cam.position.set(xCentre, T[2] + Math.sin(pl) * dist, Math.cos(pl) * dist);
    cam.lookAt(xCentre, T[2], 0);
    soleil.target.position.set(xCentre, T[2], 0);
    soleil.target.updateMatrixWorld();
  },
  scene() {
    return scene;
  },
  materiau() {
    return mat;
  },
};
