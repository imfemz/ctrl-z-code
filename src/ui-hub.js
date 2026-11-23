// PLAN ADDICTIF, ÉTAPE 4, CHANTIER B : le hub « Noyau » (ARCHITECTURE.md § E4.B) — ouvert depuis l'écran titre, quatre
// onglets : Agents (ouvre l'écran Agents : grille et fiches, src/ui.js et src/ui-agents-fiche.js), Collection (74 cases, « ? » tant que rien n'est
// vu, fiche à droite), Succès (tous, progression chiffrée), Déblocages (achats en Cycles, API du chantier A).
//
// Règles : tout est du DOM, construit UNE fois par build() (à l'init de ui.js), rempli à l'ouverture et après chaque
// action (fill) — jamais par image, jamais en combat (le hub ne s'ouvre que de l'écran titre). Aucun stockage, aucun
// écouteur clavier : les touches passent par main.js (STATE.HUB) qui appelle tab(), move(), confirm(). Lit ctx.meta et
// ctx.defis ; les achats et le choix de l'agent passent par les actions de main.js (sons, stockage, garde d'état).
// Lisibilité (correctif de l'étape 3, R13a) : la case ou la carte visée se voit au cadre et à la lueur, jamais en
// éteignant son texte.
import {
  AGENTS, AGENT_COUNT, AGENT_SCREEN, DEFIS, DEFI_COND, DEFI_COUNT, DEFI_RECOMP, ENEMIES, ENEMY_COUNT, EVOLUTIONS, FUSIONS,
  HUB, ITEMS, ITEM_KEYS, META, META_BUY, RARITIES, UTILITIES, WEAPONS, WEAPON_KEYS, ARSENALS,
  DEBLOCAGES, MONNAIE, PALIERS, SUCCES_UI, montant, TEXTES_N,
} from './config.js';
import { SKIN_UI } from './config.js'; // skins (tâche 5)
import { SUCCES_RECOMPENSE } from './config.js'; // § E5.E.5 : boîte de la récompense d'un succès
import { EVOLUTION_UI } from './config.js'; // § E5.W : « niv. max » de la recette
import { CAUSE_COUNT, CAUSE_GROUPE, RETOURS_GUIDE } from './config.js'; // § E5.Q : morts par cause (fiche d'un robot)

const T = HUB.textes;
const SVG_NS = 'http://www.w3.org/2000/svg';
// onglets relus par leur clé (HUB.onglets) : réordonner les onglets ne décale rien
const ongletCle = (key) => HUB.onglets.findIndex((o) => o.key === key);
const TAB_AGENTS = ongletCle('agents');
const TAB_COLLECTION = ongletCle('collection');
const TAB_SUCCES = ongletCle('succes');
const TAB_DEBLOCAGES = ongletCle('deblocages');

let D = null; // fabriques et modules passés par ui.js : { el, icon, pressable, hex, audio, actions, meta, defis }
let view = null; // dernière vue de main.js : { best, agent, cycles… }
let rootNode = null;
let fond = null; // couche 0 de la parallaxe
let panneau = null; // couche 1
let soldeNum = null;
let soldeTotal = null;
let soldeUnite = null; // § E4.N.1 : « PIXEL » / « PIXELS » (accord)
let piedJouer = null;
let piedJouerLabel = null;
let ficheBox = null;
const fiche = {}; // nœuds de la fiche de la Collection
const ongletBtns = [];
const contenus = []; // un conteneur par onglet (couche 2 de la parallaxe : celui de l'onglet ouvert)
// Éléments navigables, par onglet : { node, row, col, kind, key, idx, … } ; rangées calculées à la construction
const items = [[], [], [], []];
const rows = [[], [], [], []]; // rows[t][r] = indices dans items[t]
const famCompte = []; // nœud « vus / total » de chaque famille
let tabIdx = 0;
let zone = 'tabs'; // 'tabs' : ← / → changent d'onglet ; 'grid' : les flèches parcourent l'onglet
const sel = new Int32Array(4); // case visée par onglet
// § E5 noyau-selection (demande de Femz du 17/11 : « cliquer sur un item ; quand on survole d'autres items, ça reste sur l'item
// sélectionné qu'on a cliqué ») : case FIXÉE par onglet (clic, ou Entrée au clavier), −1 = aucune. Onglet à détail
// (Collection : fiche de droite) : le détail montre la case fixée ; sans case fixée, il suit la case visée (survol,
// flèches) comme avant. Une case fixée est marquée (sr-fixe) ; le survol ne déplace plus rien, les flèches déplacent la
// visée (sr-sel) sans toucher au détail. Remise à −1 à chaque ouverture du Noyau. Succès et Déblocages n'ont pas de
// détail au survol : non concernés. (L'onglet Agents ouvre l'écran Agents, tâche 5 : il n'a pas de cases ici.)
const fixe = new Int32Array(4).fill(-1);
/** Case dont l'onglet t montre le détail : la case fixée s'il y en a une, sinon la case visée. */
function cible(t) {
  return fixe[t] >= 0 && fixe[t] < items[t].length ? fixe[t] : sel[t];
}
let resetEtape = 0; // confirmations de « Réinitialiser la progression » (0 = repos)
let flipRefus = false;
const succesRows = [];
const venteCards = [];
let resetBtn = null;
const tmpProg = { valeur: 0, seuil: 0, fait: false, partie: false };
const forSaleList = [];
const agentVigs = []; // § E4.L.2 : { img, a } vignettes « agent » des récompenses (silhouette si verrouillé)

function el(tag, cls, text) {
  return D.el(tag, cls, text);
}
/** § E4.N.1 : le glyphe de la monnaie, un pixel FUI dessiné en CSS (.sr-px), jamais un caractère. */
function pxGlyphe() {
  const g = el('span', 'sr-px');
  g.setAttribute('aria-hidden', 'true');
  return g;
}
/** Montant : le pixel FUI puis le nombre (hors combat : le Noyau ne s'ouvre que de l'écran titre). */
function setMontant(node, n) {
  node.replaceChildren(pxGlyphe(), document.createTextNode(fmt(n)));
  // § E4.S.9 : l'icône + le chiffre ; « 212 Pixels » en bulle au survol et au focus clavier (ui.css, data-bulle),
  // et pour les lecteurs d'écran (aria-label). Plus de title : la bulle du navigateur doublait la nôtre.
  node.dataset.bulle = montant(n, fmt(n));
  node.setAttribute('aria-label', node.dataset.bulle);
  node.removeAttribute('title');
}

