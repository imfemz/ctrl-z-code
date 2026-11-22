// Étape 5, chantier C (ARCHITECTURE.md § E5.C) — invite « touche » au-dessus de la borne prête à frapper (demande de
// Femz du 17/11 : « un petit icône E qui pop au-dessus quand on est prêt, pour qu'on comprenne »).
//
// Quoi : une touche de clavier en pixel-art (contour clair, face sombre, lèvre, équerre cyan du HUD « carte mère »), la
// lettre de la touche RÉELLEMENT réglée pour « Interagir » (input.codeDe, libellé selon la disposition), une petite
// pointe vers la borne. Une seule invite : sur la borne prête de props (PRET), la plus proche à portée et devant.
// Mouvement : pop (échelle en retour, petit rebond) + fondu d'entrée ; respiration verticale au sous-pixel ; à l'appui,
// la touche s'enfonce (lettre cyan) puis part en fondu ; on s'éloigne : fondu de sortie.
//
// Dessin : UN sprite face caméra (+ 1 appel de dessin quand l'invite est visible, 0 sinon), passé hors de l'effet CRT /
// pixel par render.garderNet (comme les chiffres de dégâts : net, dessiné après la passe finale). Texture : un canvas
// dessiné hors combat (à l'init, et quand la touche ou la disposition change), deux images empilées (touche levée /
// enfoncée) choisies par le décalage de la texture. Taille : une part FIXE de la hauteur de l'écran (pxArt720 pixels
// d'écran par pixel d'art à 720 p, le double à 1440 p), lue dans la matrice de projection (zoom compris).
// Allocation (§ V) : sync n'alloue rien — tableaux typés, champs numériques ; dt lu dans DT (écrit par main.js).
import * as THREE from 'three';
import { DECORS, INTERAGIR, STATE } from './config.js';
import { SFX } from './config.js'; // § E5.G : son de l'apparition
import { ARGF, F_X, F_Z } from './state.js';
import { PRET, PRET_COUPS, PRET_GEN, PRET_I, PRET_KX, PRET_KZ, PRET_X, PRET_Z } from './props.js';

/** dt réel de l'image (s), écrit par main.js avant sync (aucun flottant passé en argument, § V). */
export const DT = new Float32Array(1);

const PRF = new Float64Array(3); // § E5.AB.12 : point de l'invite (profondeur en perspective)
const ART = 4; // pixels du canvas par pixel d'art (mipmaps : net à ×2 — 720 p — et ×4 — 1440 p)
const W = 96; // largeur d'une image, en pixels d'art (libellés jusqu'à 13 caractères)
const HF = 18; // hauteur d'une image, en pixels d'art (touche 16 + pointe 2)
const LIGNE = 'interagir';

let game = null;
let input = null;
let camera = null;
let sprite = null;
let mat = null;
let tex = null;
let canvas = null;
let g2d = null;
let police = 'Determination';
let policePrete = false;
let codeAff = null;
let layoutAff = null;
let labelAff = null;
let dessins = 0;

// état : phase, temps dans la phase, horloge de respiration, position, repères des compteurs de props
const PH_CACHE = 0;
const PH_VISIBLE = 1; // pop puis respiration
const PH_SORTIE = 2;
const PH_APPUI = 3;
const S = new Float64Array(12);
const S_PH = 0;
const S_T = 1;
const S_BOB = 2;
const S_X = 3;
const S_Z = 4;
const S_COUPS = 5;
const S_GEN = 6;
const S_ALPHA = 7; // opacité au début de la sortie (sortie d'une invite pas encore pleine)
const S_SC = 8; // dernières valeurs appliquées (inspect)
const S_OP = 9;
const S_I = 10; // borne suivie (indice de props)
const S_IMG = 11; // 0 levée, 1 enfoncée
let apparitions = 0;
let ctxSon = null; // § E5.G : contexte (ctx.audio lu au moment de jouer)

/** § E5.G : un clic doux à chaque apparition de l'invite (SFX.INVITE, une fois ; minInterval dans config.js). */
function sonApparition() {
  const audio = ctxSon !== null ? ctxSon.audio : null;
  if (!audio) return;
  ARGF[F_X] = S[S_X];
  ARGF[F_Z] = S[S_Z];
  audio.playF(SFX.INVITE);
}

