// 袋詰め職人 / BAG IT UP
// レジ横で流れてくる商品をエコバッグに詰める。袋の中は2Dの物理（planck.js = Box2D）、見た目は Three.js の3D。
// 時間は固定60Hz（performance.now で数える）。ゲージは置かず、客の態度と店長の位置で圧を見せる
import * as THREE from 'three'
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js'
import { clone as skClone } from './vendor/jsm/utils/SkeletonUtils.js'
import { setupLook, enableShadows, castShadow, receiveShadow, addBlobShadow, surfaceTex, addCornerAO, createFx, createFace, look } from './look.js'

const D = window.BI_DATA, pl = window.planck
const $ = s => document.querySelector(s)
const STEP = 1 / 60
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, k) => a + (b - a) * k
const ease = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k) }
const isTouch = matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0)
function mulberry(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const store = { get(k) { try { return localStorage.getItem('bi.' + k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem('bi.' + k, v) } catch (e) {} } }
const IT = D.ITEMS

// ---------- 寸法（世界の単位。袋の内寸 BW×BH）
const BW = 2.4, BH = 2.0, BD = 1.25, WALL = 0.08, TABLE = 2.7, FLOOR_Y = -3.4
const CTR = { y: 1.5, z: -1.9, front: -1.25, back: -2.55 } // レジ台の天板
const CUST_Y = -0.5, CUST_H = 3.0
const QUEUE = [[0.2, -3.7], [2.75, -5.4], [4.0, -6.5], [5.1, -7.4], [6.1, -8.2]]
const MGR_POS = [[-3.55, -6.9], [-3.3, -6.2], [-2.7, -4.7], [-1.9, -3.15]]
const G = -22
const LOOKUP = -0.45

// ---------- 状態
const S = {
  lang: store.get('lang') || ((navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'),
  mode: 'title', time: 0, seed: 1, rand: Math.random, dbgPause: false,
  items: [], counter: [], held: null, cust: [], front: null, nextCustT: 0, custN: 0,
  P: 0, complaints: 0, served: 0, bags: 0, eggsSafe: 0, eggsTotal: 0, dmg: { egg: 0, tofu: 0, squash: 0, melt: 0, drop: 0 },
  settleT: 0, bagSwapT: 0, sighT: 4, madaT: 6, tut: store.get('tut') === '1' ? 2 : 0, tutEggShown: false,
  overT: 0, resT: 0, result: null, shake: 0, lastThud: 0, photoTaken: false, ptr: null,
}
const TT = () => D.T[S.lang]
const pick = a => a[Math.floor(S.rand() * a.length) % a.length]

// ---------- 音（録音素材だけ。合成音は使わない。エンジンは sfx.js、出所は CREDITS.md）
const sf = (pre, n) => Array.from({ length: n }, (_, i) => `snd/${pre}${i + 1}.mp3`)
Snd.muted = store.get('mute') === '1'
Snd.def({
  tap: 'snd/tap.mp3', beep: 'snd/beep.mp3', grab: sf('grab', 3), thud: sf('thud', 3), crack: sf('crack', 3), shell: 'snd/shell.mp3',
  splash: sf('splash', 2), squash: sf('crack', 3), melt: sf('melt', 2), drop: sf('drop', 2), done: 'snd/done.mp3', full: sf('bag', 3), bag: sf('bag', 3),
  sigh: sf('sigh', 2), mada: sf('grunt', 3), tapfoot: sf('foot', 3), complaint: sf('grunt', 3), mgr: sf('grunt', 3), over: 'snd/over.mp3', stamp: 'snd/stamp.mp3',
  boing: sf('boing', 2), squeak: sf('squeak', 3),
})
const SND_TRACKS = { title: ['snd/bgm_title.mp3', 0.22, 1], play: ['snd/bgm_play.mp3', 0.26, 1], over: ['snd/bgm_title.mp3', 0.16, 0.8] }
Object.assign(Snd, {
  want: null, tempo: 1, tense: 0, _init: Snd.init, _setMute: Snd.setMute,
  init() { const first = !this.ctx; this._init(); if (first && this.ctx) { this.loop('amb', 'snd/amb_fridge.mp3', 0.12, 1); this.applyTrack() } },
  setMute(m) { this._setMute(m); store.set('mute', m ? '1' : '0') },
  setTrack(name) { if (this.want === name) return; this.want = name; this.applyTrack() },
  applyTrack() {
    if (!this.ctx) return
    const t = this.want && SND_TRACKS[this.want]; this.loop('bgm', t ? t[0] : null, t ? t[1] : 0, 0.3)
    if (t) this.played['bgm:' + this.want] = (this.played['bgm:' + this.want] || 0) + 1
  },
  // 遊び中は客の圧で曲が速く・高くなる
  tick() { const l = this.loops.bgm; if (l && l.node) l.node.playbackRate.value = (SND_TRACKS[this.want] || [0, 0, 1])[2] * (this.want === 'play' ? this.tempo : 1) },
  sfx(n, o = {}) {
    if (n === 'thud') { const v = clamp(o.v ?? 0.5, 0.1, 1); return this.play(n, { vol: 0.25 + 0.75 * v, rate: 1.15 - 0.3 * v }) }
    if (n === 'crack') { this.play('shell', { vol: 0.7, rate: 1.5 }); return this.play(n, { vol: 0.9 }) }
    if (n === 'squash') return this.play(n, { vol: 0.8, rate: 0.7 })
    if (n === 'tapfoot') return this.play(n, { vol: 0.35 })
    if (n === 'sigh') return this.play(n, { vol: 0.32, rate: 0.7 })
    if (n === 'mada') return this.play(n, { vol: 0.7, rate: o.hot ? 1.35 : 1.1 })
    if (n === 'complaint') { this.duck(0.35, 1.2); this.play(n, { vol: 1, rate: 1.3 }); return this.play(n, { vol: 1, rate: 1.45, delay: 0.22 }) }
    if (n === 'mgr') return this.play(n, { vol: 1, rate: 0.62, room: 0.4 })
    if (n === 'over') this.duck(0.2, 1.8)
    return this.play(n, { vol: { tap: 0.45, beep: 0.5, grab: 0.6, full: 0.8, bag: 0.55 }[n] ?? 0.9 })
  },
})

// ---------- 描画の土台
const canvas = $('#gl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.75 : 2))
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xdfe8dc)
scene.fog = new THREE.Fog(0xdfe8dc, 18, 34)
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80)
const lk = setupLook(renderer, scene, { env: true, envIntensity: 0.55, exposure: 1.05, sun: 2.1, sunPos: [3, 8, 5], hemi: 0.8, sky: 0xfff6e6, ground: 0x7a6a5a })
enableShadows(renderer, lk.sun, { center: [0, 1.2, -0.6], radius: 4.2, mapSize: isTouch ? 1024 : 2048 })
const fx = createFx(scene, camera, renderer)
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o })
function mesh(geo, mat, x = 0, y = 0, z = 0, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (parent) parent.add(m); return m }
function canvasTex(w, h, draw, o = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  if (o.rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...o.rep) }
  return t
}
const FONT = '"Zen Maru Gothic","Hiragino Maru Gothic ProN","Hiragino Sans",sans-serif'
function label(x, w, h, o) {
  x.fillStyle = o.bg; x.fillRect(0, 0, w, h)
  if (o.band) { x.fillStyle = o.band; x.fillRect(0, h * (o.bandY ?? 0.55), w, h * (o.bandH ?? 0.3)) }
  if (o.draw) o.draw(x, w, h)
  x.fillStyle = o.fg; x.textAlign = 'center'; x.textBaseline = 'middle'
  x.font = `900 ${o.size ?? h * 0.28}px ${FONT}`; x.fillText(o.text, w / 2, h * (o.ty ?? 0.38))
  if (o.sub) { x.font = `900 ${o.subSize ?? h * 0.13}px ${FONT}`; x.fillStyle = o.subFg ?? o.fg; x.fillText(o.sub, w / 2, h * (o.sy ?? 0.72)) }
}

