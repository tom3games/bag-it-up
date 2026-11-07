// テストで絶対に音を出さないための保険（2026-11-08 検証中に音が漏れて再発防止）。
// 使い方: ブラウザを起動するスクリプトの「一番最初の import」に  import './mute-auto.mjs'  を置くだけ（tools/ からは '../mute-auto.mjs'）。
// 読み込んだ時点で playwright の chromium/webkit/firefox を差し替える:
//   launch → --mute-audio を必ず足す / newContext・newPage・launchPersistentContext → 作った全部に mute.mjs の muteContext を掛ける。
// スクリプト側で muteContext を呼んでいても二重に掛かるだけで害はない。同じ mute.mjs と並べて置く
import pw from 'playwright'
import { muteContext, MUTE_LAUNCH } from './mute.mjs'

const withMute = o => ({ ...(o || {}), args: [...((o && o.args) || []), ...MUTE_LAUNCH.args] })
function wrapBrowser(b) {
  if (b.__muteAuto) return b
  b.__muteAuto = true
  const nc = b.newContext.bind(b), np = b.newPage.bind(b)
  b.newContext = async (...a) => { const c = await nc(...a); await muteContext(c); return c }
  b.newPage = async (...a) => { const p = await np(...a); await muteContext(p.context()); return p }
  return b
}
for (const k of ['chromium', 'webkit', 'firefox']) {
  const bt = pw[k]
  if (!bt || bt.__muteAuto) continue
  bt.__muteAuto = true
  const launch = bt.launch.bind(bt), persist = bt.launchPersistentContext.bind(bt)
  bt.launch = async o => wrapBrowser(await launch(withMute(o)))
  bt.launchPersistentContext = async (dir, o) => { const c = await persist(dir, withMute(o)); await muteContext(c); return c }
}
