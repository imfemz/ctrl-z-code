// Recette en FORMULE À ICÔNES (21/11/2026, Femz : « revoir la mise en page, ça fait trop brouillon » sur la ligne
// « Évoluée  Blaster + Viseur thermique → Canon chiffré » coupée en deux) : [icône] ingrédient A + [icône] ingrédient B
// sur une ligne, → [icône] résultat (doré) sur la suivante. Une seule fabrique pour tout le jeu : fenêtre d'infos de la
// pause et du Noyau (ui.js), et les listes du Noyau (Collection, Déblocages) qui veulent la même formule.
//   const f = creerFormule();            // DOM créé une fois (hors combat) : f.racine à insérer où l'on veut
//   f.poser(recetteEvolution(id));       // ou recetteFusion(k) ; textContent = « A + B → R » (phrase lisible par les tests)
// Styles : ui.css (.sr-evo-recette, .sr-evo-ing, .sr-evo-nom, .sr-evo-op, .sr-evo-res). Icônes : symboles du sprite de
// ui.js (#sr-w<arme>, #sr-m-<objet>, #sr-e<évolution>), donc pages où ui.js a posé son sprite.
import { EVOLUTIONS, FUSIONS, ITEMS, WEAPONS, WEAPON_KEYS } from './config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function ingredient(cls) {
  const c = el('span', cls);
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', 'sr-ic');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG_NS, 'use');
  u.setAttribute('href', '#sr-w0');
  s.appendChild(u);
  const n = el('span', 'sr-evo-nom', '');
  c.append(s, n);
  return { c, use: u, nom: n };
}

/** Formule vide : { racine, poser({ a, b, r }) } où a, b, r = { href: '#sr-…', nom }. */
export function creerFormule(clsRacine = 'sr-evo-recette') {
  const racine = el('span', clsRacine);
  const A = ingredient('sr-evo-ing');
  const B = ingredient('sr-evo-ing');
  const R = ingredient('sr-evo-ing sr-evo-res');
  R.c.prepend(el('span', 'sr-evo-op', ' → '));
  racine.append(A.c, el('span', 'sr-evo-op', ' + '), B.c, R.c);
  const mettre = (x, v) => {
    x.use.setAttribute('href', v.href);
    if (x.nom.textContent !== v.nom) x.nom.textContent = v.nom;
  };
  return {
    racine,
    poser(rec) {
      mettre(A, rec.a);
      mettre(B, rec.b);
      mettre(R, rec.r);
    },
  };
}

const arme = (w) => ({ href: '#sr-w' + w, nom: WEAPONS[w].name });
const objet = (i) => ({ href: '#sr-m-' + ITEMS[i].key, nom: ITEMS[i].name });

/** Recette de l'évolution id : arme + objet (ou arme partenaire) → évolution. Préparées une fois. */
const RECETTES_EVO = EVOLUTIONS.map((E, id) => {
  const w = WEAPON_KEYS.indexOf(E.weapon);
  const it = E.item ? ITEMS.findIndex((I) => I.key === E.item) : -1;
  const p = E.partner ? WEAPON_KEYS.indexOf(E.partner) : -1;
  return {
    a: w >= 0 ? arme(w) : { href: '', nom: '?' },
    b: it >= 0 ? objet(it) : p >= 0 ? arme(p) : { href: '', nom: '?' },
    r: { href: '#sr-e' + id, nom: E.name },
  };
});
export function recetteEvolution(id) {
  return RECETTES_EVO[id];
}

/** Recette de la fusion k : objet a + objet b → objet né (même formule). */
const RECETTES_FUSION = FUSIONS.map((F) => ({ a: objet(F.a), b: objet(F.b), r: { href: '#sr-m-' + F.key, nom: F.name } }));
export function recetteFusion(k) {
  return RECETTES_FUSION[k];
}

/** Évolution dont l'arme w est l'arme principale, −1 sinon. */
const EVO_DE_ARME = WEAPONS.map((W, w) => EVOLUTIONS.findIndex((E) => E.weapon === WEAPON_KEYS[w]));
export function evolutionDeArme(w) {
  return w >= 0 && w < EVO_DE_ARME.length ? EVO_DE_ARME[w] : -1;
}
