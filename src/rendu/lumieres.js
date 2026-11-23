// RENDU « PEINT » — lumière émise (passe 4) : taches de lumière au sol + quelques vraies lumières ponctuelles.
//
// TACHES : un seul InstancedMesh, un carré posé au sol par source, dont le fragment dessine une flaque douce
// (cloche (1 − d²)²) de la couleur de la source. Mélange dst × (1 + src) : la lumière s'AJOUTE en épousant la couleur
// du sol (une flaque rouge sur le sable ocre est rouge orangé, pas un disque rose collé dessus), et se mêle à l'ambiant.
// Testée en profondeur (un robot devant la cache), sans écriture de profondeur. Un appel de dessin pour toutes.
// Sources, lues chaque image sans rien allouer (§ V) :
//   yeux des robots (E, couleur d'œil du type, petites et faibles), héros (flaque cyan), butin, étincelles, anneaux de fx
//   (explosions des robots et du boss, soin, dash : la tache suit leur rayon et s'éteint avec leur couleur), zones
//   télégraphiées du boss, flammes de ses cheminées en phase 2 (vacillent) ;
//   PROJECTILES (étape « vfx », § Z septies) : lus dans les LOTS de src/vfx/projectiles.js, après son commit — comètes,
//   plombs et têtes de roquette (TIRS, × f d'extinction), tirs des robots (ENNEMIS), disques (CONTINUS), rayons du rail
//   et segments d'arc à leur départ, ondes des explosions de roquette (ÉVÉNEMENTS vivants : la tache suit le rayon de
//   l'onde et s'éteint avec elle, et devient candidate à une vraie lumière). Couleur : VFX_COULEURS.bord de l'arme.
//   Les maillages sources sont trouvés par leur nom à l'init (contrat des modules : ARCHITECTURE.md § G.3) ; leurs
//   matrices d'instance (et couleurs d'instance) sont celles que leurs sync viennent d'écrire.
// VRAIES LUMIÈRES : `nombre` lumières ponctuelles en COORDONNÉES DU MONDE (texture uSrPtTex de materiaux.js ; intégration —
// au prototype, des PointLight de three) — couleur nulle au repos : aucun programme
// recompilé), données à chaque image aux sources les plus fortes (explosions, flammes du boss) : elles éclairent les
// côtés des robots et du décor (matériau peint : boucle des lumières ponctuelles, materiaux.js).
// Contrat d'intégration : init(scene) après la création des maillages des modules ; sync() en F11, après tous les sync.
import * as THREE from 'three';
import { ENEMIES, PALETTE, PICKUPS, PLAYER, VFX_COULEURS, VFX_ROBOTS, VFX_STYLE, VFX_VIE, WEAPON } from '../config.js';
import { GROS_BUTIN } from '../config.js'; // § E4.K : tache des gros butins, au rayon de leur échelle
import { SAUVEGARDE_BOSS } from '../config.js'; // § E4.Q : flaque violette sous la disquette
import { LISIBILITE_GUIDE } from '../config.js'; // § E5.P (B1) : lumière des effets alliés atténuée autour du héros
//#region e5:AH-virus-gaz
import { VIRUS_GAZ } from '../config.js';
const GAZ_STYLE = VIRUS_GAZ.style; // § E5.AH : bouffées de gaz du Virus (lot TIRS) — aucune tache de lumière
//#endregion e5:AH-virus-gaz
import { E, P } from '../state.js';
import * as V from '../vfx/projectiles.js';
import { PEINT } from './reglages.js';
import { uniformsPeints } from './materiaux.js';
import { envoyer } from './envois.js';

const T = PEINT.taches;
const L = PEINT.lumieres;
let mesh = null;
let mat = null;
let col = null;
let cap = 0;
const lin = (hex) => new THREE.Color(hex);
const typeCoul = new Float32Array(ENEMIES.types.length * 3);
const H = new Float64Array(4); // 0 horloge (s), 1 gain des taches, 2 gain des lumières, 3 actif (1/0)
H[1] = 1;
H[2] = 1;
H[3] = 1;

