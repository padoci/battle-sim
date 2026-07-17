import type {SearchConfig} from '../../search/config';
import {FAST, STRONG} from '../../search/config';

/**
 * Dev/tuning parameters carried in the hash query
 * (`#/sixoh?seed=123&config=fast&tera=25`):
 * - seed: reproducible run (draft offers, opponents, battles)
 * - config=fast: d1 search (quick tuning sessions + e2e; STRONG default)
 * - tera: eval TERA_AVAILABLE override — the watch-and-tune knob
 */
export interface DevParams {
  seed?: number;
  config: SearchConfig;
  configName: 'strong' | 'fast';
  tera?: number;
}

export function readDevParams(): DevParams {
  const query = location.hash.split('?')[1] ?? '';
  const params = new URLSearchParams(query);
  const seed = params.get('seed');
  const tera = params.get('tera');
  const fast = params.get('config') === 'fast';
  return {
    seed: seed !== null && Number.isFinite(Number(seed)) ? Number(seed) : undefined,
    config: fast ? FAST : STRONG,
    configName: fast ? 'fast' : 'strong',
    tera: tera !== null && Number.isFinite(Number(tera)) ? Number(tera) : undefined,
  };
}
