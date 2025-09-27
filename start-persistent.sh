#!/bin/bash

# Kill any existing processes
pkill -f "node github-mcp-enhanced.js"
pkill -f ngrok

echo "🔄 Starting persistent ngrok tunnel..."

# Start ngrok with a subdomain (requires ngrok paid plan)
# Uncomment this line if you have a paid ngrok account:
# ngrok http 8788 --subdomain=github-mcp-btangonan &

# For free ngrok accounts, use this (URL will change on restart):
ngrok http 8788 &

# Wait for ngrok to start
sleep 3

# Get and display the ngrok URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | python3 -c "import json, sys; data = json.load(sys.stdin); print(data['tunnels'][0]['public_url'] if data.get('tunnels') else 'No tunnel found')")

echo "✅ Ngrok tunnel active: $NGROK_URL"
echo "📋 ChatGPT SSE URL: $NGROK_URL/sse"
echo ""
echo "💡 To keep the same URL permanently:"
echo "   Option 1: Upgrade to ngrok paid plan for custom subdomain"
echo "   Option 2: Use a service like Cloudflare Tunnels (free)"
echo "   Option 3: Keep this terminal open (URL persists until you close it)"
echo ""

# Start the MCP server
echo "🚀 Starting GitHub MCP server..."
node github-mcp-enhanced.js