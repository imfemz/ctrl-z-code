// VFX DES PROJECTILES « toon » — cinq lots instanciés, un programme (shader.js), aucune allocation par image (§ V).
//
//   lot          appels  écrit par                         contenu
//   TIRS           1     weapons.sync, chaque image        comètes (blaster), plombs (pompe), têtes de roquette
//   ENNEMIS        1     enemies.sync, chaque image        tirs des robots (dessinés après tout le reste : lisibles)
//   TRAINES        1     ce module (historique)            traînées des roquettes : flamme → fumée + étincelles
//   CONTINUS       1     weapons.sync, chaque image        disques, traînée circulaire des disques, aura et orbe EMP ;
//                                                          nappes corrosives et mines logiques (étape 2, § E2.B)
//   EVENEMENTS     1     impact(), rail(), arc(), explosion() — à la naissance seule : rayons du rail, arcs EMP,
//                        éclats d'étoile, explosions, ondes
// Soit 5 appels de dessin pour les 6 armes et les tirs ennemis (l'ancien rendu en faisait 7 : 5 maillages, l'anneau
// de l'EMP, les tirs ennemis). Chaque instance = 12 flottants (voir shader.js) ; l'appelant écrit en ligne dans
// tampon(lot) puis fixe compte[lot]. Les événements datés ne coûtent rien entre leur naissance et leur fin : le shader
// lit leur âge (uTemps − naissance), le CPU n'y touche plus.
// Horloge : H[0] = secondes SIMULÉES depuis la remise à zéro (identique à 60 et 240 Hz), avancée par main.js : du pas
// de simulation dans simulate (S1, avant tout update : un événement né pendant l'update a l'heure de son image), du
// pas réel pendant le game over (les effets en cours vont jusqu'au bout, comme fx). Figée en pause, en boutique et
// pendant un hitstop (le monde est figé). Remise à 0 par reset() (main.resetAll).
// Intégration (14/11/2026, ARCHITECTURE.md § Z septies) — le jeu écrit À LA SOURCE (le prototype tests/vfx/vfx.js
// relisait les matrices des anciens maillages, retirés) :
//   init(scene) : main.js, après world.init et avant les modules qui écrivent ; reset() : main.resetAll ;
//   weapons.sync   : tirs droits → TIRS (tête, cap, traînée = min(pTravel, VFX.comete/plomb.traine), f = pLinger /
//                    impactLinger) ; roquettes → TIRS + traineOuvrir (au tir) / traineAvancer (sync) / traineFermer
//                    (removeProjectile : un emplacement par roquette, échangé avec elle) ; disques, aura, orbe → CONTINUS ;
//   weapons (update) : impact figé → impact(), salve du rail → rail(), segment d'arc EMP → arc(), arrivée d'une
//                    roquette → explosion() ;
//   enemies.sync   : tirs ennemis → ENNEMIS ;  main (F11, après tous les sync, avant world.sync) : commit().
//   src/rendu/lumieres.js lit les lots (après commit) pour les taches de lumière au sol et les vraies lumières.
import * as THREE from 'three';
import { WEAPON } from '../config.js';
import { LISIBILITE_GUIDE } from '../config.js'; // § E5.P (B1) : effets alliés atténués autour du héros
import { P } from '../state.js'; // § E5.P (B1) : centre du héros, écrit dans uHeros à chaque commit
import { STYLE, VFX } from './reglages.js';
import { sources } from './shader.js';
import { lookDuChargement } from './look.js';

export const LOT = Object.freeze({ TIRS: 0, ENNEMIS: 1, TRAINES: 2, CONTINUS: 3, EVENEMENTS: 4 });
export const STRIDE = 12;
const NOMS = ['vfx-tirs', 'vfx-tirs-ennemis', 'vfx-traines', 'vfx-continus', 'vfx-evenements'];
const CAPS = [VFX.capacite.tirs, VFX.capacite.ennemis, VFX.capacite.segments, VFX.capacite.continus, VFX.capacite.evenements];
const ORDRES = [VFX.ordre.tirs, VFX.ordre.ennemis, VFX.ordre.traines, VFX.ordre.continus, VFX.ordre.evenements];