// ---------- 店（背景）
const world3 = new THREE.Group(); scene.add(world3)
{
  // 床（店のタイル）
  const ft = surfaceTex({ w: 512, h: 512, base: '#d9d4c7', noise: 0.04, grime: 0.06, repeat: [7, 7], draw: (x, w, h) => { x.strokeStyle = 'rgba(90,80,60,.35)'; x.lineWidth = 3; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * w / 4, 0); x.lineTo(i * w / 4, h); x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); x.stroke() } x.fillStyle = 'rgba(160,150,120,.25)'; x.fillRect(0, 0, w / 4, h / 4); x.fillRect(w / 2, h / 2, w / 4, h / 4) } })
  const floor = mesh(new THREE.PlaneGeometry(40, 16), std(0xffffff, { map: ft, roughness: 0.35 }), 0, CUST_Y, -10.55, world3); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true
  const ft2 = ft.clone(); ft2.repeat.set(7, 2.5); ft2.needsUpdate = true
  const floor2 = mesh(new THREE.PlaneGeometry(40, 14), std(0xffffff, { map: ft2, roughness: 0.35 }), 0, FLOOR_Y, 5.45, world3); floor2.rotation.x = -Math.PI / 2; floor2.receiveShadow = true
  // 奥の壁と棚
  const wt = surfaceTex({ w: 256, h: 256, base: '#f2ead8', noise: 0.03, grime: 0.05 })
  mesh(new THREE.PlaneGeometry(40, 12), std(0xffffff, { map: wt }), 0, 6, -10.5, world3)
  const shelfMat = std(0xe8e2d4, { roughness: 0.5 }), shelfDk = std(0x8b8f96, { roughness: 0.4, metalness: 0.3 })
  const boxCols = [0xe76f51, 0xf4a261, 0x2a9d8f, 0xe9c46a, 0x264653, 0xd62828, 0x90be6d, 0xf8f9fa, 0x577590, 0xf9844a]
  const rnd = mulberry(7), boxGeo = new THREE.BoxGeometry(1, 1, 1)
  const inst = new THREE.InstancedMesh(boxGeo, std(0xffffff, { roughness: 0.55 }), 600); let ni = 0
  const mtx = new THREE.Matrix4(), col = new THREE.Color()
  for (const sx of [-9, -4.5, 4.5, 9, 13.5, -13.5]) {
    const g = new THREE.Group(); g.position.set(sx, CUST_Y, -9.6); world3.add(g)
    mesh(new THREE.BoxGeometry(4.2, 5.4, 0.2), shelfMat, 0, 2.7, -0.6, g)
    for (let r = 0; r < 4; r++) {
      const y = 0.4 + r * 1.3; mesh(new THREE.BoxGeometry(4.2, 0.08, 1.1), shelfDk, 0, y, 0, g)
      let x = -1.95
      while (x < 1.9 && ni < 600) {
        const w = 0.25 + rnd() * 0.35, h = 0.45 + rnd() * 0.6, d = 0.5 + rnd() * 0.3
        mtx.compose(new THREE.Vector3(sx + x + w / 2, CUST_Y + y + 0.04 + h / 2, -9.6 + 0.05), new THREE.Quaternion(), new THREE.Vector3(w * 0.95, h, d))
        inst.setMatrixAt(ni, mtx); inst.setColorAt(ni, col.setHex(boxCols[Math.floor(rnd() * boxCols.length)])); ni++; x += w
      }
    }
  }
  inst.count = ni; world3.add(inst)
  // 天井の照明（光る板）
  for (const x of [-6, 0, 6]) for (const z of [-4, -8]) mesh(new THREE.BoxGeometry(2.6, 0.08, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff }), x, 9.5, z, world3)
  // 吊り看板（レジ）
  const sign = mesh(new THREE.BoxGeometry(2.2, 0.8, 0.08), [std(0x2a9d6f), std(0x2a9d6f), std(0x2a9d6f), std(0x2a9d6f), std(0xffffff, { map: canvasTex(256, 96, (x, w, h) => label(x, w, h, { bg: '#2a9d6f', fg: '#fff', text: 'レジ 3', size: 52, ty: 0.5 })) }), std(0x2a9d6f)], -1.2, 7.2, -5.5, world3)
  mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4), shelfDk, -1.9, 8.6, -5.5, world3); mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4), shelfDk, -0.5, 8.6, -5.5, world3)
  sign.castShadow = false
  // 事務所のドア（店長が出てくる）
  const dt = canvasTex(256, 512, (x, w, h) => { x.fillStyle = '#7a8a96'; x.fillRect(0, 0, w, h); x.fillStyle = '#5d6b75'; x.fillRect(20, 20, w - 40, h - 40); x.fillStyle = '#fff'; x.fillRect(48, 120, w - 96, 70); x.fillStyle = '#1d1a16'; x.font = `900 34px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('STAFF', w / 2, 155) })
  const frame = mesh(new THREE.BoxGeometry(2.0, 4.0, 0.2), std(0x3a3f45), -3.6, CUST_Y + 2.0, -10.35, world3)
  W3.door = mesh(new THREE.BoxGeometry(1.7, 3.7, 0.1), std(0xffffff, { map: dt }), 0, 0, 0)
  W3.doorPivot = new THREE.Group(); W3.doorPivot.position.set(-3.6 - 0.85, CUST_Y + 1.88, -10.2); W3.door.position.set(0.85, 0, 0); W3.doorPivot.add(W3.door); world3.add(W3.doorPivot)
  frame.receiveShadow = true

  // レジ台（客側）とベルトコンベア
  const ctrMat = std(0xf3efe6, { roughness: 0.4 }), ctrSide = std(0x2a9d6f, { roughness: 0.5 })
  const ctr = mesh(new THREE.BoxGeometry(7.2, CTR.y - CUST_Y, CTR.front - CTR.back), [ctrSide, ctrSide, ctrMat, ctrMat, ctrSide, ctrSide], 0, (CTR.y + CUST_Y) / 2, (CTR.front + CTR.back) / 2, world3)
  ctr.receiveShadow = true; ctr.castShadow = true
  W3.belt = canvasTex(256, 64, (x, w, h) => { x.fillStyle = '#2b2d30'; x.fillRect(0, 0, w, h); x.fillStyle = '#3a3d41'; for (let i = 0; i < 8; i++) x.fillRect(i * 32, 0, 14, h) }, { rep: [6, 1] })
  const belt = mesh(new THREE.PlaneGeometry(6.8, 1.0), std(0xffffff, { map: W3.belt, roughness: 0.8 }), 0, CTR.y + 0.005, (CTR.front + CTR.back) / 2, world3); belt.rotation.x = -Math.PI / 2; belt.receiveShadow = true
  // レジの機械
  const reg = new THREE.Group(); reg.position.set(3.3, CTR.y, -2.2); world3.add(reg)
  mesh(new THREE.BoxGeometry(0.9, 0.5, 0.7), std(0x3d4148, { roughness: 0.4 }), 0, 0.25, 0, reg)
  const scr = mesh(new THREE.BoxGeometry(0.8, 0.55, 0.06), std(0x1d1f22), 0, 0.85, -0.1, reg); scr.rotation.x = -0.25
  mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshBasicMaterial({ map: canvasTex(128, 80, (x, w, h) => { x.fillStyle = '#0f3b2a'; x.fillRect(0, 0, w, h); x.fillStyle = '#7dffb0'; x.font = `900 26px monospace`; x.fillText('¥1,280', 10, 50) }) }), 0, 0.85, -0.065, reg).rotation.x = -0.25
  castShadow(reg)
  // 袋詰め台（手前）
  const tt = surfaceTex({ w: 256, h: 256, base: '#c9a27a', noise: 0.05, grime: 0.05, draw: (x, w, h, r) => { x.strokeStyle = 'rgba(110,70,40,.22)'; x.lineWidth = 2; for (let i = 0; i < 18; i++) { x.beginPath(); const y = r() * h; x.moveTo(0, y); x.bezierCurveTo(w * .3, y + 8, w * .6, y - 8, w, y + 3); x.stroke() } } })
  const table = mesh(new THREE.BoxGeometry(TABLE * 2, 0.3, 2.4), std(0xffffff, { map: tt, roughness: 0.55 }), 0, -0.15, 0.1, world3); table.receiveShadow = true
  mesh(new THREE.BoxGeometry(TABLE * 2 - 0.2, 4, 0.12), std(0xb7b0a2), 0, -2.3, 1.2, world3)
  addCornerAO(world3, { minX: -TABLE, maxX: TABLE, minZ: -1.0, maxZ: 1.3, y: 0, width: 0.25, strength: 0.18, sides: 'B', walls: false })
}
function W3() {}

// ---------- エコバッグ
const BAG_COLS = [['#d9b25f', '#8a6a2a'], ['#6f9e7a', '#2f5c3a'], ['#c76b5e', '#7a2e25'], ['#5f86b5', '#2a4a75'], ['#e6dccb', '#8a7d64']]
function bagTex(ci, logo) {
  const [a, b] = BAG_COLS[ci % BAG_COLS.length]
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = a; x.fillRect(0, 0, w, h)
    x.globalAlpha = 0.18; x.strokeStyle = b; x.lineWidth = 1; for (let i = 0; i < w; i += 4) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke() }
    if (!logo) return
    x.globalAlpha = 0.9; x.strokeStyle = b; x.lineWidth = 6; x.beginPath(); x.ellipse(w / 2, h * 0.5, 34, 22, -0.6, 0, 7); x.stroke(); x.beginPath(); x.moveTo(w / 2 - 26, h * 0.5 + 18); x.lineTo(w / 2 + 26, h * 0.5 - 18); x.stroke()
    x.globalAlpha = 1; x.fillStyle = b; x.font = `900 22px ${FONT}`; x.textAlign = 'center'; x.fillText('MY BAG', w / 2, h * 0.78)
  })
}
function makeBag(ci) {
  const g = new THREE.Group(), tex = bagTex(ci, false), m = std(0xffffff, { map: tex, roughness: 0.9, side: THREE.DoubleSide })
  const front = std(0xffffff, { map: bagTex(ci, true), roughness: 0.9, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide })
  const h = BH, t = 0.04
  mesh(new THREE.BoxGeometry(BW + 0.16, t, BD), m, 0, t / 2, 0, g)
  mesh(new THREE.BoxGeometry(BW + 0.16, h, t), m, 0, h / 2, -BD / 2, g)
  for (const s of [-1, 1]) { const sd = mesh(new THREE.BoxGeometry(t, h, BD), m, s * (BW / 2 + 0.06), h / 2, 0, g) }
  const fr = mesh(new THREE.PlaneGeometry(BW + 0.16, h), front, 0, h / 2, BD / 2, g); fr.renderOrder = 3; fr.castShadow = false
  // 前の縁だけ不透明の帯（袋の口に見せる）
  mesh(new THREE.BoxGeometry(BW + 0.16, 0.16, 0.03), m, 0, h - 0.08, BD / 2, g)
  const hm = std(BAG_COLS[ci % BAG_COLS.length][1], { roughness: 0.8 })
  for (const z of [-BD / 2, BD / 2]) { const hd = mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 20, Math.PI), hm, 0, h, z, g) }
  castShadow(g); fr.castShadow = false; receiveShadow(g)
  return g
}

// ---------- 商品の見た目
const MAT = {}
function m1(key, f) { return MAT[key] || (MAT[key] = f()) }
const clearMat = () => m1('clear', () => std(0xe8f4ff, { roughness: 0.1, transparent: true, opacity: 0.38, depthWrite: false }))
function boxWithLabel(w, h, d, tex, color, o = {}) {
  const side = std(color, { roughness: o.rough ?? 0.5 }), face = std(0xffffff, { map: tex, roughness: o.rough ?? 0.5 })
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, o.top ? face : side, side, face, side])
}
function makeItemMesh(kind) {
  const it = IT[kind], g = new THREE.Group(), parts = {}
  const w = it.w, h = it.h, d = it.d, r = it.r
  switch (kind) {
    case 'egg': {
      const tray = mesh(new THREE.BoxGeometry(w, h * 0.45, d), std(0xd8d2c4, { roughness: 0.7 }), 0, -h * 0.27, 0, g)
      const lab = canvasTex(256, 64, (x, W, H) => label(x, W, H, { bg: '#fff3c4', fg: '#9d4b00', text: 'たまご 6コ', size: 34, ty: 0.55, draw: (x) => { x.fillStyle = '#f4a261'; x.fillRect(0, 0, W, 10) } }))
      const band = mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.32), std(0xffffff, { map: lab }), 0, -h * 0.25, d / 2 + 0.006, g)
      parts.eggs = []
      const eg = new THREE.SphereGeometry(0.13, 16, 12)
      for (let i = 0; i < 6; i++) {
        const e = mesh(eg, m1('egg', () => std(0xf6ead2, { roughness: 0.45 })), -0.32 + (i % 3) * 0.32, 0.02, i < 3 ? -0.14 : 0.14, g); e.scale.set(1, 1.15, 1)
        parts.eggs.push(e)
      }
      const dome = mesh(new THREE.BoxGeometry(w * 0.98, h * 0.6, d * 0.98), clearMat(), 0, h * 0.18, 0, g); dome.castShadow = false
      break
    }
    case 'tofu': {
      mesh(new THREE.BoxGeometry(w, h, d), clearMat(), 0, 0, 0, g).castShadow = false
      parts.water = mesh(new THREE.BoxGeometry(w * 0.94, h * 0.86, d * 0.94), std(0x9fd3f0, { roughness: 0.05, transparent: true, opacity: 0.5, depthWrite: false }), 0, -h * 0.05, 0, g)
      parts.block = mesh(new THREE.BoxGeometry(w * 0.82, h * 0.72, d * 0.8), std(0xfbf8ef, { roughness: 0.8 }), 0, -h * 0.06, 0, g)
      const film = canvasTex(256, 128, (x, W, H) => label(x, W, H, { bg: 'rgba(255,255,255,0)', fg: '#1d4f91', text: 'もめん', size: 44, ty: 0.5, draw: (x) => { x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.ellipse(W / 2, H / 2, W * .36, H * .36, 0, 0, 7); x.fill() } }))
      const f = mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.8), new THREE.MeshStandardMaterial({ map: film, transparent: true, roughness: 0.4 }), 0, 0, d / 2 + 0.006, g); f.castShadow = false
      break
    }
    case 'gyoza': case 'icebox': {
      const isG = kind === 'gyoza'
      const tex = canvasTex(256, 96, (x, W, H) => label(x, W, H, { bg: isG ? '#1e5aa8' : '#f1f6ff', fg: isG ? '#fff' : '#1e5aa8', text: isG ? '冷凍ぎょうざ' : 'バニラアイス', size: 30, ty: 0.42, sub: isG ? '12コ入' : '6本入', subSize: 18, sy: 0.78, subFg: isG ? '#ffd23f' : '#e63946',
        draw: (x) => { if (isG) { x.fillStyle = '#f2d39b'; for (let i = 0; i < 4; i++) { x.beginPath(); x.ellipse(40 + i * 58, 74, 24, 13, 0, Math.PI, 0); x.fill() } } else { x.fillStyle = '#ffe9a8'; x.fillRect(150, 52, 70, 34) } } }))
      parts.body = boxWithLabel(w, h, d, tex, isG ? 0x1e5aa8 : 0xf1f6ff, { top: true, rough: 0.35 }); g.add(parts.body)
      // 霜（白い膜）と汗のしずく
      parts.frost = mesh(new THREE.BoxGeometry(w * 1.01, h * 1.01, d * 1.01), std(0xffffff, { transparent: true, opacity: 0.35, roughness: 1, depthWrite: false }), 0, 0, 0, g); parts.frost.castShadow = false
      parts.drops = []
      const dg = new THREE.SphereGeometry(0.035, 8, 6), dm = m1('drop', () => std(0x9fdcff, { roughness: 0.05, transparent: true, opacity: 0.85 }))
      for (let i = 0; i < 9; i++) { const dd = mesh(dg, dm, (i / 8 - 0.5) * w * 0.9, (((i * 37) % 10) / 10 - 0.5) * h * 0.8, d / 2 + 0.02, g); dd.scale.set(1, 1.5, 1); dd.visible = false; dd.userData.y0 = dd.position.y; parts.drops.push(dd) }
      break
    }
    case 'milk': {
      const bh = h * 0.8, tex = canvasTex(128, 256, (x, W, H) => { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#1d6fb8'; x.fillRect(0, H * 0.62, W, H * 0.38); x.fillStyle = '#1d1a16'; for (const [cx, cy, rr] of [[30, 40, 14], [90, 70, 18], [50, 110, 10]]) { x.beginPath(); x.ellipse(cx, cy, rr, rr * 0.7, 0.4, 0, 7); x.fill() } x.fillStyle = '#1d6fb8'; x.font = `900 40px ${FONT}`; x.textAlign = 'center'; x.fillText('牛乳', W / 2, H * 0.55); x.fillStyle = '#fff'; x.font = `900 20px ${FONT}`; x.fillText('1000ml', W / 2, H * 0.82) })
      const b = boxWithLabel(w, bh, d, tex, 0xffffff, { rough: 0.6 }); b.position.y = -h / 2 + bh / 2; g.add(b)
      const roof = mesh(new THREE.CylinderGeometry(0.0001, w * 0.72, h * 0.2, 4, 1), std(0x1d6fb8, { roughness: 0.6 }), 0, h / 2 - h * 0.1, 0, g); roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.98)
      break
    }
    case 'bottle': case 'can': {
      const isB = kind === 'bottle'
      const tex = canvasTex(256, 64, (x, W, H) => label(x, W, H, isB ? { bg: '#1b8fc9', fg: '#fff', text: '天然水 2L', size: 30, ty: 0.52, draw: (x) => { x.fillStyle = '#7fd0ff'; x.beginPath(); x.moveTo(0, 50); for (let i = 0; i <= 8; i++) x.lineTo(i * 32, 44 + (i % 2) * 8); x.lineTo(W, H); x.lineTo(0, H); x.fill() } } : { bg: '#e9c46a', fg: '#7a2e00', text: 'ツナ', size: 34, ty: 0.55, draw: (x) => { x.fillStyle = '#f4a261'; x.fillRect(0, 0, W, 12); x.fillRect(0, H - 12, W, 12) } }), {})
      const rr = w / 2
      if (isB) {
        const body = mesh(new THREE.CylinderGeometry(rr, rr, h * 0.72, 20), std(0xbfe6ff, { roughness: 0.08, transparent: true, opacity: 0.55, depthWrite: false }), 0, -h * 0.12, 0, g); body.castShadow = true
        mesh(new THREE.CylinderGeometry(rr * 0.95, rr * 0.95, h * 0.62, 20), std(0x9ad4f5, { roughness: 0.1, transparent: true, opacity: 0.45, depthWrite: false }), 0, -h * 0.15, 0, g)
        const lab = mesh(new THREE.CylinderGeometry(rr * 1.01, rr * 1.01, h * 0.26, 20, 1, true), std(0xffffff, { map: tex }), 0, -h * 0.1, 0, g); lab.rotation.y = -Math.PI / 2
        mesh(new THREE.CylinderGeometry(rr * 0.35, rr, h * 0.16, 20), std(0xbfe6ff, { roughness: 0.08, transparent: true, opacity: 0.6, depthWrite: false }), 0, h * 0.32, 0, g)
        mesh(new THREE.CylinderGeometry(rr * 0.38, rr * 0.38, h * 0.08, 16), std(0x1b8fc9, { roughness: 0.4 }), 0, h * 0.45, 0, g)
      } else {
        mesh(new THREE.CylinderGeometry(rr, rr, h, 20), std(0xc9ced4, { roughness: 0.25, metalness: 0.8 }), 0, 0, 0, g)
        const lab = mesh(new THREE.CylinderGeometry(rr * 1.01, rr * 1.01, h * 0.75, 20, 1, true), std(0xffffff, { map: tex }), 0, 0, 0, g); lab.rotation.y = -Math.PI / 2
      }
      break
    }
    case 'cabbage': case 'melon': case 'bowling': case 'egg1': {
      if (kind === 'cabbage') {
        const ct = surfaceTex({ w: 128, h: 128, base: '#9cc96b', noise: 0.08, grime: 0.05, draw: (x, W, H) => { x.strokeStyle = 'rgba(230,250,200,.7)'; x.lineWidth = 3; for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(W / 2, H); x.quadraticCurveTo(i * W / 8, H / 2, i * W / 8 + 10, 0); x.stroke() } } })
        mesh(new THREE.SphereGeometry(r, 24, 18), std(0xffffff, { map: ct, roughness: 0.7 }), 0, 0, 0, g)
        for (let i = 0; i < 5; i++) { const lf = mesh(new THREE.SphereGeometry(r * 1.04, 16, 10, i * 1.3, 1.6, 0.4, 1.6), std(0x7fb455, { roughness: 0.7, side: THREE.DoubleSide }), 0, 0, 0, g); lf.rotation.z = i * 0.7 }
      } else if (kind === 'melon') {
        const mt = canvasTex(256, 128, (x, W, H) => { x.fillStyle = '#3f8f3a'; x.fillRect(0, 0, W, H); x.fillStyle = '#163d17'; for (let i = 0; i < 12; i++) { x.beginPath(); const cx = i * W / 12; x.moveTo(cx, 0); for (let y = 0; y <= H; y += 8) x.lineTo(cx + Math.sin(y * 0.2 + i) * 5, y); x.lineTo(cx + 9, H); for (let y = H; y >= 0; y -= 8) x.lineTo(cx + 9 + Math.sin(y * 0.2 + i) * 5, y); x.fill() } })
        mesh(new THREE.SphereGeometry(r, 28, 20), std(0xffffff, { map: mt, roughness: 0.35 }), 0, 0, 0, g).scale.set(1, 0.96, 1)
      } else if (kind === 'bowling') {
        mesh(new THREE.SphereGeometry(r, 28, 20), std(0x7b1fa2, { roughness: 0.15, metalness: 0.1 }), 0, 0, 0, g)
        for (const [a, b] of [[-0.25, 0.35], [0.25, 0.35], [0, 0.0]]) { const hole = mesh(new THREE.CircleGeometry(r * 0.13, 12), std(0x111111), Math.sin(a) * r * 0.98, b * r * 0.9, Math.cos(a) * r * 0.9, g); hole.lookAt(hole.position.clone().multiplyScalar(2)) }
      } else {
        mesh(new THREE.SphereGeometry(r, 18, 14), m1('egg', () => std(0xf6ead2, { roughness: 0.45 })), 0, 0, 0, g).scale.set(1, 1.2, 1)
        parts.eggs = [g.children[0]]
      }
      break
    }
    case 'ring': {
      const rt = canvasTex(256, 32, (x, W, H) => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#fff' : '#ff5d8f'; x.fillRect(i * W / 8, 0, W / 8, H) } })
      const tor = mesh(new THREE.TorusGeometry(r * 0.72, r * 0.28, 16, 32), std(0xffffff, { map: rt, roughness: 0.3 }), 0, 0, 0, g)
      tor.rotation.y = 0
      break
    }
    case 'daikon': {
      const dk = mesh(new THREE.CylinderGeometry(h * 0.52, h * 0.22, w * 0.78, 18), std(0xf7f3ea, { roughness: 0.55 }), w * 0.1, 0, 0, g); dk.rotation.z = Math.PI / 2
      const tip = mesh(new THREE.ConeGeometry(h * 0.22, w * 0.12, 12), std(0xf2ecdf), w * 0.55, 0, 0, g); tip.rotation.z = -Math.PI / 2
      const top = mesh(new THREE.CylinderGeometry(h * 0.5, h * 0.52, w * 0.06, 16), std(0xb9d98a), -w * 0.32, 0, 0, g); top.rotation.z = Math.PI / 2
      for (let i = 0; i < 5; i++) { const lf = mesh(new THREE.ConeGeometry(0.07, 0.6, 6), std(0x4f8f2f, { roughness: 0.7 }), -w * 0.42 - 0.12, (i - 2) * 0.06, (i % 2 - 0.5) * 0.12, g); lf.rotation.z = Math.PI / 2 + (i - 2) * 0.25 }
      break
    }
    case 'bread': {
      const bag = clearMat()
      mesh(new THREE.BoxGeometry(w * 0.96, h * 0.62, d * 0.94), std(0xd9a066, { roughness: 0.8 }), 0, -h * 0.17, 0, g)
      const top = mesh(new THREE.CylinderGeometry(h * 0.3, h * 0.3, w * 0.96, 16, 1, false, 0, Math.PI), std(0xc98a4b, { roughness: 0.8 }), 0, h * 0.12, 0, g); top.rotation.z = Math.PI / 2; top.scale.set(1, 1, d / (h * 0.62))
      mesh(new THREE.PlaneGeometry(w * 0.8, h * 0.5), std(0xfff6e8, { roughness: 0.9 }), 0, -h * 0.15, d * 0.47 + 0.004, g)
      const lt = canvasTex(256, 96, (x, W, H) => label(x, W, H, { bg: 'rgba(0,0,0,0)', fg: '#c1121f', text: '食パン', size: 42, ty: 0.5 }))
      mesh(new THREE.PlaneGeometry(w * 0.7, h * 0.36), new THREE.MeshBasicMaterial({ map: lt, transparent: true }), 0, -h * 0.12, d * 0.5 + 0.03, g)
      mesh(new THREE.BoxGeometry(w * 1.02, h * 1.0, d * 1.0), bag, 0, 0, 0, g).castShadow = false
      break
    }
    case 'chips': {
      const ct = canvasTex(128, 160, (x, W, H) => label(x, W, H, { bg: '#ffd23f', fg: '#c1121f', text: 'うすしお', size: 26, ty: 0.3, draw: (x) => { x.fillStyle = '#f4a261'; for (let i = 0; i < 4; i++) { x.beginPath(); x.ellipse(36 + (i % 2) * 52, 92 + Math.floor(i / 2) * 32, 26, 16, i, 0, 7); x.fill() } } }))
      const b = mesh(new THREE.BoxGeometry(w, h, d, 4, 4, 2), std(0xffffff, { map: ct, roughness: 0.25, metalness: 0.2 }), 0, 0, 0, g)
      const pos = b.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), z = pos.getZ(i); const k = 1 - Math.pow(Math.abs(y) / (h / 2), 4); pos.setZ(i, z * (0.3 + 0.9 * k)) } b.geometry.computeVertexNormals()
      break
    }
    case 'banana': {
      for (let i = 0; i < 3; i++) { const b = mesh(new THREE.TorusGeometry(0.6, 0.075, 8, 16, 1.25), std(0xf5d33a, { roughness: 0.5 }), 0, -0.6 + 0.12 + i * 0.03, (i - 1) * 0.12, g); b.rotation.z = Math.PI / 2 - 0.62; b.position.y = -0.48 + i * 0.02 }
      mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), std(0x6b4f2a), -w * 0.47, 0.06, 0, g).rotation.z = 1.2
      break
    }
    case 'tuna': {
      const body = mesh(new THREE.SphereGeometry(0.5, 24, 16), std(0x3a4a66, { roughness: 0.25, metalness: 0.5 }), 0, 0, 0, g); body.scale.set(w * 0.86, h * 0.5 / 0.5, d * 0.5 / 0.5)
      const belly = mesh(new THREE.SphereGeometry(0.5, 24, 16, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), std(0xd9dde3, { roughness: 0.3, metalness: 0.4 }), 0, -0.01, 0, g); belly.scale.copy(body.scale).multiplyScalar(1.01)
      const tail = mesh(new THREE.ConeGeometry(0.22, 0.4, 4), std(0x2c3a52), w * 0.47, 0, 0, g); tail.rotation.z = Math.PI / 2; tail.scale.set(1, 1, 0.25)
      mesh(new THREE.SphereGeometry(0.05, 10, 8), std(0x111111, { roughness: 0.1 }), -w * 0.36, 0.05, d * 0.36, g)
      mesh(new THREE.SphereGeometry(0.07, 10, 8), std(0xffffff, { roughness: 0.1 }), -w * 0.36, 0.05, d * 0.33, g)
      break
    }
    case 'pine': {
      const pt = canvasTex(64, 64, (x, W, H) => { x.fillStyle = '#c98a2b'; x.fillRect(0, 0, W, H); x.strokeStyle = '#7a4a12'; x.lineWidth = 3; for (let i = -64; i < 128; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke() } }, { rep: [3, 2] })
      mesh(new THREE.SphereGeometry(0.5, 20, 14), std(0xffffff, { map: pt, roughness: 0.7 }), 0, -h * 0.15, 0, g).scale.set(w * 0.98, h * 0.66, d * 0.98)
      for (let i = 0; i < 7; i++) { const lf = mesh(new THREE.ConeGeometry(0.06, 0.45, 5), std(0x3f8f3a, { roughness: 0.6 }), 0, h * 0.28, 0, g); lf.rotation.set((i % 3 - 1) * 0.4, i, (i % 2 ? 1 : -1) * 0.25 * (i / 3)) }
      break
    }
    case 'chicken': {
      const yl = m1('chk', () => std(0xf7d73a, { roughness: 0.35 })), rd = m1('chkr', () => std(0xd62828, { roughness: 0.4 })), or = m1('chko', () => std(0xf28c28, { roughness: 0.4 }))
      mesh(new THREE.SphereGeometry(r * 0.82, 18, 14), yl, 0, -r * 0.1, 0, g).scale.set(1.15, 0.92, 0.9)
      mesh(new THREE.SphereGeometry(r * 0.44, 16, 12), yl, -r * 0.62, r * 0.5, 0, g)
      mesh(new THREE.ConeGeometry(r * 0.13, r * 0.34, 8), or, -r * 1.02, r * 0.46, 0, g).rotation.z = Math.PI / 2
      for (const i of [-1, 0, 1]) mesh(new THREE.SphereGeometry(r * 0.12, 10, 8), rd, -r * 0.62 + i * r * 0.14, r * 0.96 - Math.abs(i) * r * 0.06, 0, g)
      mesh(new THREE.SphereGeometry(r * 0.09, 8, 6), m1('blk', () => std(0x111111, { roughness: 0.2 })), -r * 0.8, r * 0.58, r * 0.32, g)
      const tail = mesh(new THREE.ConeGeometry(r * 0.26, r * 0.5, 8), yl, r * 0.9, r * 0.28, 0, g); tail.rotation.z = -0.8
      for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(r * 0.05, r * 0.05, r * 0.28, 6), or, r * 0.1 * s, -r * 0.84, 0, g)
      break
    }
    case 'toilet': {
      const wt = m1('roll', () => std(0xfbfaf4, { roughness: 0.9 })), cd = m1('rollc', () => std(0x8a6a3a, { roughness: 0.9 }))
      for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 3; ix++) { const rr = h / 4.2, cy = mesh(new THREE.CylinderGeometry(rr, rr, d * 0.92, 18), wt, (ix - 1) * w / 3, (iy - 0.5) * h / 2, 0, g); cy.rotation.x = Math.PI / 2; const hole = mesh(new THREE.CircleGeometry(rr * 0.32, 12), cd, (ix - 1) * w / 3, (iy - 0.5) * h / 2, d * 0.46 + 0.005, g); hole.castShadow = false }
      mesh(new THREE.BoxGeometry(w * 1.02, h * 1.02, d * 1.02), clearMat(), 0, 0, 0, g).castShadow = false
      const lt = canvasTex(256, 64, (x, W, H) => label(x, W, H, { bg: '#2f7dd1', fg: '#fff', text: 'ダブル12ロール', size: 26, ty: 0.52 }))
      mesh(new THREE.PlaneGeometry(w * 0.72, h * 0.2), new THREE.MeshBasicMaterial({ map: lt }), 0, 0, d * 0.52 + 0.012, g)
      break
    }
    case 'tanuki': {
      const br = m1('tnk', () => std(0x7a5a3c, { roughness: 0.45 })), lt = m1('tnkl', () => std(0xe3cfa6, { roughness: 0.5 })), hat = m1('tnkh', () => std(0x4a4034, { roughness: 0.55 })), blk = m1('blk', () => std(0x111111, { roughness: 0.2 }))
      mesh(new THREE.SphereGeometry(w * 0.5, 22, 16), br, 0, -h * 0.2, 0, g).scale.set(1, 1.02, 0.86)
      mesh(new THREE.SphereGeometry(w * 0.34, 20, 14), lt, 0, -h * 0.25, w * 0.18, g)
      mesh(new THREE.SphereGeometry(w * 0.34, 20, 14), br, 0, h * 0.2, 0, g)
      mesh(new THREE.SphereGeometry(w * 0.2, 14, 10), lt, 0, h * 0.13, w * 0.2, g)
      for (const s of [-1, 1]) { mesh(new THREE.SphereGeometry(w * 0.07, 10, 8), blk, s * w * 0.12, h * 0.26, w * 0.28, g); mesh(new THREE.SphereGeometry(w * 0.09, 10, 8), br, s * w * 0.25, h * 0.4, 0, g) }
      mesh(new THREE.SphereGeometry(w * 0.05, 8, 6), blk, 0, h * 0.15, w * 0.38, g)
      mesh(new THREE.ConeGeometry(w * 0.46, h * 0.12, 18), hat, 0, h * 0.44, 0, g)
      const bag = mesh(new THREE.BoxGeometry(w * 0.22, h * 0.26, w * 0.1), hat, w * 0.42, -h * 0.08, w * 0.1, g); bag.rotation.z = 0.2
      break
    }
    case 'daruma': {
      const dt = canvasTex(256, 128, (x, W, H) => { x.fillStyle = '#c1121f'; x.fillRect(0, 0, W, H); x.fillStyle = '#fbf3e4'; x.beginPath(); x.ellipse(W * 0.75, H * 0.44, 40, 32, 0, 0, 7); x.fill(); x.fillStyle = '#1d1a16'; x.beginPath(); x.arc(W * 0.75 - 20, H * 0.4, 9, 0, 7); x.fill(); x.lineWidth = 4; x.strokeStyle = '#1d1a16'; x.beginPath(); x.arc(W * 0.75 + 20, H * 0.4, 9, 0, 7); x.stroke(); x.beginPath(); x.moveTo(W * 0.75 - 14, H * 0.62); x.quadraticCurveTo(W * 0.75, H * 0.7, W * 0.75 + 14, H * 0.62); x.stroke() })
      const b = mesh(new THREE.SphereGeometry(r, 26, 20), std(0xffffff, { map: dt, roughness: 0.25 }), 0, 0, 0, g); b.scale.set(1, 1.04, 1); b.rotation.y = -Math.PI * 0.25 - Math.PI / 2
      break
    }
    case 'goldfish': {
      const wm = std(0x9ad7f5, { roughness: 0.05, transparent: true, opacity: 0.5, depthWrite: false })
      parts.water = mesh(new THREE.SphereGeometry(0.5, 22, 16), wm, 0, -h * 0.1, 0, g); parts.water.scale.set(w * 0.98, h * 0.74, d * 0.98)
      const or = m1('gf', () => std(0xf2591f, { roughness: 0.35 }))
      const f = mesh(new THREE.SphereGeometry(0.1, 12, 10), or, 0.02, -h * 0.1, 0.02, g); f.scale.set(1.3, 0.75, 0.6)
      const t = mesh(new THREE.ConeGeometry(0.075, 0.12, 6), or, 0.17, -h * 0.1, 0.02, g); t.rotation.z = Math.PI / 2; t.scale.z = 0.3
      mesh(new THREE.CylinderGeometry(0.05, w * 0.18, h * 0.22, 12), clearMat(), 0, h * 0.34, 0, g).castShadow = false
      mesh(new THREE.TorusGeometry(0.05, 0.016, 6, 12), m1('gfr', () => std(0xd62828)), 0, h * 0.46, 0, g).rotation.x = Math.PI / 2
      break
    }
    case 'rice': {
      const rt = canvasTex(256, 128, (x, W, H) => label(x, W, H, { bg: '#f7f1e3', fg: '#1d1a16', text: 'お米', size: 52, ty: 0.42, sub: '5kg', subSize: 30, sy: 0.8, subFg: '#c1121f', draw: (x) => { x.fillStyle = '#3f8f3a'; x.fillRect(0, 0, 26, H); x.fillRect(W - 26, 0, 26, H) } }))
      const b = boxWithLabel(w, h, d, rt, 0xf7f1e3, { rough: 0.85 }); g.add(b)
      break
    }
  }
  castShadow(g)
  return { g, parts }
}

// ---------- 物理（袋の断面だけを2Dで解く）
let PW, ground, bagBody
function initPhysics() {
  PW = new pl.World({ gravity: pl.Vec2(0, G), allowSleep: false })
  ground = PW.createBody()
  ground.createFixture(pl.Box(TABLE, 0.15, pl.Vec2(0, -0.15), 0), { friction: 0.7 })
  ground.createFixture(pl.Box(12, 0.2, pl.Vec2(0, FLOOR_Y - 0.2), 0), { friction: 0.8 })
  ground.createFixture(pl.Box(0.2, 8, pl.Vec2(-8.5, 2), 0)); ground.createFixture(pl.Box(0.2, 8, pl.Vec2(8.5, 2), 0))
  bagBody = PW.createBody()
  bagBody.createFixture(pl.Box(BW / 2 + WALL, WALL / 2, pl.Vec2(0, WALL / 2 - 0.02), 0), { friction: 0.8 })
  for (const s of [-1, 1]) bagBody.createFixture(pl.Box(WALL / 2, BH / 2, pl.Vec2(s * (BW / 2 + WALL / 2), BH / 2), 0), { friction: 0.5 })
  PW.on('post-solve', onPostSolve)
}
function createBody(it, kind, x, y, a = 0) {
  const def = IT[kind], b = PW.createBody({ type: 'dynamic', position: pl.Vec2(x, y), angle: a, angularDamping: 0.4, linearDamping: 0.05, bullet: true })
  const fo = { density: def.dens, friction: def.fric ?? 0.6, restitution: def.rest ?? 0.08 }
  if (def.shape === 'ball') b.createFixture(pl.Circle(def.r), fo)
  else if (def.shape === 'milk') b.createFixture(pl.Polygon([pl.Vec2(-def.w / 2, -def.h / 2), pl.Vec2(def.w / 2, -def.h / 2), pl.Vec2(def.w / 2, def.h * 0.3), pl.Vec2(0, def.h / 2), pl.Vec2(-def.w / 2, def.h * 0.3)]), fo)
  else b.createFixture(pl.Box(def.w / 2 * (it.sq ? 1.04 : 1), def.h / 2 * (it.sq ? 0.55 : 1)), fo)
  b.setUserData(it); it.body = b
  return b
}
// 接触の衝撃: 卵・柔らかい物の判定に使う
function onPostSolve(contact, imp) {
  const A = contact.getFixtureA().getBody(), B = contact.getFixtureB().getBody()
  const n = imp.normalImpulses, sum = (n[0] || 0) + (n[1] || 0)
  if (sum <= 0) return
  const ia = A.getUserData(), ib = B.getUserData()
  if (((ia && ia.def && ia.def.squeaky) || (ib && ib.def && ib.def.squeaky)) && sum > 0.1 && S.time - (S.lastSq || 0) > 0.18) { S.lastSq = S.time; S.squeakQ = true }
  if (sum > 0.9 && S.time - S.lastThud > 0.09) { S.lastThud = S.time; S.thudQ = Math.max(S.thudQ || 0, sum) }
  for (const [me, other, ob] of [[ia, ib, B], [ib, ia, A]]) {
    if (!me || !me.kind) continue
    const above = ob.getPosition().y > me.body.getPosition().y + 0.05 && other && other.kind
    if (above) me.loadNow += sum
    if (above && sum > me.hitMax) me.hitMax = sum
    if (!above && sum > me.selfHit) me.selfHit = sum
  }
}

// ---------- キャラ（Kenney Mini Characters, CC0）
const CHAR_FILES = ['female-b', 'male-a', 'female-c', 'male-b', 'female-f', 'male-f']
const MODELS = {}
let charsReady = false
const loader = new GLTFLoader()
function loadChars() {
  const all = [...CHAR_FILES, 'male-d']
  return Promise.all(all.map(n => new Promise(res => loader.load(`chars/character-${n}.glb`, g => { MODELS[n] = g; res() }, undefined, () => res())))).then(() => { charsReady = true })
}
// ---------- 客の顔（Kenney の顔はテクスチャ固定なので、目と口の面を肌色に塗り替えて、頭の骨に顔の板を貼る）
const FACE_INK = '#34343c'
function faceTex(expr) {
  return _tex['face-' + expr] || (_tex['face-' + expr] = canvasTex(256, 256, (x) => {
    x.fillStyle = FACE_INK; x.strokeStyle = FACE_INK; x.lineCap = 'round'; x.lineJoin = 'round'
    const poly = (...p) => { x.beginPath(); x.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) x.lineTo(p[i], p[i + 1]); x.closePath(); x.fill() }
    const both = (f) => { f(1); x.save(); x.translate(256, 0); x.scale(-1, 1); f(-1); x.restore() }
    const white = (cx, cy, rx, ry) => { x.fillStyle = '#fff'; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 7); x.fill(); x.fillStyle = FACE_INK }
    const cheeks = (a) => { x.fillStyle = `rgba(230,60,50,${a})`; both(() => { x.beginPath(); x.ellipse(42, 158, 28, 18, 0, 0, 7); x.fill() }); x.fillStyle = FACE_INK }
    switch (expr) {
      case 'calm': both(() => { x.beginPath(); x.ellipse(82, 100, 15, 21, 0, 0, 7); x.fill() }); x.lineWidth = 11; x.beginPath(); x.moveTo(100, 172); x.quadraticCurveTo(128, 190, 156, 172); x.stroke(); break
      case 'blink': x.lineWidth = 11; both(() => { x.beginPath(); x.moveTo(64, 102); x.lineTo(100, 102); x.stroke() }); x.beginPath(); x.moveTo(100, 172); x.quadraticCurveTo(128, 190, 156, 172); x.stroke(); break
      case 'annoyed': both(() => { poly(58, 92, 106, 92, 106, 118, 58, 118); x.lineWidth = 9; x.beginPath(); x.moveTo(54, 74); x.lineTo(110, 78); x.stroke() }); x.lineWidth = 11; x.beginPath(); x.moveTo(102, 178); x.lineTo(154, 172); x.stroke(); break
      case 'angry': both(() => { poly(60, 98, 108, 112, 100, 130, 62, 124); x.lineWidth = 15; x.beginPath(); x.moveTo(50, 62); x.lineTo(112, 92); x.stroke() }); x.lineWidth = 12; x.beginPath(); x.moveTo(96, 186); x.quadraticCurveTo(128, 158, 160, 186); x.stroke(); cheeks(0.28); break
      case 'fury': cheeks(0.6); both(() => { white(80, 112, 28, 28); x.beginPath(); x.ellipse(88, 116, 9, 9, 0, 0, 7); x.fill(); x.lineWidth = 19; x.beginPath(); x.moveTo(42, 56); x.lineTo(116, 94); x.stroke() }); poly(78, 156, 178, 156, 186, 218, 70, 218); x.fillStyle = '#fff'; x.fillRect(86, 162, 84, 18); x.fillStyle = '#d9534f'; x.beginPath(); x.ellipse(128, 206, 34, 12, 0, 0, 7); x.fill(); break
      case 'shock': both(() => { white(82, 104, 28, 34); x.beginPath(); x.ellipse(82, 106, 8, 8, 0, 0, 7); x.fill(); x.lineWidth = 9; x.beginPath(); x.moveTo(52, 50); x.quadraticCurveTo(82, 34, 110, 52); x.stroke() }); x.beginPath(); x.ellipse(128, 188, 18, 26, 0, 0, 7); x.fill(); break
      case 'happy': x.lineWidth = 13; both(() => { x.beginPath(); x.moveTo(58, 110); x.quadraticCurveTo(82, 74, 106, 110); x.stroke() }); poly(88, 158, 168, 158, 150, 204, 106, 204); x.fillStyle = '#d9534f'; x.beginPath(); x.ellipse(128, 192, 16, 9, 0, 0, 7); x.fill(); cheeks(0.25); break
      case 'stern': both(() => { poly(62, 92, 104, 104, 100, 122, 62, 120); x.lineWidth = 15; x.beginPath(); x.moveTo(52, 70); x.lineTo(112, 86); x.stroke() }); x.lineWidth = 12; x.beginPath(); x.moveTo(100, 178); x.lineTo(156, 178); x.stroke(); break
    }
  }))
}
const FACE_DY = { 'male-a': -0.1 }   // 白い丸メガネの中に目が来るように下げる
function modelName(model) { return Object.keys(MODELS).find(k => MODELS[k] === model) }
// 目と口の濃い面の UV を、同じ高さの肌の UV に差し替える（モデルごとに1回）。顔の枠を返す
function blankFace(model) {
  if (model.userData.face !== undefined) return model.userData.face
  let hm = null; model.scene.traverse(o => { if (o.name === 'head-mesh') hm = o })
  model.userData.face = null; if (!hm) return null
  const g = hm.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index, img = hm.material.map.image
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0); const d = cx.getImageData(0, 0, img.width, img.height).data
  // 目と口は全モデル同じ1色 (63,63,70)。髪のグレーはグラデーションなので混ざらない
  const dark = (i) => { const px = Math.min(img.width - 1, Math.floor(uv.getX(i) * img.width)), py = Math.min(img.height - 1, Math.floor(uv.getY(i) * img.height)), k = (py * img.width + px) * 4; return Math.abs(d[k] - 63) < 3 && Math.abs(d[k + 1] - 63) < 3 && Math.abs(d[k + 2] - 70) < 3 }
  const eyes = new Set(); let z0 = 0
  for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); if (dark(a) && dark(b) && dark(c) && Math.min(pos.getZ(a), pos.getZ(b), pos.getZ(c)) > 0.08) { eyes.add(a); eyes.add(b); eyes.add(c); z0 = Math.max(z0, pos.getZ(a)) } }
  if (!eyes.size) return null
  // 同じ面の上に描いてあるアイシャドウなども一緒に消す
  for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); if (Math.abs(pos.getZ(a) - z0) < 0.0015 && Math.abs(pos.getZ(b) - z0) < 0.0015 && Math.abs(pos.getZ(c) - z0) < 0.0015) { eyes.add(a); eyes.add(b); eyes.add(c) } }
  let x0 = 9, x1 = -9, y0 = 9, y1 = -9
  for (const i of eyes) { x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i)); y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i)) }
  const fy = (y0 + y1) / 2 + (FACE_DY[model.scene.children[0] && modelName(model)] || 0)
  // 顔の面の肌の色: 目のすぐ後ろで、目の中心を含む面
  let skin = null, best = -9
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); if (eyes.has(a)) continue
    const ys = [pos.getY(a), pos.getY(b), pos.getY(c)], xs = [pos.getX(a), pos.getX(b), pos.getX(c)], z = Math.max(pos.getZ(a), pos.getZ(b), pos.getZ(c))
    if (Math.min(...ys) > fy || Math.max(...ys) < fy || Math.min(...xs) > 0 || Math.max(...xs) < 0 || z > z0 + 0.001 || z < best) continue
    best = z; skin = [uv.getX(a), uv.getY(a)]
  }
  if (skin) { for (const i of eyes) uv.setXY(i, skin[0], skin[1]); uv.needsUpdate = true }
  const skel = hm.skeleton, bi = skel ? skel.bones.findIndex(b => b.name === 'head') : -1
  model.userData.face = { p: new THREE.Vector3(0, fy, z0 + 0.004), w: 0.34, bind: bi >= 0 ? skel.boneInverses[bi].clone() : null }
  return model.userData.face
}
function setFace(c, expr) { if (!c.face || c.expr === expr) return; c.expr = expr; c.face.material.map = faceTex(expr) }
function moodExpr(c, m, dt) {
  if ((c.shockT || 0) > 0) { c.shockT -= dt; return 'shock' }
  if (m > 0.82) return 'fury'; if (m > 0.55) return 'angry'; if (m > 0.3) return 'annoyed'
  c.blinkT = (c.blinkT ?? 1 + Math.random() * 3) - dt; if (c.blinkT < 0) { if (c.blinkT < -0.12) c.blinkT = 2 + Math.random() * 3; return 'blink' }
  return 'calm'
}
function makeChar(name) {
  const src = MODELS[name]; if (!src) return null
  const fb = blankFace(src)
  const root = skClone(src.scene), g = new THREE.Group(); g.add(root)
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); o.material.roughness = 0.75 } })
  const box = new THREE.Box3().setFromObject(root), hgt = box.max.y - box.min.y
  g.scale.setScalar(CUST_H / hgt); g.userData.s0 = CUST_H / hgt
  const mats = []; root.traverse(o => { if (o.isMesh) mats.push(o.material) })
  const mixer = new THREE.AnimationMixer(root), acts = {}
  for (const c of src.animations) acts[c.name] = mixer.clipAction(c)
  const head = root.getObjectByName('head')
  const c = { g, mixer, acts, cur: null, head, name, mood: 0, bubT: 0, tapT: 0, mats, dim: 0 }
  if (fb && head) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(fb.w, fb.w), new THREE.MeshBasicMaterial({ map: faceTex('calm'), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }))
    if (fb.bind) m.position.copy(fb.p).applyMatrix4(fb.bind); else { m.position.copy(fb.p); m.position.y -= head.position.y }
    m.renderOrder = 2; head.add(m); c.face = m; c.expr = 'calm'
  }
  // 怒りマーク・汗
  c.anger = new THREE.Sprite(new THREE.SpriteMaterial({ map: angerTex(), transparent: true, depthTest: false, toneMapped: false })); c.anger.scale.setScalar(0.7); c.anger.visible = false; c.anger.renderOrder = 9; scene.add(c.anger)
  c.sweat = new THREE.Sprite(new THREE.SpriteMaterial({ map: sweatTex(), transparent: true, depthTest: false, toneMapped: false })); c.sweat.scale.setScalar(0.45); c.sweat.visible = false; c.sweat.renderOrder = 9; scene.add(c.sweat)
  c.puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex(), transparent: true, depthTest: false, toneMapped: false, opacity: 0 })); c.puff.scale.setScalar(0.8); c.puff.renderOrder = 9; scene.add(c.puff)
  scene.add(g); c.blob = addBlobShadow(g, 2.2, { floorY: CUST_Y, opacity: 0.35, parent: scene }); play(c, 'idle')
  return c
}
function play(c, name, fade = 0.2, speed = 1) {
  const a = c.acts[name]; if (!a) return
  a.timeScale = speed
  if (c.cur === name) return
  const prev = c.cur ? c.acts[c.cur] : null
  a.reset().play(); if (prev) a.crossFadeFrom(prev, fade, false)
  c.cur = name
}
function freeChar(c) { c.g.removeFromParent(); c.anger.removeFromParent(); c.sweat.removeFromParent(); c.puff.removeFromParent(); if (c.blob) c.blob.removeFromParent(); if (c.bub) { c.bub.remove(); c.bub = null } }
const _tex = {}
function angerTex() { return _tex.anger || (_tex.anger = canvasTex(64, 64, (x) => { x.strokeStyle = '#e63946'; x.lineWidth = 7; x.lineCap = 'round'; for (const [a, b, c2, d] of [[14, 22, 26, 26], [22, 14, 26, 26], [50, 22, 38, 26], [42, 14, 38, 26], [14, 42, 26, 38], [22, 50, 26, 38], [50, 42, 38, 38], [42, 50, 38, 38]]) { x.beginPath(); x.moveTo(a, b); x.quadraticCurveTo(c2, d, c2, d); x.stroke() } })) }
function sweatTex() { return _tex.sweat || (_tex.sweat = canvasTex(64, 64, (x) => { x.fillStyle = '#8fd3ff'; x.strokeStyle = '#1d1a16'; x.lineWidth = 3; x.beginPath(); x.moveTo(32, 6); x.quadraticCurveTo(54, 40, 32, 58); x.quadraticCurveTo(10, 40, 32, 6); x.fill(); x.stroke() })) }
function puffTex() { return _tex.puff || (_tex.puff = canvasTex(64, 64, (x) => { x.fillStyle = 'rgba(255,255,255,.95)'; for (const [cx, cy, r] of [[22, 34, 14], [36, 28, 16], [46, 38, 12], [30, 42, 12]]) { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill() } })) }

// ---------- 店長
const MGR = { c: null, stage: 0, pos: new THREE.Vector3(...[MGR_POS[0][0], CUST_Y, MGR_POS[0][1]]), face: null }
function setupManager() {
  MGR.c = makeChar('male-d'); if (!MGR.c) return
  MGR.c.g.position.copy(MGR.pos); MGR.c.g.visible = false
  MGR.c.g.scale.multiplyScalar(1.06)
}

// ---------- 文字の演出（DOM）
const FX = []
const _w = new THREE.Vector3()
function toScreen(p) { _w.copy(p).project(camera); return { x: (_w.x + 1) / 2 * innerWidth, y: (1 - _w.y) / 2 * innerHeight } }
// 同時に出す文字は2つまで（古い物から消す）
function trimFx() { while (FX.length >= 2) { const f = FX.shift(); f.el.remove(); if (f.c && f.c.bub === f.el) f.c.bub = null } }
function ono(text, pos, cls = '', o = {}) {
  trimFx()
  const el = document.createElement('div'); el.className = 'ono ' + cls; el.textContent = text
  el.style.fontSize = (o.size ?? 30) + 'px'; $('#fx').appendChild(el)
  FX.push({ el, pos: pos.clone(), t: 0, life: o.life ?? 1.1, rise: o.rise ?? 0.8, kind: 'ono', rot: (Math.random() - 0.5) * 16 })
}
function bubble(c, text, cls = '', life = 1.6) {
  if (c.bub) { c.bub.remove(); const i = FX.findIndex(f => f.el === c.bub); if (i >= 0) FX.splice(i, 1); c.bub = null }
  trimFx()
  const el = document.createElement('div'); el.className = 'sb ' + cls; el.textContent = text; $('#fx').appendChild(el)
  c.bub = el; FX.push({ el, c, t: 0, life, kind: 'sb' })
}
function clearFx() { for (const f of FX) f.el.remove(); FX.length = 0; for (const c of S.cust) c.bub = null; if (MGR.c) MGR.c.bub = null }
const _hp = new THREE.Vector3()
function headPos(c, out) { if (c.head) c.head.getWorldPosition(out); else out.copy(c.g.position).setY(CUST_Y + CUST_H); return out.add(_q.set(0, 0.95, 0)) }
const _q = new THREE.Vector3()
function updateFx(dt) {
  for (let i = FX.length - 1; i >= 0; i--) {
    const f = FX[i]; f.t += dt
    if (f.t >= f.life || (f.c && !f.c.g.parent)) { f.el.remove(); FX.splice(i, 1); if (f.c && f.c.bub === f.el) f.c.bub = null; continue }
    const k = f.t / f.life
    if (f.kind === 'ono') {
      const s = toScreen(_w.copy(f.pos).add(_q.set(0, f.rise * ease(k * 2), 0)))
      const sc = k < 0.12 ? 0.4 + k / 0.12 * 0.8 : 1.2 - Math.min(0.2, (k - 0.12) * 2)
      const w = f.el.offsetWidth, x = clamp(s.x, w / 2 + 8, innerWidth - w / 2 - 8)
      f.el.style.transform = `translate(${x - w / 2}px,${s.y - 20}px) rotate(${f.rot}deg) scale(${sc})`; f.el.style.opacity = k > 0.75 ? (1 - k) / 0.25 : 1
    } else {
      const s = toScreen(headPos(f.c, _hp)), w = f.el.offsetWidth, h = f.el.offsetHeight
      const x = clamp(s.x - w / 2, 8, innerWidth - w - 8), y = clamp(s.y - h - 8, 52, innerHeight - h - 8)
      const sc = f.t < 0.12 ? 0.5 + f.t / 0.12 * 0.5 : 1
      const jig = f.el.classList.contains('hot') ? Math.sin(S.time * 60) * 2 : 0
      f.el.style.transform = `translate(${x + jig}px,${y}px) scale(${sc})`; f.el.style.opacity = k > 0.85 ? (1 - k) / 0.15 : 1
    }
  }
}

// ---------- 店員の手（CC0 の手の素材が無いので Kenney の人物と同じ質感で作る。袋の口を持っていて、つかむと近い方が取りに行く）
const HANDS = []
function makeHand(sx) {
  const skin = m1('hand', () => std(0xf0c7a0, { roughness: 0.62 })), sleeve = m1('slv', () => std(0x2a9d6f, { roughness: 0.75 })), cuff = m1('cuff', () => std(0xf3efe6, { roughness: 0.7 }))
  const h = { sx, g: new THREE.Group(), arm: new THREE.Group(), fingers: [], thumb: null, pos: new THREE.Vector3(sx * (BW / 2 + 0.06), BH - 0.1, BD / 2 + 0.06), grip: 0 }
  const palm = mesh(new THREE.CapsuleGeometry(0.135, 0.11, 4, 10), skin, 0, 0.1, 0, h.g); palm.scale.set(1.2, 1, 0.55)
  for (let i = 0; i < 4; i++) {
    const piv = new THREE.Group(); piv.position.set((i - 1.5) * 0.078, 0.25, 0); h.g.add(piv)
    const a = mesh(new THREE.CapsuleGeometry(0.036, 0.1 - Math.abs(i - 1.5) * 0.012, 3, 8), skin, 0, 0.075, 0, piv)
    const j = new THREE.Group(); j.position.y = 0.14; piv.add(j); mesh(new THREE.CapsuleGeometry(0.033, 0.06, 3, 8), skin, 0, 0.05, 0, j)
    h.fingers.push({ piv, j }); a.castShadow = false
  }
  const tp = new THREE.Group(); tp.position.set(-sx * 0.15, 0.08, 0.03); tp.rotation.z = sx * 0.9; h.g.add(tp)
  mesh(new THREE.CapsuleGeometry(0.044, 0.11, 3, 8), skin, 0, 0.09, 0, tp); h.thumb = tp
  const c = mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.1, 14), cuff, 0, -0.08, 0, h.g); c.scale.z = 0.72
  const fore = mesh(new THREE.CylinderGeometry(1, 1, 1, 14), sleeve, 0, 0, 0, h.arm); h.fore = fore
  scene.add(h.g); scene.add(h.arm)
  h.g.traverse(o => { o.castShadow = false }); fore.castShadow = false
  HANDS.push(h)
  return h
}
makeHand(1); makeHand(-1)
const _hd = new THREE.Vector3(), _hy = new THREE.Vector3(0, 1, 0), _ht = new THREE.Vector3(), _ha = new THREE.Vector3()
function updateHands(dt) {
  const vis = S.mode !== 'result'; for (const h of HANDS) { h.g.visible = vis; h.arm.visible = vis } if (!vis) return
  const held = S.held ? S.held.it : null
  const nearer = held ? (held.g.position.x >= 0 ? 1 : -1) : 0
  for (const h of HANDS) {
    const grab = held && nearer === h.sx
    if (grab) {
      // 商品の横をつかむ（商品を隠さない）
      const halfW = (held.def.w ?? held.def.r * 2) * held.scale / 2
      _ht.copy(held.g.position).add(_q.set(h.sx * (halfW + 0.2), -0.12, 0.14))
    } else _ht.set(h.sx * (BW / 2 + 0.1), BH - 0.14, BD / 2 + 0.08)
    h.pos.lerp(_ht, Math.min(1, dt * (grab ? 22 : 9)))
    h.grip = lerp(h.grip, grab ? 1 : 0.55, Math.min(1, dt * 14))
    // 腕は画面の外（手前の横）から伸びる
    _ha.set(h.sx * 4.2, h.pos.y - 1.1, h.pos.z + 2.2)
    _hd.copy(h.pos).sub(_ha); const len = _hd.length(); _hd.normalize()
    h.g.position.copy(h.pos); h.g.quaternion.setFromUnitVectors(_hy, _hd)
    h.arm.position.copy(_ha).addScaledVector(_hd, len / 2 - 0.06)
    h.arm.quaternion.copy(h.g.quaternion); h.fore.scale.set(0.15, len - 0.1, 0.12)
    for (const f of h.fingers) { f.piv.rotation.x = 0.35 + h.grip * 0.75; f.j.rotation.x = 0.3 + h.grip * 0.9 }
  }
}

// ---------- 商品のやりとり
let itemId = 0
function newItem(kind) {
  const def = IT[kind], { g, parts } = makeItemMesh(kind)
  const it = { id: ++itemId, kind, def, g, parts, body: null, state: 'counter', slot: -1, scale: 0.6, z: CTR.z, owner: S.front,
    broken: 0, spilled: 0, spillAcc: 0, sq: false, sqAcc: 0, melt: 0, melted: false, loadNow: 0, hitMax: 0, selfHit: 0, crackAcc: 0, popT: 0, age: 0, floorT: 0 }
  scene.add(g)
  return it
}
const nSlots = () => camera.aspect < 0.8 ? 4 : 5
function slotX(i) { const n = nSlots(), sp = n === 4 ? 0.98 : 1.15; return (Math.min(i, n - 1) - (n - 1) / 2) * sp }
function counterScale(it) { const big = Math.max(it.def.w ?? it.def.r * 2, it.def.h ?? it.def.r * 2); return Math.min(0.85, (nSlots() === 4 ? 0.95 : 1.1) / big) }
function freeSlot() { for (let i = 0; i < nSlots(); i++) if (!S.counter.some(it => it.slot === i)) return i; return -1 }
function spawnToCounter(kind) {
  const i = freeSlot(); if (i < 0) return false
  const it = newItem(kind); it.slot = i; it.popT = 0.001; S.counter.push(it); S.items.push(it)
  Snd.sfx('beep')
  if (it.def.tag === 'egg' && S.tut < 2 && !S.tutEggShown) { S.tutEggShown = true; S.eggHintT = 4 }
  return true
}
function inBag(it) { if (!it.body) return false; const p = it.body.getPosition(); return Math.abs(p.x) < BW / 2 && p.y > -0.1 && p.y < BH + 0.7 }
function itemTop(it) { const p = it.body.getPosition(), a = it.body.getAngle(), d = it.def; if (d.shape === 'ball') return p.y + d.r; const hw = d.w / 2, hh = d.h / 2 * (it.sq ? 0.55 : 1); return p.y + Math.abs(Math.sin(a)) * hw + Math.abs(Math.cos(a)) * hh }

// つかむ（画面の点から一番近い商品）
const ray = new THREE.Raycaster(), _nd = new THREE.Vector2(), plane0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
function ptrWorld(x, y, out = new THREE.Vector3()) { _nd.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(_nd, camera); ray.ray.intersectPlane(plane0, out); return out }
function itemScreenR(it) { const big = Math.max(it.def.w ?? it.def.r * 2, it.def.h ?? it.def.r * 2) * it.scale; const a = toScreen(it.g.position), b = toScreen(_w.copy(it.g.position).add(_q.set(big / 2, 0, 0))); return Math.max(26, Math.hypot(b.x - a.x, b.y - a.y)) }
function pickAt(x, y) {
  let best = null, bd = 1e9
  for (const it of S.items) {
    if (it.state === 'gone' || it.state === 'bagged' || it.state === 'floor') continue
    const s = toScreen(it.g.position), r = itemScreenR(it) + (isTouch ? 22 : 10), d = Math.hypot(s.x - x, s.y - y)
    if (d < r && d / r < bd) { bd = d / r; best = it }
  }
  return best
}
function grab(it, x, y) {
  const wp = ptrWorld(x, y)
  if (it.state === 'counter') {
    // 見えている位置から袋の面に出す（奥行きはゆっくり手前へ）
    S.counter = S.counter.filter(c => c !== it); it.state = 'loose'
    const sp = toScreen(it.g.position), p = ptrWorld(sp.x, sp.y)
    createBody(it, it.kind, p.x, p.y, 0)
  }
  const b = it.body; b.setAwake(true); b.setAngularDamping(4)
  const j = PW.createJoint(pl.MouseJoint({ maxForce: 260 * b.getMass() + 30, frequencyHz: 6, dampingRatio: 0.8 }, ground, b, b.getPosition().clone()))
  j.setTarget(pl.Vec2(wp.x, wp.y))
  S.held = { it, j, x, y }
  it.state = 'held'
  Snd.sfx(it.def.squeaky ? 'squeak' : 'grab')
  if (S.tut === 0) S.tut = 1
}
function release() {
  if (!S.held) return
  const { it, j } = S.held; PW.destroyJoint(j)
  const v = it.body.getLinearVelocity(), sp = Math.hypot(v.x, v.y); if (sp > 16) it.body.setLinearVelocity(pl.Vec2(v.x * 16 / sp, v.y * 16 / sp))
  it.body.setAngularDamping(0.4); it.state = 'loose'; S.held = null
}

// ---------- 客
let custId = 0
function newCustomer() {
  const name = CHAR_FILES[custId % CHAR_FILES.length]
  const c = charsReady ? makeChar(name) : null
  const n = S.custN
  const rare = S.mode === 'play' && n >= 4 && S.rand() < 0.14 ? pick(D.RARE) : null
  const list = rare ? [...rare.list] : makeList(n)
  const cu = { id: ++custId, c, list, k: S.cust.length, state: 'walk', wait: 0, spawned: 0, spawnT: 0.6, mood: 0, done: false, x: 8, z: -8.2, bags: 0, rare, line: null, wish: null, sayT: 0.35, hurt: false }
  if (S.mode === 'play' && !(n === 0 && S.tut < 2)) { const o = orderLine(list, rare); cu.line = o.line; cu.wish = o.wish }
  if (c) { c.g.position.set(cu.x, CUST_Y, cu.z); play(c, 'walk', 0.2, 1.4) }
  S.cust.push(cu); S.custN++
  return cu
}
function makeList(n) {
  if (n === 0) return ['milk', 'bread', 'egg']
  if (n === 1) return ['bottle', 'tofu', 'gyoza']
  const len = clamp(2 + Math.floor(n * 0.42) + Math.floor(S.rand() * 2), 2, 9), out = []
  const odd = clamp((n - 2) * 0.07, 0, 0.45)
  for (let i = 0; i < len; i++) out.push(S.rand() < odd ? pick(D.ODD) : pick(D.NORMAL))
  if (S.rand() < 0.6 && !out.includes('egg')) out.splice(Math.floor(S.rand() * (out.length + 1)), 0, 'egg')
  return out
}
// 注文の一言: 変な物 > 気をつける物 > たまに世間話。同じ人には1回だけ
function orderLine(list, rare) {
  if (rare) return { line: rare.say, wish: rare.wish || null }
  const has = list.filter(k => IT[k].say), odd = has.filter(k => IT[k].odd)
  const k = odd.length ? pick(odd) : has.length ? pick(has) : null
  if (S.rand() < 0.18 || !k) return { line: pick(D.SMALLTALK), wish: null }
  return { line: IT[k].say, wish: k }
}
function bubblesNow() { return FX.filter(f => f.kind === 'sb').length }
function updateOrderLine(dt) {
  const f = S.front; if (!f || !f.c || !f.line || f.state !== 'wait') return
  f.sayT -= dt; if (f.sayT > 0 || bubblesNow() > 0) return
  const text = f.line[S.lang]; f.line = null
  bubble(f.c, text, 'order', Math.max(2.2, 0.9 + text.length * 0.12)); Snd.sfx('mada', { hot: false })
}
function queuePos(k) { return QUEUE[Math.min(k, QUEUE.length - 1)] }
function updateCustomers(dt) {
  // 並び直し
  let k = 0
  for (const cu of S.cust) { if (cu.state === 'leave') continue; cu.k = k++ }
  S.front = S.cust.find(cu => cu.state !== 'leave' && cu.k === 0) || null
  for (let i = S.cust.length - 1; i >= 0; i--) {
    const cu = S.cust[i], c = cu.c
    let tx, tz
    if (cu.state === 'leave') { tx = 9; tz = -2.9 } else { [tx, tz] = queuePos(cu.k) }
    const dx = tx - cu.x, dz = tz - cu.z, dist = Math.hypot(dx, dz), spd = cu.state === 'leave' ? 3.4 : 2.8
    let moving = false
    if (dist > 0.05) { const s = Math.min(dist, spd * dt); cu.x += dx / dist * s; cu.z += dz / dist * s; moving = true }
    if (cu.state === 'walk' && !moving) cu.state = 'wait'
    if (cu.state === 'leave' && cu.x > 8.6) { if (c) freeChar(c); S.cust.splice(i, 1); continue }
    if (!c) continue
    c.g.position.set(cu.x, CUST_Y, cu.z)
    // 奥の客は小さく・暗く（前後が分かるように）
    const dimT = cu.state === 'leave' || cu.k === 0 ? 0 : 1; c.dim = lerp(c.dim, dimT, Math.min(1, dt * 4))
    c.g.scale.setScalar(c.g.userData.s0 * (1 - 0.12 * c.dim)); for (const mt of c.mats) mt.color.setScalar(1 - 0.3 * c.dim)
    const face = moving ? Math.atan2(dx, dz) : 0
    c.g.rotation.y = lerpAngle(c.g.rotation.y, face, Math.min(1, dt * 10))
    // 態度（圧の見せ方。ゲージは置かない）
    const m = cu.state === 'leave' ? 0 : clamp(S.P * (cu.k === 0 ? 1 : 0.85) + (cu.k > 0 ? 0.05 * cu.k : 0), 0, 1)
    cu.mood = m
    if (moving) play(c, 'walk', 0.2, 1.4)
    else if (c.reactT > 0) { c.reactT -= dt }
    else if (m > 0.62) play(c, 'emote-no', 0.2, 0.9 + m * 0.6)
    else if (m > 0.3) play(c, 'walk', 0.25, 0.5 + m)   // 足踏み
    else play(c, 'idle', 0.3)
    c.mixer.update(dt)
    // 上から見下ろすカメラなので、顔をこちらに上げる（頭のてっぺんが顔に見えないように）
    if (c.head) c.head.rotation.x += LOOKUP
    headPos(c, _hp)
    setFace(c, cu.state === 'leave' ? (cu.hurt ? 'annoyed' : 'happy') : moodExpr(c, m, dt))
    c.anger.visible = m > 0.55 && cu.state !== 'leave'; c.anger.position.copy(_hp).add(_q.set(0.45, 0.25, 0)); c.anger.scale.setScalar(0.5 + 0.3 * m + (m > 0.8 ? Math.abs(Math.sin(S.time * 10)) * 0.2 : 0))
    c.sweat.visible = m > 0.3 && m <= 0.55 && cu.state !== 'leave'; c.sweat.position.copy(_hp).add(_q.set(-0.5, 0.1 - (S.time * 0.6 % 0.4), 0))
    if (c.puffT > 0) { c.puffT -= dt; c.puff.material.opacity = clamp(c.puffT / 0.8, 0, 1) * 0.9; c.puff.position.copy(_hp).add(_q.set(0.2 + (1 - c.puffT) * 0.6, -0.5 + (1 - c.puffT) * 0.3, 0.4)); c.puff.scale.setScalar(0.5 + (1 - c.puffT) * 0.6) } else c.puff.material.opacity = 0
  }
}
function lerpAngle(a, b, k) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k }
function custReact(text, cls) {
  const f = S.front; if (!f || !f.c) return
  if (f.brokeWish && !f.saidBroke) { f.saidBroke = true; text = TT().broke; cls = 'hot' }
  bubble(f.c, text, cls || 'warm', Math.max(1.4, 0.9 + text.length * 0.09)); play(f.c, 'emote-no', 0.15, 1.6); f.c.reactT = 0.9; f.c.shockT = 0.9
}

// ---------- 袋のやりとり
let bagMesh = null, bagCi = 0, oldBags = []
function newBag(slide) {
  bagMesh = makeBag(bagCi++); scene.add(bagMesh)
  if (slide) { bagMesh.position.x = -5; bagMesh.userData.slide = 0 } else bagMesh.userData.slide = 1
}
function handOver(reason) {
  // 袋に入っている物を袋ごと持っていく
  const cu = S.front, inside = S.items.filter(it => it.state === 'loose' && inBag(it))
  let eggsOk = 0, eggsAll = 0
  for (const it of inside) {
    if (it.def.tag === 'egg') { eggsAll += it.def.eggs; eggsOk += it.def.eggs - it.broken }
    const p = it.body.getPosition(), a = it.body.getAngle()
    PW.destroyBody(it.body); it.body = null; it.state = 'bagged'
    bagMesh.add(it.g); it.g.position.set(p.x, p.y, it.z); it.g.rotation.set(0, 0, a)
  }
  S.eggsSafe += eggsOk; S.eggsTotal += eggsAll; S.bags++
  if (cu) cu.bags++
  const ob = bagMesh; ob.userData.fly = 0; ob.userData.to = cu && cu.c ? cu : null; oldBags.push(ob)
  newBag(true)
  Snd.sfx(reason === 'full' ? 'full' : 'done'); Snd.sfx('bag')
  const pos = new THREE.Vector3(0, BH + 0.4, 0)
  if (reason === 'full') ono(TT().full, pos, 'yel', { size: 34 })
  if (eggsAll) popChip('#hEggs')
  fx.burst(pos, { count: 18, color: 0xfff0a0, speed: 1.8, life: 0.5 })
  S.settleT = 0
}
function finishCustomer() {
  const cu = S.front; if (!cu) return
  handOver('done')
  cu.state = 'leave'; S.served++; popChip('#hServed')
  S.P = Math.max(0, S.P - 0.24)
  if (cu.c) { const T = TT(), w = cu.hurt ? T.thanksBad : cu.wish ? T.thanksWish : T.thanks; bubble(cu.c, w, '', Math.max(1.2, 0.9 + w.length * 0.09)); play(cu.c, 'walk', 0.2, 1.6) }
  S.nextCustT = Math.min(S.nextCustT, 0.6)
}
function popChip(sel) { const e = $(sel); e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop') }
function updateOldBags(dt) {
  for (let i = oldBags.length - 1; i >= 0; i--) {
    const b = oldBags[i]; b.userData.fly += dt
    const k = b.userData.fly
    // 持ち上げて客の方へ
    const to = b.userData.to && b.userData.to.c ? b.userData.to.c.g.position : new THREE.Vector3(3, 2, -3)
    const u = ease(k / 0.9)
    b.position.set(lerp(0, to.x + 0.6, u), lerp(0, CTR.y + 0.4, u) + Math.sin(u * Math.PI) * 1.5, lerp(0, to.z + 0.8, u))
    b.scale.setScalar(lerp(1, 0.55, u)); b.rotation.z = Math.sin(k * 12) * 0.08 * (1 - u)
    if (k > 0.9) {
      if (b.userData.to && b.userData.to.c && b.userData.to.c.g.parent) { const c = b.userData.to.c; b.position.copy(c.g.position).add(_q.set(0.75, 0.6, 0.2)); b.scale.setScalar(0.45) }
      if (k > 4 || !(b.userData.to && b.userData.to.c && b.userData.to.c.g.parent)) { b.removeFromParent(); oldBags.splice(i, 1); for (const it of S.items) if (it.g.parent === b) it.state = 'gone'; S.items = S.items.filter(it => it.state !== 'gone') }
    }
  }
  if (bagMesh.userData.slide < 1) { bagMesh.userData.slide = Math.min(1, bagMesh.userData.slide + dt * 2.2); bagMesh.position.x = lerp(-5, 0, ease(bagMesh.userData.slide)) }
}

// ---------- 判定（割れ・水・つぶれ・溶け）
const _v3 = new THREE.Vector3()
function worldOf(it) { return it.g.getWorldPosition(_v3).clone() }
function damage(kind, it, n = 1) {
  S.dmg[kind] += n
  const P = { egg: 0.07 * n, tofu: 0.12, squash: 0.08, melt: 0.12, drop: 0.15 }[kind]
  S.P = Math.min(1.05, S.P + P)
  const f = S.front; if (f && it && it.owner === f) { f.hurt = true; if (f.wish && f.wish === it.kind) f.brokeWish = true }
  if (S.mode === 'play') S.photoMoment = Math.max(S.photoMoment || 0, kind === 'egg' ? 2 : 1)
}
function crackEggs(it, n) {
  n = Math.min(n, it.def.eggs - it.broken); if (n <= 0) return
  for (let i = 0; i < n; i++) {
    const e = it.parts.eggs[it.broken + i]; if (!e) continue
    e.material = m1('yolk', () => std(0xffb703, { roughness: 0.2 })); e.scale.set(1.25, 0.45, 1.25); e.position.y -= 0.05
  }
  it.broken += n
  Snd.sfx('crack'); fx.burst(worldOf(it), { count: 10 + n * 4, color: 0xffd166, speed: 1.4, life: 0.45, size: 0.1 })
  ono(n >= 3 ? TT().crack : TT().crack2, worldOf(it), 'yel', { size: 26 + n * 4 })
  damage('egg', it, n)
  if (n >= 2) { fx.shake(0.012, 0.2); custReact(S.lang === 'ja' ? 'あっ…卵' : 'My eggs…') }
}
function judge(it, dt) {
  const d = it.def
  if (it.state === 'loose' || it.state === 'held') {
    // 卵: 上に重さが乗る・落とす
    if (d.tag === 'egg' && it.broken < d.eggs) {
      const force = it.loadNow / STEP, TH = d.eggs === 1 ? 3 : 7.5
      if (it.hitMax > (d.eggs === 1 ? 0.5 : 2.6)) crackEggs(it, 1 + Math.floor((it.hitMax - 2.6) / 2.2))
      else if (it.selfHit > (d.eggs === 1 ? 0.8 : 2.3)) crackEggs(it, 1 + Math.floor((it.selfHit - 2.3) / 1.0))
      if (force > TH) { it.crackAcc += (force - TH) / TH * dt * 2.2; if (it.crackAcc >= 1) { it.crackAcc -= 1; crackEggs(it, 1) } }
    }
    // 柔らかい物: 重さでぺちゃんこ
    if (d.tag === 'soft' && !it.sq) {
      const force = it.loadNow / STEP
      if (force > 10 || it.hitMax > 3.2) { it.sqAcc += dt * (force > 18 || it.hitMax > 3.2 ? 4 : 1); if (it.sqAcc > 0.5) squash(it) }
      else it.sqAcc = Math.max(0, it.sqAcc - dt)
    }
    // 豆腐: 傾けると水が出る
    if (d.tag === 'tofu' && !it.spilled) {
      const a = Math.abs(Math.sin(it.body.getAngle()))
      if (a > 0.5) { it.spillAcc += dt * (a - 0.4) * 3; if (Math.random() < 0.4) fx.burst(worldOf(it), { count: 2, color: 0x9fd3f0, speed: 0.6, life: 0.5, size: 0.08, gravity: 3 }) }
      if (it.spillAcc > 0.45) {
        it.spilled = 1; it.parts.water.scale.y = 0.35; it.parts.water.position.y = -d.h * (it.kind === 'goldfish' ? 0.22 : 0.32)
        Snd.sfx('splash'); ono(TT().spill, worldOf(it), 'blue', { size: 30 }); fx.burst(worldOf(it), { count: 26, color: 0x9fd3f0, speed: 2, life: 0.6, size: 0.12, gravity: 3 })
        damage('tofu', it); custReact(it.kind === 'goldfish' ? (S.lang === 'ja' ? '金魚が！' : 'My goldfish!') : (S.lang === 'ja' ? '豆腐が…' : 'The tofu…'))
      }
    }
  }
  it.loadNow = 0; it.hitMax = 0; it.selfHit = 0
  // 冷凍: 袋の外にある間は溶ける
  if (d.tag === 'frozen' && !it.melted) {
    const safe = it.state === 'loose' && inBag(it)
    if (!safe && S.mode === 'play') it.melt += dt / meltSec()
    const m = it.melt
    it.parts.frost.material.opacity = 0.35 * (1 - clamp(m * 1.6, 0, 1))
    const nd = Math.floor(clamp((m - 0.25) / 0.6, 0, 1) * it.parts.drops.length)
    it.parts.drops.forEach((dd, i) => { dd.visible = i < nd; if (dd.visible) { dd.position.y = dd.userData.y0 - ((S.time * 0.5 + i * 0.17) % 0.25); } })
    if (m >= 1) {
      it.melted = true; it.parts.body.scale.set(1.04, 0.82, 1.04); it.parts.drops.forEach(dd => { dd.visible = true })
      const mats = [].concat(it.parts.body.material); for (const mt of mats) mt.color.multiplyScalar(0.75)
      Snd.sfx('melt'); ono(TT().melt, worldOf(it), 'blue', { size: 26 })
      damage('melt', it); custReact(S.lang === 'ja' ? '溶けてる…' : 'It\'s melting…')
    }
  }
  // 床に落とした
  if (it.body && it.body.getPosition().y < -1.2 && it.state !== 'floor') {
    it.state = 'floor'; it.floorT = 0
    if (it.def.tag === 'egg') crackEggs(it, it.def.eggs - it.broken)
    Snd.sfx('drop'); ono(TT().drop, new THREE.Vector3(clamp(it.body.getPosition().x, -2.6, 2.6), 0.4, 0.6), 'red', { size: 32 })
    damage('drop', it); custReact(S.lang === 'ja' ? 'ちょっと！' : 'Hey!', 'hot')
  }
}
function squash(it) {
  it.sq = true
  const b = it.body, p = b.getPosition(), a = b.getAngle(), v = b.getLinearVelocity()
  const held = S.held && S.held.it === it; if (held) release()
  PW.destroyBody(b); createBody(it, it.kind, p.x, p.y - it.def.h * 0.2, a); it.body.setLinearVelocity(v)
  Snd.sfx('squash'); ono(TT().squash, worldOf(it), 'red', { size: 26 })
  damage('squash', it); custReact(S.lang === 'ja' ? 'つぶれてる' : 'Squished!')
}
function meltSec() { return Math.max(7, 14 - S.served * 0.3) }

// ---------- 遊びの進行
function difficultyRate() { const front = S.cust.filter(c => c.state !== 'leave').length; return 0.017 + 0.0011 * S.served + 0.006 * Math.max(0, front - 1) }
function updateGame(dt) {
  S.time += dt
  // 客を呼ぶ
  if (S.mode === 'play' || S.mode === 'title') {
    const want = S.mode === 'title' ? 3 : Math.min(5, 2 + Math.floor(S.served / 3))
    S.nextCustT -= dt
    if (S.nextCustT <= 0 && S.cust.filter(c => c.state !== 'leave').length < want && charsReadyOrSkip()) { newCustomer(); S.nextCustT = S.mode === 'title' ? 99 : 2.5 }
  }
  updateCustomers(dt)
  if (S.mode === 'title') { updateMgr(dt); return }
  if (S.mode !== 'play' && S.mode !== 'over') { updateMgr(dt); return }
  // 先頭の客の商品をレジへ流す
  const f = S.front
  if (S.mode === 'play' && f && f.state === 'wait' && f.spawned < f.list.length) {
    f.spawnT -= dt
    if (f.spawnT <= 0 && spawnToCounter(f.list[f.spawned])) { f.spawned++; f.spawnT = Math.max(0.35, 0.8 - S.served * 0.02) }
  }
  // 物理
  if (S.held) {
    const wp = ptrWorld(S.held.x, S.held.y)
    S.held.j.setTarget(pl.Vec2(clamp(wp.x, -6, 6), clamp(wp.y, -0.5, 6.5)))
  }
  PW.step(STEP, 8, 4)
  if (S.squeakQ) { Snd.sfx('squeak'); S.squeakQ = false; S.thudQ = 0 } else if (S.thudQ) { Snd.sfx('thud', { v: clamp(S.thudQ / 6, 0.15, 1) }); S.thudQ = 0 }
  for (const it of S.items) judge(it, dt)
  // 床に落ちた物は消す
  for (const it of S.items) if (it.state === 'floor') { it.floorT += dt; if (it.floorT > 1.0) { if (it.body) { PW.destroyBody(it.body); it.body = null } it.g.removeFromParent(); it.state = 'gone' } }
  S.items = S.items.filter(it => it.state !== 'gone' || it.g.parent)
  if (S.mode !== 'play') { updateMgr(dt); return }
  // 袋がいっぱい・客が終わり
  const loose = S.items.filter(it => it.state === 'loose')
  const settled = loose.every(it => { const v = it.body.getLinearVelocity(); return Math.hypot(v.x, v.y) < 0.35 })
  S.settleT = settled && !S.held && bagMesh.userData.slide >= 1 ? S.settleT + dt : 0
  if (f && S.settleT > 0.45) {
    const inside = loose.filter(inBag), outside = loose.filter(it => !inBag(it))
    const remaining = f.list.length - f.spawned + S.counter.length + outside.length
    const top = inside.reduce((m, it) => Math.max(m, itemTop(it)), 0)
    if (remaining === 0 && f.spawned === f.list.length && inside.length) finishCustomer()
    else if (top > BH + 0.12 && remaining > 0) handOver('full')
  }
  // 圧（後ろの客のイライラ）
  S.P += difficultyRate() * dt
  Snd.tempo = 1 + clamp(S.P, 0, 1) * 0.25; Snd.tense = S.P > 0.75 ? 2 : S.P > 0.45 ? 1 : 0
  updateOrderLine(dt)
  moodVoices(dt)
  if (S.P >= 1) complaint()
  updateMgr(dt)
  // 案内
  updateTutorial(dt)
}
function charsReadyOrSkip() { return charsReady || S.time > 6 }
function moodVoices(dt) {
  const f = S.front; if (!f || !f.c) return
  S.sighT -= dt; S.madaT -= dt
  const m = S.P
  if (m > 0.32 && m < 0.6 && S.sighT <= 0) { S.sighT = 5 + S.rand() * 3; const c = (S.cust.find(c => c.k === 1 && c.c) || f).c; bubble(c, TT().sigh, '', 1.4); c.puffT = 1; Snd.sfx('sigh') }
  if (m > 0.3 && Math.floor(S.time * 2.2) !== Math.floor((S.time - dt) * 2.2) && m < 0.62) Snd.sfx('tapfoot')
  if (m >= 0.55 && S.madaT <= 0) {
    S.madaT = Math.max(1.6, 4.5 - m * 3); const hot = m > 0.82
    const ws = TT().mada, w = hot ? ws[3 + Math.floor(S.rand() * 2)] : ws[Math.floor(S.rand() * 3)]
    const who = S.rand() < 0.6 ? f : (S.cust.find(c => c.k === 1 && c.c) || f)
    bubble(who.c, w, hot ? 'hot' : 'warm', 1.5); Snd.sfx('mada', { hot }); if (hot) fx.shake(0.006, 0.2)
  }
}
function complaint() {
  S.complaints++; S.P = 0.42
  const f = S.front
  if (f && f.c) { bubble(f.c, TT().complaint, 'hot', 2); play(f.c, 'emote-no', 0.1, 2); f.c.reactT = 1.6 }
  Snd.sfx('complaint'); fx.shake(0.02, 0.4)
  MGR.stage = Math.min(3, S.complaints)
  if (MGR.c) { MGR.c.g.visible = true; setTimeout(() => { if (MGR.c && S.mode !== 'title') { bubble(MGR.c, TT().mgrCome[Math.min(2, S.complaints - 1)], 'mgr', 1.8); Snd.sfx('mgr') } }, 700) }
  if (S.complaints >= 3) gameOver()
}
function updateMgr(dt) {
  const c = MGR.c; if (!c) return
  const tgt = MGR_POS[MGR.stage], to = new THREE.Vector3(tgt[0], CUST_Y, tgt[1])
  const doorOpen = MGR.stage > 0 ? 1 : 0
  W3.doorPivot.rotation.y = lerp(W3.doorPivot.rotation.y, doorOpen ? -1.3 : 0, Math.min(1, dt * 4))
  const d = to.clone().sub(c.g.position); d.y = 0
  const dist = d.length()
  if (dist > 0.05) { const s = Math.min(dist, 2.4 * dt); c.g.position.addScaledVector(d.normalize(), s); c.g.rotation.y = lerpAngle(c.g.rotation.y, Math.atan2(d.x, d.z), Math.min(1, dt * 8)); play(c, 'walk', 0.2, 1.2) }
  else { c.g.rotation.y = lerpAngle(c.g.rotation.y, MGR.stage >= 3 ? 0.35 : 0.6, Math.min(1, dt * 5)); play(c, MGR.stage >= 3 ? 'emote-no' : 'idle', 0.3, 0.8) }
  c.g.visible = MGR.stage > 0 || dist > 0.05
  c.mixer.update(dt)
  if (c.head) c.head.rotation.x += LOOKUP
  setFace(c, MGR.stage >= 3 ? 'fury' : MGR.stage >= 2 ? 'angry' : 'stern')
  c.anger.visible = MGR.stage >= 2; headPos(c, _hp); c.anger.position.copy(_hp).add(_q.set(0.45, 0.25, 0)); c.anger.scale.setScalar(0.7 + Math.abs(Math.sin(S.time * 6)) * 0.15)
}
function gameOver() {
  if (S.mode !== 'play') return
  S.mode = 'over'; S.overT = 0
  release()
  Snd.setTrack(null); Snd.sfx('over')
  setTimeout(() => { if (MGR.c && S.mode === 'over') { bubble(MGR.c, TT().over, 'mgr', 3); Snd.sfx('mgr') } }, 1300)
  $('#hint').hidden = true; $('#finger').hidden = true
}
function updateOver(dt) {
  S.overT += dt
  if (!S.photoTaken && S.overT > 2.0) { S.doCap = true }
  if (S.overT > 3.2) toResult()
}

// ---------- 案内（最初の1回だけ）
function updateTutorial(dt) {
  const h = $('#hint'), fg = $('#finger')
  if (S.tut === 1 && S.items.some(it => it.state === 'loose' && inBag(it))) { S.tut = 2; store.set('tut', '1') }
  if (S.eggHintT > 0) { S.eggHintT -= dt; h.textContent = TT().tutEgg; h.hidden = false; fg.hidden = true; return }
  if (S.tut >= 2 || !S.counter.length) { h.hidden = true; fg.hidden = true; return }
  if (S.tut === 1) {
    // 1つ袋に入ったら案内終わり
    if (S.items.some(it => it.state === 'loose' && inBag(it))) { S.tut = 2; store.set('tut', '1') }
    h.hidden = true; fg.hidden = true; return
  }
  h.textContent = isTouch ? TT().tutTouch : TT().tutPC; h.hidden = false
  const it = S.counter[0], a = toScreen(it.g.position), b = toScreen(new THREE.Vector3(0, BH * 0.5, 0))
  const k = (S.time % 1.8) / 1.8, u = ease(clamp((k - 0.2) / 0.6, 0, 1))
  fg.hidden = false; fg.style.transform = `translate(${lerp(a.x, b.x, u) - 14}px,${lerp(a.y, b.y, u) - 6}px) scale(${k < 0.2 || k > 0.85 ? 1 : 0.88})`
  fg.style.opacity = k > 0.9 ? 0 : 1
}

// ---------- 見た目の更新
function updateScene(dt) {
  W3.belt.offset.x -= dt * 0.25
  for (const it of S.items) {
    if (it.state === 'counter') {
      const tx = slotX(it.slot), sc = counterScale(it), h = (it.def.h ?? it.def.r * 2) * sc
      if (it.popT > 0) it.popT = Math.min(1, it.popT + dt * 4)
      const pop = it.popT > 0 && it.popT < 1 ? Math.sin(it.popT * Math.PI) * 0.4 : 0
      it.scale = lerp(it.scale, sc, Math.min(1, dt * 10))
      it.g.position.set(tx, CTR.y + h / 2 + pop + 0.02, CTR.z)
      it.g.rotation.set(0, 0, 0); it.g.scale.setScalar(it.scale)
      it.z = CTR.z
    } else if (it.body) {
      const p = it.body.getPosition()
      it.z = lerp(it.z, 0, Math.min(1, dt * 9)); it.scale = lerp(it.scale, 1, Math.min(1, dt * 10))
      it.g.position.set(p.x, p.y, it.z); it.g.rotation.set(0, 0, it.body.getAngle()); it.g.scale.setScalar(it.scale)
    }
  }
  updateOldBags(dt)
  updateHands(dt)
}

// ---------- カメラ（画面の形に合わせて必要な物が全部入る距離）
const FIT_P = [[-1.45, -0.2, 0.7], [1.45, -0.2, 0.7], [-1.45, BH + 1.0, 0], [1.45, BH + 1.0, 0], [-1.85, CTR.y + 0.6, CTR.z], [1.85, CTR.y + 0.6, CTR.z], [0.35, CUST_Y + CUST_H + 0.9, -3.5]]
const FIT_L = [[-1.5, -0.2, 0.7], [1.5, -0.2, 0.7], [-1.5, BH + 0.9, 0], [1.5, BH + 0.9, 0], [-2.6, CTR.y + 0.6, CTR.z], [2.6, CTR.y + 0.6, CTR.z], [0.35, CUST_Y + CUST_H + 0.5, -3.5]]
function frameCamera() {
  const W = innerWidth, H = innerHeight
  camera.aspect = W / H
  const land = W > H, dir = new THREE.Vector3(0, land ? 0.55 : 0.78, 1).normalize(), FIT = land ? FIT_L : FIT_P
  const tgt = new THREE.Vector3(0, 1.4, -1.4)
  const topPad = 64 / H * 2, botPad = (land ? 10 : 24) / H * 2, sidePad = 10 / W * 2
  let lo = 4, hi = 40
  for (let i = 0; i < 26; i++) {
    const d = (lo + hi) / 2
    camera.position.copy(tgt).addScaledVector(dir, d); camera.lookAt(tgt); camera.updateMatrixWorld(); camera.updateProjectionMatrix()
    let ok = true
    for (const p of FIT) { _w.set(...p).project(camera); if (_w.x < -1 + sidePad || _w.x > 1 - sidePad || _w.y > 1 - topPad || _w.y < -1 + botPad) { ok = false; break } }
    if (ok) hi = d; else lo = d
  }
  camera.position.copy(tgt).addScaledVector(dir, hi); camera.lookAt(tgt); camera.updateProjectionMatrix()
}

// ---------- 画面
const views = ['vTitle', 'vHow', 'vPlay', 'vResult']
function show(id) { for (const v of views) $('#' + v).hidden = v !== id }
function applyLang() {
  const T = TT(); document.documentElement.lang = S.lang
  for (const el of document.querySelectorAll('[data-t]')) el.innerHTML = T[el.dataset.t]
  $('#langTxt').textContent = S.lang === 'ja' ? 'EN' : 'JA'
  if (S.mode === 'result' && S.result) fillResult(true)
}
function drawMgrFace() {
  for (const svg of document.querySelectorAll('[data-face=mgr]')) svg.innerHTML = '<circle cx="24" cy="25" r="20" fill="#f2c9a5" stroke="#1d1a16" stroke-width="2.5"/><path d="M6 20c2-12 34-14 36 0-6-5-30-6-36 0z" fill="#3b2a20"/><path d="M14 22l7 2M34 22l-7 2" stroke="#1d1a16" stroke-width="2.5" stroke-linecap="round"/><circle cx="18" cy="27" r="2.2"/><circle cx="30" cy="27" r="2.2"/><path d="M18 36h12" stroke="#1d1a16" stroke-width="2.5" stroke-linecap="round"/><path d="M19 44l5-4 5 4" fill="#c1121f" stroke="#1d1a16" stroke-width="1.5"/>'
}
function resetRun() {
  if (S.held) release()
  for (const it of S.items) { if (it.body) PW.destroyBody(it.body); it.g.removeFromParent() }
  for (const b of oldBags) b.removeFromParent(); oldBags = []
  for (const cu of S.cust) if (cu.c) freeChar(cu.c)
  clearFx()
  S.items = []; S.counter = []; S.cust = []; S.front = null; S.custN = 0; custId = 0
  S.P = 0; S.complaints = 0; S.served = 0; S.bags = 0; S.eggsSafe = 0; S.eggsTotal = 0; S.dmg = { egg: 0, tofu: 0, squash: 0, melt: 0, drop: 0 }
  S.settleT = 0; S.sighT = 4; S.madaT = 6; S.nextCustT = 0; S.photoTaken = false; S.photoMoment = 0; S.eggHintT = 0; S.tutEggShown = false
  MGR.stage = 0; if (MGR.c) { MGR.c.g.position.set(MGR_POS[0][0], CUST_Y, MGR_POS[0][1]); MGR.c.g.visible = false; if (MGR.c.bub) { MGR.c.bub.remove(); MGR.c.bub = null } }
  if (bagMesh) bagMesh.removeFromParent(); newBag(false)
}
function startRun(seed) {
  Snd.init(); Snd.sfx('tap')
  S.seed = seed ?? ((Date.now() & 0xffffff) || 1); S.rand = mulberry(S.seed)
  resetRun(); S.mode = 'play'; S.time = 0
  show('vPlay'); $('#hServed').textContent = '0'; $('#hEggs').textContent = '0'
  Snd.setTrack('play')
}
function toTitle() {
  Snd.sfx('tap'); resetRun(); S.mode = 'title'; S.rand = Math.random
  for (let i = 0; i < 3; i++) newCustomer()
  for (const cu of S.cust) { const [x, z] = queuePos(cu.k = S.cust.indexOf(cu)); cu.x = x; cu.z = z; cu.state = 'wait' }
  S.P = 0
  show('vTitle'); Snd.setTrack('title')
}
function updateHud() {
  $('#hServed').textContent = S.served
  $('#hEggs').textContent = S.eggsSafe
}

// ---------- 結果
function calcResult() {
  const score = S.served * 100 + S.bags * 30 + S.eggsSafe * 25
  let rank = D.RANKS[0]; for (const r of D.RANKS) if (score >= r.min) rank = r
  return { score, served: S.served, bags: S.bags, eggsSafe: S.eggsSafe, eggsTotal: S.eggsTotal, dmg: { ...S.dmg }, rank }
}
function toResult() {
  S.mode = 'result'; S.resT = 0; S.result = calcResult()
  if (!S.photoTaken) capturePhoto()
  fillResult(false); show('vResult'); Snd.setTrack('over')
}
function fillResult(keep) {
  const r = S.result, T = TT(), L = S.lang
  $('#rStamp').innerHTML = T.stamp
  $('#rRank').textContent = r.rank[L]
  $('#rNums').innerHTML = [[T.servedL, T.unitP.replace('{N}', r.served)], [T.eggsL, T.unitE.replace('{N}', r.eggsSafe).replace('{T}', r.eggsTotal)], [T.bagsL, T.unitB.replace('{N}', r.bags)]].map(([a, b]) => `<div>${a}<b>${b}</b></div>`).join('')
  $('#rDmg').textContent = dmgText(r)
  $('#rCmt').textContent = r.rank.cmt[L]
  if (!keep) { $('#rScore').textContent = '0'; for (const e of document.querySelectorAll('#vResult .reveal')) e.classList.remove('on'); $('#rStamp').classList.remove('on') }
  else $('#rScore').textContent = r.score
}
function dmgText(r) { const T = TT(), d = r.dmg, a = []; if (d.egg) a.push(T.dmgE.replace('{N}', d.egg)); if (d.tofu) a.push(T.dmgT.replace('{N}', d.tofu)); if (d.squash) a.push(T.dmgS.replace('{N}', d.squash)); if (d.melt) a.push(T.dmgM.replace('{N}', d.melt)); if (d.drop) a.push(T.dmgD.replace('{N}', d.drop)); return a.length ? T.dmgL + ': ' + a.join(' / ') : '' }
function updateReveal(dt) {
  if (S.mode !== 'result') return
  const was = S.resT; S.resT += dt; const r = S.result
  const at = (t) => was < t && S.resT >= t
  if (S.resT < 1.2) $('#rScore').textContent = Math.round(r.score * ease(S.resT / 1.2))
  if (at(1.2)) { $('#rScore').textContent = r.score; Snd.sfx('stamp'); $('#rStamp').classList.add('on') }
  if (at(1.6)) $('#rRank').classList.add('on')
  if (at(1.9)) { $('#rNums').classList.add('on'); $('#rDmg').classList.add('on') }
  if (at(2.3)) $('#rMc').classList.add('on')
  if (at(2.6)) { $('#rBtns1').classList.add('on'); $('#rBtns2').classList.add('on') }
}
function finishReveal() { if (S.mode !== 'result') return; if (S.resT < 3) { S.resT = 2.99; updateReveal(0.02) } }
function capturePhoto() {
  render()
  const src = renderer.domElement, c = $('#rPhoto').getContext('2d'), W = src.width, H = src.height
  const s = Math.min(W, H) * 0.86, cx = W / 2, cy = H * 0.52
  try { c.drawImage(src, cx - s / 2, cy - s / 2, s, s, 0, 0, 256, 256) } catch (e) { c.fillStyle = '#c9a27a'; c.fillRect(0, 0, 256, 256) }
  S.photoTaken = true
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath() }
function drawCard() {
  const r = S.result, T = TT(), L = S.lang, c = document.createElement('canvas'); c.width = 1080; c.height = 1080; const x = c.getContext('2d')
  const disp = L === 'ja' ? '"Zen Maru Gothic"' : '"Dela Gothic One"', wt = L === 'ja' ? '900 ' : ''
  x.fillStyle = '#20352b'; x.fillRect(0, 0, 1080, 1080)
  x.fillStyle = '#2a9d6f'; for (let i = 0; i < 12; i++) x.fillRect(i * 96, 0, 48, 1080); x.globalAlpha = 1
  x.fillStyle = 'rgba(32,53,43,.82)'; x.fillRect(0, 0, 1080, 1080)
  // 写真
  x.save(); roundRect(x, 60, 150, 560, 560, 30); x.clip(); x.drawImage($('#rPhoto'), 60, 150, 560, 560); x.restore()
  x.lineWidth = 8; x.strokeStyle = '#1d1a16'; roundRect(x, 60, 150, 560, 560, 30); x.stroke()
  // タイトル
  x.fillStyle = '#ffd23f'; x.font = `900 64px ${disp}, sans-serif`; x.textBaseline = 'top'; x.fillText(T.cardTitle, 60, 50)
  // 数字
  x.fillStyle = '#fffaf0'; roundRect(x, 650, 150, 370, 560, 30); x.fill(); x.stroke()
  x.fillStyle = '#1d1a16'; x.textAlign = 'center'; x.font = `900 34px "Zen Maru Gothic", sans-serif`; x.fillText(T.scoreL, 835, 180)
  x.fillStyle = '#e63946'; x.font = `120px "Dela Gothic One", sans-serif`; x.fillText(String(r.score), 835, 220)
  x.fillStyle = '#1d1a16'
  const rows = [[T.servedL, T.unitP.replace('{N}', r.served)], [T.eggsL, T.unitE.replace('{N}', r.eggsSafe).replace('{T}', r.eggsTotal)], [T.bagsL, T.unitB.replace('{N}', r.bags)]]
  rows.forEach(([a, b], i) => { x.font = `900 28px "Zen Maru Gothic", sans-serif`; x.fillText(a, 835, 390 + i * 104); x.font = `52px "Dela Gothic One", sans-serif`; x.fillText(b, 835, 424 + i * 104) })
  // 称号
  x.fillStyle = '#ffd23f'; x.font = `${wt}62px ${disp}, sans-serif`; x.fillText(r.rank[L], 540, 760)
  x.fillStyle = '#fffaf0'; x.font = `900 32px "Zen Maru Gothic", sans-serif`; x.fillText(dmgText(r), 540, 860)
  // ハンコ
  x.save(); x.translate(520, 640); x.rotate(-0.25); x.strokeStyle = '#e63946'; x.lineWidth = 12; x.beginPath(); x.arc(0, 0, 105, 0, 7); x.fillStyle = 'rgba(255,250,240,.9)'; x.fill(); x.stroke()
  x.fillStyle = '#e63946'; x.font = `${wt}36px ${disp}, sans-serif`; x.textBaseline = 'middle'; const st = T.stamp.split('<br>'); st.forEach((s, i) => x.fillText(s, 0, (i - (st.length - 1) / 2) * 44)); x.restore()
  x.textBaseline = 'top'; x.fillStyle = 'rgba(255,250,240,.7)'; x.font = `900 28px "Zen Maru Gothic", sans-serif`; x.fillText(T.cardFoot, 540, 990)
  return c
}
async function saveCard() {
  Snd.sfx('tap'); finishReveal()
  try { await document.fonts.ready } catch (e) {}
  const url = drawCard().toDataURL('image/png'), a = document.createElement('a')
  a.href = url; a.download = `bag-it-up-${S.result.score}.png`; document.body.appendChild(a); a.click(); a.remove()
}
function shareText() { const r = S.result, T = TT(); return T.share.replace('{N}', r.served).replace('{E}', r.eggsSafe).replace('{S}', r.score).replace('{R}', r.rank[S.lang]) }
function xPost() { const text = shareText(); return { text, url: D.PUBLIC_URL, href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(D.PUBLIC_URL)}` } }
function openX() { if (!S.result) return; Snd.sfx('tap'); window.open(xPost().href, '_blank', 'noopener') }

