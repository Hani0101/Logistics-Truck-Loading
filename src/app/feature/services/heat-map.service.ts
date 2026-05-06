import { Injectable, inject } from '@angular/core';
import * as THREE from 'three';
import { Truck3DService } from './truck-3d.service';
import { Container3DService } from './container-3d.service';
import { TruckDimensions } from '../../shared/models/truck.models';
import { Container } from '../../shared/models/container.models';

@Injectable({ providedIn: 'root' })
export class HeatMapService {
  private truck3DService = inject(Truck3DService);
  private container3DService = inject(Container3DService);

  private group: THREE.Group | null = null;
  private visible = false;

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(show: boolean, truck: TruckDimensions): void {
    this.visible = show;
    this.setContainersVisible(!show);
    if (show) {
      this.build(truck);
    } else {
      this.dispose();
    }
  }

  refresh(truck: TruckDimensions): void {
    if (!this.visible) return;
    this.setContainersVisible(false);
    this.build(truck);
  }

  dispose(): void {
    if (!this.group) return;
    this.truck3DService.getScene().remove(this.group);
    this.group.traverse((obj) => {
      const asSprite = obj as THREE.Sprite;
      if (asSprite.isSprite) {
        (asSprite.material as THREE.SpriteMaterial).map?.dispose();
        asSprite.material.dispose();
        return;
      }
      const asMesh = obj as THREE.Mesh;
      if (asMesh.isMesh || (obj as THREE.LineSegments).isLineSegments) {
        asMesh.geometry.dispose();
        const mat = asMesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material).dispose();
      }
    });
    this.group = null;
  }

  private setContainersVisible(visible: boolean): void {
    this.container3DService.getContainers().forEach((c) => {
      if (c.mesh) c.mesh.visible = visible;
    });
  }

  private build(truck: TruckDimensions): void {
    const containers = this.container3DService.getContainers();
    const cols = 12, rows = 20;
    const grid = this.computeWeightGrid(containers, truck, cols, rows);
    const f = 0.001;
    const tw = truck.width * f;
    const tl = truck.length * f;
    const th = (truck.height ?? 4000) * f;
    const cellW = tw / cols;
    const cellL = tl / rows;
    const maxBarH = th * 0.4;

    let maxW = 0;
    for (const row of grid) for (const v of row) if (v > maxW) maxW = v;

    this.dispose();
    this.group = new THREE.Group();

    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const t = maxW > 0 ? grid[r][col] / maxW : 0;
        if (t < 0.01) continue;

        const barH = Math.max(0.03, t * maxBarH);
        const cx = -tw / 2 + col * cellW + cellW / 2;
        const cz = -tl / 2 + r * cellL + cellL / 2;

        const geo = new THREE.BoxGeometry(cellW * 0.9, barH, cellL * 0.9);
        const mat = new THREE.MeshStandardMaterial({
          color: this.weightToHex(t),
          metalness: 0.1,
          roughness: 0.6,
          transparent: true,
          opacity: 0.88,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx, barH / 2, cz);
        mesh.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }),
        ));
        this.group.add(mesh);

        if (t >= 0.25) {
          this.group.add(this.createWeightLabel(grid[r][col] / 1000, t, barH, cx, cz, cellW, cellL));
        }
      }
    }

    this.truck3DService.getScene().add(this.group);
  }

  private createWeightLabel(
    weightKg: number, t: number, barH: number,
    cx: number, cz: number, cellW: number, cellL: number,
  ): THREE.Sprite {
    const cw = 220, ch = 72;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;

    const bgAlpha = 0.55 + t * 0.35;
    ctx.fillStyle = `rgba(8,10,14,${bgAlpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.roundRect(3, 3, cw - 6, ch - 6, 10);
    ctx.fill();

    ctx.strokeStyle = `rgba(255,255,255,${(0.2 + t * 0.3).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    const text = weightKg >= 1000
      ? `${(weightKg / 1000).toFixed(2)}t`
      : `${weightKg.toFixed(1)}kg`;
    const fontSize = Math.round(20 + t * 10);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = `rgba(255,255,255,${(0.75 + t * 0.25).toFixed(2)})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);

    const spriteW = Math.max(cellW, cellL) * 1.1;
    sprite.scale.set(spriteW, spriteW * (ch / cw), 1);
    sprite.position.set(cx, barH + spriteW * (ch / cw) * 0.55, cz);
    return sprite;
  }

  private computeWeightGrid(containers: Container[], truck: TruckDimensions, cols: number, rows: number): number[][] {
    const grid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
    const f = 0.001;
    const tw = truck.width * f;
    const tl = truck.length * f;
    const cellW = tw / cols;
    const cellL = tl / rows;

    for (const c of containers) {
      if (!c.position) continue;
      const weight = c.weight + (c.itemCount ?? 0) * (c.itemWeightG ?? 0);
      const cxMin = c.position.x - c.width / 2;
      const cxMax = c.position.x + c.width / 2;
      const czMin = c.position.z - c.length / 2;
      const czMax = c.position.z + c.length / 2;
      const containerArea = (cxMax - cxMin) * (czMax - czMin);
      if (containerArea <= 0) continue;

      const colMin = Math.max(0, Math.floor((cxMin + tw / 2) / cellW));
      const colMax = Math.min(cols - 1, Math.floor((cxMax + tw / 2) / cellW));
      const rowMin = Math.max(0, Math.floor((czMin + tl / 2) / cellL));
      const rowMax = Math.min(rows - 1, Math.floor((czMax + tl / 2) / cellL));

      for (let r = rowMin; r <= rowMax; r++) {
        const cellZMin = -tl / 2 + r * cellL;
        const overlapZ = Math.max(0, Math.min(czMax, cellZMin + cellL) - Math.max(czMin, cellZMin));
        for (let col = colMin; col <= colMax; col++) {
          const cellXMin = -tw / 2 + col * cellW;
          const overlapX = Math.max(0, Math.min(cxMax, cellXMin + cellW) - Math.max(cxMin, cellXMin));
          grid[r][col] += weight * (overlapX * overlapZ) / containerArea;
        }
      }
    }
    return grid;
  }

  private weightToHex(t: number): number {
    const stops: [number, number, number][] = [
      [0,   0,   255],
      [0,   255, 255],
      [0,   255, 0  ],
      [255, 255, 0  ],
      [255, 0,   0  ],
    ];
    const idx = t * (stops.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, stops.length - 1);
    const frac = idx - lo;
    const r = Math.round(stops[lo][0] + frac * (stops[hi][0] - stops[lo][0]));
    const g = Math.round(stops[lo][1] + frac * (stops[hi][1] - stops[lo][1]));
    const b = Math.round(stops[lo][2] + frac * (stops[hi][2] - stops[lo][2]));
    return (r << 16) | (g << 8) | b;
  }
}
