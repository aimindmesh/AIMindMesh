#!/bin/bash
set -e

echo "🌐 [AIMindMesh] Applying VPN Routes and MTU..."

WG_SUBNET=${WG_SUBNET:-10.6.0.0/24}
WG_GATEWAY=${WG_GATEWAY:-10.2.0.3}

# Static route to the mobile VPN subnet via the WireGuard gateway
# This ensures that even after container/host reboots, the link to the phone is restored.
# `replace` is idempotent: a container restart (e.g. after a backup restore) finds the route already there
ip route replace "$WG_SUBNET" via "$WG_GATEWAY" || echo "⚠️ Route setup failed"

# Aggressive MTU (1280) - IPv6 Minimum & Safe for all tunnels
ip link set dev eth0 mtu 1280 || echo "⚠️ MTU link adjustment failed"

# Manual MSS Override (1240 = 1280 - 40 bytes overhead)
# This forces the remote PC to send small packets regardless of its own MTU.
# Using POSTROUTING to catch outgoing SYN-ACKs and force the negotiated MSS.
# -C first: on every restart -A alone would stack one more identical rule
MSS_RULE="POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1240"
iptables -t mangle -C $MSS_RULE 2>/dev/null || iptables -t mangle -A $MSS_RULE || echo "⚠️ MSS override failed"

echo "🚀 [AIMindMesh] Starting Node Server..."
exec node ./dist/index.js
