// LOT : juice — hitstop, bords rouges, éclats low-poly, chiffres de dégâts en 7 segments, explosions, étincelles,
// anneaux au sol, bouffées (contrat : ARCHITECTURE.md § O ; rendu : § G.2, § G.3 ; appels reçus : § H ; règles : § V).
//
// Quatre maillages instanciés, créés une fois à l'init et jamais recréés :
//   éclats      CAPS.debris     matériau éclairé à facettes, couleur d'instance = couleur du robot, flash blanc (aFx)
//   étincelles  CAPS.sparks     non éclairé : traits d'impact, éclairs, blocs de feu et bouffées (un seul maillage)
//   anneaux     CAPS.rings      décalque au sol, transparent, sans écriture de profondeur
//   chiffres    64 × 5 × 7      un quad biseauté par segment allumé, face à l'écran : ni DOM ni texture
// Aucune fonction spawn… n'alloue ni ne renvoie rien. Pool plein : rien n'est créé (seule exception, voulue par le
// § O : les nombres recyclent le plus ancien). Les flottants d'un événement passent par le tableau Q, jamais par
// des arguments de fonction interne : V8 alloue un nombre par flottant passé à une fonction non mise en ligne (§ V).
//
// Chiffres de dégâts — ce qui tient les nombres lisibles dans une horde qui dure (voir spawnDamageNumber) :
//   · tous montent à la même vitesse : deux nombres qui ne se recouvrent pas ne se recouvriront jamais ;
//   · à chaque création ou regroupement, tout nombre que la boîte recouvre à l'écran est fondu dans le nombre ;
//   · un nombre n'absorbe que pendant FX.numbers.absorbSeconds après sa naissance : sa valeur et sa durée sont bornées ;
//   · un nombre ne monte jamais à travers le corps du joueur : son ancre est décalée de côté.
// Étincelles — les FX.impact.reserve dernières places du pool sont gardées aux explosions : un impact n'y touche pas.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAMERA, CAPS, DAMAGE, ENEMIES, ENEMY, ENEMY_COUNT, FX, FXK, PALETTE, PLAYER, PROGRAMME, RENDER, WAVES, WEAPON_COUNT, WORLD } from './config.js';
import { END_LOOT } from './config.js'; // § E2.G bis : voxels du butin perdu en fin de vague
import { GROS_BUTIN } from './config.js'; // § E4.K : éclat au ramassage d'un gros butin
import { SAUVEGARDE_BOSS } from './config.js'; // § E4.Q : éclats de chute et de ramassage de la disquette
import { BOUCLIER } from './config.js'; // § E4.P : impact atténué et éclats du bouclier du blindé
import { LISIBILITE_GUIDE } from './config.js'; // § E5.P : chiffres hiérarchisés, rien d'allié sur le héros, éclats plafonnés
import { CONFORT_FLASHS as CF } from './config.js'; // § E5.X5 (audit C12) : réglage « Flashs »
import { ARGF, F_DX, F_DZ, F_V, F_X, F_Z, P, rand } from './state.js';
import { LOT8 } from './config.js'; // § E5.X8 (E9) : vapeur du boss en récupération
import { lookDuChargement } from './vfx/look.js'; // 17/11 : look des VFX

let render = null;
let camMod = null; // § E5.AB.12 : module caméra (perspective du mode Souris : chiffres avancés vers l'œil)
// § E5.AB.12 : en perspective, un chiffre avance de cette part du chemin vers l'œil (même place à l'écran) et rétrécit
// d'autant (même taille à l'écran) — l'axe de visée seul le décalerait et le grossirait (45 m sur 50,7 m)
const NUMBER_PERSP = 0.75;

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

// ----- Minuteries réécrites à chaque image : dans un tableau typé (une variable de module qui reçoit un flottant
// coûte un nombre alloué à chaque écriture, § V) ---------------------------------------------------------------------
const HITSTOP_LEFT = 0; // s restantes de gel de la simulation (temps réel)
const SINCE_HITSTOP = 1; // s depuis le dernier hitstop accepté
const EDGE = 2; // bords rouges 0..1 (valeur affichée)
const EDGE_FROM = 3; // force au déclenchement
const EDGE_AGE = 4; // s depuis le déclenchement
const DT = 5; // pas de simulation en cours (lu par les step…, pour ne pas le passer en argument)
const MORTS = 6; // § E5.P (B16) : morts récentes, moyenne glissante (× LISIBILITE_GUIDE.eclats.fenetre = morts/s)
const RESTE = 7; // § E5.P (B16) : part fractionnaire d'éclats reportée d'une mort à l'autre
const VIE_ECLAT = 8; // § E5.P (B16) : multiplicateur de vie des éclats émis par emitDebris (1 hors spawnDebris)
const T = new Float64Array(9);
T[VIE_ECLAT] = 1;
T[SINCE_HITSTOP] = 1e9;
let hitstops = 0;
let dirty = false; // un pool a changé depuis le dernier sync

// ----- Base de l'écran dans le monde (fixe : la caméra ne tourne jamais), remplie à l'init ---------------------------
// droite (0..2), haut (3..5), vers la caméra (6..8)
const BASIS = new Float64Array(9);

// ----- Palette de travail : couleurs LINÉAIRES converties une fois à l'init par render.writeColor --------------------
const KINDS = FX.explosion.kinds.length;
const C_WEAPON = 0; // WEAPON_COUNT lignes : PALETTE.weapon
const C_NEUTRAL = C_WEAPON + WEAPON_COUNT; // source qui n'est pas une arme du joueur
const C_NUMBER = C_NEUTRAL + 1;
const C_CRIT = C_NUMBER + 1;
const C_ENEMY = C_CRIT + 1; // ENEMY_COUNT lignes : couleur de corps de chaque type
const C_PLAYER = C_ENEMY + ENEMY_COUNT;
const C_SHIELD = C_PLAYER + 1;
const C_HEAL = C_SHIELD + 1;
const C_HURT = C_HEAL + 1;
const C_SMOKE = C_HURT + 1;
const C_EXPLO = C_SMOKE + 1; // KINDS lignes : couleur de chaque genre d'explosion
const C_HOT = C_EXPLO + KINDS; // KINDS lignes : éclair central de chaque genre
const C_TMP = C_HOT + KINDS; // couleur reçue par spawnRing / spawnPuff
const C_PURGE = C_TMP + 1; // voxels et anneau de la purge de fin de vague (§ E1.A) : WAVES.purge.color
const COL = new Float32Array((C_PURGE + 1) * 3);

// ----- Paramètres d'événement (au lieu d'arguments flottants) ---------------------------------------------------------
const OX = 0; // origine de l'événement
const OY = 1;
const OZ = 2;
const ODX = 3; // direction brute (non normalisée, éventuellement nulle ou non finie)
const ODZ = 4;
const OS = 5; // échelle (rayon d'une explosion, taille des éclats)
const OHALF = 6; // demi-angle du cône (rad)
const PX = 7; // étincelle à créer
const PY = 8;
const PZ = 9;
const PVX = 10;
const PVY = 11;
const PVZ = 12;
const PLIFE = 13;
const PW = 14; // demi-épaisseur d'un trait, rayon d'un bloc
const PL = 15; // demi-longueur d'un trait
const PROT = 16;
const PR = 17;
const PG = 18;
const PB = 19;
const GX = 20; // anneau à créer
const GZ = 21;
const GRAD = 22;
const GLIFE = 23;
const GDELAY = 24; // retard avant d'apparaître (anneaux en écho) ; remis à 0 par pushRing
const GW = 25; // épaisseur imposée du trait (m) ; 0 = celle de FX.ring ; remis à 0 par pushRing (purge, § E1.A)
const Q = new Float64Array(26);

// ----- Tables par type de robot (init) --------------------------------------------------------------------------------
const isBig = new Uint8Array(ENEMY_COUNT);
const bodyY = new Float32Array(ENEMY_COUNT); // hauteur du centre du corps
const sizeMul = new Float32Array(ENEMY_COUNT); // taille des éclats selon la carrure

// ----- Éclats (pool privé, suppression immédiate par échange) ---------------------------------------------------------
const D_CAP = CAPS.debris;
const dX = new Float32Array(D_CAP);
const dY = new Float32Array(D_CAP);
const dZ = new Float32Array(D_CAP);
const dVX = new Float32Array(D_CAP);
const dVY = new Float32Array(D_CAP);
const dVZ = new Float32Array(D_CAP);
const dAngle = new Float32Array(D_CAP);
const dSpin = new Float32Array(D_CAP);
const dLife = new Float32Array(D_CAP);
const dMax = new Float32Array(D_CAP);
const dSize = new Float32Array(D_CAP);
const dPurge = new Uint8Array(D_CAP); // 1 = voxel de la purge de fin de vague : pas de lueur rouge de l'AGI (§ E1.A)
const dRobot = new Uint8Array(D_CAP); // § E5.P (B1) : 1 = éclat d'un robot détruit (atténué près du héros) ; 0 = éclats du héros
let dCount = 0;
let purgePer = 1; // voxels par robot de la purge en cours (écrit par beginPurge)
let purgePerBig = 1;
let purgeTotal = 0; // voxels de purge émis depuis le chargement
let debrisMesh = null;
let dMat = null; // instanceMatrix.array
let dFx = null; // aFx.array
let dCol = null; // instanceColor.array (fait partie du pool : échangée avec l'éclat)

// ----- Étincelles : traits, éclairs, blocs et bouffées ----------------------------------------------------------------
const K_STREAK = 0; // trait étiré le long de sa vitesse, freiné, qui retombe
const K_PUFF = 1; // bloc ou bouffée : gonfle puis rétrécit
const K_CORE = 2; // éclair : plein dès la première image, puis s'effondre
const S_CAP = CAPS.sparks;
const sX = new Float32Array(S_CAP);
const sY = new Float32Array(S_CAP);
const sZ = new Float32Array(S_CAP);
const sVX = new Float32Array(S_CAP);
const sVY = new Float32Array(S_CAP);
const sVZ = new Float32Array(S_CAP);
const sLife = new Float32Array(S_CAP);
const sMax = new Float32Array(S_CAP);
const sW = new Float32Array(S_CAP);
const sL = new Float32Array(S_CAP);
const sRot = new Float32Array(S_CAP);
const sKind = new Uint8Array(S_CAP);
// § E5.P (B1) : 1 = effet ALLIÉ (impact d'une arme du joueur, explosion de roquette), atténué près du héros ; 0 = tout le
// reste (gerbe des dégâts subis, explosions des robots et du boss, soins, butin) — écrit par pushSpark depuis ALLIE[0]
const sAllie = new Uint8Array(S_CAP);
const ALLIE = new Uint8Array(1);
let sCount = 0;
let sparkMesh = null;
let sMat = null;
// Look des VFX (17/11, src/vfx/look.js) : étincelles, blocs et bouffées × tailleLook, en aplat (sans facettes)
let tailleLook = 1;
let ombresFacettes = null; // teintes d'origine des facettes (rendues quand le look est coupé)
let sCol = null;

// ----- Anneaux au sol ---------------------------------------------------------------------------------------------------
// Le maillage est un entonnoir : bord extérieur de rayon 1 à la hauteur du décalque, bord intérieur de rayon
// 1 − RING_BAND un mètre plus bas. Le sol cache tout ce qui passe dessous : l'échelle verticale de l'instance règle
// donc l'ÉPAISSEUR visible du trait, sans opacité variable (interdite sur un matériau : § G.2) ni second maillage.
const RING_BAND = 0.5;
const RING_Y = RENDER.decals.ring.y;
const RING_F_MAX = 0.9; // part visible maximale de la bande (le bord intérieur reste au-dessus du sol)
const RING_TH_MIN = RING_Y * 0.8; // m — plus fin, la paroi serait vue par sa tranche du côté de la caméra : caché
const R_CAP = CAPS.rings;
const rX = new Float32Array(R_CAP);
const rZ = new Float32Array(R_CAP);
const rRadius = new Float32Array(R_CAP); // rayon final
const rLife = new Float32Array(R_CAP); // s restantes (> rMax : pas encore apparu)
const rMax = new Float32Array(R_CAP);
const rWidth = new Float32Array(R_CAP); // épaisseur imposée du trait (m) ; 0 = FX.ring.width + widthPerRadius × rayon
let rCount = 0;
let ringMesh = null;
let rMat = null;
let rCol = null;

// ----- Chiffres de dégâts -------------------------------------------------------------------------------------------------
const N_CAP = CAPS.damageNumbers;
const GLYPHS = CAPS.numberGlyphs;
const SEGS = CAPS.numberSegments;
const N_INST = N_CAP * GLYPHS * SEGS;
const nX = new Float32Array(N_CAP); // ancre au sol
const nZ = new Float32Array(N_CAP);
const nValue = new Float64Array(N_CAP); // cumul des coups regroupés
const nCritV = new Float64Array(N_CAP); // part de ce cumul venue de coups critiques
const nAge = new Float32Array(N_CAP); // s depuis la création ou le dernier regroupement qui a relancé la durée
const nBorn = new Float32Array(N_CAP); // s depuis la naissance (celle du plus ancien des nombres fondus) : jamais remis à zéro
const nLift = new Float32Array(N_CAP); // m montés vers le haut de l'écran
const nPop = new Float32Array(N_CAP); // s depuis le dernier sursaut (création ou regroupement)
const nPopAmp = new Float32Array(N_CAP); // ampleur de ce sursaut
const nR = new Float32Array(N_CAP); // couleur linéaire du nombre
const nG = new Float32Array(N_CAP);
const nB = new Float32Array(N_CAP);
const nCrit = new Uint8Array(N_CAP);
const nSeq = new Uint32Array(N_CAP); // ordre de création (le plus petit = le plus ancien)
let nCount = 0;
let nSeqNext = 1;
let nSegments = 0; // instances écrites au dernier sync (= segments allumés)
let numberMesh = null;
let nMat = null;
let nCol = null;

