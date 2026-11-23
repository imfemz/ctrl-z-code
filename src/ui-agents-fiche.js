// Écran Agents, tâche 6 : la FICHE perso (docs/superpowers/specs/2026-11-22-ecran-agents-design.md § Comportements ;
// maquettes docs/maquettes-ecran-agents/fiche-B5.png et fiche-B2-verrouille.png, mesurées à 2560 × 1440 où 1 rem = 32 px).
//   gauche : « Skins n / N », une vignette par skin EXISTANT (précalculée : VITRINE.vignettes ; skin choisi coché, skin
//            verrouillé : silhouette + cadenas), puis le skin visé (choisi : nom + une ligne ; verrouillé : sa condition) ;
//   centre : l'agent en 3D (vitrine de src/pause-agent.js, cadre « fiche ») dans une toile plein écran, posé sur le fond
//            peint ; silhouette + cadenas si l'agent ou le skin visé est verrouillé ; « Chargement » tant que son modèle
//            n'est pas lu (§ E5.K), puis il apparaît en fondu ;
//   droite : arme de départ (étiquette de rareté « Root »), rôle, nom, passif, 4 barres (PV, Vitesse, Blindage, Dash) ;
//   pied   : (construit par ui.js, commun à la grille) « Retour », « Jouer · <agent> » + « en skin <skin porté> » quand un
//            autre skin est visé ; agent verrouillé : sa condition et sa progression à la place de « Jouer ».
// Module à part de ui.js (déjà très long) : il construit et remplit la vue, ui.js garde le focus, les flèches et Entrée
// (agentsBouger / agentsConfirmer) et le pied. N'importe que config.js ; fabriques et modules passés par ui.js (D).
// Aucune allocation par image : rien ici ne tourne à chaque image (remplissage à l'ouverture et à chaque choix).
import { AGENTS, AGENT_SCREEN, HUB, PLAYER, RARITIES, RARITY, SKIN_BASE, SUCCES_RECOMPENSE, VITRINE, WEAPONS, agentBarPips, agentSignature, skinNom, skinsDe } from './config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const F = AGENT_SCREEN.fiche;
// vignettes construites une fois : autant que le plus grand nombre de skins d'un agent (les autres sont cachées)
const MAX_SKINS = AGENTS.reduce((m, A) => Math.max(m, skinsDe(A.key).length), 1);

let D = null; // { el, icon, pressable, setText, hex, formatValue, meta, hub, onVignette(k) }
let racine = null;
let toile = null;
let cadenasAgent = null;
let attenteNode = null;
let titreChemin = null;
let compte = null;
const vignettes = []; // { node, img, cadenas, nom, statut, coche }
let detailKicker = null;
let detailKickerTxt = null;
let detailCadenas = null;
let detailNom = null;
let detailTexte = null;
let armeIcone = null; // <svg> de l'arme : son <use> change d'agent en agent
let armeNom = null;
let roleNode = null;
let nomNode = null;
let passifNom = null;
let passifTexte = null;
const barres = []; // { pips: [nœuds], val }
let indice = null; // sous « Jouer »
let piedCond = null;
let piedCondTexte = null;
let piedCondProg = null;
// état montré : agent, skins de l'agent (clés), skin visé, verrous
const V = { agent: -1, verrouAgent: false, skinVise: SKIN_BASE, vitrineSkin: SKIN_BASE, attente: false, focus: -1 };
let cles = [SKIN_BASE];

/** Coche du skin choisi (trait vert, comme la maquette). */
function coche() {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', 'sr-ae-coche');
  s.setAttribute('viewBox', '0 0 12 12');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M1 6 L4.5 9.5 L11 2.5');
  s.appendChild(p);
  return s;
}

