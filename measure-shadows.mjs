// Measures the text shadows in the two screenshots reproduce.sh takes, one at the device's own density and one at
// 160 dpi, where a dp is a pixel. Exits 1 while textShadowRadius blurs by the same number of pixels at both densities
// or textShadowRadius: 0 draws no shadow, 0 once neither holds, 2 when the screenshots show nothing to measure.
// Usage: node measure-shadows.mjs <screenshot.png> <dpi> <blurred l,t,r,b> <radius 0 l,t,r,b> <radius 1 l,t,r,b>
//   <screenshot at 160 dpi.png> 160 <blurred l,t,r,b> <radius 0 l,t,r,b> <radius 1 l,t,r,b>
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// The text's own glyphs: black over white or over the red shadow leaves the red channel low.
const glyphRedBelow = 128;
// The shadow's faintest reach: red over white tints green and blue down while red stays high.
const tintAtLeast = 6;
// A sharp red shadow pixel, not one of the glyphs' antialiased edges.
const strongRedAtLeast = 200;
const strongOtherAtMost = 80;
// Fewer red pixels than this from textShadowRadius: 1 says the shadow is not where the run looks for it.
const leastControlPixels = 50;

function fail(message) {
  console.log(`step failed: ${message}`);
  process.exit(2);
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) {
    return left;
  }
  return toUp <= toUpLeft ? up : upLeft;
}

function predictor(filter, left, up, upLeft) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4:
      return paeth(left, up, upLeft);
    default:
      throw new Error(`unknown PNG row filter ${filter}`);
  }
}

