'use strict';

const {getJson} = require('../geocoder/transport');

const endpoint = 'https://public-api.meteofrance.fr/public/DPVigilance/v1/';
const geo = 'https://geo.api.gouv.fr/communes';
const issuer = 'meteo-france';
const issuerLabel = 'Météo-France';
const sourceUrl = 'https://vigilance.meteofrance.fr/fr';
const departmentCode = /^(?:0[1-9]|[1-8][0-9]|9[0-5]|2[AB])$/;
const events = ['Vent', 'Pluie-inondation', 'Orages', 'Crues', 'Neige-verglas',
    'Canicule', 'Grand froid', 'Avalanches', 'Vagues-submersion'];
const severities = ['Vert', 'Jaune', 'Orange', 'Rouge'];
const refreshMs = 5 * 60 * 1000;
const retryMs = 60 * 1000;
const maxAgeMs = 16 * 60 * 60 * 1000;

function utc(value) {
    return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(value) ?
        Date.parse(value) : NaN;
}
function iso(value) { return new Date(value).toISOString(); }
function array(value) { return Array.isArray(value) ? value : []; }
function color(value) { return /^[1-4]$/.test(String(value)) ? Number(value) : 0; }

function product(body, type) {
    const p = body && body.product;
    if (p && p.domain_id === 'FRA' && p.warning_type === 'vigilance' && p.type_cdp === type) {
        return p;
    }
}

function parseSnapshot(body, bulletin, now) {
    const map = product(body, 'cdp_carte_externe');
    const meta = body && body.meta;
    if (!map || !meta || !Array.isArray(map.periods)) {
        return;
    }
    const effective = utc(meta.product_datetime);
    const issued = utc(map.update_time);
    if (!(effective <= now && issued <= now)) {
        return;
    }
    const periods = map.periods.map(period => ({
        code: period && period.echeance,
        start: utc(period && period.begin_validity_time),
        end: utc(period && period.end_validity_time),
        domains: period && period.timelaps && period.timelaps.domain_ids
    })).sort((a, b) => a.start - b.start);
    if (!periods.length || periods.length > 2 || periods[0].code !== 'J' ||
        (periods[1] && periods[1].code !== 'J1') || periods[0].start > now ||
        periods.some((p, i) => !(p.end > p.start) || !Array.isArray(p.domains) ||
            (i > 0 && p.start !== periods[i - 1].end))) {
        return;
    }
    const validUntil = Math.min(Math.max(effective, issued) + maxAgeMs, periods[periods.length - 1].end);
    if (validUntil <= now) {
        return;
    }
    const text = product(bulletin, 'cdp_textes');
    const textMeta = bulletin && bulletin.meta;
    const paired = text && textMeta && meta.snapshot_id && textMeta.snapshot_id === meta.snapshot_id &&
        utc(textMeta.product_datetime) === effective;
    return {effective, issued, periods, validUntil, blocks: paired ? array(text.text_bloc_items) : []};
}

function findDescription(blocks, department, hazard, grade, start, end) {
    const paragraphs = new Set();
    for (const block of blocks) {
        if (!block || block.domain_id !== department || block.bloc_id !== 'BULLETIN_DEPARTEMENTAL') {
            continue;
        }
        for (const group of array(block.bloc_items)) {
            for (const detail of array(group && group.text_items)) {
                if (!detail || String(detail.hazard_code) !== hazard) {
                    continue;
                }
                for (const term of array(detail.term_items)) {
                    if (!term || color(term.risk_code) !== grade ||
                        !(utc(term.start_time) < end && utc(term.end_time) > start)) {
                        continue;
                    }
                    for (const section of array(term.subdivision_text)) {
                        const text = array(section && section.text).filter(line => typeof line === 'string').join('\n').trim();
                        if (text) { paragraphs.add(text); }
                    }
                }
            }
        }
    }
    return Array.from(paragraphs).join('\n\n').slice(0, 8000) || undefined;
}

function makeWarning(snapshot, department, hazard, grade, start, end, timing) {
    const event = events[Number(hazard) - 1];
    const severity = severities[grade - 1];
    return {
        id: [issuer, department, hazard, grade, iso(snapshot.issued), iso(start)].join(':'),
        issuer, issuerLabel, sourceUrl, eventCode: hazard, event, language: 'fr',
        severity, product: grade === 2 ? 'advisory' : 'warning',
        headline: 'Vigilance ' + severity.toLowerCase() + ' — ' + event,
        description: findDescription(snapshot.blocks, department, hazard, grade, start, end),
        sentAt: iso(snapshot.issued), effectiveAt: iso(snapshot.effective), expiresAt: iso(end),
        timing,
        ...(timing === 'interval' ? {onsetAt: iso(start), endsAt: iso(end)} : {periodStartsAt: iso(start)}),
        area: {type: 'department', code: department}, matchMethod: 'area-code'
    };
}

