#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    CREATE ROLE app_superuser WITH SUPERUSER CREATEDB CREATEROLE LOGIN PASSWORD 'app_superuser';
    CREATE DATABASE andmejutt
        WITH TEMPLATE template0
        ENCODING 'UTF8'
        LOCALE_PROVIDER libc
        LOCALE 'et_EE.UTF-8';
    ALTER DATABASE andmejutt OWNER TO app_superuser;
EOSQL

grep -vE '^CREATE DATABASE|^ALTER DATABASE andmejutt OWNER' \
    /tmp/database_dump.sql \
    | psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "andmejutt"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "andmejutt" \
    -f /tmp/seed.sql
