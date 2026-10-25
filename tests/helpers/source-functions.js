// Exercise existing calculation code without refactoring money/storage during an audit.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { toSatang } from '../../src/money.js';

export const mainSource = readFileSync(new URL('../../src/main.jsx', import.meta.url), 'utf8');
export function settlementsFor({ friends, billItems, allocations, total }) {
  const start = mainSource.indexOf('  const calculateSettlements = () => {');
  const end = mainSource.indexOf('\n  const finishSplitting', start);
  const script = mainSource.slice(start, end) + '\ncalculateSettlements();';
  return JSON.parse(JSON.stringify(vm.runInNewContext(script, { friends, billItems, allocations, total, toSatang })));
}
export function plainOcr(text) {
  const constants = mainSource.slice(mainSource.indexOf('const THAI_DIGITS'), mainSource.indexOf('const HISTORY_CATEGORIES'));
  const helpers = mainSource.slice(mainSource.indexOf('function normalizeThaiDigits'), mainSource.indexOf('function selectWholeValue'));
  const parser = mainSource.slice(mainSource.indexOf('function parseThaiBillText'), mainSource.indexOf('function parseThaiBillTsv'));
  return JSON.parse(JSON.stringify(vm.runInNewContext(`${constants}\n${helpers}\n${parser}\nparseThaiBillText(text)`, { text })));
}