// Afficheur 7 segments. Chiffre de hauteur 1, centré ; segments a (haut), b, c (droite), d (bas), e, f (gauche),
// g (milieu) ; bit k du masque = segment k.
const SEG_MASK = new Uint8Array([63, 6, 91, 79, 102, 109, 125, 7, 127, 111]);
const SEG_SPAN = (1 - FX.numbers.stroke) / 2; // longueur d'un segment d'axe à axe
const SEG_OX = new Float32Array([0, SEG_SPAN / 2, SEG_SPAN / 2, 0, -SEG_SPAN / 2, -SEG_SPAN / 2, 0]);
const SEG_OY = new Float32Array([SEG_SPAN, SEG_SPAN / 2, -SEG_SPAN / 2, -SEG_SPAN, -SEG_SPAN / 2, SEG_SPAN / 2, 0]);
const SEG_VERT = new Uint8Array([0, 1, 1, 0, 1, 1, 0]);
const GLYPH_ADV = SEG_SPAN + FX.numbers.stroke + FX.numbers.spacing; // pas d'un chiffre au suivant
// Chiffres proportionnels (Femz, 22/11) : un « 1 » n'allume que ses deux montants de droite ; dans une case de « 8 » il
// laissait une demi-case vide à sa gauche et « 6951 » se lisait « 695 1 ». Le 1 a une case étroite (un trait) et ses
// montants y sont centrés ; l'espace entre deux chiffres reste FX.numbers.spacing partout.
const GLYPH_W = SEG_SPAN + FX.numbers.stroke; // largeur dessinée d'un chiffre
const ONE_W = FX.numbers.stroke; // largeur dessinée d'un « 1 »
const ONE_DX = -SEG_SPAN / 2; // décalage des montants d'un « 1 » vers le centre de sa case
const SEG_LAYER = 0.05; // avance du plein d'un segment sur son liseré, vers la caméra (en hauteurs de chiffre)
// Montants alignés (b–c à droite, e–f à gauche) : quand le segment du milieu est éteint (0, 1, 7), leurs pointes à
// 45° ne se touchent que par un point — le montant se lisait « ¦ ». Chacun est alors allongé vers le nœud du milieu,
// de SEG_JOIN (sa pointe passe sous l'épaule de l'autre) : l'instance est étirée de SEG_JOIN_K le long de son axe
// et son centre avance de SEG_JOIN / 2, l'autre bout ne bouge pas.
const SEG_SIDE = new Uint8Array([0, 1, 1, 0, 2, 2, 0]); // 1 : montant de droite, 2 : montant de gauche
const SEG_JOIN = FX.numbers.stroke * 0.75;
const SEG_JOIN_K = (SEG_SPAN / 2 + SEG_JOIN / 2) / (SEG_SPAN / 2);
const PLUS_L = 1.25; // § E5.Q (B14) : longueur d'un trait du « + » (× segment)
const PLUS_E = 0.6; // § E5.Q (B14) : épaisseur d'un trait du « + » (× segment)
// Les chiffres sont dessinés très en avant de la scène, le long de l'axe de visée : en projection orthographique
// leur place à l'écran ne change pas, mais ils passent devant tout — robots, falaises, décalques transparents.
const NUMBER_BIAS = Math.min(FX.numbers.depthBias, (CAMERA.distance - CAMERA.near) * 0.75);
const SETTLE_PASSES = 16; // garde de settle() : fusions et décalages enchaînés pour un seul coup

// ----- Compteurs depuis le chargement (lus par les tests dans inspect) ----------------------------------------------------
let debrisTotal = 0;
let sparksTotal = 0;
let ringsTotal = 0;
let numbersTotal = 0;
let merges = 0; // coups ajoutés à un nombre existant
let fused = 0; // nombres fondus dans un autre parce que leurs boîtes se recouvraient
let replaced = 0; // nombres trop vieux pour absorber, remplacés par le coup qui les aurait recouverts
let recycled = 0; // pool plein : le plus ancien a cédé sa place
let explosions = 0;
let impacts = 0;
let shieldSparks = 0;
let shieldDamps = 0; // § E4.P : coups de face atténués
let shieldCracks = 0; // § E4.P : boucliers fissurés (éclats)
let healPulses = 0;
let grosButin = 0; // § E4.K : éclats de ramassage d'un gros butin
const sauvegardeEclats = new Int32Array(2); // § E4.Q : éclats de la disquette [chute, ramassage]
let playerHits = 0;
let puffs = 0;
let dropped = 0; // créations refusées, pool plein
let shed = 0; // impacts non émis pour laisser la réserve du pool aux explosions
//#region e5:P-lisibilite-guide
let chiffresMasques = 0; // § E5.P (B2) : coups non affichés (plafond atteint par de plus gros coups)
let chiffresRemplaces = 0; // § E5.P (B2) : plus petits chiffres remplacés par un plus gros coup
let eclatsReduits = 0; // § E5.P (B16) : éclats non émis (taux de morts au-delà du seuil)
let eclatsPlafond = 0; // § E5.P (B16) : éclats non émis (plafond de vivants)
// § E5.P (B1) : réglages de l'atténuation autour du héros, en constantes du module (lus une fois : une constante de
// module se lit sans emballer son flottant, même hors du compilateur optimisant — un champ d'objet, non) ; seul
// LISIBILITE_GUIDE.autour.actif (booléen) est relu à chaque image
const AU_HY = LISIBILITE_GUIDE.autour.centre;
const AU_R0 = LISIBILITE_GUIDE.autour.r0;
const AU_R1 = LISIBILITE_GUIDE.autour.r1;
const AU_INV = 1 / (AU_R1 - AU_R0);
const AU_PART = LISIBILITE_GUIDE.autour.partFx;
//#endregion e5:P-lisibilite-guide

// Réglages des étincelles d'une explosion, au format des gerbes (burst) : multipliés par le rayon.
const EXPLO_STYLE = {
  speedMin: FX.explosion.sparkSpeedMin,
  speedMax: FX.explosion.sparkSpeedMax,
  seconds: FX.explosion.sparkSeconds,
  width: FX.explosion.sparkWidth,
  length: FX.explosion.sparkLength,
  upMin: FX.explosion.sparkUpMin,
  upMax: FX.explosion.sparkUpMax,
  gain: FX.explosion.gain,
  shade: FX.explosion.sparkShade,
  offset: FX.explosion.sparkOffset,
};

// Recette de l'étape 4 (ARCHITECTURE.md § E4.R) : burst() ne reçoit plus que des objets de MÊME forme (les dix champs
// ci-dessus, dans cet ordre). Les réglages de config.js ont chacun leur forme (FX.impact, FX.shieldSpark,
// FX.playerHit, puis BOUCLIER.impact au § E4.P) : au cinquième, les lectures S.xxx de burst devenaient mégamorphes et
// chaque lecture d'un nombre à virgule l'emballait — 600 octets par image en combat (juice : 43 o le 14/11, 603 o le
// 17/11). Copiés une fois au chargement : config.js n'est pas modifié en cours de partie.
function burstStyle(S) {
  return { speedMin: S.speedMin, speedMax: S.speedMax, seconds: S.seconds, width: S.width, length: S.length, upMin: S.upMin, upMax: S.upMax, gain: S.gain, shade: S.shade, offset: S.offset };
}
const IMPACT_STYLE = burstStyle(FX.impact);
const SHIELD_STYLE = burstStyle(FX.shieldSpark);
const DAMP_STYLE = burstStyle(BOUCLIER.impact);
const HURT_STYLE = burstStyle(FX.playerHit);

// ----- Géométries (init seulement) --------------------------------------------------------------------------------------

/** Éclat : tétraèdre allongé et aplati, blanc (la couleur vient de l'instance). */
function buildShard() {
  // carte mère (PROGRAMME) : voxel FILAIRE (Femz, 14/11 : « plus des carrés wireframe que pleins ») — les 12 arêtes
  // d'un cube de côté 0,7 × la taille de l'éclat, en baguettes d'épaisseur FX.debris.arete (part du côté)
  if (FX.debris.voxel) {
    const c = 0.7;
    const e = c * FX.debris.arete;
    const h = (c - e) / 2;
    const aretes = [];
    for (const a of [-h, h])
      for (const b of [-h, h]) {
        aretes.push(new THREE.BoxGeometry(c, e, e).translate(0, a, b));
        aretes.push(new THREE.BoxGeometry(e, c, e).translate(a, 0, b));
        aretes.push(new THREE.BoxGeometry(e, e, c).translate(a, b, 0));
      }
    return render.makePart(mergeGeometries(aretes, false), 0xffffff, 0);
  }
  const g = new THREE.TetrahedronGeometry(1, 0);
  g.scale(0.75, 0.5, 1.25);
  return render.makePart(g, 0xffffff, 0);
}

/**
 * Étincelle : octaèdre de rayon 1 ; étiré par l'instance en trait, ou gardé tel quel en bloc. Le matériau n'est
 * pas éclairé : les facettes sont peintes dans la couleur de sommet (une teinte par face, comme sous le soleil de
 * l'arène), sinon un bloc de feu se lirait comme un aplat sans volume.
 */
function buildSpark() {
  const g = render.makePart(new THREE.OctahedronGeometry(1, 0), 0xffffff, 0);
  const pos = g.attributes.position.array;
  const col = g.attributes.color.array;
  const sun = WORLD.light.sunDir;
  const sl = Math.hypot(sun[0], sun[1], sun[2]) || 1;
  const lo = FX.spark.facetShade;
  for (let t = 0; t < pos.length; t += 9) {
    // normale de la face (les sommets d'un octaèdre centré : leur somme)
    const nx = pos[t] + pos[t + 3] + pos[t + 6];
    const ny = pos[t + 1] + pos[t + 4] + pos[t + 7];
    const nz = pos[t + 2] + pos[t + 5] + pos[t + 8];
    const nl = Math.hypot(nx, ny, nz) || 1;
    const lit = Math.max(0, (nx * sun[0] + ny * sun[1] + nz * sun[2]) / (nl * sl));
    const shade = lo + (1 - lo) * Math.min(1, lit / 0.88); // la face la mieux exposée reste à la couleur pleine
    for (let k = 0; k < 9; k++) col[t + k] = shade;
  }
  return g;
}

