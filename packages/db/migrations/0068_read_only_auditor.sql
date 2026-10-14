-- Read-only auditor: sees everything in its assigned scope (company or branches) and changes nothing.
-- The API sets app.can_write from the caller's roles (packages/domain/src/session.ts): a user whose only
-- role is 'auditor' gets can_write = false, so every write policy that checks app_can_write() rejects them.
ALTER TYPE org_role ADD VALUE IF NOT EXISTS 'auditor';
