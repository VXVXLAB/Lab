'use strict';

const $ = (sel) => document.querySelector(sel);
const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4',
  pen: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  inbox: 'M4 13l2.5-8h11L20 13v6H4v-6zM4 13h5a3 3 0 0 0 6 0h5',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z',
  send: 'M4 12l16-8-6 16-3-7-7-1zM11 13l4-4',
  file: 'M7 3h7l4 4v14H7V3zM14 3v4h4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v5M14 11v5',
  mail: 'M3 6h18v12H3V6zM3 7l9 6 9-6',
  mailopen: 'M3 10l9-6 9 6v10H3V10zM3 10l9 5 9-5',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  refresh: 'M19 12a7 7 0 1 1-2.3-5.2M19 4v4h-4',
  reply: 'M10 7L4 12l6 5v-3.5c5 0 8 1.5 10 5.5 0-7-4-10.500-10-10.500V7z',
  replyall: 'M8 7L2 12l6 5M13 7l-6 5 6 5v-3.5c4 0 6.500 1.500 8 5.500 0-7-3-10.500-8-10.500V7z',
  forward: 'M14 7l6 5-6 5v-3.5c-5 0-8 1.500-10 5.500 0-7 4-10.500 10-10.500V7z',
  restore: 'M4 12a8 8 0 1 0 2.500-5.800M4 4v5h5M12 8v4l3 2',
  close: 'M6 6l12 12M18 6L6 18',
  clip: 'M20 11l-8 8a5 5 0 0 1-7-7l8.500-8.500a3.500 3.500 0 0 1 5 5L10 17a2 2 0 0 1-3-3l7.500-7.500',
  users: 'M9 11a3.500 3.500 0 1 0 0-7a3.500 3.500 0 0 0 0 7zM2.500 20c0-3.500 3-5.500 6.500-5.500s6.500 2 6.500 5.500M16 4.500a3.500 3.500 0 0 1 0 6.500M18 14.800c2 .700 3.500 2.400 3.500 5.200',
  key: 'M14.500 9.500a4 4 0 1 0-4.300 4L4 19.500V21h3v-2h2v-2h2l1.700-1.700a4 4 0 0 0 1.800-5.800zM16 8h.01',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  alert: 'M12 3l9.5 17h-19L12 3zM12 10v4.5M12 17.500v.010',
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM3 12h18M12 3c2.500 2.500 3.800 5.500 3.800 9s-1.300 6.500-3.800 9c-2.500-2.500-3.800-5.500-3.800-9S9.500 5.500 12 3z',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  list: 'M9 6h11M9 12h11M9 18h11M4.500 6h.010M4.500 12h.010M4.500 18h.010',
  listnum: 'M10 6h10M10 12h10M10 18h10M4 5l1.500-1v4M4 16.500c0-1.500 2.500-1.500 2.500 0c0 1-2.500 2-2.500 3.500h2.500',
  quote: 'M5 17c2-1 3-2.500 3-5H5V7h5v5c0 3-1.500 5-4 6zM14 17c2-1 3-2.500 3-5h-3V7h5v5c0 3-1.500 5-4 6z',
  link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
  eraser: 'M8 19h11M5.500 15.500l8-8 4.500 4.500-7 7H8l-2.500-2.500a1 1 0 0 1 0-1z',
  copy: 'M9 9h10v11H9V9zM5 15V4h10',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z',
  image: 'M4 5h16v14H4V5zM4 16l4.500-4.500 4 4 3-3L20 16M9 9.500h.010',
  more: 'M5 12h.010M12 12h.010M19 12h.010',
};
function icon(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICONS[name] + '"/></svg>';
}
function paintIcons(root) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.firstElementChild) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  });
}

/** Tạo phần tử DOM: h('div', {class:'x', onclick: fn}, 'chữ', con…) */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // chỉ dùng cho biểu tượng cố định
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null) el.append(kid);
  return el;
}

const FOLDERS = [
  { id: 'inbox', name: 'Hộp thư đến', icon: 'inbox', empty: 'Hộp thư đến trống. Thư mới sẽ xuất hiện ở đây.' },
  { id: 'starred', name: 'Có gắn sao', icon: 'star', empty: 'Chưa có thư nào được gắn sao.' },
  { id: 'sent', name: 'Thư đã gửi', icon: 'send', empty: 'Bạn chưa gửi thư nào.' },
  { id: 'drafts', name: 'Thư nháp', icon: 'file', empty: 'Không có thư nháp.' },
  { id: 'spam', name: 'Thư rác', icon: 'alert', empty: 'Không có thư rác. Thư ở đây tự xóa sau 30 ngày.' },
  { id: 'trash', name: 'Thùng rác', icon: 'trash', empty: 'Thùng rác trống.' },
];
/** Thông tin thư mục (có sẵn hoặc do người dùng tạo) theo mã. */
function folderInfo(id) {
  const sys = FOLDERS.find((f) => f.id === id);
  if (sys) return sys;
  const c = state.custom.find((f) => f.id === id);
  return { id, name: c ? c.name : 'Thư mục', icon: 'folder', empty: 'Thư mục này chưa có thư. Mở một thư rồi bấm biểu tượng thư mục để chuyển thư vào đây.' };
}
const folderName = (id) => folderInfo(id).name;

const state = {
  me: null, domain: '', setup: false,
  folder: 'inbox', q: '', page: 0, items: [], total: 0, pageSize: 50,
  selected: new Set(), current: null, counts: {}, custom: [], latest: null, timer: null,
};

// ---------- tiện ích ----------

async function api(method, url, body) {
  const opt = { method, headers: { 'X-Requested-With': 'webmail' }, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opt); } catch (e) { throw new Error('Mất kết nối tới máy chủ.'); }
  let data = {};
  try { data = await res.json(); } catch (e) { /* không phải JSON */ }
  if (res.status === 401 && state.me) { state.me = null; showAuth(); }
  if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra (' + res.status + ').');
  return data;
}

