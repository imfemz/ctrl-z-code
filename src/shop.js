// LOT : waves-shop — drone-marchand (maillage, arrivée à côté du joueur, pose, réparation, départ), modèle de
// boutique et achats (contrat : ARCHITECTURE.md § L).
//
// Le drone-marchand est un maillage simple (pièces fusionnées, matériau éclairé commun) et son ombre factice un
// disque au sol : deux appels de dessin au plus (§ G.7), aucun quand il est parti. Tout est créé à l'init ;
// reset() ne fait que cacher. Le modèle de boutique (getView, buy) est celui de la fondation, inchangé.
//
// Le drone et le joueur ne se recouvrent jamais (le joueur, lui, ne peut pas être arrêté : seul player.js le
// déplace). Trois règles, de la plus douce à la plus ferme :
//   1. il se pose du côté où le joueur ne va pas (à l'arrêt : le point du contrat, joueur + landOffset) ;
//   2. en vol à hauteur d'homme, à l'arrivée comme au départ, c'est lui qui s'écarte (comme les robots) ;
//   3. posé, si le joueur vient à son contact, la boutique s'ouvre sans attendre la fin de la pause.
import * as THREE from 'three';
import { ARME_COULEUR_UI, BUY, PALETTE, PLAYER, SFX, SHOP, STAT_COUNT, STAT_MAX_LEVEL, WEAPON_COUNT, WEAPON_KEYS, WEAPONS, WORLD, overchargeCost, salePrice } from './config.js';
import { P, randEvent, run } from './state.js';

let ctx = null;
let weapons = null;
let progression = null;
let audio = null;
let fx = null;
let world = null;
let camView = null;

const AWAY = 0;
const ARRIVING = 1;
const LANDED = 2;
const LEAVING = 3;
const MERCHANT_KEYS = ['away', 'arriving', 'landed', 'leaving'];
const TAU = Math.PI * 2;

let merchant = AWAY;
let arrivalDone = false;
// Son du posé déjà lancé pour cette descente : le fichier MERCHANT_LAND part audio.lead(id) s AVANT le contact, pour
// que son choc tombe sur l'image du posé (intégration des sons) ; un tampon synthétisé (lead 0) part au contact.
let landCue = false;
let isOpen = false;
let moved = false; // l'état du drone a changé depuis le dernier sync (rien à réécrire pendant la boutique, jeu figé)

// État du drone. Réécrit à chaque image de la séquence : dans un tableau typé (une variable de module qui reçoit
// un flottant coûte un nombre alloué à chaque écriture, § V).
const T_STATE = 0; // s écoulées dans l'état courant du marchand
const POS_X = 1; // position au sol (m)
const POS_Z = 2;
const ALT = 3; // altitude des patins (m)
const ROT = 4; // cap (rad)
const TILT = 5; // tangage (rad)
const ROLL = 6; // roulis (rad)
const SQUASH = 7; // écrasement à la pose (0 = aucun)
const CLOCK = 8; // s depuis le début de la séquence (phase du balancement)
const LIFT = 9; // m gardés au-dessus du profil de descente tant que la place n'est pas libre (0 en descente normale)
const M = new Float64Array(10);
const target = new Float64Array(2); // point de pose courant

// Points de pose possibles, autour du joueur, tous à la même distance de lui (celle de landOffset) : décalages
// monde (x, z) calculés une fois à l'init depuis les axes de l'écran. Dans l'ordre de préférence à l'arrêt : le
// point du contrat (à droite), son symétrique (à gauche), derrière, devant, puis les quatre diagonales. Le dernier
// emplacement est le repli, recalculé quand aucun des huit n'est libre.
const SIDES = 8;
const sideX = new Float64Array(SIDES + 1);
const sideZ = new Float64Array(SIDES + 1);
//#region e5:AB-camera-3p
// § E5.AB.8 : points de pose en axes d'ÉCRAN (droite, haut), gardés pour recalculer les décalages monde au lacet courant
const sideRight = new Float64Array(SIDES);
const sideUp = new Float64Array(SIDES);
/** Décalages monde des huit points de pose au lacet courant de la caméra (à chaque nouveau choix de côté). */
function axesCotes() {
  for (let k = 0; k < SIDES; k++) {
    sideX[k] = sideRight[k] * camView.rightX + sideUp[k] * camView.upX;
    sideZ[k] = sideRight[k] * camView.rightZ + sideUp[k] * camView.upZ;
  }
}
//#endregion e5:AB-camera-3p
let side = 0; // point de pose courant (indice)
let landReach = 0; // m — distance du joueur à son point de pose (écrite une fois, à l'init)

