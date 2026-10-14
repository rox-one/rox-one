import { describe, expect, it } from 'bun:test'
import { extractLinks, linkCardKind } from '../message-cards'
import { formatCallDuration } from '../use-team-call'
import { initials } from '../ChannelInfoPanel'

describe('team calls UI helpers', () => {
  it('formats the call timer', () => {
    expect(formatCallDuration(0)).toBe('0:00')
    expect(formatCallDuration(458_000)).toBe('7:38')
    expect(formatCallDuration(3_725_000)).toBe('1:02:05')
    expect(formatCallDuration(-5)).toBe('0:00')
  })
  it('extracts link and file cards from message text', () => {
    const text = 'PR https://github.com/rox-one/rox-one/pull/482, макет https://files.rox.one/onboarding-0.12-final.fig. И снова https://github.com/rox-one/rox-one/pull/482'
    const links = extractLinks(text)
    expect(links).toEqual(['https://github.com/rox-one/rox-one/pull/482', 'https://files.rox.one/onboarding-0.12-final.fig'])
    expect(links.map(linkCardKind)).toEqual(['link', 'file'])
    expect(extractLinks('без ссылок')).toEqual([])
  })
  it('builds avatar initials', () => {
    expect(initials('Рамзан Кадыров')).toBe('РК')
    expect(initials('kira')).toBe('K')
    expect(initials('  ')).toBe('?')
  })
})