let toastTimer;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, bad ? 5000 : 2800);
}
const fail = (e) => toast(e.message, true);

function fmtDate(ts, long) {
  const d = new Date(ts * 1000), now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const hm = p(d.getHours()) + ':' + p(d.getMinutes());
  if (long) return hm + ', ' + d.getDate() + ' tháng ' + (d.getMonth() + 1) + ', ' + d.getFullYear();
  if (d.toDateString() === now.toDateString()) return hm;
  if (d.getFullYear() === now.getFullYear()) return d.getDate() + ' thg ' + (d.getMonth() + 1);
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
const COLORS = ['#3b5bdb', '#0c8599', '#2b8a3e', '#e8590c', '#c2255c', '#7048e8', '#5c7cfa', '#b08900'];
function paintAvatar(el, name, addr) {
  const label = (name || addr || '?').trim();
  let hash = 0;
  for (const ch of (addr || label)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  el.textContent = Array.from(label)[0] || '?';
  el.style.background = COLORS[hash % COLORS.length];
}
/** 'A <a@x>, b@y' -> ['a@x','b@y'] */
function addrList(s) {
  return (s || '').match(/[^\s<>,;"']+@[^\s<>,;"']+/g) || [];
}
/** Tên hiển thị gọn cho danh sách người nhận. */
function shortNames(s) {
  return (s || '').split(',').map((x) => x.replace(/<[^>]*>/, '').replace(/"/g, '').trim() || x.trim())
    .filter(Boolean).join(', ');
}
function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /(https?:\/\/[^\s<>"')\]]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index));
    frag.append(h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer' }, m[1]));
    last = m.index + m[1].length;
  }
  frag.append(text.slice(last));
  return frag;
}

// ---------- đăng nhập ----------

function showAuth() {
  clearInterval(state.timer);
  $('#app').hidden = true; $('#compose').hidden = true; closeModal();
  $('#auth').hidden = false;
  const s = state.setup;
  $('#auth-title').textContent = s ? 'Thiết lập hộp thư' : 'Đăng nhập';
  $('#auth-sub').textContent = s ? 'Tạo tài khoản quản trị đầu tiên để bắt đầu.' : 'Chào mừng bạn quay lại hộp thư.';
  $('#auth-name-row').hidden = !s;
  $('#auth-token-row').hidden = !s;
  $('#auth-submit').textContent = s ? 'Tạo tài khoản' : 'Đăng nhập';
  $('#auth-password').autocomplete = s ? 'new-password' : 'current-password';
  $('#auth-domain').textContent = '@' + state.domain;
  $('#auth-error').hidden = true;
  document.title = 'Hộp thư';
  (s ? $('#auth-token') : $('#auth-email')).focus();
}

$('#auth-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('#auth-submit');
  btn.disabled = true;
  try {
    const body = { email: $('#auth-email').value, password: $('#auth-password').value, name: $('#auth-name').value,
      token: $('#auth-token').value };
    const r = await api('POST', state.setup ? '/api/setup' : '/api/login', body);
    state.me = r.user; state.setup = false;
    $('#auth-password').value = '';
    showApp();
  } catch (e) {
    const el = $('#auth-error');
    el.textContent = e.message; el.hidden = false;
  }
  btn.disabled = false;
});

// ---------- khung ứng dụng ----------

function showApp() {
  $('#auth').hidden = true; $('#app').hidden = false;
  paintAvatar($('#user-btn'), state.me.name, state.me.email);
  $('#menu-name').textContent = state.me.name;
  $('#menu-email').textContent = state.me.email;
  $('#act-users').hidden = !state.me.is_admin;
  $('#act-dns').hidden = !state.me.is_admin;
  state.folder = 'inbox'; state.q = ''; state.page = 0; state.latest = null;
  $('#search-input').value = '';
  closeReader();
  renderFolders();
  loadList();
  refreshCounts();
  clearInterval(state.timer);
  state.timer = setInterval(refreshCounts, 15000);
}

function renderFolders() {
  const ul = $('#folders');
  ul.replaceChildren(...FOLDERS.map((f) => {
    const n = state.counts[f.id] || 0;
    return h('li', null, h('button', {
      class: f.id === state.folder && !state.q ? 'active' : '',
      onclick: () => openFolder(f.id),
    }, h('span', { html: icon(f.icon) }), f.name, n ? h('span', { class: 'count' }, String(n)) : null));
  }));
  $('#custom-folders').replaceChildren(...state.custom.map((f) => h('li', { class: f.id === state.folder && !state.q ? 'active' : '' },
    h('button', { class: 'open', onclick: () => openFolder(f.id) }, h('span', { html: icon('folder') }),
      h('span', { class: 'name' }, f.name), f.unread ? h('span', { class: 'count' }, String(f.unread)) : null),
    h('button', { class: 'icon-btn more', title: 'Đổi tên hoặc xóa thư mục', html: icon('more'), onclick: () => folderModal(f) }))));
}

async function refreshCounts() {
  if (!state.me) return;
  try {
    const r = await api('GET', '/api/folders');
    state.counts = r.counts;
    state.custom = r.custom || [];
    if (/^f\d+$/.test(state.folder) && !state.custom.some((f) => f.id === state.folder)) return openFolder('inbox');
    renderFolders();
    if (!state.q && !state.selected.size) $('#folder-title').textContent = folderName(state.folder);
    document.title = (r.counts.inbox ? '(' + r.counts.inbox + ') ' : '') + 'Hộp thư';
    if (state.latest !== null && r.latest > state.latest) {
      toast('Bạn có thư mới');
      if (state.folder === 'inbox' && state.page === 0 && !state.q) loadList(true);
    }
    state.latest = r.latest;
  } catch (e) { /* thử lại ở lượt sau */ }
}

function openFolder(id) {
  state.folder = id; state.q = ''; state.page = 0;
  $('#search-input').value = '';
  document.body.classList.remove('nav-open');
  closeReader();
  renderFolders();
  loadList();
}

async function loadList(quiet) {
  if (!quiet) state.selected.clear();
  try {
    const r = await api('GET', '/api/messages?folder=' + state.folder + '&page=' + state.page +
      '&q=' + encodeURIComponent(state.q));
    state.items = r.items; state.total = r.total; state.pageSize = r.page_size;
    renderList();
  } catch (e) { fail(e); }
}

function renderList() {
  const { items, total, page, pageSize } = state;
  $('#folder-title').textContent = state.q ? 'Kết quả cho “' + state.q + '”' : folderName(state.folder);
  $('#range').textContent = total ? (page * pageSize + 1) + '–' + (page * pageSize + items.length) + ' / ' + total : '';
  $('#prev').disabled = page === 0;
  $('#next').disabled = (page + 1) * pageSize >= total;
  $('#empty-trash').hidden = !((state.folder === 'trash' || state.folder === 'spam') && total && !state.q);
  $('#empty-trash').textContent = state.folder === 'spam' ? 'Xóa hết thư rác' : 'Dọn thùng rác';
  const list = $('#list');
  if (!items.length) {
    const f = folderInfo(state.folder);
    list.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'empty-art', html: icon(state.q ? 'search' : f.icon) }),
      h('p', null, state.q ? 'Không tìm thấy thư nào phù hợp.' : f.empty)));
  } else {
    list.replaceChildren(...items.map(rowEl));
  }
  updateBulk();
}

function rowEl(m) {
  const outgoing = m.folder === 'sent' || m.folder === 'drafts';
  const who = outgoing ? 'Đến: ' + (shortNames(m.to) || '(chưa có người nhận)') : (m.from_name || m.from_addr || '(không rõ)');
  const cb = h('input', {
    type: 'checkbox', 'aria-label': 'Chọn thư', checked: state.selected.has(m.id),
    onclick: (ev) => ev.stopPropagation(),
    onchange: (ev) => { ev.target.checked ? state.selected.add(m.id) : state.selected.delete(m.id); updateBulk(); },
  });
  const star = h('button', {
    class: 'star-btn' + (m.starred ? ' on' : ''), title: m.starred ? 'Bỏ gắn sao' : 'Gắn sao', html: icon('star'),
    onclick: (ev) => { ev.stopPropagation(); toggleStar(m); },
  });
  return h('div', {
    class: 'row' + (m.is_read ? '' : ' unread') + (state.current && state.current.id === m.id ? ' active' : ''),
    role: 'listitem', tabindex: '0', 'data-id': m.id,
    onclick: () => openMessage(m),
    onkeydown: (ev) => { if (ev.key === 'Enter') openMessage(m); },
  },
  cb, star,
  h('span', { class: 'who' }, who),
  h('span', { class: 'date' }, fmtDate(m.date)),
  h('span', { class: 'line2' },
    state.q || state.folder === 'starred' ? h('span', { class: 'tag' }, folderName(m.folder)) : null,
    h('span', { class: 'subject' }, m.subject || '(không có tiêu đề)'),
    h('span', { class: 'snippet' }, m.snippet ? '– ' + m.snippet : ''),
    m.has_attach ? h('span', { class: 'clip', title: 'Có tệp đính kèm', html: icon('clip') }) : null));
}

function updateBulk() {
  const n = state.selected.size;
  $('#bulk').hidden = n === 0;
  $('#folder-title').hidden = n > 0;
  document.querySelector('[data-bulk=restore]').hidden = state.folder !== 'trash';
  document.querySelector('[data-bulk=notspam]').hidden = state.folder !== 'spam';
  document.querySelector('[data-bulk=move]').hidden = ['drafts', 'trash'].includes(state.folder);
  document.querySelector('[data-bulk=spam]').hidden = ['spam', 'sent', 'drafts', 'trash'].includes(state.folder);
  const all = $('#sel-all');
  all.checked = n > 0 && n === state.items.length;
  all.indeterminate = n > 0 && n < state.items.length;
}

async function act(ids, action, done, folder) {
  try {
    await api('POST', '/api/messages/action', { ids, action, folder });
    if (done) toast(done);
    await loadList();
    refreshCounts();
  } catch (e) { fail(e); }
}

async function toggleStar(m) {
  m.starred = !m.starred;
  if (state.current && state.current.id === m.id) { state.current.starred = m.starred; paintStar(); }
  await act([m.id], m.starred ? 'star' : 'unstar');
}

$('#sel-all').addEventListener('change', (ev) => {
  state.selected = new Set(ev.target.checked ? state.items.map((m) => m.id) : []);
  renderList();
});
$('#bulk').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-bulk]');
  if (!b) return;
  const ids = [...state.selected], a = b.dataset.bulk;
  if (a === 'move') return moveModal(ids);
  if (state.current && ids.includes(state.current.id) && !['read', 'unread'].includes(a)) closeReader();
  const permanent = a === 'delete' && (state.folder === 'trash' || state.folder === 'drafts');
  const go = () => act(ids, a, { delete: permanent ? 'Đã xóa vĩnh viễn' : 'Đã chuyển vào Thùng rác', restore: 'Đã khôi phục',
    spam: 'Đã chuyển vào Thư rác', notspam: 'Đã chuyển về Hộp thư đến' }[a]);
  if (permanent) confirmBox('Xóa vĩnh viễn ' + ids.length + ' thư?', 'Thao tác này không thể hoàn tác.', 'Xóa', go);
  else go();
});
$('#refresh').addEventListener('click', () => { loadList(); refreshCounts(); });
$('#prev').addEventListener('click', () => { state.page--; loadList(); });
$('#next').addEventListener('click', () => { state.page++; loadList(); });
$('#empty-trash').addEventListener('click', () => {
  const spam = state.folder === 'spam';
  confirmBox(spam ? 'Xóa hết thư rác?' : 'Dọn sạch thùng rác?', 'Toàn bộ thư trong thư mục này sẽ bị xóa vĩnh viễn.', 'Xóa hết', async () => {
    try {
      await api('POST', spam ? '/api/spam/empty' : '/api/trash/empty');
      closeReader(); toast('Đã xóa'); loadList(); refreshCounts();
    } catch (e) { fail(e); }
  });
});
$('#search').addEventListener('submit', (ev) => {
  ev.preventDefault();
  state.q = $('#search-input').value.trim(); state.page = 0;
  closeReader(); renderFolders(); loadList();
});
$('#search-input').addEventListener('search', (ev) => {
  if (!ev.target.value && state.q) { state.q = ''; state.page = 0; renderFolders(); loadList(); }
});

