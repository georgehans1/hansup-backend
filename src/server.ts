import http from "node:http";
import { URL } from "node:url";
import {
  addChallenge,
  addGoal,
  addMessage,
  addReaction,
  AppStore,
  authWithIdentity,
  blockUser,
  conversationComparison,
  conversationsFor,
  createConversation,
  createDemoStore,
  currentUser,
  friendLeaderboard,
  friendsFor,
  markConversationRead,
  messagesForConversation,
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
  upsertSummary,
  weeklyRecapFor
} from "./store.js";
import { LeaderboardPeriod } from "./domain.js";
import { sendApnsPush } from "./apns.js";
import { ProductionConfig, productionConfig } from "./config.js";
import { exchangeGoogleAuthorizationCode, verifyGoogleIdentity } from "./auth.js";

const demoUserId = "u_ama";

export function createServer(
  store: AppStore = createDemoStore(),
  config: ProductionConfig = productionConfig(),
  onChange: () => Promise<void> = async () => {}
) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const userId = req.headers["x-user-id"]?.toString() || demoUserId;

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
        await onChange();
        return json(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/auth/google/code") {
        const payload = await body<{ code: string; codeVerifier: string; redirectUri: string }>(req);
        const identity = await exchangeGoogleAuthorizationCode({ ...payload, config });
        const result = authWithIdentity(store, identity, config.jwtSecret ?? "demo-secret");
        await onChange();
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
        await onChange();
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

      if (req.method === "PATCH" && url.pathname === "/me/settings") {
        const result = updateUserSettings(store, userId, await body(req));
        await onChange();
        return json(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/users/search") {
        return json(res, 200, searchUsers(store, userId, url.searchParams.get("q") ?? ""));
      }

      const userProfile = url.pathname.match(/^\/users\/([^/]+)$/);
      if (req.method === "GET" && userProfile) {
        return json(res, 200, publicProfile(store, userId, userProfile[1]));
      }

      const userActivity = url.pathname.match(/^\/users\/([^/]+)\/activity$/);
      if (req.method === "GET" && userActivity) {
        return json(res, 200, profileActivity(store, userId, userActivity[1]));
      }

      if (req.method === "GET" && url.pathname === "/friends") {
        return json(res, 200, {
          friends: friendsFor(store, userId),
          requests: store.friendships.filter((item) => item.addresseeId === userId && item.status === "pending")
        });
      }

      if (req.method === "POST" && url.pathname === "/friends/requests") {
        const payload = await body<{ addresseeId: string }>(req);
        const result = sendFriendRequest(store, userId, payload.addresseeId);
        await onChange();
        return json(res, 201, result);
      }

      const friendResponse = url.pathname.match(/^\/friends\/requests\/([^/]+)\/respond$/);
      if (req.method === "POST" && friendResponse) {
        const payload = await body<{ accept: boolean }>(req);
        const result = respondFriendRequest(store, friendResponse[1], userId, payload.accept);
        await onChange();
        return json(res, 200, result);
      }

      const friendRemove = url.pathname.match(/^\/friends\/([^/]+)$/);
      if (req.method === "DELETE" && friendRemove) {
        const result = removeFriend(store, userId, friendRemove[1]);
        await onChange();
        return json(res, 200, result);
      }

      const userBlock = url.pathname.match(/^\/users\/([^/]+)\/block$/);
      if (req.method === "POST" && userBlock) {
        const result = blockUser(store, userId, userBlock[1]);
        await onChange();
        return json(res, 200, result);
      }

      if (req.method === "POST" && url.pathname === "/activity/summaries") {
        const result = upsertSummary(store, await body(req));
        await onChange();
        return json(res, 201, result);
      }

      if (req.method === "GET" && url.pathname === "/leaderboards/friends") {
        return json(res, 200, friendLeaderboard(store, userId, period(url.searchParams.get("period"))));
      }

      if (req.method === "POST" && url.pathname === "/goals") {
        const result = addGoal(store, await body(req));
        await onChange();
        return json(res, 201, result);
      }

      if (req.method === "GET" && url.pathname === "/conversations") {
        return json(res, 200, conversationsFor(store, userId));
      }

      if (req.method === "POST" && url.pathname === "/conversations") {
        const result = createConversation(store, userId, await body(req));
        await onChange();
        return json(res, 201, result);
      }

      const conversationMessages = url.pathname.match(/^\/conversations\/([^/]+)\/messages$/);
      if (req.method === "GET" && conversationMessages) {
        return json(res, 200, messagesForConversation(store, userId, conversationMessages[1]));
      }

      if (req.method === "POST" && conversationMessages) {
        const payload = await body<{ body: string }>(req);
        const result = addMessage(store, userId, { conversationId: conversationMessages[1], body: payload.body });
        await onChange();
        return json(res, 201, result);
      }

      const conversationRead = url.pathname.match(/^\/conversations\/([^/]+)\/read$/);
      if (req.method === "POST" && conversationRead) {
        const result = markConversationRead(store, userId, conversationRead[1]);
        await onChange();
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
        await onChange();
        return json(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/challenges") {
        const result = addChallenge(store, await body(req));
        await onChange();
        return json(res, 201, result);
      }

      const challengeRespond = url.pathname.match(/^\/challenges\/([^/]+)\/respond$/);
      if (req.method === "POST" && challengeRespond) {
        const payload = await body<{ accept: boolean }>(req);
        const result = respondChallenge(store, challengeRespond[1], userId, payload.accept);
        await onChange();
        return json(res, 200, result);
      }

      const rematch = url.pathname.match(/^\/challenges\/([^/]+)\/rematch$/);
      if (req.method === "POST" && rematch) {
        const result = rematchChallenge(store, rematch[1]);
        await onChange();
        return json(res, 201, result);
      }

      const share = url.pathname.match(/^\/challenges\/([^/]+)\/share$/);
      if (req.method === "POST" && share) {
        const payload = await body<{ conversationId: string }>(req);
        const result = shareChallenge(store, userId, share[1], payload.conversationId);
        await onChange();
        return json(res, 201, result);
      }

      const reaction = url.pathname.match(/^\/feed\/([^/]+)\/reactions$/);
      if (req.method === "POST" && reaction) {
        const result = addReaction(store, reaction[1], await body(req));
        await onChange();
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
        await onChange();
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

      if (req.method === "DELETE" && url.pathname === "/me") {
        return json(res, 202, { ok: true, message: "Account deletion requested" });
      }

      return json(res, 404, { error: "Not found" });
    } catch (error) {
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
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

function period(value: string | null): LeaderboardPeriod {
  return value === "today" || value === "week" || value === "month" || value === "all" ? value : "week";
}
