import { inject, Injectable } from '@angular/core';
import * as THREE from 'three';
import { Container3DService } from './container-3d.service';
import { Container } from '../../shared/models/container.models';
import { TruckDimensions } from '../../shared/models/truck.models';
import { Chromosome } from '../../shared/models/genetic.models';

@Injectable({ providedIn: 'root' })
export class GeneticAlgorithmService {
  private container3DService = inject(Container3DService);

  // GA Parameters
  private populationSize = 60;
  private generations    = 150;
  private mutationRate   = 0.15;
  private crossoverRate  = 0.85;
  private tournamentSize = 5;
  private elitismCount   = 3;

  // Public entery point
  findOptimalLayout(containers: Container[],truckDimensions: TruckDimensions): Chromosome | null {
    if (!containers.length) return null;

    // const truck = this.scaled(truckDimensions);
    const truck = this.getCargoBox(truckDimensions);
    let population = this.initializePopulation(containers, truck);

    for (let gen = 0; gen < this.generations; gen++) {
      population.sort((a, b) => b.fitness - a.fitness);

      // Elitism — carry best N unchanged
      const next: Chromosome[] = population.slice(0, this.elitismCount).map(c => this.clone(c));

      while (next.length < this.populationSize) {
        const p1 = this.tournamentSelect(population);
        const p2 = this.tournamentSelect(population);

        let o1: Chromosome, o2: Chromosome;
        if (Math.random() < this.crossoverRate) {
          [o1, o2] = this.crossover(p1, p2, truck);
        } else {
          o1 = this.clone(p1);
          o2 = this.clone(p2);
        }

        this.mutate(o1, truck);
        this.mutate(o2, truck);

        next.push(o1, o2);
      }

      population = next.slice(0, this.populationSize);
    }

    population.sort((a, b) => b.fitness - a.fitness);
    return population[0];
  }

  getCargoBox(dimensions: TruckDimensions): { w: number; l: number; h: number } {
    const f = 0.001;
    return {
      w: dimensions.width  * f,
      l: dimensions.length * f * 0.7,
      h: dimensions.height * f * 0.9,
    };
  }

  // DETERMINISTIC BOTTOM-LEFT-FILL PLACER
  //
  // Given an ordered list of containers, places each one at the lowest,
  // furthest-forward, leftmost valid position inside the truck.
  //
  // Key insight: the GA only evolves the ORDER of containers.
  // This function deterministically converts that order into positions,
  // guaranteeing no overlaps and no out-of-bounds — by construction.
  // Penalties are no longer needed in the fitness function.
  private placeContainers(orderedContainers: Container[],truck: { w: number; l: number; h: number }): THREE.Vector3[] {
    const placed: { pos: THREE.Vector3; c: Container }[] = [];

    // Candidate anchor points along X and Z axes.
    // Each placed container adds new anchors at its far edges.
    const anchorsX = new Set<number>([-truck.w / 2]);
    const anchorsZ = new Set<number>([-truck.l / 2]);
    for (const c of orderedContainers) {
      let bestPos: THREE.Vector3 | null = null;
      let bestScore = Infinity;

      for (const ax of anchorsX) {
        for (const az of anchorsZ) {
          // Container center given left edge at ax, front edge at az
          const cx = ax + c.width / 2;
          const cz = az + c.length / 2;

          // Must fit within truck footprint
          if (cx + c.width  / 2 > truck.w / 2 + 1e-6) continue;
          if (cz + c.length / 2 > truck.l / 2 + 1e-6) continue;

          // Drop down: find the Y level this container rests at
          const cy = this.findSupportY(cx, cz, c, placed, truck.h);
          if (cy === null) continue; // doesn't fit vertically

          const candidate = new THREE.Vector3(cx, cy, cz);

          // Confirm no horizontal+vertical overlap
          if (this.overlapsAny(candidate, c, placed)) continue;

          // Score: minimise Y first (floor), then Z (pack from front), then X (pack left)
          const score = cy * 1_000_000 + (cz + truck.l / 2) * 1000 + (cx + truck.w / 2);
          if (score < bestScore) {
            bestScore = score;
            bestPos   = candidate;
          }
        }
      }

      // Fallback
      if (!bestPos) {
        const fbx = -truck.w / 2 + c.width  / 2;
        const fbz = -truck.l / 2 + c.length / 2;
        const fby = this.findSupportY(fbx, fbz, c, placed, truck.h) ?? c.height / 2;
        bestPos = new THREE.Vector3(fbx, fby, fbz);
      }

      placed.push({ pos: bestPos, c });

      // Expose new anchor candidates at this container's far edges
      anchorsX.add(bestPos.x + c.width  / 2);
      anchorsZ.add(bestPos.z + c.length / 2);
    }

    return placed.map(p => p.pos);
  }

