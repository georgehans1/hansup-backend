import http from "node:http";
import { URL } from "node:url";
import { deleteAvatar, storeAvatar } from "./storage.js";
import {
  addChallenge,
  activityAggregatesFor,
  activitySummariesFor,
  activityWorkoutsFor,
  addGoal,
  goalHistory,
  addMessage,
  addReaction,
  AppStore,
  authWithIdentity,
  blockUser,
  badgeProgressForUser,
  blockedUsersFor,
  unblockUser,
  exportAccount,
  deleteAccount,
  addReport,
  conversationComparison,
  challengesFor,
  challengeCareerStats,
  challengeHistoryBetween,
  challengeFor,
  circleTimeline,
  conversationsFor,
  createConversation,
  createDemoStore,
  currentUser,
  friendLeaderboard,
  friendActivity,
  friendsFor,
  markConversationRead,
  setConversationMuted,
  leaveConversation,
  addConversationMembers,
  messagesForConversation,
  notificationsFor,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  archiveNotification,
  deleteNotification,
  lifetimePersonalBests,
  personalBestsFor,
  personalRecordLabFor,
  userSummaries,
  profileActivity,
  profileFriendsFor,
  publicProfile,
  reactToMessage,
  rematchChallenge,
  removeFriend,
  refreshBadgesForUser,
  respondChallenge,
  respondFriendRequest,
  searchUsers,
  sendFriendRequest,
  shareChallenge,
  updateUserSettings,
  updateUserProfile,
  updateGoal,
  deleteGoal,
  upsertSummary,
  upsertSummaries,
  upsertWorkouts,
  weeklyRecapFor,
  monthlyRecapFor,
  workoutForViewer,
  workoutForExactViewer,
  summaryForViewer
  ,updateWorkoutSocialMetadata
  ,compareWorkouts
  ,challengeCommentsFor
  ,addChallengeComment
  ,profileHighlightsFor
  ,replaceProfileHighlights
  ,setWorkoutClap
  ,workoutReactionsFor
} from "./store.js";
import { LeaderboardMetric, LeaderboardPeriod } from "./domain.js";
import type { WorkoutHeartRatePoint } from "./domain.js";
import { InMemoryWorkoutHeartRateRepository, WorkoutHeartRateRepository } from "./heart-rate.js";
import type { WorkoutSplit } from "./domain.js";
import { InMemoryWorkoutSplitRepository, WorkoutSplitRepository } from "./splits.js";
import { sendApnsPush } from "./apns.js";
import { ProductionConfig, productionConfig } from "./config.js";
import { exchangeGoogleAuthorizationCode, verifyGoogleIdentity } from "./auth.js";
import type { PersistenceChange } from "./postgres.js";
import type { PostgresRepository } from "./postgres.js";
import { generateGeminiPlan, generateGeminiSessionAnalysis } from "./gemini.js";
import { error as logError, info, warn } from "./logger.js";

const demoUserId = "u_ama";