function parsePeriod(snapshot, period, department, now) {
    const matches = period.domains.filter(d => d && d.domain_id === department);
    if (matches.length !== 1 || !Array.isArray(matches[0].phenomenon_items)) {
        return;
    }
    const [domain] = matches;
    const warnings = [];
    const seen = new Set();
    let highest = 1;
    for (const item of domain.phenomenon_items) {
        const hazard = String(item && item.phenomenon_id);
        const grade = color(item && item.phenomenon_max_color_id);
        if (!/^[1-9]$/.test(hazard) || seen.has(hazard) || !grade || !Array.isArray(item.timelaps_items)) {
            return;
        }
        seen.add(hazard);
        highest = Math.max(highest, grade);
        if (!item.timelaps_items.length && (hazard === '4' || grade === 1)) {
            if (grade > 1) {
                warnings.push(makeWarning(snapshot, department, hazard, grade, period.start, period.end, 'period-maximum'));
            }
            continue;
        }

        let peak = 0;
        let priorEnd = period.start;
        for (const interval of item.timelaps_items) {
            const start = utc(interval && interval.begin_time);
            const end = utc(interval && interval.end_time);
            const level = color(interval && interval.color_id);
            if (!level || !(start === priorEnd && end > start && end <= period.end)) {
                return;
            }
            priorEnd = end;
            peak = Math.max(peak, level);
            if (level > 1 && end > now && end > snapshot.effective) {
                warnings.push(makeWarning(snapshot, department, hazard, level, start, end, 'interval'));
            }
        }
        if (peak !== grade || priorEnd !== period.end) {
            return;
        }
    }
    return highest === color(domain.max_color_id) ? warnings : undefined;
}

function createVigilanceService(options) {
    const request = options.getJson || getJson;
    const now = options.now || Date.now;
    const key = options.apiKey;
    let cached, pending, previous;
    let nextAttempt = 0;

    async function json(url, headers, timeoutMs, maxBytes, signal) {
        try {
            const result = await request(url, {headers, timeoutMs, maxBytes, signal, headersOnlyOnNon200: true});
            if (result.status === 200 && result.json) {
                return result.body;
            }
        } catch (_) {
            // Upstream transport errors affect only this read.
        }
    }

    function snapshot() {
        const time = now();
        if (cached && cached.freshUntil > time) { return Promise.resolve(cached); }
        if (pending) { return pending; }
        if (time < nextAttempt) { return Promise.resolve(undefined); }

        const headers = {Accept: 'application/json', apikey: key};
        const byteLimit = 2 * 1024 * 1024;
        pending = Promise.all([
            json(endpoint + 'cartevigilance/encours', headers, 2500, byteLimit),
            json(endpoint + 'textesvigilance/encours', headers, 1200, byteLimit)
        ]).then(([map, text]) => {
            const checked = now();
            const parsed = parseSnapshot(map, text, checked);
            if (!parsed || (previous && (parsed.effective < previous.effective || parsed.issued < previous.issued))) {
                cached = undefined;
                nextAttempt = checked + retryMs;
                return;
            }
            previous = {effective: parsed.effective, issued: parsed.issued};
            cached = {...parsed, freshUntil: Math.min(parsed.validUntil, checked + refreshMs)};
            return cached;
        }).finally(() => { pending = undefined; });
        return pending;
    }

    return async function fetchWarnings(location, signal) {
        function envelope(state, department, map, warnings = []) {
            const source = {issuer, issuerLabel, sourceUrl, scope: 'metropolitan-department', state};
            const viewed = {...location};
            if (department) {
                viewed.country = 'FR';
                source.area = {type: 'department', code: department};
            }
            if (map) {
                source.asOf = iso(map.issued);
                source.freshUntil = iso(map.freshUntil);
            }
            return {location: viewed, checkedAt: iso(now()), sources: [source], warnings};
        }
        if (location.lat < 41 || location.lat > 52 || location.lon < -6 || location.lon > 10) {
            return envelope('unsupported');
        }
        if (!key) { return envelope('unavailable'); }

        const query = new URLSearchParams({lat: location.lat, lon: location.lon, fields: 'codeDepartement', limit: 10});
        const communes = await json(geo + '?' + query, {Accept: 'application/json'}, 1800, 32768, signal);
        if (!Array.isArray(communes) || (signal && signal.aborted)) {
            return envelope('unavailable');
        }
        if (!communes.length) { return envelope('unsupported'); }
        const departments = new Set(communes.map(row => row && row.codeDepartement));
        const [department] = departments;
        if (departments.size !== 1 || typeof department !== 'string' || !departmentCode.test(department)) {
            return envelope('unavailable');
        }

        const map = await snapshot();
        const checked = now();
        if (!map || map.freshUntil <= checked) {
            return envelope('unavailable', department);
        }
        const warnings = [];
        let covered = true;
        for (const period of map.periods.filter(value => value.end > checked)) {
            const rows = parsePeriod(map, period, department, checked);
            if (rows) { warnings.push(...rows); } else { covered = false; }
        }
        warnings.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.eventCode.localeCompare(b.eventCode));
        return envelope(covered ? 'current' : 'unavailable', department, map, warnings);
    };
}

module.exports = {createVigilanceService};
