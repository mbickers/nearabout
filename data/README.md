# Why bike routes use NYC DOT data

The map uses NYC DOT data rather than OpenStreetMap (OSM) for bike routes.

The DOT field `facilitycl` classifies routes as protected, painted, or shared—the distinction the
map style needs. OSM represents these categories with `cycleway=track`, `cycleway=lane`, and
`cycleway=shared_lane`. Although OSM can provide more detail, its coverage is inconsistent.

The Protomaps basemap cannot provide this classification. Its schema represents roads with only
`kind` and `kind_detail`. It includes cycleways mapped as separate ways, but not bike lanes tagged
on a roadway. Supporting OSM bike lanes would therefore require a custom extract and schema, not
just a style change.

## Limitations of the DOT data

- It does not identify contraflow lanes. `bikedir` records R, L, or 2 relative to the digitized
  geometry, not the direction of traffic. Determining contraflow would require matching every DOT
  segment to the corresponding basemap road and its traffic direction.
- Its geometry is independent of the basemap, so a bike lane and its underlying street are
  unrelated lines.
- Routes are split into block-length segments, with a median of two points per segment.
  `symbol-spacing` applies separately to each feature, and even a feature shorter than the spacing
  receives one symbol at its midpoint. As a result, bike-lane markers appear more densely spaced
  than street markers configured with the same value.
