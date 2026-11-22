// Composants de l'interface « carte mère » (ARCHITECTURE.md § E3.J), d'après la référence de Femz
// (tests/.cache/retours-femz/1511-ref-hud-carte-mere.png, FEMZ_1511D) : cartouches à bord vert clair sur fond vert
// sombre translucide, pistes de circuit fines à vias ronds, cases d'arme ou d'objet, barres PV / XP, puce CPU qui bat.
// Les styles sont dans ui.css (bloc « e3:J-refonte-ui », sous html[data-sr-theme='carte-mere']), en rem mesurés sur
// la référence (1 rem = 16 px en 1280 × 720 ; la référence fait 1827 × 861 : 1 px de la référence = 0,0523 rem).
//
// Règles (§ V et § E3.0.5) : tout est construit à l'init (ou à l'ouverture d'un écran, hors combat) ; en combat,
// seule paintPuce écrit, et seulement quand le cran de la puce change (chaînes tirées d'une table faite au chargement).
// N'importe que config.js, comme ui.js. Aucune lecture de mise en page, aucune minuterie, aucun son.
// Utilisés par ui.js (HUD, écrans) et, au groupe 2, par H (jauge .sr-case-cd), I (fiche de la pause), F (fusion),
// B (évolutions) : ils construisent leurs éléments avec ces fabriques plutôt qu'avec du DOM à la main.
import { UI_CARTE } from './config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PU = UI_CARTE.puce;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Cartouche « LIBELLÉ valeur » : bord vert clair, fond vert sombre translucide, police pixel.
 * Renvoie { root, label, value } ; seul value.textContent se réécrit (sur changement).
 */
export function cartouche(label, cls) {
  const root = el('div', cls ? 'sr-cartouche ' + cls : 'sr-cartouche');
  const lab = el('span', 'sr-cartouche-label', label);
  const value = el('span', 'sr-cartouche-value sr-num', '');
  root.append(lab, value);
  return { root, label: lab, value };
}

/**
 * Calque SVG de pistes, dimensionné en rem : 1 unité du viewBox = 1/16 rem (= 1 px en 1280 × 720), donc les traits
 * suivent l'échelle de l'interface sans se déformer. Renvoie le <svg> ; on y ajoute des pistes avec piste().
 */
export function pistes(wRem, hRem, cls) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', cls ? 'sr-pistes ' + cls : 'sr-pistes');
  s.setAttribute('viewBox', '0 0 ' + wRem * 16 + ' ' + hRem * 16);
  s.setAttribute('aria-hidden', 'true');
  s.style.width = wRem + 'rem';
  s.style.height = hRem + 'rem';
  return s;
}

/**
 * Une piste : polyligne (points = [x0, y0, x1, y1, …] en unités du viewBox) et ses vias ronds (indices de points
 * où poser un via ; −1 = les deux bouts). variante : '' (vert), 'jaune' (piste de signal), 'on' (s'allume au rythme
 * de la puce). Construction seulement.
 */
export function piste(parent, points, vias, variante) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', variante ? 'sr-piste sr-piste-' + variante : 'sr-piste');
  const p = document.createElementNS(SVG_NS, 'polyline');
  p.setAttribute('points', points.join(' '));
  g.appendChild(p);
  const list = vias === -1 ? [0, points.length / 2 - 1] : vias || [];
  for (const k of list) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', points[2 * k]);
    c.setAttribute('cy', points[2 * k + 1]);
    c.setAttribute('r', 2.2);
    g.appendChild(c);
  }
  parent.appendChild(g);
  return g;
}

/**
 * Case d'arme ou d'objet (kind : 'arme' | 'objet') : icône (<svg><use>), chiffre (niveau ou piles) et l'enfant
 * .sr-case-cd déjà présent et caché — la jauge horloge du chantier H (variable CSS --sr-cd, 0 → 1).
 * cls : classe imposée (le HUD garde ses classes historiques sr-weapon / sr-item, lues par les tests).
 * Renvoie { root, icon, use, n, cd }.
 */
