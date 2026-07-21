## Joint eval-weight search (config=fast, 8 candidates x 10 battles, 290s)

Baseline (shipped defaults): TERA_AVAILABLE=50, TERA_DECAY_FAINTS=8, STATUS_THREAT=0.6, SWEEPER_DANGER=12, SPEED_TIER=3

| rank | score | teraAvail | teraDecay | statusThreat | sweeperDanger | speedTier |
|---|---|---|---|---|---|---|
| 1 | 6/10 | 64.13 | 8 | 0.69 | 16.34 | 3.29 |
| 2 | 6/10 | 52.02 | 5.96 | 0.63 | 9.11 | 4.33 |
| 3 | 6/10 | 30.9 | 8.24 | 0.8 | 16.14 | 3.54 |
| 4 | 5/10 | 40.09 | 5.36 | 0.65 | 8.67 | 2.63 |
| 5 | 5/10 | 33.63 | 5.7 | 0.87 | 17.09 | 4.17 |
| 6 | 5/10 | 45.23 | 8.55 | 0.72 | 14.54 | 3.66 |
| 7 | 4/10 | 31.03 | 7.66 | 0.37 | 16.49 | 4.48 |
| 8 | 4/10 | 62.86 | 5.79 | 0.8 | 11.6 | 1.68 |

Best candidate scored 6/10 vs baseline defaults (chance level = 5/10).
This is a screening pass, not an acceptance test — confirm any promising
candidate with a dedicated 40-battle scripts/sim-ai-ab.ts-style run before shipping.