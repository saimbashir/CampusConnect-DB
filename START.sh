#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "Starting CampusConnect at http://127.0.0.1:3000"
node server.js