/** Anneau : entonnoir de rayon 1 (voir RING_BAND), faces tournées vers le haut. */
function buildRing() {
  const n = FX.ring.segments;
  const pos = new Float32Array(n * 18);
  const inner = 1 - RING_BAND;
  let p = 0;
  const put = (x, y, z) => {
    pos[p++] = x;
    pos[p++] = y;
    pos[p++] = z;
  };
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * TWO_PI;
    const a1 = ((k + 1) / n) * TWO_PI;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    // deux triangles par secteur, normale vers le haut (ordre vérifié ci-dessous)
    put(c0, 0, s0);
    put(c1, 0, s1);
    put(inner * c0, -1, inner * s0);
    put(c1, 0, s1);
    put(inner * c1, -1, inner * s1);
    put(inner * c0, -1, inner * s0);
  }
  // Sens des triangles : la normale doit monter, sinon on échange deux sommets.
  for (let t = 0; t < pos.length; t += 9) {
    const ux = pos[t + 3] - pos[t];
    const uz = pos[t + 5] - pos[t + 2];
    const vx = pos[t + 6] - pos[t];
    const vz = pos[t + 8] - pos[t + 2];
    const ny = uz * vx - ux * vz;
    if (ny < 0) {
      for (let k = 0; k < 3; k++) {
        const tmp = pos[t + 3 + k];
        pos[t + 3 + k] = pos[t + 6 + k];
        pos[t + 6 + k] = tmp;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return render.makePart(g, 0xffffff, 0);
}

/**
 * Segment d'afficheur : quad biseauté (hexagone) couché sur l'axe X dans le plan XY, face vers +Z. Les pointes à
 * 45° de deux segments voisins se rejoignent exactement sur le nœud du chiffre : le trait est continu, sans
 * interstice. Deux hexagones dans la même géométrie : le liseré sombre, en retrait, et le plein, SEG_LAYER plus
 * près de la caméra — le test de profondeur garde donc toujours le plein d'un segment devant le liseré de son
 * voisin, quel que soit l'ordre des instances.
 */
function buildSegment() {
  const N = FX.numbers;
  const h = N.stroke / 2; // demi-épaisseur
  const e = N.outline;
  const l = SEG_SPAN / 2; // demi-longueur, pointe comprise
  const pos = new Float32Array(2 * 4 * 9);
  let p = 0;
  const hexagon = (len, half, shoulder, z) => {
    // sommets dans le sens direct vu de +Z, en éventail depuis la pointe droite
    const vx = [len, shoulder, -shoulder, -len, -shoulder, shoulder];
    const vy = [0, half, half, 0, -half, -half];
    for (let k = 1; k < 5; k++) {
      pos[p++] = vx[0];
      pos[p++] = vy[0];
      pos[p++] = z;
      pos[p++] = vx[k];
      pos[p++] = vy[k];
      pos[p++] = z;
      pos[p++] = vx[k + 1];
      pos[p++] = vy[k + 1];
      pos[p++] = z;
    }
  };
  hexagon(l + e * Math.SQRT2, h + e, l - h + e * (Math.SQRT2 - 1), 0); // liseré : hexagone décalé de e vers l'extérieur
  hexagon(l, h, l - h, SEG_LAYER); // plein
  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const g = render.makePart(raw, 0xffffff, 0);
  const col = g.attributes.color.array;
  for (let k = 0; k < 12 * 3; k++) col[k] = N.outlineShade; // les 12 premiers sommets sont ceux du liseré
  return g;
}

// ----- Cycle de vie ---------------------------------------------------------------------------------------------------------

export function init(ctx) {
  render = ctx.render;
  camMod = ctx.camera;

  // Base de l'écran à partir des vecteurs du sol de la caméra (§ B) : droite, haut, vers la caméra.
  // § E3.L : refaite à chaque changement d'inclinaison (réglage de caméra), sans allocation.
  const view = ctx.camera.view;
  const baseEcran = () => {
    const gph = view.groundPerHeight; // cos φ / sin φ
    const sinP = 1 / Math.sqrt(1 + gph * gph);
    const cosP = gph * sinP;
    BASIS[0] = view.rightX;
    BASIS[1] = 0;
    BASIS[2] = view.rightZ;
    BASIS[3] = view.upX * sinP;
    BASIS[4] = cosP;
    BASIS[5] = view.upZ * sinP;
    BASIS[6] = -view.upX * cosP;
    BASIS[7] = sinP;
    BASIS[8] = -view.upZ * cosP;
  };
  baseEcran();
  if (ctx.camera.onPitch) ctx.camera.onPitch(baseEcran);

  // Tables par type de robot.
  const D = FX.debris;
  for (let t = 0; t < ENEMY_COUNT; t++) {
    const E = ENEMIES.types[t];
    isBig[t] = DAMAGE.bigTypes.indexOf(t) >= 0 ? 1 : 0;
    bodyY[t] = (E.hover || 0) + (E.height || 1) * 0.5;
    const k = (E.radius || D.refRadius) / D.refRadius;
    sizeMul[t] = k < D.sizeMulMin ? D.sizeMulMin : k > D.sizeMulMax ? D.sizeMulMax : k;
    render.writeColor(COL, (C_ENEMY + t) * 3, E.bodyColor === undefined ? PALETTE.robot : E.bodyColor);
  }

  // Palette de travail.
  for (let w = 0; w < WEAPON_COUNT; w++) render.writeColor(COL, (C_WEAPON + w) * 3, PALETTE.weapon[w]);
  render.writeColor(COL, C_NEUTRAL * 3, PALETTE.damageNumber);
  render.writeColor(COL, C_NUMBER * 3, PALETTE.damageNumber);
  render.writeColor(COL, C_CRIT * 3, PALETTE.damageNumberCrit);
  render.writeColor(COL, C_PLAYER * 3, PALETTE.player);
  render.writeColor(COL, C_SHIELD * 3, FX.shieldSpark.color);
  render.writeColor(COL, C_HEAL * 3, FX.heal.color);
  render.writeColor(COL, C_HURT * 3, FX.playerHit.color);
  render.writeColor(COL, C_SMOKE * 3, FX.explosion.smokeColor);
  render.writeColor(COL, C_PURGE * 3, WAVES.purge.color);
  for (let k = 0; k < KINDS; k++) {
    render.writeColor(COL, (C_EXPLO + k) * 3, FX.explosion.kinds[k].color);
    render.writeColor(COL, (C_HOT + k) * 3, FX.explosion.kinds[k].hot);
  }

  // Maillages : une instance de matériau par maillage, couleur d'instance demandée à la création (§ G.3).
  // carte mère : la lueur d'instance des voxels est le rouge de l'AGI (aFx.y monte en fin de vie, syncDebris)
  const lueurEclats = FX.debris.voxel ? PROGRAMME.couleur : 0xffffff;
  debrisMesh = render.createInstanced(buildShard(), render.createLitMaterial({ profil: 'robot', glowColor: lueurEclats }), D_CAP, { instanceColor: true, name: 'eclats' });
  debrisMesh.renderOrder = RENDER.effectsOrder; // intégration : dessiné après l'anneau du joueur (RENDER.effectsOrder)
  dMat = debrisMesh.instanceMatrix.array;
  dFx = debrisMesh.geometry.attributes.aFx.array;
  dCol = debrisMesh.instanceColor.array;

  sparkMesh = render.createInstanced(buildSpark(), render.createUnlitMaterial(), S_CAP, { instanceColor: true, name: 'etincelles' });
  sparkMesh.renderOrder = RENDER.effectsOrder; // intégration : dessiné après l'anneau du joueur (RENDER.effectsOrder)
  sMat = sparkMesh.instanceMatrix.array;
  sCol = sparkMesh.instanceColor.array;

  ringMesh = render.createInstanced(buildRing(), render.createUnlitMaterial({ transparent: true }), R_CAP, { instanceColor: true, name: 'anneaux' });
  ringMesh.renderOrder = RENDER.decals.ring.order;
  rMat = ringMesh.instanceMatrix.array;
  rCol = ringMesh.instanceColor.array;

  // Chiffres. Le contrat (§ O) prévoyait un matériau opaque sans test de profondeur : three le dessine dans la
  // liste opaque, donc AVANT les décalques transparents (anneaux, zones du boss, anneau de l'EMP), qui repassaient
  // sur les chiffres. Ici : matériau opaque AVEC profondeur, et instances avancées de NUMBER_BIAS vers la caméra.
  // Les chiffres sont devant tout, les décalques échouent au test derrière eux, et le liseré d'un segment ne
  // recouvre jamais le plein d'un voisin.
  numberMesh = render.createInstanced(buildSegment(), render.createUnlitMaterial(), N_INST, { instanceColor: true, name: 'chiffres' });
  numberMesh.renderOrder = RENDER.decals.numbersOrder;
  render.garderNet(numberMesh); // branche shader-crt : les chiffres restent nets, hors de l'effet CRT / pixel
  nMat = numberMesh.instanceMatrix.array;
  nCol = numberMesh.instanceColor.array;
  reglerLook(lookDuChargement());
}

/** Remise à zéro : compteurs de pools et minuteries. Aucune ressource n'est créée ni libérée (§ T). */
/** Look des VFX (17/11) : { taille } du look (null = rendu d'avant) — taille des étincelles et aplat de leurs facettes. */
export function reglerLook(o) {
  tailleLook = o && o.taille ? o.taille : 1;
  const a = sparkMesh.geometry.attributes.color;
  if (ombresFacettes === null) ombresFacettes = Float32Array.from(a.array);
  const plat = !!(o && o.tons);
  for (let i = 0; i < a.array.length; i++) a.array[i] = plat ? 1 : ombresFacettes[i];
  a.needsUpdate = true;
  dirty = true;
  return { taille: tailleLook, plat };
}

export function reset() {
  T[HITSTOP_LEFT] = 0;
  T[SINCE_HITSTOP] = 1e9;
  T[EDGE] = 0;
  T[EDGE_FROM] = 0;
  T[EDGE_AGE] = 0;
  render.setEdgeFlash(0);
  dCount = 0;
  sCount = 0;
  rCount = 0;
  nCount = 0;
  nSegments = 0;
  Q[GDELAY] = 0;
  T[MORTS] = 0; // § E5.P (B16)
  T[RESTE] = 0;
  render.commit(debrisMesh, 0);
  render.commit(sparkMesh, 0);
  render.commit(ringMesh, 0);
  render.commit(numberMesh, 0);
  dirty = false;
}

/** S12 : éclats, étincelles, anneaux, chiffres — en temps simulé (figés pendant un hitstop et derrière un menu). */
export function update(dt) {
  if (T[MORTS] > 0) T[MORTS] *= Math.exp(-dt / LISIBILITE_GUIDE.eclats.fenetre); // § E5.P (B16) : moyenne glissante
  if (dCount + sCount + rCount + nCount === 0) return;
  T[DT] = dt;
  if (dCount > 0) stepDebris();
  if (sCount > 0) stepSparks();
  if (rCount > 0) stepRings();
  if (nCount > 0) stepNumbers();
  dirty = true;
}

/** F5 : minuterie du hitstop et extinction des bords rouges, en temps réel. */
export function updateReal(realDt) {
  T[SINCE_HITSTOP] += realDt;
  if (T[HITSTOP_LEFT] > 0) {
    T[HITSTOP_LEFT] -= realDt;
    if (T[HITSTOP_LEFT] < 0) T[HITSTOP_LEFT] = 0;
  }
  if (T[EDGE] > 0) {
    // De la force de départ à 0 en FX.edgeFlash.seconds, le long de (1 − t)^curve : chute rapide, puis traîne.
    T[EDGE_AGE] += realDt;
    const k = 1 - T[EDGE_AGE] / FX.edgeFlash.seconds;
    const curve = FX.edgeFlash.curve;
    T[EDGE] = k > 0 ? T[EDGE_FROM] * (curve === 2 ? k * k : curve === 1 ? k : Math.pow(k, curve)) : 0;
    render.setEdgeFlash(T[EDGE]);
  }
}

/** F11 : écrit les tampons d'instance des quatre maillages, seulement si un pool a changé. */
export function sync() {
  if (!dirty) return;
  dirty = false;
  // Un pool vide dont le maillage est déjà caché n'a rien à écrire ni à envoyer.
  if (dCount > 0 || debrisMesh.count > 0) syncDebris();
  if (sCount > 0 || sparkMesh.count > 0) syncSparks();
  if (rCount > 0 || ringMesh.count > 0) syncRings();
  if (nCount > 0 || numberMesh.count > 0) syncNumbers();
}

// ----- [F] hitstop et bords rouges ---------------------------------------------------------------------------------------------

/** Fige la simulation ; ignoré si le précédent date de moins de FX.hitstop.minInterval ; ne s'additionne pas. */
export function hitstop(seconds = FX.hitstop.seconds) {
  if (!(seconds > 0) || T[SINCE_HITSTOP] < FX.hitstop.minInterval) return;
  T[HITSTOP_LEFT] = CF.reduits ? seconds * CF.hitstopMul : seconds; // § E5.X5 : arrêts sur image raccourcis
  T[SINCE_HITSTOP] = 0;
  hitstops++;
}

/** 0 pendant un hitstop, 1 sinon. Lu par main à chaque image. */
export function getTimeScale() {
  return T[HITSTOP_LEFT] > 0 ? 0 : 1;
}

/** Bords rouges : montent à strength puis s'éteignent en FX.edgeFlash.seconds. */
export function flashDamageEdges(strength) {
  if (!(strength > 0)) return;
  if (strength > T[EDGE]) {
    T[EDGE] = strength > 1 ? 1 : strength;
    T[EDGE_FROM] = T[EDGE];
    T[EDGE_AGE] = 0;
    render.setEdgeFlash(T[EDGE]);
  }
}

// ----- Créations internes (paramètres dans Q) ------------------------------------------------------------------------------------

/**
 * n éclats de la couleur COL[row], depuis Q[OX..OZ], projetés dans un cône autour de (Q[ODX], Q[ODZ]) — direction
 * nulle ou non finie : dispersion tout autour. Q[OS] : échelle des tailles.
 */
function emitDebris(n, row) {
  const F = FX.debris;
  const x = Q[OX];
  const y = Q[OY];
  const z = Q[OZ];
  const scale = Q[OS];
  const dx = Q[ODX];
  const dz = Q[ODZ];
  const len = Math.sqrt(dx * dx + dz * dz);
  let base = 0;
  let half = Math.PI;
  if (len > 1e-6 && len < Infinity) {
    base = Math.atan2(dz, dx);
    half = F.coneDeg * 0.5 * DEG;
  }
  const o3 = row * 3;
  const r = COL[o3];
  const g = COL[o3 + 1];
  const b = COL[o3 + 2];
  for (let j = 0; j < n; j++) {
    if (dCount >= D_CAP) {
      dropped += n - j;
      break;
    }
    const i = dCount++;
    const a = base + (rand() * 2 - 1) * half;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const speed = F.speedMin + rand() * (F.speedMax - F.speedMin);
    const off = rand() * F.scatter;
    dX[i] = x + ca * off;
    dY[i] = y * (0.5 + rand());
    dZ[i] = z + sa * off;
    dVX[i] = ca * speed;
    dVY[i] = F.upMin + rand() * (F.upMax - F.upMin);
    dVZ[i] = sa * speed;
    dAngle[i] = rand() * TWO_PI;
    if (F.voxel) dAngle[i] = 0; // voxels alignés (le tirage est gardé : même suite de rand() qu'avant)
    dSpin[i] = (rand() * 2 - 1) * F.spinMax;
    const life = (F.lifeMin + rand() * (F.lifeMax - F.lifeMin)) * T[VIE_ECLAT]; // § E5.P (B16) : × 1 hors horde fauchée
    dLife[i] = life;
    dMax[i] = life;
    dSize[i] = (F.sizeMin + rand() * (F.sizeMax - F.sizeMin)) * scale;
    dPurge[i] = 0;
    dRobot[i] = row >= C_ENEMY && row < C_ENEMY + ENEMY_COUNT ? 1 : 0; // § E5.P (B1)
    const shade = 1 + (rand() * 2 - 1) * F.shade;
    const o = i * 3;
    dCol[o] = r * shade;
    dCol[o + 1] = g * shade;
    dCol[o + 2] = b * shade;
    debrisTotal++;
  }
  dirty = true;
}

/**
 * n voxels de purge depuis Q[OX..OZ] (§ E1.A règle 9) : même pool que les éclats, mais ils montent en flottant
 * (WAVES.purge), à la couleur de l'agent, sans la lueur rouge de l'AGI (dPurge).
 */
function emitPurge(n) {
  const F = FX.debris;
  const W = WAVES.purge;
  const x = Q[OX];
  const y = Q[OY];
  const z = Q[OZ];
  const scale = Q[OS];
  const o3 = C_PURGE * 3;
  const r = COL[o3] * W.gain;
  const g = COL[o3 + 1] * W.gain;
  const b = COL[o3 + 2] * W.gain;
  for (let j = 0; j < n; j++) {
    if (dCount >= D_CAP) {
      dropped += n - j;
      break;
    }
    const i = dCount++;
    const a = rand() * TWO_PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const off = rand() * F.scatter * scale;
    const speed = rand() * W.drift;
    dX[i] = x + ca * off;
    dY[i] = y * (0.2 + 1.6 * rand()); // sur toute la hauteur du robot : sa silhouette part en voxels
    dZ[i] = z + sa * off;
    dVX[i] = ca * speed;
    dVY[i] = W.upMin + rand() * (W.upMax - W.upMin);
    dVZ[i] = sa * speed;
    dAngle[i] = 0;
    dSpin[i] = 0;
    const life = W.lifeMin + rand() * (W.lifeMax - W.lifeMin);
    dLife[i] = life;
    dMax[i] = life;
    dSize[i] = (F.sizeMin + rand() * (F.sizeMax - F.sizeMin)) * scale * W.sizeMul;
    dPurge[i] = 1;
    const shade = 1 + (rand() * 2 - 1) * F.shade;
    const o = i * 3;
    dCol[o] = r * shade;
    dCol[o + 1] = g * shade;
    dCol[o + 2] = b * shade;
    purgeTotal++;
  }
  dirty = true;
}

/** Une étincelle du genre donné, décrite par Q[PX..PB]. */
function pushSpark(kind) {
  if (sCount >= S_CAP) {
    dropped++;
    return;
  }
  const i = sCount++;
  sX[i] = Q[PX];
  sY[i] = Q[PY];
  sZ[i] = Q[PZ];
  sVX[i] = Q[PVX];
  sVY[i] = Q[PVY];
  sVZ[i] = Q[PVZ];
  sLife[i] = Q[PLIFE];
  sMax[i] = Q[PLIFE];
  sW[i] = Q[PW];
  sL[i] = Q[PL];
  sRot[i] = Q[PROT];
  sKind[i] = kind;
  sAllie[i] = ALLIE[0]; // § E5.P (B1)
  const o = i * 3;
  sCol[o] = Q[PR];
  sCol[o + 1] = Q[PG];
  sCol[o + 2] = Q[PB];
  sparksTotal++;
  dirty = true;
}

/** Un éclair immobile en Q[PX..PZ] : rayon size, durée seconds, couleur COL[row] × gain. */
function pushCore(row, S) {
  const o = row * 3;
  const gain = S.coreGain;
  Q[PVX] = 0;
  Q[PVY] = 0;
  Q[PVZ] = 0;
  Q[PLIFE] = S.coreSeconds;
  Q[PL] = Q[PW];
  Q[PROT] = rand() * TWO_PI;
  Q[PR] = COL[o] * gain;
  Q[PG] = COL[o + 1] * gain;
  Q[PB] = COL[o + 2] * gain;
  pushSpark(K_CORE);
}

/**
 * Gerbe de n traits de la couleur COL[row], depuis Q[OX..OZ], dans un cône de demi-angle Q[OHALF] autour de
 * (Q[ODX], Q[ODZ]) — direction nulle ou non finie : tout autour. Q[OS] multiplie vitesses et tailles.
 * S : speedMin, speedMax, seconds, width, length, upMin, upMax, gain, shade, offset.
 */
function burst(n, S, row) {
  const x = Q[OX];
  const y = Q[OY];
  const z = Q[OZ];
  const k = Q[OS];
  const kr = Math.sqrt(k);
  const dx = Q[ODX];
  const dz = Q[ODZ];
  const len = Math.sqrt(dx * dx + dz * dz);
  let base = 0;
  let half = Math.PI;
  if (len > 1e-6 && len < Infinity) {
    base = Math.atan2(dz, dx);
    half = Q[OHALF];
  }
  const o3 = row * 3;
  const r = COL[o3];
  const g = COL[o3 + 1];
  const b = COL[o3 + 2];
  for (let j = 0; j < n; j++) {
    const a = base + (rand() * 2 - 1) * half;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const speed = (S.speedMin + rand() * (S.speedMax - S.speedMin)) * k;
    Q[PX] = x + ca * S.offset * k;
    Q[PY] = y;
    Q[PZ] = z + sa * S.offset * k;
    Q[PVX] = ca * speed;
    Q[PVY] = S.upMin + rand() * (S.upMax - S.upMin);
    Q[PVZ] = sa * speed;
    Q[PLIFE] = S.seconds * (0.6 + 0.4 * rand());
    Q[PW] = S.width * kr;
    Q[PL] = S.length * kr * (0.7 + 0.6 * rand());
    Q[PROT] = Math.atan2(ca, sa); // l'avant local (+Z) suit la vitesse
    const shade = S.gain * (1 + (rand() * 2 - 1) * S.shade);
    Q[PR] = r * shade;
    Q[PG] = g * shade;
    Q[PB] = b * shade;
    pushSpark(K_STREAK);
  }
}

/** Un anneau décrit par Q[GX], Q[GZ], Q[GRAD], Q[GLIFE] (+ Q[GDELAY]), de la couleur COL[row]. */
function pushRing(row) {
  const delay = Q[GDELAY];
  const width = Q[GW];
  Q[GDELAY] = 0;
  Q[GW] = 0;
  if (rCount >= R_CAP) {
    dropped++;
    return;
  }
  const i = rCount++;
  rX[i] = Q[GX];
  rZ[i] = Q[GZ];
  rRadius[i] = Q[GRAD];
  rMax[i] = Q[GLIFE];
  rLife[i] = Q[GLIFE] + delay;
  rWidth[i] = width;
  const gain = FX.ring.gain;
  const o3 = row * 3;
  const o = i * 3;
  rCol[o] = COL[o3] * gain;
  rCol[o + 1] = COL[o3 + 1] * gain;
  rCol[o + 2] = COL[o3 + 2] * gain;
  ringsTotal++;
  dirty = true;
}

// ----- [L] API : sans allocation, ne renvoient rien, ne font rien si leur pool est plein --------------------------------------------

/** Éclats low-poly à la couleur du robot, projetés dans la direction du coup (non normalisée, éventuellement nulle). */
export function spawnDebris(x, z, enemyType, dirX, dirZ) {
  if (!(x * 0 === 0 && z * 0 === 0)) return; // position finie exigée (ni NaN, ni infini, ni absente)
  let t = enemyType | 0;
  if (t < 0 || t >= ENEMY_COUNT) t = 0;
  Q[OX] = x;
  Q[OY] = bodyY[t];
  Q[OZ] = z;
  Q[ODX] = dirX;
  Q[ODZ] = dirZ;
  Q[OS] = sizeMul[t];
  //#region e5:P-lisibilite-guide
  // § E5.P (B16) : au-delà de `seuil` morts/s, moins d'éclats par mort (report de la partie fractionnaire, aucun tirage
  // de plus : la suite de rand() ne change pas sous le seuil) et plus brefs ; jamais plus de `plafond` éclats vivants
  const LE = LISIBILITE_GUIDE.eclats;
  T[MORTS] += 1;
  const taux = T[MORTS] / LE.fenetre;
  let n = isBig[t] === 1 ? FX.debris.perBigKill : FX.debris.perKill;
  T[VIE_ECLAT] = 1;
  if (taux > LE.seuil) {
    const voulu = (n * LE.seuil) / taux + T[RESTE];
    const k = Math.floor(voulu);
    T[RESTE] = voulu - k;
    eclatsReduits += n - k;
    n = k;
    T[VIE_ECLAT] = LE.vie;
  }
  const libre = LE.plafond - dCount;
  if (n > libre) {
    const k = libre > 0 ? libre : 0;
    eclatsPlafond += n - k;
    n = k;
  }
  if (n > 0) emitDebris(n, C_ENEMY + t);
  T[VIE_ECLAT] = 1;
  //#endregion e5:P-lisibilite-guide
  if (PROGRAMME.actif) {
    const A = PROGRAMME.mort.anneau;
    // désagrégation : anneau bref au sol — écrit ici comme dans spawnRing, sans flottant passé en argument (§ Z nonies)
    render.writeColor(COL, C_TMP * 3, PROGRAMME.couleur);
    Q[GX] = x;
    Q[GZ] = z;
    Q[GRAD] = A.rayon * sizeMul[t];
    Q[GLIFE] = A.secondes;
    pushRing(C_TMP);
  }
}

/**
 * Début d'une purge de fin de vague (§ E1.A règle 9), `alive` robots à désintégrer : fixe le nombre de voxels par
 * robot (WAVES.purge.maxVoxels au total) et lance les anneaux fins à la couleur de l'agent depuis le héros.
 */
export function beginPurge(alive) {
  const W = WAVES.purge;
  let per = alive > 0 ? Math.floor(W.maxVoxels / alive) : W.voxelsPerRobot;
  if (per > W.voxelsPerRobot) per = W.voxelsPerRobot;
  if (per < 1) per = 1;
  purgePer = per;
  purgePerBig = Math.round((per * W.voxelsPerBig) / W.voxelsPerRobot);
  if (purgePerBig < 1) purgePerBig = 1;
  // anneaux fins en écho, à la couleur de l'agent, qui balaient l'écran depuis le héros
  for (let k = 0; k < W.rings; k++) {
    Q[GX] = P.x;
    Q[GZ] = P.z;
    Q[GRAD] = W.ringRadius;
    Q[GLIFE] = W.ringSeconds;
    Q[GDELAY] = k * W.ringDelay;
    Q[GW] = W.ringWidth;
    pushRing(C_PURGE);
  }
}

/** Un robot du type donné se désintègre en voxels de purge, à la position (ARGF[F_X], ARGF[F_Z]). */
export function spawnPurgeF(enemyType) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  if (!(x * 0 === 0 && z * 0 === 0)) return;
  let t = enemyType | 0;
  if (t < 0 || t >= ENEMY_COUNT) t = 0;
  Q[OX] = x;
  Q[OY] = bodyY[t];
  Q[OZ] = z;
  Q[OS] = sizeMul[t];
  emitPurge(isBig[t] === 1 ? purgePerBig : purgePer);
}

/**
 * § E2.G bis G1 : un butin perdu en fin de vague se désintègre avec les mêmes voxels de purge que les robots, en
 * (ARGF[F_X], ARGF[F_Z]). chest = 1 : un coffre (END_LOOT.voxelsPerChest, chestVoxelScale) ; 0 : `n` voxels d'une gemme
 * ou d'un fragment (lootVoxelScale). Aucun flottant en argument.
 */
export function spawnPurgeLootF(chest, n) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  if (!(x * 0 === 0 && z * 0 === 0) || !(n > 0)) return;
  Q[OX] = x;
  Q[OY] = chest === 1 ? 0.5 : 0.35;
  Q[OZ] = z;
  Q[OS] = chest === 1 ? END_LOOT.chestVoxelScale : END_LOOT.lootVoxelScale;
  emitPurge(n);
}