let mesh = null; // le drone
let modele = false; // modèle Blender posé (setModele, § Z quinquies)
let shadow = null; // son ombre factice au sol
let shadowDX = 0; // décalage de l'ombre par mètre d'altitude, à l'opposé du soleil
let shadowDZ = 0;

// Vue persistante, mise à jour sur place par getView().
const view = { fragments: 0, nextWave: 1, sale: -1, weapons: [], soin: 0 }; // soin : § E5.X7 (H6), PV rendus à l'ouverture
view.slots = []; // § E2.C : identifiants des armes possédées, dans l'ordre d'obtention — l'interface n'affiche que celles-là

// Étape 1 du plan addictif (§ E1.D)
const OVERCHARGE_K = 7; // offerId = w × 8 + 7 : surcharge de l'arme w (k = 6 reste invalide)
const FULL_LEVEL = 1 + STAT_COUNT * (STAT_MAX_LEVEL - 1); // niveau d'une arme dont tout est au maximum (21)
let saleOffer = -1; // offerId de l'offre soldée de la boutique ouverte ; −1 = aucune
let salesDrawn = 0; // boutiques ouvertes (un tirage de randEvent() chacune) et soldes posés, depuis le reset
let salesMade = 0;

function hexString(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

/**
 * Maillage du drone-marchand : le modèle Blender assets/modeles/marchand.glb (§ Z quinquies ; outils/blender/marchand.py, drone-processeur du 22/11), posé par setModele() à son
 * arrivée (main.js) ; d'ici là une géométrie vide. Avant = +Z local, patins posés sur y = 0, hauteur
 * MODELES.marchandHauteur × SHOP.merchant.scale. Appelé une fois, à l'init.
 */
function buildMerchant(render) {
  const m = new THREE.Mesh(render.emptyModelGeometry(), render.createLitMaterial({ glowColor: PALETTE.fragment }));
  m.name = 'marchand';
  // Rendu peint (§ Z quater) : vraie ombre (carte du soleil) et ombres reçues ; ombre de contact au sol (world.js)
  render.makeShadowCaster(m);
  m.receiveShadow = true;
  m.rotation.order = 'YXZ';
  m.visible = false;
  return m;
}

/** Modèle du marchand arrivé (main.js, une fois) : données de src/rendu/modeles.js ; la géométrie vide est libérée. */
export function setModele(donnees) {
  ctx.render.setModelGeometry(mesh, donnees);
  modele = true;
}

/** Ombre factice : disque sombre translucide posé au sol (pas de carte d'ombre : § G.4). */
function buildShadow(render) {
  const S = SHOP.merchant.shadow;
  const g = new THREE.CircleGeometry(1, 10);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(render.makePart(g, S.color, 0), render.createUnlitMaterial({ transparent: true, opacity: S.opacity }));
  m.name = 'marchand-ombre';
  m.renderOrder = S.order;
  m.visible = false;
  return m;
}

export function init(context) {
  ctx = context;
  weapons = ctx.weapons;
  progression = ctx.progression;
  audio = ctx.audio;
  fx = ctx.fx;
  world = ctx.world;
  camView = ctx.camera.view;
  for (let w = 0; w < WEAPON_COUNT; w++) {
    const W = WEAPONS[w];
    const stats = [];
    for (let s = 0; s < STAT_COUNT; s++) {
      stats.push({
        stat: s,
        label: W.statLabels[s],
        unit: W.statUnits[s],
        level: 0,
        maxLevel: STAT_MAX_LEVEL,
        value: 0,
        nextValue: null,
        offerId: w * 8 + 1 + s,
        cost: -1,
        baseCost: -1, // prix hors solde (§ E1.D)
        onSale: false,
        affordable: false,
        maxed: false,
      });
    }
    view.weapons.push({
      id: w,
      key: WEAPON_KEYS[w],
      name: W.name,
      desc: W.desc,
      color: hexString(ARME_COULEUR_UI[w]), // § E4.S.4 : couleur d'identité (icône cel)
      unlockWave: W.unlockWave,
      unlocked: false,
      owned: false,
      offerId: w * 8,
      cost: W.unlockCost,
      baseCost: W.unlockCost, // prix hors solde (§ E1.D)
      onSale: false,
      affordable: false,
      level: 0,
      stats,
      // Surcharge (§ E1.D) : proposée quand l'arme est au niveau 21. level = crans achetés, percent = bonus de dégâts actuel (%).
      overcharge: { offerId: w * 8 + OVERCHARGE_K, label: SHOP.overcharge.label, level: 0, percent: 0, nextPercent: 0, cost: 0, baseCost: 0, onSale: false, affordable: false, available: false },
    });
  }

  // Points de pose, en axes d'écran (droite, haut) puis en décalages monde.
  const O = SHOP.landOffset;
  landReach = Math.sqrt(O.right * O.right + O.up * O.up);
  const diag = landReach * Math.SQRT1_2;
  const offRight = [O.right, -O.right, 0, 0, diag, -diag, -diag, diag];
  const offUp = [O.up, O.up, landReach, -landReach, diag, diag, -diag, -diag];
  for (let k = 0; k < SIDES; k++) {
    sideRight[k] = offRight[k];
    sideUp[k] = offUp[k];
  }
  axesCotes(); // § E5.AB.8
  sideX[SIDES] = sideX[0];
  sideZ[SIDES] = sideZ[0];

  // Drone-marchand et son ombre : créés et ajoutés à la scène ici, cachés (le prewarm les compile quand même).
  const sun = WORLD.light.sunDir;
  if (sun[1] > 0) {
    shadowDX = -sun[0] / sun[1];
    shadowDZ = -sun[2] / sun[1];
  }
  mesh = buildMerchant(ctx.render);
  shadow = buildShadow(ctx.render);
  ctx.scene.add(mesh);
  ctx.scene.add(shadow);
}

export function reset() {
  merchant = AWAY;
  arrivalDone = false;
  isOpen = false;
  saleOffer = -1;
  salesDrawn = 0;
  salesMade = 0;
  moved = false;
  side = 0;
  M.fill(0);
  mesh.visible = false;
  shadow.visible = false;
}

/** Le point de pose k est-il libre : dans l'arène et hors de tout obstacle, sur toute l'emprise du drone ? */
function isSideFree(k) {
  const r = SHOP.merchant.radius;
  const x = P.x + sideX[k];
  const z = P.z + sideZ[k];
  return world.isInsideArena(x, z, r) && !world.overlaps(x, z, r);
}

/**
 * Point de pose, réévalué à chaque image de la descente : résultat dans side et target.
 *
 * Joueur à l'arrêt : le premier point libre dans l'ordre de la table — le point du contrat, joueur + landOffset,
 * tant qu'il n'est ni dans un obstacle ni hors de l'arène. Joueur en marche : le point libre le plus à l'opposé
 * de sa marche, pour qu'il ne finisse pas dans le drone en continuant d'avancer.
 *
 * keep : garder le point courant tant qu'il est libre et que le joueur ne marche pas vers lui (le drone ne
 * papillonne pas d'un côté à l'autre). committed : fin de descente, on ne change plus de côté pour suivre la
 * marche — seulement si le point n'est plus libre.
 */
function chooseSide(keep, committed) {
  // § E5.AB.8 : nouveau choix — points de pose au lacet courant (gardés pendant la descente : le drone ne tourne pas
  // autour du héros quand la caméra tourne)
  if (!keep) axesCotes();
  const D = SHOP.merchant;
  const vx = P.vx;
  const vz = P.vz;
  const speed2 = vx * vx + vz * vz;
  const walking = speed2 > D.headingMinSpeed * D.headingMinSpeed;
  let k = side;
  let kept = false;
  if (keep && isSideFree(k)) {
    kept = !walking || committed || sideX[k] * vx + sideZ[k] * vz <= D.headingAvoidCos * landReach * Math.sqrt(speed2);
  }
  if (!kept) {
    k = -1;
    let least = Infinity;
    for (let i = 0; i < SIDES; i++) {
      if (!isSideFree(i)) continue;
      if (!walking) {
        k = i;
        break;
      }
      const along = sideX[i] * vx + sideZ[i] * vz; // > 0 : le point est devant le joueur
      if (along < least) {
        least = along;
        k = i;
      }
    }
    if (k < 0) {
      // Aucun des huit points n'est libre (joueur au fond d'un coin) : à la même distance, vers le centre de l'arène.
      k = SIDES;
      let dx = -P.x;
      let dz = -P.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 1e-3) {
        dx /= d;
        dz /= d;
      } else {
        dx = camView.upX;
        dz = camView.upZ;
      }
      sideX[k] = dx * landReach;
      sideZ[k] = dz * landReach;
      if (!isSideFree(k)) {
        // Dernier recours (joueur coincé entre des obstacles) : le point du contrat ramené dans l'arène, puis
        // écarté du joueur jusqu'à ce que le drone ne le recouvre pas.
        const lim = WORLD.half - D.radius;
        const x = P.x + sideX[0];
        const z = P.z + sideZ[0];
        let ox = (x > lim ? lim : x < -lim ? -lim : x) - P.x;
        let oz = (z > lim ? lim : z < -lim ? -lim : z) - P.z;
        const o = Math.sqrt(ox * ox + oz * oz);
        const min = D.radius + P.radius;
        if (o < min) {
          if (o > 1e-3) {
            ox *= min / o;
            oz *= min / o;
          } else {
            ox = dx * min;
            oz = dz * min;
          }
        }
        sideX[k] = ox;
        sideZ[k] = oz;
      }
    }
    side = k;
  }
  target[0] = P.x + sideX[k];
  target[1] = P.z + sideZ[k];
}

