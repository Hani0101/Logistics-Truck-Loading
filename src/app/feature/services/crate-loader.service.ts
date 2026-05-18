import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { ContainerType } from '../../shared/models/container.models';

interface ModelConfig {
  mtlPath: string;
  objPath: string;
  rotationX: number;
  /** True when rotationX = -PI/2: local Y→world Z, local Z→world Y, so scale.y/z must be swapped. */
  swapYZScale: boolean;
}

const MODEL_CONFIGS: Partial<Record<ContainerType, ModelConfig>> = {
  'crate': {
    mtlPath: '3dModels/Plastic_crate/14029_Plastic_Fruit_Crate_v1_L1.mtl',
    objPath: '3dModels/Plastic_crate/14029_Plastic_Fruit_Crate_v1_L1.obj',
    rotationX: -Math.PI / 2,
    swapYZScale: true,
  },
  'wooden-crate': {
    mtlPath: '3dModels/Wooden_Crate/Crate1.mtl',
    objPath: '3dModels/Wooden_Crate/Crate1.obj',
    rotationX: 0,
    swapYZScale: false,
  },
};

@Injectable({ providedIn: 'root' })
export class CrateLoaderService {
  private platformId = inject(PLATFORM_ID);
  private protoGroups = new Map<string, THREE.Group>();
  private loadPromises = new Map<string, Promise<THREE.Group>>();
  private cachedSizes = new Map<string, THREE.Vector3>();

  preload(type: ContainerType = 'crate'): Promise<THREE.Group> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject('SSR: skipping OBJ preload');
    }
    const cached = this.protoGroups.get(type);
    if (cached) return Promise.resolve(cached);
    const inFlight = this.loadPromises.get(type);
    if (inFlight) return inFlight;

    const config = MODEL_CONFIGS[type];
    if (!config) return Promise.reject(`Unknown model type: ${type}`);

    const promise = new Promise<THREE.Group>((resolve, reject) => {
      const mtlLoader = new MTLLoader();
      mtlLoader.load(
        config.mtlPath,
        (materials) => {
          materials.preload();
          const objLoader = new OBJLoader();
          objLoader.setMaterials(materials);
          objLoader.load(
            config.objPath,
            (group) => {
              this.protoGroups.set(type, group);
              this.loadPromises.delete(type);
              resolve(group);
            },
            undefined,
            (err) => { this.loadPromises.delete(type); reject(err); },
          );
        },
        undefined,
        (err) => { this.loadPromises.delete(type); reject(err); },
      );
    });

    this.loadPromises.set(type, promise);
    return promise;
  }

  cloneAndScale(type: ContainerType, widthMm: number, lengthMm: number, heightMm: number): THREE.Group {
    const protoGroup = this.protoGroups.get(type);
    if (!protoGroup) {
      throw new Error(`CrateLoaderService: call preload('${type}') before cloneAndScale()`);
    }
    const config = MODEL_CONFIGS[type]!;

    const inner = protoGroup.clone(true);
    if (config.rotationX) {
      inner.rotateOnAxis(new THREE.Vector3(1, 0, 0), config.rotationX);
    }
    inner.updateMatrixWorld(true);

    let modelSize: THREE.Vector3;
    if (this.cachedSizes.has(type)) {
      modelSize = this.cachedSizes.get(type)!.clone();
    } else {
      modelSize = new THREE.Vector3();
      new THREE.Box3().setFromObject(inner).getSize(modelSize);
      this.cachedSizes.set(type, modelSize.clone());
    }

    const f = 0.001;
    if (config.swapYZScale) {
      // -90° X rotation: scale.y drives world Z (length), scale.z drives world Y (height)
      inner.scale.set(
        (widthMm  * f) / modelSize.x,
        (lengthMm * f) / modelSize.z,
        (heightMm * f) / modelSize.y,
      );
    } else {
      inner.scale.set(
        (widthMm  * f) / modelSize.x,
        (heightMm * f) / modelSize.y,
        (lengthMm * f) / modelSize.z,
      );
    }

    inner.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(inner);
    const center = new THREE.Vector3();
    scaledBox.getCenter(center);
    inner.position.sub(center);

    const wrapper = new THREE.Group();
    wrapper.add(inner);
    return wrapper;
  }
}
