/* 国策树样式。风格跟领地档案一套：暗底、琥珀金、2px 圆角、细边框、字距。 */
(function () {
  'use strict';

  window.__fiefCssFocus = String.raw`
  /* ================= 国策树 ================= */

  .fx { display: flex; flex-direction: column; gap: 14px; }

  /* ---- 头部：国名 + 两个指针 ---- */
  .fx-head {
    display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap;
    padding-bottom: 11px; border-bottom: 1px solid var(--fl-line);
  }
  .fx-title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
  .fx-title b {
    font-size: calc(13px * var(--fl-fs, 1)); font-weight: 600; letter-spacing: 4px; color: var(--fl-accent);
    white-space: nowrap;
  }
  .fx-title span {
    font-size: calc(13px * var(--fl-fs, 1)); color: rgba(var(--fl-text-rgb), .86);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fx-meters { display: flex; align-items: center; gap: 14px; margin-left: auto; }
  .fx-meter { display: flex; align-items: baseline; gap: 5px; }
  .fx-meter i {
    font-style: normal; font-size: calc(9.5px * var(--fl-fs, 1)); letter-spacing: 1.6px;
    color: var(--fl-dimmer);
  }
  .fx-meter b {
    font-size: calc(13px * var(--fl-fs, 1)); font-weight: 500; font-variant-numeric: tabular-nums;
    color: rgba(var(--fl-text-rgb), .9);
  }
  .fx-meter.low b { color: #c9776a; }
  .fx-meter.high b { color: #8fbf7a; }

  /* ---- 本期 ---- */
  .fx-period {
    padding: 11px 13px; border-radius: 2px;
    border: 1px solid var(--fl-line);
    background: rgba(var(--fl-accent-rgb), .045);
  }
  .fx-period-h {
    display: flex; align-items: baseline; gap: 9px;
    font-size: calc(11px * var(--fl-fs, 1)); letter-spacing: 2px; color: var(--fl-dimmer);
  }
  .fx-period-h b {
    font-size: calc(13px * var(--fl-fs, 1)); font-weight: 500; letter-spacing: 1px;
    color: rgba(var(--fl-text-rgb), .92);
  }
  .fx-period-b {
    margin-top: 7px; font-size: calc(12px * var(--fl-fs, 1)); line-height: 1.85;
    color: rgba(var(--fl-text-rgb), .66);
  }
  .fx-period-more {
    margin-top: 6px; font-size: calc(10.5px * var(--fl-fs, 1)); color: var(--fl-dimmer);
    cursor: pointer; letter-spacing: .5px;
  }
  .fx-period-more:hover { color: var(--fl-accent); }

  /* ---- 进度 ---- */
  .fx-prog { display: flex; align-items: center; gap: 10px; }
  .fx-prog-t {
    font-size: calc(10px * var(--fl-fs, 1)); letter-spacing: 2px; color: var(--fl-dimmer); white-space: nowrap;
  }
  .fx-prog-bar {
    flex: 1; height: 3px; border-radius: 2px; overflow: hidden;
    background: rgba(var(--fl-text-rgb), .09);
  }
  .fx-prog-bar i {
    display: block; height: 100%; border-radius: 2px;
    background: linear-gradient(90deg, rgba(var(--fl-accent-rgb), .55), var(--fl-accent));
    transition: width .45s cubic-bezier(.22,.9,.3,1);
  }
  .fx-prog-n {
    font-size: calc(11px * var(--fl-fs, 1)); font-variant-numeric: tabular-nums; color: var(--fl-dim);
    white-space: nowrap;
  }
  .fx-prog-n b { color: var(--fl-accent); font-weight: 500; }

  /* ---- 分支 ---- */
  .fx-branch {
    border: 1px solid var(--fl-line); border-radius: 2px;
    background: rgba(var(--fl-text-rgb), .015);
    overflow: hidden;
  }
  .fx-branch-h {
    display: flex; align-items: baseline; gap: 9px;
    padding: 9px 13px; border-bottom: 1px solid var(--fl-line);
    background: rgba(var(--fl-accent-rgb), .035);
  }
  .fx-branch-h b {
    font-size: calc(12px * var(--fl-fs, 1)); font-weight: 500; letter-spacing: 1.6px;
    color: rgba(var(--fl-text-rgb), .9);
  }
  .fx-branch-h u {
    font-style: normal; text-decoration: none;
    font-size: calc(9px * var(--fl-fs, 1)); letter-spacing: 1px; padding: 1px 5px; border-radius: 2px;
    color: var(--fl-accent); border: 1px solid rgba(var(--fl-accent-rgb), .4);
  }
  .fx-branch-h i {
    font-style: normal; font-size: calc(10px * var(--fl-fs, 1)); color: var(--fl-dimmer); margin-left: auto;
  }
  .fx-branch-h em {
    font-style: normal; font-size: calc(10.5px * var(--fl-fs, 1)); line-height: 1.6;
    color: var(--fl-dimmer); flex: 1; min-width: 0;
  }

  /* ---- 列（按前置深度） ---- */
  .fx-cols {
    display: flex; align-items: stretch; gap: 26px;
    padding: 14px 13px; overflow-x: auto;
    scrollbar-width: thin;
  }
  .fx-cols::-webkit-scrollbar { height: 4px; }
  .fx-cols::-webkit-scrollbar-thumb { background: var(--fl-line2); border-radius: 2px; }

  .fx-col {
    position: relative;
    display: flex; flex-direction: column; justify-content: center; gap: 9px;
    flex: none;
  }
  /* 列间连线：从上一列拉过来 */
  .fx-col + .fx-col::before {
    content: ""; position: absolute;
    left: -26px; top: 50%; width: 26px; height: 1px;
    background: var(--fl-line2);
  }
  .fx-col + .fx-col::after {
    content: ""; position: absolute;
    left: -5px; top: 50%; width: 5px; height: 5px;
    margin-top: -2px; border-top: 1px solid var(--fl-line2); border-right: 1px solid var(--fl-line2);
    transform: rotate(45deg);
  }

  /* ---- 节点 ---- */
  .fx-node {
    position: relative;
    min-width: 104px; max-width: 168px;
    padding: 7px 10px 6px; border-radius: 2px;
    border: 1px solid var(--fl-line);
    background: rgba(var(--fl-text-rgb), .025);
    cursor: pointer;
    transition: border-color .16s, background .16s, transform .16s, box-shadow .2s;
  }
  .fx-node:hover {
    transform: translateY(-1px);
    border-color: var(--fl-line2);
    background: rgba(var(--fl-accent-rgb), .07);
  }
  .fx-node-n {
    font-size: calc(12px * var(--fl-fs, 1)); line-height: 1.45; letter-spacing: .3px;
    color: rgba(var(--fl-text-rgb), .82);
    word-break: break-word;
  }
  .fx-node-m {
    margin-top: 4px; font-size: calc(9.5px * var(--fl-fs, 1)); letter-spacing: .6px;
    color: var(--fl-dimmer); font-variant-numeric: tabular-nums;
  }
  .fx-node-piv {
    position: absolute; top: -1px; right: -1px;
    width: 0; height: 0; border-top: 7px solid rgba(var(--fl-accent-rgb), .55);
    border-left: 7px solid transparent;
  }

  /* 已完成 */
  .fx-node.done {
    border-color: rgba(var(--fl-accent-rgb), .5);
    background: rgba(var(--fl-accent-rgb), .10);
  }
  .fx-node.done .fx-node-n { color: rgba(var(--fl-text-rgb), .96); }
  .fx-node.done .fx-node-m { color: var(--fl-accent); }

  /* 可推进 */
  .fx-node.ready {
    border-color: var(--fl-line2);
    box-shadow: 0 0 0 1px rgba(var(--fl-accent-rgb), .1) inset;
  }
  .fx-node.ready .fx-node-n { color: rgba(var(--fl-text-rgb), .94); }

  /* 条件不足 */
  .fx-node.blocked { opacity: .62; }
  .fx-node.blocked .fx-node-n { color: rgba(var(--fl-text-rgb), .6); }

  /* 锁定 */
  .fx-node.locked { opacity: .34; cursor: default; }
  .fx-node.locked:hover { transform: none; border-color: var(--fl-line); background: rgba(var(--fl-text-rgb), .025); }

  /* 互斥被占 */
  .fx-node.mutexed { opacity: .3; cursor: default; }
  .fx-node.mutexed:hover { transform: none; border-color: var(--fl-line); background: rgba(var(--fl-text-rgb), .025); }
  .fx-node.mutexed .fx-node-n { text-decoration: line-through; text-decoration-color: rgba(var(--fl-text-rgb), .3); }

  /* 正在推进 */
  .fx-node.running {
    border-color: var(--fl-accent);
    background: rgba(var(--fl-accent-rgb), .14);
  }
  .fx-node.running::after {
    content: ""; position: absolute; inset: -1px; border-radius: 2px;
    border: 1px solid rgba(var(--fl-accent-rgb), .5);
    animation: fx-pulse 1.9s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes fx-pulse {
    0%, 100% { opacity: .25; }
    50%      { opacity: .9; }
  }

  /* 选中 */
  .fx-node.sel {
    border-color: var(--fl-accent);
    box-shadow: 0 0 14px rgba(var(--fl-accent-rgb), .22);
  }

  /* ---- 详情 ---- */
  .fx-detail {
    border: 1px solid var(--fl-line2); border-radius: 2px;
    background: rgba(var(--fl-text-rgb), .022);
    overflow: hidden;
  }
  .fx-d-h {
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
    padding: 11px 13px; border-bottom: 1px solid var(--fl-line);
  }
  .fx-d-h b {
    font-size: calc(14px * var(--fl-fs, 1)); font-weight: 500; letter-spacing: .6px;
    color: rgba(var(--fl-text-rgb), .96);
  }
  .fx-d-h u {
    font-style: normal; text-decoration: none; font-size: calc(10px * var(--fl-fs, 1)); letter-spacing: 1px;
    color: var(--fl-dim); border: 1px solid var(--fl-line); padding: 1px 6px; border-radius: 2px;
  }
  .fx-d-h s {
    text-decoration: none; margin-left: auto; cursor: pointer;
    font-size: calc(15px * var(--fl-fs, 1)); line-height: 1; color: var(--fl-dimmer); padding: 2px 4px;
  }
  .fx-d-h s:hover { color: var(--fl-text); }

  .fx-d-b { padding: 12px 13px; display: flex; flex-direction: column; gap: 10px; }
  .fx-d-tx { font-size: calc(12.5px * var(--fl-fs, 1)); line-height: 1.9; color: rgba(var(--fl-text-rgb), .74); }

  .fx-d-row { display: flex; gap: 9px; align-items: baseline; font-size: calc(11.5px * var(--fl-fs, 1)); line-height: 1.7; }
  .fx-d-row k {
    flex: none; width: 4.2em; font-size: calc(9.5px * var(--fl-fs, 1)); letter-spacing: 1.4px;
    color: var(--fl-dimmer);
  }
  .fx-d-row v { flex: 1; color: rgba(var(--fl-text-rgb), .72); }
  .fx-d-row v b { color: rgba(var(--fl-text-rgb), .92); font-weight: 400; }
  .fx-d-row.ok v { color: rgba(143, 191, 122, .9); }
  .fx-d-row.no v { color: rgba(201, 119, 106, .9); }

  .fx-d-f {
    display: flex; align-items: center; gap: 9px;
    padding: 10px 13px; border-top: 1px solid var(--fl-line);
    background: rgba(var(--fl-accent-rgb), .025);
  }
  .fx-d-note { font-size: calc(11px * var(--fl-fs, 1)); line-height: 1.6; color: var(--fl-dimmer); flex: 1; }
  .fx-d-note b { color: rgba(201, 119, 106, .95); font-weight: 400; }

  /* ---- 生成树 ---- */
  .fx-gen { display: flex; flex-direction: column; gap: 7px; padding-top: 2px; }
  .fx-gen-btn { align-self: flex-start; }
  .fx-gen-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .fx-gen-row .fx-gen-btn { align-self: auto; }

  /* 导入 / 手写：输入框用实底，不用半透明，暗底上看得清 */
  .fx-imp { display: flex; flex-direction: column; gap: 8px; margin-top: 3px; }
  .fx-imp-ta {
    width: 100%; min-height: 180px; resize: vertical;
    box-sizing: border-box;
    font-family: ui-monospace, Menlo, Consolas, "Courier New", monospace;
    font-size: calc(11.5px * var(--fl-fs, 1));
    line-height: 1.65;
    color: var(--fl-text);
    background: var(--fl-bg2);
    border: 1px solid var(--fl-line2);
    border-radius: 2px;
    padding: 9px 10px;
    outline: none;
    -webkit-appearance: none;
  }
  .fx-imp-ta::placeholder { color: var(--fl-dimmer); }
  .fx-imp-ta:focus { border-color: var(--fl-accent); }
  .fx-imp-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .fx-gen-note { font-size: calc(10.5px * var(--fl-fs, 1)); line-height: 1.7; color: var(--fl-dimmer); }
  .fx-gen-err { font-size: calc(11px * var(--fl-fs, 1)); line-height: 1.7; color: rgba(201, 119, 106, .95); }
  .fx-gen-link {
    color: var(--fl-accent); cursor: pointer;
    border-bottom: 1px dashed rgba(var(--fl-accent-rgb), .45);
  }
  .fx-gen-link:hover { border-bottom-style: solid; }
  .fx-gen-tag {
    font-style: normal; text-decoration: none;
    font-size: calc(9px * var(--fl-fs, 1)); letter-spacing: 1px; padding: 1px 5px; border-radius: 2px;
    color: var(--fl-accent); border: 1px solid rgba(var(--fl-accent-rgb), .35);
  }

  /* ---- 快讯 ---- */
  .fx-news { border: 1px solid var(--fl-line); border-radius: 2px; overflow: hidden; }
  .fx-news-h {
    display: flex; align-items: baseline; gap: 9px; cursor: pointer;
    padding: 9px 13px; background: rgba(var(--fl-accent-rgb), .03);
  }
  .fx-news-h b { font-size: calc(11px * var(--fl-fs, 1)); font-weight: 500; letter-spacing: 2.4px; color: var(--fl-dim); }
  .fx-news-h i { font-style: normal; font-size: calc(10px * var(--fl-fs, 1)); color: var(--fl-dimmer); }
  .fx-news-h s { text-decoration: none; margin-left: auto; font-size: calc(10px * var(--fl-fs, 1)); color: var(--fl-dimmer); }
  .fx-news-h:hover s { color: var(--fl-accent); }
  .fx-news-b { padding: 0; }
  .fx-news-i { padding: 9px 13px; border-top: 1px solid var(--fl-line); }
  .fx-news-t { font-size: calc(12.5px * var(--fl-fs, 1)); color: rgba(var(--fl-text-rgb), .9); letter-spacing: .4px; }
  .fx-news-at { font-size: calc(9.5px * var(--fl-fs, 1)); color: var(--fl-dimmer); letter-spacing: .8px; margin-top: 2px; }
  .fx-news-x { font-size: calc(11.5px * var(--fl-fs, 1)); line-height: 1.7; color: rgba(var(--fl-text-rgb), .6); margin-top: 4px; }
  .fx-news-e { font-size: calc(10.5px * var(--fl-fs, 1)); color: var(--fl-accent); margin-top: 4px; }

  /* ---- 本期周期 ---- */
  .fx-period-p { font-style: normal; margin-left: auto; font-size: calc(10.5px * var(--fl-fs, 1)); color: var(--fl-dimmer); }

  /* ---- 空态 ---- */
  .fx-empty {
    display: flex; flex-direction: column; align-items: center; gap: 9px;
    padding: 46px 20px; border-radius: 2px;
    border: 1px dashed rgba(var(--fl-text-rgb), .14);
    text-align: center;
  }
  .fx-empty b { font-size: calc(13px * var(--fl-fs, 1)); font-weight: 400; letter-spacing: 2px; color: var(--fl-dim); }
  .fx-empty small { font-size: calc(11px * var(--fl-fs, 1)); color: var(--fl-dimmer); line-height: 1.7; }

  /* ---- 国名选择 ---- */
  .fx-pick { display: flex; flex-wrap: wrap; gap: 5px; }
  .fx-pick span {
    font-size: calc(11px * var(--fl-fs, 1)); padding: 3px 9px; border-radius: 2px; cursor: pointer;
    color: var(--fl-dim); border: 1px solid var(--fl-line);
    transition: color .15s, border-color .15s, background .15s;
  }
  .fx-pick span:hover { color: var(--fl-text); border-color: var(--fl-line2); }
  .fx-pick span.on {
    color: var(--fl-accent); border-color: rgba(var(--fl-accent-rgb), .5);
    background: rgba(var(--fl-accent-rgb), .09);
  }

  /* ---- 窄屏 ---- */
  @media (max-width: 620px) {
    .fx-head { gap: 9px; }
    .fx-meters { margin-left: 0; width: 100%; justify-content: flex-start; }
    .fx-cols { gap: 20px; padding: 12px 10px; }
    .fx-col + .fx-col::before { left: -20px; width: 20px; }
    .fx-node { min-width: 92px; max-width: 140px; }
    .fx-node-n { font-size: calc(11.5px * var(--fl-fs, 1)); }
  }
`;
})();
