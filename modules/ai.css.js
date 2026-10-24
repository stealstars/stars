/* 自动生成：AI 设置面板样式。改这里，不要改 core。 */
(function () {
  'use strict';
  // AI 凭据设置面板的样式。由 core 注入 <style>。
  window.__fiefCssAi = String.raw`  /* ================= AI 凭据设置面板 ================= */
  .fl-aic {
    display: flex; flex-direction: column; gap: 0;
    max-width: 720px; margin: 0 auto; padding: 4px 0 40px;
  }

  .fl-aic-head { padding: 14px 0 18px; border-bottom: 1px solid rgba(var(--fl-accent-rgb), .12); }
  .fl-aic-title {
    font-size: 15px; font-weight: 600; letter-spacing: 2px; color: var(--fl-bright);
    margin-bottom: 7px;
  }
  .fl-aic-sub { font-size: 12px; color: rgba(var(--fl-text-rgb), .42); letter-spacing: .3px; }

  .fl-aic-tabs { display: flex; gap: 6px; padding: 14px 0 0; flex-wrap: wrap; }
  .fl-aic-tab {
    padding: 5px 13px; border-radius: 4px; cursor: pointer;
    font-size: 12px; letter-spacing: 1.4px; color: var(--fl-dim);
    border: 1px solid rgba(var(--fl-accent-rgb), .16);
    background: rgba(255,255,255,.015);
    transition: all .15s;
  }
  .fl-aic-tab:hover { color: var(--fl-text); border-color: rgba(var(--fl-accent-rgb), .34); }
  .fl-aic-tab.on {
    color: var(--fl-accent); border-color: var(--fl-accent);
    background: rgba(var(--fl-accent-rgb), .12);
  }

  .fl-aic-f {
    display: flex; flex-direction: column;
    gap: 8px; padding: 20px 0;
    border-bottom: 1px solid rgba(var(--fl-accent-rgb), .09);
  }
  .fl-aic-l {
    font-size: 13.5px; font-weight: 600; letter-spacing: 1px;
    color: var(--fl-bright);
  }
  .fl-aic-h {
    font-size: 11.5px; line-height: 1.65;
    color: rgba(var(--fl-text-rgb), .38);
    letter-spacing: .2px;
  }

  /* ---- 输入框 ---- */
  .fl-aic-in {
    width: 100%; box-sizing: border-box;
    padding: 12px 14px; border-radius: 7px;
    font: inherit; font-size: 13.5px; letter-spacing: .3px;
    color: var(--fl-text);
    background: rgba(0,0,0,.34);
    border: 1px solid rgba(var(--fl-accent-rgb), .2);
    outline: none;
    transition: border-color .16s, box-shadow .18s, background .16s;
  }
  .fl-aic-in::placeholder { color: rgba(var(--fl-text-rgb), .2); }
  .fl-aic-in:hover { border-color: rgba(var(--fl-accent-rgb), .34); }
  .fl-aic-in:focus {
    border-color: var(--fl-accent);
    background: rgba(0,0,0,.46);
    box-shadow: 0 0 0 3px rgba(var(--fl-accent-rgb), .1), 0 0 14px rgba(var(--fl-accent-rgb), .12);
  }
  .fl-aic-in[type="password"] { letter-spacing: 2px; font-size: 15px; }

  /* ---- 下拉 ---- */
  .fl-aic-row { display: flex; gap: 8px; }
  .fl-aic-selwrap { position: relative; flex: 1; }
  .fl-aic-sel {
    width: 100%; box-sizing: border-box;
    -webkit-appearance: none; -moz-appearance: none; appearance: none;
    padding: 12px 38px 12px 14px; border-radius: 7px;
    font: inherit; font-size: 13.5px; letter-spacing: .3px;
    color: var(--fl-text);
    background: rgba(0,0,0,.34);
    border: 1px solid rgba(var(--fl-accent-rgb), .2);
    outline: none; cursor: pointer;
    transition: border-color .16s, box-shadow .18s;
  }
  .fl-aic-sel:hover:not([disabled]) { border-color: rgba(var(--fl-accent-rgb), .34); }
  .fl-aic-sel:focus { border-color: var(--fl-accent); box-shadow: 0 0 0 3px rgba(var(--fl-accent-rgb), .1); }
  .fl-aic-sel[disabled] { opacity: .45; cursor: not-allowed; }
  .fl-aic-sel option { background: #17120c; color: var(--fl-text); }
  .fl-aic-caret {
    position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
    font-style: normal; font-size: 11px; pointer-events: none;
    color: rgba(var(--fl-text-rgb), .42);
  }
  .fl-aic-selwrap:has(.fl-aic-sel[disabled]) .fl-aic-caret { opacity: .3; }

  /* ---- 按钮 ---- */
  .fl-aic-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 11px 18px; border-radius: 7px; cursor: pointer;
    font: inherit; font-size: 13px; letter-spacing: 1.6px;
    color: var(--fl-text);
    background: rgba(var(--fl-accent-rgb), .1);
    border: 1px solid rgba(var(--fl-accent-rgb), .28);
    transition: all .16s;
  }
  .fl-aic-btn:hover:not([disabled]) {
    background: rgba(var(--fl-accent-rgb), .2);
    border-color: var(--fl-accent);
    box-shadow: 0 0 14px rgba(var(--fl-accent-rgb), .16);
  }
  .fl-aic-btn:active:not([disabled]) { transform: scale(.98); }
  .fl-aic-btn[disabled] { opacity: .42; cursor: not-allowed; }
  .fl-aic-btn.ghost { background: rgba(255,255,255,.02); }
  .fl-aic-btn.primary {
    background: linear-gradient(100deg,
      rgba(var(--fl-accent-rgb), .26) 0%,
      rgba(var(--fl-accent-rgb), .46) 50%,
      rgba(var(--fl-accent-rgb), .26) 100%);
    border-color: rgba(var(--fl-accent-rgb), .6);
    color: #fff4d2; font-weight: 600;
  }
  .fl-aic-btn.primary:hover:not([disabled]) {
    box-shadow: 0 0 20px rgba(var(--fl-accent-rgb), .42);
    filter: brightness(1.1);
  }
  .fl-aic-btn[disabled] .fl-aic-spin { animation: none !important; }

  .fl-aic-spin { display: inline-block; font-style: normal; }
  .fl-aic-spin.on { animation: fl-aic-rot .9s linear infinite; }
  @keyframes fl-aic-rot { to { transform: rotate(360deg); } }

  /* ---- 已选择模型 ---- */
  .fl-aic-cur {
    padding: 11px 14px; border-radius: 7px;
    font-size: 13px; letter-spacing: .4px;
    color: var(--fl-accent);
    background: rgba(var(--fl-accent-rgb), .07);
    border: 1px solid rgba(var(--fl-accent-rgb), .16);
    word-break: break-all;
  }

  /* ---- 模型分布 / 属性 ---- */
  .fl-aic-dist {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
    font-size: 11px; letter-spacing: .2px; color: rgba(var(--fl-text-rgb), .34);
    padding-top: 2px;
  }
  .fl-aic-tag {
    display: inline-block; padding: 1px 7px; border-radius: 3px;
    font-style: normal; font-size: 10px; letter-spacing: .4px;
    border: 1px solid;
  }
  .fl-aic-tag.idle { color: #9ed08a; border-color: rgba(143,191,122,.36); background: rgba(143,191,122,.1); }
  .fl-aic-tag.normal { color: #e0c47a; border-color: rgba(212,175,90,.34); background: rgba(212,175,90,.09); }
  .fl-aic-tag.other { color: rgba(var(--fl-text-rgb), .42); border-color: rgba(var(--fl-text-rgb), .14); }
  .fl-aic-tag.bad { color: #e08a7a; border-color: rgba(212,127,108,.38); background: rgba(212,127,108,.1); }

  /* ---- 提示 ---- */
  .fl-aic-err {
    margin-top: 14px; padding: 11px 14px; border-radius: 6px;
    font-size: 12px; line-height: 1.7;
    color: #e8a396;
    background: rgba(212,127,108,.09);
    border: 1px solid rgba(212,127,108,.32);
    word-break: break-word;
  }
  .fl-aic-ok {
    margin-top: 14px; padding: 11px 14px; border-radius: 6px;
    font-size: 12px; color: #a8d69a;
    background: rgba(143,191,122,.08);
    border: 1px solid rgba(143,191,122,.3);
  }

  .fl-aic-foot { display: flex; gap: 10px; padding: 20px 0 0; }

  .fl-aic-note {
    margin-top: 22px; padding: 14px 16px; border-radius: 7px;
    font-size: 11.5px; line-height: 1.9;
    color: rgba(var(--fl-text-rgb), .38);
    background: rgba(255,255,255,.014);
    border: 1px solid rgba(var(--fl-accent-rgb), .09);
  }
  .fl-aic-note b {
    display: block; margin-bottom: 6px;
    font-weight: 400; font-size: 10.5px; letter-spacing: 2.4px;
    color: rgba(var(--fl-accent-rgb), .55);
  }
  .fl-aic-note code {
    padding: 1px 5px; border-radius: 3px;
    font-family: ui-monospace, Consolas, monospace; font-size: 10.5px;
    color: rgba(var(--fl-accent-rgb), .78);
    background: rgba(var(--fl-accent-rgb), .08);
    word-break: break-all;
  }

  /* ---- 手机 ---- */
  @media (max-width: 760px) {
    .fl-aic { padding: 0 0 30px; }
    .fl-aic-head { padding: 10px 0 14px; }
    .fl-aic-title { font-size: 14px; letter-spacing: 1.4px; }
    .fl-aic-sub { font-size: 11.5px; }
    .fl-aic-f { padding: 16px 0; gap: 7px; }
    .fl-aic-l { font-size: 13px; }
    .fl-aic-h { font-size: 11px; }
    .fl-aic-in, .fl-aic-sel { padding: 11px 12px; font-size: 13px; }
    .fl-aic-sel { padding-right: 34px; }
    .fl-aic-btn { padding: 11px 14px; font-size: 12.5px; letter-spacing: 1.2px; }
    .fl-aic-foot { gap: 8px; }
    .fl-aic-foot .fl-aic-btn { flex: 1; }
    .fl-aic-note { font-size: 11px; line-height: 1.85; }
  }
  /* ---- 输入框 ---- */
  .fl-aic-in {
    width: 100%; box-sizing: border-box;
    padding: 12px 14px; border-radius: 7px;
    font: inherit; font-size: 13.5px; letter-spacing: .3px;
    color: var(--fl-text);
    background: rgba(0,0,0,.34);
    border: 1px solid rgba(var(--fl-accent-rgb), .2);
    outline: none;
    transition: border-color .16s, box-shadow .18s, background .16s;
  }
  .fl-aic-in::placeholder { color: rgba(var(--fl-text-rgb), .2); }
  .fl-aic-in:hover { border-color: rgba(var(--fl-accent-rgb), .34); }
  .fl-aic-in:focus {
    border-color: var(--fl-accent);
    background: rgba(0,0,0,.46);
    box-shadow: 0 0 0 3px rgba(var(--fl-accent-rgb), .1), 0 0 14px rgba(var(--fl-accent-rgb), .12);
  }
  .fl-aic-in[type="password"] { letter-spacing: 2px; font-size: 15px; }

  /* ---- 下拉 ---- */
  .fl-aic-row { display: flex; gap: 8px; }
  .fl-aic-selwrap { position: relative; flex: 1; }
  .fl-aic-sel {
    width: 100%; box-sizing: border-box;
    -webkit-appearance: none; -moz-appearance: none; appearance: none;
    padding: 12px 38px 12px 14px; border-radius: 7px;
    font: inherit; font-size: 13.5px; letter-spacing: .3px;
    color: var(--fl-text);
    background: rgba(0,0,0,.34);
    border: 1px solid rgba(var(--fl-accent-rgb), .2);
    outline: none; cursor: pointer;
    transition: border-color .16s, box-shadow .18s;
  }
  .fl-aic-sel:hover:not([disabled]) { border-color: rgba(var(--fl-accent-rgb), .34); }
  .fl-aic-sel:focus { border-color: var(--fl-accent); box-shadow: 0 0 0 3px rgba(var(--fl-accent-rgb), .1); }
  .fl-aic-sel[disabled] { opacity: .45; cursor: not-allowed; }
  .fl-aic-sel option { background: #17120c; color: var(--fl-text); }
  .fl-aic-caret {
    position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
    font-style: normal; font-size: 11px; pointer-events: none;
    color: rgba(var(--fl-text-rgb), .42);
  }
  .fl-aic-selwrap:has(.fl-aic-sel[disabled]) .fl-aic-caret { opacity: .3; }

  /* ---- 按钮 ---- */
  .fl-aic-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 11px 18px; border-radius: 7px; cursor: pointer;
    font: inherit; font-size: 13px; letter-spacing: 1.6px;
    color: var(--fl-text);
    background: rgba(var(--fl-accent-rgb), .1);
    border: 1px solid rgba(var(--fl-accent-rgb), .28);
    transition: all .16s;
  }
  .fl-aic-btn:hover:not([disabled]) {
    background: rgba(var(--fl-accent-rgb), .2);
    border-color: var(--fl-accent);
    box-shadow: 0 0 14px rgba(var(--fl-accent-rgb), .16);
  }
  .fl-aic-btn:active:not([disabled]) { transform: scale(.98); }
  .fl-aic-btn[disabled] { opacity: .42; cursor: not-allowed; }
  .fl-aic-btn.ghost { background: rgba(255,255,255,.02); }
  .fl-aic-btn.primary {
    background: linear-gradient(100deg,
      rgba(var(--fl-accent-rgb), .26) 0%,
      rgba(var(--fl-accent-rgb), .46) 50%,
      rgba(var(--fl-accent-rgb), .26) 100%);
    border-color: rgba(var(--fl-accent-rgb), .6);
    color: #fff4d2; font-weight: 600;
  }
  .fl-aic-btn.primary:hover:not([disabled]) {
    box-shadow: 0 0 20px rgba(var(--fl-accent-rgb), .42);
    filter: brightness(1.1);
  }
  .fl-aic-btn[disabled] .fl-aic-spin { animation: none !important; }

  .fl-aic-spin { display: inline-block; font-style: normal; }
  .fl-aic-spin.on { animation: fl-aic-rot .9s linear infinite; }
  @keyframes fl-aic-rot { to { transform: rotate(360deg); } }

  /* ---- 已选择模型 ---- */
  .fl-aic-cur {
    padding: 11px 14px; border-radius: 7px;
    font-size: 13px; letter-spacing: .4px;
    color: var(--fl-accent);
    background: rgba(var(--fl-accent-rgb), .07);
    border: 1px solid rgba(var(--fl-accent-rgb), .16);
    word-break: break-all;
  }

  /* ---- 提示 ---- */
  .fl-aic-err {
    margin-top: 14px; padding: 11px 14px; border-radius: 6px;
    font-size: 12px; line-height: 1.7;
    color: #e8a396;
    background: rgba(212,127,108,.09);
    border: 1px solid rgba(212,127,108,.32);
    word-break: break-word;
  }
  .fl-aic-ok {
    margin-top: 14px; padding: 11px 14px; border-radius: 6px;
    font-size: 12px; color: #a8d69a;
    background: rgba(143,191,122,.08);
    border: 1px solid rgba(143,191,122,.3);
  }

  .fl-aic-foot { display: flex; gap: 10px; padding: 20px 0 0; }

  .fl-aic-note {
    margin-top: 22px; padding: 14px 16px; border-radius: 7px;
    font-size: 11.5px; line-height: 1.9;
    color: rgba(var(--fl-text-rgb), .38);
    background: rgba(255,255,255,.014);
    border: 1px solid rgba(var(--fl-accent-rgb), .09);
  }
  .fl-aic-note b {
    display: block; margin-bottom: 6px;
    font-weight: 400; font-size: 10.5px; letter-spacing: 2.4px;
    color: rgba(var(--fl-accent-rgb), .55);
  }
  .fl-aic-note code {
    padding: 1px 5px; border-radius: 3px;
    font-family: ui-monospace, Consolas, monospace; font-size: 10.5px;
    color: rgba(var(--fl-accent-rgb), .78);
    background: rgba(var(--fl-accent-rgb), .08);
    word-break: break-all;
  }

  /* ---- 手机 ---- */
  @media (max-width: 760px) {
    .fl-aic { padding: 0 0 30px; }
    .fl-aic-head { padding: 10px 0 14px; }
    .fl-aic-title { font-size: 14px; letter-spacing: 1.4px; }
    .fl-aic-sub { font-size: 11.5px; }
    .fl-aic-f { padding: 16px 0; gap: 7px; }
    .fl-aic-l { font-size: 13px; }
    .fl-aic-h { font-size: 11px; }
    .fl-aic-in, .fl-aic-sel { padding: 11px 12px; font-size: 13px; }
    .fl-aic-sel { padding-right: 34px; }
    .fl-aic-btn { padding: 11px 14px; font-size: 12.5px; letter-spacing: 1.2px; }
    .fl-aic-foot { gap: 8px; }
    .fl-aic-foot .fl-aic-btn { flex: 1; }
    .fl-aic-note { font-size: 11px; line-height: 1.85; }
  }
`;
})();