/** Nombre en chiffres groupés par milliers (espace insécable : présente dans les polices pixel). */
export function fmt(n) {
  const s = String(Math.max(0, Math.floor(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ' ';
    out += s[i];
  }
  return out;
}

/** Accord : « 1 détruit », « 2 détruits » (formes = [singulier, pluriel]). § E4.I.5 */
export function pluriel(n, formes) {
  return fmt(n) + ' ' + (Math.floor(n) <= 1 ? formes[0] : formes[1]);
}

/** Durée de jeu : « 36 min », « 2 h 05 ». */
function duree(sec) {
  const m = Math.floor(Math.max(0, sec) / 60);
  if (m < 60) return m + ' min';
  const r = m % 60;
  return Math.floor(m / 60) + ' h ' + (r < 10 ? '0' : '') + r;
}

// ----- Navigation reconstruite au remplissage (onglets Succès et Déblocages, § E4.I) --------------------------------
function bindNav(t, node) {
  if (node.__srNav) return;
  node.__srNav = true;
  node.addEventListener('pointerenter', () => {
    if (tabIdx !== t) return;
    const k = items[t].findIndex((x) => x.node === node);
    if (k < 0) return;
    zone = 'grid';
    select(k, false);
  });
}
function resetNav(t) {
  items[t].length = 0;
  rows[t].length = 0;
}
function pushNav(t, node, r, extra) {
  while (rows[t].length <= r) rows[t].push([]);
  const it = Object.assign({ node, row: r, col: rows[t][r].length }, extra);
  rows[t][r].push(items[t].length);
  items[t].push(it);
  bindNav(t, node);
  return it;
}
function clampSel(t) {
  if (sel[t] >= items[t].length) sel[t] = Math.max(0, items[t].length - 1);
}

function date(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (x) => (x < 10 ? '0' : '') + x;
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

/** Succès dont la récompense est `key` avec la sorte `sorte` (−1 : aucun). */
function succesPour(key, sorte) {
  for (let s = 0; s < DEFI_COUNT; s++) if (DEFIS.list[s].reward === key && DEFIS.list[s].sorte === sorte) return s;
  return -1;
}

/**
 * Progression d'un succès vue du hub (hors partie) : les cumuls viennent des statistiques de la méta, les vagues du
 * record ; un succès « dans une partie » sans record gardé montre seulement s'il est réussi. `best` : vague record.
 */
export function progressHub(s, best, out = tmpProg) {
  const Dd = DEFIS.list[s];
  const meta = D.meta;
  const st = meta.getStats();
  out.seuil = Dd.n;
  out.fait = meta.hasSucces(s);
  out.partie = !Dd.cumul;
  let v = 0;
  switch (Dd.cond) {
    case DEFI_COND.VAGUE: {
      // § E4.T.5 a : le record (gardé par « Réinitialiser la progression ») ne compte que SOUS le seuil — au-delà il
      // montrerait « 5 / 5 » pour un succès non accordé ; les statistiques de la méta, elles, repartent de zéro
      const r = best | 0;
      v = r < Dd.n ? r : 0;
      for (let a = 0; a < AGENT_COUNT; a++) if (st.meilleureVagueAgent[a] > v) v = st.meilleureVagueAgent[a];
      out.partie = false; // le record EST la meilleure partie
      break;
    }
    case DEFI_COND.KILLS_CUMUL:
      v = st.kills;
      break;
    case DEFI_COND.KILLS_TYPE:
      v = st.killsByType[Dd.arg] | 0;
      break;
    case DEFI_COND.COFFRES:
      v = st.coffres;
      break;
    case DEFI_COND.ELITES:
      v = st.elites;
      break;
    case DEFI_COND.EVOLUTIONS:
      v = meta.evolutionCount();
      out.partie = false;
      break;
    default:
      v = out.fait ? Dd.n : 0;
  }
  if (out.fait) v = Math.max(v, Dd.n);
  out.valeur = Math.min(Dd.n, v);
  return out;
}

/** Texte de la progression : « 1 240 / 2 000 » ; « dans une seule partie » si rien n'est gardé d'une partie à l'autre. */
function progText(p) {
  if (p.partie && !p.fait) return T.dansPartie + ' · 0 / ' + fmt(p.seuil);
  return fmt(p.valeur) + ' / ' + fmt(p.seuil);
}

/** La voie d'un élément verrouillé : « Succès : Purge de masse », « En vente : 120 Cycles »… (clé 'arme:rail'). */
export function voie(key) {
  const meta = D.meta;
  const s = succesPour(key, DEFI_RECOMP.DEBLOQUE);
  if (s >= 0) return T.viaSucces + DEFIS.list[s].name + ' (' + DEFIS.list[s].texte.toLowerCase() + ')';
  if (key in META.prix) {
    const prix = montant(META.prix[key], fmt(META.prix[key])); // § E4.N.1 : « 120 Pixels »
    if (meta.isForSale(key)) return T.enVente + prix;
    const v = succesPour(key, DEFI_RECOMP.VENTE);
    if (v >= 0) return T.viaSucces + DEFIS.list[v].name + T.puisVente + prix;
    return T.enVente + prix;
  }
  return '';
}

/**
 * Condition d'un agent verrouillé : { texte, prog } (« Pour le débloquer : atteindre la vague 5 », « vague record 3 / 5 »).
 * court : le texte du succès seul (« Atteindre la vague 5 ») — carte de la grille de l'écran Agents.
 */
export function agentCondition(a, best, court) {
  const s = succesPour('agent:' + AGENTS[a].key, DEFI_RECOMP.DEBLOQUE);
  if (s < 0) return { texte: '', prog: '' };
  const p = progressHub(s, best, {});
  const Dd = DEFIS.list[s];
  const unite = Dd.cond === DEFI_COND.VAGUE ? 'vague record ' : '';
  const suffixe = Dd.cond === DEFI_COND.KILLS_CUMUL ? ' robots' : '';
  const texte = court ? Dd.texte : T.pourDebloquer + Dd.texte.charAt(0).toLowerCase() + Dd.texte.slice(1);
  return { texte, prog: unite + fmt(p.valeur) + ' / ' + fmt(p.seuil) + suffixe };
}

/**
 * Condition d'un skin verrouillé { texte, prog } : le texte de son succès, et « pas encore débloqué ». court : le texte du
 * succès seul (« Détruire le boss de rang 2 avec le Shinobi ») — fiche de l'écran Agents (tâche 6).
 */
export function skinCondition(agentKey, skinKey, court) {
  const s = succesPour('skin:' + agentKey + ':' + skinKey, DEFI_RECOMP.DEBLOQUE);
  if (s < 0) return { texte: '', prog: '' };
  const Dd = DEFIS.list[s];
  return { texte: court ? Dd.texte : T.pourDebloquer + Dd.texte.charAt(0).toLowerCase() + Dd.texte.slice(1), prog: SKIN_UI.pasEncore };
}

function icone(id) {
  return D.icon(id);
}

function img(src, cls) {
  const i = el('img', cls);
  i.src = src;
  i.alt = '';
  i.draggable = false;
  return i;
}

/** Nom affiché d'une clé ('arme:rail' → 'Fusil à rail'). */
function nomCle(key) {
  return D.defis.rewardName(key);
}

// ----- Construction (une fois) ---------------------------------------------------------------------------------------

/** Construit l'écran ; rend son nœud (ui.js l'ajoute comme SCREEN.HUB). deps : voir D. */
export function build(deps) {
  D = deps;
  const scr = el('div', 'sr-screen sr-hub');
  rootNode = scr;
  fond = el('div', 'sr-hub-fond');
  scr.appendChild(fond);
  panneau = el('div', 'sr-hub-panneau');

  // En-tête : chemin FUI, titre, solde de Cycles
  const head = el('div', 'sr-hub-head');
  const titre = el('div', 'sr-hub-titre');
  titre.append(el('div', 'sr-hub-chemin', HUB.chemin), el('h2', null, HUB.bouton));
  if (HUB.lead) titre.appendChild(el('p', 'sr-lead', HUB.lead)); // § E4.N.2 : sous-titre retiré (HUB.lead vide)
  const solde = el('div', 'sr-hub-solde');
  soldeNum = el('span', 'sr-num sr-hub-solde-num', '0');
  const ligne = el('div', 'sr-hub-solde-ligne');
  soldeUnite = el('span', 'sr-hub-solde-unite', HUB.monnaie);
  const gly = el('span', 'sr-hub-solde-glyphe');
  gly.appendChild(pxGlyphe());
  ligne.append(gly, soldeNum, soldeUnite);
  soldeTotal = el('div', 'sr-hub-solde-total', '');
  solde.append(ligne, soldeTotal);
  head.append(titre, solde);
  panneau.appendChild(head);

  // Onglets (1 à 4)
  const barre = el('div', 'sr-hub-onglets');
  for (let t = 0; t < HUB.onglets.length; t++) {
    const b = D.pressable(el('button', 'sr-hub-onglet'), () => {
      if (!D.actions.hubGuard()) return;
      zone = 'tabs';
      tab(t, true);
    });
    // menus « Pile » (19/11, Femz) : aucune touche affichée dans les menus (les touches 1 à 4 marchent toujours)
    b.append(el('span', 'sr-hub-onglet-nom', HUB.onglets[t].label));
    ongletBtns.push(b);
    barre.appendChild(b);
  }
  panneau.appendChild(barre);

  const corps = el('div', 'sr-hub-corps');
  const zoneContenu = el('div', 'sr-hub-zone');
  for (let t = 0; t < 4; t++) {
    const c = el('div', 'sr-hub-contenu sr-hub-contenu-' + HUB.onglets[t].key);
    contenus.push(c);
    zoneContenu.appendChild(c);
  }
  // Écran Agents (tâche 5) : l'onglet Agents n'a plus de contenu ici — il ouvre l'écran Agents (tab, D.actions.agentsOuvrir)
  buildCollection(contenus[TAB_COLLECTION]);
  buildSucces(contenus[TAB_SUCCES]);
  buildDeblocages(contenus[TAB_DEBLOCAGES]);
  ficheBox = buildFiche();
  corps.append(zoneContenu, ficheBox);
  panneau.appendChild(corps);

  const pied = el('div', 'sr-hub-pied');
  pied.appendChild(D.button('Retour', 'sr-btn', () => {
    D.audio.play(D.SFX.UI_CLICK);
    D.actions.quitHub();
  })); // menus « Pile » : sans touche affichée (Échap revient toujours)
  piedJouer = D.button(T.jouer, 'sr-btn sr-primary', () => D.actions.hubPlay()); // l'agent de départ (« Jouer · <agent> »)
  piedJouerLabel = piedJouer.querySelector('.sr-btn-label');
  pied.appendChild(piedJouer);
  panneau.appendChild(pied);
  scr.appendChild(panneau);
  return scr;
}

/** Ajoute un élément navigable à l'onglet t, à la rangée r. */
function addItem(t, node, r, extra) {
  const k = items[t].length;
  while (rows[t].length <= r) rows[t].push([]);
  const it = Object.assign({ node, row: r, col: rows[t][r].length }, extra);
  rows[t][r].push(k);
  items[t].push(it);
  node.addEventListener('pointerenter', () => {
    if (tabIdx !== t) return;
    if (fixe[t] >= 0) return; // § E5 noyau-selection : une case fixée garde le détail ; le survol ne déplace rien
    zone = 'grid';
    select(k, false);
  });
  return it;
}

function agentVerrou(a) {
  return D.meta.agentVerrouille(a);
}

function caseNode(ic) {
  const b = D.pressable(el('button', 'sr-hub-case'), () => {});
  const icBox = el('span', 'sr-hub-case-ic');
  if (ic) icBox.appendChild(ic);
  b.append(icBox, el('span', 'sr-hub-case-q', T.inconnu), el('span', 'sr-hub-cadenas'));
  return b;
}

function buildCollection(box) {
  const C = HUB.colonnes.collection;
  let r = 0;
  for (let f = 0; f < HUB.familles.length; f++) {
    const F = HUB.familles[f];
    const sec = el('div', 'sr-hub-famille');
    const h = el('div', 'sr-hub-famille-titre');
    const compte = el('span', 'sr-num sr-hub-famille-compte', '');
    h.append(el('span', null, F.label), compte);
    famCompte.push(compte);
    const grille = el('div', 'sr-hub-grille');
    grille.style.setProperty('--cols', String(C));
    const liste = familleListe(F.key);
    for (let i = 0; i < liste.length; i++) {
      const e = liste[i];
      const node = caseNode(e.ic);
      grille.appendChild(node);
      const it = addItem(TAB_COLLECTION, node, r + Math.floor(i / C), e);
      it.fam = f;
      node.addEventListener('click', () => {
        if (!D.actions.hubGuard()) return;
        zone = 'grid';
        const k = items[TAB_COLLECTION].indexOf(it);
        fixe[TAB_COLLECTION] = k; // § E5 noyau-selection : la fiche reste sur la case cliquée
        select(k, false);
        D.audio.play(D.SFX.UI_OPEN);
      });
    }
    r += Math.ceil(liste.length / C);
    sec.append(h, grille);
    box.appendChild(sec);
  }
}

/** Éléments d'une famille de la Collection : { kind, key, idx, ic, nom }. */
function familleListe(fam) {
  const out = [];
  if (fam === 'arme') for (let w = 0; w < WEAPONS.length; w++) out.push({ kind: 'arme', key: 'arme:' + WEAPON_KEYS[w], idx: w, ic: icone('sr-w' + w) });
  else if (fam === 'evo') for (let e = 0; e < EVOLUTIONS.length; e++) out.push({ kind: 'evo', key: 'evo:' + EVOLUTIONS[e].key, idx: e, ic: icone('sr-e' + e) }); // 21/11 : icône de l'évolution
  //#region e5:AL-retrait-cryogel
  // objet retiré (Cryogel) et fusion fermée (Orage glacé) : hors de la Collection (ni case, ni compte)
  else if (fam === 'objet') for (let i = 0; i < ITEMS.length; i++) { if (ITEMS[i].retire !== true) out.push({ kind: 'objet', key: 'objet:' + ITEM_KEYS[i], idx: i, ic: icone('sr-m-' + ITEM_KEYS[i]) }); }
  else if (fam === 'fusion') for (let f = 0; f < FUSIONS.length; f++) { if (FUSIONS[f].enabled !== false) out.push({ kind: 'fusion', key: 'fusion:' + FUSIONS[f].key, idx: f, ic: icone('sr-m-' + FUSIONS[f].key) }); }
  //#endregion e5:AL-retrait-cryogel
  else if (fam === 'agent') for (let a = 0; a < AGENT_COUNT; a++) out.push({ kind: 'agent', key: 'agent:' + AGENTS[a].key, idx: a, ic: img(AGENT_SCREEN.portraits[a], 'sr-hub-portrait') });
  else if (fam === 'robot') for (let t = 0; t < ENEMY_COUNT; t++) out.push({ kind: 'robot', key: 'robot:' + t, idx: t, ic: img(HUB.robotPortraits + t + '.png', 'sr-hub-portrait sr-hub-robot') });
  return out;
}

function buildFiche() {
  const f = el('div', 'sr-hub-fiche sr-cadre');
  fiche.kicker = el('div', 'sr-hub-fiche-kicker', '');
  fiche.ic = el('div', 'sr-hub-fiche-ic');
  fiche.nom = el('div', 'sr-hub-fiche-nom', '');
  fiche.desc = el('p', 'sr-hub-fiche-desc', '');
  fiche.l1 = el('p', 'sr-hub-fiche-ligne', '');
  fiche.l2 = el('p', 'sr-hub-fiche-ligne', '');
  fiche.voie = el('p', 'sr-hub-fiche-voie', '');
  // § E5.W (Femz, 21/11 : recettes « comme img 2 ») : la recette en formule à icônes — la fabrique commune
  // (src/ui-recette.js, passée par ui.js : D.creerFormule), celle de la fenêtre d'infos
  fiche.recBox = el('div', 'sr-hub-fiche-recette');
  fiche.recLab = el('div', 'sr-hub-fiche-recette-lab', '');
  fiche.rec = D.creerFormule();
  const [ingA, op, ingB] = fiche.rec.racine.children;
  // « niv. max » en petit à côté de l'arme tant que la recette n'est pas faite (évolution à objet)
  fiche.cond = el('span', 'sr-evo-cond', '');
  fiche.cond.style.display = 'none';
  ingA.appendChild(fiche.cond);
  // fiche étroite : le « + » part avec B — « + B » passe à la ligne en entier, jamais un « + » seul en bout de ligne
  // (textContent inchangé : « A + B → R »)
  ingB.prepend(op);
  fiche.recBox.append(fiche.recLab, fiche.rec.racine);
  fiche.recBox.style.display = 'none';
  const haut = el('div', 'sr-hub-fiche-haut');
  const id = el('div', 'sr-hub-fiche-id');
  id.append(fiche.kicker, fiche.nom);
  haut.append(fiche.ic, id);
  f.append(haut, fiche.desc, fiche.recBox, fiche.l1, fiche.l2, fiche.voie);
  return f;
}

// ----- Succès (§ E4.I.7 : synthèse à gauche, filtres, liste à vignettes, sections) ------------------------------------
const SU = SUCCES_UI;
const synth = {};
const filtreBtns = [];
const sectionNodes = {}; // reussis / enCours / verrouilles
let succesListe = null;
let filtreSucces = 0; // 0 tous, 1 verrouillés, 2 réussis

/** Vignette : 'robot:<type>', 'agent:<clé>' ou id d'icône. */
function vignette(spec) {
  if (spec.startsWith('robot:')) return img(HUB.robotPortraits + spec.slice(6) + '.png', 'sr-hub-portrait sr-hub-robot');
  if (spec.startsWith('agent:')) {
    const a = AGENTS.findIndex((x) => x.key === spec.slice(6));
    const im = img(AGENT_SCREEN.portraits[a >= 0 ? a : 0], 'sr-hub-portrait');
    agentVigs.push({ img: im.tagName === 'IMG' ? im : im.querySelector('img'), a: a >= 0 ? a : 0 }); // § E4.L.2
    return im;
  }
  return icone(spec);
}

/** Vignette de la récompense d'un succès (clé 'agent:bastion', 'skin:shinobi:ombre', 'arme:rail', 'evo:…', 'fusion:…'). */
function rewardSpec(key) {
  const i = key.indexOf(':');
  const kind = key.slice(0, i);
  const k = key.slice(i + 1);
  if (kind === 'agent') return 'agent:' + k;
  if (kind === 'skin') return 'agent:' + k.slice(0, k.indexOf(':')); // portrait de l'agent du skin
  if (kind === 'arme') return 'sr-w' + WEAPON_KEYS.indexOf(k);
  if (kind === 'objet') return 'sr-m-' + k;
  if (kind === 'util') return 'sr-u-' + k;
  if (kind === 'evo') {
    const e = EVOLUTIONS.findIndex((x) => x.key === k);
    return e >= 0 ? 'sr-e' + e : 'sr-w0'; // 21/11 : icône de l'évolution
  }
  if (kind === 'fusion') return 'sr-m-' + k;
  return 'sr-b-default';
}

// ----- § E5.E.5 : récompense d'un succès — boîte qui la décrit, et lien vers sa case -----------------------------------
/** Ligne courte de la chose débloquée (desc ≤ 12 mots du chantier N ; agent : sa phrase ; recette : sa règle courte). */
function texteRecompense(key) {
  if (SUCCES_RECOMPENSE.courtes[key]) return SUCCES_RECOMPENSE.courtes[key];
  const i = key.indexOf(':');
  const kind = key.slice(0, i);
  const k = key.slice(i + 1);
  if (kind === 'agent') {
    const A = AGENTS.find((x) => x.key === k);
    return A && A.lines && A.lines[0] ? A.lines[0] : '';
  }
  if (kind === 'evo') return (EVOLUTIONS.find((x) => x.key === k) || { rule: '' }).rule;
  if (kind === 'fusion') return (FUSIONS.find((x) => x.key === k) || { rule: '' }).rule;
  return venteDesc(key);
}

/** La boîte : « Nom : ligne courte », puis le montant en Pixelz en petit (pièce + chiffre). Construite une fois. */
function recompenseBoite(key) {
  const b = el('span', 'sr-hub-succes-lien');
  const t = el('span', 'sr-hub-succes-lien-txt');
  t.append(el('span', 'sr-hub-succes-lien-nom', nomCle(key)), document.createTextNode(' : ' + texteRecompense(key)));
  b.appendChild(t);
  if (SUCCES_RECOMPENSE.montantVisible) {
    const val = el('span', 'sr-num sr-hub-succes-val sr-montant', '');
    setMontant(val, META.bareme.succes);
    b.appendChild(val);
  }
  return b;
}

/**
 * Clic sur la boîte ou la case de la récompense du succès s (ou Entrée sur sa ligne) : l'onglet où vit la chose s'ouvre
 * et sa case est visée ET fixée (comme un clic, § E5 noyau-selection). Objet, arme, évolution, fusion → Collection, même
 * pas encore découverte (sa case « ? » et sa fiche d'inconnue) ; agent ou skin → la fiche de l'agent sur l'écran Agents
 * (skin : ce skin visé ; « Retour » : la grille, puis le Noyau sur cet onglet) ; mis en
 * vente, ou bonus au sol → Déblocages (sa catégorie se déplie si elle était repliée). Rend true si la case est trouvée.
 */
function allerRecompense(s) {
  const Dd = DEFIS.list[s];
  const key = Dd.reward;
  const kind = key.slice(0, key.indexOf(':'));
  if (kind === 'agent' || kind === 'skin') {
    const parts = key.split(':');
    const a = AGENTS.findIndex((A) => A.key === parts[1]);
    if (a < 0) return false;
    D.audio.play(D.SFX.UI_OPEN);
    return D.actions.agentsOuvrir('noyau', a, kind === 'skin' ? parts[2] : undefined);
  }
  const t = Dd.sorte === DEFI_RECOMP.VENTE || kind === 'util' ? TAB_DEBLOCAGES : TAB_COLLECTION;
  if (t === TAB_DEBLOCAGES) {
    const cat = cats.find((c) => c.cartes.some((n) => venteCards[n].key === key));
    if (cat && !cat.ouvert) {
      cat.ouvert = true;
      catFermees.delete(cat.key);
      ecrireFermees();
      navDeblocages();
    }
  }
  const k = items[t].findIndex((x) => x.key === key && x.kind !== 'cat');
  if (k < 0) return false;
  D.audio.play(D.SFX.UI_OPEN);
  tab(t, false);
  zone = 'grid';
  fixe[t] = k;
  select(k, true);
  return true;
}

function synthLigne(parent, ic, label) {
  const row = el('div', 'sr-hub-synth-ligne');
  const icb = el('span', 'sr-hub-synth-ic');
  icb.appendChild(icone(ic));
  const txt = el('div', 'sr-hub-synth-txt');
  const val = el('div', 'sr-num sr-hub-synth-val', '');
  txt.append(el('div', 'sr-hub-synth-lab', label), val);
  row.append(icb, txt);
  parent.appendChild(row);
  return val;
}

function buildSucces(box) {
  const page = el('div', 'sr-hub-succes-page');
  // synthèse (gauche)
  const side = el('aside', 'sr-hub-synth');
  const haut = el('div', 'sr-hub-synth-haut');
  const ic = el('span', 'sr-hub-synth-gros-ic');
  ic.appendChild(icone('sr-i-trophee'));
  synth.pct = el('span', 'sr-num sr-hub-synth-pct', '0 %');
  haut.append(ic, synth.pct);
  synth.sous = el('div', 'sr-hub-synth-sous', '');
  const tete = el('div', 'sr-hub-synth-tete');
  tete.append(haut, synth.sous);
  side.appendChild(tete);
  synth.enCours = synthLigne(side, 'sr-i-sablier', SU.textes.enCours);
  synth.recomp = synthLigne(side, 'sr-i-lock', SU.textes.recompenses);
  synth.gagnes = synthLigne(side, 'sr-i-pixel', MONNAIE.nom + ' ' + SU.textes.gagnes);
  synth.gagnes.parentNode.previousSibling.replaceChildren(pxGlyphe()); // § E5.E.4 : la pièce animée, pas l'icône cel
  synth.gagnes.classList.add('sr-montant');
  synth.temps = synthLigne(side, 'sr-i-horloge', SU.textes.temps);
  // filtres + liste (droite)
  const droite = el('div', 'sr-hub-succes-col');
  const filtres = el('div', 'sr-hub-filtres');
  for (let f = 0; f < SU.filtres.length; f++) {
    const b = D.pressable(el('button', 'sr-hub-filtre'), () => {
      if (!D.actions.hubGuard()) return;
      setFiltre(f, true);
    });
    b.append(el('span', 'sr-hub-filtre-nom', SU.filtres[f].label), el('span', 'sr-num sr-hub-filtre-n', ''));
    filtreBtns.push(b);
    filtres.appendChild(b);
  }
  succesListe = el('div', 'sr-hub-succes-liste');
  for (const k of ['reussis', 'enCours', 'verrouilles']) {
    const h = el('div', 'sr-hub-section sr-hub-section-' + k);
    h.append(el('span', 'sr-hub-section-nom', SU.sections[k]), el('span', 'sr-hub-section-filet'));
    sectionNodes[k] = h;
  }
  synth.vide = el('p', 'sr-lead sr-hub-succes-vide', SU.textes.vide);
  for (let s = 0; s < DEFI_COUNT; s++) {
    const Dd = DEFIS.list[s];
    const row = D.pressable(el('button', 'sr-hub-succes'), () => {
      if (!D.actions.hubGuard()) return;
      const k = items[TAB_SUCCES].findIndex((x) => x.kind === 'succes' && x.idx === s);
      if (k < 0) return;
      zone = 'grid';
      select(k, false);
    });
    const vig = el('span', 'sr-hub-succes-vig');
    vig.appendChild(vignette(SU.vignettes[Dd.key] || 'sr-b-default'));
    const txt = el('div', 'sr-hub-succes-txt');
    const nom = el('div', 'sr-hub-succes-nom', Dd.name);
    const cond = el('div', 'sr-hub-succes-cond', Dd.texte);
    const recomp = el('div', 'sr-hub-succes-recomp', '');
    const barre = el('div', 'sr-hub-succes-barre');
    const rempli = el('div', 'sr-hub-succes-rempli');
    barre.appendChild(rempli);
    const prog = el('div', 'sr-num sr-hub-succes-prog', '');
    const progBox = el('div', 'sr-hub-succes-progbox');
    progBox.append(barre, prog);
    txt.append(nom, cond, recomp, progBox);
    // § E5.E.5 : à la place du seul montant, une petite boîte qui dit ce que le succès débloque (nom + ligne courte),
    // le montant en Pixelz en petit dedans ; elle et la case de la récompense mènent à la chose (allerRecompense)
    const lien = recompenseBoite(Dd.reward);
    const rec = el('span', 'sr-hub-succes-rec');
    rec.appendChild(vignette(rewardSpec(Dd.reward)));
    for (const n of [lien, rec]) {
      n.setAttribute('role', 'link');
      n.title = '';
      n.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!D.actions.hubGuard()) return;
        allerRecompense(s);
      });
    }
    row.append(vig, txt, lien, rec);
    succesRows.push({ row, prog, progBox, rempli, recomp, cond, s, etat: 'verrouilles' });
  }
  droite.append(filtres, succesListe, synth.vide);
  page.append(side, droite);
  box.appendChild(page);
}

