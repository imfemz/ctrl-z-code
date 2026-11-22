//#region e5:AE-tuto-bornes
// Tuto des bornes de PV à la première partie (ARCHITECTURE.md § E5.AE ; Femz, 22/11 : « sur la première game lancée, un
// tuto pour les bornes HP »). La bulle est la 4e consigne de src/consignes.js ; ce module fait le reste :
//   - chercherBorne() : la borne À L'ÉCRAN la plus proche du héros — centre de la borne projeté par la caméra du jeu (vue et
//     projection lues à l'image : juste si la caméra tourne, en orthographique comme en perspective), dans
//     TUTO_BORNES.ecran ; résultat dans VIS (tableau typé) ;
//   - syncFleche(mode) : la flèche pixel au-dessus de la borne désignée (triangle pointe en bas, liseré sombre, corps
//     vert de la croix, reflet clair, halo en paliers cuit dans la texture). UN sprite face caméra, net
//     (render.garderNet, comme l'invite de la touche), taille fixe à l'écran (pxArt720, profondeur comprise en
//     perspective). Pop + fondu d'entrée, flottement continu au sous-pixel, glissé vers une nouvelle borne, fondu de
//     sortie ; effacée quand la borne devient « prête » (l'invite de la touche prend le relais au même endroit).
// init et sync sont appelés par consignes.js (aucune ligne dans main.js ni ui.js).
// Allocation (§ V) : chercherBorne et syncFleche n'allouent rien — tableaux typés, un Vector3 réutilisé.
import * as THREE from 'three';
import { DECORS, TUTO_BORNES } from './config.js';
import { P } from './state.js';
import { BORNE_X, BORNE_Z, PRET, PRET_I, getCount } from './props.js';

const ART = 4; // pixels du canvas par pixel d'art (mipmaps : net à ×2 — 720 p — et ×4 — 1440 p)
const TRI_W = 11; // triangle : 11 pixels d'art de large, 6 de haut (liseré compris)
const TRI_H = 6;
const HALO = 3; // paliers du halo autour du triangle
const W = TRI_W + 2 * HALO; // 17
const H = TRI_H + 2 * HALO; // 12

/** Mode de sync : flèche cachée net (écran de choix, nouvelle partie), montrée (suit VIS), en sortie (fondu). */
export const CACHEE = 0;
export const MONTREE = 1;
export const SORTIE = 2;

/** Résultat de chercherBorne() : [0] indice de la borne désignée (−1 : aucune à l'écran), [1] x, [2] z, [3] distance² au héros. */
export const VIS = new Float64Array(4);
VIS[0] = -1;

let camera = null;
let sprite = null;
let mat = null;
let tex = null;
let canvas = null;
const V = new THREE.Vector3();

// état de la flèche
const PH_CACHE = 0;
const PH_VISIBLE = 1;
const PH_SORTIE = 2;
const S = new Float64Array(11);
const S_PH = 0;
const S_T = 1; // s dans la phase
const S_BOB = 2; // horloge du flottement
const S_X = 3; // position affichée (glisse vers la borne)
const S_Z = 4;
const S_ALPHA = 5; // opacité au début de la sortie
const S_OP = 6; // dernière opacité appliquée (inspect)
const S_SC = 7; // dernière échelle appliquée
const S_I = 8; // borne désignée (indice de props)
const S_PRF = 9; // profondeur de la pointe (perspective ; 1 en orthographique)
const S_VIS = 10; // 1 : flèche dessinée
let apparitions = 0;
let recherches = 0;

