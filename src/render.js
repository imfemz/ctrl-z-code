// FONDATION : render.js — renderer, scène, post-traitement, matériaux communs (flash blanc par attribut d'instance),
// fabriques d'instances, qualité adaptative (descente et remontée), prewarm (contrat : ARCHITECTURE.md § G).
// Intégration du rendu « peint » (13/11/2026, § Z quater, DA docs/da-clash.md) : le matériau éclairé commun est le
// matériau peint de src/rendu/materiaux.js (profils), la chaîne est RenderPass → lueur (bloom multi-niveaux de
// src/rendu/bloom.js + flou diorama de src/rendu/diorama.js) → passe finale peinte (src/rendu/post.js : exposition,
// courbe filmique, saturation, chaud / froid, diorama, vignettage, flash des bords) ; un changement de niveau de
// qualité règle aussi les coûts du pipeline peint (carte d'ombre, filtrage, grain du sol, cailloux, végétation).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PEINT, RENDER } from './config.js';
import { ajouterTeinteLueurs, appliquerCelMateriaux, createPaintedMaterial } from './rendu/materiaux.js';
import { BloomPeint } from './rendu/bloom.js';
import { lookDuChargement } from './vfx/look.js';
import { FlouDiorama } from './rendu/diorama.js';
import { appliquerCelPost, appliquerCrt, celDuChargement, creerPasseFinale, crtDuChargement } from './rendu/post.js';
import * as peint from './rendu/index.js';
import { geometrieVide, poser } from './rendu/modeles.js';
import * as uniformes from './rendu/uniformes.js';
import * as envois from './rendu/envois.js';
import { AUTOUR_LUMIERE, HEROS } from './vfx/projectiles.js'; // § E5.P (B1) : halo du bloom atténué autour du héros

let ctx = null;
let renderer = null;
let scene = null;
let composer = null;
let glowPass = null; // bloom peint + flou diorama (une seule place dans la chaîne)
let finalPass = null;

const LAST_LEVEL = RENDER.quality.length - 1;

let level = 0; // niveau de qualité courant (0 = le meilleur, celui du chargement)
let ceiling = 0; // meilleur niveau encore autorisé : monte d'un cran quand une remontée a échoué
let samples = 0; // MSAA réellement appliqué (dépend du niveau ET du nombre de pixels)
let pixelRatio = 1;
let appliedDpr = 0; // window.devicePixelRatio au dernier applySize
let cssW = 1;
let cssH = 1;
let bufW = 1;
let bufH = 1;
let resizePending = true;
let lastCalls = 0;
let lastTriangles = 0;

// Adaptation de qualité (§ G.6). Compteurs entiers et drapeaux en variables ; tout ce qui reçoit un flottant à
// chaque image est rangé dans un tableau typé : une variable de module qui reçoit un flottant coûte un nombre
// alloué (12 octets) à chaque écriture (§ V).
const T_SETTLE = 0; // s encore ignorées après un changement de niveau ou de taille
const T_WIN_TIME = 1; // durée de la fenêtre en cours (s)
const T_WIN_SUM = 2; // somme des intervalles de la fenêtre (ms)
const T_TRIGGER = 3; // intervalle moyen de la fenêtre qui a déclenché la dernière descente (ms)
const T_CLEAN = 4; // s de fenêtres propres consécutives au niveau courant
const T_DPR = 5; // s depuis la dernière relecture de la densité d'écran
const timers = new Float64Array(6);
timers[T_SETTLE] = RENDER.adaptive.settleSeconds;
let winFrames = 0;
let winSlow = 0;
let slowRun = 0; // fenêtres lentes consécutives
let noGainRun = 0; // descentes consécutives qui n'ont rien apporté
let awaitingGain = false; // la prochaine fenêtre complète juge la dernière descente
let probing = false; // le niveau courant vient d'une remontée pas encore confirmée
let adaptStopped = false;
let adaptPaused = false; // écran titre 3D affiché (§ Z octies) : ses images ne jugent pas la qualité du jeu
let graphFixe = -1; // réglage « Graphismes » (Femz, 21/11) : -1 = Auto (adaptation), sinon niveau de RENDER.quality imposé

const tmpColor = new THREE.Color();
const tmpSize = new THREE.Vector2();

/**
 * Lueur (§ Z quater) : bloom « dual filter » à 5 niveaux (src/rendu/bloom.js : seuil sur le canal le plus fort avec
 * genou, plafond par pixel — garde-fou de la horde —, voile des zones claires) puis copie floue de la scène pour le
 * diorama (src/rendu/diorama.js). N'écrit dans aucun tampon de la chaîne (needsSwap = false) : la passe finale lit
 * bloom.texture et diorama.texture. Niveau de qualité sans bloom : le bloom n'est plus rendu (uBloom = 0).
 */