function setFiltre(f, sound) {
  if (!(f >= 0 && f < SU.filtres.length)) return false;
  if (sound) D.audio.play(D.SFX.UI_CLICK);
  filtreSucces = f;
  fillSucces();
  paintSel();
  return true;
}

function venteIcone(key) {
  const i = key.indexOf(':');
  const kind = key.slice(0, i);
  const k = key.slice(i + 1);
  if (kind === 'arme') return icone('sr-w' + WEAPON_KEYS.indexOf(k));
  if (kind === 'objet') return icone('sr-m-' + k);
  if (kind === 'util') return icone('sr-u-' + k);
  return icone('sr-b-default');
}

function venteDesc(key) {
  const i = key.indexOf(':');
  const kind = key.slice(0, i);
  const k = key.slice(i + 1);
  if (kind === 'arme') return WEAPONS[WEAPON_KEYS.indexOf(k)].desc;
  if (kind === 'objet') return ITEMS[ITEM_KEYS.indexOf(k)].desc;
  if (kind === 'util') {
    const u = UTILITIES.list.find((x) => x.key === k);
    return u && u.desc ? u.desc : ''; // § E4.N.2 : chaque bonus au sol a sa propre ligne (UTILITIES.list[k].desc)
  }
  return '';
}

// ----- Déblocages (§ E4.I.4 d : catégories dépliables, définies par DEBLOCAGES.categories) ---------------------------
const cats = []; // { key, label, head, chev, compte, grille, cartes: [n…], ouvert }
let catFermees = null; // Set des catégories repliées (gardé par main.js : actions.prefLire / prefEcrire)

