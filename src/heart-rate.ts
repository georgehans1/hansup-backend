import { WorkoutHeartRateDetail, WorkoutHeartRatePoint } from "./domain.js";

export interface WorkoutHeartRateRepository {
  getWorkoutHeartRate(workoutId: string): Promise<WorkoutHeartRateDetail | undefined>;
  replaceWorkoutHeartRate(workoutId: string, points: WorkoutHeartRatePoint[]): Promise<WorkoutHeartRateDetail>;
  heartRateForWorkoutIds(workoutIds: string[]): Promise<WorkoutHeartRateDetail[]>;
}

export function normalizeHeartRatePoints(points: WorkoutHeartRatePoint[]): WorkoutHeartRatePoint[] {
  if (!Array.isArray(points) || points.length === 0) throw new Error("Heart-rate samples are required");
  if (points.length > 2_000) throw new Error("Too many heart-rate samples");
  const unique = new Map<string, WorkoutHeartRatePoint>();
  for (const point of points) {
    const timestamp = new Date(point.recordedAt);
    if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid heart-rate timestamp");
    if (!Number.isFinite(point.bpm) || point.bpm < 25 || point.bpm > 250) throw new Error("Heart rate is outside the supported range");
    if (!Number.isInteger(point.sampleCount) || point.sampleCount < 1 || point.sampleCount > 1_000) throw new Error("Invalid heart-rate sample count");
    unique.set(timestamp.toISOString(), { recordedAt: timestamp.toISOString(), bpm: Math.round(point.bpm * 10) / 10, sampleCount: point.sampleCount });
  }
  return [...unique.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

export function heartRateDetail(workoutId: string, rawPoints: WorkoutHeartRatePoint[], updatedAt = new Date().toISOString()): WorkoutHeartRateDetail {
  const points = normalizeHeartRatePoints(rawPoints);
  const sampleCount = points.reduce((sum, point) => sum + point.sampleCount, 0);
  const weightedTotal = points.reduce((sum, point) => sum + point.bpm * point.sampleCount, 0);
  return {
    workoutId,
    averageBPM: Math.round(weightedTotal / sampleCount),
    minimumBPM: Math.round(Math.min(...points.map((point) => point.bpm))),
    maximumBPM: Math.round(Math.max(...points.map((point) => point.bpm))),
    sampleCount,
    points,
    updatedAt
  };
}

export class InMemoryWorkoutHeartRateRepository implements WorkoutHeartRateRepository {
  private readonly details = new Map<string, WorkoutHeartRateDetail>();
  async getWorkoutHeartRate(workoutId: string) { return this.details.get(workoutId); }
  async replaceWorkoutHeartRate(workoutId: string, points: WorkoutHeartRatePoint[]) {
    const detail = heartRateDetail(workoutId, points);
    this.details.set(workoutId, detail);
    return detail;
  }
  async heartRateForWorkoutIds(workoutIds: string[]) {
    return workoutIds.flatMap((id) => this.details.get(id) ?? []);
  }
}
