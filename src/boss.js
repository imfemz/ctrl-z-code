// LOT : boss — boss à 2 phases : arrivée annoncée (alarme, marque au sol, chute), déplacement, changement de phase,
// 4 attaques télégraphiées au sol (frappe, ruée, obus, invocation), mort, maillage et ombre
// (contrat : ARCHITECTURE.md § J.4, § J.2, § H.2, § H.3, § G.3, § G.4, § N).
//
// Qui fait quoi :
//   • le boss vit dans E (type ENEMY.BOSS) : damage, les armes et la grille le traitent comme un robot ;
//   • enemies.update (S5) décompte E.timer et E.cd du boss et le fait frapper au contact ; ce module (S6) est le
//     SEUL à écrire E.x, E.z, E.vx, E.vz et E.rot du boss ;
//   • E.state = état de l'IA, E.timer = durée restante de l'état (arrêt, récupération, tir), E.cd = pause commune
//     entre deux attaques, E.ai0…ai3 = ruée (direction, distance restante, joueur déjà touché) ;
//   • les zones au sol ont leurs propres minuteries (privées) : ce sont elles qui déclenchent les frappes. Le
//     télégraphe d'une attaque dure donc exactement sa clé « telegraph », et tout se fige quand les robots sont
//     figés (debug.areEnemiesFrozen) ;
//   • un seul boss à la fois : l'état privé est rattaché à E.uid du boss suivi, jamais à un indice.
//
// Lisibilité (ce qui se voit quoi qu'il y ait à l'écran) :
//   • les fonds des zones sont des décalques au sol, que la horde cache ; leurs CONTOURS (traits des cercles,
//     bordures et barres du couloir) sont dessinés par-dessus les robots — voir « Contours » plus bas ;
//   • le corps du boss s'ouvre autour du joueur qu'il cacherait (fenêtre découpée dans son matériau, addReveal).
import * as THREE from 'three';
import {
  BMUT,
  BMUT_COUNT,
  BOSS,
  CAPS,
  DMG,
  DMG_SRC,
  EFLAG,
  ENEMIES,
  ENEMY,
  FXK,
  HURT,
  PLAYER,
  RENDER,
  SFX,
  TRAUMA,
  WAVES,
  WORLD,
  bossFragments,
  bossHpMul,
  bossMutations,
  bossPriseEnMain,
  bossPvMul,
  bossRank,
  waveDmgMul,
  waveHpMul,
} from './config.js';
import { E, P, PRIO, rand, run } from './state.js';
import { ARGF, F_T, F_V, F_X, F_Z } from './state.js'; // § E5.X8
import { CHESTS, CHEST_FLAG } from './config.js'; // § E2.C ; § E2.G bis (coffre du boss gardé)
import { CHEST_FLAG_BOSS } from './config.js'; // § E3.A : taille du coffre du boss
//#region e5:X8-lot8
import { LOT8 } from './config.js'; // § E5.X8 (E9) : récupération lisible, récupération après les obus
// XB : [0] × émissifs, [1] s entre deux bouffées, [2] minuterie de la vapeur, [3] hauteur, [4] rayon, [5] gain du son,
// [6] sa vitesse, [7] × émissifs appliqué en ce moment (1 hors récupération)
const XB = new Float64Array([LOT8.bossRecup.emissifs, LOT8.bossRecup.vapeurEcart, 0, LOT8.bossRecup.vapeurHauteur, LOT8.bossRecup.vapeurRayon, LOT8.bossRecup.son.gain, LOT8.bossRecup.son.vitesse, 1]);
const XB_SON = LOT8.bossRecup.son.id | 0;
const XB_VAPEUR = LOT8.bossRecup.vapeurCouleur;
let recX8 = 0; // 1 = le boss est en récupération (S_RECOVER) à la dernière image
let recupsX8 = 0; // récupérations commencées (tests)
let vapeursX8 = 0; // bouffées de vapeur (tests)
let recupsObusX8 = 0; // récupérations après les obus (tests)
//#endregion e5:X8-lot8
import { CAUSE } from './config.js'; // § E5.Q (C2) : cause des coups du boss ; (B13) sons d'annonce par attaque
import { CONFORT_FLASHS as CF } from './config.js'; // § E5.X5 (audit C12) : réglage « Flashs »
// Animation (étape « animations », ARCHITECTURE.md § Z sexies) : le corps en pièces (marche à genoux, pieds posés,
// gestes, flammes simulées aux cheminées, son des pas au contact du pied) et les obus / invocations qui partent de son
// corps. Le maillage « boss » ci-dessous reste l'ancre de pose (matrice, visibilité, uniformes) sur le calque 7.
import * as bossCorps from './anim/boss-corps.js';
import { appliquerTexturesModele } from './rendu/materiaux.js'; // boss allégé à texture cuite (17/11)
import * as bossAnim from './anim/boss-anim.js';

const TWO_PI = Math.PI * 2;

let ctx = null;
let enemies = null;
let camera = null;
let audio = null;
let fx = null;
let pickups = null;
let chests = null; // § E2.C : coffre du boss
let debug = null;
let damage = null;
let render = null;
let view = null;

// ----- Maillages (tous créés à l'init, jamais recréés) -----------------------------------------------------------------
let mesh = null; // corps : Mesh simple, projette une ombre
let overlay = null; // pièces incandescentes de la phase 2 (enfant du corps, cachées en phase 1)
let modele = false; // modèle Blender posé (setModele, § Z quinquies)
let uFx = null; // Vector2 du corps : x = flash blanc, y = lueur rouge
let uFxOverlay = null;
let uBoost = null; // uniforme { value } : gain des émissifs du corps
let uBoostOverlay = null;
let discMesh = null; // zones circulaires, au sol (décalques instanciés : fond + disque qui grandit)
let ringMesh = null; // contours des zones circulaires (traits du fond et du disque), par-dessus les robots
let quadMesh = null; // couloir de la ruée (rectangles instanciés : fond et remplissage au sol, bordures et barres par-dessus)
let laserMesh = null; // § E1.D : rayons du balayage laser et liens des drones-boucliers (boîtes additives instanciées)

// ----- Contours par-dessus les robots ----------------------------------------------------------------------------------
// Un contour reste un décalque avec test de profondeur, mais il est posé à la hauteur CONTOUR_Y et décalé de
// (CONTOUR_D[0], CONTOUR_D[1]) le long de l’axe de visée : en projection orthographique il tombe exactement sur son
// tracé au sol, quelle que soit la secousse (décalage dans le plan de l'écran, roulis autour de l'axe de visée).
// Rien de ce qui est plus bas que CONTOUR_Y ne le cache (robots, joueur, rochers) ; le haut du boss et les
// falaises le cachent encore, comme il se doit. Sous le corps du boss, les contours restent au sol (BODY_R).
let CONTOUR_Y = 0;
// § E5.AB : décalage des contours dans un tableau typé — refait à chaque image où la souris tourne la caméra (onPitch) :
// une variable de module qui reçoit un flottant coûterait un nombre alloué à chaque écriture (§ V)
const CONTOUR_D = new Float64Array(2); // x, z
const BODY_R = BOSS.radius * 1.2; // m — emprise du corps (épaules comprises) autour de son centre
const STOP_EPS = 0.01; // m — il ne repart pas pour moins que cela (E.x et E.z sont en simple précision)

// ----- Fenêtre sur le joueur (uniformes partagés par le corps et les pièces de la phase 2) ---------------------------
const uHole = new THREE.Vector4(0, 0, 0, 0); // xyz : centre du joueur ; w : rayon (0 = aucune fenêtre)
const uHoleDir = new THREE.Vector3(0, -1, 0); // axe de visée, de la caméra vers le sol (unitaire)
let revealReady = false; // les insertions du shader ont trouvé leurs repères

// ----- Arrivée (hors de E) ---------------------------------------------------------------------------------------------
const A_NONE = 0;
const A_ALARM = 1; // alarme : marque au sol, rien dans le ciel
const A_DROP = 2; // chute
const A_LAND = 3; // au sol, en attente d'un emplacement libre dans E (nouvel essai à chaque image)
const ARRIVAL_NAMES = ['none', 'alarm', 'drop', 'landing'];
let arrival = A_NONE;
let arrWave = 1; // (le point de chute est dans T : T_AX, T_AZ)

// ----- IA du boss (E.state) --------------------------------------------------------------------------------------------
const S_CHASE = 0; // marche vers le joueur, choisit une attaque
const S_SLAM = 1; // frappe : télégraphe, immobile
const S_AIM = 2; // ruée : télégraphe, il vise puis verrouille
const S_RUSH = 3; // ruée
const S_CAST = 4; // obus : tir, immobile (les obus tombent ensuite pendant qu'il marche)
const S_SUMMON = 5; // invocation : télégraphe, immobile
const S_STUN = 6; // changement de phase : arrêt
const S_RECOVER = 7; // récupération après un atterrissage ou une attaque
const S_SWEEP = 8; // balayage laser (§ E1.D) : annonce puis rayon, immobile, il tourne avec le rayon
const STATE_NAMES = ['chase', 'slam', 'aim', 'rush', 'cast', 'summon', 'stun', 'recover', 'sweep'];

const ATK_NONE = 0;
const ATK_SLAM = 1;
const ATK_CHARGE = 2;
const ATK_MORTAR = 3;
const ATK_SUMMON = 4;
const ATK_SWEEP = 5; // § E1.D : rang 2 et suivants
const NATK = 6;
const ATTACK_NAMES = [null, 'slam', 'charge', 'mortar', 'summon', 'sweep'];
const ATTACK_KEYS = ['', 'slam', 'charge', 'mortar', 'summon', 'sweep'];

let trackedUid = 0; // E.uid du boss pris en charge (0 = aucun)
let phase = 1; // 1, 2, ou 3 (enragé, § E1.D)
let flashDue = false; // changement de phase en cours : l'allumage (flash blanc) reste à faire, au milieu de l'arrêt
let ignited = false; // la phase 2 est visible (pièces incandescentes allumées au milieu de l'arrêt)
let curAttack = ATK_NONE; // attaque en cours, télégraphe compris
let flickerStep = -1; // dernier palier écrit du vacillement des pièces incandescentes
let mortarLeft = 0; // obus encore en l'air
let summonLeft = 0; // points d'invocation encore marqués
const atkCd = new Float64Array(NATK); // recharge propre à chaque attaque (s), index = ATK_*
const allowed = new Uint8Array(NATK * 4); // [attaque × 4 + phase] : l'attaque existe-t-elle dans cette phase, pour ce rang ?

// ----- Mutations du boss suivi (§ E1.D) : écrites une fois par boss, à sa prise en charge (applyRank) -----------------
const MUT = new Float64Array(BMUT_COUNT); // bossMutations(rang) : index BMUT.*
let rank = 1; // rang du boss suivi (bossRank de sa vague)
let bossWave = 1; // vague du boss suivi (PV des drones-boucliers)
let beams = 0; // rayons du balayage (0 = pas de balayage)
let summonType = BOSS.attacks.summon.type;
let summonCount = BOSS.attacks.summon.count;
let droneCount = 0; // drones-boucliers voulus
let slamLeft = 0; // frappes encore à venir dans la série en cours (enragé : BOSS.enrage.slamRepeat)
let sweepHit = 0; // masque : rayons du balayage en cours qui ont déjà touché le joueur
const F_SD = EFLAG.SHIELD_DRONE;
const RAD = Math.PI / 180;

// ----- Zones au sol (pool privé) ---------------------------------------------------------------------------------------
const Z_SLAM = 1; // cercle de la frappe
const Z_CHARGE = 2; // couloir de la ruée pendant son télégraphe
const Z_LANE = 3; // couloir pendant la ruée (ce qu'il reste à parcourir)
const Z_MORTAR = 4; // cercle d'un obus
const Z_SUMMON = 5; // point d'invocation
const Z_SWEEP = 6; // balayage laser pendant son annonce (centre = le boss, zRot = angle de départ, zLen = portée)
const Z_BEAM = 7; // balayage laser pendant que le rayon tourne (zT = s restantes, zD = durée du balayage)
const ZONE_NAMES = ['', 'slam', 'charge', 'lane', 'mortar', 'summon', 'sweep', 'beam'];
const ZCAP = CAPS.telegraphs;
const zKind = new Uint8Array(ZCAP);
const zX = new Float32Array(ZCAP);
const zZ = new Float32Array(ZCAP);
const zR = new Float32Array(ZCAP); // rayon (cercle) ou demi-largeur (couloir)
const zT = new Float32Array(ZCAP); // s restantes avant la frappe
const zD = new Float32Array(ZCAP); // durée totale du télégraphe
const zV = new Float32Array(ZCAP); // dégâts au joueur, multiplicateur de vague compris
const zRot = new Float32Array(ZCAP); // cap du couloir
const zLen = new Float32Array(ZCAP); // longueur du couloir
let zCount = 0;

const DISC_PER_ZONE = 2; // fond + disque qui grandit (et, dans ringMesh, le trait de chacun)
const DISC_CAP = (ZCAP + 1) * DISC_PER_ZONE; // + la marque d'arrivée
// un seul couloir à la fois : fond, remplissage, 5 bordures (2 côtés × 2 niveaux, le bout), barres (16 au plus) ; ou
// l'arc d'un balayage laser (§ E1.D) : par rayon, un rectangle de départ et des rayons fins (3 × (1 + 6) au plus)
const QUAD_CAP = 40;
const LASER_CAP = 16; // 3 rayons × (trait visière → rayon, rayon au sol, son cœur) + 6 liens de drones-boucliers
const QD_STRIDE = 6;
const QD = new Float32Array(QUAD_CAP * QD_STRIDE); // rectangles du couloir : latéral, départ, largeur, longueur, gain, niveau (0 sol, 1 contour)

