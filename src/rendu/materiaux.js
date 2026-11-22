// RENDU « PEINT » — matériau éclairé des unités et du décor (prototype, passe 2 du 13/11/2026, brief docs/da-clash.md).
//
// Même contrat que render.createLitMaterial (ARCHITECTURE.md § G.2) : MeshLambertMaterial modifié par
// onBeforeCompile, couleurs de sommet (COLOR_0 des modèles Blender : couleur × AO cuite × dégradé), attribut de
// sommet aEmissive, attribut d'instance aFx (flash blanc, lueur), uniforme uFx, uniformes uGlowColor, uEmissiveBoost,
// uFlashEmissive dans material.userData.uniforms. Les insertions du flash et de l'émissif sont les MÊMES chaînes que
// render.js : seul l'éclairage change (remplacement de lights_fragment_begin / maps / end).
//
// Éclairage, par fragment :
//   albédo   = couleur de sommet « étalonnée » par le PROFIL du matériau (multiplicateur de base, saturation) : les
//              modèles Blender gardent leurs couleurs, le rendu les pousse (acier bleu-gris profond pour les robots,
//              plaques plus chaudes pour le héros) ; le flash blanc n'est pas étalonné
//   direct   = albédo × soleil × wrap(N·L) × min(ombre temps réel, ombre statique du décor)
//   ambiant  = albédo × hémisphère ciel/sol (× profil) + voile AJOUTÉ là où le soleil manque, de la couleur du profil
//              (passe 3 : brun chaud sur le décor, bleuté sur le sable et les unités)
//   textures = map, normalMap, aoMap des .glb (appliquerTextures) ; sans texture, les couleurs de sommet seules
//   bords    = liseré de contour (Fresnel) de la couleur du profil : froid et discret sur le décor, cyan sur le héros
//   métal    = spéculaire Blinn × métal du profil, seulement au soleil : les biseaux clairs attrapent la lumière
// Les ombres ne descendent jamais au noir : il reste le ciel bleu et le voile violet.
//
// PROFILS (PEINT.profils) : constantes de COMPILATION (#define), un programme par profil. Rien de propre au matériau
// n'est donc envoyé au GPU à chaque appel de dessin (mesure de la passe 1 : les uniformes qui changent d'un appel à
// l'autre font allouer three). Profils : objet, robot, boss, heros, decor, sol.
// Essai mesuré (tests/rendu-alloc.mjs, passe 2) : profils en uniformes et UN seul programme → three alloue PLUS
// (7,5 à 7,8 Ko par image contre 6,1 à 7,3) : les uniformes de profil changent à chaque bascule de matériau. Gardé :
// un programme par profil.
//
// Ombres : srOmbre() lit la carte du soleil (même format RGBA que three r170) en 1 prise bilinéaire (4 lectures) ou
// 4 prises (16 lectures), au choix de la qualité (uniforme). srOmbreStatique() lit une carte calculée UNE fois pour
// tout le décor (rochers, falaises, carcasses : ombre-statique.js) : le décor ne repasse plus dans la carte du soleil
// à chaque image. Ce module ne fait que des matériaux, à l'init.
import * as THREE from 'three';
import { RENDER } from '../config.js';
import { PEINT } from './reglages.js';

// ----- Insertions du contrat § G.2 (copie exacte de render.js : le flash et l'émissif ne changent pas) -------------
const LIT_VERT_PARS = `#include <common>
attribute vec2 aFx; attribute float aEmissive; uniform vec2 uFx; varying vec2 vFx; varying float vEmissive;`;
const LIT_VERT_MAIN = `#include <color_vertex>
vFx = clamp( aFx + uFx, 0.0, 1.0 ); vEmissive = aEmissive;`;
const LIT_FRAG_PARS = `#include <common>
uniform vec3 uGlowColor; uniform float uEmissiveBoost; uniform float uFlashEmissive; varying vec2 vFx; varying float vEmissive;`;
const LIT_FRAG_COLOR = `
vec3 srBase = diffuseColor.rgb; diffuseColor.rgb = mix( diffuseColor.rgb * ( 1.0 - vEmissive ), vec3( 1.0 ), vFx.x );`;
// Armes bakées du héros (appliquerTexturesArmes) : la couleur de l'image REMPLACE la couleur de sommet là où aTex = 1
// (ailleurs, couleur de sommet seule : l'image n'est même pas multipliée), et le relief de l'image n'y perturbe que ces
// faces. Sans le #define TEX_ARMES, ces morceaux ne sont pas compilés.
const TEX_VERT_PARS = `
#ifdef TEX_ARMES
attribute float aTex; varying float vTex;
#endif`;
const TEX_VERT_MAIN = `
#ifdef TEX_ARMES
vTex = aTex;
#endif`;
// Modèles ALLÉGÉS À TEXTURE CUITE (17/11/2026, outils/blender/cuire_modele.py ; appliquerTexturesModele) : en plus
// (#define TEX_LUEURS), l'alpha de l'image porte le masque des lueurs (A = 1 − 0,5 × masque) — là où il vaut 1, le texel
// est émissif comme un sommet aEmissive = 1 (yeux, fentes, bandes rouges sans faces à elles). vEmissive est relayé par
// srEmiT pour la suite du shader (varying en lecture seule) ; le profil du matériau s'applique à l'image comme aux
// couleurs de sommet (pas de retrait de la dominante, contrairement aux armes du héros).
const TEX_FRAG_PARS = `
#ifdef TEX_ARMES
varying float vTex;
#endif
#ifdef TEX_LUEURS
float srEmiT;
#endif`;
const TEX_FRAG_MAP = `
#ifdef TEX_ARMES
vec4 srTexArmes = texture2D( map, vMapUv );
#ifdef TEX_LUEURS
srEmiT = max( vEmissive, clamp( ( 1.0 - srTexArmes.a ) * 2.0, 0.0, 1.0 ) * vTex );
#define vEmissive srEmiT
#endif
#else
#include <map_fragment>
#endif`;
const TEX_FRAG_COLOR = `
#ifdef TEX_ARMES
diffuseColor.rgb = mix( diffuseColor.rgb, srTexArmes.rgb, vTex );
#endif`;
const TEX_FRAG_NORMAL = `
#ifdef TEX_ARMES
vec3 srNormal0 = normal;
#endif
#include <normal_fragment_maps>
#ifdef TEX_ARMES
normal = normalize( mix( srNormal0, normal, vTex ) );
#endif`;
const LIT_FRAG_EMISSIVE = `#include <emissivemap_fragment>
totalEmissiveRadiance += srBase * vEmissive * uEmissiveBoost * ( 1.0 - vFx.x ) + vec3( uFlashEmissive * vFx.x ) + uGlowColor * vFx.y;`;

