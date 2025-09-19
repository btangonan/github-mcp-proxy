# GitHub MCP for ChatGPT - 3 Minute Setup

**This works!** Follow these 3 simple steps to browse GitHub repos from ChatGPT.

## Step 1: Setup (1 minute)

```bash
# Clone and configure
git clone https://github.com/yourusername/github-mcp-proxy.git
cd github-mcp-proxy

# Create .env file with your GitHub token
echo "GITHUB_PAT=ghp_YOUR_TOKEN_HERE" > .env
echo "PORT=8787" >> .env

# Install dependencies
npm install
```

Get your GitHub token from: https://github.com/settings/tokens (needs `public_repo` scope)

## Step 2: Start Server (30 seconds)

```bash
# Run this single command - it handles everything!
./start.sh
```

This will:
- ✅ Start the MCP server
- ✅ Start ngrok tunnel
- ✅ Show you the public URL to use

Look for the ngrok URL like: `https://abc123.ngrok-free.app`

## Step 3: Add to ChatGPT (90 seconds)

1. Copy the ngrok URL from terminal
2. Go to ChatGPT → Settings → Connectors
3. Add connector:
   - **Name**: `github_connect`
   - **URL**: `https://YOUR_NGROK_URL.ngrok-free.app/sse`  ← Add `/sse` at the end!
   - **Auth**: No authentication
4. Check "I trust this application" → Create

## Test It!

Start a NEW chat with the connector enabled and try:
- "Browse the src folder in facebook/react"
- "Read package.json from vercel/next.js"
- "Show the file tree of microsoft/vscode"

## That's it! 🎉

Your ChatGPT can now browse any public GitHub repository!

**Troubleshooting:** If ChatGPT says "Error creating connector", make sure you:
1. Used the ngrok HTTPS URL (not localhost)
2. Added `/sse` at the end of the URL
3. Started a NEW chat with connector enabled