// sources « maillage » : nom, couleur fixe (si pas de couleur d'instance), rayon, intensité, rayon × échelle ?
const SOURCES = [
  ['gemmes-0', PICKUPS.gemTiers[0].color, T.butin, false],
  ['gemmes-1', PICKUPS.gemTiers[1].color, T.butin, false],
  ['gemmes-2', PICKUPS.gemTiers[2].color, T.butin, false],
  ['fragments', PICKUPS.fragment.color, T.butin, false],
  ['etincelles', null, T.etincelles, false],
  ['anneaux', null, T.explosions, true],
  ['boss-zones', null, T.zones, true],
  // § E4.J : balles et obus des robots à canon, ancien visuel (src/tirs-canon.js) — même source qu'avant le 14/11
  ['tirs-ennemis', PALETTE.enemyShot, T.tirsEnnemis, false],
  // § E4.Q : disquette (Sauvegarde lâchée par un boss) — flaque violette, au rayon de son échelle dessinée (elle pulse)
  ['disquettes', SAUVEGARDE_BOSS.couleur, SAUVEGARDE_BOSS.tache, true],
];
const srcMesh = [];
const srcCoul = new Float32Array(SOURCES.length * 3);
const srcR = new Float32Array(SOURCES.length);
const srcI = new Float32Array(SOURCES.length);
const srcEchelle = new Uint8Array(SOURCES.length);
const S_ANNEAUX = 5; // indice de 'anneaux' dans SOURCES
const S_ETINCELLES = 4; // indice de 'etincelles' dans SOURCES (§ E5.P)
// § E4.K.2 : butin (sources 0 à 3) — échelle de référence du palier ; au-delà (gros butin), la tache grandit avec
// l'échelle dessinée (lue dans la matrice : élément 5), jusqu'à × GROS_BUTIN.tacheMax ; elle respire avec son pouls
const srcRef = new Float32Array(SOURCES.length);
for (let k = 0; k < PICKUPS.gemTiers.length; k++) srcRef[k] = PICKUPS.gemTiers[k].scale;
srcRef[PICKUPS.gemTiers.length] = PICKUPS.fragment.scale;
const TACHE_MAX = GROS_BUTIN.tacheMax;
let boss = null;
let bossChaud = null;
const flamme = lin(T.flammes.couleur);
const heros = lin(PALETTE.playerAccent);

// Lots VFX (§ Z septies) : couleur « bord » (linéaire) par style lu, et réglages de tache
const BORD = VFX_COULEURS.bord;
const ST = VFX_STYLE;
const VIE_RAIL = VFX_VIE[ST.RAIL];
const VIE_ARC = VFX_VIE[ST.ARC];
const VIE_ONDE = VFX_VIE[ST.ONDE];
const VIE_CROISSANT = VFX_VIE[ST.CROISSANT];

// lumières ponctuelles : candidates de l'image (x, z, r, v, b, intensité), puis les plus fortes
const NC = 64;
const cand = new Float32Array(NC * 6);
let nCand = 0;
const lumieres = [];
const prise = new Uint8Array(NC);

