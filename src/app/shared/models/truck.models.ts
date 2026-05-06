export interface TruckDimensions {
  width: number;
  length: number;
  height: number;
  weightKg?: number;       // truck tare weight in kg
  maxCapacityKg?: number;  // max payload capacity in kg
}
