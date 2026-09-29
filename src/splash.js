/**
 * dsh-splash-screen —— 开屏动画本体（vanilla，无依赖，不接触 React）
 * ===========================================================================
 * 设计方向：**淡绿清晨**。亮底（奶白绿），深林绿文字保证对比度，嫩绿作为唯一信号色。
 *
 * 两个阶段：
 *   A 点阵加载　canvas 点阵把文字拆成粒子：一屏点阵先弥散，再收敛成 DEEPSEEK →
 *               HARNESS → DSH；每颗点按「最近方向」重组（贪心最近邻分配，带占用去重），
 *               所以重组是有机的，不是按下标硬飞。配合同一节奏的进度条与计数器。
 *   B 主视觉　　点阵散场，立绘从左侧淡入（低不透明度做底纹），DEEPSEEK HARNESS /
 *               DSH 字标从遮罩里升起，末段斜切滑幕出场。
 *
 * 节奏取自可公开观察的同类站点动效常量：密集交互 .3s、主视觉/开屏层 .6s，
 * 位移 24px（1.5rem）一档；进度条为方形端点的细轨 + 单一信号色填充。
 *
 * 契约：本文件只暴露 globalThis.__DSH_SPLASH__ = { createSplash, destroySplash }。
 * 它不是 ES 模块，不得出现 import/export；生成器把它内联进「注入脚本」与
 * client 半两处，两处共用同一份代码。
 *
 * 可跳过：点击 / 任意键 / 触屏 / 滚轮，或右下 SKIP。跳过不硬切，走同一条滑幕。
 * 无障碍：progressbar 语义 + aria-live；尊重 prefers-reduced-motion（静态终帧）。
 */
