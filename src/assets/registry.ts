import registry from '../../mint-assets.json';

type ArtifactRecord = {
  artifactId: string;
  role: string;
  localPath: string;
  loaderHint: string;
  extensionsRequired?: string[];
};

type AssetRecord = {
  mode: string;
  artifacts: Record<string, ArtifactRecord>;
};

const assets = (registry as { assets: Record<string, AssetRecord> }).assets;

/** Converts a Vite public-root path such as `public/assets/mint/x.glb` into a browser URL. */
function toUrl(localPath: string): string {
  const normalized = localPath.replaceAll('\\', '/');
  const stripped = normalized.startsWith('public/') ? normalized.slice('public/'.length) : normalized;
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${stripped}`;
}

function record(key: string): AssetRecord {
  const asset = assets[key];
  if (!asset) throw new Error(`mint-assets.json has no asset with key "${key}".`);
  return asset;
}

/** Browser URL of the canonical GLB for a registry key. */
export function modelUrl(key: string): string {
  const asset = record(key);
  const artifact =
    Object.values(asset.artifacts).find((a) => a.role === 'canonical_model') ??
    Object.values(asset.artifacts).find((a) => a.loaderHint === 'gltf');
  if (!artifact) throw new Error(`Registry asset "${key}" has no GLB artifact.`);
  return toUrl(artifact.localPath);
}

/** Browser URL of one material map (artifact id such as `map_basecolor`). */
export function materialMapUrl(key: string, artifactId: string): string | null {
  const artifact = record(key).artifacts[artifactId];
  return artifact ? toUrl(artifact.localPath) : null;
}

/** Tile value → registry key for the eleven stone blocks. */
export const TILE_VALUES = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048] as const;
export const tileKey = (value: number): string => `tile-${value}`;
export const RUBBLE_KEYS = ['rubble-a', 'rubble-b', 'rubble-c'] as const;
export const BOARD_MATERIAL_KEY = 'board-slate';
