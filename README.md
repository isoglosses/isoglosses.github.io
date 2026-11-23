# Fairfax County Mother Tongue Project

Which languages are spoken where in Fairfax County, where people can get help in
those languages, and how that has changed, all mapped onto the 24 FCPS high
school attendance areas.

Ideas first sketched in August 2026.

## Views

- **Speakers**: people 5+ who speak Spanish, Korean, Chinese, Vietnamese, Arabic
  or Tagalog at home. One dot is 25 speakers, placed in census blocks where
  people live. Or shade each area by its share of residents.
- **Services**: places that serve people in each language, collected and checked
  by hand in `web/services.csv`. Music and culture count as a service.
- **Gaps**: residents who speak English less than "very well," set against the
  services logged for their language (a 3×3 color grid).
- **Over time**: 2010–14, 2015–19 and 2020–24, plus the share of each heritage
  group that still speaks the language at home. Press play to hear it: each
  language is a note of a C pentatonic scale with its own instrument, and the
  octave follows geography (north is higher).

## Running it

```bash
npm install
./scripts/fetch.sh          # downloads ~250 MB of census files into data/raw/
node scripts/build.mjs      # writes web/data.json
cd web && python3 -m http.server 8765
```

Deploy with `npx firebase-tools deploy --only hosting` (serves `web/`).

## Adding services

One row per place in `web/services.csv`:

| column | example |
|---|---|
| name | Example Korean Market |
| category | `Grocery & food`, `Worship`, `Government & civic`, `Library`, `Banking`, `Senior center`, `Media`, `Music & culture`, `Other` |
| languages | language keys separated by `;`, e.g. `korean;chinese` |
| lat, lon | decimal degrees |
| address | street address |
| source | how it was checked (visit, phone call, website) |
| verified | date checked, `YYYY-MM-DD` |

## Method notes

- Language: ACS table C16001 (B16001 for 2010–14). Heritage: Hispanic or
  Latino origin (B03003), Asian groups alone (B02006 / B02015), Arab ancestry
  (B04006).
- Tracts are split among attendance areas by census block population (2010
  blocks for the first two periods, 2020 blocks for the last).
- ACS figures are sample estimates. Small numbers for a single area have wide
  margins of error.
- Heritage counts cover all ages and language counts cover ages 5+, so the
  "kept at home" share runs slightly low.
