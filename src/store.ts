import {
  ActivityComparison,
  ActivityKind,
  AppNotification,
  ActivitySummary,
  Badge,
  Challenge,
  ChallengeComment,
  ChallengeCareerStats,
  ChallengeParticipant,
  ChallengeTemplate,
  CircleTimelineEntry,
  Conversation,
  ConversationMember,
  FeedItem,
  Friendship,
  Goal,
  GoalCadence,
  ID,
  LeaderboardPeriod,
  LeaderboardMetric,
  Message,
  MonthlyRecap,
  PersonalRecordAttempt,
  PersonalRecordLab,
  ProfileStats,
  Reaction,
  ReactionKind,
  Streak,
  GoalStreak,
  GoalHistoryEntry,
  User,
  UserBadge,
  UserSettings,
  ProfileHighlight,
  WorkoutComparison,
  WorkoutSummary,
  WorkoutSplitsDetail,
  calculateStreak,
  addLocalDays,
  detectTrustLevel,
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
  goalVersions: Array<{ goalId: ID; userId: ID; kind: ActivityKind; cadence: GoalCadence; target: number; effectiveDate: string }>;
  goalStreaks: GoalStreak[];
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
  notifications: AppNotification[];
  challengeComments: ChallengeComment[];
  profileHighlights: ProfileHighlight[];
}

export function createEmptyStore(): AppStore {
  return {
    users: [],
    settings: [],
    friendships: [],
    summaries: [],
    workouts: [],
    goals: [],
    goalVersions: [],
    goalStreaks: [],
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
    reports: [],
    notifications: [],
    challengeComments: [],
    profileHighlights: []
  };
}

export function updateWorkoutSocialMetadata(
  store: AppStore,
  userId: ID,
  workoutId: ID,
  patch: Pick<WorkoutSummary, "customTitle" | "note" | "effortRating" | "visibility">
): WorkoutSummary {
  const workout = store.workouts.find((item) => item.id === workoutId && item.userId === userId);
  if (!workout) throw new Error("Workout not found");
  if (patch.effortRating !== undefined && (patch.effortRating < 1 || patch.effortRating > 5)) throw new Error("Effort must be between 1 and 5");
  workout.customTitle = cleanOptionalText(patch.customTitle, 80);
  workout.note = cleanOptionalText(patch.note, 500);
  workout.effortRating = patch.effortRating;
  workout.visibility = patch.visibility === "private" ? "private" : "friends";
  workout.automaticTitle ||= automaticWorkoutTitle(workout);
  workout.updatedAt = new Date().toISOString();
  return workout;
}

export function compareWorkouts(store: AppStore, userId: ID, firstId: ID, secondId: ID): WorkoutComparison {
  const first = workoutForViewer(store, userId, firstId);
  const second = workoutForViewer(store, userId, secondId);
  const pace = (workout: WorkoutSummary) => workout.distanceMeters > 0 ? workout.durationSeconds / (workout.distanceMeters / 1000) : undefined;
  const firstPace = pace(first);
  const secondPace = pace(second);
  const summary: string[] = [];
  if (first.activityType !== second.activityType) summary.push("These activities use different workout types.");
  if (firstPace !== undefined && secondPace !== undefined) {
    const difference = Math.round(secondPace - firstPace);
    summary.push(difference < 0 ? `The second workout was ${Math.abs(difference)} seconds per kilometre faster.` : difference > 0 ? `The second workout was ${difference} seconds per kilometre slower.` : "Both workouts had the same average pace.");
  }
  if (second.distanceMeters > first.distanceMeters) summary.push(`The second workout covered ${Math.round(second.distanceMeters - first.distanceMeters)} more metres.`);
  return {
    first, second,
    compatible: first.activityType === second.activityType,
    durationDeltaSeconds: second.durationSeconds - first.durationSeconds,
    distanceDeltaMeters: second.distanceMeters - first.distanceMeters,
    paceDeltaSecondsPerKm: firstPace !== undefined && secondPace !== undefined ? secondPace - firstPace : undefined,
    calorieDelta: second.calories - first.calories,
    summary
  };
}