/**
 * Chiffre de dégâts, regroupé (§ O ; cahier : « regroupés quand ils se chevauchent »). Le coup rejoint, par ordre de
 * préférence :
 *   1. un nombre encore jeune (né depuis moins de absorbSeconds) : soit à moins de mergeRadius de lui et relancé
 *      depuis moins de mergeWindow (règle du § O), soit que son chiffre recouvrirait à l'écran, à n'importe quelle
 *      distance — le montant s'y ajoute et sa durée repart ;
 *   2. sinon la place d'un nombre trop vieux pour absorber, que son chiffre recouvrirait : il le remplace ;
 *   3. sinon un nouveau nombre (pool plein : le plus ancien est recyclé).
 * Puis settle() : couleur, fusion des nombres que la boîte recouvre, écart du corps du joueur.
 * Un nombre nourri sans arrêt ne vit donc pas indéfiniment : passé absorbSeconds il finit sa course (life) et le
 * coup suivant en ouvre un autre — sa valeur est bornée par ce que la horde encaisse en absorbSeconds.
 */
export function spawnDamageNumber(x, z, amount, crit) {
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  ARGF[F_V] = amount;
  spawnDamageNumberF(crit);
}

/** spawnDamageNumber sans flottant en argument : position ARGF[F_X], ARGF[F_Z], montant ARGF[F_V] (§ Z nonies). */
export function spawnDamageNumberF(crit) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  const amount = ARGF[F_V];
  if (!(amount > 0) || !(x * 0 === 0 && z * 0 === 0)) return;
  const LC = LISIBILITE_GUIDE.chiffres; // § E5.P (B2)
  const N = FX.numbers;
  const ecart = LC.ecart; // § E5.P (B2) : écart horizontal minimal entre deux chiffres, × la plus haute des deux (m d'écran)
  // plafond (§ E5.P, B2) : compte et plus petit chiffre relevés seulement quand le pool peut l'atteindre (sinon rien de
  // plus par coup qu'avant le lot)
  const plafond = SOIN_N[0] === 0 && nCount >= LC.max && LC.max < N_CAP ? 1 : 0;
  let nDeg = 0; // chiffres de dégâts affichés
  let petit = -1; // le plus petit d'entre eux qui a au moins ageMinRemplace s
  let radius = N.mergeRadius;
  if (nCount >= N.crowdCount) radius *= N.crowdRadiusMul; // horde arrosée : moins de nombres, plus gros en valeur
  const r2 = radius * radius;
  // Place du coup dans le plan de l'écran (m) : la hauteur d'affichage, commune à tous, s'annule.
  const rx = BASIS[0];
  const rz = BASIS[2];
  const ux = BASIS[3];
  const uz = BASIS[5];
  const sx = x * rx + z * rz;
  const sy = x * ux + z * uz;
  const size = crit ? N.size * N.critScale : N.size;
  const half = HALF[codeHalf(amount)] * size;
  let bestD = Infinity; // le plus proche des nombres jeunes qui prennent le coup
  let best = -1;
  let oldD = Infinity; // le plus proche des nombres trop vieux que le chiffre recouvrirait
  let old = -1;
  for (let i = 0; i < nCount; i++) {
    if ((nCrit[i] === 2 ? 1 : 0) !== SOIN_N[0]) continue; // § E5.F : un soin (vert) ne se mêle pas aux dégâts
    if (plafond === 1) {
      // § E5.P (B2) : compte des chiffres de dégâts, et le plus petit qui peut céder sa place
      nDeg++;
      if (nBorn[i] >= LC.ageMinRemplace && (petit < 0 || nValue[i] < nValue[petit])) petit = i;
    }
    const dx = nX[i] - x;
    const dz = nZ[i] - z;
    const d = dx * dx + dz * dz;
    const young = nBorn[i] < N.absorbSeconds;
    if (d >= (young ? bestD : oldD)) continue;
    if (!(young && d < r2 && nAge[i] < N.mergeWindow)) {
      // hors de la règle du rayon : seulement si les deux boîtes se recouvrent à l'écran, là où le nombre est affiché
      const other = nCrit[i] === 1 ? N.size * N.critScale : N.size;
      const ex = nX[i] * rx + nZ[i] * rz - sx;
      const ey = nX[i] * ux + nZ[i] * uz + nLift[i] - sy;
      const wx = (half + HALF[codeHalf(nValue[i])] * other) * N.overlap + ecart * (size > other ? size : other); // § E5.P (B2) : + écart minimal
      const wy = (size + other) * 0.5 * N.overlap;
      if (ex >= wx || ex <= -wx || ey >= wy || ey <= -wy) continue;
    }
    if (young) {
      bestD = d;
      best = i;
    } else {
      oldD = d;
      old = i;
    }
  }
  let i = best;
  if (i >= 0) {
    nValue[i] += amount;
    if (crit) nCritV[i] += amount;
    nAge[i] = 0; // la durée repart
    if (nPop[i] >= N.popSeconds) {
      // sursaut discret à chaque regroupement, jamais deux à la fois (un nombre nourri en continu ne tremble pas)
      nPop[i] = 0;
      nPopAmp[i] = N.mergePopAmp;
    }
    merges++;
  } else {
    if (old >= 0) {
      i = old;
      replaced++;
    } else if (plafond === 1 && nDeg >= LC.max) {
      // § E5.P (B2) : plafond atteint — seul un plus gros coup (ou un critique) s'affiche, à la place du plus petit
      // (max ≥ la capacité du pool : comportement d'avant, le plus ancien est recyclé)
      if (petit >= 0 && (crit || amount > nValue[petit])) {
        i = petit;
        chiffresRemplaces++;
      } else {
        chiffresMasques++;
        return;
      }
    } else if (nCount < N_CAP) {
      i = nCount++;
    } else {
      i = 0;
      for (let k = 1; k < N_CAP; k++) if (nSeq[k] < nSeq[i]) i = k;
      recycled++;
    }
    nX[i] = x;
    nZ[i] = z;
    nValue[i] = amount;
    nCrit[i] = SOIN_N[0] === 1 ? 2 : 0; // § E5.F : 2 = soin
    nCritV[i] = crit ? amount : 0;
    nAge[i] = 0;
    nBorn[i] = 0;
    nLift[i] = 0;
    nPop[i] = 0;
    nPopAmp[i] = N.popAmp;
    nSeq[i] = nSeqNext++;
    numbersTotal++;
  }
  settle(i);
  dirty = true;
}

