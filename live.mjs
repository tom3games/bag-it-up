// 公開URLの確認。node live.mjs（ログインしていないブラウザで見る）。SKIPGH=1 で GitHub ページの確認を省く
// bag-it-up __NS__ を置き換え、「遊びの通し」をゲームに合わせて書く
import { chromium, webkit } from 'playwright'
import { launch } from './_mute.mjs'
const URL0 = 'https://tom3games.github.io/bag-it-up/'
const out = []
for (const [name, bt, opts] of [['chromium', chromium, {}], ['webkit', webkit, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const b = await launch(bt), ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts }), p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  p.on('requestfailed', r => errs.push('fail ' + r.url()))
  await p.goto(URL0 + '?t=' + Date.now(), { waitUntil: 'networkidle' })
  await p.waitForFunction(() => window.__biReady && window.BI && window.BI.charsReady, null, { timeout: 15000 })
  await p.evaluate(() => { BI.dbg.tut(2); BI.dbg.start(5) })
  await p.waitForFunction(() => BI.S.counter.length > 0, null, { timeout: 10000 })
  const pl = await p.evaluate(async () => {
    const c = document.getElementById('gl'), a = BI.dbg.counterScreen(0), b = BI.dbg.worldScreen(0, 2.5, 0)
    const ev = (type, x, y, tgt) => (tgt || window).dispatchEvent(new PointerEvent(type, { pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    ev('pointerdown', a.x, a.y, c)
    for (let i = 1; i <= 10; i++) { ev('pointermove', a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10); await new Promise(r => setTimeout(r, 30)) }
    await new Promise(r => setTimeout(r, 250)); ev('pointerup', b.x, b.y); await new Promise(r => setTimeout(r, 900))
    const inBag = BI.state().items.filter(i => i.inBag).length
    BI.dbg.over(); await new Promise(r => setTimeout(r, 4200))
    return { inBag, mode: BI.S.mode, score: document.getElementById('rScore').textContent }
  })
  out.push(`${name}: play=${JSON.stringify(pl)}`)
  await p.screenshot({ path: `shots/live-${name}.png` })
  const og = await p.evaluate(async () => { const r = await fetch(document.querySelector('meta[property="og:image"]').content); return r.status + ' ' + r.headers.get('content-type') })
  out.push(`${name}: og=${og} errors=${errs.length ? errs.join(' | ') : 'none'}`)
  await b.close()
}
if (process.env.SKIPGH) { console.log(out.join('\n')); process.exit(0) }
// ログアウト状態でリポジトリ・更新履歴に個人のIDが出ていないか
const b = await launch(chromium), p = await b.newPage()
for (const u of ['https://github.com/tom3games/bag-it-up', 'https://github.com/tom3games/bag-it-up/commits/main']) {
  const res = await p.goto(u, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500)
  out.push(`${u} status=${res.status()} owner-id=${new RegExp(['tmk', '4men'].join(''), 'i').test(await p.content()) ? 'FOUND' : 'none'}`)
}
await b.close()
console.log(out.join('\n'))
