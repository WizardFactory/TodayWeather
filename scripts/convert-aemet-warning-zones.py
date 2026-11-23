#!/usr/bin/env python3
"""Convert the AEMET v6 EPSG:32630 land and coast GIS files to WGS84."""
import gzip
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

import pyproj
import shapefile
from shapely.geometry import shape
from shapely.ops import transform

SOURCE_DIGEST = "d7be17de8b7a3c6a4cc0c00ff59d097443a2c066444633c92a52d5aea33f5a5d"


def ring(coordinates):
    return [[round(x, 7), round(y, 7)] for x, y in coordinates]


def convert(source):
    project = pyproj.Transformer.from_crs(32630, 4326, always_xy=True).transform
    rows = []
    with zipfile.ZipFile(io.BytesIO(source)) as archive:
        for filename in sorted(archive.namelist()):
            if not filename.endswith(".shp"):
                continue
            with shapefile.Reader(
                shp=io.BytesIO(archive.read(filename)),
                dbf=io.BytesIO(archive.read(filename[:-4] + ".dbf")),
                encoding="iso8859-15",
            ) as reader:
                for feature in reader.iterShapeRecords():
                    code, name = feature.record["COD_Z"], feature.record["NOM_Z"]
                    area = transform(project, shape(feature.shape.__geo_interface__))
                    polygons = [area] if area.geom_type == "Polygon" else area.geoms
                    rings = [[ring(poly.exterior.coords)] + [ring(hole.coords) for hole in poly.interiors]
                             for poly in polygons]
                    rows.append([code, name, list(area.bounds), rings])
    rows.sort(key=lambda row: row[0])
    if len(rows) != 233 or len({row[0] for row in rows}) != len(rows):
        raise ValueError("unexpected AEMET zone inventory")
    return gzip.compress(json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode(), mtime=0)


def main():
    _, origin, destination = sys.argv
    source = Path(origin).read_bytes()
    if hashlib.sha256(source).hexdigest() != SOURCE_DIGEST:
        raise ValueError("unexpected AEMET archive version")
    Path(destination).write_bytes(convert(source))


if __name__ == "__main__":
    main()