export function init(ctx) {
  ctxSon = ctx;
  game = ctx.game;
  input = ctx.input;
  camera = ctx.camera;
  canvas = document.createElement('canvas');
  canvas.width = W * ART;
  canvas.height = 2 * HF * ART;
  g2d = canvas.getContext('2d', { willReadFrequently: false });
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.repeat.set(1, 0.5);
  tex.offset.set(0, 0.5); // image du haut du canvas : touche levée
  tex.name = 'invite-interagir';
  mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  sprite = new THREE.Sprite(mat);
  sprite.name = 'invite-interagir';
  sprite.center.set(0.5, 0); // ancrée par la pointe (bas de l'image)
  sprite.renderOrder = 1000;
  sprite.frustumCulled = false;
  sprite.visible = false;
  ctx.scene.add(sprite);
  ctx.render.garderNet(sprite); // hors de l'effet CRT / pixel : nette, devant la scène
  S[S_GEN] = PRET[PRET_GEN];
  S[S_COUPS] = PRET[PRET_COUPS];
  verifierLibelle(true);
  // la police pixel du HUD (ui.css) : redessin quand elle est là (avant : repli du système, quelques images au plus)
  if (document.fonts && document.fonts.load) {
    document.fonts.load('120px ' + police).then(
      () => {
        policePrete = document.fonts.check('120px ' + police);
        labelAff = null;
        verifierLibelle(true);
      },
      () => {},
    );
  }
}

/** Libellé de la touche réglée ; redessine si elle (ou la disposition détectée) a changé. Sans allocation sinon. */
function verifierLibelle(force) {
  const c = input.codeDe(LIGNE);
  const lay = input.getLayout();
  if (!force && c === codeAff && lay === layoutAff) return;
  codeAff = c;
  layoutAff = lay;
  const lab = c === '' ? '?' : input.keyLabel(c).toUpperCase();
  if (lab === labelAff && !force) return;
  labelAff = lab;
  dessiner(lab);
}

/** Bitmap 1 bit du libellé : la police pixel tracée à 120 px (briques de 10 px), lue au centre de chaque brique. */
function bitmap(lab) {
  const B = 10; // px par brique à 120 px (Determination : 12 briques par em, avance 7)
  const n = lab.length;
  const cw = n * 7 * B + 4 * B;
  const ch = 16 * B;
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.textBaseline = 'alphabetic';
  g.font = '120px ' + (policePrete ? police : 'monospace');
  const base = 12 * B; // ligne de base : 12 briques sous le haut (accents au-dessus de la capitale de 9)
  g.fillText(lab, B, base);
  const d = g.getImageData(0, 0, cw, ch).data;
  const cols = Math.floor(cw / B);
  const rows = Math.floor(ch / B);
  const bits = new Uint8Array(cols * rows);
  let x0 = cols;
  let x1 = -1;
  let y0 = rows;
  let y1 = -1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const px = i * B + (B >> 1);
      const py = j * B + (B >> 1);
      if (d[(py * cw + px) * 4 + 3] >= 128) {
        bits[j * cols + i] = 1;
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (j < y0) y0 = j;
        if (j > y1) y1 = j;
      }
    }
  }
  if (x1 < 0) return { w: 1, h: 1, haut: 0, bits: new Uint8Array(1) };
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out[j * w + i] = bits[(y0 + j) * cols + x0 + i];
  // haut : rangées au-dessus de la capitale (accents) — la capitale commence à la rangée base − 9 briques
  return { w, h, haut: 3 - y0, bits: out };
}

