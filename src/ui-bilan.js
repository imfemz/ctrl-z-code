// PLAN ADDICTIF, ÉTAPE 4, CHANTIER C (ARCHITECTURE.md § E4.C, précisions § E4.C.4) : les deux blocs FUI de l'écran de
// fin — « BILAN DES ARMES » (une ligne par arme : icône, nom, dégâts, kills, part du total en barre de la couleur de
// l'arme ; lueur Root sur la meilleure) et « CYCLES » (barème, total qui monte, solde, record de vague, succès de la
// partie, renvoi vers le Noyau).
//
// Règles (comme ui-hub.js) : DOM construit UNE fois par build() (init de ui.js), rempli par fill() à l'entrée de
// l'écran de fin, jamais en combat ; aucun stockage, aucun écouteur clavier, aucune lecture de mise en page, aucune
// minuterie : la montée des Cycles avance par update(realDt), appelé par ui.update tant que l'écran de fin est affiché.
// Sons : SFX.FRAGMENT (paliers de la montée, au plus toutes les BILAN.sonEvery s) et SFX.UNLOCK (une fois, s'il y a des
// succès dans la partie), joués par l'audio passé par ui.js.
import { BILAN, WEAPON_COUNT, montant } from './config.js';

const T = BILAN.textes;
const LMAX = WEAPON_COUNT + 2; // 18 armes + « Modules et dash » + « Utilitaires »

let D = null; // { el, icon, hex, audio, SFX } passés par ui.js
let root = null;
const rows = []; // { row, use, nom, tag, degats, kills, rempli, pct }
let liste = null;
let vide = null;
const bareme = []; // 4 lignes : { row, lab, val }
let gainVal = null;
let soldeVal = null;
let soldeBox = null; // § E4.S.9 : icône de la monnaie + solde
let gainBox = null; // § E4.S.9 : icône de la monnaie + gain

/** § E4.S.9 : l'icône de la monnaie (le .sr-px du chantier N, devenu l'icône cel par ui.css). */
function pxIcone() {
  const g = el('span', 'sr-px');
  g.setAttribute('aria-hidden', 'true');
  return g;
}
let recordRow = null;
let recordVal = null;
let recordTag = null;
let succesBox = null;
const succesRows = []; // { row, nom, recomp }
let succesTitre = null; // « Succès de la partie », suivi de « +N » (succès non listés) au-delà de BILAN.succesMax
let noyau = null;

// montée des Cycles (hors combat)
const M = { actif: false, t: 0, cible: 0, montre: -1, dernierSon: -1, sons: 0, unlock: 0, aUnlock: false, finie: true };

function el(tag, cls, text) {
  return D.el(tag, cls, text);
}

