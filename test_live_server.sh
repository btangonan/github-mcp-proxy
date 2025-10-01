#!/bin/bash

SERVER_URL="https://github-mcp-server-v2.onrender.com"

echo "🧪 Testing Live Render Server"
echo "📡 Server: $SERVER_URL"
echo ""

# Test 1: read_file (was failing)
echo "Test 1: read_file with octocat/Hello-World README"
curl -s -X POST "$SERVER_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_file","arguments":{"repo":"octocat/Hello-World","path":"README"}},"id":1}' \
  | python3 -c "import json, sys; d=json.load(sys.stdin); print('✅ SUCCESS' if 'result' in d else '❌ ERROR: ' + d.get('error',{}).get('message','Unknown'))"

echo ""

# Test 2: list_directory (was failing)
echo "Test 2: list_directory with octocat/Hello-World root"
curl -s -X POST "$SERVER_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_directory","arguments":{"repo":"octocat/Hello-World","path":""}},"id":2}' \
  | python3 -c "import json, sys; d=json.load(sys.stdin); print('✅ SUCCESS' if 'result' in d else '❌ ERROR: ' + d.get('error',{}).get('message','Unknown'))"

echo ""

# Test 3: get_tree (was failing)
echo "Test 3: get_tree with octocat/Hello-World"
curl -s -X POST "$SERVER_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_tree","arguments":{"repo":"octocat/Hello-World","recursive":true}},"id":3}' \
  | python3 -c "import json, sys; d=json.load(sys.stdin); print('✅ SUCCESS' if 'result' in d else '❌ ERROR: ' + d.get('error',{}).get('message','Unknown'))"

echo ""

# Test 4: get_branches (was working)
echo "Test 4: get_branches (should still work)"
curl -s -X POST "$SERVER_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_branches","arguments":{"repo":"octocat/Hello-World","per_page":5}},"id":4}' \
  | python3 -c "import json, sys; d=json.load(sys.stdin); print('✅ SUCCESS' if 'result' in d else '❌ ERROR: ' + d.get('error',{}).get('message','Unknown'))"

echo ""
echo "📊 Test Complete"
