-- Local development only. In Railway/AWS/Azure, create these roles with strong generated passwords.
CREATE ROLE app_runtime LOGIN PASSWORD 'pw' NOBYPASSRLS;
CREATE ROLE app_auth LOGIN PASSWORD 'pw' BYPASSRLS;
