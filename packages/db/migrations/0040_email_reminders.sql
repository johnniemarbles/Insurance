-- Reminder emails: a person can turn them off. The identity pool changes only this one column.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_reminders boolean NOT NULL DEFAULT true;
GRANT UPDATE (email_reminders) ON app_users TO app_auth;
