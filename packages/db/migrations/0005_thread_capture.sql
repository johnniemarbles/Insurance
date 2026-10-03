-- Linking a conversation captures what the person sees in their own Gmail tab, after they accept the notice.
-- No Gmail API access (and no restricted Google scope) is needed for this, so a thread no longer needs a gmail_accounts row.
ALTER TABLE email_threads ALTER COLUMN gmail_account_id DROP NOT NULL;
ALTER TABLE email_threads ADD COLUMN linked_by uuid REFERENCES app_users(id);
CREATE UNIQUE INDEX email_threads_user_thread ON email_threads (linked_by, gmail_thread_id) WHERE linked_by IS NOT NULL;
ALTER TABLE email_threads ADD CONSTRAINT email_threads_source CHECK (gmail_account_id IS NOT NULL OR linked_by IS NOT NULL);
