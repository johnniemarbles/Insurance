-- =====================================================================
-- Gmail CRM + LMS : PostgreSQL schema v0.1  (matches PRD v0.9)
-- Target: PostgreSQL 15+ (uses security_invoker views).
--
-- Deployment model
--   * One database per region: 'ca-qc' (Quebec) and 'us'. A tenant is one
--     company in one country and lives only in its region's database.
--   * Run the app as role app_runtime (NOBYPASSRLS). After auth, the API runs
--     SET LOCAL app.tenant_id / app.user_id / app.node_ids /
--     app.is_tenant_admin / app.can_write for every transaction.
--   * Login (finding the tenant from an email or Google id) uses a separate
--     auth role that can read app_users only. It never touches CRM/LMS data.
--
-- Visibility model (PRD 6B)
--   * Org graph: tenant > location > partner > sub-partner (multi-parent).
--   * CRM records: visible to the owner node, partner-chain ancestors of the
--     owner, the record's context location, and tenant admins. Siblings never.
--   * LMS records: visible by reach (location -> linked partners -> sub-partners).
--   * Gmail tokens and scheduled sends: the owning user only. Never ancestors.
-- =====================================================================


CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), gen_random_bytes()
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- 0. Types
-- ---------------------------------------------------------------------
CREATE TYPE region_code    AS ENUM ('ca-qc', 'us');
CREATE TYPE locale_code    AS ENUM ('en', 'fr-CA');
CREATE TYPE org_node_type  AS ENUM ('tenant', 'location', 'partner');   -- sub-partner = partner with a partner_link parent
CREATE TYPE org_link_kind  AS ENUM ('location_link', 'partner_link');
CREATE TYPE org_role       AS ENUM ('admin', 'manager', 'trainer', 'member', 'learner');
CREATE TYPE user_status    AS ENUM ('invited', 'active', 'disabled');
CREATE TYPE lesson_type    AS ENUM ('video', 'file', 'richtext', 'link', 'quiz', 'scorm');  -- scorm = P1
CREATE TYPE course_status  AS ENUM ('draft', 'published', 'archived');

-- ---------------------------------------------------------------------
-- 1. Deployment, tenants, settings
-- ---------------------------------------------------------------------
CREATE TABLE deployment_info (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  region    region_code NOT NULL,           -- INSERT once per deployment
  environment text NOT NULL DEFAULT 'dev' CHECK (environment IN ('dev', 'staging', 'prod')),
  -- Set to true only after someone confirms the host is physically in the region
  -- (ca-qc = Quebec). Until then, a prod deployment refuses to create tenants.
  -- Dev on a host outside the region must hold synthetic data only.
  physical_region_verified boolean NOT NULL DEFAULT false
);

CREATE TABLE tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  country_code   char(2) NOT NULL CHECK (country_code IN ('CA', 'US')),
  region         region_code NOT NULL,
  default_locale locale_code NOT NULL DEFAULT 'en',
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_country_region CHECK (
    (country_code = 'CA' AND region = 'ca-qc') OR (country_code = 'US' AND region = 'us'))
);

-- A tenant can only be created in the database of its own region (residency guard).
CREATE FUNCTION tenants_region_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.region IS DISTINCT FROM (SELECT region FROM deployment_info) THEN
    RAISE EXCEPTION 'Residency violation: tenant region % does not match this deployment', NEW.region;
  END IF;
  IF EXISTS (SELECT 1 FROM deployment_info WHERE environment = 'prod' AND NOT physical_region_verified) THEN
    RAISE EXCEPTION 'Residency violation: production deployment is not verified as physically in region %', NEW.region;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenants_region_guard BEFORE INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_region_guard();

CREATE TABLE tenant_settings (
  tenant_id                   uuid PRIMARY KEY REFERENCES tenants(id),
  max_partner_levels          int  NOT NULL DEFAULT 5 CHECK (max_partner_levels BETWEEN 1 AND 5),
  email_open_tracking_allowed boolean NOT NULL DEFAULT false,   -- admins can disable entirely
  email_open_tracking_default boolean NOT NULL DEFAULT false CHECK (NOT email_open_tracking_default),  -- decided: off by default
  notice_version              text NOT NULL DEFAULT 'v1'        -- current consent notice (Appendix A)
);

-- ---------------------------------------------------------------------
-- 2. Organization graph
-- ---------------------------------------------------------------------
CREATE TABLE org_nodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  type        org_node_type NOT NULL,
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,       -- deactivate, never delete (history)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX one_root_per_tenant ON org_nodes (tenant_id) WHERE type = 'tenant';
CREATE INDEX ON org_nodes (tenant_id, type);

