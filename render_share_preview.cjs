// Render the link previews frame by frame into videos (og:video) and stills (og:image):
//   share_preview.html -> dist/share/preview.mp4/.png (homepage and other pages)
//   place_preview.html + .share-preview/places.json (from build_share_previews.py)
//     -> dist/share/<state>/<id>.mp4/.png, one per locality or county
// Usage: node render_share_preview.cjs [home] [places] [--only id,id]
const fs = require('fs');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  ({ chromium } = require(path.join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')));
}
const FPS = 24, WORKERS = 4;
const work = path.join(__dirname, '.share-preview'), out = path.join(__dirname, 'dist', 'share');
const args = process.argv.slice(2), only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const want = (k) => !args.some((a) => a === 'home' || a === 'places') || args.includes(k);

function encode(frames, mp4) {
  return new Promise((ok, fail) => execFile('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frames, '%04d.jpg'),
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '28', '-vf', 'scale=960:504', '-preset', 'slow',
    '-movflags', '+faststart', '-an', mp4], (e) => (e ? fail(e) : ok())));
}
async function shoot(page, dur, still, frames, png) {
  fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
  for (let i = 0; i < FPS * dur; i++) {
    await page.evaluate((t) => window.setT(t), i / FPS);
    await page.screenshot({ path: path.join(frames, String(i).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 92 });
  }
  await page.evaluate((t) => window.setT(t), still);
  await page.screenshot({ path: png });
}
async function open(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto('file://' + path.join(__dirname, file));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  return page;
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  if (want('home')) {
    const page = await open(browser, 'share_preview.html'), frames = path.join(work, 'frames-home');
    await shoot(page, 6, 2.3, frames, path.join(out, 'preview.png'));
    await encode(frames, path.join(out, 'preview.mp4'));
    console.log('home done');
  }
  if (want('places')) {
    const data = JSON.parse(fs.readFileSync(path.join(work, 'places.json'), 'utf8'));
    const queue = data.places.filter((p) => !only || only.includes(p.id) || only.includes(p.state + '/' + p.id));
    let done = 0;
    await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
      const page = await open(browser, 'place_preview.html');
      const frames = path.join(work, 'frames-' + w);
      for (let p; (p = queue.shift());) {
        const dir = path.join(out, p.state); fs.mkdirSync(dir, { recursive: true });
        await page.evaluate(([s, pl]) => window.setPlace(s, pl), [data.states[p.state], p]);
        await shoot(page, 5, 3.4, frames, path.join(dir, p.id + '.png'));
        await encode(frames, path.join(dir, p.id + '.mp4'));
        console.log(++done, p.state + '/' + p.id);
      }
    }));
  }
  await browser.close();
})();