function decodePng(path) {
  const file = readFileSync(path);
  if (file.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`${path} is not a PNG`);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressed = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('latin1', offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [bitDepth, colorType] = [body[8], body[9]];
      const interlaced = body[12] !== 0;
      if (bitDepth !== 8 || interlaced || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`${path} is not an 8-bit, non-interlaced RGB or RGBA PNG`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      compressed.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const filtered = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  const emptyRow = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[row * (stride + 1)];
    const line = filtered.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const current = pixels.subarray(row * stride, (row + 1) * stride);
    const previous = row > 0 ? pixels.subarray((row - 1) * stride, row * stride) : emptyRow;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? current[index - channels] : 0;
      const upLeft = index >= channels ? previous[index - channels] : 0;
      current[index] = (line[index] + predictor(filter, left, previous[index], upLeft)) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function parseBounds(argument, what, image) {
  const match = /^(\d+),(\d+),(\d+),(\d+)$/.exec(argument ?? '');
  if (!match) {
    fail(`the bounds of the ${what} are "${argument}", not "<left>,<top>,<right>,<bottom>"`);
  }
  const [left, top, right, bottom] = match.slice(1).map(Number);
  if (left >= right || top >= bottom || right > image.width || bottom > image.height) {
    fail(`the bounds of the ${what}, ${argument}, are not inside the ${image.width}x${image.height} screenshot`);
  }
  return { left, top, right, bottom };
}

// The smallest box holding every pixel of the region the test accepts, or null when none does.
function boxOf(image, region, test) {
  let box = null;
  for (let y = region.top; y < region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      const index = (y * image.width + x) * image.channels;
      const [red, green, blue] = [image.pixels[index], image.pixels[index + 1], image.pixels[index + 2]];
      if (test(red, green, blue)) {
        if (box === null) {
          box = { left: x, top: y, right: x + 1, bottom: y + 1 };
        } else {
          box.left = Math.min(box.left, x);
          box.top = Math.min(box.top, y);
          box.right = Math.max(box.right, x + 1);
          box.bottom = Math.max(box.bottom, y + 1);
        }
      }
    }
  }
  return box;
}

function countOf(image, region, test) {
  let count = 0;
  for (let y = region.top; y < region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      const index = (y * image.width + x) * image.channels;
      if (test(image.pixels[index], image.pixels[index + 1], image.pixels[index + 2])) {
        count += 1;
      }
    }
  }
  return count;
}

const isGlyph = (red) => red < glyphRedBelow;
const isTinted = (red, green, blue) =>
  red >= glyphRedBelow && red - green >= tintAtLeast && red - blue >= tintAtLeast;
const isStrongRed = (red, green, blue) =>
  red >= strongRedAtLeast && green <= strongOtherAtMost && blue <= strongOtherAtMost;

function measurePass(path, dpiArgument, blurredArgument, zeroArgument, oneArgument) {
  if (!/^\d+$/.test(dpiArgument ?? '')) {
    fail(`the density "${dpiArgument}" is not a number of dots per inch`);
  }
  const dpi = Number(dpiArgument);
  let image;
  try {
    image = decodePng(path);
  } catch (error) {
    fail(`reading ${path}: ${error.message}`);
  }
  const blurred = parseBounds(blurredArgument, 'blurred shadow text', image);
  const zero = parseBounds(zeroArgument, 'textShadowRadius: 0 text', image);
  const one = parseBounds(oneArgument, 'textShadowRadius: 1 text', image);

  const glyphs = boxOf(image, blurred, isGlyph);
  const shadow = boxOf(image, blurred, isTinted);
  if (glyphs === null) {
    fail(`at ${dpi} dpi the blurred shadow text's bounds hold no black glyph`);
  }
  if (shadow === null) {
    fail(`at ${dpi} dpi the blurred shadow text's bounds hold no red shadow`);
  }
  if (
    shadow.left <= blurred.left ||
    shadow.top <= blurred.top ||
    shadow.right >= blurred.right ||
    shadow.bottom >= blurred.bottom
  ) {
    fail(`at ${dpi} dpi the red shadow reaches the edge of the blurred shadow text's bounds, so its reach is cut`);
  }
  const reach =
    (glyphs.left - shadow.left + (shadow.right - glyphs.right) + (glyphs.top - shadow.top) +
      (shadow.bottom - glyphs.bottom)) /
    4;
  const scale = dpi / 160;
  const glyphWidth = glyphs.right - glyphs.left;
  console.log(
    `at ${dpi} dpi (${scale.toFixed(2)} px per dp): the text "Shadow" spans ${glyphWidth}x${glyphs.bottom - glyphs.top} px,` +
      ` and the red shadow of textShadowRadius: 8 reaches ${reach.toFixed(1)} px (${(reach / scale).toFixed(1)} dp) past it`,
  );

  const zeroRed = countOf(image, zero, isStrongRed);
  const oneRed = countOf(image, one, isStrongRed);
  console.log(
    `at ${dpi} dpi: with textShadowOffset {width: 4, height: 4}, textShadowRadius: 0 draws ${zeroRed} red pixels` +
      ` and textShadowRadius: 1 draws ${oneRed}`,
  );
  if (oneRed < leastControlPixels) {
    fail(`at ${dpi} dpi textShadowRadius: 1 draws ${oneRed} red pixels, so the sharp shadows are not where the run looks`);
  }
  return { dpi, glyphWidth, reach, zeroRed, oneRed };
}

function main(argumentList) {
  if (argumentList.length !== 10) {
    fail(
      'usage: measure-shadows.mjs <png> <dpi> <blurred> <radius 0> <radius 1> <png at 160 dpi> 160 <blurred> <radius 0>' +
        ' <radius 1>, each bounds "<left>,<top>,<right>,<bottom>"',
    );
  }
  const own = measurePass(...argumentList.slice(0, 5));
  const base = measurePass(...argumentList.slice(5, 10));
  if (base.dpi !== 160) {
    fail(`the second screenshot is at ${base.dpi} dpi, where a dp is a pixel only at 160`);
  }
  const densityGrowth = own.dpi / base.dpi;
  if (densityGrowth < 2) {
    fail(`the device's own density, ${own.dpi} dpi, is less than twice 160 dpi, too close to tell the units apart`);
  }
  const textGrowth = own.glyphWidth / base.glyphWidth;
  if (Math.abs(textGrowth / densityGrowth - 1) > 0.15) {
    fail(
      `from 160 to ${own.dpi} dpi the text grows ${textGrowth.toFixed(2)}x where the density grows` +
        ` ${densityGrowth.toFixed(2)}x, so the two screenshots do not show the same layout`,
    );
  }
  if (base.reach <= 0) {
    fail('at 160 dpi the red shadow reaches no pixel past the text');
  }
  const blurGrowth = own.reach / base.reach;
  // Halfway, as a ratio, between a radius in pixels (1x) and one in dp (the density's growth).
  const radiusInPixels = blurGrowth < Math.sqrt(densityGrowth);
  const zeroDrawsNothing = [own, base].some((pass) => pass.zeroRed * 10 < pass.oneRed);

  const findings = [];
  if (radiusInPixels) {
    findings.push(
      `from 160 to ${own.dpi} dpi the text grows ${textGrowth.toFixed(2)}x and its textShadowRadius: 8 blur` +
        ` ${blurGrowth.toFixed(2)}x, so the radius is taken in pixels`,
    );
  }
  if (zeroDrawsNothing) {
    findings.push('textShadowRadius: 0 with an offset draws no shadow, where textShadowRadius: 1 draws one');
  }
  if (findings.length > 0) {
    console.log(`SUMMARY: ${findings.join('; and ')}`);
    process.exit(1);
  }
  console.log(
    `SUMMARY: from 160 to ${own.dpi} dpi the text grows ${textGrowth.toFixed(2)}x and its textShadowRadius: 8 blur` +
      ` ${blurGrowth.toFixed(2)}x, and textShadowRadius: 0 with an offset draws a shadow`,
  );
  process.exit(0);
}

main(process.argv.slice(2));
