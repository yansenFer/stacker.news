import { describe, test } from 'node:test'
import { expect } from 'expect'
import { cachedFetcher } from './fetch.js'

function defer () {
  let res, rej
  const promise = new Promise((resolve, reject) => {
    res = resolve
    rej = reject
  })
  return { promise, resolve: res, reject: rej }
}

describe('cachedFetcher', () => {
  test('cold concurrency invokes fetcher once and shares pending promise', async () => {
    const d = defer()
    let calls = 0
    const fetcher = async (key) => {
      calls++
      return await d.promise
    }

    const cached = cachedFetcher(fetcher, {
      cacheExpiry: 1000,
      forceRefreshThreshold: 2000,
      keyGenerator: (k) => k
    })

    const promises = Array.from({ length: 10 }, () => cached('item-1'))
    expect(calls).toBe(1)

    d.resolve('result-1')
    const results = await Promise.all(promises)
    expect(results).toEqual(Array(10).fill('result-1'))
    expect(calls).toBe(1)
  })

  test('distinct keys invoke fetcher independently', async () => {
    let calls = 0
    const fetcher = async (key) => {
      calls++
      return `result-${key}`
    }

    const cached = cachedFetcher(fetcher, {
      cacheExpiry: 1000,
      forceRefreshThreshold: 2000,
      keyGenerator: (k) => k
    })

    const [r1, r2] = await Promise.all([cached('key-a'), cached('key-b')])
    expect(r1).toBe('result-key-a')
    expect(r2).toBe('result-key-b')
    expect(calls).toBe(2)
  })

  test('undefined results are cached within cacheExpiry', async () => {
    let calls = 0
    const fetcher = async (key) => {
      calls++
      return undefined
    }

    const cached = cachedFetcher(fetcher, {
      cacheExpiry: 1000,
      forceRefreshThreshold: 2000,
      keyGenerator: (k) => k
    })

    const r1 = await cached('undef-key')
    expect(r1).toBeUndefined()
    expect(calls).toBe(1)

    const r2 = await cached('undef-key')
    expect(r2).toBeUndefined()
    expect(calls).toBe(1)
  })

  test('shared rejection and retry on failure', async () => {
    let calls = 0
    let currentDeferred = defer()
    const fetcher = async (key) => {
      calls++
      return await currentDeferred.promise
    }

    const cached = cachedFetcher(fetcher, {
      cacheExpiry: 1000,
      forceRefreshThreshold: 2000,
      keyGenerator: (k) => k
    })

    const p1 = cached('retry-key')
    const p2 = cached('retry-key')
    expect(calls).toBe(1)

    currentDeferred.reject(new Error('fetch failed'))
    await expect(p1).rejects.toThrow('fetch failed')
    await expect(p2).rejects.toThrow('fetch failed')

    // Retry should trigger another call because cache was cleared
    currentDeferred = defer()
    const p3 = cached('retry-key')
    expect(calls).toBe(2)
    currentDeferred.resolve('recovered')
    expect(await p3).toBe('recovered')
  })

  test('force refresh threshold dedupes concurrent foreground refreshes', async () => {
    let calls = 0
    const d = defer()
    const fetcher = async (key) => {
      calls++
      if (calls === 1) return 'initial'
      return await d.promise
    }

    const cached = cachedFetcher(fetcher, {
      cacheExpiry: 10,
      forceRefreshThreshold: 20,
      keyGenerator: (k) => k
    })

    const initial = await cached('key-1')
    expect(initial).toBe('initial')
    expect(calls).toBe(1)

    // Wait until past forceRefreshThreshold
    await new Promise((resolve) => setTimeout(resolve, 35))

    const p1 = cached('key-1')
    const p2 = cached('key-1')
    expect(calls).toBe(2) // Only 1 new call initiated, not 2

    d.resolve('refreshed')
    const [res1, res2] = await Promise.all([p1, p2])
    expect(res1).toBe('refreshed')
    expect(res2).toBe('refreshed')
    expect(calls).toBe(2)
  })

  test('background refresh returns stale data while updating in background', async () => {
    let calls = 0
    const d = defer()
    const fetcher = async (key) => {
      calls++
      if (calls === 1) return 'initial'
      return await d.promise
    }

    const cached = cachedFetcher(fetcher, {
      cacheExpiry: 10,
      forceRefreshThreshold: 500,
      keyGenerator: (k) => k
    })

    const initial = await cached('key-1')
    expect(initial).toBe('initial')
    expect(calls).toBe(1)

    // Wait past cacheExpiry but before forceRefreshThreshold
    await new Promise((resolve) => setTimeout(resolve, 20))

    // First call triggers background refresh and returns stale data
    const stale1 = await cached('key-1')
    expect(stale1).toBe('initial')
    expect(calls).toBe(2)

    // Concurrent call during background refresh also returns stale data without new fetch
    const stale2 = await cached('key-1')
    expect(stale2).toBe('initial')
    expect(calls).toBe(2)

    d.resolve('new-data')
    await new Promise((resolve) => setTimeout(resolve, 5))

    // After background refresh resolves, cache returns new data
    const updated = await cached('key-1')
    expect(updated).toBe('new-data')
    expect(calls).toBe(2)
  })
})
