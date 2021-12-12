CREATE TABLE punishments (
	punishment_id AUTOINCREMENT PRIMARY KEY,
	-- either a userid or an ip
	id TEXT NOT NULL,
	reason TEXT NOT NULL,
	expire_time NUMBER NOT NULL,
	type TEXT NOT NULL,
	roomid TEXT,
	ips TEXT[] NOT NULL,
	ids TEXT[] NOT NULL
);