// § E5.P (B1, Femz 21/11) : une tache d'effet ALLIÉ (étincelles, explosions, tirs et disques du joueur) porte un drapeau
// dans la 4e ligne de sa matrice d'instance (élément [0][3], toujours 0 pour une matrice affine : remis à 0 avant usage) ;
// le fragment est alors atténué au sol près des pieds du héros (r0, r1, part de VFX.AUTOUR_LUMIERE ; actif = w). Les
// yeux des robots, les tirs ennemis, les zones du boss, le héros, le butin ne portent pas le drapeau.
const VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vCoul; varying vec2 vSol; varying float vAllie;
void main() {
  vUv = uv; vCoul = instanceColor;
  mat4 im = instanceMatrix;
  vAllie = im[0][3];
  im[0][3] = 0.0;
  vec4 w = modelMatrix * im * vec4( position, 1.0 );
  vSol = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */ `
uniform vec4 uHerosL; uniform vec4 uAutourL;
varying vec2 vUv; varying vec3 vCoul; varying vec2 vSol; varying float vAllie;
void main() {
  float d = length( vUv * 2.0 - 1.0 );
  float a = clamp( 1.0 - d * d, 0.0, 1.0 );
  float k = 1.0;
  if ( vAllie > 0.5 && uAutourL.w > 0.5 )
    k = mix( uAutourL.z, 1.0, clamp( ( length( vSol - uHerosL.xz ) - uAutourL.x ) / max( uAutourL.y - uAutourL.x, 1e-3 ), 0.0, 1.0 ) );
  gl_FragColor = vec4( vCoul * a * a * k, 1.0 );
}`;
// drapeau « allié » de la prochaine tache posée (poserL) et de la prochaine vraie lumière candidate (candidatL)
const ALLIE = new Uint8Array(1);
// sources « maillage » alliées (indices de SOURCES) : étincelles et anneaux d'explosion
const LUM_R0 = LISIBILITE_GUIDE.autour.r0;
const LUM_R1 = LISIBILITE_GUIDE.autour.r1;
const LUM_INV = 1 / (LUM_R1 - LUM_R0);
const LUM_PART = LISIBILITE_GUIDE.autour.partLumiere;

const PT = uniformsPeints.uSrPtTex.value; // texture des lumières (materiaux.js) : colonne k, ligne 0 = position, 1 = couleur
const PD = PT.image.data;
const NL = PT.image.width;
let ptChange = 0; // une valeur a changé cette image : texture renvoyée une fois
/** Écrit la lumière k (position au sol x, z ; couleur × intensité). Appelée ≤ nombre fois par image. */
function ecrireLumiere(k, x, z, r, g, b) {
  L8[0] = x;
  L8[1] = z;
  L8[3] = r;
  L8[4] = g;
  L8[5] = b;
  ecrireLumiereL(k);
}
/** ecrireLumiere sans flottant en argument : position L8[0], L8[1], couleur L8[3..5]. */
function ecrireLumiereL(k) {
  const x = L8[0];
  const z = L8[1];
  const r = L8[3];
  const g = L8[4];
  const b = L8[5];
  const o = k * 4;
  const c = (NL + k) * 4;
  if (PD[o] === x && PD[o + 2] === z && PD[c] === r && PD[c + 1] === g && PD[c + 2] === b) return;
  PD[o] = x;
  PD[o + 1] = x === 0 && z === 0 && r === 0 && g === 0 && b === 0 ? -50 : L.hauteur;
  PD[o + 2] = z;
  PD[c] = r;
  PD[c + 1] = g;
  PD[c + 2] = b;
  ptChange = 1;
}
const actives = new Uint8Array(8);

export function init(scene) {
  cap = T.capacite;
  const g = new THREE.PlaneGeometry(2, 2);
  g.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: { uHerosL: { value: V.HEROS }, uAutourL: { value: V.AUTOUR_LUMIERE } }, // § E5.P (B1)
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor, // dst × src + dst : la lumière prend la couleur du sol
    blendDst: THREE.OneFactor,
  });
  mesh = new THREE.InstancedMesh(g, material, cap);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.name = 'taches-lumiere';
  mesh.frustumCulled = false;
  mesh.renderOrder = 0.5; // après les ombres de contact (0), avant les zones du boss (1)
  mesh.count = 0;
  mat = mesh.instanceMatrix.array;
  col = mesh.instanceColor.array;
  for (let t = 0; t < ENEMIES.types.length; t++) {
    const c = lin(ENEMIES.types[t].eyeColor || PALETTE.robotEye);
    typeCoul[t * 3] = c.r;
    typeCoul[t * 3 + 1] = c.g;
    typeCoul[t * 3 + 2] = c.b;
  }
  for (let s = 0; s < SOURCES.length; s++) {
    const [nom, hex, R, echelle] = SOURCES[s];
    srcMesh.push(scene.getObjectByName(nom) || null);
    const c = hex === null ? new THREE.Color(1, 1, 1) : lin(hex);
    srcCoul[s * 3] = c.r;
    srcCoul[s * 3 + 1] = c.g;
    srcCoul[s * 3 + 2] = c.b;
    srcR[s] = R.rayon;
    srcI[s] = R.intensite;
    srcEchelle[s] = echelle ? 1 : 0;
  }
  boss = scene.getObjectByName('boss') || null;
  bossChaud = scene.getObjectByName('boss-phase-2') || null;
  // vraies lumières : texture partagée par tous les matériaux peints (materiaux.js, uSrPtTex)
  for (let k = 0; k < L.nombre; k++) lumieres.push(k);
  scene.add(mesh);
  return mesh;
}