// ---------- 入力
function onDown(e) {
  Snd.init()
  if (S.mode !== 'play' || S.dbgPause && !S.allowInput) return
  if (S.held) return
  const it = pickAt(e.clientX, e.clientY); if (!it) return
  e.preventDefault()
  try { canvas.setPointerCapture(e.pointerId) } catch (er) {}
  S.ptrId = e.pointerId
  grab(it, e.clientX, e.clientY)
}
function onMove(e) { if (S.held && e.pointerId === S.ptrId) { S.held.x = e.clientX; S.held.y = e.clientY } }
function onUp(e) { if (S.held && e.pointerId === S.ptrId) { S.held.x = e.clientX; S.held.y = e.clientY; release() } }
canvas.addEventListener('pointerdown', onDown, { passive: false })
window.addEventListener('pointermove', onMove)
window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp)

// ---------- ループ（固定60Hz）
function render() { look.update(); fx.applyCamera(); if (S.viewOffX) { camera.zoom = S.viewZoom || 1; camera.updateProjectionMatrix(); camera.setViewOffset(innerWidth, innerHeight, S.viewOffX, S.viewOffY || 0, innerWidth, innerHeight) } renderer.render(scene, camera) }
let acc = 0, lastT = performance.now()
function step() {
  const vdt = fx.update(STEP)
  if (vdt > 0 || S.mode !== 'play') {
    updateGame(STEP); if (S.mode === 'over') updateOver(STEP)
  }
  updateScene(STEP); updateFx(STEP); updateReveal(STEP)
  if (S.doCap) { S.doCap = false; capturePhoto() }
}
function loop() {
  requestAnimationFrame(loop)
  const now = performance.now(); let dt = (now - lastT) / 1000; lastT = now
  if (S.dbgPause) { Snd.tick(); render(); return }
  acc += Math.min(dt, 0.25)
  let n = 0; while (acc >= STEP && n < 8) { step(); acc -= STEP; n++ }
  if (n === 8) acc = 0
  if (S.mode === 'play') updateHud()
  Snd.tick(); render()
}
function syncMute() { $('#icOn').hidden = Snd.muted; $('#icOff').hidden = !Snd.muted }
function resize() { renderer.setSize(innerWidth, innerHeight, false); frameCamera() }

