CREATE TABLE IF NOT EXISTS help_stats (
   message TEXT NOT NULL,
	date TEXT NOT NULL,
   faqName TEXT NOT NULL,
   regex TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS help_regexes (
   faq TEXT NOT NULL,
   regex TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS help_queue (
   regexString TEXT NOT NULL,
	submitter TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS help_settings (
   filterDisabled INTEGER,
	queueDisabled INTEGER
);