/** Gains (option crépuscule) et activation (passe 3 ↔ passe 4 dans le prototype). */
export function regler(gainTaches, gainLumieres, actif) {
  H[1] = gainTaches;
  H[2] = gainLumieres;
  H[3] = actif ? 1 : 0;
  mesh.visible = actif;
  if (!actif)
    for (let k = 0; k < lumieres.length; k++) {
      ecrireLumiere(k, 0, 0, 0, 0, 0);
      actives[k] = 0;
    }
  if (ptChange !== 0) {
    envoyer(PT); // texSubImage2D direct (envois.js, § Z nonies)
    ptChange = 0;
  }
}

let k = 0; // curseur d'instance de l'image (entier)

/** Une fois par image, après tous les sync. */
export function sync() {
  if (H[3] === 0) return;
  H[0] += 1 / 60; // horloge visuelle (vacillement), une image = 1/60 s
  const g = H[1];
  k = 0;
  nCand = 0;
  // 1. yeux des robots (en ligne, sans appel par robot)
  const X = E.x, Z = E.z, A = E.alive, TY = E.type, n = E.count;
  const ry = T.yeux.rayon, iy = T.yeux.intensite * g, y = T.y;
  const SU = E.sus;
  for (let i = 0; i < n && k < cap; i++) {
    if (A[i] === 0 || SU[i] !== 0) continue; // § E4.F : en repli, yeux éteints ; garé, rien
    const o = k * 16;
    mat[o] = ry; mat[o + 1] = 0; mat[o + 2] = 0; mat[o + 3] = 0; mat[o + 4] = 0; mat[o + 5] = 1; mat[o + 6] = 0; mat[o + 7] = 0;
    mat[o + 8] = 0; mat[o + 9] = 0; mat[o + 10] = ry; mat[o + 11] = 0; mat[o + 12] = X[i]; mat[o + 13] = y; mat[o + 14] = Z[i]; mat[o + 15] = 1;
    const c = k * 3, t = TY[i] * 3;
    col[c] = typeCoul[t] * iy; col[c + 1] = typeCoul[t + 1] * iy; col[c + 2] = typeCoul[t + 2] * iy;
    k++;
  }
  // 2. héros : flaque cyan (lisibilité)
  if (P.alive) {
    L8[0] = P.x;
    L8[1] = P.z;
    L8[2] = T.heros.rayon * (PLAYER.visualScale || 1);
    L8[3] = heros.r;
    L8[4] = heros.g;
    L8[5] = heros.b;
    L8[6] = T.heros.intensite * g;
    poserL();
  }
  // 3. maillages sources
  for (let s = 0; s < srcMesh.length; s++) {
    const m = srcMesh[s];
    if (m === null || !m.visible || m.count === 0) continue;
    const a = m.instanceMatrix.array;
    const ic = m.instanceColor !== null ? m.instanceColor.array : null;
    const r0 = srcR[s], i0 = srcI[s] * g;
    ALLIE[0] = s === S_ETINCELLES || s === S_ANNEAUX ? 1 : 0; // § E5.P (B1)
    for (let q = 0; q < m.count && k < cap; q++) {
      const o = q * 16;
      const sx = srcEchelle[s] === 1 ? Math.sqrt(a[o] * a[o] + a[o + 2] * a[o + 2]) : 1;
      let cr = srcCoul[s * 3], cg = srcCoul[s * 3 + 1], cb = srcCoul[s * 3 + 2];
      if (ic !== null) {
        cr *= ic[q * 3];
        cg *= ic[q * 3 + 1];
        cb *= ic[q * 3 + 2];
      }
      let ii = i0;
      // entrées de poserL / candidatL dans L8 (aucun flottant passé en argument, § V)
      L8[0] = a[o + 12];
      L8[1] = a[o + 14];
      L8[3] = cr;
      L8[4] = cg;
      L8[5] = cb;
      if (s === S_ANNEAUX) {
        // anneaux : explosion (vraie lumière) ou aura centrée sur le héros (EMP, soin, dash : faible, pas de lumière)
        const dx = a[o + 12] - P.x, dz = a[o + 14] - P.z;
        if (dx * dx + dz * dz < 2.25) ii *= T.explosions.autourDuHeros;
        else {
          L8[6] = i0 * sx;
          candidatL();
        }
      }
      let rr = r0 * sx;
      if (srcRef[s] > 0) {
        const f = a[o + 5] / srcRef[s];
        if (f > 1) rr = r0 * (f < TACHE_MAX ? f : TACHE_MAX);
      }
      L8[2] = rr;
      L8[6] = ii;
      poserL();
    }
  }
  ALLIE[0] = 0;
  // 3 bis. projectiles : lots de src/vfx (écrits par weapons.sync et enemies.sync, envoyés par V.commit juste avant)
  lireLots();
  // 4. flammes des cheminées du boss (phase 2) : deux flaques qui vacillent, et deux vraies lumières
  if (boss !== null && boss.visible && bossChaud !== null && bossChaud.visible) {
    // .matrix (écrite en ligne par boss.sync, matrixAutoUpdate = false) : matrixWorld n'est recalculée qu'au rendu
    const e = boss.matrix.elements;
    for (let c = -1; c <= 1; c += 2) {
      // cheminées : dos du boss (−Z local), de part et d'autre
      const lx = c * 0.9, lz = -1.1;
      const x = e[12] + e[0] * lx + e[8] * lz;
      const z = e[14] + e[2] * lx + e[10] * lz;
      const v = 0.78 + 0.14 * Math.sin(H[0] * 13.1 + c) + 0.08 * Math.sin(H[0] * 29.7 + 2 * c);
      L8[0] = x;
      L8[1] = z;
      L8[2] = T.flammes.rayon * v;
      L8[3] = flamme.r;
      L8[4] = flamme.g;
      L8[5] = flamme.b;
      L8[6] = T.flammes.intensite * v * g;
      poserL();
      L8[6] = T.flammes.intensite * v * 1.5;
      candidatL();
    }
  }
  mesh.count = k;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  // 5. vraies lumières : les plus fortes candidates (sélection simple, N passes sur ≤ 64)
  for (let c = 0; c < nCand; c++) prise[c] = 0;
  for (let l = 0; l < lumieres.length; l++) {
    let best = -1, bi = 0;
    for (let c = 0; c < nCand; c++) {
      if (prise[c] === 1) continue;
      const v = cand[c * 6 + 5];
      if (v > bi) {
        bi = v;
        best = c;
      }
    }
    if (best < 0 || bi < 0.05) {
      // au repos : couleur nulle, position inchangée — l'uniforme ne change pas, three ne le renvoie pas
      if (actives[l] !== 0) ecrireLumiere(l, 0, 0, 0, 0, 0); // position gardée à 0 : rien ne change au repos
      actives[l] = 0;
      continue;
    }
    prise[best] = 1;
    const o = best * 6;
    const g = bi * L.gain * H[2];
    L8[0] = cand[o];
    L8[1] = cand[o + 1];
    L8[3] = cand[o + 2] * g;
    L8[4] = cand[o + 3] * g;
    L8[5] = cand[o + 4] * g;
    ecrireLumiereL(l);
    actives[l] = 1;
  }
  if (ptChange !== 0) {
    envoyer(PT); // texSubImage2D direct (envois.js, § Z nonies)
    ptChange = 0;
  }
}