export function caseSlot(kind, cls, iconId) {
  const root = el('div', cls || 'sr-case sr-case-' + kind);
  root.dataset.kind = kind;
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', 'sr-ic');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG_NS, 'use');
  u.setAttribute('href', '#' + (iconId || ''));
  s.appendChild(u);
  const n = el('span', kind === 'arme' ? 'sr-weapon-level sr-num' : 'sr-item-n sr-num', kind === 'arme' ? '1' : '');
  const cd = el('span', 'sr-case-cd');
  root.append(s, n, cd);
  return { root, icon: s, use: u, n, cd };
}

/**
 * Barre (kind : 'pv' | 'xp') : { root, fill, text }. La largeur se pose par transform: scaleX sur fill (comme les
 * barres du HUD), le texte par text.textContent. PV : cœur pixel à gauche, « 100 / 100 » à droite ; XP : « NIV. n ».
 */
export function barre(kind) {
  const root = el('div', 'sr-barre sr-barre-' + kind);
  if (kind === 'pv') root.appendChild(el('span', 'sr-barre-coeur'));
  const track = el('div', 'sr-barre-piste');
  const fill = el('div', 'sr-barre-fill');
  track.appendChild(fill);
  const text = el('span', 'sr-barre-text sr-num', '');
  root.append(track, text);
  return { root, fill, text };
}

/**
 * Puce CPU à broches (le cœur jaune de la référence) avec sa lueur. Intensité : variable --sr-puce (opacité crête de
 * la lueur, 0 → 1) ; rythme : --sr-puce-s (période de l'animation CSS). Écrites par paintPuce, sur changement.
 * Renvoie { root, lueur }.
 */
export function puce(cls) {
  const root = el('div', cls ? 'sr-puce ' + cls : 'sr-puce');
  const lueur = el('div', 'sr-puce-lueur');
  const broches = el('div', 'sr-puce-broches');
  const corps = el('div', 'sr-puce-corps');
  corps.appendChild(el('div', 'sr-puce-coeur'));
  root.append(lueur, broches, corps);
  return { root, lueur };
}

// Tables faites au chargement : le cran k (0 … steps) → les deux chaînes à écrire. Aucune chaîne fabriquée en combat.
const PUCE_K = [];
const PUCE_S = [];
const PUCE_T = new Float64Array(PU.steps + 1);
for (let k = 0; k <= PU.steps; k++) {
  const t = k / PU.steps;
  PUCE_T[k] = t;
  PUCE_K.push((PU.kMin + (PU.kMax - PU.kMin) * t).toFixed(3));
  PUCE_S.push((1 / (PU.hzMin + (PU.hzMax - PU.hzMin) * t)).toFixed(3) + 's');
}

/** Cran de la puce pour n objets portés et s piles en tout (entier 0 … steps). Pure, sans allocation. */
export function puceStep(items, stacks) {
  const s = stacks < PU.stackCap ? stacks : PU.stackCap;
  let t = PU.perItem * items + PU.perStack * s;
  if (t > 1) t = 1;
  else if (t < 0) t = 0;
  return Math.round(t * PU.steps);
}

/** Intensité et fréquence d'un cran (pour les tests et inspect). */
export function puceValues(step, out) {
  out.t = PUCE_T[step];
  out.k = Number(PUCE_K[step]);
  out.hz = PU.hzMin + (PU.hzMax - PU.hzMin) * PUCE_T[step];
  return out;
}

/** Écrit le cran sur la racine (ou les racines) qui portent les variables ; à n'appeler que si le cran a changé. */
export function paintPuce(node, step) {
  node.style.setProperty('--sr-puce', PUCE_K[step]);
  node.style.setProperty('--sr-puce-s', PUCE_S[step]);
}

/** Creux de l'animation (part de l'intensité crête gardée entre deux battements), posé une fois à l'init. */
export function initPuce(node) {
  node.style.setProperty('--sr-puce-creux', String(PU.creux));
  paintPuce(node, 0);
}