/** Entier groupé par milliers (espace insécable : présente dans les polices pixel). */
function fmt(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Dixièmes de pour cent → « 42,3 % ». */
function pct(d) {
  return Math.floor(d / 10) + ',' + (d % 10) + ' %';
}

function setText(node, s) {
  if (node.textContent !== s) node.textContent = s;
}

/** Construit les deux blocs ; rend leur conteneur (ui.js le place sous les quatre cases). */
export function build(deps) {
  D = deps;
  root = el('div', 'sr-bilan');

  // 1. BILAN DES ARMES
  const armes = el('section', 'sr-bilan-bloc sr-bilan-armes');
  armes.append(el('div', 'sr-bilan-chemin', T.chemin), el('h3', 'sr-bilan-titre', T.armes));
  const tete = el('div', 'sr-bilan-ligne sr-bilan-tete');
  tete.append(el('span', 'sr-bilan-ic'), el('span', 'sr-bilan-nom', T.cols[0]), el('span', 'sr-bilan-num', T.cols[1]), el('span', 'sr-bilan-num', T.cols[2]), el('span', 'sr-bilan-part', T.cols[3]));
  liste = el('div', 'sr-bilan-liste');
  liste.style.setProperty('--lignes', String(BILAN.lignesMax));
  for (let k = 0; k < LMAX; k++) {
    const row = el('div', 'sr-bilan-ligne');
    const ic = D.icon('sr-w0');
    ic.classList.add('sr-bilan-ic');
    const nomBox = el('span', 'sr-bilan-nom');
    const nom = el('span', 'sr-bilan-nom-txt', '');
    const tag = el('span', 'sr-bilan-tag', '');
    nomBox.append(nom, tag);
    const degats = el('span', 'sr-bilan-num sr-num', '0');
    const kills = el('span', 'sr-bilan-num sr-num', '0');
    const part = el('span', 'sr-bilan-part');
    const barre = el('span', 'sr-bilan-barre');
    const rempli = el('span', 'sr-bilan-rempli');
    barre.appendChild(rempli);
    const p = el('span', 'sr-bilan-pct sr-num', '');
    part.append(barre, p);
    row.append(ic, nomBox, degats, kills, part);
    row.style.display = 'none';
    liste.appendChild(row);
    rows.push({ row, use: ic.firstChild, nom, tag, degats, kills, rempli, pct: p });
  }
  vide = el('p', 'sr-bilan-vide', T.vide);
  armes.append(tete, liste, vide);

  // 2. CYCLES
  const cyc = el('section', 'sr-bilan-bloc sr-bilan-cycles');
  cyc.appendChild(el('h3', 'sr-bilan-titre', T.cycles)); // § E4.N.2 : sans le second « SYSTÈME / BILAN » (doublon)
  for (let k = 0; k < 4; k++) {
    const row = el('div', 'sr-bilan-bareme');
    const lab = el('span', 'sr-bilan-bareme-lab', '');
    const val = el('span', 'sr-bilan-bareme-val sr-num', '');
    row.append(lab, val);
    cyc.appendChild(row);
    bareme.push({ row, lab, val });
  }
  const gain = el('div', 'sr-bilan-gain');
  gainVal = el('span', 'sr-bilan-gain-val sr-num', '+0');
  // § E4.S.9 : la monnaie = son icône (.sr-px, l'icône cel) + le chiffre ; « N Pixels » en bulle au survol (data-bulle)
  gainBox = el('span', 'sr-bilan-montant');
  gainBox.append(pxIcone(), gainVal);
  gain.append(el('span', 'sr-bilan-gain-lab', T.gain), gainBox);
  const solde = el('div', 'sr-bilan-solde');
  soldeVal = el('span', 'sr-num', '0');
  soldeBox = el('span', 'sr-bilan-montant');
  soldeBox.append(pxIcone(), soldeVal);
  solde.append(el('span', null, T.solde), soldeBox);
  recordRow = el('div', 'sr-bilan-record');
  recordVal = el('span', 'sr-num', '');
  recordTag = el('span', 'sr-bilan-record-tag', T.nouveau);
  recordRow.append(el('span', null, T.record), recordVal, recordTag);
  succesBox = el('div', 'sr-bilan-succes');
  succesTitre = el('div', 'sr-bilan-succes-titre', T.succesTitre);
  succesBox.appendChild(succesTitre);
  for (let k = 0; k < BILAN.succesMax; k++) {
    const row = el('div', 'sr-bilan-succes-ligne');
    const nom = el('span', 'sr-bilan-succes-nom', '');
    const recomp = el('span', 'sr-bilan-succes-recomp', '');
    row.append(nom, recomp);
    succesBox.appendChild(row);
    succesRows.push({ row, nom, recomp });
  }
  noyau = el('div', 'sr-bilan-noyau', T.noyau);
  succesBox.append(noyau);
  cyc.append(gain, solde, recordRow, succesBox);

  root.append(armes, cyc);
  return root;
}

/** v : overView de main.js (bilan, best, isNewBest). Hors combat. */
export function fill(v) {
  const b = v.bilan;
  M.actif = false;
  M.finie = true;
  if (!b) {
    root.style.display = 'none';
    return;
  }
  root.style.display = '';
  // tableau
  const n = Math.min(b.lignes.length, LMAX);
  for (let k = 0; k < LMAX; k++) {
    const R = rows[k];
    if (k >= n) {
      R.row.style.display = 'none';
      continue;
    }
    const L = b.lignes[k];
    R.row.style.display = '';
    R.row.className = 'sr-bilan-ligne' + (L.best ? ' sr-bilan-best' : '') + (L.etiquette === T.absorbee ? ' sr-absorbee' : '');
    R.row.style.setProperty('--wc', D.hex(L.couleur));
    R.use.setAttribute('href', '#' + L.icone);
    setText(R.nom, L.nom);
    setText(R.tag, L.etiquette);
    R.tag.style.display = L.etiquette ? '' : 'none';
    setText(R.degats, fmt(L.degats));
    setText(R.kills, fmt(L.kills));
    setText(R.pct, pct(L.dixiemes));
    R.rempli.style.transform = 'scaleX(' + L.dixiemes / 1000 + ')';
  }
  liste.scrollTop = 0;
  liste.classList.toggle('sr-defile', n > BILAN.lignesMax);
  vide.style.display = n === 0 ? '' : 'none';

  // barème (§ E4.I.2) : « Vagues terminées × 5 = 40 », « Boss × 1 = 20 », « Élites × 4 = 14 », « Succès × 2 = 40 »
  const C = b.cycles;
  const nS = b.succes.length;
  setText(bareme[0].lab, T.vague + ' × ' + (C.vagues | 0));
  setText(bareme[1].lab, T.boss + ' × ' + b.boss);
  setText(bareme[2].lab, T.elites + ' × ' + b.elites);
  setText(bareme[3].lab, T.succes + ' × ' + nS);
  setText(bareme[0].val, '= ' + fmt(C.vague));
  setText(bareme[1].val, '= ' + fmt(C.boss));
  setText(bareme[2].val, '= ' + fmt(C.elites));
  setText(bareme[3].val, '= ' + fmt(C.succes));
  setText(soldeVal, fmt(b.solde));
  soldeBox.dataset.bulle = montant(b.solde, fmt(b.solde)); // § E4.S.9
  gainBox.dataset.bulle = '+' + montant(b.compte ? C.total : 0, fmt(b.compte ? C.total : 0));
  gainVal.parentNode.classList.toggle('sr-non-compte', !b.compte);

  // record de vague (§ E4.C.4 point 6)
  const best = v.best;
  recordRow.style.display = best ? '' : 'none';
  if (best) setText(recordVal, String(best.wave));
  recordTag.style.display = v.isNewBest ? '' : 'none';

  // succès de la partie
  for (let k = 0; k < succesRows.length; k++) {
    const S = succesRows[k];
    if (k < nS) {
      S.row.style.display = '';
      setText(S.nom, b.succes[k].nom);
      setText(S.recomp, b.succes[k].recompense);
    } else S.row.style.display = 'none';
  }
  const autres = nS - succesRows.length;
  // sur la ligne du titre : une ligne de plus sortirait le panneau de l'écran en 1280 × 720 (§ E4.C.5)
  setText(succesTitre, T.succesTitre + (autres > 0 ? ' +' + autres : '')); // « Succès de la partie +1 » : tient sur une ligne
  succesBox.style.display = nS > 0 ? '' : 'none';

  // montée
  M.t = 0;
  M.cible = b.compte ? C.total : 0;
  M.dernierSon = -1;
  M.sons = 0;
  M.unlock = 0;
  M.aUnlock = nS > 0;
  if (!b.compte) {
    setText(gainVal, T.nonCompte);
    M.montre = 0;
    return;
  }
  if (M.cible > 0) {
    M.actif = true;
    M.finie = false;
    M.montre = 0;
    setText(gainVal, '+0');
  } else {
    M.montre = 0;
    setText(gainVal, '+0');
  }
}

/** Montée des Cycles : ui.update tant que l'écran de fin est affiché (hors combat). */
export function update(realDt) {
  if (!M.actif || !(realDt > 0)) return;
  M.t += realDt;
  const t = M.t - BILAN.delai;
  if (t < 0) return;
  const k = t >= BILAN.montee ? 1 : t / BILAN.montee;
  const val = k >= 1 ? M.cible : Math.floor(M.cible * k);
  if (val !== M.montre) {
    M.montre = val;
    gainVal.textContent = '+' + fmt(val);
    if (M.dernierSon < 0 || M.t - M.dernierSon >= BILAN.sonEvery) {
      M.dernierSon = M.t;
      M.sons++;
      D.audio.play(D.SFX.FRAGMENT);
    }
  }
  if (k >= 1) {
    M.actif = false;
    M.finie = true;
    if (M.aUnlock) {
      M.unlock++;
      D.audio.play(D.SFX.UNLOCK);
    }
  }
}

/** Tests : ce que l'écran montre (textes) et l'état de la montée. Hors combat. */
export function inspect(out = {}) {
  out.visible = !!root && root.style.display !== 'none';
  out.lignes = [];
  for (const R of rows) {
    if (R.row.style.display === 'none') continue;
    out.lignes.push({
      nom: R.nom.textContent,
      etiquette: R.tag.textContent,
      degats: R.degats.textContent,
      kills: R.kills.textContent,
      part: R.pct.textContent,
      best: R.row.classList.contains('sr-bilan-best'),
      couleur: R.row.style.getPropertyValue('--wc'),
      icone: R.use.getAttribute('href'),
    });
  }
  out.bareme = bareme.map((x) => x.lab.textContent + ' ' + x.val.textContent);
  out.gain = gainVal.textContent;
  out.solde = soldeVal.textContent;
  out.record = recordRow.style.display === 'none' ? '' : recordRow.textContent;
  out.recordNouveau = recordTag.style.display !== 'none';
  out.succes = succesRows.filter((S) => S.row.style.display !== 'none').map((S) => S.nom.textContent + ' : ' + S.recomp.textContent);
  out.montee = { actif: M.actif, finie: M.finie, t: M.t, cible: M.cible, montre: M.montre, sons: M.sons, unlock: M.unlock };
  return out;
}
