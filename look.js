// look.js — tom3games の3Dバカゲー共通の「見た目」部品（Three.js r185）。依存は import map の 'three' だけ。
// 正本は ~/Desktop/claudecode/_shared/look.js。各ゲームへはファイルをコピーして同梱する（リポジトリが別なので）。
// 使い方は _shared/README.md。
import * as THREE from 'three'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

// ============================================================ 1. 光
// setupLook(renderer, scene, opts) → { hemi, sun, fill, target }
//   ACES トーンマップ・sRGB 出力・弱い半球光・斜め上の暖色の太陽・反対側から寒色の補助光
export function setupLook(renderer, scene, o = {}) {
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = o.exposure ?? 1.1
  const hemi = new THREE.HemisphereLight(o.sky ?? 0xfff2e0, o.ground ?? 0x5a4a44, o.hemi ?? 0.7)
  const sun = new THREE.DirectionalLight(o.sunColor ?? 0xfff0dc, o.sun ?? 2.3)
  sun.position.set(...(o.sunPos ?? [3, 6, 2]))
  const target = new THREE.Object3D(); target.position.set(...(o.target ?? [0, 0, 0])); sun.target = target
  const fill = new THREE.DirectionalLight(o.fillColor ?? 0xbcd2ff, o.fill ?? 0.45)
  fill.position.set(...(o.fillPos ?? [-3, 2, 4]))
  scene.add(hemi, sun, target, fill)
  if (o.env) useRoomEnvironment(renderer, scene, o.envIntensity ?? 0.6)
  return { hemi, sun, fill, target }
}

// flatShading をやめる。material.userData.keepFlat = true の小物はそのまま
export function smoothShading(root) {
  root.traverse(m => { if (!m.isMesh) return; for (const mt of [].concat(m.material)) if (mt && mt.flatShading && !mt.userData.keepFlat) { mt.flatShading = false; mt.needsUpdate = true } })
}

// ============================================================ 8. 材質と環境光
// toStandard(root, { roughness, metalness, shiny: [材質名や色の判定関数] })
//   Lambert/Phong を MeshStandardMaterial に置き換える（同じ材質は1回だけ変換して使い回す）。
//   Phong の shininess が高いものは roughness を下げて光らせる。material.userData.keep = true は触らない
const _conv = new WeakMap()
export function toStandard(root, o = {}) {
  const conv = mt => {
    if (!mt || mt.userData.keep || !(mt.isMeshLambertMaterial || mt.isMeshPhongMaterial)) return mt
    if (_conv.has(mt)) return _conv.get(mt)
    const shin = mt.isMeshPhongMaterial ? mt.shininess : 0
    const s = new THREE.MeshStandardMaterial({
      color: mt.color, map: mt.map, emissive: mt.emissive, emissiveMap: mt.emissiveMap, emissiveIntensity: mt.emissiveIntensity,
      transparent: mt.transparent, opacity: mt.opacity, side: mt.side, vertexColors: mt.vertexColors, alphaTest: mt.alphaTest,
      depthWrite: mt.depthWrite, depthTest: mt.depthTest, flatShading: mt.userData.keepFlat ? mt.flatShading : false,
      roughness: shin > 30 ? 0.3 : (o.roughness ?? 0.7), metalness: shin > 70 ? 0.25 : (o.metalness ?? 0),
    })
    s.userData = { ...mt.userData, from: mt.type }
    if (o.tweak) o.tweak(s, mt)
    _conv.set(mt, s); return s
  }
  root.traverse(m => { if (m.isMesh || m.isInstancedMesh) m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material) })
}
// 単体の材質を変換したいとき（skin など、あとで色を書き換える材質を手元に持ちたいとき）
export const standardOf = (mt, o) => { const g = new THREE.Group(), m = new THREE.Mesh(undefined, mt); g.add(m); toStandard(g, o); return m.material }

