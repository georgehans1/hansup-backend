CREATE TABLE users (
  id text PRIMARY KEY,
  username text UNIQUE NOT NULL,
  display_name text NOT NULL,
  email text UNIQUE,
  phone text,
  avatar_color text,
  avatar_url text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  searchable boolean NOT NULL DEFAULT true
);

CREATE TABLE oauth_identities (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_subject)
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE user_settings (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  home_goal_id text,
  hide_activity_from_friends boolean NOT NULL DEFAULT false,
  hide_exact_numbers boolean NOT NULL DEFAULT false,
  searchable boolean NOT NULL DEFAULT true,
  push_messages boolean NOT NULL DEFAULT true,
  push_friend_requests boolean NOT NULL DEFAULT true,
  push_challenges boolean NOT NULL DEFAULT true,
  push_milestones boolean NOT NULL DEFAULT true
);

CREATE TABLE friendships (
  id text PRIMARY KEY,
  requester_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE(requester_id, addressee_id)
);

CREATE TABLE activity_summaries (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  timezone text NOT NULL,
  steps integer NOT NULL DEFAULT 0,
  walking_distance_meters double precision NOT NULL DEFAULT 0,
  running_distance_meters double precision NOT NULL DEFAULT 0,
  workout_count integer NOT NULL DEFAULT 0,
  active_minutes integer NOT NULL DEFAULT 0,
  calories integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'healthkit',
  trust_level text NOT NULL DEFAULT 'verified',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, local_date, source)
);

CREATE TABLE workout_summaries (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  healthkit_uuid text NOT NULL,
  activity_type text NOT NULL CHECK (activity_type IN ('walking', 'running', 'strengthTraining')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  duration_seconds double precision NOT NULL DEFAULT 0,
  distance_meters double precision NOT NULL DEFAULT 0,
  calories double precision NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'healthkit',
  trust_level text NOT NULL DEFAULT 'verified',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, healthkit_uuid)
);

CREATE TABLE workout_heart_rate_summaries (
  workout_id text PRIMARY KEY REFERENCES workout_summaries(id) ON DELETE CASCADE,
  average_bpm double precision NOT NULL,
  minimum_bpm double precision NOT NULL,
  maximum_bpm double precision NOT NULL,
  sample_count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workout_heart_rate_points (
  workout_id text NOT NULL REFERENCES workout_summaries(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,
  bpm double precision NOT NULL,
  sample_count integer NOT NULL,
  PRIMARY KEY (workout_id, recorded_at)
);

CREATE INDEX workout_heart_rate_points_workout_time_idx ON workout_heart_rate_points(workout_id, recorded_at);

CREATE TABLE workout_splits (
  workout_id text NOT NULL REFERENCES workout_summaries(id) ON DELETE CASCADE,
  unit text NOT NULL CHECK (unit IN ('kilometer', 'mile')),
  split_index integer NOT NULL,
  distance_meters double precision NOT NULL,
  duration_seconds double precision NOT NULL,
  pace_seconds_per_km double precision NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  is_partial boolean NOT NULL DEFAULT false,
  average_heart_rate_bpm double precision,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workout_id, unit, split_index)
);

CREATE TABLE goals (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  cadence text NOT NULL,
  target double precision NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE goal_versions (
  goal_id text NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  cadence text NOT NULL,
  target double precision NOT NULL,
  effective_date date NOT NULL,
  PRIMARY KEY (goal_id, effective_date)
);

CREATE TABLE goal_streaks (
  goal_id text PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cadence text NOT NULL,
  current_count integer NOT NULL DEFAULT 0,
  best_count integer NOT NULL DEFAULT 0,
  last_completed_period date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE performance_goals (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  distance_meters double precision NOT NULL,
  target_seconds integer NOT NULL,
  target_date date NOT NULL,
  training_days_per_week integer NOT NULL,
  preferred_long_run_day integer NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'completed', 'abandoned', 'archived')),
  consent_version text NOT NULL,
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX performance_goals_one_active_per_user ON performance_goals(user_id) WHERE status = 'active';

CREATE TABLE performance_goal_milestones (
  id text PRIMARY KEY,
  performance_goal_id text NOT NULL REFERENCES performance_goals(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  target_seconds integer NOT NULL,
  target_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'missed')),
  completed_workout_id text REFERENCES workout_summaries(id) ON DELETE SET NULL,
  UNIQUE(performance_goal_id, sequence)
);

CREATE TABLE training_plans (
  id text PRIMARY KEY,
  performance_goal_id text NOT NULL REFERENCES performance_goals(id) ON DELETE CASCADE,
  version integer NOT NULL,
  model text NOT NULL,
  summary text NOT NULL,
  gap_explanation text NOT NULL,
  recovery_guidance text NOT NULL,
  caution text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(performance_goal_id, version)
);

CREATE TABLE training_sessions (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  purpose text NOT NULL,
  distance_meters double precision,
  duration_seconds integer,
  effort text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'skipped')),
  linked_workout_id text REFERENCES workout_summaries(id) ON DELETE SET NULL
);

CREATE TABLE coach_generations (
  id text PRIMARY KEY,
  performance_goal_id text NOT NULL REFERENCES performance_goals(id) ON DELETE CASCADE,
  input_fingerprint text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL,
  model text NOT NULL,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE streaks (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_days integer NOT NULL DEFAULT 0,
  best_days integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE challenges (
  id text PRIMARY KEY,
  creator_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL,
  template text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL,
  mode text NOT NULL DEFAULT 'competitive',
  target double precision,
  rematch_of_challenge_id text REFERENCES challenges(id),
  shared_conversation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE challenge_participants (
  challenge_id text NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted boolean NOT NULL DEFAULT false,
  score double precision NOT NULL DEFAULT 0,
  responded_at timestamptz,
  team_id text,
  PRIMARY KEY(challenge_id, user_id)
);

CREATE TABLE conversations (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('direct', 'group')),
  title text,
  created_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_members (
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  muted boolean NOT NULL DEFAULT false,
  PRIMARY KEY(conversation_id, user_id)
);

CREATE TABLE messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id text REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('user', 'system')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reactions (
  id text PRIMARY KEY,
  target_type text NOT NULL CHECK (target_type IN ('feed', 'message')),
  target_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feed_items (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE badges (
  id text PRIMARY KEY,
  title text NOT NULL,
  emoji text NOT NULL,
  rule_kind text NOT NULL,
  threshold double precision NOT NULL
);

CREATE TABLE user_badges (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id text NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, badge_id)
);

CREATE TABLE device_tokens (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'ios',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, token)
);

CREATE TABLE reports (
  id text PRIMARY KEY,
  reporter_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('user', 'message')),
  target_id text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