CREATE TABLE org_links (
  tenant_id  uuid NOT NULL,
  parent_id  uuid NOT NULL,
  child_id   uuid NOT NULL,
  kind       org_link_kind NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_id, child_id),
  FOREIGN KEY (parent_id, tenant_id) REFERENCES org_nodes (id, tenant_id),
  FOREIGN KEY (child_id,  tenant_id) REFERENCES org_nodes (id, tenant_id),
  CHECK (parent_id <> child_id)
);
CREATE INDEX ON org_links (child_id);

-- Closure over partner_link edges only (partner -> sub-partner), self rows included.
-- path_count lets us remove one of several parent links safely (multi-parent DAG).
CREATE TABLE org_partner_closure (
  tenant_id     uuid NOT NULL,
  ancestor_id   uuid NOT NULL,
  descendant_id uuid NOT NULL,
  path_count    int  NOT NULL CHECK (path_count >= 0),   -- 0 only transiently; rows at 0 are deleted
  PRIMARY KEY (ancestor_id, descendant_id),
  FOREIGN KEY (ancestor_id,   tenant_id) REFERENCES org_nodes (id, tenant_id),
  FOREIGN KEY (descendant_id, tenant_id) REFERENCES org_nodes (id, tenant_id)
);
CREATE INDEX ON org_partner_closure (descendant_id);

-- Every partner node gets its self row.
CREATE FUNCTION org_partner_self_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO org_partner_closure (tenant_id, ancestor_id, descendant_id, path_count)
  VALUES (NEW.tenant_id, NEW.id, NEW.id, 1);
  RETURN NEW;
END $$;
CREATE TRIGGER org_partner_self_row AFTER INSERT ON org_nodes
  FOR EACH ROW WHEN (NEW.type = 'partner') EXECUTE FUNCTION org_partner_self_row();

-- Validate links: node types, no cycles, depth cap (default 5 partner levels).
CREATE FUNCTION org_links_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p_type org_node_type; c_type org_node_type; levels_up int; levels_down int; max_lv int;
BEGIN
  SELECT type INTO p_type FROM org_nodes WHERE id = NEW.parent_id;
  SELECT type INTO c_type FROM org_nodes WHERE id = NEW.child_id;

  IF NEW.kind = 'location_link' THEN
    IF NOT (p_type = 'location' AND c_type = 'partner') THEN
      RAISE EXCEPTION 'location_link must go from a location to a partner';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (p_type = 'partner' AND c_type = 'partner') THEN
    RAISE EXCEPTION 'partner_link must go from a partner to a partner';
  END IF;
  IF EXISTS (SELECT 1 FROM org_partner_closure
             WHERE ancestor_id = NEW.child_id AND descendant_id = NEW.parent_id) THEN
    RAISE EXCEPTION 'Cycle rejected: parent is already a descendant of child';
  END IF;

  SELECT coalesce(max(max_partner_levels), 5) INTO max_lv
    FROM tenant_settings WHERE tenant_id = NEW.tenant_id;

  WITH RECURSIVE up(id, lvl) AS (
    SELECT NEW.parent_id, 1
    UNION ALL
    SELECT l.parent_id, up.lvl + 1 FROM org_links l JOIN up ON l.child_id = up.id
    WHERE l.kind = 'partner_link')
  SELECT max(lvl) INTO levels_up FROM up;

  WITH RECURSIVE down(id, lvl) AS (
    SELECT NEW.child_id, 1
    UNION ALL
    SELECT l.child_id, down.lvl + 1 FROM org_links l JOIN down ON l.parent_id = down.id
    WHERE l.kind = 'partner_link')
  SELECT max(lvl) INTO levels_down FROM down;

  IF levels_up + levels_down > max_lv THEN
    RAISE EXCEPTION 'Partner depth cap exceeded (% levels allowed)', max_lv;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER org_links_validate BEFORE INSERT ON org_links
  FOR EACH ROW EXECUTE FUNCTION org_links_validate();

-- Closure maintenance: ancestors-of-parent x descendants-of-child.
CREATE FUNCTION org_links_closure_add() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> 'partner_link' THEN RETURN NEW; END IF;
  INSERT INTO org_partner_closure (tenant_id, ancestor_id, descendant_id, path_count)
  SELECT NEW.tenant_id, a.ancestor_id, d.descendant_id, a.path_count * d.path_count
  FROM org_partner_closure a, org_partner_closure d
  WHERE a.descendant_id = NEW.parent_id AND d.ancestor_id = NEW.child_id
  ON CONFLICT (ancestor_id, descendant_id)
  DO UPDATE SET path_count = org_partner_closure.path_count + EXCLUDED.path_count;
  RETURN NEW;
