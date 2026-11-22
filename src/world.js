// FONDATION : world.js — arène : obstacles avec collision (rochers, carcasses de robots), falaises en bordure, et,
// depuis l'intégration du rendu « peint » (13/11/2026, ARCHITECTURE.md § Z quater, DA docs/da-clash.md), le monde
// peint de src/rendu/ : soleil chaud et ciel froid (carte d'ombre ajustée à l'emprise visible), sol peint, cailloux et
// touffes cuits, décor modélisé sous Blender (assets/modeles/decor/, placé selon son manifeste) avec son ombre figée,
// végétation vivante, nuages, ombres de contact sous chaque unité, taches de lumière au sol et vraies lumières.
// L'arène est générée avec WORLD.seed par un générateur privé : identique à chaque partie.
import * as THREE from 'three';
import { AGENTS, EVENTS, PALETTE, PEINT, RESOLVE, TRAUMA, WORLD } from './config.js';
import * as lumiere from './rendu/lumiere.js';
import * as sol from './rendu/sol.js';
import * as vegetation from './rendu/vegetation.js';
import * as contact from './rendu/ombres-contact.js';
import * as lumieresEmises from './rendu/lumieres.js';
import * as ombreStatique from './rendu/ombre-statique.js';
import { setLumiere, uniformsPeints } from './rendu/materiaux.js';
import { P, run } from './state.js';
import { chargerGeometrie } from './rendu/glb.js';
import * as peint from './rendu/index.js';

let ctx = null;
let view = null;

const HALF = WORLD.half;
const MAX_OBS = WORLD.rocks.count + WORLD.carcasses.count;

/** x, z, rayon de chaque obstacle. */
export const obstacles = new Float32Array(MAX_OBS * 3);
export let obstacleCount = 0;
let rockCount = 0; // les rockCount premiers obstacles sont des rochers, les suivants des carcasses

// Grille statique des obstacles : chaque obstacle est inscrit dans toutes les cellules que touche son cercle
// élargi de OBS_MARGIN. Une requête de rayon ≤ OBS_MARGIN ne lit donc que la cellule de son centre ; au-delà,
// elle parcourt tous les obstacles (il y en a 40). La grille couvre l'arène, élargie d'une demi-cellule.
const OBS_CELL = WORLD.obstacleCell;
const OBS_MIN = -(HALF + OBS_CELL / 2);
const OBS_DIM = Math.ceil((2 * (HALF + OBS_CELL / 2)) / OBS_CELL);
const OBS_MARGIN = WORLD.obstacleMargin;
// Deux obstacles sont séparés d'au moins WORLD.minGap : un cercle de rayon ≤ minGap / 2 n'en touche jamais deux à
// la fois, une seule passe le sort. Plus gros, il peut être renvoyé d'un obstacle dans l'autre : plusieurs passes.
const SINGLE_PASS_R = WORLD.minGap / 2;
const MAX_PASSES = 6;
const solved = new Float64Array(2); // résultat de solve()
const obsStart = new Uint16Array(OBS_DIM * OBS_DIM);
const obsCount = new Uint16Array(OBS_DIM * OBS_DIM);
let obsItems = new Uint8Array(0);

// Rendu peint
// Plan de routage cuit (branche carte-blender) : textures posées dans les uniformes du sol, grille des pistes (les CMS
// ne s'y posent pas), impulsion du début de vague
const PLAN = PEINT.carte.plan;
let planPret = false;
let planGrille = null; // Uint8Array PLAN_N² : 1 = piste, via, processeur ou sérigraphie réservée (pas de CMS)
const PLAN_PAS = 0.25;
const PLAN_N = Math.ceil((2 * 64) / PLAN_PAS);
const impulsion = { t: 1e9, vague: 0 };
const revele = { t: 1e9, ombres: [] }; // matérialisation du héros (s depuis le départ), maillages dont l'ombre est coupée
// pendant la matérialisation, l'ombre du héros ne précède pas son corps : ombre coupée sur le corps, la cape et les armes
function ombresHeros(on) {
  if (!on) {
    revele.ombres.length = 0;
    ctx.scene.traverse((o) => {
      if (o.isMesh && o.castShadow && (o.name === 'joueur' || o.name === 'joueur-cape' || o.name.startsWith('arme-'))) revele.ombres.push(o);
    });
  }
  for (const o of revele.ombres) o.castShadow = on;
  if (on) revele.ombres.length = 0;
}
let decorGlb = null; // résultat de preload() : { rochers, falaises, carcasses } (listes de modèles), ou null
let helices = null; // pales des ventirads des coins (carte mère) : sol.creerHelices, tournées par update()
const decorInfo = { source: 'aucun', fichiers: 0, maillages: 0, triangles: 0, octetsTextures: 0, ombreStatiqueCm: 0, erreur: '' };
const NUAGE = new Float64Array(2); // décalage des ombres de nuages (m), avancé en temps réel

