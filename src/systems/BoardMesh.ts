import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOARD_MATERIAL_KEY, materialMapUrl } from '../assets/registry';
import { SIZE } from '../game/Board';

export const CELL = 1.0;
export const TILE = 0.8;
export const POCKET_DEPTH = 0.13;
export const BOARD_HALF = (SIZE * CELL) / 2;
export const TRAY_RIM = 0.32;
const RAIL = 0.12;
const RIM = TRAY_RIM;
const BASE_THICKNESS = 0.42;
const TEXTURE_SCALE = 0.42;

/** World position of a grid cell center on the pocket floor. */
export function cellToWorld(r: number, c: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-BOARD_HALF + CELL * (c + 0.5), -POCKET_DEPTH, -BOARD_HALF + CELL * (r + 0.5));
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Rewrites UVs from world position so the slate tiles seamlessly across every box. */
function planarProjectUVs(geometry: THREE.BufferGeometry, scale: number): void {
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i, x * scale, z * scale);
    else if (nx >= nz) uv.setXY(i, z * scale, y * scale);
    else uv.setXY(i, x * scale, y * scale);
  }
  uv.needsUpdate = true;
}

/**
 * Procedural stone tray: a slab with a 4x4 grid of recessed pockets, skinned with the
 * generated slate PBR maps. Returns the mesh plus a promise that resolves when maps are in.
 */
export function createBoardMesh(): { mesh: THREE.Mesh; ready: Promise<void> } {
  const parts: THREE.BufferGeometry[] = [];
  const outer = BOARD_HALF + RIM;
  const floorTop = -POCKET_DEPTH;

  // Base slab whose top is the pocket floor.
  parts.push(boxAt(outer * 2, BASE_THICKNESS, outer * 2, 0, floorTop - BASE_THICKNESS / 2, 0));

  // Rails between pockets (top at y = 0).
  for (let i = 1; i < SIZE; i += 1) {
    const offset = -BOARD_HALF + CELL * i;
    parts.push(boxAt(RAIL, POCKET_DEPTH, BOARD_HALF * 2, offset, floorTop + POCKET_DEPTH / 2, 0));
    parts.push(boxAt(BOARD_HALF * 2, POCKET_DEPTH, RAIL, 0, floorTop + POCKET_DEPTH / 2, offset));
  }

  // Outer rim, slightly taller than the rails for a lip.
  const rimHeight = POCKET_DEPTH + 0.06;
  const rimY = floorTop + rimHeight / 2;
  parts.push(boxAt(RIM, rimHeight, outer * 2, -BOARD_HALF - RIM / 2, rimY, 0));
  parts.push(boxAt(RIM, rimHeight, outer * 2, BOARD_HALF + RIM / 2, rimY, 0));
  parts.push(boxAt(BOARD_HALF * 2, rimHeight, RIM, 0, rimY, -BOARD_HALF - RIM / 2));
  parts.push(boxAt(BOARD_HALF * 2, rimHeight, RIM, 0, rimY, BOARD_HALF + RIM / 2));

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('Failed to merge board geometry.');
  planarProjectUVs(merged, TEXTURE_SCALE);
  merged.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.name = 'board';
  mesh.receiveShadow = true;
  mesh.castShadow = true;

  const loader = new THREE.TextureLoader();
  const loadMap = async (artifactId: string, srgb: boolean): Promise<THREE.Texture | null> => {
    const url = materialMapUrl(BOARD_MATERIAL_KEY, artifactId);
    if (!url) return null;
    const tex = await loader.loadAsync(url);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return tex;
  };

  const ready = Promise.all([
    loadMap('map_basecolor', true),
    loadMap('map_normal', false),
    loadMap('map_roughness', false),
    loadMap('map_metalness', false),
  ]).then(([map, normalMap, roughnessMap, metalnessMap]) => {
    material.map = map;
    material.normalMap = normalMap;
    material.roughnessMap = roughnessMap;
    material.metalnessMap = metalnessMap;
    material.needsUpdate = true;
  });

  return { mesh, ready };
}