// ---------- đọc thư ----------

function closeReader() {
  state.current = null;
  document.body.classList.remove('reading');
  $('#reader-body').hidden = true; $('#reader-empty').hidden = false;
  document.querySelectorAll('.row.active').forEach((r) => r.classList.remove('active'));
}
function paintStar() {
  $('#r-star').classList.toggle('on', !!(state.current && state.current.starred));
}

async function openMessage(m) {
  let d;
  try { d = await api('POST', '/api/messages/' + m.id + '/open'); } catch (e) { return fail(e); }
  if (d.folder === 'drafts') return openCompose({
    id: d.id, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body: d.text, html: d.html, attachments: d.attachments,
  });
  state.current = d;
  if (!m.is_read) { m.is_read = true; refreshCounts(); }
  document.querySelectorAll('.row').forEach((r) => {
    const on = Number(r.dataset.id) === d.id;
    r.classList.toggle('active', on);
    if (on) r.classList.remove('unread');
  });
  document.body.classList.add('reading');
  $('#reader-empty').hidden = true; $('#reader-body').hidden = false;
  $('#r-subject').textContent = d.subject || '(không có tiêu đề)';
  paintAvatar($('#r-avatar'), d.from_name, d.from_addr);
  $('#r-from').textContent = d.from_name || d.from_addr;
  $('#r-addr').textContent = d.from_name ? '<' + d.from_addr + '>' : '';
  $('#r-to').textContent = 'Đến: ' + (shortNames(d.to) || '—') + (d.cc ? ' · Cc: ' + shortNames(d.cc) : '') +
    (d.bcc ? ' · Bcc: ' + shortNames(d.bcc) : '');
  $('#r-date').textContent = fmtDate(d.date, true);
  $('#r-restore').hidden = d.folder !== 'trash';
  $('#r-unread').hidden = d.folder === 'sent';
  $('#r-spam').hidden = d.folder !== 'inbox' && !/^f\d+$/.test(d.folder);
  $('#r-move').hidden = d.folder === 'trash';
  $('#r-notspam').hidden = d.folder !== 'spam';
  paintStar();
  $('#r-images').hidden = true;
  renderBody(d, false);
  $('#r-attachments').replaceChildren(...d.attachments.map((a) => h('a', {
    class: 'chip', href: '/api/messages/' + d.id + '/attachments/' + a.id + '?dl=1', download: a.filename,
    title: 'Tải xuống ' + a.filename,
  }, h('span', { html: icon('download') }), h('span', { class: 'fname' }, a.filename),
  h('span', { class: 'muted' }, fmtSize(a.size)))));
  document.querySelector('.reader-scroll').scrollTop = 0;
}

