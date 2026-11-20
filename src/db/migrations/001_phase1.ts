import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE users (
      id uuid PRIMARY KEY,
      firebase_uid text NOT NULL UNIQUE,
      email text NOT NULL,
      first_name text NOT NULL,
      email_verified boolean NOT NULL DEFAULT false,
      tz text NOT NULL,
      socials jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email))`.execute(
    db,
  );

  await sql`
    CREATE TABLE locals (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL UNIQUE REFERENCES users (id),
      display_name text NOT NULL,
      role_title text NOT NULL,
      bio text NOT NULL,
      booking_label text,
      booking_price_minor integer,
      verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE markets (
      id text PRIMARY KEY,
      city text NOT NULL,
      country text NOT NULL,
      tz text NOT NULL,
      reset_time time NOT NULL,
      currency text NOT NULL,
      status text NOT NULL CHECK (status IN ('preview', 'open'))
    )`.execute(db);
  await sql`
    INSERT INTO markets (id, city, country, tz, reset_time, currency, status) VALUES
      ('new-york-city', 'New York City', 'US', 'America/New_York', '06:00', 'USD', 'open'),
      ('boston', 'Boston', 'US', 'America/New_York', '06:00', 'USD', 'open'),
      ('ellsworth-acadia', 'Ellsworth / Acadia', 'US', 'America/New_York', '06:00', 'USD', 'open'),
      ('kyoto', 'Kyoto', 'JP', 'Asia/Tokyo', '06:00', 'JPY', 'preview'),
      ('sigiriya', 'Sigiriya', 'LK', 'Asia/Colombo', '06:00', 'LKR', 'preview')`.execute(
    db,
  );

  await sql`
    CREATE TABLE media (
      id uuid PRIMARY KEY,
      owner_user_id uuid REFERENCES users (id),
      owner_device_hash text,
      content_type text NOT NULL,
      s3_key text NOT NULL,
      width integer,
      height integer,
      status text NOT NULL CHECK (status IN ('pending', 'ready', 'rejected')),
      reject_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT media_one_owner CHECK ((owner_user_id IS NOT NULL) <> (owner_device_hash IS NOT NULL))
    )`.execute(db);

  await sql`
    CREATE TABLE drops (
      id uuid PRIMARY KEY,
      local_id uuid NOT NULL REFERENCES locals (id),
      market_id text NOT NULL REFERENCES markets (id),
      title text NOT NULL,
      why_now text NOT NULL,
      perfect_for text NOT NULL,
      cost_min_usd integer NOT NULL,
      cost_max_usd integer NOT NULL,
      time_minutes integer NOT NULL,
      best_time text,
      watch_out text NOT NULL,
      photo_media_id uuid NOT NULL REFERENCES media (id),
      photo_is_stand_in boolean NOT NULL DEFAULT false,
      fuzzy_area text NOT NULL,
      unlock_price_minor integer NOT NULL,
      unlock_cap integer NOT NULL,
      window_hours integer NOT NULL,
      status text NOT NULL,
      approved_at timestamptz,
      expires_at timestamptz,
      unlocks_used integer NOT NULL DEFAULT 0,
      window_date date,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT drops_cost_min_range CHECK (cost_min_usd BETWEEN 0 AND 1000),
      CONSTRAINT drops_cost_max_range CHECK (cost_max_usd BETWEEN 0 AND 1000),
      CONSTRAINT drops_cost_order CHECK (cost_max_usd >= cost_min_usd),
      CONSTRAINT drops_time_minutes CHECK (time_minutes BETWEEN 15 AND 720 AND time_minutes % 15 = 0),
      CONSTRAINT drops_window_hours CHECK (window_hours IN (3, 6, 12, 24, 48, 72)),
      CONSTRAINT drops_unlock_cap CHECK (unlock_cap BETWEEN 1 AND 20),
      CONSTRAINT drops_unlock_price CHECK (unlock_price_minor IN (100, 200, 300)),
      CONSTRAINT drops_status CHECK (status IN ('draft', 'pending', 'live', 'paused', 'gone', 'rejected', 'removed'))
    )`.execute(db);
  await sql`CREATE INDEX drops_market_status_expires_idx ON drops (market_id, status, expires_at)`.execute(
    db,
  );
  await sql`CREATE INDEX drops_local_status_idx ON drops (local_id, status)`.execute(
    db,
  );

  await sql`
    CREATE TABLE drop_private (
      drop_id uuid PRIMARY KEY REFERENCES drops (id),
      exact_place text NOT NULL,
      meet_detail text
    )`.execute(db);

  await sql`
    CREATE TABLE guest_identities (
      id uuid PRIMARY KEY,
      email text NOT NULL,
      claim_hash text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE events (
      id uuid PRIMARY KEY,
      owner_user_id uuid REFERENCES users (id),
      guest_identity_id uuid REFERENCES guest_identities (id),
      market_id text NOT NULL REFERENCES markets (id),
      name text NOT NULL,
      category text NOT NULL CHECK (category IN ('tasting', 'walk', 'market', 'class', 'gathering')),
      description text NOT NULL,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz,
      date_note text,
      area text NOT NULL,
      address_visibility text CHECK (address_visibility IN ('public', 'after_rsvp')),
      photo_media_id uuid REFERENCES media (id),
      link text,
      capacity integer,
      host_name text NOT NULL,
      host_badge text NOT NULL CHECK (host_badge IN ('verified_local', 'community_host')),
      status text NOT NULL CHECK (status IN ('pending', 'upcoming', 'past', 'cancelled', 'rejected', 'removed')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT events_one_owner CHECK ((owner_user_id IS NOT NULL) <> (guest_identity_id IS NOT NULL)),
      CONSTRAINT events_ends_window CHECK (ends_at IS NULL OR (ends_at > starts_at AND ends_at <= starts_at + interval '24 hours')),
      CONSTRAINT events_capacity CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 500)
    )`.execute(db);
  await sql`CREATE INDEX events_market_status_starts_idx ON events (market_id, status, starts_at)`.execute(
    db,
  );

  await sql`
    CREATE TABLE event_private (
      event_id uuid PRIMARY KEY REFERENCES events (id),
      exact_address text NOT NULL
    )`.execute(db);

  await sql`
    CREATE TABLE review_items (
      id uuid PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('drop', 'event')),
      ref_id uuid NOT NULL,
      state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected', 'removed')),
      reason text,
      flags text[] NOT NULL DEFAULT '{}',
      submitted_at timestamptz NOT NULL DEFAULT now(),
      decided_at timestamptz,
      reviewer_id uuid
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX review_items_one_pending_idx ON review_items (kind, ref_id) WHERE state = 'pending'`.execute(
    db,
  );
  await sql`CREATE INDEX review_items_state_submitted_idx ON review_items (state, submitted_at)`.execute(
    db,
  );

  await sql`
    CREATE TABLE outbox (
      id uuid PRIMARY KEY,
      type text NOT NULL,
      subject_kind text NOT NULL,
      subject_id uuid NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      published_at timestamptz
    )`.execute(db);
  await sql`CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL`.execute(
    db,
  );

  await sql`
    CREATE TABLE rate_events (
      id bigserial PRIMARY KEY,
      kind text NOT NULL,
      key_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX rate_events_kind_key_created_idx ON rate_events (kind, key_hash, created_at)`.execute(
    db,
  );

  await sql`
    CREATE TABLE audit_log (
      id uuid PRIMARY KEY,
      actor_id uuid,
      action text NOT NULL,
      target_kind text NOT NULL,
      target_id uuid NOT NULL,
      diff jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  // Roles are cluster-wide: create only if absent. Grants are (re)applied every migration run.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'raahi_public_read') THEN
        CREATE ROLE raahi_public_read NOLOGIN;
      END IF;
    END
    $$`.execute(db);
  await sql`GRANT USAGE ON SCHEMA public TO raahi_public_read`.execute(db);
  await sql`GRANT SELECT ON markets, drops TO raahi_public_read`.execute(db);
  await sql`GRANT SELECT (id, content_type, s3_key, width, height, status) ON media TO raahi_public_read`.execute(
    db,
  );
  await sql`
    GRANT SELECT (id, display_name, role_title, bio, booking_label, booking_price_minor, verified_at)
    ON locals TO raahi_public_read`.execute(db);
  await sql`
    GRANT SELECT (id, market_id, name, category, description, starts_at, ends_at, date_note, area,
      address_visibility, photo_media_id, link, capacity, host_name, host_badge, status, created_at, updated_at)
    ON events TO raahi_public_read`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of [
    'audit_log',
    'rate_events',
    'outbox',
    'review_items',
    'event_private',
    'events',
    'guest_identities',
    'drop_private',
    'drops',
    'media',
    'markets',
    'locals',
    'users',
  ]) {
    await sql`DROP TABLE IF EXISTS ${sql.table(t)} CASCADE`.execute(db);
  }
}
