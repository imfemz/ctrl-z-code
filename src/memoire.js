// § E5.K — mémoire (Femz, 18/11 : « le Chrome de mes amis plante à 50 % du chargement »). Deux messages, hors chemin chaud :
//  1. ATTENTE : le modèle de l'agent choisi est lu à la demande (un seul agent détaillé en mémoire, src/rendu/modeles.js
//     chargerAgent) ; « Jouer » avec un agent pas encore arrivé affiche « Assemblage de l'agent… » jusqu'à son arrivée.
//  2. CONTEXTE WEBGL PERDU (webglcontextlost : le navigateur a repris la mémoire graphique) : rien ne se redessine plus —
//     message clair + « Recharger » au lieu d'un écran figé.
// Le balisage est créé ici (pas dans index.html) : il n'existe que si l'un des deux cas arrive. Réglages : MEMOIRE (config,
// région e5:K-memoire).
import { MEMOIRE } from './config.js';

let attenteBoite = null;
let perteBoite = null;
const etat = { attente: false, perdu: false, pertes: 0 };

function style(el, css) {
  el.style.cssText = css;
  return el;
}

/** Cartouche de la DA carte mère (vert, fond sombre, police du jeu), au-dessus de tous les écrans du jeu. */
export function cartouche(cls, role) {
  const b = document.createElement('div');
  b.className = cls;
  b.setAttribute('role', role);
  style(
    b,
    'position:fixed;left:50%;z-index:2147482000;transform:translateX(-50%);box-sizing:border-box;max-width:min(92vw,560px);' +
      'padding:12px 18px;color:#74e09a;background:rgba(6,34,16,.92);border:2px solid #74e09a;' +
      "font:16px/1.4 'Mister Pixel 16','Avenir Next','Segoe UI',system-ui,sans-serif;text-align:center;pointer-events:none",
  );
  document.body.appendChild(b);
  return b;
}

/** Affiche (on) ou retire l'attente du modèle de l'agent (main.js : launch en attente, arrivée du modèle). */
export function attente(on) {
  etat.attente = !!on;
  if (!on) {
    if (attenteBoite) attenteBoite.hidden = true;
    return;
  }
  if (attenteBoite === null) {
    attenteBoite = cartouche('sr-memoire-attente', 'status');
    attenteBoite.style.bottom = '12vh';
    attenteBoite.setAttribute('aria-live', 'polite');
  }
  attenteBoite.textContent = MEMOIRE.textes.attente;
  attenteBoite.hidden = false;
}

/** Le modèle de l'agent n'a pas pu être lu : message (le joueur peut choisir un autre agent ou recharger). */
export function echecAgent(cause) {
  attente(true);
  attenteBoite.style.color = '#ff3b5c';
  attenteBoite.style.borderColor = '#ff3b5c';
  attenteBoite.textContent = MEMOIRE.textes.echecAgent + (cause ? ' (' + cause + ')' : '');
}

let surPerte = null; // § E5.X2 (audit I10) : main.js met la partie en pause

function montrerPerte() {
  etat.perdu = true;
  if (surPerte) {
    try {
      surPerte();
    } catch (e) {
      console.error(e);
    }
  }
  etat.pertes++;
  attente(false);
  if (perteBoite === null) {
    perteBoite = cartouche('sr-memoire-perte', 'alert');
    perteBoite.style.top = '50%';
    perteBoite.style.transform = 'translate(-50%,-50%)';
    perteBoite.style.pointerEvents = 'auto';
    const t = document.createElement('p');
    style(t, 'margin:0 0 6px;color:#ff3b5c;font-size:18px');
    t.textContent = MEMOIRE.textes.perteTitre;
    const p = document.createElement('p');
    style(p, 'margin:0 0 12px');
    p.textContent = MEMOIRE.textes.perteTexte;
    const r = document.createElement('button');
    r.type = 'button';
    r.textContent = MEMOIRE.textes.recharger;
    style(r, 'font:inherit;padding:5px 14px;color:#f4f050;background:rgba(4,24,11,.92);border:2px solid #f4f050;cursor:pointer');
    r.addEventListener('click', () => location.reload());
    perteBoite.append(t, p, r);
  }
  perteBoite.hidden = false;
}

/**
 * Branche la perte du contexte WebGL du canvas du jeu (render.init l'a créé). preventDefault : le navigateur PEUT rendre
 * le contexte (webglcontextrestored) ; three le reprend alors seul, mais les géométries et programmes envoyés sont
 * perdus — on garde le message et le bouton « Recharger » (un retour partiel serait pire qu'un rechargement).
 * quandPerdu (§ E5.X2) : appelé à la perte — main.js met la partie en pause (le héros ne prend plus de coups à l'aveugle).
 */
export function brancher(canvas, quandPerdu = null) {
  surPerte = quandPerdu;
  if (!canvas || !canvas.addEventListener) return;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.error('Contexte WebGL perdu (mémoire graphique reprise par le navigateur)');
    montrerPerte();
  });
}

/** Tests : état des messages. */
export function inspect(out = {}) {
  out.attente = etat.attente && attenteBoite !== null && !attenteBoite.hidden;
  out.perdu = etat.perdu;
  out.pertes = etat.pertes;
  out.texteAttente = attenteBoite ? attenteBoite.textContent : '';
  out.textePerte = perteBoite && !perteBoite.hidden ? perteBoite.textContent : '';
  return out;
}