/**
 * Le nombre i, encore jeune, vient de changer (création ou regroupement). Repris jusqu'à ce que plus rien ne bouge :
 *   1. couleur : critique tant que les coups critiques pèsent au moins critShare de son total. Le § O dit « le
 *      critique reste acquis » : il le reste après quelques coups normaux (un critique vaut critMul coups), mais pas
 *      dans un nombre qui regroupe des dizaines de coups — sinon, dans une horde, presque tous les nombres sont
 *      jaunes et la couleur ne dit plus rien (mesuré : 52 % de nombres jaunes pour 5 % de critiques) ;
 *   2. tout autre nombre que sa boîte recouvre à l'écran est fondu en lui. Il hérite de l'âge du plus ancien ; un
 *      nombre trop vieux pour absorber est retiré sans transmettre sa valeur (elle a été affichée absorbSeconds au
 *      moins) : un cumul ne passe donc jamais de nombre en nombre au-delà de absorbSeconds ;
 *   3. s'il devait monter à travers le corps du joueur d'ici la fin de sa vie, son ancre est décalée de côté, le
 *      long de la droite de l'écran, jusqu'au bord du couloir.
 */
function settle(i) {
  const N = FX.numbers;
  const ecart = LISIBILITE_GUIDE.chiffres.ecart; // § E5.P (B2) : × la plus haute des deux boîtes
  const rx = BASIS[0];
  const rz = BASIS[2];
  const ux = BASIS[3];
  const uz = BASIS[5];
  const cosP = BASIS[4];
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    const soin = nCrit[i] === 2 ? 1 : 0; // § E5.F : chiffre de soin, vert
    const crit = soin === 0 && nCritV[i] > 0 && nCritV[i] >= nValue[i] * N.critShare ? 1 : 0;
    nCrit[i] = soin === 1 ? 2 : crit;
    const o3 = (soin === 1 ? C_HEAL : crit === 1 ? C_CRIT : C_NUMBER) * 3;
    nR[i] = COL[o3] * N.gain;
    nG[i] = COL[o3 + 1] * N.gain;
    nB[i] = COL[o3 + 2] * N.gain;
    const size = crit === 1 ? N.size * N.critScale : N.size;
    const half = (HALF[codeHalf(nValue[i])] + soin * GLYPH_ADV * 0.5) * size; // § E5.Q (B14) : le « + » d'un soin élargit la boîte
    const sx = nX[i] * rx + nZ[i] * rz;
    const sy = nX[i] * ux + nZ[i] * uz + nLift[i];
    let hit = -1;
    for (let j = 0; j < nCount; j++) {
      if (j === i) continue;
      if ((nCrit[j] === 2) !== (nCrit[i] === 2)) continue; // § E5.F : soins et dégâts ne se fondent pas
      const other = nCrit[j] === 1 ? N.size * N.critScale : N.size;
      const ex = nX[j] * rx + nZ[j] * rz - sx;
      const ey = nX[j] * ux + nZ[j] * uz + nLift[j] - sy;
      const wx = (half + HALF[codeHalf(nValue[j])] * other) * N.overlap + ecart * (size > other ? size : other); // § E5.P (B2) : + écart minimal
      const wy = (size + other) * 0.5 * N.overlap;
      if (ex < wx && ex > -wx && ey < wy && ey > -wy) {
        hit = j;
        break;
      }
    }
    if (hit >= 0) {
      if (nBorn[hit] < N.absorbSeconds) {
        nValue[i] += nValue[hit];
        nCritV[i] += nCritV[hit];
        if (nBorn[hit] > nBorn[i]) nBorn[i] = nBorn[hit];
      }
      fused++;
      const last = nCount - 1;
      removeNumber(hit);
      if (i === last) i = hit;
      continue; // la valeur a changé : couleur et boîte à reprendre
    }
    // Couloir du joueur : la boîte, de sa place actuelle jusqu'à la fin de sa vie possible, ne passe pas sur son corps.
    const px = nX[i] - P.x;
    const pz = nZ[i] - P.z;
    const ex = px * rx + pz * rz;
    const bottom = px * ux + pz * uz + nLift[i] + N.height * cosP - size * 0.5; // bas de la boîte, depuis les pieds du joueur
    const top = bottom + size + N.rise * (N.life + N.absorbSeconds - nBorn[i]);
    const wx = half + N.clearSide;
    if (!(ex < wx && ex > -wx && bottom < PLAYER.height * cosP + N.clearAbove && top > -N.clearBelow)) break;
    const shift = (ex >= 0 ? wx : -wx) * 1.001 - ex;
    nX[i] += rx * shift;
    nZ[i] += rz * shift;
  }
}

/** § E5.F : chiffre de SOIN (vert, jamais mêlé aux dégâts) — montant dans ARGF[F_V], position ARGF[F_X], ARGF[F_Z]. */
const SOIN_N = new Uint8Array(1);
export function spawnHealNumberF() {
  SOIN_N[0] = 1;
  spawnDamageNumberF(false);
  SOIN_N[0] = 0;
}

/** Retire le nombre j du pool (échange avec le dernier). */
function removeNumber(j) {
  const last = --nCount;
  if (j === last) return;
  nX[j] = nX[last];
  nZ[j] = nZ[last];
  nValue[j] = nValue[last];
  nCritV[j] = nCritV[last];
  nAge[j] = nAge[last];
  nBorn[j] = nBorn[last];
  nLift[j] = nLift[last];
  nPop[j] = nPop[last];
  nPopAmp[j] = nPopAmp[last];
  nR[j] = nR[last];
  nG[j] = nG[last];
  nB[j] = nB[last];
  nCrit[j] = nCrit[last];
  nSeq[j] = nSeq[last];
}

/** Code de largeur d'un nombre entier v (1 ≤ v ≤ maxValue) : chiffres × 8 + nombre de « 1 » (un « 1 » est étroit).
 *  Rend un entier (jamais de flottant à travers l'appel : aucune allocation) ; la largeur se lit dans LARG[code]. */
function codeLargeur(v) {
  let d = 0;
  let uns = 0;
  do {
    if (v % 10 === 1) uns++;
    v = (v / 10) | 0;
    d++;
  } while (v > 0 && d < GLYPHS);
  return d * 8 + uns;
}
/** Largeur (en hauteurs de chiffre) par code : d chiffres dont u « 1 ». */
const LARG = new Float64Array((GLYPHS + 1) * 8);
for (let d = 1; d <= GLYPHS; d++) for (let u = 0; u <= d && u < 8; u++) LARG[d * 8 + u] = (d - u) * GLYPH_W + u * ONE_W + (d - 1) * FX.numbers.spacing;
/** Demi-largeurs par code (lues par les appelants de codeHalf : la valeur flottante ne traverse aucun appel). */
const HALF = LARG.map((w) => w * 0.5);

/** Code de demi-largeur d'un nombre affiché (valeur brute, arrondie et bornée ici) : HALF[codeHalf(value)]. */
function codeHalf(value) {
  return codeLargeur(value < 1 ? 1 : value > FX.numbers.maxValue ? FX.numbers.maxValue : Math.round(value) | 0);
}

/** Explosion : anneau au sol jusqu'au rayon, éclair, blocs de feu, étincelles, fumée. kind = FXK.*. */
export function spawnExplosion(x, z, radius, kind) {
  if (!(x * 0 === 0 && z * 0 === 0)) return;
  const X = FX.explosion;
  const r = radius > 0 && radius < 1e6 ? radius : X.minRadius;
  let k = kind | 0;
  if (k < 0 || k >= KINDS) k = 0;
  const K = X.kinds[k];
  const mul = K.mul;
  explosions++;
  ALLIE[0] = k === FXK.ROCKET || k === FXK.ROCKET_TOON ? 1 : 0; // § E5.P (B1) : explosion d'une arme du joueur

  // Anneaux au sol : le premier marque exactement la zone touchée, les suivants lui font écho.
  for (let j = 0; j < K.rings; j++) {
    Q[GX] = x;
    Q[GZ] = z;
    Q[GRAD] = r;
    Q[GLIFE] = X.ringSeconds;
    Q[GDELAY] = j * X.ringSeconds * 0.4;
    pushRing(C_EXPLO + k);
  }

  // Éclair central.
  Q[PX] = x;
  Q[PY] = X.height;
  Q[PZ] = z;
  Q[PW] = r * X.coreSize;
  pushCore(C_HOT + k, X);

  // Blocs de feu.
  let o3 = (C_EXPLO + k) * 3;
  let cr = COL[o3] * X.gain;
  let cg = COL[o3 + 1] * X.gain;
  let cb = COL[o3 + 2] * X.gain;
  let n = Math.round(X.chunks * mul);
  for (let j = 0; j < n; j++) {
    const a = rand() * TWO_PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const speed = r * X.chunkSpeed * (0.35 + 0.65 * rand());
    Q[PX] = x + ca * r * 0.12;
    Q[PY] = X.height * (0.6 + 0.8 * rand());
    Q[PZ] = z + sa * r * 0.12;
    Q[PVX] = ca * speed;
    Q[PVY] = X.chunkRise * (0.4 + rand());
    Q[PVZ] = sa * speed;
    Q[PLIFE] = X.seconds * (0.65 + 0.35 * rand());
    Q[PW] = r * X.chunkSize * (0.65 + 0.7 * rand());
    Q[PL] = Q[PW];
    Q[PROT] = rand() * TWO_PI;
    const shade = 0.75 + 0.25 * rand(); // jamais au-dessus du gain : la teinte du genre reste exacte
    Q[PR] = cr * shade;
    Q[PG] = cg * shade;
    Q[PB] = cb * shade;
    pushSpark(K_PUFF);
  }

  // Fumée : bouffées sombres qui montent et durent un peu plus que le feu.
  o3 = C_SMOKE * 3;
  cr = COL[o3];
  cg = COL[o3 + 1];
  cb = COL[o3 + 2];
  n = Math.round(X.smoke * mul);
  for (let j = 0; j < n; j++) {
    const a = rand() * TWO_PI;
    const d = r * 0.35 * rand();
    Q[PX] = x + Math.cos(a) * d;
    Q[PY] = X.height * 0.5;
    Q[PZ] = z + Math.sin(a) * d;
    Q[PVX] = Math.cos(a) * r * 0.5;
    Q[PVY] = 1.5 + 2 * rand();
    Q[PVZ] = Math.sin(a) * r * 0.5;
    Q[PLIFE] = X.smokeSeconds * (0.7 + 0.3 * rand());
    Q[PW] = r * X.smokeSize * (0.7 + 0.6 * rand());
    Q[PL] = Q[PW];
    Q[PROT] = rand() * TWO_PI;
    const shade = 0.8 + 0.5 * rand();
    Q[PR] = cr * shade;
    Q[PG] = cg * shade;
    Q[PB] = cb * shade;
    pushSpark(K_PUFF);
  }

  // Étincelles projetées tout autour.
  Q[OX] = x;
  Q[OY] = X.height;
  Q[OZ] = z;
  Q[ODX] = 0;
  Q[ODZ] = 0;
  Q[OS] = r;
  Q[OHALF] = Math.PI;
  burst(Math.round(X.sparks * mul), EXPLO_STYLE, C_EXPLO + k);

  // Éclats : ces deux genres les émettent eux-mêmes (aucun autre appelant ne le fait, § O).
  if (k === FXK.BOSS_DEATH) {
    Q[OY] = bodyY[ENEMY.BOSS];
    Q[OS] = sizeMul[ENEMY.BOSS];
    emitDebris(FX.debris.perBossKill, C_ENEMY + ENEMY.BOSS);
  } else if (k === FXK.PLAYER_DEATH) {
    Q[OY] = PLAYER.height * 0.5;
    Q[OS] = 1;
    emitDebris(FX.debris.perPlayerDeath, C_PLAYER);
  }
  ALLIE[0] = 0; // § E5.P (B1)
}

/**
 * Étincelle d'impact à la couleur de la source. source va de 0 à 8 : PALETTE.weapon n'est lu que si
 * source < WEAPON_COUNT ; sinon (kamikaze, boss, debug, valeur absente) la couleur neutre.
 * Un tir direct donne un éclair sur le robot et une gerbe dans le prolongement du tir. Un coup de zone (roquettes,
 * EMP, explosion ennemie : damage.explode appelle hitEnemy sur chaque robot AVANT spawnExplosion) ne donne que
 * l'éclair : l'explosion est son effet. Les FX.impact.reserve dernières places du pool ne sont jamais prises par un
 * impact, même pour son éclair : elles restent aux explosions d'une salve.
 */
