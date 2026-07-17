# Gauntlet simulation — Can you 6-0?

12 runs/mode · player search = **strong** · draft = **greedy** · easy ramp = **smooth** · 3316s total.

_Auto-drafted teams (greedy); real search + the shipped Easy ramp. FAST understates the STRONG default — read the shape, not the absolute win rate._

## Outcomes

| mode | flawless | reached rung (survival) | mean battles/run |
|---|---|---|---|
| easy | **17%** (2/12) | 100% · 92% · 92% · 83% · 75% · 50% | 4.9 |
| normal | **8%** (1/12) | 100% · 83% · 42% · 25% · 17% · 17% | 2.8 |

## Per-rung win rate (of runs that reached it)

| mode | rung1 | rung2 | rung3 | rung4 | rung5 | rung6 |
|---|---|---|---|---|---|---|
| easy | 92% (11/12) | 100% (11/11) | 91% (10/11) | 90% (9/10) | 67% (6/9) | 33% (2/6) |
| normal | 83% (10/12) | 50% (5/10) | 60% (3/5) | 67% (2/3) | 100% (2/2) | 50% (1/2) |

## Where runs died

| mode | lost r1 | r2 | r3 | r4 | r5 | r6 | flawless |
|---|---|---|---|---|---|---|---|
| easy | 1 | 0 | 1 | 1 | 3 | 4 | 2 |
| normal | 2 | 5 | 2 | 1 | 0 | 1 | 1 |

## Tera timing (player, p1)

| mode | Tera'd in | mean Tera turn | mean % through battle |
|---|---|---|---|
| easy | 100% of battles (59/59) | turn 4.1 | 15% |
| normal | 100% of battles (34/34) | turn 4.9 | 13% |

mean turns/battle: easy 32 · normal 39

wrote logs/gauntlet-sim.md and .json