function lireFermees() {
  if (catFermees) return catFermees;
  catFermees = new Set();
  const raw = D.actions.prefLire(DEBLOCAGES.cleOuverture); // main.js (try/catch) : null si le stockage est indisponible
  for (const k of raw ? raw.split(',') : []) if (k) catFermees.add(k);
  return catFermees;
}

function ecrireFermees() {
  D.actions.prefEcrire(DEBLOCAGES.cleOuverture, [...catFermees].join(',')); // stockage indisponible : vaut pour la session
}

function catDe(key) {
  for (const C of DEBLOCAGES.categories) for (const pre of C.prefixes) if (key.startsWith(pre)) return C.key;
  return null;
}

function palierDe(key) {
  const p = PALIERS.find((x) => x.key === (META.palier && META.palier[key]));
  return p ? p.label : '';
}

/** Pour qui est le déblocage : « Arsenal : Éclaireur » (arme) ou « Tous les agents » (objet, utilitaire). */
export function pourQui(key) {
  if (key.startsWith('arme:')) {
    const ars = arsenalDe(key.slice(5));
    return ars.length ? DEBLOCAGES.arsenal + ars.join(', ') : '';
  }
  return DEBLOCAGES.tous;
}

function buildDeblocages(box) {
  const fermees = lireFermees();
  const keys = Object.keys(META.prix).sort((a, b) => META.prix[a] - META.prix[b] || a.localeCompare(b));
  for (const C of DEBLOCAGES.categories) {
    const sec = el('div', 'sr-hub-cat');
    const head = D.pressable(el('button', 'sr-hub-cat-tete'), () => {
      if (!D.actions.hubGuard()) return;
      const k = items[TAB_DEBLOCAGES].findIndex((x) => x.node === head);
      zone = 'grid';
      if (k >= 0) sel[TAB_DEBLOCAGES] = k;
      basculer(cat);
    });
    const chev = el('span', 'sr-hub-cat-chev');
    const compte = el('span', 'sr-num sr-hub-cat-compte', '');
    head.append(chev, el('span', 'sr-hub-cat-nom', C.label), compte);
    const grille = el('div', 'sr-hub-vitrine');
    const cat = { key: C.key, label: C.label, sec, head, chev, compte, grille, cartes: [], ouvert: !fermees.has(C.key) };
    sec.append(head, grille);
    box.appendChild(sec);
    cats.push(cat);
    for (const key of keys) {
      if (catDe(key) !== C.key) continue;
      const n = venteCards.length;
      const card = el('div', 'sr-hub-vente sr-facet');
      card.dataset.key = key; // tests et lecture : la carte se retrouve par sa clé, quel que soit l'ordre des catégories
      const haut = el('div', 'sr-hub-vente-haut');
      const ic = el('span', 'sr-hub-vente-ic');
      ic.appendChild(venteIcone(key));
      const id = el('div', 'sr-hub-vente-id');
      id.append(el('div', 'sr-hub-vente-sorte', sorteNom(key) + ' · ' + palierDe(key)), el('div', 'sr-hub-vente-nom', nomCle(key)));
      haut.append(ic, id);
      const desc = el('div', 'sr-hub-vente-desc', venteDesc(key));
      const qui = el('div', 'sr-hub-vente-qui', pourQui(key));
      const bas = el('div', 'sr-hub-vente-bas');
      const prix = el('span', 'sr-num sr-hub-vente-prix sr-montant', '');
      setMontant(prix, META.prix[key]);
      const btn = D.button(T.debloquer, 'sr-btn sr-hub-vente-btn', () => {
        if (!D.actions.hubGuard()) return;
        const k = items[TAB_DEBLOCAGES].findIndex((x) => x.node === card);
        zone = 'grid';
        if (k >= 0) select(k, false);
        acheter(n);
      }); // menus « Pile » : sans touche affichée (Entrée achète toujours)
      const etat = el('div', 'sr-hub-vente-etat', '');
      bas.append(prix, btn);
      card.append(haut, desc, qui, etat, bas);
      grille.appendChild(card);
      venteCards.push({ card, prix, btn, btnLabel: btn.querySelector('.sr-btn-label'), btnKey: btn.querySelector('.sr-key'), etat, key });
      cat.cartes.push(n);
    }
  }
  resetBtn = D.button(T.reset, 'sr-btn sr-hub-reset', () => {
    if (!D.actions.hubGuard()) return;
    zone = 'grid';
    select(items[TAB_DEBLOCAGES].length - 1, false);
    reinitialiser();
  });
  box.appendChild(resetBtn);
  navDeblocages();
}