export function spawnImpact(x, z, source) {
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  spawnImpactF(source);
}

/** spawnImpact sans flottant en argument : position ARGF[F_X], ARGF[F_Z] (§ Z nonies). */
export function spawnImpactF(source) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  if (!(x * 0 === 0 && z * 0 === 0)) return;
  const I = FX.impact;
  const free = S_CAP - sCount;
  if (free <= I.reserve) {
    shed++;
    return;
  }
  const weapon = source >= 0 && source < WEAPON_COUNT;
  const w = weapon ? source | 0 : 0;
  const row = weapon ? C_WEAPON + w : C_NEUTRAL;
  impacts++;
  Q[PX] = x;
  Q[PY] = I.height;
  Q[PZ] = z;
  Q[PW] = I.coreSize;
  ALLIE[0] = weapon ? 1 : 0; // § E5.P (B1) : impact d'une arme du joueur
  pushCore(row, I);
  if (!weapon || I.radial[w]) {
    ALLIE[0] = 0;
    return;
  }
  // Mêlée : plus le pool est plein, plus la gerbe s'allège — tous les traits tant que la part libre dépasse
  // I.crowd, puis de moins en moins, et l'éclair seul à l'approche de la réserve (la gerbe n'y entre jamais).
  const room = (free - 1 - I.reserve) / (S_CAP * I.crowd - I.reserve);
  const n = room >= 1 ? I.sparks : Math.round(I.sparks * room);
  if (n <= 0) {
    ALLIE[0] = 0;
    return;
  }
  Q[OX] = x;
  Q[OY] = I.height;
  Q[OZ] = z;
  Q[OS] = 1;
  // la gerbe part dans le prolongement du tir, du joueur vers le robot
  Q[ODX] = x - P.x;
  Q[ODZ] = z - P.z;
  Q[OHALF] = I.coneDeg * 0.5 * DEG;
  burst(n, IMPACT_STYLE, row);
  ALLIE[0] = 0;
}

/** Coup arrêté par un bouclier : ricochet vers la source. (dirX, dirZ) : du robot vers la source, non normalisé. */
export function spawnShieldSpark(x, z, dirX, dirZ) {
  ARGF[F_X] = x;
  ARGF[F_Z] = z;
  ARGF[F_DX] = dirX;
  ARGF[F_DZ] = dirZ;
  spawnShieldSparkF();
}

/** spawnShieldSpark sans flottant en argument : position ARGF[F_X], ARGF[F_Z], direction ARGF[F_DX], ARGF[F_DZ]. */
export function spawnShieldSparkF() {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  const dirX = ARGF[F_DX];
  const dirZ = ARGF[F_DZ];
  if (!(x * 0 === 0 && z * 0 === 0)) return;
  const S = FX.shieldSpark;
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
  let nx = 0;
  let nz = 0;
  if (len > 1e-6 && len < Infinity) {
    nx = dirX / len;
    nz = dirZ / len;
  }
  shieldSparks++;
  const cx = x + nx * S.edge;
  const cz = z + nz * S.edge;
  Q[PX] = cx;
  Q[PY] = S.height;
  Q[PZ] = cz;
  Q[PW] = S.coreSize;
  pushCore(C_SHIELD, S);
  Q[OX] = cx;
  Q[OY] = S.height;
  Q[OZ] = cz;
  Q[ODX] = nx;
  Q[ODZ] = nz;
  Q[OS] = 1;
  Q[OHALF] = S.coneDeg * 0.5 * DEG;
  burst(S.sparks, SHIELD_STYLE, C_SHIELD);
}

/**
 * § E4.P : coup de face atténué par le bouclier d'un blindé — petite gerbe à la couleur d'acier du blindé, partie du
 * bord du bouclier côté source (BOUCLIER.impact) ; pas d'éclair central ni de ricochet blanc. Position ARGF[F_X],
 * ARGF[F_Z] (le robot), direction ARGF[F_DX], ARGF[F_DZ] (du robot vers la source).
 */
export function spawnShieldDampF() {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  const dirX = ARGF[F_DX];
  const dirZ = ARGF[F_DZ];
  if (!(x * 0 === 0 && z * 0 === 0)) return;
  const S = BOUCLIER.impact;
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
  let nx = 0;
  let nz = 0;
  if (len > 1e-6 && len < Infinity) {
    nx = dirX / len;
    nz = dirZ / len;
  }
  shieldDamps++;
  Q[OX] = x + nx * S.edge;
  Q[OY] = S.height;
  Q[OZ] = z + nz * S.edge;
  Q[ODX] = nx;
  Q[ODZ] = nz;
  Q[OS] = 1;
  Q[OHALF] = S.coneDeg * 0.5 * DEG;
  burst(S.sparks, DAMP_STYLE, C_ENEMY + ENEMY.BLINDE);
}

/**
 * § E4.P : le bouclier d'un blindé se fissure — BOUCLIER.fissure.eclats éclats low-poly à la couleur du type, depuis
 * (ARGF[F_X], ARGF[F_Z]) (le bouclier), projetés dans la direction (ARGF[F_DX], ARGF[F_DZ]).
 */
export function spawnShieldShardsF(enemyType) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  if (!(x * 0 === 0 && z * 0 === 0)) return;
  let t = enemyType | 0;
  if (t < 0 || t >= ENEMY_COUNT) t = 0;
  shieldCracks++;
  Q[OX] = x;
  Q[OY] = bodyY[t];
  Q[OZ] = z;
  Q[ODX] = ARGF[F_DX];
  Q[ODZ] = ARGF[F_DZ];
  Q[OS] = sizeMul[t];
  emitDebris(BOUCLIER.fissure.eclats, C_ENEMY + t);
}

/** Soin : anneau vert au sol et losanges qui montent. */
export function spawnHealPulse(x, z) {
  if (!(x * 0 === 0 && z * 0 === 0)) return;
  const H = FX.heal;
  healPulses++;
  Q[GX] = x;
  Q[GZ] = z;
  Q[GRAD] = H.ringRadius;
  Q[GLIFE] = H.ringSeconds;
  pushRing(C_HEAL);
  const o3 = C_HEAL * 3;
  for (let j = 0; j < H.sparks; j++) {
    const a = rand() * TWO_PI;
    const d = rand() * H.scatter;
    Q[PX] = x + Math.cos(a) * d;
    Q[PY] = H.height + rand() * 0.5;
    Q[PZ] = z + Math.sin(a) * d;
    Q[PVX] = 0;
    Q[PVY] = H.rise * (0.7 + 0.6 * rand());
    Q[PVZ] = 0;
    Q[PLIFE] = H.seconds * (0.7 + 0.3 * rand());
    Q[PW] = H.size;
    Q[PL] = H.size;
    Q[PROT] = rand() * TWO_PI;
    Q[PR] = COL[o3] * H.gain;
    Q[PG] = COL[o3 + 1] * H.gain;
    Q[PB] = COL[o3 + 2] * H.gain;
    pushSpark(K_PUFF);
  }
}

/**
 * § E4.K.3 — ramassage d'une grosse gemme ou d'un gros fragment : anneau au sol de la couleur reçue et quelques losanges
 * qui montent (pools existants). Position ARGF[F_X], ARGF[F_Z] (aucun flottant passé en argument, § V).
 */
export function spawnGrosButinF(colorHex) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  if (!(x * 0 === 0 && z * 0 === 0)) return;
  const K = GROS_BUTIN.eclat;
  render.writeColor(COL, C_TMP * 3, colorHex);
  grosButin++;
  Q[GX] = x;
  Q[GZ] = z;
  Q[GRAD] = K.anneau;
  Q[GLIFE] = K.secondes;
  pushRing(C_TMP);
  const o3 = C_TMP * 3;
  for (let j = 0; j < K.losanges; j++) {
    const a = rand() * TWO_PI;
    const d = rand() * K.dispersion;
    Q[PX] = x + Math.cos(a) * d;
    Q[PY] = K.hauteur + rand() * 0.5;
    Q[PZ] = z + Math.sin(a) * d;
    Q[PVX] = 0;
    Q[PVY] = K.montee * (0.7 + 0.6 * rand());
    Q[PVZ] = 0;
    Q[PLIFE] = K.vie * (0.7 + 0.3 * rand());
    Q[PW] = K.taille;
    Q[PL] = K.taille;
    Q[PROT] = rand() * TWO_PI;
    Q[PR] = COL[o3] * K.gain;
    Q[PG] = COL[o3 + 1] * K.gain;
    Q[PB] = COL[o3 + 2] * K.gain;
    pushSpark(K_PUFF);
  }
}

/**
 * § E4.Q.3 — disquette de Sauvegarde : kind 0 = chute (anneau large, losanges qui montent haut), 1 = ramassage (anneau
 * serré). Couleur de l'objet. Position ARGF[F_X], ARGF[F_Z] (aucun flottant passé en argument, § V).
 */
export function spawnSauvegardeF(kind) {
  const x = ARGF[F_X];
  const z = ARGF[F_Z];
  if (!(x * 0 === 0 && z * 0 === 0) || !(kind === 0 || kind === 1)) return;
  const K = SAUVEGARDE_BOSS.eclat[kind];
  render.writeColor(COL, C_TMP * 3, SAUVEGARDE_BOSS.couleur);
  sauvegardeEclats[kind]++;
  Q[GX] = x;
  Q[GZ] = z;
  Q[GRAD] = K.anneau;
  Q[GLIFE] = K.secondes;
  pushRing(C_TMP);
  const o3 = C_TMP * 3;
  for (let j = 0; j < K.losanges; j++) {
    const a = rand() * TWO_PI;
    const d = rand() * K.dispersion;
    Q[PX] = x + Math.cos(a) * d;
    Q[PY] = K.hauteur + rand() * 0.5;
    Q[PZ] = z + Math.sin(a) * d;
    Q[PVX] = 0;
    Q[PVY] = K.montee * (0.7 + 0.6 * rand());
    Q[PVZ] = 0;
    Q[PLIFE] = K.vie * (0.7 + 0.3 * rand());
    Q[PW] = K.taille;
    Q[PL] = K.taille;
    Q[PROT] = rand() * TWO_PI;
    Q[PR] = COL[o3] * K.gain;
    Q[PG] = COL[o3 + 1] * K.gain;
    Q[PB] = COL[o3 + 2] * K.gain;
    pushSpark(K_PUFF);
  }
}

/** Anneau au sol qui s'élargit jusqu'à radius (dash, pose du marchand, impulsion de l'EMP), de la couleur reçue. */
export function spawnRing(x, z, radius, colorHex, seconds = FX.ring.seconds) {
  if (!(x * 0 === 0 && z * 0 === 0) || !(radius > 0 && radius < 1e6)) return;
  render.writeColor(COL, C_TMP * 3, colorHex);
  Q[GX] = x;
  Q[GZ] = z;
  Q[GRAD] = radius;
  Q[GLIFE] = seconds > 0 && seconds < 1e3 ? seconds : FX.ring.seconds;
  pushRing(C_TMP);
}

/** Bouffée (traînée des roquettes), de la couleur reçue. */
export function spawnPuff(x, y, z, colorHex) {
  if (!(x * 0 === 0 && y * 0 === 0 && z * 0 === 0)) return;
  const F = FX.puff;
  render.writeColor(COL, C_TMP * 3, colorHex);
  puffs++;
  const o3 = C_TMP * 3;
  Q[PX] = x;
  Q[PY] = y;
  Q[PZ] = z;
  Q[PVX] = (rand() - 0.5) * 0.8;
  Q[PVY] = F.rise * (0.6 + 0.8 * rand());
  Q[PVZ] = (rand() - 0.5) * 0.8;
  Q[PLIFE] = F.seconds * (0.8 + 0.4 * rand());
  Q[PW] = F.size * 0.5 * (0.8 + 0.4 * rand()); // size = envergure : le rayon en est la moitié
  Q[PL] = Q[PW];
  Q[PROT] = rand() * TWO_PI;
  Q[PR] = COL[o3] * F.gain;
  Q[PG] = COL[o3 + 1] * F.gain;
  Q[PB] = COL[o3 + 2] * F.gain;
  pushSpark(K_PUFF);
}

/**
 * spawnPuff sans flottant en argument (§ V ; § E3.D : poussière de la foreuse, plusieurs par image) : position dans
 * ARGF[F_X], ARGF[F_V] (hauteur), ARGF[F_Z] ; colorHex entier.
 */
export function spawnPuffF(colorHex) {
  const x = ARGF[F_X];
  const y = ARGF[F_V];
  const z = ARGF[F_Z];
  if (!(x * 0 === 0 && y * 0 === 0 && z * 0 === 0)) return;
  const F = FX.puff;
  render.writeColor(COL, C_TMP * 3, colorHex);
  puffs++;
  const o3 = C_TMP * 3;
  Q[PX] = x;
  Q[PY] = y;
  Q[PZ] = z;
  Q[PVX] = (rand() - 0.5) * 0.8;
  Q[PVY] = F.rise * (0.6 + 0.8 * rand());
  Q[PVZ] = (rand() - 0.5) * 0.8;
  Q[PLIFE] = F.seconds * (0.8 + 0.4 * rand());
  Q[PW] = F.size * 0.5 * (0.8 + 0.4 * rand());
  Q[PL] = Q[PW];
  Q[PROT] = rand() * TWO_PI;
  Q[PR] = COL[o3] * F.gain;
  Q[PG] = COL[o3 + 1] * F.gain;
  Q[PB] = COL[o3 + 2] * F.gain;
  pushSpark(K_PUFF);
}

