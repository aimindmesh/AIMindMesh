#!/bin/bash
set -e

CONFIG_FILE="$HOME/.config/aimindmesh-client/config.toml"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Error: Config file not found at $CONFIG_FILE"
    echo "Please open AIMindMesh app at least once and configure your VPN IP in the settings."
    exit 1
fi

echo "🔍 Parsing VPN IP from configuration..."
VPN_IP=$(grep -A 5 '\[node\]' "$CONFIG_FILE" | grep 'vpn_ip' | cut -d '"' -f 2)

if [ -z "$VPN_IP" ]; then
    echo "❌ Error: Could not extract vpn_ip from $CONFIG_FILE"
    exit 1
fi

echo "✅ Found configured VPN IP: $VPN_IP"
echo "🔧 Patching Ollama systemd service to bind exclusively to this IP..."

# Create a drop-in override for systemd
sudo mkdir -p /etc/systemd/system/ollama.service.d/
cat <<EOF | sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null
[Service]
Environment="OLLAMA_HOST=$VPN_IP"
Environment="OLLAMA_ORIGINS=*"
EOF

echo "🔄 Reloading and restarting Ollama daemon..."
sudo systemctl daemon-reload
sudo systemctl restart ollama

echo ""
echo "🎉 SUCCESS! Ollama is now securely bound ONLY to your VPN IP ($VPN_IP)."
echo "You can verify this by running: sudo netstat -tulnp | grep 11434"
