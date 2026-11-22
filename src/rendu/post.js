// RENDU « PEINT » — passe finale (prototype du 13/11/2026, brief § 1 « Couleur » et § 3).
//
// Remplaçante de makeFinalShader de render.js, même place dans la chaîne (après la passe de bloom resserrée) et MÊMES
// uniformes (tDiffuse, tBloom<i>, uBloom, uVignette, uVignetteStart, uEdgeFlash, uEdgeColor) : render.setEdgeFlash et
// applyBloom n'ont rien à changer. En plus :
//   uExposure    gain avant la courbe (la scène est éclairée pour rester sous le seuil du bloom : seuls les émissifs
//                le dépassent, puis l'exposition remonte l'ensemble)
//   courbe       ACES (approximation de Narkowicz) — par canal ('aces') ou sur le canal le plus fort, teinte gardée
//                ('aces-teinte', retenue) — ou AgX (three r170) avec le look « punchy », choisie à la
//                construction (une constante de préprocesseur : un seul programme)
//   uSaturation  saturation après la courbe (+10 à 15 % du brief)
//   uContrast    courbe en S (gamma 2,2) mêlée après la courbe : contraste et couleurs plus francs (passe 2)
//   uShadowLift  couleur ajoutée aux tons sombres : les ombres bleuissent, rien n'atteint le noir pur
// Le vignettage est gardé, plus léger. Aucun nouveau rendu plein écran : même coût de remplissage qu'avant, plus
// une vingtaine d'opérations par pixel. Aucune AO en post-traitement (brief § 3).
import * as THREE from 'three';
import { PALETTE } from '../config.js';
import { PEINT } from './reglages.js';

const AGX = /* glsl */ `
// AgX (three r170, AgXToneMapping) + look « punchy » (saturation et contraste dans l'espace de la courbe)
vec3 srAgx( vec3 color ) {
  const mat3 AgXInsetMatrix = mat3( vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
    vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ), vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 ) );
  const mat3 AgXOutsetMatrix = mat3( vec3( 1.1271005818144368, -0.1413297634984383, -0.14132976349843826 ),
    vec3( -0.11060664309660323, 1.157823702216272, -0.11060664309660294 ), vec3( -0.016493938717834573, -0.016493938717834257, 1.2519364065950405 ) );
  const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3( vec3( 1.6605, -0.1246, -0.0182 ), vec3( -0.5876, 1.1329, -0.1006 ), vec3( -0.0728, -0.0083, 1.1187 ) );
  const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3( vec3( 0.6274, 0.0691, 0.0164 ), vec3( 0.3293, 0.9195, 0.0880 ), vec3( 0.0433, 0.0113, 0.8956 ) );
  const float AgxMinEv = - 12.47393; const float AgxMaxEv = 4.026069;
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = AgXInsetMatrix * color;
  color = max( color, 1e-10 );
  color = log2( color ); color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv ); color = clamp( color, 0.0, 1.0 );
  vec3 x2 = color * color; vec3 x4 = x2 * x2;
  color = + 15.5 * x4 * x2 - 40.14 * x4 * color + 31.96 * x4 - 6.868 * x2 * color + 0.4298 * x2 + 0.1191 * color - 0.00232;
  // look punchy : saturation 1,4, puissance 1,35
  float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color = pow( max( color, 0.0 ), vec3( 1.35 ) ); l = pow( max( l, 0.0 ), 1.35 );
  color = l + 1.4 * ( color - l );
  color = AgXOutsetMatrix * color;
  color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  return clamp( color, 0.0, 1.0 );
}`;
const ACES = /* glsl */ `
float srAcesC( float x ) { return clamp( ( x * ( 2.51 * x + 0.03 ) ) / ( x * ( 2.43 * x + 0.59 ) + 0.14 ), 0.0, 1.0 ); }
vec3 srAces( vec3 x ) {
  return clamp( ( x * ( 2.51 * x + 0.03 ) ) / ( x * ( 2.43 * x + 0.59 ) + 0.14 ), 0.0, 1.0 );
}
// ACES appliqué au canal le plus fort, la couleur suit en proportion : la courbe ne déplace pas la teinte (le sable
// reste ocre au lieu de virer au jaune, le rouge des yeux reste rouge au lieu de blanchir), la palette du brief tient.
vec3 srAcesTeinte( vec3 x ) {
  float m = max( max( x.r, x.g ), max( x.b, 1e-5 ) );
  return x * ( srAcesC( m ) / m );
}`;