class PasseLueur extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.bloom = new BloomPeint();
    this.diorama = new FlouDiorama();
    this.bloomOn = true;
    this.dioramaOn = PEINT.diorama.force > 0;
    const A = PEINT.atmosphere;
    this.bloom.voile(A.voile.seuil, A.voile.force);
  }

  setSize(w, h) {
    this.bloom.setSize(w, h);
    this.diorama.setSize(w, h);
  }

  render(r, writeBuffer, readBuffer) {
    if (this.bloomOn) this.bloom.render(r, writeBuffer, readBuffer);
    if (this.dioramaOn) this.diorama.render(r, writeBuffer, readBuffer);
  }

  dispose() {}
}

export function init(context) {
  ctx = context;
  // Le canvas remplit la fenêtre par ses propres styles : sa taille affichée ne dépend d'aucune feuille de style
  // (renderer.setSize(…, false) n'en pose pas ; sans eux il s'afficherait à la taille de son tampon de dessin).
  ctx.canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  renderer = new THREE.WebGLRenderer({
    canvas: ctx.canvas,
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  renderer.setClearColor(RENDER.clearColor, 1);
  envois.init(renderer); // textures de données et tri des listes sans allocation (§ Z nonies)
  scene = new THREE.Scene();
  ctx.renderer = renderer;
  ctx.scene = scene;

  samples = RENDER.quality[level].msaa;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
  target.texture.name = 'SurvivorComposer.rt';
  // look-cel : profondeur de la scène en texture (contour des silhouettes) ; renderTarget2 en reçoit un clone.
  // Seulement si la variante chargée trace le contour, ou en ?debug (essais de variantes) : la variante retenue
  // (« Aplats seuls ») n'en a pas besoin, pas de résolution de profondeur à chaque image pour rien.
  const celInit = celDuChargement();
  if ((PEINT.cel.variantes[celInit]?.contour || 0) > 0 || new URLSearchParams(location.search).has('debug')) {
    target.depthTexture = new THREE.DepthTexture(1, 1);
    target.depthTexture.minFilter = THREE.NearestFilter;
    target.depthTexture.magFilter = THREE.NearestFilter;
  }
  composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(1); // les tailles sont passées en pixels du tampon de dessin (entiers)

  const passeRendu = new RenderPass(scene, ctx.camera.threeCamera);
  composer.addPass(passeRendu);

  glowPass = new PasseLueur();
  composer.addPass(glowPass);

  // Passe finale peinte. Les textures sont assignées APRÈS la construction du ShaderPass (passées dans la définition,
  // three tenterait de cloner une texture de cible de rendu : « Textures of render targets cannot be cloned »).
  finalPass = new ShaderPass(creerPasseFinale(1));
  finalPass.uniforms.tBloom0.value = glowPass.bloom.texture;
  finalPass.uniforms.tDiorama.value = glowPass.diorama.texture;
  // § E5.P (B1) : objets partagés, assignés après le clonage du ShaderPass — centre du héros (écrit par vfx.commit),
  // matrices de la caméra (tenues à jour par three), réglages et drapeau actif (écrits par vfx.commit)
  finalPass.uniforms.uHaloHeros.value = HEROS;
  finalPass.uniforms.uHaloProj.value = ctx.camera.threeCamera.projectionMatrix;
  finalPass.uniforms.uHaloVue.value = ctx.camera.threeCamera.matrixWorldInverse;
  finalPass.uniforms.uHalo.value = AUTOUR_LUMIERE;
  //#region e5:AB-camera-3p
  // § E5.AB.12 : caméra en perspective du mode Souris — la passe de rendu, les matrices du halo et la profondeur du
  // contour suivent la caméra active (une seule à la fois)
  if (ctx.camera.onCamera) {
    ctx.camera.onCamera((cam) => {
      passeRendu.camera = cam;
      finalPass.uniforms.uHaloProj.value = cam.projectionMatrix;
      finalPass.uniforms.uHaloVue.value = cam.matrixWorldInverse;
      finalPass.uniforms.uCelPersp.value.set(cam.isPerspectiveCamera ? 1 : 0, cam.near, cam.far);
    });
  }
  //#endregion e5:AB-camera-3p
  const A = PEINT.atmosphere;
  finalPass.uniforms.uDiorama.value.set(PEINT.diorama.force, PEINT.diorama.bande);
  finalPass.uniforms.uChaud.value.set(A.chaud[0], A.chaud[1], A.chaud[2]);
  finalPass.uniforms.uFroid.value.set(A.froid[0], A.froid[1], A.froid[2]);
  finalPass.uniforms.uSaturation.value = A.saturation;
  composer.addPass(finalPass);
  applyBloom();
  reglerCrt(crtDuChargement());
  { const lk = lookDuChargement(); if (lk) reglerGlow(lk.glow); } // 17/11 : glow du look des VFX (src/vfx/look.js)
  reglerCel(celInit);

  window.addEventListener('resize', onResize);
}

function onResize() {
  resizePending = true;
}

let forceBloom = PEINT.bloom.force; // 17/11 : réglée par reglerGlow (look des VFX)

function applyBloom() {
  const on = RENDER.quality[level].bloom;
  glowPass.bloomOn = on;
  finalPass.uniforms.uBloom.value.set(on ? forceBloom : 0, 0, 0, 0); // 0 : la texture du bloom n'est plus lue
}

/** Taille du tampon, MSAA et frustum pour le niveau courant. Seul endroit où des cibles de rendu sont recréées. */
function applySize() {
  resizePending = false;
  cssW = Math.max(1, window.innerWidth | 0);
  cssH = Math.max(1, window.innerHeight | 0);
  const q = RENDER.quality[level];
  appliedDpr = window.devicePixelRatio || 1;
  pixelRatio = Math.min(appliedDpr, q.pixelRatio, Math.sqrt(q.maxPixels / (cssW * cssH)));
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(cssW, cssH, false);
  renderer.getDrawingBufferSize(tmpSize);
  bufW = tmpSize.x;
  bufH = tmpSize.y;
  // MSAA : celui du niveau, divisé par deux tant que pixels × échantillons dépasse le budget du niveau. À la
  // densité d'un écran Retina, deux échantillons suffisent et le coût reste celui d'un rendu ×1,5 à quatre.
  let n = q.msaa;
  while (n > 2 && bufW * bufH * n > q.maxSamples) n >>= 1;
  if (n !== samples) {
    samples = n;
    composer.renderTarget1.samples = n;
    composer.renderTarget2.samples = n;
    composer.renderTarget1.dispose();
    composer.renderTarget2.dispose();
  }
  composer.setSize(bufW, bufH);
  finalPass.uniforms.uCrtRes.value.set(bufW, bufH);
  finalPass.uniforms.uCrtDpr.value = pixelRatio;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    if (!rt.depthTexture) continue;
    rt.depthTexture.image.width = bufW; // three r170 : setSize ne redimensionne pas la texture de profondeur
    rt.depthTexture.image.height = bufH;
  }
  finalPass.uniforms.uCelRes.value.set(bufW, bufH);
  ctx.camera.resize(cssW, cssH);
  timers[T_SETTLE] = RENDER.adaptive.settleSeconds;
  timers[T_WIN_TIME] = 0;
  timers[T_WIN_SUM] = 0;
  winFrames = 0;
  winSlow = 0;
}

function setLevel(next) {
  level = next < 0 ? 0 : next > LAST_LEVEL ? LAST_LEVEL : next;
  slowRun = 0;
  timers[T_CLEAN] = 0;
  applyBloom();
  peint.setQualite(level); // carte d'ombre (recréée), filtrage, grain du sol, cailloux, touffes, végétation
  applySize();
}

/**
 * Une fenêtre d'observation vient de se fermer (§ G.6). slow : plus de slowShare de ses images étaient lentes ;
 * avg : son intervalle moyen (ms).
 */
function closeWindow(slow, avg) {
  const A = RENDER.adaptive;
  if (awaitingGain) {
    // Première fenêtre complète après une descente : a-t-elle servi à quelque chose ?
    awaitingGain = false;
    if (avg > timers[T_TRIGGER] * (1 - A.minGain)) {
      noGainRun++;
      if (noGainRun >= A.noGainDrops) {
        // Plusieurs descentes de suite sans effet : la cadence est bridée par autre chose que le rendu (économie
        // d'énergie, écran lent, machine occupée). La qualité perdue pour rien est rendue, et on n'adapte plus.
        adaptStopped = true;
        probing = false;
        setLevel(level - noGainRun);
        return;
      }
    } else {
      noGainRun = 0;
    }
  }
  if (slow) {
    timers[T_CLEAN] = 0;
    slowRun++;
    // Un ralentissement passager ne coûte rien : il faut dropAfterWindows fenêtres lentes de suite. Juste après
    // une remontée, une seule suffit : la remontée a échoué, on revient et ce niveau n'est plus retenté.
    if (level < LAST_LEVEL && slowRun >= (probing ? 1 : A.dropAfterWindows)) {
      if (probing) {
        probing = false;
        ceiling = level + 1;
      } else {
        timers[T_TRIGGER] = avg;
        awaitingGain = true;
      }
      setLevel(level + 1);
    }
    return;
  }
  slowRun = 0;
  timers[T_CLEAN] += A.windowSeconds;
  if (probing && timers[T_CLEAN] >= A.probeSeconds) probing = false; // remontée confirmée
  if (!probing && level > ceiling && timers[T_CLEAN] >= A.raiseAfterSeconds) {
    probing = true;
    noGainRun = 0;
    setLevel(level - 1);
  }
}

/** F1 : redimensionnement en attente, remise à zéro des compteurs du renderer, adaptation de qualité. */
export function beginFrame(frameMs) {
  const dt = frameMs / 1000;
  // Densité d'écran : une fenêtre glissée d'un écran ×1 vers un écran Retina ne déclenche aucun « resize ».
  timers[T_DPR] += dt;
  if (timers[T_DPR] >= RENDER.dprPollSeconds) {
    timers[T_DPR] = 0;
    if ((window.devicePixelRatio || 1) !== appliedDpr) resizePending = true;
  }
  if (resizePending) applySize();
  renderer.info.reset();
  envois.debutImage();
  uniformes.suivre(renderer); // envoi des uniformes sans allocation (§ Z nonies) : rien tant qu'aucun programme n'apparaît

  const A = RENDER.adaptive;
  if (!A.enabled || adaptStopped || adaptPaused || graphFixe >= 0) return;
  if (timers[T_SETTLE] > 0) {
    timers[T_SETTLE] -= dt;
    return;
  }
  timers[T_WIN_TIME] += dt;
  timers[T_WIN_SUM] += frameMs;
  winFrames++;
  if (frameMs > 1000 / A.dropBelowFps) winSlow++;
  // La fenêtre se ferme quand elle a duré windowSeconds ET compte minFrames images. (Ignorer une fenêtre trop
  // pauvre en images, comme le voulait la première version du contrat, empêchait toute descente sous 10 i/s :
  // constaté en rendu logiciel, 4,6 i/s et qualité restée au niveau 0.) Une reprise après un onglet masqué ne
  // donne qu'UNE image longue : elle ne fait pas la moitié de la fenêtre.
  if (timers[T_WIN_TIME] < A.windowSeconds || winFrames < A.minFrames) return;
  const slow = winSlow > A.slowShare * winFrames;
  const avg = timers[T_WIN_SUM] / winFrames;
  timers[T_WIN_TIME] = 0;
  timers[T_WIN_SUM] = 0;
  winFrames = 0;
  winSlow = 0;
  closeWindow(slow, avg);
}

/** F14 */
export function render() {
  rendreComposer();
  renderNets();
  lastCalls = renderer.info.render.calls;
  lastTriangles = renderer.info.render.triangles;
}

/**
 * Écran titre 3D (§ Z octies) : à la place de render() quand la scène du menu a été rendue par le même renderer.
 * Relève les compteurs de l'image (appels, triangles) comme render().
 */
export function noteFrame() {
  lastCalls = renderer.info.render.calls;
  lastTriangles = renderer.info.render.triangles;
}

/** Écran titre avant l'arrivée de la scène du menu (§ Z octies) : fond uni (RENDER.clearColor), rien d'autre. */
export function clearScreen() {
  renderer.setRenderTarget(null);
  renderer.clear();
  noteFrame();
}

/**
 * Adaptation de la qualité suspendue (on = true) pendant que la scène du menu est affichée : elle a son propre coût, qui
 * ne dit rien de celui du combat. À la reprise, la fenêtre d'observation repart de zéro après settleSeconds (la première
 * image de la partie peut porter un envoi de géométries).
 */
/**
 * Réglage « Graphismes » (Femz, 21/11) : niveau < 0 = Auto (l'adaptation repart du meilleur niveau, ses compteurs et
 * plafonds remis à zéro) ; sinon le niveau de RENDER.quality est imposé et l'adaptation ne joue plus. Hors chemin chaud.
 */
export function setGraphismes(niveau) {
  if (!(niveau >= 0)) {
    graphFixe = -1;
    adaptStopped = false;
    ceiling = 0;
    probing = false;
    awaitingGain = false;
    noGainRun = 0;
    timers[T_WIN_TIME] = 0;
    timers[T_WIN_SUM] = 0;
    winFrames = 0;
    winSlow = 0;
    if (level !== 0) setLevel(0);
    timers[T_SETTLE] = RENDER.adaptive.settleSeconds;
    return;
  }
  graphFixe = niveau > LAST_LEVEL ? LAST_LEVEL : niveau | 0;
  if (level !== graphFixe) setLevel(graphFixe);
}

export function setAdaptivePaused(on) {
  const p = !!on;
  if (p === adaptPaused) return;
  adaptPaused = p;
  if (!p) {
    timers[T_SETTLE] = RENDER.adaptive.settleSeconds;
    timers[T_WIN_TIME] = 0;
    timers[T_WIN_SUM] = 0;
    winFrames = 0;
    winSlow = 0;
  }
}

/** Marque le redimensionnement et l'applique tout de suite (appel explicite de main après les init). */
export function resize() {
  applySize();
}

/**
 * Rend une image par le composer avec TOUT ce que la scène contient : chaque objet rendu visible (un maillage
 * dans un groupe caché ne serait pas dessiné), aucun maillage écarté par le frustum (un maillage rangé hors
 * champ non plus), un exemplaire de chaque instancié placé sur la cible de la caméra. Programmes compilés et
 * géométries envoyées avant le premier combat ; tout est remis en place ensuite.
 */
export function prewarm() {
  const saved = toutMontrer();
  rendreComposer();
  renderNets(); // programme des chiffres pour l'écran (espace de sortie sRGB) compilé avant le premier coup
  toutRemettre(saved);
  renderer.info.reset();
}

/**
 * 20/11 (testeur Windows : « 0 % » pendant 2 min ; sous Direct3D 11 la compilation des shaders du jeu prend ~100 s) :
 * les programmes de TOUT ce que la scène contient sont DEMANDÉS à la carte graphique sans bloquer la page
 * (renderer.compileAsync : KHR_parallel_shader_compile — la carte compile en parallèle, la page continue de vivre,
 * l'écran de chargement avance). La promesse est tenue quand ils sont tous prêts (jamais rejetée) ; main fait ALORS
 * le prewarm habituel, devenu rapide (ombres, passes du composer et envoi des géométries). Même préparation que
 * prewarm (tout visible, un exemplaire de chaque instancié), remise en place aussitôt la demande faite : l'attente ne
 * touche plus à la scène. Les objets sont compilés pour la cible de la RenderPass (son espace de sortie), comme au rendu.
 */
export function prewarmAsync() {
  if (typeof renderer.compileAsync !== 'function') return Promise.resolve();
  // Sans KHR_parallel_shader_compile (Firefox, Chrome sans GPU des tests), compileAsync ne gagne rien (la compilation
  // bloque de toute façon) et three écrit un avertissement de console : le prewarm synchrone qui suit fait le travail.
  // has() ne prévient pas (get() le fait). Chrome Windows (ANGLE / Direct3D 11) l'a : le gain du 20/11 est gardé.
  if (!renderer.extensions || !renderer.extensions.has('KHR_parallel_shader_compile')) return Promise.resolve();
  const saved = toutMontrer();
  const avant = renderer.getRenderTarget();
  const attentes = [];
  try {
    renderer.setRenderTarget(composer.readBuffer);
    attentes.push(renderer.compileAsync(scene, ctx.camera.threeCamera));
    if (crtActif && nets.length > 0) {
      renderer.setRenderTarget(null);
      attentes.push(renderer.compileAsync(sceneNets, ctx.camera.threeCamera));
    }
  } catch (e) {
    /* compilation impossible ici : le prewarm synchrone qui suit s'en chargera */
  } finally {
    renderer.setRenderTarget(avant);
    toutRemettre(saved);
  }
  return Promise.all(attentes).then(
    () => undefined,
    () => undefined,
  );
}

/** Tout ce que la scène contient devient visible (et non écarté), un exemplaire de chaque instancié sur la cible. */
function toutMontrer() {
  const view = ctx.camera.view;
  const saved = [];
  const preparer = (o) => {
    if (o.isLight || o.isCamera) return; // une lumière allumée pour l'occasion changerait les programmes
    const rec = { o, visible: o.visible, culled: o.frustumCulled, count: 0, m: null };
    if (o.isInstancedMesh) {
      rec.count = o.count;
      const a = o.instanceMatrix.array;
      rec.m = a.slice(0, 16);
      writeInstance(a, 0, view.targetX, 0, view.targetZ, 0, 1, 1, 1);
      o.instanceMatrix.needsUpdate = true;
      o.count = 1;
    }
    o.visible = true;
    if (o.isMesh) o.frustumCulled = false;
    saved.push(rec);
  };
  scene.traverse(preparer);
  sceneNets.traverse(preparer); // chiffres de dégâts quand l'effet CRT / pixel est actif (scène à part)
  return saved;
}

function toutRemettre(saved) {
  for (const rec of saved) {
    const o = rec.o;
    o.visible = rec.visible;
    o.frustumCulled = rec.culled;
    if (o.isInstancedMesh) {
      o.instanceMatrix.array.set(rec.m, 0);
      o.instanceMatrix.needsUpdate = true;
      o.count = rec.count;
    }
  }
}

/**
 * Mesures seulement (crochet de debug `peintRegler`, § S) : coupe ou rétablit le bloom et le diorama de la lueur peinte.
 * Un changement de niveau de qualité réapplique le bloom du niveau.
 */
export function reglerPeint({ bloom = null, diorama = null } = {}) {
  if (bloom !== null) {
    const on = !!bloom && RENDER.quality[level].bloom;
    glowPass.bloomOn = on;
    finalPass.uniforms.uBloom.value.x = on ? forceBloom : 0;
  }
  if (diorama !== null) {
    glowPass.dioramaOn = !!diorama;
    finalPass.uniforms.uDiorama.value.x = diorama ? PEINT.diorama.force : 0;
  }
  return { bloom: glowPass.bloomOn, diorama: glowPass.dioramaOn };
}

/**
 * Look des VFX (17/11, src/vfx/look.js) : glow « deep glow » — { seuil, genou, plafond, poids[7], force, saturation } ;
 * null = réglages de PEINT.bloom (rendu d'avant). Rend les réglages appliqués.
 */
export function reglerGlow(g) {
  const B = PEINT.bloom;
  const o = g || {};
  const seuil = o.seuil ?? B.seuil;
  const genou = o.genou ?? B.genou;
  const plafond = o.plafond ?? B.plafond;
  const poids = o.poids || B.poids;
  glowPass.bloom.regler(seuil, genou, plafond);
  glowPass.bloom.reglerPoids(poids);
  glowPass.bloom.mExtraire.uniforms.uSatExt.value = o.saturationExtraction ?? 1;
  forceBloom = o.force ?? B.force;
  finalPass.uniforms.uBloomSat.value = o.saturation ?? 1;
  applyBloom();
  return { seuil, genou, plafond, poids: Array.from(poids), force: forceBloom, saturation: finalPass.uniforms.uBloomSat.value };
}

/**
 * Branche shader-crt : variante CRT / pixel de la passe finale. v = numéro dans PEINT.crt.variantes (0 = aucune) ou
 * objet de réglages { pixel, scan, scanPx, mask, chroma, courbure, niveaux }. Rend les réglages appliqués.
 */
export function reglerCrt(v) {
  const o = typeof v === 'number' ? PEINT.crt.variantes[v | 0] || {} : v || {};
  crtActif = appliquerCrt(finalPass.uniforms, o);
  for (const m of nets) appliquerCalque(m);
  return o;
}

// Ce qui reste NET quand l'effet CRT / pixel est actif (chiffres de dégâts : le texte du canvas). Ces maillages
// passent dans une SCÈNE À PART (sceneNets), que le composer ne voit pas, et sont dessinés après la passe finale,
// directement à l'écran (renderNets). Sans effet actif, ils restent dans la scène comme avant.
// Scène à part, pas un calque de la scène du jeu (corrigé le 15/11/2026) : three range l'état des lumières PAR SCÈNE.
// Une seconde passe sur la MÊME scène avec un calque sans lumière remettait cet état à « 0 lumière », puis la
// RenderPass suivante à « N lumières » : la version de l'état changeait deux fois par image, et chaque matériau
// éclairé repassait par getProgram (paramètres et clé de programme recalculés) à chaque image — ≈ 57 Ko alloués par
// image dans three (400 rôdeurs, fondation : 59 326 o au lieu de < 4 096). Pas de brouillard ni de fond dans la scène
// du jeu : les chiffres sont dessinés exactement comme avant.
const sceneNets = new THREE.Scene();
let crtActif = false;
const nets = [];
const parentsNets = []; // parent d'origine de chaque maillage net (la scène du jeu), retrouvé quand l'effet s'éteint
function appliquerCalque(m) {
  const i = nets.indexOf(m);
  (crtActif ? sceneNets : parentsNets[i]).add(m);
}
/** fx.js : le maillage des chiffres de dégâts reste hors de l'effet CRT / pixel. */
export function garderNet(mesh) {
  nets.push(mesh);
  parentsNets.push(mesh.parent || scene);
  appliquerCalque(mesh);
}
function renderNets() {
  if (!crtActif || nets.length === 0) return;
  renderer.setRenderTarget(null);
  renderer.autoClear = false;
  renderer.clearDepth(); // les chiffres ne se testent qu'entre eux (liseré et plein), toujours devant la scène
  renderer.render(sceneNets, ctx.camera.threeCamera);
  renderer.autoClear = true;
}

/**
 * Branche look-cel : variante du rendu « cel » (aplats, liseré, contour, rampe rose / rouge). v = numéro dans
 * PEINT.cel.variantes (0 = rendu d'origine) ou objet de réglages (voir config.js). Rend les réglages appliqués.
 */
export function reglerCel(v) {
  const o = typeof v === 'number' ? PEINT.cel.variantes[v | 0] || {} : v || {};
  appliquerCelMateriaux(o);
  appliquerCelPost(finalPass.uniforms, o);
  const cam = ctx.camera.threeCamera;
  finalPass.uniforms.uCelProf.value.x = cam.far - cam.near;
  return o;
}

// La RenderPass dessine la scène dans le readBuffer du composer (needsSwap faux partout avant la passe finale) : sa
// profondeur est celle que lit le contour. Lue avant chaque rendu (les deux cibles s'échangent d'une image à l'autre).
// Sans texture de profondeur (hors ?debug, variante sans contour) : null, le contour n'est jamais lu (uCel.y = 0).
function rendreComposer() {
  finalPass.uniforms.tCelProf.value = composer.readBuffer.depthTexture;
  composer.render(0);
}

/** Redessine l'image courante sans faire avancer le jeu (comparaison de variantes sur la même image). */
export function redessiner() {
  rendreComposer();
  renderNets();
}

/** Bords rouges (0..1), piloté par fx. */
export function setEdgeFlash(v) {
  finalPass.uniforms.uEdgeFlash.value = v;
}

// ----- Matériaux ------------------------------------------------------------------------------------------------

/**
 * Matériau éclairé commun = matériau PEINT (src/rendu/materiaux.js, § Z quater) : couleurs de sommet (COLOR_0 des
 * modèles), émissif par sommet (aEmissive), flash blanc et lueur par instance (aFx) ou par maillage (uFx), éclairage
 * peint (soleil enveloppé, ombres douces et figées, ciel, voile coloré du profil, liseré, spéculaire, nuages).
 * profil : 'objet' (défaut) | 'robot' | 'boss' | 'heros' | 'decor' | 'herbe' | 'sol' (PEINT.profils : constantes de
 * compilation, un programme par profil). Une instance NEUVE par appel (une par maillage) ; les programmes sont
 * partagés (customProgramCacheKey). Uniformes : material.userData.uniforms (uFx, uGlowColor, uEmissiveBoost,
 * uFlashEmissive), comme avant.
 */
/** Envoie une image au GPU tout de suite (init : atlas des agents cuits, pour qu'un changement d'agent n'en charge
 *  aucune en cours de route). Sans moteur de rendu : rien. */
export function chargerTexture(t) {
  if (renderer && t) renderer.initTexture(t);
}

export function createLitMaterial({ glowColor = 0xffffff, emissiveBoost = RENDER.emissiveBoost, profil = 'objet', teinteLueurs = false } = {}) {
  const m = createPaintedMaterial({ glowColor, emissiveBoost, profil });
  // teinteLueurs (22/11, coffres v2) : émissif × attribut d'instance aTeinte (rendu/materiaux.js ajouterTeinteLueurs)
  return teinteLueurs ? ajouterTeinteLueurs(m) : m;
}

/** Matériau non éclairé : tirs, étincelles, anneaux, chiffres, rayons, zones… Couleur = sommet × instanceColor. */
export function createUnlitMaterial({ transparent = false, additive = false, opacity = 1, depthTest = true } = {}) {
  const t = transparent || additive;
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    depthTest,
    opacity,
    transparent: t,
    depthWrite: !t,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// ----- Géométries -----------------------------------------------------------------------------------------------

/** Pièce d'une couleur unie : géométrie non indexée, attributs color (linéaire) et aEmissive remplis. */
export function makePart(geometry, colorHex, emissive = 0) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.clearGroups();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  tmpColor.setHex(colorHex);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(n).fill(emissive ? 1 : 0), 1));
  return g;
}

