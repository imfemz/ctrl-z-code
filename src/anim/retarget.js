// TRANSFERT D'ANIMATIONS (15/11/2026, demande de Femz : « tes animations ne sont pas réalistes, la façon dont tu plies
// les membres ; t'as pas accès à une banque d'animations ? ») : une animation faite par un animateur sur un squelette
// humain standard (Universal Animation Library 2 de Quaternius, CC0, squelette façon mannequin Unreal :
// assets/anims/ual2/) est recopiée sur les os du robot (un os par pièce, src/anim/pieces.js), ROTATION PAR ROTATION.
//
// Méthode (celle des moteurs) : pour chaque paire (os source S, os robot R), la rotation monde de S depuis SA pose de
// repos est appliquée à R depuis LA SIENNE. Les poses de repos diffèrent (bras du mannequin écartés, bras du robot le
// long du corps) : A = plus petite rotation qui amène la direction de repos de S (S → son bout) sur celle de R ; alors
//   D(t) = Qs(t) · Qs0⁻¹ · A⁻¹   (D · dir_repos_robot = dir_courante_source : le membre du robot pointe comme celui du
//   mannequin, et la torsion suit), rotation locale de R = D(parent de R)⁻¹ · D(R).
// Le tout dans le repère du personnage (face à +Z, gauche en +X : celui du robot comme du mannequin glTF). Le bassin :
// position monde depuis le repos × (hanche du robot ÷ hanche du mannequin) — en place pour les clips sans « root motion ».
// Aucune allocation par image (quaternions et vecteurs créés ici).
import * as THREE from 'three';

/**
 * Correspondance squelette « UE / Quaternius » → robot : [os robot, os source, bout source, bout robot, parent robot].
 * Bout = point qui donne la direction de repos de l'os (source : un os enfant ; robot : la pièce enfant, ou un vecteur
 * [x, y, z] quand l'os n'a pas d'enfant utile). null = os sans direction (bassin, buste, tête : seulement leur rotation).
 */
export const CORRESP_UE = [
  ['racine', 'pelvis', null, null, null],
  ['buste', 'spine_03', null, null, 'racine'],
  ['tete', 'Head', null, null, 'buste'],
  ['bras_g', 'upperarm_l', 'lowerarm_l', 'avant_bras_g', 'buste'],
  ['avant_bras_g', 'lowerarm_l', 'hand_l', [0, -1, 0], 'bras_g'],
  ['bras_d', 'upperarm_r', 'lowerarm_r', 'avant_bras_d', 'buste'],
  ['avant_bras_d', 'lowerarm_r', 'hand_r', [0, -1, 0], 'bras_d'],
  ['jambe_g', 'thigh_l', 'calf_l', 'tibia_g', 'racine'],
  ['tibia_g', 'calf_l', 'foot_l', 'pied_g', 'jambe_g'],
  ['pied_g', 'foot_l', 'ball_l', 'orteils_g', 'tibia_g'],
  ['orteils_g', 'ball_l', 'ball_leaf_l', [0, 0, 1], 'pied_g'],
  ['jambe_d', 'thigh_r', 'calf_r', 'tibia_d', 'racine'],
  ['tibia_d', 'calf_r', 'foot_r', 'pied_d', 'jambe_d'],
  ['pied_d', 'foot_r', 'ball_r', 'orteils_d', 'tibia_d'],
  ['orteils_d', 'ball_r', 'ball_leaf_r', [0, 0, 1], 'pied_d'],
];

