-- A person can choose their own language. The identity pool changes only this column, and only for the signed-in person (the route checks).
GRANT UPDATE (locale) ON app_users TO app_auth;
