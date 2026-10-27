/* 自动生成：政策抽卡样式。改这里，不要改 core。 */
(function () {
  'use strict';
  // 政策抽卡（内测）的全部样式。由 core 注入 <style>。
  window.__fiefCssPolicy = String.raw`  /* ================= 政策抽卡（内测）· 特效层 ================= */

  /* ---- 关键帧 ---- */
  @keyframes fl-deal {
    0%   { opacity: 0; transform: translateY(34px) rotateY(-72deg) scale(.82); filter: blur(6px); }
    55%  { opacity: 1; transform: translateY(-6px) rotateY(8deg) scale(1.03); filter: blur(0); }
    78%  { transform: translateY(2px) rotateY(-3deg) scale(.995); }
    100% { opacity: 1; transform: none; filter: none; }
  }
  @keyframes fl-sheen {
    0%   { transform: translateX(-130%) skewX(-18deg); opacity: 0; }
    18%  { opacity: .85; }
    100% { transform: translateX(230%) skewX(-18deg); opacity: 0; }
  }
  @keyframes fl-part {
    0%   { opacity: 1; transform: translate(0,0) scale(1); }
    100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(.2); }
  }
  @keyframes fl-ring {
    0%   { transform: scale(.7); opacity: .85; }
    100% { transform: scale(2.1); opacity: 0; }
  }
  @keyframes fl-breathe {
    0%, 100% { opacity: .32; }
    50%      { opacity: .78; }
  }
  @keyframes fl-pop {
    0%   { transform: scale(1); }
    38%  { transform: scale(1.055); }
    100% { transform: scale(1); }
  }
  @keyframes fl-float {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50%      { transform: translateY(-9px) rotate(180deg); }
  }
  @keyframes fl-drawshine {
    0%   { background-position: -220% 0; }
    100% { background-position: 220% 0; }
  }
  @keyframes fl-fired {
    0%   { box-shadow: 0 0 0 0 rgba(var(--fl-accent-rgb), .7); }
    100% { box-shadow: 0 0 0 26px rgba(var(--fl-accent-rgb), 0); }
  }

  /* ---- 抽卡按钮 ---- */
  .fl-drawbtn {
    position: relative; overflow: hidden;
    background: linear-gradient(100deg,
      rgba(var(--fl-accent-rgb), .22) 0%,
      rgba(var(--fl-accent-rgb), .42) 40%,
      rgba(var(--fl-accent-rgb), .22) 60%,
      rgba(var(--fl-accent-rgb), .42) 100%);
    background-size: 220% 100%;
    border-color: rgba(var(--fl-accent-rgb), .6);
    color: #fff3cf; letter-spacing: 3px; font-weight: 600;
    animation: fl-drawshine 4.5s linear infinite;
  }
  .fl-drawbtn:hover {
    border-color: var(--fl-accent);
    box-shadow: 0 0 18px rgba(var(--fl-accent-rgb), .45), 0 0 0 1px rgba(var(--fl-accent-rgb), .3) inset;
  }
  .fl-drawbtn span { position: relative; z-index: 1; }

  /* ---- 类别条 ---- */
  .fl-pcat {
    --fl-pc: var(--fl-accent);
    position: relative; overflow: hidden;
    transition: color .18s, border-color .18s, background .18s, transform .18s, box-shadow .2s;
  }
  .fl-pcat b { font-weight: 400; }
  .fl-pcat:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,.4); }
  .fl-pcat.on {
    color: var(--fl-pc);
    border-color: var(--fl-pc);
    background: var(--fl-pc-14);
    box-shadow: 0 0 14px var(--fl-pc-30), 0 0 0 1px var(--fl-pc-30) inset;
  }
  .fl-pcat.on::after {
    content: ""; position: absolute; left: 6px; right: 6px; bottom: 0; height: 1px;
    background: var(--fl-pc); box-shadow: 0 0 6px var(--fl-pc);
  }

  /* ---- 手牌区 ---- */
  .fl-phand { perspective: 1000px; }
  .fl-phand.dealing .fl-pc {
    animation: fl-deal .62s cubic-bezier(.22,.9,.3,1) both;
    animation-delay: var(--fl-d, 0ms);
  }

  /* ---- 卡片 ---- */
  .fl-pc {
    --fl-pc: var(--fl-accent);
    --mx: 50%; --my: 50%;
    --rx: 0deg; --ry: 0deg;
    position: relative; cursor: pointer;
    padding: 0; background: none; border: none;
    transform-style: preserve-3d;
    transition: transform .18s cubic-bezier(.3,1.2,.5,1), filter .18s;
    will-change: transform;
    animation: none;
  }
  .fl-pc-in {
    position: relative; overflow: hidden;
    display: flex; flex-direction: column; gap: 7px;
    padding: 14px 15px 16px; border-radius: 9px; min-height: 132px;
    background:
      radial-gradient(120% 80% at 50% -10%, var(--fl-pc-28) 0%, transparent 62%),
      linear-gradient(165deg, rgba(28,22,14,.98) 0%, rgba(16,12,8,.99) 58%, #0b0806 100%);
    border: 1px solid var(--fl-pc-55);
    box-shadow:
      0 0 0 1px rgba(0,0,0,.5) inset,
      0 1px 0 rgba(255,255,255,.055) inset,
      0 10px 26px rgba(0,0,0,.55),
      0 0 16px var(--fl-pc-glow);
    transition: border-color .18s, box-shadow .22s;
  }
  .fl-pc:hover .fl-pc-in {
    border-color: var(--fl-pc);
    box-shadow:
      0 0 0 1px rgba(0,0,0,.5) inset,
      0 1px 0 rgba(255,255,255,.09) inset,
      0 16px 38px rgba(0,0,0,.66),
      0 0 30px var(--fl-pc-glow);
  }
  .fl-pc:hover {
    transform: translateY(-5px) rotateX(var(--rx)) rotateY(var(--ry)) scale(1.02);
  }

  /* 左侧色条 + 顶部扫光 */
  .fl-pc-in::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
    background: linear-gradient(180deg, transparent, var(--fl-pc) 18%, var(--fl-pc) 82%, transparent);
    opacity: .9;
  }
  .fl-pc-sheen {
    position: absolute; top: 0; bottom: 0; left: 0; width: 42%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.13), transparent);
    transform: translateX(-130%) skewX(-18deg);
    pointer-events: none; opacity: 0;
  }
  .fl-pc:hover .fl-pc-sheen { animation: fl-sheen .85s ease-out; }

  /* 跟随鼠标的高光 */
  .fl-pc-fx {
    position: absolute; inset: 0; pointer-events: none; opacity: 0;
    background: radial-gradient(240px circle at var(--mx) var(--my), var(--fl-pc-28), transparent 62%);
    transition: opacity .2s;
  }
  .fl-pc:hover .fl-pc-fx { opacity: 1; }

  /* ---- 文字 ---- */
  .fl-pc-top {
    display: flex; align-items: center; justify-content: space-between;
    position: relative; z-index: 2;
  }
  .fl-pc-cat {
    font-size: 9.5px; letter-spacing: 2.4px; color: var(--fl-pc);
    text-shadow: 0 0 10px var(--fl-pc-55);
  }
  .fl-pc-id {
    font-size: 9px; letter-spacing: .5px;
    color: rgba(var(--fl-text-rgb), .2);
    font-variant-numeric: tabular-nums;
  }
  .fl-pc-name {
    position: relative; z-index: 2;
    font-size: 16px; font-weight: 700; letter-spacing: 1.4px; line-height: 1.3;
    color: var(--fl-bright);
    text-shadow: 0 1px 2px rgba(0,0,0,.9), 0 0 16px var(--fl-pc-28);
  }
  .fl-pc-desc {
    position: relative; z-index: 2;
    font-size: 11.5px; line-height: 1.7;
    color: rgba(var(--fl-text-rgb), .58);
  }
  .fl-pc-block {
    position: relative; z-index: 2; margin-top: auto;
    font-size: 10px; letter-spacing: .3px; color: rgba(212,127,108,.85);
  }

  /* 选中角标 */
  .fl-pc-check {
    position: absolute; top: 9px; right: 10px; z-index: 3;
    width: 17px; height: 17px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; color: #14100a;
    background: var(--fl-pc); box-shadow: 0 0 12px var(--fl-pc-55);
    opacity: 0; transform: scale(.4) rotate(-40deg);
    transition: opacity .2s, transform .28s cubic-bezier(.2,1.6,.4,1);
  }
  .fl-pc.on .fl-pc-check { opacity: 1; transform: scale(1) rotate(0deg); }
  .fl-pc.on .fl-pc-id { opacity: 0; }

  /* 选中态 */
  .fl-pc.on .fl-pc-in {
    border-color: var(--fl-pc);
    background:
      radial-gradient(120% 80% at 50% -10%, var(--fl-pc-55) 0%, transparent 66%),
      linear-gradient(165deg, rgba(38,29,17,1) 0%, rgba(22,17,11,1) 58%, #0e0a07 100%);
    box-shadow:
      0 0 0 1px var(--fl-pc-55) inset,
      0 2px 0 var(--fl-pc) inset,
      0 1px 0 rgba(255,255,255,.1) inset,
      0 12px 30px rgba(0,0,0,.6),
      0 0 34px var(--fl-pc-glow);
  }
  .fl-pc.on .fl-pc-in::after {
    content: ""; position: absolute; inset: -1px; border-radius: 9px;
    border: 1px solid var(--fl-pc);
    animation: fl-breathe 2.6s ease-in-out infinite;
    pointer-events: none;
  }
  .fl-pc.pop { animation: fl-pop .34s cubic-bezier(.3,1.5,.5,1); }

  /* 互斥灰掉 */
  .fl-pc.off { opacity: .3; cursor: not-allowed; filter: grayscale(.75) brightness(.8); }
  .fl-pc.off:hover { transform: none; }
  .fl-pc.off .fl-pc-in { box-shadow: 0 6px 16px rgba(0,0,0,.5); border-color: rgba(255,255,255,.1); }
  .fl-pc.off .fl-pc-sheen,
  .fl-pc.off .fl-pc-fx { display: none; }

  /* ---- 空态 ---- */
  .fl-pempty {
    grid-column: 1 / -1; position: relative;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 9px; padding: 46px 20px; text-align: center;
    border: 1px dashed rgba(var(--fl-accent-rgb), .18); border-radius: 9px;
    background: rgba(255,255,255,.008);
    min-height: 150px;
  }
  .fl-pempty b { font-size: 13px; letter-spacing: 2px; color: rgba(var(--fl-text-rgb),.6); font-weight: 400; }
  .fl-pempty small { font-size: 11px; color: rgba(var(--fl-text-rgb),.32); }
  .fl-pempty-ring { position: absolute; inset: 0; pointer-events: none; }
  .fl-pempty-ring i {
    position: absolute; left: 50%; top: 50%;
    width: 74px; height: 74px; margin: -37px 0 0 -37px;
    border: 1px solid rgba(var(--fl-accent-rgb), .16); border-radius: 50%;
    animation: fl-float 7s ease-in-out infinite;
  }
  .fl-pempty-ring i:nth-child(2) { width: 108px; height: 108px; margin: -54px 0 0 -54px; animation-duration: 9s; animation-direction: reverse; }
  .fl-pempty-ring i:nth-child(3) { width: 142px; height: 142px; margin: -71px 0 0 -71px; animation-duration: 11s; }

  /* ---- 已颁政令 ---- */
  .fl-chosen {
    --fl-pc: var(--fl-accent);
    position: relative; overflow: hidden;
    border: 1px solid var(--fl-pc-50);
    background: var(--fl-pc-18);
    transition: all .16s ease;
  }
  .fl-chosen::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
    background: var(--fl-pc); opacity: .8;
  }
  .fl-chosen:hover {
    border-color: #e08a7a; background: rgba(212,127,108,.14);
    transform: translateY(-1px);
  }
  .fl-chosen:hover i { opacity: 1; color: #e08a7a; }

  /* ---- AI：合成 / 自创 ---- */
  .fl-pai {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0 0 12px;
    padding: 11px 13px;
    border: 1px solid rgba(212,175,90,.16);
    border-radius: 9px;
    background: rgba(212,175,90,.035);
  }
  .fl-pai-r { display: flex; align-items: center; gap: 9px; }
  .fl-pai-btn { flex: none; padding: 5px 13px; font-size: 12px; }
  .fl-pai-btn b { color: var(--fl-accent); font-weight: 600; }
  /* 不用 disabled：点了要有反馈，所以只做视觉上的「现在不该点」 */
  .fl-pai-btn[aria-disabled="true"] {
    opacity: .45;
    cursor: not-allowed;
  }
  .fl-pai-hint { font-size: 11px; color: var(--fl-dim); }
  .fl-pai-idea { gap: 8px; }
  .fl-pai-in {
    flex: 1 1 auto;
    min-width: 0;
    font: inherit;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 7px;
    border: 1px solid var(--fl-line);
    /* 不透明深色底：半透明叠在浅色父层上会变白，字就看不见 */
    background: var(--fl-surface2, #14110b);
    color: rgb(var(--fl-text-rgb));
    -webkit-text-fill-color: rgb(var(--fl-text-rgb));
    caret-color: rgb(var(--fl-text-rgb));
    outline: none;
  }
  .fl-pai-in:focus { border-color: rgba(212,175,90,.45); }
  .fl-pai-in::placeholder { color: rgba(var(--fl-text-rgb),.28); }
  .fl-pai-in:-webkit-autofill,
  .fl-pai-in:-webkit-autofill:hover,
  .fl-pai-in:-webkit-autofill:focus {
    -webkit-text-fill-color: rgb(var(--fl-text-rgb));
    -webkit-box-shadow: 0 0 0 1000px var(--fl-surface2, #14110b) inset;
    transition: background-color 9999s ease-out;
  }
  .fl-pai-note { font-size: 11px; color: var(--fl-dimmer); line-height: 1.65; }
  .fl-pai-note b { color: var(--fl-dim); font-weight: 400; }
  .fl-pai-note.err { color: #e08a7a; }
  .fl-pai-note.warn { color: #d8b06a; }
  .fl-pai-note.busy { display: flex; align-items: center; gap: 7px; color: var(--fl-dim); }
  @keyframes fl-pai-blink { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
  .fl-pai-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--fl-accent);
    animation: fl-pai-blink 1s ease-in-out infinite;
  }

  .fl-pai-made { display: flex; flex-wrap: wrap; gap: 7px; }
  .fl-made {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 4px 9px;
    border-radius: 7px;
    font-size: 12px;
    cursor: pointer;
    color: var(--fl-ink);
    border: 1px solid var(--fl-pc, var(--fl-accent));
    background: rgba(0,0,0,.16);
    transition: background .14s;
  }
  .fl-made:hover { background: rgba(212,175,90,.1); }
  .fl-made.on { background: rgba(212,175,90,.18); }
  .fl-made u { font-style: normal; text-decoration: none; font-size: 10px; color: var(--fl-dim); }
  .fl-made s { text-decoration: none; font-size: 9px; letter-spacing: .06em; color: var(--fl-dimmer); }
  .fl-made i {
    font-style: normal;
    font-size: 10px;
    color: var(--fl-dimmer);
    opacity: .5;
    transition: opacity .14s, color .14s;
  }
  .fl-made:hover i { opacity: 1; }
  .fl-made i:hover { color: #e08a7a; }

  /* AI 造出来的卡：右上角标记换成「合 / 创」 */
  .fl-pc.ai .fl-pc-id { color: var(--fl-accent); letter-spacing: 0; }

  /* ---- 关系提示 ---- */
  .fl-rel { display: flex; align-items: flex-start; gap: 10px; }  .fl-rel b {
    flex: none; padding: 1px 7px; border-radius: 3px;
    font-weight: 400; letter-spacing: 2px; font-size: 10px;
  }
  .fl-rel span { flex: 1; }
  .fl-rel.sy b { color: #9ed08a; border: 1px solid rgba(143,191,122,.4); background: rgba(143,191,122,.1); }
  .fl-rel.cf b { color: #e08a7a; border: 1px solid rgba(212,127,108,.4); background: rgba(212,127,108,.1); }
  .fl-rel.cf { animation: fl-breathe 3s ease-in-out infinite; }

  /* ---- 发送按钮 ---- */
  .fl-sendbtn {
    position: relative; overflow: hidden;
    background: linear-gradient(100deg,
      rgba(var(--fl-accent-rgb), .26) 0%,
      rgba(var(--fl-accent-rgb), .5) 50%,
      rgba(var(--fl-accent-rgb), .26) 100%);
    background-size: 220% 100%;
    border-color: rgba(var(--fl-accent-rgb), .68);
    color: #fff4d2; letter-spacing: 2.6px; font-weight: 600;
    animation: fl-drawshine 3.6s linear infinite;
  }
  .fl-sendbtn:hover { box-shadow: 0 0 20px rgba(var(--fl-accent-rgb), .5); }
  .fl-sendbtn span { position: relative; z-index: 1; }
  .fl-sendbtn.fired { animation: fl-fired .6s ease-out; }

  /* ---- 按钮按下反馈（触摸没有 hover，靠 active） ---- */
  .fl-btn:active { transform: scale(.96); }
  .fl-pcat:active { transform: scale(.95); }
  .fl-chosen:active { transform: scale(.95); }
  .fl-btn.fl-drawbtn:active,
  .fl-btn.fl-sendbtn:active { filter: brightness(1.25); }

  /* ---- 无 hover 设备：关掉跟随鼠标的特效，改用"点下即亮" ---- */
  @media (hover: none) {
    .fl-pc:hover { transform: none; }
    .fl-pc:hover .fl-pc-in {
      box-shadow: 0 0 0 1px rgba(0,0,0,.5) inset, 0 1px 0 rgba(255,255,255,.055) inset,
        0 10px 26px rgba(0,0,0,.55), 0 0 16px var(--fl-pc-glow);
    }
    .fl-pc:hover .fl-pc-sheen { animation: none; }
    .fl-pc:hover .fl-pc-fx { opacity: 0; }
    /* 按下时给一层高光，代替 hover */
    .fl-pc:active { transform: scale(.965); }
    .fl-pc:active .fl-pc-in {
      border-color: var(--fl-pc);
      box-shadow: 0 0 0 1px var(--fl-pc-55) inset, 0 0 26px var(--fl-pc-glow);
    }
    .fl-pc-sheen { animation: fl-sheen 1.1s ease-out; opacity: 0; }
  }

  /* ---- 平板 / 大屏手机 ---- */
  @media (max-width: 900px) {
    .fl-phand { grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); }
  }

  /* ---- 手机：两列、压字、减动画 ---- */
  @media (max-width: 760px) {
    .fl-policy { gap: 12px; }
    .fl-pbar { gap: 9px; }
    .fl-pcats { gap: 5px; }
    .fl-pcat { padding: 4px 9px; font-size: 11px; letter-spacing: .6px; }
    .fl-pcat u { font-size: 9px; }
    .fl-pact { width: 100%; }
    .fl-pact .fl-btn { flex: 1; padding: 9px 6px; font-size: 12px; letter-spacing: 1.4px; }

    .fl-phand {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 9px; min-height: 0;
    }
    .fl-pc-in { min-height: 112px; padding: 11px 12px 13px; gap: 5px; border-radius: 8px; }
    .fl-pc-name { font-size: 14px; letter-spacing: .8px; }
    .fl-pc-desc {
      font-size: 10.5px; line-height: 1.62;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .fl-pc-cat { font-size: 9px; letter-spacing: 1.6px; }
    .fl-pc-id { display: none; }
    .fl-pc-check { width: 16px; height: 16px; top: 8px; right: 8px; font-size: 10px; }
    .fl-pc-block { font-size: 9.5px; }

    .fl-pfoot { gap: 10px; padding-top: 11px; }
    .fl-plabel { font-size: 10px; letter-spacing: 1.6px; }
    .fl-chosen { font-size: 11.5px; padding: 3px 8px 3px 9px; }
    .fl-pgo { gap: 7px; }
    .fl-pgo .fl-btn { flex: 1; padding: 10px 6px; }
    .fl-rel { font-size: 11px; gap: 7px; }
    .fl-rel b { font-size: 9.5px; letter-spacing: 1.2px; padding: 1px 5px; }
    .fl-rel-r { margin-left: 0; }
    .fl-pempty { padding: 32px 16px; min-height: 130px; }
    .fl-pempty-ring i:nth-child(3) { display: none; }
  }

  /* ---- 小屏手机（<=400px）---- */
  @media (max-width: 400px) {
    .fl-pcat { padding: 3px 7px; font-size: 10.5px; }
    .fl-pc-in { min-height: 104px; padding: 10px 11px 11px; }
    .fl-pc-name { font-size: 13px; }
    .fl-pc-desc { font-size: 10px; -webkit-line-clamp: 3; }
  }

  /* ---- 横屏矮屏：别让卡片占满 ---- */
  @media (max-height: 520px) and (orientation: landscape) {
    .fl-phand { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
    .fl-pc-in { min-height: 96px; }
  }

  /* ---- 低端设备：砍掉昂贵效果 ---- */
  @media (max-width: 760px) {
    .fl-pc-fx { display: none; }
    .fl-pc-sheen { display: none; }
    .fl-pc.on .fl-pc-in::after { animation-duration: 3.4s; }
  }
  @supports not (backdrop-filter: blur(1px)) {
    .fl-pc-in { background: linear-gradient(165deg, #1c1610 0%, #120e09 60%, #0b0806 100%); }
  }

  /* ---- 减少动效偏好 ---- */
  @media (prefers-reduced-motion: reduce) {
    .fl-pc, .fl-pc-in, .fl-pc-check, .fl-chosen { transition: none !important; }
    .fl-phand.dealing .fl-pc { animation: none !important; }
    .fl-drawbtn, .fl-sendbtn, .fl-pc.on .fl-pc-in::after, .fl-rel.cf,
    .fl-pempty-ring i { animation: none !important; }
  }
  /* ---- 手机：顶部压成窄带，把屏幕留给内容 ---- */

  /* ---- 极窄（320 一类）：字号再降一档 ---- */`;
})();
