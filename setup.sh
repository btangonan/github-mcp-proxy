#!/bin/bash

echo "═══════════════════════════════════════════════════════════"
echo "🚀 GitHub MCP Proxy - Easy Setup"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node -v)"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
else
    echo "✅ Dependencies already installed"
    echo ""
fi

# Check if .env exists and has a valid token
if [ -f ".env" ]; then
    # Check if token is still the placeholder
    if grep -q "PASTE_YOUR_TOKEN_HERE" .env; then
        echo "⚠️  You need to add your GitHub Personal Access Token!"
        echo ""
    else
        echo "✅ .env file exists with token configured"
        echo ""
        echo "🎉 Setup complete! You can now run:"
        echo "   ./start.sh"
        echo ""
        exit 0
    fi
else
    # Create .env from example
    cp .env.example .env 2>/dev/null || echo "GITHUB_PAT=PASTE_YOUR_TOKEN_HERE
PORT=8788" > .env
fi

# Guide user to get PAT
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Step 1: Get your GitHub Personal Access Token"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Open this link in your browser:"
echo "   👉 https://github.com/settings/tokens/new"
echo ""
echo "2. Settings for your token:"
echo "   • Note: 'GitHub MCP Proxy'"
echo "   • Expiration: 90 days (or your preference)"
echo "   • Scopes to check:"
echo "     ✓ repo (for full access)"
echo "     OR at minimum:"
echo "     ✓ public_repo"
echo "     ✓ read:org"
echo "     ✓ read:user"
echo ""
echo "3. Click 'Generate token' at the bottom"
echo "4. Copy the token (starts with ghp_...)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Step 2: Enter your token"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Paste your GitHub token (it will be hidden):"
read -s GITHUB_TOKEN
echo ""

# Validate token format
if [[ ! $GITHUB_TOKEN =~ ^ghp_[a-zA-Z0-9]{36}$ ]]; then
    echo "⚠️  That doesn't look like a valid GitHub token."
    echo "   Tokens should start with 'ghp_' and be 40 characters total."
    echo ""
    echo "Do you want to continue anyway? (y/n)"
    read -r CONFIRM
    if [[ ! $CONFIRM =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 1
    fi
fi

# Update .env file
sed -i.bak "s/GITHUB_PAT=.*/GITHUB_PAT=$GITHUB_TOKEN/" .env
rm -f .env.bak

echo "✅ Token saved to .env file"
echo ""

# Test the token (optional)
echo "🔍 Testing your token..."
RESPONSE=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user 2>/dev/null)
if echo "$RESPONSE" | grep -q '"login"'; then
    USERNAME=$(echo "$RESPONSE" | grep -o '"login":"[^"]*' | sed 's/"login":"//')
    echo "✅ Token is valid! Connected as: $USERNAME"
else
    echo "⚠️  Could not verify token, but it's been saved."
    echo "   You can test it by running ./start.sh"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "🎉 Setup Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "1. Run the server:  ./start.sh"
echo "2. Add to ChatGPT as described in README.md"
echo ""
echo "To change your token later, edit the .env file"
echo ""