#!/bin/bash
set -e

# Deploys the Edit-mode API proxy (scripts/api-server.js) separately from
# the static frontend (see deploy.sh) since it's a persistent process, not
# a static file tree — a frontend-only deploy should never need to touch it.

if [ -f .env ]; then
  source .env
fi

if [ -z "$API_DEPLOY_PATH" ]; then
  echo "Error: API_DEPLOY_PATH is not set"
  echo "Set it in .env: API_DEPLOY_PATH=user@server:/var/www/example.com/api-server"
  exit 1
fi

API_DEPLOY_HOST="${API_DEPLOY_PATH%%:*}"

echo "Source: scripts/api-server.js, scripts/lib/, package.json"
echo "Destination: $API_DEPLOY_PATH"
echo "This will restart the hours-api PM2 process on $API_DEPLOY_HOST."
read -p "Are you sure? (type 'yes' to continue): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

rsync -azP scripts/api-server.js scripts/lib package.json "$API_DEPLOY_PATH/"
ssh "$API_DEPLOY_HOST" "pm2 restart hours-api"
echo "API deploy complete!"