// ----- Générateur privé (mulberry32) -----------------------------------------------------------------------------
let seed = WORLD.seed | 0;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rr(a, b) {
  return a + (b - a) * rnd();
}

// Direction VERS le soleil (repli procédural : décalage des disques d'ombre des carcasses, retirés ensuite)
let sunDirX = 0, sunDirZ = 0;
const cA = new THREE.Color();
const cB = new THREE.Color();
function mixHex(hexA, hexB, t, lum = 1) {
  cA.setHex(hexA);
  cB.setHex(hexB);
  cA.lerp(cB, t).multiplyScalar(lum);
  return cA.getHex();
}

function obsCellOf(v) {
  const c = Math.floor((v - OBS_MIN) / OBS_CELL);
  return c < 0 ? 0 : c >= OBS_DIM ? OBS_DIM - 1 : c;
}

/**
 * Avant toute init (main.js, au démarrage) : charge le décor modélisé sous Blender (manifeste puis fichiers .glb, avec
 * leurs textures). Ne lève jamais : absent ou illisible, le décor procédural de src/rendu/sol.js le remplace.
 */
async function chargerPlan() {
  if (!PLAN.actif) return;
  const base = new URL('../' + PLAN.dossier, import.meta.url).href;
  const L = new THREE.TextureLoader();
  const tex = async (nom, couleur) => {
    const t = await L.loadAsync(base + nom);
    t.colorSpace = couleur ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8; // three borne au maximum de la carte graphique
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  const [plan, ao, cpu, emi, json] = await Promise.all([
    tex('plan-routage.png', false),
    tex('plan-ao.png', false),
    tex('processeur.png', true),
    tex('processeur-emissif.png', false),
    fetch(base + 'plan-routage.json').then((r) => r.json()),
  ]);
  const U = uniformsPeints;
  U.uSrPlanTex.value = plan;
  U.uSrPlanAo.value = ao;
  U.uSrCpuTex.value = cpu;
  U.uSrCpuEmi.value = emi;
  U.uSrPlanMix.value.set(PLAN.force, PLAN.proceduralGarde, PLAN.ao, json.emprise);
  U.uSrEnergie.value.setHex(PLAN.energie).convertSRGBToLinear();
  U.uSrPulse2.value = PLAN.piste;
  U.uSrBruitE.value.set(PLAN.bruit.echelle, PLAN.bruit.plancher, PLAN.bruit.derive);
  U.uSrCpu.value.set(json.processeur.demiCote, json.processeur.emprise, PLAN.cpu.couleur, PLAN.cpu.repos);
  // grille des emprises interdites aux CMS : pistes (+ 0,35 m), vias, processeur, sérigraphie réservée
  const g = new Uint8Array(PLAN_N * PLAN_N);
  const marquer = (x, z, r) => {
    const i0 = Math.max(0, Math.floor((x - r + 64) / PLAN_PAS)), i1 = Math.min(PLAN_N - 1, Math.floor((x + r + 64) / PLAN_PAS));
    const j0 = Math.max(0, Math.floor((z - r + 64) / PLAN_PAS)), j1 = Math.min(PLAN_N - 1, Math.floor((z + r + 64) / PLAN_PAS));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) g[j * PLAN_N + i] = 1;
  };
  const marge = json.largeurPiste / 2 + 0.35;
  for (const p of json.pistes) {
    for (let k = 0; k + 1 < p.poly.length; k++) {
      const [ax, az] = p.poly[k];
      const [bx, bz] = p.poly[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (PLAN_PAS * 0.5)));
      for (let s = 0; s <= n; s++) marquer(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n, marge);
    }
  }
  for (const [x, z] of json.vias) marquer(x, z, 0.5);
  const c = json.processeur.demiCote + 0.8;
  marquer(0, 0, c);
  for (const [x0, z0, x1, z1] of json.reserves) marquer((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) / 2);
  planGrille = g;
  planPret = true;
}

/** Vrai si un CMS de rayon r posé en (x, z) mordrait sur le plan cuit (piste, via, processeur, sérigraphie). */
function surPlan(x, z, r) {
  if (!planGrille) return false;
  const i0 = Math.max(0, Math.floor((x - r + 64) / PLAN_PAS)), i1 = Math.min(PLAN_N - 1, Math.floor((x + r + 64) / PLAN_PAS));
  const j0 = Math.max(0, Math.floor((z - r + 64) / PLAN_PAS)), j1 = Math.min(PLAN_N - 1, Math.floor((z + r + 64) / PLAN_PAS));
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (planGrille[j * PLAN_N + i]) return true;
  return false;
}