/** Construit la vue (une fois) ; rend son nœud, que ui.js pose dans l'écran Agents. deps : voir D. */
export function build(deps) {
  D = deps;
  const { el, icon, pressable } = D;
  racine = el('div', 'sr-ae-fiche');
  racine.style.setProperty('--ae-root', D.hex(RARITIES[RARITY.ROOT].color));
  const fond = el('div', 'sr-ae-fiche-fond');
  fond.style.backgroundImage = "url('" + VITRINE.fonds.agents + "')";
  const voile = el('div', 'sr-ae-voile');
  toile = el('canvas', 'sr-ae-toile');
  toile.width = 8;
  toile.height = 8;
  cadenasAgent = el('span', 'sr-ae-agent-cadenas');
  cadenasAgent.appendChild(icon('sr-i-lock'));
  attenteNode = el('div', 'sr-ae-attente', F.chargement);
  // en-tête : « Agents / Shinobi » (le chemin, comme le titre du Noyau)
  const titre = el('h2', 'sr-ae-fiche-titre', AGENT_SCREEN.title + ' ');
  titreChemin = el('span', 'sr-ae-chemin', '');
  titre.appendChild(titreChemin);
  // colonne gauche : skins
  const gauche = el('div', 'sr-ae-gauche');
  const tete = el('div', 'sr-ae-skins-tete');
  compte = el('span', 'sr-ae-skins-compte', '');
  tete.append(el('span', 'sr-ae-skins-titre', F.skins), compte);
  const rangee = el('div', 'sr-ae-vignettes');
  for (let k = 0; k < MAX_SKINS; k++) {
    const node = pressable(el('button', 'sr-ae-vignette'), () => D.onVignette(k));
    node.dataset.k = String(k);
    const scene = el('div', 'sr-ae-vignette-img');
    const img = el('img');
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    const cadenas = el('span', 'sr-ae-vignette-cadenas');
    cadenas.appendChild(icon('sr-i-lock'));
    scene.append(img, cadenas);
    const bande = el('div', 'sr-ae-vignette-bande');
    const nom = el('div', 'sr-ae-vignette-nom', '');
    const statut = el('div', 'sr-ae-vignette-statut', '');
    const ok = coche();
    bande.append(nom, statut, ok);
    node.append(scene, bande);
    rangee.appendChild(node);
    vignettes.push({ node, img, cadenas, nom, statut, coche: ok });
  }
  const detail = el('div', 'sr-ae-detail');
  detailKicker = el('div', 'sr-ae-detail-kicker');
  detailCadenas = icon('sr-i-lock');
  detailKickerTxt = el('span', null, '');
  detailKicker.append(detailCadenas, detailKickerTxt);
  detailNom = el('div', 'sr-ae-detail-nom', '');
  detailTexte = el('div', 'sr-ae-detail-texte', '');
  detail.append(detailKicker, detailNom, detailTexte);
  gauche.append(tete, rangee, detail);
  // colonne droite : arme de départ, rôle, nom, passif, barres
  const droite = el('div', 'sr-ae-droite');
  const arme = el('div', 'sr-ae-arme-bloc');
  const embleme = el('div', 'sr-ae-embleme');
  armeIcone = icon('sr-w0');
  embleme.appendChild(armeIcone);
  const armeTxt = el('div', 'sr-ae-arme-txt');
  armeNom = el('span', 'sr-ae-arme-nom', '');
  const root = el('span', 'sr-ae-root', AGENT_SCREEN.rootTag);
  root.title = AGENT_SCREEN.rootBulle;
  const ligne = el('div', 'sr-ae-arme-ligne');
  ligne.append(armeNom, root);
  armeTxt.append(el('div', 'sr-ae-arme-kicker', F.armeDepart), ligne);
  arme.append(embleme, armeTxt);
  roleNode = el('div', 'sr-ae-fiche-role', '');
  nomNode = el('div', 'sr-ae-fiche-nom', '');
  const passif = el('div', 'sr-ae-passif');
  passifNom = el('div', 'sr-ae-passif-nom', '');
  passifTexte = el('div', 'sr-ae-passif-texte', '');
  passif.append(passifNom, passifTexte);
  const blocBarres = el('div', 'sr-ae-barres');
  for (let b = 0; b < AGENT_SCREEN.bars.length; b++) {
    const row = el('div', 'sr-ae-barre');
    const pipsBox = el('span', 'sr-ae-pips');
    const pips = [];
    for (let i = 0; i < AGENT_SCREEN.pips; i++) {
      const p = el('i', 'sr-ae-pip');
      pips.push(p);
      pipsBox.appendChild(p);
    }
    const val = el('span', 'sr-ae-barre-val', '');
    row.append(el('span', 'sr-ae-barre-lab', AGENT_SCREEN.bars[b].label), pipsBox, val);
    blocBarres.appendChild(row);
    barres.push({ pips, val });
  }
  droite.append(arme, roleNode, nomNode, passif, blocBarres);
  racine.append(fond, voile, toile, cadenasAgent, attenteNode, titre, gauche, droite);
  return racine;
}

