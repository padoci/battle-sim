## Tera defense A/B — config=fast (40 battles, 97s)

### Strength

- NEW wins **22** · OLD wins **18** · draws 0
- NEW score (wins + draws/2): **22/40** — ACCEPT (non-negative) on win rate alone
- NEW win rate of decided: **55%**

### Behavioral probe (is the mechanism actually live?)

- Confirmed new defensive-Tera-support plays: **4** total, in **4/40** battles
- A "confirmed new play" = a chosen, tera'd action that appears in NEW's root candidates but was absent from OLD's for the same side/turn — i.e. the fix changed what got considered, not just relabeled something already kept.
- Mechanism is live.
- Sample logs: logs/battle-tera-defense-1.txt, logs/battle-tera-defense-2.txt, logs/battle-tera-defense-3.txt