/**
 * Le drone ne recouvre jamais le joueur quand il vole à hauteur d'homme. Au-dessus de overflyHeight il peut le
 * survoler ; en dessous il s'en écarte, de plus en plus à mesure qu'il descend, jusqu'à « emprise + rayon du
 * joueur » à PLAYER.height et plus bas. C'est lui qui cède la place, comme les robots que le joueur repousse hors
 * de son cercle (§ B.2). Il reste dans l'arène. Lit M[ALT], corrige M[POS_X] et M[POS_Z].
 */
function yieldToPlayer() {
  const D = SHOP.merchant;
  const alt = M[ALT];
  if (alt >= D.overflyHeight) return;
  let reach = D.radius + P.radius;
  if (alt > PLAYER.height) reach *= (D.overflyHeight - alt) / (D.overflyHeight - PLAYER.height);
  let dx = M[POS_X] - P.x;
  let dz = M[POS_Z] - P.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= reach * reach) return;
  if (d2 > 1e-6) {
    const s = reach / Math.sqrt(d2);
    dx *= s;
    dz *= s;
  } else {
    // exactement au-dessus de lui : il part vers la droite de l'écran
    dx = camView.rightX * reach;
    dz = camView.rightZ * reach;
  }
  const lim = WORLD.half - D.radius * D.clearance;
  const x = P.x + dx;
  const z = P.z + dz;
  M[POS_X] = x > lim ? lim : x < -lim ? -lim : x;
  M[POS_Z] = z > lim ? lim : z < -lim ? -lim : z;
}