/** Crée le sprite (une fois : consignes.build, hors combat, avant le préchauffage). */
export function init(ctx) {
  if (sprite !== null || !ctx || !ctx.scene || !ctx.camera || !ctx.render) return;
  camera = ctx.camera;
  canvas = document.createElement('canvas');
  canvas.width = W * ART;
  canvas.height = H * ART;
  dessiner(canvas.getContext('2d'));
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.name = 'tuto-bornes';
  mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  sprite = new THREE.Sprite(mat);
  sprite.name = 'tuto-bornes';
  // ancrée par la pointe du triangle (bas du triangle, au-dessus des paliers du halo)
  sprite.center.set(0.5, HALO / H);
  sprite.renderOrder = 999; // juste sous l'invite de la touche (1000)
  sprite.frustumCulled = false;
  sprite.visible = false;
  ctx.scene.add(sprite);
  ctx.render.garderNet(sprite); // hors de l'effet CRT / pixel : nette, devant la scène
  cacher();
}

/** Triangle pointe en bas, liseré, reflet, halo en paliers (hors combat, une fois). */
function dessiner(g) {
  const K = TUTO_BORNES.couleurs;
  g.clearRect(0, 0, W * ART, H * ART);
  // rangée r du triangle (0 = haut) : de x0 à x1 inclus, dans la grille du triangle
  const x0 = (r) => r;
  const x1 = (r) => TRI_W - 1 - r;
  // halo : chaque palier est le triangle grossi de k pixels d'art (du plus large au plus serré), opacité décroissante
  for (let k = HALO; k >= 1; k--) {
    g.fillStyle = 'rgba(' + K.halo + ', ' + TUTO_BORNES.halo[k - 1] + ')';
    for (let r = -k; r < TRI_H + k; r++) {
      const rr = r < 0 ? 0 : r >= TRI_H ? TRI_H - 1 : r;
      const a = x0(rr) - k;
      const b = x1(rr) + k;
      if (b < a) continue;
      g.fillRect((HALO + a) * ART, (HALO + r) * ART, (b - a + 1) * ART, ART);
    }
  }
  // triangle : rangée du haut et bords en liseré sombre, pointe en liseré seul ; corps vert, moitié droite dans l'ombre,
  // reflet clair sur la 1re rangée du corps et le long du bord gauche
  const px = (x, r, w, col) => {
    g.fillStyle = col;
    g.fillRect((HALO + x) * ART, (HALO + r) * ART, w * ART, ART);
  };
  const mid = TRI_W >> 1; // colonne du milieu (5)
  for (let r = 0; r < TRI_H; r++) px(x0(r), r, x1(r) - x0(r) + 1, K.trait);
  for (let r = 1; r < TRI_H - 1; r++) {
    const a = x0(r) + 1;
    const b = x1(r) - 1;
    px(a, r, b - a + 1, K.corps);
    if (r >= 2 && b > mid) px(mid + 1, r, b - mid, K.ombre);
  }
  px(x0(1) + 1, 1, x1(1) - x0(1) - 1, K.clair);
  for (let r = 2; r < TRI_H - 2; r++) px(x0(r) + 1, r, 1, K.clair);
}

/** La flèche disparaît sans fondu (nouvelle partie, écran de choix). */
export function cacher() {
  VIS[0] = -1; // (nouvelle partie : aucune désignation de la partie d'avant)
  S[S_PH] = PH_CACHE;
  S[S_T] = 0;
  S[S_I] = -1;
  S[S_OP] = 0;
  if (sprite !== null) {
    sprite.visible = false;
    mat.opacity = 0;
  }
}

/** La borne à l'écran la plus proche du héros → VIS. Rend rien (lire VIS[0]). Aucune allocation. */
export function chercherBorne() {
  VIS[0] = -1;
  if (camera === null) return;
  const cam = camera.threeCamera;
  if (!cam) return;
  recherches++;
  cam.updateMatrixWorld();
  const E = TUTO_BORNES.ecran;
  const yc = DECORS.height * 0.5;
  const n = getCount();
  let best = -1;
  let dmin = Infinity;
  for (let i = 0; i < n; i++) {
    const x = BORNE_X[i];
    const z = BORNE_Z[i];
    V.set(x, yc, z).project(cam);
    if (!(V.z > -1 && V.z < 1)) continue; // derrière la caméra ou hors de ses plans
    if (V.x > E.x || V.x < -E.x || V.y > E.haut || V.y < E.bas) continue;
    const dx = x - P.x;
    const dz = z - P.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < dmin) {
      dmin = d2;
      best = i;
    }
  }
  if (best < 0) return;
  VIS[0] = best;
  VIS[1] = BORNE_X[best];
  VIS[2] = BORNE_Z[best];
  VIS[3] = dmin;
}

