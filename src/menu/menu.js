// MENU PRINCIPAL — scène 3D de l'écran titre (« hero shot »), demande de Femz du 13/11/2026.
//
// Une scène et une caméra À PART (perspective : c'est un plan de cinéma, pas la caméra de jeu), rendue derrière le
// panneau d'interface de l'écran titre (src/ui.js, inchangé) qui reste à gauche ; le héros occupe le tiers droit.
//   - héros (heros-menu.js) sur un promontoire du désert, toutes armes et 4 tourelles, cape au vent, boucle de poses ;
//   - 3 boss géants (boss-menu.js) derrière lui, phase 2, dans la brume et le contre-jour, un peu flous ;
//   - ciel de crépuscule, dunes, mesas, poussière, braises (decor-menu.js, effets-menu.js) ;
//   - caméra dramatique : contre-plongée, ≈ 30 mm, dérive lente (orbite + dolly), recadrage à chaque pose, secousse
//     légère aux pas des boss ;
//   - chaîne d'image (post-menu.js) : profondeur de champ, bloom et passe finale du prototype de rendu ;
//   - son (son-menu.js) : nappe d'ambiance + sons du manifeste aux moments forts, après un geste.
//
// API : const menu = await creerMenu({ canvas | renderer, base, manuel, volume }) puis
//   menu.afficher() / menu.cacher()   — écran titre affiché / partie lancée (cacher libère les cibles de rendu,
//                                       coupe le son, arrête la boucle ; afficher les recrée : la scène est réutilisée) ;
//   menu.image(dt)                    — une image (mise à jour + rendu), pour une boucle externe (celle du jeu) ;
//   menu.liberer()                    — tout libérer (géométries, matériaux, textures, contexte audio du menu) ;
//   menu.allerA(t), menu.avancer(dt), menu.rendre() — pilotage manuel (captures, vidéo) ;
//   menu.son.debloquer() à appeler dans un gestionnaire de geste ; menu.son.setVolume(v).
// Boucle propre (sans renderer externe) : plafonnée à MENU.fpsMax (un écran à 120 Hz ne double pas le travail), arrêtée
// quand l'onglet est masqué (requestAnimationFrame) et quand le menu est caché.
//
// INTÉGRATION — FAITE le 14/11/2026 (étape « menu », ARCHITECTURE.md § Z octies) :
//   1. main.js boot() : après render.init, `creerMenu({ renderer: ctx.renderer, base: <racine absolue>, audio })` — UN
//      seul contexte WebGL (le canvas #game). Chargement asynchrone : fond uni à l'état TITLE avant l'arrivée ;
//      window.__game n'est publié qu'une fois la scène arrivée (ou en échec : fond uni, jeu jouable).
//   2. enterTitle() (T1, T16) : menu.afficher() (+ prechauffer() au premier affichage : tous les maillages envoyés d'un
//      coup) ; start() (T2) : menu.cacher() avant resetAll() — cibles de rendu libérées, scène gardée.
//   3. runFrame() F14 : à l'état TITLE, `menu.image(realDt)` puis render.noteFrame() À LA PLACE de render.render().
//      Écart à la recette : F9 – F11 (caméra, monde, sync des modules) tournent encore au titre (rien d'autre ne change
//      pour les tests et l'état du jeu ; coût mesuré ≈ 0,1 ms). L'adaptation de qualité est suspendue pendant le menu.
//   4. Son : sonDuJeu (son-menu.js) → audio.playGain(SFX[id], k) ; nappe d'audio.js montée à MENU.son.ambiance au titre
//      et ramenée à AUDIO.ambiance.gain au lancement (audio.setAmbiance). Déblocage : celui du jeu.
//   5. Taille : avec le renderer du jeu, le tampon de dessin (render.applySize) est relu à chaque image ; les cibles
//      suivent (redimensionnement, niveau de qualité).
//   6. ui.js / ui.css : rien changé.
//   Réglages : MENU et POSES dans config.js (région menu:reglages), profils peints herosMenu / bossMenu déclarés là.
//   Modules partagés (lecture seule) : cape.js et flammes.js sont chargés en instances À PART (« ?menu ») ;
//   ANIM.cape.souffle et ANIM.flammes.{tailleFeu, tailleFumee, opaciteFumee} sont posés le temps d'un appel puis
//   rendus (seule écriture dans un objet de config.js, restaurée dans la même image : § Y).
import * as THREE from 'three';
import { MENU, POSES, ORIENTATION } from './reglages-menu.js';
import { creerDecor } from './decor-menu.js';
import { creerHeros } from './heros-menu.js';
import { creerBoss } from './boss-menu.js';
import { creerEffets } from './effets-menu.js';
import { creerPost } from './post-menu.js';
import { creerSon, sonDuJeu } from './son-menu.js';
import { SFX } from '../config.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