/** Navigation de l'onglet : en-tête de chaque catégorie visible, puis ses cartes (si dépliée), puis « Réinitialiser ». */
function navDeblocages() {
  const C3 = HUB.colonnes.deblocages;
  resetNav(TAB_DEBLOCAGES);
  fixe[TAB_DEBLOCAGES] = -1; // § E5.E.5 : la navigation est reconstruite, ses indices changent
  let r = 0;
  for (const cat of cats) {
    const vide = cat.cartes.length === 0;
    cat.sec.style.display = vide ? 'none' : ''; // Cosmétiques : cachée tant qu'elle est vide
    if (vide) continue;
    cat.grille.style.display = cat.ouvert ? '' : 'none';
    cat.chev.textContent = cat.ouvert ? '▾' : '▸';
    cat.head.setAttribute('aria-expanded', cat.ouvert ? 'true' : 'false');
    pushNav(TAB_DEBLOCAGES, cat.head, r++, { kind: 'cat', key: cat.key, cls: 'sr-hub-cat-tete' + (cat.ouvert ? ' sr-ouvert' : '') });
    if (!cat.ouvert) continue;
    for (let j = 0; j < cat.cartes.length; j++) {
      const n = cat.cartes[j];
      pushNav(TAB_DEBLOCAGES, venteCards[n].card, r + Math.floor(j / C3), { kind: 'vente', key: venteCards[n].key, idx: n, cls: 'sr-hub-vente sr-facet' });
    }
    r += Math.ceil(cat.cartes.length / C3);
  }
  pushNav(TAB_DEBLOCAGES, resetBtn, r, { kind: 'reset', idx: -1, cls: 'sr-btn sr-hub-reset' });
  clampSel(TAB_DEBLOCAGES);
}

function basculer(cat) {
  cat.ouvert = !cat.ouvert;
  if (cat.ouvert) catFermees.delete(cat.key);
  else catFermees.add(cat.key);
  ecrireFermees();
  D.audio.play(cat.ouvert ? D.SFX.UI_OPEN : D.SFX.UI_CLICK);
  navDeblocages();
  fillDeblocages();
  paintSel();
  return cat.ouvert;
}

function sorteNom(key) {
  const k = key.slice(0, key.indexOf(':'));
  return k === 'arme' ? 'Arme' : k === 'objet' ? 'Objet passif' : k === 'util' ? 'Utilitaire' : k === 'agent' ? 'Agent' : '';
}

// ----- Remplissage (ouverture, après une action) ------------------------------------------------------------------------

