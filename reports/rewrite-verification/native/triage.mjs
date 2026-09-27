// Error triage for harness runs. Usage: node triage.mjs <outDir>...  (reads <outDir>/summary.json)
// Causes are backed by findings.md; anything unmatched is UNCLASSIFIED and blocks a clean pass.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KNOWN = [
    [/You have to register before post/, 'ios: no FCM token before the native notification grant (harness cannot tap it)'],
    [/Publisher misconfiguration|no form\(s\) configured/, 'admob: no UMP consent message in the AdMob console; the app starts ads without UMP'],
    [/latestAirInfo|controller\.air\.js:(22\d|3[0-9]):|aqiStandard\[grade-1\]/, 'server: production API returns no air data'],
    [/invalid day chart in has dust forecast/, 'pre-existing: template evaluated before data (telemetry only)'],
];

// Failed checks whose cause is outside the client (same evidence as above). The stale 2021 bulletin and
// the world-weather 502 were removed after both were fixed in production (rechecked 2026-09-28).
export const KNOWN_CHECKS = [
    [/^fail air-codes count=0/, 'server: production API returns no air data'],
];
export const classifyCheck = (msg) => (KNOWN_CHECKS.find(([re]) => re.test(msg)) || [null, 'UNCLASSIFIED'])[1];

export const classify = (msg) => (KNOWN.find(([re]) => re.test(msg)) || [null, 'UNCLASSIFIED'])[1];

export function report(summary) {
    const fails = summary.checks.filter((c) => !c.ok);
    const lines = [`==== SUMMARY ${summary.platform}`];
    for (const s of summary.scenarios) lines.push(`  ${s.name}: ${s.result} ${s.end ? ((s.end - s.start) / 1000).toFixed(0) + 's' : ''}`);
    lines.push(`  checks: ${summary.checks.length - fails.length} ok / ${fails.length} fail; http ok: ${summary.http}; errors: ${summary.errors.length}; native: ${summary.native.length}`);
    fails.forEach((c) => lines.push(`  FAIL [${c.scenario}] {${classifyCheck(c.msg)}} ${c.msg.slice(0, 220)}`));
    const seen = new Map();
    for (const e of summary.errors) {
        const k = e.msg.replace(/\d{2,}/g, 'N').slice(0, 160);
        if (!seen.has(k)) seen.set(k, { n: 0, e });
        seen.get(k).n++;
    }
    for (const [, v] of seen) lines.push(`  ERR x${v.n} [${v.e.scenario}] {${classify(v.e.msg)}} ${v.e.msg.slice(0, 220)}`);
    summary.native.slice(0, 10).forEach((l) => lines.push(`  NATIVE ${l.slice(0, 240)}`));
    summary.unclassified = summary.errors.filter((e) => classify(e.msg) === 'UNCLASSIFIED').length;
    summary.unclassifiedChecks = fails.filter((c) => classifyCheck(c.msg) === 'UNCLASSIFIED').length;
    lines.push(`  unclassified errors: ${summary.unclassified}; unclassified failed checks: ${summary.unclassifiedChecks} (of ${fails.length})`);
    return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    for (const dir of process.argv.slice(2)) {
        console.log(report(JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'))));
    }
}