END $$;
CREATE TRIGGER org_links_closure_add AFTER INSERT ON org_links
  FOR EACH ROW EXECUTE FUNCTION org_links_closure_add();

CREATE FUNCTION org_links_closure_remove() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind <> 'partner_link' THEN RETURN OLD; END IF;
  UPDATE org_partner_closure c SET path_count = c.path_count - x.n
  FROM (SELECT a.ancestor_id, d.descendant_id, a.path_count * d.path_count AS n
        FROM org_partner_closure a, org_partner_closure d
        WHERE a.descendant_id = OLD.parent_id AND d.ancestor_id = OLD.child_id) x
  WHERE c.ancestor_id = x.ancestor_id AND c.descendant_id = x.descendant_id;
  DELETE FROM org_partner_closure WHERE path_count = 0;
  RETURN OLD;
END $$;
CREATE TRIGGER org_links_closure_remove AFTER DELETE ON org_links
  FOR EACH ROW EXECUTE FUNCTION org_links_closure_remove();

-- "Reach": who is above whom, for LMS visibility and course availability.
--   tenant -> everything; location -> linked partners and their sub-partners;
--   partner -> itself and its sub-partners.
CREATE VIEW org_reach WITH (security_invoker = true) AS
  SELECT tenant_id, ancestor_id, descendant_id FROM org_partner_closure
  UNION
  SELECT l.tenant_id, l.parent_id, c.descendant_id
    FROM org_links l JOIN org_partner_closure c ON c.ancestor_id = l.child_id
   WHERE l.kind = 'location_link'
  UNION
  SELECT n.tenant_id, r.id, n.id
    FROM org_nodes n JOIN org_nodes r ON r.tenant_id = n.tenant_id AND r.type = 'tenant'
  UNION
  SELECT tenant_id, id, id FROM org_nodes WHERE type = 'location';

-- ---------------------------------------------------------------------
-- 3. Users, roles, invitations, consent (invite-only: no self-registration)
-- ---------------------------------------------------------------------
CREATE TABLE app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  email         citext NOT NULL,
  display_name  text,
  google_sub    text,
  locale        locale_code NOT NULL DEFAULT 'en',
  status        user_status NOT NULL DEFAULT 'invited',
  home_node_id  uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  UNIQUE (tenant_id, email),                 -- same broker in two tenants = two separate accounts
  UNIQUE (id, tenant_id),
  FOREIGN KEY (home_node_id, tenant_id) REFERENCES org_nodes (id, tenant_id)
);

CREATE TABLE user_node_roles (
  tenant_id uuid NOT NULL,
  user_id   uuid NOT NULL,
  node_id   uuid NOT NULL,
  role      org_role NOT NULL,
  PRIMARY KEY (user_id, node_id, role),
  FOREIGN KEY (user_id, tenant_id) REFERENCES app_users (id, tenant_id),
  FOREIGN KEY (node_id, tenant_id) REFERENCES org_nodes (id, tenant_id)
);

CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  email       citext NOT NULL,
  node_id     uuid NOT NULL REFERENCES org_nodes(id),
  role        org_role NOT NULL DEFAULT 'member',
  locale      locale_code NOT NULL DEFAULT 'en',
  token_hash  bytea NOT NULL UNIQUE,         -- store a hash, never the token
  invited_by  uuid REFERENCES app_users(id),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz
);

CREATE TABLE consent_records (               -- Appendix A notices
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  user_id        uuid NOT NULL REFERENCES app_users(id),
  kind           text NOT NULL CHECK (kind IN ('first_login', 'link_thread')),
  notice_version text NOT NULL,
  locale         locale_code NOT NULL,
  region         region_code NOT NULL,
  accepted_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 4. Session helpers and visibility functions (used by RLS)
-- ---------------------------------------------------------------------
CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app_node_ids() RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('app.node_ids', true), '')::uuid[], '{}'::uuid[]) $$;
CREATE FUNCTION app_is_tenant_admin() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('app.is_tenant_admin', true), 'false') = 'true' $$;
CREATE FUNCTION app_can_write() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('app.can_write', true), 'false') = 'true' $$;

