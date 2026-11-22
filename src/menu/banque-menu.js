// BANQUE D'ANIMATIONS de l'écran titre (15/11/2026) : clips de la Universal Animation Library 2 (Quaternius, CC0,
// assets/anims/ual2/) joués par le mannequin source puis recopiés sur le robot (src/anim/retarget.js).
// Un enchaînement = liste de noms de clips ; chaque clip est joué en entier (répété jusqu'à MIN_S s s'il est court),
// fondu enchaîné de FONDU s vers le suivant ; la liste boucle. Échantillonnage DÉTERMINISTE à un instant t (poids et
// temps de chaque action posés à la main, mixer.update(0)) : allerA / captures donnent la même pose.
import * as THREE from 'three';
import { lireGltf } from '../rendu/glb.js';

/** .glb (lireGltf) ou .fbx (FBXLoader, fetch + parse comme lireGltf) → { scene, animations }. */
async function lire(url) {
  if (!/\.fbx$/i.test(url)) return lireGltf(url);
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`banque d'animations : ${url} introuvable (${r.status})`);
  const groupe = new FBXLoader().parse(await r.arrayBuffer(), url.slice(0, url.lastIndexOf('/') + 1));
  // Mixamo nomme toutes ses animations « mixamo.com » : elles prennent le nom de leur fichier
  const fichier = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1).replace(/\.fbx$/i, ''));
  for (const c of groupe.animations) if (c.name === 'mixamo.com') c.name = fichier;
  return { scene: groupe, animations: groupe.animations };
}

const FONDU = 0.35; // s — par défaut (option fondu)
const MIN_S = 3; // s — un clip court (geste) est répété jusqu'à cette durée (option min)

/**
 * Charge la banque (une ou plusieurs adresses .glb au MÊME squelette : UAL1 et UAL2 ont les mêmes os, même repos) et
 * prépare l'enchaînement des clips nommés. Le mannequin est celui du premier fichier ; un nom présent dans deux fichiers
 * vient du premier.
 */
export async function chargerBanque(urls, noms, { fondu = FONDU, min = MIN_S } = {}) {
  const liste = Array.isArray(urls) ? urls : [urls];
  const gltfs = await Promise.all(liste.map((u) => lire(u)));
  const scene = gltfs[0].scene;
  const parNom = new Map();
  // prises vides écartées : un .fbx Mixamo contient, en plus de « mixamo.com », une prise « Take 001 » de durée nulle
  // (la pose de liaison) ; enchaînée, elle redressait le robot à chaque tour (« il n'est pas censé atterrir », 15/11)
  for (const g of gltfs) for (const c of g.animations) if (c.duration > 0.05 && !parNom.has(c.name)) parNom.set(c.name, c);
  // « * » : toutes les animations du fichier (un .fbx Mixamo n'en a qu'une, nommée « mixamo.com »)
  if (noms.length === 1 && noms[0] === '*') noms = [...parNom.keys()];
  const inconnus = noms.filter((n) => !parNom.has(n));
  const clips = noms.filter((n) => parNom.has(n)).map((n) => parNom.get(n));
  if (!clips.length) throw new Error(`banque d'animations : aucun clip connu parmi « ${noms.join(', ')} »`);
  const mixer = new THREE.AnimationMixer(scene);
  const segs = [];
  let debut = 0;
  for (const c of clips) {
    const a = mixer.clipAction(c);
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.play();
    a.setEffectiveWeight(0);
    const duree = c.duration * Math.max(1, Math.ceil(min / Math.max(0.05, c.duration)));
    segs.push({ nom: c.name, action: a, clip: c.duration, debut, duree });
    debut += duree - (clips.length > 1 ? fondu : 0);
  }
  const total = clips.length > 1 ? debut : segs[0].duree;
  const etat = { clip: segs[0].nom, precedent: null, poids: 1 };

  /** Pose le mannequin à l'instant t (s) de l'enchaînement. */
  function echantillonner(t) {
    let u = t % total;
    if (u < 0) u += total;
    for (const s of segs) s.action.setEffectiveWeight(0);
    let i = segs.length - 1;
    for (let k = 0; k < segs.length; k++)
      if (u < segs[k].debut + segs[k].duree - (segs.length > 1 ? fondu : 0)) {
        i = k;
        break;
      }
    const s = segs[i];
    const tl = u - s.debut;
    // début de clip : fondu DEPUIS la fin du précédent (le premier reçoit la fin du dernier : la boucle enchaîne)
    const p = segs[(i + segs.length - 1) % segs.length];
    const w = segs.length > 1 && tl < fondu ? tl / fondu : 1;
    s.action.time = tl % s.clip;
    s.action.setEffectiveWeight(w);
    if (w < 1) {
      p.action.time = (p.duree - fondu + tl) % p.clip;
      p.action.setEffectiveWeight(1 - w);
    }
    mixer.update(0);
    etat.clip = s.nom;
    etat.precedent = w < 1 ? p.nom : null;
    etat.poids = w;
    return etat;
  }
  return { scene, mixer, echantillonner, total, segs: segs.map((s) => ({ nom: s.nom, debut: s.debut, duree: s.duree })), inconnus, noms: [...parNom.keys()] };
}
