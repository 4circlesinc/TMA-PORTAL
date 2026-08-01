'use strict';

/**
 * Packs PNGs into a Windows .ico.
 *
 * There is no ImageMagick on the build machine and no icon tooling in macOS
 * that emits .ico, but the container format is trivial: a 6-byte header, one
 * 16-byte directory entry per image, then the images. Vista and later read
 * PNG-compressed entries directly, so `sips` output goes in untouched — no
 * BMP/DIB encoding, no AND mask.
 *
 *   node make-ico.js out.ico 16.png 32.png …
 *
 * Called by build-icon.sh, which does the resizing.
 */

const fs = require('node:fs');

const HEADER = 6;
const ENTRY = 16;

function build(pngs) {
  const images = pngs.map((file) => {
    const data = fs.readFileSync(file);

    // IHDR puts width and height at a fixed offset, so the real dimensions
    // come from the file rather than from trusting the filename.
    if (data.readUInt32BE(0) !== 0x89504e47) {
      throw new Error(`${file} is not a PNG`);
    }

    return { data, width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  });

  const dir = Buffer.alloc(HEADER + ENTRY * images.length);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // 1 = icon, 2 = cursor
  dir.writeUInt16LE(images.length, 4);

  let offset = dir.length;

  images.forEach((image, i) => {
    const at = HEADER + ENTRY * i;

    // 256 is stored as 0: the field is a single byte, so 256 does not fit.
    dir.writeUInt8(image.width >= 256 ? 0 : image.width, at);
    dir.writeUInt8(image.height >= 256 ? 0 : image.height, at + 1);
    dir.writeUInt8(0, at + 2); // palette size, 0 for truecolour
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(image.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);

    offset += image.data.length;
  });

  return Buffer.concat([dir, ...images.map((image) => image.data)]);
}

const [out, ...sources] = process.argv.slice(2);

if (!out || sources.length === 0) {
  console.error('usage: node make-ico.js <out.ico> <png…>');
  process.exit(1);
}

fs.writeFileSync(out, build(sources));
console.log(`Built ${out} from ${sources.length} sizes`);