function show(on) {
  mesh.visible = on;
  shadow.visible = on && SHOP.merchant.shadow.enabled !== false; // disque factice : retiré par le rendu peint
}

/** S11 : séquence du marchand (no-op hors séquence). */
export function update(dt) {
  if (merchant === AWAY) return;
  const D = SHOP.merchant;
  M[T_STATE] += dt;
  M[CLOCK] += dt;
  moved = true;
  const t = M[T_STATE];
  if (merchant === ARRIVING) {
    let v = 1 - t / SHOP.arrivalSeconds; // 1 en haut, 0 au contact
    if (v < 0) v = 0;
    const nominal = SHOP.arrivalHeight * Math.pow(v, D.arrivalEase); // profil de descente : il arrive vite puis freine
    // Le point de pose suit le joueur ; le drone le rejoint sans à-coup, sans jamais recouvrir le joueur.
    chooseSide(true, nominal < D.commitHeight);
    const k = 1 - Math.exp(-D.followRate * dt);
    M[POS_X] += (target[0] - M[POS_X]) * k;
    M[POS_Z] += (target[1] - M[POS_Z]) * k;
    yieldToPlayer();
    // Il ne se pose ni dans un rocher, ni dans la falaise, ni loin de son point de pose : si le joueur l'a pris de
    // court (dash, point de pose qui change de côté), il attend au-dessus du sol d'y être. L'altitude ne saute
    // jamais : il remonte vers hoverHeight à hoverClimb m/s au plus, et en redescend à landSpeed m/s.
    const gapX = target[0] - M[POS_X];
    const gapZ = target[1] - M[POS_Z];
    const blocked =
      gapX * gapX + gapZ * gapZ > D.landTolerance * D.landTolerance ||
      !world.isInsideArena(M[POS_X], M[POS_Z], D.radius * D.clearance) ||
      world.overlaps(M[POS_X], M[POS_Z], D.radius * D.clearance);
    let want = 0; // réserve voulue au-dessus du profil
    if (blocked && nominal < D.hoverHeight && t < SHOP.arrivalSeconds + D.landGraceSeconds) want = D.hoverHeight - nominal;
    let lift = M[LIFT];
    if (want > lift) {
      const most = M[ALT] + D.hoverClimb * dt - nominal; // l'ALTITUDE ne gagne pas plus de hoverClimb × dt
      lift = want < most ? want : most;
    } else if (lift > want) {
      lift -= D.landSpeed * dt;
      if (lift < want) lift = want;
    }
    M[LIFT] = lift;
    if (!landCue && want === 0) {
      // Temps restant avant le contact : la fin du profil de descente, ou la réserve qui redescend à landSpeed.
      const early = audio.lead(SFX.MERCHANT_LAND);
      if (early > 0) {
        let remain = SHOP.arrivalSeconds - t;
        const sink = lift / D.landSpeed;
        if (sink > remain) remain = sink;
        if (remain <= early) {
          landCue = true;
          audio.play(SFX.MERCHANT_LAND);
        }
      }
    }
    const alt = nominal + lift;
    M[ALT] = alt;
    let air = lift / D.hoverHeight; // en attente au-dessus du sol il se balance encore
    if (air > 1) air = 1;
    if (air < v) air = v;
    M[ROT] = Math.atan2(P.x - M[POS_X], P.z - M[POS_Z]) + D.spinTurns * TAU * v * v; // finit face au joueur
    M[TILT] = D.descentTilt * v;
    M[ROLL] = Math.sin(M[CLOCK] * D.swayHz * TAU) * D.swayRad * air;
    if (t >= SHOP.arrivalSeconds && alt <= 0) {
      // contact : poussière et son ; le drone ne bouge plus
      merchant = LANDED;
      M[T_STATE] = t - SHOP.arrivalSeconds < dt ? t - SHOP.arrivalSeconds : 0; // posé à l'heure : le reste du pas compte déjà pour la pause
      M[ALT] = 0;
      M[LIFT] = 0;
      M[TILT] = 0;
      M[ROLL] = 0;
      M[SQUASH] = D.squash;
      fx.spawnRing(M[POS_X], M[POS_Z], SHOP.landRingRadius, PALETTE.merchant);
      if (!landCue) audio.play(SFX.MERCHANT_LAND);
      landCue = true;
    }
  } else if (merchant === LANDED) {
    if (!arrivalDone) {
      if (t >= SHOP.settleSeconds) arrivalDone = true;
      else {
        // Le joueur vient au contact du drone posé (là où il sera au prochain pas s'il continue) : la boutique
        // s'ouvre tout de suite, il ne lui passe pas à travers pendant la pause.
        const reach = D.radius + P.radius;
        const dx = P.x + P.vx * dt - M[POS_X];
        const dz = P.z + P.vz * dt - M[POS_Z];
        if (dx * dx + dz * dz < reach * reach) arrivalDone = true;
      }
    }
    // la suspension encaisse la pose : écrasement amorti
    M[SQUASH] = D.squash * Math.exp(-t * D.squashDamp) * Math.cos(t * D.squashHz * TAU);
  } else if (merchant === LEAVING) {
    let u = t / SHOP.departureSeconds;
    if (u > 1) u = 1;
    M[ALT] = SHOP.arrivalHeight * Math.pow(u, D.departureEase); // il décolle doucement puis file
    yieldToPlayer(); // le joueur qui marche vers lui pendant le décollage le pousse devant lui
    M[ROT] += D.leaveSpinTurns * TAU * u * dt;
    M[TILT] = -D.descentTilt * u;
    M[ROLL] = Math.sin(M[CLOCK] * D.swayHz * TAU) * D.swayRad * u;
    M[SQUASH] = 0;
    if (t >= SHOP.departureSeconds) {
      merchant = AWAY;
      M[T_STATE] = 0;
      show(false);
    }
  }
}

