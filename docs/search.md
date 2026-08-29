# Location search

Location search uses a static index built from OpenStreetMap data. The browser searches that index
directly.

```text
OpenStreetMap data
        ↓
Extract names and addresses
        ↓
Normalize and index records
        ↓
Publish compressed search data
        ↓
Search and rank in the browser
```

## Building the index

The data task downloads and caches a regional OpenStreetMap extract, clips it to the supported map
area, and keeps named features and addresses. It converts each feature into a label, a location,
and normalized search variants.

PMTiles cannot supply this data: it omits addresses, alternate names, and other stuff.

The builder divides the index into compressed files. This lets the browser load a small part of the
index for each query instead of downloading the complete dataset.

## Searching

The browser normalizes the query and uses its words to find the smallest useful group of
candidates. Queries that begin with a house number also use the address index. Loaded index files
remain cached for later searches.

The search then checks the full query, removes results outside the requested map bounds, ranks the
remaining matches, removes duplicate labels, and returns a limited result set. The UI searches the
visible map first and can expand the same search to the full supported area.

The index builder and browser share normalization code. It handles case, punctuation, diacritics,
apostrophes, ordinals, directions, and common street abbreviations.

Results rank by match quality. Exact matches come before full-query prefixes, exact word matches,
and word-prefix matches.
