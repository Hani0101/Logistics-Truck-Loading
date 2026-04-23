import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ga-progress',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ga-progress.html',
  styleUrl: './ga-progress.scss',
})
export class GaProgress {
  @Input() generation     = 0;
  @Input() totalGenerations = 150;
  @Input() bestFitness    = 0;
  @Input() visible        = false;

  get progressPercent(): number {
    return Math.round((this.generation / this.totalGenerations) * 100);
  }

  // Normalise fitness into a 0–100 "quality" score for display.
  // Fitness values typically range from ~100 (few containers) to ~800+ (many),
  // so we cap at 800 and express as a percentage for an intuitive readout.
  get qualityPercent(): number {
    return Math.min(100, Math.round((this.bestFitness / 800) * 100));
  }
}
