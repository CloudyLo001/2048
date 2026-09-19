import * as THREE from 'three';
import type { TileLibrary } from '../assets/TileLibrary';

type Chunk = {
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
  baseScale: number;
  bounced: boolean;
  active: boolean;
};

type Puff = {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
  active: boolean;
};

const GRAVITY = -16;
const POOL_CHUNKS = 72;
const POOL_PUFFS = 40;

function dustTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for dust.');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(214, 200, 176, 0.75)');
  g.addColorStop(0.45, 'rgba(200, 186, 160, 0.35)');
  g.addColorStop(1, 'rgba(190, 176, 150, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Pooled rock-collision debris: generated rubble chunks fly out, tumble, bounce once on
 * the board floor and shrink away, while soft dust sprites bloom and fade.
 */
export class RubbleSystem {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly puffs: Puff[] = [];
  private readonly dustMaterial: THREE.SpriteMaterial;
  private readonly dustTex = dustTexture();
  private floorY = 0;
  private trayHalf = Infinity;
  enabled = true;

  constructor(private readonly library: TileLibrary) {
    this.group.name = 'rubble';
    this.dustMaterial = new THREE.SpriteMaterial({
      map: this.dustTex,
      transparent: true,
      depthWrite: false,
      opacity: 1,
    });
  }

  /** Build the pools once the rubble models are loaded. */
  init(floorY: number, trayHalf: number): void {
    this.floorY = floorY;
    this.trayHalf = trayHalf;
    for (let i = 0; i < POOL_CHUNKS; i += 1) {
      const object = this.library.cloneRubble(i);
      object.visible = false;
      this.group.add(object);
      this.chunks.push({
        object,
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        baseScale: 1,
        bounced: false,
        active: false,
      });
    }
    for (let i = 0; i < POOL_PUFFS; i += 1) {
      const sprite = new THREE.Sprite(this.dustMaterial.clone());
      sprite.visible = false;
      this.group.add(sprite);
      this.puffs.push({
        sprite,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        startScale: 0.3,
        endScale: 1,
        active: false,
      });
    }
  }

  /**
   * Emit a collision burst at `center`. `dir` is the travel direction of the incoming
   * block (unit vector); debris sprays mostly sideways and up. `tier` scales intensity.
   */
  burst(center: THREE.Vector3, dir: THREE.Vector3, tier: number): void {
    if (!this.enabled || this.chunks.length === 0) return;
    const count = Math.min(18, 9 + tier);
    const power = 2.4 + tier * 0.22;
    let spawned = 0;
    for (const chunk of this.chunks) {
      if (chunk.active) continue;
      chunk.active = true;
      chunk.bounced = false;
      chunk.maxLife = 0.75 + Math.random() * 0.55;
      chunk.life = chunk.maxLife;
      chunk.baseScale = 0.55 + Math.random() * 0.75;
      const angle = Math.random() * Math.PI * 2;
      const side = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      // Bias away from the incoming direction so debris looks squeezed out of the seam.
      const bias = 1 - 0.6 * Math.max(0, side.dot(dir));
      const speed = power * (0.5 + Math.random() * 0.7) * bias;
      chunk.velocity.set(side.x * speed, 2.2 + Math.random() * 2.4 + tier * 0.12, side.z * speed);
      chunk.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      chunk.object.position.copy(center).add(new THREE.Vector3(side.x * 0.25, 0.25 + Math.random() * 0.3, side.z * 0.25));
      chunk.object.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      chunk.object.scale.setScalar(chunk.baseScale);
      chunk.object.visible = true;
      spawned += 1;
      if (spawned >= count) break;
    }

    const puffCount = 6 + Math.min(6, tier);
    let puffs = 0;
    for (const puff of this.puffs) {
      if (puff.active) continue;
      puff.active = true;
      puff.maxLife = 0.45 + Math.random() * 0.35;
      puff.life = puff.maxLife;
      puff.startScale = 0.25 + Math.random() * 0.2;
      puff.endScale = 0.9 + Math.random() * 0.6 + tier * 0.03;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 1.2;
      puff.velocity.set(Math.cos(angle) * speed, 0.5 + Math.random() * 0.8, Math.sin(angle) * speed);
      puff.sprite.position.copy(center).add(new THREE.Vector3(0, 0.2, 0));
      puff.sprite.scale.setScalar(puff.startScale);
      (puff.sprite.material as THREE.SpriteMaterial).opacity = 1;
      (puff.sprite.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
      puff.sprite.visible = true;
      puffs += 1;
      if (puffs >= puffCount) break;
    }
  }

  update(delta: number): void {
    for (const chunk of this.chunks) {
      if (!chunk.active) continue;
      chunk.life -= delta;
      if (chunk.life <= 0) {
        chunk.active = false;
        chunk.object.visible = false;
        continue;
      }
      chunk.velocity.y += GRAVITY * delta;
      chunk.object.position.addScaledVector(chunk.velocity, delta);
      chunk.object.rotation.x += chunk.spin.x * delta;
      chunk.object.rotation.y += chunk.spin.y * delta;
      chunk.object.rotation.z += chunk.spin.z * delta;
      const radius = 0.08 * chunk.baseScale;
      const p = chunk.object.position;
      const onTray = Math.abs(p.x) <= this.trayHalf && Math.abs(p.z) <= this.trayHalf;
      if (!onTray) {
        // Fell off the edge: keep dropping and retire once out of sight.
        if (p.y < this.floorY - 3) {
          chunk.active = false;
          chunk.object.visible = false;
        }
      } else if (p.y < this.floorY + radius) {
        chunk.object.position.y = this.floorY + radius;
        if (!chunk.bounced && chunk.velocity.y < -0.5) {
          chunk.velocity.y = -chunk.velocity.y * 0.32;
          chunk.velocity.x *= 0.55;
          chunk.velocity.z *= 0.55;
          chunk.spin.multiplyScalar(0.5);
          chunk.bounced = true;
        } else {
          chunk.velocity.set(0, 0, 0);
          chunk.spin.set(0, 0, 0);
        }
      }
      const k = chunk.life / chunk.maxLife;
      const shrink = k < 0.3 ? k / 0.3 : 1;
      chunk.object.scale.setScalar(chunk.baseScale * shrink);
    }

    for (const puff of this.puffs) {
      if (!puff.active) continue;
      puff.life -= delta;
      if (puff.life <= 0) {
        puff.active = false;
        puff.sprite.visible = false;
        continue;
      }
      const t = 1 - puff.life / puff.maxLife;
      puff.velocity.multiplyScalar(1 - 3 * delta);
      puff.sprite.position.addScaledVector(puff.velocity, delta);
      const scale = puff.startScale + (puff.endScale - puff.startScale) * (1 - Math.pow(1 - t, 2));
      puff.sprite.scale.setScalar(scale);
      (puff.sprite.material as THREE.SpriteMaterial).opacity = (1 - t) * 0.9;
    }
  }

  clear(): void {
    for (const c of this.chunks) {
      c.active = false;
      c.object.visible = false;
    }
    for (const p of this.puffs) {
      p.active = false;
      p.sprite.visible = false;
    }
  }

  dispose(): void {
    for (const p of this.puffs) (p.sprite.material as THREE.SpriteMaterial).dispose();
    this.dustMaterial.dispose();
    this.dustTex.dispose();
  }
}
