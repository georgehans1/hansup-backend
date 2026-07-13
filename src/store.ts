import {
  ActivityComparison,
  ActivitySummary,
  Badge,
  Challenge,
  ChallengeParticipant,
  ChallengeTemplate,
  Conversation,
  ConversationMember,
  FeedItem,
  Friendship,
  Goal,
  ID,
  LeaderboardPeriod,
  Message,
  ProfileStats,
  Reaction,
  ReactionKind,
  Streak,
  User,
  UserBadge,
  UserSettings,
  WorkoutSummary,
  calculateStreak,
  addLocalDays,
  detectTrustLevel,
  earnedBadges,
  generateWeeklyRecap,
  leaderboardRows,
  localDateForTimeZone,
  startOfWeek,
  scoreChallenge
} from "./domain.js";
import { TokenPair, VerifiedIdentity, issueDemoTokens } from "./auth.js";

export interface AppStore {
  users: User[];
  settings: UserSettings[];
  friendships: Friendship[];
  summaries: ActivitySummary[];
  workouts: WorkoutSummary[];
  goals: Goal[];
  streaks: Streak[];
  challenges: Challenge[];
  feed: FeedItem[];
  conversations: Conversation[];
  conversationMembers: ConversationMember[];
  messages: Message[];
  badges: Badge[];
  userBadges: UserBadge[];
  blockedUsers: Array<{ blockerId: ID; blockedId: ID; createdAt: string }>;
  deviceTokens: Array<{ userId: ID; token: string; platform: "ios"; createdAt: string }>;
  reports: Array<{ id: ID; reporterId: ID; targetType: "user" | "message"; targetId: ID; reason: string; createdAt: string }>;
}

export function createEmptyStore(): AppStore {
  return {
    users: [],
    settings: [],
    friendships: [],
    summaries: [],
    workouts: [],
    goals: [],
    streaks: [],
    challenges: [],
    feed: [],
    conversations: [],
    conversationMembers: [],
    messages: [],
    badges: defaultBadges(),
    userBadges: [],
    blockedUsers: [],
    deviceTokens: [],
    reports: []
  };
}

export function createDemoStore(): AppStore {
  const now = new Date().toISOString();
  const users: User[] = [
    user("u_ama", "ama", "Ama Mensah", "ama@example.com", "#44d9e8", "2024-01-11T09:00:00Z"),
    user("u_kofi", "kofi", "Kofi Boateng", "kofi@example.com", "#c8ff47", "2024-02-18T09:00:00Z"),
    user("u_eli", "eli", "Eli Grant", "eli@example.com", "#7b6fff", "2024-03-02T09:00:00Z"),
    user("u_maya", "maya", "Maya Lin", "maya@example.com", "#ff6b9d", "2024-04-22T09:00:00Z"),
    user("u_sam", "sam", "Sam Rivera", "sam@example.com", "#ff6b35", "2024-05-03T09:00:00Z")
  ];

  const friendships: Friendship[] = [
    friendship("fr_ama_kofi", "u_ama", "u_kofi", "accepted", now),
    friendship("fr_ama_eli", "u_ama", "u_eli", "accepted", now),
    friendship("fr_ama_maya", "u_maya", "u_ama", "accepted", now),
    friendship("fr_sam_ama", "u_sam", "u_ama", "pending", now)
  ];

  const summaries = [
    ...week("u_ama", [9400, 11400, 7800, 10100, 8900, 12300, 11200], [700, 750, 510, 620, 590, 820, 780]),
    ...week("u_kofi", [8700, 12900, 10400, 9100, 15000, 9800, 12900], [640, 860, 690, 600, 980, 620, 880]),
    ...week("u_eli", [7600, 10100, 9300, 8700, 8200, 11100, 10100], [520, 640, 610, 570, 540, 700, 660]),
    ...week("u_maya", [12000, 14100, 9200, 16000, 11800, 13200, 14300], [820, 940, 610, 1010, 780, 880, 960]),
    ...week("u_sam", [6800, 7600, 8200, 9100, 7300, 8600, 9400], [450, 500, 540, 610, 480, 570, 630])
  ];

  const goals: Goal[] = [
    { id: "g_ama_steps", userId: "u_ama", kind: "steps", cadence: "daily", target: 10000, isEnabled: true, createdAt: now },
    { id: "g_ama_distance", userId: "u_ama", kind: "distance", cadence: "weekly", target: 50000, isEnabled: true, createdAt: now },
    { id: "g_kofi_run", userId: "u_kofi", kind: "running", cadence: "weekly", target: 15000, isEnabled: true, createdAt: now },
    { id: "g_maya_steps", userId: "u_maya", kind: "steps", cadence: "daily", target: 12000, isEnabled: true, createdAt: now }
  ];

  const streaks: Streak[] = [
    { userId: "u_ama", currentDays: 14, bestDays: 21, updatedAt: now },
    { userId: "u_kofi", currentDays: 7, bestDays: 18, updatedAt: now },
    { userId: "u_eli", currentDays: 4, bestDays: 10, updatedAt: now },
    { userId: "u_maya", currentDays: 23, bestDays: 29, updatedAt: now },
    { userId: "u_sam", currentDays: 2, bestDays: 6, updatedAt: now }
  ];

  const challenge: Challenge = {
    id: "c_week_steps",
    creatorId: "u_ama",
    title: "Weekly Step Sprint",
    kind: "steps",
    template: "weekly_steps",
    startsOn: "2026-06-16",
    endsOn: "2026-06-22",
    status: "active",
    participants: ["u_ama", "u_kofi", "u_eli", "u_maya"].map((userId) => participant(userId, true, "steps", summaries)),
    createdAt: now
  };
  const completed: Challenge = {
    id: "c_weekend",
    creatorId: "u_ama",
    title: "Weekend Warrior",
    kind: "steps",
    template: "weekend_steps",
    startsOn: "2026-06-20",
    endsOn: "2026-06-21",
    status: "completed",
    participants: ["u_ama", "u_kofi"].map((userId) => participant(userId, true, "steps", summaries)),
    createdAt: now
  };
  const pending: Challenge = {
    id: "c_sam_invite",
    creatorId: "u_sam",
    title: "Most Steps in 24 Hours",
    kind: "steps",
    template: "weekend_steps",
    startsOn: "2026-06-22",
    endsOn: "2026-06-22",
    status: "inviting",
    participants: [participant("u_sam", true, "steps", summaries), participant("u_ama", false, "steps", summaries)],
    createdAt: now
  };

  const conversation: Conversation = {
    id: "conv_squad",
    kind: "group",
    title: "HansUp Squad",
    createdBy: "u_ama",
    createdAt: now,
    mutedBy: []
  };
  const direct: Conversation = {
    id: "conv_ama_kofi",
    kind: "direct",
    createdBy: "u_kofi",
    createdAt: now,
    mutedBy: []
  };
  const conversationMembers = [
    ...["u_ama", "u_kofi", "u_eli", "u_maya"].map((userId) => member("conv_squad", userId, userId === "u_ama" ? "owner" : "member", now)),
    member("conv_ama_kofi", "u_ama", "member", now),
    member("conv_ama_kofi", "u_kofi", "owner", now)
  ];

  const feed: FeedItem[] = [
    feedItem("f_1", "u_maya", "rank", "Maya took first", "14,300 steps moved Maya to the top of the weekly leaderboard.", now),
    feedItem("f_2", "u_ama", "goal", "Ama hit a daily goal", "10k steps complete with room to spare.", now),
    feedItem("f_3", "u_kofi", "challenge", "Kofi wants a rematch", "Weekend Warrior is ready for another round.", now)
  ];

  const messages: Message[] = [
    systemMessage("m_0", "conv_squad", "Maya hit 14,300 steps, a new squad record!", now),
    chatMessage("m_1", "conv_squad", "u_maya", "I just hit 14K!!", now, ["u_maya"]),
    chatMessage("m_2", "conv_squad", "u_kofi", "No way. Absolute beast mode.", now, ["u_ama", "u_kofi"]),
    chatMessage("m_3", "conv_squad", "u_ama", "I am at 11K and fighting for my life.", now, ["u_ama"]),
    chatMessage("m_4", "conv_ama_kofi", "u_kofi", "You are close. Evening walk?", now, ["u_kofi"])
  ];
  messages[0].reactions.push(reaction("rx_1", "message", "m_0", "u_ama", "fire", now));
  messages[1].reactions.push(reaction("rx_2", "message", "m_1", "u_kofi", "cheer", now));
  feed[0].reactions.push(reaction("frx_1", "feed", "f_1", "u_ama", "fire", now));

  const badges: Badge[] = defaultBadges();
  const userBadges = [
    { id: "ub_ama_streak", userId: "u_ama", badgeId: "badge_streak_7", earnedAt: now },
    { id: "ub_ama_win", userId: "u_ama", badgeId: "badge_first_win", earnedAt: now },
    { id: "ub_ama_steps", userId: "u_ama", badgeId: "badge_steps_100k", earnedAt: now }
  ];

  return {
    users,
    settings: users.map((item) => ({
      userId: item.id,
      hideActivityFromFriends: false,
      hideExactNumbers: false,
      searchable: true,
      pushMessages: true,
      pushFriendRequests: true,
      pushChallenges: true,
      pushMilestones: true
    })),
    friendships,
    summaries,
    workouts: [],
    goals,
    streaks,
    challenges: [challenge, completed, pending],
    feed,
    conversations: [conversation, direct],
    conversationMembers,
    messages,
    badges,
    userBadges,
    blockedUsers: [],
    deviceTokens: [],
    reports: []
  };
}