//#region e5:X8-lot8
// § E5.X8 (E9) : vapeur du boss en récupération — une bouffée comme spawnPuffF, plus grosse, plus longue et qui monte
// plus vite (LOT8.bossRecup) ; position dans ARGF[F_X], ARGF[F_V] (hauteur), ARGF[F_Z].
const VAP = new Float64Array([LOT8.bossRecup.vapeurTaille, LOT8.bossRecup.vapeurVie, LOT8.bossRecup.vapeurMontee]);
export function spawnVapeurF(colorHex) {
  const x = ARGF[F_X];
  const y = ARGF[F_V];
  const z = ARGF[F_Z];
  if (!(x * 0 === 0 && y * 0 === 0 && z * 0 === 0)) return;
  render.writeColor(COL, C_TMP * 3, colorHex);
  puffs++;
  const o3 = C_TMP * 3;
  Q[PX] = x;
  Q[PY] = y;
  Q[PZ] = z;
  Q[PVX] = (rand() - 0.5) * 0.6;
  Q[PVY] = VAP[2] * (0.7 + 0.6 * rand());
  Q[PVZ] = (rand() - 0.5) * 0.6;
  Q[PLIFE] = VAP[1] * (0.8 + 0.4 * rand());
  Q[PW] = VAP[0] * 0.5 * (0.8 + 0.4 * rand());
  Q[PL] = Q[PW];
  Q[PROT] = rand() * TWO_PI;
  Q[PR] = COL[o3] * FX.puff.gain;
  Q[PG] = COL[o3 + 1] * FX.puff.gain;
  Q[PB] = COL[o3 + 2] * FX.puff.gain;
  pushSpark(K_PUFF);
}
//#endregion e5:X8-lot8

/** Impact sur le joueur : gerbe rouge, anneau rouge à ses pieds, quelques éclats de sa carrosserie. */
export function playerHit(x, z, srcX = x, srcZ = z) {
  if (!(x * 0 === 0 && z * 0 === 0)) return;
  const H = FX.playerHit;
  // Intégration : damage.hitPlayer transmet la source du coup ; la gerbe part à l'opposé, sur un demi-cercle.
  // Source inconnue ou confondue avec le joueur : gerbe radiale, comme avant.
  let sdx = x - srcX;
  let sdz = z - srcZ;
  if (!(sdx * 0 === 0 && sdz * 0 === 0)) {
    sdx = 0;
    sdz = 0;
  }
  playerHits++;
  Q[GX] = x;
  Q[GZ] = z;
  Q[GRAD] = H.ringRadius;
  Q[GLIFE] = H.ringSeconds;
  pushRing(C_HURT);
  Q[OX] = x;
  Q[OY] = H.height;
  Q[OZ] = z;
  Q[ODX] = sdx;
  Q[ODZ] = sdz;
  Q[OS] = 1;
  Q[OHALF] = Math.PI * 0.5;
  burst(H.sparks, HURT_STYLE, C_HURT);
  Q[OY] = PLAYER.height * 0.5;
  Q[OS] = FX.debris.sizeMulMin;
  emitDebris(FX.debris.perPlayerHit, C_PLAYER);
}

// ----- Simulation (S12) : dt dans T[DT] ---------------------------------------------------------------------------------------------

function stepDebris() {
  const dt = T[DT];
  const F = FX.debris;
  const G = F.gravity;
  const bounce = F.bounce;
  const friction = F.friction;
  const rest = -F.restSpeed;
  const drag = Math.exp(-F.groundDrag * dt);
  const fall = 0.5 * G * dt * dt;
  for (let i = dCount - 1; i >= 0; i--) {
    const life = dLife[i] - dt;
    if (life <= 0) {
      const last = --dCount;
      if (i !== last) {
        dX[i] = dX[last];
        dY[i] = dY[last];
        dZ[i] = dZ[last];
        dVX[i] = dVX[last];
        dVY[i] = dVY[last];
        dVZ[i] = dVZ[last];
        dAngle[i] = dAngle[last];
        dSpin[i] = dSpin[last];
        dLife[i] = dLife[last];
        dMax[i] = dMax[last];
        dSize[i] = dSize[last];
        dPurge[i] = dPurge[last];
        dRobot[i] = dRobot[last]; // § E5.P (B1)
        const a = i * 3;
        const b = last * 3;
        dCol[a] = dCol[b];
        dCol[a + 1] = dCol[b + 1];
        dCol[a + 2] = dCol[b + 2];
      }
      continue;
    }
    dLife[i] = life;
    // Chute exacte pour une accélération constante : la trajectoire ne dépend pas de la cadence.
    let vx = dVX[i];
    let vz = dVZ[i];
    let vy = dVY[i];
    let y = dY[i] + vy * dt - fall;
    vy -= G * dt;
    const floor = dSize[i] * 0.35;
    if (y <= floor) {
      y = floor;
      if (vy < rest) {
        vy = -vy * bounce;
        vx *= friction;
        vz *= friction;
        dSpin[i] *= friction;
      } else {
        vy = 0;
        vx *= drag;
        vz *= drag;
        dSpin[i] *= drag;
      }
    }
    dX[i] += vx * dt;
    dY[i] = y;
    dZ[i] += vz * dt;
    dVX[i] = vx;
    dVY[i] = vy;
    dVZ[i] = vz;
    dAngle[i] += dSpin[i] * dt;
  }
}

function stepSparks() {
  const dt = T[DT];
  const S = FX.spark;
  const kStreak = Math.exp(-S.drag * dt);
  const kPuff = Math.exp(-S.puffDrag * dt);
  const g = S.gravity * dt;
  for (let i = sCount - 1; i >= 0; i--) {
    const life = sLife[i] - dt;
    if (life <= 0) {
      const last = --sCount;
      if (i !== last) {
        sX[i] = sX[last];
        sY[i] = sY[last];
        sZ[i] = sZ[last];
        sVX[i] = sVX[last];
        sVY[i] = sVY[last];
        sVZ[i] = sVZ[last];
        sLife[i] = sLife[last];
        sMax[i] = sMax[last];
        sW[i] = sW[last];
        sL[i] = sL[last];
        sRot[i] = sRot[last];
        sKind[i] = sKind[last];
        sAllie[i] = sAllie[last]; // § E5.P (B1)
        const a = i * 3;
        const b = last * 3;
        sCol[a] = sCol[b];
        sCol[a + 1] = sCol[b + 1];
        sCol[a + 2] = sCol[b + 2];
      }
      continue;
    }
    sLife[i] = life;
    const kind = sKind[i];
    if (kind === K_CORE) continue;
    let vy = sVY[i];
    if (kind === K_STREAK) {
      sVX[i] *= kStreak;
      sVZ[i] *= kStreak;
      vy -= g;
    } else {
      sVX[i] *= kPuff;
      sVZ[i] *= kPuff;
      vy *= kPuff;
    }
    sX[i] += sVX[i] * dt;
    sZ[i] += sVZ[i] * dt;
    let y = sY[i] + vy * dt;
    if (y < 0.05) {
      y = 0.05;
      vy = 0;
    }
    sY[i] = y;
    sVY[i] = vy;
  }
}

function stepRings() {
  const dt = T[DT];
  for (let i = rCount - 1; i >= 0; i--) {
    const life = rLife[i] - dt;
    if (life <= 0) {
      const last = --rCount;
      if (i !== last) {
        rX[i] = rX[last];
        rZ[i] = rZ[last];
        rRadius[i] = rRadius[last];
        rLife[i] = rLife[last];
        rMax[i] = rMax[last];
        rWidth[i] = rWidth[last];
        const a = i * 3;
        const b = last * 3;
        rCol[a] = rCol[b];
        rCol[a + 1] = rCol[b + 1];
        rCol[a + 2] = rCol[b + 2];
      }
      continue;
    }
    rLife[i] = life;
  }
}

function stepNumbers() {
  const dt = T[DT];
  const N = FX.numbers;
  const life = N.life;
  const rise = N.rise * dt; // la même pour tous, sans plafond : l'écart entre deux nombres ne change jamais
  for (let i = nCount - 1; i >= 0; i--) {
    const age = nAge[i] + dt;
    if (age >= life) {
      removeNumber(i);
      continue;
    }
    nAge[i] = age;
    nBorn[i] += dt;
    nPop[i] += dt;
    nLift[i] += rise;
  }
}

// ----- Écriture des instances (F11) : matrices en ligne, gabarits du § G.3 -----------------------------------------------------------

function syncDebris() {
  const m = dMat;
  const f = dFx;
  const F = FX.debris;
  const shrink = F.shrink;
  const flashInv = 1 / F.flashSeconds;
  const glow = F.voxel ? F.glow : 0;
  const purgeShrink = WAVES.purge.shrink;
  //#region e5:P-lisibilite-guide
  // § E5.P (B1) : rien sur le héros — taille × partFx près de son centre à l'écran (rampe de r0 à r1)
  const AU = LISIBILITE_GUIDE.autour;
  const au = AU.actif;
  const hx = P.x;
  const hy = AU_HY;
  const hz = P.z;
  const r0 = AU_R0;
  const r1 = AU_R1;
  const rInv = AU_INV;
  const part = AU_PART;
  const bx = BASIS[0];
  const bz = BASIS[2];
  const ux = BASIS[3];
  const uy = BASIS[4];
  const uz = BASIS[5];
  //#endregion e5:P-lisibilite-guide
  for (let i = 0; i < dCount; i++) {
    const k = dLife[i] / dMax[i];
    const sh = dPurge[i] === 1 ? purgeShrink : shrink;
    let u = k < sh ? (dSize[i] * k) / sh : dSize[i];
    if (au && dRobot[i] === 1) {
      // § E5.P (B1)
      const ex = (dX[i] - hx) * bx + (dZ[i] - hz) * bz;
      const ey = (dX[i] - hx) * ux + (dY[i] - hy) * uy + (dZ[i] - hz) * uz;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d < r1) u *= d <= r0 ? part : part + (1 - part) * (d - r0) * rInv;
    }
    const a = dAngle[i];
    const b = a * 1.7;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    const o = i * 16;
    // Ry(a) · Rx(b), échelle uniforme u
    m[o] = ca * u;
    m[o + 1] = 0;
    m[o + 2] = -sa * u;
    m[o + 3] = 0;
    m[o + 4] = sa * sb * u;
    m[o + 5] = cb * u;
    m[o + 6] = ca * sb * u;
    m[o + 7] = 0;
    m[o + 8] = sa * cb * u;
    m[o + 9] = -sb * u;
    m[o + 10] = ca * cb * u;
    m[o + 11] = 0;
    m[o + 12] = dX[i];
    m[o + 13] = dY[i];
    m[o + 14] = dZ[i];
    m[o + 15] = 1;
    const fl = 1 - (dMax[i] - dLife[i]) * flashInv; // blanc au départ, couleur du robot ensuite
    f[i * 2] = fl > 0 ? fl : 0;
    // voxels filaires : rougeoient tout de suite, plus fort en se dissolvant (0 hors carte mère) ; ceux de la purge
    // n'ont pas la lueur rouge de l'AGI : leur couleur d'instance (cyan × WAVES.purge.gain) suffit
    f[i * 2 + 1] = dPurge[i] === 1 ? 0 : glow * (0.7 + 0.3 * (1 - k));
  }
  render.commit(debrisMesh, dCount);
}

function syncSparks() {
  const m = sMat;
  // Décalage vers la caméra : même place à l'écran (projection orthographique), mais devant le robot touché.
  const bias = FX.spark.depthBias;
  const bx = BASIS[6] * bias;
  const by = BASIS[7] * bias;
  const bz = BASIS[8] * bias;
  //#region e5:P-lisibilite-guide
  // § E5.P (B1) : étincelles, blocs de feu et bouffées × partFx près du centre du héros à l'écran (rampe de r0 à r1)
  const AU = LISIBILITE_GUIDE.autour;
  const au = AU.actif;
  const hx = P.x;
  const hy = AU_HY;
  const hz = P.z;
  const r0 = AU_R0;
  const r1 = AU_R1;
  const rInv = AU_INV;
  const part = AU_PART;
  const ex0 = BASIS[0];
  const ez0 = BASIS[2];
  const ux = BASIS[3];
  const uy = BASIS[4];
  const uz = BASIS[5];
  //#endregion e5:P-lisibilite-guide
  for (let i = 0; i < sCount; i++) {
    const k = sLife[i] / sMax[i]; // 1 → 0
    const kind = sKind[i];
    const rot = sRot[i];
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    let w = sW[i] * tailleLook;
    let l = w;
    if (kind === K_STREAK) {
      w *= 0.35 + 0.65 * k;
      l = sL[i] * tailleLook * (0.25 + 0.75 * k);
    } else if (kind === K_PUFF) {
      const t = 1 - k;
      w *= t < 0.2 ? 0.55 + 2.25 * t : k * 1.25; // gonfle vite, puis rétrécit jusqu'à rien
      l = w;
    } else {
      w *= Math.sqrt(k); // éclair : plein tout de suite, s'effondre à la fin
      l = w;
    }
    if (au && sAllie[i] === 1) {
      // § E5.P (B1)
      const ex = (sX[i] - hx) * ex0 + (sZ[i] - hz) * ez0;
      const ey = (sX[i] - hx) * ux + (sY[i] - hy) * uy + (sZ[i] - hz) * uz;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d < r1) {
        const a = d <= r0 ? part : part + (1 - part) * (d - r0) * rInv;
        w *= a;
        l *= a;
      }
    }
    const o = i * 16;
    m[o] = c * w;
    m[o + 1] = 0;
    m[o + 2] = -s * w;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = w;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = s * l;
    m[o + 9] = 0;
    m[o + 10] = c * l;
    m[o + 11] = 0;
    m[o + 12] = sX[i] + bx;
    m[o + 13] = sY[i] + by;
    m[o + 14] = sZ[i] + bz;
    m[o + 15] = 1;
  }
  render.commit(sparkMesh, sCount);
}

