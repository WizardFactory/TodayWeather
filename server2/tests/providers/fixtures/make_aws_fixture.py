#!/usr/bin/env python3
"""Regenerate the synthetic EUC-KR AWS minute fixture (TEST ONLY, no network).

The layout follows the legacy `KmaScraper._parseStnMinInfo` contract: an `.ehead`
element whose last space-separated token is `YYYY.MM.DD.HH:MM`, then a nested
table whose first row is a header. Values are synthetic; they are not a capture.
Run from server2/: python3 tests/providers/fixtures/make_aws_fixture.py
"""
from pathlib import Path

ROWS = [
    ('108', '서울', '86', '○', '0.0', '0.0', '0.0', '0.0', '0.0', '0.0', '18.4', '270', '서', '1.2', '265', '서', '1.4', '61', '1013.2', '서울특별시 종로구'),
    ('112', '인천', '71', '●', '0.5', '1.0', '1.0', '1.0', '1.0', '1.0', '17.9', '45', '북동', '2.1', '50', '북동', '2.0', '77', '1012.8', '인천광역시 중구'),
]
HEADER = ('지점', '지점명', '고도', '강수', '15분', '1시간', '3시간', '6시간', '12시간', '일일', '기온',
          '풍향1', '풍향1', '풍속1', '풍향10', '풍향10', '풍속10', '습도', '기압', '주소')


def page():
    cells = lambda row: ''.join(f'<td>{v}</td>' for v in row)
    rows = ''.join(f'<tr>{cells(r)}</tr>\n' for r in ROWS)
    return (
        '<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=euc-kr">\n'
        '<title>AWS 매분자료</title>\n</head>\n<body>\n'
        '<table><tr><td>\n<span class="ehead">AWS 매분관측자료 2026.10.13.14:32</span>\n'
        f'<table border="1">\n<tr>{cells(HEADER)}</tr>\n{rows}</table>\n'
        '</td></tr></table>\n</body>\n</html>\n'
    )


def city():
    """Legacy EUC-KR city-observation layout (`table_topinfo`, `table_develop3`)."""
    return (
        '<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=euc-kr">\n'
        '<title>도시별관측</title>\n</head>\n<body>\n'
        '<div class="table_topinfo">기상실황표 2026.10.13.14:00</div>\n'
        '<table class="table_develop3">\n<thead><tr id="table_header2"><th>지점</th><th>현재일기</th>'
        '<th>현재기온</th></tr></thead>\n<tbody>\n<tr><td>서울</td><td>맑음</td><td>18.4</td></tr>\n'
        '</tbody>\n</table>\n</body>\n</html>\n'
    )


if __name__ == '__main__':
    for name, text in (('aws-minute-euckr.html', page()), ('city-obs-euckr.html', city())):
        target = Path(__file__).with_name(name)
        target.write_bytes(text.encode('euc-kr'))
        print(target)
