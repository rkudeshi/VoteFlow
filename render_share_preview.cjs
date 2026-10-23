// Render .share-preview/frame.html (from build_share_preview.py) into the link-preview
// video and still: dist/share/preview.mp4 (og:video) and dist/share/preview.png (og:image).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  ({ chromium } = require(path.join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')));
}
const FPS = 30, DUR = 10, STILL = 4.2;
const work = path.join(__dirname, '.share-preview'), frames = path.join(work, 'frames');
const out = path.join(__dirname, 'dist', 'share');
(async () => {
  fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true }); fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto('file://' + path.join(work, 'frame.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  for (let i = 0; i < FPS * DUR; i++) {
    await page.evaluate((t) => window.setT(t), i / FPS);
    await page.screenshot({ path: path.join(frames, String(i).padStart(4, '0') + '.png') });
  }
  await page.evaluate((t) => window.setT(t), STILL);
  await page.screenshot({ path: path.join(out, 'preview.png') });
  await browser.close();
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frames, '%04d.png'),
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow',
    '-movflags', '+faststart', '-an', path.join(out, 'preview.mp4')]);
  for (const f of ['preview.mp4', 'preview.png']) console.log(f, Math.round(fs.statSync(path.join(out, f)).size / 1024), 'KB');
})();
