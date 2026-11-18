/*
 * i18n.js: languages for Second Look (English, Bahasa Melayu, 中文).
 *
 * Text is written in English in the code and looked up here by its exact
 * English wording, with {name} placeholders for the parts that change:
 *   T('Move {n} of {total}', { n: 2, total: 5 })
 * Translations live in lang.js as rows of [English, Malay, Chinese]; that file
 * is only loaded when Malay or Chinese is chosen. Anything missing falls back
 * to English, so a gap never breaks the page.
 *
 * Static text in index.html is translated once at startup by matching
 * whole text nodes (and aria-label / title / alt / placeholder).
 */
(function (global) {
  'use strict';

  var LANGS = { en: 'English', ms: 'Bahasa Melayu', zh: '中文' };
  var LOCALES = { en: 'en', ms: 'ms-MY', zh: 'zh-CN' };
  var SETTINGS_KEY = 'chessTrainer.settings.v1';

  function pickLang() {
    try {
      var s = JSON.parse(global.localStorage.getItem(SETTINGS_KEY) || '{}');
      if (s && Object.prototype.hasOwnProperty.call(LANGS, s.lang)) return s.lang;
    } catch (e) {
      /* no storage: use the browser language */
    }
    var nav = '';
    try {
      nav = String((global.navigator && ((global.navigator.languages && global.navigator.languages[0]) || global.navigator.language)) || '').toLowerCase();
    } catch (e) {
      nav = '';
    }
    if (nav.indexOf('zh') === 0) return 'zh';
    if (nav.indexOf('ms') === 0) return 'ms';
    return 'en';
  }

  var I18N = {
    langs: LANGS,
    lang: 'en',
    locale: 'en',
    dict: { ms: {}, zh: {} },

    /** Add translations as rows of [English, Malay, Chinese]. */
    addRows: function (rows) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r[1]) this.dict.ms[r[0]] = r[1];
        if (r[2]) this.dict.zh[r[0]] = r[2];
      }
    },

    /** Save a language choice in the site's settings (the page reloads to apply it). */
    choose: function (lang) {
      if (!Object.prototype.hasOwnProperty.call(LANGS, lang)) return;
      try {
        var s = JSON.parse(global.localStorage.getItem(SETTINGS_KEY) || '{}') || {};
        s.lang = lang;
        global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
      } catch (e) {
        /* storage blocked: the choice lasts for this page only */
      }
      this.setLang(lang);
    },

    setLang: function (lang) {
      this.lang = Object.prototype.hasOwnProperty.call(LANGS, lang) ? lang : 'en';
      this.locale = LOCALES[this.lang];
    },

    /** Translate an English template, then fill in {placeholders}. */
    T: function (str, params) {
      var d = I18N.lang !== 'en' ? I18N.dict[I18N.lang] : null;
      var out = (d && Object.prototype.hasOwnProperty.call(d, str) && d[str]) || str;
      if (params) {
        out = out.replace(/\{(\w+)\}/g, function (m, k) {
          return Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m;
        });
      }
      return out;
    },

    /** Translate the page's own text: whole text nodes and a few attributes. */
    translateDom: function (root) {
      if (I18N.lang === 'en' || !root) return;
      var d = I18N.dict[I18N.lang];
      if (!d) return;
      var doc = root.ownerDocument || root;
      var walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null);
      var node;
      var todo = [];
      while ((node = walker.nextNode())) {
        var parent = node.parentNode;
        if (!parent || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(parent.nodeName)) continue;
        var raw = node.nodeValue;
        var text = raw.replace(/\s+/g, ' ').trim();
        if (text && Object.prototype.hasOwnProperty.call(d, text)) todo.push([node, raw, text]);
      }
      todo.forEach(function (x) {
        var lead = x[1].match(/^\s*/)[0];
        var tail = x[1].match(/\s*$/)[0];
        x[0].nodeValue = lead + d[x[2]] + tail;
      });
      var attrs = ['aria-label', 'title', 'alt', 'placeholder'];
      Array.prototype.forEach.call(root.querySelectorAll('[aria-label], [title], [alt], [placeholder]'), function (el) {
        attrs.forEach(function (a) {
          var v = el.getAttribute(a);
          if (v && Object.prototype.hasOwnProperty.call(d, v)) el.setAttribute(a, d[v]);
        });
      });
    }
  };

  I18N.setLang(pickLang());
  global.I18N = I18N;
  global.T = I18N.T;
  if (global.document && global.document.documentElement) {
    global.document.documentElement.lang = I18N.lang === 'zh' ? 'zh-Hans' : I18N.lang;
  }
})(typeof window !== 'undefined' ? window : globalThis);