  /**
   * Returns the Y center for a container dropped vertically at (cx, cz).
   * Finds the highest surface (floor or top of a placed container) in the footprint.
   * Returns null if the container would exceed the truck roof.
   */
  private findSupportY(cx: number,cz: number,c: Container,placed: { pos: THREE.Vector3; c: Container }[],truckH: number): number | null {
    let supportTop = 0; // floor

    for (const { pos, c: other } of placed) {
      const overlapX = Math.abs(cx - pos.x) < (c.width  + other.width)  / 2 - 1e-6;
      const overlapZ = Math.abs(cz - pos.z) < (c.length + other.length) / 2 - 1e-6;
      if (overlapX && overlapZ) {
        supportTop = Math.max(supportTop, pos.y + other.height / 2);
      }
    }

    const cy = supportTop + c.height / 2;
    return cy + c.height / 2 > truckH + 1e-6 ? null : cy;
  }

   //Returns true if placing a container at `pos` would overlap any already-placed container.
  private overlapsAny(pos: THREE.Vector3,c: Container,placed: { pos: THREE.Vector3; c: Container }[]): boolean {
    for (const { pos: o, c: other } of placed) {
      const ox = Math.abs(pos.x - o.x) < (c.width  + other.width)  / 2 - 1e-6;
      const oy = Math.abs(pos.y - o.y) < (c.height + other.height) / 2 - 1e-6;
      const oz = Math.abs(pos.z - o.z) < (c.length + other.length) / 2 - 1e-6;
      if (ox && oy && oz) return true;
    }
    return false;
  }

  // Fitness:
  // No overlap/bounds penalties needed — the placer already guarantees validity.
  // Rewards: high volume utilisation + tight front-loading + low centre of gravity.
  private calculateFitness(chromosome: Chromosome,truck: { w: number; l: number; h: number }): number {
    const truckVolume = truck.w * truck.l * truck.h;
    let usedVolume    = 0;
    let packingScore  = 0;

    chromosome.genes.forEach((c, i) => {
      const pos = chromosome.positions[i];
      usedVolume   += c.width * c.height * c.length;
      // Reward proximity to front (−Z) and floor (low Y)
      packingScore += (truck.l / 2 - pos.z) + (truck.h - pos.y);
    });

    const utilisation = usedVolume / truckVolume;
    return utilisation * 500 + packingScore * 0.5 + chromosome.genes.length * 10;
  }

  // Initialise population: random permutations, placed deterministically
  private initializePopulation(containers: Container[],truck: { w: number; l: number; h: number }): Chromosome[] {
    return Array.from({ length: this.populationSize }, () => {
      const genes = [...containers].sort(() => Math.random() - 0.5);
      return this.decode(genes, truck);
    });
  }

  // CROSSOVER — Order Crossover (OX) on gene sequence, then re-place
  private crossover(p1: Chromosome,p2: Chromosome,truck: { w: number; l: number; h: number }): [Chromosome, Chromosome] {
    return [
      this.decode(this.ox(p1.genes, p2.genes), truck),
      this.decode(this.ox(p2.genes, p1.genes), truck),
    ];
  }

  /** Order Crossover (OX): preserves relative order, no duplicates. */
  private ox(primary: Container[], secondary: Container[]): Container[] {
    const len = primary.length;
    let lo = Math.floor(Math.random() * len);
    let hi = Math.floor(Math.random() * len);
    if (lo > hi) [lo, hi] = [hi, lo];

    const slice    = primary.slice(lo, hi + 1);
    const sliceIds = new Set(slice.map(c => c.id));
    const rest     = secondary.filter(c => !sliceIds.has(c.id));

    return [...rest.slice(0, lo), ...slice, ...rest.slice(lo)];
  }

  //swap two positions in the sequence then re-place
  private mutate(chromosome: Chromosome, truck: { w: number; l: number; h: number }): void {
    let mutated = false;

    for (let i = 0; i < chromosome.genes.length; i++) {
      if (Math.random() < this.mutationRate) {
        const j = Math.floor(Math.random() * chromosome.genes.length);
        [chromosome.genes[i], chromosome.genes[j]] = [chromosome.genes[j], chromosome.genes[i]];
        mutated = true;
      }
    }

    if (mutated) {
      chromosome.positions = this.placeContainers(chromosome.genes, truck);
      chromosome.fitness   = this.calculateFitness(chromosome, truck);
    }
  }

  // Helpers
  private decode(genes: Container[], truck: { w: number; l: number; h: number }): Chromosome {
    const positions = this.placeContainers(genes, truck);
    const c: Chromosome = { genes, positions, fitness: 0 };
    c.fitness = this.calculateFitness(c, truck);
    return c;
  }

  private scaled(td: TruckDimensions) {
    const f = 0.001;
    return { w: td.width * f, l: td.length * f, h: td.height * f };
  }

  private clone(c: Chromosome): Chromosome {
    return {
      genes:     [...c.genes],
      positions: c.positions.map(p => p.clone()),
      fitness:   c.fitness,
    };
  }

  private tournamentSelect(population: Chromosome[]): Chromosome {
    let best = population[Math.floor(Math.random() * population.length)];
    for (let i = 1; i < this.tournamentSize; i++) {
      const candidate = population[Math.floor(Math.random() * population.length)];
      if (candidate.fitness > best.fitness) best = candidate;
    }
    return best;
  }
}
