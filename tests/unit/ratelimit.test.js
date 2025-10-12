/**
 * Unit Tests for Rate Limiting Logic
 * Tests PR creation and merge rate limiting
 */

describe('Rate Limiting Logic', () => {
  let prRateLimiter;
  let prMergeRateLimiter;

  beforeEach(() => {
    // Initialize fresh rate limiter maps
    prRateLimiter = new Map();
    prMergeRateLimiter = new Map();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('PR Creation Rate Limiting', () => {
    const checkPRRateLimit = (repo, maxRequests = 5, windowMs = 60000) => {
      const now = Date.now();
      const key = repo;

      if (!prRateLimiter.has(key)) {
        prRateLimiter.set(key, []);
      }

      const timestamps = prRateLimiter.get(key);
      const recentRequests = timestamps.filter(ts => now - ts < windowMs);

      if (recentRequests.length >= maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: recentRequests[0] + windowMs
        };
      }

      recentRequests.push(now);
      prRateLimiter.set(key, recentRequests);

      return {
        allowed: true,
        remaining: maxRequests - recentRequests.length,
        resetTime: recentRequests[0] + windowMs
      };
    };

    test('should allow first PR creation request', () => {
      const result = checkPRRateLimit('owner/repo');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    test('should track multiple requests for same repo', () => {
      const repo = 'owner/repo';

      for (let i = 0; i < 3; i++) {
        const result = checkPRRateLimit(repo);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i);
      }
    });

    test('should enforce rate limit after max requests', () => {
      const repo = 'owner/repo';

      // Make 5 allowed requests
      for (let i = 0; i < 5; i++) {
        const result = checkPRRateLimit(repo);
        expect(result.allowed).toBe(true);
      }

      // 6th request should be rejected
      const result = checkPRRateLimit(repo);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    test('should reset rate limit after time window expires', () => {
      const repo = 'owner/repo';

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        checkPRRateLimit(repo);
      }

      // Should be rate limited
      expect(checkPRRateLimit(repo).allowed).toBe(false);

      // Advance time by 61 seconds
      jest.advanceTimersByTime(61000);

      // Should be allowed again
      const result = checkPRRateLimit(repo);
      expect(result.allowed).toBe(true);
    });

    test('should track different repos independently', () => {
      const repo1 = 'owner/repo1';
      const repo2 = 'owner/repo2';

      // Make 5 requests to repo1
      for (let i = 0; i < 5; i++) {
        checkPRRateLimit(repo1);
      }

      // repo1 should be rate limited
      expect(checkPRRateLimit(repo1).allowed).toBe(false);

      // repo2 should still be allowed
      expect(checkPRRateLimit(repo2).allowed).toBe(true);
    });

    test('should handle custom rate limit parameters', () => {
      const repo = 'owner/repo';
      const maxRequests = 10;
      const windowMs = 120000;

      for (let i = 0; i < maxRequests; i++) {
        const result = checkPRRateLimit(repo, maxRequests, windowMs);
        expect(result.allowed).toBe(true);
      }

      const result = checkPRRateLimit(repo, maxRequests, windowMs);
      expect(result.allowed).toBe(false);
    });

    test('should clean up old timestamps correctly', () => {
      const repo = 'owner/repo';

      // Make 3 requests
      checkPRRateLimit(repo);
      checkPRRateLimit(repo);
      checkPRRateLimit(repo);

      // Advance time by 61 seconds (outside window)
      jest.advanceTimersByTime(61000);

      // Make 2 more requests (old ones should be cleaned)
      const result = checkPRRateLimit(repo);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // Should have 4 remaining, not 1
    });
  });

  describe('PR Merge Rate Limiting', () => {
    const checkPRMergeRateLimit = (repo, maxRequests = 5, windowMs = 60000) => {
      const now = Date.now();
      const key = repo;

      if (!prMergeRateLimiter.has(key)) {
        prMergeRateLimiter.set(key, []);
      }

      const timestamps = prMergeRateLimiter.get(key);
      const recentRequests = timestamps.filter(ts => now - ts < windowMs);

      if (recentRequests.length >= maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: recentRequests[0] + windowMs
        };
      }

      recentRequests.push(now);
      prMergeRateLimiter.set(key, recentRequests);

      return {
        allowed: true,
        remaining: maxRequests - recentRequests.length,
        resetTime: recentRequests[0] + windowMs
      };
    };

    test('should independently track merge rate limits', () => {
      const repo = 'owner/repo';

      // Define local checkPRRateLimit for this test
      const checkPRRateLimit = (repo, maxRequests = 5, windowMs = 60000) => {
        const now = Date.now();
        const key = repo;
        if (!prRateLimiter.has(key)) {
          prRateLimiter.set(key, []);
        }
        const timestamps = prRateLimiter.get(key);
        const recentRequests = timestamps.filter(ts => now - ts < windowMs);
        if (recentRequests.length >= maxRequests) {
          return { allowed: false, remaining: 0, resetTime: recentRequests[0] + windowMs };
        }
        recentRequests.push(now);
        prRateLimiter.set(key, recentRequests);
        return { allowed: true, remaining: maxRequests - recentRequests.length, resetTime: recentRequests[0] + windowMs };
      };

      // Exhaust PR creation limit
      for (let i = 0; i < 5; i++) {
        const result = checkPRRateLimit(repo);
        expect(result.allowed).toBe(true);
      }

      // PR creation should be limited
      expect(checkPRRateLimit(repo).allowed).toBe(false);

      // But merge should still be allowed (different limiter)
      const mergeResult = checkPRMergeRateLimit(repo);
      expect(mergeResult.allowed).toBe(true);
    });

    test('should enforce merge rate limits correctly', () => {
      const repo = 'owner/repo';

      // Make 5 merge requests
      for (let i = 0; i < 5; i++) {
        const result = checkPRMergeRateLimit(repo);
        expect(result.allowed).toBe(true);
      }

      // 6th merge should be rejected
      const result = checkPRMergeRateLimit(repo);
      expect(result.allowed).toBe(false);
    });
  });

  describe('Rate Limit State Management', () => {
    test('should initialize empty rate limiter', () => {
      expect(prRateLimiter.size).toBe(0);
      expect(prMergeRateLimiter.size).toBe(0);
    });

    test('should store timestamps for each repo', () => {
      const checkPRRateLimit = (repo) => {
        const now = Date.now();
        if (!prRateLimiter.has(repo)) {
          prRateLimiter.set(repo, []);
        }
        const timestamps = prRateLimiter.get(repo);
        timestamps.push(now);
        prRateLimiter.set(repo, timestamps);
        return { allowed: true };
      };

      checkPRRateLimit('owner/repo1');
      checkPRRateLimit('owner/repo2');
      checkPRRateLimit('owner/repo1');

      expect(prRateLimiter.size).toBe(2);
      expect(prRateLimiter.get('owner/repo1').length).toBe(2);
      expect(prRateLimiter.get('owner/repo2').length).toBe(1);
    });

    test('should handle concurrent requests to different repos', () => {
      const checkPRRateLimit = (repo) => {
        const now = Date.now();
        if (!prRateLimiter.has(repo)) {
          prRateLimiter.set(repo, []);
        }
        const timestamps = prRateLimiter.get(repo);
        timestamps.push(now);
        prRateLimiter.set(repo, timestamps);
        return { allowed: true };
      };

      const repos = ['repo1', 'repo2', 'repo3'];

      repos.forEach(repo => {
        for (let i = 0; i < 3; i++) {
          checkPRRateLimit(repo);
        }
      });

      expect(prRateLimiter.size).toBe(3);
      repos.forEach(repo => {
        expect(prRateLimiter.get(repo).length).toBe(3);
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle zero max requests', () => {
      const checkPRRateLimit = (repo, maxRequests = 0, windowMs = 60000) => {
        const now = Date.now();
        if (!prRateLimiter.has(repo)) {
          prRateLimiter.set(repo, []);
        }
        const timestamps = prRateLimiter.get(repo);
        const recentRequests = timestamps.filter(ts => now - ts < windowMs);
        if (recentRequests.length >= maxRequests) {
          return { allowed: false };
        }
        recentRequests.push(now);
        prRateLimiter.set(repo, recentRequests);
        return { allowed: true };
      };

      const result = checkPRRateLimit('owner/repo', 0);
      expect(result.allowed).toBe(false);
    });

    test('should handle very large time windows', () => {
      const checkPRRateLimit = (repo, maxRequests = 5, windowMs = 86400000) => {
        const now = Date.now();
        if (!prRateLimiter.has(repo)) {
          prRateLimiter.set(repo, []);
        }
        const timestamps = prRateLimiter.get(repo);
        const recentRequests = timestamps.filter(ts => now - ts < windowMs);
        if (recentRequests.length >= maxRequests) {
          return { allowed: false };
        }
        recentRequests.push(now);
        prRateLimiter.set(repo, recentRequests);
        return { allowed: true };
      };

      const repo = 'owner/repo';
      const windowMs = 86400000; // 24 hours

      for (let i = 0; i < 5; i++) {
        checkPRRateLimit(repo, 5, windowMs);
        jest.advanceTimersByTime(60000); // Advance 1 minute each time
      }

      // Should still be rate limited after 5 minutes
      const result = checkPRRateLimit(repo, 5, windowMs);
      expect(result.allowed).toBe(false);
    });
  });
});