export async function preload() {
  try {
    await chargerPlan();
  } catch (e) {
    planPret = false;
    planGrille = null;
    decorInfo.erreur = 'plan : ' + String((e && e.message) || e);
  }
  try {
    const base = new URL('../' + WORLD.decor.dir, import.meta.url).href;
    const D = await sol.chercherDecorGlb(chargerGeometrie, base, WORLD.decor.manifest);
    decorGlb = D;
    decorInfo.fichiers = D.rochers.length + D.falaises.length + D.carcasses.length;
  } catch (e) {
    decorGlb = null;
    decorInfo.erreur = String((e && e.message) || e);
  }
}

export function init(context) {
  ctx = context;
  view = ctx.camera.view;
  const scene = ctx.scene;
  seed = WORLD.seed | 0;
  const sd = WORLD.light.sunDir;
  sunDirX = sd[0];
  sunDirZ = sd[2];

  placeObstacles();
  buildObstacleGrid();

  // Soleil chaud, ciel froid, carte d'ombre qui suit la vue (src/rendu/lumiere.js)
  lumiere.init({ scene });

  // Sol peint (albédo calculé dans le shader), cailloux et touffes cuits en un maillage
  scene.add(sol.creerSol({ plan: planPret }));
  const parsemes = sol.cuireParsemes(sol.creerParsemes((x, z, r) => overlaps(x, z, r) || surPlan(x, z, r)));
  scene.add(parsemes);

  // Décor : modèles Blender placés selon le manifeste, regroupés par atlas (un appel de dessin par famille) ; sans
  // eux, le décor procédural (rochers ronds, falaises et carcasses de la fondation recolorées).
  const D = decorGlb;
  const parts = [];
  if (D && D.rochers.length) parts.push(...sol.partiesRochers(D.rochers, obstacles, rockCount));
  else parts.push({ geometry: sol.creerRochers(obstacles, rockCount).geometry, textures: null });
  if (D && D.falaises.length) parts.push(...sol.partiesFalaises(D.falaises, HALF));
  else parts.push({ geometry: sol.recolorerFalaises(buildCliffs(ctx.render)).geometry, textures: null });
  if (D && D.carcasses.length) parts.push(...sol.partiesCarcasses(D.carcasses, obstacles, rockCount, obstacleCount));
  else parts.push({ geometry: sol.nettoyerCarcasses(buildCarcasses(ctx.render)).geometry, textures: null });
  const decors = sol.fusionnerParties(parts);
  decorInfo.source = D && decorInfo.fichiers > 0 ? 'glb' : 'procedural';
  decorInfo.maillages = decors.length;
  decorInfo.triangles = 0;
  decorInfo.octetsTextures = 0;
  for (const m of decors) {
    m.updateMatrix();
    scene.add(m);
    decorInfo.triangles += m.geometry.attributes.position.count / 3;
  }
  if (D) for (const fam of [D.rochers, D.falaises, D.carcasses]) for (const m of fam) decorInfo.octetsTextures += m.octetsTextures || 0;
  // pales des ventirads des coins : hors du décor fusionné (elles tournent), hors de l'ombre figée
  helices = D && D.helice && sol.helices.length ? sol.creerHelices(D.helice, sol.helices) : null;
  if (helices) {
    helices.mesh.updateMatrix();
    scene.add(helices.mesh);
  }

  // Végétation vivante (un maillage instancié par espèce)
  vegetation.init(scene, (x, z, r) => overlaps(x, z, r), obstacles, rockCount);

  // Ombre FIGÉE du décor : rendue une fois, AVANT la première compilation des matériaux peints (prewarm)
  decorInfo.ombreStatiqueCm = ombreStatique.cuire(ctx.renderer, decors, lumiere.directionSoleil([0, 0, 0])).texelCm;

  peint.enregistrer({ parsemes: [parsemes], soleil: true });
}

/**
 * Après l'init de TOUS les modules (main.js), avant le prewarm : ombres de contact (robots, héros, obstacles, marchand)
 * et lumière émise (taches au sol, vraies lumières), qui retrouvent par leur nom les maillages des modules (§ G.3).
 */
export function initLate() {
  const scene = ctx.scene;
  const marchand = scene.getObjectByName('marchand');
  const suivre = marchand ? [{ objet: marchand, rayon: PEINT.contact.marchand }] : [];
  // capsule de ravitaillement (événement de vague, § E1.C) : même ombre de contact, qui pâlit avec l'altitude
  const capsule = scene.getObjectByName('capsule');
  if (capsule) suivre.push({ objet: capsule, rayon: EVENTS.types.find((e) => e.key === 'ravitaillement').contactRadius });
  contact.init(scene, {
    statiques: obstacles,
    nStatiques: obstacleCount,
    suivre,
  });
  lumieresEmises.init(scene);
}