export async function creerMenu({ canvas = null, renderer = null, base = '/', manuel = false, volume = MENU.son.volumeDefaut, audio = null } = {}) {
  const propre = !renderer;
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false; // compteurs d'une image entière (scène + passes), remis à zéro dans rendre()
  }
  const scene = new THREE.Scene();
  scene.name = 'menu';
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, MENU.camera.near, MENU.camera.far);
  camera.filmGauge = 35;
  camera.filmOffset = MENU.camera.decalage;
  // dans le jeu (audio = src/audio.js) : les sons passent par le moteur du jeu ; page de prototype : contexte à part
  const son = audio ? sonDuJeu(audio, SFX) : creerSon({ base, volume });
  // § E5 menu-sons : MENU.sonsUnites = false (demande de Femz du 17/11) — aucun son de la scène (pas, alarme, impact, tirs) :
  // seule la nappe reste. Lu à chaque appel (réglage vivant) ; rien n'est journalisé quand c'est coupé.
  const jouer = (id, k) => {
    if (MENU.sonsUnites !== false) son.jouer(id, k);
  };

  // secousse (trauma ² × bruit lissé) et temps du menu
  const T = new Float64Array(6); // 0 temps, 1 trauma, 2 prochaine alarme, 3 dernier dt
  T[2] = 1.2;
  const vise = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  const decor = await creerDecor({ scene, base });
  let effets = null;
  /** Événements du héros et des boss : sons, poussière, secousse. */
  function evenement(type, x, y, z, k) {
    const d = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
    const S = MENU.son;
    if (type === 'PAS') {
      const u = Math.min(1, Math.max(0, (d - 25) / 50));
      jouer('BOSS_STEP', S.pasProche + (S.pasLoin - S.pasProche) * u);
      T[1] = Math.min(1, T[1] + 0.32 * (1 - u * 0.6));
      if (effets) effets.bouffee(x, y, z, 12, k * 0.9);
    } else if (type === 'TOURELLE') jouer('BLASTER', S.tourelle);
    else if (type === 'RAIL') {
      jouer('RAIL', S.rail);
      T[1] = Math.min(1, T[1] + 0.22);
    } else if (type === 'IMPACT') {
      jouer('BOSS_SLAM', S.impact);
      T[1] = Math.min(1, T[1] + 0.42);
      if (effets) effets.bouffee(x, y, z, 22, 0.55);
    } else jouer(type, 0.42);
  }
  const heros = await creerHeros({ scene, base, solY: decor.solY, camera, evenement });
  const boss = await creerBoss({ scene, base, solY: decor.solY, heros: heros.base, evenement });
  effets = creerEffets({ scene, dirSoleil: decor.dirSoleil, solY: decor.solY });
  const post = creerPost(renderer);

  // ----- caméra : plan de la pose mêlé au précédent, dérive continue, secousse
  const D = MENU.camera.derive;
  const CYCLE = heros.CYCLE;
  const DUREE = heros.DUREE;
  function plan(t, out) {
    if (heros.clip || heros.banque || heros.cuit) {
      // capture de mouvement (MENU.clip) ou banque d'animations : un cadrage fixe, la dérive s'y ajoute (placerCamera) ;
      // mannequin de comparaison affiché : cadre élargi
      const C = MENU.clip.plan;
      const large = heros.banque && heros.banque.mannequin;
      out.az = C.azimutDeg;
      out.el = C.elevationDeg;
      out.dist = C.distance * (large ? 1.45 : 1);
      out.fov = C.fov;
      out.visee = C.visee;
      out.roulis = C.roulisDeg;
      return out;
    }
    let tb = t % DUREE;
    let ip = 0;
    while (tb >= CYCLE[ip]) {
      tb -= CYCLE[ip];
      ip++;
    }
    const B = POSES[ip].plan;
    const A = POSES[(ip + POSES.length - 1) % POSES.length].plan;
    const tr = (POSES[ip].transition || MENU.transition) * 1.15;
    const u = easeInOut(Math.min(1, tb / tr));
    out.az = A.azimutDeg + (B.azimutDeg - A.azimutDeg) * u;
    out.el = A.elevationDeg + (B.elevationDeg - A.elevationDeg) * u;
    out.dist = A.distance + (B.distance - A.distance) * u;
    out.fov = A.fov + (B.fov - A.fov) * u;
    out.visee = A.visee + (B.visee - A.visee) * u;
    out.roulis = A.roulisDeg + (B.roulisDeg - A.roulisDeg) * u;
    // poussée lente pendant le maintien (dolly avant de 4 %)
    const tm = Math.max(0, tb - tr);
    out.dist *= 1 - 0.04 * Math.min(1, tm / 3);
    return out;
  }
  const P = { az: 0, el: 0, dist: 6, fov: 40, visee: 1.3, roulis: 0 };
  function placerCamera(t, dt) {
    plan(t, P);
    const az = (P.az + D.orbiteDeg * Math.sin(TAU * D.orbiteHz * t)) * DEG + ORIENTATION;
    const el = P.el * DEG;
    const dist = P.dist * (1 + D.dolly * Math.sin(TAU * D.dollyHz * t + 1.3));
    const b = heros.base;
    vise.set(b[0], b[1] + P.visee + D.hauteur * Math.sin(TAU * D.hauteurHz * t), b[2]);
    camera.position.set(vise.x + dist * Math.sin(az) * Math.cos(el), vise.y + dist * Math.sin(el), vise.z + dist * Math.cos(az) * Math.cos(el));
    const sol = decor.solY(camera.position.x, camera.position.z) + 0.35;
    if (camera.position.y < sol) camera.position.y = sol;
    // secousse : trauma² × bruit lissé (sommes de sinus), décroissance exponentielle
    T[1] = Math.max(0, T[1] - MENU.camera.secousse.decroissance * dt * T[1] - 0.02 * dt);
    const k = T[1] * T[1];
    const f = MENU.camera.secousse.frequence;
    const A = MENU.camera.secousse.amplitude * k;
    camera.position.x += A * (Math.sin(t * f * 1.7) + 0.5 * Math.sin(t * f * 3.1 + 1));
    camera.position.y += A * (Math.sin(t * f * 2.3 + 2) + 0.5 * Math.sin(t * f * 4.1));
    camera.lookAt(vise);
    camera.rotateZ(P.roulis * DEG + MENU.camera.secousse.roulis * k * Math.sin(t * f * 2.7));
    if (camera.fov !== P.fov) {
      camera.fov = P.fov;
      camera.updateProjectionMatrix();
    }
  }

  // ----- taille
  let W = 0;
  let Hh = 0;
  let dpr = 1;
  // Renderer du jeu : le tampon de dessin est celui que render.applySize a réglé (taille de la fenêtre × densité du
  // niveau de qualité) ; le menu y cale ses cibles et le relit à chaque image (redimensionnement, changement de niveau).
  const tampon = new THREE.Vector2();
  const taille = new Int32Array(2); // tampon des cibles du menu (pixels)
  function redimensionner(w = window.innerWidth, h = window.innerHeight, ratio = window.devicePixelRatio || 1) {
    let bw;
    let bh;
    if (propre) {
      dpr = Math.min(ratio, MENU.pixelRatioMax);
      W = Math.max(1, w | 0);
      Hh = Math.max(1, h | 0);
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, Hh, false);
      bw = Math.round(W * dpr);
      bh = Math.round(Hh * dpr);
    } else {
      renderer.getDrawingBufferSize(tampon);
      bw = Math.max(1, tampon.x);
      bh = Math.max(1, tampon.y);
      dpr = renderer.getPixelRatio();
      W = bw / dpr;
      Hh = bh / dpr;
    }
    post.setSize(bw, bh);
    taille[0] = bw;
    taille[1] = bh;
    camera.aspect = W / Hh;
    camera.updateProjectionMatrix();
    effets.echelle(bh, camera.fov);
  }

  // ----- une image
  function avancer(dt) {
    T[0] += dt;
    T[3] = dt;
    const t = T[0];
    placerCamera(t, dt);
    camera.updateMatrixWorld(true);
    heros.update(dt);
    boss.update(dt, t);
    const V = MENU.vent;
    const vent = V.base + V.rafale * (0.5 + 0.5 * Math.sin(TAU * V.rafaleHz * t)) * (0.6 + 0.4 * Math.sin(TAU * V.rafaleHz2 * t + 0.7));
    heros.sync(dt, vent);
    effets.update(dt, t, vent);
    decor.update(t, camera, heros.base);
    // alarme lointaine, une fois par tour environ
    if (t >= T[2]) {
      T[2] = t + MENU.son.alarmePeriode;
      jouer('BOSS_ALARM', MENU.son.alarme);
    }
    son.update(t);
  }
  function rendre() {
    if (propre) renderer.info.reset();
    effets.echelle(Math.round(Hh * dpr), camera.fov);
    post.rendre(scene, camera);
  }
  function image(dt) {
    if (!propre) {
      renderer.getDrawingBufferSize(tampon);
      if (tampon.x !== taille[0] || tampon.y !== taille[1]) redimensionner();
    }
    avancer(dt);
    rendre();
  }

  // ----- boucle propre (plafonnée)
  let boucle = false;
  let avant = -1;
  const pasMin = 1000 / MENU.fpsMax - 2;
  function tic(now) {
    if (avant < 0) avant = now;
    const ms = now - avant;
    if (ms < pasMin) return;
    avant = now;
    image(Math.min(0.05, ms / 1000));
    stats.images++;
  }
  const stats = { images: 0 };
  function demarrer() {
    if (boucle || !propre || manuel) return;
    boucle = true;
    avant = -1;
    renderer.setAnimationLoop(tic);
  }
  function arreter() {
    boucle = false;
    if (propre) renderer.setAnimationLoop(null);
  }
  const surRedim = () => redimensionner();

  /**
   * Préchauffage (intégration, § Z octies) : une image rendue avec TOUT visible et sans élimination hors champ, au
   * premier affichage. Sans lui, chaque maillage était envoyé au GPU la première fois que la dérive de la caméra le
   * faisait entrer dans le champ (mesuré : 69 → 74 géométries du renderer sur le premier tour de 18,5 s, une petite
   * saccade à chaque fois, et des compteurs qui semblaient fuir d'un retour au titre à l'autre).
   */
  let prechauffe = false;
  function prechauffer() {
    if (prechauffe) return;
    prechauffe = true;
    const garde = [];
    scene.traverse((o) => {
      if (o.isLight || o.isCamera) return;
      garde.push(o, o.visible, o.frustumCulled);
      o.visible = true;
      o.frustumCulled = false;
    });
    post.rendre(scene, camera);
    for (let i = 0; i < garde.length; i += 3) {
      garde[i].visible = garde[i + 1];
      garde[i].frustumCulled = garde[i + 2];
    }
  }

  let visible = false;
  function afficher() {
    if (visible) return;
    visible = true;
    if (canvas) canvas.style.visibility = 'visible';
    redimensionner();
    prechauffer();
    if (propre) window.addEventListener('resize', surRedim);
    son.reprendre();
    demarrer();
  }
  function cacher() {
    if (!visible) return;
    visible = false;
    arreter();
    if (propre) window.removeEventListener('resize', surRedim);
    son.couper();
    post.vider(); // la mémoire lourde : cibles de rendu plein écran
    if (canvas) canvas.style.visibility = 'hidden';
  }
  function liberer() {
    cacher();
    heros.liberer();
    boss.liberer();
    effets.liberer();
    decor.liberer();
    post.liberer();
    son.liberer();
    if (propre) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }

  // ----- pilotage manuel (captures)
  function allerA(t) {
    T[0] = heros.allerA(t);
    boss.reset();
    // simule jusqu'à t (cape, flammes, boss) à 60 i/s
    while (T[0] < t - 1e-6) avancer(Math.min(1 / 60, t - T[0]));
  }

  heros.reset();
  redimensionner();
  return {
    scene,
    camera,
    renderer,
    son,
    heros,
    boss,
    decor,
    post,
    afficher,
    cacher,
    liberer,
    image,
    avancer,
    rendre,
    allerA,
    redimensionner,
    demarrer,
    arreter,
    stats,
    DUREE,
    poses: POSES.map((p, i) => ({ nom: p.nom, titre: p.titre, debut: CYCLE.slice(0, i).reduce((a, b) => a + b, 0), transition: p.transition || MENU.transition, maintien: p.maintien || MENU.maintien })),
    temps: () => T[0],
    etat: () => ({ t: T[0], pose: heros.etat.nom, u: heros.etat.u, trauma: T[1], visible, boucle, son: { pret: son.etat.pret, debloque: son.etat.debloque, actif: son.etat.actif, contexte: son.etat.ac ? son.etat.ac.state : 'aucun' } }),
  };
}
