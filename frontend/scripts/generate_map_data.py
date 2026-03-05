#!/usr/bin/env python3
"""
Fetch Great Neck peninsula features from OpenStreetMap via Overpass API,
convert to SVG path strings, and output a TypeScript data file.
Includes: streets (all types), parks, buildings, railways, water, coastline.
"""

import requests
import json
import sys

# Bounding box for Great Neck peninsula
SOUTH, WEST = 40.770, -73.750
NORTH, EAST = 40.832, -73.695

# SVG dimensions
SVG_W, SVG_H = 800, 1000
PAD = 30

VILLAGE_CENTERS = {
    "Kings Point":        (40.8175, -73.7350),
    "Great Neck Estates": (40.7975, -73.7350),
    "Kensington":         (40.7930, -73.7230),
    "Thomaston":          (40.7860, -73.7300),
    "Great Neck Plaza":   (40.7870, -73.7220),
    "Great Neck":         (40.7900, -73.7130),
}

VILLAGE_SLUGS = {
    "Kings Point": "kings-point",
    "Great Neck Estates": "gn-estates",
    "Kensington": "kensington",
    "Thomaston": "thomaston",
    "Great Neck Plaza": "gn-plaza",
    "Great Neck": "great-neck",
}


def lat_lng_to_svg(lat, lng, precision=1):
    x = PAD + (lng - WEST) / (EAST - WEST) * (SVG_W - 2 * PAD)
    y = PAD + (1 - (lat - SOUTH) / (NORTH - SOUTH)) * (SVG_H - 2 * PAD)
    return round(x, precision), round(y, precision)


def nearest_village(coords):
    mid_idx = len(coords) // 2
    lat, lng = coords[mid_idx]
    best, best_d = "Great Neck", float("inf")
    for name, (vlat, vlng) in VILLAGE_CENTERS.items():
        d = (lat - vlat) ** 2 + (lng - vlng) ** 2
        if d < best_d:
            best, best_d = name, d
    return best


def fmt(v):
    """Format number: drop trailing .0 for integers."""
    return int(v) if v == int(v) else v


def coords_to_path(svg_coords):
    parts = [f"M{fmt(svg_coords[0][0])} {fmt(svg_coords[0][1])}"]
    for x, y in svg_coords[1:]:
        parts.append(f"L{fmt(x)} {fmt(y)}")
    return "".join(parts)


def coords_to_closed_path(svg_coords):
    return coords_to_path(svg_coords) + "Z"


def simplify_coords(coords, min_dist=2.0):
    """Remove points that are within min_dist pixels of the previous kept point."""
    if len(coords) <= 2:
        return coords
    result = [coords[0]]
    for x, y in coords[1:-1]:
        px, py = result[-1]
        if (x - px) ** 2 + (y - py) ** 2 >= min_dist ** 2:
            result.append((x, y))
    result.append(coords[-1])
    return result


def bbox_size(coords):
    """Return (width, height) of bounding box in SVG pixels."""
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return max(xs) - min(xs), max(ys) - min(ys)


def fetch_query(query, endpoints):
    """Try each endpoint until one succeeds."""
    last_err = None
    for ep in endpoints:
        try:
            resp = requests.post(ep, data={"data": query}, timeout=180)
            resp.raise_for_status()
            d = resp.json()
            print(f"    Got {len(d['elements'])} elements from {ep}", file=sys.stderr)
            return d["elements"]
        except Exception as e:
            last_err = e
            print(f"    {ep} failed: {e}", file=sys.stderr)
    print(f"  All endpoints failed: {last_err}", file=sys.stderr)
    sys.exit(1)


