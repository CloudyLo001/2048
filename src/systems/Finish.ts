import * as THREE from 'three';

export type FinishName = 'natural' | 'polished' | 'matte' | 'plastic' | 'metallic' | 'wet';

export const FINISHES: FinishName[] = ['natural', 'polished', 'matte', 'plastic', 'metallic', 'wet'];

export function isFinish(value: string): value is FinishName {
  return (FINISHES as string[]).includes(value);
}

type Preset = {
  roughness: number;
  metalness: number | null;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
  sheen: number;
};

const PRESETS: Record<Exclude<FinishName, 'natural'>, Preset> = {
  polished: { roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.1, sheen: 0 },
  matte: { roughness: 0.97, metalness: 0, clearcoat: 0, clearcoatRoughness: 1, envMapIntensity: 0.45, sheen: 0 },
  plastic: { roughness: 0.38, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.3, envMapIntensity: 0.9, sheen: 0.15 },
  metallic: { roughness: 0.32, metalness: 0.92, clearcoat: 0, clearcoatRoughness: 1, envMapIntensity: 1.6, sheen: 0 },
  wet: { roughness: 0.06, metalness: null, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8, sheen: 0 },
};

type Original = {
  roughness: number;
  metalness: number;
  roughnessMap: THREE.Texture | null;
  metalnessMap: THREE.Texture | null;
  envMapIntensity: number;
};

/**
 * Converts each block material to MeshPhysicalMaterial once (so clearcoat is available)
 * and remembers the generated values so "Natural" restores the asset exactly as delivered.
 */
export class FinishController {
  private readonly materials = new Map<THREE.MeshPhysicalMaterial, Original>();
  current: FinishName = 'natural';

  /** Upgrade a loaded model's materials in place and register them for finish switching. */
  adopt(root: THREE.Object3D): void {
    const converted = new Map<THREE.Material, THREE.Material>();
    const convert = (m: THREE.Material): THREE.Material => {
      const cached = converted.get(m);
      if (cached) return cached;
      let phys: THREE.MeshPhysicalMaterial;
      if ((m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
        phys = m as THREE.MeshPhysicalMaterial;
      } else if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        phys = new THREE.MeshPhysicalMaterial();
        THREE.MeshStandardMaterial.prototype.copy.call(phys, m as THREE.MeshStandardMaterial);
        phys.name = m.name;
      } else {
        converted.set(m, m);
        return m;
      }
      if (!this.materials.has(phys)) {
        this.materials.set(phys, {
          roughness: phys.roughness,
          metalness: phys.metalness,
          roughnessMap: phys.roughnessMap,
          metalnessMap: phys.metalnessMap,
          envMapIntensity: phys.envMapIntensity,
        });
      }
      converted.set(m, phys);
      return phys;
    };
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
    });
    if (this.current !== 'natural') this.apply(this.current);
  }

  apply(name: FinishName): void {
    this.current = name;
    for (const [mat, orig] of this.materials) {
      if (name === 'natural') {
        mat.roughness = orig.roughness;
        mat.metalness = orig.metalness;
        mat.roughnessMap = orig.roughnessMap;
        mat.metalnessMap = orig.metalnessMap;
        mat.envMapIntensity = orig.envMapIntensity;
        mat.clearcoat = 0;
        mat.sheen = 0;
      } else {
        const p = PRESETS[name];
        mat.roughness = p.roughness;
        mat.metalness = p.metalness ?? orig.metalness;
        mat.roughnessMap = null;
        mat.metalnessMap = null;
        mat.envMapIntensity = p.envMapIntensity;
        mat.clearcoat = p.clearcoat;
        mat.clearcoatRoughness = p.clearcoatRoughness;
        mat.sheen = p.sheen;
        if (p.sheen > 0) mat.sheenColor.set(0xffffff);
      }
      mat.needsUpdate = true;
    }
  }
}