/**
 * Branche shader-crt : pose les réglages CRT / pixel `o` ({ pixel, pixelTampon, scan, scanPx, scanPxTampon, scanGrille,
 * mask, chroma, courbure, niveaux }) sur les uniformes d'une passe finale (jeu ou écran titre). Rend vrai si un effet
 * est actif. uCrtRes et uCrtDpr sont posés par le propriétaire de la passe à chaque changement de taille.
 */
export function appliquerCrt(u, o) {
  o = o || {};
  u.uCrtPixel.value = o.pixel || 0;
  u.uCrtPixelTampon.value = o.pixelTampon || 0;
  u.uCrtScan.value = o.scan || 0;
  u.uCrtScanPx.value = o.scanPx || 3;
  u.uCrtScanPxTampon.value = o.scanPxTampon || 0;
  u.uCrtScanGrille.value = o.scanGrille ? 1 : 0;
  u.uCrtMask.value = o.mask || 0;
  u.uCrtChroma.value = o.chroma || 0;
  u.uCrtCourbure.value = o.courbure || 0;
  u.uCrtNiveaux.value = o.niveaux || 0;
  return !!(o.pixel || o.pixelTampon || o.scan || o.mask || o.chroma || o.courbure || o.niveaux);
}

/** Variante CRT voulue au chargement : ?crt=N dans l'URL, sinon PEINT.crt.actif. */
export function crtDuChargement() {
  const n = new URLSearchParams(window.location.search).get('crt');
  return PEINT.crt.variantes[n !== null ? Number(n) | 0 : PEINT.crt.actif] || null;
}

