import * as THREE from 'three';

export interface Container {
  id?: string;
  width: number;
  length: number;
  height: number;
  weight: number;
  amount: number;
  color?: string;
  position?: THREE.Vector3;
  mesh?: THREE.Mesh;
  originalMaterial?: THREE.MeshStandardMaterial;
}