/** F11 : place le drone et son ombre, seulement quand il a bougé (parti, il est caché ; posé, il ne bouge plus). */
export function sync() {
  if (!moved) return;
  moved = false;
  if (merchant === AWAY) return;
  const S = SHOP.merchant.shadow;
  const sq = M[SQUASH];
  const wide = 1 + sq * SHOP.merchant.squashBulge;
  mesh.position.set(M[POS_X], M[ALT], M[POS_Z]);
  mesh.rotation.set(M[TILT], M[ROT], M[ROLL]);
  mesh.scale.set(wide, 1 - sq, wide);
  // L'ombre glisse vers le point de pose à mesure que le drone descend (même direction que les ombres du soleil).
  const h = M[ALT] + S.bodyHeight;
  let near = 1 - M[ALT] / SHOP.arrivalHeight;
  if (near < 0) near = 0;
  const size = S.radius * (S.minScale + (1 - S.minScale) * near);
  shadow.position.set(M[POS_X] + shadowDX * h, S.y, M[POS_Z] + shadowDZ * h);
  shadow.scale.set(size, 1, size);
}

/** Le drone-marchand apparaît à arrivalHeight au-dessus de son point de pose et descend se poser à côté du joueur. */
export function beginArrival() {
  merchant = ARRIVING;
  arrivalDone = false;
  landCue = false;
  chooseSide(false, false);
  M[T_STATE] = 0;
  M[CLOCK] = 0;
  M[POS_X] = target[0];
  M[POS_Z] = target[1];
  M[ALT] = SHOP.arrivalHeight;
  M[LIFT] = 0;
  M[ROT] = Math.atan2(P.x - M[POS_X], P.z - M[POS_Z]) + SHOP.merchant.spinTurns * TAU;
  M[TILT] = SHOP.merchant.descentTilt;
  M[ROLL] = 0;
  M[SQUASH] = 0;
  moved = true;
  show(true);
}

