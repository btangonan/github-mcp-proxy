#!/bin/bash

# Colors for better output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}🚀 GitHub MCP Server Starter (v3.0)${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Check if setup has been done
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  No .env file found. Running setup first...${NC}"
    echo ""
    ./setup.sh
    exit $?
fi

# Check if token is configured
if grep -q "PASTE_YOUR_TOKEN_HERE" .env; then
    echo -e "${YELLOW}⚠️  GitHub token not configured!${NC}"
    echo "   Running setup..."
    echo ""
    ./setup.sh
    exit $?
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}📦 Installing dependencies...${NC}"
    npm install
    echo ""
fi

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}❌ ngrok is not installed (required for ChatGPT)${NC}"
    echo ""
    echo "To install ngrok:"
    echo "  brew install ngrok  # macOS"
    echo "  apt install ngrok   # Linux"
    echo ""
    echo "Then configure your auth token:"
    echo "  ngrok config add-authtoken YOUR_TOKEN"
    echo ""
    echo "Get your token from: https://dashboard.ngrok.com/signup"
    exit 1
fi

# Get port from .env or use default
PORT=$(grep "^PORT=" .env | cut -d '=' -f2 || echo "8788")

echo -e "${GREEN}🔧 Configuration:${NC}"
echo "   • Port: $PORT"
echo "   • Token: Loaded from .env"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}🛑 Shutting down...${NC}"
    kill $SERVER_PID 2>/dev/null
    kill $NGROK_PID 2>/dev/null
    echo -e "${GREEN}✅ Cleanup complete${NC}"
    exit 0
}

# Set up trap to cleanup on Ctrl+C
trap cleanup INT

# Kill any existing processes on the port
echo -e "${BLUE}🧹 Cleaning up any existing processes...${NC}"
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
killall ngrok 2>/dev/null || true
sleep 1

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🚦 Starting MCP server and ngrok tunnel...${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Start the MCP server in background
echo -e "${BLUE}📡 Starting MCP server on port $PORT...${NC}"
npm start > server.log 2>&1 &
SERVER_PID=$!

# Wait for server to be ready
RETRIES=0
MAX_RETRIES=10
while true; do
    # Check if server responds with a timeout
    if curl -s --max-time 1 http://localhost:$PORT/sse 2>/dev/null | grep -q "event: open"; then
        break
    fi

    if [ $RETRIES -eq $MAX_RETRIES ]; then
        echo -e "${RED}❌ Server failed to start after $MAX_RETRIES attempts${NC}"
        cat server.log
        exit 1
    fi
    echo -e "   ${YELLOW}Waiting for server to be ready... (attempt $((RETRIES+1))/$MAX_RETRIES)${NC}"
    sleep 1
    RETRIES=$((RETRIES+1))
done
echo -e "${GREEN}✅ MCP Server is running (PID: $SERVER_PID)${NC}"
echo ""

# Start ngrok in background without output
echo -e "${BLUE}🌐 Starting ngrok tunnel...${NC}"
ngrok http $PORT > /dev/null 2>&1 &
NGROK_PID=$!

# Wait for ngrok to be ready and get the URL
echo -e "   ${YELLOW}Waiting for ngrok to establish tunnel...${NC}"
sleep 3

# Get the ngrok URL from the API
RETRIES=0
MAX_RETRIES=10
NGROK_URL=""

while [ -z "$NGROK_URL" ] && [ $RETRIES -lt $MAX_RETRIES ]; do
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | \
                python3 -c "import sys, json; data = json.load(sys.stdin); print(data['tunnels'][0]['public_url'] if 'tunnels' in data and len(data['tunnels']) > 0 else '')" 2>/dev/null)

    if [ -z "$NGROK_URL" ]; then
        echo -e "   ${YELLOW}Waiting for ngrok tunnel... (attempt $((RETRIES+1))/$MAX_RETRIES)${NC}"
        sleep 2
        RETRIES=$((RETRIES+1))
    fi
done

if [ -z "$NGROK_URL" ]; then
    echo -e "${RED}❌ Failed to get ngrok URL${NC}"
    echo "   Please check if ngrok is properly configured with an auth token"
    echo "   Run: ngrok config add-authtoken YOUR_TOKEN"
    cleanup
    exit 1
fi

echo -e "${GREEN}✅ Ngrok tunnel established!${NC}"
echo ""

# Clear screen for clean display
clear

# Display success message with the actual URL
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           🎉 MCP SERVER READY FOR CHATGPT! 🎉            ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}${CYAN}Your MCP Server URL:${NC}"
echo -e "${BOLD}${YELLOW}$NGROK_URL/sse${NC}"
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}📋 HOW TO ADD TO CHATGPT:${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BOLD}1. Copy this URL:${NC}"
echo -e "   ${GREEN}$NGROK_URL/sse${NC}"
echo ""
echo -e "${BOLD}2. Go to ChatGPT:${NC}"
echo -e "   • Click Settings → Connectors → Add Connector"
echo ""
echo -e "${BOLD}3. Fill in the form:${NC}"
echo -e "   • ${BOLD}Name:${NC} github_connect"
echo -e "   • ${BOLD}MCP Server URL:${NC} $NGROK_URL/sse"
echo -e "   • ${BOLD}Authentication:${NC} No authentication"
echo ""
echo -e "${BOLD}4. Check:${NC} ✅ I trust this application"
echo ""
echo -e "${BOLD}5. Click:${NC} Create"
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}🧪 TEST COMMANDS FOR CHATGPT:${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Try these in ChatGPT after adding the connector:"
echo -e "• ${GREEN}\"Show files in facebook/react\"${NC}"
echo -e "• ${GREEN}\"Read README.md from vercel/next.js\"${NC}"
echo -e "• ${GREEN}\"Search for React repositories\"${NC}"
echo -e "• ${GREEN}\"Get tree structure of microsoft/vscode\"${NC}"
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}📊 Server Status:${NC}"
echo -e "   • MCP Server: ${GREEN}✅ Running${NC} on http://localhost:$PORT"
echo -e "   • Ngrok Tunnel: ${GREEN}✅ Active${NC} at $NGROK_URL"
echo -e "   • GitHub Token: ${GREEN}✅ Configured${NC}"
echo ""
echo -e "${BOLD}Press Ctrl+C to stop the server${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Show server logs in real-time
echo -e "${BLUE}📜 Server Logs:${NC}"
echo -e "${CYAN}───────────────────────────────────────────────────────────${NC}"
tail -f server.log | while read line; do
    # Format MCP requests specially
    if [[ $line == *"MCP Request"* ]]; then
        echo -e "${YELLOW}$line${NC}"
    elif [[ $line == *"Error"* ]] || [[ $line == *"error"* ]]; then
        echo -e "${RED}$line${NC}"
    elif [[ $line == *"✅"* ]] || [[ $line == *"Success"* ]]; then
        echo -e "${GREEN}$line${NC}"
    else
        echo "$line"
    fi
done &
TAIL_PID=$!

# Wait for processes
wait $SERVER_PID