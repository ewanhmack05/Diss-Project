#!/usr/bin/env bash
# Adds the realtime-hub client to a Keycloak that imported the realm before
# it was in realm/diss-realm.json - the import skips a realm that already
# exists. Safe to run again: it only adds what's missing. A fresh Keycloak
# (or one after `docker compose down -v`) gets it from the import instead.
#
#   ./add-realtime-hub-client.sh              # diss-keycloak - either compose file
#   ./add-realtime-hub-client.sh <container>  # any other Keycloak container
set -euo pipefail
# Git Bash would otherwise turn /opt/keycloak/... into a Windows path.
export MSYS_NO_PATHCONV=1

container="${1:-diss-keycloak}"
realm=diss
client=realtime-hub
secret=realtime-hub-dev-secret

kcadm() {
  docker exec "$container" /opt/keycloak/bin/kcadm.sh "$@"
}

kcadm config credentials --server http://localhost:8080/auth --realm master --user admin --password admin >/dev/null

if kcadm get clients -r "$realm" -q clientId="$client" --fields clientId | grep -q "\"$client\""; then
  echo "$client client is already there"
else
  kcadm create clients -r "$realm" \
    -s clientId="$client" \
    -s name="Realtime hub" \
    -s 'description=Reads the user list for the viewer'"'"'s Users tab. Its service account can only view users.' \
    -s enabled=true \
    -s publicClient=false \
    -s clientAuthenticatorType=client-secret \
    -s secret="$secret" \
    -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s serviceAccountsEnabled=true >/dev/null
  echo "Added the $client client"
fi

# Adding a role it already has is a no-op.
kcadm add-roles -r "$realm" --uusername "service-account-$client" --cclientid realm-management --rolename view-users
echo "service-account-$client can view users"
