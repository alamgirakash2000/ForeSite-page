# ForeSite project page

This folder is the project website. GitHub Pages serves it as it is. There is no build step.

## Publish

1. Push the repository to GitHub.
2. Open Settings, then Pages. Under "Build and deployment" choose "Deploy from a branch", branch `main`, folder `/docs`.
3. The page appears at `https://<user>.github.io/ForeSite/` after about a minute.

The root `.gitignore` ignores `*.webm` and `*.mp4`. The line `!docs/**/*.webm` keeps the clips of this page in git.

## Turn on the Paper and Code buttons

In `index.html`, search for `btn-soon`. Each button is a `<span>`. Change it to a link, and delete the
`<small>coming soon</small>` part and the `role` and `aria-disabled` attributes:

```html
<a class="btn" href="https://github.com/alamgirakash2000/ForeSite">... Code</a>
```

Then add the journal and DOI to the BibTeX entry in the Cite section.

## What is here

```
index.html           the page
css/site.css         all styles
js/site.js           page behaviour (clips, bars, hazard table, loads the 3D view on demand)
js/explorer.js       the 3D view (three.js)
js/hazards.js        names and notes of the 15 hazards
data/site.json       the site and one logged run: list of meshes, bodies, hazards
data/site.bin        geometry and 150 s of body poses (3.6 MB)
media/video/*.webm   clips (VP9), media/poster/*.jpg first frames, media/captions/*.vtt
img/, fonts/, vendor/   framework figure, self-hosted fonts, three.js r170
tools/               the two scripts that make data/site.json and data/site.bin
```

## The 3D view shows a real run

The 3D view replays one logged run: ForeSite on the full route, seed 3, `--randomize`. The box is delivered in
149.6 s, all 15 hazards are cleared and the robot does not fall. Nothing in it is animated by hand.

To rebuild the data, run from the repository root (needs `trimesh`, `fast-simplification` and `scipy` on top of
the normal environment):

```
python docs/tools/run_export.py 3 run3.npz
python docs/tools/export_scene.py 3 run3.npz docs/data
```

`run_export.py` runs the simulation and saves body poses, body spheres, moving-hazard capsules and the command at
25 Hz. `export_scene.py` turns every geom of the MuJoCo model into triangles, reduces them, and writes the two files.
Use `PYTHONPATH=.` if Python does not find the `foresite` package.

## Seeds of the clips

| Clip | Run |
| --- | --- |
| hero_drone_in, site_drone_out, site_carrying_box | full route, seed 13 |
| site_corridor, posture_squat, posture_twist, posture_bend | fixed hazards, seed 10 |
| terrain_ramp / stairs / wet_slab / debris | walking only, seeds 2 / 4 / 0 / 3 |
| timing_crane / worker / excavator | moving hazards, seeds 3 / 8 / 1 |
| compare_crane_seed7 | crane with contact, seed 7, no avoidance (left) and ForeSite (right) |
| foresite_overview | the overview video, with sound |

## Credits that must stay on the page

- Music in the overview video: "Undaunted" by Kevin MacLeod (incompetech.com), CC BY 4.0.
- Textures, sky and props: Poly Haven (CC0). Fonts: Big Shoulders Display and Barlow (SIL Open Font License).
- three.js (MIT), see `vendor/THREE_LICENSE.txt`.