/** Vue de main.js : { best (vague record), agent (agent de départ), playable }. Rafraîchit tous les onglets. */
export function fill(v, fresh) {
  view = v;
  if (fresh) {
    zone = 'tabs';
    resetEtape = 0;
    fixe.fill(-1); // § E5 noyau-selection : rien de fixé à l'ouverture…
    // l'onglet Agents ouvre l'écran Agents : jamais l'onglet ouvert à l'ouverture du Noyau (Collection à sa place)
    tab(Number.isInteger(v.tab) && v.tab !== TAB_AGENTS ? v.tab : tabIdx !== TAB_AGENTS ? tabIdx : TAB_COLLECTION, false);
  }
  const meta = D.meta;
  const solde = meta.getCycles();
  soldeNum.textContent = fmt(solde);
  soldeUnite.textContent = (Math.abs(solde) <= 1 ? MONNAIE.un : MONNAIE.nom).toUpperCase(); // « 1 PIXEL », « 212 PIXELS »
  soldeUnite.parentNode.dataset.bulle = montant(solde, fmt(solde)); // § E4.S.9 : mot caché, bulle « 212 Pixels »
  // § E4.N.2 : « N gagnés depuis le début » seulement s'il dit autre chose que le solde (après un achat)
  const tot = cyclesTotal();
  soldeTotal.textContent = tot !== solde ? pluriel(tot, ['gagné depuis le début', T.gagnes]) : '';
  majJouer();
  fillCollection();
  fillSucces();
  fillDeblocages();
  paintSel();
}

function cyclesTotal() {
  const i = D.meta.inspect();
  return i.data.cyclesTotal | 0;
}

/** « Jouer · <agent de départ> » au pied du Noyau. */
function majJouer() {
  const A = AGENTS[view && view.agent >= 0 && view.agent < AGENT_COUNT ? view.agent : 0];
  piedJouerLabel.textContent = T.jouer + ' · ' + A.name;
  const k = piedJouer.querySelector('.sr-key');
  if (k) k.style.display = 'none';
  piedJouer.style.setProperty('--ac', D.hex(A.accent));
}

/** État d'une case de la Collection : { vu, revele, verrou }. */
function etatCase(it, out) {
  const meta = D.meta;
  out.vu = false;
  out.revele = false;
  out.verrou = false;
  if (it.kind === 'arme') {
    out.vu = meta.isSeen(it.key);
    out.verrou = !meta.isUnlocked('arme', WEAPON_KEYS[it.idx]);
  } else if (it.kind === 'objet') {
    out.vu = meta.isSeen(it.key);
    out.verrou = !meta.isUnlocked('objet', ITEM_KEYS[it.idx]);
  } else if (it.kind === 'evo') {
    out.vu = meta.isDiscovered('evolutions', EVOLUTIONS[it.idx].id);
    out.revele = !out.vu && meta.isRevealed(it.key);
  } else if (it.kind === 'fusion') {
    out.vu = meta.isDiscovered('fusions', FUSIONS[it.idx].id);
    out.revele = !out.vu && meta.isRevealed(it.key);
  } else if (it.kind === 'agent') {
    out.verrou = it.idx !== 0 && !meta.isUnlocked('agent', AGENTS[it.idx].key);
    out.vu = !out.verrou;
  } else if (it.kind === 'robot') {
    out.vu = meta.isSeen(it.key);
  }
  return out;
}

const tmpEtat = { vu: false, revele: false, verrou: false };

function fillCollection() {
  const list = items[TAB_COLLECTION];
  const vus = new Int32Array(HUB.familles.length);
  const tot = new Int32Array(HUB.familles.length);
  for (let k = 0; k < list.length; k++) {
    const it = list[k];
    const e = etatCase(it, tmpEtat);
    it.vu = e.vu;
    it.revele = e.revele;
    it.verrou = e.verrou;
    tot[it.fam]++;
    if (e.vu) vus[it.fam]++;
    let cls = 'sr-hub-case';
    if (e.vu) cls += ' sr-vu';
    if (e.revele) cls += ' sr-revele';
    if (e.verrou) cls += ' sr-verrou';
    it.cls = cls;
    it.node.setAttribute('aria-label', e.vu || e.revele ? nomCase(it) : T.inconnu);
  }
  for (let f = 0; f < famCompte.length; f++) famCompte[f].textContent = vus[f] + ' / ' + tot[f];
}

function nomCase(it) {
  if (it.kind === 'arme') return WEAPONS[it.idx].name;
  if (it.kind === 'objet') return ITEMS[it.idx].name;
  if (it.kind === 'evo') return EVOLUTIONS[it.idx].name;
  if (it.kind === 'fusion') return FUSIONS[it.idx].name;
  if (it.kind === 'agent') return AGENTS[it.idx].name;
  if (it.kind === 'robot') return ENEMIES.types[it.idx].name;
  return '';
}

function arsenalDe(wkey) {
  const out = [];
  for (const a of AGENTS) if (ARSENALS[a.key] && ARSENALS[a.key].indexOf(wkey) >= 0) out.push(a.name);
  return out;
}

const NIV_MAX = ' ' + EVOLUTION_UI.nivMax; // espace : « Blaster niv. max + … » au texte lu
/**
 * § E5.W : recette dans la fiche — étiquette, puis [icône] A + [icône] B → [icône] résultat (D.recetteEvolution /
 * D.recetteFusion, src/ui-recette.js par ui.js). kind 'evo' | 'fusion' ; faite : l'évolution a été réussie (sinon
 * « niv. max » près de l'arme).
 */
function ficheRecette(lab, kind, idx, faite) {
  fiche.recLab.textContent = lab;
  fiche.rec.poser(kind === 'evo' ? D.recetteEvolution(idx) : D.recetteFusion(idx));
  const c = kind === 'evo' && !faite && !!EVOLUTIONS[idx].item;
  fiche.cond.textContent = c ? NIV_MAX : ''; // vide quand caché : le texte lu reste « A + B → R »
  fiche.cond.style.display = c ? '' : 'none';
  fiche.recBox.style.display = '';
}

/** Remplit la fiche de droite pour la case it de la Collection. */
function fillFiche(it) {
  const famille = HUB.familles[it.fam].label;
  fiche.ic.replaceChildren();
  const visible = it.vu || it.revele;
  if (visible) {
    const c = it.node.querySelector('.sr-hub-case-ic').firstChild;
    if (c) fiche.ic.appendChild(c.cloneNode(true));
  } else fiche.ic.appendChild(el('span', 'sr-hub-case-q', T.inconnu));
  fiche.kicker.textContent = famille + (it.verrou ? ' · ' + T.verrou : it.revele ? ' · ' + T.revele : '');
  fiche.recBox.style.display = 'none'; // § E5.W : rien de révélé → pas de recette
  let nom = T.inconnu;
  let desc = '';
  let l1 = '';
  let l2 = '';
  let v = '';
  if (it.kind === 'arme') {
    const W = WEAPONS[it.idx];
    if (it.vu || it.verrou) nom = W.name; // le nom d'une arme verrouillée est public (onglet Déblocages)
    desc = it.vu ? W.detail || W.desc : TEXTES_N.pasObtenue;
    if (it.vu) {
      const ars = arsenalDe(W.key);
      l1 = ars.length ? 'Arsenal : ' + ars.join(', ') : '';
      const e = EVOLUTIONS.findIndex((x) => x.weapon === W.key || x.partner === W.key);
      const E = e >= 0 ? EVOLUTIONS[e] : null;
      const faite = !!E && D.meta.isDiscovered('evolutions', E.id);
      if (E && (faite || D.meta.isRevealed('evo:' + E.key))) ficheRecette(T.evolutionLab, 'evo', e, faite); // § E5.W
    }
    if (it.verrou) v = voie(it.key);
  } else if (it.kind === 'objet') {
    const I = ITEMS[it.idx];
    if (it.vu || it.verrou) nom = I.name;
    desc = it.vu ? I.detail || I.desc : TEXTES_N.pasObtenu;
    if (it.vu) {
      l1 = TEXTES_N.rang + RARITIES[I.tier].name + ' (' + (I.tier + 1) + '/' + RARITIES.length + ')'; // § E5.L (C18) : le rang
      l2 = I.pile ? TEXTES_N.parNiveau + I.pile : '';
    }
    if (it.verrou) v = voie(it.key);
  } else if (it.kind === 'evo') {
    const E = EVOLUTIONS[it.idx];
    if (visible) {
      nom = E.name;
      ficheRecette(T.recette, 'evo', it.idx, it.vu); // § E5.W : en icônes (était « Recette : A (niveau max) + B »)
      desc = it.vu ? E.rule : TEXTES_N.recetteRevelee;
    } else desc = TEXTES_N.evoInconnue;
  } else if (it.kind === 'fusion') {
    const F = FUSIONS[it.idx];
    if (visible) {
      nom = F.name;
      ficheRecette(T.recette, 'fusion', it.idx, it.vu); // § E5.W
      desc = it.vu ? F.rule : TEXTES_N.recetteRevelee;
    } else desc = TEXTES_N.fusionInconnue;
  } else if (it.kind === 'agent') {
    const A = AGENTS[it.idx];
    nom = A.name;
    desc = A.lines[0];
    l1 = 'Rôle : ' + A.role;
    l2 = 'Passif : ' + A.passive.name;
    if (it.verrou) {
      const c = agentCondition(it.idx, view ? view.best : 0);
      v = c.texte + ' · ' + c.prog;
    }
  } else if (it.kind === 'robot') {
    const R = ENEMIES.types[it.idx];
    if (it.vu) {
      nom = R.name;
      desc = R.desc || '';
      l1 = pluriel(D.meta.getStats().killsByType[it.idx] | 0, T.detruit); // § E4.I.5 : « 1 détruit »
      // § E5.Q (Femz, 21/11) : parties perdues sur un coup de ce robot (toutes ses attaques), un chiffre sur sa ligne
      const M = D.meta.getStats().mortsParCause;
      let n = 0;
      if (M) for (let c = 1; c < CAUSE_COUNT; c++) if (CAUSE_GROUPE[c] === it.idx) n += M[c] | 0;
      l2 = RETOURS_GUIDE.noyau.avant + n + RETOURS_GUIDE.noyau.apres;
    } else desc = T.jamaisVu;
  }
  fiche.nom.textContent = nom;
  fiche.desc.textContent = desc;
  fiche.l1.textContent = l1;
  fiche.l1.style.display = l1 ? '' : 'none';
  fiche.l2.textContent = l2;
  fiche.l2.style.display = l2 ? '' : 'none';
  fiche.voie.textContent = v;
  fiche.voie.style.display = v ? '' : 'none';
}

