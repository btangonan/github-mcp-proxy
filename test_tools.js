#!/usr/bin/env node
/**
 * Test script to reproduce the exact tool call failures
 * Simulates what ChatGPT/Render MCP is doing
 */

const axios = require('axios');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8788';

async function testTool(toolName, args) {
  console.log(`\n🧪 Testing ${toolName}...`);
  console.log(`   Args: ${JSON.stringify(args)}`);

  try {
    const response = await axios.post(`${SERVER_URL}/mcp`, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      },
      id: Date.now()
    });

    if (response.data.error) {
      console.log(`   ❌ Error: ${response.data.error.message}`);
      console.log(`   Details:`, JSON.stringify(response.data.error, null, 2));
      return false;
    } else {
      console.log(`   ✅ Success`);
      return true;
    }
  } catch (error) {
    console.log(`   ❌ HTTP Error: ${error.response?.status} ${error.message}`);
    if (error.response?.data) {
      console.log(`   Response:`, JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

async function runTests() {
  console.log('🚀 GitHub MCP Tool Test Suite');
  console.log(`📡 Server: ${SERVER_URL}`);

  const results = {
    working: [],
    failing: []
  };

  // Test cases from user's report
  const tests = [
    // Working tools
    { name: 'fetch', args: { repo: 'octocat/Hello-World' }, expected: 'working' },
    { name: 'get_branches', args: { repo: 'octocat/Hello-World', per_page: 5 }, expected: 'working' },
    { name: 'get_commits', args: { repo: 'octocat/Hello-World', per_page: 3 }, expected: 'working' },

    // Failing tools - exact same args as user tested
    { name: 'read_file', args: { repo: 'octocat/Hello-World', path: 'README' }, expected: 'failing' },
    { name: 'read_file', args: { repo: 'octocat/Hello-World', path: 'README.md', ref: 'master' }, expected: 'failing' },
    { name: 'list_directory', args: { repo: 'octocat/Hello-World', path: '', ref: 'main' }, expected: 'failing' },
    { name: 'get_tree', args: { repo: 'octocat/Hello-World', ref: 'main', recursive: true }, expected: 'failing' },
  ];

  for (const test of tests) {
    const success = await testTool(test.name, test.args);

    if (success) {
      results.working.push(test.name);
    } else {
      results.failing.push(test.name);
    }
  }

  console.log('\n📊 Test Results:');
  console.log(`✅ Working: ${results.working.join(', ')}`);
  console.log(`❌ Failing: ${results.failing.join(', ')}`);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
