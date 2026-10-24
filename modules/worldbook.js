/**
 * 世界书读取模块
 *
 * 目标：运行时从酒馆里读世界书条目，不硬编码任何名单。
 *
 * 酒馆助手的接口（见 JS-Slash-Runner 文档）：
 *   getWorldbookNames()           → string[]
 *   getWorldbook(name)            → Promise<WorldbookEntry[]>   ← 异步！
 *   getCharWorldbookNames('current') → { primary, additional[] }
 *   getGlobalWorldbookNames()     → string[]
 *
 * 条目的字段是 name / content / strategy.keys，不是 comment / key。
 *
 * 命定更新后重新扫一遍即可，不需要改脚本。
 *
 * 产物：window.__fiefBook
 *   scan()          → Promise<{ entries, factions, names, count, err }>
 *   scanSync()      → 已扫过就直接给缓存，没扫过返回 null
 *   factions[势力]  → { name, places[], overview[] }
 *   places[i]       → { faction, name, scale, where, people, len, content, tags }
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

  /** 把各种形状的条目统一成 [{comment, content, keys, constant}] */
  function normalize(raw) {
    var out = [];
    if (!raw) return out;

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

      // 酒馆助手给 name；卡片导出给 comment；原生给 comment 或 name
      var title = e.comment != null ? e.comment
        : (e.name != null ? e.name : (e.title != null ? e.title : ''));

      // 酒馆助手把关键字放在 strategy.keys
      var keys = [];
      if (Array.isArray(e.keys)) keys = e.keys.slice();
      else if (Array.isArray(e.key)) keys = e.key.slice();
      else if (e.strategy && Array.isArray(e.strategy.keys)) keys = e.strategy.keys.slice();

      var constant = !!e.constant
        || (e.strategy && e.strategy.type === 'constant');

      out.push({
        comment: String(title),
        content: content,
        keys: keys,
        constant: constant,
        order: e.insertion_order != null ? e.insertion_order
          : (e.order != null ? e.order : (e.position && e.position.order != null ? e.position.order : 0)),
        uid: e.uid,
      });
    }
    return out;
  }

  function isPromise(x) {
    return !!x && (typeof x === 'object' || typeof x === 'function') && typeof x.then === 'function';
  }

  /** 列出所有世界书名（同步） */
  function listNames() {
    var th = TH();
    var names = [];
    var push = function (v) {
      if (typeof v === 'string' && v && names.indexOf(v) < 0) names.push(v);
      else if (Array.isArray(v)) {
        for (var i = 0; i < v.length; i += 1) push(v[i]);
      }
    };
    if (th) {
      var fns = ['getWorldbookNames', 'getGlobalWorldbookNames'];
      for (var i = 0; i < fns.length; i += 1) {
        try { if (typeof th[fns[i]] === 'function') push(th[fns[i]]()); } catch (e) { /* 忽略 */ }
      }
      // 角色卡绑定的世界书
      try {
        if (typeof th.getCharWorldbookNames === 'function') {
          var cw = th.getCharWorldbookNames('current');
          if (cw && typeof cw === 'object') { push(cw.primary); push(cw.additional); }
        }
      } catch (e) { /* 忽略 */ }
      // 聊天绑定
      try {
        if (typeof th.getChatWorldbookName === 'function') push(th.getChatWorldbookName('current'));
      } catch (e) { /* 忽略 */ }
    }
    try {
      if (host.world_names && typeof host.world_names === 'object') push(Object.keys(host.world_names));
    } catch (e) { /* 忽略 */ }
    return names;
  }

  /**
   * 读一本书。酒馆助手的 getWorldbook 是异步的，这里统一成 Promise。
   * 也兼容同步返回的旧实现。
   */
  function readOne(name) {
    var th = TH();
    if (!th) return Promise.resolve(null);
    var fns = ['getWorldbook', 'getLorebook', 'getWorldbookEntries'];
    for (var i = 0; i < fns.length; i += 1) {
      var fn = th[fns[i]];
      if (typeof fn !== 'function') continue;
      try {
        var r = fn.call(th, name);
        if (isPromise(r)) {
          return r.then(function (v) {
            var list = normalize(v);
            return list.length ? list : null;
          }).catch(function () { return null; });
        }
        var list = normalize(r);
        if (list.length) return Promise.resolve(list);
      } catch (e) { /* 换下一个函数 */ }
    }
    return Promise.resolve(null);
  }

  /** 原生全局（同步） */
  function readNative() {
    var out = null;
    try {
      if (host.world_info && host.world_info.entries) out = normalize(host.world_info);
    } catch (e) { /* 忽略 */ }
    if (out && out.length) return out;
    try {
      if (host.worldBooks) {
        var n = normalize(host.worldBooks);
        if (n && n.length) return n;
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /**
   * 读全部已挂载世界书的条目（合并去重）。
   * 名字一个也没拿到时，再退回原生全局。
   */
  function readAll() {
    var names = listNames();
    var seen = {};
    var all = [];

    var absorb = function (list) {
      if (!list) return;
      for (var i = 0; i < list.length; i += 1) {
        var e = list[i];
        var key = e.comment + '|' + e.content.length + '|' + e.content.slice(0, 40);
        if (seen[key]) continue;
        seen[key] = 1;
        all.push(e);
      }
    };

    var tasks = names.map(function (n) {
      return readOne(n).then(function (list) {
        if (list) absorb(list);
      });
    });

    return Promise.all(tasks).then(function () {
      if (!all.length) {
        var nat = readNative();
        if (nat) absorb(nat);
      }
      return all;
    });
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
   */
  var SCALE_RE = /(^|[\s|｜,，])(?:规模|地点类别|城市规模|等级规模)\s*[:：]\s*([^\n|｜]{1,24})/m;

  function placeScale(content) {
    var m = String(content || '').match(SCALE_RE);
    return m ? m[2].trim() : '';
  }

  /** 从正文里捞出位置、人口这些现成字段，省得再让 AI 猜 */
  function pickField(content, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var re = new RegExp('(?:^|[\\s|｜])' + keys[i] + '\\s*[:：]\\s*([^\\n]{1,80})', 'm');
      var m = String(content || '').match(re);
      if (m && m[1].trim()) return m[1].trim();
    }
    return '';
  }

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
      var bySelf = sp.name === sp.faction;
      node.isPlace = !byName && !byTag && !bySelf && (!!scale || !!sp.name);

      if (node.isPlace) factions[sp.faction].places.push(node);
      else factions[sp.faction].overview.push(node);
    }
    return factions;
  }

  /* ---------------------------------------------------------- 对外 */

  var cache = null;

  /** 扫一遍（异步）。force=false 且已扫过就直接返回缓存 */
  function scan(force) {
    if (cache && !force) return Promise.resolve(cache);
    return readAll().then(function (entries) {
      cache = {
        entries: entries,
        factions: buildFactionTree(entries),
        names: listNames(),
        count: entries.length,
        err: entries.length ? '' : '世界书里一条条目也没读到',
        at: Date.now(),
      };
      return cache;
    });
  }

  function scanSync() { return cache; }

  host.__fiefBook = {
    scan: scan,
    scanSync: scanSync,
    readAll: readAll,
    readOne: readOne,
    buildFactionTree: buildFactionTree,
    splitFactionTag: splitFactionTag,
    listNames: listNames,
    normalize: normalize,
    placeScale: placeScale,
    pickField: pickField,
    /** 诊断：把能查到的东西全列出来，扫不到时照着这个看断在哪 */
    debug: function () {
      var th = TH();
      var d = {
        TavernHelper: !!th,
        世界书名: listNames(),
        有getWorldbook: !!(th && typeof th.getWorldbook === 'function'),
        缓存条目: cache ? cache.count : null,
      };
      try {
        if (th && typeof th.getCharWorldbookNames === 'function') {
          d.角色卡世界书 = th.getCharWorldbookNames('current');
        }
      } catch (e) { d.角色卡世界书 = 'ERR ' + e.message; }
      return d;
    },
    /** 异步诊断：实际去读一遍，报告每本书读到几条 */
    probe: function () {
      var names = listNames();
      return Promise.all(names.map(function (n) {
        return readOne(n).then(function (l) { return { 书: n, 条目: l ? l.length : 0 }; });
      })).then(function (rows) {
        return { 书数: names.length, 明细: rows };
      });
    },
  };
})();
