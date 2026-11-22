// PLAN ADDICTIF, ÉTAPE 4, CHANTIER I : le panneau « Nouveautés » de l'écran titre (ARCHITECTURE.md § E4.I.6).
// Données : src/patchnotes.js (à compléter à la main). Colonne gauche de l'écran titre, DA FUI (cadre de 1 px, chemin,
// police de l'UI). Une version pas encore lue s'affiche DÉPLIÉE, avec la pastille « NOUVEAU » ; elle est lue dès que le
// joueur touche au panneau (clic sur l'en-tête, clic ou défilement dans la liste). Ensuite, le panneau garde l'état que
// le joueur lui donne (déplié / replié ; son UI_OPEN à l'ouverture). Tout est du DOM, construit UNE
// fois ; aucun stockage ici : les réglages passent par main.js (actions.prefLire / prefEcrire, en try/catch).
import { PATCHNOTES_UI } from './config.js';
import { PATCHNOTES } from './patchnotes.js';

const P = PATCHNOTES_UI;
let D = null; // { el, pressable, audio, SFX, actions }
let box = null;
let pastille = null;
let corps = null;
let chev = null;
let ouvert = false;
let vue = false; // dernière version déjà ouverte

/** Construit le panneau ; rend son nœud (ui.js l'ajoute à l'écran titre). */
export function build(deps) {
  D = deps;
  const el = D.el;
  box = el('aside', 'sr-notes sr-cadre');
  const tete = D.pressable(el('button', 'sr-notes-tete'), () => basculer(true));
  const id = el('span', 'sr-notes-id');
  id.append(el('span', 'sr-notes-titre', P.titre));
  pastille = el('span', 'sr-notes-pastille', P.nouveau);
  chev = el('span', 'sr-notes-chev', '');
  // menus « Pile » (19/11) : replié, le journal tient sur UNE ligne en bas à gauche — pastille, version et titre de la
  // dernière mise à jour ; un clic le déplie vers le haut
  const der = PATCHNOTES.entrees[0];
  // « PATCHNOTE » en étiquette (verte tant que la version n'est pas lue, éteinte ensuite : sr-non-lu) ; la pastille
  // « NOUVEAU » reste dans le DOM (état lu par inspect) mais n'est plus montrée
  tete.append(id, el('span', 'sr-notes-ligne', 'v' + PATCHNOTES.version + (der ? ' \u00b7 ' + der.titre : '')), pastille, chev);
  corps = el('div', 'sr-notes-corps');
  // Chaque version se déplie à part : la plus récente dépliée, les anciennes repliées (une ligne chacune) — le panneau
  // tient dans l'écran sans défiler au départ ; il défile si le joueur déplie tout.
  for (let k = 0; k < PATCHNOTES.entrees.length; k++) {
    const E = PATCHNOTES.entrees[k];
    const bloc = el('section', 'sr-notes-entree');
    const ul = el('ul', 'sr-notes-liste');
    const ch = el('span', 'sr-notes-chev-v', '');
    const h = D.pressable(el('button', 'sr-notes-entete'), () => {
      marquerVu();
      const ouvre = ul.style.display === 'none';
      ul.style.display = ouvre ? '' : 'none';
      ch.textContent = ouvre ? '\u25BE' : '\u25B8';
      D.audio.play(ouvre ? D.SFX.UI_OPEN : D.SFX.UI_CLICK);
    });
    h.append(ch, el('span', 'sr-num sr-notes-date', E.date), el('span', 'sr-notes-etiq', E.titre), el('span', 'sr-num sr-notes-v', 'v' + E.version));
    for (const l of E.lignes) ul.appendChild(el('li', null, l));
    ul.style.display = k === 0 ? '' : 'none';
    ch.textContent = k === 0 ? '\u25BE' : '\u25B8';
    bloc.append(h, ul);
    corps.appendChild(bloc);
  }
  box.append(tete, corps);
  corps.addEventListener('scroll', marquerVu, { passive: true });
  corps.addEventListener('pointerdown', marquerVu);
  vue = D.actions.prefLire(P.cleVue) === PATCHNOTES.version;
  ouvert = false; // menus « Pile » : toujours replié à l'arrivée (la pastille « NOUVEAU » signale une version pas lue)
  peindre();
  return box;
}

function peindre() {
  box.classList.toggle('sr-ouvert', ouvert);
  box.classList.toggle('sr-non-lu', !vue);
  corps.style.display = ouvert ? '' : 'none';
  pastille.style.display = vue ? 'none' : '';
  chev.textContent = ouvert ? '▾' : '▸';
  box.firstChild.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
}

/** Version lue : la pastille s'éteint (et reste éteinte au rechargement). */
function marquerVu() {
  if (vue) return;
  vue = true;
  D.actions.prefEcrire(P.cleVue, PATCHNOTES.version);
  peindre();
}

/** Déplie / replie (clic sur l'en-tête). sound : joué par le joueur. Rend l'état ouvert. */
export function basculer(sound) {
  ouvert = !ouvert;
  marquerVu();
  D.actions.prefEcrire(P.cleOuvert, ouvert ? '1' : '0');
  if (sound) D.audio.play(ouvert ? D.SFX.UI_OPEN : D.SFX.UI_CLICK);
  peindre();
  return ouvert;
}

//#region e5:L-textes-guide
/** § E5.L (A4) : 1er lancement — le journal se replie (sans rien écrire) tant que le joueur n'y a pas touché. */
export function premierLancement() {
  if (box === null || D.actions.prefLire(P.cleOuvert) !== null) return ouvert;
  ouvert = false;
  peindre();
  return ouvert;
}
//#endregion e5:L-textes-guide

/** Nœud du panneau (couche de la parallaxe de l'écran titre). */
export function node() {
  return box;
}

export function inspect(out = {}) {
  out.ouvert = ouvert;
  out.vue = vue;
  out.pastille = !!pastille && pastille.style.display !== 'none';
  out.version = PATCHNOTES.version;
  out.entrees = PATCHNOTES.entrees.length;
  return out;
}