function renderBody(d, images) {
  const box = $('#r-content');
  if (!d.has_html) {
    box.replaceChildren(h('pre', null, linkify(d.text || '')));
    return;
  }
  const frame = h('iframe', {
    sandbox: 'allow-same-origin allow-popups allow-popups-to-escape-sandbox', title: 'Nội dung thư',
    src: '/api/messages/' + d.id + '/html' + (images ? '?images=1' : ''),
  });
  frame.addEventListener('load', () => {
    const fit = () => {
      try { frame.style.height = frame.contentDocument.documentElement.scrollHeight + 'px'; } catch (e) { frame.style.height = '70vh'; }
    };
    fit();
    setTimeout(fit, 400); setTimeout(fit, 1500);
  });
  box.replaceChildren(frame);
  if (!images) {
    fetch(frame.src, { method: 'HEAD', credentials: 'same-origin' }).then((r) => {
      if (state.current === d) $('#r-images').hidden = r.headers.get('X-Blocked-Images') !== '1';
    }).catch(() => {});
  }
}

$('#r-show-images').addEventListener('click', () => { $('#r-images').hidden = true; renderBody(state.current, true); });
$('#back').addEventListener('click', closeReader);
$('#r-star').addEventListener('click', () => {
  const m = state.items.find((x) => x.id === state.current.id) || state.current;
  toggleStar(m);
  if (m !== state.current) { state.current.starred = m.starred; paintStar(); }
});
$('#r-unread').addEventListener('click', () => { const id = state.current.id; closeReader(); act([id], 'unread', 'Đã đánh dấu chưa đọc'); });
$('#r-restore').addEventListener('click', () => { const id = state.current.id; closeReader(); act([id], 'restore', 'Đã khôi phục'); });
$('#r-move').addEventListener('click', () => moveModal([state.current.id]));
$('#r-spam').addEventListener('click', () => { const id = state.current.id; closeReader(); act([id], 'spam', 'Đã chuyển vào Thư rác. Bộ lọc sẽ ghi nhớ.'); });
$('#r-notspam').addEventListener('click', () => { const id = state.current.id; closeReader(); act([id], 'notspam', 'Đã chuyển về Hộp thư đến'); });
$('#r-delete').addEventListener('click', () => {
  const d = state.current;
  const go = () => { closeReader(); act([d.id], 'delete', d.folder === 'trash' ? 'Đã xóa vĩnh viễn' : 'Đã chuyển vào Thùng rác'); };
  if (d.folder === 'trash') confirmBox('Xóa vĩnh viễn thư này?', 'Thao tác này không thể hoàn tác.', 'Xóa', go);
  else go();
});

