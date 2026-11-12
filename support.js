// 支援リンクと、ポータル（ひまつぶし横丁）へ戻る文字リンク。結果画面の「もう一回」のある所に足す
// 使い方: </body> の直前に <script src="support.js?v=1" data-ja="肉まん" data-en="a pork bun"></script>
// 2026-11-11 X（旧Twitter）のアプリの中のブラウザは、画面の下に自分のバー（× と URL の帯、ポストの操作の列）を
// ページの上に重ねて描く。safe-area も高さも教えてくれないので、X の中と分かった時だけ
// <html class="inapp-x"> と --inapp-bot（下に逃がす高さ）を付ける。各ゲームは下に貼り付く所に var(--inapp-bot,0px) を足す。
// 見分け方: UA に Twitter（Android の TwitterAndroid、昔の iOS の "Twitter for iPhone"）／iOS で t.co・x.com から来た。
// 一度分かったらタブの間は覚える（もう一回・再読み込みで referrer が消えても効くように）。試験用に ?inapp=x / ?inapp=0
;(function () {
  var KEY = 'tm_inapp', BOT = '52px'
  var de = document.documentElement, ua = navigator.userAgent || '', on = null
  function store(v) { try { sessionStorage.setItem(KEY, v) } catch (e) {} }
  var m = /[?&]inapp=(x|0)(?:&|$)/.exec(location.search)
  if (m) { on = m[1] === 'x'; store(on ? 'x' : '0') }
  if (on === null) { try { var s = sessionStorage.getItem(KEY); if (s) on = s === 'x' } catch (e) {} }
  if (on === null) {
    var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    var other = /CriOS|FxiOS|EdgiOS|OPiOS|Line\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(ua)
    var ref = ''
    try { ref = document.referrer ? new URL(document.referrer).hostname : '' } catch (e) {}
    on = /\bTwitter/i.test(ua) || (ios && !other && /^(t\.co|(mobile\.)?(x|twitter)\.com)$/.test(ref))
    if (on) store('x')
  }
  if (on) de.classList.add('inapp-x')
  // 2026-11-12 X の別の形（上に帯・下に戻る/共有の列）では、100svh が見えている高さより大きく出て、
  // 画面の下に置いたボタン（開始など）が見えなくなった。100svh と実際の高さ（innerHeight）の差を測り、
  // 差がある時だけその分も --inapp-bot に足す。ふつうのブラウザでは差は0なので何も変わらない。
  var sent = false
  function apply() {
    var diff = 0
    try {
      var p = document.createElement('div')
      p.style.cssText = 'position:fixed;left:-10px;top:0;width:1px;height:100svh;visibility:hidden;pointer-events:none'
      ;(document.body || de).appendChild(p)
      diff = Math.round(p.getBoundingClientRect().height - window.innerHeight)
      p.parentNode.removeChild(p)
    } catch (e) {}
    if (!(diff >= 2 && diff <= 400)) diff = 0
    var px = (on ? parseInt(BOT, 10) : 0) + diff
    if (px) de.style.setProperty('--inapp-bot', px + 'px'); else de.style.removeProperty('--inapp-bot')
    // どのブラウザでずれが出るかを後で見るため、ずれた時だけ計測に1回送る
    if (diff && !sent && window.dataLayer) { sent = true; try { window.dataLayer.push(['event', 'vh_short', { diff: diff, inapp: on ? 1 : 0, ih: window.innerHeight }]) } catch (e) {} }
  }
  apply()
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', function () { setTimeout(apply, 300) })
})();

