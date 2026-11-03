PRAGMA foreign_keys = ON;

CREATE TABLE families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Parent identity = Telegram user id. Tidak ada password/session di backend:
-- kanal Parent adalah bot Telegram, dan token bot hanya hidup di server.
CREATE TABLE family_members (
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  telegram_user_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (family_id, telegram_user_id)
);

-- Satu akun Telegram hanya mengelola satu keluarga pada MVP.
CREATE UNIQUE INDEX family_members_telegram_unique ON family_members (telegram_user_id);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  label TEXT NOT NULL,
  model TEXT,
  manufacturer TEXT,
  platform TEXT NOT NULL DEFAULT 'android',
  app_version TEXT,
  sdk_int INTEGER,
  installation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
  paired_at INTEGER,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (family_id, installation_id)
);

CREATE TABLE device_credentials (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  secret_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT 'device:self',
  created_at INTEGER NOT NULL,
  activated_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER
);

-- Satu credential aktif per device.
CREATE UNIQUE INDEX device_credentials_one_active
  ON device_credentials (device_id)
  WHERE activated_at IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE pairing_requests (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  created_by INTEGER NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_expires_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  verification_attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN
    ('OPEN', 'CLAIMED', 'LOCAL_CONFIRMED', 'APPROVED', 'REJECTED', 'EXPIRED')),
  device_id TEXT REFERENCES devices(id),
  claim_token_hash TEXT UNIQUE,
  claim_token_expires_at INTEGER,
  claim_secret_hash TEXT,
  verification_code TEXT,
  verification_expires_at INTEGER,
  device_label TEXT,
  device_model TEXT,
  device_manufacturer TEXT,
  app_version TEXT,
  sdk_int INTEGER,
  installation_id TEXT,
  local_confirmed_at INTEGER,
  approved_at INTEGER,
  rejected_at INTEGER,
  reject_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX pairing_requests_family_status ON pairing_requests (family_id, status, created_at);

-- Kontrol persisten untuk percobaan kode pairing yang salah, terpisah dari rate limit IP.
CREATE TABLE pairing_claim_attempts (
  code_hash TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE commands (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  type TEXT NOT NULL CHECK (type IN ('REQUEST_STATUS', 'LOCK_SCREEN')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL CHECK (state IN
    ('QUEUED', 'RECEIVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED')),
  requested_by INTEGER NOT NULL,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  received_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  delivery_count INTEGER NOT NULL DEFAULT 0,
  last_delivered_at INTEGER,
  lease_expires_at INTEGER,
  result_json TEXT,
  error_json TEXT,
  notified_at INTEGER,
  UNIQUE (requested_by, idempotency_key)
);

CREATE INDEX commands_device_state ON commands (device_id, state, created_at);
CREATE INDEX commands_state_expiry ON commands (state, expires_at);

CREATE TABLE command_results (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES commands(id),
  ack_id TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  error_json TEXT,
  observed_at INTEGER,
  recorded_at INTEGER NOT NULL,
  UNIQUE (command_id, ack_id)
);

CREATE TABLE device_status (
  device_id TEXT PRIMARY KEY REFERENCES devices(id),
  sequence INTEGER NOT NULL,
  battery_level INTEGER,
  charging INTEGER,
  network_connected INTEGER,
  backend_reachable INTEGER,
  screen_interactive INTEGER,
  keyguard_locked INTEGER,
  observed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  capabilities_json TEXT,
  app_version TEXT
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('PARENT', 'DEVICE', 'SYSTEM')),
  actor_id TEXT,
  device_id TEXT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE', 'DENIED')),
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX audit_logs_family_time ON audit_logs (family_id, created_at);

-- schema_migrations dibuat oleh runner (src/db/migrate.ts), bukan oleh file ini.