// ----- Scalaires réécrits à chaque image : dans un tableau typé (§ V) -------------------------------------------------
const T_ARR = 0; // s écoulées dans l'étape d'arrivée en cours
const T_CLOCK = 1; // horloge simulée du module (clignotements, barres du couloir, tremblement)
const T_WALK = 2; // phase du pas (rad)
const T_GAIT = 3; // 0..1 : il marche
const T_LEAN = 4; // penché vers l'avant (rad)
const T_LIFT = 5; // surélévation (m)
const T_SQUASH = 6; // écrasement (> 0) ou étirement (< 0) vertical
const T_SHAKE = 7; // tremblement (m)
const T_FLASH = 8; // flash blanc du changement de phase, 1 → 0
const T_DROP_Y = 9; // hauteur du maillage pendant la chute (m)
const T_TELE = 10; // avancement 0..1 du télégraphe lié au boss (frappe, visée, invocation)
const T_LAND = 11; // s écoulées depuis l'impact de l'atterrissage (délai de grâce)
const T_AX = 12; // point de chute, figé au début de l'alarme
const T_AZ = 13;
// Pose du maillage, rassemblée par sync avant d'écrire sa matrice. Elle passe par ce tableau et non par des
// variables locales : dans une variable alimentée par deux branches, V8 (Maglev) garde la valeur « étiquetée »
// dès qu'une des branches lui donne un nombre déjà emballé, et emballe alors tous les autres flottants
// (mesuré : 40 à 55 octets par image dans sync une fois qu'une arrivée avait eu lieu).
const T_PX = 14;
const T_PY = 15;
const T_PZ = 16;
const T_ROT = 17;
const T_TILT = 18; // penché vers l'avant écrit
const T_ROLL = 19;
const T_SQ = 20; // écrasement écrit
const T_SW_A0 = 21; // balayage laser (§ E1.D) : angle de départ du premier rayon (rad, même convention que E.rot)
const T_SW_DIR = 22; // sens du balayage (+1 / −1)
const T_ORBIT = 23; // phase de l'orbite des drones-boucliers (rad)
const T = new Float64Array(24);
const SEG = new Float64Array(9); // segment à dessiner dans laserMesh : ax, ay, az, bx, by, bz, largeur, gain, épaisseur (§ V : aucun flottant en argument)

// Compteurs depuis le chargement (comme camera.grantedTotal : jamais remis à zéro ; lus par les tests).
let nArrivals = 0;
let nLandings = 0;
let nSlams = 0;
let nCharges = 0;
let nMortars = 0;
let nSummons = 0;
let nStrikes = 0; // explosions déclenchées (frappes + obus)
let nSummoned = 0; // robots invoqués
let nChargeHits = 0; // ruées qui ont touché le joueur
let nPhaseChanges = 0;
let nDeaths = 0;
let nSweeps = 0; // balayages laser lancés (§ E1.D)
let nSweepHits = 0; // rayons qui ont touché le joueur
let nEnrages = 0; // passages en phase 3
let nShieldDrones = 0; // drones-boucliers créés

// =====================================================================================================================
// Initialisation
// =====================================================================================================================

export function init(context) {
  ctx = context;
  enemies = ctx.enemies;
  camera = ctx.camera;
  audio = ctx.audio;
  fx = ctx.fx;
  pickups = ctx.pickups;
  chests = ctx.chests || null; // § E2.C
  debug = ctx.debug;
  damage = ctx.damage;
  render = ctx.render;
  view = ctx.camera.view;

  applyRank(1);

  const type = ENEMIES.types[ENEMY.BOSS];

  // ----- Axe de visée et niveau des contours (les vecteurs de view sont justes dès camera.init, § C.1)
  let top = BOSS.zone.contourHeight;
  if (PLAYER.height + BOSS.zone.contourMargin > top) top = PLAYER.height + BOSS.zone.contourMargin;
  for (let t = 0; t < ENEMIES.types.length; t++) {
    if (t === ENEMY.BOSS) continue;
    const h = (ENEMIES.types[t].height || 0) + (ENEMIES.types[t].hover || 0) + BOSS.zone.contourMargin;
    if (h > top) top = h;
  }
  CONTOUR_Y = top;
  // § E3.L : axe de visée et décalage des contours refaits à chaque changement d'inclinaison (réglage de caméra)
  const axeVisee = () => {
    const gph = view.groundPerHeight;
    const inv = 1 / Math.sqrt(1 + gph * gph);
    uHoleDir.set(view.upX * gph * inv, -inv, view.upZ * gph * inv);
    CONTOUR_D[0] = -view.upX * CONTOUR_Y * gph;
    CONTOUR_D[1] = -view.upZ * CONTOUR_Y * gph;
  };
  axeVisee();
  if (ctx.camera.onPitch) ctx.camera.onPitch(axeVisee);

  // ----- Corps : modèle Blender du boss (assets/modeles/boss.glb sans ses nœuds de phase 2, § Z quinquies), posé par
  // setModele() à son arrivée (main.js) ; d'ici là une géométrie vide. Avant = +Z local, pieds à y = 0, hauteur BOSS.height.
  const bodyMaterial = render.createLitMaterial({ glowColor: type.glowColor, profil: 'boss' }); // profil peint (§ Z quater)
  revealReady = addReveal(bodyMaterial);
  uFx = bodyMaterial.userData.uniforms.uFx.value;
  uBoost = bodyMaterial.userData.uniforms.uEmissiveBoost;
  mesh = new THREE.Mesh(render.emptyModelGeometry(), bodyMaterial);
  mesh.name = 'boss';
  mesh.matrixAutoUpdate = false; // sa matrice est écrite en ligne dans sync (aucun appel à arguments flottants, § V)
  mesh.visible = false;
  render.makeShadowCaster(mesh);
  mesh.receiveShadow = true; // rendu peint (§ Z quater)
  ctx.scene.add(mesh);

  // ----- Pièces de la phase 2 (nœuds extras.phase = 2 du même fichier : flammes des cheminées, réacteur, fissures,
  // bandes, poings et tibias chauffés ; émissif chaud), même repère et même échelle que le corps
  const hotMaterial = render.createLitMaterial({ glowColor: type.glowColor, emissiveBoost: BOSS.phase2.emissiveBoost, profil: 'boss' });
  addReveal(hotMaterial);
  uFxOverlay = hotMaterial.userData.uniforms.uFx.value;
  uBoostOverlay = hotMaterial.userData.uniforms.uEmissiveBoost;
  overlay = new THREE.Mesh(render.emptyModelGeometry(), hotMaterial);
  overlay.name = 'boss-phase-2';
  overlay.matrixAutoUpdate = false; // même repère que le corps
  overlay.receiveShadow = true;
  overlay.visible = false;
  mesh.add(overlay);

  // ----- Zones : décalques transparents sans écriture de profondeur (§ G.3). Couleur de sommet = rouge du
  // télégraphe ; la couleur d'instance porte le gain. Les fonds (disques pleins) sont au sol ; les traits, plus
  // vifs (au-dessus du seuil du bloom), ont leur propre maillage pour passer par-dessus les robots.
  const Zc = BOSS.zone;
  const disc = new THREE.CircleGeometry(1, Zc.segments);
  disc.rotateX(-Math.PI / 2);
  discMesh = render.createInstanced(
    render.makePart(disc, BOSS.telegraphColor, 0),
    render.createUnlitMaterial({ transparent: true, opacity: BOSS.telegraphOpacity }),
    DISC_CAP,
    { instanceColor: true, name: 'boss-zones' },
  );
  discMesh.renderOrder = RENDER.decals.telegraph.order;

  const rim = new THREE.RingGeometry(1 - Zc.edge, 1, Zc.segments);
  rim.rotateX(-Math.PI / 2);
  const rimPart = render.makePart(rim, BOSS.telegraphColor, 0);
  boostColors(rimPart, Zc.edgeBoost);
  ringMesh = render.createInstanced(
    rimPart,
    render.createUnlitMaterial({ transparent: true, opacity: BOSS.telegraphOpacity }),
    DISC_CAP,
    { instanceColor: true, name: 'boss-zones-contours' },
  );
  ringMesh.renderOrder = RENDER.decals.telegraph.order + 0.5; // après les fonds, avant l'anneau de l'EMP

  const quad = new THREE.PlaneGeometry(1, 1);
  quad.rotateX(-Math.PI / 2);
  quad.translate(0, 0, 0.5); // x ∈ [−0,5 ; 0,5], z ∈ [0 ; 1] : le couloir part de son origine
  quadMesh = render.createInstanced(
    render.makePart(quad, BOSS.telegraphColor, 0),
    render.createUnlitMaterial({ transparent: true, opacity: BOSS.telegraphOpacity }),
    QUAD_CAP,
    { instanceColor: true, name: 'boss-couloir' },
  );
  quadMesh.renderOrder = RENDER.decals.telegraph.order;

  // ----- Rayons du balayage laser et liens des drones-boucliers (§ E1.D) : boîtes unitaires (x, y ∈ [−0,5 ; 0,5],
  // z ∈ [0 ; 1]) additives, étirées d'un point à l'autre ; la couleur d'instance porte le gain. Un seul appel de dessin.
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0, 0.5);
  laserMesh = render.createInstanced(
    render.makePart(box, BOSS.attacks.sweep.color, 0),
    render.createUnlitMaterial({ additive: true }),
    LASER_CAP,
    { instanceColor: true, name: 'boss-laser' },
  );
  laserMesh.renderOrder = RENDER.decals.telegraph.order + 1;
}

/**
 * Mutations du boss de la vague donnée (§ E1.D) : rang, table des attaques permises par phase, type et nombre
 * d'invocations, rayons, drones-boucliers. Une fois par boss (prise en charge) : hors du chemin chaud.
 */
function applyRank(wave) {
  bossWave = wave > 1 ? wave : 1;
  rank = bossRank(bossWave);
  bossMutations(rank, MUT);
  beams = MUT[BMUT.BEAMS] | 0;
  summonType = MUT[BMUT.SUMMON_TYPE] | 0;
  summonCount = MUT[BMUT.SUMMON_COUNT] | 0;
  droneCount = MUT[BMUT.DRONES] | 0;
  for (let a = 1; a < NATK; a++) {
    const phases = BOSS.attacks[ATTACK_KEYS[a]].phases;
    for (let p = 1; p <= 3; p++) allowed[a * 4 + p] = phases.indexOf(p) >= 0 ? 1 : 0;
  }
  if (beams === 0) for (let p = 1; p <= 3; p++) allowed[ATK_SWEEP * 4 + p] = 0;
  if (MUT[BMUT.MORTAR_P1] === 1) allowed[ATK_MORTAR * 4 + 1] = 1;
  bossAnim.setTypeInvocation(summonType); // le robot qui sort de la trappe est celui qu'il invoque
}

/** Multiplie les couleurs de sommet d'une pièce (trait plus vif que le fond). */
function boostColors(part, gain) {
  const c = part.attributes.color.array;
  for (let k = 0; k < c.length; k++) c[k] *= gain;
}

/**
 * Fenêtre sur le joueur : le matériau du boss ne dessine pas ce qui se trouve DEVANT le joueur, à moins de
 * uHole.w de son centre dans le plan de l'écran, et cercle le bord de la fenêtre de la couleur du joueur.
 * Le test se fait dans le repère du monde, le long de l'axe de visée (caméra orthographique : tous les rayons
 * sont parallèles) : il ne dépend ni de la taille du tampon, ni de la densité d'écran, ni de la secousse.
 * Les insertions s'ajoutent à celles de render.createLitMaterial (§ G.2) ; le programme a sa propre clé, il est
 * compilé au prewarm comme les autres. Renvoie false sans rien changer si un repère du shader manque.
 */
function addReveal(material) {
  const R = BOSS.reveal;
  if (!(R.radius > 0) || typeof material.onBeforeCompile !== 'function') return false;
  const baseCompile = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey;
  const uniforms = {
    uSrHole: { value: uHole },
    uSrHoleDir: { value: uHoleDir },
    uSrHoleEdge: { value: R.edge },
    uSrHoleColor: { value: new THREE.Color(R.color).multiplyScalar(R.boost) },
  };
  let ok = true;
  material.onBeforeCompile = (shader, renderer) => {
    baseCompile.call(material, shader, renderer);
    const vs = shader.vertexShader;
    const fs = shader.fragmentShader;
    if (!vs.includes(HOLE_MAIN) || !vs.includes(HOLE_VERT_AT) || !fs.includes(HOLE_MAIN) || !fs.includes(HOLE_FRAG_AT)) {
      ok = false; // shader inattendu : pas de fenêtre plutôt qu'une erreur de compilation
      return;
    }
    shader.uniforms.uSrHole = uniforms.uSrHole;
    shader.uniforms.uSrHoleDir = uniforms.uSrHoleDir;
    shader.uniforms.uSrHoleEdge = uniforms.uSrHoleEdge;
    shader.uniforms.uSrHoleColor = uniforms.uSrHoleColor;
    shader.vertexShader = vs.replace(HOLE_MAIN, HOLE_VERT_PARS + HOLE_MAIN).replace(HOLE_VERT_AT, HOLE_VERT_AT + HOLE_VERT_MAIN);
    shader.fragmentShader = fs.replace(HOLE_MAIN, HOLE_FRAG_PARS + HOLE_MAIN + HOLE_FRAG_TEST).replace(HOLE_FRAG_AT, HOLE_FRAG_EDGE + HOLE_FRAG_AT);
  };
  material.customProgramCacheKey = () => (typeof baseKey === 'function' ? baseKey.call(material) : '') + '|boss-fenetre';
  material.userData.reveal = { uniforms, isReady: () => ok };
  return true;
}