export function challengeCommentsFor(store: AppStore, userId: ID, challengeId: ID): ChallengeComment[] {
  challengeFor(store, userId, challengeId);
  return store.challengeComments.filter((item) => item.challengeId === challengeId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function addChallengeComment(store: AppStore, userId: ID, challengeId: ID, body: string): ChallengeComment {
  challengeFor(store, userId, challengeId);
  const value = body.trim();
  if (!value || value.length > 500) throw new Error("Comment must contain 1 to 500 characters");
  const comment: ChallengeComment = { id: `challenge_comment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, challengeId, userId, body: value, createdAt: new Date().toISOString() };
  store.challengeComments.push(comment);
  return comment;
}

export function profileHighlightsFor(store: AppStore, viewerId: ID, userId: ID): ProfileHighlight[] {
  if (viewerId !== userId && friendshipStatus(store, viewerId, userId) !== "accepted") return [];
  return store.profileHighlights.filter((item) => item.userId === userId).sort((a, b) => a.position - b.position);
}

export function replaceProfileHighlights(store: AppStore, userId: ID, values: Array<Pick<ProfileHighlight, "kind" | "entityId">>): ProfileHighlight[] {
  if (values.length > 3) throw new Error("You can pin up to three highlights");
  store.profileHighlights = store.profileHighlights.filter((item) => item.userId !== userId);
  const now = new Date().toISOString();
  const saved: ProfileHighlight[] = values.map((value, position) => ({ id: `highlight_${Date.now()}_${position}`, userId, kind: value.kind, entityId: value.entityId, position, createdAt: now }));
  store.profileHighlights.push(...saved);
  return saved;
}

function automaticWorkoutTitle(workout: WorkoutSummary): string {
  const hour = new Date(workout.startedAt).getHours();
  const period = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : hour < 22 ? "Evening" : "Late Night";
  const activity = workout.activityType === "strengthTraining" ? "Strength Session" : workout.activityType === "running" ? "Run" : "Walk";
  return `${period} ${activity}`;
}

function cleanOptionalText(value: string | undefined, maximum: number): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  if (cleaned.length > maximum) throw new Error(`Text must be ${maximum} characters or fewer`);
  return cleaned;
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);
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
      homeGoalId: goals.find((goal) => goal.userId === item.id)?.id,
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
    goalVersions: goals.map((goal) => ({ goalId: goal.id, userId: goal.userId, kind: goal.kind, cadence: goal.cadence, target: goal.target, effectiveDate: goal.createdAt.slice(0, 10) })),
    goalStreaks: [],
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
    reports: [],
    notifications: [],
    challengeComments: [],
    profileHighlights: []
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
  let defaultGoal = store.goals.find((goal) => goal.userId === saved.id && goal.kind === "steps" && goal.cadence === "daily");
  if (!defaultGoal) {
    defaultGoal = {
      id: `goal_${saved.id}_daily_steps`,
      userId: saved.id,
      kind: "steps",
      cadence: "daily",
      target: 10_000,
      isEnabled: true,
      createdAt: new Date().toISOString()
    };
    store.goals.push(defaultGoal);
    store.goalVersions.push({
      goalId: defaultGoal.id,
      userId: saved.id,
      kind: defaultGoal.kind,
      cadence: defaultGoal.cadence,
      target: defaultGoal.target,
      effectiveDate: currentDateForUser(store, saved.id)
    });
  }
  const userSettings = store.settings.find((item) => item.userId === saved!.id);
  if (userSettings && !userSettings.homeGoalId) userSettings.homeGoalId = defaultGoal.id;
  refreshDerived(store, saved.id);
  return { ...issueDemoTokens(saved.id, tokenSecret), user: saved, needsUsername: isNewUser };
}

export function currentUser(store: AppStore, userId = "u_ama") {
  const user = requireUser(store, userId);
  refreshDerived(store, userId);
  return {
    user,
    settings: store.settings.find((item) => item.userId === userId),
    profileStats: profileStats(store, userId),
    streak: store.streaks.find((item) => item.userId === userId),
    goalStreaks: store.goalStreaks.filter((item) => item.userId === userId),
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
  if (patch.homeGoalId !== undefined) {
    const goal = store.goals.find((item) => item.id === patch.homeGoalId && item.userId === userId && item.isEnabled);
    if (!goal) throw new Error("Home goal must be one of your enabled goals");
  }
  Object.assign(current, patch, { userId });
  const user = requireUser(store, userId);
  user.searchable = current.searchable;
  refreshDerived(store, userId);
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

export function profileActivity(store: AppStore, viewerId: ID, userId: ID, from?: string, to?: string) {
  const status = friendshipStatus(store, viewerId, userId);
  const privacy = store.settings.find((item) => item.userId === userId);
  if (viewerId !== userId && status !== "accepted") {
    return { profile: publicProfile(store, viewerId, userId), summaries: [], workouts: [], feed: [], stats: undefined, records: undefined, badges: [], activityHidden: true, exactNumbersHidden: false };
  }
  if (viewerId !== userId && privacy?.hideActivityFromFriends) {
    return { profile: publicProfile(store, viewerId, userId), summaries: [], workouts: [], feed: [], stats: undefined, records: undefined, badges: [], activityHidden: true, exactNumbersHidden: false };
  }
  const hideExact = viewerId !== userId && Boolean(privacy?.hideExactNumbers);
  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
  return {
    profile: publicProfile(store, viewerId, userId),
    summaries: hideExact ? [] : store.summaries.filter((summary) => summary.userId === userId && inRange(summary.localDate)),
    workouts: store.workouts.filter((workout) => workout.userId === userId && inRange(workout.startedAt.slice(0, 10)) && (viewerId === userId || workout.visibility !== "private")).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((workout) => hideExact ? { ...workout, durationSeconds: 0, distanceMeters: 0, calories: 0 } : workout),
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
    .filter((workout) => friendIds.has(workout.userId) && workout.visibility !== "private" && !store.settings.find((item) => item.userId === workout.userId)?.hideActivityFromFriends)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(offset, offset + Math.min(Math.max(limit, 1), 50))
    .map((workout) => store.settings.find((item) => item.userId === workout.userId)?.hideExactNumbers
      ? { ...workout, durationSeconds: 0, distanceMeters: 0, calories: 0 }
      : workout);
}

export function circleTimeline(
  store: AppStore,
  viewerId: ID,
  limit = 20,
  cursor?: string,
  filter = "all"
): { items: CircleTimelineEntry[]; nextCursor?: string } {
  const friendIds = new Set(friendsFor(store, viewerId).map((user) => user.id));
  const visible = (userId: ID) =>
    friendIds.has(userId) && !store.settings.find((item) => item.userId === userId)?.hideActivityFromFriends;
  const workoutEntries: CircleTimelineEntry[] = store.workouts
    .filter((workout) => visible(workout.userId) && workout.visibility !== "private")
    .filter((workout) => ["all", "activities", workout.activityType].includes(filter))
    .map((workout) => {
      const hideExact = store.settings.find((item) => item.userId === workout.userId)?.hideExactNumbers;
      const safeWorkout = hideExact ? { ...workout, durationSeconds: 0, distanceMeters: 0, calories: 0 } : workout;
      return {
        id: `circle_workout_${workout.id}`,
        type: "workout",
        user: publicProfile(store, viewerId, workout.userId),
        createdAt: workout.startedAt,
        title: activityKindLabel(workout.activityType),
        summary: hideExact ? "Completed a new activity." : workoutTimelineSummary(workout),
        workout: safeWorkout,
        reactions: []
      };
    });
  const milestoneEntries: CircleTimelineEntry[] = store.feed
    .filter((item) => visible(item.userId) && ["streak", "badge"].includes(item.type))
    .filter((item) => ["all", "milestones"].includes(filter))
    .map((item) => ({
      id: `circle_${item.id}`,
      type: item.type === "badge" ? "badgeEarned" : "streakMilestone",
      user: publicProfile(store, viewerId, item.userId),
      createdAt: item.createdAt,
      title: item.title,
      summary: item.body,
      badge: item.type === "badge" ? store.badges.find((badge) => badge.id === item.entityId) : undefined,
      streakCount: item.type === "streak" ? Number(item.metadata?.streakCount ?? 0) : undefined,
      reactions: item.reactions
    }));
  const all = [...workoutEntries, ...milestoneEntries]
    .filter((item) => !cursor || item.createdAt < cursor)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const page = all.slice(0, Math.min(Math.max(limit, 1), 50));
  return { items: page, nextCursor: all.length > page.length ? page.at(-1)?.createdAt : undefined };
}

function workoutTimelineSummary(workout: WorkoutSummary): string {
  if (workout.activityType === "strengthTraining") return `${Math.round(workout.durationSeconds / 60)} min strength session`;
  return `${Number((workout.distanceMeters / 1000).toFixed(2))} km in ${Math.round(workout.durationSeconds / 60)} min`;
}

export function workoutForViewer(store: AppStore, viewerId: ID, workoutId: ID) {
  const workout = store.workouts.find((item) => item.id === workoutId);
  if (!workout) throw new Error("Activity not found");
  if (workout.userId === viewerId) return workout;
  if (friendshipStatus(store, viewerId, workout.userId) !== "accepted") throw new Error("Activity not available");
  if (workout.visibility === "private") throw new Error("Activity not available");
  const privacy = store.settings.find((item) => item.userId === workout.userId);
  if (privacy?.hideActivityFromFriends) throw new Error("Activity not available");
  return privacy?.hideExactNumbers ? { ...workout, durationSeconds: 0, distanceMeters: 0, calories: 0 } : workout;
}

export function workoutForExactViewer(store: AppStore, viewerId: ID, workoutId: ID) {
  const workout = workoutForViewer(store, viewerId, workoutId);
  const original = store.workouts.find((item) => item.id === workoutId)!;
  if (original.userId !== viewerId && store.settings.find((item) => item.userId === original.userId)?.hideExactNumbers) {
    throw new Error("Activity details are private");
  }
  return workout;
}

export function summaryForViewer(store: AppStore, viewerId: ID, summaryId: ID) {
  const summary = store.summaries.find((item) => item.id === summaryId);
  if (!summary) throw new Error("Activity not found");
  if (summary.userId === viewerId) return summary;
  if (friendshipStatus(store, viewerId, summary.userId) !== "accepted") throw new Error("Activity not available");
  const privacy = store.settings.find((item) => item.userId === summary.userId);
  if (privacy?.hideActivityFromFriends || privacy?.hideExactNumbers) throw new Error("Activity details are private");
  return summary;
}

export function upsertWorkouts(store: AppStore, userId: ID, input: Array<Omit<WorkoutSummary, "id" | "userId" | "source" | "trustLevel" | "updatedAt">>): WorkoutSummary[] {
  const previousStreaks = goalStreakSnapshot(store, userId);
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
      updatedAt: now,
      automaticTitle: existing?.automaticTitle,
      customTitle: existing?.customTitle,
      note: existing?.note,
      effortRating: existing?.effortRating,
      visibility: existing?.visibility ?? "friends"
    };
    saved.automaticTitle ||= automaticWorkoutTitle(saved);
    if (existing) Object.assign(existing, saved);
    else store.workouts.push(saved);
    return saved;
  });
  refreshDerived(store, userId);
  emitGoalStreakMilestones(store, userId, previousStreaks);
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
  notify(store, { userId: addresseeId, actorId: requesterId, type: "friendRequest", entityType: "friendship", entityId: saved.id, title: "New friend request", body: `${displayName(store, requesterId)} wants to connect.`, deduplicationKey: `friend-request:${saved.id}` });
  return saved;
}

export function respondFriendRequest(store: AppStore, friendshipId: ID, userId: ID, accept: boolean): Friendship {
  const friendship = store.friendships.find((item) => item.id === friendshipId);
  if (!friendship) throw new Error("Friend request not found");
  if (friendship.addresseeId !== userId) throw new Error("Only the addressee can respond");
  friendship.status = accept ? "accepted" : "declined";
  friendship.respondedAt = new Date().toISOString();
  if (accept) notify(store, { userId: friendship.requesterId, actorId: userId, type: "friendAccepted", entityType: "user", entityId: userId, title: "Friend request accepted", body: `${displayName(store, userId)} is now your friend.`, deduplicationKey: `friend-accepted:${friendship.id}` });
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

export function profileFriendsFor(store: AppStore, viewerId: ID, userId: ID) {
  if (viewerId !== userId && friendshipStatus(store, viewerId, userId) !== "accepted") throw new Error("Friends are not visible");
  return friendsFor(store, userId).map((user) => publicProfile(store, viewerId, user.id));
}

export function upsertSummary(store: AppStore, summaryInput: Omit<ActivitySummary, "id" | "source" | "trustLevel" | "updatedAt">, updateDerived = true): ActivitySummary {
  const previousStreaks = goalStreakSnapshot(store, summaryInput.userId);
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
  if (updateDerived) {
    refreshDerived(store, summary.userId);
    emitGoalStreakMilestones(store, summary.userId, previousStreaks);
  }
  return existing ?? summary;
}

export function upsertSummaries(store: AppStore, inputs: Array<Omit<ActivitySummary, "id" | "source" | "trustLevel" | "updatedAt">>, emitMilestones = true): ActivitySummary[] {
  if (inputs.length === 0) return [];
  const uniqueInputs = Array.from(new Map(inputs.map((input) => [`${input.userId}:${input.localDate}`, input])).values());
  const userId = uniqueInputs[0].userId;
  if (uniqueInputs.some((input) => input.userId !== userId)) throw new Error("Activity summary batches must belong to one user");
  const previousStreaks = goalStreakSnapshot(store, userId);
  const saved = uniqueInputs.map((input) => upsertSummary(store, input, false));
  refreshDerived(store, userId);
  if (emitMilestones) emitGoalStreakMilestones(store, userId, previousStreaks);
  return saved;
}

export function addGoal(store: AppStore, goal: Omit<Goal, "id" | "createdAt">): Goal {
  if (goal.target <= 0) throw new Error("Goal target must be greater than zero");
  if (store.goals.some((item) => item.userId === goal.userId && item.kind === goal.kind && item.cadence === goal.cadence)) {
    throw new Error("An active goal already exists for this metric and frequency");
  }
  const saved: Goal = { ...goal, isEnabled: goal.isEnabled ?? true, id: `goal_${store.goals.length + 1}`, createdAt: new Date().toISOString() };
  store.goals.push(saved);
  store.goalVersions.push({ goalId: saved.id, userId: saved.userId, kind: saved.kind, cadence: saved.cadence, target: saved.target, effectiveDate: currentDateForUser(store, saved.userId) });
  const settings = store.settings.find((item) => item.userId === saved.userId);
  if (settings && !settings.homeGoalId && saved.isEnabled) settings.homeGoalId = saved.id;
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
  if (!store.goalVersions.some((item) => item.goalId === goal.id)) {
    store.goalVersions.push({ goalId: goal.id, userId, kind: goal.kind, cadence: goal.cadence, target: goal.target, effectiveDate: goal.createdAt.slice(0, 10) });
  }
  if (next.target !== goal.target || next.kind !== goal.kind || next.cadence !== goal.cadence) {
    const effectiveDate = currentDateForUser(store, userId);
    store.goalVersions = store.goalVersions.filter((item) => item.goalId !== goal.id || item.effectiveDate !== effectiveDate);
    store.goalVersions.push({ goalId: goal.id, userId, kind: next.kind, cadence: next.cadence, target: next.target, effectiveDate });
  }
  Object.assign(goal, next);
  const settings = store.settings.find((item) => item.userId === userId);
  if (settings?.homeGoalId === goal.id && !goal.isEnabled) settings.homeGoalId = preferredHomeGoal(store, userId)?.id;
  refreshDerived(store, userId);
  return goal;
}

export function deleteGoal(store: AppStore, userId: ID, goalId: ID) {
  const before = store.goals.length;
  store.goals = store.goals.filter((item) => !(item.id === goalId && item.userId === userId));
  if (store.goals.length === before) throw new Error("Goal not found");
  store.goalVersions = store.goalVersions.filter((item) => item.goalId !== goalId);
  store.goalStreaks = store.goalStreaks.filter((item) => item.goalId !== goalId);
  const settings = store.settings.find((item) => item.userId === userId);
  if (settings?.homeGoalId === goalId) settings.homeGoalId = preferredHomeGoal(store, userId)?.id;
  refreshDerived(store, userId);
  return { ok: true };
}

export function friendLeaderboard(store: AppStore, userId: ID, period: LeaderboardPeriod, metric: LeaderboardMetric = "steps"): ActivityComparison {
  return {
    period,
    metric,
    rows: leaderboardRows({
      userIds: [userId, ...friendsFor(store, userId).map((friend) => friend.id)],
      summaries: store.summaries,
      goals: store.goals,
      streaks: store.streaks,
      workouts: store.workouts,
      period,
      metric,
      now: currentDateForUser(store, userId)
    })
  };
}

export function createConversation(store: AppStore, creatorId: ID, input: { kind: "direct" | "group"; title?: string; memberIds: ID[] }): Conversation {
  const members = unique([creatorId, ...input.memberIds]);
  if (input.kind === "direct" && members.length === 2) {
    const existing = store.conversations.find((conversation) => conversation.kind === "direct" && members.every((id) => store.conversationMembers.some((member) => member.conversationId === conversation.id && member.userId === id)));
    if (existing) return existing;
  }
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
    unreadCount: store.messages.filter((item) => {
      if (item.conversationId !== conversation.id || item.senderId === userId) return false;
      const member = store.conversationMembers.find((candidate) => candidate.conversationId === conversation.id && candidate.userId === userId);
      return !member?.lastReadAt || item.createdAt > member.lastReadAt;
    }).length
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
      notify(store, { userId: memberId, actorId: userId, type: "groupAdded", entityType: "conversation", entityId: conversationId, title: "Added to a group", body: `${displayName(store, userId)} added you to ${conversation.title ?? "a group"}.`, deduplicationKey: `group-added:${conversationId}:${memberId}` });
    }
  }
  return store.conversationMembers.filter((item) => item.conversationId === conversationId);
}

export function addMessage(store: AppStore, userId: ID, message: { conversationId: ID; body: string }): Message {
  requireMember(store, userId, message.conversationId);
  const saved = chatMessage(`message_${store.messages.length + 1}`, message.conversationId, userId, message.body, new Date().toISOString(), [userId]);
  store.messages.push(saved);
  for (const member of store.conversationMembers.filter((item) => item.conversationId === message.conversationId && item.userId !== userId)) {
    notify(store, { userId: member.userId, actorId: userId, type: "message", entityType: "conversation", entityId: message.conversationId, title: "New message", body: message.body, deduplicationKey: `message:${saved.id}:${member.userId}` });
  }
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
  const existing = message.reactions.find((item) => item.userId === userId);
  if (existing?.kind === kind) {
    message.reactions = message.reactions.filter((item) => item.id !== existing.id);
    return message.reactions;
  }
  const saved = reaction(`message_reaction_${messageId}_${userId}`, "message", messageId, userId, kind, new Date().toISOString());
  message.reactions = message.reactions.filter((item) => item.userId !== userId);
  message.reactions.push(saved);
  if (message.senderId && message.senderId !== userId) notify(store, { userId: message.senderId, actorId: userId, type: "reaction", entityType: "conversation", entityId: message.conversationId, title: "Message reaction", body: `${displayName(store, userId)} reacted to your message.`, deduplicationKey: `message-reaction:${messageId}:${userId}:${kind}` });
  return message.reactions;
}

export function conversationComparison(store: AppStore, userId: ID, conversationId: ID, period: LeaderboardPeriod, metric: LeaderboardMetric = "steps"): ActivityComparison {
  requireMember(store, userId, conversationId);
  return {
    period,
    metric,
    rows: leaderboardRows({
      userIds: store.conversationMembers.filter((item) => item.conversationId === conversationId).map((item) => item.userId),
      summaries: store.summaries,
      goals: store.goals,
      streaks: store.streaks,
      workouts: store.workouts,
      period,
      metric,
      now: currentDateForUser(store, userId)
    })
  };
}

export function addChallenge(store: AppStore, challenge: Omit<Challenge, "id" | "createdAt" | "status" | "participants"> & { participantIds: ID[] }): Challenge {
  if (challenge.endsOn < challenge.startsOn) throw new Error("Challenge end date must be after its start date");
  if (["target", "cooperative", "team", "survivor"].includes(challenge.mode ?? "") && (!challenge.target || challenge.target <= 0)) throw new Error("This challenge mode requires a positive target");
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
    participants: unique([challenge.creatorId, ...challenge.participantIds]).map((userId, index) => ({ userId, accepted: userId === challenge.creatorId, score: 0, respondedAt: userId === challenge.creatorId ? new Date().toISOString() : undefined, teamId: challenge.mode === "team" ? (index % 2 === 0 ? "team_a" : "team_b") : undefined, livesRemaining: challenge.mode === "survivor" ? (challenge.survivorLives ?? 0) : undefined, missedDays: challenge.mode === "survivor" ? [] : undefined })),
    createdAt: new Date().toISOString()
  };
  store.challenges.push(saved);
  for (const participant of saved.participants.filter((item) => item.userId !== saved.creatorId)) {
    notify(store, { userId: participant.userId, actorId: saved.creatorId, type: "challengeInvite", entityType: "challenge", entityId: saved.id, title: "Challenge invitation", body: saved.title, deduplicationKey: `challenge-invite:${saved.id}:${participant.userId}` });
  }
  if (saved.sharedConversationId) {
    requireMember(store, challenge.creatorId, saved.sharedConversationId);
    store.messages.push(systemMessage(`message_challenge_invite_${saved.id}`, saved.sharedConversationId, `Challenge invite: ${saved.title}. Open Challenges to accept and track progress.`, new Date().toISOString()));
  }
  refreshChallenge(store, saved);
  return saved;
}

export function respondChallenge(store: AppStore, challengeId: ID, userId: ID, accept: boolean): Challenge {
  const challenge = requireChallenge(store, challengeId);
  const participant = challenge.participants.find((item) => item.userId === userId);
  if (!participant) throw new Error("Challenge participant not found");
  participant.accepted = accept;
  participant.respondedAt = new Date().toISOString();
  notify(store, { userId: challenge.creatorId, actorId: userId, type: "challengeUpdate", entityType: "challenge", entityId: challenge.id, title: accept ? "Challenge accepted" : "Challenge declined", body: `${displayName(store, userId)} ${accept ? "joined" : "declined"} ${challenge.title}.`, deduplicationKey: `challenge-response:${challenge.id}:${userId}` });
  refreshChallenge(store, challenge);
  return challenge;
}

export function challengesFor(store: AppStore, userId: ID): Challenge[] {
  for (const challenge of store.challenges) refreshChallenge(store, challenge);
  return store.challenges.filter((challenge) => challenge.participants.some((item) => item.userId === userId));
}

export function challengeCareerStats(store: AppStore, userId: ID): ChallengeCareerStats {
  for (const challenge of store.challenges.filter((item) => item.participants.some((participant) => participant.userId === userId))) {
    refreshChallenge(store, challenge);
  }
  const entered = store.challenges.filter((challenge) => challenge.participants.some((item) => item.userId === userId && item.accepted));
  const active = entered.filter((challenge) => challenge.status !== "completed").length;
  const pendingInvites = store.challenges.filter((challenge) => challenge.participants.some((item) => item.userId === userId && !item.accepted && !item.respondedAt)).length;
  const completed = entered.filter((challenge) => challenge.status === "completed").sort((a, b) => a.endsOn.localeCompare(b.endsOn));
  const outcomes = completed.map((challenge) => challengeOutcomeKind(challenge, userId));
  const isWin = (outcome: ChallengeOutcomeKind) => ["win", "teamWin", "targetSuccess", "cooperativeSuccess"].includes(outcome);
  const isLoss = (outcome: ChallengeOutcomeKind) => ["loss", "teamLoss", "targetMiss", "cooperativeFailure"].includes(outcome);
  let currentWinStreak = 0;
  for (const outcome of [...outcomes].reverse()) {
    if (!isWin(outcome)) break;
    currentWinStreak += 1;
  }
  let bestWinStreak = 0;
  let run = 0;
  for (const outcome of outcomes) {
    run = isWin(outcome) ? run + 1 : 0;
    bestWinStreak = Math.max(bestWinStreak, run);
  }
  const kindCounts = new Map<ActivityKind, number>();
  for (const challenge of entered) kindCounts.set(challenge.kind, (kindCounts.get(challenge.kind) ?? 0) + 1);
  const favoriteKind = [...kindCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const wins = outcomes.filter(isWin).length;
  const losses = outcomes.filter(isLoss).length;
  const draws = outcomes.filter((outcome) => outcome === "draw" || outcome === "teamDraw").length;
  const targetSuccesses = outcomes.filter((outcome) => outcome === "targetSuccess").length;
  const cooperativeSuccesses = outcomes.filter((outcome) => outcome === "cooperativeSuccess").length;
  const teamWins = outcomes.filter((outcome) => outcome === "teamWin").length;
  const podiumFinishes = completed.filter((challenge) => {
    if (challenge.mode === "cooperative" || challenge.mode === "team") return challengeOutcome(challenge, userId);
    const ranked = [...challenge.participants].filter((item) => item.accepted).sort((a, b) => b.score - a.score);
    return ranked.findIndex((item) => item.userId === userId) >= 0 && ranked.findIndex((item) => item.userId === userId) < 3;
  }).length;
  return {
    userId,
    entered: entered.length,
    completed: completed.length,
    wins,
    losses,
    draws,
    active,
    pendingInvites,
    targetSuccesses,
    cooperativeSuccesses,
    teamWins,
    podiumFinishes,
    currentWinStreak,
    bestWinStreak,
    winRate: wins + losses + draws ? Math.round(wins / (wins + losses + draws) * 100) : 0,
    favoriteKind
  };
}

export function challengeHistoryBetween(store: AppStore, userId: ID, friendId: ID) {
  if (friendshipStatus(store, userId, friendId) !== "accepted") throw new Error("Challenge history is available to friends");
  const shared = store.challenges.filter((challenge) =>
    challenge.status === "completed"
    && challenge.participants.some((item) => item.userId === userId && item.accepted)
    && challenge.participants.some((item) => item.userId === friendId && item.accepted)
  );
  let wins = 0, losses = 0, draws = 0;
  for (const challenge of shared) {
    const mine = challenge.participants.find((item) => item.userId === userId)?.score ?? 0;
    const theirs = challenge.participants.find((item) => item.userId === friendId)?.score ?? 0;
    if (mine > theirs) wins++; else if (mine < theirs) losses++; else draws++;
  }
  return { friendId, total: shared.length, wins, losses, draws, recent: shared.sort((a, b) => b.endsOn.localeCompare(a.endsOn)).slice(0, 5) };
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
  if (item.userId !== reactionInput.userId) notify(store, { userId: item.userId, actorId: reactionInput.userId, type: "reaction", entityType: "feed", entityId: item.id, title: "New reaction", body: `${displayName(store, reactionInput.userId)} reacted to your activity.`, deduplicationKey: `reaction:${saved.id}` });
  return saved;
}

export function notificationsFor(store: AppStore, userId: ID, limit = 30, before?: string, unreadOnly = false) {
  const rows = store.notifications.filter((item) => item.userId === userId && !item.archivedAt && (!before || item.createdAt < before) && (!unreadOnly || !item.readAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.min(Math.max(limit, 1), 100));
  return rows.map((item) => ({ ...item, actor: item.actorId ? publicProfile(store, userId, item.actorId) : undefined }));
}

export function unreadNotificationCount(store: AppStore, userId: ID) {
  return store.notifications.filter((item) => item.userId === userId && !item.readAt && !item.archivedAt).length;
}

export function markNotificationRead(store: AppStore, userId: ID, notificationId: ID) {
  const item = store.notifications.find((notification) => notification.id === notificationId && notification.userId === userId);
  if (!item) throw new Error("Notification not found");
  item.readAt = item.readAt ?? new Date().toISOString();
  return item;
}

export function markAllNotificationsRead(store: AppStore, userId: ID) {
  const now = new Date().toISOString();
  for (const item of store.notifications.filter((notification) => notification.userId === userId && !notification.readAt)) item.readAt = now;
  return { ok: true };
}

export function archiveNotification(store: AppStore, userId: ID, notificationId: ID) {
  const item = markNotificationRead(store, userId, notificationId);
  item.archivedAt = new Date().toISOString();
  return item;
}

export function deleteNotification(store: AppStore, userId: ID, notificationId: ID) {
  store.notifications = store.notifications.filter((item) => !(item.id === notificationId && item.userId === userId));
  return { ok: true };
}

function notify(store: AppStore, input: Omit<AppNotification, "id" | "metadata" | "createdAt"> & { metadata?: Record<string, unknown> }) {
  const settings = store.settings.find((item) => item.userId === input.userId);
  if (
    ((input.type === "message" || input.type === "groupAdded") && settings?.pushMessages === false)
    || ((input.type === "friendRequest" || input.type === "friendAccepted") && settings?.pushFriendRequests === false)
    || (input.type.startsWith("challenge") && settings?.pushChallenges === false)
    || (["goal", "streak", "rank", "recap", "personalBest"].includes(input.type) && settings?.pushMilestones === false)
  ) return;
  if (store.notifications.some((item) => item.deduplicationKey === input.deduplicationKey)) return;
  const metadata = {
    destinationType: input.entityType ?? input.type,
    ...(input.entityId ? { destinationId: input.entityId } : {}),
    ...(input.metadata ?? {})
  };
  store.notifications.push({ ...input, id: `notification_${Date.now()}_${store.notifications.length + 1}`, metadata, createdAt: new Date().toISOString() });
}

function displayName(store: AppStore, userId: ID) { return store.users.find((user) => user.id === userId)?.displayName ?? "A friend"; }

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

export function monthlyRecapFor(store: AppStore, userId: ID, month?: string): MonthlyRecap {
  const resolved = month && /^\d{4}-\d{2}$/.test(month) ? month : currentDateForUser(store, userId).slice(0, 7);
  const previousDate = new Date(`${resolved}-01T12:00:00Z`);
  previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previous = previousDate.toISOString().slice(0, 7);
  const summaries = store.summaries.filter((item) => item.userId === userId && item.localDate.startsWith(resolved));
  const previousSummaries = store.summaries.filter((item) => item.userId === userId && item.localDate.startsWith(previous));
  const workouts = store.workouts.filter((item) => item.userId === userId && item.startedAt.slice(0, 7) === resolved);
  const totalSteps = summaries.reduce((sum, item) => sum + item.steps, 0);
  const previousSteps = previousSummaries.reduce((sum, item) => sum + item.steps, 0);
  const bestDay = summaries.filter((item) => item.steps > 0).sort((a, b) => b.steps - a.steps)[0];
  return {
    month: resolved,
    userId,
    isFinal: resolved < currentDateForUser(store, userId).slice(0, 7),
    totalSteps,
    totalDistanceMeters: summaries.reduce((sum, item) => sum + item.walkingDistanceMeters + item.runningDistanceMeters, 0),
    walkingDistanceMeters: summaries.reduce((sum, item) => sum + item.walkingDistanceMeters, 0),
    runningDistanceMeters: summaries.reduce((sum, item) => sum + item.runningDistanceMeters, 0),
    activeMinutes: summaries.reduce((sum, item) => sum + item.activeMinutes, 0),
    calories: summaries.reduce((sum, item) => sum + item.calories, 0),
    walkingWorkouts: workouts.filter((item) => item.activityType === "walking").length,
    runningWorkouts: workouts.filter((item) => item.activityType === "running").length,
    strengthWorkouts: workouts.filter((item) => item.activityType === "strengthTraining").length,
    activeDays: summaries.filter((item) => item.steps > 0 || item.workoutCount > 0 || item.activeMinutes > 0).length,
    bestDay: bestDay ? { localDate: bestDay.localDate, steps: bestDay.steps } : undefined,
    previousMonthTrendPercent: previousSteps > 0 ? Math.round((totalSteps - previousSteps) / previousSteps * 100) : 0
  };
}

export function badgesForUser(store: AppStore, userId: ID) {
  return store.userBadges
    .filter((item) => item.userId === userId)
    .map((item) => ({ earnedAt: item.earnedAt, badge: store.badges.find((badge) => badge.id === item.badgeId)! }))
    .filter((item) => item.badge);
}

export function badgeProgressForUser(store: AppStore, userId: ID) {
  const earnedById = new Map(store.userBadges.filter((item) => item.userId === userId).map((item) => [item.badgeId, item]));
  return store.badges.map((badge) => {
    const current = badgeMetric(store, userId, badge.ruleKind);
    const earned = badge.ruleKind === "fastest5K" ? current > 0 && current <= badge.threshold : current >= badge.threshold;
    return { badgeId: badge.id, current, target: badge.threshold, earned, earnedAt: earnedById.get(badge.id)?.earnedAt };
  });
}

export function refreshBadgesForUser(store: AppStore, userId: ID) {
  const existing = new Set(store.userBadges.filter((item) => item.userId === userId).map((item) => item.badgeId));
  const now = new Date().toISOString();
  const newlyEarned = badgeProgressForUser(store, userId).filter((item) => item.earned && !existing.has(item.badgeId)).map((item) => ({
    id: `user_badge_${userId}_${item.badgeId}`, userId, badgeId: item.badgeId, earnedAt: now
  }));
  store.userBadges.push(...newlyEarned);
  for (const award of newlyEarned) {
    const badge = store.badges.find((item) => item.id === award.badgeId);
    if (!badge || !["gold", "elite", "legendary"].includes(badge.difficulty ?? "bronze")) continue;
    const feedId = `feed_badge_${award.id}`;
    if (store.feed.some((item) => item.id === feedId)) continue;
    store.feed.push(feedItem(
      feedId, userId, "badge", `${badge.title} earned`,
      badge.description ?? `Earned the ${badge.title} badge.`, award.earnedAt,
      "badge", badge.id, { difficulty: badge.difficulty ?? "gold" }
    ));
  }
  return newlyEarned;
}

export function profileStats(store: AppStore, userId: ID): ProfileStats {
  const userSummaries = store.summaries.filter((item) => item.userId === userId);
  const userWorkouts = store.workouts.filter((item) => item.userId === userId);
  const lifetimeSteps = userSummaries.reduce((sum, item) => sum + item.steps, 0);
  const challengeWins = challengeCareerStats(store, userId).wins;
  return {
    userId,
    lifetimeSteps,
    lifetimeDistanceMeters: userSummaries.reduce((sum, item) => sum + item.walkingDistanceMeters + item.runningDistanceMeters, 0),
    activeDays: new Set([
      ...userSummaries.filter((item) => item.steps > 0 || item.activeMinutes > 0).map((item) => item.localDate),
      ...userWorkouts.map((item) => item.startedAt.slice(0, 10))
    ]).size,
    workoutCount: userWorkouts.length,
    badgesEarned: store.userBadges.filter((item) => item.userId === userId).length,
    challengeWins,
    currentStreak: store.streaks.find((item) => item.userId === userId)?.currentDays ?? 0,
    bestStreak: store.streaks.find((item) => item.userId === userId)?.bestDays ?? 0,
    goalsHit: store.goals.filter((goal) => goal.userId === userId).length + Math.floor(lifetimeSteps / 50000),
    friendCount: friendsFor(store, userId).length
  };
}

export function profileRecords(store: AppStore, userId: ID) {
  const workouts = store.workouts.filter((item) => item.userId === userId);
  const running = workouts.filter((item) => item.activityType === "running" && item.distanceMeters > 0 && item.durationSeconds > 0);
  const fastest = (meters: number) => {
    const eligible = running.filter((item) => isStandaloneDistance(item.distanceMeters, meters));
    if (eligible.length === 0) return undefined;
    return Math.round(Math.min(...eligible.map((item) => item.durationSeconds)));
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

export function activitySummariesFor(store: AppStore, userId: ID, from?: string, to?: string) {
  return store.summaries.filter((item) => item.userId === userId && (!from || item.localDate >= from) && (!to || item.localDate <= to));
}

export function activityWorkoutsFor(store: AppStore, userId: ID, input: { from?: string; to?: string; type?: string; limit?: number; before?: string }) {
  return store.workouts.filter((item) => item.userId === userId && (!input.from || item.startedAt.slice(0, 10) >= input.from) && (!input.to || item.startedAt.slice(0, 10) <= input.to) && (!input.type || item.activityType === input.type) && (!input.before || item.startedAt < input.before))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, Math.min(Math.max(input.limit ?? 50, 1), 200));
}

export function activityAggregatesFor(store: AppStore, userId: ID, weeks = 13) {
  const today = currentDateForUser(store, userId);
  const currentWeek = startOfWeek(today);
  return Array.from({ length: Math.min(Math.max(weeks, 1), 104) }, (_, offset) => {
    const weekStartsOn = addLocalDays(currentWeek, -(weeks - offset - 1) * 7);
    const weekEndsOn = addLocalDays(weekStartsOn, 6);
    const summaries = activitySummariesFor(store, userId, weekStartsOn, weekEndsOn);
    const workouts = store.workouts.filter((item) => item.userId === userId && item.startedAt.slice(0, 10) >= weekStartsOn && item.startedAt.slice(0, 10) <= weekEndsOn);
    return { weekStartsOn, steps: summaries.reduce((sum, item) => sum + item.steps, 0), walkingDistanceMeters: summaries.reduce((sum, item) => sum + item.walkingDistanceMeters, 0), runningDistanceMeters: summaries.reduce((sum, item) => sum + item.runningDistanceMeters, 0), activeMinutes: summaries.reduce((sum, item) => sum + item.activeMinutes, 0), calories: summaries.reduce((sum, item) => sum + item.calories, 0), strengthSessions: workouts.filter((item) => item.activityType === "strengthTraining").length };
  });
}

export function lifetimePersonalBests(store: AppStore, userId: ID) {
  const summaries = store.summaries.filter((item) => item.userId === userId);
  const workouts = store.workouts.filter((item) => item.userId === userId);
  const runs = workouts.filter((item) => item.activityType === "running" && item.distanceMeters > 0 && item.durationSeconds > 0);
  const fastest = (meters: number) => runs.filter((item) => isStandaloneDistance(item.distanceMeters, meters)).map((item) => ({ workout: item, elapsedSeconds: Math.round(item.durationSeconds), paceSecondsPerKm: Math.round(item.durationSeconds / (item.distanceMeters / 1000)) })).sort((a, b) => a.elapsedSeconds - b.elapsedSeconds).slice(0, 20);
  return {
    fastest1K: fastest(1000), fastest5K: fastest(5000), fastest10K: fastest(10000), fastestHalfMarathon: fastest(21097.5),
    highestStepDays: summaries.filter((item) => item.steps > 0).sort((a, b) => b.steps - a.steps).slice(0, 20),
    longestWalks: workouts.filter((item) => item.activityType === "walking").sort((a, b) => b.distanceMeters - a.distanceMeters).slice(0, 20),
    longestActivities: [...workouts].sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 20),
    longestStrengthSessions: workouts.filter((item) => item.activityType === "strengthTraining").sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 20),
    highestActiveMinuteDays: summaries.filter((item) => item.activeMinutes > 0).sort((a, b) => b.activeMinutes - a.activeMinutes).slice(0, 20)
  };
}

function isStandaloneDistance(recordedMeters: number, targetMeters: number): boolean {
  const tolerance = Math.min(Math.max(75, targetMeters * 0.03), 750);
  return Math.abs(recordedMeters - targetMeters) <= tolerance;
}

export function personalBestsFor(store: AppStore, viewerId: ID, userId: ID) {
  const status = friendshipStatus(store, viewerId, userId);
  const privacy = store.settings.find((item) => item.userId === userId);
  if (viewerId !== userId && (status !== "accepted" || privacy?.hideActivityFromFriends || privacy?.hideExactNumbers)) throw new Error("Activity is not visible");
  return lifetimePersonalBests(store, userId);
}

export function personalRecordLabFor(store: AppStore, viewerId: ID, userId: ID, splitDetails: WorkoutSplitsDetail[] = []): PersonalRecordLab {
  const status = friendshipStatus(store, viewerId, userId);
  const privacy = store.settings.find((item) => item.userId === userId);
  if (viewerId !== userId && (status !== "accepted" || privacy?.hideActivityFromFriends || privacy?.hideExactNumbers)) {
    throw new Error("Activity is not visible");
  }

  const runs = store.workouts
    .filter((item) => item.userId === userId && item.activityType === "running" && item.distanceMeters > 0 && item.durationSeconds > 0);

  const buildRecord = (
    key: string,
    distanceMeters: number,
    recordType: "standalone" | "split",
    sourceAttempts: Array<Omit<PersonalRecordAttempt, "isPersonalBest" | "isCurrentPersonalBest">>
  ) => {
    let recordSeconds = Number.POSITIVE_INFINITY;
    const chronological = sourceAttempts
      .sort((left, right) => left.workout.startedAt.localeCompare(right.workout.startedAt))
      .map((attempt): PersonalRecordAttempt => {
        const isPersonalBest = attempt.elapsedSeconds < recordSeconds;
        recordSeconds = Math.min(recordSeconds, attempt.elapsedSeconds);
        return { ...attempt, isPersonalBest, isCurrentPersonalBest: false };
      });

    const bestSeconds = Math.min(Number.POSITIVE_INFINITY, ...chronological.map((attempt) => attempt.elapsedSeconds));
    const marked = chronological.map((attempt) => ({
      ...attempt,
      isCurrentPersonalBest: attempt.elapsedSeconds === bestSeconds
    }));
    const ranked = [...marked].sort((left, right) => left.elapsedSeconds - right.elapsedSeconds || right.workout.startedAt.localeCompare(left.workout.startedAt));
    const newest = [...marked].sort((left, right) => right.workout.startedAt.localeCompare(left.workout.startedAt));
    const recent = newest.slice(0, 5);
    const best = ranked[0];
    const latest = newest[0];
    const first = marked[0];
    return {
      key,
      distanceMeters,
      recordType,
      totalAttempts: marked.length,
      best,
      latest,
      improvementSeconds: best && first ? Math.max(first.elapsedSeconds - best.elapsedSeconds, 0) : 0,
      latestGapSeconds: best && latest ? Math.max(latest.elapsedSeconds - best.elapsedSeconds, 0) : 0,
      recentAveragePaceSecondsPerKm: recent.length
        ? Math.round(recent.reduce((sum, item) => sum + item.paceSecondsPerKm, 0) / recent.length)
        : 0,
      attempts: newest.slice(0, 100)
    };
  };

  const standaloneDistances = [1_000, 2_000, 3_000, 4_000, 5_000, 10_000, 15_000, 21_097.5, 42_195];
  const standalone = standaloneDistances.map((distanceMeters) => {
    const tolerance = Math.min(Math.max(75, distanceMeters * 0.03), 750);
    const attempts = runs
      .filter((workout) => Math.abs(workout.distanceMeters - distanceMeters) <= tolerance)
      .map((workout) => ({
        workout,
        elapsedSeconds: Math.round(workout.durationSeconds),
        paceSecondsPerKm: Math.round(workout.durationSeconds / (workout.distanceMeters / 1_000)),
        qualification: "standalone" as const
      }));
    return buildRecord(`standalone:${distanceMeters}`, distanceMeters, "standalone", attempts);
  });

  const runsById = new Map(runs.map((workout) => [workout.id, workout]));
  const splitAttempts = splitDetails.flatMap((detail) => {
    const workout = runsById.get(detail.workoutId);
    if (!workout) return [];
    const bestSplit = detail.splits
      .filter((split) => split.unit === "kilometer" && !split.isPartial && split.distanceMeters >= 950)
      .sort((left, right) => left.durationSeconds - right.durationSeconds)[0];
    if (!bestSplit) return [];
    return [{
      workout,
      elapsedSeconds: Math.round(bestSplit.durationSeconds),
      paceSecondsPerKm: Math.round(bestSplit.paceSecondsPerKm),
      qualification: "measuredSplit" as const,
      splitIndex: bestSplit.index
    }];
  });
  const fastestKilometerSplit = buildRecord("split:1000", 1_000, "split", splitAttempts);

  return {
    userId,
    generatedAt: new Date().toISOString(),
    distances: [...standalone, fastestKilometerSplit]
  };
}

export function userSummaries(store: AppStore, viewerId: ID, ids: ID[]) {
  return unique(ids).slice(0, 100).map((id) => publicProfile(store, viewerId, id));
}

function refreshDerived(store: AppStore, userId: ID) {
  ensureDefaultStepGoal(store, userId);
  const currentLocalDate = currentDateForUser(store, userId);
  const now = new Date().toISOString();
  const goals = store.goals.filter((goal) => goal.userId === userId);
  store.goalStreaks = store.goalStreaks.filter((item) => item.userId !== userId);
  for (const goal of goals) {
    const calculated = goal.isEnabled ? versionedStreak(store, goal, currentLocalDate) : { current: 0, best: 0, lastCompletedPeriod: undefined };
    store.goalStreaks.push({
      goalId: goal.id,
      userId,
      cadence: goal.cadence,
      currentCount: calculated.current,
      bestCount: calculated.best,
      lastCompletedPeriod: calculated.lastCompletedPeriod,
      updatedAt: now
    });
  }

  const homeGoal = preferredHomeGoal(store, userId);
  const homeStreak = store.goalStreaks.find((item) => item.goalId === homeGoal?.id);
  let current = store.streaks.find((item) => item.userId === userId);
  if (!current) {
    current = { userId, currentDays: 0, bestDays: 0, updatedAt: now };
    store.streaks.push(current);
  }
  current.currentDays = homeStreak?.currentCount ?? 0;
  current.bestDays = homeStreak?.bestCount ?? 0;
  current.updatedAt = now;

  refreshBadgesForUser(store, userId);
  for (const challenge of store.challenges.filter((item) => item.participants.some((participant) => participant.userId === userId))) refreshChallenge(store, challenge);
}

export function refreshDerivedForUser(store: AppStore, userId: ID) {
  refreshDerived(store, userId);
}

function versionedStreak(store: AppStore, goal: Goal, currentLocalDate: string) {
  const versions = store.goalVersions.filter((item) => item.goalId === goal.id).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const targetOn = (date: string) => [...versions].reverse().find((item) => item.effectiveDate <= date) ?? { kind: goal.kind, cadence: goal.cadence, target: goal.target };
  const periodStart = (date: string) => goal.cadence === "weekly" ? startOfWeek(date) : date;
  const previousPeriod = (date: string) => addLocalDays(date, goal.cadence === "weekly" ? -7 : -1);
  const nextPeriod = (date: string) => addLocalDays(date, goal.cadence === "weekly" ? 7 : 1);
  const achieved = (date: string) => {
    const version = targetOn(date);
    return goalValueForPeriod(store, goal.userId, version.kind, version.cadence, date) >= version.target;
  };
  let date = periodStart(currentLocalDate);
  if (!achieved(date)) date = previousPeriod(date);
  let current = 0;
  let lastCompletedPeriod: string | undefined;
  while (achieved(date)) {
    if (!lastCompletedPeriod) lastCompletedPeriod = date;
    current += 1;
    date = previousPeriod(date);
  }

  const summaryDates = store.summaries.filter((item) => item.userId === goal.userId).map((item) => item.localDate);
  const workoutDates = store.workouts.filter((item) => item.userId === goal.userId).map((item) => item.startedAt.slice(0, 10));
  const firstDate = [...summaryDates, ...workoutDates, goal.createdAt.slice(0, 10)].sort()[0];
  let best = 0;
  let run = 0;
  if (firstDate) {
    for (let cursor = periodStart(firstDate); cursor <= periodStart(currentLocalDate); cursor = nextPeriod(cursor)) {
      run = achieved(cursor) ? run + 1 : 0;
      best = Math.max(best, run);
    }
  }
  return { current, best, lastCompletedPeriod };
}

function goalValueForPeriod(store: AppStore, userId: ID, kind: ActivityKind, cadence: GoalCadence, periodStart: string): number {
  const periodEnd = cadence === "weekly" ? addLocalDays(periodStart, 6) : periodStart;
  const summaries = store.summaries.filter((item) => item.userId === userId && item.localDate >= periodStart && item.localDate <= periodEnd);
  const workouts = store.workouts.filter((item) => {
    const date = item.startedAt.slice(0, 10);
    return item.userId === userId && date >= periodStart && date <= periodEnd;
  });
  if (kind === "strengthTraining") return workouts.filter((item) => item.activityType === "strengthTraining").length;
  return summaries.reduce((total, summary) => total + valueForBadgeKind(summary, kind), 0);
}

function preferredHomeGoal(store: AppStore, userId: ID): Goal | undefined {
  const settings = store.settings.find((item) => item.userId === userId);
  const selected = store.goals.find((goal) => goal.id === settings?.homeGoalId && goal.userId === userId && goal.isEnabled);
  return selected
    ?? store.goals.find((goal) => goal.userId === userId && goal.kind === "steps" && goal.cadence === "daily" && goal.isEnabled)
    ?? store.goals.find((goal) => goal.userId === userId && goal.isEnabled);
}

function ensureDefaultStepGoal(store: AppStore, userId: ID): Goal {
  let goal = store.goals.find((item) => item.userId === userId && item.kind === "steps" && item.cadence === "daily");
  if (!goal) {
    goal = {
      id: `goal_${userId}_daily_steps`,
      userId,
      kind: "steps",
      cadence: "daily",
      target: 10_000,
      isEnabled: true,
      createdAt: new Date().toISOString()
    };
    store.goals.push(goal);
    store.goalVersions.push({
      goalId: goal.id,
      userId,
      kind: goal.kind,
      cadence: goal.cadence,
      target: goal.target,
      effectiveDate: currentDateForUser(store, userId)
    });
  }
  const settings = store.settings.find((item) => item.userId === userId);
  if (settings && !settings.homeGoalId) settings.homeGoalId = preferredHomeGoal(store, userId)?.id ?? goal.id;
  return goal;
}

export function goalHistory(store: AppStore, userId: ID, goalId: ID, from: string, to: string, limit = 120, offset = 0) {
  const goal = store.goals.find((item) => item.id === goalId && item.userId === userId);
  if (!goal) throw new Error("Goal not found");
  const versions = store.goalVersions.filter((item) => item.goalId === goal.id).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const targetOn = (date: string) => [...versions].reverse().find((item) => item.effectiveDate <= date)?.target ?? goal.target;
  const firstPeriod = goal.cadence === "weekly" ? startOfWeek(from) : from;
  const lastPeriod = goal.cadence === "weekly" ? startOfWeek(to) : to;
  const increment = goal.cadence === "weekly" ? 7 : 1;
  const entries: GoalHistoryEntry[] = [];
  for (let date = firstPeriod; date <= lastPeriod; date = addLocalDays(date, increment)) {
    const periodEnd = goal.cadence === "weekly" ? addLocalDays(date, 6) : date;
    const summaries = store.summaries.filter((item) => item.userId === userId && item.localDate >= date && item.localDate <= periodEnd);
    const workouts = store.workouts.filter((item) => item.userId === userId && item.startedAt.slice(0, 10) >= date && item.startedAt.slice(0, 10) <= periodEnd);
    const strength = workouts.filter((item) => item.activityType === "strengthTraining");
    const target = targetOn(date);
    const value = goalValueForPeriod(store, userId, goal.kind, goal.cadence, date);
    entries.push({
      periodStart: date,
      periodEnd,
      value,
      target,
      completed: value >= target,
      steps: summaries.reduce((sum, item) => sum + item.steps, 0),
      distanceMeters: summaries.reduce((sum, item) => sum + item.walkingDistanceMeters + item.runningDistanceMeters, 0),
      walkingDistanceMeters: summaries.reduce((sum, item) => sum + item.walkingDistanceMeters, 0),
      runningDistanceMeters: summaries.reduce((sum, item) => sum + item.runningDistanceMeters, 0),
      activeMinutes: summaries.reduce((sum, item) => sum + item.activeMinutes, 0),
      calories: summaries.reduce((sum, item) => sum + item.calories, 0),
      strengthSessions: strength.length,
      strengthMinutes: Math.round(strength.reduce((sum, item) => sum + item.durationSeconds, 0) / 60)
    });
  }
  const page = entries.reverse().slice(offset, offset + Math.min(Math.max(limit, 1), 366));
  return { goal, streak: store.goalStreaks.find((item) => item.goalId === goal.id), entries: page, hasMore: offset + page.length < entries.length };
}

function refreshChallenge(store: AppStore, challenge: Challenge) {
  const previousStatus = challenge.status;
  for (const participant of challenge.participants) {
    if (!participant.accepted) continue;
    const summaries = store.summaries.filter((item) => item.userId === participant.userId && item.localDate >= challenge.startsOn && item.localDate <= challenge.endsOn);
    if (challenge.kind === "strengthTraining") {
      participant.score = store.workouts.filter((item) => item.userId === participant.userId && item.activityType === "strengthTraining" && item.startedAt.slice(0, 10) >= challenge.startsOn && item.startedAt.slice(0, 10) <= challenge.endsOn).length;
    } else {
      participant.score = scoreChallenge(challenge.kind, summaries);
    }
    if (challenge.mode === "survivor") {
      const todayForParticipant = currentDateForUser(store, participant.userId);
      const finalEvaluationDate = [addLocalDays(todayForParticipant, -1), challenge.endsOn].sort()[0];
      const missedDays: string[] = [];
      for (let date = challenge.startsOn; date <= finalEvaluationDate; date = addLocalDays(date, 1)) {
        const dailySummaries = summaries.filter((item) => item.localDate === date);
        const value = challenge.kind === "strengthTraining"
          ? store.workouts.filter((item) => item.userId === participant.userId && item.activityType === "strengthTraining" && item.startedAt.slice(0, 10) === date).length
          : scoreChallenge(challenge.kind, dailySummaries);
        if (value < (challenge.survivorDailyTarget ?? challenge.target ?? 0)) missedDays.push(date);
      }
      participant.missedDays = missedDays;
      participant.livesRemaining = Math.max((challenge.survivorLives ?? 0) - missedDays.length, 0);
      if (missedDays.length > (challenge.survivorLives ?? 0)) participant.eliminatedAt ||= missedDays[challenge.survivorLives ?? 0];
      participant.score = participant.eliminatedAt ? Math.max(0, daysBetween(challenge.startsOn, participant.eliminatedAt)) : Math.max(0, daysBetween(challenge.startsOn, finalEvaluationDate) + 1);
    }
  }
  const today = currentDateForUser(store, challenge.creatorId);
  const invited = challenge.participants.filter((item) => item.userId !== challenge.creatorId);
  const allResponded = invited.every((item) => item.respondedAt);
  if (previousStatus === "completed") challenge.status = "completed";
  else if (today > challenge.endsOn) challenge.status = "completed";
  else if (allResponded && challenge.participants.filter((item) => item.accepted).length <= 1) challenge.status = "completed";
  else if (allResponded && challenge.participants.filter((item) => item.accepted).length > 1 && today >= challenge.startsOn) challenge.status = "active";
  else challenge.status = "inviting";
  if (challenge.status === "completed" && previousStatus !== "completed") {
    for (const participant of challenge.participants.filter((item) => item.accepted)) {
      const won = challengeOutcome(challenge, participant.userId);
      notify(store, {
        userId: participant.userId,
        type: "challengeUpdate",
        entityType: "challenge",
        entityId: challenge.id,
        title: won ? "Challenge won" : "Challenge complete",
        body: won ? `You won ${challenge.title}.` : `${challenge.title} has finished. See the final standings.`,
        deduplicationKey: `challenge-result:${challenge.id}:${participant.userId}`
      });
    }
    if (challenge.sharedConversationId && !store.messages.some((item) => item.id === `message_challenge_result_${challenge.id}`)) {
      store.messages.push(systemMessage(
        `message_challenge_result_${challenge.id}`,
        challenge.sharedConversationId,
        `${challenge.title} is complete. ${winnerText(challenge, store)}.`,
        new Date().toISOString()
      ));
    }
  }
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

export function addDailyGroupChallengeUpdates(store: AppStore, now = new Date()): ID[] {
  const updateDate = new Date(now);
  updateDate.setUTCDate(updateDate.getUTCDate() - 1);
  const localDate = updateDate.toISOString().slice(0, 10);
  const changed: ID[] = [];

  for (const challenge of store.challenges) {
    if (!challenge.sharedConversationId || localDate < challenge.startsOn || localDate > challenge.endsOn) continue;
    const messageId = `message_challenge_daily_${challenge.id}_${localDate}`;
    if (store.messages.some((message) => message.id === messageId)) continue;
    refreshChallenge(store, challenge);
    const ranking = challenge.participants
      .filter((participant) => participant.accepted)
      .sort((left, right) => right.score - left.score)
      .map((participant, index) => {
        const name = store.users.find((user) => user.id === participant.userId)?.displayName ?? "Member";
        return `${index + 1}. ${name}: ${Math.round(participant.score).toLocaleString("en-US")}`;
      })
      .join(" | ");
    const accepted = challenge.participants.filter((participant) => participant.accepted);
    const squadScore = accepted.reduce((sum, participant) => sum + participant.score, 0);
    const targetText = challenge.target
      ? `${Math.round(squadScore).toLocaleString("en-US")} of ${Math.round(challenge.target).toLocaleString("en-US")}`
      : Math.round(squadScore).toLocaleString("en-US");
    const body = challenge.mode === "cooperative"
      ? `${challenge.title} squad progress for ${localDate}: ${targetText}. Contributions: ${ranking || "No activity recorded yet."}`
      : `${challenge.title} progress for ${localDate}: ${ranking || "No activity recorded yet."}`;
    store.messages.push(systemMessage(messageId, challenge.sharedConversationId, body, now.toISOString()));
    for (const participant of challenge.participants.filter((item) => item.accepted)) notify(store, { userId: participant.userId, type: "challengeUpdate", entityType: "challenge", entityId: challenge.id, title: "Challenge progress", body, deduplicationKey: `challenge-daily:${challenge.id}:${localDate}:${participant.userId}` });
    changed.push(challenge.id);
  }
  return changed;
}

export function generateScheduledNotifications(store: AppStore) {
  for (const user of store.users) {
    const today = currentDateForUser(store, user.id);
    const weekStartsOn = startOfWeek(today);
    if (today === weekStartsOn) notify(store, { userId: user.id, type: "recap", entityType: "recap", entityId: `recap_${user.id}_${addLocalDays(weekStartsOn, -7)}`, title: "Your weekly recap is ready", body: "See your totals, goals, streak, and best day from last week.", deduplicationKey: `weekly-recap:${user.id}:${weekStartsOn}` });
  }
}

function goalStreakSnapshot(store: AppStore, userId: ID) {
  return new Map(store.goalStreaks.filter((item) => item.userId === userId).map((item) => [item.goalId, { current: item.currentCount, best: item.bestCount }]));
}

function emitGoalStreakMilestones(store: AppStore, userId: ID, previous: Map<ID, { current: number; best: number }>) {
  const settings = store.settings.find((item) => item.userId === userId);
  if (settings?.pushMilestones === false) return;
  for (const streak of store.goalStreaks.filter((item) => item.userId === userId)) {
    const before = previous.get(streak.goalId) ?? { current: 0, best: 0 };
    if (streak.currentCount <= before.current || !isNotableStreak(streak.currentCount)) continue;
    const goal = store.goals.find((item) => item.id === streak.goalId);
    if (!goal) continue;
    const unit = goal.cadence === "weekly" ? "week" : "day";
    const label = activityKindLabel(goal.kind);
    const personalBest = streak.currentCount > before.best;
    const body = `${streak.currentCount}-${unit} ${label} streak${personalBest ? ", a new personal best" : ""}`;
    notify(store, {
      userId,
      type: "streak",
      entityType: "goal",
      entityId: goal.id,
      title: `${label} streak`,
      body: `You reached a ${body}.`,
      metadata: { goalId: goal.id, goalKind: goal.kind, cadence: goal.cadence, streakCount: streak.currentCount },
      deduplicationKey: `goal-streak:${goal.id}:${streak.currentCount}`
    });
    const feedId = `feed_streak_${goal.id}_${streak.currentCount}`;
    if (!store.feed.some((item) => item.id === feedId)) {
      store.feed.push(feedItem(
        feedId, userId, "streak", `${activityKindLabel(goal.kind)} streak milestone`,
        `Reached a ${body}.`, new Date().toISOString(), "goal", goal.id,
        { streakCount: String(streak.currentCount), cadence: goal.cadence, goalKind: goal.kind }
      ));
    }
  }
}

function isNotableStreak(value: number) {
  return [7, 14, 30, 50, 100, 150, 200, 250, 365].includes(value) || (value > 365 && value % 100 === 0);
}

function activityKindLabel(kind: ActivityKind) {
  switch (kind) {
    case "activeMinutes": return "Active Minutes";
    case "strengthTraining": return "Strength Training";
    default: return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

type ChallengeOutcomeKind = "win" | "loss" | "draw" | "teamWin" | "teamLoss" | "teamDraw" | "targetSuccess" | "targetMiss" | "cooperativeSuccess" | "cooperativeFailure";

function challengeOutcomeKind(challenge: Challenge, userId: ID): ChallengeOutcomeKind {
  const accepted = challenge.participants.filter((item) => item.accepted);
  const participant = accepted.find((item) => item.userId === userId);
  if (!participant) return "loss";
  if (challenge.mode === "cooperative") {
    return challenge.target && accepted.reduce((sum, item) => sum + item.score, 0) >= challenge.target
      ? "cooperativeSuccess"
      : "cooperativeFailure";
  }
  if (challenge.mode === "team") {
    const teamTotals = new Map<string, number>();
    for (const item of accepted) teamTotals.set(item.teamId ?? "", (teamTotals.get(item.teamId ?? "") ?? 0) + item.score);
    const best = Math.max(0, ...teamTotals.values());
    const participantScore = teamTotals.get(participant.teamId ?? "") ?? 0;
    const leaders = [...teamTotals.values()].filter((score) => score === best).length;
    if (participantScore !== best || best <= 0) return "teamLoss";
    return leaders > 1 ? "teamDraw" : "teamWin";
  }
  if (challenge.mode === "target") return challenge.target && participant.score >= challenge.target ? "targetSuccess" : "targetMiss";
  const best = Math.max(0, ...accepted.map((item) => item.score));
  if (participant.score !== best || best <= 0) return "loss";
  return accepted.filter((item) => item.score === best).length > 1 ? "draw" : "win";
}

function challengeOutcome(challenge: Challenge, userId: ID): boolean {
  return ["win", "teamWin", "targetSuccess", "cooperativeSuccess"].includes(challengeOutcomeKind(challenge, userId));
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

function feedItem(
  id: ID, userId: ID, type: FeedItem["type"], title: string, body: string, createdAt: string,
  entityType?: FeedItem["entityType"], entityId?: ID, metadata?: Record<string, string>
): FeedItem {
  return { id, userId, type, title, body, entityType, entityId, metadata, createdAt, reactions: [] };
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
  if (challenge.mode === "cooperative") {
    const total = challenge.participants.filter((item) => item.accepted).reduce((sum, item) => sum + item.score, 0);
    const outcome = challenge.target && total >= challenge.target ? "reached the goal" : "finished";
    return `the squad ${outcome} with ${Math.round(total).toLocaleString()} points`;
  }
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

function badgeMetric(store: AppStore, userId: ID, ruleKind: Badge["ruleKind"]): number {
  const summaries = store.summaries.filter((item) => item.userId === userId);
  const workouts = store.workouts.filter((item) => item.userId === userId);
  const walking = workouts.filter((item) => item.activityType === "walking");
  const running = workouts.filter((item) => item.activityType === "running");
  const strength = workouts.filter((item) => item.activityType === "strengthTraining");
  const challenges = store.challenges.filter((item) => item.participants.some((participant) => participant.userId === userId && participant.accepted));
  const dailyStepGoal = store.goals.find((goal) => goal.userId === userId && goal.kind === "steps" && goal.cadence === "daily" && goal.isEnabled)?.target ?? 10_000;
  const weekGroups = <T extends { date: string }>(rows: T[]) => {
    const groups = new Map<string, T[]>();
    for (const item of rows) groups.set(startOfWeek(item.date), [...(groups.get(startOfWeek(item.date)) ?? []), item]);
    return Array.from(groups.values());
  };
  const activeDates = new Set([...summaries.filter((item) => item.steps > 0 || item.activeMinutes > 0).map((item) => item.localDate), ...workouts.map((item) => item.startedAt.slice(0, 10))]);
  const workoutRows = workouts.map((item) => ({ ...item, date: item.startedAt.slice(0, 10) }));
  const summaryWeeks = weekGroups(summaries.map((item) => ({ ...item, date: item.localDate })));
  const workoutWeeks = weekGroups(workoutRows);

  switch (ruleKind) {
    case "streak": return store.streaks.find((item) => item.userId === userId)?.bestDays ?? 0;
    case "challengeWins": return profileStats(store, userId).challengeWins;
    case "lifetimeSteps": return summaries.reduce((sum, item) => sum + item.steps, 0);
    case "goalHits": return summaries.filter((summary) => store.goals.some((goal) => goal.userId === userId && goal.isEnabled && goal.cadence === "daily" && valueForBadgeKind(summary, goal.kind) >= goal.target)).length;
    case "maxDailySteps": return Math.max(0, ...summaries.map((item) => item.steps));
    case "overGoalPercent": return Math.max(0, ...summaries.map((item) => item.steps / dailyStepGoal));
    case "walkingWorkouts": return walking.length;
    case "maxWalkDistance": return Math.max(0, ...walking.map((item) => item.distanceMeters));
    case "walkingActiveDaysWeek": return Math.max(0, ...workoutWeeks.map((week) => new Set(week.filter((item) => item.activityType === "walking").map((item) => item.date)).size));
    case "lifetimeWalkingDistance": return walking.reduce((sum, item) => sum + item.distanceMeters, 0);
    case "runningWorkouts": return running.length;
    case "maxRunDistance": return Math.max(0, ...running.map((item) => item.distanceMeters));
    case "fastest5K": {
      const values = running.filter((item) => item.distanceMeters >= 5_000 && item.durationSeconds > 0).map((item) => item.durationSeconds * 5_000 / item.distanceMeters);
      return values.length > 0 ? Math.min(...values) : 0;
    }
    case "runningWorkoutsWeek": return Math.max(0, ...workoutWeeks.map((week) => week.filter((item) => item.activityType === "running").length));
    case "lifetimeRunningDistance": return running.reduce((sum, item) => sum + item.distanceMeters, 0);
    case "strengthWorkouts": return strength.length;
    case "maxStrengthDuration": return Math.max(0, ...strength.map((item) => item.durationSeconds));
    case "strengthWorkoutsWeek": return Math.max(0, ...workoutWeeks.map((week) => week.filter((item) => item.activityType === "strengthTraining").length));
    case "activityTypesWeek": return Math.max(0, ...workoutWeeks.map((week) => new Set(week.map((item) => item.activityType)).size));
    case "activeDaysWeek": return Math.max(0, ...weekGroups(Array.from(activeDates).map((date) => ({ date }))).map((week) => week.length));
    case "earlyActivities": return workouts.filter((item) => new Date(item.startedAt).getHours() < 7).length;
    case "nightActivities": return workouts.filter((item) => new Date(item.startedAt).getHours() >= 20).length;
    case "weekendActivities": return workouts.filter((item) => [0, 6].includes(new Date(item.startedAt).getDay())).length;
    case "challengesJoined": return challenges.length;
    case "challengesCompleted": return challenges.filter((item) => item.status === "completed").length;
    case "rematches": return challenges.filter((item) => item.rematchOfChallengeId).length;
    case "groupChallengesCompleted": return challenges.filter((item) => item.status === "completed" && item.participants.length > 2).length;
    case "improvedWeeks": {
      const totals = summaryWeeks.map((week) => ({ week: startOfWeek(week[0]?.date ?? ""), steps: week.reduce((sum, item) => sum + item.steps, 0) })).sort((a, b) => a.week.localeCompare(b.week));
      return totals.slice(1).filter((item, index) => item.steps > totals[index].steps).length;
    }
  }
}

function valueForBadgeKind(summary: ActivitySummary, kind: ActivityKind): number {
  switch (kind) {
    case "steps": return summary.steps;
    case "distance": return summary.walkingDistanceMeters + summary.runningDistanceMeters;
    case "walking": return summary.walkingDistanceMeters;
    case "running": return summary.runningDistanceMeters;
    case "strengthTraining": return summary.workoutCount;
    case "activeMinutes": return summary.activeMinutes;
    case "calories": return summary.calories;
  }
}

export function defaultBadges(): Badge[] {
  return [
    badge("steps_1k", "First Steps", "👟", "maxDailySteps", 1_000, "Steps", "Record 1,000 steps in one day."),
    badge("goal_once", "Goal Getter", "🎯", "goalHits", 1, "Steps", "Reach a personal goal."),
    badge("goal_7", "On Target", "✅", "goalHits", 7, "Steps", "Reach personal goals seven times."),
    badge("overachiever", "Overachiever", "🚀", "overGoalPercent", 1.5, "Steps", "Reach 150% of your daily step goal."),
    badge("steps_20k", "Big Day", "⚡", "maxDailySteps", 20_000, "Steps", "Record 20,000 steps in one day."),
    badge("steps_30k", "Step Giant", "🦶", "maxDailySteps", 30_000, "Steps", "Record 30,000 steps in one day."),
    badge("steps_100k", "100K Club", "💯", "lifetimeSteps", 100_000, "Steps", "Record 100,000 lifetime steps."),
    badge("steps_1m", "Million Steps", "🌟", "lifetimeSteps", 1_000_000, "Steps", "Record one million lifetime steps."),
    badge("steps_5m", "Five Million Strong", "💎", "lifetimeSteps", 5_000_000, "Steps", "Record five million lifetime steps."),

    badge("streak_3", "Getting Started", "🔥", "streak", 3, "Streaks", "Maintain a three-day streak."),
    badge("streak_7", "7-Day Fire", "🔥", "streak", 7, "Streaks", "Maintain a seven-day streak."),
    badge("streak_14", "Fortnight Focus", "🗓️", "streak", 14, "Streaks", "Maintain a 14-day streak."),
    badge("streak_30", "Monthly Momentum", "🌙", "streak", 30, "Streaks", "Maintain a 30-day streak."),
    badge("streak_100", "Unstoppable", "⚡", "streak", 100, "Streaks", "Maintain a 100-day streak."),
    badge("streak_365", "Year of Motion", "🏅", "streak", 365, "Streaks", "Maintain a 365-day streak."),

    badge("walk_1", "First Walk", "🚶", "walkingWorkouts", 1, "Walking", "Sync your first walking workout."),
    badge("walk_5k", "5K Walker", "🥾", "maxWalkDistance", 5_000, "Walking", "Complete a 5 km walk."),
    badge("walk_10k", "Long Walk", "🌳", "maxWalkDistance", 10_000, "Walking", "Complete a 10 km walk."),
    badge("walk_week", "Walking Week", "📅", "walkingActiveDaysWeek", 5, "Walking", "Walk on five days in one week."),
    badge("walk_100k", "Century Walker", "🧭", "lifetimeWalkingDistance", 100_000, "Walking", "Accumulate 100 km of walking."),
    badge("walk_500k", "Walking the Distance", "🌍", "lifetimeWalkingDistance", 500_000, "Walking", "Accumulate 500 km of walking."),

    badge("run_1", "First Run", "🏃", "runningWorkouts", 1, "Running", "Sync your first running workout."),
    badge("run_5k", "First 5K", "5️⃣", "maxRunDistance", 5_000, "Running", "Complete a 5 km run."),
    badge("run_10k", "First 10K", "🔟", "maxRunDistance", 10_000, "Running", "Complete a 10 km run."),
    badge("run_half", "Half Marathoner", "🏁", "maxRunDistance", 21_097.5, "Running", "Complete a half marathon."),
    badge("run_5k_30", "Five Under Thirty", "⏱️", "fastest5K", 1_800, "Running", "Complete 5 km in under 30 minutes."),
    badge("run_week_3", "Consistent Runner", "📈", "runningWorkoutsWeek", 3, "Running", "Run three times in one week."),
    badge("run_100k", "100K Runner", "🛣️", "lifetimeRunningDistance", 100_000, "Running", "Accumulate 100 km of running."),
    badge("run_500k", "Road Warrior", "🏎️", "lifetimeRunningDistance", 500_000, "Running", "Accumulate 500 km of running."),

    badge("strength_1", "First Lift", "🏋️", "strengthWorkouts", 1, "Strength", "Complete your first strength workout."),
    badge("strength_3", "Strong Start", "💪", "strengthWorkouts", 3, "Strength", "Complete three strength sessions."),
    badge("strength_week", "Strength Week", "🗓️", "strengthWorkoutsWeek", 3, "Strength", "Complete three strength sessions in one week."),
    badge("strength_30", "Half-Hour Power", "⚙️", "maxStrengthDuration", 1_800, "Strength", "Complete a 30-minute strength session."),
    badge("strength_60", "Iron Hour", "🔩", "maxStrengthDuration", 3_600, "Strength", "Complete a 60-minute strength session."),
    badge("strength_25", "Strength Habit", "🦾", "strengthWorkouts", 25, "Strength", "Complete 25 strength sessions."),
    badge("strength_100", "Century Strong", "🏆", "strengthWorkouts", 100, "Strength", "Complete 100 strength sessions."),

    badge("triple_threat", "Triple Threat", "🔺", "activityTypesWeek", 3, "Activity", "Walk, run, and strength-train in one week."),
    badge("active_week", "Active Week", "⚡", "activeDaysWeek", 5, "Activity", "Record activity on five days in one week."),
    badge("perfect_week", "Perfect Week", "✨", "activeDaysWeek", 7, "Activity", "Record activity every day of a week."),
    badge("early_bird", "Early Bird", "🌅", "earlyActivities", 1, "Activity", "Complete an activity before 7 AM."),
    badge("night_mover", "Night Mover", "🌙", "nightActivities", 1, "Activity", "Complete an activity after 8 PM."),
    badge("weekend_warrior", "Weekend Warrior", "🎉", "weekendActivities", 3, "Activity", "Complete three weekend activities."),

    badge("challenge_join", "Challenge Accepted", "🤝", "challengesJoined", 1, "Challenges", "Join your first challenge."),
    badge("challenge_finish", "Finisher", "🏁", "challengesCompleted", 1, "Challenges", "Complete your first challenge."),
    badge("first_win", "First Victory", "🏆", "challengeWins", 1, "Challenges", "Win your first challenge."),
    badge("wins_3", "Hat Trick", "🎩", "challengeWins", 3, "Challenges", "Win three challenges."),
    badge("wins_5", "Five-Time Champion", "👑", "challengeWins", 5, "Challenges", "Win five challenges."),
    badge("challenge_25", "Challenge Veteran", "🎖️", "challengesCompleted", 25, "Challenges", "Complete 25 challenges."),
    badge("rematch", "Rematch Ready", "🔁", "rematches", 1, "Challenges", "Join a challenge rematch."),
    badge("squad", "Squad Goals", "👥", "groupChallengesCompleted", 1, "Challenges", "Complete a group challenge."),

    badge("better_week", "Better Than Last Week", "📈", "improvedWeeks", 1, "Milestones", "Improve your weekly steps over the previous week."),
    badge("goals_3", "Goal Collector", "🎯", "goalHits", 3, "Milestones", "Complete three personal goals.")
  ];
}

function badge(id: string, title: string, emoji: string, ruleKind: Badge["ruleKind"], threshold: number, category: string, description: string): Badge {
  return { id: `badge_${id}`, title, emoji, ruleKind, threshold, category, description, difficulty: badgeDifficulty(id) };
}

function badgeDifficulty(id: string): NonNullable<Badge["difficulty"]> {
  if (["steps_5m", "streak_365", "run_half", "strength_100", "challenge_25"].includes(id)) return "legendary";
  if (["steps_1m", "streak_100", "walk_500k", "run_500k", "wins_5", "strength_25"].includes(id)) return "elite";
  if (["steps_30k", "streak_30", "walk_100k", "run_10k", "run_5k_30", "strength_60", "wins_3", "perfect_week"].includes(id)) return "gold";
  if (["steps_20k", "streak_14", "walk_10k", "run_5k", "strength_week", "first_win"].includes(id)) return "silver";
  return "bronze";
}
