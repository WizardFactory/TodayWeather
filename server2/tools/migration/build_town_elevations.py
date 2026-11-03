#!/usr/bin/env python3
"""Build data/town_elevations.csv: terrain elevation of each town at its official KMA coordinate.

Inputs, all passed as arguments and never read at runtime: the skadi SRTM tiles and the KMA short
forecast guide archive holding the official grid and coordinate workbook. A town is listed only
when its name joins an official row, or the numbered parts of one; other towns stay unverified.
"""
import argparse
import array
import csv
import gzip
import io
import math
import pathlib
import re
import statistics
import sys
import xml.etree.ElementTree as ET
import zipfile

MAIN = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
FIRST = {'강원도': '강원특별자치도', '전라북도': '전북특별자치도'}


class Terrain:
    """Bilinear samples from north-west-first, row-major, big-endian 16-bit skadi tiles."""

    def __init__(self, directory):
        self.directory = pathlib.Path(directory)
        self.tiles = {}

    def tile(self, lat, lon):
        key = (lat, lon)
        if key not in self.tiles:
            path = self.directory / f'N{lat:02d}E{lon:03d}.hgt.gz'
            if path.exists():
                cells = array.array('h')
                cells.frombytes(gzip.decompress(path.read_bytes()))
                if sys.byteorder == 'little':
                    cells.byteswap()
                self.tiles[key] = (cells, math.isqrt(len(cells)))
            else:
                self.tiles[key] = None
        return self.tiles[key]

    def at(self, lat, lon):
        found = self.tile(math.floor(lat), math.floor(lon))
        if not found:
            return None
        cells, size = found
        x = (lon - math.floor(lon)) * (size - 1)
        y = (math.floor(lat) + 1 - lat) * (size - 1)
        row, col = int(y), int(x)
        below, right = min(row + 1, size - 1), min(col + 1, size - 1)
        fy, fx = y - row, x - col
        corners = [cells[row * size + col], cells[row * size + right],
                   cells[below * size + col], cells[below * size + right]]
        if -32768 in corners:
            known = [c for c in corners if c != -32768]
            return sum(known) / len(known) if known else None
        return ((corners[0] * (1 - fx) + corners[1] * fx) * (1 - fy)
                + (corners[2] * (1 - fx) + corners[3] * fx) * fy)

    def window(self, lat, lon, radius_km, step_km):
        dy = step_km / 111.0
        dx = dy / math.cos(math.radians(lat))
        steps = int(radius_km / step_km)
        samples = []
        for a in range(-steps, steps + 1):
            for b in range(-steps, steps + 1):
                if a * a + b * b <= steps * steps:
                    value = self.at(lat + a * dy, lon + b * dx)
                    if value is not None:
                        samples.append(max(value, 0.0))
        return sorted(samples)


def official_rows(guide):
    with zipfile.ZipFile(guide) as outer:
        name = next(n for n in outer.namelist() if n.endswith('.xlsx'))
        workbook = zipfile.ZipFile(io.BytesIO(outer.read(name)))
    strings = [''.join(t.text or '' for t in si.iter(MAIN + 't'))
               for si in ET.fromstring(workbook.read('xl/sharedStrings.xml')).findall(MAIN + 'si')]
    sheet = sorted(n for n in workbook.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n))[0]
    rows = []
    for row in ET.fromstring(workbook.read(sheet)).iter(MAIN + 'row'):
        cells = {}
        for cell in row.findall(MAIN + 'c'):
            value = cell.find(MAIN + 'v')
            if value is not None:
                column = re.match(r'[A-Z]+', cell.get('r')).group()
                cells[column] = strings[int(value.text)] if cell.get('t') == 's' else value.text
        rows.append(cells)
    return [(r['C'], r.get('D', ''), r['E'], float(r['O']), float(r['N'])) for r in rows[1:] if r.get('E')]


def norm_town(name):
    return re.sub(r'제(\d)', r'\1', name).replace('.', '·').replace(' ', '')


def norm_city(name):
    return name.replace(' ', '')


class Official:
    def __init__(self, rows):
        self.names = {}
        self.cities = {}
        for first, city, town, lat, lon in rows:
            self.names[(first, norm_city(city), norm_town(town))] = (lat, lon)
            self.cities.setdefault((first, norm_city(city)), []).append((norm_town(town), lat, lon))

    def coordinate(self, first, city, town):
        first, city, town = FIRST.get(first, first), norm_city(city), norm_town(town)
        if (first, city, town) in self.names:
            return self.names[(first, city, town)]
        hits = [v for k, v in self.names.items() if k[1] == city and k[2] == town]
        if len(hits) == 1:
            return hits[0]
        # A town the workbook splits into numbered parts: the mean of the parts.
        stem = re.sub(r'\d*동$', '', town)
        if town.endswith('동') and stem:
            parts = [(lat, lon) for name, lat, lon in self.cities.get((first, city), [])
                     if re.fullmatch(re.escape(stem) + r'\d*(·\d+)*동', name)]
            if parts:
                return (statistics.mean(p[0] for p in parts), statistics.mean(p[1] for p in parts))
        return None


def towns(data):
    found = {}
    for name in ('part.csv', 'base.csv'):
        with open(pathlib.Path(data) / name, encoding='utf-8-sig', newline='') as source:
            for row in csv.reader(source):
                if len(row) > 4 and row[2] and row[3] != '위도':
                    found.setdefault((row[0], row[1], row[2]), None)
    return list(found)


def estimates(terrain, lat, lon):
    """Median within 500 m, lower quartile within 2 km and the point itself, in whole metres."""
    near, wide = terrain.window(lat, lon, 0.5, 0.5), terrain.window(lat, lon, 2.0, 0.5)
    point = terrain.at(lat, lon)
    if not near or not wide or point is None:
        return None
    return (round(statistics.median(near)), round(wide[min(len(wide) - 1, len(wide) // 4)]), round(max(point, 0.0)))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tiles', required=True)
    parser.add_argument('--guide', required=True)
    parser.add_argument('--data', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args(argv)
    official = Official(official_rows(args.guide))
    terrain = Terrain(args.tiles)
    listed = skipped = 0
    with open(args.out, 'w', encoding='utf-8', newline='\n') as out:
        out.write('first,second,third,median_m,lower_quartile_m,point_m\n')
        for first, second, third in sorted(towns(args.data)):
            coordinate = official.coordinate(first, second, third)
            values = estimates(terrain, *coordinate) if coordinate else None
            if values is None:
                skipped += 1
                continue
            listed += 1
            out.write(f'{first},{second},{third},{values[0]},{values[1]},{values[2]}\n')
    print(f'listed {listed}, unverified {skipped}')


if __name__ == '__main__':
    main()
