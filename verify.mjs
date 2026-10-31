// verify.mjs の共通部品。コピーして __bi を置き換え、ゲーム固有のテストを足す。node verify.mjs
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
const ROOT = import.meta.dirname
mkdirSync(ROOT + '/shots', { recursive: true })
const PORT = 5421
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const URL0 = `http://localhost:${PORT}/`
let pass = 0, fail = 0
const results = []
// テストは必ず await する（しないと例外が素通りして全部 pass になる）
async function t(name, fn) {
  try { const r = await fn(); if (r === false) throw new Error('false'); pass++; console.log('ok', name); results.push(`ok   ${name}${r && r !== true ? '  ' + JSON.stringify(r) : ''}`) }
  catch (e) { fail++; console.log('FAIL', name, e.message.split('\n')[0]); results.push(`FAIL ${name}  ${e.message.split('\n')[0]}`) }
}
const expect = (c, msg) => { if (!c) throw new Error(msg) }
// 日本語ロケール固定・エラー収集つきでページを開く
async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts })
  await ctx.addInitScript(() => { try { localStorage.clear() } catch (e) {} })
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message))
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console ' + m.text()) })
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) p.errs.push('reqfail ' + r.url()) })
  await p.goto(URL0); await p.waitForFunction(() => window.__biReady && window.BI && window.BI.charsReady, null, { timeout: 10000 })
  return p
}
// 横のはみ出し
const overflow = p => p.evaluate(() => {
  const W = document.documentElement.clientWidth, bad = []
  for (const el of document.querySelectorAll('main:not([hidden]) *')) {
    if (el.closest('[hidden]') || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) continue
    const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.left) + '-' + Math.round(r.right))
  }
  return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) }
})
// 一画面に収まる（縦スクロール不要・ボタンが画面内）
const fit = q => q.evaluate(() => {
  const H = innerHeight, de = document.documentElement, over = []
  if (de.scrollHeight > H + 1) over.push('page:' + de.scrollHeight)
  for (const el of document.querySelectorAll('main:not([hidden]) button,main:not([hidden]) canvas')) { if (!el.offsetParent) continue; const r = el.getBoundingClientRect(); if (r.bottom > H + 1 || r.top < -1) over.push((el.id || el.className) + ':' + Math.round(r.top) + '-' + Math.round(r.bottom)) }
  return { H, over: over.slice(0, 6) }
})
// 描画の輝度の散らばり（ほぼ単色＝何も描けていない）
const variance = (p, sel) => p.evaluate(sel => {
  const c = document.querySelector(sel), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 13) { const v = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += v; s2 += v * v; n++ }
  return Math.round(s2 / n - (s / n) ** 2)
}, sel)
const SIZES = [[360, 640, 'small'], [390, 844, 'phone'], [844, 390, 'land'], [667, 375, 'land-se'], [768, 1024, 'tab'], [1440, 900, 'pc']]

const browser = await chromium.launch()
const p = await open(browser)
await t('起動時にエラーが出ない', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await t('ブラウザの拡大が起きない（viewport・ピンチ・Ctrl+ホイール・Ctrl+プラス）', async () => {
  const r = await p.evaluate(() => {
    const vp = document.querySelector('meta[name=viewport]').content
    const g = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(g)
    const w = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }); window.dispatchEvent(w)
    const k = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(k)
    return { vp, gesture: g.defaultPrevented, wheel: w.defaultPrevented, key: k.defaultPrevented, ta: getComputedStyle(document.documentElement).touchAction, us: getComputedStyle(document.body).userSelect }
  })
  expect(/user-scalable=no/.test(r.vp) && r.gesture && r.wheel && r.key && r.ta === 'manipulation' && r.us === 'none', JSON.stringify(r)); return r
})
await t('OGP 一式がある', async () => {
  const r = await p.evaluate(() => ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].map(k => !!document.querySelector(`meta[property="${k}"]`)).concat(!!document.querySelector('meta[name="twitter:card"]')))
  expect(r.every(Boolean), JSON.stringify(r))
})