// RoomEnvironment（three/examples の RoomEnvironment を同梱。MIT）を PMREM に通して scene.environment に
export function useRoomEnvironment(renderer, scene, intensity = 0.6) {
  const pm = new THREE.PMREMGenerator(renderer), env = roomScene()
  scene.environment = pm.fromScene(env, 0.04).texture
  if ('environmentIntensity' in scene) scene.environmentIntensity = intensity
  env.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose() } }); pm.dispose()
  return scene.environment
}
function roomScene() {
  const sc = new THREE.Scene(); sc.position.y = -3.5
  const geo = new THREE.BoxGeometry(); geo.deleteAttribute('uv')
  const L = new THREE.PointLight(0xffffff, 900, 28, 2); L.position.set(0.418, 16.199, 0.3); sc.add(L)
  const room = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ side: THREE.BackSide })); room.position.set(-0.757, 13.219, 0.717); room.scale.set(31.713, 28.305, 28.591); sc.add(room)
  const bm = new THREE.MeshStandardMaterial()
  for (const [p, r, s] of [[[-10.906, 2.009, 1.846], -0.195, [2.328, 7.905, 4.651]], [[-5.607, -0.754, -0.758], 0.994, [1.97, 1.534, 3.955]], [[6.167, 0.857, 7.803], 0.561, [3.927, 6.285, 3.687]], [[-2.017, 0.018, 6.124], 0.333, [2.002, 4.566, 2.064]], [[2.291, -0.756, -2.621], -0.286, [1.546, 1.552, 1.496]], [[-2.193, -0.369, -5.547], 0.516, [3.875, 3.487, 2.986]]]) {
    const b = new THREE.Mesh(geo, bm); b.position.set(...p); b.rotation.y = r; b.scale.set(...s); sc.add(b)
  }
  const al = i => new THREE.MeshLambertMaterial({ color: 0, emissive: 0xffffff, emissiveIntensity: i })
  for (const [i, p, s] of [[50, [-16.116, 14.37, 8.208], [0.1, 2.428, 2.739]], [50, [-16.109, 18.021, -8.207], [0.1, 2.425, 2.751]], [17, [14.904, 12.198, -1.832], [0.15, 4.265, 6.331]], [43, [-0.462, 8.89, 14.52], [4.38, 5.441, 0.088]], [20, [3.235, 11.486, -12.541], [2.5, 2, 0.1]], [100, [0, 20, 0], [1, 0.1, 1]]]) {
    const m = new THREE.Mesh(geo, al(i)); m.position.set(...p); m.scale.set(...s); sc.add(m)
  }
  return sc
}

// 本物の影を「主役まわりだけ」に限定して入れる
// enableShadows(renderer, sun, { center:[x,y,z], radius, mapSize, bias, static })
//   影カメラを center ± radius に絞る（範囲が狭いほど同じ解像度でくっきり、安い）
//   static: true なら毎フレーム更新せず、look.shadowDirty() を呼んだ時だけ描き直す
export function enableShadows(renderer, sun, o = {}) {
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  if (o.static) renderer.shadowMap.autoUpdate = false
  sun.castShadow = true
  const r = o.radius ?? 2, c = new THREE.Vector3(...(o.center ?? [0, 0, 0]))
  const sz = o.mapSize ?? (isTouch ? 1024 : 2048)
  sun.shadow.mapSize.set(sz, sz)
  const cam = sun.shadow.camera; cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r
  const dir = sun.position.clone().sub(sun.target.position).normalize()
  sun.target.position.copy(c); sun.position.copy(c).addScaledVector(dir, r * 4)
  cam.near = r * 1.5; cam.far = r * 7; cam.updateProjectionMatrix()
  sun.shadow.bias = o.bias ?? -0.0005; sun.shadow.normalBias = o.normalBias ?? 0.02
  sun.shadow.radius = o.blur ?? 3
  sun.target.updateMatrixWorld()
  return sun.shadow
}
export const castShadow = (root, on = true) => root.traverse(m => { if (m.isMesh && !m.material.transparent) m.castShadow = on })
export const receiveShadow = (root, on = true) => root.traverse(m => { if (m.isMesh) m.receiveShadow = on })

// ============================================================ 2. 丸影
// addBlobShadow(obj, size, { floorY, opacity, parent, shrink, offset:[x,z] }) → 影の板
//   obj の真下の床に柔らかい丸影を置く。look.update() で毎フレーム追従し、高く浮くほど小さく薄くなる
let _shadowTex = null
const BLOBS = []
function blobTex() {
  if (_shadowTex) return _shadowTex
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 31); g.addColorStop(0, 'rgba(30,18,12,1)'); g.addColorStop(0.5, 'rgba(30,18,12,.55)'); g.addColorStop(1, 'rgba(30,18,12,0)')
  x.fillStyle = g; x.fillRect(0, 0, 64, 64)
  _shadowTex = new THREE.CanvasTexture(c); _shadowTex.colorSpace = THREE.SRGBColorSpace; return _shadowTex
}
const _bv = new THREE.Vector3()
export function addBlobShadow(obj, size = 0.6, o = {}) {
  const mat = new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: o.opacity ?? 0.42, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); m.rotation.x = -Math.PI / 2; m.renderOrder = -1
  m.userData.blob = { obj, size, floorY: o.floorY ?? 0, op: mat.opacity, shrink: o.shrink ?? 2.5, off: o.offset ?? [0, 0], sx: o.stretch ?? 1 }
  ;(o.parent ?? findScene(obj) ?? obj.parent).add(m); BLOBS.push(m); updateBlob(m); return m
}
function findScene(o) { while (o && o.parent) o = o.parent; return o && o.isScene ? o : null }
function updateBlob(m) {
  const b = m.userData.blob; if (!b.obj.parent && !b.obj.isScene) { m.visible = false; return }
  b.obj.getWorldPosition(_bv)
  let vis = true; for (let p = b.obj; p; p = p.parent) if (!p.visible) { vis = false; break }
  const h = Math.max(0, _bv.y - b.floorY), k = 1 / (1 + h * b.shrink), ws = new THREE.Vector3(); b.obj.getWorldScale(ws)
  m.position.set(_bv.x + b.off[0], b.floorY + 0.004, _bv.z + b.off[1]); if (m.parent && !m.parent.isScene) m.parent.worldToLocal(m.position)
  m.scale.set(b.size * ws.x * b.sx * k, b.size * ws.z * k, 1)
  m.material.opacity = b.op * clamp(k * 1.3, 0, 1); m.visible = vis
}
export function removeBlobShadow(m) { const i = BLOBS.indexOf(m); if (i >= 0) BLOBS.splice(i, 1); m.removeFromParent() }