/** dt réel de l'image (s), écrit par consignes.update avant sync (aucun flottant passé en argument, § V). */
export const DT = new Float64Array(1);

/**
 * Chaque image (consignes.update), DÈS LE LANCEMENT, flèche visible ou non. mode : CACHEE (cachée net), MONTREE (suit
 * VIS : chercherBorne() appelée avant), SORTIE (fondu).
 * SANS BRANCHE : tous les calculs et toutes les écritures tournent à chaque appel, l'état ne fait que CHOISIR entre des
 * valeurs déjà calculées. Mesuré (22/11, %GetOptimizationStatus) : avec des branches d'apparition, de glissé et de
 * sortie jamais parcourues avant la 1re apparition, la fonction optimisée (Maglev) était désoptimisée à cette image
 * (aucun retour de type dans ces branches) et restait en code de base pendant toute la bulle : chaque flottant emballé,
 * ≈ 900 o par image.
 */
export function syncFleche(mode) {
  if (sprite === null) return;
  const F = TUTO_BORNES.fleche;
  const d0 = DT[0];
  const dt = d0 > 0 ? d0 : 0;
  // toutes les lectures et toutes les comparaisons AVANT les choix (aucune lecture de tableau sautée par un « && » : retour de type complet)
  const phLu = S[S_PH];
  const v0 = VIS[0];
  const v1 = VIS[1];
  const v2 = VIS[2];
  const pret = PRET[PRET_I];
  const cCache = mode === CACHEE;
  const cMontre = mode === MONTREE;
  const cBorne = v0 >= 0;
  const cPrete = pret === v0; // la borne désignée est « prête » : l'invite de la touche prend le relais
  const ph0 = cCache ? PH_CACHE : phLu; // cachée net : retour à la phase cachée, sans fondu
  const cVisible = ph0 === PH_VISIBLE;
  const vise = cMontre && cBorne && !cPrete ? 1 : 0;
  const cible = vise === 1 ? v0 : -1;
  const appar = vise === 1 && !cVisible ? 1 : 0; // apparition (ou retour pendant la sortie) : posée, pop
  const sort = vise === 0 && cVisible ? 1 : 0; // début du fondu de sortie
  const t0 = S[S_T] + dt;
  const x0 = S[S_X];
  const z0 = S[S_Z];
  const i0 = S[S_I];
  const al0 = S[S_ALPHA];
  const op0 = S[S_OP];
  S[S_T] = appar === 1 ? dt : sort === 1 ? 0 : cCache ? 0 : t0;
  S[S_BOB] += dt;
  // glissé exponentiel vers la borne désignée (calculé à chaque image, gardé seulement quand une borne est visée)
  const k = 1 - Math.exp(-dt / F.glisse);
  const gx = x0 + (v1 - x0) * k;
  const gz = z0 + (v2 - z0) * k;
  S[S_X] = appar === 1 ? v1 : vise === 1 ? gx : x0;
  S[S_Z] = appar === 1 ? v2 : vise === 1 ? gz : z0;
  S[S_I] = vise === 1 ? cible : cCache ? -1 : i0;
  S[S_ALPHA] = sort === 1 ? op0 : al0;
  apparitions += appar;
  let ph = vise === 1 ? PH_VISIBLE : sort === 1 ? PH_SORTIE : ph0;
  const t = S[S_T];
  // entrée : fondu + easeOutBack (en ligne : aucun flottant passé à une fonction, § V) ; sortie : fondu, léger recul
  const qp = t / F.pop;
  const q = qp < 1 ? qp : 1;
  const c1 = F.rebond;
  const x = q - 1;
  const scE = 0.35 + 0.65 * (1 + (c1 + 1) * x * x * x + c1 * x * x);
  const ae = t / F.entree;
  const aE = ae < 1 ? ae : 1;
  const qq = t / F.sortie;
  const qs = qq < 1 ? qq : 1;
  const aS = (sort === 1 ? op0 : al0) * (1 - qs);
  const scS = 1 - 0.15 * qs;
  const finie = qs >= 1;
  const enSortie = ph === PH_SORTIE;
  ph = enSortie && finie ? PH_CACHE : ph;
  S[S_PH] = ph;
  const pV = ph === PH_VISIBLE;
  const pS = ph === PH_SORTIE;
  const a = pV ? aE : pS ? aS : 0;
  const sc = pV ? scE : pS ? scS : 1;
  S[S_OP] = a;
  S[S_SC] = sc;
  // hauteur de l'image : part fixe de l'écran (H × pxArt720 / 720), convertie en unités du monde par la projection ;
  // en perspective, × la profondeur de la pointe (taille fixe à l'écran quelle que soit la distance)
  const cam = camera.threeCamera;
  const yPointe = DECORS.height + F.leve;
  V.set(S[S_X], yPointe, S[S_Z]).applyMatrix4(cam.matrixWorldInverse);
  const vz = -V.z;
  const prof = vz > 0.01 ? vz : 0.01;
  const persp = cam.isPerspectiveCamera === true;
  S[S_PRF] = persp ? prof : 1;
  const hy = ((((H * F.pxArt720) / 720) * 2) / cam.projectionMatrix.elements[5]) * S[S_PRF];
  const unArt = hy / H; // un pixel d'art, en unités du monde (dans le plan de la caméra)
  const bob = F.flottement.amplitude * (0.5 + 0.5 * Math.sin((S[S_BOB] * 6.283185307179586) / F.flottement.periode));
  sprite.position.x = S[S_X];
  sprite.position.y = yPointe + bob * unArt;
  sprite.position.z = S[S_Z];
  sprite.scale.x = hy * sc * (W / H);
  sprite.scale.y = hy * sc;
  sprite.scale.z = 1;
  const vis = a > 0.002;
  S[S_VIS] = vis ? 1 : 0;
  mat.opacity = S[S_VIS] * a; // (toujours un flottant : la représentation du champ ne change pas à l'apparition)
  sprite.visible = vis;
}