// ----- Uniformes partagés (valeurs constantes en jeu : envoyées une fois par programme, puis gardées en cache) -------
const lin = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const S = PEINT.sol;
const K = PEINT.carte;
const CARTE = PEINT.theme === 'carte-mere';
const Q0 = PEINT.qualite[0];
export const uniformsPeints = {
  // x : wrap, y : force du spéculaire, z : puissance du spéculaire,
  // w : niveau de la lumière d'ambiance (1 = normal ; événement « panne de courant », § E1.C : 0,25). Il multiplie le
  // soleil, le ciel, le voile d'ombre et le liseré — PAS les émissifs, ni le flash, ni les lumières ponctuelles des
  // explosions : yeux, tirs, accents du héros gardent leur éclat. Posé par setLumiere(), une valeur d'uniforme : aucun
  // shader recompilé.
  uSrLum: { value: new THREE.Vector4(PEINT.wrap, PEINT.speculaire.force, PEINT.speculaire.puissance, 1) },
  // x : 4 prises d'ombre ?, y : écart des prises (texels), z : grain du sol, w : demi-côté de l'arène
  uSrQual: { value: new THREE.Vector4(Q0.filtrage, Q0.douceur, Q0.detail, 60) },
  // passe 4 : x part du blanc au cœur des émissifs, y gain du cœur, z actif (1) — constant en jeu
  uSrGlow: { value: new THREE.Vector4(PEINT.emissifCoeur.blanc, PEINT.emissifCoeur.gain, 1, 0) },
  // passe 5 : x toon doux (0/1), y force des ombres de nuages, z échelle des nuages (1/m), w détail du sol (0/1)
  uSrStyle: { value: new THREE.Vector4(0, PEINT.nuages.force, PEINT.nuages.echelle, 1) },
  // Plan de routage cuit sous Blender (branche carte-blender, outils/blender/decor/plan_carte.py) : textures du plan
  // (R piste / bus alimenté, G or, B sérigraphie / trou), de l'occlusion du décor, du processeur central (couleur,
  // émissif). Lues seulement par le sol du jeu (define SR_PLAN) ; posées par world.preload.
  uSrPlanTex: { value: null },
  uSrPlanAo: { value: null },
  uSrCpuTex: { value: null },
  uSrCpuEmi: { value: null },
  // x force du plan, y part GARDÉE du sol procédural (pistes, vias, sérigraphie), z force de l'occlusion, w emprise (m)
  uSrPlanMix: { value: new THREE.Vector4(1, 1, 0, 64) },
  // impulsion d'énergie du début de vague : x rayon du front (m), y largeur (m), z gain du front, w gain de la traîne
  uSrPulse: { value: new THREE.Vector4(-100, 3, 0, 0) },
  uSrEnergie: { value: new THREE.Color(1, 1, 1) },
  uSrPulse2: { value: 0.65 }, // opacité des pistes cuites
  uSrBruitE: { value: new THREE.Vector3(0.32, 0.3, 0.06) }, // bruit fractal de l'énergie : échelle, plancher, dérive
  // processeur central : x demi-côté du substrat (m), y emprise de sa texture (m), z gain de couleur, w émissif (gain)
  uSrCpu: { value: new THREE.Vector4(5.5, 6, 1, 0) },
  // Matérialisation du héros sur le processeur (carte-blender) : x hauteur MONDE du front (m), y actif (0/1), z demi-épaisseur
  // de la ligne (m), w longueur de la traîne (m) ; couleur = accent de l'agent (world.materialiser / world.update)
  uSrRevele: { value: new THREE.Vector4(0, 0, 0.05, 0.5) },
  uSrReveleCouleur: { value: new THREE.Color(0, 1, 1) },
  uSrNuage: { value: new THREE.Vector2(0, 0) }, // décalage des nuages (m), avancé à chaque image
  // branche look-cel (PEINT.cel, posé par appliquerCelMateriaux) : x paliers du soleil (0 = éclairage d'origine),
  // y douceur de la transition, z aplat du ciel (0..1), w force du liseré dur ; uSrCelBord = couleur (rgb) + seuil (w)
  uSrCel: { value: new THREE.Vector4(0, 0.04, 0, 0) },
  uSrCelBord: { value: new THREE.Vector4(1, 0.9, 0.88, 0.62) },
  uSrCelSol: { value: 1 }, // look-cel : gain de l'albédo du sol (< 1 : arène sombre, persos détachés)
  uSrSableRouge: { value: lin(PEINT.sol.sableRouge) },
  uSrSablePale: { value: lin(PEINT.sol.sablePale) },
  uSrChemin: { value: lin(PEINT.sol.chemin) },
  // ombre statique du décor (ombre-statique.js) : carte et matrice monde → carte, constantes après l'init
  uSrStatMap: { value: null },
  uSrStatMat: { value: new THREE.Matrix4() },
  uSrStatSize: { value: new THREE.Vector2(1, 1) },
  // sol
  uSrSable: { value: lin(S.sable) },
  uSrSableClair: { value: lin(S.sableClair) },
  uSrSableOmbre: { value: lin(S.sableOmbre) },
  uSrRoche: { value: lin(S.roche) },
  uSrRochePied: { value: lin(S.rochePied) },
  // carte mère (SR_CARTE) : teintes du circuit, x pas des voies, y demi-largeur des pistes, z rayon des vias, w côté des blocs
  uSrPcbVernis: { value: lin(K.vernis) },
  uSrPcbClair: { value: lin(K.vernisClair) },
  uSrPcbSombre: { value: lin(K.vernisSombre) },
  uSrPcbPiste: { value: lin(K.piste) },
  uSrPcbOr: { value: lin(K.or) },
  uSrPcbTrou: { value: lin(K.trou) },
  uSrPcbSeri: { value: lin(K.serigraphie) },
  uSrPcbDehors: { value: lin(K.dehors) },
  uSrPcbGeo: { value: new THREE.Vector4(K.voie, K.largeurPiste / 2, K.via, K.bloc) },
  uSrPcbBus: { value: new THREE.Vector3(K.bus.periode, K.bus.pistes, K.bus.pas) },
  // alimentation au-delà des murs : couleur des pistes (or), couleur × gain des impulsions
  uSrPcbAlim: { value: lin(K.alimentation.couleur) },
  uSrPcbImp: { value: lin(K.alimentation.impulsion, K.alimentation.gain) },
  // branche carte-retouche : part gardée des détails (pistes, vias, sérigraphie, plans de masse), émissif des bus,
  // grille fine (x pas m, y demi-largeur m, z force)
  uSrPcbDetail: { value: new THREE.Vector4(K.detail.pistes, K.detail.vias, K.detail.seri, K.detail.plan) },
  uSrPcbLueur: { value: lin(K.lueur.couleur, K.lueur.gain) },
  uSrPcbGrille: { value: new THREE.Vector3(K.grille.pas, K.grille.largeur, K.grille.force) },
  // halo doux autour du héros (sol seulement) : x, z du héros (world.update), rayon (m), force ; teinte ; part de
  // lumière gardée loin du héros
  uSrHalo: { value: new THREE.Vector4(0, 0, K.halo.rayon, K.halo.force) },
  uSrHaloTeinte: { value: lin(K.halo.teinte) },
  uSrHaloLoin: { value: K.halo.loin },
  uSrSolEchelles: { value: new THREE.Vector3(S.echelles[0], S.echelles[1], S.echelles[2]) },
  // Vraies lumières des grands moments (lumieres.js) — intégration : en uniformes du MONDE, plus en PointLight de three.
  // Les lumières de three sont envoyées dans le repère de la vue : chaque pas de caméra renvoyait leurs 6 positions à
  // chaque programme (~2 Ko alloués par image dans three, mesuré). Ici une lumière au repos ne change pas : rien n'est
  // renvoyé. pos = (x, y, z, portée), col = (couleur × intensité, décroissance) ; même atténuation que three r170.
  // Données des lumières dans une petite TEXTURE (lumieres.js l'écrit, une fois par image et seulement si elles ont
  // changé) : envoyée UNE fois, quel que soit le nombre de programmes. Mesuré (scène D de
  // tests/integration-allocations.mjs) : en 12 vec4, 6,1 Ko alloués par image dans setValueV4f ; en deux mat4, 6,6 Ko
  // dans setValueM4 — three renvoie un uniforme qui a changé à CHAQUE programme qui le lit.
  // Colonne k = lumière k ; ligne 0 = (x, y, z, portée), ligne 1 = (couleur × intensité, décroissance).
  uSrPtTex: { value: null },
};
{
  const n = Math.max(1, PEINT.lumieres.nombre);
  const t = new THREE.DataTexture(new Float32Array(n * 2 * 4), n, 2, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.name = 'SurvivorLumieres';
  for (let i = 0; i < n; i++) {
    t.image.data[i * 4 + 1] = -50; // repos : sous le sol, couleur nulle
    t.image.data[i * 4 + 3] = PEINT.lumieres.portee;
    t.image.data[(n + i) * 4 + 3] = PEINT.lumieres.decroissance;
  }
  t.needsUpdate = true;
  uniformsPeints.uSrPtTex.value = t;
}
/** Vraies lumières : appels déroulés (lumière k = colonne k de uSrPtTex). */
let ptCorps = '';
for (let i = 0; i < PEINT.lumieres.nombre; i++) {
  ptCorps += `\n  srPointLumiere( texelFetch( uSrPtTex, ivec2( ${i}, 0 ), 0 ), texelFetch( uSrPtTex, ivec2( ${i}, 1 ), 0 ), vSrW, srAlb, srN, reflectedLight.directDiffuse );`;
}
let statique = false; // une carte statique est fournie : les programmes compilés ensuite la lisent

/** Niveau de la lumière d'ambiance (uSrLum.w) : 1 = normal. Uniforme seulement, aucune recompilation (§ E1.C). */
export function setLumiere(k) {
  uniformsPeints.uSrLum.value.w = k;
}

/** Qualité adaptative : filtrage des ombres et grain du sol (uniformes seulement, aucune recompilation). */
export function setQualite(q) {
  const v = uniformsPeints.uSrQual.value;
  v.x = q.filtrage;
  v.y = q.douceur;
  v.z = q.detail;
}

/**
 * Branche look-cel : réglages « matériaux » d'une variante de PEINT.cel (objet, voir config.js). Une valeur
 * d'uniforme partagée par tous les programmes peints : aucun shader recompilé.
 */
export function appliquerCelMateriaux(o = {}) {
  const c = new THREE.Color(o.bordCouleur === undefined ? 0xffe6e0 : o.bordCouleur);
  uniformsPeints.uSrCel.value.set(o.paliers || 0, o.douceur === undefined ? 0.04 : o.douceur, o.aplat || 0, o.bord || 0);
  uniformsPeints.uSrCelBord.value.set(c.r, c.g, c.b, o.bordSeuil === undefined ? 0.62 : o.bordSeuil);
  uniformsPeints.uSrCelSol.value = o.sol === undefined ? 1 : o.sol;
}

/** Ombre statique du décor : à appeler AVANT la première compilation des matériaux peints (ombre-statique.js). */
export function setOmbreStatique(texture, matrice, taille) {
  uniformsPeints.uSrStatMap.value = texture;
  uniformsPeints.uSrStatMat.value.copy(matrice);
  uniformsPeints.uSrStatSize.value.set(taille, taille);
  statique = true;
}

// ----- Profils → #define ------------------------------------------------------------------------------------------
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const v3 = (c) => `vec3( ${f(c.r)}, ${f(c.g)}, ${f(c.b)} )`;
function definesDe(profil) {
  const P = PEINT.profils[profil];
  if (!P) throw new Error(`profil de matériau inconnu : ${profil}`);
  const base = new THREE.Color(P.base[0], P.base[1], P.base[2]); // multiplicateur (pas une couleur sRGB)
  const rim = lin(P.liseré.couleur, P.liseré.force);
  const d = {
    SR_SAT: f(P.saturation),
    SR_GAIN: v3(base),
    SR_RIM: v3(rim),
    SR_RIM_P: f(P.liseré.puissance),
    // 16/11 (look-unites) : part du liseré du profil GARDÉE sous le look cel, en bord dur (0 = éteint, comme avant)
    SR_RIM_CEL: f(P.liseré.cel || 0),
    SR_METAL: f(P.metal),
    // teinte d'ombre DU PROFIL (passe 3) : brun chaud sur le décor, bleuté sur le sable et les unités
    SR_OMBRE: v3(lin(P.ombre.couleur, P.ombre.force)),
    SR_AMB: v3(new THREE.Color(...(P.ciel || [1, 1, 1]))), // multiplicateur de l'hémisphère (décor : ciel réchauffé)
    SR_EMI: f(P.emissif === undefined ? 1 : P.emissif),
    SR_DIRECT: f(P.soleil === undefined ? 1 : P.soleil),
    SR_TRANS: f(P.translucide || 0), // passe 5 : translucidité au soleil (herbes)
  };
  if (P.texProfil) d.SR_TEX_PROFIL = ''; // § E5.T : l'image des armes suit le gain et la saturation du profil
  if (profil === 'sol') d.SR_SOL = '';
  if (profil === 'sol' && CARTE) d.SR_CARTE = '';
  if (profil === 'decor') d.SR_DECOR = '';
  if (statique && P.ombreStatique !== false) d.SR_STATIQUE = '';
  return d;
}

// ----- GLSL ----------------------------------------------------------------------------------------------------------
const MONDE = '1'; // position monde toujours calculée (ombres de nuages, passe 5)
const VERT_WORLD_PARS = `
#if ${MONDE}
varying vec3 vSrW;
#endif
void main() {`;
const VERT_WORLD_MAIN = `#include <project_vertex>
#if ${MONDE}
{ vec4 srW = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  srW = instanceMatrix * srW;
#endif
  vSrW = ( modelMatrix * srW ).xyz; }
#endif`;

const FRAG_PARS = `
uniform vec4 uSrLum; uniform vec4 uSrQual; uniform vec4 uSrGlow; uniform vec4 uSrStyle; uniform vec2 uSrNuage;
uniform vec4 uSrCel; uniform vec4 uSrCelBord; uniform float uSrCelSol;
uniform highp sampler2D uSrPtTex;
uniform vec3 uSrSableRouge; uniform vec3 uSrSablePale; uniform vec3 uSrChemin;
// bruit de valeur entier, IDENTIQUE à vegetation.js (densite) : les chemins du sol et les trous dans l'herbe coïncident
float srHU( vec2 c ) {
  uvec2 u = uvec2( ivec2( c ) );
  uint h = u.x * 374761393u + u.y * 668265263u;
  h = ( h ^ ( h >> 13u ) ) * 1274126177u;
  return float( h ^ ( h >> 16u ) ) / 4294967296.0;
}
float srBU( vec2 p ) {
  vec2 i = floor( p ); vec2 f = p - i; vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( srHU( i ), srHU( i + vec2( 1.0, 0.0 ) ), u.x ), mix( srHU( i + vec2( 0.0, 1.0 ) ), srHU( i + vec2( 1.0 ) ), u.x ), u.y );
}
// ombres de nuages : grandes taches douces qui glissent (2 octaves)
// vraie lumière ponctuelle (lumieres.js) : diffus enveloppé, atténuation de three r170 ; couleur nulle = éteinte
void srPointLumiere( vec4 lp, vec4 lc, vec3 w, vec3 alb, vec3 n, inout vec3 diffus ) {
  if ( lc.r + lc.g + lc.b <= 0.0 ) return;
  vec3 dw = lp.xyz - w;
  float d = length( dw );
  vec3 dv = normalize( ( viewMatrix * vec4( dw, 0.0 ) ).xyz );
  float att = 1.0 / max( pow( d, lc.w ), 0.01 );
  if ( lp.w > 0.0 ) { float x = saturate( 1.0 - pow4( d / lp.w ) ); att *= x * x; }
  diffus += alb * lc.rgb * att * saturate( ( dot( n, dv ) + 0.5 ) / 1.5 );
}
${CARTE && !(K.ventilo.force > 0) ? `float srNuages( vec2 w ) { return 0.0; } // carte mère : ni nuages ni ventilateur` : CARTE ? `// carte mère : ombre d'un ventilateur géant au-dessus de l'arène (pales qui tournent lentement, moyeu plein)
float srNuages( vec2 w ) {
  vec2 d = w - vec2( ${f(K.ventilo.centre[0])}, ${f(K.ventilo.centre[1])} );
  float r = length( d );
  float R = ${f(K.ventilo.rayon)};
  if ( r > R + 1.0 ) return 0.0;
  float a = atan( d.y, d.x ) + uSrNuage.x * ${f(K.ventilo.vitesse)} - r * 0.012;
  float t = fract( a * ${f(K.ventilo.pales / (2 * Math.PI))} );
  float pale = smoothstep( 0.0, 0.07, t ) * ( 1.0 - smoothstep( 0.3, 0.4, t ) );
  float moyeu = 1.0 - smoothstep( 3.2, 3.8, r );
  float anneau = smoothstep( R - 1.4, R - 0.9, r ) * ( 1.0 - smoothstep( R, R + 0.6, r ) );
  float bord = 1.0 - smoothstep( R - 1.2, R - 0.6, r );
  return max( max( pale * bord * smoothstep( 3.0, 4.2, r ), moyeu ), anneau ) * ${f(K.ventilo.force)};
}` : `float srNuages( vec2 w ) {
  vec2 p = ( w + uSrNuage ) * uSrStyle.z;
  float n = srBU( p ) * 0.65 + srBU( p * 2.3 + 7.1 ) * 0.35;
  return smoothstep( 0.52, 0.72, n ) * uSrStyle.y;
}`}
#if ${MONDE}
varying vec3 vSrW;
#endif
#if defined( SR_SOL ) || defined( SR_DECOR )
float srHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float srNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( srHash( i ), srHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( srHash( i + vec2( 0.0, 1.0 ) ), srHash( i + vec2( 1.0 ) ), u.x ), u.y );
}
#endif
#ifdef SR_SOL
uniform vec3 uSrSable; uniform vec3 uSrSableClair; uniform vec3 uSrSableOmbre; uniform vec3 uSrRoche; uniform vec3 uSrRochePied;
uniform vec3 uSrSolEchelles;
#endif
#ifdef SR_CARTE
uniform vec3 uSrPcbVernis; uniform vec3 uSrPcbClair; uniform vec3 uSrPcbSombre; uniform vec3 uSrPcbPiste;
uniform vec3 uSrPcbOr; uniform vec3 uSrPcbTrou; uniform vec3 uSrPcbSeri; uniform vec3 uSrPcbDehors;
uniform vec4 uSrPcbGeo; uniform vec3 uSrPcbBus; uniform vec3 uSrPcbAlim; uniform vec3 uSrPcbImp;
uniform vec4 uSrPcbDetail; uniform vec3 uSrPcbLueur; uniform vec3 uSrPcbGrille;
uniform vec4 uSrHalo; uniform vec3 uSrHaloTeinte; uniform float uSrHaloLoin;
#ifdef SR_PLAN
uniform sampler2D uSrPlanTex; uniform sampler2D uSrPlanAo; uniform sampler2D uSrCpuTex; uniform sampler2D uSrCpuEmi;
uniform vec4 uSrPlanMix; uniform vec4 uSrPulse; uniform vec3 uSrEnergie; uniform vec4 uSrCpu; uniform float uSrPulse2; uniform vec3 uSrBruitE;
#endif
// couverture anticrénelée d'une forme de distance signée d (m) ; px = taille d'un pixel au sol (m)
float srCouv( float d, float px ) { return 1.0 - smoothstep( -0.6 * px, 0.6 * px, d ); }
// pistes d'une voie le long de x (repère q) : segments tirés au hasard, terminés par un via de chaque côté.
// Renvoie (piste, via, trou) en couvertures.
vec3 srVoies( vec2 q, vec2 bloc, float px, float bus ) {
  float pas = uSrPcbGeo.x;
  float voie = floor( q.y / pas );
  float v = q.y - ( voie + 0.5 ) * pas;
  float L = mix( 1.6, 6.5, srHash( vec2( voie, bloc.x * 7.0 + bloc.y ) ) );
  float x = q.x + srHash( vec2( voie, 9.7 + bloc.y ) ) * L;
  float s = floor( x / L );
  float on = step( 0.4, srHash( vec2( voie * 1.7 + s, s * 0.31 + bloc.x ) ) ) * ( 1.0 - bus );
  float u = x - s * L;
  float g = 0.32;
  float dPiste = max( abs( v ) - uSrPcbGeo.y, max( g - u, u - ( L - g ) ) );
  float du = min( abs( u - g ), abs( u - ( L - g ) ) );
  float r = length( vec2( du, v ) );
  return on * vec3( srCouv( dPiste, px ), srCouv( r - uSrPcbGeo.z, px ), srCouv( r - uSrPcbGeo.z * 0.42, px ) );
}
#endif
#if ( defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0 ) || defined( SR_STATIQUE )
float srCmp( sampler2D m, vec2 uv, float z ) { return step( z, unpackRGBAToDepth( texture2D( m, uv ) ) ); }
// comparaison filtrée bilinéairement (même centrage que le PCF doux de three)
float srBil( sampler2D m, vec2 uv, float z, vec2 ts, vec2 size ) {
  vec2 f = fract( uv * size + 0.5 ); vec2 b = uv - f * ts;
  float a = srCmp( m, b, z ); float c = srCmp( m, b + vec2( ts.x, 0.0 ), z );
  float d = srCmp( m, b + vec2( 0.0, ts.y ), z ); float e = srCmp( m, b + ts, z );
  return mix( mix( a, c, f.x ), mix( d, e, f.x ), f.y );
}
#endif
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
float srOmbre( sampler2D m, vec2 size, float intensity, float bias, vec4 coord ) {
  coord.xyz /= coord.w; coord.z += bias;
  if ( coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0 ) return 1.0;
  vec2 ts = 1.0 / size; float s;
  if ( uSrQual.x > 0.5 ) {
    // 4 prises en grille tournée (écart uSrQual.y texels) : pénombre douce sans motif de grille
    vec2 o1 = ts * uSrQual.y * vec2( 0.92, 0.38 ); vec2 o2 = ts * uSrQual.y * vec2( -0.38, 0.92 );
    s = 0.25 * ( srBil( m, coord.xy + o1, coord.z, ts, size ) + srBil( m, coord.xy - o1, coord.z, ts, size )
               + srBil( m, coord.xy + o2, coord.z, ts, size ) + srBil( m, coord.xy - o2, coord.z, ts, size ) );
  } else {
    s = srBil( m, coord.xy, coord.z, ts, size );
  }
  return mix( 1.0, s, intensity );
}
#endif
#ifdef SR_STATIQUE
uniform sampler2D uSrStatMap; uniform mat4 uSrStatMat; uniform vec2 uSrStatSize;
float srOmbreStatique( vec3 w ) {
  vec4 c = uSrStatMat * vec4( w, 1.0 );
  if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0 ) return 1.0;
  vec2 ts = 1.0 / uSrStatSize;
  if ( uSrQual.x > 0.5 ) {
    // même grille tournée que l'ombre du soleil, à 1 texel : le bord de l'ombre figée ne fait plus d'escalier
    vec2 o1 = ts * vec2( 0.92, 0.38 ); vec2 o2 = ts * vec2( -0.38, 0.92 ); float z = c.z - 0.0015;
    return 0.25 * ( srBil( uSrStatMap, c.xy + o1, z, ts, uSrStatSize ) + srBil( uSrStatMap, c.xy - o1, z, ts, uSrStatSize )
                  + srBil( uSrStatMap, c.xy + o2, z, ts, uSrStatSize ) + srBil( uSrStatMap, c.xy - o2, z, ts, uSrStatSize ) );
  }
  return srBil( uSrStatMap, c.xy, c.z - 0.0015, ts, uSrStatSize );
}
#endif`;

// Albédo peint du sol (bruit en monde) : fond presque uni, plaques claires ou sombres posées au pinceau ; roche dehors.
const FRAG_SOL = `
#if defined( SR_SOL ) && defined( SR_CARTE )
{
  // ---- carte mère : vernis peint, zones de routage, bus, vias, sérigraphie (tout en mètres, monde) ----
  vec2 srP = vSrW.xz;
  float srProc = 1.0; // part gardée du routage procédural (le plan cuit le remplace en partie)
#ifdef SR_PLAN
  srProc = uSrPlanMix.y;
#endif
  float px = max( fwidth( srP.x ), fwidth( srP.y ) );
  float n1 = srNoise( srP * uSrSolEchelles.x );
  float n2 = srNoise( srP * uSrSolEchelles.y + 17.3 );
  float n3 = srNoise( srP * uSrSolEchelles.z + 41.7 );
  float big = srBU( srP / 40.0 + 2.7 );
  // vernis : presque uni, grandes plaques plus claires ou plus sombres posées au pinceau, grain fin
  vec3 col = uSrPcbVernis * ( 0.95 + 0.1 * n1 + 0.05 * uSrQual.z * ( n3 - 0.5 ) );
  col = mix( col, uSrPcbClair, smoothstep( 0.58, 0.8, big ) * 0.45 );
  col = mix( col, uSrPcbSombre, smoothstep( 0.42, 0.2, big ) * 0.4 );
  col = mix( col, uSrPcbSombre, smoothstep( 0.62, 0.72, ( 1.0 - n2 ) * 0.6 + ( 1.0 - n1 ) * 0.4 ) * 0.25 );
  // bus : faisceaux de pistes continues, horizontaux et verticaux (périodes décalées)
  float per = uSrPcbBus.x;
  float lb = uSrPcbBus.y * uSrPcbBus.z; // largeur du faisceau
  float busH = 0.0, busV = 0.0, pisteBus = 0.0, lueurBus = 0.0; // lueurBus : piste du MILIEU de chaque faisceau (fine ligne lumineuse)
  {
    float k = floor( srP.y / per );
    float c = ( k + 0.5 ) * per + ( srHash( vec2( k, 1.3 ) ) - 0.5 ) * per * 0.4;
    float e = srP.y - c + lb * 0.5;
    if ( srHash( vec2( k, 5.1 ) ) > 0.25 && e > -0.25 && e < lb + 0.25 ) {
      busH = 1.0;
      float vv = mod( e, uSrPcbBus.z ) - uSrPcbBus.z * 0.5;
      if ( e > 0.0 && e < lb ) pisteBus = max( pisteBus, srCouv( abs( vv ) - uSrPcbGeo.y * 0.8, px ) );
      if ( floor( e / uSrPcbBus.z ) == floor( uSrPcbBus.y * 0.5 ) ) lueurBus = max( lueurBus, srCouv( abs( vv ) - uSrPcbGeo.y * 0.55, px ) );
    }
    float k2 = floor( ( srP.x + 11.0 ) / ( per * 1.3 ) );
    float c2 = ( k2 + 0.5 ) * per * 1.3 - 11.0 + ( srHash( vec2( k2, 2.9 ) ) - 0.5 ) * per * 0.5;
    float e2 = srP.x - c2 + lb * 0.5;
    if ( srHash( vec2( k2, 7.7 ) ) > 0.35 && e2 > -0.25 && e2 < lb + 0.25 ) {
      busV = 1.0;
      float vv = mod( e2, uSrPcbBus.z ) - uSrPcbBus.z * 0.5;
      if ( e2 > 0.0 && e2 < lb ) pisteBus = max( pisteBus, srCouv( abs( vv ) - uSrPcbGeo.y * 0.8, px ) );
      if ( floor( e2 / uSrPcbBus.z ) == floor( uSrPcbBus.y * 0.5 ) ) lueurBus = max( lueurBus, srCouv( abs( vv ) - uSrPcbGeo.y * 0.55, px ) );
    }
  }
  float bus = max( busH, busV );
  // zones de routage : une orientation par bloc (horizontale, verticale, diagonale) ou plan de masse
  float T = uSrPcbGeo.w;
  vec2 bloc = floor( srP / T );
  vec2 dansBloc = srP - bloc * T;
  float bordBloc = min( min( dansBloc.x, T - dansBloc.x ), min( dansBloc.y, T - dansBloc.y ) );
  float hb = srHash( bloc + 3.1 );
  vec3 pv = vec3( 0.0 );
  float plan = 0.0;
  if ( hb < 0.36 ) pv = srVoies( srP, bloc, px, bus );
  else if ( hb < 0.7 ) pv = srVoies( srP.yx, bloc + 19.0, px, bus );
  else if ( hb < 0.84 ) pv = srVoies( vec2( srP.x + srP.y, srP.y - srP.x ) * 0.70710678, bloc + 41.0, px, bus );
  else plan = 1.0 - bus;
  pv *= smoothstep( 0.35, 0.75, bordBloc ); // les pistes s'arrêtent avant le bord du bloc
  // au loin (écran titre, vue rasante) : un pixel couvre plus qu'une piste → détails fondus vers le vernis (pas de moiré)
  float detail = 1.0 - smoothstep( 0.05, 0.22, px );
  pv *= detail * srProc;
  pisteBus *= detail * srProc;
  lueurBus *= detail;
  // plan de masse : cuivre sous le vernis (plus clair), bord en retrait, vias de couture en grille
  float marge = smoothstep( 0.5, 0.7, bordBloc );
  col = mix( col, mix( col, uSrPcbPiste, 0.35 ), plan * marge * uSrPcbDetail.w * srProc );
  vec2 cg = fract( srP / 1.2 ) - 0.5;
  float rc = length( cg ) * 1.2;
  float couture = plan * step( 0.9, bordBloc ) * step( 0.55, srHash( floor( srP / 1.2 ) + 0.7 ) ) * detail * step( 0.5, uSrPcbDetail.w ) * srProc;
  // pistes (cuivre sous le vernis : vert clair) puis vias (or nu, trou sombre)
  // grille fine (réf « arène technique ») : traits éclaircis tous les uSrPcbGrille.x m, fondus au loin
  if ( uSrPcbGrille.z > 0.0 ) {
    vec2 gq = abs( fract( srP / uSrPcbGrille.x + 0.5 ) - 0.5 ) * uSrPcbGrille.x;
    float gl = srCouv( min( gq.x, gq.y ) - uSrPcbGrille.y, px ) * detail;
    col = mix( col, col * 1.6 + 0.02, gl * uSrPcbGrille.z );
  }
  col = mix( col, uSrPcbPiste, pv.x * 0.85 * uSrPcbDetail.x );
  col = mix( col, uSrPcbPiste, pisteBus * 0.85 );
  totalEmissiveRadiance += uSrPcbLueur * lueurBus;
  float via = max( pv.y, couture * srCouv( rc - uSrPcbGeo.z * 0.8, px ) );
  float trou = max( pv.z, couture * srCouv( rc - uSrPcbGeo.z * 0.34, px ) );
  // vias isolés semés hors des bus
  {
    vec2 cs = floor( srP / 1.7 );
    vec2 o = ( vec2( srHash( cs + 1.1 ), srHash( cs + 2.3 ) ) - 0.5 ) * 1.0;
    float rv = length( srP - ( cs + 0.5 ) * 1.7 - o );
    float on = step( 0.9, srHash( cs + 8.8 ) ) * ( 1.0 - bus ) * ( 1.0 - plan ) * detail * srProc;
    via = max( via, on * srCouv( rv - uSrPcbGeo.z, px ) );
    trou = max( trou, on * srCouv( rv - uSrPcbGeo.z * 0.42, px ) );
  }
  col = mix( col, uSrPcbOr * ( 0.92 + 0.12 * n2 ), via * uSrPcbDetail.y );
  col = mix( col, uSrPcbTrou, trou * uSrPcbDetail.y );
  // sérigraphie : repères de texte (rangées de glyphes) et empreintes vides (cadre + 2 pastilles dorées)
  {
    vec2 cc = floor( srP / 3.4 );
    float h = srHash( cc + 4.4 );
    vec2 l = srP - ( cc + 0.5 ) * 3.4 - ( vec2( srHash( cc + 5.5 ), srHash( cc + 6.6 ) ) - 0.5 ) * 1.6;
    float seri = 0.0;
    float or2 = 0.0;
    if ( h < 0.16 && bus < 0.5 ) {
      // rangée de 2 à 4 glyphes de 0,14 × 0,24 m
      float ng = 2.0 + floor( srHash( cc + 7.7 ) * 3.0 );
      float gx = l.x / 0.2 + ng * 0.5;
      float gi = floor( gx );
      float gf = fract( gx );
      if ( gi >= 0.0 && gi < ng ) {
        float forme = srHash( cc * 3.0 + gi );
        float dx = abs( gf - 0.5 ) * 0.2 - 0.065;
        float dy = abs( l.y ) - 0.12;
        float plein = max( dx, dy );
        float creux = max( abs( gf - 0.5 ) * 0.2 - 0.025, abs( l.y - ( forme - 0.5 ) * 0.1 ) - 0.03 );
        seri = srCouv( max( plein, -creux ), px );
      }
    } else if ( h < 0.3 && bus < 0.5 && plan < 0.5 ) {
      // empreinte vide 0,9 × 0,5 m : cadre de sérigraphie, deux pastilles
      vec2 a = abs( l ) - vec2( 0.45, 0.25 );
      float cadre = abs( max( a.x, a.y ) ) - 0.025;
      seri = srCouv( cadre, px );
      vec2 pp = vec2( abs( l.x ) - 0.24, l.y );
      vec2 b = abs( pp ) - vec2( 0.11, 0.14 );
      or2 = srCouv( max( b.x, b.y ), px );
    }
    col = mix( col, uSrPcbOr, or2 * detail * uSrPcbDetail.z * srProc );
    col = mix( col, uSrPcbSeri, seri * 0.92 * detail * uSrPcbDetail.z * srProc );
  }
  // sous et derrière la bordure : vernis sombre, traversé par les faisceaux d'ALIMENTATION — pistes or perpendiculaires
  // au bord le plus proche, groupées par faisceaux, terminées par un via ; des impulsions d'énergie y courent vers la
  // carte (temps : uSrNuage.x avance de PEINT.nuages.vitesse[0] m/s, world.update)
  vec2 qd = abs( srP ) - vec2( uSrQual.w );
  float dehors = smoothstep( -0.4, 1.2, max( qd.x, qd.y ) );
  vec3 colD = uSrPcbDehors * ( 0.92 + 0.12 * n1 );
  if ( dehors > 0.0 ) {
    float cote = step( qd.y, qd.x ); // 1 : bords est / ouest (pistes le long de x), 0 : nord / sud
    float uOut = max( mix( qd.y, qd.x, cote ), 0.0 );
    float vAl = mix( srP.x, srP.y, cote ) + cote * 2.0;
    float F = ${f(K.alimentation.faisceau)};
    float pa = ${f(K.alimentation.pas)};
    float g = floor( vAl / F );
    float hg = srHash( vec2( g, 3.3 + cote * 17.0 + sign( mix( srP.y, srP.x, cote ) ) * 5.0 ) );
    float nb = 4.0 + floor( hg * 6.0 );
    float loc = vAl - g * F - ( F - nb * pa ) * 0.5;
    float k = floor( loc / pa );
    float onA = step( 0.3, hg ) * step( 0.0, loc ) * step( k, nb - 1.0 );
    float vv = loc - ( k + 0.5 ) * pa;
    float hk = srHash( vec2( g * 7.0 + k, 9.1 + cote ) );
    float lg = mix( ${f(K.alimentation.longueurMin)}, ${f(K.alimentation.longueurMax)}, hk );
    float piste = onA * srCouv( abs( vv ) - uSrPcbGeo.y, px ) * ( 1.0 - smoothstep( lg - 0.05, lg, uOut ) );
    float rv = length( vec2( uOut - lg, vv ) );
    float viaA = onA * srCouv( rv - uSrPcbGeo.z * 1.3, px );
    float trouA = onA * srCouv( rv - uSrPcbGeo.z * 0.5, px );
    colD = mix( colD, uSrPcbAlim * ( 0.8 + 0.2 * n2 ), piste * 0.9 );
    colD = mix( colD, uSrPcbAlim, viaA );
    colD = mix( colD, uSrPcbTrou, trouA );
    // impulsion : front net côté carte, traîne qui s'éteint vers l'extérieur ; une piste sur deux, déphasées
    float t = uSrNuage.x / ${f(PEINT.nuages.vitesse[0])};
    float ph = fract( ( uOut + t * ${f(K.alimentation.vitesse)} ) / ${f(K.alimentation.periode)} + hk * 3.7 );
    float imp = smoothstep( 0.0, 0.015, ph ) * ( 1.0 - smoothstep( 0.015, 0.22, ph ) ) * step( 0.45, fract( hk * 13.0 ) );
    totalEmissiveRadiance += uSrPcbImp * imp * piste * dehors;
  }
#ifdef SR_PLAN
  {
    // plan de routage cuit : monde (x, z) → uv ((x + E) / 2E, (E − z) / 2E) (texture chargée avec flipY)
    float E = uSrPlanMix.w;
    vec2 uvP = vec2( srP.x + E, E - srP.y ) / ( 2.0 * E );
    float dansPlan = step( 0.0, uvP.x ) * step( uvP.x, 1.0 ) * step( 0.0, uvP.y ) * step( uvP.y, 1.0 );
    vec3 pm = texture2D( uSrPlanTex, uvP ).rgb * dansPlan;
    float piste = clamp( pm.r / 0.6, 0.0, 1.0 );
    float alim = clamp( ( pm.r - 0.6 ) / 0.4, 0.0, 1.0 );
    float seriP = clamp( ( pm.b - 0.5 ) * 2.0, 0.0, 1.0 );
    float trouP = clamp( pm.b * 2.0, 0.0, 1.0 ) * ( 1.0 - seriP ) * step( 0.25, pm.b ) * ( 1.0 - step( 0.75, pm.b ) );
    float K = uSrPlanMix.x;
    col = mix( col, uSrPcbPiste, piste * uSrPulse2 * K );
    col = mix( col, uSrPcbOr * ( 0.92 + 0.12 * n2 ), pm.g * K );
    col = mix( col, uSrPcbTrou, trouP * K );
    col = mix( col, uSrPcbSeri, seriP * 0.85 * K );
    float ao = mix( 1.0, texture2D( uSrPlanAo, uvP ).r, uSrPlanMix.z * dansPlan );
    col *= ao;
    // impulsion du début de vague : un front part du processeur et court sur les bus alimentés, suivi d'une traîne
    float r = length( srP );
    float df = ( r - uSrPulse.x ) / uSrPulse.y;
    float front = exp( - df * df );
    float traine = df < 0.0 ? exp( df * 0.18 ) : 0.0;
    // bruit fractal (4 octaves) qui casse l'aplat de l'énergie ; il dérive avec le front
    vec2 pb = srP * uSrBruitE.x + vec2( uSrPulse.x * uSrBruitE.z, - uSrPulse.x * uSrBruitE.z * 0.6 );
    float fb = 0.5 * srNoise( pb ) + 0.25 * srNoise( pb * 2.03 + 7.1 ) + 0.125 * srNoise( pb * 4.11 + 3.7 ) + 0.0625 * srNoise( pb * 8.3 + 1.9 );
    float bruitE = mix( uSrBruitE.y, 1.25, smoothstep( 0.2, 0.75, fb / 0.9375 ) );
    totalEmissiveRadiance += uSrEnergie * alim * K * ( uSrPulse.z * front + uSrPulse.w * traine ) * bruitE;
    // processeur central (substrat + capot), plat : couleur cuite, émissif de la rainure et de la gravure
    vec2 q = srP / uSrCpu.y;
    vec2 uvC = vec2( q.x, - q.y ) * 0.5 + 0.5;
    vec2 aq = abs( srP ) - vec2( uSrCpu.x );
    float dedans = 1.0 - smoothstep( -0.6 * px, 0.6 * px, max( aq.x, aq.y ) );
    if ( dedans > 0.0 ) {
      col = mix( col, texture2D( uSrCpuTex, uvC ).rgb * uSrCpu.z, dedans );
      totalEmissiveRadiance += uSrEnergie * texture2D( uSrCpuEmi, uvC ).r * dedans * uSrCpu.w * mix( 1.0, bruitE, 0.6 );
    }
  }
#endif
  diffuseColor.rgb = mix( col, colD, dehors ) * uSrCelSol;
  if ( uSrHalo.w > 0.0 || uSrHaloLoin < 1.0 ) { // halo doux autour du héros : le sol s'éclaire près de lui, s'enfonce au loin
    vec2 dh = ( srP - uSrHalo.xy ) / uSrHalo.z;
    float kh = exp( - dot( dh, dh ) );
    diffuseColor.rgb *= mix( vec3( uSrHaloLoin ), vec3( 1.0 ) + uSrHalo.w * uSrHaloTeinte, kh );
  }
}
#elif defined( SR_SOL )
{
  vec2 srP = vSrW.xz;
  float n1 = srNoise( srP * uSrSolEchelles.x );
  float n2 = srNoise( srP * uSrSolEchelles.y + 17.3 );
  float n3 = srNoise( srP * uSrSolEchelles.z + 41.7 );
  vec3 sable = uSrSable * ( 0.94 + 0.12 * n1 + 0.06 * uSrQual.z * ( n3 - 0.5 ) );
  if ( uSrStyle.w > 0.5 ) {
    // passe 5 : grandes variations de teinte (ocre rouge ↔ pâle), chemins piétinés plus clairs et plus lisses
    float big = srBU( srP / 40.0 + 2.7 );
    sable = mix( sable, uSrSableRouge * ( 0.95 + 0.1 * n2 ), smoothstep( 0.55, 0.8, big ) * 0.55 );
    sable = mix( sable, uSrSablePale * ( 0.96 + 0.08 * n1 ), smoothstep( 0.45, 0.2, big ) * 0.45 );
    float ch = abs( srBU( srP / 26.0 + vec2( 11.0, 5.0 ) ) - 0.5 );
    sable = mix( sable, uSrChemin, ( 1.0 - smoothstep( 0.03, 0.065, ch ) ) * 0.7 );
  }
  float clair = smoothstep( 0.58, 0.68, n2 * 0.7 + n1 * 0.3 );
  float sombre = smoothstep( 0.61, 0.71, ( 1.0 - n2 ) * 0.6 + ( 1.0 - n1 ) * 0.4 );
  sable = mix( sable, uSrSableClair, clair * 0.3 );
  sable = mix( sable, uSrSableOmbre, sombre * 0.28 );
  vec2 q = abs( srP ) - vec2( uSrQual.w );
  float dehors = smoothstep( -0.4, 1.2, max( q.x, q.y ) );
  vec3 roc = mix( uSrRochePied, uSrRoche, 0.35 + 0.5 * n2 );
  diffuseColor.rgb = mix( sable, roc, dehors ) * uSrCelSol;
}
#endif
#ifdef SR_DECOR
diffuseColor.rgb *= 0.92 + 0.16 * srNoise( vSrW.xz * 0.45 + vSrW.y * 0.3 );
#endif`;

// Remplace lights_fragment_begin / maps / end : un soleil (le premier directionnel) et une hémisphère.
const FRAG_LIGHTS = `
{
  vec3 srN = normal;
  vec3 srV = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
  totalEmissiveRadiance *= SR_EMI; // gain émissif du profil (accents cyan du héros)
  {
    // passe 4 : émissif « lumineux » — cœur plus clair et plus fort là où la face regarde la caméra, bords saturés
    float srFace = pow( saturate( dot( normal, isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition ) ) ), 3.0 ) * uSrGlow.z;
    float srMx = max( totalEmissiveRadiance.r, max( totalEmissiveRadiance.g, totalEmissiveRadiance.b ) );
    totalEmissiveRadiance = mix( totalEmissiveRadiance, vec3( srMx ), uSrGlow.x * srFace ) * ( 1.0 + uSrGlow.y * srFace );
  }
  // étalonnage du profil (le flash blanc y échappe)
  float srL0 = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 srAlb = mix( max( mix( vec3( srL0 ), diffuseColor.rgb, SR_SAT ), 0.0 ) * SR_GAIN, diffuseColor.rgb, vFx.x );
  #if defined( TEX_ARMES ) && ! defined( TEX_LUEURS ) && ! defined( SR_TEX_PROFIL )
  // armes bakées : même gain, SANS la dominante chaude du profil (l'acier gris virait au brun) ; § E5.T : un profil
  // « texProfil » (tourelles posées) étalonne l'image comme les couleurs de sommet (gain froid, saturation)
  srAlb = mix( srAlb, diffuseColor.rgb * dot( vec3( SR_GAIN ), vec3( 1.0 / 3.0 ) ), vTex * ( 1.0 - vFx.x ) );
  #endif
  float srLit = 0.0; float srShadow = 1.0; float srNdotL = 0.0;
  vec3 srSunCol = vec3( 0.0 ); vec3 srL = vec3( 0.0, 1.0, 0.0 );
  #ifdef SR_STATIQUE
    srShadow = srOmbreStatique( vSrW );
  #endif
  #if NUM_DIR_LIGHTS > 0
    srL = directionalLights[ 0 ].direction;
    srSunCol = directionalLights[ 0 ].color;
    srNdotL = dot( srN, srL );
    float srWrapped = saturate( ( srNdotL + uSrLum.x ) / ( 1.0 + uSrLum.x ) );
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      if ( receiveShadow ) {
        DirectionalLightShadow srS = directionalLightShadows[ 0 ];
        srShadow = min( srShadow, srOmbre( directionalShadowMap[ 0 ], srS.shadowMapSize, srS.shadowIntensity, srS.shadowBias, vDirectionalShadowCoord[ 0 ] ) );
      }
    #endif
    srShadow *= 1.0 - srNuages( vSrW.xz ); // passe 5 : ombres de nuages (le soleil seulement)
    if ( uSrStyle.x > 0.5 ) {
      // passe 5, option : diffus « toon doux », 3 paliers lissés
      srWrapped = 0.18 + 0.42 * smoothstep( 0.12, 0.22, srWrapped ) + 0.4 * smoothstep( 0.55, 0.65, srWrapped );
    }
    srLit = srWrapped * srShadow;
    if ( uSrCel.x > 0.5 ) {
      // look-cel : soleil × ombre en paliers durs (l'ombre portée devient un aplat net, comme la face à contre-jour)
      float srT = srLit * uSrCel.x; float srB = floor( srT );
      srLit = min( ( srB + smoothstep( 0.5 - uSrCel.y, 0.5 + uSrCel.y, srT - srB ) ) / uSrCel.x, 1.0 );
    }
    #ifdef USE_AOMAP
      // cavités cuites (AO, canal R) : elles retiennent aussi un peu de soleil, pas seulement l'ambiant
      srLit *= mix( 1.0, texture2D( aoMap, vAoMapUv ).r, 0.5 );
    #endif
  #endif
  vec3 srAmb = ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
    // look-cel : aplat du ciel — l'hémisphère lue face caméra (même valeur partout) au lieu de suivre la normale
    srAmb += getHemisphereLightIrradiance( hemisphereLights[ 0 ], normalize( mix( srN, vec3( 0.0, 0.0, 1.0 ), uSrCel.z ) + vec3( 0.0, 0.0, 1e-4 ) ) ) * SR_AMB;
  #endif
  // niveau de la lumière d'ambiance (panne de courant, § E1.C) : soleil, ciel, voile d'ombre et liseré — pas les émissifs
  srAmb *= uSrLum.w;
  srSunCol *= uSrLum.w;
  // passe 4 : vraies lumières ponctuelles des grands moments (explosions, flammes du boss), diffus enveloppé
  // (intégration : uniformes du monde au lieu des PointLight de three ; même atténuation que getDistanceAttenuation r170)${ptCorps}
  reflectedLight.directDiffuse += srAlb * srSunCol * srLit * SR_DIRECT; // part du soleil du profil (robots : aplats profonds)
  #if NUM_SPOT_LIGHTS > 0
    // 15/11 (Femz : « un vrai spotlight ») : les SpotLight de three (projecteur de l'écran titre ; aucun en partie, donc
    // rien de compilé en jeu). Diffus enveloppé, en paliers durs si le look cel est actif, comme le soleil.
    for ( int srI = 0; srI < NUM_SPOT_LIGHTS; srI ++ ) {
      IncidentLight srSpot;
      getSpotLightInfo( spotLights[ srI ], - vViewPosition, srSpot );
      float srSl = saturate( ( dot( srN, srSpot.direction ) + uSrLum.x ) / ( 1.0 + uSrLum.x ) );
      if ( uSrCel.x > 0.5 ) { float srT2 = srSl * uSrCel.x; float srB2 = floor( srT2 ); srSl = min( ( srB2 + smoothstep( 0.5 - uSrCel.y, 0.5 + uSrCel.y, srT2 - srB2 ) ) / uSrCel.x, 1.0 ); }
      reflectedLight.directDiffuse += srAlb * srSpot.color * srSl * uSrLum.w;
    }
  #endif
  // passe 5 : translucidité (herbes) — le bout du brin (couleur de sommet claire) s'allume à contre-jour
  reflectedLight.directDiffuse += srAlb * srSunCol * SR_TRANS * srShadow * smoothstep( 0.5, 1.0, srL0 + 0.35 ) * ( 0.55 + 0.45 * saturate( - dot( srL, srV ) + 0.3 ) );
  reflectedLight.indirectDiffuse += srAlb * srAmb;
  // ombre peinte : un voile coloré AJOUTÉ (pas multiplié par l'albédo, sinon un sable pauvre en bleu ne bleuirait
  // jamais), de la couleur du profil, proportionnel à la clarté de la matière (un métal sombre reste sombre)
  reflectedLight.indirectDiffuse += SR_OMBRE * ( 1.0 - srLit ) * ( 0.3 + dot( srAlb, vec3( 0.3, 0.59, 0.11 ) ) ) * uSrLum.w;
  // lueur d'instance (soin, phase 2 du boss…) : l'éclairage s'efface sous elle, la couleur de lueur reste franche
  reflectedLight.directDiffuse *= 1.0 - 0.6 * vFx.y;
  reflectedLight.indirectDiffuse *= 1.0 - 0.6 * vFx.y;
  #ifndef SR_SOL
    float srKeep = 1.0 - vEmissive;
    float srF = pow( 1.0 - saturate( dot( srN, srV ) ), SR_RIM_P );
    float srCelOn = step( 0.5, uSrCel.x );
    // look-cel : liseré DUR clair tout autour de la silhouette (Fresnel en marche), plus marqué côté soleil
    float srFd = smoothstep( uSrCelBord.w - 0.015, uSrCelBord.w + 0.015, 1.0 - saturate( dot( srN, srV ) ) );
    // liseré du profil : Fresnel doux hors cel ; sous le cel, bord dur × SR_RIM_CEL (0 par défaut = éteint)
    reflectedLight.directDiffuse += SR_RIM * mix( srF * ( 1.0 - 0.5 * srLit ), srFd * SR_RIM_CEL, srCelOn ) * srKeep * uSrLum.w;
    reflectedLight.directDiffuse += uSrCelBord.rgb * uSrCel.w * srFd * ( 0.55 + 0.45 * srLit ) * srKeep * uSrLum.w;
    vec3 srH = normalize( srL + srV );
    float srSp = pow( saturate( dot( srN, srH ) ), uSrLum.z );
    srSp = mix( srSp, smoothstep( 0.45, 0.5, srSp ) * 0.6, srCelOn ); // look-cel : reflet en tache nette
    srSp *= uSrLum.y * SR_METAL * srShadow * step( 0.0, srNdotL );
    reflectedLight.directDiffuse += srSunCol * srSp * srKeep;
  #endif
}`;

/**
 * Partie « peinte » de l'onBeforeCompile : appliquée après les insertions du contrat (§ G.2). Idempotente
 * (intégration) : sur un matériau DÉJÀ peint (render.createLitMaterial l'est depuis l'intégration), `peindre` rejoue son
 * onBeforeCompile puis rappellerait celle-ci — le shader n'est alors pas retouché (seuls les #define du nouveau
 * matériau, donc son profil, s'appliquent).
 */
function applyPainted(shader) {
  for (const k in uniformsPeints) shader.uniforms[k] = uniformsPeints[k];
  if (shader.fragmentShader.includes('uniform vec4 uSrLum;')) return;
  shader.vertexShader = shader.vertexShader.replace('void main() {', VERT_WORLD_PARS).replace('#include <project_vertex>', VERT_WORLD_MAIN);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>' + FRAG_PARS)
    .replace('#include <lights_fragment_begin>', FRAG_LIGHTS)
    .replace('#include <lights_fragment_maps>', '')
    .replace('#include <lights_fragment_end>', '');
}

/** Défines et clé de programme résolues à la compilation (l'ombre statique peut arriver après la création). */
function brancher(material, profil, baseKey) {
  material.defines = {}; // three passe CET objet au shader (parameters.defines) : rempli dans onBeforeCompile
  const key = baseKey + '|sr-peint-v2-' + profil;
  const keySt = key + '-st';
  // la clé est demandée AVANT onBeforeCompile : elle suit directement l'état de l'ombre statique
  material.customProgramCacheKey = () => (statique && PEINT.profils[profil].ombreStatique !== false ? keySt : key) + (material.userData.texArmes ? '-texArmes' : '') + (material.userData.texLueurs ? '-texLueurs' : '') + (material.userData.plan ? '-plan' : '');
  return () => {
    Object.assign(material.defines, definesDe(profil));
    if (material.userData.texArmes) material.defines.TEX_ARMES = '';
    if (material.userData.texLueurs) material.defines.TEX_LUEURS = '';
  };
}

/**
 * Textures d'un modèle (passe 3) : map (couleur peinte, sRGB), normalMap (espace tangent glTF ; avec l'attribut tangent
 * — MikkTSpace, calculé par glb.js s'il manque — ou, à défaut, repère par dérivées et normalScale.y inversé comme
 * GLTFLoader), aoMap (canal R, UV0). Lambert de three les lit déjà : couleur × couleur de sommet, normale perturbée
 * AVANT l'éclairage peint (le wrap, le liseré et le spéculaire suivent donc la normal map), AO sur l'ambiant ; le
 * matériau peint ajoute l'AO sur une part du soleil. Mipmaps et filtrage anisotrope modéré posés ici.
 */
export function appliquerTextures(material, { map = null, normalMap = null, aoMap = null, normalScale = null, anisotropie = 4 } = {}) {
  for (const t of [map, normalMap, aoMap]) {
    if (!t) continue;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = anisotropie;
    t.needsUpdate = true;
  }
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace;
    material.map = map;
  }
  if (normalMap) {
    normalMap.colorSpace = THREE.NoColorSpace;
    material.normalMap = normalMap;
    if (normalScale) material.normalScale.copy(normalScale);
  }
  if (aoMap) {
    aoMap.colorSpace = THREE.NoColorSpace;
    material.aoMap = aoMap;
    material.aoMapIntensity = 1;
  }
  return material;
}

