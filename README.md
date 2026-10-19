# Rv25Story — the 5 October 2026 bus accident on riksväg 25

An animated, story-driven map reconstructing the response to the line 845
double-decker crash between Växjö and Alvesta. Everything happens on one
map: the crash site, the ambulance runs to Växjö, Ljungby and Värnamo, the
rescue helicopter flight to Karlskrona, onward transfers to Lund and
Linköping, and the background traffic (buses, trams, trains, planes) taken
(synthetic, illustrative). Swedish by default, with English available.

## Run

```bash
python serve.py            # → http://127.0.0.1:8020
```

Keys: **Space** plays or pauses, **← / →** jump to the previous or next event, **Esc** stops following a unit.
Click a unit in the left panel to follow it. Click a chapter to jump to it.
**Tidslinje per enhet** opens a Gantt chart of every unit's phases.

Apart from basemap tiles, the app runs offline. MapLibre and three.js are
vendored in `static/vendor/`.

## Live site

**https://claudiodgl.github.io/BussolyckanRv25/**: GitHub Pages serves the
`gh-pages` branch, which is a copy of `static/`. The app is front-end only,
so `serve.py` is just a local convenience. To publish after committing a
change on `main`:

```bash
git push origin main
git subtree push --prefix static origin gh-pages
```

## Rebuild the data

```bash
python tools/build_scene.py --city-model C:/path/to/city-model
```

This reads a city model's `data/<city>/city.json` (buildings) and
`transport_schedule.json` (transit) for Växjö, Karlskrona, Lund and Linköping.
It fetches road routes from OSRM once and caches them under `cache/`.
All story content (places, unit plan, events) lives in that script.

`tools/shot.py OUT 16:30@crash 17:40@heli …` takes headless screenshots for
checking the visuals.

## What is documented and what is modelled

| | Source |
|---|---|
| 16:30 crash, between Kvälleberg and Hanaslöv, just past Långstorp, westbound | Region Kronoberg, SVT, SR P4 |
| 16:31 alarm; 16:52 Rv 25 closed; 20:28 cordon; 21:28 death announced | Polisen |
| 17:20 hospitals prepare; 17:54 4–6 seriously injured; 19:30 >40 affected / ~10 serious; 22:44 overnight status | Region Kronoberg press releases |
| Patients: Växjö 8 (2 ICU), Ljungby 2, Värnamo 2, Karlskrona 1 (helicopter), Lund 1 | Region Kronoberg 22:44, Hallandsposten/TT |
| Lightly injured taken by bus to vårdcentralen Skärvet | Region Kronoberg |
| Median barrier cut; rescue wound down 19:30; SAR helicopter (Sjöfartsverket) | Smålandsposten |
| **Modelled:** which units responded, base locations, dispatch/departure times, routes | OSRM; blue-light driving = 0.8 × car time |
| **Modelled:** line 845 departure time; helicopter times (240 km/h from Ronneby); Lund/Linköping transfer times | — |
| **Illustrative:** background flights at Småland Airport; transit timetables are synthetic | — |

Ambulance bases, fire and police stations, the Ronneby SAR base and Skärvet
are approximate positions. They show a dashed ring on the map.

## Author

**Claudio D. G. Linhares**, Associate Professor, Department of Computer Science
and Media Technology, Linnaeus University, Växjö (ISOVIS group).
<claudio.linhares@lnu.se> · [website](https://sites.google.com/view/claudiodglinhares) ·
[ORCID 0000-0001-7012-4461](https://orcid.org/0000-0001-7012-4461)

This is an independent research and visualization project, not an official
product of Region Kronoberg, the Police or the rescue services.
