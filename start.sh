#!/bin/bash

echo "═══════════════════════════════════════════════════════════"
echo "🚀 GitHub MCP Server Starter (v2.0)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if setup has been done
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Running setup first..."
    echo ""
    ./setup.sh
    exit $?
fi

# Check if token is configured
if grep -q "PASTE_YOUR_TOKEN_HERE" .env; then
    echo "⚠️  GitHub token not configured!"
    echo "   Running setup..."
    echo ""
    ./setup.sh
    exit $?
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed (required for ChatGPT)"
    echo ""
    echo "To install ngrok:"
    echo "  brew install ngrok  # macOS"
    echo ""
    echo "Then configure your auth token:"
    echo "  ngrok config add-authtoken YOUR_TOKEN"
    echo ""
    echo "Get your token from: https://dashboard.ngrok.com/signup"
    exit 1
fi

# Get port from .env or use default
PORT=$(grep "^PORT=" .env | cut -d '=' -f2 || echo "8787")

echo "🔧 Configuration:"
echo "   • Port: $PORT"
echo "   • Token: Loaded from .env"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "🚦 Starting server and ngrok... (Press Ctrl+C to stop)"
echo ""

# Start the MCP server in background
npm start &
SERVER_PID=$!
echo "✅ MCP Server started (PID: $SERVER_PID)"

# Wait for server to start
sleep 2

# Start ngrok
echo "🌐 Starting ngrok tunnel..."
ngrok http $PORT &
NGROK_PID=$!

# Wait for ngrok to start
sleep 3

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "📋 ADD TO CHATGPT:"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "1. Look for the ngrok URL above (https://xxxxx.ngrok-free.app)"
echo ""
echo "2. Go to ChatGPT → Settings → Connectors"
echo ""
echo "3. Add new connector:"
echo "   • Name: github_connect"
echo "   • URL: [YOUR_NGROK_URL]/sse"
echo "   • Auth: No authentication"
echo ""
echo "4. Check 'I trust this application' → Create"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Server is running! Press Ctrl+C to stop"
echo "═══════════════════════════════════════════════════════════"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $SERVER_PID 2>/dev/null
    kill $NGROK_PID 2>/dev/null
    echo "✅ Cleanup complete"
    exit 0
}

# Set up trap to cleanup on Ctrl+C
trap cleanup INT

# Keep script running
wait