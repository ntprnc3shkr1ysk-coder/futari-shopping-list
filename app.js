'use strict';
const API = 'https://pemchevkjbzrjmwuxgwa.supabase.co/rest/v1';
const API_KEY = 'sb_publishable__anoFV7SrWBuXH0YUUY3JQ_Z8gjNF7R';
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get('list') || '';
let items = [], busy = false, refreshing = false, verified = false, generation = 0, toastTimer, pollTimer;
let draft = null;
const pendingItems = new Set();
function status(message, problem = false) { $('statusText').textContent = message; $('status').classList.toggle('problem', problem); }
function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3000); }
async function request(path, method = 'GET', body, prefer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(API + path, {
      method, headers: { apikey: API_KEY, 'x-shopping-key': token, ...(body ? {'Content-Type': 'application/json'} : {}), ...(prefer ? {Prefer: prefer} : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.status === 204 ? [] : await response.json();
  } finally { clearTimeout(timer); }
}
function render() {
  const todo = items.filter(item => !item.bought), done = items.filter(item => item.bought);
  $('todoCount').textContent = todo.length; $('doneCount').textContent = done.length;
  $('empty').hidden = !!todo.length; $('doneSection').hidden = !done.length;
  for (const [id, rows] of [['todo', todo], ['done', done]]) {
    const fragment = document.createDocumentFragment();
    for (const item of rows) {
      const li = document.createElement('li'), button = document.createElement('button'), check = document.createElement('span'), name = document.createElement('span');
      button.type = 'button'; button.className = 'item'; button.setAttribute('role', 'checkbox');
      button.setAttribute('aria-checked', String(item.bought)); button.setAttribute('aria-label', item.name + (item.bought ? '：購入済み、押すと戻す' : '：買うもの、押すと購入済み'));
      button.disabled = busy || pendingItems.has(item.id); check.className = 'check'; check.setAttribute('aria-hidden', 'true'); check.textContent = item.bought ? '✓' : '';
      name.className = 'item-name'; name.textContent = item.name;
      button.append(check, name); button.addEventListener('click', () => toggle(item)); li.append(button); fragment.append(li);
    }
    $(id).replaceChildren(fragment);
  }
  $('clear').disabled = busy || pendingItems.size > 0;
  $('addButton').disabled = busy || !verified;
  $('share').disabled = !verified;
}
async function refresh(force = false) {
  if ((refreshing && !force) || (busy && !force) || document.hidden || !verified) return;
  refreshing = true; const snapshot = ++generation;
  try {
    const rows = await request('/shopping_items?select=id,name,bought,created_at&order=created_at.asc,id.asc');
    if (snapshot !== generation) return;
    if (!Array.isArray(rows)) throw new Error('Invalid data');
    // Keep keyboard focus on the same item when a background refresh changes the list.
    const activeLabel = document.activeElement?.getAttribute('aria-label');
    if (JSON.stringify(rows) !== JSON.stringify(items)) {
      items = rows; render();
      if (activeLabel) for (const b of document.querySelectorAll('.item')) if (b.getAttribute('aria-label') === activeLabel) { b.focus({preventScroll:true}); break; }
    }
    status('ふたりのリストに保存されています');
  } catch (e) { if (snapshot === generation) status(navigator.onLine ? '同期できません。少し待つと再接続します' : 'オフラインです。ネット接続を確認してください', true); }
  finally { if (snapshot === generation) refreshing = false; }
}
async function toggle(item) {
  if (busy || pendingItems.has(item.id)) return;
  pendingItems.add(item.id); generation++; render(); error(); status('保存しています…');
  try {
    const rows = await request('/shopping_items?id=eq.' + item.id, 'PATCH', {bought: !item.bought}, 'return=representation');
    if (!rows.length) toast('この商品は、もう削除されています');
  } catch { error('変更を確認できませんでした。リストの状態を確認して、もう一度お試しください。'); }
  finally { pendingItems.delete(item.id); refreshing = false; await refresh(true); render(); }
}
$('addForm').addEventListener('submit', async event => {
  event.preventDefault(); const name = $('itemName').value.trim();
  if (!name || busy || !verified) return;
  if (items.some(item => !item.bought && item.name === name)) { toast('「' + name + '」はリストに入っています'); return; }
  if (!draft || draft.name !== name) draft = {id: crypto.randomUUID(), name};
  busy = true; generation++; render(); error(); status('追加しています…');
  try {
    await request('/shopping_items?on_conflict=id', 'POST', draft, 'return=representation,resolution=ignore-duplicates');
    $('itemName').value = ''; draft = null; toast('買うものに追加しました');
  } catch { error('追加を確認できませんでした。リストに反映されていなければ、もう一度「追加」を押してください。'); }
  finally { busy = false; refreshing = false; await refresh(true); render(); $('itemName').focus(); }
});
$('clear').addEventListener('click', () => {
  if (busy) return;
  $('deleteDialog').showModal(); $('cancelDelete').focus();
});
$('cancelDelete').addEventListener('click', () => $('deleteDialog').close());
$('confirmDelete').addEventListener('click', async () => {
  // Freeze the selected IDs: another person's newly checked items must not be removed.
  const ids = items.filter(item => item.bought).map(item => item.id);
  $('deleteDialog').close(); if (!ids.length || busy) return;
  busy = true; generation++; render(); error(); status('削除しています…');
  try {
    await request('/shopping_items?bought=eq.true&id=in.(' + ids.join(',') + ')', 'DELETE', undefined, 'return=representation');
    toast('購入済みを削除しました');
  } catch { error('削除を確認できませんでした。リストの状態を確認して、もう一度お試しください。'); }
  finally { busy = false; refreshing = false; await refresh(true); render(); }
});
$('share').addEventListener('click', async () => {
  const url = location.origin + location.pathname + '#list=' + token;
  try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました。奥さんに送って共有できます'); }
  catch { window.prompt('このリンクをコピーして共有してください', url); }
});
async function init() {
  if (!/^[a-f0-9]{64}$/.test(token)) { $('missing').hidden = false; status('共有リンクが必要です', true); return; }
  try {
    const rooms = await request('/shopping_lists?select=list_hash');
    if (!rooms.length) { $('missing').hidden = false; status('この共有リンクは使えません', true); return; }
    verified = true; $('content').hidden = false; render(); await refresh();
    pollTimer = setInterval(() => refresh(), 4000);
  } catch {
    status('接続できませんでした', true);
    $('missing').textContent = 'ネット接続を確認してください。少し待つと、もう一度接続します。'; $('missing').hidden = false;
    setTimeout(() => { $('missing').hidden = true; init(); }, 6000);
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('online', () => refresh());
window.addEventListener('offline', () => status('オフラインです。ネット接続を確認してください', true));
init();