// ----- Obstacles (positions) -------------------------------------------------------------------------------------
function placeObstacles() {
  const lim = HALF - WORLD.edgeMargin;
  const kinds = [WORLD.rocks, WORLD.carcasses];
  let n = 0;
  for (let k = 0; k < kinds.length; k++) {
    const K = kinds[k];
    for (let i = 0; i < K.count; i++) {
      for (let attempt = 0; attempt < 400; attempt++) {
        const r = rr(K.radiusMin, K.radiusMax);
        const x = rr(-lim + r, lim - r);
        const z = rr(-lim + r, lim - r);
        if (Math.hypot(x, z) < WORLD.clearRadius + r) continue;
        let ok = true;
        for (let j = 0; j < n; j++) {
          const d = Math.hypot(x - obstacles[j * 3], z - obstacles[j * 3 + 1]);
          if (d < r + obstacles[j * 3 + 2] + WORLD.minGap) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        obstacles[n * 3] = x;
        obstacles[n * 3 + 1] = z;
        obstacles[n * 3 + 2] = r;
        n++;
        break;
      }
    }
    if (k === 0) rockCount = n;
  }
  obstacleCount = n;
}

function buildObstacleGrid() {
  const lists = [];
  for (let c = 0; c < OBS_DIM * OBS_DIM; c++) lists.push([]);
  for (let i = 0; i < obstacleCount; i++) {
    const x = obstacles[i * 3];
    const z = obstacles[i * 3 + 1];
    const reach = obstacles[i * 3 + 2] + OBS_MARGIN;
    const cx0 = obsCellOf(x - reach);
    const cx1 = obsCellOf(x + reach);
    const cz0 = obsCellOf(z - reach);
    const cz1 = obsCellOf(z + reach);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) lists[cz * OBS_DIM + cx].push(i);
  }
  let total = 0;
  for (const l of lists) total += l.length;
  obsItems = new Uint8Array(total);
  let run = 0;
  for (let c = 0; c < lists.length; c++) {
    obsStart[c] = run;
    obsCount[c] = lists[c].length;
    for (const i of lists[c]) obsItems[run++] = i;
  }
}

