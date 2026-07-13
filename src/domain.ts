export type ID = string;

export type ActivityKind = "steps" | "distance" | "walking" | "running" | "strengthTraining" | "activeMinutes" | "calories";
export type GoalCadence = "daily" | "weekly";
export type ChallengeStatus = "inviting" | "active" | "completed";
export type ChallengeTemplate =
  | "weekly_steps"
  | "weekly_distance"
  | "weekly_running"
  | "weekly_walking"
  | "weekend_steps"
  | "group_distance";
export type FriendshipStatus = "pending" | "accepted" | "declined" | "blocked";
export type ReactionKind = "cheer" | "fire" | "strong" | "comeback" | "win" | "laugh" | "heart";
export type FeedItemType = "activity" | "goal" | "streak" | "challenge" | "recap" | "badge" | "rank";
export type ConversationKind = "direct" | "group";
export type MessageKind = "user" | "system";
export type LeaderboardPeriod = "today" | "week" | "month" | "all";
export type BadgeRuleKind = "streak" | "challengeWins" | "lifetimeSteps" | "goalHits" | "reactionGiven";

export interface User {
  id: ID;
  username: string;
  displayName: string;
  email?: string;
  phone?: string;
  avatarColor?: string;
  avatarURL?: string;
  joinedAt: string;
  searchable: boolean;
}

export interface PublicUserProfile {
  id: ID;
  username: string;
  displayName: string;
  avatarColor?: string;
  avatarURL?: string;
  joinedAt: string;
  friendshipStatus?: FriendshipStatus;
}

export interface UserSettings {
  userId: ID;
  hideActivityFromFriends: boolean;
  hideExactNumbers: boolean;
  searchable: boolean;
  pushMessages: boolean;
  pushFriendRequests: boolean;
  pushChallenges: boolean;
  pushMilestones: boolean;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: User;
  needsUsername: boolean;
}

export interface Friendship {
  id: ID;
  requesterId: ID;
  addresseeId: ID;
  status: FriendshipStatus;
  createdAt: string;
  respondedAt?: string;
}

export interface ActivitySummary {
  id: ID;
  userId: ID;
  localDate: string;
  timezone: string;
  steps: number;
  walkingDistanceMeters: number;
  runningDistanceMeters: number;
  workoutCount: number;
  activeMinutes: number;
  calories: number;
  source: "healthkit";
  trustLevel: "verified" | "review";
  updatedAt: string;
}

export type WorkoutActivityType = "walking" | "running" | "strengthTraining";

export interface WorkoutSummary {
  id: ID;
  userId: ID;
  healthkitUUID: string;
  activityType: WorkoutActivityType;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  distanceMeters: number;
  calories: number;
  source: "healthkit";
  trustLevel: "verified" | "review";
  updatedAt: string;
}

export interface Goal {
  id: ID;
  userId: ID;
  kind: ActivityKind;
  cadence: GoalCadence;
  target: number;
  createdAt: string;
}

export interface Streak {
  userId: ID;
  currentDays: number;
  bestDays: number;
  updatedAt: string;
}

export interface ChallengeParticipant {
  userId: ID;
  accepted: boolean;
  score: number;
  respondedAt?: string;
}

export interface Challenge {
  id: ID;
  creatorId: ID;
  title: string;
  kind: ActivityKind;
  template: ChallengeTemplate;
  startsOn: string;
  endsOn: string;
  status: ChallengeStatus;
  mode?: "target" | "competitive";
  target?: number;
  participants: ChallengeParticipant[];
  rematchOfChallengeId?: ID;
  sharedConversationId?: ID;
  createdAt: string;
}

export interface FeedItem {
  id: ID;
  userId: ID;
  type: FeedItemType;
  title: string;
  body: string;
  createdAt: string;
  reactions: Reaction[];
}

export interface Reaction {
  id: ID;
  targetType: "feed" | "message";
  targetId: ID;
  userId: ID;
  kind: ReactionKind;
  createdAt: string;
}

export interface Conversation {
  id: ID;
  kind: ConversationKind;
  title?: string;
  createdBy: ID;
  createdAt: string;
  mutedBy: ID[];
}