export function isArrivalDone() {
  return arrivalDone;
}

/** Ouvre la boutique : réparation à l'arrivée, solde du jour tiré, vue préparée. */
export function open() {
  isOpen = true;
  // § E5.X7 (H6) : les PV réellement rendus, dits sous le titre « Décryptage » (ui.fillShop)
  view.soin = SHOP.repairOnArrival > 0 ? Math.round(ctx.player.heal(SHOP.repairOnArrival * P.maxHp)) : 0;
  // Soldes (§ E1.D) : UN tirage de randEvent() par boutique, toujours (le calendrier des événements reste à
  // « 2 tirages par vague + 1 par boutique », qu'une offre soit soldée ou non).
  saleOffer = pickSale(randEvent());
  salesDrawn++;
  if (saleOffer >= 0) salesMade++;
  getView();
}

export function close() {
  isOpen = false;
  saleOffer = -1; // le solde vaut pour un achat (buy), au plus tard jusqu'à la fermeture
}

/** L'offre existe-t-elle et peut-elle être achetée (fragments mis à part) ? Débloquée et pas encore prise, stat pas au maximum, surcharge ouverte. */
function isAvailable(offerId) {
  const w = offerId >> 3;
  const k = offerId & 7;
  if (k === 0) return false; // § E2.C : le marchand ne vend plus d'arme (elles sortent des coffres)
  if (weapons.owned[w] === 0) return false;
  if (k === OVERCHARGE_K) return weapons.getWeaponLevel(w) >= FULL_LEVEL;
  return k <= STAT_COUNT && weapons.getLevel(w, k - 1) < STAT_MAX_LEVEL;
}

