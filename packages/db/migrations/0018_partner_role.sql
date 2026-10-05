-- "Member" becomes "Partner": the person who works the CRM and the default for every invitation.
-- Renaming the enum value in place converts user_node_roles, invitations and the column default together.
-- "Learner" is no longer chosen at invite time; it is added when someone first enrols in a course.
ALTER TYPE org_role RENAME VALUE 'member' TO 'partner';
