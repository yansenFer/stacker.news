import { describe, test, afterEach } from 'node:test'
import { expect } from 'expect'

import { parseInternalLinks, isMisleadingLink, parseEmbedUrl, isExternal, getLinkAttributes } from './url.js'

const internalLinkCases = [
  ['https://stacker.news/items/123', '#123'],
  ['https://stacker.news/items/123/related', '#123/related'],
  // invalid links should not be parsed so user can spot error
  ['https://stacker.news/items/123foobar', undefined],
  // Invalid origin should not be parsed so no malicious links
  ['https://example.com/items/123', undefined],
  // parse referral links
  ['https://stacker.news/items/123/r/ekzyis', '#123'],
  // use comment id if available
  ['https://stacker.news/items/123?commentId=456', '#456'],
  // comment id + referral link
  ['https://stacker.news/items/123/r/ekzyis?commentId=456', '#456'],
  // multiple params
  ['https://stacker.news/items/123?commentId=456&parentId=789', '#456']
]

describe('internal links', () => {
  for (const [href, expected] of internalLinkCases) {
    test(`parses ${href} as ${expected}`, () => {
      process.env.NEXT_PUBLIC_URL = 'https://stacker.news'
      const { linkText: actual } = parseInternalLinks(href)
      expect(actual).toBe(expected)
    })
  }
})

const misleadingLinkCases = [
  // if text is the same as the link, it's not misleading
  ['https://stacker.news/items/1234', 'https://stacker.news/items/1234', false],
  // same origin is not misleading
  ['https://stacker.news/items/1235', 'https://stacker.news/items/1234', false],
  ['www.google.com', 'https://www.google.com', false],
  ['stacker.news', 'https://stacker.news', false],
  // if text is obviously not a link, it's not misleading
  ['innocent text', 'https://stacker.news/items/1234', false],
  ['innocenttext', 'https://stacker.news/items/1234', false],
  // if text might be a link to a different origin, it's misleading
  ['innocent.text', 'https://stacker.news/items/1234', true],
  ['https://google.com', 'https://bing.com', true],
  ['www.google.com', 'https://bing.com', true],
  ['s-tacker.news', 'https://snacker.news', true],
  // don't catch edge cases with spaces
  ['11.1 percent', 'https://example.com', false],
  ['for 11.1 percent', 'https://example.com', false],
  ['v11.1', 'https://example.com', false],
  // don't catch numeric-only, except for IP addresses
  ['11.1', 'https://example.com', false],
  ['11.1.0', 'https://example.com', false],
  ['11.1.0.0', 'https://example.com', true]
]

describe('misleading links', () => {
  for (const [text, href, expected] of misleadingLinkCases) {
    test(`identifies [${text}](${href}) as misleading: ${expected}`, () => {
      const actual = isMisleadingLink(text, href)
      expect(actual).toBe(expected)
    })
  }
})

const nostrEmbedUrlCases = [
  ['https://njump.me/nprofile1qqsfy7f8d0lms08wxw2xu4jvxcq2x2zqy6dgypksrh05p3jr9w4qhjc2xjd74', true],
  ['https://yakihonne.com/note/nevent1qgsfy7f8d0lms08wxw2xu4jvxcq2x2zqy6dgypksrh05p3jr9w4qhjcppemhxue69uhkummn9ekx7mp0qy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7qpqa56frq6ljgdeh85rntn50yv3c9u5ffkd26nzs698h9xuljtezljs98kq07', true],
  ['https://npub1nsyte9neefm3jle7dg5gw6mhchxyk75a6f5dng70l4l3a2mx0nashqv2jk.nsite.lol/', false],
  ['https://njump.me/nevent1qgsfy7f8d0lms08wxw2xu4jvxcq2x2zqy6dgypksrh05p3jr9w4qhjcppemhxue69uhkummn9ekx7mp0qy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7qpqa56frq6ljgdeh85rntn50yv3c9u5ffkd26nzs698h9xuljtezljs98kq07', true],
  ['https://primal.net/p/npub1jfujw6llhq7wuvu5detycdsq5v5yqf56sgrdq8wlgrryx2a2p09svwm0gx', true]
]

describe('embed nostr links', () => {
  for (const [url, expectedEmbed] of nostrEmbedUrlCases) {
    test(`identifies ${url} as embed ${expectedEmbed}`, () => {
      const actual = parseEmbedUrl(url)
      if (expectedEmbed) {
        expect(actual).toMatchObject({ provider: 'nostr' })
      } else {
        expect(actual).toBeNull()
      }
    })
  }
})

describe('isExternal and link attributes', () => {
  const originalUrl = process.env.NEXT_PUBLIC_URL

  afterEach(() => {
    process.env.NEXT_PUBLIC_URL = originalUrl
    delete globalThis.window
  })

  test('classifies off-origin protocol-relative URLs as external', () => {
    process.env.NEXT_PUBLIC_URL = 'https://stacker.news'

    expect(isExternal('//example.com/items/123')).toBe(true)
    expect(isExternal('//stacker.news@example.com/path')).toBe(true)
    expect(isExternal('//stacker.news:8080/path')).toBe(true)
    expect(isExternal('//evil.com')).toBe(true)
    expect(isExternal('//')).toBe(true)

    expect(getLinkAttributes('//example.com/items/123')).toEqual({
      target: '_blank',
      rel: 'noopener nofollow noreferrer'
    })
  })

  test('classifies same-origin protocol-relative URLs as internal', () => {
    process.env.NEXT_PUBLIC_URL = 'https://stacker.news'

    expect(isExternal('//stacker.news/items/123')).toBe(false)
    expect(isExternal('//stacker.news')).toBe(false)

    expect(getLinkAttributes('//stacker.news/items/123')).toEqual({
      target: '',
      rel: ''
    })
  })

  test('classifies absolute paths as internal', () => {
    process.env.NEXT_PUBLIC_URL = 'https://stacker.news'

    expect(isExternal('/items/123')).toBe(false)
    expect(isExternal('/')).toBe(false)
    expect(isExternal('/post')).toBe(false)

    expect(getLinkAttributes('/items/123')).toEqual({
      target: '',
      rel: ''
    })
  })

  test('respects browser window.location.origin for protocol-relative links', () => {
    delete process.env.NEXT_PUBLIC_URL
    globalThis.window = { location: { origin: 'https://staging.stacker.news' } }

    expect(isExternal('//staging.stacker.news/items/123')).toBe(false)
    expect(isExternal('//example.com/items/123')).toBe(true)
  })
})
