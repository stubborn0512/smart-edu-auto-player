// ==UserScript==
// @name         智慧教育平台自动连播-关闭弹窗定位下一待学视频
// @namespace    https://service.icourses.cn/
// @version      3.0.0
// @description  视频正常播放结束后，关闭播放窗口，重新定位下一个未完成视频并播放；不跳过、不倍速、不修改进度。
// @match        https://service.icourses.cn/resCourse/web/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CFG = {
    pollMs: 1500,
    nextDelayMs: 2500,
    startMuted: true,
    playRetry: 14
  };

  const STORE_ENABLED = 'smartedu_auto_close_next_enabled_v3';
  const STORE_TITLE = 'smartedu_auto_close_next_title_v3';

  let enabled = localStorage.getItem(STORE_ENABLED) !== '0';
  let currentTitle = sessionStorage.getItem(STORE_TITLE) || '';
  let switching = false;
  let userStarted = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const txt = el => (el?.innerText || el?.textContent || '').trim();

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' &&
      s.visibility !== 'hidden' &&
      s.opacity !== '0' &&
      r.width > 5 &&
      r.height > 5;
  }

  function state(msg) {
    console.log('[智慧教育自动连播]', msg);
    const el = document.querySelector('#smartedu-state-v3');
    if (el) el.textContent = msg;
  }

  function isPanel(el) {
    return !!el?.closest?.('#smartedu-panel-v3');
  }

  function clickReal(el) {
    if (!el || !(el instanceof Element) || isPanel(el)) return false;

    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    } catch (_) {}

    const win = el.ownerDocument.defaultView || window;
    const opt = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: win,
      button: 0
    };

    try {
      ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']
        .forEach(type => {
          let ev;
          try {
            ev = type.startsWith('pointer')
              ? new win.PointerEvent(type, opt)
              : new win.MouseEvent(type, opt);
          } catch (_) {
            ev = new win.MouseEvent(type, opt);
          }
          el.dispatchEvent(ev);
        });
      return true;
    } catch (_) {
      try {
        el.click();
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  function clickCenter(el) {
    if (!el || !(el instanceof Element) || isPanel(el)) return false;

    const doc = el.ownerDocument;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = doc.elementFromPoint(x, y);

    if (top && !isPanel(top)) clickReal(top);
    clickReal(el);
    return true;
  }

  function allDocs() {
    const docs = [document];
    document.querySelectorAll('iframe').forEach(f => {
      try {
        if (f.contentDocument) docs.push(f.contentDocument);
      } catch (_) {}
    });
    return docs;
  }

  function allVideos() {
    const arr = [];
    allDocs().forEach(doc => {
      try {
        arr.push(...doc.querySelectorAll('video'));
      } catch (_) {}
    });
    return arr;
  }

  function mainVideo() {
    const videos = allVideos();
    if (!videos.length) return null;

    videos.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });

    return videos.find(v => visible(v)) || videos[0] || null;
  }

  function playButtons() {
    const selectors = [
      '.vjs-big-play-button',
      '.vjs-play-control',
      '.vjs-poster',
      '.video-js',
      '.video-js .vjs-tech',
      'button[aria-label*="播放"]',
      'button[title*="播放"]',
      '[class*="play"]'
    ];

    const arr = [];

    allDocs().forEach(doc => {
      selectors.forEach(sel => {
        try {
          doc.querySelectorAll(sel).forEach(el => {
            if (visible(el) && !isPanel(el)) arr.push(el);
          });
        } catch (_) {}
      });
    });

    return [...new Set(arr)];
  }

  function videoItems() {
    return [...document.querySelectorAll('.child-item')]
      .filter(item => {
        const t = txt(item);
        return item.querySelector('.tag-video') || t.includes('视频');
      });
  }

  function itemTitle(item) {
    const t = item?.querySelector('.tag-txt');
    return (t?.getAttribute('title') || txt(t) || txt(item)).trim();
  }

  function watched100(item) {
    const p = item?.querySelector('.process');
    const s = txt(p);
    return /100\s*%|已观看\s*100/.test(s);
  }

  function activeSection() {
    return document.querySelector('.left-item.active')?.closest('li.list-item') ||
      document.querySelector('.left-item.active')?.closest('.list-item') ||
      null;
  }

  function currentItem() {
    if (!currentTitle) return null;
    return videoItems().find(item => itemTitle(item) === currentTitle) || null;
  }

  function currentSection() {
    return currentItem()?.closest('li.list-item') ||
      currentItem()?.closest('.list-item') ||
      activeSection();
  }

  async function closeVideoWindow() {
    state('正在关闭当前播放窗口...');

    const v = mainVideo();
    if (v) {
      try { v.pause(); } catch (_) {}
    }

    const closeSelectors = [
      '.ant-modal-close',
      '.detail-modal .close-btn',
      '.content-container .close-btn',
      '.close-btn',
      '[aria-label="Close"]',
      '[aria-label*="关闭"]',
      'button[class*="close"]',
      '[class*="close"]'
    ];

    for (const sel of closeSelectors) {
      const btn = [...document.querySelectorAll(sel)]
        .find(el => visible(el) && !isPanel(el) && el.getBoundingClientRect().width < 100);

      if (btn) {
        clickReal(btn);
        await sleep(900);
        return true;
      }
    }

    const modal = [...document.querySelectorAll('.ant-modal-content, .ant-modal, .detail-modal, .content-container')]
      .find(el => visible(el));

    if (modal) {
      const r = modal.getBoundingClientRect();
      const x = r.right - 28;
      const y = r.top + 24;
      const target = document.elementFromPoint(x, y);

      if (target && !isPanel(target)) {
        clickReal(target);
        await sleep(900);
        return true;
      }
    }

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true
    }));

    await sleep(900);
    return false;
  }

  function hookVideo(video) {
    if (!video || video.__smarteduHookedV3) return;

    video.__smarteduHookedV3 = true;

    video.addEventListener('ended', () => {
      nextByCloseAndLocate();
    });

    video.addEventListener('timeupdate', () => {
      if (!enabled || switching) return;
      if (video.duration && video.duration > 5 && video.currentTime >= video.duration - 0.8) {
        nextByCloseAndLocate();
      }
    });

    video.addEventListener('pause', () => {
      if (!enabled || switching) return;
      if (!video.duration) return;

      if (video.currentTime < video.duration - 3 && userStarted) {
        setTimeout(() => ensurePlay(), 800);
      }
    });
  }

  async function ensurePlay() {
    if (!enabled) return false;

    let v = mainVideo();

    if (v) {
      hookVideo(v);
      v.autoplay = true;
      v.playsInline = true;

      if (CFG.startMuted) {
        v.muted = true;
        v.volume = 0;
      }

      try {
        await v.play();
      } catch (_) {}

      if (!v.paused && v.readyState > 0) {
        state('正在播放：' + (currentTitle || document.title));
        return true;
      }
    }

    for (let i = 0; i < CFG.playRetry; i++) {
      const btns = playButtons();

      for (const b of btns.slice(0, 5)) {
        clickCenter(b);
        await sleep(250);
      }

      v = mainVideo();

      if (v) {
        hookVideo(v);
        v.autoplay = true;
        v.playsInline = true;

        if (CFG.startMuted) {
          v.muted = true;
          v.volume = 0;
        }

        clickCenter(v);

        try {
          await v.play();
        } catch (_) {}

        await sleep(500);

        if (!v.paused && v.readyState > 0) {
          state('正在播放：' + (currentTitle || document.title));
          return true;
        }
      }

      await sleep(600);
    }

    state('视频没有成功播放，可能是该节加载失败。');
    return false;
  }

  async function expandSection(section) {
    if (!section) return;

    const header = section.querySelector('.left-item') || section.querySelector('.title') || section;
    if (header) {
      clickReal(header);
      await sleep(800);
    }
  }

  async function findNextUnfinishedItem() {
    await sleep(1200);

    let cur = currentItem();
    let all = videoItems();

    if (cur) {
      const idx = all.indexOf(cur);

      for (let i = idx + 1; i < all.length; i++) {
        if (!watched100(all[i])) return all[i];
      }
    }

    const sections = [...document.querySelectorAll('li.list-item, .list-item')];
    const curSection = currentSection();
    let startIndex = sections.indexOf(curSection);
    if (startIndex < 0) startIndex = 0;

    for (let i = startIndex; i < sections.length; i++) {
      await expandSection(sections[i]);

      const children = [...sections[i].querySelectorAll('.child-item')]
        .filter(item => item.querySelector('.tag-video') || txt(item).includes('视频'));

      let startChildIndex = 0;

      if (cur && sections[i] === curSection) {
        const cidx = children.indexOf(cur);
        startChildIndex = cidx >= 0 ? cidx + 1 : 0;
      }

      for (let j = startChildIndex; j < children.length; j++) {
        if (!watched100(children[j])) return children[j];
      }
    }

    return videoItems().find(item => !watched100(item)) || null;
  }

  async function openItem(item) {
    if (!item) return false;

    currentTitle = itemTitle(item);
    sessionStorage.setItem(STORE_TITLE, currentTitle);

    state('重新打开下一个待学习视频：' + currentTitle);

    const target = item.querySelector('.tag-txt') ||
      item.querySelector('.tag-name') ||
      item;

    clickReal(target);

    await sleep(1800);

    return ensurePlay();
  }

  async function nextByCloseAndLocate() {
    if (!enabled || switching) return;

    switching = true;

    state('本节已播放到结尾，准备关闭窗口并定位下一节...');
    await sleep(CFG.nextDelayMs);

    await closeVideoWindow();
    await sleep(1200);

    const next = await findNextUnfinishedItem();

    if (!next) {
      state('没有找到下一个待学习视频。');
      switching = false;
      return;
    }

    await openItem(next);

    switching = false;
  }

  async function start() {
    enabled = true;
    userStarted = true;
    localStorage.setItem(STORE_ENABLED, '1');
    updateBtn();

    const v = mainVideo();

    if (v || playButtons().length) {
      await ensurePlay();
      return;
    }

    const first = videoItems().find(item => !watched100(item)) || videoItems()[0];

    if (first) {
      await openItem(first);
    } else {
      state('没有找到视频条目。');
    }
  }

  function updateBtn() {
    const btn = document.querySelector('#smartedu-toggle-v3');
    if (btn) btn.textContent = enabled ? '暂停' : '开始连播';
  }

  function createPanel() {
    document.querySelector('#smartedu-panel-v3')?.remove();

    const panel = document.createElement('div');
    panel.id = 'smartedu-panel-v3';
    panel.style.cssText = `
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      width: 310px;
      padding: 12px;
      border-radius: 10px;
      background: rgba(0,0,0,.84);
      color: #fff;
      font-size: 13px;
      line-height: 1.55;
      font-family: Microsoft YaHei, Arial, sans-serif;
      box-shadow: 0 4px 18px rgba(0,0,0,.35);
    `;

    panel.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;">智慧教育正常连播 V3</div>
      <div id="smartedu-state-v3" style="min-height:45px;color:#d7ecff;">等待启动...</div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button id="smartedu-toggle-v3" style="flex:1;border:0;border-radius:6px;padding:7px;cursor:pointer;">${enabled ? '暂停' : '开始连播'}</button>
        <button id="smartedu-next-v3" style="flex:1;border:0;border-radius:6px;padding:7px;cursor:pointer;">测试下一节</button>
      </div>
      <div style="margin-top:6px;color:#ffdca8;font-size:12px;">
        逻辑：播放完 → 关窗口 → 找下一个未100% → 重新点击。
      </div>
    `;

    document.body.appendChild(panel);

    document.querySelector('#smartedu-toggle-v3').onclick = async () => {
      if (enabled) {
        enabled = false;
        localStorage.setItem(STORE_ENABLED, '0');
        updateBtn();

        const v = mainVideo();
        if (v) {
          try { v.pause(); } catch (_) {}
        }

        state('已暂停。');
      } else {
        await start();
      }
    };

    document.querySelector('#smartedu-next-v3').onclick = async () => {
      userStarted = true;
      enabled = true;
      localStorage.setItem(STORE_ENABLED, '1');
      updateBtn();
      await nextByCloseAndLocate();
    };
  }

  createPanel();

  setInterval(() => {
    if (!enabled) return;

    const v = mainVideo();

    if (v) {
      hookVideo(v);

      if (!v.paused) {
        state('正在播放：' + (currentTitle || document.title));
      } else if (userStarted && !switching) {
        ensurePlay();
      }
    }
  }, CFG.pollMs);

})();