// ============================================================ 3. 縦画面のカメラ
// frameSubject(camera, { center, height, top=0.2, bottom=0.8, dir, fov })
//   主役（中心 center・高さ height）が画面の高さ top〜bottom に収まる距離にカメラを置き、主役を見る。
//   dir はカメラの方向（主役→カメラ、例 [0, 0.25, 1]）。戻り値は距離
export function frameSubject(camera, o) {
  if (o.fov) camera.fov = o.fov
  camera.updateProjectionMatrix()
  const top = o.top ?? 0.2, bottom = o.bottom ?? 0.8, fill = bottom - top
  const vt = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const d = o.height / (fill * 2 * vt)
  const c = new THREE.Vector3(...[].concat(o.center.toArray ? o.center.toArray() : o.center))
  // 主役の中心を画面の (top+bottom)/2 に置くため、見る点をずらす
  const shift = ((top + bottom) / 2 - 0.5) * 2 * vt * d
  const dir = new THREE.Vector3(...(o.dir ?? [0, 0.2, 1])).normalize()
  camera.position.copy(c).addScaledVector(dir, d)
  camera.lookAt(c.x, c.y + shift, c.z)
  return d
}
// 物体が画面のどこを占めているか（0〜1。検証用）→ { top, bottom, left, right }
export function screenSpan(camera, obj) {
  const box = new THREE.Box3().setFromObject(obj), v = new THREE.Vector3(), r = { top: 1, bottom: 0, left: 1, right: 0 }
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera)
    const x = (v.x + 1) / 2, y = (1 - v.y) / 2
    r.top = Math.min(r.top, y); r.bottom = Math.max(r.bottom, y); r.left = Math.min(r.left, x); r.right = Math.max(r.right, x)
  }
  for (const k in r) r[k] = +r[k].toFixed(3); return r
}

// ============================================================ 4. 演出文字のルール
// tidyTexts(els, { margin=16, max=2, avoid=[DOMRect...], gap=6 })
//   毎フレーム、ゲーム側が位置（transform）を決めたあとに呼ぶ。新しい順に max 個まで残し、古いものは消す合図を返す。
//   画面の端から margin 内に押し戻し、先に置いた文字と重なる場合は下（入らなければ上）へずらす。
//   ずらしは CSS の translate プロパティで足すので、ゲームの transform とは干渉しない。
//   戻り値: 消すべき要素の配列（ゲーム側でフェードさせる）
export function tidyTexts(els, o = {}) {
  const M = o.margin ?? 16, max = o.max ?? 2, gap = o.gap ?? 6, W = innerWidth, H = innerHeight
  const live = els.filter(e => e && e.isConnected), drop = live.slice(0, Math.max(0, live.length - max))
  const keep = live.slice(drop.length), placed = [...(o.avoid ?? [])].map(r => ({ l: r.left, t: r.top, r: r.right, b: r.bottom }))
  const minY = o.top ?? M, maxY = o.bottom ?? H - M
  for (let i = keep.length - 1; i >= 0; i--) { // 新しいものを優先して先に置く
    const el = keep[i], [ox, oy] = (el._lkOff ?? [0, 0]), r = el.getBoundingClientRect()
    const w = r.width, h = r.height; let l = r.left - ox, t = r.top - oy
    l = w > W - 2 * M ? (W - w) / 2 : clamp(l, M, W - M - w)
    t = h > maxY - minY ? minY : clamp(t, minY, maxY - h)
    for (let k = 0; k < 8; k++) {
      const hit = placed.find(p => l < p.r + gap && l + w > p.l - gap && t < p.b + gap && t + h > p.t - gap); if (!hit) break
      const down = hit.b + gap, up = hit.t - gap - h
      t = down + h <= maxY ? down : up >= minY ? up : down
    }
    placed.push({ l, t, r: l + w, b: t + h })
    const off = [Math.round(l - (r.left - ox)), Math.round(t - (r.top - oy))]
    if (off[0] !== ox || off[1] !== oy) { el.style.translate = `${off[0]}px ${off[1]}px`; el._lkOff = off }
  }
  return drop
}
// 検証用: 画面内の演出文字（selector）について、はみ出し・重なりを数える
export function checkTexts(selector, margin = 16) {
  const rs = [...document.querySelectorAll(selector)].filter(e => +getComputedStyle(e).opacity > 0.3).map(e => e.getBoundingClientRect()).filter(r => r.width)
  const out = rs.filter(r => r.left < margin - 1 || r.right > innerWidth - margin + 1 || r.top < 0 || r.bottom > innerHeight).length
  let over = 0; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i], b = rs[j]; if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) over++ }
  return { n: rs.length, out, over }
}

