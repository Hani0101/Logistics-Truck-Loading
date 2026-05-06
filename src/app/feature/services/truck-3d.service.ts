import {Injectable, ElementRef, inject} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TruckDimensions } from '../../shared/models/truck.models';
@Injectable({
  providedIn: 'root'
})
export class Truck3DService {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private truck!: THREE.Group;
  private animationId!: number;
  private controls!: OrbitControls;

  constructor() {}

  initializeScene(container: ElementRef): void {
    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      (container.nativeElement.clientWidth / container.nativeElement.clientHeight),
      0.1,
      1000
    );
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.nativeElement.clientWidth, container.nativeElement.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.nativeElement.appendChild(this.renderer.domElement);

    // Initialize controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 100;

    // Add lights
    this.addLights();

    // Add grid helper
    const gridHelper = new THREE.GridHelper(30, 30);
    this.scene.add(gridHelper);

    // Start animation loop
    this.animate();
  }

  private addLights(): void {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);

    // Directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(directionalLight);
  }

  createTruck(dimensions: TruckDimensions): void {
    // Remove existing truck if any
    if (this.truck) {
      this.scene.remove(this.truck);
    }

    // Create truck group
    this.truck = new THREE.Group();

    // Convert mm to meters for better visualization (scale down by 1000)
    const scaleFactor = 0.001;
    const width = dimensions.width * scaleFactor;
    const length = dimensions.length * scaleFactor;
    const height = dimensions.height * scaleFactor;

    // Create wireframe material for truck skeleton
    const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });

    // Create truck cabin wireframe
    const cabinGeometry = new THREE.BoxGeometry(width * 0.34, height * 0.8, width * 0.9);
    const cabinEdges = new THREE.EdgesGeometry(cabinGeometry);
    // const cabinWireframe = new THREE.LineSegments(cabinEdges, wireframeMaterial);
    // cabinWireframe.position.set(-length * 0.35, height * 0.4, 0);
    // this.truck.add(cabinWireframe);

    // Create truck cargo area wireframe
    // const cargoGeometry = new THREE.BoxGeometry(length * 0.7, height * 0.9, width);
    const cargoGeometry = new THREE.BoxGeometry(width, height * 0.9, length * 0.8);
    const cargoEdges = new THREE.EdgesGeometry(cargoGeometry);
    const cargoWireframe = new THREE.LineSegments(cargoEdges, wireframeMaterial);
    // cargoWireframe.position.set(length * 0.15, height * 0.45, 0);
    cargoWireframe.position.set(0, height * 0.45, 0);
    this.truck.add(cargoWireframe);

    // Add truck to scene
    this.scene.add(this.truck);

    // Adjust camera position based on truck size
    this.adjustCameraPosition(width, length - 100, height);
  }


  private adjustCameraPosition(width: number, length: number, height: number): void {
    const maxDimension = Math.max(width, length, height);
    const distance = maxDimension * 3;
    this.camera.position.set(distance, distance, distance);
    this.camera.lookAt(0, 0, 0);
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());

    // Update controls
    this.controls.update();

    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize(container: ElementRef): void {
    this.camera.aspect = container.nativeElement.clientWidth / container.nativeElement.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.nativeElement.clientWidth, container.nativeElement.clientHeight);
  }

  dispose(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.controls) {
      this.controls.dispose();
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  disableControls(): void {
    this.controls.enabled = false;
  }

  enableControls(): void {
    this.controls.enabled = true;
  }
}