const HOLE_MAIN = 'void main() {';
const HOLE_VERT_AT = '#include <project_vertex>';
const HOLE_FRAG_AT = '#include <opaque_fragment>';
const HOLE_VERT_PARS = 'varying vec3 vSrHoleW;\n';
const HOLE_VERT_MAIN = '\n\tvSrHoleW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;';
const HOLE_FRAG_PARS = 'uniform vec4 uSrHole;\nuniform vec3 uSrHoleDir;\nuniform float uSrHoleEdge;\nuniform vec3 uSrHoleColor;\nvarying vec3 vSrHoleW;\n';
// Devant le joueur (srAlong > 0) et à moins du rayon de l'axe qui passe par lui : pas dessiné. Juste autour :
// liseré, adouci sur un pixel. Les dérivées sont prises hors de tout branchement.
const HOLE_FRAG_TEST = `
	float srHoleEdge = 0.0;
	vec3 srTo = uSrHole.xyz - vSrHoleW;
	float srAlong = dot( srTo, uSrHoleDir );
	float srR = length( srTo - uSrHoleDir * srAlong );
	float srAa = max( fwidth( srR ), 1e-4 );
	if ( uSrHole.w > 0.0 && srAlong > 0.0 ) {
		if ( srR < uSrHole.w ) discard;
		float srOut = uSrHole.w + uSrHoleEdge;
		srHoleEdge = 1.0 - smoothstep( srOut - srAa, srOut, srR );
	}
`;
const HOLE_FRAG_EDGE = 'outgoingLight = mix( outgoingLight, uSrHoleColor, srHoleEdge );\n\t';

/**
 * Modèle du boss arrivé (main.js, une fois) : corps = phase 1 du fichier, chaud = sa surcouche de phase 2 (données de
 * src/rendu/modeles.js, même échelle). Les deux maillages les prennent ; leurs géométries vides sont libérées.
 */
export function setModele(corps, chaud, complet) {
  // modèle allégé à texture cuite (17/11) : atlas sur le matériau du corps, que « boss-anime » partage ; la surcouche de
  // phase 2 (décalques émissifs, sans image) garde son matériau
  appliquerTexturesModele(mesh.material, (complet && complet.textures) || corps.textures);
  render.setModelGeometry(mesh, corps);
  render.setModelGeometry(overlay, chaud);
  modele = true;
  if (!complet) return;
  // Corps animé (§ Z sexies) : un SkinnedMesh « boss-anime » de TOUT le fichier (pièces de phase 2 comprises, montrées
  // par l'échelle de leur os), même matériau que « boss ». « boss » et « boss-phase-2 » passent sur le calque 7 : ils
  // restent l'ancre de pose (matrice, visibilité, uniformes, lumière émise) mais ne sont plus dessinés.
  bossCorps.init({ scene: ctx.scene, materiau: mesh.material, donnees: complet, T, chaud: estChaud, ancien: mesh });
  bossCorps.setActif(true);
  bossCorps.surPas.f = pasLourd;
  // obus depuis les cheminées, invocations depuis le ventre : après la pose du modèle du drone (main.poserModeles)
  bossAnim.init(ctx.scene, { kind: zKind, x: zX, z: zZ, t: zT, d: zD, count: nZones });
  bossAnim.setActif(true);
}
/** Phase 2 allumée (lu par boss-corps : pièces incandescentes, flammes). */
function estChaud() {
  return ignited;
}
function nZones() {
  return zCount;
}
/** Contact d'un pied du modèle animé avec le sol (boss-corps.surPas) : son d'un pas lourd, à sa position. */
function pasLourd(x, z) {
  audio.play(SFX.BOSS_STEP, x, z);
}

// =====================================================================================================================
// Cycle de vie
// =====================================================================================================================

/**
 * Peut être appelé à tout moment, y compris en pleine alarme ou en pleine chute : annule l'arrivée, efface les
 * zones, cache le maillage et la marque. Ne touche pas à E. Ne crée rien.
 */
export function reset() {
  arrival = A_NONE;
  zCount = 0;
  curAttack = ATK_NONE;
  mortarLeft = 0;
  summonLeft = 0;
  trackedUid = 0;
  phase = 1;
  flashDue = false;
  ignited = false;
  slamLeft = 0;
  sweepHit = 0;
  atkCd.fill(0);
  T.fill(0);
  enemies.SHIELDRING[4] = 0;
  E.bossShield = 0;
  PRIO[0] = 0;
  flickerStep = -1;
  mesh.visible = false;
  overlay.visible = false;
  uFx.x = 0;
  uFx.y = 0;
  uFxOverlay.x = 0;
  uFxOverlay.y = 0;
  uBoost.value = RENDER.emissiveBoost;
  uHole.w = 0;
  recX8 = 0; // § E5.X8
  XB[7] = 1;
  recupsX8 = vapeursX8 = recupsObusX8 = 0;
  render.commit(discMesh, 0);
  render.commit(ringMesh, 0);
  render.commit(quadMesh, 0);
  render.commit(laserMesh, 0);
  bossCorps.reset();
  bossAnim.reset();
}

/** Lancé par waves (et par __game.spawnBoss) : alarme, marque au sol, chute, puis apparition dans E. */
export function spawn(wave) {
  if (isActive()) return;
  const A = BOSS.arrival;
  // Point de chute : à spawnDist du joueur, en direction du centre de l'arène (vers le haut de l'écran si le
  // joueur est au centre), figé maintenant.
  let dx = -P.x;
  let dz = -P.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1) {
    dx = view.upX;
    dz = view.upZ;
  } else {
    dx /= d;
    dz /= d;
  }
  // Il n'atterrit pas dans un rocher : si le point touche un obstacle, la direction tourne par pas de
  // ±dropTurnDeg (dropTries essais au plus) ; sans point libre, celui de la direction d'origine est gardé.
  const step = (A.dropTurnDeg * Math.PI) / 180;
  const clear = BOSS.radius + A.dropClearance;
  let x0 = 0;
  let z0 = 0;
  let free = false;
  for (let k = 0; k <= A.dropTries && !free; k++) {
    const turn = ((k + 1) >> 1) * step * ((k & 1) === 1 ? 1 : -1); // 0, +1, −1, +2, −2… pas
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    setDropPoint(dx * c - dz * s, dx * s + dz * c);
    if (k === 0) {
      x0 = T[T_AX];
      z0 = T[T_AZ];
    }
    free = !ctx.world.overlaps(T[T_AX], T[T_AZ], clear);
  }
  if (!free) {
    T[T_AX] = x0;
    T[T_AZ] = z0;
  }
  arrWave = wave;
  arrival = A_ALARM;
  T[T_ARR] = 0;
  T[T_DROP_Y] = A.dropHeight;
  nArrivals++;
  audio.play(SFX.BOSS_ALARM);
}

/**
 * Point de chute dans la direction unitaire (dx, dz), écrit dans T[T_AX], T[T_AZ]. Il doit tomber DANS l'écran
 * (arrivée annoncée) et sous le HUD : la distance est réduite si la fenêtre est étroite ou si le sommet du boss
 * arriverait dans la bande du haut de l'écran, sans jamais passer sous minDist. Borné à l'arène. Les tailles de
 * view se lisent au moment de servir (§ N).
 */
const PJD = new Float64Array(6); // § E5.AB.12 : projection du point de chute (perspective)
function setDropPoint(dx, dz) {
  const A = BOSS.arrival;
  let dist = A.spawnDist;
  const a = dx * view.rightX + dz * view.rightZ; // part du trajet le long de la droite de l'écran
  const b = dx * view.upX + dz * view.upZ; // … et le long du haut de l'écran
  //#region e5:M-dangers-guide
  // § E5.M (B11) : bande du HUD en fraction de la hauteur d'écran (hudTopPx = 120 px fixes était périmé : le HUD descend à
  // 0,19 × la hauteur), en profondeur au sol : frac × hauteur d'écran en m (2 × halfH) × halfD / halfH
  const hud = A.hudTopFrac > 0 ? A.hudTopFrac * 2 * view.halfD : (A.hudTopPx / view.pxPerMeter) * (view.halfD / view.halfH);
  //#endregion
  const maxA = view.halfW - A.screenMargin;
  const maxUp = view.halfD - (hud > A.screenMargin ? hud : A.screenMargin) - BOSS.height * view.groundPerHeight; // sa tête dépasse vers le haut
  const maxDown = view.halfD - A.screenMargin;
  if ((a < 0 ? -a : a) * dist > maxA) dist = maxA / (a < 0 ? -a : a);
  if (b > 0 && b * dist > maxUp) dist = maxUp / b;
  if (b < 0 && -b * dist > maxDown) dist = maxDown / -b;
  if (dist < A.minDist) dist = A.minDist;
  //#region e5:AB-camera-3p
  // § E5.AB.12 : perspective — le rectangle de view englobe le trapèze vu (plus large et plus profond que l'écran vers
  // le bas) : le point est vérifié par la vraie projection (pieds, sommet), sous la bande du HUD, et rapproché sinon
  if (view.persp === 1) {
    const mp = A.screenMargin * view.visPxPerMeter;
    const haut = (A.hudTopFrac > 0 ? A.hudTopFrac : 0.2) * view.heightPx;
    for (let k = 0; k < 16 && dist > A.minDist; k++) {
      PJD[0] = P.x + dx * dist;
      PJD[1] = 0;
      PJD[2] = P.z + dz * dist;
      camera.ecranT(PJD);
      const ok0 = PJD[5] === 1 && PJD[3] > mp && PJD[3] < view.widthPx - mp && PJD[4] < view.heightPx - mp;
      PJD[1] = BOSS.height;
      camera.ecranT(PJD);
      if (ok0 && PJD[4] > haut) break;
      dist *= 0.88;
      if (dist < A.minDist) dist = A.minDist;
    }
  }
  //#endregion e5:AB-camera-3p
  const lim = WORLD.half - BOSS.radius;
  const x = P.x + dx * dist;
  const z = P.z + dz * dist;
  T[T_AX] = x > lim ? lim : x < -lim ? -lim : x;
  T[T_AZ] = z > lim ? lim : z < -lim ? -lim : z;
}

/** Arrivée en cours OU boss dans E. */
export function isActive() {
  return arrival !== A_NONE || E.bossIndex >= 0;
}

/**
 * 0 = pas de boss dans E ; 1, 2, ou 3 (enragé, § E1.D : rang 4 et suivants). Une phase est acquise dès que les PV
 * passent sous son seuil (BOSS.phase2At ; seuil d'enragement du rang).
 */
export function getPhase() {
  const i = E.bossIndex;
  if (i < 0) return 0;
  const tracked = E.uid[i] === trackedUid;
  if (tracked) {
    if (phase === 3) return 3;
    const en = MUT[BMUT.ENRAGE_AT];
    if (en > 0 && E.hp[i] <= en * E.maxHp[i]) return 3;
    if (phase === 2) return 2;
  }
  return E.hp[i] > BOSS.phase2At * E.maxHp[i] ? 1 : 2;
}

/** Rang du boss suivi (1 à la vague 5, 2 à la vague 10…) : lu par l'interface (libellé de la barre). */
export function getRank() {
  return rank;
}

/** Seuil d'enragement du boss suivi, en centièmes des PV (0 = il ne s'enrage pas) : lu par l'interface, à l'apparition de la barre. */
export function getEnragePercent() {
  return Math.round(MUT[BMUT.ENRAGE_AT] * 100);
}

/** Efface zones télégraphiées et attaques en cours (fin de vague, mort du boss, reset). Le boss reprend sa marche. */
export function clearHazards() {
  zCount = 0;
  mortarLeft = 0;
  summonLeft = 0;
  slamLeft = 0;
  if (curAttack === ATK_NONE) return;
  curAttack = ATK_NONE;
  const i = E.bossIndex;
  if (i < 0 || E.alive[i] === 0 || E.uid[i] !== trackedUid) return;
  const st = E.state[i];
  if (st === S_SLAM || st === S_AIM || st === S_RUSH || st === S_CAST || st === S_SUMMON || st === S_SWEEP) {
    E.state[i] = S_CHASE;
    const gap = BOSS.attackGap[phase - 1] * MUT[BMUT.CD_MUL];
    if (E.cd[i] < gap) E.cd[i] = gap;
  }
}

/**
 * Appelé par damage.killEnemy, avant la compaction (E.bossIndex vaut déjà −1). flags = ceux du coup fatal :
 * SILENT (ni explosion, ni secousse, ni son) et NO_LOOT sont respectés et transmis aux sbires.
 * N'appelle jamais damage.explode (§ H.3).
 */
