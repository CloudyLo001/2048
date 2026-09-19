import * as THREE from 'three';
import { createMintGltfLoader } from './gltf-runtime';
import { modelUrl, RUBBLE_KEYS, TILE_VALUES, tileKey } from './registry';
import type { FinishController } from '../systems/Finish';

export type TileTemplate = {
  value: number;
  /** Normalized model: footprint fits `size`, centered on x/z, bottom at y = 0. */
  root: THREE.Object3D;
  height: number;
  width: number;
};

export type RubbleTemplate = {
  root: THREE.Object3D;
  radius: number;
};

export type LoadProgress = (loaded: number, total: number) => void;

/**
 * Loads every generated block and rubble chunk once through the shared Draco-capable
 * loader, normalizes their bounds, and hands out lightweight clones.
 */
export class TileLibrary {
  private readonly tiles = new Map<number, TileTemplate>();
  private readonly rubble: RubbleTemplate[] = [];
  private readonly manager = new THREE.LoadingManager();
  private readonly loader = createMintGltfLoader({ manager: this.manager });
  private loadedCount = 0;

  constructor(
    private readonly tileSize: number,
    private readonly rubbleSize: number,
    private readonly finish: FinishController,
  ) {}

  get ready(): boolean {
    return this.tiles.size === TILE_VALUES.length && this.rubble.length === RUBBLE_KEYS.length;
  }

  async load(onProgress?: LoadProgress): Promise<void> {
    const total = TILE_VALUES.length + RUBBLE_KEYS.length;
    this.loadedCount = 0;
    const report = () => onProgress?.(this.loadedCount, total);
    report();

    const tileJobs = TILE_VALUES.map(async (value) => {
      const scene = await this.loadScene(modelUrl(tileKey(value)));
      const template = this.normalizeTile(scene, value);
      this.finish.adopt(template.root);
      this.tiles.set(value, template);
      this.loadedCount += 1;
      report();
    });
    const rubbleJobs = RUBBLE_KEYS.map(async (key) => {
      const scene = await this.loadScene(modelUrl(key));
      this.rubble.push(this.normalizeRubble(scene));
      this.loadedCount += 1;
      report();
    });
    await Promise.all([...tileJobs, ...rubbleJobs]);
  }

  private async loadScene(url: string): Promise<THREE.Object3D> {
    const gltf = await this.loader.loadAsync(url);
    const scene = gltf.scene;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return scene;
  }

  private normalizeTile(scene: THREE.Object3D, value: number): TileTemplate {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z, 1e-4);
    const scale = this.tileSize / footprint;
    const center = box.getCenter(new THREE.Vector3());
    const root = new THREE.Group();
    root.name = `tile-${value}`;
    scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    scene.scale.setScalar(scale);
    root.add(scene);
    return { value, root, height: size.y * scale, width: this.tileSize };
  }

  private normalizeRubble(scene: THREE.Object3D): RubbleTemplate {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z, 1e-4);
    const scale = this.rubbleSize / largest;
    const center = box.getCenter(new THREE.Vector3());
    const root = new THREE.Group();
    scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    scene.scale.setScalar(scale);
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.receiveShadow = false;
    });
    root.add(scene);
    return { root, radius: this.rubbleSize * 0.5 };
  }

  template(value: number): TileTemplate {
    const t = this.tiles.get(value);
    if (!t) throw new Error(`No block model loaded for value ${value}.`);
    return t;
  }

  /** Clone shares geometry and materials with the template, so finish changes apply everywhere. */
  cloneTile(value: number): THREE.Object3D {
    return this.template(value).root.clone(true);
  }

  cloneRubble(index: number): THREE.Object3D {
    const t = this.rubble[index % this.rubble.length];
    if (!t) throw new Error('Rubble models are not loaded.');
    return t.root.clone(true);
  }

  get rubbleCount(): number {
    return this.rubble.length;
  }

  dispose(): void {
    const seen = new Set<THREE.BufferGeometry | THREE.Material>();
    const disposeTree = (root: THREE.Object3D) => {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (!seen.has(mesh.geometry)) {
          seen.add(mesh.geometry);
          mesh.geometry.dispose();
        }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          for (const v of Object.values(m as unknown as Record<string, unknown>)) {
            if (v && typeof v === 'object' && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
          }
          m.dispose();
        }
      });
    };
    for (const t of this.tiles.values()) disposeTree(t.root);
    for (const r of this.rubble) disposeTree(r.root);
    this.tiles.clear();
    this.rubble.length = 0;
  }
}
