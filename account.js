/*
 * account.js: optional "Sign in with Google" that keeps your progress the
 * same on every device where you sign in.
 *
 * - Progress lives in Supabase: table public.progress, one row per player
 *   ({ user_id, data, updated_at }). Row level security lets each player
 *   read and write only their own row.
 * - The publishable key below is meant to be public; it can't get past
 *   row level security.
 * - supabase-js is only downloaded when someone signs in or is already
 *   signed in, so visitors without an account load nothing extra.
 * - Sync merges instead of overwriting: finished lessons, badges, games and
 *   saved blunders from both sides are kept, counts keep the higher number.
 *   Changes from other devices are applied when the site opens (one quick
 *   reload); while you play, this device only sends its changes.
 * - Not synced: settings (sound, board colour, language) and the game in
 *   progress, which belong to the device.
 */
(function (root) {
  'use strict';

  var SUPABASE_URL = 'https://bsisutbujfxsatilofso.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_9Cf-p2SGE3GV6weu43AZiQ_XiLFWjt6';
  var LIB_URLS = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
    'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js'
  ];
  var PREFIX = 'chessTrainer.';
  var SKIP = { 'chessTrainer.settings.v1': true, 'chessTrainer.game.v1': true };
  var BANK = 'chessTrainer.blunderBank.v1';
  var REMOVED = 'chessTrainer.blunderBank.removed.v1';
  var META_KEY = 'chessTrainerSync.meta';
  var RETURN_KEY = 'chessTrainerSync.return';
  var NOTICE_KEY = 'chessTrainerSync.notice';
  var RELOAD_KEY = 'chessTrainerSync.reloadedAt';
  var AUTO_MS = 45000;

  /* ---------------------------------------------------------------------- */
  /* Merging two copies of the progress (pure functions)                    */
  /* ---------------------------------------------------------------------- */

  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return isFinite(n) ? n : 0;
  }

  function isObj(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x);
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (isObj(src)) for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  /** Higher of two values: numbers by size, date strings (YYYY-MM-DD) by order, true beats false. */
  function higher(a, b) {
    if (a === undefined || a === null) return b;
    if (b === undefined || b === null) return a;
    if (typeof a === 'number' || typeof b === 'number') return Math.max(num(a), num(b));
    if (typeof a === 'string' && typeof b === 'string') return a >= b ? a : b;
    if (typeof a === 'boolean' || typeof b === 'boolean') return !!(a || b);
    return a;
  }

  /** Earlier of two timestamps (when a badge was first earned). */
  function earlier(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return Math.min(a, b);
    return a !== undefined && a !== null && a !== false ? a : b;
  }

  function eachKey(a, b, fn) {
    var out = {};
    var seen = {};
    [a, b].forEach(function (o) {
      if (!isObj(o)) return;
      Object.keys(o).forEach(function (k) {
        if (seen[k]) return;
        seen[k] = true;
        out[k] = fn(isObj(a) ? a[k] : undefined, isObj(b) ? b[k] : undefined, k);
      });
    });
    return out;
  }

  function maxFields(a, b) {
    return eachKey(a, b, function (x, y) { return higher(x, y); });
  }

  function mergeProgress(a, b) {
    var out = assign({}, b, a);
    out.xp = Math.max(num(a.xp), num(b.xp));
    var days = eachKey(a.days, b.days, function (x, y) {
      x = isObj(x) ? x : {};
      y = isObj(y) ? y : {};
      return eachKey(x, y, function (p, q) { return higher(p, q); });
    });
    var dayKeys = Object.keys(days).sort();
    while (dayKeys.length > 60) delete days[dayKeys.shift()];
    out.days = days;
    var sa = isObj(a.streak) ? a.streak : {};
    var sb = isObj(b.streak) ? b.streak : {};
    var la = String(sa.last || '');
    var lb = String(sb.last || '');
    var pick = la > lb ? sa : lb > la ? sb : (num(sa.count) >= num(sb.count) ? sa : sb);
    out.streak = {
      count: num(pick.count),
      best: Math.max(num(sa.best), num(sb.best), num(sa.count), num(sb.count)),
      last: String(pick.last || '')
    };
    out.badges = eachKey(a.badges, b.badges, earlier);
    out.daily = eachKey(a.daily, b.daily, higher);
    var ladA = Array.isArray(a.ladder) ? a.ladder : [];
    var ladB = Array.isArray(b.ladder) ? b.ladder : [];
    out.ladder = [];
    for (var i = 0; i < Math.max(ladA.length, ladB.length); i++) out.ladder.push(Math.max(num(ladA[i]), num(ladB[i])));
    return out;
  }

  function mergeLearn(a, b) {
    var out = assign({}, b, a);
    out.done = eachKey(a.done, b.done, higher);
    out.step = eachKey(a.step, b.step, function (x, y) { return Math.max(num(x), num(y)); });
    return out;
  }

  function unionList(a, b, limit) {
    var out = [];
    var seen = {};
    (Array.isArray(b) ? b : []).concat(Array.isArray(a) ? a : []).forEach(function (x) {
      var k = typeof x === 'string' ? x : JSON.stringify(x);
      if (seen[k]) return;
      seen[k] = true;
      out.push(x);
    });
    return limit ? out.slice(-limit) : out;
  }

  function mergePuzzles(a, b) {
    var out = assign({}, b, a);
    // Rating and run streak come from the copy that has played more.
    var main = num(a.played) >= num(b.played) ? a : b;
    out.rating = typeof main.rating === 'number' ? main.rating : (typeof a.rating === 'number' ? a.rating : b.rating);
    out.streak = num(main.streak);
    out.played = Math.max(num(a.played), num(b.played));
    out.solved = Math.max(num(a.solved), num(b.solved));
    out.best = Math.max(num(a.best), num(b.best));
    out.seen = unionList(a.seen, b.seen, 800);
    var da = String(a.day || '');
    var db = String(b.day || '');
    out.day = da >= db ? da : db;
    out.today = da === db ? Math.max(num(a.today), num(b.today)) : num((da >= db ? a : b).today);
    out.theme = a.theme || b.theme;
    out.rushBest = maxFields(isObj(a.rushBest) ? a.rushBest : {}, isObj(b.rushBest) ? b.rushBest : {});
    return out;
  }

  function mergeHistory(a, b) {
    var seen = {};
    return (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : [])
      .filter(function (g) {
        if (!isObj(g)) return false;
        var k = g.at + '|' + g.result;
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      })
      .sort(function (x, y) { return num(y.at) - num(x.at); })
      .slice(0, 50);
  }

  function lastTouched(e) {
    return Math.max(num(e.lastAttemptAt), num(e.lastSeenAt), num(e.createdAt));
  }

  function mergeEntry(x, y) {
    var newer = lastTouched(y) > lastTouched(x) ? y : x;
    var older = newer === x ? y : x;
    var out = assign({}, older, newer);
    // Only touch fields one of the copies has, so merging a copy with itself changes nothing.
    ['attempts', 'timesBlundered'].forEach(function (f) {
      if (x[f] !== undefined || y[f] !== undefined) out[f] = Math.max(num(x[f]), num(y[f]));
    });
    if (x.createdAt !== undefined || y.createdAt !== undefined) {
      out.createdAt = Math.min(x.createdAt === undefined ? Infinity : num(x.createdAt), y.createdAt === undefined ? Infinity : num(y.createdAt));
    }
    out.id = num(x.createdAt) < num(y.createdAt) || (num(x.createdAt) === num(y.createdAt) && x.id <= y.id) ? x.id : y.id;
    return out;
  }

  /** Saved blunders from both copies, minus the ones solved (removed) on either device. */
  function mergeBank(a, b, removed) {
    var gone = {};
    (removed || []).forEach(function (id) { gone[id] = true; });
    var byId = {};
    (Array.isArray(b) ? b : []).concat(Array.isArray(a) ? a : []).forEach(function (e) {
      if (!isObj(e) || typeof e.id !== 'string' || gone[e.id]) return;
      byId[e.id] = byId[e.id] ? mergeEntry(byId[e.id], e) : e;
    });
    // The same mistake saved on two devices gets two ids: keep one.
    var byKey = {};
    var out = [];
    Object.keys(byId).sort().forEach(function (id) {
      var e = byId[id];
      var k = e.key || id;
      if (byKey[k] !== undefined) {
        out[byKey[k]] = mergeEntry(out[byKey[k]], e);
      } else {
        byKey[k] = out.length;
        out.push(e);
      }
    });
    out = out.filter(function (e) { return !gone[e.id]; });
    out.sort(function (x, y) { return num(x.createdAt) - num(y.createdAt) || (x.id < y.id ? -1 : 1); });
    return out.slice(-300);
  }

  var MERGERS = {
    'chessTrainer.progress.v1': mergeProgress,
    'chessTrainer.learn.v1': mergeLearn,
    'chessTrainer.puzzles.v1': mergePuzzles,
    'chessTrainer.stats.v1': maxFields,
    'chessTrainer.blunderStats.v1': maxFields,
    'chessTrainer.history.v1': mergeHistory,
    'chessTrainer.blunderBank.removed.v1': function (a, b) { return unionList(a, b, 500); }
  };

  /** Combine this device's progress with the copy saved in the account. */
  function mergeAll(local, cloud) {
    local = isObj(local) ? local : {};
    cloud = isObj(cloud) ? cloud : {};
    var out = eachKey(local, cloud, function (x, y, k) {
      if (x === undefined) return y;
      if (y === undefined) return x;
      if (k === BANK) return x; // done below, once the removed list is merged
      var fn = MERGERS[k];
      if (fn && (isObj(x) || Array.isArray(x)) && (isObj(y) || Array.isArray(y))) return fn(x, y);
      return x; // anything else: this device's copy
    });
    if (local[BANK] !== undefined || cloud[BANK] !== undefined) {
      out[BANK] = mergeBank(local[BANK], cloud[BANK], out[REMOVED]);
    }
    return out;
  }

  /** JSON with sorted keys, so equal data always gives equal text. */
  function stable(x) {
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (isObj(x)) {
      return '{' + Object.keys(x).sort().filter(function (k) { return x[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ':' + stable(x[k]); }).join(',') + '}';
    }
    return JSON.stringify(x === undefined ? null : x);
  }

  /* ---------------------------------------------------------------------- */
  /* Local storage                                                          */
  /* ---------------------------------------------------------------------- */

  function storage() {
    try { return root.localStorage; } catch (e) { return null; }
  }

  /** This device's progress: every chessTrainer.* value except settings and the game in progress. */
  function collect() {
    var ls = storage();
    var out = {};
    if (!ls) return out;
    try {
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (!k || k.indexOf(PREFIX) !== 0 || SKIP[k]) continue;
        try {
          var v = JSON.parse(ls.getItem(k));
          if (v && typeof v === 'object') out[k] = v;
        } catch (e) { /* not JSON: not ours to sync */ }
      }
    } catch (e) { /* storage blocked */ }
    return out;
  }

  function writeLocal(data) {
    var ls = storage();
    if (!ls) return false;
    try {
      Object.keys(data).forEach(function (k) {
        if (k.indexOf(PREFIX) === 0 && !SKIP[k]) ls.setItem(k, JSON.stringify(data[k]));
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function session(k, v) {
    try {
      if (v === undefined) return root.sessionStorage.getItem(k);
      if (v === null) root.sessionStorage.removeItem(k);
      else root.sessionStorage.setItem(k, v);
    } catch (e) { /* ignore */ }
    return null;
  }

  function hasStoredSession() {
    var ls = storage();
    if (!ls) return false;
    try {
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (k && k.indexOf('sb-') === 0 && /-auth-token$/.test(k)) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function hasAuthParams() {
    return /[?&](code|error|error_description)=/.test(root.location ? root.location.search : '');
  }

  // Back from Google: put back the page the player signed in from (before the app reads the address).
  if (root.location && root.history && hasAuthParams()) {
    var back = session(RETURN_KEY);
    if (back && !root.location.hash) {
      try { root.history.replaceState(null, '', root.location.pathname + root.location.search + back); } catch (e) { /* ignore */ }
    }
  }

  function cleanUrl() {
    if (!hasAuthParams()) return;
    session(RETURN_KEY, null);
    try { root.history.replaceState(null, '', root.location.pathname + root.location.hash); } catch (e) { /* ignore */ }
  }

  function loadScript(urls) {
    return new Promise(function (resolve, reject) {
      var i = 0;
      (function next() {
        if (root.supabase && root.supabase.createClient) { resolve(root.supabase); return; }
        if (i >= urls.length) { reject(new Error('Could not load the sign-in library.')); return; }
        var s = document.createElement('script');
        s.src = urls[i++];
        s.async = true;
        s.onload = function () { if (root.supabase && root.supabase.createClient) resolve(root.supabase); else next(); };
        s.onerror = next;
        document.head.appendChild(s);
      })();
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Account                                                                */
  /* ---------------------------------------------------------------------- */

  var Account = {
    hooks: {},
    client: null,
    user: null,
    available: false,
    status: 'out', // out | starting | syncing | synced | error
    error: '',
    lastSync: 0,
    lastLocal: '',
    busy: null,
    started: null,
    pendingNotice: null,
    timer: null,

    /**
     * hooks: { onState(account), reload(), notice(kind, info) }
     * Called once by the app at start-up.
     */
    init: function (hooks) {
      var self = this;
      this.hooks = hooks || {};
      if (hasAuthParams() || hasStoredSession()) {
        this.status = 'starting';
        this.start();
      }
      this.checkAvailable();
      // A message saved just before a sync reload ("progress synced"), shown once we know who's signed in.
      this.pendingNotice = session(NOTICE_KEY);
      session(NOTICE_KEY, null);
      if (document && document.addEventListener) {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') self.pushIfChanged();
        });
      }
      if (root.addEventListener) root.addEventListener('pagehide', function () { self.pushIfChanged(); });
      this.changed();
    },

    changed: function () {
      if (this.hooks.onState) this.hooks.onState(this);
    },

    notify: function (kind, info) {
      if (this.hooks.notice) this.hooks.notice(kind, info || {});
    },

    /** Is Google sign-in switched on for the project? (A tiny request; the library isn't needed.) */
    checkAvailable: function () {
      var self = this;
      if (typeof fetch !== 'function') return Promise.resolve(false);
      return fetch(SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: SUPABASE_KEY } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (s) {
          self.available = !!(s && s.external && s.external.google);
          self.changed();
          return self.available;
        })
        .catch(function () { return false; });
    },

    /** Load supabase-js and pick up a session (including one coming back from Google). */
    start: function () {
      var self = this;
      if (this.started) return this.started;
      this.started = loadScript(LIB_URLS).then(function (lib) {
        self.client = lib.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        self.client.auth.onAuthStateChange(function (event, sess) {
          // Don't call Supabase from inside this callback; just note the user.
          var was = self.user && self.user.id;
          self.user = sess ? sess.user : null;
          if ((self.user && self.user.id) !== was) setTimeout(function () { self.changed(); }, 0);
        });
        var returning = hasAuthParams();
        var failed = /[?&]error/.test(root.location.search);
        return self.client.auth.getSession().then(function (res) {
          cleanUrl();
          self.user = res && res.data && res.data.session ? res.data.session.user : null;
          if (!self.user) {
            self.status = 'out';
            self.pendingNotice = null;
            if (returning && failed) self.notify('signin-failed');
            self.changed();
            return self.client;
          }
          self.status = 'synced';
          self.changed();
          self.startTimer();
          return self.syncNow({ apply: true, signedIn: returning }).then(function () {
            if (self.pendingNotice) {
              self.notify(self.pendingNotice);
              self.pendingNotice = null;
            }
            return self.client;
          });
        });
      }).catch(function (e) {
        self.started = null;
        self.status = self.user ? 'error' : 'out';
        self.error = e && e.message ? e.message : String(e);
        self.changed();
        throw e;
      });
      return this.started;
    },

    startTimer: function () {
      var self = this;
      clearInterval(this.timer);
      this.timer = setInterval(function () { self.pushIfChanged(); }, AUTO_MS);
    },

    signIn: function () {
      var self = this;
      // Sign-in starts from Settings, which is part of Play.
      session(RETURN_KEY, root.location.hash || '#play');
      this.status = 'starting';
      this.changed();
      return this.start().then(function (client) {
        if (self.user) return null;
        var to = root.location.origin + root.location.pathname;
        return client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: to } }).then(function (res) {
          if (res && res.error) throw res.error;
        });
      }).catch(function (e) {
        self.status = 'out';
        self.changed();
        self.notify('signin-failed', { error: e });
      });
    },

    signOut: function () {
      var self = this;
      if (!this.client) return Promise.resolve();
      return this.pushIfChanged().catch(function () {}).then(function () {
        return self.client.auth.signOut();
      }).catch(function () {}).then(function () {
        clearInterval(self.timer);
        self.user = null;
        self.status = 'out';
        self.lastSync = 0;
        self.changed();
        self.notify('signed-out');
      });
    },

    /** Delete the account and the progress saved online. This device keeps its own copy. */
    deleteAccount: function () {
      var self = this;
      if (!this.client || !this.user) return Promise.resolve(false);
      return this.client.rpc('delete_my_account').then(function (res) {
        if (res && res.error) throw res.error;
        return self.client.auth.signOut().catch(function () {});
      }).then(function () {
        clearInterval(self.timer);
        self.user = null;
        self.status = 'out';
        self.changed();
        self.notify('deleted');
        return true;
      }).catch(function (e) {
        self.status = 'error';
        self.error = e && e.message ? e.message : String(e);
        self.changed();
        self.notify('delete-failed');
        return false;
      });
    },

    pushIfChanged: function () {
      if (!this.user || !this.client) return Promise.resolve();
      if (stable(collect()) === this.lastLocal) return Promise.resolve();
      return this.syncNow({ apply: false });
    },

    /**
     * Pull the account's copy, merge it with this device's, and save the result online.
     * opts.apply: also bring other devices' progress onto this device (reloads the page once).
     */
    syncNow: function (opts) {
      var self = this;
      opts = opts || {};
      if (!this.user || !this.client) return Promise.resolve();
      if (this.busy) return this.busy;
      var uid = this.user.id;
      var local = collect();
      var localText = stable(local);
      this.status = 'syncing';
      this.changed();
      this.busy = this.client.from('progress').select('data').eq('user_id', uid).maybeSingle()
        .then(function (res) {
          if (res && res.error) throw res.error;
          var cloud = res && res.data && isObj(res.data.data) ? res.data.data : null;
          var merged = cloud ? mergeAll(local, cloud) : local;
          var mergedText = stable(merged);
          var push = !cloud || stable(cloud) !== mergedText;
          return (push ? self.client.from('progress').upsert({ user_id: uid, data: merged }) : Promise.resolve(null))
            .then(function (up) {
              if (up && up.error) throw up.error;
              self.lastLocal = localText;
              self.lastSync = Date.now();
              self.status = 'synced';
              self.error = '';
              try { storage().setItem(META_KEY, JSON.stringify({ user: uid, at: self.lastSync })); } catch (e) { /* ignore */ }
              var bring = opts.apply && mergedText !== localText;
              // Settled: the next change from another device may reload again.
              if (opts.apply && !bring) session(RELOAD_KEY, null);
              if (bring) {
                // Guard against a reload loop if something keeps changing.
                var last = num(session(RELOAD_KEY));
                if (Date.now() - last > 20000 && writeLocal(merged)) {
                  session(RELOAD_KEY, String(Date.now()));
                  session(NOTICE_KEY, opts.signedIn ? 'signed-in-merged' : 'pulled');
                  self.changed();
                  if (self.hooks.reload) self.hooks.reload();
                  return;
                }
              }
              self.changed();
              if (opts.signedIn) self.notify('signed-in');
            });
        })
        .catch(function (e) {
          self.status = 'error';
          self.error = e && e.message ? e.message : String(e);
          self.changed();
        })
        .then(function () { self.busy = null; });
      return this.busy;
    },

    displayName: function () {
      var u = this.user;
      if (!u) return '';
      var m = u.user_metadata || {};
      return m.full_name || m.name || (u.email ? u.email.split('@')[0] : '');
    },

    email: function () {
      return this.user && this.user.email ? this.user.email : '';
    }
  };

  root.Account = Account;
  root.SyncMerge = { mergeAll: mergeAll, stable: stable, mergeBank: mergeBank, mergeProgress: mergeProgress, mergePuzzles: mergePuzzles, mergeLearn: mergeLearn, mergeHistory: mergeHistory };
})(typeof window !== 'undefined' ? window : globalThis);
