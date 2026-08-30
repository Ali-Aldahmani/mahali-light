#!/bin/sh
set -e
# Named volumes are often created as root. Drop to `node` after fixing ownership.
mkdir -p /data/uploads /data/tls /app/backups /app/logs
chown -R node:node /data /app/backups /app/logs
exec gosu node "$@"
