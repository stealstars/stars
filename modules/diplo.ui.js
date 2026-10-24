/**
 * 外交页 · 逻辑
 *
 * 三块内容：
 *   ① 天下十国 —— 世界书里 [本体][势力] 拆出来的势力，做成大卡
 *   ② 地点列表 —— 选中势力后列出它的城镇/地块
 *   ③ 地点档案 —— 选中地点后，把世界书原文整理成档案
 *
 * 名单一律运行时扫，不硬编码。命定更新后刷新即生效。
 *
 * 产物：window.__fiefDiplo
 */
(function () {
  'use strict';

  var host = (typeof window !== 'undefined' && window.__fiefHost) || (typeof window !== 'undefined' ? window : globalThis);
  var BOOK = function () { return host.__fiefBook || null; };

  /* ------------------------------------------------------------ 状态 */

  var S = {
    faction: '',      // 当前选中的势力
    place: '',        // 当前选中的地点名
    expanded: {},     // 势力 → 是否展开全部地点
  };

  var PREF = 'fief-ledger-diplo-v1';

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

  /* ------------------------------------------------------------ 工具 */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 势力名的首字，做徽记 */
  function crest(name) {
    var s = String(name || '').replace(/^(翼民圣国|奥古斯提姆|萨赫拉|伯伦斯)/, '');
    return s ? s.charAt(0) : '·';
  }

  /** 从势力名里猜一个短标签，卡片上显示用 */
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
    try { return b.scan(false); } catch (e) { return null; }
  }

  function factions() {
    var c = book();
    if (!c) return [];
    var names = Object.keys(c.factions);
    // 有地点的排前面，地点多的排前面；没地点的沉底但仍列出
    names.sort(function (a, b) {
      var da = c.factions[b].places.length - c.factions[a].places.length;
      if (da) return da;
      return String(a).localeCompare(String(b), 'zh');
    });
    return names.map(function (n) {
      return { name: n, kind: factionKind(n), places: c.factions[n].places, overview: c.factions[n].overview };
    });
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
        + (f.places.length
          ? '<div class="fl-dw-cnt">' + f.places.length + ' 处 <i>地点</i></div>'
          : '<div class="fl-dw-cnt"><i>暂无地点条目</i></div>')
        + '</div>';
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
      return '<div class="fl-dp-list"><div class="fl-pf-note">这个势力在世界书里只有总述，没有单列的地点条目。</div></div>';
    }
    var show = S.expanded[f.name] ? f.places.length : Math.min(PAGE, f.places.length);
    var out = '<div class="fl-dp-list">';
    for (var i = 0; i < show; i += 1) {
      var p = f.places[i];
      var on = p.name === S.place ? ' on' : '';
      out += '<div class="fl-dp-row' + on + '" data-dw-place="' + esc(p.name) + '">'
        + '<span class="fl-dp-nm">' + esc(p.name) + '</span>'
        + (p.scale ? '<span class="fl-dp-tag">' + esc(p.scale) + '</span>' : '')
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

  /* ------------------------------------------------------------ 渲染：地点档案 */

  /** 从世界书原文里抽出几组关键行，做成人能读的 kv */
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
      var label = KEYS[i][0];
      var alts = KEYS[i][1];
      for (var j = 0; j < alts.length; j += 1) {
        var re = new RegExp('(?:^|[\\s|｜])' + alts[j] + '\\s*[:：]\\s*([^\\n]{1,120})', 'm');
        var m = raw.match(re);
        if (m && m[1].trim()) { out.push([label, m[1].trim()]); break; }
      }
    }
    return out;
  }

  /** 概览/定位那一段，单独拎出来做引子 */
  function sniffLead(text) {
    var raw = String(text || '');
    var m = raw.match(/(?:概览|定位|简介|概况)\s*[:：]\s*\|?\s*\n?([\s\S]{6,260}?)(?:\n\s{0,4}[^\s].*?:|$)/);
    if (m) return m[1].replace(/\s+/g, ' ').trim();
    // 没有明确字段时，取第一行像描述的话
    var lines = raw.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].length > 14 && !/^[-—=]+$/.test(lines[i]) && lines[i].indexOf(':') < 0) return lines[i];
    }
    return '';
  }

  function renderProfile() {
    var p = currentPlace();
    if (!p) return '';

    var kv = sniffSections(p.content);
    var lead = sniffLead(p.content);
    var f = currentFaction();

    var html = '<div class="fl-pf">';

    // 头：徽记 + 名字 + 标签
    html += '<div class="fl-pf-hd">'
      + '<div class="fl-pf-crest">' + esc(crest(p.name)) + '</div>'
      + '<div class="fl-pf-tt">'
      + '<div class="fl-pf-nm">' + esc(p.name) + '</div>'
      + '<div class="fl-pf-meta">'
      + '<span class="fl-pf-chip"><b>势力</b> ' + esc(f ? f.name : p.faction) + '</span>'
      + (p.scale ? '<span class="fl-pf-chip"><b>规模</b> ' + esc(p.scale) + '</span>' : '')
      + (p.tags && p.tags.length ? '<span class="fl-pf-chip">' + esc(p.tags.join(' · ')) + '</span>' : '')
      + '</div></div></div>';

    // 引子
    if (lead) {
      html += '<div class="fl-pf-raw" style="max-height:none;border-style:solid;border-color:rgba(212,175,90,.14);color:var(--fl-ink);opacity:.9">'
        + esc(lead) + '</div>';
    }

    // 关键字段
    if (kv.length) {
      html += '<div class="fl-pf-sec"><div class="fl-pf-sk">摘 要</div>';
      for (var i = 0; i < kv.length; i += 1) {
        html += '<div class="fl-pf-kv"><span class="k">' + esc(kv[i][0]) + '</span>'
          + '<span class="v">' + esc(kv[i][1]) + '</span></div>';
      }
      html += '</div>';
    }

    // 世界书原文（折叠）
    html += '<div class="fl-pf-sec"><div class="fl-pf-sk">原 文 <span style="opacity:.6;letter-spacing:.04em">世界书 · ' + p.len + ' 字</span></div>'
      + '<div class="fl-pf-raw">' + esc(p.content) + '</div></div>';

    // 动作
    html += '<div class="fl-pf-acts">'
      + '<button class="fl-pf-btn primary" data-dw-act="send">发到聊天框</button>'
      + '<button class="fl-pf-btn" data-dw-act="copy">复制原文</button>'
      + '</div>';

    html += '<div class="fl-pf-note">这一页读的是世界书原文，没有经过改写。'
      + '世界书更新后，刷新即生效。</div>';

    html += '</div>';
    return html;
  }

  /* ------------------------------------------------------------ 总装 */

  function html() {
    var c = book();

    if (!c) {
      return '<div class="fl-dw-load"><b>世 界 书 模 块 未 加 载</b>'
        + '外交页需要 <code>modules/worldbook.js</code>。<br>'
        + '如果是刚更新，刷新一下页面。</div>';
    }

    var out = '';

    out += '<div class="fl-dip-h"><b>天 下 势 力</b><em>Powers</em><s></s></div>';
    out += renderFactions();

    var f = currentFaction();
    if (f) {
      out += '<div class="fl-dip-h" style="margin-top:18px"><b>' + esc(f.name) + ' · 地 点</b>'
        + '<em>' + f.places.length + ' Places</em><s></s></div>';
      out += renderPlaces();

      var pf = renderProfile();
      if (pf) out += pf;
    }

    out += '<div class="fl-sec-note" style="margin-top:16px">'
      + '势力与地点都是从世界书里现扫的，没有写死名单：'
      + '<code>[本体][势力][势力名]…</code> 这类条目会被自动收进来。'
      + '共扫到 ' + c.count + ' 条，' + Object.keys(c.factions).length + ' 个势力。'
      + '<br>要改内容改世界书就行，不用动脚本。</div>';

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
        S.faction = card.getAttribute('data-dw-faction');
        S.place = '';
        savePref();
        rerender(root);
        return;
      }

      var row = t.closest('[data-dw-place]');
      if (row) {
        S.place = row.getAttribute('data-dw-place');
        savePref();
        rerender(root);
        return;
      }

      var more = t.closest('[data-dw-more]');
      if (more) {
        var fn = more.getAttribute('data-dw-more');
        S.expanded[fn] = !S.expanded[fn];
        rerender(root);
        return;
      }

      var act = t.closest('[data-dw-act]');
      if (act) {
        var kind = act.getAttribute('data-dw-act');
        var p = currentPlace();
        if (!p) return;
        if (kind === 'copy') {
          try {
            if (host.navigator && host.navigator.clipboard) host.navigator.clipboard.writeText(p.content);
          } catch (e) { /* 忽略 */ }
          return;
        }
        if (kind === 'send') {
          // 交给主脚本：它知道输入框在哪
          if (typeof host.__fiefSendToInput === 'function') {
            host.__fiefSendToInput('【' + p.faction + ' · ' + p.name + '】\n' + p.content);
          }
          return;
        }
      }
    });
  }

  function rerender(root) {
    var box = root || host.document;
    if (!box) return;
    var host2 = box.querySelector ? (box.querySelector('#fief-ledger-view') || box) : box;
    if (host2 && typeof host.__fiefRenderView === 'function') {
      host.__fiefRenderView();
      return;
    }
    // 没有钩子时，退化：只刷新这一块
    var el = box.querySelector ? box.querySelector('.fl-diplo-root') : null;
    if (el) { el.innerHTML = html(); bind(el); }
  }

  host.__fiefDiplo = {
    html: html,
    bind: bind,
    state: S,
    reset: function () { S.faction = ''; S.place = ''; S.expanded = {}; savePref(); },
    debug: function () {
      var fs = factions();
      return {
        势力: fs.length,
        选中: S.faction,
        地点: S.place,
        列表: fs.map(function (f) { return f.name + '(' + f.places.length + ')'; }),
      };
    },
  };

  loadPref();
})();