/**
 * Image des armes bakées du héros (src/anim/pieces.js, option textures) : appliquerTextures + #define TEX_ARMES (la
 * couleur et le relief de l'image remplacent ceux des sommets là où aTex = 1). textures null : rien.
 */
export function appliquerTexturesArmes(material, textures) {
  if (!textures || !textures.map) return material;
  appliquerTextures(material, textures);
  material.userData.texArmes = true;
  material.needsUpdate = true;
  return material;
}

/**
 * Atlas d'un modèle ALLÉGÉ À TEXTURE CUITE (outils/blender/cuire_modele.py ; src/anim/pieces.js, option textures) :
 * comme appliquerTexturesArmes (l'image remplace couleur et relief là où aTex = 1), plus #define TEX_LUEURS (masque des
 * lueurs dans l'alpha, profil du matériau gardé). Une image par type, sur le matériau du type : aucun appel de dessin en
 * plus. À l'arrivée du modèle seulement. textures null : rien (le modèle garde ses couleurs de sommet).
 */
export function appliquerTexturesModele(material, textures) {
  if (!textures || !textures.map) return material;
  preparerTexturesModele(textures);
  const neuf = !material.userData.texLueurs; // déjà compilé avec TEX_LUEURS : changer d'image ne recompile rien
  material.map = textures.map;
  if (textures.normalMap) {
    material.normalMap = textures.normalMap;
    if (textures.normalScale) material.normalScale.copy(textures.normalScale);
  }
  material.userData.texArmes = true;
  material.userData.texLueurs = true;
  if (neuf) material.needsUpdate = true;
  return material;
}