/** Les deux images de la touche (levée, enfoncée) dans le canvas. Hors combat (init, changement de touche). */
function dessiner(lab) {
  dessins++;
  const K = INTERAGIR.invite.couleurs;
  const g = g2d;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const bm = bitmap(lab);
  const padX = bm.w <= 6 ? 3 : 2;
  let wc = bm.w + 2 * padX + 2;
  if (wc % 2 === 1) wc++;
  if (wc > W) wc = W;
  const x0 = (W - wc) >> 1;
  const px = (x, y, w, h, col) => {
    g.fillStyle = col;
    g.fillRect((x0 + x) * ART, y * ART, w * ART, h * ART);
  };
  for (let f = 0; f < 2; f++) {
    const oy = f * HF; // haut de l'image
    const top = f; // touche enfoncée : la face descend d'un pixel, la lèvre en perd un
    const lip = f === 0 ? 2 : 1;
    const faceH = 13; // contour du haut + 12 rangées de face
    const bas = top + faceH + lip; // rangée du contour du bas (15 dans les deux images)
    // contour (coins coupés), face, lèvre
    px(1, oy + top, wc - 2, 1, K.trait);
    px(0, oy + top + 1, 1, bas - top - 1, K.trait);
    px(wc - 1, oy + top + 1, 1, bas - top - 1, K.trait);
    px(1, oy + bas, wc - 2, 1, K.trait);
    px(1, oy + top + 1, wc - 2, faceH - 1, K.face);
    px(1, oy + top + faceH, wc - 2, lip, K.levre);
    px(1, oy + top + faceH - 1, wc - 2, 1, K.levreTrait); // arête entre la face et la lèvre
    // reflet du haut de la face, équerre cyan (coin haut-gauche, comme les panneaux du HUD)
    px(3, oy + top + 1, wc - 5, 1, K.reflet);
    px(1, oy + top + 1, 2, 1, K.equerre);
    px(1, oy + top + 2, 1, 1, K.equerre);
    // pointe vers la borne
    const cx = wc >> 1;
    px(cx - 2, oy + bas + 1, 4, 1, K.trait);
    px(cx - 1, oy + bas + 2, 2, 1, K.trait);
    // libellé : capitale de 9 rangées à partir de la 2e rangée de face (accents au-dessus, rognés au contour)
    const lx = 1 + ((wc - 2 - bm.w) >> 1);
    const ly = top + 2 - bm.haut;
    g.fillStyle = f === 0 ? K.texte : K.texteAppui;
    for (let j = 0; j < bm.h; j++) {
      const y = ly + j;
      if (y < top + 1 || y > top + faceH - 2) continue;
      for (let i = 0; i < bm.w; i++) if (bm.bits[j * bm.w + i] === 1) g.fillRect((x0 + lx + i) * ART, (oy + y) * ART, ART, ART);
    }
  }
  tex.needsUpdate = true;
}

/** Nouvelle partie, ou retour au titre : l'invite disparaît sans fondu. */
function cacher() {
  S[S_PH] = PH_CACHE;
  S[S_T] = 0;
  S[S_I] = -1;
  sprite.visible = false;
  mat.opacity = 0;
  S[S_OP] = 0;
}

/** F11 : phase, position, taille, opacité, image. Aucune allocation. */
/** Libellé affiché de la touche « Interagir » (même chaîne tant qu'elle ne change pas ; lu par le HUD du palier). */
export function libelle() {
  return labelAff;
}