// Arguments flottants de lireLots → poserL / candidatL : dans un tableau typé, jamais en arguments (une fonction non
// mise en ligne emballe chaque flottant calculé qu'on lui passe : 3,6 Ko par image mesurés en charge maximale, § V).
// 0 x, 1 z, 2 rayon, 3-5 couleur, 6 intensité
const L8 = new Float64Array(7);
function poserL() {
  if (k >= cap) return;
  const o = k * 16;
  const r = L8[2];
  mat[o] = r; mat[o + 1] = 0; mat[o + 2] = 0; mat[o + 3] = ALLIE[0]; // § E5.P : drapeau « allié » (voir FRAG)
  mat[o + 4] = 0; mat[o + 5] = 1; mat[o + 6] = 0; mat[o + 7] = 0;
  mat[o + 8] = 0; mat[o + 9] = 0; mat[o + 10] = r; mat[o + 11] = 0;
  mat[o + 12] = L8[0]; mat[o + 13] = T.y; mat[o + 14] = L8[1]; mat[o + 15] = 1;
  const c = k * 3;
  const i = L8[6];
  col[c] = L8[3] * i;
  col[c + 1] = L8[4] * i;
  col[c + 2] = L8[5] * i;
  k++;
}
function candidatL() {
  if (nCand >= NC) return;
  const o = nCand * 6;
  cand[o] = L8[0]; cand[o + 1] = L8[1]; cand[o + 2] = L8[3]; cand[o + 3] = L8[4]; cand[o + 4] = L8[5]; cand[o + 5] = L8[6];
  if (ALLIE[0] === 1 && V.AUTOUR_LUMIERE[3] === 1) {
    // § E5.P (B1) : vraie lumière d'une explosion alliée près du héros, atténuée comme sa tache (distance au sol)
    const dx = L8[0] - P.x;
    const dz = L8[1] - P.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < LUM_R1) cand[o + 5] = L8[6] * (d <= LUM_R0 ? LUM_PART : LUM_PART + (1 - LUM_PART) * (d - LUM_R0) * LUM_INV);
  }
  nCand++;
}
function couleurL(c) {
  L8[3] = c[0];
  L8[4] = c[1];
  L8[5] = c[2];
}

