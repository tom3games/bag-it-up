// verify.mjs の共通部品。コピーして __bi を置き換え、ゲーム固有のテストを足す。node verify.mjs
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium, webkit } from 'playwright'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
const ROOT = import.meta.dirname
mkdirSync(ROOT + '/shots', { recursive: true })
const PORT = Number(process.env.VPORT || 5421)
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
process.on('exit', () => server.kill())   // 途中で落ちても確認用サーバーを残さない（次の回がポートを握られる）
// サーバーが応答するまで待つ（固定 400ms だと負荷で間に合わない）
for (let i = 0; i < 100; i++) { try { await fetch(`http://localhost:${PORT}/`); break } catch (e) { await new Promise(r => setTimeout(r, 100)) } }
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
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts }); await muteContext(ctx)
  await ctx.addInitScript(() => { try { localStorage.clear() } catch (e) {} })
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message))
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console ' + m.text()) })
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) p.errs.push('reqfail ' + r.url()) })
  // 負荷が高いと load まで30秒を超えることがある。DOM ができたら進み、準備完了は長めに条件待ち
  await p.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 180000 }); await p.waitForFunction(() => window.__biReady && window.BI && window.BI.charsReady, null, { timeout: 120000 })
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
// スマホ縦だけ（横持ち・PC は本人が言った時だけ。2026-11-03）
const SIZES = [[360, 640, 'small'], [390, 844, 'phone'], [430, 932, 'large']]