export interface ConversationMember {
  conversationId: ID;
  userId: ID;
  joinedAt: string;
  lastReadAt?: string;
  role: "owner" | "member";
}

export interface Message {
  id: ID;
  conversationId: ID;
  senderId?: ID;
  kind: MessageKind;
  body: string;
  createdAt: string;
  readBy: ID[];
  reactions: Reaction[];
}

export interface WeeklyRecap {
  id: ID;
  userId: ID;
  weekStartsOn: string;
  totalSteps: number;
  totalDistanceMeters: number;
  bestDay: string;
  goalsHit: number;
  streakDays: number;
  leaderboardRank: number;
  challengeWins: number;
  trendPercent: number;
  dayBars: Array<{ localDate: string; steps: number }>;
}

export interface Badge {
  id: ID;
  title: string;
  emoji: string;
  ruleKind: BadgeRuleKind;
  threshold: number;
}

export interface UserBadge {
  id: ID;
  userId: ID;
  badgeId: ID;
  earnedAt: string;
}

export interface ProfileStats {
  userId: ID;
  lifetimeSteps: number;
  challengeWins: number;
  bestStreak: number;
  goalsHit: number;
}

export interface LeaderboardRow {
  userId: ID;
  score: number;
  rank: number;
  steps: number;
  totalDistanceMeters: number;
  walkingDistanceMeters: number;
  runningDistanceMeters: number;
  activeMinutes: number;
  calories: number;
  streakDays: number;
  goalsHit: number;
}

export interface ActivityComparison {
  period: LeaderboardPeriod;
  rows: LeaderboardRow[];
}

export function calculateGoalProgress(goal: Goal, summaries: ActivitySummary[]): number {
  const total = summaries.reduce((sum, summary) => sum + valueForKind(summary, goal.kind), 0);
  return Math.min(total / goal.target, 1);
}

export function countGoalsHit(goals: Goal[], summaries: ActivitySummary[]): number {
  return goals.filter((goal) => calculateGoalProgress(goal, summaries) >= 1).length;
}

export function calculateStreak(goal: Goal, summaries: ActivitySummary[]): number {
  const ordered = [...summaries].sort((a, b) => b.localDate.localeCompare(a.localDate));
  let streak = 0;

  for (const summary of ordered) {
    if (valueForKind(summary, goal.kind) >= goal.target) {
      streak += 1;
      continue;
    }
    break;
  }

  return streak;
}

export function scoreChallenge(kind: ActivityKind, summaries: ActivitySummary[]): number {
  return summaries.reduce((sum, summary) => sum + valueForKind(summary, kind), 0);
}

export function rankUsers(scores: Array<{ userId: ID; score: number }>): Array<{ userId: ID; score: number; rank: number }> {
  return [...scores]
    .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId))
    .map((score, index) => ({ ...score, rank: index + 1 }));
}

export function leaderboardRows(input: {
  userIds: ID[];
  summaries: ActivitySummary[];
  goals: Goal[];
  streaks: Streak[];
  period: LeaderboardPeriod;
  now?: string;
}): LeaderboardRow[] {
  const filtered = filterSummariesForPeriod(input.summaries, input.period, input.now);
  const ranked = rankUsers(
    input.userIds.map((userId) => ({
      userId,
      score: filtered.filter((summary) => summary.userId === userId).reduce((sum, summary) => sum + summary.steps, 0)
    }))
  );

  return ranked.map(({ userId, score, rank }) => {
    const userSummaries = filtered.filter((summary) => summary.userId === userId);
    return {
      userId,
      score,
      rank,
      steps: score,
      totalDistanceMeters: userSummaries.reduce((sum, summary) => sum + summary.walkingDistanceMeters + summary.runningDistanceMeters, 0),
      walkingDistanceMeters: userSummaries.reduce((sum, summary) => sum + summary.walkingDistanceMeters, 0),
      runningDistanceMeters: userSummaries.reduce((sum, summary) => sum + summary.runningDistanceMeters, 0),
      activeMinutes: userSummaries.reduce((sum, summary) => sum + summary.activeMinutes, 0),
      calories: userSummaries.reduce((sum, summary) => sum + summary.calories, 0),
      streakDays: input.streaks.find((streak) => streak.userId === userId)?.currentDays ?? 0,
      goalsHit: countGoalsHit(input.goals.filter((goal) => goal.userId === userId), userSummaries)
    };
  });
}