(function () {
  var URL = 'https://ofuse.me/ktomo_dev'
  var script = document.currentScript
  var ja = '作者に' + script.getAttribute('data-ja') + 'をおごる'
  var en = 'Buy the dev ' + script.getAttribute('data-en')
  var again = document.getElementById('bAgain') || document.getElementById('btnAgain')
  if (!again || document.getElementById('tmSupport')) return

  var a = document.createElement('a')
  a.id = 'tmSupport'
  a.href = URL
  a.target = '_blank'
  a.rel = 'noopener'
  // 2026-11-08 本人「もう少しだけ目立つように。やりすぎない感じで」: 金の細い縁・小さな贈り物の線画・一度だけふわっと出る（くり返す動きはしない）
  a.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:7px;align-self:center;flex:none;width:fit-content;max-width:100%;min-height:40px;margin:8px auto 0;padding:0 16px;border:1.5px solid rgba(232,194,106,.9);border-radius:99px;background:rgba(28,22,14,.84);color:#FFE7A6;font-family:inherit;font-size:14px;font-weight:700;line-height:1.2;text-align:center;text-decoration:none;position:relative;z-index:2;pointer-events:auto;box-shadow:0 2px 12px rgba(232,194,106,.22);opacity:0;transform:translateY(6px);transition:opacity .5s ease .35s,transform .5s ease .35s'
  var ico = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="flex:none"><g fill="none" stroke="#E8C26A" stroke-width="1.4" stroke-linejoin="round"><rect x="2" y="6.5" width="12" height="7.5" rx="1"/><path d="M1.5 4.5h13v2h-13zM8 4.5v9.5"/><path d="M8 4.5C6.6 2 4.4 2.2 4.6 3.6 4.8 4.6 8 4.5 8 4.5zM8 4.5c1.4-2.5 3.6-2.3 3.4-.9C11.2 4.6 8 4.5 8 4.5z"/></g></svg>'
  var label = document.createElement('span')
  a.innerHTML = ico; a.appendChild(label)

  // 2026-11-09 ポータル公開: 支援より控えめな文字リンク。同じタブで横丁のトップへ
  var home = document.createElement('a')
  home.id = 'tmHome'
  home.href = 'https://tom3games.com/'
  home.target = '_top'
  home.style.cssText = 'display:block;align-self:center;flex:none;width:fit-content;max-width:100%;margin:2px auto 0;padding:4px 12px;border-radius:99px;background:rgba(18,16,14,.5);color:#F4EEE2;font-family:inherit;font-size:12px;font-weight:600;line-height:1.3;text-align:center;text-decoration:underline;text-underline-offset:3px;position:relative;z-index:2;pointer-events:auto;opacity:0;transition:opacity .5s ease .5s'
  function show() {
    function on() { a.style.opacity = '1'; a.style.transform = 'none'; home.style.opacity = '.92' }
    if (!('IntersectionObserver' in window)) return on()
    // 結果画面が開いて見えた時に1回だけ
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting })) { io.disconnect(); requestAnimationFrame(on) } })
    io.observe(a)
    setTimeout(on, 8000)   // 見えないまま判定が来ない時の保険（透明のまま残さない）
  }

  function setText() {
    var jp = /[ぁ-んァ-ヶ一-龠]/.test(again.textContent) || !again.textContent.trim()
    label.textContent = jp ? ja : en
    home.textContent = jp ? 'ひまつぶし横丁へ戻る' : 'Back to Himatsubushi Yokocho'
  }
  setText()
  new MutationObserver(setText).observe(again, { childList: true, characterData: true, subtree: true })

  // ボタンが3つ以上ある所はそこがボタンの置き場。2つまでなら横並びの列なので、ひとつ外の末尾に置く
  var row = again.parentElement
  var view = row.closest('main,section,[id="result"],[id="vResult"],[id="vEnd"]')
  var count = row.querySelectorAll(':scope > button, :scope > a').length
  if (row === view || count >= 3) row.appendChild(a)
  else row.parentElement.appendChild(a)
  // 結果画面が詰まっているゲームは、置き場所を data-home-slot で指定できる（足元の小さな文字の列など）
  var slot = document.querySelector('[data-home-slot]')
  if (slot) { home.style.margin = '0'; home.style.padding = '2px 10px'; slot.appendChild(home) }
  else a.parentElement.insertBefore(home, a.nextSibling)
  show()
})()
