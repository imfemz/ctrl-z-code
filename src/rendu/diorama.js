// RENDU « PEINT » — flou de profondeur en bande, effet diorama / tilt-shift (passe 5, option réglable).
//
// Copie floue de la scène HDR à 1/4 de la définition (descente 1/4 → 1/8 en filtre « dual », puis une remontée en
// tente vers 1/4), mêlée par la passe finale en haut et en bas de l'écran (bande réglable, force réglable, 0 = coupé).
// La caméra orthographique n'a pas de profondeur de champ réelle : la bande imite la maquette vue de près.
// Intégration (13/11/2026) : la première descente va DIRECTEMENT au quart (prises diagonales à ±1 texel de la pleine
// définition : chaque prise bilinéaire couvre 2 × 2 texels, l'ensemble un carré de 4 × 4) au lieu de passer par la
// demi-définition — 3 rendus au lieu de 4, et le plus cher (écriture d'un quart de l'écran à 5 lectures) disparaît.
// Aucune allocation par image.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
const DESC = /* glsl */ `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec3 s = texture2D( tSrc, vUv ).rgb * 4.0;
  s += texture2D( tSrc, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb + texture2D( tSrc, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb;
  s += texture2D( tSrc, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb + texture2D( tSrc, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb;
  gl_FragColor = vec4( s * 0.125, 1.0 );
}`;
const MONT = /* glsl */ `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec2 h = uTexel;
  vec3 s = texture2D( tSrc, vUv + vec2( -2.0 * h.x, 0.0 ) ).rgb + texture2D( tSrc, vUv + vec2( 2.0 * h.x, 0.0 ) ).rgb
         + texture2D( tSrc, vUv + vec2( 0.0, -2.0 * h.y ) ).rgb + texture2D( tSrc, vUv + vec2( 0.0, 2.0 * h.y ) ).rgb
         + 2.0 * ( texture2D( tSrc, vUv + vec2( -h.x, h.y ) ).rgb + texture2D( tSrc, vUv + vec2( h.x, h.y ) ).rgb
                 + texture2D( tSrc, vUv + vec2( -h.x, -h.y ) ).rgb + texture2D( tSrc, vUv + vec2( h.x, -h.y ) ).rgb );
  gl_FragColor = vec4( s / 12.0, 1.0 );
}`;

export class FlouDiorama extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    const o = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.d = [new THREE.WebGLRenderTarget(1, 1, o), new THREE.WebGLRenderTarget(1, 1, o)]; // 1/4, 1/8
    this.m = new THREE.WebGLRenderTarget(1, 1, o);
    this.texture = this.m.texture;
    // un #define par niveau : un programme (donc un cache d'uniformes) par niveau, uTexel n'est pas renvoyé à chaque image
    const mat = (f, n) => new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, vertexShader: VERT, fragmentShader: f, depthTest: false, depthWrite: false, defines: { SR_NIVEAU_DIO: n } });
    this.md = [mat(DESC, 0), mat(DESC, 1)];
    this.mm = mat(MONT, 3);
    this.quad = new FullScreenQuad(null);
    this.w = 1;
    this.h = 1;
  }
  setSize(w, h) {
    this.w = w;
    this.h = h;
    this.d[0].setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
    this.d[1].setSize(Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 8)));
    this.m.setSize(this.d[0].width, this.d[0].height);
    this.md[0].uniforms.uTexel.value.set(1 / w, 1 / h); // ±1 texel de la pleine définition : carré de 4 × 4
    this.md[1].uniforms.tSrc.value = this.d[0].texture;
    this.md[1].uniforms.uTexel.value.set(0.5 / this.d[0].width, 0.5 / this.d[0].height);
    this.mm.uniforms.tSrc.value = this.d[1].texture;
    this.mm.uniforms.uTexel.value.set(0.5 / this.d[1].width, 0.5 / this.d[1].height);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.md[0].uniforms.tSrc.value = readBuffer.texture;
    for (let i = 0; i < 2; i++) {
      this.quad.material = this.md[i];
      renderer.setRenderTarget(this.d[i]);
      this.quad.render(renderer);
    }
    this.quad.material = this.mm;
    renderer.setRenderTarget(this.m);
    this.quad.render(renderer);
  }
}
