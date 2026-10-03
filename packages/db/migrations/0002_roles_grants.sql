-- Roles and grants. Passwords/LOGIN are set by ops (see docs/ops.md), never in migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOBYPASSRLS;
  END IF;
  -- Login lookup only: finds a user by email before a tenant context exists.
  -- BYPASSRLS, but granted read access to a few identity tables and nothing else.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auth') THEN
    CREATE ROLE app_auth NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_runtime, app_auth;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- Tenants and deployment identity are created by bootstrap (owner role), not by the running app.
REVOKE INSERT, DELETE ON tenants FROM app_runtime;
REVOKE INSERT, UPDATE, DELETE ON deployment_info FROM app_runtime;
-- Audit log is append-only; partitions are reachable only through the parent table.
REVOKE UPDATE, DELETE ON audit_log FROM app_runtime;
REVOKE ALL ON audit_log_default FROM app_runtime;

GRANT SELECT ON tenants, app_users, user_node_roles, org_nodes, invitations, deployment_info TO app_auth;
GRANT UPDATE (last_login_at, google_sub, status) ON app_users TO app_auth;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