export function onDeath(i, flags) {
  const x = E.x[i];
  const z = E.z[i];
  nDeaths++;
  // 1. explosion, secousse, punch, son
  if ((flags & DMG.SILENT) === 0) {
    fx.spawnExplosion(x, z, BOSS.death.explosionRadius, FXK.BOSS_DEATH);
    camera.addTrauma(BOSS.death.trauma, TRAUMA.BOSS);
    camera.punchZoom(BOSS.death.punch);
    audio.play(SFX.BOSS_DEATH, x, z);
    fx.hitstop(); // mort d'un gros robot (§ O) : killEnemy saute cette étape pour le boss
  }
  // 2. butin
  if ((flags & DMG.NO_LOOT) === 0) {
    const L = BOSS.loot;
    pickups.beginKeep(); // § E2.G bis G1 règle 2a : le butin du boss est toujours aspiré en fin de vague
    for (let k = 0; k < L.gems; k++) {
      const a = (k / L.gems) * TWO_PI;
      pickups.spawnGem(x + Math.cos(a) * L.gemRing, z + Math.sin(a) * L.gemRing, L.gemXp);
    }
    const total = bossFragments(run.wave);
    const each = Math.floor(total / L.fragmentPickups);
    let rest = total - each * L.fragmentPickups;
    for (let k = 0; k < L.fragmentPickups; k++) {
      const a = (k / L.fragmentPickups) * TWO_PI + 0.3;
      const v = each + (rest > 0 ? 1 : 0);
      if (rest > 0) rest--;
      if (v > 0) pickups.spawnFragment(x + Math.cos(a) * L.fragmentRing, z + Math.sin(a) * L.fragmentRing, v);
    }
    pickups.endKeep();
    if (ctx.disquette) ctx.disquette.onBossDeath(i); // § E4.Q : chance de lâcher une Sauvegarde (rang du boss tué)
    if (chests !== null && CHESTS.bossChest) chests.dropAt(x, z, CHESTS.bossMinRarity, CHEST_FLAG.KEEP | CHEST_FLAG_BOSS); // § E3.A : CHEST_FLAG_BOSS = coffre de 3 ou 5 lots selon le rang ; // § E2.C : coffre garanti, lots « Optimisé » au moins ; § E2.G bis : gardé
  }
  // 3. sbires (death.minionLoot = false : ils meurent sans butin)
  if (BOSS.death.killMinions) enemies.killAll((flags & (DMG.SILENT | DMG.NO_LOOT)) | (BOSS.death.minionLoot ? 0 : DMG.NO_LOOT));
  // 4. plus rien d'actif
  clearHazards();
  arrival = A_NONE;
  trackedUid = 0;
  phase = 1;
  flashDue = false;
  ignited = false;
  enemies.SHIELDRING[4] = 0;
  E.bossShield = 0;
  PRIO[0] = 0;
}

// =====================================================================================================================
// Simulation (S6)
// =====================================================================================================================

/** S6. Ne fait rien si les robots sont figés (debug). */
export function update(dt) {
  countShields(); // même robots figés : un drone-bouclier tué par le debug cesse aussitôt de protéger
  if (debug.areEnemiesFrozen()) {
    const f = E.bossIndex;
    if (f >= 0) {
      E.vx[f] = 0; // il ne bouge pas : sa vitesse effective est nulle
      E.vz[f] = 0;
    }
    return;
  }
  T[T_CLOCK] += dt;
  if (T[T_FLASH] > 0) {
    const fl = T[T_FLASH] - dt / BOSS.phase2.flashSeconds;
    T[T_FLASH] = fl > 0 ? fl : 0;
  }
  if (arrival !== A_NONE) updateArrival(dt);
  if (zCount > 0) updateZones(dt);
  const i = E.bossIndex;
  if (i >= 0 && E.alive[i] === 1) {
    if (E.uid[i] !== trackedUid) adopt(i, run.wave); // boss posé directement dans E : pris en charge, en phase 1
    updateBoss(i, dt);
    recupX8F(i, dt); // § E5.X8 (E9)
  } else enemies.SHIELDRING[4] = 0;
  // animation (§ Z sexies) : phase du pas sur la vitesse réelle, gestes, appuis ; temps des obus et invocations
  bossCorps.update(dt);
  bossAnim.update(dt);
}

/** Alarme, chute, impact, puis apparition dans E (nouvel essai à chaque image si E est plein). */
function updateArrival(dt) {
  const A = BOSS.arrival;
  if (arrival === A_ALARM) {
    T[T_ARR] += dt;
    if (T[T_ARR] < A.alarmSeconds) return;
    T[T_ARR] -= A.alarmSeconds; // le reste du pas entame la chute
    arrival = A_DROP;
  } else if (arrival === A_DROP) {
    T[T_ARR] += dt;
  }
  if (arrival === A_DROP) {
    if (T[T_ARR] < A.dropSeconds) {
      const u = T[T_ARR] / A.dropSeconds;
      T[T_DROP_Y] = A.dropHeight * (1 - u * u); // chute accélérée
      T[T_SQUASH] = -BOSS.anim.dropStretch; // étiré par la vitesse
      return;
    }
    // Impact : secoue, ne blesse pas.
    arrival = A_LAND;
    T[T_DROP_Y] = 0;
    T[T_LAND] = 0;
    T[T_SQUASH] = BOSS.anim.landSquash;
    nLandings++;
    camera.addTrauma(A.trauma, TRAUMA.BOSS);
    camera.punchZoom(A.punch);
    audio.play(SFX.BOSS_SLAM, T[T_AX], T[T_AZ]);
    fx.spawnExplosion(T[T_AX], T[T_AZ], A.blastRadius, FXK.BOSS_SLAM); // poussière et onde : effet seul, aucun dégât
    fx.hitstop();
  } else if (T[T_SQUASH] !== 0) {
    // au sol, pas encore dans E : l'écrasement de l'impact se détend quand même
    const sq = T[T_SQUASH] * Math.exp(-BOSS.anim.squashRate * dt);
    T[T_SQUASH] = sq > 1e-3 || sq < -1e-3 ? sq : 0;
  }
  // L'impact ne blesse pas : si le joueur est SOUS le boss, celui-ci n'entre dans E (où enemies le fait frapper
  // au contact) qu'après graceSeconds, ou dès que le joueur est sorti de son cercle.
  if (T[T_LAND] < A.graceSeconds && P.alive) {
    const gx = P.x - T[T_AX];
    const gz = P.z - T[T_AZ];
    const reach = BOSS.radius + P.radius;
    if (gx * gx + gz * gz < reach * reach) {
      T[T_LAND] += dt;
      return;
    }
  }
  // § E4.T.3 : le boss d'une vague de boss suit la prise en main des robots de sa vague (vague 5 : dégâts × 0,55) ;
  // § E5.A.2 : ses PV sont bossPvMul (vague 5 : 3 000 PV, décision de Femz du 17/11)
  const i = enemies.spawn(ENEMY.BOSS, T[T_AX], T[T_AZ], bossPvMul(arrWave), waveDmgMul(Math.max(1, arrWave)) * bossPriseEnMain(arrWave, 'dmg'));
  if (i < 0) return; // E plein (ou un autre boss posé entre-temps) : nouvel essai à l'image suivante
  arrival = A_NONE;
  adopt(i, arrWave);
  E.state[i] = S_RECOVER; // il se relève avant de marcher
  E.timer[i] = A.recoverSeconds;
}

/**
 * Drones-boucliers en vie (§ E1.D) : E.bossShield et la liste PRIO des cibles prioritaires (state.js), recomptés à
 * chaque pas. Sans boss dans E, ou pour un boss sans drones : zéro, sans parcourir E.
 */
function countShields() {
  let n = 0;
  if (droneCount > 0 && E.bossIndex >= 0) {
    const FL = E.flags;
    const AL = E.alive;
    const total = E.count;
    const cap = PRIO.length - 1;
    for (let j = 0; j < total; j++) {
      if (AL[j] === 1 && (FL[j] & F_SD) !== 0) {
        if (n < cap) PRIO[1 + n] = j;
        n++;
      }
    }
  }
  PRIO[0] = n < PRIO.length - 1 ? n : PRIO.length - 1;
  E.bossShield = n;
}

/**
 * Pose les drones-boucliers qui manquent autour du boss i (prise en charge, puis chaque changement de phase) : robots
 * de type drone, drapeaux SHIELD_DRONE | PRIORITY | NO_LOOT, PV = shieldDrones.hp × bossHpMul(vague), place sur
 * l'orbite dans E.rev0. Plafond de vivants et E plein respectés (un drone qui n'entre pas est abandonné).
 */
function spawnShieldDrones(i) {
  if (droneCount === 0) return;
  countShields();
  const S = BOSS.shieldDrones;
  const hp = S.hp * bossHpMul(bossWave) * bossPriseEnMain(bossWave, 'hp'); // § E4.T.3
  const ring = enemies.SHIELDRING;
  ring[0] = E.x[i];
  ring[1] = E.z[i];
  ring[2] = S.orbitRadius;
  ring[3] = T[T_ORBIT];
  ring[4] = 1;
  for (let k = E.bossShield; k < droneCount; k++) {
    if (E.aliveCount >= WAVES.maxAlive) break;
    const a = (k / droneCount) * TWO_PI;
    const x = E.x[i] + Math.sin(a + T[T_ORBIT]) * S.orbitRadius;
    const z = E.z[i] + Math.cos(a + T[T_ORBIT]) * S.orbitRadius;
    const j = enemies.spawn(ENEMY.DRONE, x, z, 1, E.mul[i]);
    if (j < 0) break;
    E.hp[j] = hp;
    E.maxHp[j] = hp;
    E.flags[j] = EFLAG.SHIELD_DRONE | EFLAG.PRIORITY | EFLAG.NO_LOOT;
    E.rev0[j] = a;
    fx.spawnRing(x, z, S.orbitRadius * 0.35, BOSS.telegraphColor);
    nShieldDrones++;
  }
  countShields();
}

/** Prend en charge le boss présent à l'indice i (vague `wave` : son rang) : phase 1, aucune attaque en cours, recharges à zéro. */
function adopt(i, wave) {
  trackedUid = E.uid[i];
  applyRank(wave);
  phase = 1;
  flashDue = false;
  ignited = false;
  recX8 = 0; // § E5.X8
  XB[7] = 1;
  curAttack = ATK_NONE;
  mortarLeft = 0;
  summonLeft = 0;
  slamLeft = 0;
  sweepHit = 0;
  zCount = 0;
  atkCd.fill(0);
  E.state[i] = S_CHASE;
  E.timer[i] = 0;
  E.cd[i] = BOSS.firstAttackDelay;
  E.glow[i] = 0;
  T[T_LEAN] = 0;
  T[T_LIFT] = 0;
  T[T_SHAKE] = 0;
  T[T_GAIT] = 0;
  T[T_FLASH] = 0;
  T[T_TELE] = 0;
  uBoost.value = RENDER.emissiveBoost;
  spawnShieldDrones(i);
}

/** Ajoute une zone au sol ; renvoie son indice, ou −1 si le pool est plein. Appelé par attaque, pas par image. */
function addZone(kind, x, z, r, seconds, value) {
  if (zCount >= ZCAP) return -1;
  const k = zCount++;
  zKind[k] = kind;
  zX[k] = x;
  zZ[k] = z;
  zR[k] = r;
  zT[k] = seconds;
  zD[k] = seconds;
  zV[k] = value;
  zRot[k] = 0;
  zLen[k] = 0;
  return k;
}

function findZone(kind) {
  for (let k = 0; k < zCount; k++) if (zKind[k] === kind) return k;
  return -1;
}

/** Retire la zone k par échange avec la dernière. */
function removeZone(k) {
  const last = --zCount;
  if (k === last) return;
  zKind[k] = zKind[last];
  zX[k] = zX[last];
  zZ[k] = zZ[last];
  zR[k] = zR[last];
  zT[k] = zT[last];
  zD[k] = zD[last];
  zV[k] = zV[last];
  zRot[k] = zRot[last];
  zLen[k] = zLen[last];
}

/** Fin d'une attaque liée au corps du boss : pause commune, puis récupération (ou marche tout de suite). */
function endAttack(i, recover) {
  curAttack = ATK_NONE;
  E.cd[i] = BOSS.attackGap[phase - 1] * MUT[BMUT.CD_MUL];
  if (recover > 0) {
    E.state[i] = S_RECOVER;
    E.timer[i] = recover;
  } else {
    E.state[i] = S_CHASE;
  }
}

// ----- Départ des attaques (un appel par attaque) ------------------------------------------------------------------------

function startSlam(i) {
  const S = BOSS.attacks.slam;
  if (addZone(Z_SLAM, E.x[i], E.z[i], S.radius, S.telegraph, S.dmg * E.mul[i]) < 0) return;
  curAttack = ATK_SLAM;
  atkCd[ATK_SLAM] = S.cooldown[phase - 1] * MUT[BMUT.CD_MUL];
  slamLeft = phase === 3 ? BOSS.enrage.slamRepeat : 1; // enragé : la frappe retombe plusieurs fois, chacune annoncée
  E.state[i] = S_SLAM;
  nSlams++;
  audio.play(SFX.BOSS_TELEGRAPH);
}

