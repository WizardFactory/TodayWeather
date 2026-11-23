'use strict';

const https = require('https');
const {spawn} = require('child_process');
const {names, isoDate, digest, validateEdition} = require('./calendar');

const archive = 'https://astro.kasi.re.kr/kor/life/post/almanac?search_year=';
const gazette = 'https://www.gwanbo.go.kr';
const limit = 5 * 1024 * 1024;

function locateEdition(html, year) {
    // The KASI archive can fall back to its newest available edition. The PDF
    // title is checked again, independent of the year requested from the archive.
    const title = new RegExp('(?:>|^)\\s*' + year + '년\\s*월력요항\\s*(?:<|$)');
    if (!title.test(html)) throw new Error('Official edition unavailable for ' + year);
    const button = html.match(/<button\b[^>]*\bid="gwanboLink"[^>]*>/i);
    const link = button && button[0].match(/window\.open\('([^']+)'/);
    if (!link) throw new Error('Missing gazette link');
    const url = new URL(link[1].replace(/&amp;/g, '&'));
    const content = url.searchParams.get('contentId');
    const toc = url.searchParams.get('tocId');
    if (![gazette, 'https://gwanbo.go.kr'].includes(url.origin) || url.pathname !== '/ezpdf/customLayout.jsp' ||
        !/^I\d{15,40}$/.test(content) || !/^I\d{15,40}$/.test(toc)) throw new Error('Invalid gazette link');
    return {sourceUrl: gazette + '/ezpdf/customLayout.jsp?contentId=' + content + '&tocId=' + toc + '&isTocOrder=N', toc};
}
function parseEdition(year, sourceUrl, sourceDigest, text) {
    const header = text.slice(0, 1200);
    const id = /(?:우주항공청|과학기술정보통신부)\s*공고\s*제\s*(\d{4})\s*[-–]\s*(\d{1,8})\s*호/.exec(header);
    const published = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(header);
    const title = new RegExp(year + '년\\s*월력요항');
    const table = /□\s*24\s*절기\s*([\s\S]*?)(?=□|$)/.exec(text);
    if (!id || !published || !title.test(header) || !table) throw new Error('Missing official almanac identity or table');
    const dates = new Map();
    for (const line of table[1].split(/\r?\n/)) {
        const cells = /^\s*([가-힣])\s*([가-힣])\s+(\d{1,2})\s+(\d{1,2})\s+([가-힣])\s*([가-힣])\s+(\d{1,2})\s+(\d{1,2})\s*$/.exec(line);
        if (!cells) {
            if (/\d/.test(line)) throw new Error('Unexpected almanac table row');
            continue;
        }
        for (const start of [1, 5]) {
            const name = cells[start] + cells[start + 1];
            if (!names.includes(name) || dates.has(name)) throw new Error('Duplicate or unknown term in gazette');
            dates.set(name, isoDate(year, +cells[start + 2], +cells[start + 3]));
        }
    }
    const publicationDate = isoDate(+published[1], +published[2], +published[3]);
    const edition = {year, id: id[1] + '-' + id[2], publicationDate,
        order: publicationDate + '/' + id[2].padStart(9, '0'), sourceUrl, sourceDigest,
        dates: names.map(name => dates.get(name))};
    validateEdition(edition);
    return edition;
}
function fetchBytes(url, form) {
    return new Promise((resolve, reject) => {
        const headers = {'User-Agent': 'TodayWeather/1.0', Accept: '*/*'};
        if (form) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            headers['Content-Length'] = Buffer.byteLength(form);
        }
        const req = https.request(url, {method: form ? 'POST' : 'GET', headers}, res => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(new URL(url).hostname + ' HTTP ' + res.statusCode));
                return;
            }
            const chunks = [];
            let size = 0;
            res.on('error', reject);
            res.on('data', chunk => {
                size += chunk.length;
                if (size > limit) req.destroy(new Error('Official document exceeds size limit'));
                else chunks.push(chunk);
            });
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        const deadline = setTimeout(() => req.destroy(new Error('Official source timeout')), 30000);
        req.once('close', () => clearTimeout(deadline));
        req.once('error', reject);
        req.end(form);
    });
}

function extractText(pdf) {
    if (!Buffer.isBuffer(pdf) || pdf.length > limit || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        return Promise.reject(new Error('Invalid gazette PDF'));
    }
    return new Promise((resolve, reject) => {
        const worker = spawn('pdftotext', ['-enc', 'UTF-8', '-layout', '-', '-'], {stdio: ['pipe', 'pipe', 'ignore']});
        const timer = setTimeout(() => worker.kill('SIGKILL'), 15000);
        const chunks = [];
        let bytes = 0;
        worker.once('error', error => { clearTimeout(timer); reject(error); });
        worker.stdin.on('error', reject);
        worker.stdout.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > limit) worker.kill('SIGKILL');
            else chunks.push(chunk);
        });
        worker.once('close', code => {
            clearTimeout(timer);
            if (code !== 0 || bytes > limit) reject(new Error('Failed to extract almanac table'));
            else resolve(Buffer.concat(chunks).toString('utf8'));
        });
        worker.stdin.end(pdf);
    });
}

async function fetchEdition(year, fetch = fetchBytes, extract = extractText) {
    const html = await fetch(archive + year);
    const {toc, sourceUrl} = locateEdition(html.toString('utf8'), year);
    const pdf = await fetch(gazette + '/user/common/ofcttCntntDownload.do', 'cntnt_seq_no=' + toc);
    const edition = parseEdition(year, sourceUrl, digest(pdf), await extract(pdf));
    return {edition, pdf};
}
module.exports = {locateEdition, parseEdition, extractText, fetchEdition};