-- CRM rule: owner node, partner-chain ancestors of the owner, the context location, tenant admin.
CREATE FUNCTION crm_row_visible(p_tenant uuid, p_owner uuid, p_context uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_tenant = app_tenant_id() AND (
       app_is_tenant_admin()
    OR p_owner = ANY (app_node_ids())
    OR (p_context IS NOT NULL AND p_context = ANY (app_node_ids()))
    OR EXISTS (SELECT 1 FROM org_partner_closure c
               WHERE c.descendant_id = p_owner AND c.ancestor_id = ANY (app_node_ids())))
$$;

-- LMS rule: the node itself or anything that reaches it (location -> linked partners -> sub-partners).
CREATE FUNCTION lms_node_visible(p_tenant uuid, p_node uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_tenant = app_tenant_id() AND (
       app_is_tenant_admin()
    OR p_node = ANY (app_node_ids())
    OR EXISTS (SELECT 1 FROM org_reach r
               WHERE r.descendant_id = p_node AND r.ancestor_id = ANY (app_node_ids())))
$$;

-- Pipelines and courses are defined at a node and usable by everything beneath it,
-- and visible to everything above it. Drafts and private pipelines: owner chain only.
CREATE FUNCTION shared_down_visible(p_tenant uuid, p_owner uuid, p_shared boolean)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_tenant = app_tenant_id() AND (
       app_is_tenant_admin()
    OR p_owner = ANY (app_node_ids())
    OR EXISTS (SELECT 1 FROM org_reach r                        -- viewer is above the owner
               WHERE r.descendant_id = p_owner AND r.ancestor_id = ANY (app_node_ids()))
    OR (p_shared AND EXISTS (SELECT 1 FROM org_reach r          -- viewer is beneath the owner
               WHERE r.ancestor_id = p_owner AND r.descendant_id = ANY (app_node_ids()))))
$$;

-- A record's context must be a location linked to the owner or one of its partner-chain ancestors.
CREATE FUNCTION context_allowed(p_owner uuid, p_context uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_context IS NULL OR EXISTS (
    SELECT 1 FROM org_links l
    JOIN org_partner_closure c ON c.ancestor_id = l.child_id AND c.descendant_id = p_owner
    WHERE l.kind = 'location_link' AND l.parent_id = p_context)
$$;
CREATE FUNCTION trg_validate_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT context_allowed(NEW.owner_node_id, NEW.context_node_id) THEN
    RAISE EXCEPTION 'context_node_id must be a location linked to the owner chain';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 5. Audit log (append-only; ancestor views are logged here too)
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id     uuid NOT NULL,
  actor_user_id uuid,
  action        text NOT NULL,         -- e.g. link_changed, ancestor_view, thread_linked, consent_accepted
  entity_type   text,
  entity_id     uuid,
  owner_node_id uuid,
  detail        jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;   -- add monthly partitions in ops
CREATE INDEX ON audit_log (tenant_id, created_at DESC);
CREATE INDEX ON audit_log (tenant_id, entity_type, entity_id);

-- ---------------------------------------------------------------------
-- 6. CRM
-- ---------------------------------------------------------------------
CREATE TABLE pipelines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  owner_node_id uuid NOT NULL REFERENCES org_nodes(id),
  name          text NOT NULL,
  is_shared_down boolean NOT NULL DEFAULT false,   -- usable by nodes beneath the owner
  created_by    uuid REFERENCES app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name        text NOT NULL,
  position    int  NOT NULL,
  is_won      boolean NOT NULL DEFAULT false,
  is_lost     boolean NOT NULL DEFAULT false,
  UNIQUE (pipeline_id, position)
);

CREATE TABLE field_defs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  key         text NOT NULL,
  labels      jsonb NOT NULL,            -- {"en": "...", "fr-CA": "..."}
  type        text NOT NULL CHECK (type IN ('text','number','date','dropdown','checkbox','currency')),
  options     jsonb,
  required    boolean NOT NULL DEFAULT false,
  position    int NOT NULL DEFAULT 0,
  UNIQUE (pipeline_id, key)
);

CREATE TABLE accounts (                     -- customer companies (not org nodes)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  owner_node_id uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id uuid REFERENCES org_nodes(id),
  name          text NOT NULL,
  domain        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  owner_node_id uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id uuid REFERENCES org_nodes(id),
  account_id    uuid REFERENCES accounts(id),
  email         citext,
  full_name     text,
  phone         text,
  custom        jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_node_id, email)           -- duplicates across sibling partners are allowed (isolated)
);
CREATE INDEX ON contacts (tenant_id, owner_node_id);
CREATE INDEX contacts_name_trgm ON contacts USING gin (full_name gin_trgm_ops);

CREATE TABLE boxes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  pipeline_id   uuid NOT NULL REFERENCES pipelines(id),
  stage_id      uuid NOT NULL REFERENCES stages(id),
  owner_node_id uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id uuid REFERENCES org_nodes(id),     -- location the work is for
  owner_user_id uuid REFERENCES app_users(id),
  name          text NOT NULL,
  value_amount  numeric(14,2),
  currency      char(3) NOT NULL DEFAULT 'CAD',
  close_date    date,
  custom        jsonb NOT NULL DEFAULT '{}',
  created_by    uuid REFERENCES app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON boxes (tenant_id, pipeline_id, stage_id);
