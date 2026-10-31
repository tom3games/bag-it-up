// SNS用サムネ og.png（1200x630）。node og.mjs
// 卵の上にボウリングの球、豆腐から水、後ろの客は「まだ！？」、奥のドアから店長がのぞく瞬間を左に、右にタイトルと一言
import { chromium } from 'playwright'
import { launch } from './_mute.mjs'
import { spawn } from 'node:child_process'
const ROOT = import.meta.dirname
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: '5423' } })
await new Promise(r => setTimeout(r, 400))
const b = await launch(chromium)
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, locale: 'ja-JP' })
await p.goto('http://localhost:5423/'); await p.waitForFunction(() => window.__biReady && BI.charsReady)
await p.evaluate(() => document.fonts.ready)
await p.evaluate(() => { BI.dbg.tut(2); BI.dbg.start(11) })
await p.waitForTimeout(2600)
await p.evaluate(() => {
  BI.dbg.pause(true); BI.dbg.setList(['milk', 'gyoza', 'melon', 'daikon', 'chips']); BI.dbg.clearCounter()
  for (let i = 0; i < 300 && BI.S.counter.length < 4; i++) BI.dbg.step(1)
  BI.dbg.complaint(); BI.dbg.step(200)
  BI.dbg.give('egg', -0.3, 0.3); BI.dbg.step(30); BI.dbg.give('bottle', 0.75, 0.75); BI.dbg.step(30)
  BI.dbg.give('tofu', 0.75, 1.9, 0.9); BI.dbg.step(10)
  BI.dbg.give('bowling', -0.35, 3.0); BI.dbg.step(26)
  BI.dbg.setP(0.95); BI.dbg.step(4)
  document.querySelectorAll('#fx > *').forEach(e => e.remove())
  BI.dbg.say(0, 'まだ！？', 'hot'); BI.dbg.say(1, 'はぁ…', ''); 
  BI.dbg.view(250, 40, 1.3); BI.dbg.step(1)
})
await p.addStyleTag({ content: `#corner,.hudTop,.hint,#finger,#loading{display:none!important}
  body::after{content:'';position:fixed;inset:0 0 0 54%;background:linear-gradient(90deg,rgba(32,53,43,0),rgba(32,53,43,.94) 22%);z-index:30}
  .sb,.sb.hot{font-size:26px!important;padding:6px 14px!important}` })
await p.waitForTimeout(800)
await p.evaluate(() => { document.querySelectorAll('#fx .sb.mgr').forEach(e => e.remove()); BI.dbg.step(1) })
await p.evaluate(() => {
  const ono = (t, x, y, size, rot, col) => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:20;font-family:'Dela Gothic One';font-size:${size}px;color:${col};-webkit-text-stroke:4px #1d1a16;paint-order:stroke fill;text-shadow:0 6px 0 #1d1a16;transform:rotate(${rot}deg);white-space:nowrap`; document.body.appendChild(d) }
  const egg = BI.S.items.find(i => i.kind === 'egg'), tofu = BI.S.items.find(i => i.kind === 'tofu')
  const a = BI.toScreen(egg.g.position), t = BI.toScreen(tofu.g.position)
  ono('グシャッ', a.x - 260, a.y - 30, 70, -10, '#ffd23f')
  ono('ピチャッ', t.x + 10, t.y - 120, 46, 8, '#8fd3ff')
  const d = document.createElement('div'); d.style.cssText = 'position:fixed;right:28px;top:0;bottom:0;width:480px;z-index:31;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:24px;color:#fff;text-align:center'
  d.innerHTML = `<div style="font-family:'Dela Gothic One';font-size:30px;letter-spacing:.12em;color:#1d1a16;background:#ffd23f;padding:6px 16px 5px;border:4px solid #1d1a16;transform:rotate(-3deg);box-shadow:4px 4px 0 #1d1a16">BAG IT UP</div>
  <div style="font-family:'Zen Maru Gothic';font-weight:900;font-size:92px;line-height:1.05;white-space:nowrap;-webkit-text-stroke:4px #1d1a16;paint-order:stroke fill;text-shadow:0 7px 0 #1d1a16">袋詰め<span style="font-family:'Dela Gothic One';font-weight:400;color:#ffd23f">職人</span></div>
  <div style="font-weight:900;font-size:30px;line-height:1.55;font-family:'Zen Maru Gothic'">卵は下だと<span style="color:#ffd23f">割れる</span>。<br>豆腐は傾けると<span style="color:#8fd3ff">水が出る</span>。<br>後ろの客は「<span style="color:#ff6b74">まだ？</span>」</div>`
  document.body.appendChild(d)
})
await p.waitForTimeout(300)
await p.screenshot({ path: ROOT + '/og.png' })
await b.close(); server.kill()
console.log('ok')