export function googleAuth(store: AppStore, input: { idToken: string; email?: string; displayName?: string }): { accessToken: string; refreshToken: string; user: User; needsUsername: boolean } {
  const email = input.email ?? "ama@example.com";
  return authWithIdentity(store, { provider: "google", subject: input.idToken || email, email, displayName: input.displayName }, "demo-secret");
}

export function authWithIdentity(store: AppStore, identity: VerifiedIdentity, tokenSecret: string): TokenPair & { user: User; needsUsername: boolean } {
  const email = identity.email ?? `${identity.subject}@${identity.provider}.local`;
  let saved = store.users.find((item) => item.email === email);
  const isNewUser = !saved;
  if (!saved) {
    const suffix = Math.random().toString(36).slice(2, 9);
    const id = `u_${slug(email.split("@")[0])}_${suffix}`;
    const username = `user_${suffix}`;
    saved = user(id, username, username, email, "#44d9e8", new Date().toISOString());
    store.users.push(saved);
    store.settings.push({
      userId: saved.id,
      hideActivityFromFriends: false,
      hideExactNumbers: false,
      searchable: true,
      pushMessages: true,
      pushFriendRequests: true,
      pushChallenges: true,
      pushMilestones: true
    });
    store.streaks.push({ userId: saved.id, currentDays: 0, bestDays: 0, updatedAt: new Date().toISOString() });
  }
  if (!store.goals.some((goal) => goal.userId === saved.id && goal.kind === "steps" && goal.cadence === "daily")) {
    store.goals.push({
      id: `goal_${saved.id}_daily_steps`,
      userId: saved.id,
      kind: "steps",
      cadence: "daily",
      target: 10_000,
      isEnabled: true,
      createdAt: new Date().toISOString()
    });
  }
  return { ...issueDemoTokens(saved.id, tokenSecret), user: saved, needsUsername: isNewUser };
}

export function currentUser(store: AppStore, userId = "u_ama") {
  const user = requireUser(store, userId);
  return {
    user,
    settings: store.settings.find((item) => item.userId === userId),
    profileStats: profileStats(store, userId),
    streak: store.streaks.find((item) => item.userId === userId),
    goals: store.goals.filter((item) => item.userId === userId),
    badges: badgesForUser(store, userId)
  };
}

