/* Multiplayer e2e: two headless browsers create/join a room and play a turn.
 * Requires Google Chrome installed. Run: pnpm test:e2e (server must NOT be running)
 */
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8742;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const server = createServer(async (req, res) => {
  const file = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end();
  }
}).listen(PORT);

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];
const executablePath = CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, label) {
  console.log(`${cond ? '✔' : '✘'} ${label}`);
  if (!cond) failures++;
}

// Two separate browser instances: a backgrounded second tab in headless
// Chrome gets throttled and CDP calls hang.
const launchOpts = {
  executablePath,
  headless: true,
  protocolTimeout: 30000,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
};
const hostBrowser = await puppeteer.launch(launchOpts);
const guestBrowser = await puppeteer.launch(launchOpts);

try {
  const host = await hostBrowser.newPage();
  const guest = await guestBrowser.newPage();
  host.setDefaultTimeout(20000);
  guest.setDefaultTimeout(20000);
  host.on('pageerror', (e) => console.log('HOST pageerror:', e.message));
  guest.on('pageerror', (e) => console.log('GUEST pageerror:', e.message));

  const URL = `http://localhost:${PORT}/`;
  await host.goto(URL, { waitUntil: 'domcontentloaded' });
  await guest.goto(URL, { waitUntil: 'domcontentloaded' });

  // Host creates a room
  await host.type('#my-name', 'Ana');
  await host.click('#btn-create');
  await host.waitForFunction(
    () => /^[A-Z0-9]{4}$/.test(document.querySelector('#room-code').textContent),
    { timeout: 15000 }
  );
  const code = await host.$eval('#room-code', (el) => el.textContent);
  check(true, `host created room ${code}`);

  // Guest joins
  await guest.type('#my-name', 'Beto');
  await guest.type('#join-code', code);
  await guest.click('#btn-join');
  await guest.waitForFunction(
    () => document.querySelectorAll('#wait-list li:not(.empty)').length === 2,
    { timeout: 15000 }
  );
  check(true, 'guest joined, both in waiting room');

  // Host starts the game
  await host.waitForFunction(() => !document.querySelector('#btn-begin').disabled);
  await host.click('#btn-begin');
  await host.waitForSelector('#screen-game.active', { timeout: 10000 });
  await guest.waitForSelector('#screen-game.active', { timeout: 10000 });
  check(true, 'game started on both devices');
  await sleep(1400); // let the deal animation finish so clicks land on the cards

  // Peek phase: each player flips 2 of their own (bottom-seat) cards and confirms
  for (const [page, who] of [[host, 'host'], [guest, 'guest']]) {
    await page.waitForFunction(
      () => document.querySelectorAll('.seat[data-pos="bottom"] .card.selectable').length >= 2
    );
    const cards = await page.$$('.seat[data-pos="bottom"] .card.selectable');
    await cards[0].click();
    await sleep(300);
    await (await page.$$('.seat[data-pos="bottom"] .card.selectable'))[0].click();
    await page.waitForFunction(
      () => document.querySelectorAll('.seat[data-pos="bottom"] .card.flipped').length === 2
    );
    check(true, `${who} peeked exactly 2 own cards`);
    // Other players' cards must never show a face
    const leaked = await page.evaluate(() =>
      document.querySelectorAll('.seat:not([data-pos="bottom"]) .card .face').length);
    check(leaked === 0, `${who} cannot see opponent card faces`);
    const confirmBtn = await page.waitForFunction(() =>
      [...document.querySelectorAll('#action-bar .btn')].find((b) => b.textContent.includes('CONFIRMAR')));
    await confirmBtn.asElement().click();
  }

  // Turn phase: exactly one device shows "TU TURNO"
  await host.waitForFunction(
    () => !document.querySelector('#turn-banner').classList.contains('hidden'),
    { timeout: 10000 }
  );
  const hostBanner = await host.$eval('#turn-banner', (el) => el.textContent);
  const guestBanner = await guest.$eval('#turn-banner', (el) => el.textContent);
  const mineCount = [hostBanner, guestBanner].filter((t) => t.includes('TU TURNO')).length;
  check(mineCount === 1, `exactly one player sees TU TURNO (host="${hostBanner}" guest="${guestBanner}")`);

  // Active player draws and discards; the other should see the discard but not the drawn face
  const active = hostBanner.includes('TU TURNO') ? host : guest;
  const passive = active === host ? guest : host;
  await active.evaluate(() => {
    [...document.querySelectorAll('#action-bar .btn')].find((b) => b.textContent.includes('ROBAR')).click();
  });
  await active.waitForFunction(() => !document.querySelector('#drawn-modal').classList.contains('hidden'));
  check(true, 'active player sees drawn-card modal');
  const passiveSeesFace = await passive.evaluate(() =>
    !!document.querySelector('#drawn-float .face'));
  check(!passiveSeesFace, 'passive player cannot see the drawn card face');

  await active.evaluate(() => {
    [...document.querySelectorAll('#drawn-actions .btn')].find((b) => b.textContent.includes('DESCARTAR')).click();
  });
  await passive.waitForFunction(
    () => document.querySelectorAll('#discard-pile .card').length === 1,
    { timeout: 10000 }
  );
  check(true, 'discard visible on both devices');

  // Turn must have passed to the other player
  await passive.waitForFunction(
    () => document.querySelector('#turn-banner').textContent.includes('TU TURNO'),
    { timeout: 10000 }
  );
  check(true, 'turn passed to the other player');

  console.log(failures === 0 ? '\nALL E2E TESTS PASSED' : `\n${failures} E2E FAILURES`);
} finally {
  await hostBrowser.close();
  await guestBrowser.close();
  server.close();
}
process.exit(failures === 0 ? 0 : 1);
