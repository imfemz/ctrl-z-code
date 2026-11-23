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
  const qCap = new THREE.Quaternion();
  const AXE_Y = new THREE.Vector3(0, 1, 0);

  // Écran Agents (tâche 7) : appelé à CHAQUE image par la vitrine du titre et de l'écran Agents. Aucun flottant n'est passé
  // à une fonction (V8 l'emballe en objet quand l'appel n'est pas en ligne, mesuré ≈ 1,5 Ko par image) : temps lu dans
  // temps[0] quand t est null, slerp écrit directement dans les champs du quaternion (puis son rappel, sans argument :
  // l'Euler de l'os reste juste), position de la racine écrite champ par champ.
  const temps = new Float64Array(1);
  function echantillonner(t, os, racine, cap) {
    let u = ((t === null ? temps[0] : t) % duree) * fps;
    if (u < 0) u += n;
    const i0 = Math.floor(u) % n;
    const i1 = (i0 + 1) % n;
    const f = u - Math.floor(u);
    for (let k = 0; k < noms.length; k++) {
      const o = noms[k] === 'racine' ? racine : os[noms[k]];
      if (!o) continue;
      const a = (i0 * noms.length + k) * 4;
      const b = (i1 * noms.length + k) * 4;
      // slerp (même calcul que THREE.Quaternion.slerpQuaternions)
      const ax = Q[a], ay = Q[a + 1], az = Q[a + 2], aw = Q[a + 3];
      let bx = Q[b], by = Q[b + 1], bz = Q[b + 2], bw = Q[b + 3];
      let c = ax * bx + ay * by + az * bz + aw * bw;
      if (c < 0) {
        c = -c;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
      }
      // mêmes seuils que three : identiques → a ; presque identiques → mélange linéaire normalisé ; sinon slerp
      let k0 = 1;
      let k1 = 0;
      let norm = false;
      if (f !== 0 && c < 1) {
        const s2 = 1 - c * c;
        if (s2 <= Number.EPSILON) {
          k0 = 1 - f;
          k1 = f;
          norm = true;
        } else {
          const sn = Math.sqrt(s2);
          const ang = Math.atan2(sn, c);
          k0 = Math.sin((1 - f) * ang) / sn;
          k1 = Math.sin(f * ang) / sn;
        }
      }
      let x = ax * k0 + bx * k1, y = ay * k0 + by * k1, z = az * k0 + bz * k1, w = aw * k0 + bw * k1;
      if (norm) {
        const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
        x /= l;
        y /= l;
        z /= l;
        w /= l;
      }
      const q = o.quaternion;
      q._x = x;
      q._y = y;
      q._z = z;
      q._w = w;
      q._onChangeCallback();
      if (o === racine && cap !== 0) {
        qCap.setFromAxisAngle(AXE_Y, cap);
        q.premultiply(qCap);
      }
    }
    const x = R[i0 * 3] + (R[i1 * 3] - R[i0 * 3]) * f;
    const z = R[i0 * 3 + 2] + (R[i1 * 3 + 2] - R[i0 * 3 + 2]) * f;
    const p = racine.position;
    if (cap === 0) {
      p.x = x;
      p.z = z;
    } else {
      const c = Math.cos(cap);
      const s = Math.sin(cap);
      p.x = x * c + z * s;
      p.z = -x * s + z * c;
    }
    p.y = R[i0 * 3 + 1] + (R[i1 * 3 + 1] - R[i0 * 3 + 1]) * f;
  }
  return { n, fps, duree, source: doc.source, licence: doc.licence, temps, echantillonner };
}

export async function chargerCuit(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`animation cuite introuvable : ${url} (${r.status})`);
  return preparerCuit(await r.json());
}