export function updateUserProfile(store: AppStore, userId: ID, patch: { username?: string; displayName?: string; avatarURL?: string }): User {
  const user = requireUser(store, userId);
  if (patch.username !== undefined) {
    const username = slug(patch.username);
    if (username.length < 3) throw new Error("Username must be at least 3 characters");
    if (store.users.some((item) => item.id !== userId && item.username.toLowerCase() === username.toLowerCase())) {
      throw new Error("Username is already taken");
    }
    user.username = username;
    user.displayName = username;
  } else if (patch.displayName !== undefined) {
    const username = slug(patch.displayName);
    if (username.length < 3) throw new Error("Username must be at least 3 characters");
    if (store.users.some((item) => item.id !== userId && item.username.toLowerCase() === username.toLowerCase())) {
      throw new Error("Username is already taken");
    }
    user.username = username;
    user.displayName = username;
  }
  if (patch.avatarURL !== undefined) user.avatarURL = patch.avatarURL;
  return user;
}

export function updateUserSettings(store: AppStore, userId: ID, patch: Partial<UserSettings>): UserSettings {
  const current = store.settings.find((item) => item.userId === userId);
  if (!current) throw new Error("Settings not found");
  Object.assign(current, patch, { userId });
  const user = requireUser(store, userId);
  user.searchable = current.searchable;
  return current;
}

export function searchUsers(store: AppStore, viewerId: ID, query: string, limit = 20, offset = 0) {
  const lowered = query.trim().toLowerCase();
  return store.users
    .filter((item) => item.id !== viewerId && item.searchable)
    .filter((item) => item.username.toLowerCase().includes(lowered) || item.email?.toLowerCase().includes(lowered) || item.displayName.toLowerCase().includes(lowered))
    .slice(offset, offset + Math.min(Math.max(limit, 1), 50))
    .map((item) => publicProfile(store, viewerId, item.id));
}

export function publicProfile(store: AppStore, viewerId: ID, userId: ID) {
  const user = requireUser(store, userId);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    avatarURL: user.avatarURL,
    joinedAt: user.joinedAt,
    friendshipStatus: friendshipStatus(store, viewerId, userId)
  };
}

