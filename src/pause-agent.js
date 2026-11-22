// § E3.I — l'agent en 3D TEMPS RÉEL dans la fiche (ARCHITECTURE.md § E3.I bis, point 4 ; § E4.L : aussi au Noyau).
//
// Même renderer que le jeu (aucun 2e contexte WebGL), SCÈNE À PART (scenePortrait : soleil et ciel du jeu, un liseré à
// l'accent de l'agent) — pas un calque de la scène du jeu : un 2e état de lumières sur la même scène ferait recalculer
// les clés de programme de chaque matériau à chaque image (voir sceneNets, render.js).
// Maillage : un SkinnedMesh NEUF sur la géométrie du MODÈLE DE L'AGENT montré (§ E4.L.1 : player.modeleAgent(a) ; en
// pause, c'est la géométrie du héros posé), avec un squelette du même ordre d'os que heros.init (racine, une pièce par os,
// buste) et le matériau peint (profil herosAnime). Animation : Warrior Idle cuit (§ E4.E.3), l'idle en code en repli.
// Armes : en pause, l'échelle de chaque os arme_* / tourelle_* du héros du jeu est recopiée ; au Noyau, seule l'arme
// signature de l'agent est portée. Agent verrouillé (§ E4.L.2) : SILHOUETTE PLEINE (matériau uni, sans arme, cape comprise).
// Cape (§ E4.L.3) : une instance à part de src/anim/cape.js (« cape.js?portrait »), jamais la cape du héros en partie.
// Tissus du Shinobi (§ E5.I) : de même, une instance à part de src/anim/tissus.js (« tissus.js?portrait »).
// Rendu (pause et Noyau, appelé par main.js AVANT la scène) : basse définition (PAUSE.pixel px CSS par pixel d'art) dans
// le coin bas-gauche du canvas du jeu (viewport + scissor, fond transparent), recopié par drawImage dans le <canvas> 2D
// de la fiche ; la scène du jeu (ou du titre) est ensuite rendue par-dessus tout le canvas.
// Aucune allocation par image dans ce module : vecteurs et tableaux créés à la construction.
import * as THREE from 'three';
import { AGENTS, ANIM, PAUSE, PORTRAIT_CAPE, SILHOUETTE, WEAPONS, WEAPON_KEYS } from './config.js';
import { IDLES_AGENTS } from './config.js'; // § E5.F.13 : idle du marteau
import { run } from './state.js';
import * as heros from './anim/heros-anim.js';
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
let dPosee = null; // § E5.K : données (pièces, vides) du modèle du portrait construit
let fixe = false; // § E5.K : la fiche montre l'image fixe d'un agent pas chargé
// § E5.W : agent choisi dont le modèle est en lecture — ni image pixel ni 3D : état « Chargement » (ui.setPortraitAttente)
let attente = false;
// 21/11 (Femz : « les perso sont décentrés ») : à chaque ouverture, la caméra se recentre sur la silhouette POSÉE (vue
// 3/4, idle) et non sur l'axe du modèle — le Shinobi, penché lame en avant, tombait ≈ 48 px (2560) à gauche
let recentrer = false;
const BB_POSE = new THREE.Box3();
let toile = null; // <canvas> 2D de la fiche
let g2d = null;
const os = {}; // nom → os du portrait
const copieSrc = []; // os du héros du jeu (arme_*, tourelle_*)
const copieDst = []; // os du portrait de même nom
const armesDst = []; // os d'arme du portrait (arme_*, tourelle_*_socle) : Noyau et silhouette
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
// § E4.L : [0] agent montré, [1] mode (0 pause, 1 Noyau), [2] verrouillé (silhouette), [3] cape active, [4] replacer la cape
const M = new Int32Array(5).fill(-1);
const MODE_PAUSE = 0;
const MODE_HUB = 1;
const TAU = Math.PI * 2;
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
let tisMod = null;
let tisMesh = null;
let tisMat = null;
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
      tisMod = m;
      M[0] = -1; // l'habillage suivant pose les tissus si l'agent montré en porte
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
}