/** Taches des projectiles, lues dans les lots VFX (aucune allocation : boucles sur les tampons, entrées dans L8, § V). */
function lireLots() {
  const g = H[1];
  // TIRS : comètes (blaster), plombs (pompe), têtes de roquette ; × f (un tir figé sur un impact s'éteint)
  ALLIE[0] = 1; // § E5.P (B1) : tirs du joueur
  let a = V.tampon(V.LOT.TIRS);
  let n = V.compte[V.LOT.TIRS];
  for (let q = 0; q < n && k < cap; q++) {
    const o = q * 12;
    const st = a[o + 8];
    if (st === ST.ECLAT) continue; // § E5.Y : les fragments des Éclats n'éclairent pas le sol (métal, pas de lueur)
    if (st === GAZ_STYLE) continue; // § E5.AH : le gaz du Virus n'éclaire pas le sol
    // style RICOCHET (ricochet, tirs des sentinelles, § E2.A) : l'arme est la partie entière de la graine
    // boomerang et flacon de la nappe (§ E2.B) : la couleur de leur arme
    const w = st === ST.COMETE ? WEAPON.BLASTER : st === ST.PLOMB ? WEAPON.SHOTGUN : st === ST.RICOCHET ? Math.floor(a[o + 9]) : st === ST.BOOMERANG ? WEAPON.BOOMERANG : st === ST.FLACON ? WEAPON.POOL : WEAPON.ROCKETS;
    const R = st === ST.ROQUETTE ? T.roquettes : T.projectiles;
    L8[0] = a[o];
    L8[1] = a[o + 2];
    L8[2] = R.rayon;
    couleurL(BORD[w]);
    L8[6] = R.intensite * a[o + 10] * g;
    poserL();
  }
  // ENNEMIS : rayons des scanners (§ E4.J : les balles et les obus sont lus dans le maillage « tirs-ennemis », SOURCES)
  ALLIE[0] = 0; // rayons des scanners : un danger, jamais atténué
  a = V.tampon(V.LOT.ENNEMIS);
  n = V.compte[V.LOT.ENNEMIS];
  for (let q = 0; q < n && k < cap; q++) {
    const o = q * 12;
    L8[0] = a[o];
    L8[1] = a[o + 2];
    L8[2] = T.tirsEnnemis.rayon;
    couleurL(BORD[VFX_ROBOTS]);
    L8[6] = T.tirsEnnemis.intensite * g;
    poserL();
  }
  // CONTINUS : disques seulement (aura, orbe et traînée circulaire n'en posent pas, comme l'ancien anneau de l'EMP)
  ALLIE[0] = 1; // disques, puis événements des armes du joueur
  a = V.tampon(V.LOT.CONTINUS);
  n = V.compte[V.LOT.CONTINUS];
  for (let q = 0; q < n && k < cap; q++) {
    const o = q * 12;
    if (a[o + 8] !== ST.DISQUE) continue;
    L8[0] = a[o];
    L8[1] = a[o + 2];
    L8[2] = T.disques.rayon;
    couleurL(BORD[WEAPON.ORBITALS]);
    L8[6] = T.disques.intensite * g;
    poserL();
  }
  // ÉVÉNEMENTS vivants : rayon du rail et segment d'arc (tache au départ, s'éteint avec lui), onde d'explosion (suit son
  // rayon, s'éteint avec elle, candidate à une vraie lumière). Âge = horloge − naissance (iC.z), contre VFX_VIE.
  a = V.tampon(V.LOT.EVENEMENTS);
  n = V.nombreEvenements();
  const now = V.H[0];
  for (let q = 0; q < n && k < cap; q++) {
    const o = q * 12;
    const st = a[o + 8];
    const age = now - a[o + 10];
    if (age < 0) continue;
    if (st === ST.RAIL || st === ST.ARC) {
      const vie = st === ST.RAIL ? VIE_RAIL : VIE_ARC;
      if (age > vie) continue;
      const L = a[o + 7]; // départ = tête − direction × longueur
      L8[0] = a[o] - a[o + 4] * L;
      L8[1] = a[o + 2] - a[o + 6] * L;
      L8[2] = T.rayons.rayon;
      couleurL(BORD[st === ST.RAIL ? WEAPON.RAIL : WEAPON.EMP]);
      L8[6] = T.rayons.intensite * (1 - age / vie) * g;
      poserL();
    } else if (st === ST.CROISSANT) {
      // balayage de la lame de phase (§ E2.A) : tache au milieu de l'arc, qui s'éteint avec le croissant
      if (age > VIE_CROISSANT) continue;
      L8[0] = a[o] + a[o + 4] * a[o + 3] * 0.6;
      L8[1] = a[o + 2] + a[o + 6] * a[o + 3] * 0.6;
      L8[2] = T.rayons.rayon;
      couleurL(BORD[WEAPON.BLADE]);
      L8[6] = T.rayons.intensite * (1 - age / VIE_CROISSANT) * g;
      poserL();
    } else if (st === ST.ONDE) {
      if (age > VIE_ONDE) continue;
      const u = 1 - age / VIE_ONDE;
      const rad = a[o + 3] * (1 - u * u * u); // même rayon que l'onde dessinée (shader.js, onde())
      L8[0] = a[o];
      L8[1] = a[o + 2];
      L8[2] = T.explosions.rayon * rad;
      const f = u * Math.sqrt(u); // l'onde s'éteint (en ligne : pas de flottant passé en argument)
      const cr = BORD[Math.floor(a[o + 9])]; // couleur de l'arme (partie entière de la graine : roquettes, mines logiques § E2.B)
      L8[3] = cr[0] * f;
      L8[4] = cr[1] * f;
      L8[5] = cr[2] * f;
      L8[6] = T.explosions.intensite * g;
      poserL();
      L8[6] = T.explosions.intensite * rad;
      candidatL();
    }
  }
  ALLIE[0] = 0;
}

export function inspect(out) {
  out.taches = mesh ? mesh.count : 0;
  let n = 0;
  for (let l = 0; l < lumieres.length; l++) n += actives[l];
  out.lumieresActives = n;
}