export function sync() {
  const I = INTERAGIR.invite;
  const dt = DT[0];
  verifierLibelle(false);
  if (PRET[PRET_GEN] !== S[S_GEN]) {
    S[S_GEN] = PRET[PRET_GEN];
    S[S_COUPS] = PRET[PRET_COUPS];
    cacher();
  }
  const st = game.state;
  if (st !== STATE.PLAYING && st !== STATE.WAVE_CLEAR && st !== STATE.COUNTDOWN && st !== STATE.PAUSED) {
    if (S[S_PH] !== PH_CACHE) cacher();
    return;
  }
  S[S_T] += dt;
  S[S_BOB] += dt;
  const pret = PRET[PRET_I];
  // appui : un coup vient de partir à la touche
  if (PRET[PRET_COUPS] !== S[S_COUPS]) {
    S[S_COUPS] = PRET[PRET_COUPS];
    S[S_PH] = PH_APPUI;
    S[S_T] = 0;
    S[S_X] = PRET[PRET_KX];
    S[S_Z] = PRET[PRET_KZ];
  }
  let ph = S[S_PH];
  if (ph === PH_CACHE && pret >= 0) {
    ph = PH_VISIBLE;
    S[S_T] = dt; // l'image de l'apparition compte (visible dès elle)
    S[S_I] = pret;
    S[S_X] = PRET[PRET_X];
    S[S_Z] = PRET[PRET_Z];
    apparitions++;
    sonApparition();
  } else if (ph === PH_VISIBLE) {
    if (pret < 0) {
      ph = PH_SORTIE;
      S[S_ALPHA] = S[S_OP];
      S[S_T] = 0;
    } else if (PRET[PRET_X] !== S[S_X] || PRET[PRET_Z] !== S[S_Z]) {
      // une autre borne devient la plus proche : l'invite saute dessus et repop
      S[S_T] = dt; // l'image de l'apparition compte (visible dès elle)
      S[S_I] = pret;
      S[S_X] = PRET[PRET_X];
      S[S_Z] = PRET[PRET_Z];
      apparitions++;
      sonApparition();
    }
  } else if (ph === PH_SORTIE && pret >= 0) {
    ph = PH_VISIBLE;
    S[S_T] = dt; // l'image de l'apparition compte (visible dès elle)
    S[S_I] = pret;
    S[S_X] = PRET[PRET_X];
    S[S_Z] = PRET[PRET_Z];
    apparitions++;
    sonApparition();
  }
  S[S_PH] = ph;
  const t = S[S_T];
  let a = 0;
  let sc = 1;
  let img = 0;
  if (ph === PH_VISIBLE) {
    a = t < I.entree ? t / I.entree : 1;
    const k = t < I.pop ? t / I.pop : 1;
    // easeOutBack (en ligne : aucun flottant passé à une fonction, § V)
    const c1 = I.rebond;
    const x = k - 1;
    sc = 0.35 + 0.65 * (1 + (c1 + 1) * x * x * x + c1 * x * x);
  } else if (ph === PH_SORTIE) {
    const k = t < I.sortie ? t / I.sortie : 1;
    a = S[S_ALPHA] * (1 - k);
    sc = 1 - 0.15 * k;
    if (k >= 1) ph = PH_CACHE;
  } else if (ph === PH_APPUI) {
    img = 1;
    if (t < I.appui) {
      a = 1;
      sc = 0.96;
    } else {
      const k = (t - I.appui) / I.sortieAppui;
      const kk = k < 1 ? k : 1;
      a = 1 - kk;
      sc = 0.96 + 0.16 * kk;
      if (k >= 1) ph = PH_CACHE;
    }
  }
  S[S_PH] = ph;
  if (ph === PH_CACHE) a = 0;
  S[S_SC] = sc;
  S[S_OP] = a;
  if (a <= 0.002) {
    sprite.visible = false;
    mat.opacity = 0;
    return;
  }
  // hauteur de l'image : part fixe de l'écran (HF × pxArt720 / 720), convertie en unités du monde par la projection
  const e5 = camera.threeCamera.projectionMatrix.elements[5];
  let hy = (((HF * I.pxArt720) / 720) * 2) / e5;
  //#region e5:AB-camera-3p
  // § E5.AB.12 : perspective — e5 = 1 / tan(demi-ouverture) × zoom : la hauteur voulue à l'écran se multiplie par la
  // profondeur du point (taille fixe à l'écran, quelle que soit la distance)
  if (camera.view.persp === 1) {
    PRF[0] = S[S_X];
    PRF[1] = DECORS.height + I.leve;
    PRF[2] = S[S_Z];
    hy *= camera.profondeurT(PRF);
  }
  //#endregion e5:AB-camera-3p
  const unArt = hy / HF; // un pixel d'art, en unités du monde (dans le plan de la caméra)
  const bob = I.flottement.amplitude * Math.sin((S[S_BOB] * 6.283185307179586) / I.flottement.periode);
  sprite.position.x = S[S_X];
  sprite.position.y = DECORS.height + I.leve + bob * unArt;
  sprite.position.z = S[S_Z];
  sprite.scale.x = hy * sc * (W / HF);
  sprite.scale.y = hy * sc;
  sprite.scale.z = 1;
  if (img !== S[S_IMG]) {
    S[S_IMG] = img;
    tex.offset.y = img === 0 ? 0.5 : 0;
  }
  mat.opacity = a;
  sprite.visible = true;
}

/** Tests : état de l'invite, position à l'écran (hors combat : alloue). */
export function inspect(out = {}) {
  out.phase = ['cache', 'visible', 'sortie', 'appui'][S[S_PH]];
  out.visible = sprite.visible;
  out.opacite = mat.opacity;
  out.echelle = S[S_SC];
  out.image = S[S_IMG];
  out.x = S[S_X];
  out.z = S[S_Z];
  out.y = sprite.position.y;
  out.scaleY = sprite.scale.y;
  out.libelle = labelAff;
  out.code = codeAff;
  out.dessins = dessins;
  out.apparitions = apparitions;
  out.policePrete = policePrete;
  out.hauteurPx720 = HF * INTERAGIR.invite.pxArt720;
  return out;
}

/** Tests et planches : le canvas de la texture (les deux images). */
export function canvasTexture() {
  return canvas;
}
