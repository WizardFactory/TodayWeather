/* S15b-2 station page inputs: committed server2 fixtures, synthetic edge pages and (with
 * S15B_LIVE=1) the local live captures, which are never committed. */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const FIX = path.join(process.env.TW_REPO, 'server2/tests/providers/fixtures');
const LIVE = path.join(__dirname, '../live');
const lite = () => Module._load('iconv-lite', module);
const euc = s => lite().encode(s, 'euc-kr').toString('base64');
const utf = s => Buffer.from(s, 'utf8').toString('base64');
const file = f => fs.readFileSync(f).toString('base64');

function awsPage(pub, rows, opts) {
    opts = opts || {};
    const header = '<tr bgcolor=#AAE3FF align=center class=name><td colspan=3 nowrap>AWS 지점 / 고도</td><td>강수</td><td>강수15</td><td>강수60</td><td>강수3H</td><td>강수6H</td><td>강수12H</td><td>일강수</td><td width=40>기온</td><td colspan=2 width=60>풍향1</td><td>풍속1(m/s)</td><td colspan=2 width=60>풍향10</td><td>풍속10(m/s)</td><td>습도</td><td>해면기압</td><td>위치</td></tr>\n';
    const body = rows.map(r => '<tr align=center class=text>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>\n').join('');
    return '<HTML><HEAD><META http-equiv="Content-Type" content="text/html; charset=euc-kr"></HEAD><BODY>\n' +
        (opts.noHead ? '' : '<span class=ehead>[ 매분관측자료 ] ' + pub + '</span>\n') +
        '<table border=0 cellspacing=0 cellpadding=0>\n<tr><td bgcolor=#999999>\n<table border=0 cellspacing=1 cellpadding=1>\n' +
        header + body + '</table>\n</td></tr></table>\n' + (opts.tail || '') + '</BODY></HTML>\n';
}
const R = (id, name, extra) => Object.assign([id, name, '12m', '<font color=red>○</font>', '0', '0', '0', '0', '0', '0', '18.4', '270.1', 'W', '1.2', '265.0', 'WSW', '1.4', '61', '1013.2', '서울특별시 종로구 송월동'], extra || {});