function syncRings() {
  const m = rMat;
  const R = FX.ring;
  const start = R.startRadius;
  for (let i = 0; i < rCount; i++) {
    const life = rLife[i];
    const max = rMax[i];
    let radius = 0;
    let sy = 1;
    if (life <= max) {
      const e = life / max; // 1 → 0
      const target = rRadius[i];
      const w0 = rWidth[i] > 0 ? rWidth[i] : R.width + R.widthPerRadius * target;
      const th = w0 * Math.pow(e, R.thinning); // épaisseur du trait au sol : s'amincit jusqu'à rien
      if (th > RING_TH_MIN) {
        radius = target * (start + (1 - start) * (1 - e * e * e)); // part vite, se pose au rayon final
        let visible = th / (radius * RING_BAND);
        if (visible > RING_F_MAX) visible = RING_F_MAX;
        sy = RING_Y / visible;
      }
    }
    const o = i * 16;
    m[o] = radius;
    m[o + 1] = 0;
    m[o + 2] = 0;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = sy;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = 0;
    m[o + 9] = 0;
    m[o + 10] = radius;
    m[o + 11] = 0;
    m[o + 12] = rX[i];
    m[o + 13] = RING_Y;
    m[o + 14] = rZ[i];
    m[o + 15] = 1;
  }
  render.commit(ringMesh, rCount);
}

function syncNumbers() {
  const m = nMat;
  const col = nCol;
  const N = FX.numbers;
  const rx = BASIS[0];
  const rz = BASIS[2];
  const ux = BASIS[3];
  const uy = BASIS[4];
  const uz = BASIS[5];
  const dx = BASIS[6];
  const dy = BASIS[7];
  const dz = BASIS[8];
  const popInv = 1 / N.popSeconds;
  const fadeInv = 1 / N.fadeSeconds;
  const maxValue = N.maxValue;
  // § E5.AB.12 : œil de la caméra (perspective du mode Souris)
  const persp = camMod !== null && camMod.view.persp === 1 ? 1 : 0;
  const cpos = persp === 1 ? camMod.threeCamera.position : null;
  const eyeX = persp === 1 ? cpos.x : 0;
  const eyeY = persp === 1 ? cpos.y : 0;
  const eyeZ = persp === 1 ? cpos.z : 0;
  //#region e5:P-lisibilite-guide
  // § E5.P (B1) : un chiffre que le héros a rejoint (il s'est déplacé sous lui) rétrécit à partFx près de son centre —
  // distance du centre du héros au bord de la boîte du chiffre, à l'écran
  const AU = LISIBILITE_GUIDE.autour;
  const au = AU.actif;
  const hsx = P.x * rx + P.z * rz;
  const hsy = P.x * ux + P.z * uz + AU_HY * uy;
  const r0 = AU_R0;
  const r1 = AU_R1;
  const rInv = AU_INV;
  const part = AU_PART;
  //#endregion e5:P-lisibilite-guide
  let q = 0; // instances écrites = segments allumés
  for (let i = 0; i < nCount && q < N_INST; i++) {
    const age = nAge[i];
    let s = nCrit[i] === 1 ? N.size * N.critScale : N.size;
    if (nPop[i] < N.popSeconds) {
      const k = 1 - nPop[i] * popInv;
      s *= 1 + nPopAmp[i] * k * k;
    }
    const left = N.life - age;
    if (left < N.fadeSeconds) s *= left * fadeInv;
    // Chiffres par divisions entières : aucune chaîne.
    let v = Math.round(nValue[i]);
    if (v < 1) v = 1;
    else if (v > maxValue) v = maxValue;
    let digits = 1;
    for (let p = 10; v >= p && digits < GLYPHS; p *= 10) digits++;
    const plus = nCrit[i] === 2 ? 1 : 0; // § E5.Q (B14) : un chiffre de soin s'écrit « +N » (glyphe de plus, à gauche)
    const wNum = LARG[codeLargeur(v)]; // chiffres proportionnels : le « 1 » est étroit
    const wAll = wNum + plus * (GLYPH_W + N.spacing); // avec le « + » d'un soin, à gauche
    const lift = nLift[i];
    if (au && nCrit[i] !== 2) {
      // § E5.P (B1) — boîte de base (sans sursaut ni fondu)
      const b = nCrit[i] === 1 ? N.size * N.critScale : N.size;
      let qx = nX[i] * rx + nZ[i] * rz - hsx;
      let qy = nX[i] * ux + nZ[i] * uz + lift + N.height * uy - hsy;
      qx = (qx < 0 ? -qx : qx) - wNum * 0.5 * b;
      qy = (qy < 0 ? -qy : qy) - b * 0.5;
      if (qx < 0) qx = 0;
      if (qy < 0) qy = 0;
      const d = Math.sqrt(qx * qx + qy * qy);
      if (d < r1) s *= d <= r0 ? part : part + (1 - part) * (d - r0) * rInv;
    }
    let px = nX[i] + ux * lift + dx * NUMBER_BIAS;
    let py = N.height + uy * lift + dy * NUMBER_BIAS;
    let pz = nZ[i] + uz * lift + dz * NUMBER_BIAS;
    //#region e5:AB-camera-3p
    if (persp === 1) {
      const bx = nX[i] + ux * lift;
      const by = N.height + uy * lift;
      const bz = nZ[i] + uz * lift;
      px = bx + (eyeX - bx) * NUMBER_PERSP;
      py = by + (eyeY - by) * NUMBER_PERSP;
      pz = bz + (eyeZ - bz) * NUMBER_PERSP;
      s *= 1 - NUMBER_PERSP;
    }
    //#endregion e5:AB-camera-3p
    const rsx = rx * s;
    const rsz = rz * s;
    const usx = ux * s;
    const usy = uy * s;
    const usz = uz * s;
    const cr = nR[i];
    const cg = nG[i];
    const cb = nB[i];
    //#region e5:Q-retours-guide
    // « + » : deux traits croisés au premier rang du nombre, un peu plus longs (PLUS_L) et plus fins (PLUS_E) qu'un
    // segment de chiffre — de même taille, leurs pointes faisaient un losange à l'écran
    for (let k = 0; k < 2 * plus && q < N_INST; k++) {
      const ox = (GLYPH_W - wAll) * 0.5; // centre du premier rang
      const o = q * 16;
      if (k === 1) {
        m[o] = usx * PLUS_L;
        m[o + 1] = usy * PLUS_L;
        m[o + 2] = usz * PLUS_L;
        m[o + 4] = -rsx * PLUS_E;
        m[o + 5] = 0;
        m[o + 6] = -rsz * PLUS_E;
      } else {
        m[o] = rsx * PLUS_L;
        m[o + 1] = 0;
        m[o + 2] = rsz * PLUS_L;
        m[o + 4] = usx * PLUS_E;
        m[o + 5] = usy * PLUS_E;
        m[o + 6] = usz * PLUS_E;
      }
      m[o + 3] = 0;
      m[o + 7] = 0;
      m[o + 8] = dx * s;
      m[o + 9] = dy * s;
      m[o + 10] = dz * s;
      m[o + 11] = 0;
      m[o + 12] = px + rsx * ox;
      m[o + 13] = py;
      m[o + 14] = pz + rsz * ox;
      m[o + 15] = 1;
      const c = q * 3;
      col[c] = cr;
      col[c + 1] = cg;
      col[c + 2] = cb;
      q++;
    }
    //#endregion e5:Q-retours-guide
    let xr = wAll * 0.5; // bord droit du chiffre suivant (de droite à gauche), nombre centré
    for (let j = digits - 1; j >= 0 && q < N_INST; j--) {
      const dg = v % 10;
      const mask = SEG_MASK[dg];
      v = (v / 10) | 0;
      const w = dg === 1 ? ONE_W : GLYPH_W;
      const gx = xr - w * 0.5 + (dg === 1 ? ONE_DX : 0); // centre de la case (§ E5.Q : après le « + ») ; le 1 recentré
      xr -= w + N.spacing;
      // montants à joindre : b et c allumés sans g (bit 1 : droite), e et f allumés sans g (bit 2 : gauche)
      const joins = ((mask & 0x46) === 0x06 ? 1 : 0) | ((mask & 0x70) === 0x30 ? 2 : 0);
      for (let k = 0; k < SEGS && q < N_INST; k++) {
        if ((mask & (1 << k)) === 0) continue;
        const ox = gx + SEG_OX[k];
        let oy = SEG_OY[k];
        const o = q * 16;
        if (SEG_VERT[k] === 1) {
          // segment vertical : son axe suit le haut de l'écran
          let along = 1;
          if ((joins & SEG_SIDE[k]) !== 0) {
            along = SEG_JOIN_K;
            oy += oy > 0 ? -SEG_JOIN * 0.5 : SEG_JOIN * 0.5;
          }
          m[o] = usx * along;
          m[o + 1] = usy * along;
          m[o + 2] = usz * along;
          m[o + 4] = -rsx;
          m[o + 5] = 0;
          m[o + 6] = -rsz;
        } else {
          m[o] = rsx;
          m[o + 1] = 0;
          m[o + 2] = rsz;
          m[o + 4] = usx;
          m[o + 5] = usy;
          m[o + 6] = usz;
        }
        m[o + 3] = 0;
        m[o + 7] = 0;
        m[o + 8] = dx * s;
        m[o + 9] = dy * s;
        m[o + 10] = dz * s;
        m[o + 11] = 0;
        m[o + 12] = px + rsx * ox + usx * oy;
        m[o + 13] = py + usy * oy;
        m[o + 14] = pz + rsz * ox + usz * oy;
        m[o + 15] = 1;
        const c = q * 3;
        col[c] = cr;
        col[c + 1] = cg;
        col[c + 2] = cb;
        q++;
      }
    }
  }
  nSegments = q;
  render.commit(numberMesh, q);
}

// ----- Debug ------------------------------------------------------------------------------------------------------------------------

/**
 * Part du snapshot (§ S) : timeScale, hitstopLeft, hitstops, edgeFlash, pools. Le lot y AJOUTE de quoi mesurer
 * chaque effet (le contrat autorise l'ajout de champs) : compteurs depuis le chargement, segments allumés, contenu
 * des pools lu dans les tampons réellement envoyés au GPU, réglages des maillages.
 */
//#region e5:P-lisibilite-guide
/** § E5.P (tests, hors chemin chaud) : compteurs du lot — chiffres masqués / remplacés, éclats réduits / plafonnés, taux de morts. */
export function lisibilite() {
  return {
    chiffresMasques,
    chiffresRemplaces,
    eclatsReduits,
    eclatsPlafond,
    eclats: dCount,
    mortsParSeconde: T[MORTS] / LISIBILITE_GUIDE.eclats.fenetre,
  };
}
//#endregion e5:P-lisibilite-guide

export function inspect(out) {
  out.timeScale = T[HITSTOP_LEFT] > 0 ? 0 : 1;
  out.hitstopLeft = T[HITSTOP_LEFT];
  out.hitstops = hitstops;
  out.edgeFlash = T[EDGE];
  out.pools = {
    debris: { used: dCount, cap: D_CAP },
    numbers: { used: nCount, cap: N_CAP },
    sparks: { used: sCount, cap: S_CAP },
    rings: { used: rCount, cap: R_CAP },
  };
  out.segments = nSegments;
  out.counts = {
    debris: debrisTotal,
    purge: purgeTotal, // voxels de purge de fin de vague (§ E1.A), comptés à part des éclats
    sparks: sparksTotal,
    rings: ringsTotal,
    numbers: numbersTotal,
    merges,
    fused,
    replaced,
    recycled,
    explosions,
    impacts,
    shieldSparks,
    shieldDamps,
    shieldCracks,
    healPulses,
    grosButin,
    sauvegardeChute: sauvegardeEclats[0], // § E4.Q
    sauvegardePrise: sauvegardeEclats[1],
    playerHits,
    puffs,
    dropped,
    shed,
  };
  if (debrisMesh === null) return;
  const LIST_MAX = 96;
  out.numbersList = [];
  for (let i = 0; i < nCount; i++) {
    out.numbersList.push({ x: nX[i], z: nZ[i], value: nValue[i], critValue: nCritV[i], crit: nCrit[i] === 1, soin: nCrit[i] === 2, age: nAge[i], born: nBorn[i], lift: nLift[i], pop: nPop[i], color: [nR[i], nG[i], nB[i]] });
  }
  out.debrisList = [];
  for (let i = 0; i < dCount && i < LIST_MAX; i++) {
    // shown, axis : lus dans la matrice d'instance écrite au dernier sync (échelle affichée, premier axe du repère)
    const o = i * 16;
    const shown = Math.hypot(dMat[o], dMat[o + 1], dMat[o + 2]);
    out.debrisList.push({ x: dX[i], y: dY[i], z: dZ[i], vx: dVX[i], vy: dVY[i], vz: dVZ[i], size: dSize[i], life: dLife[i], max: dMax[i], spin: dSpin[i], shown, axis: shown > 0 ? [dMat[o] / shown, dMat[o + 2] / shown] : [0, 0], color: [dCol[i * 3], dCol[i * 3 + 1], dCol[i * 3 + 2]] });
  }
  out.sparksList = [];
  for (let i = 0; i < sCount; i++) {
    out.sparksList.push({ kind: sKind[i], x: sX[i], y: sY[i], z: sZ[i], vx: sVX[i], vz: sVZ[i], life: sLife[i], size: sW[i], color: [sCol[i * 3], sCol[i * 3 + 1], sCol[i * 3 + 2]] });
  }
  out.ringsList = [];
  for (let i = 0; i < rCount; i++) {
    out.ringsList.push({ x: rX[i], y: rMat[i * 16 + 13], z: rZ[i], radius: rRadius[i], shown: rMat[i * 16], life: rLife[i], seconds: rMax[i], color: [rCol[i * 3], rCol[i * 3 + 1], rCol[i * 3 + 2]] });
  }
  out.meshes = {
    debris: describe(debrisMesh),
    sparks: describe(sparkMesh),
    rings: describe(ringMesh),
    numbers: describe(numberMesh),
  };
}

function describe(mesh) {
  const mat = mesh.material;
  return {
    name: mesh.name,
    count: mesh.count,
    visible: mesh.visible,
    capacity: mesh.instanceMatrix.count,
    renderOrder: mesh.renderOrder,
    instanceColor: mesh.instanceColor !== null,
    transparent: mat.transparent,
    depthWrite: mat.depthWrite,
    depthTest: mat.depthTest,
    lit: mat.isMeshLambertMaterial === true,
    map: mat.map !== null && mat.map !== undefined,
    frustumCulled: mesh.frustumCulled,
  };
}