/**
 * Modèles Blender des unités (§ Z quinquies) : géométrie VIDE (zéro sommet, attributs du contrat) avec laquelle une
 * unité crée son maillage à l'init, puis pose du modèle arrivé (src/rendu/modeles.js : attributs du modèle + attributs
 * d'instance du maillage, ancienne géométrie libérée ; `aussi` = maillages qui partagent la géométrie). Init et
 * arrivée des modèles seulement.
 */
export function emptyModelGeometry() {
  return geometrieVide();
}
export function setModelGeometry(mesh, donnees, aussi = []) {
  return poser(mesh, donnees, aussi);
}

/** Fusionne des pièces (à l'init seulement). */
export function mergeParts(parts) {
  return mergeGeometries(parts, false);
}

/**
 * InstancedMesh prêt à l'emploi : géométrie neuve qui réutilise les attributs de sommet reçus, attribut d'instance
 * aFx, couleur d'instance créée à l'init si demandée, tampons dynamiques, jamais éliminé par le frustum, vide et
 * invisible, ajouté à la scène.
 */
export function createInstanced(geometry, material, capacity, { castShadow = false, instanceColor = false, name = '' } = {}) {
  const g = new THREE.BufferGeometry();
  for (const key of Object.keys(geometry.attributes)) g.setAttribute(key, geometry.attributes[key]);
  if (geometry.index) g.setIndex(geometry.index);
  const aFx = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  aFx.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aFx', aFx);
  const mesh = new THREE.InstancedMesh(g, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (instanceColor) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  mesh.name = name;
  if (castShadow) makeShadowCaster(mesh);
  scene.add(mesh);
  return mesh;
}

/** Projeteur d'ombre : son propre matériau de profondeur (sinon three refait ses paramètres à chaque bascule). */
export function makeShadowCaster(mesh) {
  mesh.castShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
}

// ----- Écriture des instances (init et prewarm seulement ; dans un sync, écrire en ligne : § G.3) ---------------

export function writeInstance(arr, o, x, y, z, rotY, sx, sy, sz) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
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
  arr[o + 12] = x;
  arr[o + 13] = y;
  arr[o + 14] = z;
  arr[o + 15] = 1;
}