const browser = await chromium.launch(MUTE_LAUNCH)
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
    await p.waitForFunction(() => BI.S.counter.length > 0 || BI.S.served >= 2, null, { timeout: 30000 })
    if (await p.evaluate(() => BI.S.served >= 2)) break
    await bagOne(p, (i % 3 - 1) * 0.5)
  }
  await p.waitForFunction(() => BI.S.served >= 2, null, { timeout: 30000 })
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
  // 店長に呼ばれる演出と結果の数え上げは実時間で待つと負荷で8秒を超える。時間を止めてコマで進める
  await p.evaluate(() => { BI.dbg.complaint(); BI.dbg.pause(true); for (let i = 0; i < 60 * 30 && BI.S.mode !== 'result'; i++) BI.dbg.step(1) })
  expect(await p.evaluate(() => BI.S.mode === 'result'), 'no result')
  await p.evaluate(() => { BI.dbg.step(60 * 3); BI.dbg.pause(false) })
  const r = await p.evaluate(() => ({ score: document.getElementById('rScore').textContent, rank: document.getElementById('rRank').textContent, nums: document.getElementById('rNums').textContent, res: BI.S.result }))
  expect(mg === 2 && r.res.score === 7 * 100 + 8 * 30 + 11 * 25 && r.score === String(r.res.score) && /7/.test(r.nums) && /11\/18/.test(r.nums), JSON.stringify(r)); return r.score + ' ' + r.rank
})
await t('結果: 画像の保存（1080x1080 の PNG）', async () => {
  const dl = p.waitForEvent('download', { timeout: 30000 }).catch(e => null); await p.click('#bSave', { timeout: 5000 }); const d = await dl; expect(d, 'no download')
  const ok = await p.evaluate(() => { const c = BI.drawCard(); return [c.width, c.height] })
  expect(/bag-it-up-\d+\.png/.test(d.suggestedFilename()) && ok[0] === 1080, d.suggestedFilename())
})
await t('結果: X でポスト（intent・本文に結果とハッシュタグ・url は公開URL）', async () => {
  const x = await p.evaluate(() => BI.xPost())
  const u = new URL(x.href)
  expect(u.origin + u.pathname === 'https://x.com/intent/post' && /#袋詰め職人/.test(u.searchParams.get('text')) && /7人/.test(u.searchParams.get('text')) && u.searchParams.get('url') === 'https://tom3games.github.io/bag-it-up/', x.href)
  const [pop] = await Promise.all([p.waitForEvent('popup', { timeout: 30000 }), p.click('#bX', { timeout: 5000 })]); await pop.close()
})
await t('英語に切り替わる（結果・ボタン・共有文）', async () => {
  await p.click('#bLang'); const r = await p.evaluate(() => ({ btn: document.getElementById('bAgain').textContent, rank: document.getElementById('rRank').textContent, share: BI.xPost().text, lang: document.documentElement.lang }))
  await p.click('#bLang'); expect(r.lang === 'en' && r.btn === 'Again' && /#BagItUp/.test(r.share) && !/[ぁ-ん]/.test(r.rank), JSON.stringify(r))
})
await t('音: BGM と効果音を鳴らす関数が呼ばれる（実際には鳴らさない）・ミュートで止まる', async () => {
  await p.click('#bTitle'); await p.click('#bStart'); await p.waitForTimeout(1200)
  const a = await p.evaluate(() => ({ played: BI.Snd.played, want: BI.Snd.want, ctx: BI.Snd.ctx && BI.Snd.ctx.state }))
  await p.click('#bMute'); await p.waitForTimeout(400); const m = await p.evaluate(() => ({ lv: BI.Snd.level(), muted: BI.Snd.muted, ls: localStorage.getItem('bi.mute') }))
  await p.click('#bMute')
  expect(a.want === 'play' && a.ctx === 'suspended' && a.played.tap && a.played.beep && m.muted && m.lv === 0 && m.ls === '1', JSON.stringify({ a, m })); return Object.keys(a.played).join(',')
})
await t('音: 無音のまま（__muteOk・録音素材が読み込まれる）', async () => {
  await p.waitForFunction(() => Object.values(BI.Snd.bufs).filter(b => b && b !== 'loading').length >= 20, null, { timeout: 15000 })
  const r = await p.evaluate(() => ({ ok: window.__muteOk(), n: Object.values(BI.Snd.bufs).filter(b => b && b !== 'loading').length, osc: typeof BI.Snd.tone, amb: !!BI.Snd.loops.amb, bgm: !!BI.Snd.loops.bgm }))
  expect(r.ok && r.osc === 'undefined' && r.amb && r.bgm, JSON.stringify(r)); return r
})
await t('顔: 圧で表情が変わる（ふつう→むっ→怒り→激怒）', async () => {
  const r = await p.evaluate(() => { BI.dbg.start(4); BI.dbg.pause(true); for (let i = 0; i < 400 && !(BI.S.front && BI.S.front.state === 'wait'); i++) BI.dbg.step(1); BI.S.front.line = null; const out = {}; for (const [k, v] of [['a', 0.1], ['b', 0.42], ['c', 0.68], ['d', 0.92]]) { BI.dbg.setP(v); BI.dbg.step(2); out[k] = BI.S.front.c.expr } BI.dbg.setP(0); BI.dbg.pause(false); return out })
  expect(['calm', 'blink'].includes(r.a) && r.b === 'annoyed' && r.c === 'angry' && r.d === 'fury', JSON.stringify(r)); return r
})
await t('顔: 客の全員に顔の板があり、店長は段階で変わる', async () => {
  const r = await p.evaluate(() => { BI.dbg.start(4); BI.dbg.pause(true); for (let i = 0; i < 3; i++) BI.dbg.addCust(); BI.dbg.step(30); const f = BI.dbg.faces(); BI.dbg.mgrStage(1); BI.dbg.step(2); const m1 = BI.dbg.mgrExpr(); BI.dbg.mgrStage(3); BI.dbg.step(2); const m3 = BI.dbg.mgrExpr(); BI.dbg.mgrStage(0); BI.dbg.pause(false); return { f, m1, m3 } })
  expect(r.f.length >= 3 && r.f.every(c => c.face) && r.m1 === 'stern' && r.m3 === 'fury', JSON.stringify(r)); return r.f.map(c => c.name).join(',')
})
await t('手: つかむと近い方の手が商品へ行き、離すと袋の口に戻る', async () => {
  await p.evaluate(() => { BI.dbg.tut(2); BI.dbg.start(5) }); await p.waitForFunction(() => BI.S.counter.length > 0, null, { timeout: 30000 })
  const from = await p.evaluate(() => BI.dbg.counterScreen(0)), to = await p.evaluate(() => BI.dbg.worldScreen(0.4, 2.8, 0))
  const rest = await p.evaluate(() => BI.dbg.hands())
  await p.mouse.move(from.x, from.y); await p.mouse.down(); for (let i = 1; i <= 8; i++) { await p.mouse.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8); await p.waitForTimeout(20) }
  await p.waitForTimeout(400)
  const hold = await p.evaluate(() => { const it = BI.S.held.it, h = BI.dbg.hands()[0]; return { d: Math.hypot(h.x - it.g.position.x, h.y - it.g.position.y), h: BI.dbg.hands() } })
  await p.mouse.up(); await p.waitForTimeout(700)
  const back = await p.evaluate(() => BI.dbg.hands())
  expect(rest.length === 2 && hold.h[0].gripping && hold.d < 1.2 && !back[0].gripping && Math.abs(back[0].y - rest[0].y) < 0.1, JSON.stringify({ hold, back })); return +hold.d.toFixed(2)
})
await t('一言: 全部12字前後で、前に来た客が1回だけ言う', async () => {
  const r = await p.evaluate(async () => {
    const D = BI.D, lines = [...Object.values(D.ITEMS).filter(i => i.say).map(i => i.say.ja), ...D.SMALLTALK.map(i => i.ja), ...D.RARE.map(i => i.say.ja)], long = lines.filter(l => l.length > 13)
    BI.dbg.tut(2); BI.dbg.start(5); await new Promise(r => { const iv = setInterval(() => { if (BI.S.front && BI.S.front.state === 'wait') { clearInterval(iv); r() } }, 50) })
    BI.dbg.setFrontLine('tofu'); await new Promise(r => setTimeout(r, 500))
    const said = [...document.querySelectorAll('#fx .sb')].map(e => e.textContent), rest = BI.S.front.line
    return { n: lines.length, long, said, rest, wish: BI.S.front.wish }
  })
  expect(!r.long.length && r.said.includes('豆腐は水平で') && r.rest === null && r.wish === 'tofu', JSON.stringify(r)); return r.n
})
await t('一言: 頼んだ物を台無しにすると「言うたやん！」・守ると「言うた通りや！」', async () => {
  const r = await p.evaluate(() => {
    BI.dbg.start(9); BI.dbg.pause(true); for (let i = 0; i < 400 && !(BI.S.front && BI.S.front.state === 'wait'); i++) BI.dbg.step(1)
    BI.dbg.clearCounter(); BI.S.front.line = null; BI.S.front.wish = 'egg'; BI.dbg.noSpawn(); BI.dbg.give('egg', 3.5, 1.0); BI.dbg.step(200)
    const a = [...document.querySelectorAll('#fx .sb')].map(e => e.textContent), hurt = BI.S.front.hurt, broke = BI.S.front.brokeWish
    BI.dbg.pause(false); return { a, hurt, broke }
  })
  expect(r.hurt && r.broke, JSON.stringify(r)); return r
})
await t('変な物: 新しい物も全部作れて袋に入る・金魚は傾けるとこぼれる・ゴムはキュッと鳴る', async () => {
  const r = await p.evaluate(() => {
    const out = {}
    for (const k of BI.D.ODD) { BI.dbg.start(9); BI.dbg.noSpawn(); BI.dbg.pause(true); BI.dbg.give(k, 0, 0.9); BI.dbg.step(90); const s = BI.state(); out[k] = s.items.find(i => i.kind === k)?.inBag ?? (k === 'tuna' ? 'long' : false); BI.dbg.pause(false) }
    BI.dbg.start(9); BI.dbg.noSpawn(); BI.dbg.pause(true); BI.dbg.give('goldfish', 0, 1.0, 1.3); BI.dbg.step(150); const fish = BI.state().dmg.tofu
    const sq0 = BI.Snd.played.squeak || 0; BI.dbg.give('chicken', 0, 3); BI.dbg.step(100); const sq1 = BI.Snd.played.squeak || 0; BI.dbg.pause(false)
    return { out, fish, sq: sq1 - sq0 }
  })
  const bad = Object.entries(r.out).filter(([k, v]) => v === false && !['tuna', 'bowling'].includes(k))
  expect(!bad.length && r.fish === 1 && r.sq >= 1, JSON.stringify(r)); return r.out
})
await t('変な客: 全種のリストが商品として成り立つ（4人目以降・seed で再現）', async () => {
  const r = await p.evaluate(() => {
    const bad = BI.D.RARE.filter(c => !c.list.every(k => BI.D.ITEMS[k]) || (c.wish && !c.list.includes(c.wish)))
    const seen = (seed) => { BI.dbg.start(seed); BI.dbg.pause(true); const names = []; for (let i = 0; i < 40; i++) { BI.S.custN = 4 + i; const id = BI.dbg.addCust(); const cu = BI.S.cust.find(c => c.id === id); names.push(cu.rare ? cu.rare.id : '-') } BI.dbg.pause(false); return names.join(',') }
    const a = seed => seen(seed), s1 = a(11), s2 = a(11)
    return { bad: bad.map(c => c.id), same: s1 === s2, rare: (s1.match(/[a-z]+/g) || []).length }
  })
  expect(!r.bad.length && r.same && r.rare >= 1, JSON.stringify(r)); return r
})
await t('文字: 同時に出す文字は2つまで（圧・割れ・落下を連発しても）', async () => {
  const r = await p.evaluate(async () => {
    BI.dbg.tut(2); BI.dbg.start(4); await new Promise(r => setTimeout(r, 1200)); BI.dbg.setP(0.9); let mx = 0
    for (let i = 0; i < 60; i++) { if (i % 12 === 0) { BI.dbg.give('egg', 3.5, 1); BI.dbg.give('tofu', 0, 1, 1.3) } BI.S.P = Math.min(0.95, BI.S.P); mx = Math.max(mx, document.querySelectorAll('#fx > *').length); await new Promise(r => setTimeout(r, 60)) }
    return mx
  })
  expect(r <= 2, r); return r
})
await t('固定60Hz: 画面の速さに関係なく1秒=60ステップ', async () => {
  // 実時間で2秒待つと、負荷でコマが遅れた分（1コマ最大8ステップの上限）だけ進みが減って落ちる。
  // 時計とコマを差し替えて 30/60/120/144Hz で仮想2秒ずつ回し、どの速さでも 1秒=60ステップかを見る
  const r = await p.evaluate(async () => {
    const realRaf = window.requestAnimationFrame.bind(window), realNow = performance.now.bind(performance)
    // 仮想のコマの間は描画を止める（数百コマを一気に描くと GPU 側に溜まり、後でページを閉じるのに数分かかった）
    const cv = document.getElementById('gl'), gls = [cv.getContext('webgl2') || cv.getContext('webgl')].filter(Boolean), DRAW = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'clear']
    for (const gl of gls) for (const k of DRAW) if (gl[k]) gl[k] = () => {}
    let fake = realNow(), cbs = []
    window.requestAnimationFrame = cb => { cbs.push(cb); return 1 }
    performance.now = () => fake
    await new Promise(r => realRaf(() => realRaf(() => realRaf(r))))
    const out = {}
    for (const hz of [30, 60, 120, 144]) {
      const t0 = BI.S.time
      for (let i = 0; i < hz * 2; i++) { fake += 1000 / hz; const c = cbs; cbs = []; c.forEach(f => f(fake)) }
      out[hz] = +((BI.S.time - t0) / 2).toFixed(3)
    }
    const off = fake - realNow(); performance.now = () => realNow() + off
    window.requestAnimationFrame = realRaf; cbs.forEach(f => realRaf(f))
    for (const gl of gls) for (const k of DRAW) delete gl[k]
    return out
  })
  expect(Object.values(r).every(v => v > 0.97 && v < 1.03), r); return r
})


