// usage: node shots.js <outdir> <scenario...>   scenarios: empty, flight, answer, projector, lightbox, verify, today, offline
const { chromium } = require('playwright-core');
const out = process.argv[2], want = process.argv.slice(3);
const Q = 'Compare the Palm Jumeirah reclamation between 2000 and 2001 and show the images and also say what happened and what are the downsides and etc.';
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const [w, h] of [[1280, 720], [1920, 1080]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage(); const logs = [];
    p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
    p.on('pageerror', e => logs.push('pageerror: ' + e.message));
    const shot = async n => { await p.screenshot({ path: `${out}/${n}_${w}.png` }); };
    await p.goto('http://localhost:8000/?shots'); await p.waitForTimeout(4000);
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (want.includes('empty')) await shot('empty');
    if (want.some(x => ['flight', 'answer', 'projector', 'lightbox', 'verify', 'today'].includes(x))) {
      await p.evaluate(q => App.ask(q), Q); await p.waitForTimeout(3000);
      if (want.includes('flight')) await shot('flight');
      await p.waitForTimeout(6000);
      if (want.includes('answer')) { await shot('answer'); await p.evaluate(() => document.querySelector('.msg.bot').scrollIntoView()); await p.waitForTimeout(400); await shot('answertop'); }
      if (want.includes('today')) { await p.click('[data-compare=bt]'); await p.waitForTimeout(1500); await shot('today'); await p.click('[data-compare=ba]'); }
      if (want.includes('verify')) { await p.click('#btnVerify'); await p.waitForTimeout(500); await shot('verify'); await p.keyboard.press('Escape'); }
      if (want.includes('lightbox')) { await p.click('[data-thumb=after]'); await p.waitForTimeout(2500); await p.click('[data-thumb=after]'); await p.waitForTimeout(800); await shot('lightbox'); await p.keyboard.press('Escape'); }
      if (want.includes('projector')) { await p.keyboard.press('p'); await p.waitForTimeout(800); await shot('projector'); await p.keyboard.press('p'); }
    }
    const fps = await p.evaluate(() => Globe.stats.fps);
    console.log(`${w}x${h} hscroll=${hs} fps=${fps} console:`, logs.length ? logs : 'clean');
    await ctx.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
