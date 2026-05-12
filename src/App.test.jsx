import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'
import matchData from './data/match.json'

describe('App (Phase 1 — raw data on screen)', () => {
  it('renders home vs away in the heading from match data', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', {
        name: `${matchData.teams.home.name} vs ${matchData.teams.away.name}`,
      }),
    ).toBeInTheDocument()
  })

  it('renders prettified JSON so the full payload is visible', () => {
    const { container } = render(<App />)
    const preEl = container.querySelector('pre')
    expect(preEl).toBeTruthy()
    expect(preEl.textContent).toBe(JSON.stringify(matchData, null, 2))
    expect(preEl.textContent).toContain('"starters"')
    expect(preEl.textContent).toContain('"substitutes"')
  })
})
