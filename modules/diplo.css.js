/**
 * 外交页 · 样式
 *
 * 三块：势力大卡（10 国）、地点列表、地点档案。
 * 配色沿用主面板的琥珀金，不引入新色系。
 */
(function () {
  'use strict';

  window.__fiefCssDiplo = String.raw`
/* ---------------------------------------------------------------- 势力大卡 */
.fl-dw {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  gap: 10px;
  margin: 4px 0 6px;
}

.fl-dw-card {
  position: relative;
  padding: 12px 13px 11px;
  border: 1px solid var(--fl-line);
  border-radius: 10px;
  background:
    linear-gradient(165deg, rgba(212, 175, 90, 0.055), rgba(212, 175, 90, 0.012) 46%, transparent 74%);
  cursor: pointer;
  transition: border-color .16s, background .16s, transform .16s;
  overflow: hidden;
}

.fl-dw-card::before {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 2px;
  background: linear-gradient(180deg, var(--fl-gold), transparent);
  opacity: .34;
  transition: opacity .16s;
}

.fl-dw-card:hover {
  border-color: rgba(212, 175, 90, .46);
  background:
    linear-gradient(165deg, rgba(212, 175, 90, 0.1), rgba(212, 175, 90, 0.03) 46%, transparent 74%);
  transform: translateY(-1px);
}

.fl-dw-card:hover::before { opacity: .8; }

.fl-dw-card.on {
  border-color: var(--fl-gold);
  background:
    linear-gradient(165deg, rgba(212, 175, 90, 0.16), rgba(212, 175, 90, 0.05) 46%, transparent 74%);
}

.fl-dw-card.on::before { opacity: 1; }

/* 有领地但没记邻邦时给个说明，不要让这块无声消失 */
.fl-dw-empty {
  border: 1px dashed var(--fl-line2);
  border-radius: 10px;
  padding: 14px 14px 13px;
  font-size: 12.5px;
  color: var(--fl-dim);
  line-height: 1.7;
}
.fl-dw-empty small {
  display: block;
  margin-top: 5px;
  font-size: 11px;
  opacity: .8;
}
.fl-dw-empty code {
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.07);
}

.fl-dw-nm {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: .04em;
  color: var(--fl-ink);
  line-height: 1.35;
  margin-bottom: 5px;
}

.fl-dw-sub {
  font-size: 10.5px;
  letter-spacing: .04em;
  color: var(--fl-dim);
  line-height: 1.5;
}

.fl-dw-cnt {
  margin-top: 7px;
  padding-top: 6px;
  border-top: 1px dashed rgba(212, 175, 90, .16);
  font-size: 10px;
  letter-spacing: .08em;
  color: rgba(212, 175, 90, .74);
}

.fl-dw-cnt i {
  font-style: normal;
  color: var(--fl-dim);
}

/* ---------------------------------------------------------------- 地点列表 */
.fl-dp-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 4px 0 6px;
}

.fl-dp-row {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 8px 11px;
  border: 1px solid transparent;
  border-radius: 7px;
  cursor: pointer;
  transition: background .14s, border-color .14s;
}

.fl-dp-row:hover {
  background: rgba(212, 175, 90, .055);
  border-color: rgba(212, 175, 90, .2);
}

.fl-dp-row.on {
  background: rgba(212, 175, 90, .1);
  border-color: rgba(212, 175, 90, .4);
}

/* 子地点：左边一个折线，字号略小，表明它在谁的下面 */
.fl-dp-sub {
  border-left: 1px solid rgba(212, 175, 90, .18);
  margin-left: 6px;
  border-radius: 0 7px 7px 0;
}

.fl-dp-br {
  font-size: 11px;
  opacity: .35;
  flex: 0 0 auto;
  line-height: 1.5;
}

.fl-dp-sub .fl-dp-nm {
  font-size: 12.5px;
  opacity: .92;
}

/* 原文只列了名字、没有独立条目的城市 —— 看得见，但点不了 */
.fl-dp-ghost {
  cursor: default;
  opacity: .72;
}

.fl-dp-ghost:hover {
  background: transparent;
  border-color: transparent;
}

.fl-dp-ghost .fl-dp-nm {
  font-style: italic;
}

/* 公国：中层的政治实体，本身不是一个能点开的地点 */
.fl-dp-duchy {
  cursor: default;
  margin-top: 6px;
  border-top: 1px solid rgba(212, 175, 90, .16);
  padding-top: 9px;
}

.fl-dp-duchy:hover {
  background: transparent;
  border-color: transparent;
  border-top-color: rgba(212, 175, 90, .16);
}

.fl-dp-duchy .fl-dp-nm {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .3px;
}

.fl-dp-nm {
  font-size: 13px;
  color: var(--fl-ink);
  line-height: 1.4;
  flex: 0 0 auto;
}

.fl-dp-tag {
  font-size: 10px;
  letter-spacing: .05em;
  color: rgba(212, 175, 90, .72);
  border: 1px solid rgba(212, 175, 90, .24);
  border-radius: 4px;
  padding: 1px 5px;
  flex: 0 0 auto;
}

.fl-dp-wh {
  font-size: 10.5px;
  color: var(--fl-dim);
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: right;
}

.fl-dp-more {
  padding: 9px 11px;
  font-size: 11px;
  letter-spacing: .06em;
  color: rgba(212, 175, 90, .8);
  cursor: pointer;
  border-radius: 7px;
  text-align: center;
  border: 1px dashed rgba(212, 175, 90, .24);
  transition: background .14s, border-color .14s;
}

.fl-dp-more:hover {
  background: rgba(212, 175, 90, .07);
  border-color: rgba(212, 175, 90, .44);
}

/* ---------------------------------------------------------------- 地点档案 */
.fl-pf {
  margin: 6px 0 4px;
  padding: 14px 15px 13px;
  border: 1px solid rgba(212, 175, 90, .28);
  border-radius: 11px;
  background:
    linear-gradient(168deg, rgba(212, 175, 90, .075), rgba(212, 175, 90, .014) 44%, transparent 76%);
}

.fl-pf-hd {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  margin-bottom: 11px;
}

.fl-pf-crest {
  flex: 0 0 auto;
  width: 42px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 600;
  color: #2a2114;
  background: linear-gradient(160deg, #e0c47c, #b8933f);
  border-radius: 5px 5px 22px 22px / 5px 5px 34px 34px;
  box-shadow: 0 2px 9px rgba(0, 0, 0, .36);
}

.fl-pf-tt { flex: 1 1 auto; min-width: 0; }

.fl-pf-nm {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: .05em;
  color: var(--fl-ink);
  line-height: 1.3;
}

.fl-pf-meta {
  margin-top: 5px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px 8px;
}

.fl-pf-chip {
  font-size: 10.5px;
  letter-spacing: .04em;
  color: var(--fl-dim);
  border: 1px solid var(--fl-line);
  border-radius: 4px;
  padding: 1.5px 6px;
  white-space: nowrap;
}

.fl-pf-chip b {
  font-weight: 500;
  color: rgba(212, 175, 90, .88);
}

.fl-pf-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin: 12px 0 10px;
  border: 1px solid var(--fl-line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--fl-line);
}

.fl-pf-m {
  padding: 9px 10px 8px;
  background: rgba(20, 17, 12, .62);
}

.fl-pf-mk {
  font-size: 10px;
  letter-spacing: .12em;
  color: var(--fl-dim);
  margin-bottom: 3px;
}

.fl-pf-mv {
  font-size: 14.5px;
  color: var(--fl-ink);
  line-height: 1.25;
}

.fl-pf-mv small {
  font-size: 10px;
  color: var(--fl-dim);
  margin-left: 2px;
}

.fl-pf-sec {
  margin-top: 11px;
  padding-top: 9px;
  border-top: 1px dashed rgba(212, 175, 90, .15);
}

.fl-pf-sk {
  font-size: 10.5px;
  letter-spacing: .14em;
  color: rgba(212, 175, 90, .84);
  margin-bottom: 6px;
}

.fl-pf-kv {
  display: flex;
  gap: 10px;
  padding: 3.5px 0;
  font-size: 12px;
  line-height: 1.66;
}

.fl-pf-kv .k {
  flex: 0 0 62px;
  color: var(--fl-dim);
  font-size: 11px;
  letter-spacing: .04em;
}

.fl-pf-kv .v {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--fl-ink);
}

.fl-pf-raw {
  margin-top: 10px;
  padding: 10px 11px;
  border: 1px dashed rgba(212, 175, 90, .2);
  border-radius: 7px;
  font-size: 11.5px;
  line-height: 1.82;
  color: var(--fl-dim);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow-y: auto;
}

.fl-pf-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 11px;
}

.fl-pf-btn {
  flex: 0 0 auto;
  padding: 6px 13px;
  font-size: 11.5px;
  letter-spacing: .06em;
  color: rgba(212, 175, 90, .92);
  border: 1px solid rgba(212, 175, 90, .34);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: background .14s, border-color .14s, color .14s;
}

.fl-pf-btn:hover {
  background: rgba(212, 175, 90, .12);
  border-color: rgba(212, 175, 90, .6);
  color: var(--fl-gold);
}

.fl-pf-btn.primary {
  background: rgba(212, 175, 90, .14);
  border-color: rgba(212, 175, 90, .5);
}

.fl-pf-btn.busy {
  opacity: .55;
  cursor: default;
  pointer-events: none;
}

.fl-pf-note {
  margin-top: 9px;
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--fl-dim);
}

.fl-pf-note code {
  font-size: 10px;
  color: rgba(212, 175, 90, .8);
  background: rgba(212, 175, 90, .08);
  padding: 1px 4px;
  border-radius: 3px;
}

/* ---------------------------------------------------------------- 加载与空态 */
.fl-dw-load {
  padding: 22px 12px;
  text-align: center;
  font-size: 12px;
  letter-spacing: .06em;
  color: var(--fl-dim);
}

.fl-dw-load b {
  display: block;
  font-size: 15px;
  letter-spacing: .12em;
  color: rgba(212, 175, 90, .8);
  margin-bottom: 7px;
  font-weight: 500;
}

@keyframes fl-dw-dot {
  0%, 100% { opacity: .25; }
  50%      { opacity: 1; }
}

.fl-dw-load i {
  display: inline-block;
  font-style: normal;
  animation: fl-dw-dot 1.25s ease-in-out infinite;
}

.fl-dw-load i:nth-child(2) { animation-delay: .18s; }
.fl-dw-load i:nth-child(3) { animation-delay: .36s; }

@media (max-width: 760px) {
  .fl-dw {
    grid-template-columns: repeat(auto-fill, minmax(136px, 1fr));
    gap: 8px;
  }
  .fl-dw-card { padding: 10px 11px 9px; }
  .fl-dw-nm { font-size: 12.5px; }
  .fl-pf-metrics { grid-template-columns: repeat(3, 1fr); }
  .fl-pf { padding: 12px 12px 11px; }
  .fl-pf-nm { font-size: 15px; }
  .fl-pf-kv .k { flex: 0 0 54px; }
  .fl-dp-wh { display: none; }
}

@media (max-width: 380px) {
  .fl-dw { grid-template-columns: repeat(2, 1fr); }
  .fl-pf-metrics { grid-template-columns: repeat(2, 1fr); }
}
`;
})();
