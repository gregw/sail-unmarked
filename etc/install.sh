#!/usr/bin/env bash
# install.sh — installs the sail-unmarked systemd service on a Debian/Raspberry Pi system.
# Must be run as root (or with sudo).
#
# Safe to re-run: upgrading is `git pull && sudo etc/install.sh`. The data directory is
# never overwritten — config and programme files are seeded only if missing, and the
# store is left alone entirely. A service that was running is restarted at the end, and
# the script exits non-zero if it does not come back.
set -euo pipefail

SERVICE_NAME=sail-unmarked.service
SERVICE_USER=sail-unmarked
INSTALL_DIR=/opt/sail-unmarked
DATA_DIR=/var/lib/sail-unmarked
SERVICE_FILE=/etc/systemd/system/sail-unmarked.service
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

# The EXAMPLE is seeded; auth.yaml itself never is. A file that turned the login on with
# somebody else's client id would be worse than no file: the club would be locked out of
# its own editor by a stranger's OAuth registration. So the example is put where it can be
# copied and the last line of this script says how.
if [ ! -f "$DATA_DIR/config/auth.yaml" ] \
    && [ -f "$SRC_DIR/data/config/auth.yaml.example" ]; then
    echo "    seeding config/auth.yaml.example (there is NO login until you copy it)"
    install -m 644 "$SRC_DIR/data/config/auth.yaml.example" \
        "$DATA_DIR/config/auth.yaml.example"
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
# auth.yaml holds an OAuth client secret. Nobody but the service needs to read it, and an
# upgrade must not quietly loosen a mode somebody set by hand.
if [ -f "$DATA_DIR/config/auth.yaml" ]; then
    chmod 600 "$DATA_DIR/config/auth.yaml"
fi

echo "==> Pre-building the project…"
sudo -u "$SERVICE_USER" HOME="$DATA_DIR" \
    sh -c "cd '$INSTALL_DIR' && mvn --batch-mode \
        -Dmaven.repo.local='$DATA_DIR/.m2/repository' compile -q"

echo "==> Installing systemd service unit…"
install -m 644 "$SRC_DIR/etc/sail-unmarked.service" "$SERVICE_FILE"

echo "==> Reloading systemd and enabling service…"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# An upgrade restarts; a first install does not, because there is nothing to interrupt and
# the operator may still have things to fill in — auth.yaml in particular.
#
# The rsync and the rebuild above have already replaced the source and the classes under any
# running process. Java loads classes as it first needs them, so between those steps and this
# restart a page nobody has visited yet can fail to load. That window is not created here, it
# is closed here: the alternative is a stop-install-start that is down for the whole build.
if [ "$WAS_RUNNING" = true ]; then
    echo "==> Restarting $SERVICE_NAME…"
    systemctl restart "$SERVICE_NAME"
    # Long enough to fail. With a login configured, start-up includes the OpenID discovery
    # call, so "came up" is a slower claim here than it looks — and a Pi with no route yet
    # fails at exactly that step.
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
    echo "  Start:   sudo systemctl start sail-unmarked"
fi
echo "  Restart: sudo systemctl restart sail-unmarked"
echo "  Stop:    sudo systemctl stop sail-unmarked"
echo "  Status:  sudo systemctl status sail-unmarked"
echo "  Logs:    sudo journalctl -u sail-unmarked -f"
echo ""
echo "Data directory: $DATA_DIR"
echo "  config/clubs/<club domain>/<series>.yaml   points, lines, courses and races"
echo "  store/records/                             boats' race records — back it up"
echo "  store/conduct/                             what happened in each race: the channel,"
echo "                                             the flags, who joined"
echo ""

# THE LAST THING PRINTED IS THE THING NOT DONE. An install that ends with "complete" and
# says nothing else invites somebody to believe it is ready for a club night.
if [ ! -f "$DATA_DIR/config/auth.yaml" ]; then
    echo "THERE IS NO LOGIN: the course editor and the race screen are open to anything that"
    echo "can reach this port — which includes anything that can reach this Pi. A boat's own"
    echo "screens are meant to be open; those two are not."
    echo ""
    echo "  sudo cp $DATA_DIR/config/auth.yaml.example $DATA_DIR/config/auth.yaml"
    echo "  sudo chown $SERVICE_USER:$SERVICE_USER $DATA_DIR/config/auth.yaml"
    echo "  sudo chmod 600 $DATA_DIR/config/auth.yaml"
    echo "  sudo -e $DATA_DIR/config/auth.yaml     # the OAuth client, and enabled: true"
    echo "  sudo systemctl restart sail-unmarked"
    echo ""
    echo "Two things to get right there:"
    echo "  - the server needs a route at START-UP with a login configured: it discovers the"
    echo "    provider's endpoints before it binds."
    echo "  - allowLoopback must stay FALSE behind a reverse proxy. Every request in the world"
    echo "    arrives from 127.0.0.1 there, so leaving it on hands the editor to the internet."
    echo ""
else
    echo "A login is configured ($DATA_DIR/config/auth.yaml)."
    echo "Boats need none of it: joining, records and the whole dialog stay open, by design."
    echo ""
fi