const meshes = [];
const tampons = [];
const buffers = [];
/** Instances de chaque lot (TIRS, ENNEMIS, CONTINUS : écrit par l'appelant avant commit). */
export const compte = new Int32Array(5);
/** 0 : horloge (s simulées) ; 1 : actif (1/0) ; 2 : coût CPU du dernier commit (ms, mesure) */
export const H = new Float64Array(4);
/** Arguments flottants d'evenement() et de traineAvancer() (jamais passés en arguments : § V). */
export const Q = new Float64Array(12);
/** § E5.F : âge de naissance (s) du prochain événement — une traînée de lame naît déjà avancée, pour être dessinée à
 *  l'image de l'impact (et pendant l'arrêt sur image) ; remis à 0 après chaque événement. */
export const AGE0 = new Float64Array(1);
let uTemps = null;
// look « pixel + deep glow » (src/vfx/look.js) : uniformes PARTAGÉS par les 5 maillages (un seul jeu de valeurs)
const uTempsPix = { value: 0.5 };
const uPix = { value: null };
const uPixS = { value: null };
const uPixG = { value: null };
const uTaille = { value: 1.5 }; // champ « double » (écrit à 1 par reglerLook)
//#region e5:P-lisibilite-guide
// § E5.P (B1) : centre du héros (partagé) ; atténuation autour de lui (alliés) — le lot des tirs ennemis a la sienne,
// toujours coupée (w = 0). Float32Array écrits en place à chaque commit : les champs d'un Vector4 de three (classe
// partagée par toute la scène) emballaient chaque flottant (20 o/image mesurés au premier jet).
const uHeros = { value: null };
/** § E5.P : centre du héros (x, hauteur, z), écrit à chaque commit ; lu aussi par les taches de lumière (rendu/lumieres.js)
 *  et la passe finale (halo du bloom). */
export const HEROS = new Float32Array(4);
/** § E5.P : taches de lumière et halo du bloom autour du héros — r0, r1 (m), part gardée, actif (écrit à chaque commit). */
export const AUTOUR_LUMIERE = new Float32Array([LISIBILITE_GUIDE.autour.r0, LISIBILITE_GUIDE.autour.r1, LISIBILITE_GUIDE.autour.partLumiere, 1]);
const uAutour = { value: null };
const uAutourEnnemis = { value: null };
//#endregion e5:P-lisibilite-guide
let pasPix = 0;
let evCurseur = 0;
let evMax = 0;
let evSale = false;
const naissance = new Float64Array(40).fill(-1e9); // dernière naissance de chaque style daté (mesures, captures)

// ----- Traînées des roquettes : historique de positions par emplacement stable -------------------------------------------
const TS = 32; // emplacements
const K = VFX.traine.points;
const tX = new Float32Array(TS * K);
const tY = new Float32Array(TS * K);
const tZ = new Float32Array(TS * K);
const tN = new Float32Array(TS * K); // naissance du point (horloge)
const tTete = new Int32Array(TS); // indice du point le plus récent dans l'anneau
const tNb = new Int32Array(TS); // points dans l'anneau
const tEtat = new Uint8Array(TS); // 0 libre, 1 en vol, 2 roquette partie (la fumée se dissipe)
const tHX = new Float32Array(TS); // position actuelle de la tête (en vol)
const tHY = new Float32Array(TS);
const tHZ = new Float32Array(TS);
const tGraine = new Float32Array(TS);
const tProchain = new Float64Array(TS); // instant (horloge) du prochain point : grille fixe, indépendante de la cadence
let tOuverts = 0;