export function createServer(
  store: AppStore = createDemoStore(),
  config: ProductionConfig = productionConfig(),
  persistChange: (change: PersistenceChange) => Promise<void> = async () => {},
  heartRate: WorkoutHeartRateRepository = new InMemoryWorkoutHeartRateRepository(),
  splits: WorkoutSplitRepository = new InMemoryWorkoutSplitRepository(),
  performanceGoals?: PostgresRepository
) {
  const requestWindows = new Map<string, { startedAt: number; count: number }>();
  let requestSequence = 0;
  return http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const requestId = `${startedAt.toString(36)}-${(++requestSequence).toString(36)}`;
    const method = req.method ?? "UNKNOWN";
    const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
    res.setHeader("x-request-id", requestId);
    res.on("finish", () => {
      if (requestPath !== "/health") info("request_completed", { requestId, method, path: requestPath, status: res.statusCode, durationMs: Date.now() - startedAt });
    });
    const onChange = async (change: PersistenceChange) => {
      await persistChange(change);
      info("domain_change_persisted", { requestId, kind: change.kind });
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const userId = req.headers["x-user-id"]?.toString() || demoUserId;
      const rateKey = req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? userId;
      const now = Date.now();
      const window = requestWindows.get(rateKey);
      if (!window || now - window.startedAt >= 60_000) requestWindows.set(rateKey, { startedAt: now, count: 1 });
      else if (++window.count > 180) {
        warn("rate_limit_exceeded", { requestId, path: requestPath });
        return json(res, 429, { error: "Too many requests. Try again shortly." });
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/demo") {
        return json(res, 200, store);
      }

      if (req.method === "POST" && url.pathname === "/auth/google") {
        const payload = await body<{ idToken: string; email?: string; displayName?: string }>(req);
        const identity = await verifyGoogleIdentity({ ...payload, config });
        const result = authWithIdentity(store, identity, config.jwtSecret ?? "demo-secret");
        await onChange({ kind: "auth", userId: result.user.id });
        info("authentication_succeeded", { requestId, provider: "google", userId: result.user.id, newUsernameRequired: result.needsUsername });
        return json(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/auth/google/code") {
        const payload = await body<{ code: string; codeVerifier: string; redirectUri: string }>(req);
        const identity = await exchangeGoogleAuthorizationCode({ ...payload, config });
        const result = authWithIdentity(store, identity, config.jwtSecret ?? "demo-secret");
        await onChange({ kind: "auth", userId: result.user.id });
        info("authentication_succeeded", { requestId, provider: "google_code", userId: result.user.id, newUsernameRequired: result.needsUsername });
        return json(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/auth/dev") {
        const allowDevAuth = process.env.ALLOW_DEV_AUTH === "true" || process.env.NODE_ENV !== "production";
        if (!allowDevAuth) {
          return json(res, 403, { error: "Development auth is disabled" });
        }
        const payload = await body<{ email?: string; displayName?: string }>(req);
        const result = authWithIdentity(store, {
          provider: "google",
          subject: payload.email ?? "local-test@hansup.dev",
          email: payload.email ?? "local-test@hansup.dev",
          displayName: payload.displayName ?? "Local Tester"
        }, config.jwtSecret ?? "demo-secret");
        await onChange({ kind: "auth", userId: result.user.id });
        return json(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/auth/refresh") {
        return json(res, 200, { accessToken: `demo_access_${userId}`, refreshToken: `demo_refresh_${userId}` });
      }

      if (req.method === "POST" && url.pathname === "/auth/logout") {
        return json(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/me") {
        const result = currentUser(store, userId);
        await onChange({ kind: "derived", userId });
        return json(res, 200, result);
      }

      if (req.method === "PATCH" && url.pathname === "/me") {
        const patch = await body<{ username?: string; displayName?: string; avatarURL?: string }>(req);
        if (patch.avatarURL?.startsWith("data:image/")) patch.avatarURL = await storeAvatar(config, userId, patch.avatarURL);
        else if (patch.avatarURL === "") await deleteAvatar(config, userId);
        const result = updateUserProfile(store, userId, patch);
        await onChange({ kind: "auth", userId });
        return json(res, 200, result);
      }

      if (req.method === "PATCH" && url.pathname === "/me/settings") {
        const result = updateUserSettings(store, userId, await body(req));
        await onChange({ kind: "settings", userId });
        return json(res, 200, result);
      }

      if (req.method === "PATCH" && url.pathname === "/me/settings/home-goal") {
        const result = updateUserSettings(store, userId, await body<{ homeGoalId: string }>(req));
        await onChange({ kind: "settings", userId });
        await onChange({ kind: "derived", userId });
        return json(res, 200, result);
      }

      if (url.pathname.startsWith("/performance-goals") && !performanceGoals) {
        return json(res, 503, { error: "Performance coaching requires PostgreSQL" });
      }

      if (req.method === "GET" && url.pathname === "/performance-goals") {
        const goals = await performanceGoals!.performanceGoalsFor(userId);
        const refreshed = await Promise.all(goals.map((item) =>
          item.goal.status === "active" ? performanceGoals!.refreshPerformanceGoalAnalysis(userId, item.goal.id) : item
        ));
        return json(res, 200, refreshed);
      }

      if (req.method === "POST" && url.pathname === "/performance-goals") {
        const payload = await body<{
          distanceMeters: number; targetSeconds: number; targetDate: string;
          trainingDaysPerWeek: number; preferredLongRunDay: number; consentVersion: string; baselineWorkoutId?: string;
        }>(req);
        const result = await performanceGoals!.createPerformanceGoal(userId, payload);
        return json(res, 201, result);
      }

      const performanceGoalRoute = url.pathname.match(/^\/performance-goals\/([^/]+)$/);
      const performanceAnalysisRoute = url.pathname.match(/^\/performance-goals\/([^/]+)\/analysis$/);
      const performanceGenerateRoute = url.pathname.match(/^\/performance-goals\/([^/]+)\/generate$/);
      const performanceCoachingDataRoute = url.pathname.match(/^\/performance-goals\/([^/]+)\/coaching-data$/);
      const performanceQualifyingRunsRoute = url.pathname.match(/^\/performance-goals\/([^/]+)\/qualifying-runs$/);
      const performanceBenchmarkRoute = url.pathname.match(/^\/performance-goals\/([^/]+)\/benchmark$/);
      const performanceCheckInsRoute = url.pathname.match(/^\/performance-goals\/([^/]+)\/check-ins$/);
      const performanceEvidenceRoute = url.pathname.match(/^\/performance-goals\/([^/]+)\/evidence$/);
      const performanceEvaluateRoute = url.pathname.match(/^\/performance-goals\/([^/]+)\/evaluate$/);
      const performanceAdaptationsRoute = url.pathname.match(/^\/performance-goals\/([^/]+)\/adaptations$/);
      const performanceAdaptationActionRoute = url.pathname.match(/^\/performance-goals\/([^/]+)\/adaptations\/([^/]+)\/(accept|decline)$/);
      if (req.method === "GET" && performanceGoalRoute) {
        const result = await performanceGoals!.performanceGoalFor(userId, performanceGoalRoute[1]);
        return result ? json(res, 200, result) : json(res, 404, { error: "Performance goal not found" });
      }
      if (req.method === "PATCH" && performanceGoalRoute) {
        return json(res, 200, await performanceGoals!.updatePerformanceGoal(userId, performanceGoalRoute[1], await body(req)));
      }
      if (req.method === "POST" && performanceAnalysisRoute) {
        return json(res, 200, await performanceGoals!.refreshPerformanceGoalAnalysis(userId, performanceAnalysisRoute[1]));
      }
      if (req.method === "GET" && performanceQualifyingRunsRoute) {
        return json(res, 200, await performanceGoals!.qualifyingRunsFor(userId, performanceQualifyingRunsRoute[1]));
      }
      if (req.method === "POST" && performanceBenchmarkRoute) {
        const payload = await body<{ workoutId: string }>(req);
        return json(res, 200, await performanceGoals!.setCurrentPerformanceBenchmark(userId, performanceBenchmarkRoute[1], payload.workoutId));
      }
      if (req.method === "POST" && performanceCheckInsRoute) {
        return json(res, 200, await performanceGoals!.checkInPerformanceRun(userId, performanceCheckInsRoute[1], await body(req)));
      }
      if (req.method === "GET" && performanceEvidenceRoute) {
        return json(res, 200, await performanceGoals!.performanceEvidenceFor(userId, performanceEvidenceRoute[1]));
      }
      if (req.method === "POST" && performanceEvaluateRoute) {
        const payload = await body<{ preparePlan?: boolean }>(req);
        const adaptation = await performanceGoals!.evaluatePerformanceGoal(
          userId, performanceEvaluateRoute[1], payload.preparePlan === false ? "weeklyReview" : "userRequested"
        );
        if (!adaptation) return json(res, 200, { adaptation: null });
        if (adaptation.status === "recommended" && payload.preparePlan !== false) {
          const detail = await performanceGoals!.performanceGoalFor(userId, performanceEvaluateRoute[1]);
          if (!detail) return json(res, 404, { error: "Performance goal not found" });
          const draft = await generateGeminiPlan(config, detail);
          return json(res, 200, {
            adaptation: await performanceGoals!.attachAdaptationDraft(userId, detail.goal.id, adaptation.id, draft)
          });
        }
        return json(res, 200, { adaptation });
      }
      if (req.method === "GET" && performanceAdaptationsRoute) {
        return json(res, 200, await performanceGoals!.adaptationsFor(userId, performanceAdaptationsRoute[1]));
      }
      if (req.method === "POST" && performanceAdaptationActionRoute) {
        const [_, goalId, adaptationId, action] = performanceAdaptationActionRoute;
        if (action === "accept") {
          return json(res, 200, await performanceGoals!.acceptAdaptation(userId, goalId, adaptationId, config.geminiModel ?? "gemini-2.5-flash"));
        }
        return json(res, 200, await performanceGoals!.declineAdaptation(userId, goalId, adaptationId));
      }
      if (req.method === "POST" && performanceGenerateRoute) {
        const refreshed = await performanceGoals!.refreshPerformanceGoalAnalysis(userId, performanceGenerateRoute[1]);
        if (refreshed.goal.status !== "active") return json(res, 409, { error: "Only active goals can generate plans" });
        const model = config.geminiModel ?? "gemini-2.5-flash";
        const generationId = await performanceGoals!.beginCoachGeneration(userId, refreshed.goal.id, model, "userRequested");
        try {
          const draft = await generateGeminiPlan(config, refreshed);
          const plan = await performanceGoals!.saveTrainingPlan(refreshed.goal.id, model, draft);
          await performanceGoals!.finishCoachGeneration(generationId);
          info("coach_plan_generated", { requestId, userId, goalId: refreshed.goal.id, planVersion: plan.version });
          return json(res, 200, { goal: refreshed.goal, plan, milestones: refreshed.milestones });
        } catch (failure) {
          await performanceGoals!.finishCoachGeneration(generationId, failure instanceof Error ? failure.message : "Generation failed");
          throw failure;
        }
      }
      if (req.method === "DELETE" && performanceCoachingDataRoute) {
        await performanceGoals!.deleteCoachingData(userId, performanceCoachingDataRoute[1]);
        return json(res, 200, { ok: true });
      }

      const trainingSessionRoute = url.pathname.match(/^\/training-sessions\/([^/]+)$/);
      const trainingSessionWorkoutRoute = url.pathname.match(/^\/training-sessions\/([^/]+)\/link-workout$/);
      const trainingSessionDetailRoute = url.pathname.match(/^\/training-sessions\/([^/]+)\/detail$/);
      const trainingSessionAnalysisRoute = url.pathname.match(/^\/training-sessions\/([^/]+)\/analysis$/);
      if (req.method === "PATCH" && trainingSessionRoute) {
        return json(res, 200, await performanceGoals!.updateTrainingSession(userId, trainingSessionRoute[1], await body(req)));
      }
      if (req.method === "GET" && trainingSessionDetailRoute) {
        return json(res, 200, await performanceGoals!.trainingSessionDetailFor(userId, trainingSessionDetailRoute[1]));
      }
      if (req.method === "POST" && trainingSessionAnalysisRoute) {
        const context = await performanceGoals!.trainingSessionAnalysisContext(userId, trainingSessionAnalysisRoute[1]);
        const result = await generateGeminiSessionAnalysis(config, context);
        const workoutId = (context.result as { workoutId?: string } | undefined)?.workoutId
          ?? (await performanceGoals!.trainingSessionDetailFor(userId, trainingSessionAnalysisRoute[1])).linkedWorkout?.id;
        if (!workoutId) return json(res, 409, { error: "Link a run before requesting coaching analysis" });
        return json(res, 200, await performanceGoals!.saveTrainingSessionAnalysis(
          userId, trainingSessionAnalysisRoute[1], workoutId, config.geminiModel ?? "gemini-2.5-flash", result
        ));
      }
      if (req.method === "POST" && trainingSessionWorkoutRoute) {
        const payload = await body<{ workoutId: string }>(req);
        return json(res, 200, await performanceGoals!.linkWorkoutToTrainingSession(userId, trainingSessionWorkoutRoute[1], payload.workoutId));
      }
      if (req.method === "DELETE" && trainingSessionWorkoutRoute) {
        return json(res, 200, await performanceGoals!.unlinkWorkoutFromTrainingSession(userId, trainingSessionWorkoutRoute[1]));
      }

      if (req.method === "GET" && url.pathname === "/users/search") {
        return json(res, 200, searchUsers(store, userId, url.searchParams.get("q") ?? "", numberParam(url, "limit", 20), numberParam(url, "offset", 0)));
      }

      const userProfile = url.pathname.match(/^\/users\/([^/]+)$/);
      if (req.method === "GET" && userProfile) {
        return json(res, 200, publicProfile(store, userId, userProfile[1]));
      }

      const userActivity = url.pathname.match(/^\/users\/([^/]+)\/activity$/);
      if (req.method === "GET" && userActivity) {
        return json(res, 200, profileActivity(store, userId, userActivity[1], url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined));
      }

      const userFriends = url.pathname.match(/^\/users\/([^/]+)\/friends$/);
      if (req.method === "GET" && userFriends) {
        return json(res, 200, profileFriendsFor(store, userId, userFriends[1]));
      }

      if (req.method === "GET" && url.pathname === "/friends") {
        return json(res, 200, {
          friends: friendsFor(store, userId),
          friendships: store.friendships.filter((item) => item.status === "accepted" && (item.requesterId === userId || item.addresseeId === userId)),
          requests: store.friendships.filter((item) => item.addresseeId === userId && item.status === "pending")
        });
      }

      if (req.method === "GET" && url.pathname === "/feed/friends") {
        return json(res, 200, friendActivity(store, userId, numberParam(url, "limit", 20), numberParam(url, "offset", 0)));
      }
      if (req.method === "GET" && url.pathname === "/circle/timeline") {
        return json(res, 200, circleTimeline(
          store, userId, numberParam(url, "limit", 20),
          url.searchParams.get("cursor") ?? undefined,
          url.searchParams.get("type") ?? "all"
        ));
      }

      if (req.method === "GET" && url.pathname === "/activity/summaries") {
        return json(res, 200, activitySummariesFor(store, userId, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined));
      }
      if (req.method === "GET" && url.pathname === "/activity/workouts") {
        return json(res, 200, activityWorkoutsFor(store, userId, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined, type: url.searchParams.get("type") ?? undefined, before: url.searchParams.get("before") ?? undefined, limit: numberParam(url, "limit", 50) }));
      }
      const workoutHeartRate = url.pathname.match(/^\/activities\/workouts\/([^/]+)\/heart-rate$/);
      if (req.method === "GET" && workoutHeartRate) {
        const workoutId = decodeURIComponent(workoutHeartRate[1]);
        workoutForExactViewer(store, userId, workoutId);
        return json(res, 200, { detail: await heartRate.getWorkoutHeartRate(workoutId) ?? null });
      }
      if (req.method === "PUT" && workoutHeartRate) {
        const workoutId = decodeURIComponent(workoutHeartRate[1]);
        const workout = store.workouts.find((item) => item.id === workoutId);
        if (!workout) throw new Error("Activity not found");
        if (workout.userId !== userId) throw new Error("Only the activity owner can upload heart rate");
        const payload = await body<{ points: WorkoutHeartRatePoint[] }>(req);
        const start = new Date(workout.startedAt).getTime() - 60_000;
        const end = new Date(workout.endedAt).getTime() + 60_000;
        if (payload.points?.some((point) => {
          const timestamp = new Date(point.recordedAt).getTime();
          return !Number.isFinite(timestamp) || timestamp < start || timestamp > end;
        })) throw new Error("Heart-rate samples must belong to the workout");
        const detail = await heartRate.replaceWorkoutHeartRate(workoutId, payload.points);
        info("workout_heart_rate_saved", { requestId, userId, workoutId, points: detail.points.length, samples: detail.sampleCount });
        return json(res, 200, detail);
      }
      const workoutSplits = url.pathname.match(/^\/activities\/workouts\/([^/]+)\/splits$/);
      if (req.method === "GET" && workoutSplits) {
        const workoutId = decodeURIComponent(workoutSplits[1]);
        workoutForExactViewer(store, userId, workoutId);
        return json(res, 200, { detail: await splits.getWorkoutSplits(workoutId) ?? null });
      }
      if (req.method === "PUT" && workoutSplits) {
        const workoutId = decodeURIComponent(workoutSplits[1]);
        const workout = store.workouts.find((item) => item.id === workoutId);
        if (!workout) throw new Error("Activity not found");
        if (workout.userId !== userId) throw new Error("Only the activity owner can upload splits");
        const payload = await body<{ splits: WorkoutSplit[] }>(req);
        const start = new Date(workout.startedAt).getTime() - 60_000;
        const end = new Date(workout.endedAt).getTime() + 60_000;
        if (payload.splits?.some((split) => {
          const splitStart = new Date(split.startedAt).getTime();
          const splitEnd = new Date(split.endedAt).getTime();
          return !Number.isFinite(splitStart) || !Number.isFinite(splitEnd) || splitStart < start || splitEnd > end;
        })) throw new Error("Splits must belong to the workout");
        for (const unit of ["kilometer", "mile"] as const) {
          const unitSplits = payload.splits?.filter((split) => split.unit === unit) ?? [];
          const distance = unitSplits.reduce((sum, split) => sum + split.distanceMeters, 0);
          const duration = unitSplits.reduce((sum, split) => sum + split.durationSeconds, 0);
          if (distance > workout.distanceMeters * 1.1 + 50 || duration > workout.durationSeconds * 1.1 + 60) throw new Error("Split totals exceed the workout");
        }
        const detail = await splits.replaceWorkoutSplits(workoutId, payload.splits);
        info("workout_splits_saved", { requestId, userId, workoutId, splits: detail.splits.length });
        return json(res, 200, detail);
      }
      const workoutDetail = url.pathname.match(/^\/activities\/workouts\/([^/]+)$/);
      const workoutInsights = url.pathname.match(/^\/activities\/workouts\/([^/]+)\/insights$/);
      if (workoutInsights) {
        const workoutId = decodeURIComponent(workoutInsights[1]);
        const workout = store.workouts.find((item) => item.id === workoutId);
        if (!workout || workout.userId !== userId) throw new Error("Activity insights are available only to the activity owner");
        if (!performanceGoals) return json(res, 503, { error: "Activity insights require PostgreSQL" });
        if (req.method === "GET") return json(res, 200, { insights: await performanceGoals.workoutInsightsFor(userId, workoutId) ?? null });
        if (req.method === "POST") {
          const payload = await body<{ force?: boolean }>(req);
          return json(res, 200, await performanceGoals.generateWorkoutInsights(userId, workoutId, payload.force === true));
        }
      }
      if (req.method === "GET" && workoutDetail) return json(res, 200, workoutForViewer(store, userId, decodeURIComponent(workoutDetail[1])));
      const summaryDetail = url.pathname.match(/^\/activities\/summaries\/([^/]+)$/);
      if (req.method === "GET" && summaryDetail) return json(res, 200, summaryForViewer(store, userId, decodeURIComponent(summaryDetail[1])));
      if (req.method === "GET" && url.pathname === "/activity/aggregates") {
        return json(res, 200, activityAggregatesFor(store, userId, numberParam(url, "weeks", 13)));
      }
      if (req.method === "GET" && url.pathname === "/me/personal-bests") {
        return json(res, 200, lifetimePersonalBests(store, userId));
      }
      if (req.method === "GET" && url.pathname === "/me/record-lab") {
        const details = await splits.splitsForWorkoutIds(store.workouts.filter((item) => item.userId === userId && item.activityType === "running").map((item) => item.id));
        return json(res, 200, personalRecordLabFor(store, userId, userId, details));
      }
      const userPersonalBests = url.pathname.match(/^\/users\/([^/]+)\/personal-bests$/);
      if (req.method === "GET" && userPersonalBests) return json(res, 200, personalBestsFor(store, userId, userPersonalBests[1]));
      const userRecordLab = url.pathname.match(/^\/users\/([^/]+)\/record-lab$/);
      if (req.method === "GET" && userRecordLab) {
        const targetId = userRecordLab[1];
        const details = await splits.splitsForWorkoutIds(store.workouts.filter((item) => item.userId === targetId && item.activityType === "running").map((item) => item.id));
        return json(res, 200, personalRecordLabFor(store, userId, targetId, details));
      }
      if (req.method === "POST" && url.pathname === "/users/summaries") {
        const payload = await body<{ ids: string[] }>(req);
        return json(res, 200, userSummaries(store, userId, payload.ids ?? []));
      }

      if (req.method === "GET" && url.pathname === "/notifications") {
        return json(res, 200, notificationsFor(store, userId, numberParam(url, "limit", 30), url.searchParams.get("before") ?? undefined, url.searchParams.get("unreadOnly") === "true"));
      }
      if (req.method === "GET" && url.pathname === "/notifications/unread-count") {
        return json(res, 200, { count: unreadNotificationCount(store, userId) });
      }
      if (req.method === "POST" && url.pathname === "/notifications/read-all") {
        const result = markAllNotificationsRead(store, userId); await persistChange({ kind: "notifications" }); return json(res, 200, result);
      }
      const notificationRoute = url.pathname.match(/^\/notifications\/([^/]+)$/);
      const notificationRead = url.pathname.match(/^\/notifications\/([^/]+)\/read$/);
      const notificationArchive = url.pathname.match(/^\/notifications\/([^/]+)\/archive$/);
      if (req.method === "POST" && notificationRead) { const result = markNotificationRead(store, userId, notificationRead[1]); await persistChange({ kind: "notifications" }); return json(res, 200, result); }
      if (req.method === "POST" && notificationArchive) { const result = archiveNotification(store, userId, notificationArchive[1]); await persistChange({ kind: "notifications" }); return json(res, 200, result); }
      if (req.method === "DELETE" && notificationRoute) { const result = deleteNotification(store, userId, notificationRoute[1]); await persistChange({ kind: "notification-delete", notificationId: notificationRoute[1], userId }); return json(res, 200, result); }

      if (req.method === "POST" && url.pathname === "/friends/requests") {
        const payload = await body<{ addresseeId: string }>(req);
        const result = sendFriendRequest(store, userId, payload.addresseeId);
        await onChange({ kind: "friendship", friendshipId: result.id });
        return json(res, 201, result);
      }

      const friendResponse = url.pathname.match(/^\/friends\/requests\/([^/]+)\/respond$/);
      if (req.method === "POST" && friendResponse) {
        const payload = await body<{ accept: boolean }>(req);
        const result = respondFriendRequest(store, friendResponse[1], userId, payload.accept);
        await onChange({ kind: "friendship", friendshipId: result.id });
        return json(res, 200, result);
      }

      const friendRemove = url.pathname.match(/^\/friends\/([^/]+)$/);
      if (req.method === "DELETE" && friendRemove) {
        const result = removeFriend(store, userId, friendRemove[1]);
        await onChange({ kind: "friendship-remove", userId, friendId: friendRemove[1] });
        return json(res, 200, result);
      }

      const userBlock = url.pathname.match(/^\/users\/([^/]+)\/block$/);
      if (req.method === "POST" && userBlock) {
        const result = blockUser(store, userId, userBlock[1]);
        await onChange({ kind: "block", blockerId: userId, blockedId: userBlock[1] });
        return json(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/me/blocked-users") {
        return json(res, 200, blockedUsersFor(store, userId));
      }
      const unblock = url.pathname.match(/^\/users\/([^/]+)\/unblock$/);
      if (req.method === "POST" && unblock) {
        const result = unblockUser(store, userId, unblock[1]);
        await onChange({ kind: "unblock", blockerId: userId, blockedId: unblock[1] });
        return json(res, 200, result);
      }

      if (req.method === "POST" && url.pathname === "/activity/summaries") {
        const result = upsertSummary(store, { ...(await body<Record<string, unknown>>(req)), userId } as Parameters<typeof upsertSummary>[1]);
        await onChange({ kind: "summary", summaryId: result.id, userId: result.userId });
        return json(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/activity/summaries/batch") {
        const payload = await body<{ summaries: Array<Omit<Parameters<typeof upsertSummary>[1], "userId">>; emitMilestones?: boolean }>(req);
        const inputs = (payload.summaries ?? []).slice(0, 90).map((summary) => ({ ...summary, userId }));
        const result = upsertSummaries(store, inputs, payload.emitMilestones !== false);
        await onChange({ kind: "summary-batch", summaryIds: result.map((item) => item.id), userId });
        const latest = [...result].sort((a, b) => b.localDate.localeCompare(a.localDate))[0];
        info("health_summaries_synced", {
          requestId,
          userId,
          summaryCount: result.length,
          latestDate: latest?.localDate,
          latestSteps: latest?.steps,
          currentStreak: store.streaks.find((item) => item.userId === userId)?.currentDays ?? 0
        });
        return json(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/activity/workouts/batch") {
        const payload = await body<{ workouts: Parameters<typeof upsertWorkouts>[2] }>(req);
        const result = upsertWorkouts(store, userId, payload.workouts ?? []);
        await onChange({ kind: "workouts", workoutIds: result.map((item) => item.id) });
        if (performanceGoals && result.length > 0) {
          await performanceGoals.evaluateNewPerformanceWorkouts(userId, result.map((item) => item.id));
        }
        for (const challenge of challengesFor(store, userId)) await onChange({ kind: "challenge", challengeId: challenge.id });
        return json(res, 201, result);
      }

      if (req.method === "GET" && url.pathname === "/leaderboards/friends") {
        return json(res, 200, friendLeaderboard(store, userId, period(url.searchParams.get("period")), leaderboardMetric(url.searchParams.get("metric"))));
      }

      if (req.method === "POST" && url.pathname === "/goals") {
        const payload = await body<Omit<Parameters<typeof addGoal>[1], "userId">>(req);
        const result = addGoal(store, { ...payload, userId });
        await onChange({ kind: "goal", goalId: result.id, userId: result.userId });
        return json(res, 201, result);
      }

      const goalRoute = url.pathname.match(/^\/goals\/([^/]+)$/);
      const goalHistoryRoute = url.pathname.match(/^\/goals\/([^/]+)\/history$/);
      if (req.method === "GET" && goalHistoryRoute) {
        const today = new Date().toISOString().slice(0, 10);
        return json(res, 200, goalHistory(
          store,
          userId,
          goalHistoryRoute[1],
          url.searchParams.get("from") ?? today,
          url.searchParams.get("to") ?? today,
          numberParam(url, "limit", 120),
          numberParam(url, "offset", 0)
        ));
      }
      if (req.method === "PATCH" && goalRoute) {
        const result = updateGoal(store, userId, goalRoute[1], await body(req));
        await onChange({ kind: "goal", goalId: result.id, userId });
        return json(res, 200, result);
      }
      if (req.method === "DELETE" && goalRoute) {
        const result = deleteGoal(store, userId, goalRoute[1]);
        await onChange({ kind: "goal-delete", goalId: goalRoute[1], userId });
        return json(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/conversations") {
        return json(res, 200, conversationsFor(store, userId));
      }

      if (req.method === "POST" && url.pathname === "/conversations") {
        const result = createConversation(store, userId, await body(req));
        await onChange({ kind: "conversation", conversationId: result.id });
        return json(res, 201, result);
      }

      const conversationMessages = url.pathname.match(/^\/conversations\/([^/]+)\/messages$/);
      if (req.method === "GET" && conversationMessages) {
        return json(res, 200, messagesForConversation(store, userId, conversationMessages[1], numberParam(url, "limit", 50), url.searchParams.get("before") ?? undefined));
      }

      const conversationMute = url.pathname.match(/^\/conversations\/([^/]+)\/mute$/);
      if (req.method === "PATCH" && conversationMute) {
        const payload = await body<{ muted: boolean }>(req);
        const result = setConversationMuted(store, userId, conversationMute[1], payload.muted);
        await onChange({ kind: "conversation-settings", conversationId: result.id, userId });
        return json(res, 200, result);
      }

      const conversationLeave = url.pathname.match(/^\/conversations\/([^/]+)\/leave$/);
      if (req.method === "POST" && conversationLeave) {
        const result = leaveConversation(store, userId, conversationLeave[1]);
        await onChange({ kind: "conversation-leave", conversationId: conversationLeave[1], userId });
        return json(res, 200, result);
      }

      const conversationMembersRoute = url.pathname.match(/^\/conversations\/([^/]+)\/members$/);
      if (req.method === "POST" && conversationMembersRoute) {
        const payload = await body<{ memberIds: string[] }>(req);
        const result = addConversationMembers(store, userId, conversationMembersRoute[1], payload.memberIds);
        await onChange({ kind: "conversation", conversationId: conversationMembersRoute[1] });
        return json(res, 200, result);
      }

      if (req.method === "POST" && conversationMessages) {
        const payload = await body<{ body: string }>(req);
        const result = addMessage(store, userId, { conversationId: conversationMessages[1], body: payload.body });
        await onChange({ kind: "message", messageId: result.id });
        return json(res, 201, result);
      }

      const conversationRead = url.pathname.match(/^\/conversations\/([^/]+)\/read$/);
      if (req.method === "POST" && conversationRead) {
        const result = markConversationRead(store, userId, conversationRead[1]);
        await onChange({ kind: "conversation-read", conversationId: conversationRead[1], userId });
        return json(res, 200, result);
      }

      const conversationCompare = url.pathname.match(/^\/conversations\/([^/]+)\/comparison$/);
      if (req.method === "GET" && conversationCompare) {
        return json(res, 200, conversationComparison(store, userId, conversationCompare[1], period(url.searchParams.get("period")), leaderboardMetric(url.searchParams.get("metric"))));
      }

      const messageReaction = url.pathname.match(/^\/messages\/([^/]+)\/reactions$/);
      if (req.method === "POST" && messageReaction) {
        const payload = await body<{ kind: any }>(req);
        const result = reactToMessage(store, userId, messageReaction[1], payload.kind);
        await onChange({ kind: "message-reactions", messageId: messageReaction[1] });
        return json(res, 200, result);
      }

      if (req.method === "POST" && url.pathname === "/challenges") {
        const payload = await body<Omit<Parameters<typeof addChallenge>[1], "creatorId">>(req);
        const result = addChallenge(store, { ...payload, creatorId: userId });
        await onChange({ kind: "challenge", challengeId: result.id, includeSharedMessages: Boolean(result.sharedConversationId) });
        return json(res, 201, result);
      }

      if (req.method === "GET" && url.pathname === "/challenges") {
        const result = challengesFor(store, userId);
        for (const challenge of result) await onChange({ kind: "challenge", challengeId: challenge.id });
        return json(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/challenges/stats") {
        return json(res, 200, challengeCareerStats(store, userId));
      }
      const friendChallengeHistory = url.pathname.match(/^\/friends\/([^/]+)\/challenge-history$/);
      if (req.method === "GET" && friendChallengeHistory) return json(res, 200, challengeHistoryBetween(store, userId, friendChallengeHistory[1]));

      const workoutSocial = url.pathname.match(/^\/activities\/workouts\/([^/]+)\/social$/);
      if (req.method === "PATCH" && workoutSocial) {
        const result = updateWorkoutSocialMetadata(store, userId, workoutSocial[1], await body(req));
        await onChange({ kind: "workouts", workoutIds: [result.id] });
        return json(res, 200, result);
      }
      const workoutReactions = url.pathname.match(/^\/activities\/workouts\/([^/]+)\/reactions$/);
      if (req.method === "GET" && workoutReactions) return json(res, 200, workoutReactionsFor(store, userId, workoutReactions[1]));
      if ((req.method === "PUT" || req.method === "POST") && workoutReactions) {
        const payload = await body<{ isClapped: boolean }>(req);
        const result = setWorkoutClap(store, userId, workoutReactions[1], payload.isClapped === true);
        await onChange({ kind: "workout-reactions", workoutId: workoutReactions[1] });
        return json(res, 200, result);
      }

      if (req.method === "POST" && url.pathname === "/activities/workouts/compare") {
        const payload = await body<{ firstId: string; secondId: string }>(req);
        return json(res, 200, compareWorkouts(store, userId, payload.firstId, payload.secondId));
      }

      const challengeDetail = url.pathname.match(/^\/challenges\/([^/]+)$/);
      if (req.method === "GET" && challengeDetail) {
        const result = challengeFor(store, userId, challengeDetail[1]);
        await onChange({ kind: "challenge", challengeId: result.id });
        return json(res, 200, result);
      }

      const challengeComments = url.pathname.match(/^\/challenges\/([^/]+)\/comments$/);
      if (req.method === "GET" && challengeComments) return json(res, 200, challengeCommentsFor(store, userId, challengeComments[1]));
      if (req.method === "POST" && challengeComments) {
        const payload = await body<{ body: string }>(req);
        const result = addChallengeComment(store, userId, challengeComments[1], payload.body);
        await onChange({ kind: "challenge-comment", commentId: result.id });
        return json(res, 201, result);
      }

      const challengeRespond = url.pathname.match(/^\/challenges\/([^/]+)\/respond$/);
      if (req.method === "POST" && challengeRespond) {
        const payload = await body<{ accept: boolean }>(req);
        const result = respondChallenge(store, challengeRespond[1], userId, payload.accept);
        await onChange({ kind: "challenge", challengeId: result.id });
        return json(res, 200, result);
      }

      const rematch = url.pathname.match(/^\/challenges\/([^/]+)\/rematch$/);
      if (req.method === "POST" && rematch) {
        const result = rematchChallenge(store, rematch[1]);
        await onChange({ kind: "challenge", challengeId: result.id });
        return json(res, 201, result);
      }

      const share = url.pathname.match(/^\/challenges\/([^/]+)\/share$/);
      if (req.method === "POST" && share) {
        const payload = await body<{ conversationId: string }>(req);
        const result = shareChallenge(store, userId, share[1], payload.conversationId);
        await onChange({ kind: "challenge", challengeId: result.id, includeSharedMessages: true });
        return json(res, 201, result);
      }

      const reaction = url.pathname.match(/^\/feed\/([^/]+)\/reactions$/);
      if (req.method === "POST" && reaction) {
        const result = addReaction(store, reaction[1], await body(req));
        await onChange({ kind: "reaction", reactionId: result.id });
        return json(res, 201, result);
      }

      if (req.method === "GET" && url.pathname === "/recaps/weekly") {
        return json(res, 200, weeklyRecapFor(store, userId));
      }
      if (req.method === "GET" && url.pathname === "/recaps/monthly") {
        return json(res, 200, monthlyRecapFor(store, userId, url.searchParams.get("month") ?? undefined));
      }

      const profileHighlights = url.pathname.match(/^\/users\/([^/]+)\/highlights$/);
      if (req.method === "GET" && profileHighlights) return json(res, 200, profileHighlightsFor(store, userId, profileHighlights[1]));
      if (req.method === "PUT" && url.pathname === "/me/highlights") {
        const payload = await body<{ items: Array<{ kind: "badge" | "personalRecord" | "challenge" | "workout"; entityId: string }> }>(req);
        const result = replaceProfileHighlights(store, userId, payload.items);
        await onChange({ kind: "profile-highlights", userId });
        return json(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/badges") {
        const newlyEarned = refreshBadgesForUser(store, userId);
        if (newlyEarned.length > 0) await onChange({ kind: "badges", userId });
        return json(res, 200, {
          badges: store.badges,
          userBadges: store.userBadges.filter((item) => item.userId === userId),
          progress: badgeProgressForUser(store, userId)
        });
      }

      if (req.method === "POST" && url.pathname === "/devices") {
        const payload = await body<{ token: string }>(req);
        store.deviceTokens.push({ userId, token: payload.token, platform: "ios", createdAt: new Date().toISOString() });
        await onChange({ kind: "device", userId, token: payload.token });
        return json(res, 201, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/notifications/test") {
        const payload = await body<{ token: string; title?: string; body?: string }>(req);
        return json(res, 202, await sendApnsPush(config, payload.token, {
          title: payload.title ?? "HansUp",
          body: payload.body ?? "Push notifications are connected.",
          category: "test"
        }));
      }

      if (req.method === "GET" && url.pathname === "/me/export") {
        const exported = exportAccount(store, userId);
        const workoutIds = store.workouts.filter((item) => item.userId === userId).map((item) => item.id);
        return json(res, 200, {
          ...exported,
          workoutHeartRate: await heartRate.heartRateForWorkoutIds(workoutIds),
          workoutSplits: await splits.splitsForWorkoutIds(workoutIds)
        });
      }

      if (req.method === "POST" && url.pathname === "/reports") {
        const result = addReport(store, userId, await body(req));
        await onChange({ kind: "report", reportId: result.id });
        return json(res, 201, result);
      }

      if (req.method === "DELETE" && url.pathname === "/me") {
        const result = deleteAccount(store, userId);
        await onChange({ kind: "account-delete", userId });
        return json(res, 200, result);
      }

      return json(res, 404, { error: "Not found" });
    } catch (error) {
      logError("request_failed", error, { requestId, method, path: requestPath, durationMs: Date.now() - startedAt });
      return json(res, 400, { error: error instanceof Error ? error.message : "Bad request" });
    }
  });
}

function json(res: any, status: number, payload: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-user-id,authorization"
  });
  res.end(JSON.stringify(payload));
}

async function body<T>(req: any): Promise<T> {
  const chunks: unknown[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 5 * 1024 * 1024) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

function period(value: string | null): LeaderboardPeriod {
  return value === "today" || value === "week" || value === "month" || value === "all" ? value : "week";
}

function leaderboardMetric(value: string | null): LeaderboardMetric {
  return value === "distance" || value === "walking" || value === "running" || value === "activeMinutes" || value === "calories" || value === "strengthSessions"
    ? value
    : "steps";
}

function numberParam(url: URL, name: string, fallback: number): number {
  const value = Number(url.searchParams.get(name));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}
