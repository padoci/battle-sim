import {describe, expect, it} from 'vitest';
import {renderGamePlan, type GamePlanFacts} from '../../src/analysis/gameplan';

describe('renderGamePlan (template spine)', () => {
  it('renders the full spec template shape', () => {
    const facts: GamePlanFacts = {
      lead: {yourSpecies: 'Great Tusk', pressures: 'Pelipper'},
      preserve: {yourSpecies: 'Blissey', checks: 'Darkrai'},
      clock: {kind: 'weather', label: 'rain'},
      biggestThreat: {
        kind: 'outspeeds-team',
        attackerSpecies: 'Barraskewda',
        outspeedsCount: 6,
        evidence: 'Barraskewda outspeeds all 6 of your team',
      },
    };
    const plan = renderGamePlan(facts);
    expect(plan.sentences).toEqual([
      'Lead Great Tusk to pressure Pelipper.',
      'Preserve Blissey as your check to Darkrai.',
      'Barraskewda outspeeds your whole team — keep it pressured or revenge-kill it early.',
      "You're on a clock vs their rain — don't let the game go long.",
    ]);
    // The polish seam: sentences stay an array, facts ride along.
    expect(Array.isArray(plan.sentences)).toBe(true);
    expect(plan.facts).toBe(facts);
  });

  it('renders a KO-threat sentence when not outsped', () => {
    const plan = renderGamePlan({
      biggestThreat: {
        kind: 'ohko',
        attackerSpecies: 'Darkrai',
        targetSpecies: 'Gliscor',
        moveName: 'Ice Beam',
        evidence: 'x',
      },
    });
    expect(plan.sentences).toEqual([
      "Watch Darkrai's Ice Beam into Gliscor — don't let that trade happen for free.",
    ]);
  });

  it('always says something', () => {
    const plan = renderGamePlan({});
    expect(plan.sentences).toHaveLength(1);
    expect(plan.sentences[0]).toMatch(/tempo/);
  });
});