/** Données du modèle de l'agent a (pièces, vides, géométrie) ; en repli, le héros posé. */
function donneesAgent(a) {
  // § E5.K : seul l'agent CHOISI est chargé (player.modeleAgent : null pour un autre) — un autre agent est montré en
  // image fixe (openHub), jamais sur le modèle d'un autre
  if (ctx.player && ctx.player.modeleAgent) {
    const d = ctx.player.modeleAgent(a);
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
function construire(a) {
  const d = donneesAgent(a);
  if (!d) return false;
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
    const haut = p.parent < 0 && /^(bras_|tete|tourelle_|arme_katana(_evo)?$|arme_sentinelle(_evo)?$|arme_canon(_evo)?$)/.test(p.nom); // comme heros-anim (katana du dos, tourelles du dos)
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
  mat.userData.uniforms.uGlowColor.value.setHex(AGENTS[a].accent);
  rim.color.setHex(AGENTS[a].accent);
  // armes : en pause, celles du héros du jeu (refreshWeapons à chaque image) ; au Noyau, la signature seule ; une
  // silhouette n'en porte aucune
  if (mode === MODE_HUB || verrou) {
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
      capeMod.init({ scene, ancrageG: vg, ancrageD: vd, dos, jambes: { a: [0, 0.6, 0], b: [0, 0.61, 0], rayon: 0 }, corps: d });
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
  // § E5.I : tissus du Shinobi (pan devant, pan du dos, queue de l'écharpe) ; silhouette unie si l'agent est verrouillé
  if (tisMod !== null && (change || TIS[0] < 0 || (TIS[0] === 0 && AGENTS[a].tissus))) {
    const d = dPosee;
    if (AGENTS[a].tissus && d) {
      const ud = (d.vides || {}).cape_dos ? d.vides.cape_dos.userData : {};
      const pc = d.pieces.find((p) => p.nom === 'corps');
      for (let i = 0; i < 3; i++) TIS_PIV[i] = pc ? pc.pivot[i] : 0;
      tisMod.init({ scene, dos: ud.a && ud.b && ud.rayon ? { a: ud.a, b: ud.b, rayon: ud.rayon } : null, corps: d });
      if (tisMesh === null) {
        tisMesh = tisMod.getMesh();
        tisMesh.name = 'portrait-tissus';
        tisMat = tisMesh.material;
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
function rendrePixel() {
  const rt = renderer.getRenderTarget();
  renderer.getViewport(SAUVE_VP);
  renderer.getScissor(SAUVE_SC);
  const scissor = renderer.getScissorTest();
  VP.set(0, 0, 1, 1);
  renderer.setRenderTarget(null);
  renderer.setViewport(VP);
  renderer.setScissor(VP);
  renderer.setScissorTest(true);
  renderer.render(scene, cam);
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
  if (ctx.player && ctx.player.aModeleAgent) {
    charge = -1;
    for (let a = 0; a < AGENTS.length && charge < 0; a++) if (ctx.player.aModeleAgent(a)) charge = a;
    if (charge < 0) return;
  }
  if (!construire(charge)) return;
  const a0 = M[0];
  const m0 = M[1];
  const v0 = M[2];
  habiller(0, MODE_PAUSE, false);
  if (M[3] === 1) capeMod.sync();
  // un vrai rendu, par le même chemin que render() (canvas, viewport + scissor, ombre du soleil) dans un seul pixel :
  // renderer.compile seul ne suffit pas (mesuré : le programme de la 1re pause était encore neuf). L'image suivante du
  // jeu recouvre tout le canvas.
  rendrePixel();
  habiller(0, MODE_PAUSE, true); // silhouette : corps et cape unis
  rendrePixel();
  habiller(0, MODE_PAUSE, false);
  if (a0 >= 0 && a0 !== 0 && construire(a0)) habiller(a0, m0, v0 === 1);
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

/**
 * § E4.L.1 : le portrait du Noyau (onglet Agents) — agent a, silhouette s'il est verrouillé ; a < 0 : fermé. De face à
 * chaque appel (changement d'agent, réouverture de l'onglet). § E5.W : enLecture — le modèle de a est en lecture : s'il
 * n'est pas encore là, état « Chargement » au lieu de l'image pixel.
 */
export function openHub(a, verrou, enLecture) {
  if (!(a >= 0 && a < AGENTS.length)) {
    close();
    return;
  }
  ouvrir(a, MODE_HUB, !!verrou, !!enLecture);
}

/** § E5.W : état « Chargement » du portrait (vrai : posé ; faux : retiré). */
function setAttente(on) {
  attente = on;
  if (ui && ui.setPortraitAttente) ui.setPortraitAttente(on);
}

function ouvrir(a, mode, verrou, enLecture) {
  if (toile === null) {
    toile = ui.getPortraitCanvas ? ui.getPortraitCanvas() : null;
    if (toile === null) return; // pas de fiche (thème désert)
    g2d = toile.getContext('2d', { alpha: true });
    brancherRotation(toile);
  }
  T[3] = 0;
  T[5] = 0;
  if (scene === null) creerScene();
  if (!construire(a)) {
    // § E5.K : agent pas chargé (pas choisi, ou verrouillé) — IMAGE FIXE : le portrait pixel de la fiche
    // (AGENT_SCREEN.portraits, ou sa silhouette pleine : ui.appliquerSil), aucun rendu 3D
    // § E5.W : sauf l'agent choisi dont le modèle est en lecture — état « Chargement » : le dernier rendu 3D (s'il y en
    // avait un à l'écran) reste dans la toile et s'efface (CSS, opacité), sans image pixel
    const vu3d = N[3] === 1;
    N[3] = 0;
    M[0] = a;
    M[1] = mode;
    M[2] = verrou ? 1 : 0;
    fixe = true;
    if (enLecture && !verrou) {
      if (!vu3d && !attente && g2d) g2d.clearRect(0, 0, toile.width, toile.height);
      setAttente(true);
      ui.setPortrait3d(false);
      return;
    }
    if (attente) setAttente(false);
    if (g2d) g2d.clearRect(0, 0, toile.width, toile.height); // aucune image 3D périmée (autre agent) sous l'image fixe
    ui.setPortrait3d(false);
    return;
  }
  fixe = false;
  if (attente) {
    if (g2d) g2d.clearRect(0, 0, toile.width, toile.height); // § E5.W : plus rien de l'agent d'avant avant le 1er rendu
    setAttente(false);
  }
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

/** Reprise / sortie du Noyau : plus de rendu du portrait (ressources gardées pour la prochaine ouverture). */
export function close() {
  N[3] = 0;
  fixe = false;
  if (attente) setAttente(false);
}

/** Recopie l'échelle des os d'armes du héros du jeu : une arme gagnée apparaît sur le portrait (pause seulement). */
export function refreshWeapons() {
  if (M[1] !== MODE_PAUSE || M[2] === 1) return;
  for (let i = 0; i < copieDst.length; i++) copieDst[i].scale.copy(copieSrc[i].scale);
}

/** Idle : respiration du buste, balancier des bras, tête, lent pivot autour de la vue 3/4 (temps réel de la pause). */
function poser() {
  if (idleCuit !== null || idlesAgents[M[0]] !== null) {
    poserCuit();
    return;
  }
  const I = PAUSE.idle;
  const s = Math.sin((TAU * T[0]) / I.souffleS);
  oRacine.position.y = I.racine * (s - 1) * 0.5;
  oBuste.rotation.x = I.buste * s;
  if (oBrasG) oBrasG.rotation.z = I.bras * (0.6 + 0.4 * s);
  if (oBrasD) oBrasD.rotation.z = -I.bras * (0.6 + 0.4 * s);
  if (oTete) oTete.rotation.y = I.tete * Math.sin((TAU * T[0]) / I.teteS);
  mesh.rotation.y = -T[1] + I.pivot * Math.sin((TAU * T[0]) / I.pivotS) + T[3];
}

/**
 * § E4.E.3 — Warrior Idle : pistes cuites (squelette de l'écran titre : racine à la hanche, buste 8,3 cm au-dessus) sur
 * le squelette du portrait (racine et buste à l'origine) : racine = Pm − Qr·H, buste = T − Qb·T (mêmes points du corps).
 */
function poserCuit() {
  // § E5.F.13 : l'agent montré est celui de la partie et il tient le marteau → « Great Sword Idle »
  const marteau = idleMarteauP !== null && IDLES_AGENTS.marteau.actif && heros.IDLE_MARTEAU[0] === 1 && M[0] === run.agent;
  (marteau ? idleMarteauP : idlesAgents[M[0]] !== null && idlesAgents[M[0]] !== undefined ? idlesAgents[M[0]] : idleCuit).echantillonner(T[0], os, oRacine, 0); // § E5.F
  qV.set(0, HT[0], 0).applyQuaternion(oRacine.quaternion);
  oRacine.position.sub(qV);
  qV2.set(0, HT[1], 0).applyQuaternion(oBuste.quaternion);
  oBuste.position.set(-qV2.x, HT[1] - qV2.y, -qV2.z);
  mesh.rotation.y = -T[1] + T[3];
}

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

/** F14, pause et Noyau seulement, AVANT la scène du jeu ou du titre (qui recouvre la région du canvas utilisée ici). */
export function render(realDt) {
  if (N[3] === 0 || mesh === null) return;
  if (M[1] === MODE_PAUSE && (heros.getMesh() === null || heros.getMesh().geometry !== geoPosee)) {
    if (!construire(run.agent)) return;
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

/** Tests : état du portrait. */
export function inspect(out = {}) {
  out.ouvert = N[3] === 1;
  out.statique = fixe; // § E5.K : agent pas chargé (image fixe, ou état « Chargement » : attente)
  out.attente = attente; // § E5.W : « Chargement » (modèle de l'agent choisi en lecture), jamais l'image pixel
  out.construit = mesh !== null;
  out.taille = [N[0], N[1]];
  out.images = N[5];
  out.temps = T[0];
  out.rotation = T[3]; // 16/11, point 9 : rotation donnée au pointeur (rad)
  out.glisse = T[5] === 1;
  out.armes = copieDst.filter((o) => o.scale.x > 0.5).map((o) => o.name);
  out.armesPortees = armesDst.filter((o) => o.scale.x > 0.5).map((o) => o.name); // § E4.L : Noyau et silhouette
  out.armesJeu = copieSrc.filter((o) => o.scale.x > 0.5).map((o) => o.name);
  out.agent = M[0] >= 0 ? M[0] : run.agent; // § E4.L : l'agent MONTRÉ (Noyau : celui du sélecteur)
  out.mode = M[1] === MODE_HUB ? 'noyau' : 'pause';
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
  out.geometrieAgent = mesh !== null && !!ctx.player && !!ctx.player.modeleAgent && ctx.player.modeleAgent(out.agent) !== null && mesh.geometry === ctx.player.modeleAgent(out.agent).geometry;
  out.idle = idleCuit !== null ? idleCuit.source : 'code'; // § E4.E.3
  if (mesh !== null && os.bras_d) out.qBrasD = [os.bras_d.quaternion.x, os.bras_d.quaternion.y, os.bras_d.quaternion.z, os.bras_d.quaternion.w];
  out.geometrieDuHeros = mesh !== null && heros.getMesh() !== null && mesh.geometry === heros.getMesh().geometry;
  out.objets = scene === null ? 0 : scene.children.filter((o) => o.isMesh && o.visible).length; // maillages dessinés (§ E4.L.3 : +1 avec la cape)
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