/** Offre soldée pour le tirage r ∈ [0, 1) : une des offres disponibles, à chances égales ; −1 s'il n'y en a aucune. */
function pickSale(r) {
  let n = 0;
  for (let id = 0; id < WEAPON_COUNT * 8; id++) if ((id & 7) !== 6 && isAvailable(id)) n++;
  if (n === 0) return -1;
  let pick = Math.floor(r * n);
  if (pick >= n) pick = n - 1;
  for (let id = 0; id < WEAPON_COUNT * 8; id++) {
    if ((id & 7) === 6 || !isAvailable(id)) continue;
    if (pick === 0) return id;
    pick--;
  }
  return -1;
}

/** Prix hors solde de l'offre (−1 : rien à vendre). */
function basePrice(offerId) {
  const w = offerId >> 3;
  const k = offerId & 7;
  if (k === 0) return -1; // § E2.C : rien à vendre
  if (k === OVERCHARGE_K) return overchargeCost(w, weapons.getOvercharge(w));
  return weapons.getUpgradeCost(w, k - 1);
}

/** Prix à payer : le prix hors solde, ou round(prix × (1 − SHOP.sale.discount)) pour l'offre soldée. */
function price(offerId) {
  const base = basePrice(offerId);
  return base >= 0 && offerId === saleOffer ? salePrice(base) : base;
}

/** Le marchand redécolle (pendant le compte à rebours). */
export function beginDeparture() {
  if (merchant === AWAY) {
    // jamais posé (appel hors séquence) : il part du point de pose
    chooseSide(false, false);
    M[POS_X] = target[0];
    M[POS_Z] = target[1];
    M[ROT] = Math.atan2(P.x - M[POS_X], P.z - M[POS_Z]);
    M[CLOCK] = 0;
    show(true);
  }
  merchant = LEAVING;
  arrivalDone = false;
  moved = true;
  M[T_STATE] = 0;
  M[ALT] = 0;
  M[SQUASH] = 0;
  fx.spawnRing(M[POS_X], M[POS_Z], SHOP.landRingRadius * SHOP.merchant.leaveRingScale, PALETTE.merchant);
  audio.play(SFX.MERCHANT_LEAVE);
}

/** Vue de la boutique : objet persistant, mis à jour sur place. */
export function getView() {
  const money = run.fragments;
  const nextWave = run.wave + 1;
  view.fragments = money;
  view.nextWave = nextWave;
  view.sale = saleOffer;
  view.slots.length = 0;
  for (let k = 0; k < weapons.slotCount; k++) view.slots.push(weapons.slots[k]);
  for (let w = 0; w < WEAPON_COUNT; w++) {
    const v = view.weapons[w];
    const isOwned = weapons.owned[w] === 1;
    v.unlocked = weapons.isUnlocked(w, nextWave);
    v.owned = isOwned;
    // § E2.C : plus d'achat d'arme — l'offre k = 0 n'a ni prix ni solde et n'est jamais « abordable »
    v.baseCost = -1;
    v.cost = -1;
    v.onSale = false;
    v.affordable = false;
    v.level = weapons.getWeaponLevel(w);
    const oc = v.overcharge;
    oc.level = weapons.getOvercharge(w);
    oc.percent = Math.round(SHOP.overcharge.damagePerLevel * oc.level * 100);
    oc.nextPercent = Math.round(SHOP.overcharge.damagePerLevel * (oc.level + 1) * 100);
    oc.available = isOwned && v.level >= FULL_LEVEL;
    oc.baseCost = overchargeCost(w, oc.level);
    oc.cost = price(oc.offerId);
    oc.onSale = oc.offerId === saleOffer;
    oc.affordable = oc.available && money >= oc.cost;
    for (let s = 0; s < STAT_COUNT; s++) {
      const st = v.stats[s];
      const level = weapons.getLevel(w, s);
      const shown = level > 0 ? level : 1;
      st.level = level;
      st.value = weapons.getStat(w, s);
      st.maxed = level >= STAT_MAX_LEVEL;
      // valeur suivante : même rapport que la stat effective (bonus passifs compris)
      const base = weapons.getStatAt(w, s, shown);
      st.nextValue = shown < STAT_MAX_LEVEL ? (base !== 0 ? (st.value / base) * weapons.getStatAt(w, s, shown + 1) : weapons.getStatAt(w, s, shown + 1)) : null;
      st.baseCost = weapons.getUpgradeCost(w, s);
      st.cost = price(st.offerId);
      st.onSale = st.offerId === saleOffer && !st.maxed;
      st.affordable = isOwned && !st.maxed && st.cost >= 0 && money >= st.cost;
    }
  }
  return view;
}

