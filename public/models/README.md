# Models

## bespoke-representative.glb

The face of Bespoke AI's live voice: a rigged human avatar rendered head and
shoulders in the live stage by `public/js/vendor/bespoke-representative.mjs`
(source in `resources/js/bespoke-representative/`).

**Origin and licence.** `mpfb.glb` from the
[TalkingHead](https://github.com/met4citizen/TalkingHead) repository, made in
Blender with the [MPFB](https://static.makehumancommunity.org/mpfb.html)
MakeHuman extension by Mika Suominen and released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — public domain,
free for commercial use, no attribution required. (The repository's other
example avatar, `brunette.glb`, is CC BY-NC and must not be used here.)

**What was done to it.** The original is 37 MB. Textures were resized to
1024 px WebP; every blendshape the face does not drive was removed and the
rest keep position deltas only (`viseme_*`, blinks, `browInnerUp`,
`mouthSmile*`, `mouthPress*`, `jawOpen`, the eye-look shapes — eyebrows keep
only `browInnerUp`, eyelashes only blink and up/down); positions, normals and
texture coordinates were quantized (`KHR_mesh_quantization`, which three.js
reads natively). The pipeline was `@gltf-transform/cli` `optimize` followed by
a small script over `@gltf-transform/core` — see the memory note for the
recipe.

**Swapping it.** Any glTF binary with Mixamo bone names (`Head`, `Neck`,
`LeftEye`, `RightEye`, `LeftArm`, `RightArm`) and the Oculus viseme plus ARKit
blendshape names works; Ready Player Me exports with
`morphTargets=ARKit,Oculus Visemes` follow exactly this convention. Drop the
file in here under the same name and bump `REP_MODEL` in
`public/js/bespoke-ai.js`. The module arms the avatar down from its A-pose and
frames between the eyes; `armDrop` and `distance` in the mount options tune
that for a differently proportioned model.
