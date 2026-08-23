# Overlapping geometry and opacity

Generally we prefer the layer property `fill-extrusion-opacity` over fragment opacities.

`line-opacity`, `fill-opacity` and `icon-opacity` apply to each fragment, so two features of one
layer covering the same pixel blend with each other and a line drawn twice at 0.5 is 0.75. Only
`fill-extrusion-opacity` is applied once for the layer, over a depth prepass. A translucent polygon
layer should therefore be a `fill-extrusion` at the default height of 0, as `subway_stations` is.

A `line` layer has no such property, so a translucent line layer's overlap has to be dissolved out
of the data instead.