// ============================================================ 5. ボタンの厚みと押し込み
// pressable(selector, { depth=5, edge='rgba(0,0,0,.35)', gloss=true, pulse='.lk-pulse' })
//   下に濃い色の段・上面のつや・押すと沈む。おすすめボタンに .lk-pulse を付けるとゆっくり脈打つ
export function pressable(selector, o = {}) {
  const d = o.depth ?? 5, edge = o.edge ?? 'var(--lk-edge, rgba(0,0,0,.35))', id = 'lk-press-' + selector.replace(/\W/g, '_')
  if (document.getElementById(id)) return
  const st = document.createElement('style'); st.id = id
  st.textContent = `${selector}{box-shadow:0 ${d}px 0 ${edge};transition:transform .06s,box-shadow .06s}
${selector}:active:not(:disabled){transform:translateY(${d - 1}px);box-shadow:0 1px 0 ${edge}}
${o.gloss !== false ? `${selector}{background-image:linear-gradient(to bottom,rgba(255,255,255,.28),rgba(255,255,255,0) 46%,rgba(0,0,0,0) 70%,rgba(0,0,0,.08))}` : ''}
${o.pulse ?? '.lk-pulse'}{animation:lkPulse 1.2s ease-in-out infinite alternate}
@keyframes lkPulse{from{scale:1}to{scale:1.04}}
.lk-pop{animation:lkPop .28s cubic-bezier(.3,1.6,.5,1)}@keyframes lkPop{from{scale:1.3}to{scale:1}}`
  document.head.appendChild(st)
}
// 数字が増減した時に跳ねさせる
export function popNumber(el) { if (!el) return; el.classList.remove('lk-pop'); void el.offsetWidth; el.classList.add('lk-pop') }

