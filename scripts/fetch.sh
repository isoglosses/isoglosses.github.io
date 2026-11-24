#!/usr/bin/env bash
# Downloads the raw census and county files into data/raw/.
# The files are large (the 2020-24 language table alone is ~70 MB), so they are
# not kept in git. Run this once, then `node scripts/build.mjs`.
set -euo pipefail
cd "$(dirname "$0")/../data"
mkdir -p raw && cd raw

ACS=https://www2.census.gov/programs-surveys/acs/summary_file
TIGER=https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb
FAIRFAX="STATE%3D%2751%27+AND+COUNTY+IN+(%27059%27,%27600%27)"

# 2020-24: table-based files (one per table, all geographies).
for t in c16001 b02015 b02018 b03003 b04006; do
  curl -sfo "$t.dat" "$ACS/2024/table-based-SF/data/5YRData/acsdt5y2024-$t.dat"
done

# 2010-14 and 2015-19: sequence files for Virginia tracts.
for y in 2014 2019; do
  mkdir -p "acs$y"
  curl -sfo "acs$y/lookup.txt" "$ACS/$y/documentation/user_tools/ACS_5yr_Seq_Table_Number_Lookup.txt"
  curl -sfo "acs$y/va_tracts.zip" "$ACS/$y/data/5_year_by_state/Virginia_Tracts_Block_Groups_Only.zip"
  (cd "acs$y" && unzip -o -q va_tracts.zip "e${y}5va000[3-7]000.txt" "e${y}5va0044000.txt" "g${y}5va.csv")
done

# Census blocks with people in them (internal point and population only).
curl -sfo blocks.json \
  "$TIGER/Tracts_Blocks/MapServer/12/query?where=$FAIRFAX+AND+POP100%3E0&outFields=GEOID,POP100,AREALAND,INTPTLON,INTPTLAT&returnGeometry=false&f=json"
curl -sfo blocks2010.json \
  "$TIGER/tigerWMS_Census2010/MapServer/18/query?where=$FAIRFAX+AND+POP100%3E0&outFields=GEOID,POP100,AREALAND,INTPTLON,INTPTLAT&returnGeometry=false&f=json"

# FCPS high school attendance areas (Fairfax County GIS open data).
curl -sfo hs.geojson \
  "https://services1.arcgis.com/ioennV6PpG5Xodq0/arcgis/rest/services/High_School_Attendance_Areas/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson"

echo "done: $(ls | wc -l | tr -d ' ') files in data/raw"
