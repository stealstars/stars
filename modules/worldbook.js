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

      // 酒馆助手的正式字段是 name；卡片导出格式用 comment。
      // 不能写成「comment != null 就用它」——酒馆助手常给出 comment:''，
      // 那样真名字就丢了，条目会变成「(总述)」并被归错类。
      var title = '';
      var cands = [e.name, e.comment, e.title];
      for (var ci = 0; ci < cands.length; ci += 1) {
        var v = cands[ci];
        if (v != null && String(v).trim()) { title = String(v); break; }
      }

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
   * 认地点：正文里的**字段名**才是最有辨识度的证据。
   *
   * 拿真实命定世界书统计过：
   *   地点条目必有 位置(132) / 环境(122) / 地理(39) / 气候(33) / 生态(24) / 地标(27)
   *   势力条目写    首府 / 领土 / 主要城市 / 统治者 / 主要贵族
   *   事件条目写    引子 / 各方态度 / 当前知情范围
   *   概念条目写    来源 / 核心特征 / 分类与特质
   * 所以「有没有地理字段」比「名字像不像地名」准得多。
   */
  var GEO_FIELD = /(?:^|[\n|｜])\s*(位置|环境|地理|气候|生态|地标|地形|水文|植被|人口构成|城区|行政区划|主要地形)\s*[:：]/g;

  /** 势力条目才有的字段——出现这些多半不是地点，但要看数量对比 */
  var FACTION_FIELD = /(?:^|[\n|｜])\s*(首府|领土|核心领土|统治者|主要贵族|主要城市|部落规模|宗旨|行事风格)\s*[:：]/g;

  function countHits(re, s) {
    var m = String(s || '').match(re);
    return m ? m.length : 0;
  }

  /** 兜底：名字像不像地名 */
  var GEO_NAME = /(城|镇|村|堡|要塞|港|湾|岛|群岛|山脉|山|岭|峰|林|谷|平原|荒原|沙漠|沼|湖|河|海|洋|洲|地标|街区|城区|区|街|巷|道|坊|广场|营地|聚落|关隘|塔|院|寺|殿|宫|馆|铺|市|集|桥|门|壁|营|厂|矿|田|园|庄|领|郡|省|州|甸|崖|坡|源|口|渡|驿|栈|屋|厅|堂|台|庭|域|壤|地|脊|礁|屿|港|池|泉|井|坑|穴|洞|林|苑|圃|坛|场|基|址)/;

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

    // 先摸一遍：哪些 tag 其实是「子势力」名。
    // 判据：这个 tag 自己就是一个条目的名字，而且那条目不是地点。
    //   [兽族联盟][鼠族王国]鼠族王国      ← 鼠族王国 是子势力，条目本身是势力总述
    //   [兽族联盟][风信子城]风信子城      ← 风信子城 是地点，条目写「规模:」
    // 不做这一步的话，「鼠族王国」会被当成枢机厅的上级地点。
    var subFactions = {};
    var i0;
    for (i0 = 0; i0 < entries.length; i0 += 1) {
      var s0 = splitFactionTag(entries[i0].comment);
      if (!s0 || !s0.name) continue;
      if (placeScale(entries[i0].content)) continue;          // 有规模 = 地点，不是势力
      var b0 = String(entries[i0].content || '');
      if (countHits(FACTION_FIELD, b0) > 0) subFactions[s0.name] = true;
    }
    var SUB_FACTION = function (t) { return !!subFactions[t]; };

    /**
     * 这些 tag 是**类型标签**，不是上级地点名。
     *   [精灵王庭][地块]中央平原区          ← 「地块」是类型
     *   [诺斯加德联盟][城镇]林歌城          ← 「城镇」是类型
     * 当成父级会造出一堆指向不存在条目的孤儿。
     */
    var TYPE_TAG = /^(地块|城镇|城市|村落|村庄|乡镇|要塞|港口|军港|圣所|大型城市|中型城镇|小型村镇|超级城市|小国|行省|帝国行省|势力|本体|地点|地标|城区|区域|聚落|营地|关隘|遗迹|胜景|建筑|设施|分割线|节庆|事件|人物|角色|组织|制度|传说|派系|经济|军事|文化|地理|历史)$/;

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

      /**
       * 地点要同时满足：
       *   ① 名字和子标签都不像「政治与社会」「人物」这类非地点条目
       *   ② 名字不等于势力名（那条是势力总述）
       *   ③ 正文给了规模，或子标签本身就是地理类（城镇/城区/地标…）
       *
       * 以前写成 (!!scale || !!sp.name)，而 sp.name 几乎永远为真，
       * 等于只看了 ①② —— 任何有名字的条目都会被当成地点。
       */
      var byName = NOT_PLACE.test(sp.name);
      var byTag = sp.tags.some(function (t) { return NOT_PLACE_TAG.test(t); });
      var bySelf = sp.name === sp.faction || !sp.name;
      var body = String(e.content || '');
      var geoN = countHits(GEO_FIELD, body);
      var facN = countHits(FACTION_FIELD, body);
      // 证据从强到弱：
      //   ① 正文写了「规模:」              → 一定是地点
      //   ② 地理字段多于势力字段           → 地点
      //      （「联盟直辖区」同时有 首府/领土 和 位置/环境，按数量判它还是地点）
      //   ③ 名字像地名且没有势力字段       → 兜底
      var geoName = GEO_NAME.test(sp.name);
      var byField = geoN > 0 && geoN >= facN;
      // 名字明确是地理单元（「联盟直辖区」「XX区」「XX公国领地」）——
      // 这类条目常借用势力的字段格式（首府/领土/统治者），但读的人要把它当地点看
      var strongName = /(直辖区|辖区|辖区|区|省|郡|州|领|地块|半岛|群岛|盆地|高原|平原|山脉)$/.test(sp.name);
      node.isPlace = !byName && !byTag && !bySelf
        && (!!scale || byField || strongName || (geoName && facN === 0));
      node.why = scale ? 'scale' : (byField ? 'field' : (strongName ? 'strongname' : (geoName && facN === 0 ? 'name' : '')));

      /**
       * 层级：条目名里的方括号是有顺序的。
       *   [本体][势力][兽族联盟][鼠族王国][风信子城][皇城区]枢机厅
       *                    faction        tags[0]   tags[1]  tags[2]  name
       * 从右往左看 tags，第一个不是子势力的，就是直接上级地点。
       * 「鼠族王国」这类是子势力（下面还会再出现地点），跳过。
       */
      var parent = '';
      for (var ti = sp.tags.length - 1; ti >= 0; ti -= 1) {
        var tk = String(sp.tags[ti] || '');
        if (!tk) continue;
        if (NOT_PLACE_TAG.test(tk)) break;
        // 类型标签不是上级地名：[精灵王庭][城镇]林歌城
        if (TYPE_TAG.test(tk)) continue;
        // 自指：条目名和 tag 一样（[风信子城]风信子城），那是重复标注，跳过
        if (tk === sp.name) continue;
        // 子势力名：本势力下所有条目都带这个 tag，且它本身也是势力条目
        if (SUB_FACTION && SUB_FACTION(tk)) continue;
        parent = tk;
        break;
      }
      node.parent = parent;
      node.depth = parent ? 2 : 1;

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
