import type {BattleResult} from './runner';
import type {TurnTrace} from './search';

/**
 * Render one battle as a human-readable log: per turn, both sides' chosen
 * actions with their root mixed-strategy probabilities (so a reviewer can
 * see whether the AI actually mixes/bluffs), then the sim events, then a
 * state line. Unknown protocol lines pass through prefixed with '·' so
 * nothing is silently dropped. Pure function — worker-safe.
 */
export function renderBattle(result: BattleResult, names: [string, string]): string {
  const log = result.protocolLog ?? [];
  const traces = new Map<number, TurnTrace[]>();
  for (const trace of result.trace ?? []) {
    const list = traces.get(trace.turn) ?? [];
    list.push(trace);
    traces.set(trace.turn, list);
  }

  const out: string[] = [];
  out.push(
    `=== ${names[0]} vs ${names[1]} — winner: ${
      result.winner === null ? 'draw/cap' : names[result.winner]
    } in ${result.turns} turns · ${result.decisions} decisions · ${Math.round(
      result.msSearch
    )} ms search · ${result.nodesPerDecision.toFixed(0)} nodes/decision ===`,
    ''
  );

  const ident = (s: string) => s.replace(/^p(\d)a: /, (_, n) => `${names[Number(n) - 1]}'s `);
  const hp = (s: string) => {
    const [current] = s.split(' ');
    if (current.includes('/')) {
      const [a, b] = current.split('/').map(Number);
      return `${Math.round((100 * a) / b)}%`;
    }
    return current === '0' ? 'fainted' : current;
  };

  for (const line of log) {
    const parts = line.split('|');
    const kind = parts[1];
    switch (kind) {
      case 'turn': {
        const turn = Number(parts[2]);
        out.push('', `== Turn ${turn} ==`);
        for (const trace of traces.get(turn) ?? []) {
          for (const side of [0, 1] as const) {
            const index = trace.chosen[side];
            if (index < 0) continue;
            const dist = side === 0 ? trace.solution.row : trace.solution.col;
            const alternatives = trace.labels[side]
              .map((label, k) => ({label, p: dist[k], k}))
              .filter(x => x.p > 0 && x.k !== index)
              .sort((a, b) => b.p - a.p)
              .map(x => `${x.label} ${x.p.toFixed(2)}`)
              .join(', ');
            out.push(
              `${names[side]} -> ${trace.labels[side][index]}  [p=${dist[index].toFixed(2)}${
                alternatives ? ` | ${alternatives}` : ''
              }]`
            );
          }
          out.push(
            `  root v=${trace.solution.value.toFixed(1)}  nodes=${trace.nodes}  ms=${trace.ms.toFixed(0)}`
          );
        }
        break;
      }
      case 'move':
        out.push(`  ${ident(parts[2])} used ${parts[3]}`);
        break;
      case 'switch':
      case 'drag':
        out.push(`  ${ident(parts[2])} switched in (${hp(parts[4] ?? '')})`);
        break;
      case '-damage':
        out.push(`    ${ident(parts[2])} -> ${hp(parts[3])}`);
        break;
      case '-heal':
        out.push(`    ${ident(parts[2])} healed -> ${hp(parts[3])}`);
        break;
      case 'faint':
        out.push(`    ${ident(parts[2])} fainted!`);
        break;
      case '-status':
        out.push(`    ${ident(parts[2])} is now ${parts[3]}`);
        break;
      case '-boost':
        out.push(`    ${ident(parts[2])} +${parts[4]} ${parts[3]}`);
        break;
      case '-unboost':
        out.push(`    ${ident(parts[2])} -${parts[4]} ${parts[3]}`);
        break;
      case '-weather':
        if (parts[2] !== 'none') out.push(`    weather: ${parts[2]}`);
        break;
      case '-sidestart':
        out.push(`    ${parts[2].replace(/^p(\d): /, (_, n) => `${names[Number(n) - 1]}: `)} +${parts[3]}`);
        break;
      case '-sideend':
        out.push(`    ${parts[2].replace(/^p(\d): /, (_, n) => `${names[Number(n) - 1]}: `)} -${parts[3]}`);
        break;
      case '-terastallize':
        out.push(`    ${ident(parts[2])} TERASTALLIZED -> ${parts[3]}`);
        break;
      case 'win':
        out.push('', `** ${parts[2]} wins **`);
        break;
      case '':
      case 'j':
      case 'l':
      case 't:':
      case 'player':
      case 'teamsize':
      case 'gen':
      case 'tier':
      case 'rule':
      case 'start':
      case 'upkeep':
      case '-resisted':
      case '-supereffective':
      case '-crit':
      case '-miss':
      case '-fail':
      case '-immune':
      case '-ability':
      case '-item':
      case '-enditem':
      case '-activate':
      case '-singleturn':
      case '-singlemove':
      case '-start':
      case '-end':
      case '-fieldstart':
      case '-fieldend':
      case 'cant':
      case '-hitcount':
      case '-anim':
      case 'debug':
        // Either noise or detail the damage lines already convey; keep terse.
        if (['-crit', '-miss', '-supereffective', '-resisted', '-immune', 'cant'].includes(kind)) {
          out.push(`    (${kind.replace('-', '')}${parts[2] ? ` ${ident(parts[2])}` : ''})`);
        }
        break;
      default:
        out.push(`  · ${line}`);
    }
  }
  return out.join('\n');
}
