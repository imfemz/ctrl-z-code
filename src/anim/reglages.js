// ANIMATIONS — réglages. Intégrés le 13/11/2026 (étape « animations », ARCHITECTURE.md § Z sexies) : les valeurs vivent
// dans src/config.js (région « anim:reglages », export ANIM : même structure, mêmes noms qu'au prototype ; la caméra dans
// CAMERA.lead et SHAKE). Ce fichier ne fait que les réexporter, pour les modules de src/anim/ qui l'importent.
export { ANIM } from '../config.js';