// ドラッグで1個詰める（マウス）
async function bagOne(q, dx = 0) {
  const from = await q.evaluate(() => BI.dbg.counterScreen(0)); if (!from) return null
  const to = await q.evaluate(dx => BI.dbg.worldScreen(dx, 2.5, 0), dx)
  await q.mouse.move(from.x, from.y); await q.mouse.down()
  for (let i = 1; i <= 10; i++) { await q.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10); await q.waitForTimeout(20) }
  await q.waitForTimeout(200); await q.mouse.up(); await q.waitForTimeout(700)
  return true
}
await t('タイトル: 3Dの絵が出ている（輝度の散らばり）', async () => {
  const v = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d'); BI.dbg.step(1); x.drawImage(document.getElementById('gl'), 0, 0, 64, 64); const d = x.getImageData(0, 0, 64, 64).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const l = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += l; s2 += l * l; n++ } return Math.round(s2 / n - (s / n) ** 2) })
  expect(v > 200, v); return v
})
await t('タイトルに客（CC0キャラ）が並んでいる', async () => { const n = await p.evaluate(() => BI.state().cust.filter(c => c.has).length); expect(n >= 2, n); return n })
await t('説明は3行・遊び方画面が開いて戻れる', async () => {
  await p.click('#bHow'); const n = await p.evaluate(() => document.querySelectorAll('#vHow .step').length); const vis = await p.isVisible('#vHow')
  await p.click('#bHowBack'); expect(n === 3 && vis && await p.isVisible('#vTitle'), n)
})
await t('遊びの通し: ドラッグで詰めて2人さばける', async () => {
  await p.evaluate(() => { BI.dbg.tut(2); BI.dbg.start(5) })
  for (let i = 0; i < 12; i++) {
    await p.waitForFunction(() => BI.S.counter.length > 0 || BI.S.served >= 2, null, { timeout: 8000 })
    if (await p.evaluate(() => BI.S.served >= 2)) break
    await bagOne(p, (i % 3 - 1) * 0.5)
  }
  await p.waitForFunction(() => BI.S.served >= 2, null, { timeout: 8000 })
  const s = await p.evaluate(() => BI.state()); expect(s.served >= 2 && s.bags >= 2 && s.eggsSafe > 0, JSON.stringify(s)); return { served: s.served, bags: s.bags, eggs: s.eggsSafe, P: s.P }
})
await t('チュートリアル: 初回だけ指の案内が出て、1個入れたら消える', async () => {
  const r = await p.evaluate(() => { localStorage.removeItem('bi.tut'); BI.dbg.tut(0); BI.dbg.start(2); return true })
  await p.waitForFunction(() => BI.S.counter.length > 0); await p.waitForTimeout(200)
  const on = await p.isVisible('#finger') && await p.isVisible('#hint')
  await bagOne(p, 0); await p.waitForTimeout(300)
  const off = !(await p.isVisible('#finger')); const saved = await p.evaluate(() => localStorage.getItem('bi.tut'))
  expect(on && off && saved === '1', JSON.stringify({ on, off, saved }))
})
// 物理の判定（決まった配置で再現する）
const sim = (list) => p.evaluate(list => { BI.dbg.start(9); BI.dbg.noSpawn(); BI.dbg.pause(true); for (const [k, x, y, a] of list) { BI.dbg.give(k, x, y, a || 0); BI.dbg.step(40) } BI.dbg.step(120); const s = BI.state(); BI.dbg.pause(false); return s }, list)
await t('卵: 一番上にそっと置けば割れない', async () => { const s = await sim([['bottle', 0, 0.3, 1.57], ['milk', -0.6, 1.0], ['egg', 0.3, 1.6]]); expect(s.dmg.egg === 0, JSON.stringify(s.dmg)) })
await t('卵: 下に置いて2Lの水を乗せると割れる', async () => { const s = await sim([['egg', 0, 0.3], ['bottle', 0, 1.2, 1.57]]); expect(s.dmg.egg >= 2, JSON.stringify(s.dmg)); return s.dmg.egg })
await t('卵: ボウリングの球を落とすと全部割れる', async () => { const s = await sim([['egg', 0, 0.3], ['bowling', 0, 2.5]]); expect(s.dmg.egg === 6, JSON.stringify(s.dmg)) })
await t('卵: 高くから投げると割れる・袋の口からなら割れない', async () => { const a = await sim([['egg', 0, 5]]), b = await sim([['egg', 0, 2.2]]); expect(a.dmg.egg >= 1 && b.dmg.egg === 0, JSON.stringify([a.dmg, b.dmg])) })
await t('豆腐: 水平なら無事・傾けると水が出る', async () => { const a = await sim([['tofu', 0, 0.3]]), b = await sim([['tofu', 0, 1.0, 1.2]]); expect(a.dmg.tofu === 0 && b.dmg.tofu === 1, JSON.stringify([a.dmg, b.dmg])) })
await t('パン: 重い物でぺちゃんこ・缶なら無事', async () => { const a = await sim([['bread', 0, 0.3], ['bottle', 0, 1.2, 1.57]]), b = await sim([['bread', 0, 0.3], ['can', 0, 1.0]]); expect(a.dmg.squash === 1 && b.dmg.squash === 0, JSON.stringify([a.dmg, b.dmg])) })
await t('冷凍: 外に置くと汗をかいて溶ける・袋に入れると止まる', async () => {
  const r = await p.evaluate(() => { BI.dbg.start(9); BI.dbg.noSpawn(); BI.dbg.pause(true); BI.dbg.give('gyoza', 2.2, 0.4); BI.dbg.give('icebox', 0, 0.4); BI.dbg.step(60 * 6); const mid = BI.state().items.map(i => i.melt); BI.dbg.step(60 * 10); const s = BI.state(); BI.dbg.pause(false); return { mid, end: s.items.map(i => [i.kind, i.melt, i.melted, i.inBag]), dmg: s.dmg.melt } })
  expect(r.mid[0] > 0.3 && r.end[0][2] === true && r.end[1][1] === 0 && r.dmg === 1, JSON.stringify(r)); return r.mid
})
await t('袋の外に落とすと「落とした」・卵は全部割れる', async () => { const s = await sim([['egg', 3.5, 1.0]]); expect(s.dmg.drop === 1 && s.dmg.egg === 6, JSON.stringify(s.dmg)) })
await t('袋が満杯になると次の袋に替わる', async () => {
  const r = await p.evaluate(() => { BI.dbg.start(9); BI.dbg.pause(true); for (let i = 0; i < 600 && !(BI.S.front && BI.S.front.state === 'wait'); i++) BI.dbg.step(1); BI.dbg.setList(['rice', 'rice', 'rice', 'rice', 'rice', 'milk']); BI.dbg.clearCounter(); BI.S.front.spawned = 5; BI.S.front.spawnT = 99; for (let i = 0; i < 5; i++) { BI.dbg.give('rice', 0, 0.4 + i * 0.6); BI.dbg.step(50) } BI.dbg.step(120); const s = BI.state(); BI.dbg.pause(false); return s })
  expect(r.bags >= 1, JSON.stringify({ bags: r.bags, items: r.items.length })); return r.bags
})
await t('ゲージなし: 圧は客の態度で出る（足踏み→ため息→まだ？）', async () => {
  const r = await p.evaluate(async () => { BI.dbg.start(4); await new Promise(r => setTimeout(r, 1500)); BI.dbg.setP(0.7); await new Promise(r => setTimeout(r, 6500)); const bubbles = [...document.querySelectorAll('#fx .sb')].map(e => e.textContent); return { bubbles, anger: BI.S.cust.some(c => c.c && c.c.anger.visible), meter: document.querySelectorAll('progress,meter,.gauge,.bar').length, mada: BI.Snd.played.mada || 0 } })
  expect(r.anger && r.meter === 0 && r.bubbles.length > 0, JSON.stringify(r)); return r
})
await t('3回クレームで店長に呼ばれて結果へ（点・客数・卵が出る）', async () => {
  await p.evaluate(() => { BI.dbg.start(4); BI.S.served = 7; BI.S.bags = 8; BI.S.eggsSafe = 11; BI.S.eggsTotal = 18; BI.dbg.complaint(); BI.dbg.complaint() })
  const mg = await p.evaluate(() => BI.state().mgr)
  await p.evaluate(() => BI.dbg.complaint())
  await p.waitForFunction(() => BI.S.mode === 'result', null, { timeout: 8000 })
  await p.waitForTimeout(3000)
  const r = await p.evaluate(() => ({ score: document.getElementById('rScore').textContent, rank: document.getElementById('rRank').textContent, nums: document.getElementById('rNums').textContent, res: BI.S.result }))
  expect(mg === 2 && r.res.score === 7 * 100 + 8 * 30 + 11 * 25 && r.score === String(r.res.score) && /7/.test(r.nums) && /11\/18/.test(r.nums), JSON.stringify(r)); return r.score + ' ' + r.rank
})
await t('結果: 画像の保存（1080x1080 の PNG）', async () => {
  const dl = p.waitForEvent('download', { timeout: 8000 }).catch(e => null); await p.click('#bSave', { timeout: 5000 }); const d = await dl; expect(d, 'no download')
  const ok = await p.evaluate(() => { const c = BI.drawCard(); return [c.width, c.height] })
  expect(/bag-it-up-\d+\.png/.test(d.suggestedFilename()) && ok[0] === 1080, d.suggestedFilename())
})
await t('結果: X でポスト（intent・本文に結果とハッシュタグ・url は公開URL）', async () => {
  const x = await p.evaluate(() => BI.xPost())
  const u = new URL(x.href)
  expect(u.origin + u.pathname === 'https://x.com/intent/post' && /#袋詰め職人/.test(u.searchParams.get('text')) && /7人/.test(u.searchParams.get('text')) && u.searchParams.get('url') === 'https://tom3games.github.io/bag-it-up/', x.href)
  const [pop] = await Promise.all([p.waitForEvent('popup', { timeout: 8000 }), p.click('#bX', { timeout: 5000 })]); await pop.close()
})
await t('英語に切り替わる（結果・ボタン・共有文）', async () => {
  await p.click('#bLang'); const r = await p.evaluate(() => ({ btn: document.getElementById('bAgain').textContent, rank: document.getElementById('rRank').textContent, share: BI.xPost().text, lang: document.documentElement.lang }))
  await p.click('#bLang'); expect(r.lang === 'en' && r.btn === 'Again' && /#BagItUp/.test(r.share) && !/[ぁ-ん]/.test(r.rank), JSON.stringify(r))
})
await t('音: BGM と効果音が鳴る・ミュートで止まる', async () => {
  await p.click('#bTitle'); await p.click('#bStart'); await p.waitForTimeout(1200)
  const a = await p.evaluate(() => ({ played: BI.Snd.played, lv: BI.Snd.level(), ctx: BI.Snd.ctx && BI.Snd.ctx.state }))
  await p.click('#bMute'); await p.waitForTimeout(400); const m = await p.evaluate(() => ({ lv: BI.Snd.level(), muted: BI.Snd.muted, ls: localStorage.getItem('bi.mute') }))
  await p.click('#bMute')
  expect(a.played['bgm:play'] && a.played.tap && a.played.beep && m.muted && m.lv === 0 && m.ls === '1', JSON.stringify({ a, m })); return Object.keys(a.played).join(',')
})
await t('固定60Hz: 画面の速さに関係なく1秒=60ステップ', async () => {
  const r = await p.evaluate(async () => { const t0 = BI.S.time; await new Promise(r => setTimeout(r, 2000)); return (BI.S.time - t0) / 2 })
  expect(r > 0.85 && r < 1.1, r); return r.toFixed(3)
})


await p.close()
// ---- 6サイズ × 全画面で一画面に収まる。画面の巡り方はゲームに合わせて書く
for (const [w, h, name] of SIZES) {
  const q = await open(browser, { viewport: { width: w, height: h } })
  const views = {}
  views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-title.png` })
  await q.evaluate(() => BI.dbg.tut(2))
  views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-title.png` })
  await q.click('#bHow'); views.how = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-how.png` }); await q.click('#bHowBack')
  await q.evaluate(() => { BI.dbg.start(5); BI.dbg.pause(true); BI.dbg.setList(['egg', 'bottle', 'tofu', 'gyoza']); BI.S.front && (BI.S.front.state = 'wait') })
  await q.evaluate(() => { for (const k of ['egg', 'bottle', 'tofu', 'gyoza']) { BI.S.counter.length < 9 } BI.dbg.pause(false) })
  await q.waitForFunction(() => BI.S.counter.length >= 3, null, { timeout: 8000 }).catch(() => {})
  await q.evaluate(() => { BI.dbg.give('bottle', -0.5, 0.4, 1.57); BI.dbg.give('cabbage', 0.6, 0.6); BI.dbg.give('egg', 0, 1.6); BI.dbg.setP(0.7) })
  await q.waitForTimeout(2200)
  views.play = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-play.png` })
  await t(`${name}: 遊び中、レジの商品が全部画面内でつかめる大きさ`, async () => {
    const r = await q.evaluate(() => BI.S.counter.map(it => { const s = BI.toScreen(it.g.position); return [Math.round(s.x), Math.round(s.y), innerWidth, innerHeight] }))
    expect(r.length && r.every(([x, y, W, H]) => x > 10 && x < W - 10 && y > 50 && y < H - 10), JSON.stringify(r)); return r.map(a => a.slice(0, 2))
  })
  await q.evaluate(() => { BI.S.served = 12; BI.S.bags = 14; BI.S.eggsSafe = 30; BI.S.eggsTotal = 42; BI.S.dmg = { egg: 12, tofu: 2, squash: 1, melt: 1, drop: 1 }; BI.dbg.toResult() })
  await q.waitForTimeout(500)
  views.result = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-result.png` })
  for (const [v, r] of Object.entries(views)) await t(`一画面に収まる ${name} ${w}x${h} ${v}`, async () => { expect(!r.over.length, JSON.stringify(r)) })
  await t(`${name}: はみ出し・エラーなし`, async () => { const o = await overflow(q); expect(o.sw <= o.W && !o.bad.length && !q.errs.length, JSON.stringify(o) + q.errs.join('|')) })
  await q.close()
}
await browser.close()
// ---- WebKit（iPhone 相当）でタッチの通し
const wb = await webkit.launch(), wp = await open(wb, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await t('WebKit: 2本指の touchmove を止める', async () => {
  const r = await wp.evaluate(() => { const e = new Event('touchmove', { cancelable: true, bubbles: true }); Object.defineProperty(e, 'touches', { value: [{}, {}] }); document.body.dispatchEvent(e); return e.defaultPrevented })
  expect(r, r)
})
await t('WebKit: タッチでつかんで袋に入れられる', async () => {
  await wp.evaluate(() => { BI.dbg.tut(2); BI.dbg.start(5) }); await wp.waitForFunction(() => BI.S.counter.length > 0, null, { timeout: 8000 })
  const r = await wp.evaluate(async () => {
    const c = document.getElementById('gl'), a = BI.dbg.counterScreen(0), b = BI.dbg.worldScreen(0, 2.5, 0)
    const ev = (type, x, y, tgt) => (tgt || window).dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    ev('pointerdown', a.x, a.y, c); const held = BI.state().held
    for (let i = 1; i <= 10; i++) { ev('pointermove', a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10); await new Promise(r => setTimeout(r, 30)) }
    await new Promise(r => setTimeout(r, 250)); ev('pointerup', b.x, b.y); await new Promise(r => setTimeout(r, 900))
    return { held, inBag: BI.state().items.filter(i => i.inBag).length }
  })
  expect(r.held && r.inBag === 1, JSON.stringify(r))
})
await wp.screenshot({ path: `${ROOT}/shots/webkit-play.png` })
await t('WebKit: エラーなし', async () => { expect(wp.errs.length === 0, wp.errs.join('|')) })
await wb.close()
server.kill()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