// ============================================================ 6. 床と壁の質感・擬似AO
// surfaceTex({ w, h, base, draw, noise, grime, lines, edge, repeat, seed }) → CanvasTexture
//   base で塗る → draw(ctx,w,h) で模様（タイル目地・木目など）→ 細かいノイズ（明度 ±noise）→ 汚れのムラ（grime）
//   edge: 0〜1。テクスチャの縁を暗くする（繰り返さない床・壁に。部屋の隅が暗くなる）
export function surfaceTex(o = {}) {
  const w = o.w ?? 256, h = o.h ?? 256, c = document.createElement('canvas'); c.width = w; c.height = h
  const x = c.getContext('2d'), rnd = mulberry(o.seed ?? 7)
  x.fillStyle = o.base ?? '#888'; x.fillRect(0, 0, w, h)
  if (o.draw) o.draw(x, w, h, rnd)
  // 汚れのムラ（大きくぼかした円）
  const gr = o.grime ?? 0.08
  for (let i = 0; i < 26 * gr * 10 && gr > 0; i++) {
    const cx = rnd() * w, cy = rnd() * h, r = (0.08 + rnd() * 0.22) * Math.max(w, h), dark = rnd() < 0.7
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, dark ? `rgba(40,30,20,${gr * 0.9})` : `rgba(255,250,235,${gr * 0.6})`); g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g
    for (const [dx, dy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) { x.save(); x.translate(dx, dy); x.fillRect(cx - r, cy - r, r * 2, r * 2); x.restore() } // 繋ぎ目が出ないよう周りにも描く
  }
  // 細かいノイズ
  const nz = o.noise ?? 0.07
  if (nz > 0) {
    const id = x.getImageData(0, 0, w, h), d = id.data
    for (let i = 0; i < d.length; i += 4) { const k = 1 + (rnd() - 0.5) * 2 * nz; d[i] = clamp(d[i] * k, 0, 255); d[i + 1] = clamp(d[i + 1] * k, 0, 255); d[i + 2] = clamp(d[i + 2] * k, 0, 255) }
    x.putImageData(id, 0, 0)
  }
  if (o.edge) {
    const e = o.edge
    for (const [x0, y0, x1, y1] of [[0, 0, 0, h * 0.25], [0, h, 0, h * 0.75], [0, 0, w * 0.25, 0], [w, 0, w * 0.75, 0]]) {
      const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `rgba(20,12,8,${e})`); g.addColorStop(1, 'rgba(20,12,8,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h)
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...o.repeat) }
  t.userData = { c, ctx: x }; return t
}
// 部屋の隅を暗くする帯（床と壁の境目に置く）
// addCornerAO(parent, { minX, maxX, minZ, maxZ, y=0, width=0.45, strength=0.35, sides='LRBF', walls=true, h=0.6 })
//   床の縁に沿って「縁が濃く内側へ消える」板を置く。walls なら壁の下端にも縦の帯を置く
let _aoTex = null
function aoTex() {
  if (_aoTex) return _aoTex
  const c = document.createElement('canvas'); c.width = 4; c.height = 64; const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, 'rgba(18,10,6,1)'); g.addColorStop(0.35, 'rgba(18,10,6,.45)'); g.addColorStop(1, 'rgba(18,10,6,0)')
  x.fillStyle = g; x.fillRect(0, 0, 4, 64); _aoTex = new THREE.CanvasTexture(c); return _aoTex
}
export function addCornerAO(parent, o) {
  const y = o.y ?? 0, w = o.width ?? 0.45, s = o.strength ?? 0.35, sides = o.sides ?? 'LRBF', grp = new THREE.Group(), hh = o.h ?? 0.6
  const mat = new THREE.MeshBasicMaterial({ map: aoTex(), transparent: true, depthWrite: false, opacity: s, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1 })
  const lx = o.maxX - o.minX, lz = o.maxZ - o.minZ, cx = (o.minX + o.maxX) / 2, cz = (o.minZ + o.maxZ) / 2
  const strip = (len, px, pz, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), mat); m.rotation.set(-Math.PI / 2, 0, ry, 'YXZ'); m.rotation.order = 'YXZ'; m.rotation.y = ry; m.position.set(px, y + 0.003, pz); grp.add(m) }
  const wall = (len, px, pz, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(len, hh), mat); m.rotation.set(0, ry, Math.PI); m.position.set(px, y + hh / 2, pz); grp.add(m) }
  // 板の +v 側（テクスチャの上＝濃い側）が壁に来るよう向ける
  if (sides.includes('B')) { strip(lx, cx, o.minZ + w / 2, 0); if (o.walls !== false) wall(lx, cx, o.minZ + 0.01, 0) }
  if (sides.includes('F')) { strip(lx, cx, o.maxZ - w / 2, Math.PI); if (o.walls !== false) wall(lx, cx, o.maxZ - 0.01, Math.PI) }
  if (sides.includes('L')) { strip(lz, o.minX + w / 2, cz, Math.PI / 2); if (o.walls !== false) wall(lz, o.minX + 0.01, cz, Math.PI / 2) }
  if (sides.includes('R')) { strip(lz, o.maxX - w / 2, cz, -Math.PI / 2); if (o.walls !== false) wall(lz, o.maxX - 0.01, cz, -Math.PI / 2) }
  parent.add(grp); return grp
}