/**
 * Réglages d'envoi des images d'un modèle cuit (mipmaps, filtrage, espace de couleur), UNE fois par image : un
 * changement d'agent (même matériau, autre atlas) ne renvoie pas l'image au GPU. À l'arrivée des modèles seulement.
 */
export function preparerTexturesModele(textures) {
  if (!textures) return;
  for (const t of [textures.map, textures.normalMap]) {
    if (!t || t.userData.srPret) continue;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4;
    t.colorSpace = t === textures.map ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    t.userData.srPret = true;
  }
}

/**
 * Matériau peint, remplaçant de render.createLitMaterial : mêmes options, mêmes uniformes (userData.uniforms), plus
 * profil ('objet' | 'robot' | 'boss' | 'heros' | 'decor' | 'sol'). Une instance neuve par appel.
 */
export function createPaintedMaterial({ glowColor = 0xffffff, emissiveBoost = RENDER.emissiveBoost, profil = 'objet', side = THREE.FrontSide, textures = null, plan = false } = {}) {
  const uniforms = {
    uFx: { value: new THREE.Vector2(0, 0) },
    uGlowColor: { value: new THREE.Color(glowColor) },
    uEmissiveBoost: { value: emissiveBoost },
    uFlashEmissive: { value: RENDER.flashEmissive },
  };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side });
  if (textures) appliquerTextures(material, textures);
  material.userData.uniforms = uniforms;
  if (plan) material.userData.plan = true; // sol du jeu : plan de routage cuit (SR_PLAN), jamais l'écran titre
  const defs = brancher(material, profil, '');
  material.onBeforeCompile = (shader) => {
    defs(shader);
    if (plan) material.defines.SR_PLAN = '';
    shader.uniforms.uFx = uniforms.uFx;
    shader.uniforms.uGlowColor = uniforms.uGlowColor;
    shader.uniforms.uEmissiveBoost = uniforms.uEmissiveBoost;
    shader.uniforms.uFlashEmissive = uniforms.uFlashEmissive;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', LIT_VERT_PARS + TEX_VERT_PARS).replace('#include <color_vertex>', LIT_VERT_MAIN + TEX_VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', LIT_FRAG_PARS + TEX_FRAG_PARS)
      .replace('#include <map_fragment>', TEX_FRAG_MAP)
      .replace('#include <normal_fragment_maps>', TEX_FRAG_NORMAL)
      .replace('#include <color_fragment>', '#include <color_fragment>' + TEX_FRAG_COLOR + FRAG_SOL + LIT_FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', LIT_FRAG_EMISSIVE);
    applyPainted(shader);
  };
  return material;
}

