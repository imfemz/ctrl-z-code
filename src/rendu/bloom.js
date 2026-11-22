// RENDU « PEINT » — bloom multi-niveaux (passe 4 du 13/11/2026 : « un beau glow », référence de Femz).
//
// Remplaçant de la passe de bloom resserrée de render.js (BloomExtractPass, un seul niveau). Chaîne « dual filter »
// (Kawase double : descente 5 prises, remontée 8 prises en tente), 5 niveaux du 1/2 au 1/32 de la définition :
// halo DOUX et LARGE pour le prix de quelques rendus de petite taille.
//   1. extraction (demi-définition) : seuil sur le canal le plus fort avec genou doux, sur la scène HDR AVANT
//      exposition — seuls les émissifs (× uEmissiveBoost, ≥ 1,5) le passent, le sable au soleil jamais ;
//      la COULEUR est gardée (aucune désaturation : le halo d'un œil rouge est rouge) ;
//      garde-fou HORDE : l'intensité extraite est plafonnée par pixel (plafond), si bien que 400 petits yeux
//      n'additionnent pas un voile — et les niveaux larges pèsent moins que les niveaux proches (poids par niveau).
//   2. descente : niveaux 1 à 4, filtre 5 prises (centre × 4 + 4 diagonales), chaque niveau lisse le précédent ;
//   3. remontée : du plus large au plus fin, tente 8 prises, accumulée avec le niveau de descente × son poids.
// Sortie : this.texture (demi-définition, demi-flottant), additionnée par la passe finale × force.
// Rendus par image : 1 extraction + 4 descentes + 4 remontées, tous sous la demi-définition (≈ 0,45 × un rendu plein
// écran en pixels). Aucune allocation par image (uniformes écrits en place, cibles créées à setSize seulement).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { PEINT } from './reglages.js';

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;

const EXTRAIRE = /* glsl */ `
uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform vec3 uSeuil; uniform vec2 uVoile; uniform float uSatExt; varying vec2 vUv;
vec3 extraire( vec3 c ) {
  float m = max( c.r, max( c.g, c.b ) );
  // genou doux (seuil x, demi-largeur y) : pas de bord dur à l'entrée du bloom
  float q = clamp( m - uSeuil.x + uSeuil.y, 0.0, 2.0 * uSeuil.y );
  q = q * q / ( 4.0 * uSeuil.y + 1e-5 );
  float w = max( q, m - uSeuil.x ) / max( m, 1e-4 );
  c *= w;
  // plafond par pixel (z) : la teinte est gardée, l'intensité bornée — garde-fou de la horde et des lucioles
  float e = max( c.r, max( c.g, c.b ) );
  c *= min( 1.0, uSeuil.z / max( e, 1e-4 ) );
  // 17/11 (look des VFX) : chroma de ce qui entre dans le glow × uSatExt (1 = inchangé) — glow sur la couleur
  return max( mix( vec3( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ), c, uSatExt ), 0.0 );
}
// passe 5 : « voile lumineux » — une petite part des zones claires (au-dessus de uVoile.x) entre dans la chaîne large
vec3 voile( vec3 c ) { return max( c - vec3( uVoile.x ), 0.0 ) * uVoile.y; }
void main() {
  // 4 prises bilinéaires (16 texels) : sous-échantillonnage stable, sans scintillement des petits émissifs
  vec3 a0 = texture2D( tDiffuse, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb;
  vec3 b0 = texture2D( tDiffuse, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb;
  vec3 c0 = texture2D( tDiffuse, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb;
  vec3 d0 = texture2D( tDiffuse, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb;
  vec3 a = extraire( a0 ) + voile( a0 ), b = extraire( b0 ) + voile( b0 ), c = extraire( c0 ) + voile( c0 ), d = extraire( d0 ) + voile( d0 );
  gl_FragColor = vec4( ( a + b + c + d ) * 0.25, 1.0 );
}`;

