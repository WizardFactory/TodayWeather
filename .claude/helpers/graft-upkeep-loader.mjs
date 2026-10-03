// Disable only the exact tested package's automatic wiring/update pass.
let upkeep;
export function initialize(data) { upkeep = data.upkeep; }
export async function load(url, context, nextLoad) {
  if (url === upkeep) {
    return { format: 'module', shortCircuit: true,
      source: 'export function runUpkeep() { return { lines: [] }; }' };
  }
  return nextLoad(url, context);
}