function fillSucces() {
  if (D.silhouette) for (const v of agentVigs) D.silhouette(v.img, v.a, agentVerrou(v.a)); // § E4.L.2
  const best = view ? view.best : 0;
  const dates = D.meta.inspect().data.succesDates || {};
  let nReussis = 0;
  let nEnCours = 0;
  for (let s = 0; s < DEFI_COUNT; s++) {
    const r = succesRows[s];
    const p = progressHub(s, best, tmpProg);
    const Dd = DEFIS.list[s];
    r.etat = p.fait ? 'reussis' : p.valeur > 0 ? 'enCours' : 'verrouilles';
    if (p.fait) nReussis++;
    else if (p.valeur > 0) nEnCours++;
    r.base = 'sr-hub-succes sr-' + r.etat;
    r.prog.textContent = progText(p);
    r.rempli.style.width = (p.seuil > 0 ? Math.round((100 * p.valeur) / p.seuil) : 0) + '%';
    r.progBox.style.display = r.etat === 'enCours' ? '' : 'none';
    r.recomp.textContent = D.defis.rewardText(s);
    r.cond.textContent = Dd.texte + (p.fait && dates[Dd.key] ? ' · ' + date(dates[Dd.key]) : '');
  }
  // synthèse
  const st = D.meta.getStats();
  const inf = D.meta.inspect().data;
  synth.pct.textContent = Math.round((100 * nReussis) / DEFI_COUNT) + ' %';
  synth.sous.textContent = nReussis + SU.textes.sur + DEFI_COUNT + SU.textes.reussis;
  synth.enCours.textContent = String(nEnCours);
  let obt = 0;
  let tot = 0;
  for (const kind in META.verrous) for (const k of META.verrous[kind]) {
    tot++;
    if (inf.unlocked.indexOf(kind + ':' + k) >= 0) obt++;
  }
  for (let s = 0; s < DEFI_COUNT; s++) if (DEFIS.list[s].sorte === DEFI_RECOMP.REVELE) {
    tot++;
    if (inf.revealed.indexOf(DEFIS.list[s].reward) >= 0) obt++;
  }
  // skins : récompenses `skin:` des succès (hors META.verrous, hors recettes), une seule fois chacune
  const skinsVus = {};
  for (let s = 0; s < DEFI_COUNT; s++) {
    const r = DEFIS.list[s].reward;
    if (r.indexOf('skin:') !== 0 || skinsVus[r]) continue;
    skinsVus[r] = 1;
    tot++;
    if (inf.unlocked.indexOf(r) >= 0) obt++;
  }
  synth.recomp.textContent = obt + ' / ' + tot;
  setMontant(synth.gagnes, st.cyclesSucces | 0);
  synth.temps.textContent = duree(st.tempsJeu | 0);
  synth.nReussis = nReussis;
  synth.nEnCours = nEnCours;
  synth.nRecomp = obt;
  // filtres : compte par filtre
  const nf = [DEFI_COUNT, DEFI_COUNT - nReussis, nReussis];
  for (let f = 0; f < filtreBtns.length; f++) filtreBtns[f].querySelector('.sr-hub-filtre-n').textContent = String(nf[f]);
  // liste : sections dans l'ordre Réussis, En cours, Verrouillés ; filtre appliqué ; navigation reconstruite
  resetNav(TAB_SUCCES);
  for (let f = 0; f < filtreBtns.length; f++) pushNav(TAB_SUCCES, filtreBtns[f], 0, { kind: 'filtre', idx: f, cls: 'sr-hub-filtre' + (f === filtreSucces ? ' sr-actif' : '') });
  succesListe.replaceChildren();
  let r = 1;
  for (const k of ['reussis', 'enCours', 'verrouilles']) {
    if (filtreSucces === 1 && k === 'reussis') continue;
    if (filtreSucces === 2 && k !== 'reussis') continue;
    let first = true;
    for (let s = 0; s < DEFI_COUNT; s++) {
      const R = succesRows[s];
      if (R.etat !== k) continue;
      if (first) {
        succesListe.appendChild(sectionNodes[k]);
        first = false;
      }
      succesListe.appendChild(R.row);
      pushNav(TAB_SUCCES, R.row, r++, { kind: 'succes', idx: s, cls: R.base });
    }
  }
  synth.vide.style.display = r === 1 ? '' : 'none';
  clampSel(TAB_SUCCES);
}

function fillDeblocages() {
  D.meta.forSale(forSaleList);
  for (const cat of cats) {
    let ok = 0;
    for (const n of cat.cartes) if (D.meta.isUnlocked(venteCards[n].key.slice(0, venteCards[n].key.indexOf(':')), venteCards[n].key.slice(venteCards[n].key.indexOf(':') + 1))) ok++;
    cat.compte.textContent = ok + ' / ' + cat.cartes.length + DEBLOCAGES.compte;
    cat.nOk = ok;
  }
  for (let n = 0; n < venteCards.length; n++) {
    const c = venteCards[n];
    const it = items[TAB_DEBLOCAGES].find((x) => x.node === c.card);
    const f = forSaleList.find((x) => x.key === c.key);
    const etat = f ? f.etat : 'attente';
    c.etatCode = etat;
    let cls = 'sr-hub-vente sr-facet';
    if (etat === 'debloque') cls += ' sr-debloque';
    else if (etat === 'attente') cls += ' sr-attente';
    else if (D.meta.getCycles() < META.prix[c.key]) cls += ' sr-pauvre';
    c.cls = cls;
    if (it) it.cls = cls;
    c.btnLabel.textContent = etat === 'debloque' ? T.debloque : T.debloquer;
    c.btn.disabled = etat !== 'vente';
    c.btn.style.display = etat === 'attente' ? 'none' : '';
    c.etat.textContent = etat === 'attente' && f && f.succes >= 0 ? T.attente + 'succès « ' + DEFIS.list[f.succes].name + ' »' : '';
    if (etat === 'vente' && D.meta.getCycles() < META.prix[c.key]) c.etat.textContent = T.tropPauvre;
    c.etat.style.display = c.etat.textContent ? '' : 'none';
  }
  const last = items[TAB_DEBLOCAGES][items[TAB_DEBLOCAGES].length - 1];
  last.cls = resetEtape > 0 ? 'sr-btn sr-hub-reset sr-hub-reset-arme' : 'sr-btn sr-hub-reset';
  resetBtn.querySelector('.sr-btn-label').textContent = resetEtape > 0 ? T.resetConfirm[resetEtape - 1] : T.reset;
}

