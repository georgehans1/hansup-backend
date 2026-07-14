import { readFileSync } from "node:fs";
import { info } from "./logger.js";
import { AppStore, createDemoStore, createEmptyStore, defaultBadges } from "./store.js";
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
  | { kind: "conversation"; conversationId: string }
  | { kind: "message"; messageId: string }
  | { kind: "conversation-read"; conversationId: string; userId: string }
  | { kind: "conversation-settings"; conversationId: string; userId: string }
  | { kind: "conversation-leave"; conversationId: string; userId: string }
  | { kind: "reaction"; reactionId: string }
  | { kind: "challenge"; challengeId: string; includeSharedMessages?: boolean }
  | { kind: "device"; userId: string; token: string }
  | { kind: "report"; reportId: string }
  | { kind: "notifications" }
  | { kind: "notification-delete"; notificationId: string; userId: string };

export class PostgresRepository {
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
    for (const settings of store.settings) await this.insertSettings(settings);
    for (const friendship of store.friendships) await this.insertFriendship(friendship);
    for (const summary of store.summaries) await this.insertSummary(summary);
    for (const workout of store.workouts) await this.insertWorkout(workout);
    for (const goal of store.goals) await this.insertGoal(goal);
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
        const settings = store.settings.find((item) => item.userId === change.userId);
        if (settings) await this.insertSettings(settings);
        const streak = store.streaks.find((item) => item.userId === change.userId);
        if (streak) await this.insertStreak(streak);
        for (const goal of store.goals.filter((item) => item.userId === change.userId)) await this.insertGoal(goal);
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

  async seedBadges(badges: Badge[]): Promise<void> {
    for (const badge of badges) await this.insertBadge(badge);
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
    const streak = store.streaks.find((item) => item.userId === userId);
    if (streak) await this.insertStreak(streak);
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
        (user_id, hide_activity_from_friends, hide_exact_numbers, searchable, push_messages, push_friend_requests, push_challenges, push_milestones)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (user_id) do update set hide_activity_from_friends = excluded.hide_activity_from_friends,
         hide_exact_numbers = excluded.hide_exact_numbers, searchable = excluded.searchable, push_messages = excluded.push_messages,
         push_friend_requests = excluded.push_friend_requests, push_challenges = excluded.push_challenges, push_milestones = excluded.push_milestones`,
      [settings.userId, settings.hideActivityFromFriends, settings.hideExactNumbers, settings.searchable, settings.pushMessages, settings.pushFriendRequests, settings.pushChallenges, settings.pushMilestones]
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
      "insert into challenge_participants (challenge_id, user_id, accepted, score, responded_at) values ($1, $2, $3, $4, $5) on conflict (challenge_id, user_id) do update set accepted = excluded.accepted, score = excluded.score, responded_at = excluded.responded_at",
      [challengeId, participant.userId, participant.accepted, participant.score, participant.respondedAt]
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

export async function createProductionContext(databaseUrl?: string, useDemoData = false): Promise<{ store: AppStore; persist: (change: PersistenceChange) => Promise<void> }> {
  if (!databaseUrl) {
    const store = useDemoData ? createDemoStore() : createEmptyStore();
    return { store, persist: async () => {} };
  }

  const repository = await createProductionRepository(databaseUrl);
  await repository.migrate();
  const loadedStore = await repository.loadStore();
  const store = loadedStore ?? (useDemoData ? createDemoStore() : createEmptyStore());
  const badges = defaultBadges();
  store.badges = badges;
  if (loadedStore) {
    await repository.seedBadges(badges);
  } else {
    await repository.saveStore(store);
  }
  return {
    store,
    persist: (change) => repository.persistChange(store, change)
  };
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
  return { userId: row.user_id, accepted: row.accepted, score: row.score, respondedAt: nullableDate(row.responded_at) };
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