const DESCENDRE = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec3 s = texture2D( tSrc, vUv ).rgb * 4.0;
  s += texture2D( tSrc, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb;
  s += texture2D( tSrc, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb;
  s += texture2D( tSrc, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb;
  s += texture2D( tSrc, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb;
  gl_FragColor = vec4( s * 0.125, 1.0 );
}`;

const REMONTER = /* glsl */ `
uniform sampler2D tSrc; uniform sampler2D tNiveau; uniform vec2 uTexel; uniform float uPoids; uniform float uPoidsSrc; varying vec2 vUv;
void main() {
  vec2 h = uTexel;
  vec3 s = texture2D( tSrc, vUv + vec2( -2.0 * h.x, 0.0 ) ).rgb + texture2D( tSrc, vUv + vec2( 2.0 * h.x, 0.0 ) ).rgb
         + texture2D( tSrc, vUv + vec2( 0.0, -2.0 * h.y ) ).rgb + texture2D( tSrc, vUv + vec2( 0.0, 2.0 * h.y ) ).rgb
         + 2.0 * ( texture2D( tSrc, vUv + vec2( -h.x, h.y ) ).rgb + texture2D( tSrc, vUv + vec2( h.x, h.y ) ).rgb
                 + texture2D( tSrc, vUv + vec2( -h.x, -h.y ) ).rgb + texture2D( tSrc, vUv + vec2( h.x, -h.y ) ).rgb );
  gl_FragColor = vec4( s / 12.0 * uPoidsSrc + texture2D( tNiveau, vUv ).rgb * uPoids, 1.0 );
}`;

// 17/11 (look des VFX, src/vfx/look.js) : 7 niveaux, jusqu'au 1/128 — la traîne longue du « deep glow ». Les deux
// derniers ont un poids nul par défaut (PEINT.bloom.poids en a 5) : le rendu d'avant est inchangé, pour deux rendus
// minuscules de plus par image.
export const NIVEAUX = 7;
const poidsDe = (p, i) => (i < p.length ? p[i] : 0);

export class BloomPeint extends Pass {
  constructor() {
    super();
    this.needsSwap = false; // n'écrit pas dans le tampon de la chaîne : la passe finale lit this.texture
    const B = PEINT.bloom;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.desc = [];
    this.mont = [];
    for (let i = 0; i < NIVEAUX; i++) {
      this.desc.push(new THREE.WebGLRenderTarget(1, 1, opts));
      this.mont.push(new THREE.WebGLRenderTarget(1, 1, opts));
    }
    this.texture = this.mont[0].texture;
    // niveau : #define propre à chaque niveau (intégration) — un programme par niveau, donc un cache d'uniformes par
    // niveau : leurs uTexel et poids, constants, ne sont plus renvoyés au GPU à chaque image (avec un programme partagé,
    // chaque bascule de niveau les renvoyait : ~10 envois par image, autant d'allocations dans three)
    const mat = (frag, uniforms, niveau = -1) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, defines: niveau >= 0 ? { SR_NIVEAU: niveau } : {} });
    this.mExtraire = mat(EXTRAIRE, {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uSeuil: { value: new THREE.Vector3(B.seuil, B.genou, B.plafond) },
      uVoile: { value: new THREE.Vector2(1e3, 0) }, // passe 5 : (seuil, force) ; coupé par défaut
      uSatExt: { value: 1 }, // 17/11 : saturation de l'extraction (look des VFX)
    });
    // un matériau par niveau : leurs uniformes (texel, source) ne changent qu'à setSize, jamais par image
    this.mDesc = [];
    this.mMont = [];
    for (let i = 0; i < NIVEAUX; i++) {
      this.mDesc.push(mat(DESCENDRE, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, i));
      this.mMont.push(mat(REMONTER, { tSrc: { value: null }, tNiveau: { value: null }, uTexel: { value: new THREE.Vector2() }, uPoids: { value: poidsDe(B.poids, i) }, uPoidsSrc: { value: i === NIVEAUX - 2 ? poidsDe(B.poids, NIVEAUX - 1) : 1 } }, i));
    }
    this.quad = new FullScreenQuad(null);
    this.actif = true;
  }

  setSize(w, h) {
    for (let i = 0; i < NIVEAUX; i++) {
      const lw = Math.max(1, Math.round(w / (2 << i)));
      const lh = Math.max(1, Math.round(h / (2 << i)));
      this.desc[i].setSize(lw, lh);
      this.mont[i].setSize(lw, lh);
    }
    this.mExtraire.uniforms.uTexel.value.set(0.5 / w, 0.5 / h); // demi-texel de la source pleine définition
    for (let i = 1; i < NIVEAUX; i++) {
      const s = this.desc[i - 1];
      this.mDesc[i].uniforms.tSrc.value = s.texture;
      this.mDesc[i].uniforms.uTexel.value.set(0.5 / s.width, 0.5 / s.height);
    }
    for (let i = 0; i < NIVEAUX - 1; i++) {
      const src = i === NIVEAUX - 2 ? this.desc[NIVEAUX - 1] : this.mont[i + 1];
      this.mMont[i].uniforms.tSrc.value = src.texture;
      this.mMont[i].uniforms.tNiveau.value = this.desc[i].texture;
      this.mMont[i].uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
    }
  }

  render(renderer, writeBuffer, readBuffer) {
    const q = this.quad;
    this.mExtraire.uniforms.tDiffuse.value = readBuffer.texture;
    q.material = this.mExtraire;
    renderer.setRenderTarget(this.desc[0]);
    q.render(renderer);
    for (let i = 1; i < NIVEAUX; i++) {
      q.material = this.mDesc[i];
      renderer.setRenderTarget(this.desc[i]);
      q.render(renderer);
    }
    // remontée : niveau i = tente(niveau i + 1) + descente i × poids i ; le plus large part de la descente 4 seule
    for (let i = NIVEAUX - 2; i >= 0; i--) {
      q.material = this.mMont[i];
      renderer.setRenderTarget(this.mont[i]);
      q.render(renderer);
    }
  }

  /** Look des VFX (17/11) : un poids par niveau, du plus fin au plus large (manquants = 0). */
  reglerPoids(p) {
    for (let i = 0; i < NIVEAUX - 1; i++) {
      this.mMont[i].uniforms.uPoids.value = poidsDe(p, i);
      this.mMont[i].uniforms.uPoidsSrc.value = i === NIVEAUX - 2 ? poidsDe(p, NIVEAUX - 1) : 1;
    }
  }

  /** Passe 5 : voile lumineux (seuil, force) ; force 0 = coupé. */
  voile(seuil, force) {
    this.mExtraire.uniforms.uVoile.value.set(seuil, force);
  }

  /** Réglages à chaud (prototype, niveau de qualité) : seuil, genou, plafond. */
  regler(seuil, genou, plafond) {
    this.mExtraire.uniforms.uSeuil.value.set(seuil, genou, plafond);
  }
}
