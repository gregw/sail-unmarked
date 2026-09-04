#!/usr/bin/env bash
# install.sh — installs the unmarkable systemd service on a Debian/Raspberry Pi system.
# Must be run as root (or with sudo).
#
# Safe to re-run: upgrading is `git pull && sudo etc/install.sh`. The data directory is
# never overwritten — config and programme files are seeded only if missing, and the
# store is left alone entirely. A service that was running is restarted at the end, and
# the script exits non-zero if it does not come back.
set -euo pipefail

SERVICE_NAME=unmarkable.service
SERVICE_USER=unmarkable
INSTALL_DIR=/opt/unmarkable
DATA_DIR=/var/lib/unmarkable
SERVICE_FILE=/etc/systemd/system/unmarkable.service
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

for cmd in java mvn rsync node; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: '$cmd' not found. Install it before running this script."
        exit 1
    fi
done

# Asked before anything is touched, because the answer decides whether this is an
# install or an upgrade — `systemctl is-active` would say "active" either way once the
# unit has been enabled below. Guarded with `if`: a non-zero exit here is the ordinary
# "not running" answer, and `set -e` would take it for a failure.
WAS_RUNNING=false
if systemctl is-active --quiet "$SERVICE_NAME"; then
    WAS_RUNNING=true
    echo "==> $SERVICE_NAME is running — it will be restarted at the end."
fi

echo "==> Creating system user '$SERVICE_USER' (if not already present)…"
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "==> Installing project to $INSTALL_DIR…"
# The source tree only. `data` is excluded deliberately: the live config and the store
# live in $DATA_DIR, and --delete here would take them with it.
mkdir -p "$INSTALL_DIR"
rsync -a --delete \
    --exclude='.git' --exclude='data' --exclude='target' --exclude='wiki' \
    "$SRC_DIR/" "$INSTALL_DIR/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo "==> Creating data directory $DATA_DIR…"
mkdir -p "$DATA_DIR/config/clubs" "$DATA_DIR/store"

# Seed config, never overwrite it. An upgrade must not silently revert a club's courses
# — or, worse, its surveyed coordinates.
if [ -f "$SRC_DIR/data/config/config.yaml" ] && [ ! -f "$DATA_DIR/config/config.yaml" ]; then
    echo "    seeding config/config.yaml"
    install -m 644 "$SRC_DIR/data/config/config.yaml" "$DATA_DIR/config/config.yaml"
fi
if [ -d "$SRC_DIR/data/config/clubs" ]; then
    rsync -a --ignore-existing "$SRC_DIR/data/config/clubs/" "$DATA_DIR/config/clubs/"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"

echo "==> Pre-building the project…"
sudo -u "$SERVICE_USER" HOME="$DATA_DIR" \
    sh -c "cd '$INSTALL_DIR' && mvn --batch-mode \
        -Dmaven.repo.local='$DATA_DIR/.m2/repository' compile -q"

echo "==> Installing systemd service unit…"
install -m 644 "$SRC_DIR/etc/unmarkable.service" "$SERVICE_FILE"

echo "==> Reloading systemd and enabling service…"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# An upgrade restarts; a first install does not, because there is nothing to interrupt
# and the operator may still have courses to fill in.
if [ "$WAS_RUNNING" = true ]; then
    echo "==> Restarting $SERVICE_NAME…"
    systemctl restart "$SERVICE_NAME"
    sleep 3
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        echo "    running."
    else
        echo ""
        echo "*** $SERVICE_NAME did not come back up. ***"
        echo "    sudo systemctl status $SERVICE_NAME"
        echo "    sudo journalctl -u $SERVICE_NAME -n 50"
        exit 1
    fi
fi

echo ""
echo "Installation complete."
echo ""
if [ "$WAS_RUNNING" != true ]; then
    echo "  Start:   sudo systemctl start unmarkable"
fi
echo "  Restart: sudo systemctl restart unmarkable"
echo "  Status:  sudo systemctl status unmarkable"
echo "  Logs:    sudo journalctl -u unmarkable -f"
echo ""
echo "Data directory: $DATA_DIR"
echo "  config/clubs/<club domain>/<series>.yaml   points, lines and courses"
echo "  store/                                     boats' race records — back it up"
echo ""