export function init(scene) {
  uPix.value = new THREE.Vector4();
  uHeros.value = HEROS;
  uAutour.value = new Float32Array(4);
  // réglages fixes écrits une fois (lus au chargement) ; à chaque commit : la position du héros et le drapeau actif
  HEROS[1] = LISIBILITE_GUIDE.autour.centre;
  uAutour.value[0] = LISIBILITE_GUIDE.autour.r0;
  uAutour.value[1] = LISIBILITE_GUIDE.autour.r1;
  uAutour.value[2] = LISIBILITE_GUIDE.autour.partVfx;
  uAutourEnnemis.value = new Float32Array([0, 1, 1, 0]); // w = 0 : jamais atténué
  uPixS.value = new THREE.Vector4();
  uPixG.value = new THREE.Vector4();
  reglerLook(lookDuChargement());
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const src = sources(VFX);
  uTemps = { value: 0.5 }; // champ « double » dès la création : l'écrire chaque image n'alloue pas de nombre
  const mat = new THREE.ShaderMaterial({
    ...src,
    uniforms: { uTemps, uTempsPix, uPix, uPixS, uPixG, uTaille, uHeros, uAutour },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
    side: THREE.DoubleSide, // l'enroulement d'un ruban dépend de son cap : aucune face écartée
    forceSinglePass: true, // transparent + double face : une seule passe (sinon deux appels par lot)
  });
  for (let l = 0; l < 5; l++) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', g.attributes.position);
    geo.setIndex(g.index);
    const a = new Float32Array(CAPS[l] * STRIDE);
    const buf = new THREE.InstancedInterleavedBuffer(a, STRIDE, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    geo.instanceCount = 0;
    // une instance de matériau par maillage (§ V), le même programme (mêmes sources : compilé une fois)
    const m = new THREE.Mesh(geo, l === 0 ? mat : mat.clone());
    m.material.uniforms.uTemps = uTemps;
    m.material.uniforms.uTempsPix = uTempsPix;
    m.material.uniforms.uPix = uPix;
    m.material.uniforms.uPixS = uPixS;
    m.material.uniforms.uPixG = uPixG;
    m.material.uniforms.uTaille = uTaille;
    m.material.uniforms.uHeros = uHeros; // § E5.P (B1)
    m.material.uniforms.uAutour = l === LOT.ENNEMIS ? uAutourEnnemis : uAutour;
    // tirs ennemis : jamais cachés par un robot (le danger se lit par-dessus la horde, comme l'anneau du héros)
    if (l === LOT.ENNEMIS) m.material.depthTest = false;
    m.name = NOMS[l];
    m.frustumCulled = false;
    m.renderOrder = ORDRES[l];
    m.visible = false;
    m.matrixAutoUpdate = false;
    scene.add(m);
    meshes.push(m);
    tampons.push(a);
    buffers.push(buf);
  }
  H[1] = 1;
  return meshes;
}

export function tampon(lot) {
  return tampons[lot];
}

export function capacite(lot) {
  return CAPS[lot];
}

export function maillages() {
  return meshes;
}

/** Tout effacer (nouvelle partie) ; l'horloge repart de 0. */
export function reset() {
  H[0] = 0;
  for (let l = 0; l < 5; l++) compte[l] = 0;
  evCurseur = 0;
  evMax = 0;
  evSale = true;
  naissance.fill(-1e9);
  tEtat.fill(0);
  tNb.fill(0);
  tOuverts = 0;
}

export function setActif(on) {
  H[1] = on ? 1 : 0;
  for (let l = 0; l < 5; l++) meshes[l].visible = on && (l === LOT.EVENEMENTS ? evMax > 0 : compte[l] > 0);
}

/**
 * Événement daté, né à l'horloge courante. Q : 0-2 tête (x, y, z), 3 R, 4-6 direction unitaire, 7 L (m),
 * 8 graine (partie entière = indice de couleur pour les éclats), 9 marge (demi-largeur du quad, m).
 */