function pages() {
    const out = [
        {id: 'aws-committed-synthetic', kind: 'aws', base64: file(path.join(FIX, 'aws-minute-euckr.html'))},
        {id: 'city-committed-real-2026-09-25', kind: 'city', content_type: 'text/html;charset=UTF-8', base64: file(path.join(FIX, 'city-obs-2026-09-25.html')), requested: '2026.09.25.19:00'},
        {id: 'city-committed-real-no-ct', kind: 'city', content_type: '', base64: file(path.join(FIX, 'city-obs-2026-09-25.html'))},
        {id: 'city-committed-real-stale', kind: 'city', content_type: 'text/html;charset=UTF-8', base64: file(path.join(FIX, 'city-obs-2026-09-25.html')), requested: '2026.09.25.20:00'},
        {id: 'city-committed-euckr', kind: 'city', content_type: 'text/html', base64: file(path.join(FIX, 'city-obs-euckr.html'))},
        {id: 'aws-edge', kind: 'aws', requested: '2026.10.14.22:00', base64: euc(awsPage('2026.10.14.22:00', [
            R('108', '서울'),
            R('112', '인천', {3: '<font color=blue>●</font>', 4: '1.5', 5: '2.0', 10: '.', 18: '-'}),
            R('113', '0값', {10: '0', 11: '0', 14: '0', 16: '0'}),
            R('114', ' 공백 \n 이름 ', {2: ' 5 m', 17: '&nbsp;77'}),
            R('115', '항목많음').concat(['extra']),
            R('116', '숫자앞', {10: '12.3도', 11: '-.5', 13: 'abc', 18: '1e3'}),
            R('117', '빈칸', {3: '', 4: ' ', 19: ''}),
            R('118', '엔티티&amp;확인', {19: '서울 &lt;중구&gt;'})
        ]))},
        {id: 'aws-minute-latest', kind: 'aws', base64: euc(awsPage('2026.10.14.23:54', [R('108', '서울'), R('400', '강남', {3: '●'})]))},
        {id: 'aws-no-head', kind: 'aws', base64: euc(awsPage('', [R('108', '서울')], {noHead: true}))},
        {id: 'aws-short-pub', kind: 'aws', base64: euc(awsPage('2026.10.14', [R('108', '서울')]))},
        {id: 'aws-stale', kind: 'aws', requested: '2026.10.14.23:00', base64: euc(awsPage('2026.10.14.22:00', [R('108', '서울')]))},
        {id: 'aws-legend-table', kind: 'aws', base64: euc(awsPage('2026.10.14.22:00', [R('108', '서울')],
            {tail: '<table><tr><td>관서용</td><td>방재용</td></tr></table>\n'}))},
        {id: 'city-legacy-layout', kind: 'city', content_type: 'text/html', base64: euc(
            '<html><head><meta http-equiv="Content-Type" content="text/html; charset=euc-kr"></head><body>\n' +
            '<div class="table_topinfo">기상실황표 2026.10.14.22:00</div>\n<table class="table_develop3"><thead>' +
            '<tr id="table_header2"><th>지점</th><th>현재일기</th><th>시정<br>km</th><th>운량<br>1/10</th><th>현재<br>기온</th><th>습도<br>%</th>' +
            '<th>풍향</th><th>풍속<br>m/s<script>x()</script></th><th>새항목</th><th>적설<br>cm</th></tr></thead><tbody>\n' +
            '<tr><td><a href="?stn=108&amp;x=1">서울</a></td><td>맑음</td><td>20 이상</td><td>&nbsp;</td><td>18.4</td><td>61</td><td>남남서</td><td><script>writeWindSpeed(\'1.1\', false)</script></td><td>?</td><td>0.5</td></tr>\n' +
            '<tr><td><a href="x.do?tm=1&stn=102">백령도</a></td><td></td><td>9</td><td>3</td><td>-1.2</td><td></td><td>북</td><td>2.5</td><td>-</td><td></td></tr>\n' +
            '<tr><td>지점없음</td><td>흐림</td><td>1</td><td>1</td><td>1</td><td>1</td><td>동</td><td>1</td><td>1</td><td>1</td></tr>\n' +
            '</tbody></table></body></html>\n')},
        {id: 'city-input-tm', kind: 'city', content_type: 'text/html; charset=utf-8', base64: utf(
            '<html><body><form><input type="hidden" name="tm" value=" 2026.10.14.21:00 "></form>\n' +
            '<table id="weather_table"><thead><tr id="table_header2"><th>이름</th><th>현재기온</th><th>풍속</th><th>해면<br/>기압</th></tr></thead>' +
            '<tbody><tr><td><a href="city-obs.do?stn=133">대전</a></td><td>15.0</td><td></td><td>1015.1</td></tr></tbody></table></body></html>\n')},
        {id: 'city-no-header', kind: 'city', content_type: 'text/html; charset=utf-8', base64: utf(
            '<html><body><div class="cmp-table-topinfo"><strong>기상실황표</strong>2026.10.14.21:00</div><table id="weather_table"><tbody><tr><td>x</td></tr></tbody></table></body></html>')},
        {id: 'city-bad-pub', kind: 'city', content_type: 'text/html; charset=utf-8', base64: utf(
            '<html><body><div class="cmp-table-topinfo">기상실황표 2026-10-14 21:00</div></body></html>')},
        // S15b2-R8: unpadded month, day and hour in the city publication.
        ...[['city-unpadded-pub', '2026.10.05.03:00'], ['city-unpadded-pub-no-request', undefined], ['city-unpadded-stale', '2026.10.05.04:00']].map(([id, requested]) => ({
            id, kind: 'city', content_type: 'text/html;charset=UTF-8', requested, base64: utf(
                '<html><body><div class="cmp-table-topinfo"><strong>기상실황표</strong>2026.10.5.3:00</div><table id="weather_table"><thead><tr id="table_header2"><th>이름</th><th>현재일기</th><th>현재<br/>기온</th></tr></thead>' +
                '<tbody><tr><td><a href="city-obs.do?stn=108">서울</a></td><td>맑음</td><td>9.5</td></tr></tbody></table></body></html>\n')})),
        // S15b2-R9: unknown and HTML5 entities inside and outside the observation tables, and an
        // entity cut by the end of the document.
        {id: 'aws-entities', kind: 'aws', requested: '2026.10.14.22:00', base64: euc(awsPage('2026.10.14.22:00', [
            R('108', '서울&check;', {19: '서울 &doesnotexist; 종로구 &hearts;x'}),
            R('109', '&notanentity;이름', {12: '&NotEqual;W', 13: '1.2&amp'})
        ], {tail: '<p>&doesnotexist;&check;&amp</p>\n'}))},
        {id: 'aws-trailing-entity', kind: 'aws', base64: euc(awsPage('2026.10.14.22:00', [R('108', '서울')]).replace(/\n$/, '') + '\n&cop')},
        {id: 'city-entities', kind: 'city', content_type: 'text/html;charset=UTF-8', base64: utf(
            '<html><body><p>&doesnotexist;</p><div class="cmp-table-topinfo"><strong>기상실황표</strong>2026.10.14.22:00</div><table id="weather_table"><thead><tr id="table_header2"><th>이름</th><th>현재일기</th><th>현재<br/>기온</th></tr></thead>' +
            '<tbody><tr><td><a href="city-obs.do?stn=108&amp;a=&check;">서울&hearts;</a></td><td>맑음&doesnotexist;</td><td>9.5</td></tr></tbody></table></body></html>\n')}
    ];
    if (process.env.S15B_LIVE) {
        out.push({id: 'live-aws-minute', local: true, kind: 'aws', base64: file(path.join(LIVE, 'aws-minute.body'))});
        out.push({id: 'live-aws-hourly', local: true, kind: 'aws', base64: file(path.join(LIVE, 'aws-hourly.body'))});
        out.push({id: 'live-city', local: true, kind: 'city', content_type: 'text/html;charset=UTF-8', base64: file(path.join(LIVE, 'city-obs.body'))});
    }
    return out;
}
function merges() {
    const page = pages();
    const by = id => page.find(p => p.id === id);
    const out = [{id: 'merge-edge', aws_id: 'aws-edge', city_id: 'city-legacy-layout', aws: by('aws-edge').base64, city: by('city-legacy-layout').base64, city_type: 'text/html', requested: '2026.10.14.22:00'}];
    if (process.env.S15B_LIVE) {
        out.push({id: 'merge-live', aws_id: 'live-aws-hourly', city_id: 'live-city', local: true, aws: by('live-aws-hourly').base64, city: by('live-city').base64, city_type: 'text/html;charset=UTF-8'});
    }
    return out;
}
module.exports = {pages, merges, awsPage, euc, utf};