// ----- Prisme irrégulier (bloc de falaise) -------------------------------------------------------------------------
// base : 4 coins au sol (x, z) dans l'ordre ; top : 4 coins (x, y, z). Faces : dessus + 4 côtés.
function prism(render, base, top, hex) {
  const pos = [];
  const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const B = base.map((q) => [q[0], 0, q[1]]);
  // dessus (deux facettes)
  tri(top[0], top[1], top[2]);
  tri(top[0], top[2], top[3]);
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    tri(B[k], top[n], top[k]);
    tri(B[k], B[n], top[n]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  // Orientation : on veut les normales vers l'extérieur ; on corrige par le centre du prisme.
  fixWinding(g);
  g.computeVertexNormals();
  return render.makePart(g, hex, 0);
}

/** Retourne les triangles dont la normale regarde vers le centre de la géométrie. */
function fixWinding(g) {
  const a = g.attributes.position.array;
  let cx = 0, cy = 0, cz = 0;
  const n = a.length / 3;
  for (let i = 0; i < n; i++) {
    cx += a[i * 3];
    cy += a[i * 3 + 1];
    cz += a[i * 3 + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  for (let t = 0; t < a.length; t += 9) {
    const ux = a[t + 3] - a[t], uy = a[t + 4] - a[t + 1], uz = a[t + 5] - a[t + 2];
    const vx = a[t + 6] - a[t], vy = a[t + 7] - a[t + 1], vz = a[t + 8] - a[t + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[t] + a[t + 3] + a[t + 6]) / 3 - cx;
    const my = (a[t + 1] + a[t + 4] + a[t + 7]) / 3 - cy;
    const mz = (a[t + 2] + a[t + 5] + a[t + 8]) / 3 - cz;
    if (nx * mx + ny * my + nz * mz < 0) {
      for (let k = 0; k < 3; k++) {
        const tmp = a[t + 3 + k];
        a[t + 3 + k] = a[t + 6 + k];
        a[t + 6 + k] = tmp;
      }
    }
  }
}

// ----- Falaises procédurales (repli : décor .glb absent), un maillage fusionné autour du carré de 120 m ------------
function buildCliffs(render) {
  const C = WORLD.cliffs;
  const parts = [];
  const gph = view.groundPerHeight;
  // Côté dont la normale sortante est n : le haut d'un bloc de hauteur h masque le sol sur
  // h × gph × max(0, −up·n) vers l'intérieur de l'arène. On recule d'autant l'arête haute intérieure : une
  // falaise du côté de la caméra ne cache jamais le joueur.
  const occl = (nx, nz) => Math.max(0, -(view.upX * nx + view.upZ * nz)) * gph;
  const sides = [
    { nx: 0, nz: -1 }, // nord
    { nx: 0, nz: 1 }, // sud
    { nx: -1, nz: 0 }, // ouest
    { nx: 1, nz: 0 }, // est
  ];
  const count = Math.round((HALF * 2) / C.segment);
  const seg = (HALF * 2) / count;
  for (const s of sides) {
    const tx = -s.nz; // tangente
    const tz = s.nx;
    const k = occl(s.nx, s.nz);
    for (let i = 0; i < count; i++) {
      const a0 = -HALF + i * seg;
      const a1 = a0 + seg;
      const h = rr(C.heightMin, C.heightMax);
      const hs = [h + rr(-0.7, 0.7), h + rr(-0.7, 0.7), h + rr(-0.7, 0.7), h + rr(-0.7, 0.7)];
      const hMax = Math.max(hs[0], hs[1], hs[2], hs[3]);
      const back = k > 0 ? k * hMax + 0.25 : rr(0.5, 1.8);
      const inner = HALF;
      const outer = HALF + C.depth + rr(-0.5, 1.5);
      const tin = Math.min(inner + back, outer - 1.2);
      const tout = outer - rr(0.3, 1.2);
      const P2 = (along, dist) => [tx * along + s.nx * dist, tz * along + s.nz * dist];
      const P3 = (along, dist, y) => [tx * along + s.nx * dist, y, tz * along + s.nz * dist];
      const j0 = rr(-0.5, 0.5);
      const j1 = rr(-0.5, 0.5);
      const base = [P2(a0, inner), P2(a1, inner), P2(a1, outer), P2(a0, outer)];
      const top = [P3(a0 + 0.2, tin + j0, hs[0]), P3(a1 - 0.2, tin + j1, hs[1]), P3(a1 - 0.2, tout, hs[2]), P3(a0 + 0.2, tout, hs[3])];
      parts.push(prism(render, base, top, mixHex(PALETTE.rock, PALETTE.rockDark, rr(0, 0.55), rr(0.92, 1.06))));
    }
  }
  // Coins
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const h = rr(C.heightMax - 1, C.heightMax + 1.5);
      const kx = occl(sx, 0);
      const kz = occl(0, sz);
      const bx = kx > 0 ? kx * h + 0.25 : rr(0.5, 1.5);
      const bz = kz > 0 ? kz * h + 0.25 : rr(0.5, 1.5);
      const o = HALF + WORLD.cliffs.depth + 1;
      const base = [
        [sx * HALF, sz * HALF],
        [sx * o, sz * HALF],
        [sx * o, sz * o],
        [sx * HALF, sz * o],
      ];
      const ix = Math.min(HALF + bx, o - 1.5);
      const iz = Math.min(HALF + bz, o - 1.5);
      const top = [
        [sx * ix, h, sz * iz],
        [sx * (o - 0.6), h + rr(-0.6, 0.6), sz * iz],
        [sx * (o - 0.6), h + rr(-0.6, 0.6), sz * (o - 0.6)],
        [sx * ix, h + rr(-0.6, 0.6), sz * (o - 0.6)],
      ];
      parts.push(prism(render, base, top, mixHex(PALETTE.rock, PALETTE.rockDark, rr(0.1, 0.5))));
    }
  }
  return render.mergeParts(parts);
}

// ----- Ombre portée factice (disque sombre posé au sol, opaque) : ancre un obstacle sans carte d'ombre ---------------
function blob(render, x, z, r) {
  const g = new THREE.CircleGeometry(1, 9);
  g.rotateX(-Math.PI / 2);
  g.scale(r * 1.25, 1, r * 1.05);
  // décalé à l'opposé du soleil
  const gl = Math.hypot(sunDirX, sunDirZ) || 1;
  g.translate(x - (sunDirX / gl) * r * 0.35, 0.02, z - (sunDirZ / gl) * r * 0.35);
  return render.makePart(g, mixHex(PALETTE.sand, PALETTE.rockDark, 0.45, 0.8), 0);
}

// ----- Carcasses de robots procédurales (repli : décor .glb absent) ------------------------------------------------
function buildCarcasses(render) {
  const parts = [];
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3(1, 1, 1);
  const tr = new THREE.Vector3();
  const box = (w, h, d, hex, px, py, pz, rx, ry, rz) => {
    const g = new THREE.BoxGeometry(w, h, d);
    e.set(rx, ry, rz);
    q.setFromEuler(e);
    tr.set(px, py, pz);
    m.compose(tr, q, sc);
    g.applyMatrix4(m);
    return render.makePart(g, hex, 0);
  };
  const rust = mixHex(PALETTE.robotDark, PALETTE.rockDark, 0.45);
  for (let i = rockCount; i < obstacleCount; i++) {
    const x = obstacles[i * 3];
    const z = obstacles[i * 3 + 1];
    const r = obstacles[i * 3 + 2];
    const s = r / 1.4; // gabarit dessiné pour un rayon de 1,4 m
    const yaw = rr(0, Math.PI * 2);
    const local = [];
    // torse renversé, à moitié enfoui
    local.push(box(1.5, 0.9, 1.1, PALETTE.robot, 0, 0.35, 0, rr(-0.25, 0.25), 0, rr(0.2, 0.45)));
    // plaque dorsale rouillée
    local.push(box(1.2, 0.16, 0.9, rust, -0.1, 0.86, 0.05, rr(-0.2, 0.2), rr(-0.3, 0.3), rr(0.25, 0.5)));
    // tête tombée, œil éteint
    local.push(box(0.62, 0.55, 0.6, PALETTE.robotLight, 1.0, 0.24, 0.45, rr(-0.5, 0.5), rr(0, 1.2), rr(-0.4, 0.4)));
    local.push(box(0.36, 0.14, 0.08, mixHex(PALETTE.robotEye, PALETTE.robotDark, 0.75), 1.08, 0.3, 0.76, 0, rr(0, 0.4), 0));
    // membres épars
    local.push(box(1.1, 0.24, 0.26, PALETTE.robotDark, -0.75, 0.13, -0.75, 0, rr(0.3, 1.2), rr(-0.1, 0.1)));
    local.push(box(0.9, 0.22, 0.24, PALETTE.robotDark, 0.35, 0.12, -0.95, 0, rr(-1.0, -0.2), 0));
    local.push(box(0.5, 0.5, 0.5, rust, -1.0, 0.18, 0.55, rr(0, 0.6), rr(0, 1), rr(0, 0.6)));
    for (const g of local) {
      g.scale(s, s, s);
      g.rotateY(yaw);
      g.translate(x, 0, z);
      parts.push(g);
    }
    parts.push(blob(render, x, z, r * 0.95));
  }
  return render.mergeParts(parts);
}

// ----- Boucle ----------------------------------------------------------------------------------------------------

/**
 * F10 : la caméra d'ombre du soleil s'ajuste à l'emprise visible et se recale au texel (src/rendu/lumiere.js), les
 * ombres de nuages glissent, la végétation recopie ses carreaux vus et suit le vent et les pousseurs.
 */
/** Impulsion d'énergie du début de vague : un front part du processeur central et court sur les bus alimentés. */
function majImpulsion(dt) {
  if (run.wave !== impulsion.vague) {
    if (run.wave > impulsion.vague) {
      impulsion.t = 0; // nouvelle vague (la vague 1 aussi : le héros apparaît)
      // secousse au départ de l'impulsion (Femz 17/11) : houle douce ; secousse sèche (trauma) seulement si secousse > 0
      if (ctx && ctx.camera) {
        const H = PLAN.impulsion.houle;
        ctx.camera.addHoule(H.amplitude, H.duree, H.frequence, H.roulis);
        if (PLAN.impulsion.secousse > 0) ctx.camera.addTrauma(PLAN.impulsion.secousse, TRAUMA.BOSS);
      }
    }
    impulsion.vague = run.wave;
  }
  impulsion.t += dt;
  const I = PLAN.impulsion;
  const U = uniformsPeints;
  const t = impulsion.t;
  if (t < I.duree) {
    const fin = 1 - Math.min(1, Math.max(0, (t - I.duree * 0.6) / (I.duree * 0.4))); // fondu de fin
    U.uSrPulse.value.set(t * I.vitesse - I.largeur, I.largeur, I.gain * fin, I.traine * fin);
  } else U.uSrPulse.value.set(-100, I.largeur, 0, 0);
  // matérialisation du héros : le front monte du sol (−ligne) au-dessus de la cape, en sortie douce ; le processeur luit
  const M = PLAN.materialisation;
  let lueur = 0;
  if (revele.t < M.duree) {
    revele.t += dt;
    let u = Math.min(1, revele.t / M.duree);
    lueur = Math.sin(Math.PI * u) * M.lueurCpu;
    u = 1 - (1 - u) * (1 - u);
    U.uSrRevele.value.set(-M.ligne + u * (M.hauteur + 2 * M.ligne), revele.t < M.duree ? 1 : 0, M.ligne, M.traine);
    if (revele.t >= M.duree) ombresHeros(true); // compilé : l'ombre revient
  } else U.uSrRevele.value.y = 0;
  U.uSrCpu.value.w = PLAN.cpu.repos + PLAN.cpu.eclat * Math.exp(-t * PLAN.cpu.decroissance) + lueur;
}

/**
 * Le héros se matérialise sur le processeur central (main.js, entrée dans le premier compte à rebours d'une partie) :
 * révélé de bas en haut par une ligne de scan à la couleur de l'agent. Sans plan de routage : rien.
 */
export function materialiser() {
  if (!planPret) return;
  if (revele.t < PLAN.materialisation.duree) ombresHeros(true); // relance en pleine matérialisation (Rejouer)
  revele.t = 0;
  ombresHeros(false);
  uniformsPeints.uSrReveleCouleur.value.setHex(AGENTS[run.agent].accent).convertSRGBToLinear();
  uniformsPeints.uSrRevele.value.set(-1, 1, PLAN.materialisation.ligne, PLAN.materialisation.traine); // caché dès cette image
}

export function update(realDt) {
  lumiere.update(view);
  const N = PEINT.nuages.vitesse;
  NUAGE[0] += N[0] * realDt;
  NUAGE[1] += N[1] * realDt;
  uniformsPeints.uSrNuage.value.set(NUAGE[0], NUAGE[1]);
  if (planPret) majImpulsion(realDt);
  uniformsPeints.uSrHalo.value.x = P.x; // halo du sol autour du héros (branche carte-retouche)
  uniformsPeints.uSrHalo.value.y = P.z;
  vegetation.update(view, realDt);
  sol.tournerHelices(helices, realDt, ctx.camera);
}

/** F11, après tous les sync des modules : ombres de contact et lumière émise (lisent E, P et les tampons d'instance). */
export function sync() {
  contact.sync();
  lumieresEmises.sync();
}

// ----- Collisions --------------------------------------------------------------------------------------------------

/**
 * Cas général, pour tout rayon : pousse le cercle hors des obstacles et le borne à l'arène, en plusieurs passes
 * (un gros cercle sorti d'un obstacle peut retomber dans son voisin, ou contre une falaise). Résultat dans
 * solved[0], solved[1].
 * Deux obstacles trop proches pour laisser passer le cercle le renverraient sans fin de l'un à l'autre : dès que
 * deux obstacles l'ont poussé dans la même passe, il est posé au point tangent aux deux le plus proche.
 */
function solve(x, z, r) {
  let nx = x;
  let nz = z;
  const lim = HALF - r;
  const all = r > OBS_MARGIN;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let first = -1; // obstacles qui ont poussé le cercle pendant cette passe
    let second = -1;
    let s = 0;
    let k = obstacleCount;
    if (!all) {
      const c = obsCellOf(nz) * OBS_DIM + obsCellOf(nx);
      s = obsStart[c];
      k = obsCount[c];
    }
    for (let q = s; q < s + k; q++) {
      const o = (all ? q : obsItems[q]) * 3;
      const dx = nx - obstacles[o];
      const dz = nz - obstacles[o + 1];
      const rad = r + obstacles[o + 2];
      const d2 = dx * dx + dz * dz;
      if (d2 < rad * rad) {
        const d = Math.sqrt(d2);
        if (d > 1e-6) {
          const f = (rad + 1e-4) / d; // un cheveu au-delà du contact : la passe suivante ne le revoit pas
          nx = obstacles[o] + dx * f;
          nz = obstacles[o + 1] + dz * f;
        } else {
          nx = obstacles[o] + rad;
        }
        if (first < 0) first = o;
        else if (o !== first) second = o;
      }
    }
    if (second >= 0) {
      // Points à la fois à (r + Ra) de A et à (r + Rb) de B : intersection de deux cercles. Elle n'existe que si
      // le cercle ne tient pas entre A et B ; sinon les passes convergent d'elles-mêmes vers le passage.
      const ax = obstacles[first];
      const az = obstacles[first + 1];
      const ra = r + obstacles[first + 2] + 1e-4;
      const bx = obstacles[second];
      const bz = obstacles[second + 1];
      const rb = r + obstacles[second + 2] + 1e-4;
      const ux = bx - ax;
      const uz = bz - az;
      const d = Math.sqrt(ux * ux + uz * uz);
      if (d > 1e-6 && d < ra + rb) {
        const along = (ra * ra - rb * rb + d * d) / (2 * d);
        const h2 = ra * ra - along * along;
        const h = h2 > 0 ? Math.sqrt(h2) : 0;
        const mx = ax + (ux / d) * along;
        const mz = az + (uz / d) * along;
        const px = (-uz / d) * h;
        const pz = (ux / d) * h;
        // des deux solutions, la plus proche de la position courante
        const side = (nx - mx) * px + (nz - mz) * pz >= 0 ? 1 : -1;
        nx = mx + px * side;
        nz = mz + pz * side;
      }
    }
    if (nx > lim) nx = lim;
    else if (nx < -lim) nx = -lim;
    if (nz > lim) nz = lim;
    else if (nz < -lim) nz = -lim;
    if (first < 0 || r <= SINGLE_PASS_R) break;
  }
  solved[0] = nx;
  solved[1] = nz;
}

