import { WorkoutSplit, WorkoutSplitsDetail } from "./domain.js";

export interface WorkoutSplitRepository {
  getWorkoutSplits(workoutId: string): Promise<WorkoutSplitsDetail | undefined>;
  replaceWorkoutSplits(workoutId: string, splits: WorkoutSplit[]): Promise<WorkoutSplitsDetail>;
  splitsForWorkoutIds(workoutIds: string[]): Promise<WorkoutSplitsDetail[]>;
}

export function normalizeWorkoutSplits(splits: WorkoutSplit[]): WorkoutSplit[] {
  if (!Array.isArray(splits) || splits.length === 0) throw new Error("Workout splits are required");
  if (splits.length > 500) throw new Error("Too many workout splits");
  const keys = new Set<string>();
  return splits.map((split) => {
    if (!Number.isInteger(split.index) || split.index < 1) throw new Error("Invalid split index");
    if (split.unit !== "kilometer" && split.unit !== "mile") throw new Error("Invalid split unit");
    if (!Number.isFinite(split.distanceMeters) || split.distanceMeters <= 0 || split.distanceMeters > 2_000) throw new Error("Invalid split distance");
    if (!Number.isFinite(split.durationSeconds) || split.durationSeconds <= 0 || split.durationSeconds > 86_400) throw new Error("Invalid split duration");
    const startedAt = new Date(split.startedAt);
    const endedAt = new Date(split.endedAt);
    if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime()) || endedAt <= startedAt) throw new Error("Invalid split timestamps");
    const key = `${split.unit}:${split.index}`;
    if (keys.has(key)) throw new Error("Duplicate workout split");
    keys.add(key);
    return {
      ...split,
      distanceMeters: Math.round(split.distanceMeters * 10) / 10,
      durationSeconds: Math.round(split.durationSeconds * 10) / 10,
      paceSecondsPerKm: Math.round((split.durationSeconds / (split.distanceMeters / 1_000)) * 10) / 10,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString()
    };
  }).sort((a, b) => a.unit.localeCompare(b.unit) || a.index - b.index);
}

export class InMemoryWorkoutSplitRepository implements WorkoutSplitRepository {
  private readonly details = new Map<string, WorkoutSplitsDetail>();
  async getWorkoutSplits(workoutId: string) { return this.details.get(workoutId); }
  async replaceWorkoutSplits(workoutId: string, splits: WorkoutSplit[]) {
    const detail = { workoutId, splits: normalizeWorkoutSplits(splits), updatedAt: new Date().toISOString() };
    this.details.set(workoutId, detail);
    return detail;
  }
  async splitsForWorkoutIds(workoutIds: string[]) { return workoutIds.flatMap((id) => this.details.get(id) ?? []); }
}
