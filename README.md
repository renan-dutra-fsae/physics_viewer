# physics_viewer

A [three.js](https://threejs.org/) GUI that plays back trajectories from
[`simulation_server`](https://github.com/renan-dutra-fsae/simulation_server).

It builds one mesh per body and one line per constraint from the manifest, then
interpolates positions across recorded frames for smooth real-time playback.
Configured for **z-up** to match [`reference-engine`](https://github.com/renan-dutra-fsae/reference-engine).

## Run

It's a static page with no build step (three.js loads from a CDN via importmap).
Serve it over http (ES modules don't load from `file://`):

```bash
python -m http.server 5173
# open http://localhost:5173
```

Make sure `simulation_server` is running on `http://localhost:8000`. To point
elsewhere, edit `SERVER` at the top of `src/main.js`.

## Controls

- **Run simulation** — re-requests the selected scene with the chosen dt / frames.
- **Scrub bar** — scrub through the trajectory (pauses playback).
- **Play / Pause / Reset** — playback transport.
- **Mouse** — orbit, zoom, pan (OrbitControls).

## Contract

Consumes the JSON from `simulation_server` (`bodies` + `links` manifest, then a
`frames` array of positions per body). See that repo's README for the schema.