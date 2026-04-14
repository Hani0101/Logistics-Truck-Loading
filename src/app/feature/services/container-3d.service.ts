import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { TruckDimensions } from '../../shared/models/truck.models';
import { Truck3DService } from './truck-3d.service';
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

  constructor(private truck3DService: Truck3DService) {}

  initialize(scene: THREE.Scene, camera: THREE.Camera, truckDimensions: TruckDimensions): void {
    this.scene = scene;
    this.camera = camera;
    this.truckDimensions = truckDimensions;
  }

  addContainer(containerData: Container): Container[] {
    const scaleFactor = 0.001;
    const width  = containerData.width  * scaleFactor;
    const length = containerData.length * scaleFactor;
    const height = containerData.height * scaleFactor;

    const geometry = new THREE.BoxGeometry(width, height, length);
    const results: Container[] = [];

    for (let i = 0; i < containerData.amount; i++) {
      const id = `container-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const material = new THREE.MeshStandardMaterial({
        color: containerData.color ? parseInt(containerData.color.replace('#', ''), 16) : 0x3b82f6,
        metalness: 0.3,
        roughness: 0.4,
        transparent: true,
        opacity: 0.8,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({
            color: containerData.color ? parseInt(containerData.color.replace('#', ''), 16) : 0x3b82f6,
            linewidth: 2,
          })
        )
      );

      const initialPosition = new THREE.Vector3(i * (width + 0.05), height / 2, 0);
      mesh.position.copy(initialPosition);
      mesh.userData['containerId'] = id;
      this.scene.add(mesh);

      const container: Container = {
        id,
        width, length, height,
        color: containerData.color,
        weight: containerData.weight,
        amount: 1,
        position: initialPosition,
        mesh,
        originalMaterial: material,
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
        // Update the local container's id to the API UUID
        local.id = api.id;
        local.mesh!.userData['containerId'] = api.id;
        newMap.set(api.id, local);
        apiByPos.delete(key); // consume so duplicates don't double-match
      } else {
        // No match found — keep the old key
        newMap.set(local.id!, local);
      }
    }

    this.containers = newMap;
  }

  rebuildFromLayout(apiContainers: (ContainerPayload & { id: string })[]): void {
    this.clear();

    for (const c of apiContainers) {
      const colorHex = c.color ? parseInt(c.color.replace('#', ''), 16) : 0x3b82f6;
      const geometry = new THREE.BoxGeometry(c.width, c.height, c.length);
      const material = new THREE.MeshStandardMaterial({
        color: colorHex, metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0.8,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: colorHex, linewidth: 2 })
        )
      );

      const pos = c.position
        ? new THREE.Vector3(c.position.x, c.position.y, c.position.z)
        : new THREE.Vector3(0, c.height / 2, 0);

      mesh.position.copy(pos);
      mesh.userData['containerId'] = c.id;
      this.scene.add(mesh);

      this.containers.set(c.id, {
        id: c.id,
        width: c.width, length: c.length, height: c.height,
        color: c.color, weight: c.weight, amount: 1,
        position: pos, mesh, originalMaterial: material,
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

  serializeForApi(): ContainerPayload[] {
    return Array.from(this.containers.values()).map((c) => ({
      width: c.width, length: c.length, height: c.height,
      weight: c.weight, amount: c.amount, color: c.color,
      position: c.position
        ? { x: c.position.x, y: c.position.y, z: c.position.z }
        : undefined,
    }));
  }

  startDrag(event: MouseEvent, containerMesh: THREE.Mesh, camera: THREE.Camera): void {
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
    if (!container.mesh) return;
    const mat = container.mesh.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(0xffd700);
    mat.emissiveIntensity = 0.4;
  }

  deselectContainer(container: Container): void {
    if (!container?.mesh) return;
    const mat = container.mesh.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 0;
  }

  private showVisualHelper(container: Container): void {
    if (!container.position) return;
    if (this.visualHelperMesh) this.scene.remove(this.visualHelperMesh);
    this.visualHelperMesh = new THREE.Mesh(
      new THREE.BoxGeometry(container.width * 1.05, container.height * 1.05, container.length * 1.05),
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
    return (
      pos.x - container.width  / 2 >= -tw / 2 &&
      pos.x + container.width  / 2 <=  tw / 2 &&
      pos.z - container.length / 2 >= -tl / 2 &&
      pos.z + container.length / 2 <=  tl / 2 &&
      pos.y - container.height / 2 >= 0 &&
      pos.y + container.height / 2 <=  th
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

  getContainerAt(raycaster: THREE.Raycaster): THREE.Mesh | null {
    const meshes = Array.from(this.containers.values()).map((c) => c.mesh!);
    const intersects = raycaster.intersectObjects(meshes, true);
    if (!intersects.length) return null;
    let obj = intersects[0].object;
    while (obj && !obj.userData['containerId']) obj = obj.parent as THREE.Mesh;
    return obj as THREE.Mesh | null;
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