// ---------- 起動
initPhysics(); newBag(false); drawMgrFace(); applyLang(); syncMute(); resize()
addEventListener('resize', resize)
$('#bStart').onclick = () => startRun()
$('#bHow').onclick = () => { Snd.init(); Snd.sfx('tap'); show('vHow') }
$('#bHowBack').onclick = () => { Snd.sfx('tap'); show('vTitle') }
$('#bAgain').onclick = () => startRun()
$('#bTitle').onclick = () => toTitle()
$('#bSave').onclick = saveCard
$('#bX').onclick = openX
$('#vResult').addEventListener('pointerdown', e => { if (!e.target.closest('button')) finishReveal() })
$('#bLang').onclick = () => { Snd.init(); S.lang = S.lang === 'ja' ? 'en' : 'ja'; store.set('lang', S.lang); applyLang(); Snd.sfx('tap') }
$('#bMute').onclick = () => { Snd.init(); Snd.setMute(!Snd.muted); syncMute() }
document.addEventListener('visibilitychange', () => { if (Snd.ctx) { if (document.hidden) Snd.ctx.suspend(); else Snd.ctx.resume() } })
show('vTitle'); Snd.setTrack('title')
requestAnimationFrame(loop)
loadChars().then(() => { $('#loading').hidden = true; setupManager(); if (S.mode === 'title') toTitleScene() })
function toTitleScene() { for (const cu of S.cust) if (cu.c) freeChar(cu.c); S.cust = []; for (let i = 0; i < 3; i++) newCustomer(); for (const cu of S.cust) { const [x, z] = queuePos(cu.k = S.cust.indexOf(cu)); cu.x = x; cu.z = z; cu.state = 'wait' } }

