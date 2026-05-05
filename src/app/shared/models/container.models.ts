import * as THREE from 'three';

export type ContainerType = 'box' | 'crate' | 'wooden-crate';

export interface Container {
  id?: string;
  groupId?: string;  // shared across containers created from the same spec (same addContainer call)
  containerType?: ContainerType;
  width: number;
  length: number;
  height: number;
  weight: number;       // tare weight of the container itself (g)
  itemCount?: number;   // number of items packed inside each container
  itemWeightG?: number; // weight of each item in grams
  amount: number;
  color?: string;
  position?: THREE.Vector3;
  mesh?: THREE.Mesh | THREE.Group;
  originalMaterial?: THREE.MeshStandardMaterial;
}