export function profileActivity(store: AppStore, viewerId: ID, userId: ID) {
  const status = friendshipStatus(store, viewerId, userId);
  const privacy = store.settings.find((item) => item.userId === userId);
  if (viewerId !== userId && status !== "accepted") {
    return { profile: publicProfile(store, viewerId, userId), summaries: [], workouts: [], feed: [], stats: undefined, records: undefined, badges: [], activityHidden: true, exactNumbersHidden: false };
  }
  if (viewerId !== userId && privacy?.hideActivityFromFriends) {
    return { profile: publicProfile(store, viewerId, userId), summaries: [], workouts: [], feed: [], stats: undefined, records: undefined, badges: [], activityHidden: true, exactNumbersHidden: false };
  }
  const hideExact = viewerId !== userId && Boolean(privacy?.hideExactNumbers);
  return {
    profile: publicProfile(store, viewerId, userId),
    summaries: hideExact ? [] : store.summaries.filter((summary) => summary.userId === userId),
    workouts: store.workouts.filter((workout) => workout.userId === userId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((workout) => hideExact ? { ...workout, durationSeconds: 0, distanceMeters: 0, calories: 0 } : workout),
    feed: store.feed.filter((item) => item.userId === userId),
    stats: hideExact ? undefined : profileStats(store, userId),
    records: hideExact ? undefined : profileRecords(store, userId),
    badges: badgesForUser(store, userId),
    activityHidden: false,
    exactNumbersHidden: hideExact
  };
}

export function friendActivity(store: AppStore, viewerId: ID, limit = 20, offset = 0) {
  const friendIds = new Set(friendsFor(store, viewerId).map((user) => user.id));
  return store.workouts
    .filter((workout) => friendIds.has(workout.userId) && !store.settings.find((item) => item.userId === workout.userId)?.hideActivityFromFriends)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(offset, offset + Math.min(Math.max(limit, 1), 50))
    .map((workout) => store.settings.find((item) => item.userId === workout.userId)?.hideExactNumbers
      ? { ...workout, durationSeconds: 0, distanceMeters: 0, calories: 0 }
      : workout);
}

export function upsertWorkouts(store: AppStore, userId: ID, input: Array<Omit<WorkoutSummary, "id" | "userId" | "source" | "trustLevel" | "updatedAt">>): WorkoutSummary[] {
  const allowed = new Set(["walking", "running", "strengthTraining"]);
  const now = new Date().toISOString();
  const savedWorkouts = input.map((workout) => {
    if (!allowed.has(workout.activityType)) throw new Error("Unsupported workout activity type");
    const existing = store.workouts.find((item) => item.userId === userId && item.healthkitUUID === workout.healthkitUUID);
    const saved: WorkoutSummary = {
      id: existing?.id ?? `workout_${userId}_${workout.healthkitUUID}`,
      userId,
      ...workout,
      durationSeconds: Math.max(0, workout.durationSeconds),
      distanceMeters: Math.max(0, workout.distanceMeters),
      calories: Math.max(0, workout.calories),
      source: "healthkit",
      trustLevel: "verified",
      updatedAt: now
    };
    if (existing) Object.assign(existing, saved);
    else store.workouts.push(saved);
    return saved;
  });
  for (const challenge of store.challenges.filter((item) => item.participants.some((participant) => participant.userId === userId))) refreshChallenge(store, challenge);
  return savedWorkouts;
}

export function sendFriendRequest(store: AppStore, requesterId: ID, addresseeId: ID): Friendship {
  if (friendshipStatus(store, requesterId, addresseeId) === "accepted") throw new Error("Already friends");
  const existing = store.friendships.find(
    (item) =>
      (item.requesterId === requesterId && item.addresseeId === addresseeId) ||
      (item.requesterId === addresseeId && item.addresseeId === requesterId)
  );
  if (existing) {
    existing.status = "pending";
    return existing;
  }
  const saved = { id: `friendship_${store.friendships.length + 1}`, requesterId, addresseeId, status: "pending" as const, createdAt: new Date().toISOString() };
  store.friendships.push(saved);
  return saved;
}

export function respondFriendRequest(store: AppStore, friendshipId: ID, userId: ID, accept: boolean): Friendship {
  const friendship = store.friendships.find((item) => item.id === friendshipId);
  if (!friendship) throw new Error("Friend request not found");
  if (friendship.addresseeId !== userId) throw new Error("Only the addressee can respond");
  friendship.status = accept ? "accepted" : "declined";
  friendship.respondedAt = new Date().toISOString();
  return friendship;
}

export function removeFriend(store: AppStore, userId: ID, friendId: ID) {
  store.friendships = store.friendships.filter(
    (item) => !((item.requesterId === userId && item.addresseeId === friendId) || (item.requesterId === friendId && item.addresseeId === userId))
  );
  return { ok: true };
}

export function blockUser(store: AppStore, blockerId: ID, blockedId: ID) {
  removeFriend(store, blockerId, blockedId);
  if (!store.blockedUsers.some((item) => item.blockerId === blockerId && item.blockedId === blockedId)) store.blockedUsers.push({ blockerId, blockedId, createdAt: new Date().toISOString() });
  return { ok: true };
}

export function blockedUsersFor(store: AppStore, userId: ID) {
  const ids = store.blockedUsers.filter((item) => item.blockerId === userId).map((item) => item.blockedId);
  return store.users.filter((item) => ids.includes(item.id)).map((item) => publicProfile(store, userId, item.id));
}

export function unblockUser(store: AppStore, userId: ID, blockedId: ID) {
  store.blockedUsers = store.blockedUsers.filter((item) => !(item.blockerId === userId && item.blockedId === blockedId));
  return { ok: true };
}

export function exportAccount(store: AppStore, userId: ID) {
  return {
    exportedAt: new Date().toISOString(),
    user: requireUser(store, userId),
    settings: store.settings.find((item) => item.userId === userId),
    friends: friendsFor(store, userId).map((item) => publicProfile(store, userId, item.id)),
    summaries: store.summaries.filter((item) => item.userId === userId),
    workouts: store.workouts.filter((item) => item.userId === userId),
    goals: store.goals.filter((item) => item.userId === userId),
    challenges: store.challenges.filter((item) => item.participants.some((participant) => participant.userId === userId)),
    messages: store.messages.filter((message) => store.conversationMembers.some((member) => member.userId === userId && member.conversationId === message.conversationId))
  };
}

export function deleteAccount(store: AppStore, userId: ID) {
  store.users = store.users.filter((item) => item.id !== userId);
  store.settings = store.settings.filter((item) => item.userId !== userId);
  store.friendships = store.friendships.filter((item) => item.requesterId !== userId && item.addresseeId !== userId);
  store.summaries = store.summaries.filter((item) => item.userId !== userId);
  store.workouts = store.workouts.filter((item) => item.userId !== userId);
  store.goals = store.goals.filter((item) => item.userId !== userId);
  store.streaks = store.streaks.filter((item) => item.userId !== userId);
  store.feed = store.feed.filter((item) => item.userId !== userId);
  store.userBadges = store.userBadges.filter((item) => item.userId !== userId);
  store.blockedUsers = store.blockedUsers.filter((item) => item.blockerId !== userId && item.blockedId !== userId);
  store.deviceTokens = store.deviceTokens.filter((item) => item.userId !== userId);
  store.conversationMembers = store.conversationMembers.filter((item) => item.userId !== userId);
  for (const message of store.messages) if (message.senderId === userId) message.senderId = undefined;
  store.conversations = store.conversations.filter((item) => !(item.createdBy === userId && !store.conversationMembers.some((member) => member.conversationId === item.id)));
  for (const challenge of store.challenges) challenge.participants = challenge.participants.filter((item) => item.userId !== userId);
  store.challenges = store.challenges.filter((item) => item.creatorId !== userId && item.participants.length > 1);
  return { ok: true };
}

export function addReport(store: AppStore, reporterId: ID, input: { targetType: "user" | "message"; targetId: ID; reason: string }) {
  if (!input.reason.trim()) throw new Error("A report reason is required");
  const report = { id: `report_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, reporterId, ...input, reason: input.reason.trim(), createdAt: new Date().toISOString() };
  store.reports.push(report);
  return report;
}

export function friendsFor(store: AppStore, userId: ID): User[] {
  const ids = store.friendships
    .filter((item) => item.status === "accepted" && (item.requesterId === userId || item.addresseeId === userId))
    .map((item) => (item.requesterId === userId ? item.addresseeId : item.requesterId));
  return store.users.filter((item) => ids.includes(item.id));
}

export function upsertSummary(store: AppStore, summaryInput: Omit<ActivitySummary, "id" | "source" | "trustLevel" | "updatedAt">): ActivitySummary {
  const previousStreak = store.streaks.find((item) => item.userId === summaryInput.userId)?.currentDays ?? 0;
  const existing = store.summaries.find(
    (item) => item.userId === summaryInput.userId && item.localDate === summaryInput.localDate
  );
  const summary: ActivitySummary = {
    ...summaryInput,
    id: existing?.id ?? `summary_${summaryInput.userId}_${summaryInput.localDate}`,
    source: "healthkit",
    trustLevel: detectTrustLevel(summaryInput),
    updatedAt: new Date().toISOString()
  };

  if (existing) {
    Object.assign(existing, summary);
  } else {
    store.summaries.push(summary);
  }
  refreshDerived(store, summary.userId);
  const currentStreak = store.streaks.find((item) => item.userId === summary.userId)?.currentDays ?? 0;
  if (currentStreak > previousStreak && currentStreak > 0) addMilestoneMessages(store, summary.userId, `reached a ${currentStreak}-day streak`);
  return existing ?? summary;
}

export function addGoal(store: AppStore, goal: Omit<Goal, "id" | "createdAt">): Goal {
  if (goal.target <= 0) throw new Error("Goal target must be greater than zero");
  if (store.goals.some((item) => item.userId === goal.userId && item.kind === goal.kind && item.cadence === goal.cadence)) {
    throw new Error("An active goal already exists for this metric and frequency");
  }
  const saved: Goal = { ...goal, isEnabled: goal.isEnabled ?? true, id: `goal_${store.goals.length + 1}`, createdAt: new Date().toISOString() };
  store.goals.push(saved);
  refreshDerived(store, goal.userId);
  return saved;
}

export function updateGoal(store: AppStore, userId: ID, goalId: ID, patch: Partial<Pick<Goal, "kind" | "cadence" | "target" | "isEnabled">>): Goal {
  const goal = store.goals.find((item) => item.id === goalId && item.userId === userId);
  if (!goal) throw new Error("Goal not found");
  const next = { ...goal, ...patch };
  if (next.target <= 0) throw new Error("Goal target must be greater than zero");
  if (store.goals.some((item) => item.id !== goal.id && item.userId === userId && item.kind === next.kind && item.cadence === next.cadence)) {
    throw new Error("An active goal already exists for this metric and frequency");
  }
  Object.assign(goal, next);
  refreshDerived(store, userId);
  return goal;
}

export function deleteGoal(store: AppStore, userId: ID, goalId: ID) {
  const before = store.goals.length;
  store.goals = store.goals.filter((item) => !(item.id === goalId && item.userId === userId));
  if (store.goals.length === before) throw new Error("Goal not found");
  refreshDerived(store, userId);
  return { ok: true };
}

export function friendLeaderboard(store: AppStore, userId: ID, period: LeaderboardPeriod): ActivityComparison {
  return {
    period,
    rows: leaderboardRows({
      userIds: [userId, ...friendsFor(store, userId).map((friend) => friend.id)],
      summaries: store.summaries,
      goals: store.goals,
      streaks: store.streaks,
      period,
      now: currentDateForUser(store, userId)
    })
  };
}

export function createConversation(store: AppStore, creatorId: ID, input: { kind: "direct" | "group"; title?: string; memberIds: ID[] }): Conversation {
  const members = unique([creatorId, ...input.memberIds]);
  for (const memberId of members) {
    if (memberId !== creatorId && friendshipStatus(store, creatorId, memberId) !== "accepted") {
      throw new Error("Conversations can only include friends");
    }
  }
  const saved: Conversation = {
    id: `conv_${store.conversations.length + 1}`,
    kind: input.kind,
    title: input.title,
    createdBy: creatorId,
    createdAt: new Date().toISOString(),
    mutedBy: []
  };
  store.conversations.push(saved);
  store.conversationMembers.push(...members.map((memberId) => member(saved.id, memberId, memberId === creatorId ? "owner" : "member", saved.createdAt)));
  return saved;
}

export function conversationsFor(store: AppStore, userId: ID) {
  const ids = store.conversationMembers.filter((item) => item.userId === userId).map((item) => item.conversationId);
  return store.conversations.filter((item) => ids.includes(item.id)).map((conversation) => ({
    conversation,
    members: store.conversationMembers.filter((item) => item.conversationId === conversation.id),
    lastMessage: store.messages.filter((item) => item.conversationId === conversation.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    unreadCount: store.messages.filter((item) => item.conversationId === conversation.id && !item.readBy.includes(userId)).length
  }));
}

export function messagesForConversation(store: AppStore, userId: ID, conversationId: ID, limit = 50, before?: string) {
  requireMember(store, userId, conversationId);
  return store.messages.filter((item) => item.conversationId === conversationId && (!before || item.createdAt < before))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.min(Math.max(limit, 1), 100)).reverse();
}

export function setConversationMuted(store: AppStore, userId: ID, conversationId: ID, muted: boolean) {
  requireMember(store, userId, conversationId);
  const conversation = store.conversations.find((item) => item.id === conversationId)!;
  conversation.mutedBy = muted ? unique([...conversation.mutedBy, userId]) : conversation.mutedBy.filter((item) => item !== userId);
  return conversation;
}

export function leaveConversation(store: AppStore, userId: ID, conversationId: ID) {
  const member = requireMember(store, userId, conversationId);
  const conversation = store.conversations.find((item) => item.id === conversationId);
  if (!conversation || conversation.kind !== "group") throw new Error("Only group conversations can be left");
  store.conversationMembers = store.conversationMembers.filter((item) => !(item.conversationId === conversationId && item.userId === userId));
  conversation.mutedBy = conversation.mutedBy.filter((item) => item !== userId);
  if (member.role === "owner") {
    const next = store.conversationMembers.find((item) => item.conversationId === conversationId);
    if (next) next.role = "owner";
  }
  return { ok: true };
}

export function addConversationMembers(store: AppStore, userId: ID, conversationId: ID, memberIds: ID[]) {
  const actor = requireMember(store, userId, conversationId);
  const conversation = store.conversations.find((item) => item.id === conversationId);
  if (!conversation || conversation.kind !== "group" || actor.role !== "owner") throw new Error("Only the group owner can add members");
  for (const memberId of memberIds) {
    if (friendshipStatus(store, userId, memberId) !== "accepted") throw new Error("Groups can only include friends");
    if (!store.conversationMembers.some((item) => item.conversationId === conversationId && item.userId === memberId)) {
      store.conversationMembers.push(member(conversationId, memberId, "member", new Date().toISOString()));
    }
  }
  return store.conversationMembers.filter((item) => item.conversationId === conversationId);
}

export function addMessage(store: AppStore, userId: ID, message: { conversationId: ID; body: string }): Message {
  requireMember(store, userId, message.conversationId);
  const saved = chatMessage(`message_${store.messages.length + 1}`, message.conversationId, userId, message.body, new Date().toISOString(), [userId]);
  store.messages.push(saved);
  return saved;
}

export function markConversationRead(store: AppStore, userId: ID, conversationId: ID) {
  requireMember(store, userId, conversationId);
  for (const message of store.messages.filter((item) => item.conversationId === conversationId)) {
    if (!message.readBy.includes(userId)) message.readBy.push(userId);
  }
  const member = store.conversationMembers.find((item) => item.conversationId === conversationId && item.userId === userId);
  if (member) member.lastReadAt = new Date().toISOString();
  return { ok: true };
}

export function reactToMessage(store: AppStore, userId: ID, messageId: ID, kind: ReactionKind) {
  const message = store.messages.find((item) => item.id === messageId);
  if (!message) throw new Error("Message not found");
  requireMember(store, userId, message.conversationId);
  const saved = reaction(`message_reaction_${message.reactions.length + 1}`, "message", messageId, userId, kind, new Date().toISOString());
  message.reactions.push(saved);
  return saved;
}

export function conversationComparison(store: AppStore, userId: ID, conversationId: ID, period: LeaderboardPeriod): ActivityComparison {
  requireMember(store, userId, conversationId);
  return {
    period,
    rows: leaderboardRows({
      userIds: store.conversationMembers.filter((item) => item.conversationId === conversationId).map((item) => item.userId),
      summaries: store.summaries,
      goals: store.goals,
      streaks: store.streaks,
      period,
      now: currentDateForUser(store, userId)
    })
  };
}

export function addChallenge(store: AppStore, challenge: Omit<Challenge, "id" | "createdAt" | "status" | "participants"> & { participantIds: ID[] }): Challenge {
  if (challenge.endsOn < challenge.startsOn) throw new Error("Challenge end date must be after its start date");
  if (challenge.mode === "target" && (!challenge.target || challenge.target <= 0)) throw new Error("Target challenges require a positive target");
  for (const participantId of challenge.participantIds) {
    if (participantId !== challenge.creatorId && friendshipStatus(store, challenge.creatorId, participantId) !== "accepted") {
      throw new Error("Challenges can only include friends");
    }
  }
  const saved: Challenge = {
    ...challenge,
    id: `challenge_${store.challenges.length + 1}`,
    status: "inviting",
    mode: challenge.mode ?? "competitive",
    participants: unique([challenge.creatorId, ...challenge.participantIds]).map((userId) => ({ userId, accepted: userId === challenge.creatorId, score: 0, respondedAt: userId === challenge.creatorId ? new Date().toISOString() : undefined })),
    createdAt: new Date().toISOString()
  };
  store.challenges.push(saved);
  refreshChallenge(store, saved);
  return saved;
}

export function respondChallenge(store: AppStore, challengeId: ID, userId: ID, accept: boolean): Challenge {
  const challenge = requireChallenge(store, challengeId);
  const participant = challenge.participants.find((item) => item.userId === userId);
  if (!participant) throw new Error("Challenge participant not found");
  participant.accepted = accept;
  participant.respondedAt = new Date().toISOString();
  refreshChallenge(store, challenge);
  return challenge;
}

export function challengesFor(store: AppStore, userId: ID): Challenge[] {
  for (const challenge of store.challenges) refreshChallenge(store, challenge);
  return store.challenges.filter((challenge) => challenge.participants.some((item) => item.userId === userId));
}

export function challengeFor(store: AppStore, userId: ID, challengeId: ID): Challenge {
  const challenge = requireChallenge(store, challengeId);
  if (!challenge.participants.some((item) => item.userId === userId)) throw new Error("Challenge participant not found");
  refreshChallenge(store, challenge);
  return challenge;
}

export function refreshChallenges(store: AppStore, userId?: ID): Challenge[] {
  const challenges = userId ? challengesFor(store, userId) : store.challenges;
  for (const challenge of challenges) refreshChallenge(store, challenge);
  return challenges;
}

export function rematchChallenge(store: AppStore, challengeId: ID): Challenge {
  const original = requireChallenge(store, challengeId);
  const durationDays = Math.max(0, Math.round((Date.parse(`${original.endsOn}T00:00:00Z`) - Date.parse(`${original.startsOn}T00:00:00Z`)) / 86400000));
  const startsOn = currentDateForUser(store, original.creatorId);
  return addChallenge(store, {
    creatorId: original.creatorId,
    title: `${original.title} Rematch`,
    kind: original.kind,
    template: original.template,
    startsOn,
    endsOn: addLocalDays(startsOn, durationDays),
    mode: original.mode,
    target: original.target,
    participantIds: original.participants.map((item) => item.userId),
    rematchOfChallengeId: original.id
  });
}

export function shareChallenge(store: AppStore, userId: ID, challengeId: ID, conversationId: ID) {
  const challenge = requireChallenge(store, challengeId);
  requireMember(store, userId, conversationId);
  challenge.sharedConversationId = conversationId;
  store.messages.push(systemMessage(`message_${store.messages.length + 1}`, conversationId, `${challenge.title} results shared: ${winnerText(challenge, store)}.`, new Date().toISOString()));
  return challenge;
}

export function addReaction(store: AppStore, feedItemId: ID, reactionInput: { userId: ID; kind: ReactionKind }): Reaction {
  const item = store.feed.find((feedItem) => feedItem.id === feedItemId);
  if (!item) throw new Error("Feed item not found");
  const saved = reaction(`reaction_${item.reactions.length + 1}`, "feed", feedItemId, reactionInput.userId, reactionInput.kind, new Date().toISOString());
  item.reactions.push(saved);
  return saved;
}

export function weeklyRecapFor(store: AppStore, userId: ID, weekStartsOn?: string) {
  const resolvedWeekStart = weekStartsOn ?? startOfWeek(currentDateForUser(store, userId));
  const weekEndsOn = addLocalDays(resolvedWeekStart, 6);
  const previousWeekStartsOn = addLocalDays(resolvedWeekStart, -7);
  const previousWeekEndsOn = addLocalDays(resolvedWeekStart, -1);
  return generateWeeklyRecap({
    userId,
    weekStartsOn: resolvedWeekStart,
    summaries: store.summaries.filter(
      (summary) => summary.userId === userId && summary.localDate >= resolvedWeekStart && summary.localDate <= weekEndsOn
    ),
    previousSummaries: store.summaries.filter(
      (summary) => summary.userId === userId && summary.localDate >= previousWeekStartsOn && summary.localDate <= previousWeekEndsOn
    ),
    goalsHit: profileStats(store, userId).goalsHit,
    streakDays: store.streaks.find((item) => item.userId === userId)?.currentDays ?? 0,
    leaderboardRank: friendLeaderboard(store, userId, "week").rows.find((row) => row.userId === userId)?.rank ?? 1,
    challengeWins: profileStats(store, userId).challengeWins
  });
}

export function badgesForUser(store: AppStore, userId: ID) {
  return store.userBadges
    .filter((item) => item.userId === userId)
    .map((item) => ({ earnedAt: item.earnedAt, badge: store.badges.find((badge) => badge.id === item.badgeId)! }))
    .filter((item) => item.badge);
}

export function profileStats(store: AppStore, userId: ID): ProfileStats {
  const lifetimeSteps = store.summaries.filter((item) => item.userId === userId).reduce((sum, item) => sum + item.steps, 0);
  const challengeWins = store.challenges.filter((challenge) => {
    if (challenge.status !== "completed") return false;
    const winner = [...challenge.participants].sort((a, b) => b.score - a.score)[0];
    return winner?.userId === userId;
  }).length;
  return {
    userId,
    lifetimeSteps,
    challengeWins,
    bestStreak: store.streaks.find((item) => item.userId === userId)?.bestDays ?? 0,
    goalsHit: store.goals.filter((goal) => goal.userId === userId).length + Math.floor(lifetimeSteps / 50000)
  };
}

export function profileRecords(store: AppStore, userId: ID) {
  const workouts = store.workouts.filter((item) => item.userId === userId);
  const running = workouts.filter((item) => item.activityType === "running" && item.distanceMeters > 0 && item.durationSeconds > 0);
  const fastest = (meters: number) => {
    const eligible = running.filter((item) => item.distanceMeters >= meters);
    if (eligible.length === 0) return undefined;
    return Math.round(Math.min(...eligible.map((item) => item.durationSeconds * meters / item.distanceMeters)));
  };
  const longestWalk = Math.max(0, ...workouts.filter((item) => item.activityType === "walking").map((item) => item.distanceMeters));
  const longestActivity = Math.max(0, ...workouts.map((item) => item.durationSeconds));
  const highestSteps = Math.max(0, ...store.summaries.filter((item) => item.userId === userId).map((item) => item.steps));
  return {
    fastest1KSeconds: fastest(1000),
    fastest5KSeconds: fastest(5000),
    fastest10KSeconds: fastest(10000),
    fastestHalfMarathonSeconds: fastest(21097.5),
    longestWalkMeters: longestWalk || undefined,
    highestDailySteps: highestSteps || undefined,
    longestActivitySeconds: longestActivity || undefined
  };
}

function refreshDerived(store: AppStore, userId: ID) {
  const userSummaries = store.summaries.filter((summary) => summary.userId === userId);
  const streakGoals = goalsForStreak(store, userId);
  const calculatedDays = Math.max(0, ...streakGoals.map((goal) => calculateStreak(goal, userSummaries)));
  const now = new Date().toISOString();
  let current = store.streaks.find((item) => item.userId === userId);
  if (!current) {
    current = { userId, currentDays: 0, bestDays: 0, updatedAt: now };
    store.streaks.push(current);
  }
  current.currentDays = calculatedDays;
  current.bestDays = Math.max(current.bestDays, calculatedDays);
  current.updatedAt = now;

  const newBadges = earnedBadges({
    userId,
    badges: store.badges,
    stats: profileStats(store, userId),
    streak: current,
    existing: store.userBadges
  });
  store.userBadges.push(...newBadges);
  for (const challenge of store.challenges.filter((item) => item.participants.some((participant) => participant.userId === userId))) refreshChallenge(store, challenge);
}

function refreshChallenge(store: AppStore, challenge: Challenge) {
  for (const participant of challenge.participants) {
    if (!participant.accepted) continue;
    const summaries = store.summaries.filter((item) => item.userId === participant.userId && item.localDate >= challenge.startsOn && item.localDate <= challenge.endsOn);
    if (challenge.kind === "strengthTraining") {
      participant.score = store.workouts.filter((item) => item.userId === participant.userId && item.activityType === "strengthTraining" && item.startedAt.slice(0, 10) >= challenge.startsOn && item.startedAt.slice(0, 10) <= challenge.endsOn).length;
    } else {
      participant.score = scoreChallenge(challenge.kind, summaries);
    }
  }
  const today = currentDateForUser(store, challenge.creatorId);
  const invited = challenge.participants.filter((item) => item.userId !== challenge.creatorId);
  const allResponded = invited.every((item) => item.respondedAt);
  if (today > challenge.endsOn) challenge.status = "completed";
  else if (allResponded && challenge.participants.filter((item) => item.accepted).length <= 1) challenge.status = "completed";
  else if (allResponded && challenge.participants.filter((item) => item.accepted).length > 1 && today >= challenge.startsOn) challenge.status = "active";
  else challenge.status = "inviting";
}

export function refreshAllChallenges(store: AppStore): ID[] {
  const changed: ID[] = [];
  for (const challenge of store.challenges) {
    const previous = JSON.stringify({ status: challenge.status, participants: challenge.participants });
    refreshChallenge(store, challenge);
    if (previous !== JSON.stringify({ status: challenge.status, participants: challenge.participants })) changed.push(challenge.id);
  }
  return changed;
}

function addMilestoneMessages(store: AppStore, userId: ID, milestone: string) {
  const name = store.users.find((item) => item.id === userId)?.displayName ?? "A friend";
  const conversationIds = store.conversationMembers.filter((item) => item.userId === userId).map((item) => item.conversationId);
  for (const conversationId of conversationIds) {
    const body = `${name} ${milestone}.`;
    if (store.messages.some((item) => item.conversationId === conversationId && item.kind === "system" && item.body === body)) continue;
    store.messages.push(systemMessage(`message_milestone_${Date.now()}_${conversationId}`, conversationId, body, new Date().toISOString()));
  }
}

function goalsForStreak(store: AppStore, userId: ID): Goal[] {
  const dailyGoals = store.goals.filter((goal) => goal.userId === userId && goal.cadence === "daily" && goal.isEnabled);
  if (dailyGoals.length > 0) return dailyGoals;
  return [
    {
      id: `default_daily_steps_${userId}`,
      userId,
      kind: "steps",
      cadence: "daily",
      target: 10000,
      isEnabled: true,
      createdAt: new Date().toISOString()
    }
  ];
}

function user(id: ID, username: string, displayName: string, email: string, avatarColor: string, joinedAt: string): User {
  return { id, username, displayName, email, avatarColor, joinedAt, searchable: true };
}

function friendship(id: ID, requesterId: ID, addresseeId: ID, status: "accepted" | "pending", now: string): Friendship {
  return { id, requesterId, addresseeId, status, createdAt: now, respondedAt: status === "accepted" ? now : undefined };
}

function summary(userId: ID, localDate: string, steps: number, calories: number): ActivitySummary {
  const walkingDistanceMeters = Math.round(steps * 0.46);
  const runningDistanceMeters = steps > 10000 ? Math.round((steps - 10000) * 0.32) : 0;
  return {
    id: `summary_${userId}_${localDate}`,
    userId,
    localDate,
    timezone: "Africa/Accra",
    steps,
    walkingDistanceMeters,
    runningDistanceMeters,
    workoutCount: runningDistanceMeters > 0 ? 1 : 0,
    activeMinutes: Math.round(steps / 180),
    calories,
    source: "healthkit",
    trustLevel: "verified",
    updatedAt: new Date().toISOString()
  };
}

function week(userId: ID, steps: number[], calories: number[]): ActivitySummary[] {
  const days = ["2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-20", "2026-06-21", "2026-06-22"];
  return days.map((day, index) => summary(userId, day, steps[index] ?? 0, calories[index] ?? 0));
}

function participant(userId: ID, accepted: boolean, kind: Challenge["kind"], summaries: ActivitySummary[]): ChallengeParticipant {
  return { userId, accepted, score: scoreChallenge(kind, summaries.filter((item) => item.userId === userId)), respondedAt: accepted ? new Date().toISOString() : undefined };
}

function feedItem(id: ID, userId: ID, type: FeedItem["type"], title: string, body: string, createdAt: string): FeedItem {
  return { id, userId, type, title, body, createdAt, reactions: [] };
}

function member(conversationId: ID, userId: ID, role: "owner" | "member", joinedAt: string): ConversationMember {
  return { conversationId, userId, joinedAt, role };
}

function chatMessage(id: ID, conversationId: ID, senderId: ID, body: string, createdAt: string, readBy: ID[]): Message {
  return { id, conversationId, senderId, kind: "user", body, createdAt, readBy, reactions: [] };
}

function systemMessage(id: ID, conversationId: ID, body: string, createdAt: string): Message {
  return { id, conversationId, kind: "system", body, createdAt, readBy: [], reactions: [] };
}

function reaction(id: ID, targetType: "feed" | "message", targetId: ID, userId: ID, kind: ReactionKind, createdAt: string): Reaction {
  return { id, targetType, targetId, userId, kind, createdAt };
}

function friendshipStatus(store: AppStore, a: ID, b: ID): Friendship["status"] | undefined {
  return store.friendships.find((item) => (item.requesterId === a && item.addresseeId === b) || (item.requesterId === b && item.addresseeId === a))?.status;
}

function requireUser(store: AppStore, userId: ID): User {
  const user = store.users.find((item) => item.id === userId);
  if (!user) throw new Error("User not found");
  return user;
}

function requireChallenge(store: AppStore, challengeId: ID): Challenge {
  const challenge = store.challenges.find((item) => item.id === challengeId);
  if (!challenge) throw new Error("Challenge not found");
  return challenge;
}

function requireMember(store: AppStore, userId: ID, conversationId: ID) {
  const member = store.conversationMembers.find((item) => item.userId === userId && item.conversationId === conversationId);
  if (!member) throw new Error("Conversation member not found");
  return member;
}

function winnerText(challenge: Challenge, store: AppStore) {
  const winner = [...challenge.participants].sort((a, b) => b.score - a.score)[0];
  const name = store.users.find((item) => item.id === winner?.userId)?.displayName ?? "Someone";
  return `${name} won with ${Math.round(winner?.score ?? 0).toLocaleString()} points`;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function currentDateForUser(store: AppStore, userId: ID): string {
  const timezone = [...store.summaries]
    .filter((summary) => summary.userId === userId)
    .sort((a, b) => b.localDate.localeCompare(a.localDate))[0]?.timezone ?? "UTC";
  return localDateForTimeZone(timezone);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export function defaultBadges(): Badge[] {
  return [
    { id: "badge_streak_7", title: "7-Day Streak", emoji: "🔥", ruleKind: "streak", threshold: 7 },
    { id: "badge_first_win", title: "First Place", emoji: "🏆", ruleKind: "challengeWins", threshold: 1 },
    { id: "badge_steps_100k", title: "100K Steps", emoji: "👟", ruleKind: "lifetimeSteps", threshold: 100000 },
    { id: "badge_goal_5", title: "Goal Getter", emoji: "🎯", ruleKind: "goalHits", threshold: 5 }
  ];
}