/**
 * Pied (construit par ui.js, commun à la grille) : « en skin <skin porté> » sous « Jouer » (hors du bouton : son libellé
 * reste « Jouer · <agent> »), et le bloc de condition d'un agent verrouillé à la place de « Jouer ».
 */
export function construirePied(pied) {
  const { el, icon } = D;
  indice = el('span', 'sr-ae-indice', '');
  pied.appendChild(indice);
  piedCond = el('div', 'sr-ae-pied-cond');
  const kicker = el('div', 'sr-ae-pied-cond-kicker');
  kicker.append(icon('sr-i-lock'), el('span', null, AGENT_SCREEN.textes.verrou));
  piedCondTexte = el('div', 'sr-ae-pied-cond-texte', '');
  piedCondProg = el('div', 'sr-ae-pied-cond-prog', '');
  piedCond.append(kicker, piedCondTexte, piedCondProg);
  pied.appendChild(piedCond);
}

/** Valeur affichée d'une barre (PV, Vitesse en %, Blindage en dégâts reçus en moins, recharge du dash). */
function barreTexte(a, b) {
  const S = AGENTS[a].stats;
  const stat = AGENT_SCREEN.bars[b].stat;
  if (stat === 'maxHp') return String(S.maxHp);
  if (stat === 'speedMul') return Math.round(S.speedMul * 100) + ' %';
  if (stat === 'damageTakenMul') return S.damageTakenMul < 1 ? '−' + Math.round((1 - S.damageTakenMul) * 100) + ' %' : '—';
  return D.formatValue(PLAYER.dash.cooldown * S.dashCdMul) + ' s';
}

/** Ligne d'un skin : Standard = la tenue d'origine ; les autres, la phrase de leur récompense de succès. */
function skinLigne(a, sk) {
  const A = AGENTS[a];
  if (sk === SKIN_BASE) return F.tenueBase(A.name);
  return SUCCES_RECOMPENSE.courtes['skin:' + A.key + ':' + sk] || '';
}

/**
 * Remplit la fiche de l'agent v.agent (vue agentView de main.js : { agent, skinVise, best }). Hors image.
 * Rend { verrouAgent } (ui.js cache « Jouer » pour un agent verrouillé).
 */