/** Các dòng văn bản -> nút DOM (chữ + xuống dòng), an toàn vì không đi qua innerHTML. */
function textNodes(text) {
  const out = [];
  (text || '').replace(/\s+$/, '').split('\n').forEach((line, i) => { if (i) out.push(h('br')); out.push(line); });
  return out;
}
function quote(d) {
  return [h('div', null, h('br')), h('div', null, h('br')),
    h('div', null, 'Vào ' + fmtDate(d.date, true) + ', ' + (d.from_name || d.from_addr) + ' <' + d.from_addr + '> đã viết:'),
    h('blockquote', null, textNodes(d.text))];
}
const withPrefix = (p, s) => (new RegExp('^' + p + ':', 'i').test(s || '') ? s : p + ': ' + (s || ''));

function reply(all) {
  const d = state.current, mine = state.me.email.toLowerCase();
  const sentByMe = d.from_addr.toLowerCase() === mine;
  let to = sentByMe ? d.to : (d.reply_to || d.from_addr), cc = '';
  if (all) {
    const seen = new Set([mine, ...addrList(to).map((a) => a.toLowerCase())]);
    const rest = [];
    for (const a of [...(sentByMe ? [] : addrList(d.to)), ...addrList(d.cc)]) {
      if (!seen.has(a.toLowerCase())) { seen.add(a.toLowerCase()); rest.push(a); }
    }
    cc = rest.join(', ');
  }
  openCompose({ to, cc, subject: withPrefix('Re', d.subject), nodes: quote(d), reply_to_id: d.id, title: 'Trả lời', focusBody: true });
}
$('#r-reply').addEventListener('click', () => reply(false));
$('#r-replyall').addEventListener('click', () => reply(true));
$('#r-forward').addEventListener('click', () => {
  const d = state.current;
  const nodes = [h('div', null, h('br')), h('div', null, h('br')), h('div', null, textNodes(
    '---------- Thư chuyển tiếp ----------\nTừ: ' + (d.from_name ? d.from_name + ' ' : '') + '<' + d.from_addr +
    '>\nNgày: ' + fmtDate(d.date, true) + '\nTiêu đề: ' + d.subject + '\nĐến: ' + d.to)), h('div', null, h('br')),
  h('div', null, textNodes(d.text))];
  openCompose({ subject: withPrefix('Fwd', d.subject), nodes, forward_of: d.attachments.length ? d.id : null, title: 'Chuyển tiếp' });
});

// ---------- soạn thư ----------

const draft = { id: null, reply_to_id: null, forward_of: null, attachments: [], busy: false, saved: '' };
const editor = $('#c-body');
const cFields = () => {
  const text = editor.innerText.replace(/\u00a0/g, ' ');
  return {
    to: $('#c-to').value.trim(), cc: $('#c-cc').value.trim(), bcc: $('#c-bcc').value.trim(),
    subject: $('#c-subject').value, body: text, html: text.trim() || editor.querySelector('img') ? editor.innerHTML : '',
  };
};

async function openCompose(o) {
  o = o || {};
  if (!$('#compose').hidden && !(await closeCompose())) return;
  Object.assign(draft, { id: o.id || null, reply_to_id: o.reply_to_id || null, forward_of: o.forward_of || null,
    attachments: o.attachments || [], busy: false });
  $('#c-title').textContent = o.title || (o.id ? 'Thư nháp' : 'Thư mới');
  $('#c-to').value = o.to || ''; $('#c-cc').value = o.cc || ''; $('#c-bcc').value = o.bcc || '';
  $('#c-subject').value = o.subject || '';
  // o.html là HTML thư nháp đã được máy chủ làm sạch (chỉ còn thẻ định dạng cơ bản).
  if (o.html) editor.innerHTML = o.html;
  else editor.replaceChildren(...(o.nodes || textNodes(o.body)));
  $('#c-cc-row').hidden = !o.cc; $('#c-bcc-row').hidden = !o.bcc;
  $('#c-more').hidden = !!(o.cc && o.bcc);
  $('#c-status').textContent = '';
  draft.saved = o.id ? JSON.stringify(cFields()) : '';
  $('#compose').hidden = false;
  renderChips();
  if (draft.forward_of) { try { await saveDraft(); } catch (e) { fail(e); } }
  if (o.focusBody || o.to) {
    editor.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(editor, 0); range.collapse(true);
    sel.addRange(range);
    editor.scrollTop = 0;
  } else $('#c-to').focus();
}

function renderChips() {
  $('#c-attachments').replaceChildren(...draft.attachments.map((a) => h('span', { class: 'chip' },
    h('span', { html: icon('clip') }), h('span', { class: 'fname' }, a.filename),
    h('span', { class: 'muted' }, fmtSize(a.size)),
    h('button', { type: 'button', title: 'Gỡ tệp', html: icon('close'), onclick: async () => {
      try {
        await api('DELETE', '/api/drafts/' + draft.id + '/attachments/' + a.id);
        draft.attachments = draft.attachments.filter((x) => x !== a);
        renderChips();
      } catch (e) { fail(e); }
    } }))));
}

async function saveDraft() {
  const f = cFields();
  const r = await api('POST', '/api/drafts', { ...f, id: draft.id,
    reply_to_id: draft.id ? null : draft.reply_to_id, forward_of: draft.id ? null : draft.forward_of });
  if (!draft.id && r.attachments) { draft.attachments = r.attachments; renderChips(); }
  draft.id = r.id;
  draft.saved = JSON.stringify(f);
  return r.id;
}

/** Đóng khung soạn: lưu nháp nếu có nội dung. Trả về false nếu lưu lỗi. */
async function closeCompose() {
  const f = cFields();
  const hasContent = f.to || f.cc || f.bcc || f.subject.trim() || f.body.trim() || f.html || draft.attachments.length;
  try {
    if (hasContent && JSON.stringify(f) !== draft.saved) { await saveDraft(); toast('Đã lưu thư nháp'); }
    else if (!hasContent && draft.id) await api('POST', '/api/messages/action', { ids: [draft.id], action: 'delete' });
  } catch (e) { fail(e); return false; }
  $('#compose').hidden = true;
  afterCompose();
  return true;
}
function afterCompose() {
  refreshCounts();
  if (state.folder === 'drafts' || state.folder === 'sent') loadList();
}

