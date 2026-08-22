# Why some OSM data is fetched separately from the basemap

The Protomaps basemap is an OpenStreetMap render, but its schema keeps only the attributes a
general-purpose basemap needs. What the map wants beyond that is fetched from the
[Overpass API](https://overpass-api.de/) as its own GeoJSON source. The basemap still supplies
water, parks, piers, landuse, buildings, boundaries and place labels.

## Roads

`data/fetch_osm_roads.py` fetches every street and every cycleway in one Overpass request and emits
one file, `osm_roads.geojson`. A street carrying a bike lane matches more than one filter and comes
back once, so the street line, its name, its direction caret and its bike lane are all derived from
the same geometry and cannot drift apart. Features carry a `role` of `street` or `bike_lane`.

The basemap is not read for roads at all. Its `roads` layer has no bike lane tagged on a roadway —
only `kind`, `kind_detail` and `oneway` — so the map already needed OSM for the lanes; taking the
street lines from the same place is what makes a caret sit exactly on its line.

### Streets

A street feature carries `kind`, `min_zoom`, `name` and `is_link`. Those are the Protomaps schema's
own field names, so the street and label layers cloned from it keep their line widths and label
placement and only have to be pointed at this source. Bridges and tunnels are not marked, because
the style paints every street one flat colour and Protomaps gives a bridge, a tunnel and a surface
road of the same kind the same line width.

- `oneway` — true when the geometry runs in the direction of travel, so the caret layer needs no
  per-feature rotation. Contiguous ways are merged, undirected for a two-way street so that ways
  digitized towards each other still join into one line for its name.
- `bike_lane_with_traffic` — whether a bike lane already carries traffic the same way. The style
  drops the car caret there and lets the bike lane's own caret show the direction. A contraflow
  lane runs against traffic and does not set it, so that street keeps its caret. When bike lanes
  are hidden the style ignores the flag, since with no bike caret every one-way street shows its
  own.

### Bike lanes

The cycleway tags reduce to the question a cyclist asks: **riding this way, what do I get?** Sides
never reach the output. Two cycleways serving the same direction collapse to one option at the
better class, and what survives is the best class available in each direction of travel.

Where the two directions differ — a protected track one way, a painted lane the other — one line
cannot say so. Those roads are drawn as two lines, each shifted to the right of its own direction of
travel and so onto opposite sides of the road, letting the thick line and the thin one be read side
by side. The offset is baked into the geometry in meters rather than done with a `line-offset`,
because `line-offset` is a paint property of the line layer and the direction carets, being a symbol
layer, would stay behind on the centreline.

- `class` — protected or painted; a shared lane is only a marking, so no line is drawn for it
- `one_way` — whether the line serves the emitted direction only

OSM is a better source than the NYC DOT bike routes feed the map used before. A bike lane is a
property of the road, so the geometry is the road's; the DOT feed digitized routes independently
and split them at every block, 24,451 parts with a median length of 60 m. Direction is recorded
too: DOT's `bikedir` was R, L or 2 relative to its own geometry, which says nothing about which way
traffic runs, while OSM gives the roadway's `oneway`, the per-side `cycleway:*:oneway` and the
contraflow `opposite_*` values.

## Why not build our own basemap tiles

The tiles are Protomaps Basemap 4.15.2, built with [Planetiler](https://github.com/onthegomap/planetiler)
from a Java profile. Emitting extra attributes means forking that profile, which brings in a JDK
and a full tile build from a regional `.osm.pbf` on every data refresh. An Overpass query costs a
few seconds and no new toolchain, and the layers still taken from the basemap need no attribute the
published tiles lack.

That trade turns over if the map ever wants attributes the basemap drops from those remaining
layers. Planetiler's declarative YAML schema is the cheaper of the two custom-tile routes, since it
needs the jar but no Java code.
