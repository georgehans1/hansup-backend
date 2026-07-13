CREATE TABLE users (
  id text PRIMARY KEY,
  username text UNIQUE NOT NULL,
  display_name text NOT NULL,
  email text UNIQUE,
  phone text,
  avatar_color text,
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

CREATE TABLE goals (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  cadence text NOT NULL,
  target double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
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
