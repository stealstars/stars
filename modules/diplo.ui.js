/**
 * 外交页 · 逻辑
 *
 * 三块内容：
 *   ① 邻邦      —— 当前领地 [邻邦:] 里写的势力
 *   ② 天下势力  —— 世界书 [本体][势力] 拆出来的势力大卡
 *   ③ 地点档案  —— 世界书原文 → AI 改写成领地档案
 *
 * 名单一律运行时扫，不硬编码。命定更新后刷新即生效。
 *
 * 产物：window.__fiefDiplo
 */
(function () {
  'use strict';

  var host = (typeof window !== 'undefined' && window.__fiefHost) || (typeof window !== 'undefined' ? window : globalThis);
  var BOOK = function () { return host.__fiefBook || null; };
  var AI = function () { return host.__fiefAI || null; };
  var PROMPT = function () {
    var p = host.__fiefPrompts;
    return p ? (p['外交档案'] || p['外交'] || null) : null;
  };

  /* ------------------------------------------------------------ 状态 */

  var S = {
    faction: '',
    place: '',
    expanded: {},
    profile: null,      // 当前地点的 AI 档案
    busy: false,
    err: '',
    showRaw: false,     // 用户点了「看原文」，暂时盖住 AI 档案
    ready: false,       // 世界书扫完了没有
    scanned: false,     // 至少扫过一次（不管扫到几条）——0 条也不能反复重扫
    scanning: false,
    scanErr: '',
    mode: '',           // '' | 'ai'
    neighbour: [],      // 邻邦名列表（由主脚本塞进来）
  };

  var PREF = 'fief-ledger-diplo-v2';
  var CACHE = 'fief-ledger-diplo-cache-v1';

  function loadPref() {
    try {
      var r = host.localStorage && host.localStorage.getItem(PREF);
      if (!r) return;
      var p = JSON.parse(r);
      if (p && typeof p === 'object') {
        if (typeof p.faction === 'string') S.faction = p.faction;
        if (typeof p.place === 'string') S.place = p.place;
      }
    } catch (e) { /* 忽略 */ }
  }

  function savePref() {
    try {
      if (host.localStorage) host.localStorage.setItem(PREF, JSON.stringify({ faction: S.faction, place: S.place }));
    } catch (e) { /* 忽略 */ }
  }

  /** AI 档案按「势力|地点」缓存在本机，不写世界书、不写聊天变量 */
  function cacheKey(f, p) { return String(f) + '|' + String(p); }

  function cacheLoad() {
    try {
      var r = host.localStorage && host.localStorage.getItem(CACHE);
      return r ? JSON.parse(r) : {};
    } catch (e) { return {}; }
  }

  function cacheGet(f, p) {
    var all = cacheLoad();
    return all[cacheKey(f, p)] || null;
  }

  function cachePut(f, p, val) {
    try {
      var all = cacheLoad();
      all[cacheKey(f, p)] = val;
      // 只留最近 40 条，别把 localStorage 撑爆
      var ks = Object.keys(all);
      if (ks.length > 40) {
        ks.sort(function (a, b) { return (all[a]._at || 0) - (all[b]._at || 0); });
        for (var i = 0; i < ks.length - 40; i += 1) delete all[ks[i]];
      }
      if (host.localStorage) host.localStorage.setItem(CACHE, JSON.stringify(all));
    } catch (e) { /* 忽略 */ }
  }

  function cacheDrop(f, p) {
    try {
      var all = cacheLoad();
      delete all[cacheKey(f, p)];
      if (host.localStorage) host.localStorage.setItem(CACHE, JSON.stringify(all));
    } catch (e) { /* 忽略 */ }
  }

  /* ------------------------------------------------------------ 工具 */

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  function crest(name) {
    var s = String(name || '').replace(/^\[.*?\]/, '').trim();
    return s ? s.charAt(0) : '·';
  }

  function factionKind(name) {
    if (/圣国|教廷|教国/.test(name)) return '神权';
    if (/帝国/.test(name)) return '帝制';
    if (/王国/.test(name)) return '王权';
    if (/联盟/.test(name)) return '诸邦';
    if (/法环/.test(name)) return '合议';
    if (/联邦/.test(name)) return '城邦';
    if (/王庭/.test(name)) return '王庭';
    if (/盟约/.test(name)) return '寡头';
    return '势力';
  }

  /* ------------------------------------------------------------ 取数据 */

  function book() {
    var b = BOOK();
    if (!b) return null;
    // scan 是异步的，这里只取已经扫完的结果；没扫完返回 null，界面画「读取中」
    try { return b.scanSync(); } catch (e) { return null; }
  }

  /** 启动扫描，扫完重绘 */
  function ensureScan() {
    var b = BOOK();
    if (!b) { S.ready = false; S.scanErr = '世界书模块没加载'; return; }
    if (S.ready || S.scanning) return;
    S.scanning = true;
    S.scanErr = '';
    try {
      b.scan(false).then(function (c) {
        S.scanning = false;
        S.scanned = true;
        S.ready = !!(c && c.count);
        S.scanErr = c && c.err ? c.err : '';
        rerender(null);
      }).catch(function (e) {
        S.scanning = false;
        S.scanned = true;
        S.ready = false;
        S.scanErr = (e && e.message) || String(e);
        rerender(null);
      });
    } catch (e) {
      S.scanning = false;
      S.scanned = true;
      S.ready = false;
      S.scanErr = (e && e.message) || String(e);
    }
  }

  /** 强制重扫 */
  function rescan() {
    var b = BOOK();
    if (!b) return;
    S.scanning = true; S.scanErr = ''; S.ready = false;
    rerender(null);
    b.scan(true).then(function (c) {
      S.scanning = false;
      S.scanned = true;
      S.ready = !!(c && c.count);
      S.scanErr = c && c.err ? c.err : '';
      rerender(null);
    }).catch(function (e) {
      S.scanning = false;
      S.scanned = true;
      S.scanErr = (e && e.message) || String(e);
      rerender(null);
    });
  }

  /** 世界书里的势力，按地点数排序 */
  function factions() {
    var c = book();
    if (!c) return [];
    var names = Object.keys(c.factions);
    names.sort(function (a, b) {
      var d = c.factions[b].places.length - c.factions[a].places.length;
      return d || String(a).localeCompare(String(b), 'zh');
    });
    return names.map(function (n) {
      return { name: n, kind: factionKind(n), places: c.factions[n].places, overview: c.factions[n].overview };
    });
  }

  /** 邻邦：优先用主脚本塞进来的，其次从世界书势力里按名字找 */
  function neighbours() {
    var c = book();
    var out = [];
    var list = Array.isArray(S.neighbour) ? S.neighbour : [];
    for (var i = 0; i < list.length; i += 1) {
      var raw = list[i];
      var name = typeof raw === 'string' ? raw : (raw && (raw.name || raw.名)) || '';
      var tone = typeof raw === 'object' && raw ? (raw.tone || raw.态度 || '') : '';
      // note 是原文里名字后面那截（「观望」「戒备」…），label 是归并后的中文名。
      // 之前只留了 tone（mid/ok 这种内部键），界面上就只能显示 mid。
      var note = typeof raw === 'object' && raw ? (raw.note || raw.备注 || '') : '';
      var label = typeof raw === 'object' && raw ? (raw.label || '') : '';
      if (!name) continue;
      out.push({
        name: name,
        tone: tone,
        note: note,
        label: label,
        faction: c && c.factions[name] ? c.factions[name] : null,
      });
    }
    return out;
  }

  function currentFaction() {
    var fs = factions();
    for (var i = 0; i < fs.length; i += 1) if (fs[i].name === S.faction) return fs[i];
    return fs.length ? fs[0] : null;
  }

  function currentPlace() {
    var f = currentFaction();
    if (!f) return null;
    for (var i = 0; i < f.places.length; i += 1) if (f.places[i].name === S.place) return f.places[i];
    return null;
  }

  /* ------------------------------------------------------------ 渲染：邻邦 */

  function renderNeighbours() {
    var ns = neighbours();
    if (!ns.length) return '';
    var out = '<div class="fl-dip-h" style="margin-top:4px"><b>邻 邦</b><em>Neighbours</em><s></s></div>';
    out += '<div class="fl-dw">';
    for (var i = 0; i < ns.length; i += 1) {
      var n = ns[i];
      var on = n.name === S.faction ? ' on' : '';
      var cnt = n.faction ? n.faction.places.length : 0;
      out += '<div class="fl-dw-card' + on + '" data-dw-faction="' + esc(n.name) + '">'
        + '<div class="fl-dw-nm">' + esc(n.name) + '</div>'
        + '<div class="fl-dw-sub">'
        // 显示玩家/世界书里的原话（观望、戒备…），不要显示 mid/ok 这种内部键。
        // note 是原文里名字后面的部分，label 是归并后的中文标签，tone 只是上色用的。
        + (function () {
          var shown = n.note || n.label || '';
          if (!shown && !n.tone) return esc(factionKind(n.name));
          var cls = n.tone === 'bad' ? ' fl-dw-tone bad' : (n.tone === 'ok' ? ' fl-dw-tone ok' : ' fl-dw-tone');
          return '<span class="' + cls.trim() + '">' + esc(shown || factionKind(n.name)) + '</span>';
        })()
        + '</div>'
        + '<div class="fl-dw-cnt">'
        + (cnt ? cnt + ' 处 <i>地点</i>' : '<i>世界书无此地条目</i>')
        + '</div></div>';
    }
    out += '</div>';
    return out;
  }

  /* ------------------------------------------------------------ 渲染：势力大卡 */

  function renderFactions() {
    var fs = factions();
    if (!fs.length) {
      return '<div class="fl-dw-load"><b>读 不 到 世 界 书</b>'
        + '外交页靠世界书里的势力条目工作，现在一条也没读到。<br>'
        + '确认命定本体世界书已在酒馆里启用，然后刷新这一页。<br><br>'
        + '<span style="font-size:10.5px;opacity:.72">控制台可以查：<code>__fiefBook.debug()</code></span></div>';
    }
    var out = '<div class="fl-dw">';
    for (var i = 0; i < fs.length; i += 1) {
      var f = fs[i];
      var on = f.name === S.faction ? ' on' : '';
      out += '<div class="fl-dw-card' + on + '" data-dw-faction="' + esc(f.name) + '">'
        + '<div class="fl-dw-nm">' + esc(f.name) + '</div>'
        + '<div class="fl-dw-sub">' + esc(f.kind) + '</div>'
        + '<div class="fl-dw-cnt">'
        + (f.places.length ? f.places.length + ' 处 <i>地点</i>' : '<i>暂无地点条目</i>')
        + '</div></div>';
    }
    out += '</div>';
    return out;
  }

  /* ------------------------------------------------------------ 渲染：地点列表 */

  var PAGE = 14;

  function renderPlaces() {
    var f = currentFaction();
    if (!f) return '';
    if (!f.places.length) {
      return '<div class="fl-dp-list"><div class="fl-pf-note">'
        + '世界书里这个势力只有总述，没有单列的地点条目。<br>'
        + '想看它治下的一处地方，可以去世界书里找它的城镇条目。'
        + '</div></div>';
    }
    var show = S.expanded[f.name] ? f.places.length : Math.min(PAGE, f.places.length);
    var out = '<div class="fl-dp-list">';
    for (var i = 0; i < show; i += 1) {
      var p = f.places[i];
      var on = p.name === S.place ? ' on' : '';
      var hit = cacheGet(f.name, p.name);
      out += '<div class="fl-dp-row' + on + '" data-dw-place="' + esc(p.name) + '">'
        + '<span class="fl-dp-nm">' + esc(p.name) + '</span>'
        + (p.scale ? '<span class="fl-dp-tag">' + esc(p.scale) + '</span>' : '')
        + (hit ? '<span class="fl-dp-tag" style="opacity:.6">已建档</span>' : '')
        + (p.where ? '<span class="fl-dp-wh">' + esc(p.where) + '</span>' : '')
        + '</div>';
    }
    out += '</div>';
    if (f.places.length > PAGE) {
      var rest = f.places.length - show;
      out += '<div class="fl-dp-more" data-dw-more="' + esc(f.name) + '">'
        + (rest > 0 ? '还有 ' + rest + ' 处 · 展开全部' : '收起')
        + '</div>';
    }
    return out;
  }

  /* ------------------------------------------------------------ 渲染：档案 */

  /** 从世界书原文里抽关键行，原文没建档时也能先看一眼 */
  function sniffSections(text) {
    var raw = String(text || '');
    var out = [];
    var KEYS = [
      ['管辖势力', ['管辖势力', '所属', '归属']],
      ['位置', ['位置', '地点']],
      ['人口', ['人口构成', '人口']],
      ['产业', ['主要产业', '产业']],
      ['输出', ['输出']],
      ['输入', ['输入']],
      ['分区', ['城市分区']],
    ];
    for (var i = 0; i < KEYS.length; i += 1) {
      var alts = KEYS[i][1];
      for (var j = 0; j < alts.length; j += 1) {
        var re = new RegExp('(?:^|[\\s|｜])' + alts[j] + '\\s*[:：]\\s*([^\\n]{1,120})', 'm');
        var m = raw.match(re);
        if (m && m[1].trim()) { out.push([KEYS[i][0], m[1].trim()]); break; }
      }
    }
    return out;
  }

  function sniffLead(text) {
    var raw = String(text || '');
    var m = raw.match(/(?:概览|定位|简介|概况)\s*[:：]\s*\|?\s*\n?([\s\S]{6,260}?)(?:\n\s{0,4}[^\s].*?:|$)/);
    if (m) return m[1].replace(/\s+/g, ' ').trim();
    var lines = raw.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].length > 14 && !/^[-—=]+$/.test(lines[i]) && lines[i].indexOf(':') < 0) return lines[i];
    }
    return '';
  }

  function metric(label, val, unit) {
    return '<div class="fl-pf-m"><div class="fl-pf-mk">' + esc(label) + '</div>'
      + '<div class="fl-pf-mv">' + esc(val || '—')
      + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div></div>';
  }

  function kv(k, v) {
    return '<div class="fl-pf-kv"><span class="k">' + esc(k) + '</span>'
      + '<span class="v">' + esc(v) + '</span></div>';
  }

  /** 有 AI 档案时按领地面板的样式画 */
  function renderAiProfile(p, a) {
    var html = '<div class="fl-pf">';

    html += '<div class="fl-pf-hd">'
      + '<div class="fl-pf-crest">' + esc(crest(a.领地 || p.name)) + '</div>'
      + '<div class="fl-pf-tt">'
      + '<div class="fl-pf-nm">' + esc(a.领地 || p.name) + '</div>'
      + '<div class="fl-pf-meta">'
      + (a.规模档 ? '<span class="fl-pf-chip"><b>规模</b> ' + esc(a.规模档) + '</span>' : '')
      + (a.所属势力 ? '<span class="fl-pf-chip"><b>所属</b> ' + esc(a.所属势力) + '</span>' : '')
      + (a.治理模式 ? '<span class="fl-pf-chip"><b>治理</b> ' + esc(a.治理模式) + '</span>' : '')
      + (a.状态 ? '<span class="fl-pf-chip"><b>状态</b> ' + esc(a.状态) + '</span>' : '')
      + '</div></div></div>';

    html += '<div class="fl-pf-metrics">'
      + metric('治 安', a.治安 ? a.治安 + ' / 100' : '—')
      + metric('民 心', a.民心 ? a.民心 + ' / 100' : '—')
      + metric('物 资', a.物资 || '—')
      + metric('人 口', a.人口 || '—')
      + metric('金 库', a.金库 || '—')
      + metric('月净额', a.月净额 || '—')
      + '</div>';

    if (a.军事 && a.军事.length) {
      html += '<div class="fl-pf-sec"><div class="fl-pf-sk">军 事</div>';
      for (var i = 0; i < a.军事.length; i += 1) {
        var u = a.军事[i] || {};
        html += '<div class="fl-pf-kv"><span class="k">' + esc(u.编制 || '—') + '</span>'
          + '<span class="v">' + esc(u.层级 || '') + (u.人数 ? '　' + esc(u.人数) : '') + '</span></div>';
      }
      html += '</div>';
    }

    if (a.营造 && a.营造.length) {
      html += '<div class="fl-pf-sec"><div class="fl-pf-sk">营 造</div>';
      for (var j = 0; j < a.营造.length; j += 1) {
        var b = a.营造[j] || {};
        html += '<div class="fl-pf-kv"><span class="k">' + esc(b.名 || '—') + '</span>'
          + '<span class="v">' + esc(b.数量 || '') + (b.状态 ? '　' + esc(b.状态) : '') + '</span></div>';
      }
      html += '</div>';
    }

    if (a.物产 && a.物产.length) {
      html += '<div class="fl-pf-sec"><div class="fl-pf-sk">物 产</div>';
      for (var k = 0; k < a.物产.length; k += 1) {
        var g = a.物产[k] || {};
        html += '<div class="fl-pf-kv"><span class="k">' + esc(g.名 || '—') + '</span>'
          + '<span class="v">' + esc(g.数量 || '') + (g.周期 ? '　每' + esc(g.周期) : '')
          + (g.状态 ? '　' + esc(g.状态) : '') + '</span></div>';
      }
      html += '</div>';
    }

    if (a.要事 && a.要事.length) {
      html += '<div class="fl-pf-sec"><div class="fl-pf-sk">要 事</div>';
      for (var m = 0; m < a.要事.length; m += 1) {
        html += '<div class="fl-pf-kv"><span class="v" style="line-height:1.8">' + esc(a.要事[m]) + '</span></div>';
      }
      html += '</div>';
    }

    if (a.治下 && (a.治下.头衔 || a.治下.主)) {
      html += '<div class="fl-pf-sec"><div class="fl-pf-sk">治 下</div>'
        + kv('头衔', a.治下.头衔 || '—')
        + kv('主事', a.治下.主 || '—')
        + kv('副手', a.治下.副 || '—')
        + kv('态度', a.治下.态度 || '—')
        + '</div>';
    }

    html += '<div class="fl-pf-acts">'
      + '<button class="fl-pf-btn primary" data-dw-act="again">重新建档</button>'
      + '<button class="fl-pf-btn" data-dw-act="send">发到聊天框</button>'
      + '<button class="fl-pf-btn" data-dw-act="raw">看原文</button>'
      + '</div>';

    html += '<div class="fl-pf-note">这份档案由 AI 按世界书原文改写，'
      + '规模与势力照抄原文，其余按制度与档位推定。<br>'
      + '存在本机，不写世界书，不进聊天变量。';
    if (a._model) html += '<br>模型：<code>' + esc(a._model) + '</code>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  /** 没有 AI 档案时画原文摘要 */
  function renderRawProfile(p) {
    var kvp = sniffSections(p.content);
    var lead = sniffLead(p.content);
    var f = currentFaction();

    var html = '<div class="fl-pf">';
    html += '<div class="fl-pf-hd">'
      + '<div class="fl-pf-crest">' + esc(crest(p.name)) + '</div>'
      + '<div class="fl-pf-tt">'
      + '<div class="fl-pf-nm">' + esc(p.name) + '</div>'
      + '<div class="fl-pf-meta">'
      + '<span class="fl-pf-chip"><b>势力</b> ' + esc(f ? f.name : p.faction) + '</span>'
      + (p.scale ? '<span class="fl-pf-chip"><b>规模</b> ' + esc(p.scale) + '</span>' : '')
      + (p.tags && p.tags.length ? '<span class="fl-pf-chip">' + esc(p.tags.join(' · ')) + '</span>' : '')
      + '</div></div></div>';

    if (lead) {
      html += '<div class="fl-pf-raw" style="max-height:none;border-style:solid;'
        + 'border-color:rgba(212,175,90,.14);color:var(--fl-ink);opacity:.9">' + esc(lead) + '</div>';
    }

    if (kvp.length) {
      html += '<div class="fl-pf-sec"><div class="fl-pf-sk">摘 要</div>';
      for (var i = 0; i < kvp.length; i += 1) html += kv(kvp[i][0], kvp[i][1]);
      html += '</div>';
    }

    html += '<div class="fl-pf-sec"><div class="fl-pf-sk">原 文 '
      + '<span style="opacity:.6;letter-spacing:.04em">世界书 · ' + p.len + ' 字</span></div>'
      + '<div class="fl-pf-raw">' + esc(p.content) + '</div></div>';

    // 已经有档案时，「建档」改成「看档案」，不再白跑一次 API
    var hasProfile = !!(S.profile || cacheGet(p.faction, p.name));
    html += '<div class="fl-pf-acts">'
      + (hasProfile
        ? '<button class="fl-pf-btn primary" data-dw-act="back">看档案</button>'
          + '<button class="fl-pf-btn" data-dw-act="again">重新建档</button>'
        : '<button class="fl-pf-btn primary" data-dw-act="build">建档</button>')
      + '<button class="fl-pf-btn" data-dw-act="copy">复制原文</button>'
      + '</div>';

    html += '<div class="fl-pf-note">现在是世界书原文。'
      + (hasProfile
        ? '这份地点已经建过档，点「看档案」回去。'
        : '点「建档」让 AI 按领地扩展的格式整理成档案。')
      + '</div>';
    html += '</div>';
    return html;
  }

  function renderBusy() {
    return '<div class="fl-pf"><div class="fl-dw-load">'
      + '<b>建 档 中</b>正在按世界书原文整理档案<i>.</i><i>.</i><i>.</i>'
      + '<div style="margin-top:10px;font-size:10.5px;opacity:.65">规模与势力照抄原文，其余按制度推</div>'
      + '</div></div>';
  }

  function renderError() {
    return '<div class="fl-pf"><div class="fl-dw-load" style="text-align:left">'
      + '<b style="color:#c98a6a">建 档 失 败</b>'
      + '<div style="line-height:1.8;font-size:11.5px;text-align:left;white-space:pre-wrap">'
      + esc(S.err) + '</div>'
      + '<div class="fl-pf-acts" style="margin-top:12px">'
      + '<button class="fl-pf-btn primary" data-dw-act="build">重试</button>'
      + '<button class="fl-pf-btn" data-dw-act="raw">只看原文</button>'
      + '</div></div></div>';
  }

  function renderProfile() {
    var p = currentPlace();
    if (!p) return '';
    if (S.busy) return renderBusy();
    if (S.err) return renderError();
    // 点了「看原文」：S.showRaw 为真时无视内存与缓存，
    // 否则清掉 S.profile 也会被下面这句从缓存里读回来，界面看着像没反应
    if (S.showRaw) return renderRawProfile(p);
    var a = S.profile || cacheGet(p.faction, p.name);
    if (a && a.领地) return renderAiProfile(p, a);
    return renderRawProfile(p);
  }

  /* ------------------------------------------------------------ 建档 */

  function buildProfile() {
    var p = currentPlace();
    if (!p) return;
    var ai = AI();
    if (!ai) { S.err = 'AI 模块没有加载。'; rerender(null); return; }
    var pr = PROMPT();
    if (!pr) { S.err = '提示词模块没有加载。'; rerender(null); return; }

    var f = currentFaction();
    S.busy = true; S.err = ''; S.profile = null;
    rerender(null);

    var userText = '';
    try {
      userText = pr.build({
        领地: p.name,
        所属势力: f ? f.name : '',
        规模档: p.scale || '',
        我方档位: S.ownTier || '',
        态度: '',
        原文: p.content,
      });
    } catch (e) {
      S.busy = false; S.err = '拼提示词出错：' + ((e && e.message) || e); rerender(null); return;
    }

    ai.chat(userText, {
      system: pr.system,
      temperature: 0.5,
      maxTokens: 3000,
      module: 'diplomacy',
    }).then(function (text) {
      var obj;
      try { obj = pr.parse(text); } catch (e) {
        throw new Error('模型返回的不是 JSON。\n' + String(text).slice(0, 300));
      }
      var norm = pr.normalize(obj);
      norm._at = Date.now();
      norm._model = (function () {
        try { var c = ai.getConf('diplomacy'); return c && c.model ? c.model : ''; } catch (e) { return ''; }
      })();
      cachePut(p.faction, p.name, norm);
      S.profile = norm;
      S.busy = false;
      rerender(null);
    }).catch(function (e) {
      S.busy = false;
      S.err = (e && e.message) || String(e);
      rerender(null);
    });
  }

  /* ------------------------------------------------------------ 总装 */

  function html() {
    var b = BOOK();
    if (!b) {
      return '<div class="fl-dw-load"><b>世 界 书 模 块 未 加 载</b>'
        + '外交页需要 <code>modules/worldbook.js</code>。<br>'
        + '如果是刚更新，刷新一下页面。</div>';
    }

    // 还没开始扫 → 起一个，先把界面画成「读取中」
    // 注意：扫完了但 0 条时不能再触发，否则永远停在「读取中」，看不到诊断表
    if (!S.ready && !S.scanning && !S.scanErr && !S.scanned) { ensureScan(); }

    if (S.scanning) {
      return '<div class="fl-dw-load"><b>读 取 世 界 书</b>'
        + '正在从酒馆里取世界书条目<i>.</i><i>.</i><i>.</i></div>';
    }

    var c = book();

    if (!c || !c.count) {
      var d = {};
      try { d = b.debug(); } catch (e) { d = { 错误: String(e && e.message) }; }
      var names = Array.isArray(d.世界书名) ? d.世界书名 : [];
      var lines = [
        ['酒馆助手可用', d.TavernHelper ? '是' : '否'],
        ['能调 getWorldbook', d.有getWorldbook ? '是' : '否'],
        ['拿到的世界书名', names.length ? names.join('、') : '（一个也没有）'],
        ['角色卡绑定', (function () {
          var v = d.角色卡世界书;
          if (!v) return '（未取到）';
          if (typeof v === 'string') return v;
          if (v.primary || v.additional) {
            return [v.primary].concat(v.additional || []).filter(Boolean).join('、') || '（空）';
          }
          return JSON.stringify(v).slice(0, 120);
        })()],
      ];
      var tbl = '';
      for (var i = 0; i < lines.length; i += 1) {
        tbl += '<div class="fl-pf-kv"><span class="k">' + esc(lines[i][0]) + '</span>'
          + '<span class="v">' + esc(lines[i][1]) + '</span></div>';
      }
      return '<div class="fl-dw-load" style="text-align:left">'
        + '<b>读 不 到 世 界 书</b>'
        + (S.scanErr ? '<div style="color:#c98a6a;margin:6px 0 10px">' + esc(S.scanErr) + '</div>' : '')
        + '<div style="margin:10px 0">' + tbl + '</div>'
        + '<div style="font-size:11px;line-height:1.9;opacity:.85">'
        + '对照上面几行：<br>'
        + '· 「酒馆助手可用」否 → 酒馆助手没装或没启用<br>'
        + '· 「拿到的世界书名」为空 → 世界书没挂到当前角色卡上<br>'
        + '· 名字有但条目 0 → 书名认得，读内容失败'
        + '</div>'
        + '<div class="fl-pf-acts" style="margin-top:12px">'
        + '<button class="fl-pf-btn primary" data-dw-act="rescan">重新扫描</button>'
        + '</div>'
        + '<div style="margin-top:10px;font-size:10.5px;opacity:.7">'
        + '控制台可以直接看：<code>__fiefBook.debug()</code> 和 <code>await __fiefBook.probe()</code>'
        + '</div></div>';
    }
    var out = '';

    var nb = renderNeighbours();
    if (nb) out += nb;

    out += '<div class="fl-dip-h"' + (nb ? ' style="margin-top:18px"' : '') + '>'
      + '<b>天 下 势 力</b><em>Powers</em><s></s></div>';
    out += renderFactions();

    var f = currentFaction();
    if (f) {
      out += '<div class="fl-dip-h" style="margin-top:18px"><b>' + esc(f.name) + ' · 地 点</b>'
        + '<em>' + f.places.length + ' Places</em><s></s></div>';
      out += renderPlaces();
      out += renderProfile();
    }

    out += '<div class="fl-sec-note" style="margin-top:16px">'
      + '势力与地点都是从世界书里现扫的，没有写死名单。'
      + '共扫到 ' + c.count + ' 条，' + Object.keys(c.factions).length + ' 个势力。'
      + '<br>改成世界书，刷新即生效。档案由 AI 按原文改写，存在本机。</div>';

    return out;
  }

  /* ------------------------------------------------------------ 交互 */

  function bind(root) {
    if (!root || root.__dwBound) return;
    root.__dwBound = true;

    root.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;

      var card = t.closest('[data-dw-faction]');
      if (card) {
        var fn = card.getAttribute('data-dw-faction');
        if (fn !== S.faction) {
          S.faction = fn;
          S.place = '';
          S.profile = null;
          S.err = '';
          S.busy = false;
          S.showRaw = false;
        }
        savePref();
        rerender(root);
        return;
      }

      var row = t.closest('[data-dw-place]');
      if (row) {
        var pn = row.getAttribute('data-dw-place');
        if (pn !== S.place) {
          S.place = pn;
          S.profile = null;
          S.err = '';
          S.busy = false;
          S.showRaw = false;
        }
        savePref();
        rerender(root);
        return;
      }

      var more = t.closest('[data-dw-more]');
      if (more) {
        var mf = more.getAttribute('data-dw-more');
        S.expanded[mf] = !S.expanded[mf];
        rerender(root);
        return;
      }

      var act = t.closest('[data-dw-act]');
      if (act) {
        var kind = act.getAttribute('data-dw-act');

        // 重扫不需要选中地点
        if (kind === 'rescan') {
          rescan();
          return;
        }

        var p = currentPlace();
        if (!p) return;

        if (kind === 'build' || kind === 'again') {
          var f2 = currentFaction();
          S.showRaw = false;
          if (kind === 'again' && f2) cacheDrop(f2.name, p.name);
          buildProfile();
          return;
        }
        if (kind === 'raw') {
          // 不能只清 S.profile —— 渲染时会从缓存再读回来，点了等于没点
          S.showRaw = true; S.err = ''; S.busy = false;
          rerender(root);
          return;
        }
        if (kind === 'back') {
          S.showRaw = false; S.err = '';
          rerender(root);
          return;
        }
        if (kind === 'copy') {
          try {
            if (host.navigator && host.navigator.clipboard) host.navigator.clipboard.writeText(p.content);
          } catch (e) { /* 忽略 */ }
          return;
        }
        if (kind === 'send') {
          var a = S.profile || cacheGet(p.faction, p.name);
          var text = a ? formatForChat(p, a) : ('【' + p.faction + ' · ' + p.name + '】\n' + p.content);
          if (typeof host.__fiefSendToInput === 'function') host.__fiefSendToInput(text);
          return;
        }
      }
    });
  }

  /** 把档案拼成一段能发进聊天框的文字 */
  function formatForChat(p, a) {
    var L = [];
    L.push('【' + (a.领地 || p.name) + '】');
    if (a.规模档) L.push('规模：' + a.规模档);
    if (a.所属势力) L.push('所属：' + a.所属势力);
    if (a.治理模式) L.push('治理：' + a.治理模式);
    if (a.状态) L.push('状态：' + a.状态);
    L.push('治安 ' + (a.治安 || '—') + '　民心 ' + (a.民心 || '—') + '　物资 ' + (a.物资 || '—'));
    if (a.人口) L.push('人口：' + a.人口);
    if (a.金库) L.push('金库：' + a.金库 + (a.月净额 ? '　月净额 ' + a.月净额 : ''));
    if (a.军事 && a.军事.length) {
      L.push('军事：');
      for (var i = 0; i < a.军事.length; i += 1) {
        var u = a.军事[i] || {};
        L.push('  ' + (u.编制 || '—') + '　' + (u.层级 || '') + (u.人数 ? '　' + u.人数 : ''));
      }
    }
    if (a.营造 && a.营造.length) {
      L.push('营造：' + a.营造.map(function (b) {
        return (b && b.名 ? b.名 : '—') + (b && b.数量 ? '×' + b.数量 : '');
      }).join('　'));
    }
    if (a.物产 && a.物产.length) {
      L.push('物产：' + a.物产.map(function (g) {
        return (g && g.名 ? g.名 : '—') + (g && g.数量 ? '(' + g.数量 + ')' : '');
      }).join('　'));
    }
    if (a.要事 && a.要事.length) {
      L.push('要事：');
      for (var j = 0; j < a.要事.length; j += 1) L.push('  · ' + a.要事[j]);
    }
    if (a.治下 && (a.治下.头衔 || a.治下.主)) {
      L.push('治下：' + [a.治下.头衔, a.治下.主, a.治下.副].filter(Boolean).join('　'));
    }
    return L.join('\n');
  }

  function rerender(root) {
    if (typeof host.__fiefRenderView === 'function') {
      try { host.__fiefRenderView(); return; } catch (e) { /* 落到下面 */ }
    }
    if (typeof host.__fiefRenderDiplo === 'function') {
      try { host.__fiefRenderDiplo(); return; } catch (e) { /* 忽略 */ }
    }
    var d = host.document;
    var el = d && d.querySelector ? d.querySelector('.fl-diplo-root') : null;
    if (el) { el.innerHTML = html(); bind(el); }
  }

  host.__fiefDiplo = {
    html: html,
    bind: bind,
    state: S,
    build: buildProfile,
    setNeighbours: function (list) { S.neighbour = Array.isArray(list) ? list : []; },
    setOwnTier: function (t) { S.ownTier = String(t || ''); },
    reset: function () { S.faction = ''; S.place = ''; S.expanded = {}; S.profile = null; savePref(); },
    clearCache: function () { try { host.localStorage.removeItem(CACHE); } catch (e) { /* 忽略 */ } },
    debug: function () {
      var fs = factions();
      return {
        势力: fs.length,
        邻邦: neighbours().map(function (n) { return n.name + '(' + (n.faction ? n.faction.places.length : 0) + ')'; }),
        选中: S.faction,
        地点: S.place,
        列表: fs.map(function (f) { return f.name + '(' + f.places.length + ')'; }),
      };
    },
  };

  loadPref();
})();