CREATE INDEX ON boxes (owner_node_id);
CREATE INDEX ON boxes (context_node_id);
CREATE INDEX boxes_custom_gin ON boxes USING gin (custom);

CREATE TABLE box_contacts (
  box_id     uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (box_id, contact_id)
);

CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  box_id        uuid REFERENCES boxes(id) ON DELETE CASCADE,
  owner_node_id uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id uuid REFERENCES org_nodes(id),
  assignee_id   uuid REFERENCES app_users(id),
  title         text NOT NULL,
  due_at        timestamptz,
  done_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON tasks (assignee_id, due_at) WHERE done_at IS NULL;

CREATE TABLE notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  box_id        uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  owner_node_id uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id uuid REFERENCES org_nodes(id),
  author_id     uuid NOT NULL REFERENCES app_users(id),
  body          text NOT NULL,
  mentions      uuid[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER boxes_context    BEFORE INSERT OR UPDATE ON boxes    FOR EACH ROW EXECUTE FUNCTION trg_validate_context();
CREATE TRIGGER contacts_context BEFORE INSERT OR UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION trg_validate_context();
CREATE TRIGGER accounts_context BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION trg_validate_context();
CREATE TRIGGER tasks_context    BEFORE INSERT OR UPDATE ON tasks    FOR EACH ROW EXECUTE FUNCTION trg_validate_context();
CREATE TRIGGER notes_context    BEFORE INSERT OR UPDATE ON notes    FOR EACH ROW EXECUTE FUNCTION trg_validate_context();

-- ---------------------------------------------------------------------
-- 7. Gmail integration (tokens are private to the user; ancestors never see them)
-- ---------------------------------------------------------------------
CREATE TABLE gmail_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  user_id          uuid NOT NULL UNIQUE REFERENCES app_users(id),
  email            citext NOT NULL,
  refresh_token_enc bytea NOT NULL,          -- envelope-encrypted; KMS key in the tenant's region
  key_id           text NOT NULL,
  scopes           text[] NOT NULL,
  history_id       text,
  watch_expires_at timestamptz,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','needs_reconnect','revoked')),
  connected_at     timestamptz NOT NULL DEFAULT now()
);

-- Metadata and a short snippet only. Full content lives in linked_thread_messages.
CREATE TABLE email_threads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  gmail_account_id uuid NOT NULL REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  owner_node_id    uuid NOT NULL REFERENCES org_nodes(id),
  gmail_thread_id  text NOT NULL,
  subject          text,
  snippet          text CHECK (char_length(snippet) <= 200),
  participants     jsonb NOT NULL DEFAULT '[]',
  last_message_at  timestamptz,
  message_count    int NOT NULL DEFAULT 0,
  UNIQUE (gmail_account_id, gmail_thread_id)
);

CREATE TABLE box_threads (
  box_id         uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  thread_id      uuid NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  linked_by      uuid NOT NULL REFERENCES app_users(id),
  consent_id     uuid NOT NULL REFERENCES consent_records(id),   -- A2 dialog accepted
  linked_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (box_id, thread_id)
);
CREATE INDEX ON box_threads (thread_id);

-- Cached full content: ONLY for explicitly linked threads. Encrypted, region-bound.
CREATE TABLE linked_thread_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  thread_id        uuid NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  sent_at          timestamptz,
  from_addr        text,
  to_addrs         jsonb NOT NULL DEFAULT '[]',
  subject          text,
  body_enc         bytea NOT NULL,
  attachments      jsonb NOT NULL DEFAULT '[]',     -- names and sizes only
  key_id           text NOT NULL,
  cached_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, gmail_message_id)
);

-- Unlinking the last box deletes the cached copy (PRD: deleted on unlink).
CREATE FUNCTION purge_unlinked_thread_cache() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM box_threads WHERE thread_id = OLD.thread_id) THEN
    DELETE FROM linked_thread_messages WHERE thread_id = OLD.thread_id;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER purge_unlinked_thread_cache AFTER DELETE ON box_threads
  FOR EACH ROW EXECUTE FUNCTION purge_unlinked_thread_cache();

CREATE TABLE snippets (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id   uuid NOT NULL REFERENCES app_users(id),
  name      text NOT NULL,
  locale    locale_code NOT NULL DEFAULT 'en',
  body      text NOT NULL
);

CREATE TABLE scheduled_sends (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  user_id          uuid NOT NULL REFERENCES app_users(id),
  gmail_account_id uuid NOT NULL REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  mime_enc         bytea NOT NULL,
  key_id           text NOT NULL,
  send_at          timestamptz NOT NULL,
  tracking_enabled boolean NOT NULL DEFAULT false,   -- off unless the sender turns it on
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','cancelled')),
  attempts         int NOT NULL DEFAULT 0
);
CREATE INDEX ON scheduled_sends (send_at) WHERE status = 'queued';

