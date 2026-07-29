import assert from "node:assert/strict";
import test from "node:test";
import { performanceTrajectory, sessionMatchScore, sessionQuality } from "../src/postgres.js";
import type { PerformanceGoal, TrainingPlan, TrainingSession, WorkoutSummary } from "../src/domain.js";

const session: TrainingSession = {
  id: "session_1",
  planId: "plan_1",
  scheduledDate: "2026-08-10",
  type: "tempo",
  title: "Controlled 3 km",
  purpose: "Build sustainable speed",
  distanceMeters: 3000,
  effort: "Controlled",
  status: "scheduled"
};

const workout: WorkoutSummary = {
  id: "workout_1",
  userId: "user_1",
  healthkitUUID: "health_1",
  activityType: "running",
  startedAt: "2026-08-11T07:00:00.000Z",
  endedAt: "2026-08-11T07:15:00.000Z",
  durationSeconds: 900,
  distanceMeters: 3020,
  calories: 180,
  source: "healthkit",
  trustLevel: "verified",
  updatedAt: "2026-08-11T07:20:00.000Z"
};

test("matches a preparation run to a nearby purpose-compatible session", () => {
  assert.ok(sessionMatchScore(session, workout) >= 0.65);
  assert.equal(sessionQuality(session, workout), "targetMet");
});

test("rejects runs outside the two-day session window", () => {
  assert.equal(sessionMatchScore(session, { ...workout, startedAt: "2026-08-14T07:00:00.000Z" }), 0);
});

test("records useful but incomplete workouts as partial", () => {
  assert.equal(sessionQuality(session, { ...workout, distanceMeters: 2750 }), "partial");
});

test("trajectory keeps original baseline separate from the current benchmark", () => {
  const goal: PerformanceGoal = {
    id: "goal_1",
    userId: "user_1",
    distanceMeters: 5000,
    targetSeconds: 1200,
    targetDate: "2026-09-30",
    trainingDaysPerWeek: 4,
    preferredLongRunDay: 1,
    status: "active",
    consentVersion: "gemini-coaching-v1",
    baselineSeconds: 1500,
    baselineWorkoutId: "baseline_run",
    currentBenchmarkSeconds: 1380,
    currentBenchmarkWorkoutId: "recent_run",
    analysis: {
      currentBestSeconds: 1380,
      targetSeconds: 1200,
      requiredPaceSecondsPerKm: 240,
      currentPaceSecondsPerKm: 276,
      timeGapSeconds: 180,
      recentWeeklyDistanceMeters: 15000,
      recentRuns: 4,
      feasibility: "ambitious",
      generatedAt: "2026-08-11T08:00:00.000Z"
    },
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-08-11T08:00:00.000Z"
  };
  const plan: TrainingPlan = {
    id: "plan_1",
    performanceGoalId: goal.id,
    version: 1,
    model: "test",
    summary: "Test block",
    gapExplanation: "Test",
    recoveryGuidance: "Recover",
    caution: "Stop if unwell",
    generatedAt: goal.createdAt,
    status: "active",
    sessions: [{ ...session, status: "completed", linkedWorkoutId: workout.id }]
  };
  const result = performanceTrajectory(goal, plan);
  assert.equal(result.originalBaselineSeconds, 1500);
  assert.equal(result.currentBenchmarkSeconds, 1380);
  assert.equal(result.improvementSeconds, 120);
  assert.equal(result.completedSessions, 1);
});
