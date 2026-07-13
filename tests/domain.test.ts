import assert from "node:assert/strict";
import test from "node:test";
import {
  ActivitySummary,
  Goal,
  calculateGoalProgress,
  calculateStreak,
  detectTrustLevel,
  generateWeeklyRecap,
  leaderboardRows,
  rankUsers,
  scoreChallenge
} from "../src/domain.js";
import {
  conversationComparison,
  createConversation,
  createDemoStore,
  friendLeaderboard,
  profileActivity,
  reactToMessage,
  rematchChallenge,
  respondChallenge,
  respondFriendRequest,
  searchUsers,
  sendFriendRequest,
  shareChallenge,
  upsertSummary
} from "../src/store.js";

const summaries: ActivitySummary[] = [
  makeSummary("2026-06-20", 9000, 3000, 1000, 44, 360),
  makeSummary("2026-06-21", 12000, 4500, 2500, 63, 520)
];

test("scores step, distance, calorie, and active-minute challenges from HealthKit summaries", () => {
  assert.equal(scoreChallenge("steps", summaries), 21000);
  assert.equal(scoreChallenge("distance", summaries), 11000);
  assert.equal(scoreChallenge("running", summaries), 3500);
  assert.equal(scoreChallenge("activeMinutes", summaries), 107);
  assert.equal(scoreChallenge("calories", summaries), 880);
});

test("calculates goal progress and current streak", () => {
  const goal: Goal = {
    id: "goal_1",
    userId: "u_1",
    kind: "steps",
    cadence: "daily",
    target: 10000,
    isEnabled: true,
    createdAt: new Date().toISOString()
  };

  assert.equal(calculateGoalProgress(goal, [summaries[1]]), 1);
  assert.equal(calculateStreak(goal, summaries), 1);
});

test("ranks users with deterministic tie ordering", () => {
  assert.deepEqual(rankUsers([{ userId: "b", score: 10 }, { userId: "a", score: 10 }]), [
    { userId: "a", score: 10, rank: 1 },
    { userId: "b", score: 10, rank: 2 }
  ]);
});

test("builds leaderboard rows for all supported activity comparison metrics", () => {
  const rows = leaderboardRows({
    userIds: ["u_1"],
    summaries,
    goals: [],
    streaks: [{ userId: "u_1", currentDays: 5, bestDays: 7, updatedAt: new Date().toISOString() }],
    period: "all"
  });

  assert.equal(rows[0].steps, 21000);
  assert.equal(rows[0].activeMinutes, 107);
  assert.equal(rows[0].calories, 880);
  assert.equal(rows[0].streakDays, 5);
});

test("generates weekly recaps with day bars and trend", () => {
  const recap = generateWeeklyRecap({
    userId: "u_1",
    weekStartsOn: "2026-06-15",
    summaries,
    previousSummaries: [makeSummary("2026-06-14", 10000, 1000, 0, 30, 250)],
    goalsHit: 3,
    streakDays: 2,
    leaderboardRank: 1,
    challengeWins: 1
  });

  assert.equal(recap.totalSteps, 21000);
  assert.equal(recap.bestDay, "2026-06-21");
  assert.equal(recap.dayBars.length, 2);
  assert.equal(recap.trendPercent, 110);
});

test("upserts activity summaries idempotently and flags unusual spikes", () => {
  const store = createDemoStore();
  const firstCount = store.summaries.length;

  const saved = upsertSummary(store, {
    userId: "u_ama",
    localDate: "2026-06-21",
    timezone: "Africa/Accra",
    steps: 65000,
    walkingDistanceMeters: 6000,
    runningDistanceMeters: 2000,
    workoutCount: 1,
    activeMinutes: 120,
    calories: 2200
  });

  assert.equal(store.summaries.length, firstCount);
  assert.equal(saved.trustLevel, "review");
  assert.equal(detectTrustLevel(saved), "review");
});

test("refreshes streaks from summaries without inflating on repeated sync", () => {
  const store = createDemoStore();

  upsertSummary(store, {
    userId: "u_ama",
    localDate: "2026-06-22",
    timezone: "Africa/Accra",
    steps: 10000,
    walkingDistanceMeters: 4600,
    runningDistanceMeters: 0,
    workoutCount: 0,
    activeMinutes: 60,
    calories: 400
  });
  const first = store.streaks.find((item) => item.userId === "u_ama")?.currentDays;

  upsertSummary(store, {
    userId: "u_ama",
    localDate: "2026-06-22",
    timezone: "Africa/Accra",
    steps: 10000,
    walkingDistanceMeters: 4600,
    runningDistanceMeters: 0,
    workoutCount: 0,
    activeMinutes: 60,
    calories: 400
  });
  const second = store.streaks.find((item) => item.userId === "u_ama")?.currentDays;

  assert.equal(second, first);
  assert.ok(store.badges.some((badge) => badge.emoji === "🔥"));
});

test("search exposes minimal profiles and activity stays friend-only", () => {
  const store = createDemoStore();
  const results = searchUsers(store, "u_ama", "sam");
  assert.equal(results[0].username, "sam");
  assert.equal("email" in results[0], false);

  const hidden = profileActivity(store, "u_sam", "u_kofi");
  assert.equal(hidden.summaries.length, 0);
  assert.equal(hidden.stats, undefined);
});

test("friend requests can be sent and accepted", () => {
  const store = createDemoStore();
  const request = sendFriendRequest(store, "u_eli", "u_sam");
  assert.equal(request.status, "pending");
  const accepted = respondFriendRequest(store, request.id, "u_sam", true);
  assert.equal(accepted.status, "accepted");
});

test("friend and conversation leaderboards support month and all-time periods", () => {
  const store = createDemoStore();
  assert.ok(friendLeaderboard(store, "u_ama", "month").rows.length >= 3);
  assert.ok(friendLeaderboard(store, "u_ama", "all").rows.length >= 3);
  assert.ok(conversationComparison(store, "u_ama", "conv_squad", "week").rows.length >= 3);
});

test("creates friends-only group conversations and message reactions", () => {
  const store = createDemoStore();
  const conversation = createConversation(store, "u_ama", { kind: "group", title: "Run Crew", memberIds: ["u_kofi", "u_eli"] });
  assert.equal(conversation.kind, "group");
  const reaction = reactToMessage(store, "u_ama", "m_1", "fire");
  assert.equal(reaction.targetType, "message");
});

test("challenge invitations, rematches, and sharing are functional", () => {
  const store = createDemoStore();
  const responded = respondChallenge(store, "c_sam_invite", "u_ama", true);
  assert.equal(responded.participants.find((item) => item.userId === "u_ama")?.accepted, true);

  const rematch = rematchChallenge(store, "c_weekend");
  assert.equal(rematch.rematchOfChallengeId, "c_weekend");

  const shared = shareChallenge(store, "u_ama", "c_weekend", "conv_squad");
  assert.equal(shared.sharedConversationId, "conv_squad");
});

function makeSummary(
  localDate: string,
  steps: number,
  walkingDistanceMeters: number,
  runningDistanceMeters: number,
  activeMinutes: number,
  calories: number
): ActivitySummary {
  return {
    id: `summary_${localDate}`,
    userId: "u_1",
    localDate,
    timezone: "Africa/Accra",
    steps,
    walkingDistanceMeters,
    runningDistanceMeters,
    workoutCount: runningDistanceMeters > 0 ? 1 : 0,
    activeMinutes,
    calories,
    source: "healthkit",
    trustLevel: "verified",
    updatedAt: new Date().toISOString()
  };
}