// ---------- 検証用の窓口
window.BI = {
  S, Snd, D, camera, toScreen, xPost, drawCard, calcResult,
  get charsReady() { return charsReady },
  dbg: {
    pause(b = true) { S.dbgPause = b },
    step(n = 1) { for (let i = 0; i < n; i++) step(); render() },
    start(seed) { S.dbgPause = false; startRun(seed) },
    give(kind, x = 0, y = 1.5, a = 0, owner) { const it = newItem(kind); it.state = 'loose'; it.z = 0; it.scale = 1; createBody(it, kind, x, y, a); S.items.push(it); updateScene(0); return it.id },
    clearCounter() { for (const it of S.counter) { it.g.removeFromParent(); it.state = 'gone' } S.counter = []; S.items = S.items.filter(i => i.state !== 'gone') },
    setP(v) { S.P = v },
    complaint() { complaint() },
    over() { if (S.mode !== 'play') startRun(1); S.complaints = 2; complaint() },
    toResult() { toResult(); S.resT = 0; updateReveal(3.2) },
    noSpawn(b = true) { if (S.front) S.front.spawned = b ? S.front.list.length : 0 },
    setList(list) { const f = S.front; if (f) { f.list = list; f.spawned = 0; f.spawnT = 0 } },
    counterScreen(i = 0) { const it = S.counter[i]; return it ? toScreen(it.g.position) : null },
    worldScreen(x, y, z = 0) { return toScreen(new THREE.Vector3(x, y, z)) },
    tut(n) { S.tut = n },
    mood(k, expr) { const c = k === 'mgr' ? MGR.c : (S.cust.find(c => c.k === k) || {}).c; if (c) setFace(c, expr) },
    faces() { return S.cust.filter(c => c.c).map(c => ({ k: c.k, name: c.c.name, expr: c.c.expr, face: !!c.c.face })) },
    mgrExpr() { return MGR.c ? MGR.c.expr : null },
    hands() { return HANDS.map(h => ({ gripping: h.grip > 0.8, x: +h.pos.x.toFixed(2), y: +h.pos.y.toFixed(2), z: +h.pos.z.toFixed(2) })) },
    addCust(rareIdx) { const save = S.rand; if (rareIdx != null) { S.rand = () => 0; const cu = newCustomer(); S.rand = save; cu.rare = D.RARE[rareIdx]; cu.list = [...cu.rare.list]; const o = orderLine(cu.list, cu.rare); cu.line = o.line; cu.wish = o.wish; return cu.id } return newCustomer().id },
    setFrontLine(kind) { const f = S.front; if (f) { f.line = { ja: IT[kind].say.ja, en: IT[kind].say.en }; f.wish = kind; f.sayT = 0 } },
    view(x, y = 0, z = 1) { S.viewOffX = x; S.viewOffY = y; S.viewZoom = z; if (!x) camera.clearViewOffset() },
    say(k, text, cls) { const c = k === 'mgr' ? MGR.c : (S.cust.find(c => c.k === k) || {}).c; if (c) bubble(c, text, cls, 99) },
    render() { render() },
    mgrStage(n) { MGR.stage = n },
  },
  state() {
    return {
      mode: S.mode, served: S.served, bags: S.bags, eggsSafe: S.eggsSafe, eggsTotal: S.eggsTotal, P: +S.P.toFixed(3), complaints: S.complaints, mgr: MGR.stage, dmg: { ...S.dmg },
      front: S.front ? { wish: S.front.wish, hurt: S.front.hurt, line: S.front.line, list: S.front.list, rare: !!S.front.rare } : null,
      counter: S.counter.map(i => i.kind), held: S.held ? S.held.it.kind : null, cust: S.cust.map(c => ({ k: c.k, st: c.state, n: c.list.length, sp: c.spawned, has: !!c.c })),
      items: S.items.filter(i => i.body).map(i => { const p = i.body.getPosition(); return { kind: i.kind, x: +p.x.toFixed(2), y: +p.y.toFixed(2), a: +i.body.getAngle().toFixed(2), broken: i.broken, spilled: i.spilled, sq: i.sq, melt: +i.melt.toFixed(2), melted: i.melted, inBag: inBag(i), st: i.state } }),
    }
  },
}
window.__biReady = true