/**
 * offerId = w × 8 + k : k = 0 débloque l'arme w ; k = 1…5 améliore la stat k − 1 ; k = 7 achète un cran de surcharge
 * (§ E1.D : arme au niveau 21, sans limite) ; k = 6 n'existe pas. L'offre soldée de la boutique est payée à son prix soldé.
 */
export function buy(offerId) {
  const r = buyOffer(offerId);
  // § E1.S : un solde = UN achat. L'offre soldée acquise, le cran suivant de la même ligne revient au prix normal
  // (avant : toute la ligne restait à −30 % jusqu'à la fermeture, surcharge sans plafond comprise).
  if (r === BUY.OK && offerId === saleOffer) saleOffer = -1;
  return r;
}

function buyOffer(offerId) {
  if (!isOpen) return BUY.CLOSED;
  if (!Number.isInteger(offerId) || offerId < 0) return BUY.INVALID;
  const w = offerId >> 3;
  const k = offerId & 7;
  if (w >= WEAPON_COUNT || (k > STAT_COUNT && k !== OVERCHARGE_K)) return BUY.INVALID;
  // § E2.C règle 2 : k = 0 n'est plus une offre. Signature gardée ; rien n'est dépensé, rien n'est donné.
  if (k === 0) return BUY.LOCKED;
  if (weapons.owned[w] === 0) return BUY.NOT_OWNED;
  if (k === OVERCHARGE_K) {
    if (weapons.getWeaponLevel(w) < FULL_LEVEL) return BUY.LOCKED;
    if (!progression.spendFragments(price(offerId))) return BUY.TOO_EXPENSIVE;
    weapons.addOvercharge(w);
    return BUY.OK;
  }
  const s = k - 1;
  if (weapons.getUpgradeCost(w, s) < 0) return BUY.MAXED;
  if (!progression.spendFragments(price(offerId))) return BUY.TOO_EXPENSIVE;
  weapons.upgradeStat(w, s);
  return BUY.OK;
}

export function inspect(out) {
  out.open = isOpen;
  out.merchant = MERCHANT_KEYS[merchant];
  out.sale = saleOffer; // offerId de l'offre soldée (§ E1.D), −1 = aucune
  out.salesDrawn = salesDrawn; // boutiques ouvertes depuis le reset (un tirage de randEvent chacune)
  out.salesMade = salesMade;
  // en plus du contrat (lecture seule, pour les tests et l'affichage de debug)
  out.arrivalDone = arrivalDone;
  out.x = M[POS_X];
  out.z = M[POS_Z];
  out.altitude = M[ALT];
  out.visible = mesh !== null && mesh.visible;
  out.landX = target[0];
  out.landZ = target[1];
  out.side = side; // point de pose courant : 0 = celui du contrat, 1 à 7 = les autres côtés, 8 = repli
  out.lift = M[LIFT];
  out.modele = modele; // modèle Blender posé (§ Z quinquies)
}