export function writeInstanceTilt(arr, o, x, y, z, rotY, tiltFwd, tiltSide, s) {
  const c = Math.cos(rotY);
  const sn = Math.sin(rotY);
  const a = tiltFwd;
  const b = tiltSide;
  arr[o] = c * s;
  arr[o + 1] = b * s;
  arr[o + 2] = -sn * s;
  arr[o + 3] = 0;
  arr[o + 4] = (sn * a - c * b) * s;
  arr[o + 5] = s;
  arr[o + 6] = (c * a + sn * b) * s;
  arr[o + 7] = 0;
  arr[o + 8] = sn * s;
  arr[o + 9] = -a * s;
  arr[o + 10] = c * s;
  arr[o + 11] = 0;
  arr[o + 12] = x;
  arr[o + 13] = y;
  arr[o + 14] = z;
  arr[o + 15] = 1;
}

/** Couleur LINÉAIRE de hex (sRGB) × boost, écrite en o, o+1, o+2. Sans allocation. */
export function writeColor(arr, o, hex, boost = 1) {
  tmpColor.setHex(hex);
  arr[o] = tmpColor.r * boost;
  arr[o + 1] = tmpColor.g * boost;
  arr[o + 2] = tmpColor.b * boost;
}

/** Une fois par maillage et par image : nombre d'instances, visibilité, envoi des tampons d'instance. */
export function commit(mesh, count) {
  mesh.count = count;
  if (count > 0) {
    mesh.visible = true;
    mesh.instanceMatrix.needsUpdate = true;
    // Intégration : le matériau non éclairé ne lit pas aFx ; ne pas renvoyer ce tampon (18 Ko par image pour les
    // chiffres de dégâts, relevé par le lot juice).
    if (mesh.material.userData.uniforms !== undefined) mesh.geometry.attributes.aFx.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  } else {
    mesh.visible = false;
  }
}

/** Niveau de qualité courant (0 le meilleur ; 3 = Basse). Lu chaque image : aucune allocation (≠ inspect). */
export function niveau() {
  return level;
}

export function inspect(out) {
  out.calls = lastCalls;
  out.triangles = lastTriangles;
  out.geometries = renderer.info.memory.geometries;
  out.textures = renderer.info.memory.textures;
  out.programs = renderer.info.programs ? renderer.info.programs.length : 0;
  uniformes.inspect(out);
  out.pixelRatio = pixelRatio;
  out.width = cssW;
  out.height = cssH;
  out.pixels = bufW * bufH;
  out.qualityLevel = level;
  out.msaa = samples;
  out.bloom = RENDER.quality[level].bloom;
  out.diorama = glowPass.dioramaOn;
  out.qualityCeiling = ceiling;
  out.adaptStopped = adaptStopped;
  out.adaptPaused = adaptPaused;
  out.graphismes = graphFixe; // -1 = Auto
}