/** Définition du ShaderPass (assigner les tBloom<i> APRÈS la construction, comme dans render.js : § G.1). */
export function creerPasseFinale(mips, courbe = PEINT.post.courbe) {
  const P = PEINT.post;
  const uniforms = {
    tDiffuse: { value: null },
    uBloom: { value: new THREE.Vector4(0, 0, 0, 0) },
    uBloomSat: { value: 1 }, // 17/11 (look des VFX) : saturation du halo
    uVignette: { value: P.vignette },
    uVignetteStart: { value: P.vignetteDebut },
    uEdgeFlash: { value: 0 },
    uEdgeColor: { value: new THREE.Color(PALETTE.edgeFlash) },
    uExposure: { value: P.exposition },
    uSaturation: { value: P.saturation },
    uContrast: { value: P.contraste || 0 },
    uShadowLift: { value: new THREE.Vector3(P.releveOmbres[0], P.releveOmbres[1], P.releveOmbres[2]) },
    uShadowEdge: { value: P.seuilOmbres },
    // passe 5 : flou diorama (texture de diorama.js ; x force, y bande), étalonnage chaud / froid
    tDiorama: { value: null },
    uDiorama: { value: new THREE.Vector2(0, 0.3) },
    uChaud: { value: new THREE.Vector3(0, 0, 0) },
    uFroid: { value: new THREE.Vector3(0, 0, 0) },
    // branche shader-crt : léger CRT / pixel sur la SCÈNE seulement (le HUD est en HTML ; vignettage et flash des
    // bords passent après). Tailles en pixels CSS (× uCrtDpr = pixels du tampon). Tout à 0 = rendu inchangé.
    uCrtRes: { value: new THREE.Vector2(1, 1) }, // taille du tampon (px)
    uCrtDpr: { value: 1 },
    uCrtPixel: { value: 0 }, // côté d'un gros pixel (px CSS) ; 0 = pas de pixellisation
    uCrtScan: { value: 0 }, // force des lignes de balayage (0..1)
    uCrtScanPx: { value: 3 }, // période des lignes (px CSS) quand il n'y a pas de pixellisation
    uCrtMask: { value: 0 }, // force de la grille d'ouverture RVB (0..1)
    uCrtChroma: { value: 0 }, // décalage rouge / bleu au bord de l'écran (px CSS)
    uCrtCourbure: { value: 0 }, // bombé de l'écran (0..~0,1)
    uCrtNiveaux: { value: 0 }, // niveaux par canal avec tramage de Bayer ; 0 = pas de postérisation
    uCrtPixelTampon: { value: 0 }, // côté d'un gros pixel en pixels du TAMPON (s'ajoute à uCrtPixel) : 2 = 2 px d'écran à pleine définition
    uCrtScanPxTampon: { value: 0 }, // période des lignes en pixels du TAMPON (remplace uCrtScanPx si > 0) : multiple de uCrtPixelTampon = lignes calées sur les gros pixels
    uCrtScanGrille: { value: 0 }, // 1 : une ligne par rangée de gros pixels ; 0 : lignes libres de période uCrtScanPx
    // branche look-cel (appliquerCelPost) : x force de la rampe de palette, y force du contour, z épaisseur du contour
    // (pixels du tampon), w seuil « émissif gardé » ; profondeur de la scène (caméra orthographique : linéaire)
    tCelProf: { value: null },
    uCel: { value: new THREE.Vector4(0, 0, 1.5, 0.92) },
    uCelRes: { value: new THREE.Vector2(1, 1) },
    uCelProf: { value: new THREE.Vector2(1, 0.35) }, // x : far − near (m), y : saut de profondeur d'un bord (m)
    uCelPersp: { value: new THREE.Vector3(0, 1, 220) }, // § E5.AB.12 : x 1 = caméra en perspective (profondeur à linéariser), y near, z far
    uCelLigne: { value: new THREE.Color(1, 0.8, 0.78) },
    uCelR0: { value: new THREE.Color() },
    uCelR1: { value: new THREE.Color() },
    uCelR2: { value: new THREE.Color() },
    uCelR3: { value: new THREE.Color() },
    // § E5.P (B1, Femz 21/11) : halo du bloom atténué autour du héros — centre du héros (x, hauteur, z), caméra, et
    // (r0, r1 en m d'écran, part gardée, actif). Passe du jeu seulement (render.js les relie) ; actif = 0 ailleurs.
    uHaloHeros: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHaloProj: { value: new THREE.Matrix4() },
    uHaloVue: { value: new THREE.Matrix4() },
    uHalo: { value: new THREE.Vector4(0, 1, 1, 0) },
  };
  let declare = '';
  let add = '';
  for (let i = 0; i < mips; i++) {
    uniforms['tBloom' + i] = { value: null };
    declare += ` uniform sampler2D tBloom${i};`;
    // 17/11 (look des VFX) : chroma du halo × uBloomSat (1 = inchangé) — halo coloré autour d'un cœur blanc
    add += `\n      { vec3 bl = texture2D( tBloom${i}, vUv ).rgb; bl = max( mix( vec3( dot( bl, vec3( 0.2126, 0.7152, 0.0722 ) ) ), bl, uBloomSat ), 0.0 ); c.rgb += bl * uBloom.${'xyzw'[i]} * haloK; }`;
  }
  const agx = courbe === 'agx';
  const fn = agx ? 'srAgx' : courbe === 'aces-teinte' ? 'srAcesTeinte' : 'srAces';
  return {
    name: 'SurvivorFinalPassPeinte',
    uniforms,
    vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
    fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;${declare} uniform vec4 uBloom; uniform float uBloomSat;
    uniform vec4 uHaloHeros; uniform mat4 uHaloProj; uniform mat4 uHaloVue; uniform vec4 uHalo;
    uniform float uVignette; uniform float uVignetteStart;
    uniform float uEdgeFlash; uniform vec3 uEdgeColor; varying vec2 vUv;
    uniform float uExposure; uniform float uSaturation; uniform float uContrast; uniform vec3 uShadowLift; uniform float uShadowEdge;
    uniform sampler2D tDiorama; uniform vec2 uDiorama; uniform vec3 uChaud; uniform vec3 uFroid;
    uniform vec2 uCrtRes; uniform float uCrtDpr; uniform float uCrtPixel; uniform float uCrtScan; uniform float uCrtScanPx;
    uniform float uCrtMask; uniform float uCrtChroma; uniform float uCrtCourbure; uniform float uCrtNiveaux; uniform float uCrtScanGrille; uniform float uCrtPixelTampon; uniform float uCrtScanPxTampon;
    uniform sampler2D tCelProf; uniform vec4 uCel; uniform vec2 uCelRes; uniform vec2 uCelProf; uniform vec3 uCelLigne; uniform vec3 uCelPersp;
    // § E5.AB.12 : profondeur du tampon → fraction linéaire de [near, far] (ortho : déjà linéaire, inchangée)
    float srProfLin( float d ) { return uCelPersp.x > 0.5 ? ( uCelPersp.y * uCelPersp.z / ( uCelPersp.z - d * ( uCelPersp.z - uCelPersp.y ) ) - uCelPersp.y ) / ( uCelPersp.z - uCelPersp.y ) : d; }
    uniform vec3 uCelR0; uniform vec3 uCelR1; uniform vec3 uCelR2; uniform vec3 uCelR3;
    // look-cel : rampe de palette à 4 teintes, lue sur la clarté perceptive (gamma 2,2)
    vec3 srCelRampe( float g ) {
      vec3 a = mix( uCelR0, uCelR1, smoothstep( 0.0, 0.34, g ) );
      a = mix( a, uCelR2, smoothstep( 0.3, 0.68, g ) );
      return mix( a, uCelR3, smoothstep( 0.62, 1.0, g ) );
    }
    ${agx ? AGX : ACES}
    float crtBayer2( vec2 a ) { a = floor( a ); return fract( dot( a, vec2( 0.5, a.y * 0.75 ) ) ); }
    float crtBayer( vec2 a ) { return crtBayer2( 0.5 * a ) * 0.25 + crtBayer2( a ); } // seuil de Bayer 4 × 4 (0..1)
    void main() {
      // --- CRT / pixel : coordonnées (bombé, puis grille des gros pixels) ---
      vec2 uv = vUv;
      float horsEcran = 0.0;
      if ( uCrtCourbure > 0.0 ) {
        vec2 cc = uv * 2.0 - 1.0;
        cc *= 1.0 + uCrtCourbure * dot( cc, cc ) * vec2( 0.6, 1.0 );
        cc /= 1.0 + uCrtCourbure * 1.6 * 0.5;
        uv = cc * 0.5 + 0.5;
        vec2 bord = smoothstep( vec2( 0.0 ), vec2( 0.004 ), uv ) * smoothstep( vec2( 0.0 ), vec2( 0.004 ), 1.0 - uv );
        horsEcran = 1.0 - bord.x * bord.y;
      }
      float bloc = uCrtPixel * uCrtDpr + uCrtPixelTampon; // côté d'un gros pixel en pixels du tampon
      vec2 cellule = uv * uCrtRes / max( bloc, 1.0 ); // position dans la grille des gros pixels
      if ( bloc > 1.0 ) uv = ( floor( cellule ) + 0.5 ) * bloc / uCrtRes;
      vec4 c = texture2D( tDiffuse, uv );
      if ( uCrtChroma > 0.0 ) { // aberration : rouge vers l'extérieur, bleu vers l'intérieur, nulle au centre
        vec2 dir = ( uv - 0.5 ) * 2.0;
        vec2 o = dir * dot( dir, dir ) * 0.5 * uCrtChroma * uCrtDpr / uCrtRes;
        c.r = texture2D( tDiffuse, uv + o ).r;
        c.b = texture2D( tDiffuse, uv - o ).b;
      }
      if ( uDiorama.x > 0.0 ) {
        // diorama : bande floue en haut et en bas (flou à 1/4, déjà adouci)
        float bnd = max( smoothstep( 1.0 - uDiorama.y, 1.0, uv.y ), smoothstep( uDiorama.y, 0.0, uv.y ) );
        c.rgb = mix( c.rgb, texture2D( tDiorama, uv ).rgb, bnd * uDiorama.x );
      }
      // § E5.P (B1) : halo atténué près du centre du héros (distance à l'écran en m : projection orthographique)
      float haloK = 1.0;
      if ( uHalo.w > 0.5 ) {
        vec4 hp = uHaloProj * uHaloVue * vec4( uHaloHeros.xyz, 1.0 );
        vec2 dm = ( uv * 2.0 - 1.0 - hp.xy / hp.w ) / vec2( uHaloProj[0][0], uHaloProj[1][1] ) * hp.w; // × w : m à la profondeur du héros en perspective (ortho : w = 1)
        haloK = mix( uHalo.z, 1.0, clamp( ( length( dm ) - uHalo.x ) / max( uHalo.y - uHalo.x, 1e-3 ), 0.0, 1.0 ) );
      }${add.replace(/vUv/g, 'uv')}
      vec3 col = ${fn}( c.rgb * uExposure );
      float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = max( mix( vec3( l ), col, uSaturation ), 0.0 );
      // courbe en S dans un espace perceptif (gamma 2,2) : couleurs plus franches sans écraser les ombres au noir
      vec3 g = pow( min( col, 1.0 ), vec3( 1.0 / 2.2 ) );
      g = mix( g, g * g * ( 3.0 - 2.0 * g ), uContrast );
      col = pow( g, vec3( 2.2 ) );
      l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = max( col + uChaud * l + uFroid * ( 1.0 - l ), 0.0 ); // hautes lumières chaudes, ombres froides (passe 5)
      col += uShadowLift * ( 1.0 - smoothstep( 0.0, uShadowEdge, l ) );
      if ( uCel.x > 0.0 ) {
        // look-cel : la scène passe dans la rampe rose / rouge ; les émissifs (canal fort au-dessus du seuil) gardent
        // leur couleur, et une part de la teinte d'origine reste (force < 1 : accents orange, yeux, tirs)
        float mx = max( col.r, max( col.g, col.b ) );
        float gc = pow( clamp( dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0, 1.0 ), 1.0 / 2.2 );
        col = mix( col, srCelRampe( gc ), uCel.x * ( 1.0 - smoothstep( uCel.w, 1.0, mx ) ) );
      }
      if ( uCel.y > 0.0 ) {
        // look-cel : contour clair des silhouettes — ce pixel est DEVANT un voisin plus loin d'au moins uCelProf.y
        vec2 o = uCel.z / uCelRes;
        float d0 = srProfLin( texture2D( tCelProf, uv ).x );
        float dm = srProfLin( max( max( texture2D( tCelProf, uv + vec2( o.x, 0.0 ) ).x, texture2D( tCelProf, uv - vec2( o.x, 0.0 ) ).x ),
                        max( texture2D( tCelProf, uv + vec2( 0.0, o.y ) ).x, texture2D( tCelProf, uv - vec2( 0.0, o.y ) ).x ) ) );
        float e = smoothstep( uCelProf.y, uCelProf.y * 1.6, ( dm - d0 ) * uCelProf.x );
        col = mix( col, uCelLigne, e * uCel.y );
      }
      // --- CRT / pixel : postérisation tramée, lignes, grille RVB, bord du tube ---
      if ( uCrtNiveaux > 0.0 ) {
        vec3 gp = pow( clamp( col, 0.0, 1.0 ), vec3( 1.0 / 2.2 ) ) * ( uCrtNiveaux - 1.0 );
        vec2 trame = bloc > 1.0 ? cellule : gl_FragCoord.xy / uCrtDpr;
        gp = floor( gp + crtBayer( trame ) ) / ( uCrtNiveaux - 1.0 );
        col = pow( gp, vec3( 2.2 ) );
      }
      if ( uCrtScan > 0.0 ) {
        float ph;
        if ( bloc > 1.0 && uCrtScanGrille > 0.5 ) ph = fract( cellule.y ); // une ligne sombre entre deux rangées de gros pixels
        else ph = fract( gl_FragCoord.y / ( uCrtScanPxTampon > 0.0 ? uCrtScanPxTampon : uCrtScanPx * uCrtDpr ) );
        float ligne = 0.5 - 0.5 * cos( ph * 6.2831853 ); // 0 au joint, 1 au milieu de la ligne
        ligne = pow( ligne, 0.6 );
        col *= mix( 1.0, ligne, uCrtScan ) * ( 1.0 + uCrtScan * 0.45 ); // gain : la luminosité moyenne tient
      }
      if ( uCrtMask > 0.0 ) {
        float k = mod( floor( gl_FragCoord.x / max( uCrtDpr, 1.0 ) ), 3.0 );
        vec3 m = k < 0.5 ? vec3( 1.25, 0.8, 0.8 ) : k < 1.5 ? vec3( 0.8, 1.25, 0.8 ) : vec3( 0.8, 0.8, 1.25 );
        col *= mix( vec3( 1.0 ), m / 0.95, uCrtMask );
      }
      col = mix( col, vec3( 0.0 ), horsEcran );
      float d = length( ( vUv - 0.5 ) * 2.0 ) * 0.7071;
      float v = smoothstep( uVignetteStart, 1.0, d );
      col *= 1.0 - uVignette * v;
      col = mix( col, uEdgeColor, clamp( uEdgeFlash * v, 0.0, 1.0 ) );
      gl_FragColor = sRGBTransferOETF( vec4( clamp( col, 0.0, 1.0 ), 1.0 ) );
    }`,
  };
}

/**
 * Branche look-cel : réglages « image » d'une variante de PEINT.cel sur les uniformes d'une passe finale (rampe de
 * palette, contour). Rend vrai si le contour est actif (la passe doit alors recevoir la profondeur de la scène).
 */
export function appliquerCelPost(u, o = {}) {
  const r = o.rampe || [0, 0, 0, 0];
  u.uCelR0.value.set(r[0]);
  u.uCelR1.value.set(r[1]);
  u.uCelR2.value.set(r[2]);
  u.uCelR3.value.set(r[3]);
  u.uCelLigne.value.set(o.contourCouleur === undefined ? 0xffd2cc : o.contourCouleur);
  u.uCel.value.set(o.etalonnage || 0, o.contour || 0, o.contourPx || 1.5, o.garde === undefined ? 0.92 : o.garde);
  u.uCelProf.value.y = o.contourM || 0.35;
  return (o.contour || 0) > 0;
}

/** Variante de PEINT.cel au chargement : ?cel=N dans l'URL, sinon PEINT.cel.actif. */
export function celDuChargement() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('cel') : null;
  const n = q === null ? PEINT.cel.actif : Number(q) | 0;
  return n >= 0 && n < PEINT.cel.variantes.length ? n : 0;
}

/** Seuil de l'ancienne passe de bloom (passe 3 du prototype) ; le jeu intégré utilise bloom.js (PEINT.bloom). */
export const SEUIL_BLOOM = PEINT.post.seuilBloom;