def main():
    print("Fetching OSM data for Great Neck peninsula...", file=sys.stderr)

    bbox = f"{SOUTH},{WEST},{NORTH},{EAST}"
    endpoints = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
    ]

    queries = [
        # 1. All roads including service, footway, cycleway, path
        (
            "roads",
            f'[out:json][timeout:120];way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|footway|cycleway|path|track|steps"]({bbox});out body;>;out skel qt;',
        ),
        # 2a. Buildings — north half
        (
            "buildings-north",
            f'[out:json][timeout:120];way["building"]({(SOUTH+NORTH)/2},{WEST},{NORTH},{EAST});out body;>;out skel qt;',
        ),
        # 2b. Buildings — south half
        (
            "buildings-south",
            f'[out:json][timeout:120];way["building"]({SOUTH},{WEST},{(SOUTH+NORTH)/2},{EAST});out body;>;out skel qt;',
        ),
        # 3. Parks, green areas, leisure
        (
            "green",
            f'[out:json][timeout:60];(way["leisure"~"park|garden|playground|golf_course|pitch"]({bbox});way["landuse"~"grass|recreation_ground|cemetery|forest"]({bbox});way["natural"~"wood|scrub|grassland"]({bbox}););out body;>;out skel qt;',
        ),
        # 4. Water, coastline, railways
        (
            "infra",
            f'[out:json][timeout:60];(way["natural"="coastline"]({bbox});way["natural"="water"]({bbox});way["waterway"]({bbox});way["railway"~"rail|light_rail|subway"]({bbox}););out body;>;out skel qt;',
        ),
    ]

    all_elements = []
    for i, (label, query) in enumerate(queries):
        print(f"  [{i+1}/{len(queries)}] {label}...", file=sys.stderr)
        elements = fetch_query(query, endpoints)
        all_elements.extend(elements)

    print(f"Total: {len(all_elements)} elements", file=sys.stderr)

    # Index nodes
    nodes = {}
    for el in all_elements:
        if el["type"] == "node":
            nodes[el["id"]] = (el["lat"], el["lon"])

    # Road classification
    ROAD_MAJOR = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link"}
    ROAD_SECONDARY = {"secondary", "secondary_link", "tertiary", "tertiary_link"}
    ROAD_RESIDENTIAL = {"residential", "unclassified", "living_street"}
    ROAD_SERVICE = {"service"}
    ROAD_FOOTPATH = {"footway", "cycleway", "path", "track", "steps"}

    # Output accumulators
    major_streets = []
    secondary_streets = []
    village_streets = {slug: [] for slug in VILLAGE_SLUGS.values()}
    service_roads = []
    footpaths = []
    buildings = []
    parks = []
    coastline_paths = []
    water_paths = []
    railway_paths = []

    counts = {}

    for el in all_elements:
        if el["type"] != "way":
            continue

        raw_coords = [nodes[n] for n in el.get("nodes", []) if n in nodes]
        if len(raw_coords) < 2:
            continue

        tags = el.get("tags", {})

        # Use integer precision for buildings/footpaths, 1 decimal for rest
        is_building = bool(tags.get("building"))
        is_footpath = tags.get("highway") in ROAD_FOOTPATH if tags.get("highway") else False
        prec = 0 if (is_building or is_footpath) else 1

        svg_coords = [lat_lng_to_svg(lat, lng, precision=prec) for lat, lng in raw_coords]

        # Coastline
        if tags.get("natural") == "coastline":
            coastline_paths.append(coords_to_path(svg_coords))
            counts["coastline"] = counts.get("coastline", 0) + 1
        # Water
        elif tags.get("natural") == "water" or tags.get("waterway"):
            is_closed = raw_coords[0] == raw_coords[-1] and len(raw_coords) > 3
            water_paths.append(
                coords_to_closed_path(svg_coords) if is_closed else coords_to_path(svg_coords)
            )
            counts["water"] = counts.get("water", 0) + 1
        # Railway
        elif tags.get("railway"):
            railway_paths.append(coords_to_path(svg_coords))
            counts["railway"] = counts.get("railway", 0) + 1
        # Buildings — skip tiny ones (< 3px in either dimension)
        elif is_building:
            if len(raw_coords) >= 4:
                w, h = bbox_size(svg_coords)
                if w >= 3 and h >= 3:
                    simplified = simplify_coords(svg_coords, min_dist=1.5)
                    buildings.append(coords_to_closed_path(simplified))
                    counts["building"] = counts.get("building", 0) + 1
        # Parks / green areas
        elif tags.get("leisure") or tags.get("landuse") in (
            "grass", "recreation_ground", "cemetery", "forest"
        ) or tags.get("natural") in ("wood", "scrub", "grassland"):
            is_closed = raw_coords[0] == raw_coords[-1] and len(raw_coords) > 3
            parks.append(
                coords_to_closed_path(svg_coords) if is_closed else coords_to_path(svg_coords)
            )
            counts["park"] = counts.get("park", 0) + 1
        # Roads
        elif tags.get("highway"):
            hw = tags["highway"]
            if is_footpath:
                simplified = simplify_coords(svg_coords, min_dist=2.0)
                footpaths.append(coords_to_path(simplified))
                counts["footpath"] = counts.get("footpath", 0) + 1
            else:
                path = coords_to_path(svg_coords)
                if hw in ROAD_MAJOR:
                    major_streets.append(path)
                    counts["major"] = counts.get("major", 0) + 1
                elif hw in ROAD_SECONDARY:
                    secondary_streets.append(path)
                    counts["secondary"] = counts.get("secondary", 0) + 1
                elif hw in ROAD_RESIDENTIAL:
                    village = nearest_village(raw_coords)
                    village_streets[VILLAGE_SLUGS[village]].append(path)
                    counts["residential"] = counts.get("residential", 0) + 1
                elif hw in ROAD_SERVICE:
                    service_roads.append(path)
                    counts["service"] = counts.get("service", 0) + 1

    print(f"Counts: {counts}", file=sys.stderr)

    # Village dot positions
    village_dots = []
    for name, (lat, lng) in VILLAGE_CENTERS.items():
        x, y = lat_lng_to_svg(lat, lng)
        village_dots.append({"name": name, "x": x, "y": y})

    output = {
        "coastline": coastline_paths,
        "water": water_paths,
        "railways": railway_paths,
        "parks": parks,
        "buildings": buildings,
        "majorStreets": major_streets,
        "secondaryStreets": secondary_streets,
        "villageStreets": village_streets,
        "serviceRoads": service_roads,
        "footpaths": footpaths,
        "villageDots": village_dots,
    }

    ts_content = f"""// Auto-generated from OpenStreetMap data — do not edit manually
// Generated by scripts/generate_map_data.py

export const MAP_DATA = {json.dumps(output, indent=2)} as const;

export type VillageSlug = keyof typeof MAP_DATA.villageStreets;
"""

    out_path = "src/data/greatNeckMapData.ts"
    with open(out_path, "w") as f:
        f.write(ts_content)
    print(f"Wrote {out_path}", file=sys.stderr)
    print(f"File size: {len(ts_content) // 1024}KB", file=sys.stderr)


if __name__ == "__main__":
    main()
