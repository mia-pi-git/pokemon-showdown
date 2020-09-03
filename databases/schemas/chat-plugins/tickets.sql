CREATE TABLE IF NOT EXISTS ticket_stats (
	ticketType TEXT NOT NULL,
	totalTime INTEGER,
	timeToFirstClaim INTEGER,
	inactiveTime INTEGER,
	resolution TEXTL,
	result TEXT,
	staff TEXT,
	month TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
	creator TEXT NOT NULL,
	userid TEXT NOT NULL PRIMARY KEY,
	open INTEGER,
	active INTEGER,
	type TEXT NOT NULL,
	claimed TEXT,
	ip TEXT NOT NULL
);
