/* ============================================================
 *  合成大奶娃 · 成绩榜（本机版）
 *  每打完一局就把这一局的成绩记进 localStorage，数据只留在这台手机上，不联网。
 *  记录格式：{ id, n:昵称, s:分数, t:时间戳 }
 *  榜单 = 本机留存的每一局成绩，按分数从高到低排；同分时先打出来的排前面。
 *  只保留最近 MAX_KEEP 局，避免本地存储无限膨胀。
 *  整个模块不碰游戏内部状态；localStorage 写不进去也只是这一局没记上，不影响玩。
 * ============================================================ */
(function () {
  'use strict';

  const STORE_KEY = 'danaiwa.scores.v1';   // 本机成绩历史
  const NAME_KEY = 'danaiwa.name';         // 昵称（沿用旧键，之前填过的昵称还在）
  const DEFAULT_NAME = '默认用户';          // 没填昵称就用这个
  const MAX_SCORE = 99999999;              // 明显离谱的成绩直接不收
  const MAX_KEEP = 200;                    // 本机最多留最近 N 局

  const $ = (id) => document.getElementById(id);

  /* ---------------------------------------------------------
   *  本机成绩：读 / 写 / 追加
   * ------------------------------------------------------- */

  /* 一条记录只认「分数是 0 ~ MAX_SCORE 的数字」，别的当坏数据丢掉 */
  function fix(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const s = Number(raw.s);
    if (!isFinite(s) || s < 0 || s > MAX_SCORE) return null;
    const t = Number(raw.t);
    return {
      id: String(raw.id || (isFinite(t) && t > 0 ? t : Math.random().toString(36).slice(2))),
      n: String(raw.n || DEFAULT_NAME).slice(0, 12),
      s: s,
      t: isFinite(t) && t > 0 ? t : 0
    };
  }

  function loadAll() {
    let arr;
    try {
      arr = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    } catch (e) {
      return [];            // 存坏了当没有，不打断玩家
    }
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rec = fix(arr[i]);
      if (rec) out.push(rec);
    }
    return out;
  }

  /* 存不进去（无痕模式 / 存满）会抛错，由调用方提示一句 */
  function saveAll(list) {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  }

  function addRecord(name, score) {
    const rec = {
      id: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      n: cleanName(name) || DEFAULT_NAME,
      s: Number(score) || 0,
      t: Date.now()
    };
    const list = loadAll();
    list.push(rec);
    /* 超过上限就从最老的那局开始丢 */
    if (list.length > MAX_KEEP) {
      list.sort((a, b) => a.t - b.t);
      list.splice(0, list.length - MAX_KEEP);
    }
    saveAll(list);
    return rec;
  }

  /* 榜单数据：本机每一局成绩，分数高的在前；同分先打出来的在前 */
  function fetchTop() {
    return loadAll().sort((a, b) => (b.s - a.s) || (a.t - b.t));
  }

  /* ---------------------------------------------------------
   *  昵称
   * ------------------------------------------------------- */

  function cleanName(raw) {
    // 去掉控制字符和首尾空白，限长
    let n = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (n.length > 12) n = n.slice(0, 12);
    return n;
  }

  function loadName() {
    try { return cleanName(localStorage.getItem(NAME_KEY) || ''); } catch (e) { return ''; }
  }

  function saveName(n) {
    try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* 忽略 */ }
  }

  /* 实际记录用的昵称：没填就用「默认用户」 */
  function myName() {
    return loadName() || DEFAULT_NAME;
  }

  /* ---------------------------------------------------------
   *  界面
   * ------------------------------------------------------- */

  const listEl = $('boardList');
  const modal = $('boardModal');
  const msgEl = $('submitMsg');
  const nickInput = $('nickInput');
  const nameLabel = $('myNameLabel');
  const submitBtn = $('submitBtn');
  const submitBox = $('submitBox');
  const noteEl = $('boardNote');

  let pendingScore = 0;   // 本局分数（记录/重试用）
  let lastId = null;      // 刚记上的那一条，用来高亮

  function setMsg(text, kind) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'submit-msg' + (kind ? ' is-' + kind : '');
  }

  function showRetry(show) {
    if (submitBtn) submitBtn.hidden = !show;
  }

  /* 昵称在界面上出现的所有地方一起刷新 */
  function paintName() {
    const n = myName();
    if (nameLabel) nameLabel.textContent = n;
    if (nickInput && document.activeElement !== nickInput) nickInput.value = loadName();
  }

  function boardMessage(text) {
    if (!listEl) return;
    listEl.textContent = '';
    const p = document.createElement('p');
    p.className = 'board-empty';
    p.textContent = text;
    listEl.appendChild(p);
  }

  function rankClass(i) {
    return i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /* 每局的时间：本机榜单靠它区分「哪一局」，比重复出现的昵称有用 */
  function stampText(t) {
    if (!t) return '';
    const d = new Date(t);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
           pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function renderBoard(rows, myId) {
    if (!listEl) return;
    listEl.textContent = '';
    if (noteEl) {
      noteEl.textContent = rows.length
        ? '本机共 ' + rows.length + ' 局成绩，按分数从高到低排'
        : '成绩只存在本机，不会上传';
    }
    if (!rows.length) {
      boardMessage('还没有成绩，先玩一局吧！');
      return;
    }
    rows.forEach((row, i) => {
      const line = document.createElement('div');
      line.className = 'board-row ' + rankClass(i);

      const rank = document.createElement('span');
      rank.className = 'board-rank';
      rank.textContent = i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1);

      const name = document.createElement('span');
      name.className = 'board-name';
      name.textContent = stampText(row.t);

      const score = document.createElement('span');
      score.className = 'board-score';
      score.textContent = row.s;

      line.appendChild(rank);
      line.appendChild(name);
      line.appendChild(score);

      // 高亮刚打完的那一局
      if (myId != null && row.id === myId) line.classList.add('is-mine');

      listEl.appendChild(line);
    });
  }

  function refreshBoard(myId) {
    const rows = fetchTop();
    renderBoard(rows, myId);
    return rows;
  }

  function openBoard() {
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    refreshBoard(lastId);
  }

  function closeBoard() {
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }

  /* ---------------------------------------------------------
   *  结算 / 记录
   * ------------------------------------------------------- */

  /* 真正落到本机 */
  function pushScore(name, score) {
    showRetry(false);
    try {
      const rec = addRecord(name, score);
      lastId = rec.id;
      setMsg('已记录 ✓　本局 ' + score + ' 分', 'good');
      return true;
    } catch (err) {
      setMsg('没能存到本机：' + (err && err.message ? err.message : '存储不可用'), 'bad');
      showRetry(true);
      return false;
    }
  }

  /* 手动重试（只在本地写入失败后出现） */
  function retry() {
    if (!pendingScore) return;
    if (pushScore(myName(), pendingScore)) pendingScore = 0;
  }

  /* 打完一局：把这一局的成绩记进本机 */
  function onGameOver(score) {
    if (!submitBox) return;
    pendingScore = Number(score) || 0;
    paintName();
    showRetry(false);

    if (!(pendingScore > 0)) {
      submitBox.style.display = 'none';
      return;
    }
    submitBox.style.display = '';
    if (pushScore(myName(), pendingScore)) pendingScore = 0;
  }

  /* ---------------------------------------------------------
   *  绑定
   * ------------------------------------------------------- */

  function bind() {
    const boardBtn = $('boardBtn');
    if (boardBtn) boardBtn.addEventListener('click', openBoard);

    const boardBtn2 = $('boardBtn2');
    if (boardBtn2) boardBtn2.addEventListener('click', openBoard);

    const closeBtn = $('boardClose');
    if (closeBtn) closeBtn.addEventListener('click', closeBoard);

    const refreshBtn = $('boardRefresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => { refreshBoard(lastId); });

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeBoard();
      });
    }

    if (submitBtn) submitBtn.addEventListener('click', retry);

    /* 昵称随时能改，改完记本地；空着就用默认用户 */
    if (nickInput) {
      nickInput.value = loadName();
      const commit = () => {
        saveName(cleanName(nickInput.value));
        nickInput.value = loadName();
        paintName();
      };
      nickInput.addEventListener('change', commit);
      nickInput.addEventListener('blur', commit);
      nickInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); nickInput.blur(); }
      });
    }

    const editNameBtn = $('editNameBtn');
    if (editNameBtn) {
      editNameBtn.addEventListener('click', () => {
        openBoard();
        if (nickInput) setTimeout(() => { nickInput.focus(); nickInput.select(); }, 260);
      });
    }

    paintName();

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeBoard();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.DanaiwaBoard = {
    open: openBoard,
    close: closeBoard,
    refresh: refreshBoard,
    onGameOver: onGameOver,
    fetchTop: fetchTop,
    myName: myName,
    setName: function (n) { saveName(cleanName(n)); paintName(); },
    hasName: function () { return !!loadName(); }
  };
})();