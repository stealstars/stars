/**
 * 世界书读取模块
 *
 * 目标：运行时从酒馆里读世界书条目，不硬编码任何名单。
 *
 * 三级回退：
 *   ① TavernHelper.getWorldbook(name)     酒馆助手
 *   ② TavernHelper.getCharWorldbookNames  拿名字再取
 *   ③ world_info / 酒馆原生全局
 *
 * 命定更新后重新扫一遍即可，不需要改脚本。
 *
 * 产物：window.__fiefBook
 *   scan(force)          → { entries, factions, names, count }
 *   factions[势力]       → { name, places[], overview[] }
 *   places[i]            → { faction, name, scale, where, people, len, content, tags }
 */
(function () {
  'use strict';

  var host = (typeof window !== 'undefined' && window.__fiefHost) || (typeof window !== 'undefined' ? window : globalThis);

  function TH() {
    return host.TavernHelper || host.tavernHelper
      || (typeof window !== 'undefined' && (window.TavernHelper || window.tavernHelper))
      || null;
  }

  /* ---------------------------------------------------------- 取条目 */

  /** 把各种形状的世界书数据统一成 [{comment, content, keys, constant, order}] */
  function normalize(raw) {
    var out = [];
    if (!raw) return out;

    // 形状 A：{ entries: { uid: {...} } }
    // 形状 B：{ entries: [ {...} ] }
    // 形状 C：[ {...} ]
    var src = null;
    if (Array.isArray(raw)) src = raw;
    else if (raw.entries && Array.isArray(raw.entries)) src = raw.entries;
    else if (raw.entries && typeof raw.entries === 'object') {
      src = Object.keys(raw.entries).map(function (k) {
        var e = raw.entries[k];
        if (e && typeof e === 'object' && e.uid == null) e = Object.assign({ uid: k }, e);
        return e;
      });
    } else return out;

    for (var i = 0; i < src.length; i += 1) {
      var e = src[i];
      if (!e || typeof e !== 'object') continue;
      var content = String(e.content != null ? e.content : '');
      if (!content.trim()) continue;
      out.push({
        comment: String(e.comment != null ? e.comment : (e.name != null ? e.name : '')),
        content: content,
        keys: (e.keys || e.key || []).slice ? (e.keys || e.key || []).slice() : [],
        constant: !!e.constant,
        order: e.insertion_order != null ? e.insertion_order : (e.order != null ? e.order : 0),
        uid: e.uid,
      });
    }
    return out;
  }

  /** 试一个取书函数，成功就返回条目数组 */
  function tryGet(fn, name) {
    try {
      var r = name == null ? fn() : fn(name);
      if (!r) return null;
      var list = normalize(r);
      return list.length ? list : null;
    } catch (e) {
      return null;
    }
  }

  /** 列出所有世界书名 */
  function listNames() {
    var th = TH();
    var names = [];
    var push = function (v) {
      if (Array.isArray(v)) {
        for (var i = 0; i < v.length; i += 1) if (typeof v[i] === 'string' && names.indexOf(v[i]) < 0) names.push(v[i]);
      }
    };
    if (th) {
      try { if (typeof th.getWorldbookNames === 'function') push(th.getWorldbookNames()); } catch (e) { /* 忽略 */ }
      try { if (typeof th.getCharWorldbookNames === 'function') {
        var r = th.getCharWorldbookNames();
        if (r && typeof r === 'object') {
          push(r.primary); push(r.additional);
          if (Array.isArray(r)) push(r);
        } else push(r);
      } } catch (e) { /* 忽略 */ }
    }
    try {
      if (typeof host.world_names === 'object' && host.world_names) push(Object.keys(host.world_names));
    } catch (e) { /* 忽略 */ }
    return names;
  }

  /**
   * 读全部已挂载世界书的条目（合并去重）。
   * 读不到就返回空数组，调用方自己决定怎么办。
   */
  function readAll() {
    var th = TH();
    var seen = {};
    var all = [];

    var absorb = function (list, from) {
      if (!list) return;
      for (var i = 0; i < list.length; i += 1) {
        var e = list[i];
        // 用「注释 + 内容长度 + 内容前 40 字」做去重键
        var key = e.comment + '|' + e.content.length + '|' + e.content.slice(0, 40);
        if (seen[key]) continue;
        seen[key] = 1;
        e._from = from;
        all.push(e);
      }
    };

    // ① 按名字逐个取
    var names = listNames();
    for (var i = 0; i < names.length; i += 1) {
      if (!th) break;
      var got = null;
      if (typeof th.getWorldbook === 'function') got = tryGet(th.getWorldbook, names[i]);
      if (!got && typeof th.getLorebook === 'function') got = tryGet(th.getLorebook, names[i]);
      if (got) absorb(got, 'th:' + names[i]);
    }

    // ② 不传名字直接取
    if (!all.length && th && typeof th.getWorldbook === 'function') {
      var g = tryGet(th.getWorldbook, null);
      if (g) absorb(g, 'th:all');
    }

    // ③ 酒馆原生全局
    if (!all.length) {
      try {
        if (host.world_info && host.world_info.entries) absorb(normalize(host.world_info), 'world_info');
      } catch (e) { /* 忽略 */ }
      try {
        if (host.worldBooks) absorb(normalize(host.worldBooks), 'worldBooks');
      } catch (e) { /* 忽略 */ }
    }

    return all;
  }

  /* ---------------------------------------------------------- 解析势力树 */

  /**
   * 把 [本体][势力][势力名][子标签…]名字 拆开。
   * 不假设子标签叫什么——命定以后加新标签也能接住。
   */
  function splitFactionTag(comment) {
    var m = String(comment || '').match(/^\[本体\]\[势力\]\[([^\]]+)\]([\s\S]*)$/);
    if (!m) return null;
    var faction = m[1];
    var rest = m[2] || '';
    var tags = [];
    var tm;
    var re = /^\[([^\]]+)\]/;
    while ((tm = rest.match(re)) !== null) {
      tags.push(tm[1]);
      rest = rest.slice(tm[0].length);
    }
    // 剥掉作者签名 "(快乐柠萌茶)" "(△一串)" 之类
    var name = rest.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
    return { faction: faction, tags: tags, name: name, rawName: rest };
  }

  /**
   * 只靠名字就能排除的条目——这些不是地点。
   * 名字里带这些词的，几乎一定不是可查看的领地。
   * 注意要在任意位置命中（「永夜盟约-政治与社会」这种前缀也得拦住）。
   */
  var NOT_PLACE = /(政治与社会|地理与文化|地理与治理|地理概览|地理|文化|贵族|军事|经济|历史|总览|派系|分割线|势力概况|简介|概述|社会结构|制度|宗教|信仰|习俗|节庆|语言|货币|贸易|产业|活动|派阀)/;

  /** 明显不是地点的子标签 */
  var NOT_PLACE_TAG = /^(派系|节庆|分割线|组织|制度|人物|角色|传说)$/;

  /**
   * 认地点的核心判据：条目正文里有「规模:」或「地点类别:」。
   *
   * 命定的地点条目写法不统一，同一件事有三种叫法：
   *   [诺斯加德联盟]  地点类别: 大型城市(庄园)
   *   [奥古斯提姆帝国] 规模: 大型城市
   *   [瓦伦蒂亚]      规模: 超级城市
   * 而势力总述写的是「定位:」「疆域:」，两者都没有。
   *
   * 这一条比标签可靠得多——瓦伦蒂亚、萨赫拉、奥古斯提姆都不打 [城镇] 标签。
   */
  var SCALE_RE = /(^|[\s|｜,，])(?:规模|地点类别|城市规模|等级规模)\s*[:：]\s*([^\n|｜]{1,24})/m;

  function placeScale(content) {
    var m = String(content || '').match(SCALE_RE);
    return m ? m[2].trim() : '';
  }

  /** 从正文里捞出位置、人口这些现成字段，省得再让 AI 猜 */
  function pickField(content, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var re = new RegExp('(?:^|[\\\\s|｜])' + keys[i] + '\\\\s*[:：]\\\\s*([^\\\\n]{1,80})', 'm');
      var m = String(content || '').match(re);
      if (m && m[1].trim()) return m[1].trim();
    }
    return '';
  }

  /**
   * 从全部条目里提出势力树。
   * 每个节点：{ 势力, 标签, 名, 字长, 规模, 位置, 人口, 原文 }
   * isPlace 标记这条能不能当领地看着。
   */
  function buildFactionTree(entries) {
    var factions = {};
    for (var i = 0; i < entries.length; i += 1) {
      var e = entries[i];
      var sp = splitFactionTag(e.comment);
      if (!sp) continue;
      if (!factions[sp.faction]) {
        factions[sp.faction] = { name: sp.faction, places: [], overview: [] };
      }
      var scale = placeScale(e.content);
      var node = {
        faction: sp.faction,
        tags: sp.tags,
        name: sp.name || '(总述)',
        len: e.content.length,
        scale: scale,
        where: pickField(e.content, ['位置', '地点']),
        people: pickField(e.content, ['人口构成', '人口']),
        content: e.content,
        comment: e.comment,
        isPlace: false,
      };

      var byName = NOT_PLACE.test(sp.name);
      var byTag = sp.tags.some(function (t) { return NOT_PLACE_TAG.test(t); });
      // 名字和势力名一样 = 势力总述，不是某个地点
      var bySelf = sp.name === sp.faction;
      // 有「规模:」就当地点；没有的话，只要名字和标签都不像总述，也先收进来
      node.isPlace = !byName && !byTag && !bySelf && (!!scale || !!sp.name);

      if (node.isPlace) factions[sp.faction].places.push(node);
      else factions[sp.faction].overview.push(node);
    }
    return factions;
  }

  /* ---------------------------------------------------------- 对外 */

  var cache = null;

  function scan(force) {
    if (cache && !force) return cache;
    var entries = readAll();
    cache = {
      entries: entries,
      factions: buildFactionTree(entries),
      names: listNames(),
      count: entries.length,
      at: Date.now(),
    };
    return cache;
  }

  host.__fiefBook = {
    scan: scan,
    readAll: readAll,
    buildFactionTree: buildFactionTree,
    splitFactionTag: splitFactionTag,
    listNames: listNames,
    normalize: normalize,
    placeScale: placeScale,
    pickField: pickField,
    debug: function () {
      var c = scan(true);
      return {
        世界书名: c.names,
        条目数: c.count,
        势力数: Object.keys(c.factions).length,
        势力: Object.keys(c.factions).map(function (k) {
          return k + '(地点 ' + c.factions[k].places.length + ' / 总述 ' + c.factions[k].overview.length + ')';
        }),
      };
    },
  };
})();
