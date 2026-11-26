CREATE TABLE nyra_public_checks (
 id TEXT PRIMARY KEY NOT NULL,
 checked_at INTEGER NOT NULL,
 kind TEXT NOT NULL,
 message TEXT NOT NULL,
 previous TEXT,
 current TEXT,
 error TEXT NOT NULL DEFAULT ''
);