export function evenement(style) {
  const a = tampons[LOT.EVENEMENTS];
  const o = evCurseur * STRIDE;
  a[o] = Q[0];
  a[o + 1] = Q[1];
  a[o + 2] = Q[2];
  a[o + 3] = Q[3];
  a[o + 4] = Q[4];
  a[o + 5] = Q[5];
  a[o + 6] = Q[6];
  a[o + 7] = Q[7];
  a[o + 8] = style;
  a[o + 9] = Q[8];
  a[o + 10] = H[0] - AGE0[0];
  a[o + 11] = Q[9];
  AGE0[0] = 0;
  evCurseur++;
  if (evCurseur > evMax) evMax = evCurseur;
  if (evCurseur >= CAPS[LOT.EVENEMENTS]) evCurseur = 0; // anneau : le plus ancien (éteint depuis longtemps) est réécrit
  evSale = true;
  naissance[style] = H[0];
}

// ----- Événements du jeu (appelés par weapons.js à la naissance ; entrées dans Q, jamais en arguments flottants) -------
// Les marges des quads (× 2,6 + …) épousent les formes du shader : elles ne se règlent pas, elles suivent shader.js.
const G = new Float64Array(2); // graine : G[0] = entrée, G[1] = sortie dans [0, 1)
function alea() {
  const h = Math.sin(G[0] * 12.9898) * 43758.5453;
  G[1] = h - Math.floor(h);
}
const IN = new Float64Array(8); // copie des entrées (Q est réécrit pour chaque événement émis)

/** Impact d'un tir de l'arme w (blaster, pompe ; EMP = bout d'arc) : éclat d'étoile. Q : 0-2 point d'impact. */
export function impact(w) {
  const r = w === WEAPON.BLASTER ? VFX.etoile.blaster : w === WEAPON.SHOTGUN ? VFX.etoile.pompe : VFX.etoile.arc;
  G[0] = Q[0] * 3.1 + Q[2] * 1.7;
  alea();
  Q[3] = r;
  Q[4] = 0;
  Q[5] = 0;
  Q[6] = 1;
  Q[7] = 0;
  Q[8] = w + G[1] * 0.999;
  Q[9] = r * 2.6;
  evenement(STYLE.ETOILE);
}

/** Rayon du rail. Q : 0-2 départ (bouche), 3 largeur au départ (m), 4-6 direction unitaire, 7 longueur (m). + éclair de bouche. */
export function rail() {
  for (let i = 0; i < 8; i++) IN[i] = Q[i];
  G[0] = IN[0] * 1.7 + IN[2] * 3.1 + IN[4];
  alea();
  Q[0] = IN[0] + IN[4] * IN[7]; // tête = bout du rayon, le ruban s'étend vers l'arrière
  Q[1] = IN[1] + IN[5] * IN[7];
  Q[2] = IN[2] + IN[6] * IN[7];
  Q[3] = IN[3] * 0.5;
  Q[8] = G[1];
  Q[9] = Q[3] * 2.6 + 1.4;
  evenement(STYLE.RAIL);
  Q[0] = IN[0];
  Q[1] = IN[1];
  Q[2] = IN[2];
  Q[3] = VFX.etoile.flash;
  Q[7] = 0;
  Q[8] = WEAPON.RAIL + G[1] * 0.999;
  Q[9] = Q[3] * 2.6;
  evenement(STYLE.FLASH);
}

/** Segment d'arc de l'EMP. Q : 0-2 départ, 4-6 direction unitaire, 7 longueur (m). fin = 1 : bout de chaîne (le robot frappé) → éclat bleu. */
export function arc(fin) {
  for (let i = 0; i < 8; i++) IN[i] = Q[i];
  G[0] = IN[0] * 1.7 + IN[2] * 3.1 + IN[4];
  alea();
  Q[0] = IN[0] + IN[4] * IN[7];
  Q[1] = IN[1] + IN[5] * IN[7];
  Q[2] = IN[2] + IN[6] * IN[7];
  Q[3] = 0;
  Q[8] = G[1];
  Q[9] = (0.2 + IN[7] * 0.05) * 1.25 + 0.45;
  evenement(STYLE.ARC);
  if (fin === 1) impact(WEAPON.EMP);
}

