/* Synthetic MidFcstInfoService JSON pages for the S15b mid oracle. */
'use strict';
function envelope(items) {
    return JSON.stringify({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'},
        body: {dataType: 'JSON', items: {item: items}, pageNo: 1, numOfRows: 999, totalCount: items.length}}});
}
function land(regId, over) {
    const item = {regId};
    for (let d = 3; d <= 10; d++) {
        (d <= 7 ? ['Am', 'Pm'] : ['']).forEach(h => {
            item['rnSt' + d + h] = 20 + d;
            item['wf' + d + h] = d % 2 ? '맑음' : '구름많고 비';
        });
    }
    return Object.assign(item, over || {});
}
function temp(regId, over) {
    const item = {regId};
    for (let d = 3; d <= 10; d++) {
        item['taMin' + d] = 10 + d; item['taMin' + d + 'Low'] = 0; item['taMin' + d + 'High'] = 0;
        item['taMax' + d] = 20 + d; item['taMax' + d + 'Low'] = 0; item['taMax' + d + 'High'] = 0;
    }
    return Object.assign(item, over || {});
}
const H = 3600000;
const at = (tmfc, minutes) => Date.UTC(+tmfc.slice(0, 4), +tmfc.slice(4, 6) - 1, +tmfc.slice(6, 8), +tmfc.slice(8, 10) - 9) + minutes * 60000;
const run = (kind, code, tmfc, minutes, items) => ({kind, code, tmfc, fetched_at: at(tmfc, minutes), pages: [envelope(items)]});
module.exports = {scenarios: [{
    id: 'mid',
    runs: [
        run('forecast', '109', '202609240600', 122, [{wfSv: '○ (강수) 25일(목) 오전까지 비가 오겠습니다.'}]),
        run('forecast', '109', '202609240600', 182, [{wfSv: 'refetch of the same publication is skipped'}]),
        run('forecast', '109', '202609241800', 122, [{wfSv: '○ (기온) 평년보다 높겠습니다.'}]),
        run('forecast', '108', '202609241800', 122, [{wfSv: ' '}]),
        run('land', '11B00000', '202609240600', 122, [land('11B00000', {wf5Am: '알수없음', rnSt6Pm: 120, wf8: ' 흐림 '})]),
        run('land', '11B00000', '202609241800', 122, [land('11B00000', {wf3Am: 'x', wf3Pm: 'x', wf4Am: 'x', wf4Pm: 'x', wf5Am: 'x', wf5Pm: 'x', wf6Am: 'x', wf6Pm: 'x',
            wf7Am: 'x', wf7Pm: 'x', wf8: 'x', wf9: 'x', wf10: 'x'})]),
        run('temp', '11B10101', '202609240600', 122, [temp('11B10101', {taMin4: -55, taMax9: '27.5'})]),
        run('temp', '11B10101', '202609241800', 122, [temp('11B10101', Object.fromEntries([3, 4, 5, 6, 7, 8, 9, 10].flatMap(d => [['taMin' + d, 99], ['taMax' + d, 99]])))]),
        run('temp', '11D20501', '202609241800', 122, [temp('11D20501')])
    ],
    queries: [['forecast', '109'], ['forecast', '108'], ['land', '11B00000'], ['temp', '11B10101'], ['temp', '11D20501'], ['land', '11D10000']]
}]};
