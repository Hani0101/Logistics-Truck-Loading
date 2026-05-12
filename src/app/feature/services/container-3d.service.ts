import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { TruckDimensions } from '../../shared/models/truck.models';
import { Truck3DService } from './truck-3d.service';
import { CrateLoaderService } from './crate-loader.service';
import { Chromosome } from '../../shared/models/genetic.models';
import { Container } from '../../shared/models/container.models';
import { ContainerPayload } from './layout';

@Injectable({ providedIn: 'root' })
export class Container3DService {
  private containers: Map<string, Container> = new Map();
  private scene!: THREE.Scene;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private draggedContainer: Container | null = null;
  private selectedContainer: Container | null = null;
  private dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private dragPoint = new THREE.Vector3();
  private visualHelperMesh: THREE.Mesh | null = null;
  private truckDimensions!: TruckDimensions;
  private camera!: THREE.Camera;

  constructor(
    private truck3DService: Truck3DService,
    private crateLoader: CrateLoaderService,
  ) {}

  initialize(scene: THREE.Scene, camera: THREE.Camera, truckDimensions: TruckDimensions): void {
    this.scene = scene;
    this.camera = camera;
    this.truckDimensions = truckDimensions;
  }

  async addContainer(containerData: Container): Promise<Container[]> {
    const scaleFactor = 0.001;
    const width  = containerData.width  * scaleFactor;
    const length = containerData.length * scaleFactor;
    const height = containerData.height * scaleFactor;

    const results: Container[] = [];
    const isModel = containerData.containerType !== 'box' && containerData.containerType != null;

    // All containers from the same addContainer call share a groupId
    const groupId = `group-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    if (isModel) {
      await this.crateLoader.preload(containerData.containerType);
    }

    const geometry = isModel ? null : new THREE.BoxGeometry(width, height, length);

    for (let i = 0; i < containerData.amount; i++) {
      const id = `container-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      let mesh: THREE.Mesh | THREE.Group;
      let originalMaterial: THREE.MeshStandardMaterial | undefined;

      if (isModel) {
        mesh = this.crateLoader.cloneAndScale(containerData.containerType!, containerData.width, containerData.length, containerData.height);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      } else {
        const material = new THREE.MeshStandardMaterial({
          color: containerData.color ? parseInt(containerData.color.replace('#', ''), 16) : 0x3b82f6,
          metalness: 0.3,
          roughness: 0.4,
          transparent: true,
          opacity: 0.8,
        });
        const boxMesh = new THREE.Mesh(geometry!, material);
        boxMesh.castShadow = true;
        boxMesh.receiveShadow = true;
        boxMesh.add(
          new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry!),
            new THREE.LineBasicMaterial({
              color: containerData.color ? parseInt(containerData.color.replace('#', ''), 16) : 0x3b82f6,
              linewidth: 2,
            })
          )
        );
        originalMaterial = material;
        mesh = boxMesh;
      }

      const initialPosition = new THREE.Vector3(i * (width + 0.05), height / 2, 0);
      mesh.position.copy(initialPosition);
      mesh.userData['containerId'] = id;
      this.scene.add(mesh);

      const container: Container = {
        id,
        groupId,
        containerType: containerData.containerType ?? 'box',
        width, length, height,
        color: containerData.color,
        weight: containerData.weight,
        itemCount: containerData.itemCount ?? 0,
        itemWeightG: containerData.itemWeightG ?? 0,
        amount: 1,
        position: initialPosition,
        mesh,
        originalMaterial,
      };

      this.containers.set(id, container);
      results.push(container);
    }

    return results;
  }

  syncIdsFromApi(apiContainers: (ContainerPayload & { id: string })[]): void {
    const posKey = (x: number, y: number, z: number) =>
      `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;

    const apiByPos = new Map<string, ContainerPayload & { id: string }>();
    for (const api of apiContainers) {
      if (api.position) {
        apiByPos.set(posKey(api.position.x, api.position.y, api.position.z), api);
      }
    }

    const newMap = new Map<string, Container>();

    for (const local of this.containers.values()) {
      if (!local.position) {
        newMap.set(local.id!, local);
        continue;
      }

      const key = posKey(local.position.x, local.position.y, local.position.z);
      const api = apiByPos.get(key);

      if (api) {
        local.id = api.id;
        local.mesh!.userData['containerId'] = api.id;
        newMap.set(api.id, local);
        apiByPos.delete(key);
      } else {
        newMap.set(local.id!, local);
      }
    }

    this.containers = newMap;
  }

  async rebuildFromLayout(apiContainers: (ContainerPayload & { id: string })[]): Promise<void> {
    this.clear();

    const modelTypes = [...new Set(
      apiContainers.filter((c) => c.containerType && c.containerType !== 'box').map((c) => c.containerType!)
    )];
    await Promise.all(modelTypes.map((t) => this.crateLoader.preload(t)));

    // Infer groupId from matching dimensions + color + type
    const groupKey = (c: ContainerPayload) =>
      `${c.width.toFixed(6)}_${c.length.toFixed(6)}_${c.height.toFixed(6)}_${c.color ?? ''}_${c.containerType ?? 'box'}`;
    const groupMap = new Map<string, string>();

    for (const c of apiContainers) {
      const key = groupKey(c);
      if (!groupMap.has(key)) {
        groupMap.set(key, `group-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
      }

      const isModel = c.containerType && c.containerType !== 'box';
      let mesh: THREE.Mesh | THREE.Group;
      let originalMaterial: THREE.MeshStandardMaterial | undefined;

      const rw = (c as any).effectiveWidth  ?? c.width;
      const rl = (c as any).effectiveLength ?? c.length;
      const rh = (c as any).effectiveHeight ?? c.height;

      if (isModel) {
        mesh = this.crateLoader.cloneAndScale(c.containerType!, rw, rl, rh);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      } else {
        const colorHex = c.color ? parseInt(c.color.replace('#', ''), 16) : 0x3b82f6;
        const geometry = new THREE.BoxGeometry(rw, rh, rl);
        const material = new THREE.MeshStandardMaterial({
          color: colorHex, metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0.8,
        });
        const boxMesh = new THREE.Mesh(geometry, material);
        boxMesh.castShadow = true;
        boxMesh.receiveShadow = true;
        boxMesh.add(
          new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: colorHex, linewidth: 2 })
          )
        );
        originalMaterial = material;
        mesh = boxMesh;
      }

      const pos = c.position
        ? new THREE.Vector3(c.position.x, c.position.y, c.position.z)
        : new THREE.Vector3(0, rh / 2, 0);

      mesh.position.copy(pos);
      mesh.userData['containerId'] = c.id;
      this.scene.add(mesh);

      this.containers.set(c.id, {
        id: c.id,
        groupId: groupMap.get(key),
        containerType: c.containerType ?? 'box',
        width: c.width, length: c.length, height: c.height,
        color: c.color, weight: c.weight, amount: 1,
        position: pos, mesh, originalMaterial,
      });
    }
  }

  updateSingleContainerPosition(id: string, position: THREE.Vector3): void {
    const container = this.containers.get(id);
    if (container?.mesh && container.position) {
      container.position.copy(position);
      container.mesh.position.copy(position);
    }
  }

  applyEffectiveDimensions(id: string, dims: { width: number; length: number; height: number }): void {
    const container = this.containers.get(id);
    if (!container) return;

    const sameW = Math.abs(dims.width  - container.width)  < 1e-9;
    const sameL = Math.abs(dims.length - container.length) < 1e-9;
    const sameH = Math.abs(dims.height - container.height) < 1e-9;
    if (sameW && sameL && sameH) return;

    container.effectiveWidth  = dims.width;
    container.effectiveLength = dims.length;
    container.effectiveHeight = dims.height;

    if (container.containerType === 'box' && container.mesh instanceof THREE.Mesh) {
      const newGeom = new THREE.BoxGeometry(dims.width, dims.height, dims.length);
      // Do NOT dispose the old geometry — it is shared across all containers added
      // in the same batch (addContainer creates one BoxGeometry for all `amount` copies).
      // Disposing it would silently destroy every sibling container's mesh.
      container.mesh.geometry = newGeom;

      const edges = container.mesh.children[0];
      if (edges instanceof THREE.LineSegments) {
        edges.geometry.dispose(); // EdgesGeometry is NOT shared — safe to dispose
        edges.geometry = new THREE.EdgesGeometry(newGeom);
      }
    } else if (container.containerType !== 'box' && container.mesh) {
      const scaledMesh = this.crateLoader.cloneAndScale(
        container.containerType!, dims.width, dims.length, dims.height,
      );
      const pos = container.mesh.position.clone();
      this.scene.remove(container.mesh);
      scaledMesh.position.copy(pos);
      scaledMesh.userData['containerId'] = id;
      this.scene.add(scaledMesh);
      container.mesh = scaledMesh;
    }
  }

  serializeForApi(): ContainerPayload[] {
    return Array.from(this.containers.values()).map((c) => ({
      width: c.width, length: c.length, height: c.height,
      weight: c.weight, amount: c.amount, color: c.color,
      containerType: c.containerType,
      position: c.position
        ? { x: c.position.x, y: c.position.y, z: c.position.z }
        : undefined,
    }));
  }

  startDrag(event: MouseEvent, containerMesh: THREE.Object3D, camera: THREE.Camera): void {
    const containerId = containerMesh.userData['containerId'];
    const container = this.containers.get(containerId);
    if (!container?.position) return;

    if (this.selectedContainer && this.selectedContainer.id !== container.id) {
      this.deselectContainer(this.selectedContainer);
    }

    this.draggedContainer = container;
    this.selectedContainer = container;
    this.camera = camera;
    this.truck3DService.disableControls();
    this.selectContainer(container);
    this.updateMousePosition(event);
    this.dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), container.position);
    this.showVisualHelper(container);
  }

  drag(event: MouseEvent, camera: THREE.Camera): void {
    if (!this.draggedContainer?.position || !this.draggedContainer.mesh) return;
    this.updateMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, camera);
    this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint);
    this.draggedContainer.position.copy(this.dragPoint);
    this.draggedContainer.mesh.position.copy(this.dragPoint);
    if (this.visualHelperMesh) {
      this.visualHelperMesh.position.copy(this.dragPoint);
      this.updateHelperColor();
    }
  }

  endDrag(): void {
    this.truck3DService.enableControls();
    this.draggedContainer = null;
    this.hideVisualHelper();
  }

  selectContainer(container: Container): void {
    if (!container.mesh || container.containerType !== 'box') return;
    const mat = (container.mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(0xffd700);
    mat.emissiveIntensity = 0.4;
  }

  deselectContainer(container: Container): void {
    if (!container?.mesh || container.containerType !== 'box') return;
    const mat = (container.mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 0;
  }

  private showVisualHelper(container: Container): void {
    if (!container.position) return;
    if (this.visualHelperMesh) this.scene.remove(this.visualHelperMesh);
    const hw = (container.effectiveWidth  ?? container.width)  * 1.05;
    const hh = (container.effectiveHeight ?? container.height) * 1.05;
    const hl = (container.effectiveLength ?? container.length) * 1.05;
    this.visualHelperMesh = new THREE.Mesh(
      new THREE.BoxGeometry(hw, hh, hl),
      new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.2, wireframe: true })
    );
    this.visualHelperMesh.position.copy(container.position);
    this.scene.add(this.visualHelperMesh);
  }

  private hideVisualHelper(): void {
    if (this.visualHelperMesh) {
      this.scene.remove(this.visualHelperMesh);
      this.visualHelperMesh = null;
    }
  }

  private updateHelperColor(): void {
    if (!this.visualHelperMesh || !this.draggedContainer) return;
    (this.visualHelperMesh.material as THREE.MeshBasicMaterial).color.setHex(
      this.isContainerInside(this.draggedContainer) ? 0x10b981 : 0xef4444
    );
  }

  private isContainerInside(container: Container): boolean {
    const f = 0.001;
    const tw = this.truckDimensions.width * f;
    const tl = this.truckDimensions.length * f;
    const th = this.truckDimensions.height * f;
    const pos = container.position;
    if (!pos) return false;
    const cw = container.effectiveWidth  ?? container.width;
    const cl = container.effectiveLength ?? container.length;
    const ch = container.effectiveHeight ?? container.height;
    return (
      pos.x - cw / 2 >= -tw / 2 &&
      pos.x + cw / 2 <=  tw / 2 &&
      pos.z - cl / 2 >= -tl / 2 &&
      pos.z + cl / 2 <=  tl / 2 &&
      pos.y - ch / 2 >= 0 &&
      pos.y + ch / 2 <=  th
    );
  }

  private updateMousePosition(event: MouseEvent): void {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    this.mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
  }

  getContainers(): Container[] {
    return Array.from(this.containers.values());
  }

  getContainerAt(raycaster: THREE.Raycaster): THREE.Object3D | null {
    const meshes = Array.from(this.containers.values()).map((c) => c.mesh!);
    const intersects = raycaster.intersectObjects(meshes, true);
    if (!intersects.length) return null;
    let obj: THREE.Object3D = intersects[0].object;
    while (obj && !obj.userData['containerId']) obj = obj.parent!;
    return obj ?? null;
  }

  updateLayout(layout: Chromosome): void {
    layout.genes.forEach((container, i) => {
      const sc = this.containers.get(container.id!);
      if (sc?.position && sc.mesh) {
        sc.position.copy(layout.positions[i]);
        sc.mesh.position.copy(layout.positions[i]);
      }
    });
  }

  removeContainer(id: string): void {
    const c = this.containers.get(id);
    if (c?.mesh) this.scene.remove(c.mesh);
    this.containers.delete(id);
  }

  clear(): void {
    this.containers.forEach((c) => { if (c.mesh) this.scene.remove(c.mesh); });
    this.containers.clear();
    this.selectedContainer = null;
    this.draggedContainer = null;
  }
}