CREATE TABLE tracking_events (               -- written only for emails with tracking explicitly on
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  send_id      uuid NOT NULL REFERENCES scheduled_sends(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('open', 'click')),
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 8. LMS
-- ---------------------------------------------------------------------
CREATE TABLE assets (                        -- files and video sources; bucket is the tenant's regional bucket
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  kind         text NOT NULL CHECK (kind IN ('video_source','hls','caption','file','certificate_pdf','image')),
  storage_key  text NOT NULL,
  mime_type    text,
  size_bytes   bigint,
  sha256       text,
  created_by   uuid REFERENCES app_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE video_assets (                  -- self-hosted pipeline (L-18)
  asset_id     uuid PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  status       text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','transcoding','ready','failed')),
  duration_s   int,
  hls_manifest_key text,
  renditions   jsonb NOT NULL DEFAULT '[]',
  attempts     int NOT NULL DEFAULT 0,
  error        text
);
CREATE TABLE caption_tracks (
  video_asset_id uuid NOT NULL REFERENCES video_assets(asset_id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  locale         locale_code NOT NULL,
  asset_id       uuid NOT NULL REFERENCES assets(id),
  PRIMARY KEY (video_asset_id, locale)
);

CREATE TABLE courses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  owner_node_id  uuid NOT NULL REFERENCES org_nodes(id),   -- available to everything beneath this node
  status         course_status NOT NULL DEFAULT 'draft',
  quebec_facing  boolean NOT NULL DEFAULT false,
  default_locale locale_code NOT NULL DEFAULT 'en',
  created_by     uuid REFERENCES app_users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE course_locales (
  course_id    uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  locale       locale_code NOT NULL,
  title        text NOT NULL,
  description  text,
  is_published boolean NOT NULL DEFAULT false,
  PRIMARY KEY (course_id, locale)
);
CREATE TABLE course_modules (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position  int NOT NULL,
  titles    jsonb NOT NULL DEFAULT '{}',        -- {"en": "...", "fr-CA": "..."}
  UNIQUE (course_id, position)
);
CREATE TABLE lessons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id   uuid NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  position    int NOT NULL,
  type        lesson_type NOT NULL,
  required    boolean NOT NULL DEFAULT true,
  pass_mark   int CHECK (pass_mark BETWEEN 0 AND 100),     -- quizzes
  max_attempts int,
  UNIQUE (module_id, position)
);
CREATE TABLE lesson_locales (
  lesson_id     uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  locale        locale_code NOT NULL,
  title         text NOT NULL,
  body          jsonb NOT NULL DEFAULT '{}',   -- rich text, link, etc.
  asset_id      uuid REFERENCES assets(id),    -- file or video source for this language
  PRIMARY KEY (lesson_id, locale)
);
CREATE TABLE quiz_questions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  lesson_id  uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position   int NOT NULL,
  type       text NOT NULL CHECK (type IN ('single','multi','true_false')),
  content    jsonb NOT NULL,                   -- per locale: prompt, options, feedback
  correct    jsonb NOT NULL,                   -- option keys (never sent to learners)
  points     int NOT NULL DEFAULT 1,
  UNIQUE (lesson_id, position)
);

-- Quebec-facing courses cannot be published without a published French version of
-- the course and of every lesson.
CREATE FUNCTION courses_quebec_publish_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.quebec_facing THEN
    IF NOT EXISTS (SELECT 1 FROM course_locales
                   WHERE course_id = NEW.id AND locale = 'fr-CA' AND is_published) THEN
      RAISE EXCEPTION 'Quebec-facing course needs a published fr-CA version';
    END IF;
    IF EXISTS (SELECT 1 FROM lessons l
               WHERE l.course_id = NEW.id
                 AND NOT EXISTS (SELECT 1 FROM lesson_locales ll
                                 WHERE ll.lesson_id = l.id AND ll.locale = 'fr-CA')) THEN
      RAISE EXCEPTION 'Every lesson needs a fr-CA version before publishing a Quebec-facing course';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER courses_quebec_publish_guard BEFORE INSERT OR UPDATE OF status, quebec_facing ON courses
  FOR EACH ROW EXECUTE FUNCTION courses_quebec_publish_guard();

CREATE TABLE course_assignments (            -- "everyone beneath this node"
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  course_id   uuid NOT NULL REFERENCES courses(id),
  node_id     uuid NOT NULL REFERENCES org_nodes(id),
  due_at      timestamptz,
  assigned_by uuid REFERENCES app_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, node_id)
);

