// Aggregate supervisor samples; optional public copy replaces PIDs with generations.
import { readFileSync, writeFileSync } from 'node:fs';
const [source, flag, destination] = process.argv.slice(2);
if (!source || (flag && (flag !== '--public-samples' || !destination)) || process.argv.length > 5) throw new Error('INVALID_ARGUMENTS');
const rows = readFileSync(source, 'utf8').trim().split('\n').map(JSON.parse);
const groups = Map.groupBy(rows, row => row.generation ?? row.pid);
const cpu = [...groups.values()].map(group => ({ user: Math.max(...group.map(row => row.userCpuSeconds)), system: Math.max(...group.map(row => row.systemCpuSeconds)) }));
const percentile = (values, fraction) => {
  const sorted = values.sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};
const summary = { samples: rows.length, monitorSeconds: rows.at(-1).elapsedSeconds, processGenerations: groups.size,
  rssMaxMiB: Math.max(...rows.map(row => row.rssKiB)) / 1024, rssLastMiB: rows.at(-1).rssKiB / 1024,
  availableMinMiB: Math.min(...rows.map(row => row.availableKiB)) / 1024,
  tempMinC: Math.min(...rows.map(row => row.temperatureC)), tempMaxC: Math.max(...rows.map(row => row.temperatureC)),
  cpuUserSeconds: cpu.reduce((sum, row) => sum + row.user, 0), cpuSystemSeconds: cpu.reduce((sum, row) => sum + row.system, 0),
  allServicesUnchanged: rows.filter(row => row.servicesUnchanged !== undefined).every(row => row.servicesUnchanged),
  serviceChecks: rows.filter(row => row.servicesUnchanged !== undefined).length, web: {} };
summary.cpuMeanOneCorePercent = 100 * (summary.cpuUserSeconds + summary.cpuSystemSeconds) / summary.monitorSeconds;
for (const label of ['heavensgate', 'forum', 'proxy']) {
  const samples = rows.flatMap(row => row.web ?? []).filter(row => row.label === label);
  summary.web[label] = { samples: samples.length, codes: [...new Set(samples.map(row => row.code))],
    medianMs: 1000 * percentile(samples.map(row => row.seconds), .5), p95Ms: 1000 * percentile(samples.map(row => row.seconds), .95),
    maxMs: 1000 * Math.max(...samples.map(row => row.seconds)) };
}
if (destination) {
  const generations = new Map([...groups.keys()].map((id, index) => [id, index + 1]));
  writeFileSync(destination, rows.map(row => {
    const { pid, generation, ...rest } = row;
    return JSON.stringify({ ...rest, generation: generations.get(generation ?? pid) });
  }).join('\n') + '\n');
}
console.log(JSON.stringify(summary, null, 2));
