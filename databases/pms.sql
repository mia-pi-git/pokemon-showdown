CREATE TABLE IF NOT EXISTS offline_pms (
	sender TEXT NOT NULL,
	receiver TEXT NOT NULL,
	message TEXT NOT NULL,
	timestamp INTEGER
)