$('#compose-btn').addEventListener('click', () => { document.body.classList.remove('nav-open'); openCompose(); });
$('#c-close').addEventListener('click', closeCompose);
$('#c-more').addEventListener('click', () => { $('#c-cc-row').hidden = false; $('#c-bcc-row').hidden = false; $('#c-more').hidden = true; $('#c-cc').focus(); });
$('#c-discard').addEventListener('click', async () => {
  try {
    if (draft.id) await api('POST', '/api/messages/action', { ids: [draft.id], action: 'delete' });
    $('#compose').hidden = true;
    toast('Đã hủy thư');
    afterCompose();
  } catch (e) { fail(e); }
});
$('#c-attach').addEventListener('click', () => $('#c-file').click());
$('#c-file').addEventListener('change', async (ev) => {
  const files = [...ev.target.files];
  ev.target.value = '';
  const status = $('#c-status');
  try {
    if (!draft.id) await saveDraft();
    for (const file of files) {
      status.textContent = 'Đang tải lên ' + file.name + '…';
      const fd = new FormData();
      fd.append('file', file);
      draft.attachments.push(await api('POST', '/api/drafts/' + draft.id + '/attachments', fd));
      renderChips();
    }
  } catch (e) { fail(e); }
  status.textContent = '';
});
$('#compose').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (draft.busy) return;
  const f = cFields();
  if (!f.to && !f.cc && !f.bcc) { toast('Hãy nhập địa chỉ người nhận.', true); $('#c-to').focus(); return; }
  const go = async () => {
    draft.busy = true; $('#c-send').disabled = true; $('#c-status').textContent = 'Đang gửi…';
    try {
      const id = await saveDraft();
      await api('POST', '/api/drafts/' + id + '/send');
      $('#compose').hidden = true;
      toast('Đã gửi thư');
      afterCompose();
      if (state.folder === 'inbox') setTimeout(refreshCounts, 800);
    } catch (e) { fail(e); }
    draft.busy = false; $('#c-send').disabled = false; $('#c-status').textContent = '';
  };
  if (!f.subject.trim()) confirmBox('Gửi thư không có tiêu đề?', 'Người nhận sẽ dễ theo dõi hơn nếu thư có tiêu đề.', 'Vẫn gửi', go);
  else go();
});
// Thanh định dạng: giữ vùng chọn trong khung soạn khi bấm nút.
$('#c-tools').addEventListener('mousedown', (ev) => ev.preventDefault());
$('#c-tools').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-cmd]');
  if (!b) return;
  editor.focus();
  let arg = b.dataset.arg || null;
  if (b.dataset.cmd === 'createLink') {
    arg = (window.prompt('Địa chỉ liên kết (https://…):', 'https://') || '').trim();
    if (!/^(https?:\/\/|mailto:)\S+$/i.test(arg)) { if (arg && arg !== 'https://') toast('Liên kết phải bắt đầu bằng https:// hoặc mailto:', true); return; }
  }
  document.execCommand(b.dataset.cmd, false, arg);
});
/** Tải ảnh lên thư nháp rồi chèn vào vị trí con trỏ; ảnh sẽ nằm ngay trong nội dung thư khi gửi. */
async function insertImages(files) {
  const status = $('#c-status');
  try {
    if (!draft.id) await saveDraft();
    for (const file of files) {
      status.textContent = 'Đang tải ảnh ' + (file.name || '') + '…';
      const fd = new FormData();
      fd.append('file', file, file.name || 'anh.png');
      fd.append('inline', '1');
      const r = await api('POST', '/api/drafts/' + draft.id + '/attachments', fd);
      editor.focus();
      document.execCommand('insertImage', false, r.url);
    }
  } catch (e) { fail(e); }
  status.textContent = '';
}
$('#c-image').addEventListener('click', () => $('#c-image-file').click());
$('#c-image-file').addEventListener('change', (ev) => { const files = [...ev.target.files]; ev.target.value = ''; insertImages(files); });
// Dán: ảnh thì chèn vào thư; còn lại chỉ lấy văn bản thuần để không mang theo định dạng và mã lạ từ trang khác.
editor.addEventListener('paste', (ev) => {
  ev.preventDefault();
  const images = [...((ev.clipboardData || {}).files || [])].filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
  if (images.length) return insertImages(images);
  document.execCommand('insertText', false, (ev.clipboardData || window.clipboardData).getData('text/plain'));
});
editor.addEventListener('drop', (ev) => ev.preventDefault());
$('#compose').addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); $('#compose').requestSubmit(); }
});

// ---------- hộp thoại ----------

function openModal(...kids) {
  const box = document.querySelector('.modal-box');
  box.classList.remove('wide');
  box.style.display = '';
  box.replaceChildren(...kids);
  $('#modal').hidden = false;
  const first = box.querySelector('input, button.primary');
  if (first) first.focus({ preventScroll: true });
  box.scrollTop = 0;
}
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('mousedown', (ev) => { if (ev.target.id === 'modal') closeModal(); });

function confirmBox(title, text, okLabel, onOk) {
  openModal(h('h2', null, title), h('p', { class: 'muted' }, text), h('div', { class: 'modal-actions' },
    h('button', { class: 'btn', onclick: closeModal }, 'Thôi'),
    h('button', { class: 'btn primary', onclick: () => { closeModal(); onOk(); } }, okLabel)));
}

function passwordModal() {
  const oldPw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const newPw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
  const msg = h('p', { class: 'error', hidden: true });
  openModal(h('form', { class: 'modal-form', onsubmit: async (ev) => {
    ev.preventDefault();
    try {
      await api('POST', '/api/password', { old: oldPw.value, new: newPw.value });
      closeModal(); toast('Đã đổi mật khẩu');
    } catch (e) { msg.textContent = e.message; msg.hidden = false; }
  } },
  h('h2', null, 'Đổi mật khẩu'),
  h('label', null, 'Mật khẩu hiện tại', oldPw),
  h('label', null, 'Mật khẩu mới (ít nhất 8 ký tự)', newPw), msg,
  h('div', { class: 'modal-actions' },
    h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Thôi'),
    h('button', { class: 'btn primary' }, 'Lưu'))));
}

