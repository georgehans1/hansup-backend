import { readFileSync } from "node:fs";
import { info } from "./logger.js";
import { AppStore, createDemoStore, createEmptyStore, defaultBadges, refreshDerivedForUser } from "./store.js";
import { heartRateDetail, InMemoryWorkoutHeartRateRepository, WorkoutHeartRateRepository } from "./heart-rate.js";
import { InMemoryWorkoutSplitRepository, normalizeWorkoutSplits, WorkoutSplitRepository } from "./splits.js";
import {
  ActivitySummary,
  AppNotification,
  Badge,
  Challenge,
  Conversation,
  ConversationMember,
  FeedItem,
  Friendship,
  Goal,
  Message,
  Reaction,
  Streak,
  User,
  UserBadge,
  UserSettings,
  WorkoutSummary
} from "./domain.js";
import type {
  PerformanceEffortFeedback,
  PerformanceGoal,
  PerformanceGoalAdaptation,
  PerformanceGoalAnalysis,
  PerformanceGoalDetail,
  PerformanceGoalEvidence,
  PerformanceGoalTrajectory,
  PerformanceQualifyingRun,
  TrainingSessionAnalysis,
  TrainingSessionDetail,
  TrainingPlan,
  TrainingSession,
  WorkoutHeartRateDetail,
  WorkoutHeartRatePoint,
  WorkoutSplit,
  WorkoutSplitsDetail
} from "./domain.js";

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
type TransactionFn = (work: (query: QueryFn) => Promise<void>) => Promise<void>;

export type PersistenceChange =
  | { kind: "auth"; userId: string }
  | { kind: "settings"; userId: string }
  | { kind: "friendship"; friendshipId: string }
  | { kind: "friendship-remove"; userId: string; friendId: string }
  | { kind: "block"; blockerId: string; blockedId: string }
  | { kind: "unblock"; blockerId: string; blockedId: string }
  | { kind: "account-delete"; userId: string }
  | { kind: "summary"; summaryId: string; userId: string }
  | { kind: "summary-batch"; summaryIds: string[]; userId: string }
  | { kind: "workouts"; workoutIds: string[] }
  | { kind: "goal"; goalId: string; userId: string }
  | { kind: "goal-delete"; goalId: string; userId: string }
  | { kind: "badges"; userId: string }
  | { kind: "derived"; userId: string }
  | { kind: "conversation"; conversationId: string }
  | { kind: "message"; messageId: string }
  | { kind: "conversation-read"; conversationId: string; userId: string }
  | { kind: "conversation-settings"; conversationId: string; userId: string }
  | { kind: "conversation-leave"; conversationId: string; userId: string }
  | { kind: "reaction"; reactionId: string }
  | { kind: "message-reactions"; messageId: string }
  | { kind: "challenge"; challengeId: string; includeSharedMessages?: boolean }
  | { kind: "device"; userId: string; token: string }
  | { kind: "report"; reportId: string }
  | { kind: "notifications" }
  | { kind: "notification-delete"; notificationId: string; userId: string };

export class PostgresRepository implements WorkoutHeartRateRepository, WorkoutSplitRepository {
  constructor(
    private readonly query: QueryFn,
    private readonly transaction: TransactionFn = async (work) => work(query)
  ) {}

  async migrate(schemaPath: string | URL = "src/schema.sql"): Promise<void> {
    const startedAt = Date.now();
    const hasUsers = await this.query("select to_regclass('public.users') as name");
    if (!hasUsers.rows[0]?.name) {
      await this.query(readFileSync(schemaPath, "utf8"));
    }
    await this.ensureRuntimeTables();
    info("database_migrations_ready", { durationMs: Date.now() - startedAt });
  }

  async loadStore(): Promise<AppStore | undefined> {
    const users = (await this.query("select * from users order by joined_at, id")).rows.map(mapUser);
    if (users.length === 0) return undefined;

    const settings = (await this.query("select * from user_settings")).rows.map(mapSettings);
    const friendships = (await this.query("select * from friendships")).rows.map(mapFriendship);
    const summaries = (await this.query("select * from activity_summaries order by local_date")).rows.map(mapSummary);
    const workouts = (await this.query("select * from workout_summaries order by started_at")).rows.map(mapWorkout);
    const goals = (await this.query("select * from goals")).rows.map(mapGoal);
    const goalVersions = (await this.query("select * from goal_versions order by effective_date")).rows.map((row) => ({ goalId: row.goal_id, userId: row.user_id, kind: row.kind, cadence: row.cadence, target: row.target, effectiveDate: dateString(row.effective_date).slice(0, 10) }));
    const goalStreaks = (await this.query("select * from goal_streaks")).rows.map((row) => ({
      goalId: row.goal_id,
      userId: row.user_id,
      cadence: row.cadence,
      currentCount: row.current_count,
      bestCount: row.best_count,
      lastCompletedPeriod: row.last_completed_period ? dateString(row.last_completed_period).slice(0, 10) : undefined,
      updatedAt: dateString(row.updated_at)
    }));
    const streaks = (await this.query("select * from streaks")).rows.map(mapStreak);
    const challenges = (await this.query("select * from challenges")).rows.map(mapChallenge);
    const participants = (await this.query("select * from challenge_participants")).rows;
    const feed = (await this.query("select * from feed_items")).rows.map(mapFeedItem);
    const conversations = (await this.query("select * from conversations")).rows.map(mapConversation);
    const members = (await this.query("select * from conversation_members")).rows.map(mapConversationMember);
    const messages = (await this.query("select * from messages order by created_at")).rows.map(mapMessage);
    const reactions = (await this.query("select * from reactions")).rows.map(mapReaction);
    const reads = (await this.query("select * from message_reads")).rows;
    const mutes = (await this.query("select * from conversation_mutes")).rows;
    const badges = (await this.query("select * from badges")).rows.map(mapBadge);
    const userBadges = (await this.query("select * from user_badges")).rows.map(mapUserBadge);
    const blockedUsers = (await this.query("select * from blocked_users")).rows.map((row) => ({
      blockerId: row.blocker_id,
      blockedId: row.blocked_id,
      createdAt: dateString(row.created_at)
    }));
    const deviceTokens = (await this.query("select * from device_tokens")).rows.map((row) => ({
      userId: row.user_id,
      token: row.token,
      platform: row.platform,
      createdAt: dateString(row.created_at)
    }));
    const reports = (await this.query("select * from reports")).rows.map((row) => ({
      id: row.id, reporterId: row.reporter_id, targetType: row.target_type, targetId: row.target_id, reason: row.reason, createdAt: dateString(row.created_at)
    }));
    const notifications = (await this.query("select * from notifications order by created_at")).rows.map(mapNotification);

    for (const challenge of challenges) {
      challenge.participants = participants.filter((row) => row.challenge_id === challenge.id).map(mapChallengeParticipant);
    }
    for (const item of feed) {
      item.reactions = reactions.filter((reaction) => reaction.targetType === "feed" && reaction.targetId === item.id);
    }
    for (const message of messages) {
      message.reactions = reactions.filter((reaction) => reaction.targetType === "message" && reaction.targetId === message.id);
      message.readBy = reads.filter((row) => row.message_id === message.id).map((row) => row.user_id);
    }
    for (const conversation of conversations) {
      conversation.mutedBy = mutes.filter((row) => row.conversation_id === conversation.id).map((row) => row.user_id);
    }

    return {
      users,
      settings,
      friendships,
      summaries,
      workouts,
      goals,
      goalVersions,
      goalStreaks,
      streaks,
      challenges,
      feed,
      conversations,
      conversationMembers: members,
      messages,
      badges,
      userBadges,
      blockedUsers,
      deviceTokens,
      reports,
      notifications
    };
  }

  async saveStore(store: AppStore): Promise<void> {
    await this.clearDomainTables();

    for (const user of store.users) await this.insertUser(user);
    for (const friendship of store.friendships) await this.insertFriendship(friendship);
    for (const summary of store.summaries) await this.insertSummary(summary);
    for (const workout of store.workouts) await this.insertWorkout(workout);
    for (const goal of store.goals) await this.insertGoal(goal);
    for (const settings of store.settings) await this.insertSettings(settings);
    for (const version of store.goalVersions) await this.insertGoalVersion(version);
    for (const streak of store.goalStreaks) await this.insertGoalStreak(streak);
    for (const streak of store.streaks) await this.insertStreak(streak);
    for (const badge of store.badges) await this.insertBadge(badge);
    for (const userBadge of store.userBadges) await this.insertUserBadge(userBadge);
    for (const challenge of store.challenges) {
      await this.insertChallenge(challenge);
      for (const participant of challenge.participants) await this.insertChallengeParticipant(challenge.id, participant);
    }
    for (const conversation of store.conversations) {
      await this.insertConversation(conversation);
      for (const userId of conversation.mutedBy) await this.query(
        "insert into conversation_mutes (conversation_id, user_id) values ($1, $2) on conflict do nothing",
        [conversation.id, userId]
      );
    }
    for (const member of store.conversationMembers) await this.insertConversationMember(member);
    for (const item of store.feed) await this.insertFeedItem(item);
    for (const message of store.messages) {
      await this.insertMessage(message);
      for (const userId of message.readBy) await this.query(
        "insert into message_reads (message_id, user_id) values ($1, $2) on conflict do nothing",
        [message.id, userId]
      );
    }
    for (const reaction of store.feed.flatMap((item) => item.reactions).concat(store.messages.flatMap((message) => message.reactions))) {
      await this.insertReaction(reaction);
    }
    for (const block of store.blockedUsers) await this.query(
      `insert into blocked_users (blocker_id, blocked_id, created_at)
       values ($1, $2, $3) on conflict (blocker_id, blocked_id) do update set created_at = excluded.created_at`,
      [block.blockerId, block.blockedId, block.createdAt]
    );
    for (const token of store.deviceTokens) await this.query(
      `insert into device_tokens (user_id, token, platform, created_at)
       values ($1, $2, $3, $4) on conflict (user_id, token) do update set created_at = excluded.created_at`,
      [token.userId, token.token, token.platform, token.createdAt]
    );
    for (const report of store.reports) await this.insertReport(report);
    for (const notification of store.notifications) await this.insertNotification(notification);
  }

  async persistChange(store: AppStore, change: PersistenceChange): Promise<void> {
    await this.transaction(async (query) => {
      const transactionalRepository = new PostgresRepository(query);
      await transactionalRepository.applyChange(store, change);
      await transactionalRepository.persistNotifications(store);
    });
  }

