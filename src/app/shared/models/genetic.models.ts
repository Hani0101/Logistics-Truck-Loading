import {Container} from './container.models';
import * as THREE from 'three';

export interface Chromosome {
  genes: Container[];
  positions: THREE.Vector3[];
  fitness: number;
}