function startCharge(i) {
  const C = BOSS.attacks.charge;
  const k = addZone(Z_CHARGE, E.x[i], E.z[i], C.width * 0.5, C.telegraph, C.dmg * E.mul[i]);
  if (k < 0) return;
  zRot[k] = E.rot[i];
  zLen[k] = C.length + C.width * 0.5; // le corps dépasse le point d'arrivée d'une demi-largeur
  curAttack = ATK_CHARGE;
  atkCd[ATK_CHARGE] = C.cooldown[phase - 1] * MUT[BMUT.CD_MUL];
  E.state[i] = S_AIM;
  nCharges++;
  audio.play(SFX.BOSS_ANNONCE_RUEE); // § E5.Q (B13) : un son d'annonce par attaque
}

/** Le joueur peut-il se tenir en (x, z) ? Dans l'arène, hors de tout obstacle. */
function standable(x, z) {
  return ctx.world.isInsideArena(x, z, P.radius) && !ctx.world.overlaps(x, z, P.radius);
}

function startMortar(i) {
  const M = BOSS.attacks.mortar;
  const lim = WORLD.half - 1;
  const dmg = M.dmg * E.mul[i];
  const px = P.x;
  const pz = P.z;
  // Le premier obus tombe sur le joueur ; les autres autour de lui, mais jamais dans l'arc de sortie. La sortie
  // est un point où le joueur peut réellement aller : à exitDist de lui, dans l'arène, hors de tout obstacle,
  // trajet compris (aux deux tiers du chemin les échantillons sont assez serrés pour le plus petit rocher).
  // Sans direction libre après exitTries tirages : vers le centre de l'arène.
  const reach = M.radius + P.radius;
  const exitDist = reach + M.exitMargin;
  let safe = 0;
  let found = false;
  for (let t = 0; t < M.exitTries && !found; t++) {
    safe = rand() * TWO_PI;
    const cx = Math.cos(safe) * exitDist;
    const cz = Math.sin(safe) * exitDist;
    found = standable(px + cx, pz + cz) && standable(px + cx * 0.667, pz + cz * 0.667) && standable(px + cx * 0.333, pz + cz * 0.333);
  }
  if (!found) safe = px * px + pz * pz > 1e-6 ? Math.atan2(-pz, -px) : 0;
  const sx = px + Math.cos(safe) * exitDist;
  const sz = pz + Math.sin(safe) * exitDist;
  // Aucun autre obus à moins de reach + exitClear de la sortie, APRÈS bornage à l'arène (ramené sur un mur, un
  // obus pouvait fermer la sortie) : il est retiré jusqu'à shellTries fois, puis abandonné.
  const keep = reach + M.exitClear;
  const half = (M.safeArcDeg * Math.PI) / 360;
  const others = M.count - 1;
  let made = 0;
  for (let k = 0; k < M.count; k++) {
    let x = px;
    let z = pz;
    let ok = true;
    if (k > 0) {
      ok = false;
      for (let t = 0; t < M.shellTries && !ok; t++) {
        const a = safe + half + ((k - 1 + rand()) / others) * (TWO_PI - 2 * half);
        const dist = M.minDist + rand() * (M.spread - M.minDist);
        x = px + Math.cos(a) * dist;
        z = pz + Math.sin(a) * dist;
        x = x > lim ? lim : x < -lim ? -lim : x;
        z = z > lim ? lim : z < -lim ? -lim : z;
        const ex = x - sx;
        const ez = z - sz;
        ok = ex * ex + ez * ez >= keep * keep;
      }
    }
    if (ok && addZone(Z_MORTAR, x, z, M.radius, M.telegraph + k * M.stagger, dmg) >= 0) made++;
  }
  if (made === 0) return;
  mortarLeft = made;
  curAttack = ATK_MORTAR;
  atkCd[ATK_MORTAR] = M.cooldown[phase - 1] * MUT[BMUT.CD_MUL];
  E.state[i] = S_CAST;
  E.timer[i] = M.castSeconds;
  nMortars++;
  audio.play(SFX.BOSS_ANNONCE_OBUS); // § E5.Q (B13)
}

function startSummon(i) {
  const S = BOSS.attacks.summon;
  const lim = WORLD.half - ENEMIES.types[summonType].radius;
  const a0 = rand() * TWO_PI;
  let made = 0;
  for (let k = 0; k < summonCount; k++) {
    const a = a0 + (k / summonCount) * TWO_PI;
    let x = E.x[i] + Math.cos(a) * S.spawnRadius;
    let z = E.z[i] + Math.sin(a) * S.spawnRadius;
    x = x > lim ? lim : x < -lim ? -lim : x;
    z = z > lim ? lim : z < -lim ? -lim : z;
    if (addZone(Z_SUMMON, x, z, S.markRadius, S.telegraph, 0) >= 0) made++;
  }
  if (made === 0) return;
  summonLeft = made;
  curAttack = ATK_SUMMON;
  atkCd[ATK_SUMMON] = S.cooldown[phase - 1] * MUT[BMUT.CD_MUL];
  E.state[i] = S_SUMMON;
  nSummons++;
  audio.play(SFX.BOSS_ANNONCE_INVOCATION); // § E5.Q (B13)
}

/**
 * Balayage laser (§ E1.D) : l'arc est centré sur la direction du joueur à cet instant, le sens est tiré au sort. La
 * zone Z_SWEEP porte l'annonce ; à son échéance elle devient Z_BEAM (le rayon tourne) : voir updateZones.
 */
function startSweep(i) {
  const W = BOSS.attacks.sweep;
  const k = addZone(Z_SWEEP, E.x[i], E.z[i], W.width * 0.5, W.telegraph, W.dmg * E.mul[i]);
  if (k < 0) return;
  const dir = rand() < 0.5 ? 1 : -1;
  T[T_SW_DIR] = dir;
  T[T_SW_A0] = Math.atan2(P.x - E.x[i], P.z - E.z[i]) - dir * W.arcDeg * RAD * 0.5;
  zRot[k] = T[T_SW_A0];
  zLen[k] = W.length;
  sweepHit = 0;
  curAttack = ATK_SWEEP;
  atkCd[ATK_SWEEP] = W.cooldown[phase - 1] * MUT[BMUT.CD_MUL];
  E.state[i] = S_SWEEP;
  nSweeps++;
  audio.play(SFX.BOSS_ANNONCE_BALAYAGE); // § E5.Q (B13)
}

/**
 * Un pas du rayon (zone k, Z_BEAM). Le joueur est touché si le rayon passe sur lui PENDANT ce pas : son angle vu du
 * boss est dans l'intervalle balayé, élargi de la demi-largeur du rayon et de son rayon — le test ne dépend donc pas
 * de la cadence. Une fois par rayon ; un joueur invulnérable (dash) laisse passer le rayon. À la fin : récupération.
 */
function sweepStep(k, dt) {
  const W = BOSS.attacks.sweep;
  const i = E.bossIndex;
  const before = zT[k];
  let left = before - dt;
  if (left < 0) left = 0;
  zT[k] = left;
  if (i >= 0 && P.alive) {
    const dx = P.x - zX[k];
    const dz = P.z - zZ[k];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= zLen[k] + P.rayonDegats) { // § E5.N (B5) : rayon de dégâts (était P.radius)
      const arc = W.arcDeg * RAD;
      const o0 = (1 - before / zD[k]) * arc;
      const o1 = (1 - left / zD[k]) * arc;
      const reach = W.width * 0.5 + P.rayonDegats; // § E5.N (B5)
      const margin = d > reach ? Math.asin(reach / d) : Math.PI;
      const theta = Math.atan2(dx, dz);
      for (let b = 0; b < beams; b++) {
        if ((sweepHit & (1 << b)) !== 0) continue;
        // angle du joueur compté depuis le départ du rayon b, dans le sens du balayage, ramené autour du milieu de l'arc
        let rel = (theta - T[T_SW_A0] - (b * TWO_PI) / beams) * T[T_SW_DIR];
        rel -= Math.round((rel - arc * 0.5) / TWO_PI) * TWO_PI;
        if (rel >= o0 - margin && rel <= o1 + margin && damage.hitPlayer(zV[k], HURT.BOSS, zX[k], zZ[k], CAUSE.BOSS_BALAYAGE) > 0) {
          sweepHit |= 1 << b;
          nSweepHits++;
        }
      }
    }
  }
  if (left <= 0) {
    removeZone(k);
    if (i >= 0) endAttack(i, W.recover);
    else curAttack = ATK_NONE;
  }
}

/**
 * Changement de phase (2, ou 3 = enragé, § E1.D) : l'attaque en cours est abandonnée, arrêt, secousse, son ; recharges
 * de la nouvelle phase ; les drones-boucliers reviennent.
 */
function enterPhase(i, to) {
  const A = BOSS.attacks;
  const C = BOSS.phaseChange;
  const m = MUT[BMUT.CD_MUL];
  const p = to - 1;
  phase = to;
  flashDue = true;
  nPhaseChanges++;
  if (to === 3) nEnrages++;
  zCount = 0;
  mortarLeft = 0;
  summonLeft = 0;
  slamLeft = 0;
  curAttack = ATK_NONE;
  E.state[i] = S_STUN;
  E.timer[i] = C.stunSeconds;
  E.cd[i] = 0;
  // les attaques nouvelles se montrent vite
  atkCd[ATK_MORTAR] = to === 3 ? BOSS.enrage.mortarDelay : C.mortarDelay;
  atkCd[ATK_SUMMON] = to === 3 ? BOSS.enrage.summonDelay : C.summonDelay;
  if (to === 3) atkCd[ATK_SWEEP] = BOSS.enrage.sweepDelay;
  else if (atkCd[ATK_SWEEP] > A.sweep.cooldown[p] * m) atkCd[ATK_SWEEP] = A.sweep.cooldown[p] * m;
  if (atkCd[ATK_SLAM] > A.slam.cooldown[p] * m) atkCd[ATK_SLAM] = A.slam.cooldown[p] * m;
  if (atkCd[ATK_CHARGE] > A.charge.cooldown[p] * m) atkCd[ATK_CHARGE] = A.charge.cooldown[p] * m;
  camera.addTrauma(C.trauma, TRAUMA.BOSS);
  audio.play(SFX.BOSS_PHASE);
  fx.spawnRing(E.x[i], E.z[i], C.ringRadius, BOSS.telegraphColor);
  spawnShieldDrones(i);
}

/** Minuteries des zones ; à l'échéance : frappe, départ de la ruée, obus, invocation. */
function updateZones(dt) {
  const A = BOSS.attacks;
  for (let k = zCount - 1; k >= 0; k--) {
    const kind = zKind[k];
    if (kind === Z_LANE) continue; // suit la ruée : retirée quand elle s'arrête
    if (kind === Z_BEAM) {
      sweepStep(k, dt); // le rayon tourne : dégâts au passage, fin du balayage
      continue;
    }
    const t = zT[k] - dt;
    if (t > 0) {
      zT[k] = t;
      continue;
    }
    zT[k] = 0;
    const i = E.bossIndex;
    if (kind === Z_SWEEP) {
      // Fin de l'annonce : le rayon part de la visière et tourne pendant sweep.seconds.
      zKind[k] = Z_BEAM;
      zT[k] = A.sweep.seconds;
      zD[k] = A.sweep.seconds;
      audio.play(SFX.BOSS_LASER, zX[k], zZ[k]);
      continue;
    }
    if (kind === Z_CHARGE) {
      // Fin du télégraphe : la direction est figée, la ruée part ; le couloir reste affiché jusqu'au bout.
      zKind[k] = Z_LANE;
      if (i >= 0) {
        const rot = zRot[k]; // = E.rot du boss : le couloir suit son cap pendant la visée
        E.state[i] = S_RUSH;
        E.ai0[i] = Math.sin(rot);
        E.ai1[i] = Math.cos(rot);
        E.ai2[i] = A.charge.length;
        E.ai3[i] = 0;
      }
      continue;
    }
    const x = zX[k];
    const z = zZ[k];
    const r = zR[k];
    const v = zV[k];
    removeZone(k); // la zone venue de la fin du pool a déjà été traitée (parcours descendant)
    if (kind === Z_SLAM) {
      nStrikes++;
      damage.explode(x, z, r, 0, v, DMG_SRC.BOSS, DMG.NONE, FXK.BOSS_SLAM, A.slam.trauma, A.slam.punch, 0, -1, CAUSE.BOSS_FRAPPE);
      audio.play(SFX.BOSS_SLAM, x, z);
      fx.hitstop();
      T[T_SQUASH] = BOSS.anim.slamSquash;
      if (i >= 0 && --slamLeft > 0 && addZone(Z_SLAM, E.x[i], E.z[i], r, A.slam.telegraph, v) >= 0) {
        audio.play(SFX.BOSS_TELEGRAPH); // enragé : la frappe suivante de la série est annoncée à son tour (il reste en S_SLAM)
      } else if (i >= 0) endAttack(i, A.slam.recover);
      else curAttack = ATK_NONE;
    } else if (kind === Z_MORTAR) {
      nStrikes++;
      damage.explode(x, z, r, 0, v, DMG_SRC.BOSS, DMG.NONE, FXK.BOSS_SLAM, A.mortar.trauma, A.mortar.punch, 0, -1, CAUSE.BOSS_OBUS);
      if (--mortarLeft <= 0) {
        // dernier obus : l'attaque est finie (le boss marche déjà)
        curAttack = ATK_NONE;
        if (i >= 0) E.cd[i] = BOSS.attackGap[phase - 1] * MUT[BMUT.CD_MUL];
      }
    } else if (kind === Z_SUMMON) {
      // Un −1 est abandonné. Le plafond de vivants du cahier (400) vaut aussi pour les invocations.
      if (E.aliveCount < WAVES.maxAlive) {
        const w = run.wave > 1 ? run.wave : 1;
        if (enemies.spawn(summonType, x, z, waveHpMul(w) * bossPriseEnMain(w, 'hp'), waveDmgMul(w) * bossPriseEnMain(w, 'dmg')) >= 0) { // § E4.T.3
          nSummoned++;
          fx.spawnRing(x, z, r * A.summon.ringScale, BOSS.telegraphColor);
        }
      }
      if (--summonLeft <= 0) {
        if (i >= 0) endAttack(i, A.summon.recover);
        else curAttack = ATK_NONE;
      }
    }
  }
}