;(function () {
  'use strict'

  var ROOT_ID = 'dsh-splash-root'
  var STYLE_ID = 'dsh-splash-style'
  var CURRENT = null

  var C = {
    bg: '#f5f8e6',
    bgSoft: '#fbfdf2',
    ink: '#1f2a12',
    inkDim: '#55632f',
    inkFaint: '#7d8b5e',
    signal: '#4f7d24',
    signalBright: '#79ad38',
    rule: 'rgba(79,125,36,.22)',
    ruleSoft: 'rgba(79,125,36,.10)',
    dotCore: '#3f6b18',
    dotAccent: '#6fa32c',
  }

  var CSS = [
    '#' + ROOT_ID + '{position:fixed;inset:0;z-index:2147483200;overflow:hidden;',
    'background:' + C.bg + ';color:' + C.ink + ';',
    'font-family:"Segoe UI Variable Display","Segoe UI",Inter,"Helvetica Neue",Helvetica,"PingFang SC","Microsoft YaHei",Arial,sans-serif;',
    'font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;',
    'cursor:default;user-select:none;}',
    '#' + ROOT_ID + ' *{box-sizing:border-box;margin:0;padding:0;}',
    '#' + ROOT_ID + '.is-out{opacity:0;transition:opacity .55s linear;pointer-events:none;}',

    '.sp-sky{position:absolute;inset:0;background:',
    'radial-gradient(120% 96% at 14% 4%,rgba(160,205,110,.42) 0%,rgba(245,248,230,0) 58%),',
    'radial-gradient(90% 74% at 92% 100%,rgba(120,175,80,.24) 0%,rgba(245,248,230,0) 62%),',
    'linear-gradient(168deg,' + C.bgSoft + ' 0%,' + C.bg + ' 54%,#eaf0d6 100%);}',
    '.sp-rays{position:absolute;inset:-20% -10%;opacity:.5;',
    'background:repeating-linear-gradient(74deg,rgba(255,255,255,.85) 0 2px,rgba(255,255,255,0) 2px 64px);',
    'mix-blend-mode:screen;transform-origin:20% 0;will-change:transform,opacity;}',
    '.sp-grain{position:absolute;inset:0;opacity:.05;mix-blend-mode:multiply;',
    'background-image:radial-gradient(rgba(31,42,18,.9) .6px,transparent .7px);background-size:3px 3px;}',
    '.sp-vig{position:absolute;inset:0;background:radial-gradient(130% 108% at 50% 44%,transparent 52%,rgba(120,150,80,.22) 100%);}',

    '.sp-corner{position:absolute;width:40px;height:40px;border:0 solid ' + C.signal + ';opacity:0;',
    'transition:opacity .5s linear .1s,transform .6s cubic-bezier(.16,1,.3,1) .1s;}',
    '.sp-corner.tl{top:24px;left:24px;border-top-width:2px;border-left-width:2px;transform:translate(-8px,-8px);}',
    '.sp-corner.tr{top:24px;right:24px;border-top-width:2px;border-right-width:2px;transform:translate(8px,-8px);}',
    '.sp-corner.bl{bottom:24px;left:24px;border-bottom-width:2px;border-left-width:2px;transform:translate(-8px,8px);}',
    '.sp-corner.br{bottom:24px;right:24px;border-bottom-width:2px;border-right-width:2px;transform:translate(8px,8px);}',
    '#' + ROOT_ID + '.is-s1 .sp-corner{opacity:.9;transform:translate(0,0);}',

    '.sp-stage{position:absolute;inset:0;}',
    '.sp-matrix{position:absolute;inset:0;width:100%;height:100%;display:block;}',

    '.sp-readout{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);',
    'display:flex;flex-direction:column;align-items:center;gap:20px;pointer-events:none;}',
    '.sp-word{font-size:clamp(52px,10vw,150px);line-height:.82;font-weight:800;letter-spacing:-.04em;',
    'text-transform:uppercase;color:' + C.ink + ';opacity:0;',
    'transition:opacity .5s linear,transform .8s cubic-bezier(.16,1,.3,1);transform:translateY(14px);}',
    '.sp-word.on{opacity:.075;transform:translateY(0);}',
    '.sp-badge{font-family:var(--sp-mono);font-size:12px;letter-spacing:.42em;text-transform:uppercase;',
    'color:' + C.signal + ';border:1px solid ' + C.rule + ';padding:7px 14px;opacity:0;',
    'transition:opacity .4s linear;}',
    '.sp-badge.on{opacity:1;}',

    '.sp-load{position:absolute;left:0;right:0;bottom:96px;padding:0 8vw;opacity:0;',
    'transform:translateY(12px);transition:opacity .5s linear .2s,transform .7s cubic-bezier(.16,1,.3,1) .2s;}',
    '#' + ROOT_ID + '.is-s1 .sp-load{opacity:1;transform:translateY(0);}',
    '.sp-loadrow{display:flex;align-items:baseline;gap:16px;font-family:var(--sp-mono);',
    'font-size:13px;letter-spacing:.24em;text-transform:uppercase;color:' + C.inkDim + ';}',
    '.sp-loadrow .lbl{font-weight:600;color:' + C.ink + ';}',
    '.sp-loadrow .dash{flex:1;height:1px;background:' + C.rule + ';transform:translateY(-4px);}',
    '.sp-ell{color:' + C.signal + ';letter-spacing:.22em;}',
    '.sp-pct{font-family:var(--sp-mono);font-size:clamp(34px,5vw,72px);font-weight:700;line-height:.8;',
    'letter-spacing:-.04em;color:' + C.ink + ';}',
    '.sp-pct small{font-size:.28em;letter-spacing:.18em;color:' + C.inkFaint + ';margin-left:6px;vertical-align:.34em;}',
    '.sp-track{position:relative;height:3px;margin-top:14px;background:' + C.ruleSoft + ';overflow:hidden;}',
    '.sp-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,' + C.signal + ',' + C.signalBright + ');}',
    '.sp-seg{position:absolute;inset:0;display:flex;}',
    '.sp-seg i{flex:1 1 0;border-right:2px solid ' + C.bg + ';}',
    '.sp-head{position:absolute;top:-3px;width:44px;height:9px;left:0;',
    'background:linear-gradient(90deg,rgba(121,173,56,0),' + C.signalBright + ');pointer-events:none;}',
    '.sp-ticks{margin-top:9px;height:7px;opacity:.55;',
    'background-image:repeating-linear-gradient(90deg,' + C.rule + ' 0 1px,transparent 1px 16px);}',

    '.sp-top{position:absolute;top:0;left:0;right:0;height:64px;padding:0 8vw;display:flex;align-items:center;',
    'justify-content:space-between;gap:20px;font-family:var(--sp-mono);font-size:11px;letter-spacing:.2em;',
    'text-transform:uppercase;color:' + C.inkFaint + ';opacity:0;transition:opacity .5s linear .15s;}',
    '#' + ROOT_ID + '.is-s1 .sp-top{opacity:1;}',
    '.sp-top b{font-weight:700;color:' + C.inkDim + ';}',
    '.sp-top .sep{color:' + C.signal + ';}',

    /* 右侧贴图梯形：占屏更宽（能露出人物），上边窄、下边宽，左缘斜切。
       斜边用 vh 表达，这样不同窗口高度下斜率一致（约 22°）。
       左缘再叠一层渐变，让它站进背景而不是贴上去。 */
    '.sp-art{position:absolute;right:0;top:0;bottom:0;width:62vw;min-width:420px;opacity:0;pointer-events:none;',
    'transition:opacity 1.15s cubic-bezier(.16,1,.3,1),transform 1.5s cubic-bezier(.16,1,.3,1);',
    'transform:translateX(30px) scale(1.02);',
    'clip-path:polygon(64.516% 0,100% 0,100% 100%,12.903% 100%);',
    'mask-image:linear-gradient(96deg,rgba(0,0,0,.04) 0%,rgba(0,0,0,.5) 12%,#000 34%,#000 100%);',
    '-webkit-mask-image:linear-gradient(96deg,rgba(0,0,0,.04) 0%,rgba(0,0,0,.5) 12%,#000 34%,#000 100%);}',
    '.sp-art img{width:100%;height:100%;object-fit:cover;object-position:center top;display:block;}',
    /* 0.3 上下调：图会淡到「看得出是图，但不抢字标」的程度 */
    '#' + ROOT_ID + '.is-art .sp-art{opacity:.3;transform:translateX(0) scale(1);}',
    '.sp-artfallback{position:absolute;inset:0;background:',
    'linear-gradient(190deg,rgba(160,205,110,.5) 0%,rgba(121,173,56,.42) 42%,rgba(79,125,36,.34) 100%);}',

    '.sp-brand{position:absolute;left:8vw;top:50%;transform:translateY(-50%);width:min(44vw,600px);',
    'text-align:left;opacity:0;pointer-events:none;transition:opacity .6s linear .1s;}',
    '#' + ROOT_ID + '.is-art .sp-brand{opacity:1;}',
    '.sp-brand .k{display:flex;align-items:center;justify-content:flex-start;gap:12px;margin-bottom:14px;',
    'font-family:var(--sp-mono);font-size:11px;letter-spacing:.36em;text-transform:uppercase;color:' + C.signal + ';}',
    '.sp-brand .k i{display:block;width:0;height:2px;background:' + C.signal + ';order:-1;',
    'transition:width .9s cubic-bezier(.16,1,.3,1) .25s;}',
    '#' + ROOT_ID + '.is-art .sp-brand .k i{width:76px;}',
    '.sp-title{font-size:clamp(36px,6.2vw,96px);line-height:.84;font-weight:800;letter-spacing:-.045em;',
    'text-transform:uppercase;color:' + C.ink + ';}',
    '.sp-title .row{display:block;overflow:hidden;}',
    '.sp-title .row > span{display:block;transform:translateY(112%);',
    'transition:transform 1s cubic-bezier(.16,1,.3,1);}',
    '#' + ROOT_ID + '.is-art .sp-title .row > span{transform:translateY(0);}',
    '.sp-title .row:nth-child(2) > span{transition-delay:.1s;}',
    '.sp-title .thin{font-weight:200;color:' + C.inkDim + ';}',
    '.sp-title .accent{color:' + C.signal + ';font-weight:600;}',
    '.sp-brand .r{position:relative;margin-top:26px;height:2px;background:' + C.rule + ';',
    'transform:scaleX(0);transform-origin:0 50%;',
    'transition:transform 1s cubic-bezier(.16,1,.3,1) .3s;}',
    '#' + ROOT_ID + '.is-art .sp-brand .r{transform:scaleX(1);}',
    '.sp-brand .r b{position:absolute;left:0;top:0;width:130px;height:2px;background:' + C.signalBright + ';}',
    '.sp-brand .tags{margin-top:16px;display:flex;flex-wrap:wrap;justify-content:flex-start;gap:8px 12px;',
    'font-family:var(--sp-mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:' + C.inkFaint + ';}',
    '.sp-brand .tags u{text-decoration:none;border:1px solid ' + C.rule + ';padding:5px 10px;color:' + C.inkDim + ';}',
    '.sp-brand .rmeta{margin-top:14px;display:flex;justify-content:flex-start;gap:22px;',
    'font-family:var(--sp-mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:' + C.inkFaint + ';}',

    '.sp-type{position:absolute;left:8vw;bottom:100px;font-family:var(--sp-mono);font-size:12px;',
    'letter-spacing:.14em;color:' + C.inkDim + ';opacity:0;transition:opacity .4s linear;}',
    '.sp-type.on{opacity:1;}',
    '.sp-ctl{position:absolute;right:8vw;bottom:28px;display:flex;gap:8px;font-family:var(--sp-mono);',
    'font-size:11px;letter-spacing:.2em;text-transform:uppercase;opacity:0;transition:opacity .4s linear .3s;}',
    '#' + ROOT_ID + '.is-s1 .sp-ctl{opacity:1;}',
    '.sp-btn{appearance:none;background:rgba(255,255,255,.6);border:1px solid ' + C.rule + ';color:' + C.inkDim + ';',
    'padding:8px 14px;cursor:pointer;font:inherit;letter-spacing:.2em;text-transform:uppercase;',
    'transition:background .2s linear,color .2s linear,border-color .2s linear;}',
    '.sp-btn:hover{background:' + C.signal + ';border-color:' + C.signal + ';color:' + C.bgSoft + ';}',
    '.sp-btn:focus-visible{outline:2px solid ' + C.signal + ';outline-offset:2px;}',
    '.sp-hint{position:absolute;left:8vw;bottom:28px;font-family:var(--sp-mono);font-size:11px;',
    'letter-spacing:.2em;text-transform:uppercase;color:' + C.inkFaint + ';opacity:0;transition:opacity .5s linear .4s;}',
    '#' + ROOT_ID + '.is-s1 .sp-hint{opacity:.9;}',
    '.sp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}',

    '.sp-wipe{position:absolute;inset:0;pointer-events:none;overflow:hidden;}',
    '.sp-wipe i{position:absolute;top:-10%;bottom:-10%;transform:translateX(-190%) skewX(-12deg);}',
    '.sp-wipe i:nth-child(1){left:0;width:52%;background:linear-gradient(90deg,rgba(79,125,36,0),rgba(121,173,56,.5) 60%,rgba(255,255,255,.95));}',
    '.sp-wipe i:nth-child(2){left:22%;width:34%;background:linear-gradient(90deg,rgba(121,173,56,0),rgba(255,255,255,.8));}',
    '.sp-wipe i:nth-child(3){left:44%;width:22%;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(79,125,36,.35));}',
    '#' + ROOT_ID + '.is-out .sp-wipe i{transform:translateX(360%) skewX(-12deg);',
    'transition:transform .62s cubic-bezier(.72,0,.28,1);}',
    '#' + ROOT_ID + '.is-out .sp-wipe i:nth-child(2){transition-delay:.06s;}',
    '#' + ROOT_ID + '.is-out .sp-wipe i:nth-child(3){transition-delay:.12s;}',

    '@media (max-width:860px){',
    '.sp-art{width:100vw;min-width:0;clip-path:polygon(58% 0,100% 0,100% 100%,20% 100%);opacity:0;}',
    '#' + ROOT_ID + '.is-art .sp-art{opacity:.22;}',
    '.sp-brand{width:84vw;left:6vw;}.sp-brand .rmeta{display:none;}',
    '.sp-title{font-size:clamp(30px,9vw,54px);}',
    '.sp-top,.sp-load{padding-left:6vw;padding-right:6vw;}.sp-hint{display:none;}',
    '.sp-ctl{right:6vw;}.sp-type{left:6vw;}',
    '}',
    '@media (prefers-reduced-motion:reduce){',
    '#' + ROOT_ID + ' *{transition-duration:1ms !important;}',
    '}',
  ].join('')

  var HTML = [
    '<div class="sp-sky"></div>',
    '<div class="sp-rays"></div>',
    '<div class="sp-grain"></div>',
    '<div class="sp-vig"></div>',
    '<div class="sp-corner tl"></div><div class="sp-corner tr"></div>',
    '<div class="sp-corner bl"></div><div class="sp-corner br"></div>',

    '<div class="sp-top">',
    '<div><b>DEEPSEEK&nbsp;HARNESS</b>&nbsp;<span class="sep">//</span>&nbsp;LOCAL&nbsp;RUNTIME</div>',
    '<div><span data-sp-clock>--:--:--</span>&nbsp;<span class="sep">//</span>&nbsp;SESSION&nbsp;01/01</div>',
    '</div>',

    '<div class="sp-art" data-sp-art><div class="sp-artfallback"></div></div>',

    '<div class="sp-stage"><canvas class="sp-matrix" data-sp-canvas></canvas></div>',

    '<div class="sp-readout">',
    '<div class="sp-word" data-sp-word>DEEPSEEK</div>',
    '<div class="sp-badge" data-sp-badge>LOADING LOCAL RUNTIME</div>',
    '</div>',

    '<div class="sp-brand">',
    '<div class="k"><span>LOCAL&nbsp;AGENT&nbsp;RUNTIME</span><i></i></div>',
    '<div class="sp-title">',
    '<span class="row"><span>DEEPSEEK</span></span>',
    '<span class="row"><span class="thin">HARNESS</span><span class="accent">&nbsp;DSH</span></span>',
    '</div>',
    '<div class="r"><b></b></div>',
    '<div class="tags"><u>THEME / MORNING GREEN</u><u>EVERYTHING IS A PLUGIN</u></div>',
    '<div class="rmeta"><span data-sp-clock2>--:--:--</span><span>PLUGIN / SPLASH SCREEN</span></div>',
    '</div>',

    '<div class="sp-load">',
    '<div class="sp-loadrow">',
    '<span class="lbl">LOADING</span><span>-</span>',
    '<span data-sp-status>INITIALIZING</span>',
    '<span class="dash"></span>',
    '<span class="sp-ell" data-sp-ell>......</span>',
    '</div>',
    '<div class="sp-track">',
    '<span class="sp-fill" data-sp-fill></span>',
    '<span class="sp-head" data-sp-head></span>',
    '<span class="sp-seg" data-sp-seg></span>',
    '</div>',
    '<div class="sp-ticks"></div>',
    '<div style="display:flex;justify-content:flex-end;margin-top:10px">',
    '<div class="sp-pct"><span data-sp-pct>000</span><small>%</small></div>',
    '</div>',
    '</div>',

    '<div class="sp-type" data-sp-type></div>',
    '<div class="sp-hint">CLICK OR PRESS ANY KEY TO SKIP</div>',
    '<div class="sp-ctl">',
    '<button class="sp-btn" type="button" data-sp-sound>SOUND OFF</button>',
    '<button class="sp-btn" type="button" data-sp-skip>SKIP</button>',
    '</div>',
    '<div class="sp-wipe"><i></i><i></i><i></i></div>',
    '<div class="sp-sr" role="status" aria-live="polite" data-sp-live>DeepSeek Harness 正在启动</div>',
  ].join('')

  /** 阶段 A 的形态序列：每项是要「点阵化」的文字 + 停留/重组节奏（ms）。 */
  var SHAPES = [
    { text: 'DEEPSEEK', hold: 900, morph: 820 },
    { text: 'HARNESS', hold: 760, morph: 780 },
    { text: 'DSH', hold: 700, morph: 700 },
  ]

  var TYPE_LINES = [
    'INITIALIZING LOCAL RUNTIME',
    'MOUNTING PLUGIN SURFACE',
    'APPEARANCE / MORNING GREEN',
    'HANDING OVER TO WORKSPACE',
  ]

  var STAGES = [
    { at: 0, value: 6, ms: 480 },
    { at: 620, value: 28, ms: 700 },
    { at: 1500, value: 52, ms: 760 },
    { at: 2350, value: 78, ms: 620 },
    { at: 3050, value: 94, ms: 520 },
    { at: 3650, value: 100, ms: 380 },
  ]

  var STATUS = [
    { at: 700, text: 'RESOLVING RUNTIME' },
    { at: 1600, text: 'LOADING PLUGIN SURFACE' },
    { at: 2450, text: 'APPLYING APPEARANCE' },
    { at: 3150, text: 'HANDING OVER' },
    { at: 3700, text: 'READY' },
  ]

  var ELL = ['......', '.....', '....', '...', '....', '.....']
  var TOTAL_MS = 4200
  var EXIT_MS = 620
  var ART_AT = 3050

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3)
  }
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v
  }

  /* ------------------------------------------------------------------ 音效 */
  function makeAudio(isMuted) {
    var ac = null
    function ensure() {
      if (ac) return ac
      var Ctor = window.AudioContext || window.webkitAudioContext
      if (!Ctor) return null
      try {
        ac = new Ctor()
      } catch (err) {
        ac = null
      }
      return ac
    }
    function resume(a) {
      if (a && a.state === 'suspended') {
        try {
          a.resume()
        } catch (err) {
          /* 忽略 */
        }
      }
    }
    function tone(freq, delay, dur, peak, type) {
      if (isMuted()) return
      var a = ensure()
      if (!a) return
      resume(a)
      var t0 = a.currentTime + delay
      var osc = a.createOscillator()
      var gain = a.createGain()
      osc.type = type || 'sine'
      osc.frequency.setValueAtTime(freq, t0)
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(gain)
      gain.connect(a.destination)
      osc.start(t0)
      osc.stop(t0 + dur + 0.03)
    }
    function air(delay, dur, peak) {
      if (isMuted()) return
      var a = ensure()
      if (!a) return
      resume(a)
      var frames = Math.max(1, Math.floor(a.sampleRate * dur))
      var buffer = a.createBuffer(1, frames, a.sampleRate)
      var data = buffer.getChannelData(0)
      for (var i = 0; i < frames; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 2.4)
      }
      var src = a.createBufferSource()
      var band = a.createBiquadFilter()
      var gain = a.createGain()
      band.type = 'bandpass'
      band.Q.value = 0.9
      band.frequency.setValueAtTime(520, a.currentTime + delay)
      band.frequency.exponentialRampToValueAtTime(2800, a.currentTime + delay + dur)
      gain.gain.setValueAtTime(0.0001, a.currentTime + delay)
      gain.gain.exponentialRampToValueAtTime(peak, a.currentTime + delay + 0.08)
      gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + delay + dur)
      src.buffer = buffer
      src.connect(band)
      band.connect(gain)
      gain.connect(a.destination)
      src.start(a.currentTime + delay)
    }
    return {
      unlock: function () {
        resume(ensure())
      },
      start: function () {
        air(0, 0.9, 0.05)
        tone(392.0, 0.05, 1.1, 0.05)
        tone(587.33, 0.1, 0.95, 0.035)
      },
      blip: function () {
        tone(660, 0, 0.16, 0.03, 'triangle')
      },
      skip: function () {
        tone(320, 0, 0.2, 0.03, 'triangle')
        tone(180, 0.05, 0.26, 0.025, 'triangle')
      },
      end: function () {
        air(0, 0.55, 0.045)
        tone(783.99, 0.02, 0.6, 0.03)
      },
    }
  }

  /* -------------------------------------------------------------- 点阵引擎 */
  /**
   * 点阵：把文字渲染到离屏画布，按网格采样出「槽位」，再把现有粒子按
   * **最近方向**分配到槽位（贪心最近邻 + 占用去重 + 网格分桶加速）。
   *
   * 为什么不用下标映射：按下标分配会让点飞成面条，看不出字；最近邻分配让每颗点
   * 走最短路径，重组过程像液体收拢成字——这是这个效果的关键观感。
   */
  function createMatrix(canvas) {
    var ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return null

    var dpr = 1
    var w = 0
    var h = 0
    var pitch = 18
    var dots = []
    var running = true
    var t0 = 0
    var shapeIndex = 0
    var shapeAt = 0
    var raf = 0
    var lastFrame = 0
    var heavyStreak = 0

    function resize() {
      dpr = clamp(window.devicePixelRatio || 1, 1, 2)
      w = canvas.clientWidth || window.innerWidth
      h = canvas.clientHeight || window.innerHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      pitch = w < 720 ? 12 : w < 1200 ? 12 : 13
      seed()
      applyShape(shapeIndex)
    }

    function seed() {
      var cols = Math.floor(w / pitch) + 1
      var rows = Math.floor(h / pitch) + 1
      var count = cols * rows
      // 点数预算：预算内 60fps 才稳（fillRect 批量画方点，比 arc 快一个量级）。
      // 上限从 2200 收到 1600：真机在应用挂载那几秒主线程很挤，少画点更稳。
      var keep = Math.min(count, 1600)
      var step = Math.max(1, Math.ceil(count / keep))
      dots = []
      for (var i = 0; i < count; i += step) {
        var cx = (i % cols) * pitch + pitch / 2
        var cy = Math.floor(i / cols) * pitch + pitch / 2
        dots.push({
          x: cx + (Math.random() - 0.5) * pitch * 4,
          y: cy + (Math.random() - 0.5) * pitch * 4,
          homeX: cx,
          homeY: cy,
          tx: cx,
          ty: cy,
          vx: 0,
          vy: 0,
          r: 1.5,
          accent: Math.random() < 0.14,
          delay: 0,
          idle: false,
        })
      }
    }

    /** 把一段文字渲染成槽位坐标（屏幕坐标），按网格采样字的像素。 */
    function slotsFor(text) {
      var off = document.createElement('canvas')
      var octx = off.getContext('2d')
      if (!octx) return []
      var W = Math.max(1, Math.floor(w))
      var H = Math.max(1, Math.floor(h))
      off.width = W
      off.height = H
      octx.fillStyle = '#000'
      octx.textAlign = 'center'
      octx.textBaseline = 'middle'
      var size = clamp(Math.min(W / (text.length * 0.6), H * 0.34), 44, 320)
      octx.font = '800 ' + Math.round(size) + 'px "Segoe UI Variable Display","Segoe UI",Inter,Arial,sans-serif'
      var cy = H * 0.46
      var measured = octx.measureText(text).width
      var squeeze = clamp((W * 0.84) / (measured || 1), 0.35, 1)
      octx.save()
      octx.translate(W / 2, cy)
      octx.scale(squeeze, 1)
      octx.fillText(text, 0, 0)
      octx.restore()

      var data
      try {
        data = octx.getImageData(0, 0, W, H).data
      } catch (err) {
        return []
      }
      var cell = Math.max(4, Math.round(pitch * 0.52))
      var out = []
      for (var y = 0; y < H; y += cell) {
        for (var x = 0; x < W; x += cell) {
          if (data[(y * W + x) * 4 + 3] > 130) out.push({ x: x + cell / 2, y: y + cell / 2 })
        }
      }
      return out
    }

    /** 贪心最近邻分配：环形扩网格找最近未占用槽位。 */
    function assign(slots) {
      var used = new Uint8Array(slots.length)
      var bucket = 64
      var grid = new Map()
      for (var s = 0; s < slots.length; s += 1) {
        var key = (Math.floor(slots[s].x / bucket) << 12) ^ Math.floor(slots[s].y / bucket)
        var list = grid.get(key)
        if (!list) grid.set(key, (list = []))
        list.push(s)
      }
      for (var d = 0; d < dots.length; d += 1) {
        var dot = dots[d]
        var bx = Math.floor(dot.x / bucket)
        var by = Math.floor(dot.y / bucket)
        var best = -1
        var bestDist = Infinity
        for (var ring = 0; ring <= 6 && best === -1; ring += 1) {
          for (var gx = bx - ring; gx <= bx + ring; gx += 1) {
            for (var gy = by - ring; gy <= by + ring; gy += 1) {
              if (ring > 0 && Math.abs(gx - bx) !== ring && Math.abs(gy - by) !== ring) continue
              var cand = grid.get((gx << 12) ^ gy)
              if (!cand) continue
              for (var c = 0; c < cand.length; c += 1) {
                var idx = cand[c]
                if (used[idx]) continue
                var dx = slots[idx].x - dot.x
                var dy = slots[idx].y - dot.y
                var dist = dx * dx + dy * dy
                if (dist < bestDist) {
                  bestDist = dist
                  best = idx
                }
              }
            }
          }
        }
        if (best === -1) {
          dot.tx = dot.homeX
          dot.ty = dot.homeY
          dot.r = 1.0
        } else {
          used[best] = 1
          dot.tx = slots[best].x
          dot.ty = slots[best].y
          dot.r = 1.5
        }
        // 对角 stagger：从左上到右下依次启程，读起来是「被扫出来的」
        dot.delay = ((dot.x + dot.y) / Math.max(1, w + h)) * 170
        dot.idle = false
      }
    }

    function applyShape(i) {
      var slots = slotsFor(SHAPES[i % SHAPES.length].text)
      if (slots.length === 0) return
      assign(slots)
    }

    function frame(now) {
      if (!running) return
      // 帧时间自适应：真机在应用挂载那几秒会抢主线程，固定步长会越积越卡。
      // 这里按真实 dt 缩放（夹到 1/30s 上限），并在持续掉帧时降载。
      if (lastFrame === 0) lastFrame = now
      var dt = Math.min(33, Math.max(0, now - lastFrame))
      lastFrame = now

      if (dt > 22) heavyStreak += 1
      else heavyStreak = Math.max(0, heavyStreak - 1)
      // 连续掉帧就抽稀：每帧只积分一部分点，视觉上仍是整体收拢
      var stride = heavyStreak > 8 ? 2 : 1

      if (t0 === 0) {
        t0 = now
        shapeAt = now
        applyShape(0)
      }
      var shape = SHAPES[shapeIndex % SHAPES.length]
      if (now - shapeAt >= shape.hold + shape.morph) {
        shapeIndex += 1
        shapeAt = now
        applyShape(shapeIndex)
      }
      var morphing = now - shapeAt < SHAPES[shapeIndex % SHAPES.length].morph

      ctx.clearRect(0, 0, w, h)
      var base = morphing ? 0.09 : 0.05
      var ease = 1 - Math.pow(1 - base, dt / 16.667)
      for (var i = 0; i < dots.length; i += 1) {
        var dot = dots[i]
        if (!dot.idle && (stride === 1 || i % stride === 0)) {
          if (now - shapeAt >= dot.delay) {
            dot.vx = (dot.vx + (dot.tx - dot.x) * ease) * 0.72
            dot.vy = (dot.vy + (dot.ty - dot.y) * ease) * 0.72
            dot.x += dot.vx
            dot.y += dot.vy
            // 到位即休眠：睡着的点不再参与积分，空闲时几乎零成本
            if (Math.abs(dot.tx - dot.x) < 0.2 && Math.abs(dot.ty - dot.y) < 0.2) {
              dot.x = dot.tx
              dot.y = dot.ty
              dot.vx = 0
              dot.vy = 0
              dot.idle = true
            }
          } else {
            dot.x += dot.vx
            dot.y += dot.vy
            dot.vx *= 0.94
            dot.vy *= 0.94
          }
        }
        var px = dot.x
        var py = dot.y
        if (dot.idle && !morphing) {
          py += Math.sin((now + i * 37) / 900) * 0.45
        }
        var r = dot.r
        ctx.fillStyle = dot.accent ? C.dotAccent : C.dotCore
        ctx.globalAlpha = 0.72
        // 方点代替圆点：2px 尺度下肉眼无差，绘制快一个量级
        ctx.fillRect(px - r, py - r, r * 2, r * 2)
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }

    return {
      start: function () {
        resize()
        window.addEventListener('resize', resize)
        raf = requestAnimationFrame(frame)
      },
      /** 交棒时把点阵整体推散：能量感的来源之一。 */
      burst: function (level) {
        for (var i = 0; i < dots.length; i += 1) {
          var a = Math.random() * 6.2832
          dots[i].tx = dots[i].x + Math.cos(a) * (60 + Math.random() * 240) * level
          dots[i].ty = dots[i].y + Math.sin(a) * (60 + Math.random() * 240) * level
          dots[i].r = 1.0
        }
      },
      stop: function () {
        running = false
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', resize)
      },
    }
  }

  /* ---------------------------------------------------------------- 主流程 */
  function createSplash(options) {
    var opts = options || {}
    var doc = document
    var rootEl = doc.documentElement
    var owner = String(opts.owner || 'anon')

    // 单实例：上一次实例残留时先清掉（含样式），避免两套动画互盖。
    var stale = doc.getElementById(ROOT_ID)
    if (stale) {
      if (stale.parentNode) stale.parentNode.removeChild(stale)
      var staleStyle = doc.getElementById(STYLE_ID)
      if (staleStyle && staleStyle.parentNode) staleStyle.parentNode.removeChild(staleStyle)
    }

    var reduced = false
    try {
      reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    } catch (err) {
      reduced = false
    }

    var style = doc.createElement('style')
    style.id = STYLE_ID
    // 制式等宽字族在这里定义，省得 CSS 里再拼一长串
    style.textContent =
      '#' + ROOT_ID + '{--sp-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;}' +
      CSS
    doc.head.appendChild(style)

    var host = doc.createElement('div')
    host.id = ROOT_ID
    host.setAttribute('data-sp-owner', owner)
    host.setAttribute('role', 'progressbar')
    host.setAttribute('aria-label', 'DeepSeek Harness 正在启动')
    host.setAttribute('aria-valuemin', '0')
    host.setAttribute('aria-valuemax', '100')
    host.setAttribute('aria-valuenow', '0')
    var box = doc.createElement('div')
    box.innerHTML = HTML
    while (box.firstChild) host.appendChild(box.firstChild)
    ;(opts.mount || doc.body || rootEl).appendChild(host)

    var q = function (sel) {
      return host.querySelector(sel)
    }
    var canvas = q('[data-sp-canvas]')
    var wordEl = q('[data-sp-word]')
    var badgeEl = q('[data-sp-badge]')
    var typeEl = q('[data-sp-type]')
    var fillEl = q('[data-sp-fill]')
    var headEl = q('[data-sp-head]')
    var segEl = q('[data-sp-seg]')
    var pctEl = q('[data-sp-pct]')
    var statusEl = q('[data-sp-status]')
    var ellEl = q('[data-sp-ell]')
    var clockEls = [q('[data-sp-clock]'), q('[data-sp-clock2]')]
    var liveEl = q('[data-sp-live]')
    var soundBtn = q('[data-sp-sound]')
    var skipBtn = q('[data-sp-skip]')
    var artEl = q('[data-sp-art]')

    // 进度条分段：40 段 + 底色缝，做出制式刻度感
    if (segEl) {
      var segHtml = ''
      for (var s = 0; s < 40; s += 1) segHtml += '<i></i>'
      segEl.innerHTML = segHtml
    }

    var timers = []
    var frames = []
    function later(fn, ms) {
      var id = setTimeout(fn, ms)
      timers.push(id)
      return id
    }
    function frame(fn) {
      var id = requestAnimationFrame(fn)
      frames.push(id)
      return id
    }

    var muted = false
    try {
      muted = !!(window.localStorage && opts.muteKey && window.localStorage.getItem(opts.muteKey) === '1')
    } catch (err) {
      muted = false
    }
    var audio = makeAudio(function () {
      return muted || reduced
    })

    var done = false
    var matrix = reduced ? null : createMatrix(canvas)
    var previousOverflow = rootEl.style.overflow

    function tickClock() {
      if (done) return
      var d = new Date()
      var pad = function (n) {
        return (n < 10 ? '0' : '') + n
      }
      var text = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
      for (var i = 0; i < clockEls.length; i += 1) if (clockEls[i]) clockEls[i].textContent = text
      later(tickClock, 1000)
    }

    function tickEll() {
      if (done) return
      ellEl.textContent = ELL[Math.floor(Math.random() * ELL.length)]
      later(tickEll, 200)
    }

    function tickType() {
      if (done) return
      var li = 0
      var ci = 0
      var hold = 0
      var step = function (now) {
        if (done) return
        var line = TYPE_LINES[li]
        if (now >= hold) {
          if (ci < line.length) {
            ci += 1
            typeEl.textContent = line.slice(0, ci)
          } else if (li < TYPE_LINES.length - 1) {
            li += 1
            ci = 0
            hold = now + 180
          }
        }
        frame(step)
      }
      typeEl.classList.add('on')
      frame(step)
    }

    var progressValue = 0
    function drawProgress(value) {
      progressValue = value
      // 不补零：官网的 SSR 初态就是 `0%` 而不是 `00%`（补零只用于 `00 / 05` 这类分节序号）
      pctEl.textContent = String(Math.round(value))
      fillEl.style.width = value + '%'
      var track = fillEl.parentNode
      var tw = track ? track.clientWidth : 0
      headEl.style.left = clamp((value / 100) * tw - 22, 0, Math.max(0, tw - 44)) + 'px'
      host.setAttribute('aria-valuenow', String(Math.round(value)))
    }

    function startProgress() {
      var idx = 0
      var segStart = 0
      var from = 0
      var startedAt = 0
      var step = function (now) {
        if (done) return
        if (startedAt === 0) {
          startedAt = now
          segStart = now
        }
        var elapsed = now - startedAt
        while (idx + 1 < STAGES.length && elapsed >= STAGES[idx + 1].at) {
          from = progressValue
          idx += 1
          segStart = now
        }
        var cur = STAGES[idx]
        var local = clamp((now - segStart) / cur.ms, 0, 1)
        drawProgress(from + (cur.value - from) * easeOutCubic(local))
        frame(step)
      }
      frame(step)
    }

    /** 形态文字层：与点阵同步换字，强化「被读出来」的节奏。 */
    function cycleWords() {
      var at = 260
      SHAPES.forEach(function (shape) {
        later(function () {
          if (done) return
          wordEl.textContent = shape.text
          wordEl.classList.add('on')
          later(function () {
            wordEl.classList.remove('on')
          }, shape.hold + shape.morph - 120)
        }, at)
        at += shape.hold + shape.morph
      })
    }

    /* 右侧贴图：延迟到 B 阶段才真正去取。
       注入脚本跑得比宿主路由注册早，若此刻就 <img src> 会吃到一个 404 并把图永久
       丢掉；所以这里只记住地址，等交棒那一刻再挂 img。 */
    var artSrc = String(opts.artSrc || '').trim()
    function loadArt() {
      if (!artSrc || artEl.getAttribute('data-sp-art-loaded') === '1') return
      artEl.setAttribute('data-sp-art-loaded', '1')
      var img = doc.createElement('img')
      img.alt = ''
      img.decoding = 'async'
      img.addEventListener('load', function () {
        // 诊断：把「有没有真的拿到图、拿到多大」写到属性上，方便排查
        artEl.setAttribute('data-sp-art-status', 'ok')
        artEl.setAttribute('data-sp-art-natural', img.naturalWidth + 'x' + img.naturalHeight)
      })
      img.addEventListener('error', function () {
        // 图挂了就退回程序化底，绝不留下破图
        artEl.setAttribute('data-sp-art-status', 'error')
        if (img.parentNode) img.parentNode.removeChild(img)
      })
      img.src = artSrc
      artEl.insertBefore(img, artEl.firstChild)
    }

    function onSkip(event) {
      if (event) {
        event.preventDefault()
        event.stopPropagation()
      }
      finish('skip')
    }
    function detach() {
      window.removeEventListener('keydown', onSkip, true)
      window.removeEventListener('pointerdown', onSkip, true)
      window.removeEventListener('wheel', onSkip, true)
      window.removeEventListener('touchstart', onSkip, true)
    }

    function finish(reason) {
      if (done) return
      done = true
      for (var i = 0; i < timers.length; i += 1) clearTimeout(timers[i])
      for (var j = 0; j < frames.length; j += 1) cancelAnimationFrame(frames[j])
      timers.length = 0
      frames.length = 0
      detach()
      if (matrix) matrix.stop()
      if (reason === 'skip') audio.skip()
      else if (reason === 'done') audio.end()
      host.setAttribute('data-sp-exit', reason || 'done')
      host.classList.add('is-out')
      rootEl.style.overflow = previousOverflow
      setTimeout(
        function () {
          if (host.parentNode) host.parentNode.removeChild(host)
          if (style.parentNode) style.parentNode.removeChild(style)
          if (CURRENT && CURRENT.host === host) CURRENT = null
          if (opts.onDone) {
            try {
              opts.onDone(reason)
            } catch (err) {
              /* 回调异常不影响收尾 */
            }
          }
        },
        reduced ? 40 : EXIT_MS + 140,
      )
    }

    function renderSound() {
      soundBtn.textContent = muted ? 'SOUND OFF' : 'SOUND ON'
      soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true')
    }
    soundBtn.addEventListener('click', function (event) {
      event.stopPropagation()
      event.preventDefault()
      muted = !muted
      try {
        if (window.localStorage && opts.muteKey) {
          window.localStorage.setItem(opts.muteKey, muted ? '1' : '0')
        }
      } catch (err) {
        /* 忽略 */
      }
      renderSound()
      if (!muted) {
        audio.unlock()
        audio.blip()
      }
    })
    skipBtn.addEventListener('click', onSkip)
    window.addEventListener('keydown', onSkip, true)
    window.addEventListener('pointerdown', onSkip, true)
    window.addEventListener('wheel', onSkip, true)
    window.addEventListener('touchstart', onSkip, true)

    rootEl.style.overflow = 'hidden'

    renderSound()
    tickClock()
    tickEll()
    tickType()
    startProgress()
    cycleWords()
    if (matrix) matrix.start()

    if (reduced) {
      host.classList.add('is-s1', 'is-art')
      loadArt()
      drawProgress(100)
      statusEl.textContent = 'READY'
      typeEl.textContent = TYPE_LINES[TYPE_LINES.length - 1]
      badgeEl.classList.add('on')
      wordEl.classList.add('on')
      later(function () {
        finish('done')
      }, 1100)
    } else {
      later(function () {
        host.classList.add('is-s1')
        audio.start()
      }, 240)
      later(function () {
        badgeEl.classList.add('on')
      }, 700)
      later(function () {
        // 交棒：点阵先爆散再冻结，随后才让贴图开始解码。
        // 三件事（爆散、图解码、React 挂载）原本撞在同一帧上，真机会卡；这里错开。
        if (matrix) {
          matrix.burst(1)
          matrix.stop()
        }
        host.classList.add('is-art')
        if (liveEl) liveEl.textContent = '主视觉'
        later(loadArt, 120)
      }, ART_AT)
      later(function () {
        if (liveEl) liveEl.textContent = '交棒'
      }, 3600)
      later(function () {
        finish('done')
      }, TOTAL_MS)
    }

    STATUS.forEach(function (item) {
      later(function () {
        if (done) return
        statusEl.textContent = item.text
        if (liveEl) liveEl.textContent = item.text
      }, item.at)
    })

    CURRENT = { host: host, owner: owner, finish: finish }
    return CURRENT
  }

  function destroySplash() {
    if (CURRENT) {
      try {
        CURRENT.finish('destroy')
      } catch (err) {
        /* 忽略 */
      }
      CURRENT = null
    }
    var host = document.getElementById(ROOT_ID)
    if (host && host.parentNode) host.parentNode.removeChild(host)
    var style = document.getElementById(STYLE_ID)
    if (style && style.parentNode) style.parentNode.removeChild(style)
  }

  globalThis.__DSH_SPLASH__ = { createSplash: createSplash, destroySplash: destroySplash }
})()
