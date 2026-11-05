// テスト中は音を出さない（本人「プレイしてテストするときに音を出さないで」2026-10-31、2026-11-02 に WebKit から漏れて再指摘）
// 使い方: const b = await chromium.launch(MUTE_LAUNCH); await muteContext(ctx)  ← ctx.newPage() より前に呼ぶ
// Chromium は --mute-audio で消える。WebKit には起動フラグが無く、resume を止めるだけでは
// クリックで作った AudioContext が最初から running で鳴る（年齢確認の WebKit 検証で漏れた）。
// なので全エンジンで ①スピーカー（destination）への接続を音量0の箱に差し替え ②作った直後に suspend ③resume は数えるだけ。
// 検証は window.__soundCalls（呼ばれた回数）と window.__muteOk()（実際に無音か）で見る
export const MUTE_LAUNCH = { args: ['--mute-audio'] }
export async function muteContext(ctx) {
  await ctx.addInitScript(() => {
    window.__soundCalls = 0
    const ctxs = []
    for (const k of ['AudioContext', 'webkitAudioContext']) {
      const C = window[k]; if (!C || C.__muted) continue
      const M = function (...a) {
        const c = new C(...a); ctxs.push(c)
        try { c.suspend() } catch (e) {}
        return c
      }
      M.prototype = C.prototype; M.__muted = true
      window[k] = M
      C.prototype.resume = function () { window.__soundCalls++; return Promise.resolve() }
      const cg = C.prototype.createGain
      if (cg && !cg.__muted) { C.prototype.createGain = function () { window.__soundCalls++; return cg.apply(this, arguments) }; C.prototype.createGain.__muted = true }
    }
    if (window.AudioNode && window.AudioDestinationNode && !AudioNode.prototype.connect.__muted) {
      const conn = AudioNode.prototype.connect
      AudioNode.prototype.connect = function (t, ...a) {
        if (t instanceof AudioDestinationNode) {
          const c = this.context
          if (!c.__silent) { c.__silent = c.createGain(); c.__silent.gain.value = 0; conn.call(c.__silent, t) }
          return conn.call(this, c.__silent, ...a)
        }
        return conn.call(this, t, ...a)
      }
      AudioNode.prototype.connect.__muted = true
    }
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () { this.muted = true; this.volume = 0; return play.apply(this, arguments) }
    // 実際に無音か: 作った全部の AudioContext が止まっていて、スピーカーの手前が音量0
    window.__muteOk = () => ctxs.every(c => c.state !== 'running' && (!c.__silent || c.__silent.gain.value === 0))
  })
}
