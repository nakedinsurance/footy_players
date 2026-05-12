import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMatchData } from './useMatchData'
import matchJson from '../data/match.json'

describe('useMatchData', () => {
  it('returns the imported match.json payload', () => {
    const { result } = renderHook(() => useMatchData())
    expect(result.current).toBe(matchJson)
  })

  it('exposes match metadata and both teams', () => {
    const { result } = renderHook(() => useMatchData())
    const data = result.current

    expect(data.match).toEqual(
      expect.objectContaining({
        home: expect.any(String),
        away: expect.any(String),
        date: expect.any(String),
        venue: expect.any(String),
      }),
    )
    expect(data.teams.home.name).toBe(data.match.home)
    expect(data.teams.away.name).toBe(data.match.away)
  })

  it('has full lineups per PRD: 11 starters, 8 substitutes, coach each side', () => {
    const { result } = renderHook(() => useMatchData())
    const { home, away } = result.current.teams

    for (const team of [home, away]) {
      expect(team.starters).toHaveLength(11)
      expect(team.substitutes).toHaveLength(8)
      expect(team.coach).toEqual(expect.objectContaining({ name: expect.any(String) }))
      expect(team.formation).toMatch(/^\d+-\d+(-\d+)*$/)
      expect(team.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      for (const player of [...team.starters, ...team.substitutes]) {
        expect(player).toEqual(
          expect.objectContaining({
            number: expect.any(Number),
            name: expect.any(String),
            position: expect.any(String),
          }),
        )
      }
    }
  })
})
