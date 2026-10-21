#!/usr/bin/env bash
# Turns on "make an account" for a Keycloak that imported the realm before
# registrationAllowed was true in realm/diss-realm.json - the import skips a
# realm that already exists. Guests need it to go from looking to editing
# (see docs/guests.md). Safe to run again. A fresh Keycloak (or one after
# `docker compose down -v`) gets it from the import instead.
#
#   ./allow-sign-up.sh              # diss-keycloak - either compose file
#   ./allow-sign-up.sh <container>  # any other Keycloak container
set -euo pipefail
# Git Bash would otherwise turn /opt/keycloak/... into a Windows path.
export MSYS_NO_PATHCONV=1

container="${1:-diss-keycloak}"
realm=diss

kcadm() {
  docker exec "$container" /opt/keycloak/bin/kcadm.sh "$@"
}

kcadm config credentials --server http://localhost:8080/auth --realm master --user admin --password admin >/dev/null
kcadm update "realms/$realm" -s registrationAllowed=true
echo "Making an account is on for the $realm realm"
