import { readFileSync } from "node:fs";
import { AppStore, createDemoStore, createEmptyStore, defaultBadges } from "./store.js";
import {
  ActivitySummary,
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
  UserSettings
} from "./domain.js";

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export class PostgresRepository {
  constructor(private readonly query: QueryFn) {}

  async migrate(schemaPath: string | URL = "src/schema.sql"): Promise<void> {
    const hasUsers = await this.query("select to_regclass('public.users') as name");
    if (!hasUsers.rows[0]?.name) {
      await this.query(readFileSync(schemaPath, "utf8"));
    }
    await this.ensureRuntimeTables();
  }

  async loadStore(): Promise<AppStore | undefined> {
    const users = (await this.query("select * from users order by joined_at, id")).rows.map(mapUser);
    if (users.length === 0) return undefined;

    const settings = (await this.query("select * from user_settings")).rows.map(mapSettings);
    const friendships = (await this.query("select * from friendships")).rows.map(mapFriendship);
    const summaries = (await this.query("select * from activity_summaries order by local_date")).rows.map(mapSummary);
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
      deviceTokens
    };
  }

  async saveStore(store: AppStore): Promise<void> {
    await this.clearDomainTables();

    for (const user of store.users) await this.insertUser(user);
    for (const settings of store.settings) await this.insertSettings(settings);
    for (const friendship of store.friendships) await this.insertFriendship(friendship);
    for (const summary of store.summaries) await this.insertSummary(summary);
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

  private async ensureRuntimeTables() {
    await this.query("create table if not exists message_reads (message_id text not null references messages(id) on delete cascade, user_id text not null references users(id) on delete cascade, primary key(message_id, user_id))");
    await this.query("create table if not exists conversation_mutes (conversation_id text not null references conversations(id) on delete cascade, user_id text not null references users(id) on delete cascade, primary key(conversation_id, user_id))");
    await this.query("create table if not exists blocked_users (blocker_id text not null references users(id) on delete cascade, blocked_id text not null references users(id) on delete cascade, created_at timestamptz not null default now(), primary key(blocker_id, blocked_id))");
  }

  private async clearDomainTables() {
    await this.query(
      `delete from message_reads;
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
       delete from activity_summaries;
       delete from blocked_users;
       delete from device_tokens;
       delete from friendships;
       delete from sessions;
       delete from oauth_identities;
       delete from user_settings;
       delete from users;`
    );
  }

  private insertUser(user: User) {
    return this.query(
      `insert into users (id, username, display_name, email, phone, avatar_color, joined_at, searchable)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set username = excluded.username, display_name = excluded.display_name,
         email = excluded.email, phone = excluded.phone, avatar_color = excluded.avatar_color, searchable = excluded.searchable`,
      [user.id, user.username, user.displayName, user.email, user.phone, user.avatarColor, user.joinedAt, user.searchable]
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
      "insert into goals (id, user_id, kind, cadence, target, created_at) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set kind = excluded.kind, cadence = excluded.cadence, target = excluded.target",
      [goal.id, goal.userId, goal.kind, goal.cadence, goal.target, goal.createdAt]
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
      `insert into challenges (id, creator_id, title, kind, template, starts_on, ends_on, status, rematch_of_challenge_id, shared_conversation_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set status = excluded.status, shared_conversation_id = excluded.shared_conversation_id`,
      [challenge.id, challenge.creatorId, challenge.title, challenge.kind, challenge.template, challenge.startsOn, challenge.endsOn, challenge.status, challenge.rematchOfChallengeId, challenge.sharedConversationId, challenge.createdAt]
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
    ssl: databaseUrl.includes("supabase.") || process.env.DATABASE_SSL === "true"
  });
  return new PostgresRepository((sql, params) => pool.query(sql, params));
}

export async function createProductionSeedStore(databaseUrl?: string, useDemoData = false): Promise<AppStore> {
  const { store } = await createProductionContext(databaseUrl, useDemoData);
  return store;
}

export async function createProductionContext(databaseUrl?: string, useDemoData = false): Promise<{ store: AppStore; persist: () => Promise<void> }> {
  if (!databaseUrl) {
    const store = useDemoData ? createDemoStore() : createEmptyStore();
    return { store, persist: async () => {} };
  }

  const repository = await createProductionRepository(databaseUrl);
  await repository.migrate();
  const store = (await repository.loadStore()) ?? (useDemoData ? createDemoStore() : createEmptyStore());
  store.badges = defaultBadges();
  await repository.saveStore(store);
  return {
    store,
    persist: () => repository.saveStore(store)
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

function mapGoal(row: any): Goal {
  return { id: row.id, userId: row.user_id, kind: row.kind, cadence: row.cadence, target: row.target, createdAt: dateString(row.created_at) };
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
