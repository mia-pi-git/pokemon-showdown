# TODO
- Integrate with loginserver
    - move usergroups from CSV to loginserver group column.

- Databases
    - Move all server SQLite -> PostgreSQL
    - Move ticket logs to database
    - Move Punishments to PostgreSQL - probably will need complete refactor?
    - Chatlog plugin needs to read DB

- Misc
    - Redis pubsub for process managers? probably not necessary, but worth a look.


# DONE
- Roomlogs moved to Postgres, scrollback moved to Redis
- Loginserver
    - Use redis to hold assertions
    - Move to PostgreSQL.