/**
 * Lueurs teintées par instance (22/11, coffres v2) : l'attribut d'instance aTeinte (vec3, linéaire) multiplie SEULEMENT
 * l'émissif (faces aEmissive) — la caisse garde ses couleurs, ses lumières prennent la couleur de la rareté. Les modèles
 * qui s'en servent peignent leurs lueurs en blanc (outils/blender/coffres_v2.py, 'blanc_lueur'). Le maillage DOIT porter
 * aTeinte (sans lui, lumières noires). Clé de programme distincte (« -teinte »).
 */
export function ajouterTeinteLueurs(m) {
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aTeinte; varying vec3 vSrTeinte;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvSrTeinte = aTeinte;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSrTeinte;')
      .replace('totalEmissiveRadiance += srBase * vEmissive', 'totalEmissiveRadiance += srBase * vSrTeinte * vEmissive');
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => (typeof key === 'function' ? key.call(m) : '') + '-teinte';
  return m;
}

/**
 * Matérialisation (carte-blender, 17/11) : le matériau peint m est révélé du sol vers le haut par une ligne de scan
 * (uSrRevele, uSrReveleCouleur : uniformes partagés, écrits par world.update) — comme l'apparition des robots
 * (allure.js), en hauteur MONDE (vSrW.y) : le corps, les modules d'armes et la cape suivent le même front. Clé de
 * programme distincte (« -revele ») : les autres matériaux du même profil (pause-agent) ne compilent pas ce code.
 */
