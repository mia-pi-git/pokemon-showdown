# TODO
- Integrate with loginserver
    - Move loginserver to PostgreSQL.
    - move usergroups from CSV to loginserver group column.
    - Use redis to hold assertions
        - give user a token, store it in redis, have server read from redis.
        - once used, delete from redis.

- Databases
    - Move all server SQLite -> PostgreSQL
    - Move ticket logs to database
    - Move Punishments to PostgreSQL - probably will need complete refactor?
    - Chatlog plugin needs to read DB

- Misc
    - Redis pubsub for process managers? probably not necessary, but worth a look.