export function generateWeeklyRecap(input: {
  userId: ID;
  weekStartsOn: string;
  summaries: ActivitySummary[];
  previousSummaries?: ActivitySummary[];
  goalsHit: number;
  streakDays: number;
  leaderboardRank: number;
  challengeWins: number;
}): WeeklyRecap {
  const best = [...input.summaries].sort((a, b) => b.steps - a.steps)[0];
  const totalSteps = input.summaries.reduce((sum, summary) => sum + summary.steps, 0);
  const previousSteps = input.previousSummaries?.reduce((sum, summary) => sum + summary.steps, 0) ?? 0;
  const totalDistanceMeters = input.summaries.reduce(
    (sum, summary) => sum + summary.walkingDistanceMeters + summary.runningDistanceMeters,
    0
  );

  return {
    id: `recap_${input.userId}_${input.weekStartsOn}`,
    userId: input.userId,
    weekStartsOn: input.weekStartsOn,
    totalSteps,
    totalDistanceMeters,
    bestDay: best?.localDate ?? input.weekStartsOn,
    goalsHit: input.goalsHit,
    streakDays: input.streakDays,
    leaderboardRank: input.leaderboardRank,
    challengeWins: input.challengeWins,
    trendPercent: previousSteps === 0 ? 100 : Math.round(((totalSteps - previousSteps) / previousSteps) * 100),
    dayBars: input.summaries.map((summary) => ({ localDate: summary.localDate, steps: summary.steps }))
  };
}

export function earnedBadges(input: {
  userId: ID;
  badges: Badge[];
  stats: ProfileStats;
  streak: Streak;
  existing: UserBadge[];
}): UserBadge[] {
  const now = new Date().toISOString();
  const already = new Set(input.existing.filter((badge) => badge.userId === input.userId).map((badge) => badge.badgeId));
  const earned: UserBadge[] = [];

  for (const badge of input.badges) {
    if (already.has(badge.id)) continue;
    const value =
      badge.ruleKind === "streak"
        ? input.streak.bestDays
        : badge.ruleKind === "challengeWins"
          ? input.stats.challengeWins
          : badge.ruleKind === "lifetimeSteps"
            ? input.stats.lifetimeSteps
            : input.stats.goalsHit;
    if (value >= badge.threshold) {
      earned.push({ id: `user_badge_${input.userId}_${badge.id}`, userId: input.userId, badgeId: badge.id, earnedAt: now });
    }
  }

  return earned;
}

export function detectTrustLevel(summary: Omit<ActivitySummary, "id" | "source" | "trustLevel" | "updatedAt">): "verified" | "review" {
  return summary.steps > 60000 || summary.runningDistanceMeters > 50000 ? "review" : "verified";
}

export function filterSummariesForPeriod(
  summaries: ActivitySummary[],
  period: LeaderboardPeriod,
  now = localDateForTimeZone("UTC")
): ActivitySummary[] {
  if (period === "all") return summaries;
  const current = new Date(`${now}T12:00:00Z`);
  const start =
    period === "today"
      ? new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()))
      : period === "week"
        ? new Date(`${startOfWeek(now)}T12:00:00Z`)
        : new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));

  const startKey = start.toISOString().slice(0, 10);
  const endKey = current.toISOString().slice(0, 10);
  return summaries.filter((summary) => summary.localDate >= startKey && summary.localDate <= endKey);
}

export function localDateForTimeZone(timeZone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function startOfWeek(localDate: string): string {
  const date = new Date(`${localDate}T12:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

export function addLocalDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function valueForKind(summary: ActivitySummary, kind: ActivityKind): number {
  switch (kind) {
    case "steps":
      return summary.steps;
    case "distance":
      return summary.walkingDistanceMeters + summary.runningDistanceMeters;
    case "walking":
      return summary.walkingDistanceMeters;
    case "running":
      return summary.runningDistanceMeters;
    case "activeMinutes":
      return summary.activeMinutes;
    case "calories":
      return summary.calories;
    case "strengthTraining":
      return 0;
  }
}
