// 職責：學長/班長看板共用的全螢幕 bottom-sheet 彈窗元件（純 UI，不含業務邏輯）
'use strict';

/**
 * 開啟一個由下往上滑出的全螢幕彈窗
 * @param {object}   opts
 * @param {string}   opts.title       標題
 * @param {string}   [opts.subtitle]  副標
 * @param {string}   opts.bodyHtml    面板內容 HTML（呼叫端自行組表單欄位與按鈕）
 * @param {Function} [opts.onMount]   面板插入 DOM 後呼叫，傳入 panelEl，供呼叫端 querySelector 綁事件
 * @param {Function} [opts.onClose]   彈窗關閉時呼叫（遮罩／X／呼叫端 close() 皆會觸發）
 * @returns {{ panelEl: HTMLElement, close: Function }}
 */
function openSheet({ title, subtitle, bodyHtml, onMount, onClose }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(44,44,42,.45);z-index:1000';

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;background:var(--bg);' +
    'border-radius:16px 16px 0 0;padding:16px 18px 20px;' +
    'max-height:85vh;overflow-y:auto;z-index:1001';

  const subtitleHtml = subtitle
    ? `<div style="font-size:15px;color:var(--muted);margin-top:2px">${subtitle}</div>`
    : '';

  panel.innerHTML = `
    <div style="width:40px;height:4px;background:var(--line);border-radius:99px;margin:0 auto 12px"></div>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
      <div>
        <div style="font-size:18px;font-weight:500">${title}</div>
        ${subtitleHtml}
      </div>
      <button type="button" class="sheet-close-btn" aria-label="關閉" style="background:none;border:none;font-size:22px;line-height:1;color:var(--muted);cursor:pointer;padding:4px 6px">✕</button>
    </div>
    <div class="sheet-body"></div>
  `;
  panel.querySelector('.sheet-body').innerHTML = bodyHtml;

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    panel.remove();
    onClose && onClose();
  }

  overlay.addEventListener('click', close);
  panel.querySelector('.sheet-close-btn').addEventListener('click', close);

  document.body.appendChild(overlay);
  document.body.appendChild(panel);

  onMount && onMount(panel);

  return { panelEl: panel, close };
}

if (typeof window !== 'undefined') window.LeaderModal = { openSheet };
if (typeof module !== 'undefined') module.exports = { openSheet };
