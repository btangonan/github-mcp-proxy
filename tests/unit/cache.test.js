/**
 * Unit Tests for Cache Management
 * Tests in-memory cache with TTL functionality
 */

describe('Cache Management', () => {
  let cache;

  beforeEach(() => {
    cache = new Map();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    cache.clear();
  });

  describe('Cache Storage Operations', () => {
    const cacheSet = (key, value, ttl = 300000) => {
      const expiry = Date.now() + ttl;
      cache.set(key, { value, expiry });
    };

    const cacheGet = (key) => {
      if (!cache.has(key)) {
        return null;
      }

      const entry = cache.get(key);
      if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
      }

      return entry.value;
    };

    test('should store and retrieve values', () => {
      cacheSet('key1', 'value1');

      const result = cacheGet('key1');
      expect(result).toBe('value1');
    });

    test('should return null for non-existent keys', () => {
      const result = cacheGet('nonexistent');
      expect(result).toBeNull();
    });

    test('should store different data types', () => {
      cacheSet('string', 'value');
      cacheSet('number', 42);
      cacheSet('object', { foo: 'bar' });
      cacheSet('array', [1, 2, 3]);
      cacheSet('boolean', true);

      expect(cacheGet('string')).toBe('value');
      expect(cacheGet('number')).toBe(42);
      expect(cacheGet('object')).toEqual({ foo: 'bar' });
      expect(cacheGet('array')).toEqual([1, 2, 3]);
      expect(cacheGet('boolean')).toBe(true);
    });

    test('should overwrite existing keys', () => {
      cacheSet('key1', 'value1');
      expect(cacheGet('key1')).toBe('value1');

      cacheSet('key1', 'value2');
      expect(cacheGet('key1')).toBe('value2');
    });

    test('should handle empty string values', () => {
      cacheSet('empty', '');
      expect(cacheGet('empty')).toBe('');
    });

    test('should handle null values', () => {
      cacheSet('null', null);
      expect(cacheGet('null')).toBeNull();
    });

    test('should handle undefined values', () => {
      cacheSet('undefined', undefined);
      expect(cacheGet('undefined')).toBeUndefined();
    });
  });

  describe('TTL (Time To Live) Functionality', () => {
    const cacheSet = (key, value, ttl = 300000) => {
      const expiry = Date.now() + ttl;
      cache.set(key, { value, expiry });
    };

    const cacheGet = (key) => {
      if (!cache.has(key)) {
        return null;
      }

      const entry = cache.get(key);
      if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
      }

      return entry.value;
    };

    test('should expire entries after TTL', () => {
      const ttl = 5000; // 5 seconds
      cacheSet('key1', 'value1', ttl);

      // Should exist immediately
      expect(cacheGet('key1')).toBe('value1');

      // Advance time by 6 seconds (past TTL)
      jest.advanceTimersByTime(6000);

      // Should be expired
      expect(cacheGet('key1')).toBeNull();
    });

    test('should not expire entries before TTL', () => {
      const ttl = 10000; // 10 seconds
      cacheSet('key1', 'value1', ttl);

      // Advance time by 5 seconds (before TTL)
      jest.advanceTimersByTime(5000);

      // Should still exist
      expect(cacheGet('key1')).toBe('value1');
    });

    test('should handle different TTLs for different keys', () => {
      cacheSet('short', 'value1', 5000);
      cacheSet('long', 'value2', 15000);

      // After 6 seconds
      jest.advanceTimersByTime(6000);

      expect(cacheGet('short')).toBeNull();
      expect(cacheGet('long')).toBe('value2');

      // After 16 seconds total
      jest.advanceTimersByTime(10000);

      expect(cacheGet('long')).toBeNull();
    });

    test('should use default TTL when not specified', () => {
      const defaultTTL = 300000; // 5 minutes
      cacheSet('key1', 'value1'); // Using default TTL

      // Advance time by 4 minutes
      jest.advanceTimersByTime(240000);
      expect(cacheGet('key1')).toBe('value1');

      // Advance time by 2 more minutes (past default TTL)
      jest.advanceTimersByTime(120000);
      expect(cacheGet('key1')).toBeNull();
    });

    test('should clean up expired entries on get', () => {
      cacheSet('key1', 'value1', 5000);

      expect(cache.size).toBe(1);

      jest.advanceTimersByTime(6000);

      // Get should trigger cleanup
      cacheGet('key1');

      expect(cache.size).toBe(0);
    });

    test('should handle zero TTL correctly', () => {
      cacheSet('key1', 'value1', 0);

      // With zero TTL, expiry is in the past, so should expire immediately
      // Advance time by 1ms to ensure Date.now() is past expiry
      jest.advanceTimersByTime(1);

      expect(cacheGet('key1')).toBeNull();
    });

    test('should handle very long TTL', () => {
      const longTTL = 86400000; // 24 hours
      cacheSet('key1', 'value1', longTTL);

      // Advance by 23 hours
      jest.advanceTimersByTime(82800000);
      expect(cacheGet('key1')).toBe('value1');

      // Advance by 2 more hours
      jest.advanceTimersByTime(7200000);
      expect(cacheGet('key1')).toBeNull();
    });
  });

  describe('Cache Size Management', () => {
    const cacheSet = (key, value, ttl = 300000, maxSize = 1000) => {
      const expiry = Date.now() + ttl;

      // Check max size and remove oldest entry if needed
      if (cache.size >= maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }

      cache.set(key, { value, expiry });
    };

    const cacheGet = (key) => {
      if (!cache.has(key)) {
        return null;
      }

      const entry = cache.get(key);
      if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
      }

      return entry.value;
    };

    test('should enforce max cache size', () => {
      const maxSize = 3;

      cacheSet('key1', 'value1', 300000, maxSize);
      cacheSet('key2', 'value2', 300000, maxSize);
      cacheSet('key3', 'value3', 300000, maxSize);

      expect(cache.size).toBe(3);

      // Adding 4th entry should evict oldest
      cacheSet('key4', 'value4', 300000, maxSize);

      expect(cache.size).toBe(3);
      expect(cacheGet('key1')).toBeNull(); // Oldest should be evicted
      expect(cacheGet('key4')).toBe('value4'); // Newest should exist
    });

    test('should handle default max size of 1000', () => {
      // Add 1000 entries
      for (let i = 0; i < 1000; i++) {
        cacheSet(`key${i}`, `value${i}`);
      }

      expect(cache.size).toBe(1000);

      // Adding 1001st entry should evict first
      cacheSet('key1000', 'value1000');

      expect(cache.size).toBe(1000);
    });

    test('should clear all entries', () => {
      cacheSet('key1', 'value1');
      cacheSet('key2', 'value2');
      cacheSet('key3', 'value3');

      expect(cache.size).toBe(3);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cacheGet('key1')).toBeNull();
    });

    test('should handle rapid insertion within size limit', () => {
      const maxSize = 10;

      for (let i = 0; i < maxSize; i++) {
        cacheSet(`key${i}`, `value${i}`, 300000, maxSize);
      }

      expect(cache.size).toBe(maxSize);

      // All entries should be retrievable
      for (let i = 0; i < maxSize; i++) {
        expect(cacheGet(`key${i}`)).toBe(`value${i}`);
      }
    });
  });

  describe('Cache Key Management', () => {
    const cacheSet = (key, value, ttl = 300000) => {
      const expiry = Date.now() + ttl;
      cache.set(key, { value, expiry });
    };

    const cacheGet = (key) => {
      if (!cache.has(key)) {
        return null;
      }

      const entry = cache.get(key);
      if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
      }

      return entry.value;
    };

    test('should handle complex cache keys', () => {
      const complexKey = 'GET:/repos/owner/repo/contents/README.md?ref=main';
      cacheSet(complexKey, 'README content');

      expect(cacheGet(complexKey)).toBe('README content');
    });

    test('should treat different keys as separate entries', () => {
      cacheSet('user:123', { name: 'Alice' });
      cacheSet('user:456', { name: 'Bob' });

      expect(cacheGet('user:123')).toEqual({ name: 'Alice' });
      expect(cacheGet('user:456')).toEqual({ name: 'Bob' });
    });

    test('should handle keys with special characters', () => {
      const keys = [
        'key-with-dash',
        'key_with_underscore',
        'key.with.dot',
        'key/with/slash',
        'key?with=query',
        'key#with#hash'
      ];

      keys.forEach(key => {
        cacheSet(key, `value-${key}`);
        expect(cacheGet(key)).toBe(`value-${key}`);
      });
    });
  });

  describe('Edge Cases', () => {
    const cacheSet = (key, value, ttl = 300000) => {
      const expiry = Date.now() + ttl;
      cache.set(key, { value, expiry });
    };

    const cacheGet = (key) => {
      if (!cache.has(key)) {
        return null;
      }

      const entry = cache.get(key);
      if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
      }

      return entry.value;
    };

    test('should handle concurrent reads of same key', () => {
      cacheSet('key1', 'value1');

      const result1 = cacheGet('key1');
      const result2 = cacheGet('key1');
      const result3 = cacheGet('key1');

      expect(result1).toBe('value1');
      expect(result2).toBe('value1');
      expect(result3).toBe('value1');
    });

    test('should handle rapid set and get operations', () => {
      for (let i = 0; i < 100; i++) {
        cacheSet(`key${i}`, `value${i}`);
      }

      for (let i = 0; i < 100; i++) {
        expect(cacheGet(`key${i}`)).toBe(`value${i}`);
      }
    });

    test('should handle negative TTL as expired', () => {
      cacheSet('key1', 'value1', -1000);

      expect(cacheGet('key1')).toBeNull();
    });
  });
});
