import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { TruckDimensions } from '../../shared/models/truck.models';
import { Truck3DService } from './truck-3d.service';
import { Chromosome } from '../../shared/models/genetic.models';
import { Container } from '../../shared/models/container.models';
@Injectable({
  providedIn: 'root'
})
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
        color: containerData.color || 0x3b82f6,
        metalness: 0.3,
        roughness: 0.4,
        transparent: true,
        opacity: 0.8
      });

      const mesh = new THREE.Mesh(geometry, material); // geometry can be shared
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const edges = new THREE.EdgesGeometry(geometry);
      const wireframe = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: containerData.color, linewidth: 2 })
      );
      mesh.add(wireframe);

      // Offset each container so they don't overlap
      const initialPosition = new THREE.Vector3(i * (width + 0.05), height / 2, 0);
      mesh.position.copy(initialPosition);
      mesh.userData['containerId'] = id;

      this.scene.add(mesh);

      const container: Container = {
        id,
        width, length, height,
        color: containerData.color,
        weight: containerData.weight,
        amount: 1, // each instance represents 1 physical container
        position: initialPosition,
        mesh,
        originalMaterial: material
      };

      this.containers.set(id, container);
      results.push(container);
    }

    return results;
  }
  startDrag(event: MouseEvent, containerMesh: THREE.Mesh, camera: THREE.Camera): void {
    const containerId = containerMesh.userData['containerId'];
    const container = this.containers.get(containerId);
    if(!container || !container.position) return;
    console.log("container", containerId);
    if (!container) return;

    // Deselect previous container if exists
    if (this.selectedContainer && this.selectedContainer.id !== container.id) {
      this.deselectContainer(this.selectedContainer);
    }

    this.draggedContainer = container;
    this.selectedContainer = container;
    this.camera = camera;

    // Disable OrbitControls while dragging
    this.truck3DService.disableControls();

    // Select/highlight the container
    this.selectContainer(container);

    // Update mouse position
    this.updateMousePosition(event);

    // Set drag plane at container's current height
    this.dragPlane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      container.position
    );

    // Show visual helper
    this.showVisualHelper(container);
  }

  drag(event: MouseEvent, camera: THREE.Camera): void {
    if (!this.draggedContainer || !this.draggedContainer.position || !this.draggedContainer.mesh ) return;

    this.updateMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, camera);

    // Get intersection with drag plane
    this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint);

    // Update container position
    this.draggedContainer.position.copy(this.dragPoint);
    this.draggedContainer.mesh.position.copy(this.dragPoint);

    // Update visual helper
    if (this.visualHelperMesh) {
      this.visualHelperMesh.position.copy(this.dragPoint);
      this.updateHelperColor();
    }
  }

  endDrag(): void {
    // Re-enable OrbitControls after dragging
    this.truck3DService.enableControls();

    this.draggedContainer = null;
    this.hideVisualHelper();
  }

  selectContainer(container: Container): void {
    if(!container.mesh) return;
    const material = container.mesh.material as THREE.MeshStandardMaterial;
    material.emissive.setHex(0xffd700); // Gold highlight
    material.emissiveIntensity = 0.4;
  }

  deselectContainer(container: Container): void {
    if(!container || !container.mesh) return;
    const material = container.mesh.material as THREE.MeshStandardMaterial;
    material.emissive.setHex(0x000000);
    material.emissiveIntensity = 0;
  }

  private showVisualHelper(container: Container): void {
    if(!container.position) return;
    // Remove old helper if exists
    if (this.visualHelperMesh) {
      this.scene.remove(this.visualHelperMesh);
    }

    // Create helper geometry (slightly larger than container)
    const helperGeometry = new THREE.BoxGeometry(
      container.width * 1.05,
      container.height * 1.05,
      container.length * 1.05
    );
    const helperMaterial = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.2,
      wireframe: true
    });
    this.visualHelperMesh = new THREE.Mesh(helperGeometry, helperMaterial);
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

    const isInside = this.isContainerInside(this.draggedContainer);
    const color = isInside ? 0x10b981 : 0xef4444; // Green if inside, red if outside
    (this.visualHelperMesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  private isContainerInside(container: Container): boolean {
    const scaleFactor = 0.001;
    const truckWidth = this.truckDimensions.width * scaleFactor;
    const truckLength = this.truckDimensions.length * scaleFactor;
    const truckHeight = this.truckDimensions.height * scaleFactor;

    const pos = container.position;
    const halfWidth = container.width / 2;
    const halfLength = container.length / 2;
    const halfHeight = container.height / 2;
    if(!pos) return false;

    return (
      pos.x - halfWidth >= -truckWidth / 2 &&
      pos.x + halfWidth <= truckWidth / 2 &&
      pos.z - halfLength >= -truckLength / 2 &&
      pos.z + halfLength <= truckLength / 2 &&
      pos.y - halfHeight >= 0 &&
      pos.y + halfHeight <= truckHeight
    );
  }

  private updateMousePosition(event: MouseEvent): void {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  getContainers(): Container[] {
    return Array.from(this.containers.values());
  }

  getContainerAt(raycaster: THREE.Raycaster): THREE.Mesh | null {
    const containers = Array.from(this.containers.values()).map(c => c.mesh!);
    const intersects = raycaster.intersectObjects(containers, true); // Set recursive to true

    if (intersects.length > 0) {
      let intersectedObject = intersects[0].object;

      // Traverse up to find the parent mesh with the containerId
      while (intersectedObject && !intersectedObject.userData['containerId']) {
        intersectedObject = intersectedObject.parent as THREE.Mesh;
      }
      return intersectedObject as THREE.Mesh | null;
    }

    return null;
  }

  // updateLayout(layout: Chromosome): void {
  //   layout.genes.forEach(gene => {
  //     const container = this.containers.get(gene.id);
  //     if (container) {
  //       container.position.copy(gene.position);
  //       container.mesh.position.copy(gene.position);
  //     }
  //   });
  // }
  updateLayout(layout: Chromosome): void {
  layout.genes.forEach((container, i) => {
    const sceneContainer = this.containers.get(container.id!);
    if (sceneContainer) {
      const newPosition = layout.positions[i];
      if(sceneContainer.position && sceneContainer.mesh) {
        sceneContainer.position.copy(newPosition);
        sceneContainer.mesh.position.copy(newPosition);
      }
    }
  });
}

  removeContainer(id: string): void {
    const container = this.containers.get(id);
    if (container) {
      if(container.mesh) {
        this.scene.remove(container.mesh);
      }
      this.containers.delete(id);
    }
  }

  clear(): void {
    this.containers.forEach(container => {
      if(container.mesh) {
        this.scene.remove(container.mesh);
      }
    });
    this.containers.clear();
    this.selectedContainer = null;
    this.draggedContainer = null;
  }
}
