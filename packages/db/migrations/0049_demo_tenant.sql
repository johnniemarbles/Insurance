-- A demo tenant is filled with fictional data and never sends real mail to its fake users.
ALTER TABLE tenants ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
