CREATE SCHEMA IF NOT EXISTS shoplink;
REVOKE ALL ON SCHEMA shoplink FROM PUBLIC;
SET LOCAL search_path = shoplink, public;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,kind TEXT NOT NULL,email TEXT NOT NULL,full_name TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',password_hash TEXT NOT NULL,role TEXT NOT NULL,workspace TEXT,created_at TEXT NOT NULL,UNIQUE(kind,email));
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS access(email TEXT PRIMARY KEY,workspace TEXT NOT NULL,role TEXT NOT NULL,shop TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',user_id TEXT,invite_hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_access_workspace ON access(workspace);
CREATE TABLE IF NOT EXISTS integrations(hash TEXT PRIMARY KEY,workspace TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_integrations_workspace ON integrations(workspace);
CREATE TABLE IF NOT EXISTS customer_orders(customer_id TEXT NOT NULL,workspace TEXT NOT NULL,order_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(customer_id,workspace,order_id));
CREATE TABLE IF NOT EXISTS checkouts(customer_id TEXT NOT NULL,request_id TEXT NOT NULL,signature TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(customer_id,request_id));
CREATE TABLE IF NOT EXISTS uploads(filename TEXT PRIMARY KEY,workspace TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL);

-- Keep account and business tables outside the public Data API.
REVOKE ALL ON ALL TABLES IN SCHEMA shoplink FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA shoplink FROM anon, authenticated'; EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA shoplink FROM anon, authenticated'; END IF; END $$;