async function usersModal() {
  let users;
  try { users = (await api('GET', '/api/admin/users')).users; } catch (e) { return fail(e); }
  const name = h('input', { placeholder: 'Họ và tên' });
  const local = h('input', { placeholder: 'ten', required: true, autocapitalize: 'none', spellcheck: 'false' });
  const pw = h('input', { type: 'password', placeholder: 'Mật khẩu (ít nhất 8 ký tự)', required: true, minlength: '8', autocomplete: 'new-password' });
  const admin = h('input', { type: 'checkbox' });
  const msg = h('p', { class: 'error', hidden: true });
  const item = (u) => {
    const av = h('span', { class: 'avatar' });
    paintAvatar(av, u.name, u.email);
    return h('li', null, av,
      h('span', { class: 'info' }, h('strong', null, u.name + (u.is_admin ? ' · quản trị' : '')), h('span', { class: 'muted' }, u.email)),
      h('button', { class: 'icon-btn', title: 'Đặt lại mật khẩu', html: icon('key'), onclick: () => resetModal(u) }),
      u.id === state.me.id ? null : h('button', { class: 'icon-btn', title: 'Xóa hộp thư', html: icon('trash'), onclick: () =>
        confirmBox('Xóa hộp thư ' + u.email + '?', 'Toàn bộ thư của người dùng này sẽ bị xóa vĩnh viễn.', 'Xóa', async () => {
          try { await api('DELETE', '/api/admin/users/' + u.id); toast('Đã xóa ' + u.email); } catch (e) { fail(e); }
          usersModal();
        }) }));
  };
  openModal(h('form', { class: 'modal-form', onsubmit: async (ev) => {
    ev.preventDefault();
    try {
      const r = await api('POST', '/api/admin/users', { name: name.value, email: local.value, password: pw.value, is_admin: admin.checked });
      toast('Đã tạo hộp thư ' + r.user.email);
      usersModal();
    } catch (e) { msg.textContent = e.message; msg.hidden = false; }
  } },
  h('h2', null, 'Quản lý người dùng'),
  h('ul', { class: 'user-list' }, users.map(item)),
  h('fieldset', null, h('legend', null, 'Thêm hộp thư mới'), name,
    h('span', { class: 'with-suffix' }, local, h('span', { class: 'suffix' }, '@' + state.domain)), pw,
    h('label', { class: 'check' }, admin, 'Cấp quyền quản trị'), msg),
  h('div', { class: 'modal-actions' },
    h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Đóng'),
    h('button', { class: 'btn primary' }, 'Thêm hộp thư'))));
  document.querySelector('.modal-box').style.display = 'block';
  document.querySelector('.modal-form').style.cssText = 'display:grid;gap:14px';
}

function resetModal(u) {
  const pw = h('input', { type: 'password', required: true, minlength: '8', autocomplete: 'new-password' });
  const msg = h('p', { class: 'error', hidden: true });
  openModal(h('form', { class: 'modal-form', onsubmit: async (ev) => {
    ev.preventDefault();
    try {
      await api('POST', '/api/admin/users/' + u.id + '/password', { password: pw.value });
      toast('Đã đặt lại mật khẩu cho ' + u.email);
      usersModal();
    } catch (e) { msg.textContent = e.message; msg.hidden = false; }
  } },
  h('h2', null, 'Đặt lại mật khẩu'), h('p', { class: 'muted' }, u.email),
  h('label', null, 'Mật khẩu mới (ít nhất 8 ký tự)', pw), msg,
  h('div', { class: 'modal-actions' },
    h('button', { type: 'button', class: 'btn', onclick: usersModal }, 'Quay lại'),
    h('button', { class: 'btn primary' }, 'Lưu'))));
}

function nameModal(title, value, okLabel, onOk) {
  const input = h('input', { value: value || '', maxlength: '60', required: true, placeholder: 'Ví dụ: Dự án, Hóa đơn' });
  const msg = h('p', { class: 'error', hidden: true });
  openModal(h('form', { class: 'modal-form', onsubmit: async (ev) => {
    ev.preventDefault();
    try { await onOk(input.value.trim()); } catch (e) { msg.textContent = e.message; msg.hidden = false; }
  } }, h('h2', null, title), h('label', null, 'Tên thư mục', input), msg,
  h('div', { class: 'modal-actions' },
    h('button', { type: 'button', class: 'btn', onclick: closeModal }, 'Thôi'),
    h('button', { class: 'btn primary' }, okLabel))));
  document.querySelector('.modal-form').style.cssText = 'display:grid;gap:14px';
  input.select();
}

function newFolderModal(after) {
  nameModal('Tạo thư mục', '', 'Tạo', async (name) => {
    const r = await api('POST', '/api/folders', { name });
    closeModal();
    await refreshCounts();
    if (after) after(r.id); else toast('Đã tạo thư mục ' + name);
  });
}
$('#add-folder').addEventListener('click', () => newFolderModal());

function folderModal(f) {
  openModal(h('h2', null, f.name), h('div', { class: 'pick-list' },
    h('button', { onclick: () => nameModal('Đổi tên thư mục', f.name, 'Lưu', async (name) => {
      await api('PUT', '/api/folders/' + f.id.slice(1), { name });
      closeModal(); toast('Đã đổi tên thư mục'); refreshCounts();
    }) }, h('span', { html: icon('pen') }), 'Đổi tên'),
    h('button', { onclick: () => confirmBox('Xóa thư mục “' + f.name + '”?', 'Thư bên trong sẽ được chuyển vào Thùng rác.', 'Xóa', async () => {
      try {
        await api('DELETE', '/api/folders/' + f.id.slice(1));
        toast('Đã xóa thư mục');
        if (state.folder === f.id) openFolder('inbox');
        refreshCounts();
      } catch (e) { fail(e); }
    }) }, h('span', { html: icon('trash') }), 'Xóa thư mục')),
  h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: closeModal }, 'Đóng')));
}

