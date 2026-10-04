-- The Gmail conversation an invitation went out in, so the sender can open the sent email and check it.
ALTER TABLE invitations ADD COLUMN gmail_thread_id text;
