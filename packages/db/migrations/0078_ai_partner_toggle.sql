-- Partners (users whose only role is partner) may use the assistant only when a company administrator switches this on.
ALTER TABLE tenant_ai ADD COLUMN partners_enabled boolean NOT NULL DEFAULT false;