// ============================================================ 7. 見せ場のエフェクト5点セット
// const fx = createFx(scene, camera, renderer)
//   fx.burst(pos, { count=40, color=0xfff0a0, speed=1.6, life=0.5, size=0.12, up=0.6, spread=1 })  加算合成のパーティクル
//   fx.shake(amp=0.04, dur=0.25)      画面揺れ（画面座標のずらし。カメラの位置は触らない）
//   fx.zoom(k=0.07, dur=0.35)         一瞬寄る（camera.zoom を 1+k まで上げて戻す）
//   fx.hitstop(ms=80)                 演出の時間を止める（fx.update が 0 を返す。遊びの時計には使わない）
//   fx.squash(obj, amt=0.15, dur=0.45) 解放の瞬間の伸び縮み（縦 1+amt → 1-amt*0.65 → 1）
//   fx.moment(pos, { burst, shake, zoom, hitstop, react })  上の4つ＋react()（周りの人の反応のきっかけ）をまとめて
//   毎フレーム: const vdt = fx.update(dt)（演出用の dt）→ カメラを置いた後・描画直前に fx.applyCamera()
let _sparkTex = null
function sparkTex() {
  if (_sparkTex) return _sparkTex
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); _sparkTex = new THREE.CanvasTexture(c); return _sparkTex
}
export function createFx(scene, camera, renderer, o = {}) {
  const N = o.pool ?? 120, parts = []
  for (let i = 0; i < N; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: o.tex ?? sparkTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
    sp.visible = false; sp.renderOrder = 8; scene.add(sp); parts.push({ sp, life: 0, max: 1, v: new THREE.Vector3(), s: 0.1, g: 0 })
  }
  let shakeA = 0, shakeT = 0, shakeD = 1, zoomK = 0, zoomT = 0, zoomD = 1, stop = 0, time = 0
  const sq = []
  const api = {
    burst(pos, b = {}) {
      const n = b.count ?? 40, col = new THREE.Color(b.color ?? 0xfff0a0), sp = b.speed ?? 1.6
      let k = 0
      for (const p of parts) {
        if (k >= n) break; if (p.life > 0) continue; k++
        p.sp.position.copy(pos); p.max = p.life = (b.life ?? 0.5) * (0.6 + Math.random() * 0.6)
        const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * (b.spread ?? 1)
        p.v.set(Math.cos(a) * Math.cos(e), Math.sin(e) + (b.up ?? 0.6), Math.sin(a) * Math.cos(e)).multiplyScalar(sp * (0.4 + Math.random() * 0.8))
        if (b.dir) p.v.add(new THREE.Vector3(...b.dir).multiplyScalar(sp))
        p.s = (b.size ?? 0.12) * (0.5 + Math.random()); p.g = b.gravity ?? 1.2
        p.sp.material.color.copy(col).offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.1); p.sp.visible = true
      }
    },
    shake(a = 0.04, d = 0.25) { if (a >= shakeA * (1 - shakeT / shakeD)) { shakeA = a; shakeT = 0; shakeD = d } },
    zoom(k = 0.07, d = 0.35) { zoomK = k; zoomT = 0; zoomD = d },
    hitstop(ms = 80) { stop = Math.max(stop, ms / 1000) },
    squash(obj, amt = 0.15, dur = 0.45) { const i = sq.findIndex(s => s.obj === obj); if (i >= 0) { obj.scale.copy(sq[i].base); sq.splice(i, 1) } sq.push({ obj, amt, dur, t: 0, base: obj.scale.clone() }) },
    moment(pos, m = {}) {
      if (m.burst !== false) api.burst(pos, m.burst ?? {})
      if (m.shake !== false) api.shake(...[].concat(m.shake ?? [0.045, 0.25]))
      if (m.zoom !== false) api.zoom(...[].concat(m.zoom ?? [0.07, 0.35]))
      if (m.hitstop !== false) api.hitstop(m.hitstop ?? 80)
      if (m.react) m.react()
    },
    get stopped() { return stop > 0 },
    update(dt) {
      time += dt
      if (stop > 0) { stop -= dt; return 0 }
      for (const p of parts) {
        if (p.life <= 0) continue; p.life -= dt
        if (p.life <= 0) { p.sp.visible = false; continue }
        p.v.y -= p.g * dt; p.v.multiplyScalar(1 - dt * 1.8); p.sp.position.addScaledVector(p.v, dt)
        const k = p.life / p.max; p.sp.scale.setScalar(p.s * (0.4 + k * 0.8)); p.sp.material.opacity = Math.min(1, k * 1.6)
      }
      shakeT += dt; zoomT += dt
      for (let i = sq.length - 1; i >= 0; i--) {
        const s = sq[i]; s.t += dt; const u = s.t / s.dur
        if (u >= 1) { s.obj.scale.copy(s.base); sq.splice(i, 1); continue }
        const y = u < 0.25 ? 1 + s.amt * (u / 0.25) : u < 0.6 ? 1 + s.amt - s.amt * 1.65 * ((u - 0.25) / 0.35) : 1 - s.amt * 0.65 * (1 - (u - 0.6) / 0.4)
        s.obj.scale.set(s.base.x / Math.sqrt(y), s.base.y * y, s.base.z / Math.sqrt(y))
      }
      return dt
    },
    applyCamera(cam = camera) {
      const sk = shakeT < shakeD ? shakeA * (1 - shakeT / shakeD) : 0
      const z = zoomT < zoomD ? zoomK * Math.sin(Math.PI * Math.min(1, zoomT / zoomD)) * (zoomT < zoomD * 0.3 ? 1 : 1) : 0
      const nz = 1 + z
      if (cam.zoom !== nz) { cam.zoom = nz; cam.updateProjectionMatrix() }
      if (sk > 0.0005) {
        const s = new THREE.Vector2(); renderer.getSize(s)
        const px = sk * Math.min(s.x, s.y)
        cam.setViewOffset(s.x, s.y, Math.sin(time * 83) * px, Math.cos(time * 71) * px * 0.8, s.x, s.y)
      } else if (cam.view && cam.view.enabled) cam.clearViewOffset()
    },
  }
  return api
}