export function ajouterRevele(m) {
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    shader.uniforms.uSrRevele = uniformsPeints.uSrRevele;
    shader.uniforms.uSrReveleCouleur = uniformsPeints.uSrReveleCouleur;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uSrRevele; uniform vec3 uSrReveleCouleur;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
  float srRvD = uSrRevele.x - vSrW.y; // > 0 : sous le front (déjà compilé)
  if ( uSrRevele.y > 0.5 && srRvD < 0.0 ) discard;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `if ( uSrRevele.y > 0.5 ) outgoingLight += uSrReveleCouleur * ( ( 1.0 - smoothstep( 0.0, uSrRevele.z, srRvD ) ) * 3.2 + ( 1.0 - smoothstep( 0.0, uSrRevele.w, srRvD ) ) * 0.8 );
#include <opaque_fragment>`,
      );
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => (typeof key === 'function' ? key.call(m) : '') + '-revele';
  return m;
}

/**
 * Version peinte d'un matériau éclairé EXISTANT (créé par render.createLitMaterial, éventuellement
 * étendu par un module, comme la fenêtre du boss). Son onBeforeCompile est rejoué tel quel, puis l'éclairage est
 * remplacé : les uniformes d'origine (uFx, uEmissiveBoost, fenêtre…) restent les mêmes objets.
 */
export function peindre(old, { profil = 'objet' } = {}) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: old.side });
  material.userData = old.userData; // uniforms, reveal… : mêmes objets
  const baseCompile = old.onBeforeCompile;
  const baseKey = old.customProgramCacheKey;
  const defs = brancher(material, profil, typeof baseKey === 'function' ? baseKey.call(old) : '');
  material.onBeforeCompile = (shader, renderer) => {
    baseCompile.call(old, shader, renderer);
    defs(shader);
    if (profil === 'decor' && !shader.fragmentShader.includes('#ifdef SR_SOL\n{'))
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>' + FRAG_SOL);
    applyPainted(shader);
  };
  return material;
}
