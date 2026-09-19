import * as THREE from 'three';

/** Cached canvas textures for tile numbers, placed as a floating decal above each block. */
export class LabelFactory {
  private readonly textures = new Map<number, THREE.CanvasTexture>();
  private readonly materials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly geometry = new THREE.PlaneGeometry(1, 1);

  private texture(value: number): THREE.CanvasTexture {
    let tex = this.textures.get(value);
    if (tex) return tex;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable for tile labels.');
    ctx.clearRect(0, 0, size, size);
    const text = String(value);
    const light = value >= 16;
    const fontSize = text.length <= 2 ? 150 : text.length === 3 ? 118 : 96;
    ctx.font = `800 ${fontSize}px "Clear Sans", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 22;
    ctx.strokeStyle = light ? 'rgba(40, 24, 10, 0.6)' : 'rgba(255, 250, 240, 0.75)';
    ctx.strokeText(text, size / 2, size / 2 + 6);
    ctx.fillStyle = light ? '#fbf6ee' : '#5b4a38';
    ctx.fillText(text, size / 2, size / 2 + 6);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.textures.set(value, tex);
    return tex;
  }

  private material(value: number): THREE.MeshBasicMaterial {
    let mat = this.materials.get(value);
    if (mat) return mat;
    mat = new THREE.MeshBasicMaterial({
      map: this.texture(value),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.materials.set(value, mat);
    return mat;
  }

  create(value: number, width: number, topY: number): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, this.material(value));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = topY;
    mesh.scale.setScalar(width);
    mesh.renderOrder = 2;
    mesh.name = 'label';
    return mesh;
  }

  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.textures.clear();
    this.materials.clear();
    this.geometry.dispose();
  }
}
