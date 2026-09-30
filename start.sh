#!/bin/sh
set -eu
# Hosted database CAs may be supplied as a public PEM environment value.
# Certificate and hostname verification remain enabled by the connector.
if [ -n "${DB_SSL_CA_PEM:-}" ]; then
    umask 077
    DB_SSL_CA="$(mktemp "${TMPDIR:-/tmp}/flashmarket-mysql-ca.XXXXXX")"
    printf '%s\n' "$DB_SSL_CA_PEM" > "$DB_SSL_CA"
    export DB_SSL_CA
fi
python -m scripts.setup --seed
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1
