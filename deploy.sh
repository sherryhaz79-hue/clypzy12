#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

REMOTE_HOST="root@76.13.196.6"
REMOTE_DIR="/var/www"
REPO_DIR="${HOME}/diro-website"
REMOTE_STAGE_DIR="${REMOTE_DIR}/diro-website.new"

USE_PM2=0

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [-b]

Options:
  -b    Use PM2 (restart diro-backend) instead of running node directly.
EOF
}

while getopts ":bh" opt; do
  case "$opt" in
    b)
      USE_PM2=1
      ;;
    h)
      usage
      exit 0
      ;;
    \?)
      echo "Unknown option: -$OPTARG" >&2
      usage
      exit 1
      ;;
  esac
done

if [ ! -d "$REPO_DIR" ]; then
  echo "Repo directory not found: $REPO_DIR" >&2
  exit 1
fi

echo "[deploy] Preparing remote staging directory"
ssh "$REMOTE_HOST" "rm -rf '${REMOTE_STAGE_DIR}'"

echo "[deploy] Rsyncing ${REPO_DIR} -> ${REMOTE_HOST}:${REMOTE_STAGE_DIR}"
rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "frontend/node_modules" \
  --exclude "backend/node_modules" \
  "${REPO_DIR}/" "${REMOTE_HOST}:${REMOTE_STAGE_DIR}/"

echo "[deploy] Running remote deployment steps"
ssh "$REMOTE_HOST" "USE_PM2=$USE_PM2 bash -s" <<'EOF'
set -euo pipefail
IFS=$'\n\t'

REMOTE_DIR="/var/www"
REMOTE_STAGE_DIR="${REMOTE_DIR}/diro-website.new"

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

safe_source() {
  local file="$1"
  if [ -f "$file" ]; then
    # Some profiles assume variables exist; disable nounset for source.
    set +u
    # shellcheck disable=SC1090
    . "$file"
    set -u
  fi
}

safe_source /etc/profile
safe_source "${HOME}/.bashrc"
safe_source "${HOME}/.profile"

if [ -n "${NVM_DIR:-}" ] && [ -s "${NVM_DIR}/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "${NVM_DIR}/nvm.sh"
fi
if [ -z "${NVM_DIR:-}" ] && [ -s "${HOME}/.nvm/nvm.sh" ]; then
  export NVM_DIR="${HOME}/.nvm"
  # shellcheck disable=SC1090
  . "${NVM_DIR}/nvm.sh"
fi

cd "$REMOTE_DIR"

if [ -d "diro-website3" ]; then
  rm -rf "diro-website3"
fi

if [ -d "diro-website" ]; then
  mv "diro-website" "diro-website3"
fi

if [ ! -d "${REMOTE_STAGE_DIR}" ]; then
  echo "Missing staged directory: ${REMOTE_STAGE_DIR}" >&2
  exit 1
fi

mv "${REMOTE_STAGE_DIR}" "diro-website"

cd "$REMOTE_DIR/diro-website/frontend"
export VITE_API_BASE_URL=/api

if [ ! -x "node_modules/.bin/vite" ]; then
  if [ -f "package-lock.json" ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
fi

npm run build

cd "$REMOTE_DIR/diro-website/backend"
if [ ! -d "node_modules" ]; then
  if [ -f "package-lock.json" ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
fi

if [ "${USE_PM2:-0}" -eq 1 ]; then
  pkill -f node || true
  pm2 restart diro-backend
else
  pkill -f node || true
  
  # 1. Kill any existing tmux session named 'backend'
  tmux kill-session -t backend 2>/dev/null || true
  
  # 2. Start a new detached tmux session running your node process
  # This replaces nohup and allows for later attachment.
  tmux new-session -d -s backend "node --inspect=0.0.0.0:9229 src/index.js 2>&1 | tee -a $REMOTE_DIR/diro-website/backend.log"
fi

systemctl restart nginx
EOF

# --- NEW SECTION AT THE VERY END OF YOUR LOCAL SCRIPT ---

if [ "$USE_PM2" -eq 0 ]; then
  echo "[deploy] Attaching to remote console (Press Ctrl+B then D to detach without killing)..."
  # This command enters the tmux session remotely
  ssh -t "$REMOTE_HOST" "tmux attach-session -t backend"
else
  echo "[deploy] Completed (PM2 managed)"
fi

echo "[deploy] Completed"
