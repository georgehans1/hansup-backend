export type ID = string;

export type ActivityKind = "steps" | "distance" | "walking" | "running" | "strengthTraining" | "activeMinutes" | "calories";
export type GoalCadence = "daily" | "weekly";
export type PerformanceGoalStatus = "active" | "completed" | "abandoned" | "archived";
export type TrainingSessionStatus = "scheduled" | "completed" | "partial" | "skipped" | "superseded";
export type TrainingSessionType = "easy" | "recovery" | "tempo" | "intervals" | "longRun" | "progression" | "timeTrial";
export type PerformanceEffortFeedback = "easy" | "onTarget" | "hard";
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
export type LeaderboardMetric = "steps" | "distance" | "walking" | "running" | "activeMinutes" | "calories" | "strengthSessions";
export type BadgeRuleKind =
  | "streak" | "challengeWins" | "lifetimeSteps" | "goalHits" | "maxDailySteps" | "overGoalPercent"
  | "walkingWorkouts" | "maxWalkDistance" | "walkingActiveDaysWeek" | "lifetimeWalkingDistance"
  | "runningWorkouts" | "maxRunDistance" | "fastest5K" | "runningWorkoutsWeek" | "lifetimeRunningDistance"
  | "strengthWorkouts" | "maxStrengthDuration" | "strengthWorkoutsWeek" | "activityTypesWeek" | "activeDaysWeek"
  | "earlyActivities" | "nightActivities" | "weekendActivities" | "challengesJoined" | "challengesCompleted"
  | "rematches" | "groupChallengesCompleted" | "improvedWeeks";
export type NotificationType = "friendRequest" | "friendAccepted" | "message" | "groupAdded" | "challengeInvite" | "challengeUpdate" | "reaction" | "goal" | "streak" | "rank" | "recap" | "personalBest";

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
  homeGoalId?: ID;
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
  automaticTitle?: string;
  customTitle?: string;
  note?: string;
  effortRating?: 1 | 2 | 3 | 4 | 5;
  visibility?: "friends" | "private";
}

export interface WorkoutComparison {
  first: WorkoutSummary;
  second: WorkoutSummary;
  compatible: boolean;
  durationDeltaSeconds: number;
  distanceDeltaMeters: number;
  paceDeltaSecondsPerKm?: number;
  calorieDelta: number;
  summary: string[];
}

export interface ChallengeComment {
  id: ID;
  challengeId: ID;
  userId: ID;
  body: string;
  createdAt: string;
}

export interface ProfileHighlight {
  id: ID;
  userId: ID;
  kind: "badge" | "personalRecord" | "challenge" | "workout";
  entityId: ID;
  position: number;
  createdAt: string;
}

export interface PerformanceGoalAnalysis {
  currentBestSeconds?: number;
  targetSeconds: number;
  requiredPaceSecondsPerKm: number;
  currentPaceSecondsPerKm?: number;
  timeGapSeconds?: number;
  recentWeeklyDistanceMeters: number;
  recentRuns: number;
  improvementSeconds?: number;
  splitVariationSeconds?: number;
  lateRunSlowdownSeconds?: number;
  averageHeartRateBPM?: number;
  feasibility: "insufficientData" | "onTrack" | "ambitious" | "stretch";
  qualifyingWorkoutId?: ID;
  generatedAt: string;
}

