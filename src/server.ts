import http from "node:http";
import { URL } from "node:url";
import { deleteAvatar, storeAvatar } from "./storage.js";
import {
  addChallenge,
  activityAggregatesFor,
  activitySummariesFor,
  activityWorkoutsFor,
  addGoal,
  addMessage,
  addReaction,
  AppStore,
  authWithIdentity,
  blockUser,
  blockedUsersFor,
  unblockUser,
  exportAccount,
  deleteAccount,
  addReport,
  conversationComparison,
  challengesFor,
  challengeFor,
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
  userSummaries,
  profileActivity,
  publicProfile,
  reactToMessage,
  rematchChallenge,
  removeFriend,
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
  weeklyRecapFor
} from "./store.js";
import { LeaderboardPeriod } from "./domain.js";
import { sendApnsPush } from "./apns.js";
import { ProductionConfig, productionConfig } from "./config.js";
import { exchangeGoogleAuthorizationCode, verifyGoogleIdentity } from "./auth.js";
import type { PersistenceChange } from "./postgres.js";
import { error as logError, info, warn } from "./logger.js";

const demoUserId = "u_ama";

export function createServer(
  store: AppStore = createDemoStore(),
  config: ProductionConfig = productionConfig(),
  persistChange: (change: PersistenceChange) => Promise<void> = async () => {}
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
        return json(res, 200, currentUser(store, userId));
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

      if (req.method === "GET" && url.pathname === "/activity/summaries") {
        return json(res, 200, activitySummariesFor(store, userId, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined));
      }
      if (req.method === "GET" && url.pathname === "/activity/workouts") {
        return json(res, 200, activityWorkoutsFor(store, userId, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined, type: url.searchParams.get("type") ?? undefined, before: url.searchParams.get("before") ?? undefined, limit: numberParam(url, "limit", 50) }));
      }
      if (req.method === "GET" && url.pathname === "/activity/aggregates") {
        return json(res, 200, activityAggregatesFor(store, userId, numberParam(url, "weeks", 13)));
      }
      if (req.method === "GET" && url.pathname === "/me/personal-bests") {
        return json(res, 200, lifetimePersonalBests(store, userId));
      }
      const userPersonalBests = url.pathname.match(/^\/users\/([^/]+)\/personal-bests$/);
      if (req.method === "GET" && userPersonalBests) return json(res, 200, personalBestsFor(store, userId, userPersonalBests[1]));
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
        const payload = await body<{ summaries: Array<Omit<Parameters<typeof upsertSummary>[1], "userId">> }>(req);
        const inputs = (payload.summaries ?? []).slice(0, 90).map((summary) => ({ ...summary, userId }));
        const result = upsertSummaries(store, inputs);
        await onChange({ kind: "summary-batch", summaryIds: result.map((item) => item.id), userId });
        return json(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/activity/workouts/batch") {
        const payload = await body<{ workouts: Parameters<typeof upsertWorkouts>[2] }>(req);
        const result = upsertWorkouts(store, userId, payload.workouts ?? []);
        await onChange({ kind: "workouts", workoutIds: result.map((item) => item.id) });
        for (const challenge of challengesFor(store, userId)) await onChange({ kind: "challenge", challengeId: challenge.id });
        return json(res, 201, result);
      }

      if (req.method === "GET" && url.pathname === "/leaderboards/friends") {
        return json(res, 200, friendLeaderboard(store, userId, period(url.searchParams.get("period"))));
      }

      if (req.method === "POST" && url.pathname === "/goals") {
        const payload = await body<Omit<Parameters<typeof addGoal>[1], "userId">>(req);
        const result = addGoal(store, { ...payload, userId });
        await onChange({ kind: "goal", goalId: result.id, userId: result.userId });
        return json(res, 201, result);
      }

      const goalRoute = url.pathname.match(/^\/goals\/([^/]+)$/);
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
        return json(res, 200, conversationComparison(store, userId, conversationCompare[1], period(url.searchParams.get("period"))));
      }

      const messageReaction = url.pathname.match(/^\/messages\/([^/]+)\/reactions$/);
      if (req.method === "POST" && messageReaction) {
        const payload = await body<{ kind: any }>(req);
        const result = reactToMessage(store, userId, messageReaction[1], payload.kind);
        await onChange({ kind: "reaction", reactionId: result.id });
        return json(res, 201, result);
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

      const challengeDetail = url.pathname.match(/^\/challenges\/([^/]+)$/);
      if (req.method === "GET" && challengeDetail) {
        const result = challengeFor(store, userId, challengeDetail[1]);
        await onChange({ kind: "challenge", challengeId: result.id });
        return json(res, 200, result);
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

      if (req.method === "GET" && url.pathname === "/badges") {
        return json(res, 200, {
          badges: store.badges,
          userBadges: store.userBadges.filter((item) => item.userId === userId)
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
        return json(res, 200, exportAccount(store, userId));
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
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
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

function numberParam(url: URL, name: string, fallback: number): number {
  const value = Number(url.searchParams.get(name));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}
