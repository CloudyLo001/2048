import * as THREE from 'three';

const TRAUMA_MAX = 1;
const TRAUMA_DECAY = 2.2;
const MAX_OFFSET = 0.22;
const MAX_ROLL = 0.02;

function pseudoNoise(t: number, seed: number): number {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export class ShakeRig {
  private trauma = 0;
  private time = 0;
  enabled = true;

  addTrauma(amount: number): void {
    if (!this.enabled) return;
    this.trauma = Math.min(TRAUMA_MAX, this.trauma + amount);
  }

  /** Call after the base camera transform has been written for this frame. */
  update(delta: number, camera: THREE.PerspectiveCamera): void {
    this.time += delta;
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * delta);
    if (this.trauma <= 0) return;
    const shake = this.trauma * this.trauma;
    const freq = this.time * 34;
    camera.position.x += MAX_OFFSET * shake * pseudoNoise(freq, 1);
    camera.position.y += MAX_OFFSET * shake * pseudoNoise(freq, 2);
    camera.position.z += MAX_OFFSET * shake * pseudoNoise(freq, 4);
    camera.rotation.z += MAX_ROLL * shake * pseudoNoise(freq, 3);
  }
}
