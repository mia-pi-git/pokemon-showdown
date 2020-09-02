CREATE TABLE IF NOT EXISTS chat_filters (
	location TEXT NOT NULL,
	list TEXT NOT NULL,
	word TEXT NOT NULL,
	reason TEXT,
	count INTEGER NOT NULL,
	filterTo TEXT,
	punishment TEXT NOT NULL,
	PRIMARY KEY (word, list)
)