/**
 * Explosion de roquette, ou d'une mine logique (étape 2, § E2.B : w = l'arme, sa couleur). Q : 0 x, 2 z, 3 rayon du
 * souffle (m). Éclat d'étoile en l'air + onde de choc au sol.
 */
export function explosion(w = WEAPON.ROCKETS) {
  const x = Q[0];
  const z = Q[2];
  const souffle = Q[3];
  const X = VFX.explosion;
  G[0] = x + z * 3.3;
  alea();
  Q[1] = X.hauteur;
  Q[3] = souffle * X.etoile;
  Q[4] = 0;
  Q[5] = 0;
  Q[6] = 1;
  Q[7] = 0;
  Q[8] = w + G[1] * 0.999;
  Q[9] = Q[3] * X.quadEtoile;
  evenement(STYLE.EXPLOSION);
  Q[0] = x;
  Q[1] = X.onde;
  Q[2] = z;
  Q[3] = souffle;
  Q[9] = souffle * X.quadOnde;
  evenement(STYLE.ONDE);
}

/** Événements écrits dans le lot (vivants ou éteints : l'âge se lit dans iC.z contre VFX_VIE) : borne de lecture. */
export function nombreEvenements() {
  return evMax;
}

/** Nouvelle traînée de roquette ; −1 si plus d'emplacement. graine : Q[0]. */
export function traineOuvrir() {
  for (let s = 0; s < TS; s++) {
    if (tEtat[s] !== 0) continue;
    tEtat[s] = 1;
    tNb[s] = 0;
    tTete[s] = K - 1;
    tGraine[s] = Q[0];
    tProchain[s] = -1;
    tOuverts++;
    return s;
  }
  return -1;
}

/** Position actuelle de la tête (Q : 0-2) ; un point d'historique tous les VFX.traine.pas s simulées. */
export function traineAvancer(s) {
  tHX[s] = Q[0];
  tHY[s] = Q[1];
  tHZ[s] = Q[2];
  const t = tTete[s];
  // Un point à chaque multiple de VFX.traine.pas (1/60 s) : à 60, 120 ou 240 Hz, les mêmes instants simulés.
  if (H[0] >= tProchain[s] - 1e-6) {
    const pas = VFX.traine.pas;
    tProchain[s] = (Math.floor(H[0] / pas + 1e-6) + 1) * pas;
    const n = t + 1 >= K ? 0 : t + 1;
    const o = s * K + n;
    tX[o] = Q[0];
    tY[o] = Q[1];
    tZ[o] = Q[2];
    tN[o] = H[0];
    tTete[s] = n;
    if (tNb[s] < K) tNb[s]++;
  }
}

/** La roquette a quitté le jeu : son dernier point est figé, la fumée se dissipe puis l'emplacement se libère. */
export function traineFermer(s) {
  if (tEtat[s] !== 1) return;
  const n = tTete[s] + 1 >= K ? 0 : tTete[s] + 1;
  const o = s * K + n;
  tX[o] = tHX[s];
  tY[o] = tHY[s];
  tZ[o] = tHZ[s];
  tN[o] = H[0];
  tTete[s] = n;
  if (tNb[s] < K) tNb[s]++;
  tEtat[s] = 2;
}

