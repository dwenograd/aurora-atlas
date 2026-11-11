# Aurora Atlas

A live map for finding where and when to watch the northern lights and the stars from home:
aurora forecast, cloud cover, light pollution and real places to stand, in one view.

**Open it:** https://dwenograd.github.io/aurora-atlas/

Works in any modern browser (Chrome, Edge, Safari, Firefox) on Mac, Windows, iPhone and Android.
On a phone you can add it to the home screen: in Safari tap Share, then Add to Home Screen; in
Chrome open the menu, then Install app.

## What it shows

- **Best sky** (the gold and green map), two colors with two meanings. **Gold is stargazing**: clear
  sky at the chosen hour × how dark the sky is there × darkness and moonlight. **Green is aurora
  viewing**: the same clear, dark sky, wherever the forecast Kp reaches far enough south. Auto shows
  both at once, and a small key on the map always says which is which. Scrub or play the timeline to
  watch it change.
- **Aurora**: NOAA's 30-minute OVATION forecast drawn as moving curtains (aurora overhead), plus a
  green dotted line showing how far south the aurora is likely to be seen at the timeline's Kp.
- **Clouds** and **Light pollution** as their own layers (off by default; Best sky already blends them).
- **When nothing is gold**, the map key says which of the four ingredients is failing in the view on
  screen (night, moon, clouds, dark ground), and the open key lists all four with a tick or a cross.
- **How dark is dark enough** (Settings): forgiving, balanced or strict about town glow. It bends the gold
  map, the scores and the spot finder together.
- **Roads** are drawn dimly over the map, a dotted box marks where the cloud and darkness data stop, and
  when the aurora line is off the map a chip says how far north (or south) of home it is; tap it to see.
- **Forecast**: tonight's verdict first, for home or any spot, then the coming nights, then the detail:
  dark hours, moon, clouds, Kp you need, sky darkness (Bortle), temperature and dew, hour by hour.
- **Spots**: finds the darkest, clearest ground within your radius, then the nearest real
  viewpoint, campground, beach or boat launch there, checks the drive from home (roads, not a straight
  line) and the terrain toward the aurora, and ranks them for tonight. Each spot says whether it is a
  drive-up, a short walk or a hike from the nearest road; hikes rank lower and their directions lead to
  where the road ends. Save the ones you like.
- **Where am I** (target button on the map): a dot for where you are and the sky at that spot.
- **Space**: Kp now and forecast, solar wind (speed, density, Bz), NOAA alerts, 27-day outlook.
- **Night vision** (eye button): turns the whole page dim red at the spot and keeps the screen awake.
  Gold and green would look the same in red, so aurora ground is striped. On a phone, and always in night
  vision, the map's shimmer stops after 25 seconds without a touch to save battery.
- **Aurora alerts** (bell button): a chime and notification while the app is open. A background tab on a
  computer keeps watching; a phone has to have it on screen.
- **Old data**: when the newest NOAA reading is over 45 minutes old, or the device is offline, the top
  strip turns amber and the timeline says what time the data is from.

## On a phone

The map takes the top of the screen and the planner is a sheet at the bottom. Drag or flick the sheet's
handle between three stops: just the tab bar, half, and full. Tap the map for a place card (with the
sheet down at its bar, the bar shows the place's name; tap it for the card). Tap the color key (or ⓘ)
for the full map key, the moon button to step through the base maps, and the live strip at the top for
space weather. A phone on its side gets a side-panel layout.

## Sharing between devices

Everything you save (home, spots) stays in that browser. To move it to another
device or to each other, use **Share** in the Spots tab or Settings and send the link. Opening the
link offers to import it. The data rides inside the link after the `#`, which browsers never send
to a server.

## Data sources

- Aurora, Kp, solar wind, alerts, outlook: NOAA Space Weather Prediction Center
- Clouds, weather, elevation, place search: Open-Meteo
- Light pollution: David J. Lorenz, Light Pollution Atlas 2025
- Places to stand: OpenStreetMap contributors, via Photon by Komoot
- Drive times: OSRM (project-osrm.org demo server), on OpenStreetMap roads, no traffic
- Dropped-pin place names: BigDataCloud
- Base maps: Esri. Sun and Moon positions: SunCalc. Map: Leaflet.

### How "Kp you need" works

NOAA's K-index warnings and space weather scales give how far from the pole aurora reaches at each
Kp: about 65° magnetic latitude at Kp 4, 60° at Kp 5, 55° at Kp 6, 50° at Kp 7, 45° at Kp 8 and 40°
at Kp 9. Magnetic latitude comes from the IGRF dipole pole (80.8°N, 72.7°W). Seattle sits near 53°,
so it needs about Kp 6.4.

## Updating

It's a static site: plain HTML, CSS and JavaScript, no build step. Edit the files, bump the `?v=`
number on the script and stylesheet links in `index.html` and the matching list in `sw.js`, then
commit and push to `main`. GitHub Pages republishes within a minute or two and both browsers pick up
the change on their next load.

Local preview: `python -m http.server 8765` in this folder, then open http://localhost:8765.

Before pushing a layout change, run the phone test: `node tools/phone_test.js 390 664` (the top of that
file lists the other screen sizes and what it needs). It drives a headless browser with real touch
gestures and checks the sheet, the place card, night vision and the map key.

`tools/make_icons.py` redraws the app icons (pure Python, no libraries).