/** Classes de base + sélection (cadre et lueur seulement, R13a). */
function paintSel() {
  for (let t = 0; t < 4; t++) {
    const list = items[t];
    for (let k = 0; k < list.length; k++) {
      const it = list[k];
      const base = it.cls;
      let want = zone === 'grid' && t === tabIdx && k === sel[t] ? base + ' sr-sel' : base;
      if (k === fixe[t]) want += ' sr-fixe'; // § E5 noyau-selection : case fixée (clic, Entrée)
      if (it.node.className !== want) it.node.className = want;
    }
  }
  for (let t = 0; t < ongletBtns.length; t++) {
    const want = 'sr-hub-onglet' + (t === tabIdx ? ' sr-actif' : '') + (t === tabIdx && zone === 'tabs' ? ' sr-sel' : '');
    if (ongletBtns[t].className !== want) ongletBtns[t].className = want;
  }
  // fiche : Collection seulement
  ficheBox.style.display = tabIdx === TAB_COLLECTION ? '' : 'none';
  if (tabIdx === TAB_COLLECTION) fillFiche(items[TAB_COLLECTION][cible(TAB_COLLECTION)]); // § E5 noyau-selection
}

// ----- Navigation (main.js) ---------------------------------------------------------------------------------------------

/** Onglet t (0 à 3). sound : clic joué (changement voulu par le joueur). Rend l'onglet ouvert. */
export function tab(t, sound) {
  if (!(t >= 0 && t < 4)) return tabIdx;
  // Écran Agents (tâche 5) : l'onglet Agents ouvre l'écran Agents (état AGENT, origine 'noyau') ; l'onglet ouvert ne
  // change pas — « Retour » y ramène. Ouverture du Noyau (sound faux) : jamais ici (fill passe à la Collection).
  if (t === TAB_AGENTS) {
    if (sound && D.actions.hubGuard()) D.actions.agentsOuvrir('noyau');
    return tabIdx;
  }
  const change = t !== tabIdx;
  tabIdx = t;
  for (let k = 0; k < 4; k++) {
    const d = k === t ? '' : 'none';
    if (contenus[k].style.display !== d) contenus[k].style.display = d;
  }
  if (sound && change) D.audio.play(D.SFX.UI_CLICK);
  resetEtape = 0;
  if (view) {
    fillDeblocages();
    paintSel();
  }
  if (D.onTab) D.onTab(contenus[t]);
  return tabIdx;
}

function select(k, scroll) {
  const list = items[tabIdx];
  if (!(k >= 0 && k < list.length)) return;
  if (sel[tabIdx] !== k && list[k].kind !== 'reset' && resetEtape > 0) {
    resetEtape = 0;
    fillDeblocages();
  }
  sel[tabIdx] = k;
  paintSel();
  if (scroll && typeof list[k].node.scrollIntoView === 'function') list[k].node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Flèches : dx (−1, 0, 1), dy (−1 vers le haut, 1 vers le bas). Rend la zone ('tabs' | 'grid'). */
export function move(dx, dy) {
  if (zone === 'tabs') {
    if (dx !== 0) tab((tabIdx + dx + 4) % 4, true);
    else if (dy > 0) {
      zone = 'grid';
      D.audio.play(D.SFX.UI_CLICK);
      select(sel[tabIdx], true);
    }
    paintSel();
    return zone;
  }
  const list = items[tabIdx];
  const R = rows[tabIdx];
  const it = list[sel[tabIdx]];
  if (dx !== 0) {
    const k = sel[tabIdx] + dx;
    if (k >= 0 && k < list.length) {
      D.audio.play(D.SFX.UI_CLICK);
      select(k, true);
    }
  } else if (dy !== 0) {
    const r = it.row + dy;
    if (r < 0) {
      zone = 'tabs';
      D.audio.play(D.SFX.UI_CLICK);
      paintSel();
    } else if (r < R.length) {
      const row = R[r];
      D.audio.play(D.SFX.UI_CLICK);
      select(row[Math.min(it.col, row.length - 1)], true);
    }
  }
  return zone;
}

/** Entrée : dans les onglets, entre dans la grille ; dans la grille, l'action de la case visée. */
export function confirm() {
  if (zone === 'tabs') return move(0, 1);
  const it = items[tabIdx][sel[tabIdx]];
  // § E5 noyau-selection : Entrée = clic — la case visée devient la case fixée (Agents, Collection)
  if (tabIdx === TAB_COLLECTION) {
    fixe[tabIdx] = sel[tabIdx];
    paintSel();
  }
  if (tabIdx === TAB_DEBLOCAGES) {
    if (it.kind === 'cat') return basculer(cats.find((c) => c.key === it.key));
    return it.kind === 'reset' ? reinitialiser() : acheter(it.idx);
  }
  if (tabIdx === TAB_SUCCES && it.kind === 'filtre') return setFiltre(it.idx, true);
  if (tabIdx === TAB_SUCCES && it.kind === 'succes') return allerRecompense(it.idx); // § E5.E.5 : Entrée = clic sur la récompense
  if (tabIdx === TAB_COLLECTION) D.audio.play(D.SFX.UI_OPEN);
  return true;
}

function acheter(n) {
  const c = venteCards[n];
  const r = D.actions.hubBuy(c.key);
  if (r !== META_BUY.OK) {
    flipRefus = !flipRefus;
    c.prix.classList.remove('sr-refus-a', 'sr-refus-b');
    c.prix.classList.add(flipRefus ? 'sr-refus-a' : 'sr-refus-b');
  }
  return r;
}

function reinitialiser() {
  if (resetEtape < HUB.resetConfirms) {
    resetEtape++;
    D.audio.play(D.SFX.UI_CLICK);
    fillDeblocages();
    paintSel();
    return false;
  }
  resetEtape = 0;
  return D.actions.hubReset();
}

/** Onglet ouvert (jamais Agents : il ouvre l'écran Agents). */
export function onglet() {
  return tabIdx;
}

/** Couches de la parallaxe : fond, panneau, contenu de l'onglet ouvert. */
export function layers() {
  return [fond, panneau, contenus[tabIdx]];
}

/** Pour les tests (hors combat). */
export function inspect(out = {}) {
  out.tab = tabIdx;
  out.zone = zone;
  out.sel = sel[tabIdx];
  out.fixe = fixe[tabIdx]; // § E5 noyau-selection : case fixée de l'onglet ouvert (−1 : aucune)
  out.fixeKey = items[tabIdx][fixe[tabIdx]] ? items[tabIdx][fixe[tabIdx]].key || null : null; // § E5.E.5
  out.selKind = items[tabIdx][sel[tabIdx]] ? items[tabIdx][sel[tabIdx]].kind : null;
  out.selKey = items[tabIdx][sel[tabIdx]] ? items[tabIdx][sel[tabIdx]].key || null : null;
  out.cases = items[TAB_COLLECTION].length;
  out.vus = items[TAB_COLLECTION].filter((i) => i.vu).length;
  out.verrous = items[TAB_COLLECTION].filter((i) => i.verrou).map((i) => i.key);
  out.reveles = items[TAB_COLLECTION].filter((i) => i.revele).map((i) => i.key);
  out.resetEtape = resetEtape;
  out.jouer = piedJouerLabel ? piedJouerLabel.textContent : '';
  out.ficheNom = fiche.nom ? fiche.nom.textContent : '';
  out.ficheVoie = fiche.voie ? fiche.voie.textContent : '';
  out.ficheDesc = fiche.desc ? fiche.desc.textContent : '';
  out.ficheL1 = fiche.l1 ? fiche.l1.textContent : '';
  // § E4.I : onglet Succès et catégories des Déblocages
  out.succes = {
    filtre: filtreSucces,
    pct: synth.pct ? synth.pct.textContent : '',
    sous: synth.sous ? synth.sous.textContent : '',
    enCours: synth.enCours ? synth.enCours.textContent : '',
    recomp: synth.recomp ? synth.recomp.textContent : '',
    gagnes: synth.gagnes ? synth.gagnes.textContent : '',
    temps: synth.temps ? synth.temps.textContent : '',
    lignes: items[TAB_SUCCES].filter((x) => x.kind === 'succes').map((x) => ({ key: DEFIS.list[x.idx].key, etat: succesRows[x.idx].etat })),
    sections: succesListe ? [...succesListe.querySelectorAll('.sr-hub-section')].map((n) => n.textContent) : [],
    filtres: filtreBtns.map((b) => b.textContent),
  };
  out.categories = cats.map((c) => ({ key: c.key, label: c.label, visible: c.sec.style.display !== 'none', ouvert: c.ouvert, compte: c.compte.textContent, cartes: c.cartes.map((n) => venteCards[n].key) }));
  out.familles = HUB.familles.map((f) => f.key);
  return out;
}

export { TAB_AGENTS, TAB_COLLECTION, TAB_SUCCES, TAB_DEBLOCAGES, SVG_NS };
