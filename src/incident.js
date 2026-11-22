// § E5.X2 — robustesse (audit I1, I2 ; Femz, 22/11). Hors chemin chaud : rien ici n'est appelé tant qu'aucune erreur
// n'arrive.
//  1. ERREUR PENDANT UNE IMAGE : main.js (frame) attrape l'erreur, met la partie en pause et appelle erreurImage() :
//     cartouche « Un problème est survenu » + Continuer / Recharger. La boucle ne s'arrête jamais.
//  2. AVIS : message court au titre (sauvegarde abîmée reprise ou repartie de zéro), sans bloquer.
// Même cartouche que src/memoire.js (DA carte mère). Textes et bornes : MEMOIRE (config, région e5:K-memoire).
import { MEMOIRE } from './config.js';
import { cartouche } from './memoire.js';

const etat = { erreurs: 0, journalisees: 0, dernier: '', avis: '' };
let boite = null;
let detail = null;
let compte = null;
let avisBoite = null;
let avisMinuterie = 0;

function court(e) {
  let t = e && e.message ? String(e.message) : String(e);
  if (e && e.name && e.name !== 'Error') t = e.name + ' : ' + t;
  const max = MEMOIRE.incident.detailMax;
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function bouton(texte, couleur, action) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = texte;
  b.style.cssText = `font:inherit;margin:0 6px;padding:5px 14px;color:${couleur};background:rgba(4,24,11,.92);border:2px solid ${couleur};cursor:pointer`;
  b.addEventListener('click', action);
  return b;
}

function construire() {
  const T = MEMOIRE.textes;
  boite = cartouche('sr-incident', 'alert');
  boite.style.top = '50%';
  boite.style.transform = 'translate(-50%,-50%)';
  boite.style.pointerEvents = 'auto';
  const titre = document.createElement('p');
  titre.style.cssText = 'margin:0 0 6px;color:#ff3b5c;font-size:18px';
  titre.textContent = T.incidentTitre;
  const texte = document.createElement('p');
  texte.style.cssText = 'margin:0 0 8px';
  texte.textContent = T.incidentTexte;
  detail = document.createElement('p');
  detail.style.cssText = 'margin:0 0 4px;color:#a8c8b0;font-size:13px;word-break:break-word';
  compte = document.createElement('p');
  compte.style.cssText = 'margin:0 0 12px;color:#a8c8b0;font-size:13px';
  const ligne = document.createElement('div');
  ligne.append(
    bouton(T.continuer, '#74e09a', () => {
      boite.hidden = true;
    }),
    bouton(T.recharger, '#f4f050', () => location.reload()),
  );
  boite.append(titre, texte, detail, compte, ligne);
}

/** main.js, après avoir attrapé l'erreur d'une image (la pause est déjà demandée). contexte : état du jeu (texte court). */
export function erreurImage(e, contexte) {
  etat.erreurs++;
  etat.dernier = court(e);
  const I = MEMOIRE.incident;
  if (etat.journalisees < I.journalMax || etat.erreurs % I.journalPas === 0) {
    etat.journalisees++;
    console.error(`Erreur pendant une image (n° ${etat.erreurs}, ${contexte}) :`, e);
  }
  try {
    if (boite === null) construire();
    detail.textContent = MEMOIRE.textes.incidentDetail + etat.dernier;
    compte.textContent = etat.erreurs > 1 ? etat.erreurs + MEMOIRE.textes.incidentErreurs : '';
    boite.hidden = false;
  } catch (e2) {
    // pas de DOM (tests en Node) : la console suffit
  }
}

/** Avis court au-dessus du jeu (sauvegarde abîmée), retiré seul après MEMOIRE.incident.avisSecondes. */
export function avis(texte) {
  etat.avis = texte;
  try {
    if (avisBoite === null) {
      avisBoite = cartouche('sr-incident-avis', 'status');
      avisBoite.style.top = '6vh';
      avisBoite.setAttribute('aria-live', 'polite');
    }
    avisBoite.textContent = texte;
    avisBoite.hidden = false;
    clearTimeout(avisMinuterie);
    // le compte à rebours part quand l'écran de chargement (#chargement, retiré à la fin) n'est plus là : sinon l'avis
    // pourrait disparaître derrière lui sur une machine lente
    const attendre = () => {
      if (document.getElementById('chargement')) {
        avisMinuterie = setTimeout(attendre, 500);
        return;
      }
      avisMinuterie = setTimeout(() => {
        avisBoite.hidden = true;
        etat.avis = '';
      }, MEMOIRE.incident.avisSecondes * 1000);
    };
    attendre();
  } catch (e) {
    console.warn(texte);
  }
}

/** Tests : état du filet et des avis. */
export function inspect(out = {}) {
  out.erreurs = etat.erreurs;
  out.journalisees = etat.journalisees;
  out.dernier = etat.dernier;
  out.cartouche = boite !== null && !boite.hidden;
  out.texte = boite && !boite.hidden ? boite.textContent : '';
  out.avis = avisBoite && !avisBoite.hidden ? etat.avis : '';
  return out;
}
