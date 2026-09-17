#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
node scripts/check-node.mjs
exec node server/index.mjs