/** Même correspondance pour le squelette Mixamo (« mixamorig:… » ; FBXLoader retire le « : » des noms). */
export const CORRESP_MIXAMO = [
  ['racine', 'mixamorigHips', null, null, null],
  ['buste', 'mixamorigSpine2', null, null, 'racine'],
  ['tete', 'mixamorigHead', null, null, 'buste'],
  ['bras_g', 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'avant_bras_g', 'buste'],
  ['avant_bras_g', 'mixamorigLeftForeArm', 'mixamorigLeftHand', [0, -1, 0], 'bras_g'],
  ['bras_d', 'mixamorigRightArm', 'mixamorigRightForeArm', 'avant_bras_d', 'buste'],
  ['avant_bras_d', 'mixamorigRightForeArm', 'mixamorigRightHand', [0, -1, 0], 'bras_d'],
  ['jambe_g', 'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'tibia_g', 'racine'],
  ['tibia_g', 'mixamorigLeftLeg', 'mixamorigLeftFoot', 'pied_g', 'jambe_g'],
  ['pied_g', 'mixamorigLeftFoot', 'mixamorigLeftToeBase', 'orteils_g', 'tibia_g'],
  ['orteils_g', 'mixamorigLeftToeBase', 'mixamorigLeftToe_End', [0, 0, 1], 'pied_g'],
  ['jambe_d', 'mixamorigRightUpLeg', 'mixamorigRightLeg', 'tibia_d', 'racine'],
  ['tibia_d', 'mixamorigRightLeg', 'mixamorigRightFoot', 'pied_d', 'jambe_d'],
  ['pied_d', 'mixamorigRightFoot', 'mixamorigRightToeBase', 'orteils_d', 'tibia_d'],
  ['orteils_d', 'mixamorigRightToeBase', 'mixamorigRightToe_End', [0, 0, 1], 'pied_d'],
];

/** Correspondance adaptée au squelette de la source (Mixamo ou UE / Quaternius). */
export function correspPour(source) {
  return source.getObjectByName('mixamorigHips') || source.getObjectByName('mixamorig:Hips') ? CORRESP_MIXAMO : CORRESP_UE;
}

/**
 * source : racine Object3D du squelette source (gltf.scene), au REPOS (pose de liaison, avant toute animation).
 * os : { nom: Bone } du robot (racine comprise) ; pivot(nom) → [x, y, z] repère du modèle ; hanche : hauteur du pivot
 * des jambes du robot (m). Renvoie { appliquer(lacet), echelle, manquants }.
 */
export function creerRetarget({ source, os, pivot, hanche, corresp = correspPour(source) }) {
  // noms : tels quels, ou avec le « : » de Mixamo
  const os_ = (n) => (n ? source.getObjectByName(n) || source.getObjectByName(n.replace(/^mixamorig/, 'mixamorig:')) : null);
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  // repère du personnage source = sa racine (gltf.scene) : relu à chaque image (la scène peut être déplacée, tournée,
  // mise à l'échelle pour l'aperçu « mannequin » sans fausser le transfert)
  const qInvRepere = new THREE.Quaternion();
  const mInvRepere = new THREE.Matrix4();
  function repere() {
    source.updateMatrixWorld(true);
    source.getWorldQuaternion(qInvRepere).invert();
    mInvRepere.copy(source.matrixWorld).invert();
  }
  repere();
  /** Position d'un os source dans le repère du personnage (unités du fichier). */
  const posPerso = (o, out) => o.getWorldPosition(out).applyMatrix4(mInvRepere);
  const manquants = [];
  const paires = [];
  const parIndex = {};
  for (const [nomR, nomS, boutS, boutR, parentR] of corresp) {
    const s = os_(nomS);
    const r = os[nomR];
    if (!s || !r) {
      manquants.push(!s ? nomS : nomR);
      continue;
    }
    const q0 = s.getWorldQuaternion(new THREE.Quaternion()).premultiply(qInvRepere);
    const A = new THREE.Quaternion();
    if (boutS) {
      const b = os_(boutS);
      if (b) {
        posPerso(s, v1);
        posPerso(b, v2);
        const dS = v2.sub(v1).normalize().clone();
        const pr = pivot(nomR);
        const dR = Array.isArray(boutR) ? new THREE.Vector3(...boutR) : new THREE.Vector3(...pivot(boutR)).sub(new THREE.Vector3(...pr));
        dR.normalize();
        A.setFromUnitVectors(dS, dR);
      } else manquants.push(boutS);
    }
    const p = { r, s, q0inv: q0.clone().invert(), Ainv: A.clone().invert(), parent: parentR, D: new THREE.Quaternion() };
    parIndex[nomR] = p;
    paires.push(p);
  }
  // échelle du bassin : hanche du robot ÷ hauteur du bassin source au repos
  const bassinS = os_(corresp.find((c) => c[0] === 'racine')[1]);
  const bassin0 = bassinS ? posPerso(bassinS, new THREE.Vector3()) : new THREE.Vector3(0, 1, 0);
  const echelle = hanche / Math.max(0.1, bassin0.y);
  const qLacet = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();
  const AXE_Y = new THREE.Vector3(0, 1, 0);

  /** Pose le robot sur la pose COURANTE de la source (mixer déjà appliqué). lacet : cap du personnage (rad). */
  function appliquer(lacet) {
    repere();
    for (const p of paires) {
      p.s.getWorldQuaternion(p.D).premultiply(qInvRepere).multiply(p.q0inv).multiply(p.Ainv);
    }
    qLacet.setFromAxisAngle(AXE_Y, lacet);
    for (const p of paires) {
      if (!p.parent) {
        p.r.quaternion.copy(qLacet).multiply(p.D);
        continue;
      }
      const par = parIndex[p.parent];
      qTmp.copy(par ? par.D : qLacet).invert();
      p.r.quaternion.copy(qTmp).multiply(p.D);
    }
    // bassin : déplacement depuis le repos, à l'échelle du robot, tourné du cap
    if (bassinS && os.racine) {
      posPerso(bassinS, v1).sub(bassin0).multiplyScalar(echelle).applyQuaternion(qLacet);
      os.racine.position.set(v1.x, hanche + v1.y, v1.z);
    }
  }
  // pieds de la source : hauteur du plus bas de ses os de pied au-dessus de leur plus bas au repos (unités du fichier)
  const piedsS = corresp.filter((c) => /^(pied|orteils)_/.test(c[0])).map((c) => os_(c[1])).filter(Boolean);
  let piedsRepos = 1e9;
  for (const o of piedsS) piedsRepos = Math.min(piedsRepos, posPerso(o, v1).y);
  function hauteurPieds() {
    let m = 1e9;
    for (const o of piedsS) m = Math.min(m, posPerso(o, v1).y);
    return m - piedsRepos;
  }
  return { appliquer, hauteurPieds, echelle, manquants, bassin0 };
}
