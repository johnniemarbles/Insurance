-- Staff: branch staff assigned to manage brokers (plan v7, sections 3 and 6). Given by a branch manager, in its own branch.
ALTER TYPE org_role ADD VALUE IF NOT EXISTS 'staff';