CREATE TABLE enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  user_id         uuid NOT NULL REFERENCES app_users(id),
  course_id       uuid NOT NULL REFERENCES courses(id),
  assignment_id   uuid REFERENCES course_assignments(id) ON DELETE SET NULL,
  learner_node_id uuid NOT NULL REFERENCES org_nodes(id),   -- snapshot of the learner's node for visibility
  status          text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','completed')),
  progress_pct    numeric(5,2) NOT NULL DEFAULT 0,
  due_at          timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  UNIQUE (user_id, course_id)
);
CREATE INDEX ON enrollments (tenant_id, learner_node_id);
CREATE INDEX ON enrollments (course_id, status);

CREATE TABLE lesson_progress (
  enrollment_id    uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lesson_id        uuid NOT NULL REFERENCES lessons(id),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  status           text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed')),
  position_seconds int NOT NULL DEFAULT 0,
  time_spent_s     int NOT NULL DEFAULT 0,
  completed_at     timestamptz,
  PRIMARY KEY (enrollment_id, lesson_id)
);
CREATE TABLE quiz_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lesson_id     uuid NOT NULL REFERENCES lessons(id),
  score_pct     numeric(5,2) NOT NULL,
  passed        boolean NOT NULL,
  answers       jsonb NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE certificates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  enrollment_id     uuid NOT NULL UNIQUE REFERENCES enrollments(id),
  locale            locale_code NOT NULL,
  verification_code text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(9), 'hex'),
  pdf_asset_id      uuid REFERENCES assets(id),
  issued_at         timestamptz NOT NULL DEFAULT now()
);