await p.close()
// ---- スマホ縦3サイズ × 全画面で一画面に収まる。画面の巡り方はゲームに合わせて書く
for (const [w, h, name] of SIZES) {
  const q = await open(browser, { viewport: { width: w, height: h } })
  const views = {}
  views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-title.png` })
  await q.evaluate(() => BI.dbg.tut(2))
  views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-title.png` })
  await q.click('#bHow'); views.how = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-how.png` }); await q.click('#bHowBack')
  await q.evaluate(() => { BI.dbg.start(5); BI.dbg.pause(true); BI.dbg.setList(['egg', 'bottle', 'tofu', 'gyoza']); BI.S.front && (BI.S.front.state = 'wait') })
  await q.evaluate(() => { for (const k of ['egg', 'bottle', 'tofu', 'gyoza']) { BI.S.counter.length < 9 } BI.dbg.pause(false) })
  await q.waitForFunction(() => BI.S.counter.length >= 3, null, { timeout: 30000 }).catch(() => {})
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
  await wp.evaluate(() => { BI.dbg.tut(2); BI.dbg.start(5) }); await wp.waitForFunction(() => BI.S.counter.length > 0, null, { timeout: 30000 })
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
await t('WebKit: 無音のまま（__muteOk）', async () => { const r = await wp.evaluate(() => ({ ok: window.__muteOk(), ctx: BI.Snd.ctx && BI.Snd.ctx.state, bufs: Object.keys(BI.Snd.bufs).length })); expect(r.ok && r.ctx !== 'running' && r.bufs > 0, JSON.stringify(r)); return r })
await t('WebKit: エラーなし', async () => { expect(wp.errs.length === 0, wp.errs.join('|')) })
// ---- ページを離れた時の音（2026-11-11 横丁へ移っても BGM が鳴り続けた。sfx.js に止める処理が無かった）。音は鳴らさず、再生中のループの数で見る
await (async (ap, other, ready, tapXY) => {
  const e0 = ap.errs.length
  await t('WebKit: 裏に回ると BGM と環境音が止まり suspend。戻っても触るまで鳴らない（bfcache の pageshow でも）', async () => {
    await ap.waitForFunction(() => Snd.playing().length >= 1, null, { timeout: 15000 })
    const r = await ap.evaluate(async () => {
      const c = Snd.ctx; let sus = 0; const os = c.suspend; c.suspend = function () { sus++; return os.call(this) }
      const before = Snd.playing().length, w0 = Snd.life.wake
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))
      const hid = { away: Snd.away, playing: Snd.playing().length, sus, gain: Snd.master.gain.value }
      const fx = Object.keys(Snd.files)[0], url = Object.values(Snd.loops).find(l => l && l.url).url
      const pl = fx ? Snd.play(fx) : null; Snd.loop('awayTest', url, 0.2)   // 裏にいる間の音は鳴らさない
      await new Promise(r => setTimeout(r, 400)); const quiet = Snd.playing().length
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      await new Promise(r => setTimeout(r, 400)); const back = { away: Snd.away, playing: Snd.playing().length, gain: Snd.master.gain.value, state: c.state }
      Snd.loop('awayTest', null); c.suspend = os
      return { before, w0, hid, pl: pl === null, quiet, back }
    })
    const xy = await tapXY(ap); await ap.touchscreen.tap(xy.x, xy.y); await ap.waitForTimeout(700)
    const after = await ap.evaluate(() => ({ away: Snd.away, playing: Snd.playing().length, wake: Snd.life.wake, mute: window.__muteOk() }))
    expect(r.before >= 1 && r.hid.away && r.hid.playing === 0 && r.hid.sus >= 1 && r.hid.gain === 0 && r.pl && r.quiet === 0 && r.back.away && r.back.playing === 0 && r.back.gain === 0 && r.back.state !== 'running' && !after.away && after.playing >= 1 && after.wake === r.w0 + 1 && after.mute, JSON.stringify({ r, after }))
    return { before: r.before, hidden: r.hid.playing, back: r.back.playing, touched: after.playing }
  })
  await t('WebKit: 横丁へ移る（pagehide）と止まり、戻るで戻っても鳴っていない', async () => {
    await ap.evaluate(() => addEventListener('pagehide', () => { try { sessionStorage.setItem('awayHide', JSON.stringify({ away: Snd.away, playing: Snd.playing().length })) } catch (e) {} }))
    await ap.goto(URL0 + other); await ap.waitForTimeout(300)
    const h = JSON.parse(await ap.evaluate(() => sessionStorage.getItem('awayHide')) || '{}')
    await ap.goBack(); await ap.waitForFunction(ready, null, { timeout: 30000 }); await ap.waitForTimeout(800)
    const back = await ap.evaluate(() => ({ playing: Snd.playing().length, ctx: Snd.ctx ? Snd.ctx.state : 'none' }))
    expect(h.away && h.playing === 0 && back.playing === 0 && back.ctx !== 'running', JSON.stringify({ h, back })); return { h, back }
  })
  // 移る時に読み込み途中の音が中断されるのは数えない
  await t('WebKit: 離れる・戻るでエラーなし', async () => { const e = ap.errs.slice(e0).filter(s => !/^reqfail |__away__|status of 404/.test(s)); expect(!e.length, e.join('|')) })
})(wp, '__away__', () => window.__biReady, p => ({ x: Math.round(p.viewportSize().width / 2), y: 6 }))
await wb.close()
server.kill()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
