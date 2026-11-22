// ANIMATION CUITE du héros de l'écran titre (15/11/2026) : une animation transférée sur le robot (anim/retarget.js)
// puis enregistrée telle quelle, dans le repère du héros SANS son cap — rotations locales de ses os et position de sa
// racine, image par image (format « ctrlz-anim-robot/1 », écrit par tests/cuire-anim.mjs). Le jeu n'embarque que ces
// pistes, jamais le fichier source (Mixamo interdit de diffuser ses fichiers bruts ; la source reste dans
// outils/anims/sources/, hors dépôt).
// echantillonner(t, os, racine, cap) : slerp entre deux images, boucle sur la durée, cap (rad) appliqué à la racine.
// Aucune allocation par image.
import * as THREE from 'three';

export function preparerCuit(doc) {
  if (!doc || doc.format !== 'ctrlz-anim-robot/1') throw new Error('animation cuite : format inconnu');
  const { n, fps, os: noms } = doc;
  const Q = Float32Array.from(doc.q); // n × os × 4
  const R = Float32Array.from(doc.racine); // n × 3
  if (Q.length !== n * noms.length * 4 || R.length !== n * 3) throw new Error('animation cuite : pistes de mauvaise taille');
  const duree = n / fps;
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const qCap = new THREE.Quaternion();
  const AXE_Y = new THREE.Vector3(0, 1, 0);

  function echantillonner(t, os, racine, cap) {
    let u = (t % duree) * fps;
    if (u < 0) u += n;
    const i0 = Math.floor(u) % n;
    const i1 = (i0 + 1) % n;
    const f = u - Math.floor(u);
    qCap.setFromAxisAngle(AXE_Y, cap);
    for (let k = 0; k < noms.length; k++) {
      const o = noms[k] === 'racine' ? racine : os[noms[k]];
      if (!o) continue;
      const a = (i0 * noms.length + k) * 4;
      const b = (i1 * noms.length + k) * 4;
      qa.set(Q[a], Q[a + 1], Q[a + 2], Q[a + 3]);
      qb.set(Q[b], Q[b + 1], Q[b + 2], Q[b + 3]);
      o.quaternion.slerpQuaternions(qa, qb, f);
      if (o === racine) o.quaternion.premultiply(qCap);
    }
    const x = R[i0 * 3] + (R[i1 * 3] - R[i0 * 3]) * f;
    const z = R[i0 * 3 + 2] + (R[i1 * 3 + 2] - R[i0 * 3 + 2]) * f;
    const c = Math.cos(cap);
    const s = Math.sin(cap);
    racine.position.set(x * c + z * s, R[i0 * 3 + 1] + (R[i1 * 3 + 1] - R[i0 * 3 + 1]) * f, -x * s + z * c);
  }
  return { n, fps, duree, source: doc.source, licence: doc.licence, echantillonner };
}

export async function chargerCuit(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`animation cuite introuvable : ${url} (${r.status})`);
  return preparerCuit(await r.json());
}
