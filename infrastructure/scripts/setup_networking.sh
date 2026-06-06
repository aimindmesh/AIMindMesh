#!/bin/bash
set -e

NETWORK_NAME="wirehole_private_network"
SUBNET="10.2.0.0/24"

echo "🌐 Setting up Docker network: $NETWORK_NAME ($SUBNET)..."

if ! docker network inspect "$NETWORK_NAME" &> /dev/null; then
    docker network create \
        --driver bridge \
        --subnet "$SUBNET" \
        --gateway "10.2.0.254" \
        "$NETWORK_NAME"
    echo "✅ Network created."
else
    echo "✅ Network already exists."
fi