  private async applyChange(store: AppStore, change: PersistenceChange): Promise<void> {
    switch (change.kind) {
      case "auth": {
        await this.insertUser(required(store.users.find((item) => item.id === change.userId), "User"));
        for (const goal of store.goals.filter((item) => item.userId === change.userId)) await this.insertGoal(goal);
        const settings = store.settings.find((item) => item.userId === change.userId);
        if (settings) await this.insertSettings(settings);
        for (const version of store.goalVersions.filter((item) => item.userId === change.userId)) await this.insertGoalVersion(version);
        await this.persistDerivedActivity(store, change.userId);
        return;
      }
      case "notifications":
        return;
      case "notification-delete":
        await this.query("delete from notifications where id = $1 and user_id = $2", [change.notificationId, change.userId]);
        return;
      case "settings": {
        await this.insertSettings(required(store.settings.find((item) => item.userId === change.userId), "Settings"));
        await this.insertUser(required(store.users.find((item) => item.id === change.userId), "User"));
        return;
      }
      case "friendship":
        await this.insertFriendship(required(store.friendships.find((item) => item.id === change.friendshipId), "Friendship"));
        return;
      case "friendship-remove":
        await this.deleteFriendship(change.userId, change.friendId);
        return;
      case "block": {
        await this.deleteFriendship(change.blockerId, change.blockedId);
        const block = required(
          store.blockedUsers.find((item) => item.blockerId === change.blockerId && item.blockedId === change.blockedId),
          "Block"
        );
        await this.query(
          `insert into blocked_users (blocker_id, blocked_id, created_at)
           values ($1, $2, $3) on conflict (blocker_id, blocked_id) do update set created_at = excluded.created_at`,
          [block.blockerId, block.blockedId, block.createdAt]
        );
        return;
      }
      case "unblock":
        await this.query("delete from blocked_users where blocker_id = $1 and blocked_id = $2", [change.blockerId, change.blockedId]);
        return;
      case "account-delete":
        await this.query("delete from users where id = $1", [change.userId]);
        return;
      case "summary":
        await this.insertSummary(required(store.summaries.find((item) => item.id === change.summaryId), "Activity summary"));
        await this.persistDerivedActivity(store, change.userId);
        return;
      case "summary-batch":
        for (const summaryId of change.summaryIds) {
          await this.insertSummary(required(store.summaries.find((item) => item.id === summaryId), "Activity summary"));
        }
        await this.persistDerivedActivity(store, change.userId);
        return;
      case "workouts":
        for (const workoutId of change.workoutIds) {
          await this.insertWorkout(required(store.workouts.find((item) => item.id === workoutId), "Workout summary"));
        }
        if (change.workoutIds.length > 0) {
          const userId = store.workouts.find((item) => item.id === change.workoutIds[0])?.userId;
          if (userId) await this.persistDerivedActivity(store, userId);
        }
        return;
      case "goal":
        await this.insertGoal(required(store.goals.find((item) => item.id === change.goalId), "Goal"));
        for (const version of store.goalVersions.filter((item) => item.goalId === change.goalId)) await this.insertGoalVersion(version);
        await this.persistDerivedActivity(store, change.userId);
        return;
      case "goal-delete":
        await this.query("delete from goals where id = $1 and user_id = $2", [change.goalId, change.userId]);
        await this.persistDerivedActivity(store, change.userId);
        return;
      case "badges":
        for (const badge of store.userBadges.filter((item) => item.userId === change.userId)) {
          await this.insertUserBadge(badge);
        }
        return;
      case "derived":
        await this.persistDerivedActivity(store, change.userId);
        return;
      case "conversation": {
        await this.insertConversation(required(store.conversations.find((item) => item.id === change.conversationId), "Conversation"));
        for (const member of store.conversationMembers.filter((item) => item.conversationId === change.conversationId)) {
          await this.insertConversationMember(member);
        }
        return;
      }
      case "message":
        await this.persistMessage(required(store.messages.find((item) => item.id === change.messageId), "Message"));
        return;
      case "conversation-read":
        await this.persistConversationRead(store, change.conversationId, change.userId);
        return;
      case "conversation-settings": {
        await this.query("delete from conversation_mutes where conversation_id = $1 and user_id = $2", [change.conversationId, change.userId]);
        const conversation = store.conversations.find((item) => item.id === change.conversationId);
        if (conversation?.mutedBy.includes(change.userId)) await this.query("insert into conversation_mutes (conversation_id, user_id) values ($1, $2) on conflict do nothing", [change.conversationId, change.userId]);
        return;
      }
      case "conversation-leave":
        await this.query("delete from conversation_members where conversation_id = $1 and user_id = $2", [change.conversationId, change.userId]);
        await this.query("delete from conversation_mutes where conversation_id = $1 and user_id = $2", [change.conversationId, change.userId]);
        for (const member of store.conversationMembers.filter((item) => item.conversationId === change.conversationId)) await this.insertConversationMember(member);
        return;
      case "reaction": {
        const reactions = store.feed.flatMap((item) => item.reactions).concat(store.messages.flatMap((message) => message.reactions));
        await this.insertReaction(required(reactions.find((item) => item.id === change.reactionId), "Reaction"));
        return;
      }
      case "message-reactions": {
        const message = required(store.messages.find((item) => item.id === change.messageId), "Message");
        await this.query("delete from reactions where target_type = 'message' and target_id = $1", [change.messageId]);
        for (const reaction of message.reactions) await this.insertReaction(reaction);
        return;
      }
      case "challenge": {
        const challenge = required(store.challenges.find((item) => item.id === change.challengeId), "Challenge");
        await this.insertChallenge(challenge);
        for (const participant of challenge.participants) await this.insertChallengeParticipant(challenge.id, participant);
        if (change.includeSharedMessages && challenge.sharedConversationId) {
          for (const message of store.messages.filter((item) => item.conversationId === challenge.sharedConversationId)) {
            await this.persistMessage(message);
          }
        }
        return;
      }
      case "device": {
        const token = required(
          store.deviceTokens.find((item) => item.userId === change.userId && item.token === change.token),
          "Device token"
        );
        await this.query(
          `insert into device_tokens (user_id, token, platform, created_at)
           values ($1, $2, $3, $4) on conflict (user_id, token) do update set created_at = excluded.created_at`,
          [token.userId, token.token, token.platform, token.createdAt]
        );
        return;
      }
      case "report":
        await this.insertReport(required(store.reports.find((item) => item.id === change.reportId), "Report"));
        return;
    }
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const result = await this.query("select * from users where email = $1 limit 1", [email]);
    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async upsertUser(user: User): Promise<User> {
    await this.insertUser(user);
    const result = await this.query("select * from users where id = $1", [user.id]);
    return mapUser(result.rows[0]);
  }

  async upsertSettings(settings: UserSettings): Promise<UserSettings> {
    await this.insertSettings(settings);
    const result = await this.query("select * from user_settings where user_id = $1", [settings.userId]);
    return mapSettings(result.rows[0]);
  }

  async upsertActivitySummary(summary: ActivitySummary): Promise<ActivitySummary> {
    await this.insertSummary(summary);
    const result = await this.query("select * from activity_summaries where user_id = $1 and local_date = $2 and source = $3", [
      summary.userId,
      summary.localDate,
      summary.source
    ]);
    return mapSummary(result.rows[0]);
  }

  async getWorkoutHeartRate(workoutId: string): Promise<WorkoutHeartRateDetail | undefined> {
    const summary = await this.query("select * from workout_heart_rate_summaries where workout_id = $1", [workoutId]);
    if (!summary.rows[0]) return undefined;
    const points = await this.query("select * from workout_heart_rate_points where workout_id = $1 order by recorded_at", [workoutId]);
    return mapHeartRateDetail(summary.rows[0], points.rows);
  }

  async replaceWorkoutHeartRate(workoutId: string, rawPoints: WorkoutHeartRatePoint[]): Promise<WorkoutHeartRateDetail> {
    const detail = heartRateDetail(workoutId, rawPoints);
    await this.transaction(async (query) => {
      await query("delete from workout_heart_rate_points where workout_id = $1", [workoutId]);
      await query(
        `insert into workout_heart_rate_summaries (workout_id, average_bpm, minimum_bpm, maximum_bpm, sample_count, updated_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (workout_id) do update set average_bpm = excluded.average_bpm, minimum_bpm = excluded.minimum_bpm,
           maximum_bpm = excluded.maximum_bpm, sample_count = excluded.sample_count, updated_at = excluded.updated_at`,
        [workoutId, detail.averageBPM, detail.minimumBPM, detail.maximumBPM, detail.sampleCount, detail.updatedAt]
      );
      for (const point of detail.points) {
        await query(
          "insert into workout_heart_rate_points (workout_id, recorded_at, bpm, sample_count) values ($1, $2, $3, $4)",
          [workoutId, point.recordedAt, point.bpm, point.sampleCount]
        );
      }
    });
    return detail;
  }

  async heartRateForWorkoutIds(workoutIds: string[]): Promise<WorkoutHeartRateDetail[]> {
    if (workoutIds.length === 0) return [];
    const summaries = await this.query("select * from workout_heart_rate_summaries where workout_id = any($1::text[])", [workoutIds]);
    const points = await this.query("select * from workout_heart_rate_points where workout_id = any($1::text[]) order by recorded_at", [workoutIds]);
    return summaries.rows.map((summary) => mapHeartRateDetail(summary, points.rows.filter((point) => point.workout_id === summary.workout_id)));
  }

  async getWorkoutSplits(workoutId: string): Promise<WorkoutSplitsDetail | undefined> {
    const result = await this.query("select * from workout_splits where workout_id = $1 order by unit, split_index", [workoutId]);
    if (result.rows.length === 0) return undefined;
    return mapWorkoutSplits(workoutId, result.rows);
  }

  async replaceWorkoutSplits(workoutId: string, rawSplits: WorkoutSplit[]): Promise<WorkoutSplitsDetail> {
    const splits = normalizeWorkoutSplits(rawSplits);
    const updatedAt = new Date().toISOString();
    await this.transaction(async (query) => {
      await query("delete from workout_splits where workout_id = $1", [workoutId]);
      for (const split of splits) {
        await query(
          `insert into workout_splits (workout_id, unit, split_index, distance_meters, duration_seconds, pace_seconds_per_km, started_at, ended_at, is_partial, average_heart_rate_bpm, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [workoutId, split.unit, split.index, split.distanceMeters, split.durationSeconds, split.paceSecondsPerKm, split.startedAt, split.endedAt, split.isPartial, split.averageHeartRateBPM ?? null, updatedAt]
        );
      }
    });
    return { workoutId, splits, updatedAt };
  }

  async splitsForWorkoutIds(workoutIds: string[]): Promise<WorkoutSplitsDetail[]> {
    if (workoutIds.length === 0) return [];
    const result = await this.query("select * from workout_splits where workout_id = any($1::text[]) order by workout_id, unit, split_index", [workoutIds]);
    return [...new Set(result.rows.map((row) => row.workout_id))].map((workoutId) => mapWorkoutSplits(workoutId as string, result.rows.filter((row) => row.workout_id === workoutId)));
  }

  async seedBadges(badges: Badge[]): Promise<void> {
    for (const badge of badges) await this.insertBadge(badge);
  }

  async performanceGoalsFor(userId: string): Promise<PerformanceGoalDetail[]> {
    const rows = (await this.query("select * from performance_goals where user_id = $1 order by created_at desc", [userId])).rows;
    return Promise.all(rows.map(async (row) => this.performanceGoalDetailFromRow(row)));
  }

  async performanceGoalFor(userId: string, goalId: string): Promise<PerformanceGoalDetail | undefined> {
    const row = (await this.query("select * from performance_goals where id = $1 and user_id = $2", [goalId, userId])).rows[0];
    return row ? this.performanceGoalDetailFromRow(row) : undefined;
  }

  async createPerformanceGoal(userId: string, input: {
    distanceMeters: number; targetSeconds: number; targetDate: string;
    trainingDaysPerWeek: number; preferredLongRunDay: number; consentVersion: string; baselineWorkoutId?: string;
  }): Promise<PerformanceGoalDetail> {
    if (![1000, 2000, 3000, 4000, 5000, 10000, 21097.5].includes(input.distanceMeters)) throw new Error("Unsupported performance distance");
    if (input.targetSeconds <= 0 || input.trainingDaysPerWeek < 1 || input.trainingDaysPerWeek > 7) throw new Error("Invalid performance goal");
    if ((await this.query("select 1 from performance_goals where user_id = $1 and status = 'active'", [userId])).rows.length) throw new Error("Complete or archive your active performance goal first");
    const id = generatedId("pg");
    let analysis = await this.performanceAnalysis(userId, input.distanceMeters, input.targetSeconds);
    let baselineSeconds: number | undefined;
    if (input.baselineWorkoutId) {
      const tolerance = Math.max(75, input.distanceMeters * 0.015);
      const selected = (await this.query(
        `select * from workout_summaries where id = $1 and user_id = $2 and activity_type = 'running'
         and abs(distance_meters - $3) <= $4`,
        [input.baselineWorkoutId, userId, input.distanceMeters, tolerance]
      )).rows[0];
      if (!selected) throw new Error("Selected baseline run does not qualify for this distance");
      baselineSeconds = Math.round(Number(selected.duration_seconds));
      analysis = {
        ...analysis,
        currentBestSeconds: baselineSeconds,
        currentPaceSecondsPerKm: Math.round(baselineSeconds / (input.distanceMeters / 1000)),
        timeGapSeconds: baselineSeconds - input.targetSeconds,
        qualifyingWorkoutId: selected.id,
        feasibility: performanceFeasibility(baselineSeconds, input.targetSeconds)
      };
    }
    await this.query(
      `insert into performance_goals
       (id,user_id,distance_meters,target_seconds,target_date,training_days_per_week,preferred_long_run_day,status,consent_version,baseline_seconds,baseline_workout_id,current_benchmark_seconds,current_benchmark_workout_id,analysis)
       values ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$9,$10,$11)`,
      [id, userId, input.distanceMeters, input.targetSeconds, input.targetDate, input.trainingDaysPerWeek, input.preferredLongRunDay, input.consentVersion, baselineSeconds ?? null, input.baselineWorkoutId ?? null, JSON.stringify(analysis)]
    );
    if (baselineSeconds != null && input.baselineWorkoutId) {
      await this.query(
        `insert into performance_goal_benchmarks (id,performance_goal_id,workout_id,seconds,kind)
         values ($1,$2,$3,$4,'original'),($5,$2,$3,$4,'current') on conflict do nothing`,
        [generatedId("pgb"), id, input.baselineWorkoutId, baselineSeconds, generatedId("pgb")]
      );
    }
    const milestoneBaselineSeconds = baselineSeconds ?? Math.round(input.targetSeconds * 1.2);
    const start = new Date();
    const end = new Date(`${input.targetDate}T12:00:00Z`);
    for (let sequence = 1; sequence <= 3; sequence++) {
      const fraction = sequence / 3;
      const milestoneSeconds = Math.round(milestoneBaselineSeconds - (milestoneBaselineSeconds - input.targetSeconds) * fraction);
      const milestoneDate = new Date(start.getTime() + (end.getTime() - start.getTime()) * fraction).toISOString().slice(0, 10);
      await this.query(
        "insert into performance_goal_milestones (id,performance_goal_id,sequence,target_seconds,target_date) values ($1,$2,$3,$4,$5)",
        [generatedId("pm"), id, sequence, milestoneSeconds, milestoneDate]
      );
    }
    return (await this.performanceGoalFor(userId, id))!;
  }

  async updatePerformanceGoalStatus(userId: string, goalId: string, status: string): Promise<PerformanceGoalDetail> {
    if (!["completed", "abandoned", "archived"].includes(status)) throw new Error("Invalid performance goal status");
    const row = (await this.query(
      "update performance_goals set status = $1, updated_at = now() where id = $2 and user_id = $3 returning *",
      [status, goalId, userId]
    )).rows[0];
    if (!row) throw new Error("Performance goal not found");
    return this.performanceGoalDetailFromRow(row);
  }

  async updatePerformanceGoal(userId: string, goalId: string, patch: {
    status?: string; targetSeconds?: number; targetDate?: string; trainingDaysPerWeek?: number; preferredLongRunDay?: number;
  }): Promise<PerformanceGoalDetail> {
    if (patch.status) return this.updatePerformanceGoalStatus(userId, goalId, patch.status);
    if (patch.targetSeconds != null && patch.targetSeconds <= 0) throw new Error("Invalid target time");
    if (patch.trainingDaysPerWeek != null && (patch.trainingDaysPerWeek < 1 || patch.trainingDaysPerWeek > 7)) throw new Error("Invalid training days");
    const row = (await this.query(
      `update performance_goals set
       target_seconds=coalesce($1,target_seconds),target_date=coalesce($2,target_date),
       training_days_per_week=coalesce($3,training_days_per_week),
       preferred_long_run_day=coalesce($4,preferred_long_run_day),updated_at=now()
       where id=$5 and user_id=$6 and status='active' returning *`,
      [patch.targetSeconds ?? null, patch.targetDate ?? null, patch.trainingDaysPerWeek ?? null, patch.preferredLongRunDay ?? null, goalId, userId]
    )).rows[0];
    if (!row) throw new Error("Active performance goal not found");
    return this.refreshPerformanceGoalAnalysis(userId, goalId);
  }

  async qualifyingRunsFor(userId: string, goalId: string): Promise<PerformanceQualifyingRun[]> {
    const detail = await this.performanceGoalFor(userId, goalId);
    if (!detail) throw new Error("Performance goal not found");
    const tolerance = Math.max(75, detail.goal.distanceMeters * 0.015);
    const rows = (await this.query(
      `select w.*,
       exists(select 1 from performance_goal_evidence e where e.performance_goal_id = $2 and e.workout_id = w.id) as already_linked
       from workout_summaries w
       where w.user_id = $1 and w.activity_type = 'running'
       and w.started_at::date >= coalesce(
         (select min(s.scheduled_date) from training_sessions s join training_plans p on p.id=s.plan_id
          where p.performance_goal_id=$2 and p.status='active'),
         (select created_at::date from performance_goals where id=$2)
       )
       and abs(w.distance_meters - $3) <= $4
       order by w.started_at desc limit 60`,
      [userId, goalId, detail.goal.distanceMeters, tolerance]
    )).rows;
    return rows.map((row) => {
      const workout = mapWorkout(row);
      return {
        workout,
        qualifiesBenchmark: true,
        reason: `Explicit ${formatDistance(detail.goal.distanceMeters)} run completed after training began`,
        matchingSessionIds: [],
        alreadyLinked: Boolean(row.already_linked)
      };
    });
  }

  async setCurrentPerformanceBenchmark(userId: string, goalId: string, workoutId: string): Promise<PerformanceGoalDetail> {
    const detail = await this.performanceGoalFor(userId, goalId);
    if (!detail || detail.goal.status !== "active") throw new Error("Active performance goal not found");
    const tolerance = Math.max(75, detail.goal.distanceMeters * 0.015);
    const workout = (await this.query(
      `select * from workout_summaries where id = $1 and user_id = $2 and activity_type = 'running'
       and abs(distance_meters - $3) <= $4 and started_at::date >= coalesce(
         (select min(s.scheduled_date) from training_sessions s join training_plans p on p.id=s.plan_id
          where p.performance_goal_id=$5 and p.status='active'),
         (select created_at::date from performance_goals where id=$5)
       )`,
      [workoutId, userId, detail.goal.distanceMeters, tolerance, goalId]
    )).rows[0];
    if (!workout) throw new Error("Select a goal-distance run completed after training began");
    const seconds = Math.round(Number(workout.duration_seconds));
    await this.transaction(async (query) => {
      await query(
        "update performance_goals set current_benchmark_seconds = $1,current_benchmark_workout_id = $2,updated_at = now() where id = $3",
        [seconds, workoutId, goalId]
      );
      await query(
        `insert into performance_goal_benchmarks (id,performance_goal_id,workout_id,seconds,kind)
         values ($1,$2,$3,$4,'current') on conflict do nothing`,
        [generatedId("pgb"), goalId, workoutId, seconds]
      );
    });
    return this.refreshPerformanceGoalAnalysis(userId, goalId);
  }

  async performanceEvidenceFor(userId: string, goalId: string): Promise<PerformanceGoalEvidence[]> {
    if (!(await this.performanceGoalFor(userId, goalId))) throw new Error("Performance goal not found");
    const rows = (await this.query(
      `select e.*,w.*,e.id as evidence_id,e.created_at as evidence_created_at,
       c.effort_feedback,c.note
       from performance_goal_evidence e
       join workout_summaries w on w.id = e.workout_id
       left join performance_run_checkins c on c.performance_goal_id = e.performance_goal_id and c.workout_id = e.workout_id
       where e.performance_goal_id = $1 order by e.created_at desc`,
      [goalId]
    )).rows;
    return rows.map((row) => ({
      id: row.evidence_id,
      performanceGoalId: goalId,
      workout: mapWorkout(row),
      trainingSessionId: row.training_session_id ?? undefined,
      kind: row.kind,
      matchStatus: row.match_status,
      quality: row.quality ?? undefined,
      matchConfidence: row.match_confidence == null ? undefined : Number(row.match_confidence),
      impactSummary: row.impact_summary,
      createdAt: dateString(row.evidence_created_at),
      effortFeedback: row.effort_feedback ?? undefined,
      note: row.note ?? undefined
    }));
  }

  async checkInPerformanceRun(userId: string, goalId: string, input: {
    workoutId: string; effortFeedback?: PerformanceEffortFeedback; note?: string; trainingSessionId?: string;
  }): Promise<PerformanceGoalDetail> {
    const note = input.note?.trim().slice(0, 500);
    if (input.effortFeedback && !["easy", "onTarget", "hard"].includes(input.effortFeedback)) throw new Error("Invalid effort feedback");
    const detail = await this.performanceGoalFor(userId, goalId);
    if (!detail || detail.goal.status !== "active") throw new Error("Active performance goal not found");
    const tolerance = Math.max(75, detail.goal.distanceMeters * 0.015);
    const eligible = (await this.query(
      `select 1 from workout_summaries w where w.id=$1 and w.user_id=$2 and w.activity_type='running'
       and abs(w.distance_meters-$3) <= $4 and w.started_at::date >= coalesce(
         (select min(s.scheduled_date) from training_sessions s join training_plans p on p.id=s.plan_id
          where p.performance_goal_id=$5 and p.status='active'),
         (select created_at::date from performance_goals where id=$5)
       )`,
      [input.workoutId, userId, detail.goal.distanceMeters, tolerance, goalId]
    )).rows.length;
    if (!eligible) throw new Error("Only goal-distance runs completed after training began can be checked in here");
    await this.query(
      `insert into performance_run_checkins (performance_goal_id,workout_id,effort_feedback,note)
       select $1,$2,$3,$4 where exists(select 1 from performance_goals where id = $1 and user_id = $5)
       on conflict (performance_goal_id,workout_id) do update set effort_feedback = excluded.effort_feedback,note = excluded.note,created_at = now()`,
      [goalId, input.workoutId, input.effortFeedback ?? null, note ?? null, userId]
    );
    await this.evaluateWorkoutForGoal(userId, goalId, input.workoutId, input.trainingSessionId, true);
    return this.refreshPerformanceGoalAnalysis(userId, goalId);
  }

  async evaluateNewPerformanceWorkouts(userId: string, workoutIds: string[]): Promise<void> {
    const goals = (await this.query("select id from performance_goals where user_id = $1 and status = 'active'", [userId])).rows;
    for (const goal of goals) {
      for (const workoutId of workoutIds) await this.evaluateWorkoutForGoal(userId, goal.id, workoutId);
      await this.refreshPerformanceGoalAnalysis(userId, goal.id);
      await this.recommendAdaptation(userId, goal.id, "workoutSync");
    }
  }

  async evaluatePerformanceGoal(userId: string, goalId: string, reason = "userRequested"): Promise<PerformanceGoalAdaptation | undefined> {
    await this.refreshPerformanceGoalAnalysis(userId, goalId);
    return this.recommendAdaptation(userId, goalId, reason);
  }

  async adaptationsFor(userId: string, goalId: string): Promise<PerformanceGoalAdaptation[]> {
    if (!(await this.performanceGoalFor(userId, goalId))) throw new Error("Performance goal not found");
    return (await this.query("select * from performance_goal_adaptations where performance_goal_id = $1 order by created_at desc", [goalId])).rows.map(mapAdaptation);
  }

  async attachAdaptationDraft(userId: string, goalId: string, adaptationId: string, proposedPlan: unknown): Promise<PerformanceGoalAdaptation> {
    const row = (await this.query(
      `update performance_goal_adaptations a set proposed_plan = $1,status = 'pending'
       from performance_goals g where a.performance_goal_id = g.id and a.id = $2 and g.id = $3 and g.user_id = $4
       and a.status in ('recommended','pending') returning a.*`,
      [JSON.stringify(proposedPlan), adaptationId, goalId, userId]
    )).rows[0];
    if (!row) throw new Error("Adaptation not found");
    return mapAdaptation(row);
  }

  async acceptAdaptation(userId: string, goalId: string, adaptationId: string, model: string): Promise<PerformanceGoalDetail> {
    const adaptation = (await this.query(
      `select a.* from performance_goal_adaptations a join performance_goals g on g.id = a.performance_goal_id
       where a.id = $1 and a.performance_goal_id = $2 and g.user_id = $3 and a.status = 'pending'`,
      [adaptationId, goalId, userId]
    )).rows[0];
    if (!adaptation?.proposed_plan) throw new Error("Adaptation has no proposed plan");
    await this.saveTrainingPlan(goalId, model, adaptation.proposed_plan, true);
    await this.query(
      "update performance_goal_adaptations set status = 'accepted',decided_at = now() where id = $1",
      [adaptationId]
    );
    return (await this.performanceGoalFor(userId, goalId))!;
  }

  async declineAdaptation(userId: string, goalId: string, adaptationId: string): Promise<PerformanceGoalAdaptation> {
    const row = (await this.query(
      `update performance_goal_adaptations a set status = 'declined',decided_at = now()
       from performance_goals g where a.performance_goal_id = g.id and a.id = $1 and g.id = $2 and g.user_id = $3
       and a.status in ('recommended','pending') returning a.*`,
      [adaptationId, goalId, userId]
    )).rows[0];
    if (!row) throw new Error("Adaptation not found");
    return mapAdaptation(row);
  }

  async linkWorkoutToTrainingSession(userId: string, sessionId: string, workoutId: string): Promise<TrainingSession> {
    const ownership = (await this.query(
      `select s.*,g.id as goal_id from training_sessions s join training_plans p on p.id=s.plan_id
       join performance_goals g on g.id=p.performance_goal_id where s.id=$1 and g.user_id=$2`,
      [sessionId, userId]
    )).rows[0];
    if (!ownership) throw new Error("Training session not found");
    await this.evaluateWorkoutForGoal(userId, ownership.goal_id, workoutId, sessionId, true);
    const row = (await this.query("select * from training_sessions where id = $1", [sessionId])).rows[0];
    return mapTrainingSession(row);
  }

  async unlinkWorkoutFromTrainingSession(userId: string, sessionId: string): Promise<TrainingSession> {
    const row = (await this.query(
      `update training_sessions s set linked_workout_id=null,status='scheduled',quality=null,match_confidence=null
       from training_plans p join performance_goals g on g.id=p.performance_goal_id
       where s.plan_id=p.id and s.id=$1 and g.user_id=$2 returning s.*`,
      [sessionId, userId]
    )).rows[0];
    if (!row) throw new Error("Training session not found");
    await this.query("delete from performance_goal_evidence where training_session_id = $1", [sessionId]);
    return mapTrainingSession(row);
  }

  async trainingSessionDetailFor(userId: string, sessionId: string): Promise<TrainingSessionDetail> {
    const owned = (await this.query(
      `select s.*,g.id as goal_id from training_sessions s join training_plans p on p.id=s.plan_id
       join performance_goals g on g.id=p.performance_goal_id where s.id=$1 and g.user_id=$2`,
      [sessionId, userId]
    )).rows[0];
    if (!owned) throw new Error("Training session not found");
    const session = mapTrainingSession(owned);
    const linkedWorkout = session.linkedWorkoutId
      ? (await this.query("select * from workout_summaries where id=$1 and user_id=$2", [session.linkedWorkoutId, userId])).rows[0]
      : undefined;
    const evidenceRow = (await this.query(
      `select e.*,w.*,e.id as evidence_id,e.created_at as evidence_created_at,c.effort_feedback,c.note
       from performance_goal_evidence e join workout_summaries w on w.id=e.workout_id
       left join performance_run_checkins c on c.performance_goal_id=e.performance_goal_id and c.workout_id=e.workout_id
       where e.training_session_id=$1 order by e.created_at desc limit 1`,
      [sessionId]
    )).rows[0];
    const analysisRow = (await this.query(
      "select * from training_session_analyses where training_session_id=$1 order by generated_at desc limit 1",
      [sessionId]
    )).rows[0];
    const candidates = (await this.query(
      `select * from workout_summaries where user_id=$1 and activity_type='running'
       and started_at::date between ($2::date - interval '2 days') and ($2::date + interval '2 days')
       order by abs(started_at::date - $2::date),started_at desc`,
      [userId, session.scheduledDate]
    )).rows.map(mapWorkout).filter((workout) => sessionMatchScore(session, workout) >= 0.25).slice(0, 8);
    return {
      session,
      linkedWorkout: linkedWorkout ? mapWorkout(linkedWorkout) : undefined,
      evidence: evidenceRow ? mapEvidenceRow(evidenceRow, owned.goal_id) : undefined,
      analysis: analysisRow ? mapTrainingSessionAnalysis(analysisRow) : undefined,
      suggestedRuns: candidates
    };
  }

  async trainingSessionAnalysisContext(userId: string, sessionId: string): Promise<Record<string, unknown>> {
    const detail = await this.trainingSessionDetailFor(userId, sessionId);
    if (!detail.linkedWorkout) throw new Error("Link a run before requesting coaching analysis");
    const splits = (await this.query(
      "select split_index,pace_seconds_per_km,average_heart_rate_bpm from workout_splits where workout_id=$1 and is_partial=false order by split_index",
      [detail.linkedWorkout.id]
    )).rows;
    const heartRate = (await this.query(
      "select average_bpm,minimum_bpm,maximum_bpm from workout_heart_rate_summaries where workout_id=$1",
      [detail.linkedWorkout.id]
    )).rows[0];
    return {
      prescription: {
        type: detail.session.type, title: detail.session.title, purpose: detail.session.purpose,
        scheduledDate: detail.session.scheduledDate, distanceMeters: detail.session.distanceMeters,
        durationSeconds: detail.session.durationSeconds, effort: detail.session.effort,
        targetPaceMinSecondsPerKm: detail.session.targetPaceMinSecondsPerKm,
        targetPaceMaxSecondsPerKm: detail.session.targetPaceMaxSecondsPerKm,
        pacingGuidance: detail.session.pacingGuidance
      },
      result: {
        workoutId: detail.linkedWorkout.id,
        durationSeconds: detail.linkedWorkout.durationSeconds,
        distanceMeters: detail.linkedWorkout.distanceMeters,
        averagePaceSecondsPerKm: detail.linkedWorkout.distanceMeters > 0
          ? Math.round(detail.linkedWorkout.durationSeconds / (detail.linkedWorkout.distanceMeters / 1000)) : undefined,
        quality: detail.session.quality,
        matchConfidence: detail.session.matchConfidence,
        splits: splits.map((row) => ({
          index: Number(row.split_index), paceSecondsPerKm: Number(row.pace_seconds_per_km),
          averageHeartRateBPM: row.average_heart_rate_bpm == null ? undefined : Number(row.average_heart_rate_bpm)
        })),
        heartRate: heartRate ? {
          averageBPM: Number(heartRate.average_bpm), minimumBPM: Number(heartRate.minimum_bpm), maximumBPM: Number(heartRate.maximum_bpm)
        } : undefined,
        effortFeedback: detail.evidence?.effortFeedback,
        note: detail.evidence?.note
      }
    };
  }

  async saveTrainingSessionAnalysis(userId: string, sessionId: string, workoutId: string, model: string, content: {
    summary: string; observations: string[]; recommendation: string;
  }): Promise<TrainingSessionDetail> {
    if (!content.summary || !content.recommendation || !Array.isArray(content.observations)) throw new Error("Incomplete session analysis");
    const ownership = (await this.query(
      `select 1 from training_sessions s join training_plans p on p.id=s.plan_id join performance_goals g on g.id=p.performance_goal_id
       where s.id=$1 and s.linked_workout_id=$2 and g.user_id=$3`,
      [sessionId, workoutId, userId]
    )).rows.length;
    if (!ownership) throw new Error("Linked training session not found");
    await this.query(
      `insert into training_session_analyses (id,training_session_id,workout_id,summary,observations,recommendation,model)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (training_session_id,workout_id) do update set summary=excluded.summary,observations=excluded.observations,
       recommendation=excluded.recommendation,model=excluded.model,generated_at=now()`,
      [generatedId("tsa"), sessionId, workoutId, content.summary.slice(0, 1200), JSON.stringify(content.observations.slice(0, 5)), content.recommendation.slice(0, 1200), model]
    );
    return this.trainingSessionDetailFor(userId, sessionId);
  }

  async refreshPerformanceGoalAnalysis(userId: string, goalId: string): Promise<PerformanceGoalDetail> {
    const detail = await this.performanceGoalFor(userId, goalId);
    if (!detail) throw new Error("Performance goal not found");
    const analysis = await this.performanceAnalysis(
      userId,
      detail.goal.distanceMeters,
      detail.goal.targetSeconds,
      detail.goal.createdAt,
      detail.goal.currentBenchmarkSeconds ?? detail.goal.baselineSeconds,
      detail.goal.currentBenchmarkWorkoutId ?? detail.goal.baselineWorkoutId
    );
    if (analysis.currentBestSeconds != null) {
      await this.query(
        `update performance_goal_milestones set status = 'completed', completed_workout_id = $1
         where performance_goal_id = $2 and status = 'pending' and target_seconds >= $3`,
        [analysis.qualifyingWorkoutId ?? null, goalId, analysis.currentBestSeconds]
      );
    }
    await this.query(
      "update performance_goal_milestones set status = 'missed' where performance_goal_id = $1 and status = 'pending' and target_date < current_date",
      [goalId]
    );
    const row = (await this.query(
      `update performance_goals set analysis = $1,
       current_benchmark_seconds = coalesce($2,current_benchmark_seconds),
       current_benchmark_workout_id = coalesce($3,current_benchmark_workout_id),
       updated_at = now() where id = $4 returning *`,
      [JSON.stringify(analysis), analysis.currentBestSeconds ?? null, analysis.qualifyingWorkoutId ?? null, goalId]
    )).rows[0];
    if (analysis.currentBestSeconds != null && analysis.qualifyingWorkoutId) {
      await this.query(
        `insert into performance_goal_benchmarks (id,performance_goal_id,workout_id,seconds,kind)
         values ($1,$2,$3,$4,'current') on conflict do nothing`,
        [generatedId("pgb"), goalId, analysis.qualifyingWorkoutId, analysis.currentBestSeconds]
      );
    }
    const completedMilestones = (await this.query(
      "select id,sequence,completed_workout_id from performance_goal_milestones where performance_goal_id=$1 and status='completed'",
      [goalId]
    )).rows;
    for (const milestone of completedMilestones) {
      await this.insertPerformanceNotification(
        userId, goalId, "Milestone reached",
        `You completed milestone ${milestone.sequence} on the way to your performance target.`,
        `performance-milestone:${milestone.id}`
      );
    }
    return this.performanceGoalDetailFromRow(row);
  }

  async saveTrainingPlan(goalId: string, model: string, content: Omit<TrainingPlan, "id" | "performanceGoalId" | "version" | "model" | "generatedAt" | "sessions"> & { sessions: Array<Omit<TrainingSession, "id" | "planId" | "status">> }, bypassCooldown = false): Promise<TrainingPlan> {
    const latest = (await this.query("select generated_at from training_plans where performance_goal_id = $1 order by version desc limit 1", [goalId])).rows[0];
    if (!bypassCooldown && latest && Date.now() - Date.parse(latest.generated_at) < 15 * 60_000) throw new Error("Your plan was updated recently. Try again in a few minutes.");
    const goalRow = (await this.query("select distance_meters,target_seconds,analysis from performance_goals where id=$1", [goalId])).rows[0];
    if (!goalRow) throw new Error("Performance goal not found");
    const goalDistance = Number(goalRow.distance_meters);
    const targetPace = Math.round(Number(goalRow.target_seconds) / (goalDistance / 1000));
    const currentPace = Number(goalRow.analysis?.currentPaceSecondsPerKm ?? targetPace + 45);
    const sessions = content.sessions.map((session) => normalizeTrainingPrescription(session, goalDistance, targetPace, currentPace));
    const version = Number((await this.query("select coalesce(max(version),0)+1 as version from training_plans where performance_goal_id = $1", [goalId])).rows[0].version);
    const planId = generatedId("tp");
    await this.transaction(async (query) => {
      await query("update training_plans set status = 'superseded' where performance_goal_id = $1 and status = 'active'", [goalId]);
      await query(
        `update training_sessions set status = 'superseded' where status = 'scheduled'
         and plan_id in (select id from training_plans where performance_goal_id = $1)`,
        [goalId]
      );
      await query(
        `insert into training_plans (id,performance_goal_id,version,model,summary,gap_explanation,recovery_guidance,caution,status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
        [planId, goalId, version, model, content.summary, content.gapExplanation, content.recoveryGuidance, content.caution]
      );
      for (const session of sessions) {
        await query(
          `insert into training_sessions
           (id,plan_id,scheduled_date,type,title,purpose,distance_meters,duration_seconds,target_pace_min_seconds_per_km,target_pace_max_seconds_per_km,pacing_guidance,effort)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [generatedId("ts"), planId, session.scheduledDate, session.type, session.title, session.purpose,
           session.distanceMeters ?? null, session.durationSeconds ?? null, session.targetPaceMinSecondsPerKm,
           session.targetPaceMaxSecondsPerKm, session.pacingGuidance, session.effort]
        );
      }
    });
    return (await this.trainingPlanForGoal(goalId))!;
  }

  async updateTrainingSession(userId: string, sessionId: string, patch: { scheduledDate?: string; status?: string }): Promise<TrainingSession> {
    if (patch.status && !["scheduled", "completed", "partial", "skipped"].includes(patch.status)) throw new Error("Invalid session status");
    const row = (await this.query(
      `update training_sessions s set scheduled_date = coalesce($1, s.scheduled_date), status = coalesce($2, s.status)
       from training_plans p join performance_goals g on g.id = p.performance_goal_id
       where s.plan_id = p.id and s.id = $3 and g.user_id = $4 returning s.*`,
      [patch.scheduledDate ?? null, patch.status ?? null, sessionId, userId]
    )).rows[0];
    if (!row) throw new Error("Training session not found");
    return mapTrainingSession(row);
  }

  async deleteCoachingData(userId: string, goalId: string): Promise<void> {
    const owned = (await this.query("select 1 from performance_goals where id = $1 and user_id = $2", [goalId, userId])).rows.length > 0;
    if (!owned) throw new Error("Performance goal not found");
    await this.query("delete from training_plans where performance_goal_id = $1", [goalId]);
    await this.query("delete from coach_generations where performance_goal_id = $1", [goalId]);
  }

  async beginCoachGeneration(userId: string, goalId: string, model: string, reason: string): Promise<string> {
    const detail = await this.performanceGoalFor(userId, goalId);
    if (!detail) throw new Error("Performance goal not found");
    const recent = (await this.query("select generated_at from training_plans where performance_goal_id = $1 order by version desc limit 1", [goalId])).rows[0];
    if (recent && Date.now() - Date.parse(recent.generated_at) < 15 * 60_000) throw new Error("Your plan was updated recently. Try again in a few minutes.");
    const id = generatedId("cg");
    const fingerprint = `${detail.goal.updatedAt}:${detail.goal.analysis.generatedAt}:${model}`;
    await this.query(
      "insert into coach_generations (id,performance_goal_id,input_fingerprint,reason,status,model) values ($1,$2,$3,$4,'running',$5)",
      [id, goalId, fingerprint, reason, model]
    );
    return id;
  }

  async finishCoachGeneration(id: string, failure?: string): Promise<void> {
    await this.query(
      "update coach_generations set status = $1, failure_reason = $2, completed_at = now() where id = $3",
      [failure ? "failed" : "completed", failure ?? null, id]
    );
  }

  private async evaluateWorkoutForGoal(userId: string, goalId: string, workoutId: string, selectedSessionId?: string, confirmed = false): Promise<void> {
    const detail = await this.performanceGoalFor(userId, goalId);
    if (!detail || detail.goal.status !== "active") return;
    const row = (await this.query(
      "select * from workout_summaries where id=$1 and user_id=$2 and activity_type='running'",
      [workoutId, userId]
    )).rows[0];
    if (!row) return;
    const workout = mapWorkout(row);
    const goalTolerance = Math.max(75, detail.goal.distanceMeters * 0.015);
    const isBenchmark = Math.abs(workout.distanceMeters - detail.goal.distanceMeters) <= goalTolerance;
    const candidates = (detail.plan?.sessions ?? [])
      .filter((item) => item.status === "scheduled" && (!selectedSessionId || item.id === selectedSessionId))
      .map((session) => ({ session, score: sessionMatchScore(session, workout) }))
      .filter((item) => item.score >= 0.65)
      .sort((a, b) => b.score - a.score);
    const unambiguous = selectedSessionId ? candidates[0] : candidates.length === 1 || (candidates[0] && candidates[1] && candidates[0].score - candidates[1].score >= 0.15) ? candidates[0] : undefined;
    const session = unambiguous?.session;
    const confidence = unambiguous?.score;
    const quality = session ? sessionQuality(session, workout) : undefined;
    const kind = isBenchmark ? "benchmark" : session ? "session" : "relevantRun";
    const matchStatus = session ? (confirmed ? "confirmed" : "automatic") : candidates.length > 1 ? "ambiguous" : "unmatched";
    const impactSummary = isBenchmark
      ? `${formatDistance(detail.goal.distanceMeters)} benchmark completed in ${formatDuration(Math.round(workout.durationSeconds))}`
      : session ? `${session.title} ${quality === "targetMet" ? "met its target" : quality === "partial" ? "was partially completed" : "was completed"}`
      : `Run added to the goal's recent training evidence`;
    await this.query(
      `insert into performance_goal_evidence
       (id,performance_goal_id,workout_id,training_session_id,kind,match_status,quality,match_confidence,impact_summary)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (performance_goal_id,workout_id) do update set
       training_session_id=excluded.training_session_id,kind=excluded.kind,match_status=excluded.match_status,
       quality=excluded.quality,match_confidence=excluded.match_confidence,impact_summary=excluded.impact_summary`,
      [generatedId("pge"), goalId, workoutId, session?.id ?? null, kind, matchStatus, quality ?? null, confidence ?? null, impactSummary]
    );
    if (session) {
      await this.query(
        "update training_sessions set linked_workout_id=$1,status=$2,quality=$3,match_confidence=$4 where id=$5 and status='scheduled'",
        [workoutId, quality === "partial" ? "partial" : "completed", quality, confidence, session.id]
      );
    }
    if (matchStatus === "ambiguous") {
      await this.insertPerformanceNotification(
        userId, goalId, "Which session was this?",
        "A recent run could match more than one planned session. Open your goal to confirm it.",
        `performance-ambiguous:${goalId}:${workoutId}`
      );
    } else if (isBenchmark && workout.durationSeconds < (detail.goal.currentBenchmarkSeconds ?? Number.MAX_SAFE_INTEGER)) {
      await this.insertPerformanceNotification(
        userId, goalId, "New performance benchmark",
        `${formatDistance(detail.goal.distanceMeters)} is now ${formatDuration(Math.round(workout.durationSeconds))}.`,
        `performance-benchmark:${goalId}:${workoutId}`
      );
    } else if (session) {
      await this.insertPerformanceNotification(
        userId, goalId, "Training run linked",
        impactSummary,
        `performance-session-linked:${goalId}:${workoutId}`
      );
    }
  }

  private async recommendAdaptation(userId: string, goalId: string, reason: string): Promise<PerformanceGoalAdaptation | undefined> {
    const detail = await this.performanceGoalFor(userId, goalId);
    if (!detail || detail.goal.status !== "active") return undefined;
    const existing = await this.latestAdaptation(goalId, ["recommended", "pending"]);
    if (existing && Date.now() - Date.parse(existing.createdAt) < 7 * 86_400_000) return existing;
    const latestDecision = await this.latestAdaptation(goalId);
    if (latestDecision && Date.now() - Date.parse(latestDecision.createdAt) < 7 * 86_400_000) return undefined;
    const original = detail.goal.baselineSeconds;
    const current = detail.goal.currentBenchmarkSeconds ?? detail.goal.analysis.currentBestSeconds;
    const improvement = original != null && current != null ? original - current : 0;
    const missed = detail.plan?.sessions.filter((item) => item.status === "skipped").length ?? 0;
    const targetAchieved = current != null && current <= detail.goal.targetSeconds;
    const majorImprovement = original != null && improvement >= Math.max(15, original * 0.02);
    const weeklyDue = !existing && reason === "weeklyReview";
    if (!targetAchieved && !majorImprovement && missed < 2 && !weeklyDue && reason !== "userRequested") return undefined;
    const adaptationReason = targetAchieved ? "targetAchieved" : majorImprovement ? "newBenchmark" : missed >= 2 ? "missedSessions" : reason;
    const explanation = targetAchieved
      ? "You reached the target early. Review a maintenance block or choose a new target."
      : majorImprovement
        ? `Your current benchmark improved by ${formatDuration(improvement)}. A revised block can reflect your new fitness.`
        : missed >= 2
          ? "Recent missed sessions suggest the remaining block should be rebalanced."
          : "Your weekly coaching review is ready.";
    const row = (await this.query(
      `insert into performance_goal_adaptations (id,performance_goal_id,reason,explanation,status)
       values ($1,$2,$3,$4,'recommended') returning *`,
      [generatedId("pga"), goalId, adaptationReason, explanation]
    )).rows[0];
    await this.query(
      `insert into notifications
       (id,user_id,type,entity_type,entity_id,title,body,metadata,created_at,deduplication_key)
       values ($1,$2,'goal','performanceGoal',$3,'Coaching review ready',$4,$5,now(),$6)
       on conflict (deduplication_key) do nothing`,
      [generatedId("notification"), userId, goalId, explanation, JSON.stringify({ adaptationId: row.id, reason: adaptationReason }), `performance-adaptation:${row.id}`]
    );
    return mapAdaptation(row);
  }

  private async latestAdaptation(goalId: string, statuses?: string[]): Promise<PerformanceGoalAdaptation | undefined> {
    const values = statuses?.length ? statuses : ["recommended", "pending", "accepted", "declined"];
    const row = (await this.query(
      "select * from performance_goal_adaptations where performance_goal_id=$1 and status=any($2::text[]) order by created_at desc limit 1",
      [goalId, values]
    )).rows[0];
    return row ? mapAdaptation(row) : undefined;
  }

  private async insertPerformanceNotification(userId: string, goalId: string, title: string, body: string, deduplicationKey: string): Promise<void> {
    await this.query(
      `insert into notifications
       (id,user_id,type,entity_type,entity_id,title,body,metadata,created_at,deduplication_key)
       values ($1,$2,'goal','performanceGoal',$3,$4,$5,'{}'::jsonb,now(),$6)
       on conflict (deduplication_key) do nothing`,
      [generatedId("notification"), userId, goalId, title, body, deduplicationKey]
    );
  }

  private async performanceAnalysis(userId: string, distanceMeters: number, targetSeconds: number, since?: string, currentBenchmarkSeconds?: number, currentBenchmarkWorkoutId?: string): Promise<PerformanceGoalAnalysis> {
    const tolerance = Math.max(75, distanceMeters * 0.015);
    const qualifying = (await this.query(
      `select * from workout_summaries where user_id = $1 and activity_type = 'running'
       and abs(distance_meters - $2) <= $3 and ($4::timestamptz is null or started_at >= $4::timestamptz)
       order by duration_seconds asc`,
      [userId, distanceMeters, tolerance, since ?? null]
    )).rows;
    const recent = (await this.query(
      `select duration_seconds,distance_meters from workout_summaries where user_id = $1 and activity_type = 'running'
       and started_at >= now() - interval '28 days' order by started_at desc`,
      [userId]
    )).rows;
    const best = qualifying[0];
    const latest = qualifying.slice().sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
    const measuredBest = best ? Math.round(Number(best.duration_seconds)) : undefined;
    const currentBestSeconds = currentBenchmarkSeconds == null ? measuredBest : measuredBest == null ? currentBenchmarkSeconds : Math.min(currentBenchmarkSeconds, measuredBest);
    const gap = currentBestSeconds == null ? undefined : currentBestSeconds - targetSeconds;
    const improvement = best && latest ? Math.max(0, Math.round(Number(latest.duration_seconds) - Number(best.duration_seconds))) : undefined;
    const ratio = gap == null ? undefined : gap / targetSeconds;
    const splitRows = best ? (await this.query(
      "select pace_seconds_per_km, split_index from workout_splits where workout_id = $1 and unit = 'kilometer' and is_partial = false order by split_index",
      [best.id]
    )).rows : [];
    const paces = splitRows.map((row) => Number(row.pace_seconds_per_km));
    const splitAverage = paces.length ? paces.reduce((sum, value) => sum + value, 0) / paces.length : undefined;
    const splitVariation = splitAverage == null ? undefined : Math.sqrt(paces.reduce((sum, value) => sum + Math.pow(value - splitAverage, 2), 0) / paces.length);
    const midpoint = Math.floor(paces.length / 2);
    const firstHalf = midpoint ? paces.slice(0, midpoint).reduce((sum, value) => sum + value, 0) / midpoint : undefined;
    const secondValues = paces.slice(midpoint);
    const secondHalf = secondValues.length ? secondValues.reduce((sum, value) => sum + value, 0) / secondValues.length : undefined;
    const heartRate = best ? (await this.query("select average_bpm from workout_heart_rate_summaries where workout_id = $1", [best.id])).rows[0] : undefined;
    return {
      currentBestSeconds,
      targetSeconds,
      requiredPaceSecondsPerKm: Math.round(targetSeconds / (distanceMeters / 1000)),
      currentPaceSecondsPerKm: currentBestSeconds == null ? undefined : Math.round(currentBestSeconds / (distanceMeters / 1000)),
      timeGapSeconds: gap,
      recentWeeklyDistanceMeters: recent.reduce((sum, row) => sum + Number(row.distance_meters), 0) / 4,
      recentRuns: recent.length,
      improvementSeconds: improvement,
      splitVariationSeconds: splitVariation == null ? undefined : Math.round(splitVariation),
      lateRunSlowdownSeconds: firstHalf == null || secondHalf == null ? undefined : Math.round(secondHalf - firstHalf),
      averageHeartRateBPM: heartRate ? Math.round(Number(heartRate.average_bpm)) : undefined,
      feasibility: ratio == null ? "insufficientData" : ratio <= 0 ? "onTrack" : ratio <= 0.08 ? "onTrack" : ratio <= 0.2 ? "ambitious" : "stretch",
      qualifyingWorkoutId: measuredBest != null && measuredBest <= (currentBenchmarkSeconds ?? Number.MAX_SAFE_INTEGER) ? best?.id : currentBenchmarkWorkoutId,
      generatedAt: new Date().toISOString()
    };
  }

  private async trainingPlanForGoal(goalId: string): Promise<TrainingPlan | undefined> {
    const plan = (await this.query(
      "select * from training_plans where performance_goal_id = $1 order by (status = 'active') desc,version desc limit 1",
      [goalId]
    )).rows[0];
    if (!plan) return undefined;
    const sessions = (await this.query("select * from training_sessions where plan_id = $1 order by scheduled_date,id", [plan.id])).rows.map(mapTrainingSession);
    return {
      id: plan.id, performanceGoalId: plan.performance_goal_id, version: Number(plan.version), model: plan.model,
      summary: plan.summary, gapExplanation: plan.gap_explanation, recoveryGuidance: plan.recovery_guidance,
      caution: plan.caution, generatedAt: dateString(plan.generated_at), status: plan.status ?? "active", sessions
    };
  }

  private async performanceGoalDetailFromRow(row: any): Promise<PerformanceGoalDetail> {
    const goal: PerformanceGoal = {
      id: row.id, userId: row.user_id, distanceMeters: Number(row.distance_meters), targetSeconds: Number(row.target_seconds),
      targetDate: dateString(row.target_date).slice(0, 10), trainingDaysPerWeek: Number(row.training_days_per_week),
      preferredLongRunDay: Number(row.preferred_long_run_day), status: row.status, consentVersion: row.consent_version,
      baselineSeconds: row.baseline_seconds == null ? undefined : Number(row.baseline_seconds),
      baselineWorkoutId: row.baseline_workout_id ?? undefined,
      currentBenchmarkSeconds: row.current_benchmark_seconds == null ? undefined : Number(row.current_benchmark_seconds),
      currentBenchmarkWorkoutId: row.current_benchmark_workout_id ?? undefined,
      analysis: row.analysis as PerformanceGoalAnalysis, createdAt: dateString(row.created_at), updatedAt: dateString(row.updated_at)
    };
    const milestones = (await this.query(
      "select * from performance_goal_milestones where performance_goal_id = $1 order by sequence",
      [goal.id]
    )).rows.map((item) => ({
      id: item.id, performanceGoalId: item.performance_goal_id, sequence: Number(item.sequence),
      targetSeconds: Number(item.target_seconds), targetDate: dateString(item.target_date).slice(0, 10),
      status: item.status, completedWorkoutId: item.completed_workout_id ?? undefined
    }));
    const plan = await this.trainingPlanForGoal(goal.id);
    const pendingAdaptation = await this.latestAdaptation(goal.id, ["recommended", "pending"]);
    return { goal, plan, milestones, trajectory: performanceTrajectory(goal, plan), pendingAdaptation };
  }

  private async ensureRuntimeTables() {
    await this.query("create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())");
    const applied = new Set((await this.query("select id from schema_migrations")).rows.map((row) => row.id));
    const migrations = [
      {
        id: "001_runtime_social_tables",
        statements: [
          "create table if not exists message_reads (message_id text not null references messages(id) on delete cascade, user_id text not null references users(id) on delete cascade, primary key(message_id, user_id))",
          "create table if not exists conversation_mutes (conversation_id text not null references conversations(id) on delete cascade, user_id text not null references users(id) on delete cascade, primary key(conversation_id, user_id))",
          "create table if not exists blocked_users (blocker_id text not null references users(id) on delete cascade, blocked_id text not null references users(id) on delete cascade, created_at timestamptz not null default now(), primary key(blocker_id, blocked_id))"
        ]
      },
      {
        id: "002_workout_summaries",
        statements: [
          "create table if not exists workout_summaries (id text primary key, user_id text not null references users(id) on delete cascade, healthkit_uuid text not null, activity_type text not null check (activity_type in ('walking', 'running', 'strengthTraining')), started_at timestamptz not null, ended_at timestamptz not null, duration_seconds double precision not null default 0, distance_meters double precision not null default 0, calories double precision not null default 0, source text not null default 'healthkit', trust_level text not null default 'verified', updated_at timestamptz not null default now(), unique(user_id, healthkit_uuid))"
        ]
      },
      {
        id: "003_profile_avatar",
        statements: ["alter table users add column if not exists avatar_url text"]
      },
      {
        id: "004_challenge_rules",
        statements: [
          "alter table challenges add column if not exists mode text not null default 'competitive'",
          "alter table challenges add column if not exists target double precision"
        ]
      },
      {
        id: "005_reports",
        statements: ["create table if not exists reports (id text primary key, reporter_id text not null references users(id) on delete cascade, target_type text not null check (target_type in ('user', 'message')), target_id text not null, reason text not null, created_at timestamptz not null default now())"]
      },
      {
        id: "006_goal_enabled",
        statements: ["alter table goals add column if not exists is_enabled boolean not null default true"]
      },
      {
        id: "007_canonical_username",
        statements: ["update users set display_name = username where display_name <> username"]
      },
      {
        id: "008_notifications",
        statements: [
          "create table if not exists notifications (id text primary key, user_id text not null references users(id) on delete cascade, type text not null, actor_id text references users(id) on delete set null, entity_type text, entity_id text, title text not null, body text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null, read_at timestamptz, archived_at timestamptz, deduplication_key text not null unique)",
          "create index if not exists notifications_user_created_idx on notifications(user_id, created_at desc)",
          "create index if not exists notifications_user_unread_idx on notifications(user_id, read_at) where archived_at is null"
        ]
      },
      {
        id: "009_goal_versions",
        statements: [
          "create table if not exists goal_versions (goal_id text not null references goals(id) on delete cascade, user_id text not null references users(id) on delete cascade, kind text not null, cadence text, target double precision not null, effective_date date not null, primary key(goal_id, effective_date))",
          "insert into goal_versions (goal_id, user_id, kind, cadence, target, effective_date) select id, user_id, kind, cadence, target, created_at::date from goals on conflict do nothing"
        ]
      },
      {
        id: "010_unique_message_reactions",
        statements: [
          "delete from reactions a using reactions b where a.target_type = 'message' and b.target_type = 'message' and a.target_id = b.target_id and a.user_id = b.user_id and (a.created_at < b.created_at or (a.created_at = b.created_at and a.id < b.id))",
          "create unique index if not exists reactions_message_user_unique on reactions(target_id, user_id) where target_type = 'message'"
        ]
      },
      {
        id: "011_challenge_teams",
        statements: ["alter table challenge_participants add column if not exists team_id text"]
      },
      {
        id: "012_workout_heart_rate",
        statements: [
          "create table if not exists workout_heart_rate_summaries (workout_id text primary key references workout_summaries(id) on delete cascade, average_bpm double precision not null, minimum_bpm double precision not null, maximum_bpm double precision not null, sample_count integer not null, updated_at timestamptz not null default now())",
          "create table if not exists workout_heart_rate_points (workout_id text not null references workout_summaries(id) on delete cascade, recorded_at timestamptz not null, bpm double precision not null, sample_count integer not null, primary key(workout_id, recorded_at))",
          "create index if not exists workout_heart_rate_points_workout_time_idx on workout_heart_rate_points(workout_id, recorded_at)"
        ]
      },
      {
        id: "013_workout_splits",
        statements: [
          "create table if not exists workout_splits (workout_id text not null references workout_summaries(id) on delete cascade, unit text not null check (unit in ('kilometer', 'mile')), split_index integer not null, distance_meters double precision not null, duration_seconds double precision not null, pace_seconds_per_km double precision not null, started_at timestamptz not null, ended_at timestamptz not null, is_partial boolean not null default false, average_heart_rate_bpm double precision, updated_at timestamptz not null default now(), primary key(workout_id, unit, split_index))"
        ]
      },
      {
        id: "014_split_heart_rate",
        statements: [
          "alter table workout_splits add column if not exists average_heart_rate_bpm double precision"
        ]
      },
      {
        id: "015_goal_streaks_home_goal",
        statements: [
          "alter table user_settings add column if not exists home_goal_id text",
          "alter table goal_versions add column if not exists cadence text",
          "update goal_versions set cadence = goals.cadence from goals where goal_versions.goal_id = goals.id and goal_versions.cadence is null",
          "alter table goal_versions alter column cadence set not null",
          "create table if not exists goal_streaks (goal_id text primary key references goals(id) on delete cascade, user_id text not null references users(id) on delete cascade, cadence text not null, current_count integer not null default 0, best_count integer not null default 0, last_completed_period date, updated_at timestamptz not null default now())",
          "create index if not exists goal_streaks_user_idx on goal_streaks(user_id)",
          "do $$ begin if not exists (select 1 from pg_constraint where conname = 'user_settings_home_goal_id_fkey') then alter table user_settings add constraint user_settings_home_goal_id_fkey foreign key (home_goal_id) references goals(id) on delete set null; end if; end $$"
        ]
      },
      {
        id: "016_performance_coaching",
        statements: [
          "create table if not exists performance_goals (id text primary key, user_id text not null references users(id) on delete cascade, distance_meters double precision not null, target_seconds integer not null, target_date date not null, training_days_per_week integer not null, preferred_long_run_day integer not null, status text not null check (status in ('active','completed','abandoned','archived')), consent_version text not null, baseline_seconds integer, baseline_workout_id text references workout_summaries(id) on delete set null, analysis jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
          "create unique index if not exists performance_goals_one_active_per_user on performance_goals(user_id) where status = 'active'",
          "create table if not exists performance_goal_milestones (id text primary key, performance_goal_id text not null references performance_goals(id) on delete cascade, sequence integer not null, target_seconds integer not null, target_date date not null, status text not null default 'pending' check (status in ('pending','completed','missed')), completed_workout_id text references workout_summaries(id) on delete set null, unique(performance_goal_id,sequence))",
          "create table if not exists training_plans (id text primary key, performance_goal_id text not null references performance_goals(id) on delete cascade, version integer not null, model text not null, summary text not null, gap_explanation text not null, recovery_guidance text not null, caution text not null, generated_at timestamptz not null default now(), unique(performance_goal_id,version))",
          "create table if not exists training_sessions (id text primary key, plan_id text not null references training_plans(id) on delete cascade, scheduled_date date not null, type text not null, title text not null, purpose text not null, distance_meters double precision, duration_seconds integer, effort text not null, status text not null default 'scheduled' check (status in ('scheduled','completed','skipped')), linked_workout_id text references workout_summaries(id) on delete set null)",
          "create table if not exists coach_generations (id text primary key, performance_goal_id text not null references performance_goals(id) on delete cascade, input_fingerprint text not null, reason text not null, status text not null, model text not null, failure_reason text, created_at timestamptz not null default now(), completed_at timestamptz)"
        ]
      },
      {
        id: "017_performance_goal_baseline",
        statements: [
          "alter table performance_goals add column if not exists baseline_seconds integer",
          "update performance_goals set baseline_seconds = nullif((analysis->>'currentBestSeconds')::integer, 0) where baseline_seconds is null and analysis ? 'currentBestSeconds'"
        ]
      },
      {
        id: "018_performance_goal_baseline_workout",
        statements: [
          "alter table performance_goals add column if not exists baseline_workout_id text references workout_summaries(id) on delete set null"
        ]
      },
      {
        id: "019_adaptive_performance_coaching",
        statements: [
          "alter table performance_goals add column if not exists current_benchmark_seconds integer",
          "alter table performance_goals add column if not exists current_benchmark_workout_id text references workout_summaries(id) on delete set null",
          "update performance_goals set current_benchmark_seconds = baseline_seconds, current_benchmark_workout_id = baseline_workout_id where current_benchmark_seconds is null",
          "alter table training_plans add column if not exists status text not null default 'active'",
          "alter table training_sessions add column if not exists quality text",
          "alter table training_sessions add column if not exists match_confidence double precision",
          "alter table training_sessions drop constraint if exists training_sessions_status_check",
          "alter table training_sessions add constraint training_sessions_status_check check (status in ('scheduled','completed','partial','skipped','superseded'))",
          "create table if not exists performance_goal_benchmarks (id text primary key, performance_goal_id text not null references performance_goals(id) on delete cascade, workout_id text not null references workout_summaries(id) on delete cascade, seconds integer not null, kind text not null check (kind in ('original','current')), created_at timestamptz not null default now(), unique(performance_goal_id,workout_id,kind))",
          "create table if not exists performance_goal_evidence (id text primary key, performance_goal_id text not null references performance_goals(id) on delete cascade, workout_id text not null references workout_summaries(id) on delete cascade, training_session_id text references training_sessions(id) on delete set null, kind text not null check (kind in ('benchmark','session','relevantRun')), match_status text not null check (match_status in ('automatic','confirmed','ambiguous','unmatched')), quality text check (quality in ('targetMet','completed','partial')), match_confidence double precision, impact_summary text not null, created_at timestamptz not null default now(), unique(performance_goal_id,workout_id))",
          "create table if not exists performance_run_checkins (performance_goal_id text not null references performance_goals(id) on delete cascade, workout_id text not null references workout_summaries(id) on delete cascade, effort_feedback text check (effort_feedback in ('easy','onTarget','hard')), note text, created_at timestamptz not null default now(), primary key(performance_goal_id,workout_id))",
          "create table if not exists performance_goal_adaptations (id text primary key, performance_goal_id text not null references performance_goals(id) on delete cascade, reason text not null, explanation text not null, status text not null check (status in ('recommended','pending','accepted','declined','expired')), proposed_plan jsonb, created_at timestamptz not null default now(), decided_at timestamptz)",
          "create index if not exists performance_goal_evidence_goal_idx on performance_goal_evidence(performance_goal_id,created_at desc)",
          "create index if not exists performance_goal_adaptations_goal_idx on performance_goal_adaptations(performance_goal_id,created_at desc)"
        ]
      },
      {
        id: "020_training_session_analysis",
        statements: [
          "create table if not exists training_session_analyses (id text primary key, training_session_id text not null references training_sessions(id) on delete cascade, workout_id text not null references workout_summaries(id) on delete cascade, summary text not null, observations jsonb not null default '[]'::jsonb, recommendation text not null, model text not null, generated_at timestamptz not null default now(), unique(training_session_id,workout_id))"
        ]
      },
      {
        id: "021_training_session_pacing",
        statements: [
          "alter table training_sessions add column if not exists target_pace_min_seconds_per_km integer",
          "alter table training_sessions add column if not exists target_pace_max_seconds_per_km integer",
          "alter table training_sessions add column if not exists pacing_guidance text"
        ]
      }
    ];
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      await this.transaction(async (query) => {
        for (const statement of migration.statements) await query(statement);
        await query("insert into schema_migrations (id) values ($1) on conflict do nothing", [migration.id]);
      });
    }
  }

  private async clearDomainTables() {
    await this.query(
      `delete from message_reads;
       delete from notifications;
       delete from conversation_mutes;
       delete from reactions;
       delete from messages;
       delete from feed_items;
       delete from conversation_members;
       delete from conversations;
       delete from challenge_participants;
       delete from challenges;
       delete from user_badges;
       delete from badges;
       delete from streaks;
       delete from goal_streaks;
       delete from goal_versions;
       delete from goals;
       delete from workout_summaries;
       delete from activity_summaries;
       delete from reports;
       delete from blocked_users;
       delete from device_tokens;
       delete from friendships;
       delete from sessions;
       delete from oauth_identities;
       delete from user_settings;
       delete from users;`
    );
  }

  private deleteFriendship(userId: string, friendId: string) {
    return this.query(
      `delete from friendships
       where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1)`,
      [userId, friendId]
    );
  }

  private async persistDerivedActivity(store: AppStore, userId: string) {
    const settings = store.settings.find((item) => item.userId === userId);
    if (settings) await this.insertSettings(settings);
    const streak = store.streaks.find((item) => item.userId === userId);
    if (streak) await this.insertStreak(streak);
    for (const goalStreak of store.goalStreaks.filter((item) => item.userId === userId)) {
      await this.insertGoalStreak(goalStreak);
    }
    for (const badge of store.userBadges.filter((item) => item.userId === userId)) {
      await this.insertUserBadge(badge);
    }
    for (const challenge of store.challenges.filter((item) => item.participants.some((participant) => participant.userId === userId))) {
      await this.insertChallenge(challenge);
      for (const participant of challenge.participants) await this.insertChallengeParticipant(challenge.id, participant);
    }
    const conversationIds = store.conversationMembers.filter((item) => item.userId === userId).map((item) => item.conversationId);
    for (const message of store.messages.filter((item) => item.kind === "system" && conversationIds.includes(item.conversationId))) await this.persistMessage(message);
  }

  private async persistMessage(message: Message) {
    await this.insertMessage(message);
    for (const userId of message.readBy) {
      await this.query(
        "insert into message_reads (message_id, user_id) values ($1, $2) on conflict do nothing",
        [message.id, userId]
      );
    }
  }

  private async persistNotifications(store: AppStore) {
    for (const notification of store.notifications) await this.insertNotification(notification);
  }

  private insertNotification(notification: AppNotification) {
    return this.query(
      `insert into notifications (id, user_id, type, actor_id, entity_type, entity_id, title, body, metadata, created_at, read_at, archived_at, deduplication_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (id) do update set read_at=excluded.read_at, archived_at=excluded.archived_at, title=excluded.title, body=excluded.body, metadata=excluded.metadata`,
      [notification.id, notification.userId, notification.type, notification.actorId, notification.entityType, notification.entityId, notification.title, notification.body, JSON.stringify(notification.metadata), notification.createdAt, notification.readAt, notification.archivedAt, notification.deduplicationKey]
    );
  }

  private async persistConversationRead(store: AppStore, conversationId: string, userId: string) {
    const member = required(
      store.conversationMembers.find((item) => item.conversationId === conversationId && item.userId === userId),
      "Conversation member"
    );
    await this.insertConversationMember(member);
    for (const message of store.messages.filter((item) => item.conversationId === conversationId && item.readBy.includes(userId))) {
      await this.query(
        "insert into message_reads (message_id, user_id) values ($1, $2) on conflict do nothing",
        [message.id, userId]
      );
    }
  }

  private insertUser(user: User) {
    return this.query(
      `insert into users (id, username, display_name, email, phone, avatar_color, avatar_url, joined_at, searchable)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set username = excluded.username, display_name = excluded.display_name,
         email = excluded.email, phone = excluded.phone, avatar_color = excluded.avatar_color,
         avatar_url = excluded.avatar_url, searchable = excluded.searchable`,
      [user.id, user.username, user.displayName, user.email, user.phone, user.avatarColor, user.avatarURL, user.joinedAt, user.searchable]
    );
  }

  private insertReport(report: AppStore["reports"][number]) {
    return this.query("insert into reports (id, reporter_id, target_type, target_id, reason, created_at) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing",
      [report.id, report.reporterId, report.targetType, report.targetId, report.reason, report.createdAt]);
  }

  private insertWorkout(workout: WorkoutSummary) {
    return this.query(
      `insert into workout_summaries
        (id, user_id, healthkit_uuid, activity_type, started_at, ended_at, duration_seconds, distance_meters, calories, source, trust_level, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (user_id, healthkit_uuid) do update set activity_type = excluded.activity_type,
         started_at = excluded.started_at, ended_at = excluded.ended_at, duration_seconds = excluded.duration_seconds,
         distance_meters = excluded.distance_meters, calories = excluded.calories, trust_level = excluded.trust_level,
         updated_at = excluded.updated_at`,
      [workout.id, workout.userId, workout.healthkitUUID, workout.activityType, workout.startedAt, workout.endedAt,
        workout.durationSeconds, workout.distanceMeters, workout.calories, workout.source, workout.trustLevel, workout.updatedAt]
    );
  }

  private insertSettings(settings: UserSettings) {
    return this.query(
      `insert into user_settings
        (user_id, home_goal_id, hide_activity_from_friends, hide_exact_numbers, searchable, push_messages, push_friend_requests, push_challenges, push_milestones)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (user_id) do update set hide_activity_from_friends = excluded.hide_activity_from_friends,
         home_goal_id = excluded.home_goal_id,
         hide_exact_numbers = excluded.hide_exact_numbers, searchable = excluded.searchable, push_messages = excluded.push_messages,
         push_friend_requests = excluded.push_friend_requests, push_challenges = excluded.push_challenges, push_milestones = excluded.push_milestones`,
      [settings.userId, settings.homeGoalId, settings.hideActivityFromFriends, settings.hideExactNumbers, settings.searchable, settings.pushMessages, settings.pushFriendRequests, settings.pushChallenges, settings.pushMilestones]
    );
  }

  private insertFriendship(friendship: Friendship) {
    return this.query(
      `insert into friendships (id, requester_id, addressee_id, status, created_at, responded_at)
       values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set status = excluded.status, responded_at = excluded.responded_at`,
      [friendship.id, friendship.requesterId, friendship.addresseeId, friendship.status, friendship.createdAt, friendship.respondedAt]
    );
  }

  private insertSummary(summary: ActivitySummary) {
    return this.query(
      `insert into activity_summaries
        (id, user_id, local_date, timezone, steps, walking_distance_meters, running_distance_meters, workout_count, active_minutes, calories, source, trust_level, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (user_id, local_date, source) do update set timezone = excluded.timezone, steps = excluded.steps,
         walking_distance_meters = excluded.walking_distance_meters, running_distance_meters = excluded.running_distance_meters,
         workout_count = excluded.workout_count, active_minutes = excluded.active_minutes, calories = excluded.calories,
         trust_level = excluded.trust_level, updated_at = excluded.updated_at`,
      [summary.id, summary.userId, summary.localDate, summary.timezone, summary.steps, summary.walkingDistanceMeters, summary.runningDistanceMeters, summary.workoutCount, summary.activeMinutes, summary.calories, summary.source, summary.trustLevel, summary.updatedAt]
    );
  }

  private insertGoal(goal: Goal) {
    return this.query(
      "insert into goals (id, user_id, kind, cadence, target, is_enabled, created_at) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do update set kind = excluded.kind, cadence = excluded.cadence, target = excluded.target, is_enabled = excluded.is_enabled",
      [goal.id, goal.userId, goal.kind, goal.cadence, goal.target, goal.isEnabled, goal.createdAt]
    );
  }

  private insertGoalVersion(version: AppStore["goalVersions"][number]) {
    return this.query(
      "insert into goal_versions (goal_id, user_id, kind, cadence, target, effective_date) values ($1, $2, $3, $4, $5, $6) on conflict (goal_id, effective_date) do update set kind = excluded.kind, cadence = excluded.cadence, target = excluded.target",
      [version.goalId, version.userId, version.kind, version.cadence, version.target, version.effectiveDate]
    );
  }

  private insertGoalStreak(streak: AppStore["goalStreaks"][number]) {
    return this.query(
      `insert into goal_streaks (goal_id, user_id, cadence, current_count, best_count, last_completed_period, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (goal_id) do update set cadence = excluded.cadence, current_count = excluded.current_count,
         best_count = excluded.best_count, last_completed_period = excluded.last_completed_period, updated_at = excluded.updated_at`,
      [streak.goalId, streak.userId, streak.cadence, streak.currentCount, streak.bestCount, streak.lastCompletedPeriod, streak.updatedAt]
    );
  }

  private insertStreak(streak: Streak) {
    return this.query(
      "insert into streaks (user_id, current_days, best_days, updated_at) values ($1, $2, $3, $4) on conflict (user_id) do update set current_days = excluded.current_days, best_days = excluded.best_days, updated_at = excluded.updated_at",
      [streak.userId, streak.currentDays, streak.bestDays, streak.updatedAt]
    );
  }

  private insertBadge(badge: Badge) {
    return this.query(
      "insert into badges (id, title, emoji, rule_kind, threshold) values ($1, $2, $3, $4, $5) on conflict (id) do update set title = excluded.title, emoji = excluded.emoji, rule_kind = excluded.rule_kind, threshold = excluded.threshold",
      [badge.id, badge.title, badge.emoji, badge.ruleKind, badge.threshold]
    );
  }

  private insertUserBadge(userBadge: UserBadge) {
    return this.query(
      "insert into user_badges (id, user_id, badge_id, earned_at) values ($1, $2, $3, $4) on conflict (user_id, badge_id) do update set earned_at = excluded.earned_at",
      [userBadge.id, userBadge.userId, userBadge.badgeId, userBadge.earnedAt]
    );
  }

  private insertChallenge(challenge: Challenge) {
    return this.query(
      `insert into challenges (id, creator_id, title, kind, template, starts_on, ends_on, status, mode, target, rematch_of_challenge_id, shared_conversation_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict (id) do update set status = excluded.status,
         mode = excluded.mode, target = excluded.target, shared_conversation_id = excluded.shared_conversation_id`,
      [challenge.id, challenge.creatorId, challenge.title, challenge.kind, challenge.template, challenge.startsOn, challenge.endsOn, challenge.status,
        challenge.mode ?? "competitive", challenge.target, challenge.rematchOfChallengeId, challenge.sharedConversationId, challenge.createdAt]
    );
  }

  private insertChallengeParticipant(challengeId: string, participant: Challenge["participants"][number]) {
    return this.query(
      "insert into challenge_participants (challenge_id, user_id, accepted, score, responded_at, team_id) values ($1, $2, $3, $4, $5, $6) on conflict (challenge_id, user_id) do update set accepted = excluded.accepted, score = excluded.score, responded_at = excluded.responded_at, team_id = excluded.team_id",
      [challengeId, participant.userId, participant.accepted, participant.score, participant.respondedAt, participant.teamId]
    );
  }

  private insertConversation(conversation: Conversation) {
    return this.query(
      "insert into conversations (id, kind, title, created_by, created_at) values ($1, $2, $3, $4, $5) on conflict (id) do update set title = excluded.title",
      [conversation.id, conversation.kind, conversation.title, conversation.createdBy, conversation.createdAt]
    );
  }

  private insertConversationMember(member: ConversationMember) {
    return this.query(
      "insert into conversation_members (conversation_id, user_id, role, joined_at, last_read_at, muted) values ($1, $2, $3, $4, $5, false) on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at, role = excluded.role",
      [member.conversationId, member.userId, member.role, member.joinedAt, member.lastReadAt]
    );
  }

  private insertFeedItem(item: FeedItem) {
    return this.query(
      "insert into feed_items (id, user_id, type, title, body, created_at) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set title = excluded.title, body = excluded.body",
      [item.id, item.userId, item.type, item.title, item.body, item.createdAt]
    );
  }

  private insertMessage(message: Message) {
    return this.query(
      "insert into messages (id, conversation_id, sender_id, kind, body, created_at) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set body = excluded.body",
      [message.id, message.conversationId, message.senderId, message.kind, message.body, message.createdAt]
    );
  }

  private insertReaction(reaction: Reaction) {
    return this.query(
      "insert into reactions (id, target_type, target_id, user_id, kind, created_at) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set kind = excluded.kind",
      [reaction.id, reaction.targetType, reaction.targetId, reaction.userId, reaction.kind, reaction.createdAt]
    );
  }
}

export async function createProductionRepository(databaseUrl: string): Promise<PostgresRepository> {
  const pg = await import("pg");
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: databaseSslOptions(databaseUrl)
  });
  return new PostgresRepository(
    (sql, params) => pool.query(sql, params),
    async (work) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await work((sql, params) => client.query(sql, params));
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
  );
}

function databaseSslOptions(databaseUrl: string): boolean | { ca?: string; rejectUnauthorized: boolean } | undefined {
  const sslRequired = databaseUrl.includes("supabase.") || process.env.DATABASE_SSL === "true";
  if (!sslRequired) return undefined;

  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";
  return ca ? { ca, rejectUnauthorized } : { rejectUnauthorized };
}

export async function createProductionSeedStore(databaseUrl?: string, useDemoData = false): Promise<AppStore> {
  const { store } = await createProductionContext(databaseUrl, useDemoData);
  return store;
}

export async function createProductionContext(databaseUrl?: string, useDemoData = false): Promise<{ store: AppStore; persist: (change: PersistenceChange) => Promise<void>; heartRate: WorkoutHeartRateRepository; splits: WorkoutSplitRepository; performanceGoals?: PostgresRepository }> {
  if (!databaseUrl) {
    const store = useDemoData ? createDemoStore() : createEmptyStore();
    return { store, persist: async () => {}, heartRate: new InMemoryWorkoutHeartRateRepository(), splits: new InMemoryWorkoutSplitRepository() };
  }

  const repository = await createProductionRepository(databaseUrl);
  await repository.migrate();
  const loadedStore = await repository.loadStore();
  const store = loadedStore ?? (useDemoData ? createDemoStore() : createEmptyStore());
  const badges = defaultBadges();
  store.badges = badges;
  if (loadedStore) {
    await repository.seedBadges(badges);
    for (const user of store.users) {
      refreshDerivedForUser(store, user.id);
      await repository.persistChange(store, { kind: "derived", userId: user.id });
    }
  } else {
    await repository.saveStore(store);
  }
  return {
    store,
    persist: (change) => repository.persistChange(store, change),
    heartRate: repository,
    splits: repository,
    performanceGoals: repository
  };
}

function mapHeartRateDetail(summary: any, points: any[]): WorkoutHeartRateDetail {
  return {
    workoutId: summary.workout_id,
    averageBPM: Number(summary.average_bpm),
    minimumBPM: Number(summary.minimum_bpm),
    maximumBPM: Number(summary.maximum_bpm),
    sampleCount: Number(summary.sample_count),
    updatedAt: dateString(summary.updated_at),
    points: points.map((point) => ({ recordedAt: dateString(point.recorded_at), bpm: Number(point.bpm), sampleCount: Number(point.sample_count) }))
  };
}

function mapWorkoutSplits(workoutId: string, rows: any[]): WorkoutSplitsDetail {
  return {
    workoutId,
    updatedAt: rows.reduce((latest, row) => latest > dateString(row.updated_at) ? latest : dateString(row.updated_at), ""),
    splits: rows.map((row) => ({
      index: Number(row.split_index), unit: row.unit, distanceMeters: Number(row.distance_meters), durationSeconds: Number(row.duration_seconds),
      paceSecondsPerKm: Number(row.pace_seconds_per_km), startedAt: dateString(row.started_at), endedAt: dateString(row.ended_at), isPartial: Boolean(row.is_partial),
      averageHeartRateBPM: row.average_heart_rate_bpm == null ? undefined : Number(row.average_heart_rate_bpm)
    }))
  };
}

function mapTrainingSession(row: any): TrainingSession {
  return {
    id: row.id, planId: row.plan_id, scheduledDate: dateString(row.scheduled_date).slice(0, 10),
    type: row.type, title: row.title, purpose: row.purpose,
    distanceMeters: row.distance_meters == null ? undefined : Number(row.distance_meters),
    durationSeconds: row.duration_seconds == null ? undefined : Number(row.duration_seconds),
    targetPaceMinSecondsPerKm: row.target_pace_min_seconds_per_km == null ? undefined : Number(row.target_pace_min_seconds_per_km),
    targetPaceMaxSecondsPerKm: row.target_pace_max_seconds_per_km == null ? undefined : Number(row.target_pace_max_seconds_per_km),
    pacingGuidance: row.pacing_guidance ?? undefined,
    effort: row.effort, status: row.status, linkedWorkoutId: row.linked_workout_id ?? undefined,
    quality: row.quality ?? undefined,
    matchConfidence: row.match_confidence == null ? undefined : Number(row.match_confidence)
  };
}

function mapAdaptation(row: any): PerformanceGoalAdaptation {
  return {
    id: row.id,
    performanceGoalId: row.performance_goal_id,
    reason: row.reason,
    explanation: row.explanation,
    status: row.status,
    proposedPlan: row.proposed_plan ?? undefined,
    createdAt: dateString(row.created_at),
    decidedAt: nullableDate(row.decided_at)
  };
}

function mapEvidenceRow(row: any, goalId: string): PerformanceGoalEvidence {
  return {
    id: row.evidence_id,
    performanceGoalId: goalId,
    workout: mapWorkout(row),
    trainingSessionId: row.training_session_id ?? undefined,
    kind: row.kind,
    matchStatus: row.match_status,
    quality: row.quality ?? undefined,
    matchConfidence: row.match_confidence == null ? undefined : Number(row.match_confidence),
    impactSummary: row.impact_summary,
    createdAt: dateString(row.evidence_created_at),
    effortFeedback: row.effort_feedback ?? undefined,
    note: row.note ?? undefined
  };
}

function mapTrainingSessionAnalysis(row: any): TrainingSessionAnalysis {
  return {
    id: row.id,
    trainingSessionId: row.training_session_id,
    workoutId: row.workout_id,
    summary: row.summary,
    observations: Array.isArray(row.observations) ? row.observations : [],
    recommendation: row.recommendation,
    model: row.model,
    generatedAt: dateString(row.generated_at)
  };
}

export function performanceTrajectory(goal: PerformanceGoal, plan?: TrainingPlan): PerformanceGoalTrajectory {
  const original = goal.baselineSeconds;
  const current = goal.currentBenchmarkSeconds ?? goal.analysis.currentBestSeconds;
  const improvement = original != null && current != null ? Math.max(0, original - current) : 0;
  const totalPossible = original == null ? 0 : Math.max(0, original - goal.targetSeconds);
  const improvementPercent = totalPossible > 0 ? Math.min(1, improvement / totalPossible) : current != null && current <= goal.targetSeconds ? 1 : 0;
  const start = Date.parse(goal.createdAt);
  const deadline = Date.parse(`${goal.targetDate}T12:00:00Z`);
  const elapsedPercent = deadline > start ? Math.min(1, Math.max(0, (Date.now() - start) / (deadline - start))) : 1;
  const sessions = plan?.sessions.filter((item) => item.status !== "superseded") ?? [];
  const completed = sessions.filter((item) => item.status === "completed" || item.status === "partial").length;
  const due = sessions.filter((item) => Date.parse(`${item.scheduledDate}T23:59:59Z`) <= Date.now()).length;
  const adherence = due > 0 ? completed / due : 0;
  const achieved = current != null && current <= goal.targetSeconds;
  const status = achieved ? "achieved" : current == null ? "awaitingData" : improvementPercent >= elapsedPercent + 0.08 ? "ahead" : improvementPercent + 0.08 < elapsedPercent ? "behind" : "onTrack";
  return {
    originalBaselineSeconds: original,
    currentBenchmarkSeconds: current,
    improvementSeconds: improvement,
    remainingGapSeconds: current == null ? undefined : Math.max(0, current - goal.targetSeconds),
    elapsedPercent,
    improvementPercent,
    expectedImprovementPercent: elapsedPercent,
    adherencePercent: Math.min(1, adherence),
    completedSessions: completed,
    totalSessions: sessions.length,
    status
  };
}

export function sessionMatchScore(session: TrainingSession, workout: WorkoutSummary): number {
  const workoutDay = Date.parse(workout.startedAt.slice(0, 10) + "T12:00:00Z");
  const sessionDay = Date.parse(session.scheduledDate + "T12:00:00Z");
  const dayDifference = Math.abs(workoutDay - sessionDay) / 86_400_000;
  if (dayDifference > 2) return 0;
  let prescriptionScore = 0.65;
  if (session.distanceMeters != null) {
    const relativeDifference = Math.abs(workout.distanceMeters - session.distanceMeters) / session.distanceMeters;
    if (relativeDifference > 0.35) return 0;
    prescriptionScore = Math.max(0.25, 1 - relativeDifference / 0.35);
  } else if (session.durationSeconds != null) {
    const difference = Math.abs(workout.durationSeconds - session.durationSeconds);
    if (difference > session.durationSeconds * 0.3) return 0;
    prescriptionScore = Math.max(0.35, 1 - difference / (session.durationSeconds * 0.3));
  }
  const dateScore = 1 - dayDifference / 3;
  return Math.min(1, prescriptionScore * 0.75 + dateScore * 0.25);
}

export function sessionQuality(session: TrainingSession, workout: WorkoutSummary): "targetMet" | "completed" | "partial" {
  if (session.distanceMeters != null) {
    const tolerance = Math.max(100, session.distanceMeters * 0.05);
    if (Math.abs(workout.distanceMeters - session.distanceMeters) > tolerance) return "partial";
  }
  if (session.durationSeconds != null) {
    const difference = Math.abs(workout.durationSeconds - session.durationSeconds);
    if (difference > session.durationSeconds * 0.15) return "partial";
  }
  return session.type === "timeTrial" || session.type === "tempo" || session.type === "intervals" ? "targetMet" : "completed";
}

function normalizeTrainingPrescription(
  session: Omit<TrainingSession, "id" | "planId" | "status">,
  goalDistance: number,
  targetPace: number,
  currentPace: number
): Omit<TrainingSession, "id" | "planId" | "status"> {
  const maximumDistanceMultiplier = session.type === "longRun" ? 1.5 : session.type === "intervals" ? 1.25 : 1.2;
  const maximumDistance = Math.max(goalDistance, goalDistance * maximumDistanceMultiplier);
  const distanceMeters = session.distanceMeters == null ? undefined : Math.round(Math.min(session.distanceMeters, maximumDistance));
  const defaults: Record<string, [number, number, string]> = {
    easy: [currentPace + 35, currentPace + 75, "Settle into an even, conversational pace and keep every kilometre controlled."],
    recovery: [currentPace + 55, currentPace + 95, "Keep the effort relaxed and the splits even; speed is not the priority."],
    tempo: [Math.max(targetPace + 10, currentPace - 20), Math.max(targetPace + 25, currentPace), "Run controlled, even splits and avoid starting faster than the prescribed range."],
    intervals: [Math.max(1, targetPace - 12), targetPace + 5, "Hold the prescribed pace during each work interval and recover fully between repetitions."],
    longRun: [currentPace + 40, currentPace + 80, "Keep the opening conservative and aim for even splits through the final kilometre."],
    progression: [currentPace + 45, Math.max(targetPace + 10, currentPace - 10), "Begin at the slower end and gradually finish near the faster end of the range."],
    timeTrial: [targetPace, targetPace + 10, "Aim for even splits at target pace; avoid banking time in the opening kilometre."]
  };
  const fallback = defaults[session.type] ?? defaults.easy;
  const suppliedMin = session.targetPaceMinSecondsPerKm;
  const suppliedMax = session.targetPaceMaxSecondsPerKm;
  const lower = Math.max(1, Math.min(suppliedMin ?? fallback[0], suppliedMax ?? fallback[1]));
  const upper = Math.max(lower, Math.max(suppliedMin ?? fallback[0], suppliedMax ?? fallback[1]));
  return {
    ...session,
    distanceMeters,
    targetPaceMinSecondsPerKm: lower,
    targetPaceMaxSecondsPerKm: upper,
    pacingGuidance: session.pacingGuidance?.trim() || fallback[2]
  };
}

function formatDistance(meters: number): string {
  return meters === 21_097.5 ? "half marathon" : `${Number((meters / 1000).toFixed(1))} km`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remainder = Math.max(0, seconds) % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function generatedId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function performanceFeasibility(currentSeconds: number, targetSeconds: number): PerformanceGoalAnalysis["feasibility"] {
  const ratio = (currentSeconds - targetSeconds) / targetSeconds;
  return ratio <= 0.08 ? "onTrack" : ratio <= 0.2 ? "ambitious" : "stretch";
}

function mapUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    avatarColor: row.avatar_color,
    avatarURL: row.avatar_url,
    joinedAt: dateString(row.joined_at),
    searchable: row.searchable
  };
}

function mapSettings(row: any): UserSettings {
  return {
    userId: row.user_id,
    homeGoalId: row.home_goal_id ?? undefined,
    hideActivityFromFriends: row.hide_activity_from_friends,
    hideExactNumbers: row.hide_exact_numbers,
    searchable: row.searchable,
    pushMessages: row.push_messages,
    pushFriendRequests: row.push_friend_requests,
    pushChallenges: row.push_challenges,
    pushMilestones: row.push_milestones
  };
}

function mapFriendship(row: any): Friendship {
  return { id: row.id, requesterId: row.requester_id, addresseeId: row.addressee_id, status: row.status, createdAt: dateString(row.created_at), respondedAt: nullableDate(row.responded_at) };
}

function mapSummary(row: any): ActivitySummary {
  return {
    id: row.id,
    userId: row.user_id,
    localDate: dateString(row.local_date).slice(0, 10),
    timezone: row.timezone,
    steps: row.steps,
    walkingDistanceMeters: row.walking_distance_meters,
    runningDistanceMeters: row.running_distance_meters,
    workoutCount: row.workout_count,
    activeMinutes: row.active_minutes,
    calories: row.calories,
    source: row.source,
    trustLevel: row.trust_level,
    updatedAt: dateString(row.updated_at)
  };
}

function mapWorkout(row: any): WorkoutSummary {
  return {
    id: row.id,
    userId: row.user_id,
    healthkitUUID: row.healthkit_uuid,
    activityType: row.activity_type,
    startedAt: dateString(row.started_at),
    endedAt: dateString(row.ended_at),
    durationSeconds: row.duration_seconds,
    distanceMeters: row.distance_meters,
    calories: row.calories,
    source: row.source,
    trustLevel: row.trust_level,
    updatedAt: dateString(row.updated_at)
  };
}

function mapGoal(row: any): Goal {
  return { id: row.id, userId: row.user_id, kind: row.kind, cadence: row.cadence, target: row.target, isEnabled: row.is_enabled ?? true, createdAt: dateString(row.created_at) };
}

function mapStreak(row: any): Streak {
  return { userId: row.user_id, currentDays: row.current_days, bestDays: row.best_days, updatedAt: dateString(row.updated_at) };
}

function mapChallenge(row: any): Challenge {
  return {
    id: row.id,
    creatorId: row.creator_id,
    title: row.title,
    kind: row.kind,
    template: row.template,
    startsOn: dateString(row.starts_on).slice(0, 10),
    endsOn: dateString(row.ends_on).slice(0, 10),
    status: row.status,
    mode: row.mode ?? "competitive",
    target: row.target == null ? undefined : Number(row.target),
    participants: [],
    rematchOfChallengeId: row.rematch_of_challenge_id,
    sharedConversationId: row.shared_conversation_id,
    createdAt: dateString(row.created_at)
  };
}

function mapChallengeParticipant(row: any): Challenge["participants"][number] {
  return { userId: row.user_id, accepted: row.accepted, score: row.score, respondedAt: nullableDate(row.responded_at), teamId: row.team_id ?? undefined };
}

function mapFeedItem(row: any): FeedItem {
  return { id: row.id, userId: row.user_id, type: row.type, title: row.title, body: row.body, createdAt: dateString(row.created_at), reactions: [] };
}

function mapConversation(row: any): Conversation {
  return { id: row.id, kind: row.kind, title: row.title, createdBy: row.created_by, createdAt: dateString(row.created_at), mutedBy: [] };
}

function mapConversationMember(row: any): ConversationMember {
  return { conversationId: row.conversation_id, userId: row.user_id, role: row.role, joinedAt: dateString(row.joined_at), lastReadAt: nullableDate(row.last_read_at) };
}

function mapMessage(row: any): Message {
  return { id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, kind: row.kind, body: row.body, createdAt: dateString(row.created_at), readBy: [], reactions: [] };
}

function mapReaction(row: any): Reaction {
  return { id: row.id, targetType: row.target_type, targetId: row.target_id, userId: row.user_id, kind: row.kind, createdAt: dateString(row.created_at) };
}

function mapNotification(row: any): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    actorId: row.actor_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body,
    metadata: row.metadata ?? {},
    createdAt: dateString(row.created_at),
    readAt: nullableDate(row.read_at),
    archivedAt: nullableDate(row.archived_at),
    deduplicationKey: row.deduplication_key
  };
}

function mapBadge(row: any): Badge {
  return { id: row.id, title: row.title, emoji: row.emoji, ruleKind: row.rule_kind, threshold: row.threshold };
}

function mapUserBadge(row: any): UserBadge {
  return { id: row.id, userId: row.user_id, badgeId: row.badge_id, earnedAt: dateString(row.earned_at) };
}

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function nullableDate(value: unknown): string | undefined {
  return value ? dateString(value) : undefined;
}

function required<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`${label} was not found in the persistence snapshot`);
  return value;
}