function ecrireTraines() {
  const a = tampons[LOT.TRAINES];
  const cap = CAPS[LOT.TRAINES];
  const vie = VFX.traine.fumee;
  const marge = VFX.traine.largeur;
  const now = H[0];
  let n = 0;
  for (let s = 0; s < TS; s++) {
    const etat = tEtat[s];
    if (etat === 0) continue;
    let i = tTete[s];
    // dernière naissance plus vieille que la fumée : emplacement libéré
    if (etat === 2 && now - tN[s * K + i] > vie) {
      tEtat[s] = 0;
      tOuverts--;
      continue;
    }
    // point avant du premier segment : la tête en vol, sinon le dernier point figé
    let fx = etat === 1 ? tHX[s] : tX[s * K + i];
    let fy = etat === 1 ? tHY[s] : tY[s * K + i];
    let fz = etat === 1 ? tHZ[s] : tZ[s * K + i];
    let fn = etat === 1 ? now : tN[s * K + i];
    let k = etat === 1 ? 0 : 1;
    if (k === 1) i = i - 1 < 0 ? K - 1 : i - 1;
    for (; k < tNb[s] && n < cap; k++) {
      const o = s * K + i;
      const bn = tN[o];
      if (now - fn > vie) break;
      const dx = fx - tX[o];
      const dy = fy - tY[o];
      const dz = fz - tZ[o];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 1e-4) {
        const w = n * STRIDE;
        const inv = 1 / len;
        a[w] = fx;
        a[w + 1] = fy;
        a[w + 2] = fz;
        a[w + 3] = bn; // naissance du point arrière
        a[w + 4] = dx * inv;
        a[w + 5] = dy * inv;
        a[w + 6] = dz * inv;
        a[w + 7] = len;
        a[w + 8] = STYLE.TRAINE;
        a[w + 9] = tGraine[s];
        a[w + 10] = fn; // naissance du point avant
        a[w + 11] = marge;
        n++;
      }
      fx = tX[o];
      fy = tY[o];
      fz = tZ[o];
      fn = bn;
      i = i - 1 < 0 ? K - 1 : i - 1;
    }
  }
  compte[LOT.TRAINES] = n;
}

/** Une fois par image, après les écritures de l'appelant : horloge, comptes, envoi des tampons. */
export function commit() {
  uTemps.value = H[0];
  //#region e5:P-lisibilite-guide
  HEROS[0] = P.x;
  HEROS[2] = P.z;
  uAutour.value[3] = LISIBILITE_GUIDE.autour.actif ? 1 : 0;
  AUTOUR_LUMIERE[3] = uAutour.value[3];
  //#endregion e5:P-lisibilite-guide
  uTempsPix.value = pasPix > 0 ? Math.floor(H[0] / pasPix) * pasPix : H[0];
  ecrireTraines();
  const actif = H[1] === 1;
  for (let l = 0; l < 5; l++) {
    const m = meshes[l];
    if (l === LOT.EVENEMENTS) {
      m.geometry.instanceCount = evMax;
      if (evSale) {
        buffers[l].needsUpdate = true;
        evSale = false;
      }
      m.visible = actif && evMax > 0;
      continue;
    }
    const n = compte[l];
    m.geometry.instanceCount = n;
    m.visible = actif && n > 0;
    if (n > 0) buffers[l].needsUpdate = true;
  }
}

/**
 * Look des VFX (17/11, src/vfx/look.js) : { pixel, pas, taille, tons: { seuils[3], gains[3], blanc, alpha[2] } } ; null = rendu
 * d'avant. Uniformes seulement (rien n'est recompilé). Rend les réglages appliqués.
 */
export function reglerLook(o) {
  const v = o || {};
  const t = v.tons || null;
  pasPix = v.pas || 0;
  uTaille.value = v.taille || 1;
  uPix.value.set(v.pixel || 0, t ? 1 : 0, pasPix, t ? t.blanc : 0);
  if (t) {
    uPixS.value.set(t.seuils[0], t.seuils[1], t.seuils[2], t.alpha[0]);
    uPixG.value.set(t.gains[0], t.gains[1], t.gains[2], t.alpha[1]);
  }
  uTempsPix.value = pasPix > 0 ? Math.floor(H[0] / pasPix) * pasPix : H[0];
  return { pixel: uPix.value.x, tons: !!t, pas: pasPix, taille: uTaille.value };
}

export function inspect(out) {
  out.tirs = compte[LOT.TIRS];
  out.ennemis = compte[LOT.ENNEMIS];
  out.segments = compte[LOT.TRAINES];
  out.continus = compte[LOT.CONTINUS];
  out.evenements = evMax;
  out.traines = tOuverts;
  out.horloge = H[0];
  out.ageDernier = {};
  for (let st = 0; st < 40; st++) if (naissance[st] > -1e8) out.ageDernier[st] = H[0] - naissance[st];
}