/** Pousse le cercle hors des obstacles et le borne à l'arène. Résultat dans out2 ; true s'il a été déplacé. */
export function resolve(x, z, r, out2) {
  solve(x, z, r);
  out2[0] = solved[0];
  out2[1] = solved[1];
  return solved[0] !== x || solved[1] !== z; // comparé avant l'arrondi du tableau de sortie
}

/** Même chose, sur place, pour les count premiers éléments (tableaux typés) ; MODE = RESOLVE.* par élément. */
export function resolveMany(X, Z, R, MODE, count) {
  const SKIP = RESOLVE.SKIP;
  const GROUND = RESOLVE.GROUND;
  const OBST = RESOLVE.OBST; // § E4.F.2 : robot en repli — rochers seulement, il peut sortir de l'arène (bord d'écran au-delà)
  for (let i = 0; i < count; i++) {
    const mode = MODE[i];
    if (mode === SKIP) continue;
    let x = X[i];
    let z = Z[i];
    const r = R[i];
    if (mode === GROUND && r > SINGLE_PASS_R) {
      // gros cercle : cas général (rare — aucun robot de la table n'atteint ce rayon, boss à part)
      solve(x, z, r);
      X[i] = solved[0];
      Z[i] = solved[1];
      continue;
    }
    if (mode === GROUND || mode === OBST) {
      // chemin chaud, écrit en ligne : une seule cellule, une seule passe (exact pour r ≤ minGap / 2)
      let cx = Math.floor((x - OBS_MIN) / OBS_CELL);
      let cz = Math.floor((z - OBS_MIN) / OBS_CELL);
      if (cx < 0) cx = 0;
      else if (cx >= OBS_DIM) cx = OBS_DIM - 1;
      if (cz < 0) cz = 0;
      else if (cz >= OBS_DIM) cz = OBS_DIM - 1;
      const c = cz * OBS_DIM + cx;
      const k = obsCount[c];
      if (k !== 0) {
        const s = obsStart[c];
        for (let q = s; q < s + k; q++) {
          const o = obsItems[q] * 3;
          const dx = x - obstacles[o];
          const dz = z - obstacles[o + 1];
          const rad = r + obstacles[o + 2];
          const d2 = dx * dx + dz * dz;
          if (d2 < rad * rad) {
            const d = Math.sqrt(d2);
            if (d > 1e-6) {
              const f = rad / d;
              x = obstacles[o] + dx * f;
              z = obstacles[o + 1] + dz * f;
            } else {
              x = obstacles[o] + rad;
            }
          }
        }
      }
    }
    if (mode === OBST) {
      X[i] = x;
      Z[i] = z;
      continue;
    }
    const lim = HALF - r;
    if (x > lim) x = lim;
    else if (x < -lim) x = -lim;
    if (z > lim) z = lim;
    else if (z < -lim) z = -lim;
    X[i] = x;
    Z[i] = z;
  }
}