/** Tests : état de la flèche et de la recherche (hors combat : alloue). */
export function inspect(out = {}) {
  out.phase = ['cachee', 'visible', 'sortie'][S[S_PH]];
  out.visible = sprite !== null && sprite.visible;
  out.opacite = mat !== null ? mat.opacity : 0;
  out.echelle = S[S_SC];
  out.x = S[S_X];
  out.z = S[S_Z];
  out.y = sprite !== null ? sprite.position.y : 0;
  out.scaleY = sprite !== null ? sprite.scale.y : 0;
  out.borne = S[S_I];
  out.vis = VIS[0];
  out.visX = VIS[1];
  out.visZ = VIS[2];
  out.apparitions = apparitions;
  out.recherches = recherches;
  out.hauteurPx720 = H * TUTO_BORNES.fleche.pxArt720;
  return out;
}

/** Tests et planches : position à l'écran (px CSS) de la pointe de la flèche et du centre de la borne désignée. */
export function ecran(out = {}) {
  if (camera === null || sprite === null) return out;
  const cam = camera.threeCamera;
  const el = document.querySelector('canvas');
  const r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const px = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(cam);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  };
  out.pointe = px(sprite.position.x, sprite.position.y, sprite.position.z);
  if (S[S_I] >= 0 && S[S_I] < getCount()) out.borne = px(BORNE_X[S[S_I]], DECORS.height * 0.5, BORNE_Z[S[S_I]]);
  out.hautPx = sprite.scale.y; // (unités du monde)
  return out;
}
//#endregion e5:AE-tuto-bornes