// ============================================================ 9. 顔のテクスチャ（表情6種）
// const face = createFace({ size=256, ink, skin, blush, line })
//   face.texture を顔の板／球の前面に貼る。face.set('normal'|'strain'|'panic'|'relief'|'busted'|'smug'|'blink')
//   顔の面は makeFaceMesh(face, rx, ry, rz) で作れる（頭の楕円体の前面にぴったり沿う殻）
export const EXPRESSIONS = ['normal', 'strain', 'panic', 'relief', 'busted', 'smug', 'blink']
export function createFace(o = {}) {
  const S = o.size ?? 256, ink = o.ink ?? '#231a1f', texs = {}
  for (const e of EXPRESSIONS) {
    const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d')
    x.scale(S / 256, S / 256); drawFace(x, e, { ink, glasses: o.glasses, brow: o.brow ?? ink, ...o })
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texs[e] = t
  }
  const face = { texture: texs.normal, texs, expr: 'normal', mats: [],
    set(e) { if (!texs[e] || e === face.expr) return; face.expr = e; face.texture = texs[e]; for (const m of face.mats) { m.map = texs[e]; m.needsUpdate = true } } }
  return face
}
// 頭（楕円体 rx,ry,rz）の前面に沿った殻。u=経度、v=緯度 を顔の canvas に対応させる
export function makeFaceMesh(face, rx, ry, rz, o = {}) {
  const span = o.span ?? 1.9, vspan = o.vspan ?? 1.7
  const g = new THREE.SphereGeometry(1.012, 32, 24, Math.PI / 2 - span / 2 + Math.PI, span, Math.PI / 2 - vspan / 2, vspan)
  g.scale(rx, ry, rz)
  // 経度を反転して canvas の左が顔の右手側（画面の左）に来るように
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i))
  const mat = new THREE.MeshBasicMaterial({ map: face.texture, transparent: true, depthWrite: false, toneMapped: o.toneMapped ?? false, polygonOffset: true, polygonOffsetFactor: -2 })
  mat.userData.keep = true; face.mats.push(mat)
  const m = new THREE.Mesh(g, mat); m.renderOrder = 2; return m
}
function drawFace(x, e, o) {
  const ink = o.ink, L = 6.5
  x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = ink; x.fillStyle = ink; x.lineWidth = L
  const ex = [88, 168], ey = 112 // 目の中心
  const blush = (a = 0.55, big = 1) => { for (const cx of [62, 194]) { const g = x.createRadialGradient(cx, 160, 2, cx, 160, 30 * big); g.addColorStop(0, `rgba(255,90,100,${a})`); g.addColorStop(1, 'rgba(255,90,100,0)'); x.fillStyle = g; x.beginPath(); x.ellipse(cx, 160, 34 * big, 22 * big, 0, 0, 7); x.fill() } x.fillStyle = ink }
  const eyeOpen = (rx = 17, ry = 21, pr = 10, dx = 0, dy = 0) => { for (const cx of ex) { x.fillStyle = '#fff'; x.beginPath(); x.ellipse(cx, ey, rx, ry, 0, 0, 7); x.fill(); x.stroke(); x.fillStyle = ink; x.beginPath(); x.ellipse(cx + dx, ey + 2 + dy, pr, pr * 1.12, 0, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(cx + dx + pr * 0.35, ey - pr * 0.3 + dy, pr * 0.32, 0, 7); x.fill() } x.fillStyle = ink }
  const brows = (dy, ang, w = 30, lw = 8) => { x.lineWidth = lw; x.strokeStyle = o.brow; for (const [i, cx] of ex.entries()) { const s = i ? -1 : 1; x.beginPath(); x.moveTo(cx - w / 2, ey - 36 + dy - s * ang * 12); x.lineTo(cx + w / 2, ey - 36 + dy + s * ang * 12); x.stroke() } x.lineWidth = L; x.strokeStyle = ink }
  const sweat = (n = 1) => { const ds = [[214, 70, 1], [40, 84, 0.8], [226, 116, 0.7]]; for (let i = 0; i < n; i++) { const [cx, cy, s] = ds[i]; x.fillStyle = '#8fd3ff'; x.lineWidth = 4; x.beginPath(); x.moveTo(cx, cy - 18 * s); x.quadraticCurveTo(cx + 13 * s, cy + 4 * s, cx, cy + 10 * s); x.quadraticCurveTo(cx - 13 * s, cy + 4 * s, cx, cy - 18 * s); x.fill(); x.stroke() } x.fillStyle = ink; x.lineWidth = L }
  switch (e) {
    case 'normal': case 'blink':
      if (e === 'blink') for (const cx of ex) { x.beginPath(); x.moveTo(cx - 16, ey + 4); x.quadraticCurveTo(cx, ey + 12, cx + 16, ey + 4); x.stroke() }
      else eyeOpen(15, 19, 10)
      brows(0, 0); blush(0.35)
      x.beginPath(); x.moveTo(110, 186); x.quadraticCurveTo(128, 198, 146, 186); x.stroke(); break
    case 'strain': // 我慢: ＞＜、眉間にしわ、食いしばり、真っ赤、汗
      blush(0.75, 1.25)
      x.lineWidth = 8; for (const [i, cx] of ex.entries()) { const s = i ? -1 : 1; x.beginPath(); x.moveTo(cx - s * 16, ey - 13); x.lineTo(cx + s * 12, ey + 1); x.lineTo(cx - s * 16, ey + 14); x.stroke() } x.lineWidth = L
      brows(4, -0.9, 34, 9)
      x.beginPath(); x.moveTo(128 - 6, 70); x.lineTo(128 - 2, 82); x.moveTo(128 + 6, 70); x.lineTo(128 + 2, 82); x.stroke()
      x.fillStyle = '#fff'; x.beginPath(); x.roundRect(98, 170, 60, 26, 9); x.fill(); x.stroke(); x.lineWidth = 3.5; x.beginPath(); for (const xx of [113, 128, 143]) { x.moveTo(xx, 171); x.lineTo(xx, 195) } x.moveTo(99, 183); x.lineTo(157, 183); x.stroke(); x.lineWidth = L
      sweat(2); break
    case 'panic': // 焦り: 見開き小さい瞳、八の字眉、波線の口、汗
      eyeOpen(20, 24, 6, 0, 2); brows(-10, 0.7, 30, 8)
      x.beginPath(); x.moveTo(104, 190); for (let i = 0; i <= 6; i++) x.lineTo(104 + i * 8, 190 + (i % 2 ? -7 : 5)); x.stroke()
      sweat(3); blush(0.25); break
    case 'relief': // 安堵: 弧の目、やわらかい笑顔、頬
      for (const cx of ex) { x.beginPath(); x.moveTo(cx - 17, ey + 6); x.quadraticCurveTo(cx, ey - 14, cx + 17, ey + 6); x.stroke() }
      brows(-4, 0.35, 28, 7); blush(0.6, 1.1)
      x.fillStyle = '#7a1f2b'; x.beginPath(); x.moveTo(104, 178); x.quadraticCurveTo(128, 208, 152, 178); x.quadraticCurveTo(128, 186, 104, 178); x.fill(); x.stroke(); break
    case 'busted': { // バレた: 青ざめ縦線、白目の点、大口
      x.strokeStyle = 'rgba(70,90,200,.55)'; x.lineWidth = 5; for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(70 + i * 22, 22); x.lineTo(70 + i * 22, 56 + (i % 2) * 12); x.stroke() } x.strokeStyle = ink; x.lineWidth = L
      for (const cx of ex) { x.fillStyle = '#fff'; x.beginPath(); x.ellipse(cx, ey, 21, 26, 0, 0, 7); x.fill(); x.stroke(); x.fillStyle = ink; x.beginPath(); x.arc(cx, ey + 2, 4, 0, 7); x.fill() }
      brows(-16, 0.5, 30, 8)
      x.fillStyle = '#7a1f2b'; x.beginPath(); x.ellipse(128, 190, 22, 28, 0, 0, 7); x.fill(); x.stroke(); x.fillStyle = '#e46a7a'; x.beginPath(); x.ellipse(128, 204, 13, 9, 0, 0, 7); x.fill()
      sweat(2); break
    }
    case 'smug': // ドヤ: 半目、片眉、口の端を上げる
      for (const cx of ex) { x.fillStyle = '#fff'; x.beginPath(); x.ellipse(cx, ey + 4, 16, 12, 0, 0, Math.PI); x.fill(); x.fillStyle = ink; x.beginPath(); x.arc(cx + 3, ey + 6, 8, 0, Math.PI); x.fill(); x.lineWidth = 8; x.beginPath(); x.moveTo(cx - 19, ey + 2); x.lineTo(cx + 19, ey + 2); x.stroke(); x.lineWidth = L }
      x.lineWidth = 8; x.strokeStyle = o.brow; x.beginPath(); x.moveTo(72, ey - 30); x.lineTo(102, ey - 38); x.moveTo(152, ey - 44); x.quadraticCurveTo(168, ey - 54, 184, ey - 42); x.stroke(); x.strokeStyle = ink; x.lineWidth = L
      blush(0.3)
      x.beginPath(); x.moveTo(106, 188); x.quadraticCurveTo(132, 194, 154, 176); x.stroke(); break
  }
}

// ============================================================ 共通の更新・計測
// 毎フレーム look.update(dt) を1回呼ぶ（丸影の追従）
export const look = {
  update() { for (const m of BLOBS) updateBlob(m) },
}
// fps を数える（検証用。window.__lookFps に入る）
export function startFpsMeter() {
  let n = 0, t0 = performance.now(); const f = () => { n++; const now = performance.now(); if (now - t0 >= 1000) { window.__lookFps = Math.round(n * 1000 / (now - t0)); n = 0; t0 = now } requestAnimationFrame(f) }; requestAnimationFrame(f)
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