export function fill(v) {
  const { setText } = D;
  const a = v.agent;
  const A = AGENTS[a];
  const meta = D.meta;
  const k = A.key;
  cles = skinsDe(k);
  const choisi = meta ? meta.skinChoisi(k) : SKIN_BASE;
  const vise = cles.includes(v.skinVise) ? v.skinVise : choisi;
  const verrouAgent = !!meta && meta.agentVerrouille(a);
  const debloque = (sk) => !meta || meta.skinDebloque(k, sk);
  V.agent = a;
  V.verrouAgent = verrouAgent;
  V.skinVise = vise;
  V.vitrineSkin = vise;
  setText(titreChemin, '/ ' + A.name);
  if (racine.dataset.agent !== String(a)) {
    racine.dataset.agent = String(a);
    racine.style.setProperty('--ae-accent', D.hex(A.accent)); // crans des barres à l'accent de l'agent
  }
  let n = 0;
  for (let i = 0; i < cles.length; i++) if (debloque(cles[i])) n++;
  setText(compte, (verrouAgent ? 0 : n) + ' / ' + cles.length);
  for (let i = 0; i < vignettes.length; i++) {
    const t = vignettes[i];
    const sk = cles[i];
    t.node.style.display = sk === undefined ? 'none' : '';
    if (sk === undefined) continue;
    const verrou = verrouAgent || !debloque(sk);
    const estChoisi = !verrouAgent && sk === choisi;
    const src = VITRINE.vignettes(k, sk, { verrou });
    if (t.img.getAttribute('src') !== src) t.img.src = src;
    setText(t.nom, skinNom(k, sk));
    setText(t.statut, verrou ? AGENT_SCREEN.textes.verrou : estChoisi ? F.choisi : HUB.textes.debloque);
    t.node.classList.toggle('sr-choisi', estChoisi);
    t.node.classList.toggle('sr-verrou', verrou);
    t.node.classList.toggle('sr-vise', sk === vise);
    t.cadenas.style.display = verrou ? '' : 'none';
    t.coche.style.display = estChoisi ? '' : 'none';
  }
  // skin visé : choisi (nom + ligne), débloqué non porté, ou verrouillé (sa condition) ; agent verrouillé : « Verrouillé »,
  // la ligne du skin (la condition de l'agent est au pied, à la place de « Jouer »)
  const viseVerrou = !debloque(vise);
  detailCadenas.style.display = viseVerrou || verrouAgent ? '' : 'none';
  detailKicker.classList.toggle('sr-verrou', viseVerrou || verrouAgent);
  setText(detailKickerTxt, viseVerrou || verrouAgent ? AGENT_SCREEN.textes.verrou : vise === choisi ? F.skinChoisi : HUB.textes.debloque);
  setText(detailNom, skinNom(k, vise));
  setText(detailTexte, viseVerrou ? D.hub.skinCondition(k, vise, true).texte : skinLigne(a, vise));
  // centre : cadenas sur la silhouette (agent ou skin visé verrouillé)
  cadenasAgent.style.display = verrouAgent || viseVerrou ? '' : 'none';
  // droite
  const w = agentSignature(a);
  const use = armeIcone.firstChild;
  if (use.getAttribute('href') !== '#sr-w' + w) use.setAttribute('href', '#sr-w' + w);
  setText(armeNom, WEAPONS[w] ? WEAPONS[w].name : A.signatureName);
  setText(roleNode, A.role);
  setText(nomNode, A.name);
  // nom en grand (4,9 rem, maquette) ramené à la largeur de la colonne pour un nom long (« Éclaireur ») : chasse de la
  // police ≈ AGENT_SCREEN.fiche.nomChasse em par lettre, sans lecture de la mise en page
  const taille = Math.min(F.nomRem, F.colonneRem / (A.name.length * F.nomChasse));
  nomNode.style.fontSize = taille.toFixed(3) + 'rem';
  nomNode.classList.toggle('sr-accent', /^[ÀÂÉÈÊËÎÏÔÙÛÜ]/.test(A.name)); // capitale accentuée : l'accent ne touche pas le rôle
  setText(passifNom, F.passif + A.passive.name);
  setText(passifTexte, A.passive.desc);
  for (let b = 0; b < barres.length; b++) {
    const on = agentBarPips(a, b);
    const r = barres[b];
    for (let i = 0; i < r.pips.length; i++) r.pips[i].classList.toggle('sr-on', i < on);
    setText(r.val, barreTexte(a, b));
  }
  // pied : « en skin Standard » quand le skin visé n'est pas celui qui part ; agent verrouillé : condition + progression
  setText(indice, !verrouAgent && vise !== choisi ? F.enSkin + skinNom(k, choisi) : '');
  indice.style.display = indice.textContent ? '' : 'none';
  const cond = verrouAgent ? D.hub.agentCondition(a, v.best ? v.best.wave : 0, true) : null;
  setText(piedCondTexte, cond ? cond.texte : '');
  setText(piedCondProg, cond ? cond.prog : '');
  return verrouAgent;
}

/** Fiche visible (vrai) ou cachée : la grille et le pied sont gérés par ui.js. */
export function montrer(on) {
  racine.style.display = on ? '' : 'none';
  piedCond.style.display = on && V.verrouAgent ? '' : 'none';
  if (!on) {
    D.setText(indice, '');
    indice.style.display = 'none';
  }
}

/** Focus clavier / souris : vignette k (-1 : aucune). Le seul élément jaune de l'écran quand il est sur une vignette. */
export function peindreFocus(k) {
  V.focus = k;
  for (let i = 0; i < vignettes.length; i++) vignettes[i].node.classList.toggle('sr-focus', i === k);
}

/** Nombre de vignettes (skins de l'agent montré), clé du skin k, indice du skin visé. */
export function nbSkins() {
  return cles.length;
}
export function cle(k) {
  return cles[k];
}
export function indiceVise() {
  const i = cles.indexOf(V.skinVise);
  return i < 0 ? 0 : i;
}

/** La toile plein écran de la vitrine (src/pause-agent.js y recopie l'agent). */
export function getToile() {
  return toile;
}

/** Vitrine en attente du modèle de l'agent (vrai) : « Chargement », toile cachée ; faux : la toile apparaît en fondu. */
export function setAttente(on) {
  V.attente = !!on;
  racine.classList.toggle('sr-attente', V.attente);
}

/** Tests (snapshot().ui.agentScreen.fiche). */
export function inspect() {
  return {
    agent: V.agent,
    agentVerrou: V.verrouAgent,
    skinVise: V.skinVise,
    vitrineSkin: V.vitrineSkin,
    skins: cles.slice(),
    focus: V.focus,
    attente: V.attente,
  };
}
