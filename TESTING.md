# Testing Guide

Quick reference for running tests in the github-mcp-proxy project.

## Quick Start

```bash
# Install dependencies (if not already done)
npm install

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Organization

```
tests/
├── setup.js                      # Test environment configuration
├── unit/                         # Unit tests (131 tests)
│   ├── auth.test.js             # Authentication middleware (12 tests)
│   ├── ratelimit.test.js        # Rate limiting logic (14 tests)
│   ├── cache.test.js            # Cache management (24 tests)
│   └── schema-validation.test.js # JSON Schema validation (81 tests)
├── integration/                 # Integration tests (coming soon)
└── e2e/                        # End-to-end tests (coming soon)
```

## Current Test Coverage

- **Total Tests**: 131
- **Pass Rate**: 100%
- **Test Suites**: 4
- **Run Time**: ~2.3 seconds

### Test Breakdown

| Test Suite | Tests | Coverage |
|------------|-------|----------|
| Authentication | 12 | Token validation, ChatGPT compat, edge cases |
| Rate Limiting | 14 | PR creation/merge limits, time windows |
| Cache Management | 24 | Storage, TTL, size limits, key handling |
| **Schema Validation** | **81** | **All 14 MCP tools, validation rules, error formatting** |

## Running Specific Tests

```bash
# Run only unit tests
npm run test:unit

# Run only integration tests (when available)
npm run test:integration

# Run only e2e tests (when available)
npm run test:e2e

# Run a specific test file
npx jest tests/unit/auth.test.js

# Run tests matching a pattern
npx jest --testNamePattern="should allow"
```

## Coverage Reports

```bash
# Generate coverage report
npm run test:coverage

# Coverage files are in: ./coverage/
# Open HTML report: ./coverage/lcov-report/index.html
```

## CI/CD

Tests run automatically on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`

CI tests on Node.js versions: 18.x, 20.x, 22.x

See: `.github/workflows/ci.yml`

## Writing New Tests

### Unit Test Template

```javascript
describe('Feature Name', () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

  test('should do something', () => {
    // Arrange
    const input = 'test';

    // Act
    const result = functionUnderTest(input);

    // Assert
    expect(result).toBe('expected');
  });
});
```

### Using Fake Timers

```javascript
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('should expire after TTL', () => {
  // Set something with 5s TTL
  cacheSet('key', 'value', 5000);

  // Advance time
  jest.advanceTimersByTime(6000);

  // Check expired
  expect(cacheGet('key')).toBeNull();
});
```

## Test Configuration

Configuration in `jest.config.js`:

- **Test Environment**: Node.js
- **Coverage Threshold**: 50% (branches, functions, lines, statements)
- **Test Match**: `tests/**/*.test.js`, `tests/**/*.spec.js`
- **Setup File**: `tests/setup.js`

## Troubleshooting

### Tests Not Running?

```bash
# Check Jest is installed
npx jest --version

# Clear Jest cache
npx jest --clearCache

# Run with verbose output
npm test -- --verbose
```

### Coverage Not Showing?

Coverage only tracks files in `collectCoverageFrom` (see `jest.config.js`).
Currently excludes: test files, config files, docs, backups.

### CI Tests Failing?

1. Check Node.js version compatibility (18.x, 20.x, 22.x)
2. Ensure all dependencies are in `package.json`
3. Check environment variables in CI config

## Next Steps

- [ ] Add integration tests with `supertest` and `nock`
- [ ] Add E2E tests for complete MCP workflows
- [ ] Increase coverage to actual implementation files
- [ ] Add mutation testing with Stryker

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Supertest Documentation](https://github.com/ladjs/supertest)
- [Nock Documentation](https://github.com/nock/nock)
- Project Memory: ChromaDB collection `github_mcp_proxy_memory`

---

**Last Updated**: 2025-10-12
**Test Status**: ✅ 131/131 passing