-- Create enrollments for everyone beneath an assignment's node (run on assign, on user moves, nightly).
CREATE FUNCTION sync_enrollments(p_assignment uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO enrollments (tenant_id, user_id, course_id, assignment_id, learner_node_id, due_at)
  SELECT a.tenant_id, u.id, a.course_id, a.id, u.home_node_id, a.due_at
  FROM course_assignments a
  JOIN org_reach r  ON r.tenant_id = a.tenant_id AND r.ancestor_id = a.node_id
  JOIN app_users u  ON u.home_node_id = r.descendant_id AND u.tenant_id = a.tenant_id AND u.status = 'active'
  WHERE a.id = p_assignment
  ON CONFLICT (user_id, course_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Locale-aware outbox for reminders and system emails (EN / FR).
CREATE TABLE notifications_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES app_users(id),
  template    text NOT NULL,
  locale      locale_code NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  send_after  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed'))
);
CREATE INDEX ON notifications_outbox (send_after) WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- 9. Row-level security
-- ---------------------------------------------------------------------
-- Helper: SELECT / INSERT / UPDATE / DELETE policies from one visibility expression.
CREATE PROCEDURE apply_visibility_policies(p_table regclass, p_expr text) LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE POLICY vis_select ON %s FOR SELECT USING (%s)', p_table, p_expr);
  EXECUTE format('CREATE POLICY vis_insert ON %s FOR INSERT WITH CHECK ((%s) AND app_can_write())', p_table, p_expr);
  EXECUTE format('CREATE POLICY vis_update ON %s FOR UPDATE USING ((%s) AND app_can_write()) WITH CHECK ((%s) AND app_can_write())', p_table, p_expr, p_expr);
  EXECUTE format('CREATE POLICY vis_delete ON %s FOR DELETE USING ((%s) AND app_can_write())', p_table, p_expr);
END $$;

-- 9a. Enable and force RLS on every tenant table; add a RESTRICTIVE tenant wall.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_wall ON %I AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY own_tenant ON tenants USING (id = app_tenant_id());

-- 9b. CRM visibility (owner chain + context location)
CALL apply_visibility_policies('boxes',    'crm_row_visible(tenant_id, owner_node_id, context_node_id)');
CALL apply_visibility_policies('contacts', 'crm_row_visible(tenant_id, owner_node_id, context_node_id)');
CALL apply_visibility_policies('accounts', 'crm_row_visible(tenant_id, owner_node_id, context_node_id)');
CALL apply_visibility_policies('tasks',    'crm_row_visible(tenant_id, owner_node_id, context_node_id)');
CALL apply_visibility_policies('notes',    'crm_row_visible(tenant_id, owner_node_id, context_node_id)');
CALL apply_visibility_policies('email_threads',
  'crm_row_visible(tenant_id, owner_node_id, NULL) OR EXISTS (SELECT 1 FROM box_threads bt WHERE bt.thread_id = email_threads.id)');
CALL apply_visibility_policies('pipelines', 'shared_down_visible(tenant_id, owner_node_id, is_shared_down)');
-- children inherit through their parent (the parent's own policy applies inside EXISTS)
CALL apply_visibility_policies('stages',     'EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_id)');
CALL apply_visibility_policies('field_defs', 'EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_id)');
CALL apply_visibility_policies('box_contacts', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
CALL apply_visibility_policies('box_threads',  'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
CALL apply_visibility_policies('linked_thread_messages',
  'EXISTS (SELECT 1 FROM box_threads bt WHERE bt.thread_id = linked_thread_messages.thread_id)');

-- 9c. Private to the user (ancestors never see tokens, drafts or scheduled mail)
CREATE POLICY own_rows ON gmail_accounts   USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY own_rows ON scheduled_sends  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY own_rows ON snippets         USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY own_rows ON tracking_events  USING (EXISTS (SELECT 1 FROM scheduled_sends s WHERE s.id = send_id));
CREATE POLICY own_or_admin ON consent_records
  USING (user_id = app_user_id() OR app_is_tenant_admin())
  WITH CHECK (user_id = app_user_id());

-- 9d. LMS
CALL apply_visibility_policies('courses', 'shared_down_visible(tenant_id, owner_node_id, status = ''published'')');
CALL apply_visibility_policies('course_locales',  'EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id)');
CALL apply_visibility_policies('course_modules',  'EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id)');
CALL apply_visibility_policies('lessons',         'EXISTS (SELECT 1 FROM courses c WHERE c.id = course_id)');
CALL apply_visibility_policies('lesson_locales',  'EXISTS (SELECT 1 FROM lessons l WHERE l.id = lesson_id)');
CALL apply_visibility_policies('quiz_questions',  'EXISTS (SELECT 1 FROM lessons l WHERE l.id = lesson_id)');
CALL apply_visibility_policies('course_assignments', 'lms_node_visible(tenant_id, node_id)');
CALL apply_visibility_policies('enrollments',
  'user_id = app_user_id() OR lms_node_visible(tenant_id, learner_node_id)');
CALL apply_visibility_policies('lesson_progress', 'EXISTS (SELECT 1 FROM enrollments e WHERE e.id = enrollment_id)');
CALL apply_visibility_policies('quiz_attempts',   'EXISTS (SELECT 1 FROM enrollments e WHERE e.id = enrollment_id)');
CALL apply_visibility_policies('certificates',    'EXISTS (SELECT 1 FROM enrollments e WHERE e.id = enrollment_id)');
CREATE POLICY own_rows ON notifications_outbox USING (user_id = app_user_id() OR app_is_tenant_admin());

-- 9e. Tables with no specific rule: tenant members can read, writers can write, inside the tenant wall.
-- (org graph, users, roles, invitations, tenant_settings, assets, video, captions, audit_log.)
-- Fine-grained write rights (who may edit which node) are enforced by the API using user_node_roles.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relrowsecurity
      AND c.relname <> 'tenants'
      AND NOT EXISTS (SELECT 1 FROM pg_policies p
                      WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.permissive = 'PERMISSIVE')
  LOOP
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY tenant_write ON %I FOR ALL USING (app_can_write()) WITH CHECK (app_can_write())', t);
  END LOOP;
END $$;

-- 9f. Drift guard: CI must fail if this view returns any row.
CREATE VIEW rls_drift AS
SELECT c.relname AS table_name
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  AND EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
       OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_wall'));


-- ---------------------------------------------------------------------
-- Ops notes (not executed)
-- ---------------------------------------------------------------------
-- CREATE ROLE app_runtime NOLOGIN NOBYPASSRLS;
-- GRANT USAGE ON SCHEMA public TO app_runtime;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
-- REVOKE UPDATE, DELETE ON audit_log FROM app_runtime;      -- append-only
-- REVOKE UPDATE, DELETE ON audit_log_default FROM app_runtime;
--
-- Isolation tests to run in CI (each must return 0 rows or raise):
--   1. Two sibling partners under one location: A cannot select B's boxes, contacts, threads.
--   2. Partner serving locations X and Y: record with context X is invisible to location Y's manager.
--   3. Sub-partner records visible to its partner and the tenant admin, not to a sibling sub-partner.
--   4. Location manager cannot read gmail_accounts, scheduled_sends or snippets of any partner.
--   5. Removing one of two partner_links keeps closure rows; removing the last one removes them.
--   6. Inserting a partner_link that creates a cycle, or exceeds 5 levels, is rejected.
--   7. Unlinking the last box_threads row deletes linked_thread_messages for that thread.
--   8. Publishing a quebec_facing course without fr-CA content is rejected.
--   9. SELECT * FROM rls_drift returns no rows.