/** Chọn thư mục đích cho các thư đã chọn. */
function moveModal(ids) {
  const go = (id) => {
    closeModal();
    if (state.current && ids.includes(state.current.id)) closeReader();
    act(ids, 'move', 'Đã chuyển vào ' + folderName(id), id);
  };
  const targets = [FOLDERS[0], ...state.custom.map((f) => folderInfo(f.id))].filter((f) => f.id !== state.folder || state.q);
  openModal(h('h2', null, 'Chuyển tới thư mục'), h('div', { class: 'pick-list' },
    targets.map((f) => h('button', { onclick: () => go(f.id) }, h('span', { html: icon(f.icon) }), f.name)),
    h('button', { onclick: () => newFolderModal(go) }, h('span', { html: icon('plus') }), 'Tạo thư mục mới…')),
  h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: closeModal }, 'Thôi')));
}

async function clientModal() {
  let c;
  try { c = await api('GET', '/api/client-settings'); } catch (e) { return fail(e); }
  const row = (k, v) => [h('dt', null, k), h('dd', null, v)];
  const box = (title, rows) => h('fieldset', null, h('legend', null, title), h('dl', { class: 'kv' }, rows));
  const parts = [h('h2', null, 'Kết nối ứng dụng thư'),
    h('p', { class: 'muted' }, 'Dùng các thông số sau để thêm hộp thư vào Outlook, Thunderbird hoặc ứng dụng thư trên điện thoại.'),
    box('Tài khoản', [row('Tên đăng nhập', c.email), row('Mật khẩu', 'Mật khẩu hộp thư của bạn')])];
  if (c.imaps || c.imap) parts.push(box('Nhận thư bằng IMAP (khuyên dùng)', [row('Máy chủ', c.host),
    c.imaps ? row('Cổng', c.imaps + ' · SSL/TLS') : null, c.imap ? row(c.imaps ? 'Hoặc cổng' : 'Cổng', c.imap + ' · STARTTLS') : null]));
  if (c.pop3s || c.pop3) parts.push(box('Nhận thư bằng POP3', [row('Máy chủ', c.host),
    c.pop3s ? row('Cổng', c.pop3s + ' · SSL/TLS') : null, c.pop3 ? row(c.pop3s ? 'Hoặc cổng' : 'Cổng', c.pop3 + ' · STARTTLS') : null]));
  if (c.submission) parts.push(box('Gửi thư bằng SMTP', [row('Máy chủ', c.host), row('Cổng', c.submission + ' · STARTTLS'),
    row('Xác thực', 'Cùng tên đăng nhập và mật khẩu')]));
  if (c.self_signed) parts.push(h('p', { class: 'notice' }, 'Máy chủ đang dùng chứng chỉ tự ký nên ứng dụng thư sẽ hỏi bạn có tin cậy chứng chỉ không. Quản trị viên nên cài chứng chỉ thật.'));
  parts.push(h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: closeModal }, 'Đóng')));
  openModal(...parts);
}

async function dnsModal() {
  let recs;
  try { recs = (await api('GET', '/api/admin/dns')).records; } catch (e) { return fail(e); }
  openModal(h('h2', null, 'Bản ghi DNS của tên miền'),
    h('p', { class: 'muted' }, 'Khai báo các bản ghi sau ở nơi quản lý tên miền để nhận được thư và để thư gửi đi không bị coi là thư rác.'),
    h('div', { class: 'rec-list' }, recs.map((r) => h('div', { class: 'rec' },
      h('div', { class: 'rec-head' }, h('span', { class: 'tag' }, r.type), h('strong', null, r.name), h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', title: 'Sao chép giá trị', html: icon('copy'), onclick: async () => {
          try { await navigator.clipboard.writeText(r.value); toast('Đã sao chép'); } catch (e) { toast('Không sao chép được, hãy chọn và chép thủ công.', true); }
        } })),
      h('code', null, r.value), h('span', { class: 'muted' }, r.note)))),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: closeModal }, 'Đóng')));
  document.querySelector('.modal-box').classList.add('wide');
}

// ---------- thanh trên ----------

$('#user-btn').addEventListener('click', (ev) => { ev.stopPropagation(); $('#user-menu').hidden = !$('#user-menu').hidden; });
document.addEventListener('click', (ev) => { if (!ev.target.closest('#user-menu')) $('#user-menu').hidden = true; });
$('#act-password').addEventListener('click', () => { $('#user-menu').hidden = true; passwordModal(); });
$('#act-users').addEventListener('click', () => { $('#user-menu').hidden = true; usersModal(); });
$('#act-dns').addEventListener('click', () => { $('#user-menu').hidden = true; dnsModal(); });
$('#act-client').addEventListener('click', () => { $('#user-menu').hidden = true; clientModal(); });
$('#act-logout').addEventListener('click', async () => {
  $('#user-menu').hidden = true;
  if (!$('#compose').hidden && !(await closeCompose())) return;
  try { await api('POST', '/api/logout'); } catch (e) { /* vẫn thoát */ }
  state.me = null;
  showAuth();
});
$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (!$('#modal').hidden) closeModal();
  else if (!$('#user-menu').hidden) $('#user-menu').hidden = true;
  else if (document.body.classList.contains('nav-open')) document.body.classList.remove('nav-open');
  else if (!$('#compose').hidden) closeCompose();
  else if (state.current) closeReader();
});

// ---------- khởi động ----------

(async function boot() {
  paintIcons(document);
  try {
    const r = await api('GET', '/api/me');
    state.me = r.user; state.setup = r.setup; state.domain = r.domain;
    if (r.user) showApp(); else showAuth();
  } catch (e) { state.domain = ''; showAuth(); fail(e); }
})();