/** IA, déplacement et pose du boss. Seul endroit où E.x, E.z, E.vx, E.vz et E.rot du boss sont écrits. */
function updateBoss(i, dt) {
  const A = BOSS.attacks;
  const M = BOSS.anim;

  // Recharges propres à chaque attaque (privées ; E.cd et E.timer sont décomptés par enemies.update).
  for (let k = 1; k < NATK; k++) {
    if (atkCd[k] > 0) {
      const c = atkCd[k] - dt;
      atkCd[k] = c > 0 ? c : 0;
    }
  }

  // Phase 2 sous BOSS.phase2At, phase 3 (enragé, § E1.D) sous le seuil du rang : une fois pour toutes.
  const en = MUT[BMUT.ENRAGE_AT];
  if (phase < 3 && en > 0 && E.hp[i] <= en * E.maxHp[i]) enterPhase(i, 3);
  else if (phase === 1 && E.hp[i] <= BOSS.phase2At * E.maxHp[i]) enterPhase(i, 2);
  const p = phase - 1;

  // Orbite des drones-boucliers (§ E1.D) : elle suit le boss et tourne ; lue par enemies.update à l'image suivante.
  if (droneCount > 0) {
    const ring = enemies.SHIELDRING;
    T[T_ORBIT] += BOSS.shieldDrones.orbitSpeed * dt;
    ring[0] = E.x[i];
    ring[1] = E.z[i];
    ring[2] = BOSS.shieldDrones.orbitRadius;
    ring[3] = T[T_ORBIT];
    ring[4] = 1;
  }

  const x = E.x[i];
  const z = E.z[i];
  const dx = P.x - x;
  const dz = P.z - z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const lim = WORLD.half - BOSS.radius;

  // Choix d'une attaque : une seule à la fois, après la pause commune. Ordre fixe, conditions de distance.
  // L'invocation ne part que s'il reste de la place sous le plafond de vivants : sinon ses marques resteraient
  // vides, et le boss immobile pour rien — il passe à l'attaque suivante.
  if (E.state[i] === S_CHASE && curAttack === ATK_NONE && E.cd[i] <= 0 && P.alive) {
    if (allowed[ATK_SUMMON * 4 + phase] === 1 && atkCd[ATK_SUMMON] <= 0 && E.aliveByType[summonType] < A.summon.maxAlive && E.aliveCount < WAVES.maxAlive) startSummon(i);
    else if (allowed[ATK_SLAM * 4 + phase] === 1 && atkCd[ATK_SLAM] <= 0 && d <= A.slam.triggerDist) startSlam(i);
    else if (allowed[ATK_SWEEP * 4 + phase] === 1 && atkCd[ATK_SWEEP] <= 0 && d <= A.sweep.maxDist) startSweep(i);
    else if (allowed[ATK_MORTAR * 4 + phase] === 1 && atkCd[ATK_MORTAR] <= 0) startMortar(i);
    else if (allowed[ATK_CHARGE * 4 + phase] === 1 && atkCd[ATK_CHARGE] <= 0 && d >= A.charge.minDist) startCharge(i);
  }

  let nx = x;
  let nz = z;
  let rot = E.rot[i];
  let wantRot = rot;
  let turn = 0; // rad/s ; 0 = il ne tourne pas
  let walk = 0; // m/s de marche (cadence du pas)
  let tLean = 0;
  let tLift = 0;
  let tShake = 0;
  let tGlow = ignited ? (phase === 3 ? BOSS.enrage.glow : BOSS.phase2.glow) + BOSS.phase2.glowPulse * Math.sin(T[T_CLOCK] * TWO_PI * BOSS.phase2.pulseHz) : 0;
  let laneK = -1; // couloir à réorienter après la rotation
  let rushHit = false;
  let rushEnd = false;

  switch (E.state[i]) {
    case S_CHASE: {
      // Il s'arrête à stopDist, hors de portée de contact : le dernier pas n'avance que de ce qui reste.
      const speed = (phase === 3 ? BOSS.enrage.speed : phase === 2 ? BOSS.phase2Speed : BOSS.speed) * E.slow[i];
      if (d > BOSS.stopDist + STOP_EPS) {
        let step = speed * dt;
        if (step > d - BOSS.stopDist) step = d - BOSS.stopDist;
        nx = x + (dx / d) * step;
        nz = z + (dz / d) * step;
        walk = speed;
      }
      if (d > 0.05) wantRot = Math.atan2(dx, dz);
      turn = BOSS.turnRate[p];
      tLean = M.walkLean[p];
      break;
    }
    case S_SLAM: {
      // Il se cabre pendant le télégraphe, puis s'abat (écrasement posé par la frappe).
      const k = findZone(Z_SLAM);
      const u = k >= 0 ? 1 - zT[k] / zD[k] : 1;
      T[T_TELE] = u;
      tLean = -M.rearLean * u;
      tLift = M.rearLift * u;
      if (M.telegraphGlow * u > tGlow) tGlow = M.telegraphGlow * u;
      break;
    }
    case S_AIM: {
      // Il vise le joueur, puis verrouille sa direction lockSeconds avant de partir : le couloir ne bouge plus.
      const k = findZone(Z_CHARGE);
      const u = k >= 0 ? 1 - zT[k] / zD[k] : 1;
      T[T_TELE] = u;
      if (k >= 0 && zT[k] > A.charge.lockSeconds) {
        if (d > 0.05) wantRot = Math.atan2(dx, dz);
        turn = A.charge.aimTurnRate;
        laneK = k;
      }
      tLean = -M.aimLean * u;
      tShake = M.aimShake * u;
      if (M.telegraphGlow * u > tGlow) tGlow = M.telegraphGlow * u;
      break;
    }
    case S_RUSH: {
      // Ligne droite à charge.speed sur charge.length m ; la dernière image n'avance que de ce qui reste.
      const C = A.charge;
      let left = E.ai2[i];
      let step = C.speed * dt;
      if (step > left) step = left;
      nx = x + E.ai0[i] * step;
      nz = z + E.ai1[i] * step;
      if (nx > lim || nx < -lim || nz > lim || nz < -lim) rushEnd = true; // le mur arrête la ruée
      left -= step;
      E.ai2[i] = left;
      if (left <= 1e-4) rushEnd = true;
      // Joueur traversé : à moins de width / 2 + P.radius du trajet de l'image. Une fois par ruée au plus.
      if (E.ai3[i] === 0 && P.alive) {
        const sx = nx - x;
        const sz = nz - z;
        const l2 = sx * sx + sz * sz;
        let t = l2 > 1e-12 ? (dx * sx + dz * sz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = dx - sx * t;
        const ez = dz - sz * t;
        const reach = C.width * 0.5 + P.rayonDegats; // § E5.N (B5) : rayon de dégâts (était P.radius)
        rushHit = ex * ex + ez * ez < reach * reach;
      }
      tLean = M.rushLean;
      tGlow = M.telegraphGlow;
      break;
    }
    case S_CAST: {
      tLean = -M.castLean;
      if (M.telegraphGlow > tGlow) tGlow = M.telegraphGlow;
      if (E.timer[i] <= 0) {
        // § E5.X8 (E9) : une récupération après le tir (les obus tombent pendant ce temps), puis il reprend sa marche
        if (LOT8.bossRecup.obus > 0) {
          E.state[i] = S_RECOVER;
          E.timer[i] = LOT8.bossRecup.obus;
          recupsObusX8++;
        } else E.state[i] = S_CHASE;
      }
      break;
    }
    case S_SUMMON: {
      const k = findZone(Z_SUMMON);
      const u = k >= 0 ? 1 - zT[k] / zD[k] : 1;
      T[T_TELE] = u;
      tLift = M.summonLift * u;
      tLean = -M.castLean * u;
      if (M.telegraphGlow * u > tGlow) tGlow = M.telegraphGlow * u;
      break;
    }
    case S_STUN: {
      // Changement de phase : il s'arrête, tremble, chauffe ; les pièces incandescentes s'allument à mi-course.
      const stun = BOSS.phaseChange.stunSeconds;
      const u = stun > 0 ? 1 - E.timer[i] / stun : 1;
      tLean = M.stunLean;
      tShake = M.stunShake;
      tGlow = M.stunGlow * u;
      if (flashDue && u >= BOSS.phaseChange.igniteAt) ignite();
      if (E.timer[i] <= 0) {
        if (flashDue) ignite();
        E.state[i] = S_CHASE;
        E.cd[i] = BOSS.phaseChange.resumeDelay;
      }
      break;
    }
    case S_SWEEP: {
      // Balayage laser (§ E1.D) : pendant l'annonce il se tourne vers le départ de l'arc ; ensuite son corps tourne
      // avec le rayon (le rayon part de sa visière).
      const W = A.sweep;
      let k = findZone(Z_BEAM);
      if (k >= 0) {
        rot = T[T_SW_A0] + T[T_SW_DIR] * (1 - zT[k] / zD[k]) * W.arcDeg * RAD;
        tLean = M.castLean;
        tShake = M.aimShake;
        tGlow = M.telegraphGlow;
      } else {
        k = findZone(Z_SWEEP);
        const u = k >= 0 ? 1 - zT[k] / zD[k] : 1;
        T[T_TELE] = u;
        wantRot = T[T_SW_A0];
        turn = W.aimTurnRate;
        tLean = -M.aimLean * u;
        if (M.telegraphGlow * u > tGlow) tGlow = M.telegraphGlow * u;
      }
      break;
    }
    default: {
      // S_RECOVER : accroupi après l'impact, il se relève
      tLean = M.recoverLean;
      if (E.timer[i] <= 0) E.state[i] = S_CHASE;
      break;
    }
  }

  // Cap : rejoint la direction voulue à vitesse angulaire bornée.
  if (turn > 0) {
    let diff = wantRot - rot;
    diff -= Math.round(diff / TWO_PI) * TWO_PI;
    const maxStep = turn * dt;
    rot += diff > maxStep ? maxStep : diff < -maxStep ? -maxStep : diff;
    if (laneK >= 0) zRot[laneK] = rot;
  }

  // Position bornée à l'arène ; rochers ignorés. Vitesse = déplacement effectif de l'image.
  nx = nx > lim ? lim : nx < -lim ? -lim : nx;
  nz = nz > lim ? lim : nz < -lim ? -lim : nz;
  E.x[i] = nx;
  E.z[i] = nz;
  E.vx[i] = (nx - x) / dt;
  E.vz[i] = (nz - z) / dt;
  E.rot[i] = rot;

  if (rushHit && damage.hitPlayer(A.charge.dmg * E.mul[i], HURT.BOSS, nx, nz, CAUSE.BOSS_RUEE) > 0) {
    E.ai3[i] = 1;
    nChargeHits++;
  }
  if (rushEnd) {
    const k = findZone(Z_LANE);
    if (k >= 0) removeZone(k);
    endAttack(i, A.charge.recover);
  }

  // Pose : lissages exponentiels (aucune dépendance à la cadence), écrasement qui se détend.
  const kp = 1 - Math.exp(-M.poseRate * dt);
  T[T_LEAN] += (tLean - T[T_LEAN]) * kp;
  T[T_LIFT] += (tLift - T[T_LIFT]) * kp;
  T[T_SHAKE] += (tShake - T[T_SHAKE]) * kp;
  T[T_GAIT] += ((walk > 0 ? 1 : 0) - T[T_GAIT]) * kp;
  if (T[T_SQUASH] !== 0) {
    const sq = T[T_SQUASH] * Math.exp(-M.squashRate * dt);
    T[T_SQUASH] = sq > 1e-3 || sq < -1e-3 ? sq : 0;
  }
  T[T_WALK] += walk * M.stride * dt;
  // Son d'un pas lourd : au contact d'un pied du modèle animé (src/anim/boss-corps.js, surPas → pasLourd).
  E.glow[i] += (tGlow - E.glow[i]) * (1 - Math.exp(-M.glowRate * dt));
}

/** La nouvelle phase devient visible : flash blanc, pièces incandescentes, émissifs poussés (plus fort une fois enragé). */
function ignite() {
  ignited = true;
  flashDue = false;
  T[T_FLASH] = 1;
  uBoost.value = phase === 3 ? BOSS.enrage.emissiveBoost : BOSS.phase2.emissiveBoost;
}

//#region e5:X8-lot8
/**
 * § E5.X8 (E9) : récupération lisible — à l'entrée de S_RECOVER, émissifs × XB[0] (uniformes écrits à l'entrée et à la
 * sortie seulement : un flottant écrit dans { value } alloue, § V) et son de refroidissement ; pendant, une bouffée de
 * vapeur toutes les XB[1] s au-dessus du corps.
 */
function recupX8F(i, dt) {
  const rec = E.state[i] === S_RECOVER ? 1 : 0;
  if (rec !== recX8) {
    recX8 = rec;
    XB[7] = rec === 1 ? XB[0] : 1;
    uBoost.value = (ignited ? (phase === 3 ? BOSS.enrage.emissiveBoost : BOSS.phase2.emissiveBoost) : RENDER.emissiveBoost) * XB[7];
    flickerStep = -1; // pièces de phase 2 : réécrites par sync (× XB[7])
    if (rec === 1) {
      recupsX8++;
      XB[2] = 0;
      ARGF[F_X] = E.x[i];
      ARGF[F_Z] = E.z[i];
      ARGF[F_V] = XB[5];
      ARGF[F_T] = XB[6];
      audio.playGainRateF(XB_SON);
    }
  }
  if (rec === 0) return;
  XB[2] -= dt;
  if (XB[2] > 0) return;
  XB[2] = XB[1];
  vapeursX8++;
  for (let q = 0; q < 3; q++) {
    // trois bouffées autour du haut du corps (fx tire déjà dans rand : même flux que les autres effets)
    const a = rand() * TWO_PI;
    const r = XB[4] * (0.4 + 0.6 * rand());
    ARGF[F_X] = E.x[i] + Math.sin(a) * r;
    ARGF[F_V] = XB[3] + 0.6 * rand();
    ARGF[F_Z] = E.z[i] + Math.cos(a) * r;
    fx.spawnVapeurF(XB_VAPEUR);
  }
}
/** § E5.X8 (tests) : récupérations du boss, bouffées de vapeur, récupérations après les obus, × émissifs en cours. */
export function inspectX8(out) {
  out.recups = recupsX8;
  out.vapeurs = vapeursX8;
  out.recupsObus = recupsObusX8;
  out.emissifs = XB[7];
  out.boost = uBoost !== null ? uBoost.value : 0;
  return out;
}
//#endregion e5:X8-lot8

// =====================================================================================================================
// Écriture du rendu (F11)
// =====================================================================================================================

export function sync() {
  const M = BOSS.anim;
  const i = E.bossIndex;
  // Pose du maillage : position, cap, penché vers l'avant, roulis, écrasement — rassemblés dans T (voir T_PX),
  // puis écrits en une fois dans la matrice du maillage.
  let shown = false;
  if (i >= 0 && E.alive[i] === 1) {
    // ----- Boss dans E : position et cap de la simulation, pose procédurale par-dessus
    shown = true;
    const sw = Math.sin(T[T_WALK]);
    const gait = T[T_GAIT];
    const sh = T[T_SHAKE];
    const c = T[T_CLOCK];
    T[T_PX] = E.x[i] + Math.sin(c * 61) * sh;
    T[T_PY] = T[T_LIFT] + (sw < 0 ? -sw : sw) * M.bobAmp * gait;
    T[T_PZ] = E.z[i] + Math.cos(c * 53) * sh;
    T[T_ROT] = E.rot[i];
    T[T_TILT] = T[T_LEAN];
    T[T_ROLL] = sw * M.sway * gait;
    T[T_SQ] = T[T_SQUASH];
    const flash = (E.flash[i] > T[T_FLASH] ? E.flash[i] : T[T_FLASH]) * (CF.reduits ? CF.flashBlanc : 1); // § E5.X5 : flash blanc atténué
    uFx.x = flash;
    uFx.y = E.glow[i];
    const hot = ignited && E.uid[i] === trackedUid;
    overlay.visible = hot;
    if (hot) {
      uFxOverlay.x = flash;
      // Vacillement par paliers (flickerHz par seconde), écrit seulement quand il change : un uniforme { value }
      // de three range son nombre dans un champ étiqueté, chaque écriture d'un flottant y alloue 12 octets
      // (mesuré : 11 octets par image avec une écriture par image).
      const step = Math.floor(c * BOSS.phase2.flickerHz);
      if (step !== flickerStep) {
        flickerStep = step;
        uBoostOverlay.value = (phase === 3 ? BOSS.enrage.emissiveBoost : BOSS.phase2.emissiveBoost) * (1 + (CF.reduits ? 0 : BOSS.phase2.flicker) * Math.sin(step * 2.4)) * XB[7]; // § E5.X5 : Réduits = pas de vacillement ; § E5.X8 : × émissifs en récupération
      }
    }
  } else if (arrival === A_DROP || arrival === A_LAND) {
    // ----- Chute : le maillage tombe sur la marque, tourné vers le joueur
    shown = true;
    T[T_PX] = T[T_AX];
    T[T_PY] = T[T_DROP_Y];
    T[T_PZ] = T[T_AZ];
    T[T_ROT] = Math.atan2(P.x - T[T_AX], P.z - T[T_AZ]);
    T[T_TILT] = 0;
    T[T_ROLL] = 0;
    T[T_SQ] = T[T_SQUASH];
    uFx.x = 0;
    uFx.y = 0;
    overlay.visible = false;
  }
  mesh.visible = shown;
  if (shown) {
    // Matrice = T · Ry(cap) · Rx(penché) · Rz(roulis) · S ; l'écrasement élargit, l'étirement affine.
    const e = mesh.matrix.elements;
    const c = Math.cos(T[T_ROT]);
    const s = Math.sin(T[T_ROT]);
    const ca = Math.cos(T[T_TILT]);
    const sa = Math.sin(T[T_TILT]);
    const cb = Math.cos(T[T_ROLL]);
    const sb = Math.sin(T[T_ROLL]);
    const sx = 1 + T[T_SQ] * 0.5;
    const sy = 1 - T[T_SQ];
    e[0] = (c * cb + s * sa * sb) * sx;
    e[1] = ca * sb * sx;
    e[2] = (c * sa * sb - s * cb) * sx;
    e[3] = 0;
    e[4] = (s * sa * cb - c * sb) * sy;
    e[5] = ca * cb * sy;
    e[6] = (s * sb + c * sa * cb) * sy;
    e[7] = 0;
    e[8] = s * ca * sx;
    e[9] = -sa * sx;
    e[10] = c * ca * sx;
    e[11] = 0;
    e[12] = T[T_PX];
    e[13] = T[T_PY];
    e[14] = T[T_PZ];
    e[15] = 1;
    mesh.matrixWorldNeedsUpdate = true;
  }
  // Corps animé et flammes (pose réécrite depuis T : marche à genoux, gestes), puis obus et invocations (§ Z sexies)
  bossCorps.sync();
  bossAnim.sync();

  // ----- Fenêtre sur le joueur : ouverte dès que le maillage est affiché ; le shader ne retire que ce qui est
  // DEVANT le joueur. Le centre est reculé d'un rayon le long de l'axe de visée : ce qui frôle son dos saute aussi.
  if (shown && P.alive && revealReady) {
    const back = P.radius;
    uHole.x = P.x + uHoleDir.x * back;
    uHole.y = PLAYER.height * 0.5 + uHoleDir.y * back;
    uHole.z = P.z + uHoleDir.z * back;
    uHole.w = BOSS.reveal.radius;
  } else {
    uHole.w = 0;
  }

  // ----- Zones circulaires : par zone, deux disques au sol (fond, puis disque qui grandit jusqu'à l'impact) et
  // le trait de chacun, par-dessus les robots. Matrices et gains écrits en ligne (§ G.3).
  const Zc = BOSS.zone;
  const y = RENDER.decals.telegraph.y;
  const dm = discMesh.instanceMatrix.array;
  const dc = discMesh.instanceColor.array;
  const rm = ringMesh.instanceMatrix.array;
  const rc = ringMesh.instanceColor.array;
  let n = 0;
  let lane = -1;
  let sweepK = -1;
  const mark = arrival === A_ALARM || arrival === A_DROP;
  for (let k = mark ? -1 : 0; k < zCount; k++) {
    let zx;
    let zz;
    let r;
    let u;
    let under = false; // zone centrée sur le boss : ses traits restent au sol tant qu'ils sont sous son corps
    if (k < 0) {
      // marque d'arrivée : se remplit pendant l'alarme et la chute
      const A = BOSS.arrival;
      zx = T[T_AX];
      zz = T[T_AZ];
      r = A.markRadius;
      u = (arrival === A_ALARM ? T[T_ARR] : A.alarmSeconds + T[T_ARR]) / (A.alarmSeconds + A.dropSeconds);
    } else {
      const kind = zKind[k];
      if (kind === Z_CHARGE || kind === Z_LANE) {
        lane = k;
        continue;
      }
      if (kind === Z_SWEEP || kind === Z_BEAM) {
        sweepK = k; // arc du balayage laser : dessiné avec les rectangles du couloir, plus bas
        continue;
      }
      zx = zX[k];
      zz = zZ[k];
      r = zR[k];
      u = 1 - zT[k] / zD[k];
      under = kind === Z_SLAM;
    }
    if (n + DISC_PER_ZONE > DISC_CAP) break;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const pulse = CF.reduits ? u : 0.5 - 0.5 * Math.cos(u * u * Zc.blinks * TWO_PI); // clignotement qui accélère vers l'impact (§ E5.X5 Réduits : montée continue)
    for (let layer = 0; layer < DISC_PER_ZONE; layer++) {
      const s = layer === 0 ? r : r * (Zc.fillStart + (1 - Zc.fillStart) * u);
      const g = layer === 0 ? Zc.baseGain * (1 + Zc.blinkDepth * pulse) : Zc.fillGain;
      const o = n * 16;
      dm[o] = s;
      dm[o + 1] = 0;
      dm[o + 2] = 0;
      dm[o + 3] = 0;
      dm[o + 4] = 0;
      dm[o + 5] = 1;
      dm[o + 6] = 0;
      dm[o + 7] = 0;
      dm[o + 8] = 0;
      dm[o + 9] = 0;
      dm[o + 10] = s;
      dm[o + 11] = 0;
      dm[o + 12] = zx;
      dm[o + 13] = y;
      dm[o + 14] = zz;
      dm[o + 15] = 1;
      // le trait : même cercle, par-dessus les robots (sauf sous le corps du boss)
      const low = under && s < BODY_R;
      rm[o] = s;
      rm[o + 1] = 0;
      rm[o + 2] = 0;
      rm[o + 3] = 0;
      rm[o + 4] = 0;
      rm[o + 5] = 1;
      rm[o + 6] = 0;
      rm[o + 7] = 0;
      rm[o + 8] = 0;
      rm[o + 9] = 0;
      rm[o + 10] = s;
      rm[o + 11] = 0;
      rm[o + 12] = low ? zx : zx + CONTOUR_D[0];
      rm[o + 13] = low ? y : CONTOUR_Y;
      rm[o + 14] = low ? zz : zz + CONTOUR_D[1];
      rm[o + 15] = 1;
      const q = n * 3;
      dc[q] = g;
      dc[q + 1] = g;
      dc[q + 2] = g;
      rc[q] = g;
      rc[q + 1] = g;
      rc[q + 2] = g;
      n++;
    }
  }
  render.commit(discMesh, n);
  render.commit(ringMesh, n);

  // ----- Couloir de la ruée : fond et remplissage au sol ; bordures et barres qui défilent vers l'avant
  // par-dessus les robots (au sol sous le corps du boss, dont le couloir part).
  let nq = 0;
  if (lane >= 0) {
    const C = BOSS.attacks.charge;
    const rot = zRot[lane];
    const w = zR[lane] * 2;
    let ox = zX[lane];
    let oz = zZ[lane];
    let len = zLen[lane];
    let u = 1;
    let aiming = false;
    let locked = true;
    if (zKind[lane] === Z_CHARGE) {
      u = 1 - zT[lane] / zD[lane];
      aiming = true;
      locked = zT[lane] <= C.lockSeconds;
    } else if (i >= 0) {
      // pendant la ruée : ce qu'il reste à parcourir, depuis le boss
      ox = E.x[i];
      oz = E.z[i];
      len = E.ai2[i] + w * 0.5;
    }
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const e = Zc.laneEdge;
    const edgeGain = Zc.edgeBoost * (locked ? 1 : Zc.laneAimGain);
    const side = (w - e) * 0.5;
    const body = len < BODY_R ? len : BODY_R; // longueur du couloir sous le corps
    let p = 0;
    // latéral, départ le long de l'axe, largeur, longueur, gain, niveau (0 = au sol, 1 = contour)
    QD[p++] = 0; QD[p++] = 0; QD[p++] = w; QD[p++] = len; QD[p++] = Zc.baseGain * (locked ? 1 : Zc.laneAimGain); QD[p++] = 0; // fond
    QD[p++] = 0; QD[p++] = 0; QD[p++] = w; QD[p++] = len * u; QD[p++] = Zc.fillGain; QD[p++] = 0; // remplissage
    QD[p++] = side; QD[p++] = 0; QD[p++] = e; QD[p++] = body; QD[p++] = edgeGain; QD[p++] = 0; // bordures, sous le corps
    QD[p++] = -side; QD[p++] = 0; QD[p++] = e; QD[p++] = body; QD[p++] = edgeGain; QD[p++] = 0;
    if (len > body) {
      QD[p++] = side; QD[p++] = body; QD[p++] = e; QD[p++] = len - body; QD[p++] = edgeGain; QD[p++] = 1; // bordures, au-delà
      QD[p++] = -side; QD[p++] = body; QD[p++] = e; QD[p++] = len - body; QD[p++] = edgeGain; QD[p++] = 1;
    }
    QD[p++] = 0; QD[p++] = len - e; QD[p++] = w; QD[p++] = e; QD[p++] = edgeGain; QD[p++] = len - e >= body ? 1 : 0; // bout du couloir
    if (aiming) {
      const bars = Zc.laneBars;
      const spacing = len / bars;
      const shift = (T[T_CLOCK] * Zc.laneBarSpeed) % spacing;
      for (let b = 0; b < bars && p < QD.length; b++) {
        const along = b * spacing + shift;
        if (along + Zc.laneBarLength > len - e) continue;
        QD[p++] = 0; QD[p++] = along; QD[p++] = w * Zc.laneBarWidth; QD[p++] = Zc.laneBarLength; QD[p++] = Zc.laneBarGain; QD[p++] = along >= body ? 1 : 0;
      }
    }
    const qm = quadMesh.instanceMatrix.array;
    const qc = quadMesh.instanceColor.array;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    for (let k = 0; k < p; k += QD_STRIDE) {
      const lat = QD[k];
      const along = QD[k + 1];
      const sx = QD[k + 2];
      const sz = QD[k + 3];
      const g = QD[k + 4];
      const up = QD[k + 5] > 0;
      const o = nq * 16;
      qm[o] = cs * sx;
      qm[o + 1] = 0;
      qm[o + 2] = -sn * sx;
      qm[o + 3] = 0;
      qm[o + 4] = 0;
      qm[o + 5] = 1;
      qm[o + 6] = 0;
      qm[o + 7] = 0;
      qm[o + 8] = sn * sz;
      qm[o + 9] = 0;
      qm[o + 10] = cs * sz;
      qm[o + 11] = 0;
      qm[o + 12] = ox + sn * along + cs * lat + (up ? CONTOUR_D[0] : 0);
      qm[o + 13] = up ? CONTOUR_Y : y;
      qm[o + 14] = oz + cs * along - sn * lat + (up ? CONTOUR_D[1] : 0);
      qm[o + 15] = 1;
      const q = nq * 3;
      qc[q] = g;
      qc[q + 1] = g;
      qc[q + 2] = g;
      nq++;
    }
  }
  // ----- Arc du balayage laser (§ E1.D) : par rayon, le rectangle de départ (largeur du rayon) et des rayons fins
  // répartis sur l'arc, par-dessus les robots. Pendant l'annonce ils s'allument l'un après l'autre dans le sens du
  // balayage ; une fois le rayon parti, ceux qu'il a déjà balayés s'éteignent.
  let nl = 0;
  if (sweepK >= 0 && beams > 0) {
    const W = BOSS.attacks.sweep;
    const firing = zKind[sweepK] === Z_BEAM;
    const u = 1 - zT[sweepK] / zD[sweepK]; // avancement de l'annonce, puis du balayage
    const arc = W.arcDeg * RAD;
    const dir = T[T_SW_DIR];
    const ox = zX[sweepK];
    const oz = zZ[sweepK];
    const len = zLen[sweepK];
    const spokes = Math.floor(W.spokes / beams);
    const qm = quadMesh.instanceMatrix.array;
    const qc = quadMesh.instanceColor.array;
    const pulse = CF.reduits ? u : 0.5 - 0.5 * Math.cos(u * u * Zc.blinks * TWO_PI); // § E5.X5
    for (let b = 0; b < beams; b++) {
      const a0 = T[T_SW_A0] + (b * TWO_PI) / beams;
      for (let j = firing ? 1 : 0; j <= spokes && nq < QUAD_CAP; j++) {
        const f = j / spokes; // part de l'arc
        if (firing && f <= u) continue; // déjà balayé
        const a = a0 + dir * arc * f;
        const sn = Math.sin(a);
        const cs = Math.cos(a);
        const wq = j === 0 ? W.width : W.spokeWidth;
        const g = j === 0 ? W.startGain * (0.65 + 0.35 * pulse) : W.spokeGain * (firing || f <= u ? 1 : 0.3);
        const lq = len - BODY_R;
        const o = nq * 16;
        qm[o] = cs * wq;
        qm[o + 1] = 0;
        qm[o + 2] = -sn * wq;
        qm[o + 3] = 0;
        qm[o + 4] = 0;
        qm[o + 5] = 1;
        qm[o + 6] = 0;
        qm[o + 7] = 0;
        qm[o + 8] = sn * lq;
        qm[o + 9] = 0;
        qm[o + 10] = cs * lq;
        qm[o + 11] = 0;
        qm[o + 12] = ox + sn * BODY_R + CONTOUR_D[0];
        qm[o + 13] = CONTOUR_Y;
        qm[o + 14] = oz + cs * BODY_R + CONTOUR_D[1];
        qm[o + 15] = 1;
        const q = nq * 3;
        qc[q] = g;
        qc[q + 1] = g;
        qc[q + 2] = g;
        nq++;
      }
      // le rayon : de la visière au sol devant lui, puis au ras du sol jusqu'au bout de sa portée
      if (firing && shown && nl + 3 <= LASER_CAP) {
        const a = a0 + dir * arc * u;
        const sn = Math.sin(a);
        const cs = Math.cos(a);
        const flick = W.beamGain * (0.85 + 0.15 * Math.sin(T[T_CLOCK] * 90));
        const sx = ox + sn * BODY_R;
        const sz = oz + cs * BODY_R;
        if (bossCorps.pret()) {
          SEG[0] = bossCorps.visiere[0];
          SEG[1] = bossCorps.visiere[1];
          SEG[2] = bossCorps.visiere[2];
        } else {
          SEG[0] = ox;
          SEG[1] = BOSS.height * 0.86;
          SEG[2] = oz;
        }
        SEG[3] = sx;
        SEG[4] = W.beamHeight;
        SEG[5] = sz;
        SEG[6] = W.beamThickness;
        SEG[7] = flick;
        SEG[8] = W.beamThickness;
        writeSegment(nl++);
        SEG[0] = sx;
        SEG[1] = W.beamHeight;
        SEG[2] = sz;
        SEG[3] = ox + sn * len;
        SEG[4] = W.beamHeight;
        SEG[5] = oz + cs * len;
        SEG[6] = W.width; // ruban à plat : la largeur est celle de la règle de dégâts
        SEG[7] = flick;
        SEG[8] = W.beamThickness;
        writeSegment(nl++);
        SEG[6] = W.width * W.coreWidth; // cœur du rayon, mêmes extrémités
        SEG[7] = W.coreGain;
        SEG[8] = W.beamThickness;
        writeSegment(nl++);
      }
    }
  }
  render.commit(quadMesh, nq);

  // ----- Liens des drones-boucliers (§ E1.D) : un trait fin de chaque drone au torse du boss, tant qu'il le protège.
  if (shown && i >= 0 && E.bossShield > 0) {
    const S = BOSS.shieldDrones;
    const FL = E.flags;
    const AL = E.alive;
    const total = E.count;
    const hover = ENEMIES.types[ENEMY.DRONE].hover || 1;
    const g = S.linkGain * (0.75 + 0.25 * Math.sin(T[T_CLOCK] * 11));
    for (let j = 0; j < total && nl < LASER_CAP; j++) {
      if (AL[j] === 0 || (FL[j] & F_SD) === 0) continue;
      SEG[0] = E.x[j];
      SEG[1] = hover;
      SEG[2] = E.z[j];
      SEG[3] = T[T_PX];
      SEG[4] = S.linkHeight;
      SEG[5] = T[T_PZ];
      SEG[6] = S.linkWidth;
      SEG[7] = g;
      SEG[8] = S.linkWidth;
      writeSegment(nl++);
    }
  }
  render.commit(laserMesh, nl);
}

/**
 * Écrit l'instance n de laserMesh : une boîte du point (SEG[0..2]) au point (SEG[3..5]), large de SEG[6], épaisse de
 * SEG[8], de gain SEG[7]. Repère de la boîte : Z le long du segment, X horizontal en travers, Y perpendiculaire aux deux.
 */
function writeSegment(n) {
  const dx = SEG[3] - SEG[0];
  const dy = SEG[4] - SEG[1];
  const dz = SEG[5] - SEG[2];
  const w = SEG[6];
  const h = Math.sqrt(dx * dx + dz * dz);
  const l = Math.sqrt(h * h + dy * dy);
  // X : horizontal, perpendiculaire au segment (segment vertical : l'axe x du monde)
  const xx = h > 1e-6 ? dz / h : 1;
  const xz = h > 1e-6 ? -dx / h : 0;
  // Y = Z × X (normé)
  const il = l > 1e-6 ? 1 / l : 0;
  const yx = dy * il * xz;
  const yy = dz * il * xx - dx * il * xz;
  const yz = -dy * il * xx;
  const m = laserMesh.instanceMatrix.array;
  const o = n * 16;
  m[o] = xx * w;
  m[o + 1] = 0;
  m[o + 2] = xz * w;
  m[o + 3] = 0;
  m[o + 4] = yx * SEG[8];
  m[o + 5] = yy * SEG[8];
  m[o + 6] = yz * SEG[8];
  m[o + 7] = 0;
  m[o + 8] = dx;
  m[o + 9] = dy;
  m[o + 10] = dz;
  m[o + 11] = 0;
  m[o + 12] = SEG[0];
  m[o + 13] = SEG[1];
  m[o + 14] = SEG[2];
  m[o + 15] = 1;
  const c = laserMesh.instanceColor.array;
  const q = n * 3;
  c[q] = SEG[7];
  c[q + 1] = SEG[7];
  c[q + 2] = SEG[7];
}

// =====================================================================================================================
// Debug
// =====================================================================================================================

/** Part « boss » du snapshot (§ S) : les sept champs du contrat, puis des ajouts pour les tests. */
export function inspect(out) {
  const i = E.bossIndex;
  const mark = arrival === A_ALARM || arrival === A_DROP;
  out.active = isActive();
  out.arriving = arrival !== A_NONE;
  out.phase = getPhase();
  out.hp = i >= 0 ? E.hp[i] : 0;
  out.maxHp = i >= 0 ? E.maxHp[i] : 0;
  out.attack = ATTACK_NAMES[curAttack];
  out.hazards = zCount + (mark ? 1 : 0);
  // ----- ajouts
  out.arrival = ARRIVAL_NAMES[arrival];
  out.dropX = T[T_AX];
  out.dropZ = T[T_AZ];
  out.dropY = arrival === A_ALARM || arrival === A_DROP ? T[T_DROP_Y] : 0;
  out.state = i >= 0 ? STATE_NAMES[E.state[i]] : null;
  out.x = i >= 0 ? E.x[i] : 0;
  out.z = i >= 0 ? E.z[i] : 0;
  out.rot = i >= 0 ? E.rot[i] : 0;
  out.speed = i >= 0 ? Math.sqrt(E.vx[i] * E.vx[i] + E.vz[i] * E.vz[i]) : 0;
  out.glow = i >= 0 ? E.glow[i] : 0;
  out.cd = i >= 0 ? E.cd[i] : 0;
  out.meshVisible = mesh.visible;
  out.meshY = mesh.matrix.elements[13];
  out.phase2Visible = overlay.visible;
  out.modele = modele; // modèle Blender posé (§ Z quinquies)
  out.zoneInstances = discMesh.count + quadMesh.count;
  // ----- étape 1 du plan addictif (§ E1.D) : rang, mutations, drones-boucliers, balayage
  out.rank = rank;
  out.mutations = Array.from(MUT); // index BMUT.*
  out.shieldDrones = E.bossShield;
  out.laserInstances = laserMesh.count;
  out.sweepDir = T[T_SW_DIR];
  out.sweepStart = T[T_SW_A0];
  out.slamLeft = slamLeft;
  out.visiere = bossCorps.pret() ? [bossCorps.visiere[0], bossCorps.visiere[1], bossCorps.visiere[2]] : null;
  const zones = [];
  if (mark) {
    const A = BOSS.arrival;
    const total = A.alarmSeconds + A.dropSeconds;
    const done = arrival === A_ALARM ? T[T_ARR] : A.alarmSeconds + T[T_ARR];
    zones.push({ kind: 'arrival', x: T[T_AX], z: T[T_AZ], r: A.markRadius, left: total - done, duration: total, rot: 0, length: 0 });
  }
  for (let k = 0; k < zCount; k++) {
    zones.push({ kind: ZONE_NAMES[zKind[k]], x: zX[k], z: zZ[k], r: zR[k], left: zT[k], duration: zD[k], rot: zRot[k], length: zLen[k] });
  }
  out.zones = zones;
  out.counts = {
    arrivals: nArrivals,
    landings: nLandings,
    slams: nSlams,
    charges: nCharges,
    mortars: nMortars,
    summons: nSummons,
    strikes: nStrikes,
    summoned: nSummoned,
    chargeHits: nChargeHits,
    phaseChanges: nPhaseChanges,
    deaths: nDeaths,
    sweeps: nSweeps,
    sweepHits: nSweepHits,
    enrages: nEnrages,
    shieldDrones: nShieldDrones,
  };
}
