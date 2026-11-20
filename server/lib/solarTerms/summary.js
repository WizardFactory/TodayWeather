// Korean domestic forecast presentation. The annual resource owns dates and names.
'use strict';
const time = require('../history/policy');
const regions = require('../kmaForecastRegions');

const validIds = new Set(Array.from({length:24}, (_, i) => 'solar-' + i * 15));
const groups = new Set(['featured', 'spare', 'calendar']);
let policy;

function activate(config) {
    if (!config || !Number.isInteger(config.version) || config.version < 1 ||
        !Array.isArray(config.terms) || config.terms.length !== validIds.size) return false;
    const next = new Map();
    for (const row of config.terms) {
        if (!row || !validIds.has(row.id) || next.has(row.id) || !groups.has(row.group)) return false;
        next.set(row.id, row.group);
    }
    policy = next;
    return true;
}
try {
    activate(require('../../config/solar-terms/kr.json'));
} catch (error) {
    // The domestic weather response remains available if the bundled policy is missing.
    console.warn('Korean solar-term policy unavailable:', error.message);
}

const bands = {warning:5, risk:4, meaningful:3, featured:2, routine:1, spare:0};
const precipitationRisks = new Set([16,22,23,26,30,36,37,39,43,44,45,46,48,49,50,51,52,55,56,58]);
const warningTopics = {1:'wind',3:'precipitation',4:'precipitation',9:'temperature-risk',11:'air',12:'temperature-risk',13:'temperature-risk'};

function classify(item, current, units) {
    switch (item.kind) {
    case 'weather':
        if (precipitationRisks.has(current.weatherType)) return ['risk','precipitation'];
        if (current.weatherType === 63) return ['risk','wind'];
        if (current.weatherType === 12) return ['risk','air'];
        if (current.weatherType === 8) return ['risk','visibility'];
        if (current.pty > 0) return ['meaningful','precipitation'];
        return [current.weatherType > 3 ? 'meaningful' : 'routine','weather'];
    case 'precipitation':
        if (!(current.rn1 > 0 && current.pty > 0)) return null;
        return ['meaningful','precipitation'];
    case 'air':
        return [item.grade >= 3 ? 'risk' : 'routine','air'];
    case 'uv':
        return [current.ultrvGrade >= 2 ? 'risk' : 'routine','uv'];
    case 'wind':
        return [current.wsdGrade >= 3 ? 'risk' : 'routine','wind'];
    case 'discomfort':
        return [current.dsplsGrade >= 3 ? 'risk' : 'routine','temperature-risk'];
    case 'feels':
        if (!Number.isFinite(current.sensorytem) || current.sensorytem === -50) return null;
        return [current.heatIndexGrade >= 2 || current.sensorytem <= (units.temperatureUnit === 'F' ? 14 : -10)
            ? 'risk' : 'routine','temperature-risk'];
    case 'change':
        return [item.grade >= (units.temperatureUnit === 'F' ? 6 : 3) ? 'meaningful' : 'routine','change'];
    default:
        return null;
    }
}

function select(items, current, units, term, range, res) {
    const candidates = [];
    function add(band, topic, grade, str) {
        if (typeof str === 'string' && str.trim() && !/\b(?:undefined|NaN)\b/.test(str))
            candidates.push({band:bands[band], topic, grade, str});
    }
    // specialInfo contains active warnings matched to this place; multiple zones may repeat one.
    for (const w of current.specialInfo || []) {
        if (w.weather > 0 && w.level > 0 && w.weatherStr && w.levelStr)
            add('warning', warningTopics[w.weather] || 'warning-' + w.weather, w.level, w.weatherStr + w.levelStr);
    }
    for (const item of items) {
        const priority = classify(item, current, units);
        if (priority) add(priority[0], priority[1], item.grade, item.str);
    }
    // makeSummary historically uses PM and AQI only. Preserve actionable gas grades as well.
    const air = current.arpltn || {};
    for (const gas of ['o3','no2','so2','co']) {
        if (air[gas+'Grade'] >= 3 && air[gas+'Str']) {
            add('risk','air',air[gas+'Grade'],res.__('LOC_'+gas.toUpperCase())+' '+air[gas+'Str']);
        }
    }
    const tempUnit = units.temperatureUnit === 'F' ? '℉' : '℃';
    // Editorial priority thresholds in Celsius, separate from official warning criteria.
    const tempC = units.temperatureUnit === 'F' ? (current.t1h - 32) * 5 / 9 : current.t1h;
    if (Number.isFinite(current.t1h) && current.t1h !== -50 && tempC > -50 && tempC < 60 &&
        (tempC <= -12 || tempC >= 33)) {
        add('risk','temperature-risk',3,res.__('LOC_TEMP')+' '+current.t1h+tempUnit);
    }
    if (range) {
        const extreme = range.extreme;
        add(extreme ? 'risk' : 'meaningful', extreme ? 'temperature-risk' : 'range', 2.5,
            res.__('LOC_TODAY')+' '+res.__('LOC_LOWEST')+' '+range.min+tempUnit+', '+res.__('LOC_HIGHEST')+' '+range.max+tempUnit);
    }
    const group = term && policy && policy.get(term.id);
    if (group && group !== 'calendar') {
        add(group,'calendar',0,term.nameKo);
    }
    // Stable sort preserves established insertion order for equal duties and grades.
    candidates.sort((a,b) => b.band-a.band || b.grade-a.grade);
    const chosen = [];
    for (const item of candidates) {
        if (!chosen.some(x => x.topic === item.topic || x.str === item.str)) chosen.push(item);
        if (chosen.length === 2) break;
    }
    return chosen.map(x => x.str).join(', ');
}

function context(req, res) {
    if (!policy || req.version !== 'v000903' || !req.gCoord || !regions.forProvince(req.params.region) ||
        typeof res.getLocale !== 'function') return null;
    if (req.params.loc && req.solarTermCountry !== 'KR') return null;
    const now = time.key(Date.now(), true);
    const obs = req.current;
    const date = obs.time === 24 ? time.addDays(obs.date, 1) : obs.date;
    if (date !== now || !Number.isInteger(obs.time) || obs.time < 0 || obs.time > 24) return null;
    const year = require('./calendar').readYear(Number(now.slice(0,4)));
    if (!year) return null;
    const iso = now.slice(0,4)+'-'+now.slice(4,6)+'-'+now.slice(6);
    const term = res.getLocale() === 'ko' && !req.solarTermWarningsUnavailable && year.terms.find(entry => entry.date === iso);
    return {date:iso, rank:items => select(items,obs,req.query,term,
        req.solarTermRange && req.solarTermRange.date === now ? req.solarTermRange : null,res)};
}

module.exports = {activate, select, context};