/** Le cercle touche-t-il un obstacle ? Exact pour tout rayon. */
export function overlaps(x, z, r) {
  let s = 0;
  let k = obstacleCount;
  const all = r > OBS_MARGIN;
  if (!all) {
    const c = obsCellOf(z) * OBS_DIM + obsCellOf(x);
    s = obsStart[c];
    k = obsCount[c];
  }
  for (let q = s; q < s + k; q++) {
    const o = (all ? q : obsItems[q]) * 3;
    const dx = x - obstacles[o];
    const dz = z - obstacles[o + 1];
    const rad = r + obstacles[o + 2];
    if (dx * dx + dz * dz < rad * rad) return true;
  }
  return false;
}

export function isInsideArena(x, z, r) {
  const lim = HALF - r;
  return x <= lim && x >= -lim && z <= lim && z >= -lim;
}

/**
 * Niveau de la lumière d'ambiance du rendu peint (événement « panne de courant », § E1.C) : 1 = normal, 0,25 = panne.
 * Une valeur d'uniforme partagé (uSrLum.w) : aucun shader recompilé. Émissifs, tirs, gemmes et zones annoncées ne
 * baissent pas. N'écrit que si la valeur change.
 */
export function setBlackout(k) {
  if (!(k >= 0)) return;
  if (uniformsPeints.uSrLum.value.w !== k) setLumiere(k);
}

/** Même chose en pourcentage ENTIER (events.js l'appelle pendant les fondus : aucun flottant passé, § V). */
export function setBlackoutPct(pct) {
  setBlackout(pct / 100);
}

export function getBlackout() {
  return uniformsPeints.uSrLum.value.w;
}

export function inspect(out) {
  out.light = uniformsPeints.uSrLum.value.w; // niveau de la lumière d'ambiance (1 = normal)
  out.obstacles = obstacleCount;
  out.rocks = rockCount;
  out.carcasses = obstacleCount - rockCount;
  out.half = HALF;
  out.decor = decorInfo;
}

/** Détail du rendu peint (tests, F5) : décor, végétation, ombres de contact, lumière émise, carte d'ombre. */
export function inspectPeint(out) {
  out.decor = decorInfo;
  // pales des coins : angle de chaque hélice (seules celles que la caméra voit avancent)
  out.helices = helices ? { centres: helices.centres.map((c) => [c[0], c[2]]), angles: Array.from(helices.angles) } : null;
  vegetation.inspect(out);
  contact.inspect(out);
  lumieresEmises.inspect(out);
  const l = {};
  lumiere.inspect(l);
  out.ombre = l;
}
