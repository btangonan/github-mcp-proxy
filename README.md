# GitHub MCP Server for ChatGPT 🚀 **[WORKING SOLUTION]**

A fully functional MCP (Model Context Protocol) server that enables ChatGPT to browse GitHub repositories, read files, and access code directly through connectors. **This actually works** - tested and confirmed with ChatGPT!

## Features

- 🔍 **Search** GitHub repositories
- 📂 **Browse** directory contents
- 📄 **Read** individual files
- 🌳 **View** full repository structures
- 📜 **Access** commit history
- 🌿 **List** repository branches
- 🔒 **Secure**: Your PAT stays on your local machine

## Prerequisites

- Node.js 18+ installed
- GitHub Personal Access Token
- ngrok account (free) - ChatGPT requires public HTTPS URLs
- ChatGPT with ability to add custom connectors

## Quick Start (5 minutes) ✅

**Want the absolute simplest setup? See [QUICKSTART.md](QUICKSTART.md) for 3-step instructions!**

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/github-mcp-proxy.git
cd github-mcp-proxy
npm install
```

### 2. Configure GitHub Token

Create `.env` file:
```bash
GITHUB_PAT=ghp_yourPersonalAccessTokenHere
PORT=8787
```

Get your GitHub PAT from [github.com/settings/tokens](https://github.com/settings/tokens) with `public_repo` scope.

### 3. Install ngrok

```bash
# macOS
brew install ngrok

# Sign up for free account at
# https://dashboard.ngrok.com/signup

# Configure your auth token
ngrok config add-authtoken YOUR_NGROK_TOKEN
```

### 4. Start the Server

```bash
# Terminal 1: Start MCP server
node github-mcp-enhanced.js

# Terminal 2: Create public tunnel
ngrok http 8787
```

You'll see:
```
Forwarding: https://abc123.ngrok-free.app -> http://localhost:8787
```

### 5. Add to ChatGPT

1. Go to ChatGPT → Settings → Connectors
2. Click "Add Connector"
3. Fill in:
   - **Name**: `github_connect`
   - **URL**: `https://YOUR_NGROK_URL.ngrok-free.app/sse`
   - **Auth**: No authentication
4. Check "I trust this application"
5. Click "Create"

### 6. Use in ChatGPT

Start a new chat with the connector enabled:

- "Browse the src folder in facebook/react"
- "Read the README from vercel/next.js"
- "Show me recent commits in microsoft/vscode"
- "Get the full tree structure of vuejs/vue"

## Available MCP Tools

| Tool | Description | Example Request |
|------|-------------|-----------------|
| `search` | Search GitHub repositories | "Find React UI libraries" |
| `fetch` | Get repository metadata | "Info about facebook/react" |
| `list_directory` | Browse folder contents | "Show files in src/components" |
| `read_file` | Read file contents | "Read package.json from vercel/next.js" |
| `get_tree` | Full repository structure | "Show entire repo structure" |
| `get_commits` | Recent commit history | "Show last 10 commits" |
| `get_branches` | List all branches | "What branches exist?" |

## How It Works

1. **Local MCP Server**: Implements the Model Context Protocol with GitHub API integration
2. **ngrok Tunnel**: Provides the public HTTPS URL that ChatGPT requires
3. **GitHub API**: Server uses your PAT to fetch repository data
4. **MCP Tools**: Seven specialized tools for different GitHub operations

## Scripts

- `npm start` - Start the enhanced MCP server
- `npm run dev` - Start with auto-reload (if nodemon installed)

The server runs on port 8787 by default (configurable in `.env`).

## Troubleshooting

**"Error creating connector"**
- Make sure you're using the ngrok HTTPS URL, not localhost
- ChatGPT blocks all localhost/HTTP URLs for security
- Ensure the `/sse` endpoint is included in the URL

**No requests in logs**
- ChatGPT blocks localhost - you must use ngrok
- Verify ngrok is running and forwarding to port 8787
- Check ngrok dashboard at http://localhost:4040

**Connector is grayed out**
- Connectors are enabled per-conversation
- Start a NEW chat and enable the connector

**Authentication errors**
- Verify your PAT has `public_repo` scope
- Check that the token hasn't expired
- Ensure the PAT is in the `.env` file

## Security Notes

- ✅ Your PAT stays on your local machine
- ✅ ngrok provides secure HTTPS tunneling
- ✅ ChatGPT never sees your actual token
- ⚠️ Never commit `.env` to version control

## Project Structure

```
github-mcp-proxy/
├── github-mcp-enhanced.js  # Main MCP server (v2.0)
├── .env                     # Your GitHub PAT (git-ignored)
├── package.json            # Dependencies
└── README.md              # This file
```

## License

MIT