export interface PerformanceGoal {
  id: ID;
  userId: ID;
  distanceMeters: number;
  targetSeconds: number;
  targetDate: string;
  trainingDaysPerWeek: number;
  preferredLongRunDay: number;
  status: PerformanceGoalStatus;
  consentVersion: string;
  baselineSeconds?: number;
  baselineWorkoutId?: ID;
  currentBenchmarkSeconds?: number;
  currentBenchmarkWorkoutId?: ID;
  analysis: PerformanceGoalAnalysis;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingSession {
  id: ID;
  planId: ID;
  scheduledDate: string;
  type: string;
  title: string;
  purpose: string;
  distanceMeters?: number;
  durationSeconds?: number;
  targetPaceMinSecondsPerKm?: number;
  targetPaceMaxSecondsPerKm?: number;
  pacingGuidance?: string;
  effort: string;
  status: TrainingSessionStatus;
  linkedWorkoutId?: ID;
  quality?: "targetMet" | "completed" | "partial";
  matchConfidence?: number;
}

export interface TrainingPlan {
  id: ID;
  performanceGoalId: ID;
  version: number;
  model: string;
  summary: string;
  gapExplanation: string;
  recoveryGuidance: string;
  caution: string;
  generatedAt: string;
  status?: "active" | "superseded";
  sessions: TrainingSession[];
}

export interface PerformanceGoalDetail {
  goal: PerformanceGoal;
  plan?: TrainingPlan;
  milestones: PerformanceGoalMilestone[];
  trajectory?: PerformanceGoalTrajectory;
  pendingAdaptation?: PerformanceGoalAdaptation;
}

export interface PerformanceGoalTrajectory {
  originalBaselineSeconds?: number;
  currentBenchmarkSeconds?: number;
  improvementSeconds: number;
  remainingGapSeconds?: number;
  elapsedPercent: number;
  improvementPercent: number;
  expectedImprovementPercent: number;
  adherencePercent: number;
  completedSessions: number;
  totalSessions: number;
  status: "awaitingData" | "behind" | "onTrack" | "ahead" | "achieved";
}

export interface PerformanceGoalEvidence {
  id: ID;
  performanceGoalId: ID;
  workout: WorkoutSummary;
  trainingSessionId?: ID;
  kind: "benchmark" | "session" | "relevantRun";
  matchStatus: "automatic" | "confirmed" | "ambiguous" | "unmatched";
  quality?: "targetMet" | "completed" | "partial";
  matchConfidence?: number;
  impactSummary: string;
  createdAt: string;
  effortFeedback?: PerformanceEffortFeedback;
  note?: string;
}

export interface TrainingSessionAnalysis {
  id: ID;
  trainingSessionId: ID;
  workoutId: ID;
  summary: string;
  observations: string[];
  recommendation: string;
  model: string;
  generatedAt: string;
}

export interface TrainingSessionDetail {
  session: TrainingSession;
  linkedWorkout?: WorkoutSummary;
  evidence?: PerformanceGoalEvidence;
  analysis?: TrainingSessionAnalysis;
  suggestedRuns: WorkoutSummary[];
}

export interface PerformanceQualifyingRun {
  workout: WorkoutSummary;
  qualifiesBenchmark: boolean;
  reason: string;
  matchingSessionIds: ID[];
  alreadyLinked: boolean;
}

export interface PerformanceGoalAdaptation {
  id: ID;
  performanceGoalId: ID;
  reason: string;
  explanation: string;
  status: "recommended" | "pending" | "accepted" | "declined" | "expired";
  proposedPlan?: Omit<TrainingPlan, "id" | "performanceGoalId" | "version" | "model" | "generatedAt">;
  createdAt: string;
  decidedAt?: string;
}

export interface PerformanceGoalMilestone {
  id: ID;
  performanceGoalId: ID;
  sequence: number;
  targetSeconds: number;
  targetDate: string;
  status: "pending" | "completed" | "missed";
  completedWorkoutId?: ID;
}

export interface WorkoutHeartRatePoint {
  recordedAt: string;
  bpm: number;
  sampleCount: number;
}

export interface WorkoutHeartRateDetail {
  workoutId: ID;
  averageBPM: number;
  minimumBPM: number;
  maximumBPM: number;
  sampleCount: number;
  points: WorkoutHeartRatePoint[];
  updatedAt: string;
}

export type WorkoutSplitUnit = "kilometer" | "mile";

export interface WorkoutSplit {
  index: number;
  unit: WorkoutSplitUnit;
  distanceMeters: number;
  durationSeconds: number;
  paceSecondsPerKm: number;
  startedAt: string;
  endedAt: string;
  isPartial: boolean;
  averageHeartRateBPM?: number;
}

export interface WorkoutSplitsDetail {
  workoutId: ID;
  splits: WorkoutSplit[];
  updatedAt: string;
}

export interface PersonalRecordAttempt {
  workout: WorkoutSummary;
  elapsedSeconds: number;
  paceSecondsPerKm: number;
  isPersonalBest: boolean;
  isCurrentPersonalBest: boolean;
  qualification: "standalone" | "measuredSplit" | "estimated";
  splitIndex?: number;
}

export interface PersonalRecordDistance {
  key: string;
  distanceMeters: number;
  recordType: "standalone" | "split";
  totalAttempts: number;
  best?: PersonalRecordAttempt;
  latest?: PersonalRecordAttempt;
  improvementSeconds: number;
  latestGapSeconds: number;
  recentAveragePaceSecondsPerKm: number;
  attempts: PersonalRecordAttempt[];
}

export interface PersonalRecordLab {
  userId: ID;
  generatedAt: string;
  distances: PersonalRecordDistance[];
}

export interface Goal {
  id: ID;
  userId: ID;
  kind: ActivityKind;
  cadence: GoalCadence;
  target: number;
  isEnabled: boolean;
  createdAt: string;
}

export interface Streak {
  userId: ID;
  currentDays: number;
  bestDays: number;
  updatedAt: string;
}

export interface GoalStreak {
  goalId: ID;
  userId: ID;
  cadence: GoalCadence;
  currentCount: number;
  bestCount: number;
  lastCompletedPeriod?: string;
  updatedAt: string;
}

export interface GoalHistoryEntry {
  periodStart: string;
  periodEnd: string;
  value: number;
  target: number;
  completed: boolean;
  steps: number;
  distanceMeters: number;
  walkingDistanceMeters: number;
  runningDistanceMeters: number;
  activeMinutes: number;
  calories: number;
  strengthSessions: number;
  strengthMinutes: number;
}

export interface ChallengeParticipant {
  userId: ID;
  accepted: boolean;
  score: number;
  respondedAt?: string;
  teamId?: string;
  eliminatedAt?: string;
  livesRemaining?: number;
  missedDays?: string[];
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
  mode?: "target" | "competitive" | "cooperative" | "team" | "survivor";
  target?: number;
  participants: ChallengeParticipant[];
  rematchOfChallengeId?: ID;
  sharedConversationId?: ID;
  createdAt: string;
  privateNote?: string;
  survivorDailyTarget?: number;
  survivorLives?: number;
}

export interface FeedItem {
  id: ID;
  userId: ID;
  type: FeedItemType;
  title: string;
  body: string;
  entityType?: "workout" | "badge" | "goal";
  entityId?: ID;
  metadata?: Record<string, string>;
  createdAt: string;
  reactions: Reaction[];
}

export interface Reaction {
  id: ID;
  targetType: "feed" | "message" | "workout";
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

export interface MonthlyRecap {
  month: string;
  userId: ID;
  isFinal: boolean;
  totalSteps: number;
  totalDistanceMeters: number;
  walkingDistanceMeters: number;
  runningDistanceMeters: number;
  activeMinutes: number;
  calories: number;
  walkingWorkouts: number;
  runningWorkouts: number;
  strengthWorkouts: number;
  activeDays: number;
  bestDay?: { localDate: string; steps: number };
  previousMonthTrendPercent: number;
}

export interface Badge {
  id: ID;
  title: string;
  emoji: string;
  ruleKind: BadgeRuleKind;
  threshold: number;
  category?: string;
  description?: string;
  difficulty?: "bronze" | "silver" | "gold" | "elite" | "legendary";
}

export interface CircleTimelineEntry {
  id: ID;
  type: "workout" | "streakMilestone" | "badgeEarned";
  user: PublicUserProfile;
  createdAt: string;
  title: string;
  summary: string;
  workout?: WorkoutSummary;
  badge?: Badge;
  streakCount?: number;
  reactions: Reaction[];
}

export interface WorkoutInsightEvidence {
  key: string;
  label: string;
  value: string;
  splitIndex?: number;
  category: "observed" | "interpretation" | "suggestion" | "limitation";
}

export interface WorkoutInsights {
  workoutId: ID;
  userId: ID;
  activityType: "walking" | "running" | "strengthTraining";
  headline: string;
  overview: string;
  positives: string[];
  changes: string[];
  suggestion: string;
  evidence: WorkoutInsightEvidence[];
  confidence: "limited" | "moderate" | "high";
  limitations: string[];
  sourceFingerprint: string;
  engineVersion: string;
  generatedAt: string;
  updatedAt: string;
}

export interface BadgeProgress {
  badgeId: ID;
  current: number;
  target: number;
  earned: boolean;
  earnedAt?: string;
}

export interface UserBadge {
  id: ID;
  userId: ID;
  badgeId: ID;
  earnedAt: string;
}

export interface AppNotification {
  id: ID;
  userId: ID;
  type: NotificationType;
  actorId?: ID;
  entityType?: string;
  entityId?: ID;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  readAt?: string;
  archivedAt?: string;
  deduplicationKey: string;
}

export interface ProfileStats {
  userId: ID;
  lifetimeSteps: number;
  lifetimeDistanceMeters: number;
  activeDays: number;
  workoutCount: number;
  badgesEarned: number;
  challengeWins: number;
  currentStreak: number;
  bestStreak: number;
  goalsHit: number;
  friendCount: number;
}

export interface ChallengeCareerStats {
  userId: ID;
  entered: number;
  completed: number;
  wins: number;
  losses: number;
  draws: number;
  active: number;
  pendingInvites: number;
  targetSuccesses: number;
  cooperativeSuccesses: number;
  teamWins: number;
  podiumFinishes: number;
  currentWinStreak: number;
  bestWinStreak: number;
  winRate: number;
  favoriteKind?: ActivityKind;
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
  strengthSessions: number;
  streakDays: number;
  goalsHit: number;
}

export interface ActivityComparison {
  period: LeaderboardPeriod;
  metric: LeaderboardMetric;
  rows: LeaderboardRow[];
}

export function calculateGoalProgress(goal: Goal, summaries: ActivitySummary[]): number {
  const total = summaries.reduce((sum, summary) => sum + valueForKind(summary, goal.kind), 0);
  return Math.min(total / goal.target, 1);
}

export function countGoalsHit(goals: Goal[], summaries: ActivitySummary[]): number {
  return goals.filter((goal) => calculateGoalProgress(goal, summaries) >= 1).length;
}

export function calculateStreak(goal: Goal, summaries: ActivitySummary[], currentLocalDate?: string): number {
  const byDate = new Map(summaries.map((summary) => [summary.localDate, summary]));
  let expectedDate = currentLocalDate ?? [...summaries].sort((a, b) => b.localDate.localeCompare(a.localDate))[0]?.localDate;
  let streak = 0;

  if (!expectedDate) return streak;

  const current = byDate.get(expectedDate);
  if (currentLocalDate && (!current || valueForKind(current, goal.kind) < goal.target)) {
    expectedDate = offsetLocalDate(expectedDate, -1);
  }

  while (expectedDate) {
    const summary = byDate.get(expectedDate);
    if (!summary) break;
    if (valueForKind(summary, goal.kind) >= goal.target) {
      streak += 1;
      expectedDate = offsetLocalDate(expectedDate, -1);
      continue;
    }
    break;
  }

  return streak;
}

function offsetLocalDate(localDate: string, days: number): string {
  const date = new Date(`${localDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  workouts?: WorkoutSummary[];
  period: LeaderboardPeriod;
  metric?: LeaderboardMetric;
  now?: string;
}): LeaderboardRow[] {
  const filtered = filterSummariesForPeriod(input.summaries, input.period, input.now);
  const metric = input.metric ?? "steps";
  const allowedDates = new Set(filtered.map((summary) => summary.localDate));
  const allTime = input.period === "all";
  const strengthSessions = (userId: ID) => (input.workouts ?? []).filter((workout) =>
    workout.userId === userId
      && workout.activityType === "strengthTraining"
      && (allTime || allowedDates.has(workout.startedAt.slice(0, 10)))
  ).length;
  const totals = (userId: ID) => {
    const rows = filtered.filter((summary) => summary.userId === userId);
    return {
      steps: rows.reduce((sum, summary) => sum + summary.steps, 0),
      totalDistanceMeters: rows.reduce((sum, summary) => sum + summary.walkingDistanceMeters + summary.runningDistanceMeters, 0),
      walkingDistanceMeters: rows.reduce((sum, summary) => sum + summary.walkingDistanceMeters, 0),
      runningDistanceMeters: rows.reduce((sum, summary) => sum + summary.runningDistanceMeters, 0),
      activeMinutes: rows.reduce((sum, summary) => sum + summary.activeMinutes, 0),
      calories: rows.reduce((sum, summary) => sum + summary.calories, 0),
      strengthSessions: strengthSessions(userId)
    };
  };
  const scoreFor = (values: ReturnType<typeof totals>) => {
    switch (metric) {
      case "distance": return values.totalDistanceMeters;
      case "walking": return values.walkingDistanceMeters;
      case "running": return values.runningDistanceMeters;
      case "activeMinutes": return values.activeMinutes;
      case "calories": return values.calories;
      case "strengthSessions": return values.strengthSessions;
      default: return values.steps;
    }
  };
  const ranked = rankUsers(
    input.userIds.map((userId) => ({
      userId,
      score: scoreFor(totals(userId))
    }))
  );

  return ranked.map(({ userId, score, rank }) => {
    const userSummaries = filtered.filter((summary) => summary.userId === userId);
    const values = totals(userId);
    return {
      userId,
      score,
      rank,
      ...values,
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
    dayBars: Array.from(new Map(input.summaries.map((summary) => [summary.localDate, summary])).values())
      .sort((a, b) => a.localDate.localeCompare(b.localDate))
      .map((summary) => ({ localDate: summary.localDate, steps: summary.steps }))
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
