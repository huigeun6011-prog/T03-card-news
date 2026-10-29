(function () {
  'use strict';

  // ---------- 상수 ----------
  const DEFAULT_RATIOS = {
    '1:1':  { w: 1080, h: 1080 },
    '4:5':  { w: 1080, h: 1350 },
    '9:16': { w: 1080, h: 1920 },
  };
  const RATIO_VALUES = {
    '1:1':  1 / 1,
    '4:5':  4 / 5,
    '9:16': 9 / 16,
  };
  const RATIO_ORDER = ['1:1', '4:5', '9:16'];

  // ---------- 폰트 ----------
  const FONT_LIST = [
    'Pacifico', 'Varela Round', 'Quicksand', 'Montserrat',
    'Jua', 'Noto Sans KR',
    'Arial', 'Helvetica', 'Verdana',
    'Malgun Gothic', 'Apple SD Gothic Neo',
    'sans-serif', 'serif', 'monospace',
  ];
  const CUSTOM_FONTS = [
    'Pacifico', 'Varela Round', 'Quicksand', 'Montserrat', 'Jua', 'Noto Sans KR',
  ];

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const undoBtn     = $('undoBtn');
  const redoBtn     = $('redoBtn');
  const exportBtn   = $('exportBtn');
  const saveJsonBtn = $('saveJsonBtn');
  const loadJsonBtn = $('loadJsonBtn');
  const layerListEl = $('layerList');
  const layerCount  = $('layerCount');
  const stageWrap   = $('stageWrap');
  const canvasEl    = $('c');
  const emptyHint   = $('emptyHint');
  const zoomRange   = $('zoomRange');
  const zoomLabel   = $('zoomLabel');
  const zoomInBtn   = $('zoomInBtn');
  const zoomOutBtn  = $('zoomOutBtn');
  const fitViewBtn  = $('fitViewBtn');
  const textControls= $('textControls');
  const textEmpty   = $('textEmpty');
  const fontFamilyInput = $('fontFamilyInput');
  const fontSizeInput   = $('fontSizeInput');
  const colorInput      = $('colorInput');
  const deleteBtn       = $('deleteBtn');
  const fileInput   = $('fileInput');
  const jsonFileInput = $('jsonFileInput');
  const toastContainer = $('toastContainer');
  const modalOverlay = $('modalOverlay');
  const modalMessage = $('modalMessage');
  const modalConfirm = $('modalConfirm');
  const modalCancel  = $('modalCancel');
  const bgColorNone     = $('bgColorNone');
  const bgColorInput    = $('bgColorInput');
  const strokeColorInput= $('strokeColorInput');
  const strokeWidthInput= $('strokeWidthInput');
  const minimapImg      = $('minimapImg');
  const minimapViewport = $('minimapViewport');
  const minimapBox      = $('minimapBox');
  const ratioToolLabel  = $('ratioToolLabel');
  const toolButtons = document.querySelectorAll('.tool[data-tool]');

  const minimapScaleCache = { scale: 1, w: 0, h: 0, offsetX: 0, offsetY: 0 };

  // ---------- 폰트 리스트 채우기 ----------
  (function fillFontList() {
    const dl = $('fontList');
    FONT_LIST.forEach(name => {
      const o = document.createElement('option');
      o.value = name;
      dl.appendChild(o);
    });
  })();

  // ---------- 토스트 / 모달 ----------
  function showToast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'success' ? ' success' : '');
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  let modalResolve = null;
  function openModal(msg) {
    modalMessage.textContent = msg;
    modalOverlay.hidden = false;
    return new Promise(r => { modalResolve = r; });
  }
  function closeModal(result) {
    modalOverlay.hidden = true;
    if (modalResolve) { modalResolve(result); modalResolve = null; }
  }
  modalConfirm.addEventListener('click', () => closeModal(true));
  modalCancel.addEventListener('click', () => closeModal(false));
  modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) closeModal(false);
  });

  // ---------- Fabric ----------
  const canvas = new fabric.Canvas('c', {
    backgroundColor: null,
    preserveObjectStacking: true,
  });

  fabric.Object.prototype.set({
    borderColor: '#2dd4bf',
    cornerColor: '#14b8a6',
    cornerStrokeColor: '#e6e8ea',
    cornerStyle: 'circle',
    cornerSize: 12,
    transparentCorners: false,
    padding: 4,
  });
  fabric.Object.prototype.setControlsVisibility({ mtr: false });

  // ---------- 상태 ----------
  let currentRatio = '1:1';
  let bgImage = null;
  let imageNatural = null;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let currentTool = 'select';
  let pendingImageUpload = null;

  let uidSeq = 0;
  const origAdd = canvas.add.bind(canvas);
  canvas.add = function (...objs) {
    objs.forEach(o => { if (!o.__uid) o.__uid = ++uidSeq; });
    return origAdd(...objs);
  };

  // ---------- 도구 전환 ----------
  function setTool(tool) {
    currentTool = tool;
    toolButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    stageWrap.classList.remove('tool-move', 'tool-text');
    if (tool === 'move') stageWrap.classList.add('tool-move');
    if (tool === 'text') stageWrap.classList.add('tool-text');

    canvas.selection = (tool === 'select');
    canvas.forEachObject(obj => {
      if (obj.layerType) {
        obj.selectable = (tool === 'select');
        obj.evented = (tool === 'select');
      }
    });
    canvas.discardActiveObject();
    updateSelectionUI();
    canvas.requestRenderAll();
  }

  function cycleRatio() {
    const idx = RATIO_ORDER.indexOf(currentRatio);
    currentRatio = RATIO_ORDER[(idx + 1) % RATIO_ORDER.length];
    ratioToolLabel.textContent = currentRatio;
    applyCanvasSize();
    pushHistory();
    showToast('비율: ' + currentRatio, 'success');
  }

  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (tool === 'ratio') { cycleRatio(); return; }
      setTool(tool);
    });
  });

  // ---------- 자석 스냅 ----------
  const SNAP_THRESHOLD_RATIO = 0.012;
  const SNAP_THRESHOLD_MIN   = 6;
  let snapGuideV = null, snapGuideH = null;

  function getSnapThreshold() {
    const short = Math.min(canvas.getWidth(), canvas.getHeight());
    return Math.max(SNAP_THRESHOLD_MIN, short * SNAP_THRESHOLD_RATIO);
  }
  function clearSnapGuides() {
    if (snapGuideV) { canvas.remove(snapGuideV); snapGuideV = null; }
    if (snapGuideH) { canvas.remove(snapGuideH); snapGuideH = null; }
  }
  function drawSnapGuideV(x) {
    if (snapGuideV) canvas.remove(snapGuideV);
    snapGuideV = new fabric.Line([x, 0, x, canvas.getHeight()], {
      stroke: '#2dd4bf', strokeWidth: 1,
      selectable: false, evented: false, excludeFromExport: true, opacity: 0.9,
    });
    snapGuideV._isGuide = true;
    canvas.add(snapGuideV);
  }
  function drawSnapGuideH(y) {
    if (snapGuideH) canvas.remove(snapGuideH);
    snapGuideH = new fabric.Line([0, y, canvas.getWidth(), y], {
      stroke: '#2dd4bf', strokeWidth: 1,
      selectable: false, evented: false, excludeFromExport: true, opacity: 0.9,
    });
    snapGuideH._isGuide = true;
    canvas.add(snapGuideH);
  }
  function getBounds(obj) {
    const r = obj.getBoundingRect(true, true);
    return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height,
            cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }
  function applySnap(obj) {
    if (!obj || obj._isGuide) return;
    const thr = getSnapThreshold();
    const cw = canvas.getWidth();
    const ch = canvas.getHeight();
    const b = getBounds(obj);

    const targetXs = [0, cw / 2, cw];
    const targetYs = [0, ch / 2, ch];

    canvas.getObjects().forEach(o => {
      if (o === obj || o._isGuide || o === bgImage) return;
      const ob = getBounds(o);
      targetXs.push(ob.left, ob.cx, ob.right);
      targetYs.push(ob.top, ob.cy, ob.bottom);
    });

    const objXs = [
      { v: b.left, anchor: 'left' },
      { v: b.cx, anchor: 'center' },
      { v: b.right, anchor: 'right' },
    ];
    const objYs = [
      { v: b.top, anchor: 'top' },
      { v: b.cy, anchor: 'center' },
      { v: b.bottom, anchor: 'bottom' },
    ];

    let bestDx = Infinity, bestDxTarget = null, bestDxAnchor = null;
    let bestDy = Infinity, bestDyTarget = null, bestDyAnchor = null;

    objXs.forEach(ox => targetXs.forEach(tx => {
      const d = Math.abs(ox.v - tx);
      if (d < thr && d < bestDx) { bestDx = d; bestDxTarget = tx; bestDxAnchor = ox.anchor; }
    }));
    objYs.forEach(oy => targetYs.forEach(ty => {
      const d = Math.abs(oy.v - ty);
      if (d < thr && d < bestDy) { bestDy = d; bestDyTarget = ty; bestDyAnchor = oy.anchor; }
    }));

    clearSnapGuides();
    if (bestDxTarget !== null) {
      let dx = 0;
      if (bestDxAnchor === 'left')   dx = bestDxTarget - b.left;
      if (bestDxAnchor === 'center') dx = bestDxTarget - b.cx;
      if (bestDxAnchor === 'right')  dx = bestDxTarget - b.right;
      obj.left += dx;
      drawSnapGuideV(bestDxTarget);
    }
    if (bestDyTarget !== null) {
      let dy = 0;
      if (bestDyAnchor === 'top')    dy = bestDyTarget - b.top;
      if (bestDyAnchor === 'center') dy = bestDyTarget - b.cy;
      if (bestDyAnchor === 'bottom') dy = bestDyTarget - b.bottom;
      obj.top += dy;
      drawSnapGuideH(bestDyTarget);
    }
    if (bestDxTarget !== null || bestDyTarget !== null) obj.setCoords();
  }

  canvas.on('object:moving', e => applySnap(e.target));
  canvas.on('object:scaling', e => applySnap(e.target));
  canvas.on('mouse:up', () => clearSnapGuides());
  canvas.on('object:modified', () => clearSnapGuides());

  // ---------- 캔버스 크기 계산 ----------
  function computeCanvasSize(ratioKey, imgW, imgH) {
    if (!imgW || !imgH) return DEFAULT_RATIOS[ratioKey];
    const r = RATIO_VALUES[ratioKey];
    let w, h;
    if (imgW / imgH > r) { h = imgH; w = h * r; }
    else { w = imgW; h = w / r; }
    return { w: Math.round(w), h: Math.round(h) };
  }
  function placeImageCentralCrop(img) {
    const cw = canvas.getWidth();
    const ch = canvas.getHeight();
    img.scaleX = 1;
    img.scaleY = 1;
    img.left = (cw - img.width) / 2;
    img.top  = (ch - img.height) / 2;
  }
  function applyCanvasSize() {
    let w, h;
    if (imageNatural) {
      const s = computeCanvasSize(currentRatio, imageNatural.w, imageNatural.h);
      w = s.w; h = s.h;
    } else {
      const s = DEFAULT_RATIOS[currentRatio];
      w = s.w; h = s.h;
    }
    canvas.setWidth(w);
    canvas.setHeight(h);
    if (bgImage) placeImageCentralCrop(bgImage);
    applyViewToDOM();
    enforceBgCoverage();
    fitView();
  }

  // ---------- 미니맵 ----------
  let minimapTimer = null;
  function scheduleMinimap() {
    if (minimapTimer) return;
    minimapTimer = setTimeout(() => { minimapTimer = null; renderMinimap(); }, 120);
  }
  function getMinimapGeometry() {
    const cw = canvas.getWidth();
    const ch = canvas.getHeight();
    const boxW = minimapBox.clientWidth;
    const boxH = minimapBox.clientHeight;
    if (!cw || !ch || !boxW || !boxH) return null;
    const scale = Math.min(boxW / cw, boxH / ch);
    const renderW = cw * scale;
    const renderH = ch * scale;
    const offsetX = (boxW - renderW) / 2;
    const offsetY = (boxH - renderH) / 2;
    return { cw, ch, boxW, boxH, scale, renderW, renderH, offsetX, offsetY };
  }
  function renderMinimap() {
    const activeObj = canvas.getActiveObject();
    if (activeObj && activeObj.isEditing) return;
    const g = getMinimapGeometry();
    if (!g) return;

    minimapScaleCache.scale = g.scale;
    minimapScaleCache.w = g.renderW;
    minimapScaleCache.h = g.renderH;
    minimapScaleCache.offsetX = g.offsetX;
    minimapScaleCache.offsetY = g.offsetY;

    const prevBgColor = canvasEl.style.backgroundColor;
    const prevBgImage = canvasEl.style.backgroundImage;
    canvasEl.style.backgroundColor = '#ffffff';
    canvasEl.style.backgroundImage = 'none';

    if (activeObj) canvas.discardActiveObject();
    clearSnapGuides();
    canvas.requestRenderAll();

    const dataURL = canvas.toDataURL({ format: 'png', multiplier: g.scale });

    canvasEl.style.backgroundColor = prevBgColor;
    canvasEl.style.backgroundImage = prevBgImage;
    if (activeObj) canvas.setActiveObject(activeObj);
    canvas.requestRenderAll();

    minimapImg.src = dataURL;
    minimapImg.style.width = g.renderW + 'px';
    minimapImg.style.height = g.renderH + 'px';
    minimapImg.style.left = g.offsetX + 'px';
    minimapImg.style.top = g.offsetY + 'px';

    updateMinimapViewport();
  }
  function updateMinimapViewport() {
    const g = getMinimapGeometry();
    if (!g) return;
    minimapScaleCache.scale = g.scale;
    minimapScaleCache.w = g.renderW;
    minimapScaleCache.h = g.renderH;
    minimapScaleCache.offsetX = g.offsetX;
    minimapScaleCache.offsetY = g.offsetY;

    const sw = stageWrap.clientWidth;
    const sh = stageWrap.clientHeight;
    const viewLeftC   = (0  - panX) / zoom;
    const viewTopC    = (0  - panY) / zoom;
    const viewRightC  = (sw - panX) / zoom;
    const viewBottomC = (sh - panY) / zoom;

    const mx = viewLeftC  * g.scale + g.offsetX;
    const my = viewTopC   * g.scale + g.offsetY;
    const mw = (viewRightC  - viewLeftC) * g.scale;
    const mh = (viewBottomC - viewTopC)  * g.scale;

    minimapViewport.style.left   = mx + 'px';
    minimapViewport.style.top    = my + 'px';
    minimapViewport.style.width  = mw + 'px';
    minimapViewport.style.height = mh + 'px';
  }

  // ---------- 뷰(줌/팬) ----------
  function applyViewToDOM() {
    const w = canvas.getWidth();
    const h = canvas.getHeight();
    canvas.setDimensions({ width: w, height: h }, { backstoreOnly: true });
    canvas.setZoom(1);
    canvas.viewportTransform[4] = 0;
    canvas.viewportTransform[5] = 0;

    const container = canvas.wrapperEl;
    if (container) {
      container.style.position = 'absolute';
      container.style.left = '0';
      container.style.top = '0';
      container.style.width  = (w * zoom) + 'px';
      container.style.height = (h * zoom) + 'px';
      container.style.transformOrigin = '0 0';
      container.style.transform = 'translate(' + panX + 'px, ' + panY + 'px)';
      container.style.boxShadow = '0 0 0 2px var(--checker-a)';
    }
    const lowerEl = canvas.lowerCanvasEl;
    const upperEl = canvas.upperCanvasEl;
    if (lowerEl) { lowerEl.style.width = '100%'; lowerEl.style.height = '100%'; }
    if (upperEl) { upperEl.style.width = '100%'; upperEl.style.height = '100%'; }

    canvas.requestRenderAll();
    syncZoomUI();
    updateMinimapViewport();
  }
  function fitView() {
    const pad = 48;
    const availW = stageWrap.clientWidth - pad * 2;
    const availH = stageWrap.clientHeight - pad * 2;
    const w = canvas.getWidth();
    const h = canvas.getHeight();
    zoom = Math.min(availW / w, availH / h);
    panX = (stageWrap.clientWidth - w * zoom) / 2;
    panY = (stageWrap.clientHeight - h * zoom) / 2;
    applyViewToDOM();
  }
  function zoomAtPoint(newZoom, clientX, clientY) {
    newZoom = Math.max(0.02, Math.min(8, newZoom));
    const rect = stageWrap.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const cx = (px - panX) / zoom;
    const cy = (py - panY) / zoom;
    zoom = newZoom;
    panX = px - cx * zoom;
    panY = py - cy * zoom;
    applyViewToDOM();
  }
  function setZoomCenter(newZoom) {
    newZoom = Math.max(0.02, Math.min(8, newZoom));
    const cxS = stageWrap.clientWidth / 2;
    const cyS = stageWrap.clientHeight / 2;
    const cxC = (cxS - panX) / zoom;
    const cyC = (cyS - panY) / zoom;
    zoom = newZoom;
    panX = cxS - cxC * zoom;
    panY = cyS - cyC * zoom;
    applyViewToDOM();
  }
  function syncZoomUI() {
    const pct = Math.round(zoom * 100);
    zoomLabel.textContent = pct + '%';
    zoomRange.value = Math.min(400, Math.max(2, pct));
  }
  function enforceBgCoverage() {
    if (!bgImage) return;
    const visW = bgImage.width * bgImage.scaleX;
    const visH = bgImage.height * bgImage.scaleY;
    const cw = canvas.getWidth();
    const ch = canvas.getHeight();
    let need = 1;
    if (visW < cw) need = Math.max(need, cw / (bgImage.width * bgImage.scaleX));
    if (visH < ch) need = Math.max(need, ch / (bgImage.height * bgImage.scaleY));
    if (need > 1) {
      const cwOld = bgImage.left + visW / 2;
      const chOld = bgImage.top + visH / 2;
      bgImage.set({ scaleX: bgImage.scaleX * need, scaleY: bgImage.scaleY * need });
      const nW = bgImage.width * bgImage.scaleX;
      const nH = bgImage.height * bgImage.scaleY;
      bgImage.set({ left: cwOld - nW / 2, top: chOld - nH / 2 });
    }
    canvas.requestRenderAll();
  }

  // ---------- 히스토리 ----------
  const history = { stack: [], index: -1, max: 50, restoring: false };

  function snapshot() {
    const objs = canvas.getObjects().filter(o => o.layerType).map(o => {
      const base = {
        type: o.layerType, __uid: o.__uid, name: o.name,
        left: o.left, top: o.top, scaleX: o.scaleX, scaleY: o.scaleY,
        angle: o.angle, originX: o.originX, originY: o.originY,
      };
      if (o.layerType === 'text') {
        Object.assign(base, {
          text: o.text, fontSize: o.fontSize, fontFamily: o.fontFamily,
          fill: o.fill, textAlign: o.textAlign, width: o.width,
          backgroundColor: o.backgroundColor || '',
          stroke: o.stroke || '', strokeWidth: o.strokeWidth || 0,
        });
      } else if (o.layerType === 'image') {
        base.src = o._src;
        base.naturalW = o.width;
        base.naturalH = o.height;
      }
      return base;
    });
    return {
      ratio: currentRatio,
      imageNatural: imageNatural ? { ...imageNatural } : null,
      canvasW: canvas.getWidth(),
      canvasH: canvas.getHeight(),
      objects: objs,
    };
  }
  function pushHistory() {
    if (history.restoring) return;
    const snap = snapshot();
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(snap);
    if (history.stack.length > history.max) history.stack.shift();
    history.index = history.stack.length - 1;
    updateHistoryUI();
    scheduleAutosave();
  }
  function updateHistoryUI() {
    undoBtn.disabled = history.index <= 0;
    redoBtn.disabled = history.index >= history.stack.length - 1;
  }
  async function restoreSnapshot(snap) {
    history.restoring = true;

    currentRatio = snap.ratio;
    ratioToolLabel.textContent = currentRatio;
    imageNatural = snap.imageNatural ? { ...snap.imageNatural } : null;

    canvas.setWidth(snap.canvasW);
    canvas.setHeight(snap.canvasH);
    canvas.clear();
    canvas.backgroundColor = null;

    const imageJobs = [];
    const textObjs = [];
    let newBg = null;

    snap.objects.forEach(o => {
      if (o.type === 'image' && o.src) {
        imageJobs.push(new Promise(res => {
          fabric.Image.fromURL(o.src, img => {
            img.set({
              left: o.left, top: o.top, scaleX: o.scaleX, scaleY: o.scaleY,
              angle: o.angle, originX: o.originX, originY: o.originY,
              selectable: true, hasControls: true, hasBorders: true,
              lockRotation: true, lockUniScaling: true, hoverCursor: 'move',
            });
            img.layerType = 'image';
            img.name = o.name;
            img._src = o.src;
            img.__uid = o.__uid;
            canvas.add(img);
            if (!newBg) newBg = img;
            res();
          });
        }));
      } else if (o.type === 'text') {
        textObjs.push(o);
      }
    });

    await Promise.all(imageJobs);

    textObjs.forEach(o => {
      const t = new fabric.IText(o.text || '', {
        left: o.left, top: o.top, scaleX: o.scaleX, scaleY: o.scaleY,
        angle: o.angle, originX: o.originX, originY: o.originY,
        fontSize: o.fontSize, fontFamily: o.fontFamily,
        fill: o.fill, textAlign: o.textAlign, width: o.width,
        editable: true,
        backgroundColor: o.backgroundColor || '',
        stroke: o.stroke || '', strokeWidth: o.strokeWidth || 0,
        paintFirst: 'stroke',
      });
      t.layerType = 'text';
      t.name = o.name;
      t.__uid = o.__uid;
      canvas.add(t);
    });

    bgImage = newBg;
    emptyHint.style.display = bgImage ? 'none' : '';
    applyViewToDOM();
    refreshLayers();
    updateSelectionUI();
    history.restoring = false;
  }
  function undo() {
    if (history.index > 0) {
      history.index--;
      restoreSnapshot(history.stack[history.index]);
      updateHistoryUI();
    }
  }
  function redo() {
    if (history.index < history.stack.length - 1) {
      history.index++;
      restoreSnapshot(history.stack[history.index]);
      updateHistoryUI();
    }
  }
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  // ---------- 임시저장 ----------
  const AUTOSAVE_KEY = 'cardnews.autosave.v2';
  let autosaveTimer = null;
  function scheduleAutosave() {
    if (autosaveTimer) return;
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      saveToLocalStorage();
    }, 400);
  }
  function saveToLocalStorage() {
    try {
      const snap = snapshot();
      snap.objects.forEach(o => { if (o.type === 'image') delete o.src; });
      snap.hasImage = !!bgImage;
      snap.imageName = bgImage ? bgImage.name : null;
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snap));
    } catch (e) { console.warn('임시저장 실패:', e); }
  }
  function clearLocalStorage() {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
  }
  window.addEventListener('beforeunload', () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    saveToLocalStorage();
  });

  // ---------- 키보드 ----------
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const isInput = tag === 'input' || tag === 'select' || tag === 'textarea';

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isInput) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
      const obj = canvas.getActiveObject();
      if (obj && obj.isEditing) return;
      deleteSelected();
      return;
    }
    if (isInput) return;
    if (e.ctrlKey || e.metaKey) return;

    if (e.key === 'v' || e.key === 'V') setTool('select');
    if (e.key === 't' || e.key === 'T') setTool('text');
    if (e.key === 'h' || e.key === 'H') setTool('move');
    if (e.key === 'r' || e.key === 'R') cycleRatio();
    if (e.code === 'Space') {
      spaceDown = true;
      stageWrap.classList.add('tool-move');
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') {
      spaceDown = false;
      if (currentTool !== 'move') stageWrap.classList.remove('tool-move');
    }
  });

  // ---------- 파일 검증 ----------
  function sniffImageType(buf) {
    const b = new Uint8Array(buf);
    if (b.length >= 8 &&
        b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47&&
        b[4]===0x0D&&b[5]===0x0A&&b[6]===0x1A&&b[7]===0x0A) return 'image/png';
    if (b.length >= 3 && b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF) return 'image/jpeg';
    return null;
  }
  function readAsArrayBuffer(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }
  function verifyDecodable(file) {
    return new Promise(res => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(true); };
      img.onerror = () => { URL.revokeObjectURL(url); res(false); };
      img.src = url;
    });
  }
  async function validateImageFile(file) {
    const name = (file.name || '').toLowerCase();
    if (!(name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')))
      return { ok: false, reason: 'PNG 또는 JPEG만 지원합니다.' };
    let buf;
    try { buf = await readAsArrayBuffer(file); }
    catch { return { ok: false, reason: '파일을 읽을 수 없습니다.' }; }
    if (!sniffImageType(buf))
      return { ok: false, reason: '실제 이미지 파일이 아닙니다.' };
    if (!(await verifyDecodable(file)))
      return { ok: false, reason: '이미지를 해석할 수 없습니다.' };
    return { ok: true };
  }

  // ---------- 이미지 로드 ----------
  function loadBackgroundImage(file) {
    const url = URL.createObjectURL(file);
    fabric.Image.fromURL(url, img => {
      if (bgImage) canvas.remove(bgImage);
      imageNatural = { w: img.width, h: img.height };
      const s = computeCanvasSize(currentRatio, img.width, img.height);
      canvas.setWidth(s.w);
      canvas.setHeight(s.h);
      img.set({
        selectable: true, hasControls: true, hasBorders: true,
        lockRotation: true, lockUniScaling: true, hoverCursor: 'move',
        originX: 'left', originY: 'top',
      });
      img.layerType = 'image';
      img.name = file.name || '이미지';
      img._src = url;
      placeImageCentralCrop(img);
      canvas.add(img);
      canvas.sendToBack(img);
      bgImage = img;
      emptyHint.style.display = 'none';
      applyViewToDOM();
      fitView();
      refreshLayers();
      pushHistory();
      showToast('이미지가 추가되었습니다.', 'success');
    });
  }
  async function handleIncomingFile(file) {
    const r = await validateImageFile(file);
    if (!r.ok) { showToast('거절됨: ' + r.reason); return; }
    if (pendingImageUpload) {
      const snap = pendingImageUpload.snap;
      pendingImageUpload = null;
      await restoreWithNewImage(snap, file);
      return;
    }
    if (bgImage) {
      const ok = await openModal('이미 올라온 이미지가 있습니다. 새 이미지로 교체할까요?');
      if (!ok) return;
    }
    loadBackgroundImage(file);
  }

  async function restoreWithNewImage(snap, file) {
    const url = URL.createObjectURL(file);
    await new Promise(resolve => {
      fabric.Image.fromURL(url, img => {
        const imgSnap = snap.objects.find(o => o.type === 'image');
        currentRatio = snap.ratio;
        ratioToolLabel.textContent = currentRatio;
        imageNatural = snap.imageNatural ? { ...snap.imageNatural } : { w: img.width, h: img.height };
        canvas.setWidth(snap.canvasW);
        canvas.setHeight(snap.canvasH);
        canvas.clear();
        canvas.backgroundColor = null;

        img.set({
          selectable: true, hasControls: true, hasBorders: true,
          lockRotation: true, lockUniScaling: true, hoverCursor: 'move',
          originX: 'left', originY: 'top',
        });
        img.layerType = 'image';
        img.name = (imgSnap && imgSnap.name) || file.name || '이미지';
        img._src = url;

        if (imgSnap) {
          img.set({
            left: imgSnap.left, top: imgSnap.top,
            scaleX: imgSnap.scaleX, scaleY: imgSnap.scaleY,
            angle: imgSnap.angle, originX: imgSnap.originX, originY: imgSnap.originY,
          });
        } else {
          placeImageCentralCrop(img);
        }
        canvas.add(img);
        canvas.sendToBack(img);
        bgImage = img;

        snap.objects.filter(o => o.type === 'text').forEach(o => {
          const t = new fabric.IText(o.text || '', {
            left: o.left, top: o.top,
            scaleX: o.scaleX, scaleY: o.scaleY,
            angle: o.angle, originX: o.originX, originY: o.originY,
            fontSize: o.fontSize, fontFamily: o.fontFamily,
            fill: o.fill, textAlign: o.textAlign, width: o.width, editable: true,
            backgroundColor: o.backgroundColor || '',
            stroke: o.stroke || '', strokeWidth: o.strokeWidth || 0,
            paintFirst: 'stroke',
          });
          t.layerType = 'text';
          t.name = o.name;
          t.__uid = o.__uid;
          canvas.add(t);
        });

        emptyHint.style.display = 'none';
        applyViewToDOM();
        fitView();
        refreshLayers();
        updateSelectionUI();
        pushHistory();
        showToast('이미지와 편집 상태가 복원되었습니다.', 'success');
        resolve();
      });
    });
  }

  // ---------- 드래그 앤 드롭 ----------
  let dragDepth = 0;
  window.addEventListener('dragenter', e => {
    e.preventDefault(); dragDepth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragover', e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', e => {
    e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    const f = e.dataTransfer && e.dataTransfer.files;
    if (f && f[0]) handleIncomingFile(f[0]);
  });

  stageWrap.addEventListener('click', e => {
    if (e.target === stageWrap && !bgImage && currentTool === 'select') fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleIncomingFile(fileInput.files[0]);
    fileInput.value = '';
  });

  // ---------- 텍스트 추가 (텍스트 도구용) ----------
  function addTextAt(x, y) {
    const t = new fabric.IText('텍스트를 입력하세요', {
      left: x, top: y,
      fontSize: 48,
      fill: '#ffffff',
      fontFamily: 'Quicksand',
      textAlign: 'left',
      editable: true,
      paintFirst: 'stroke',
    });
    t.layerType = 'text';
    t.name = '텍스트';
    canvas.add(t);
    canvas.setActiveObject(t);
    t.enterEditing();
    t.selectAll();
    refreshLayers();
    updateSelectionUI();
    pushHistory();
  }

  // ---------- 선택 UI ----------
  function updateSelectionUI() {
    const objs = canvas.getActiveObjects();
    const single = objs.length === 1 ? objs[0] : null;
    const isSingleText = single && single.layerType === 'text';

    textControls.hidden = !isSingleText;
    textEmpty.hidden = !!isSingleText;
    deleteBtn.disabled = objs.length === 0;

    if (isSingleText) updateTextControls();
    highlightLayerList();
  }
  function updateTextControls() {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;

    if (document.activeElement !== fontFamilyInput)
      fontFamilyInput.value = obj.fontFamily || '';
    if (document.activeElement !== fontSizeInput)
      fontSizeInput.value = Math.round(obj.fontSize || 48);
    if (document.activeElement !== colorInput)
      colorInput.value = toHex(obj.fill);

    document.querySelectorAll('.align-buttons button').forEach(b =>
      b.classList.toggle('active', b.dataset.align === (obj.textAlign || 'left')));

    if (document.activeElement !== bgColorInput) {
      if (obj.backgroundColor) {
        bgColorNone.checked = false;
        bgColorInput.disabled = false;
        bgColorInput.value = toHex(obj.backgroundColor);
      } else {
        bgColorNone.checked = true;
        bgColorInput.disabled = true;
      }
    }
    if (document.activeElement !== strokeColorInput)
      strokeColorInput.value = toHex(obj.stroke || '#000000');
    if (document.activeElement !== strokeWidthInput)
      strokeWidthInput.value = obj.strokeWidth || 0;
  }
  function toHex(c) {
    if (typeof c === 'string') {
      if (/^#[0-9a-f]{6}$/i.test(c)) return c;
      const m = c.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
      if (m) {
        const h = n => parseInt(n).toString(16).padStart(2, '0');
        return '#' + h(m[1]) + h(m[2]) + h(m[3]);
      }
    }
    return '#ffffff';
  }
  function deleteSelected() {
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    objs.forEach(o => {
      if (o.layerType) {
        if (o === bgImage) { bgImage = null; imageNatural = null; }
        canvas.remove(o);
      }
    });
    canvas.discardActiveObject();
    if (!bgImage) emptyHint.style.display = '';
    refreshLayers();
    updateSelectionUI();
    pushHistory();
  }
  deleteBtn.addEventListener('click', deleteSelected);

  // ---------- 미니맵 조작 ----------
  let minimapDragging = false;
  function minimapToPan(clientX, clientY) {
    const g = getMinimapGeometry();
    if (!g) return;
    const rect = minimapBox.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const cx = (mx - g.offsetX) / g.scale;
    const cy = (my - g.offsetY) / g.scale;
    panX = stageWrap.clientWidth / 2 - cx * zoom;
    panY = stageWrap.clientHeight / 2 - cy * zoom;
    applyViewToDOM();
  }
  minimapBox.addEventListener('mousedown', e => {
    minimapDragging = true;
    minimapToPan(e.clientX, e.clientY);
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (minimapDragging) minimapToPan(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', () => { minimapDragging = false; });

  // ---------- 텍스트 속성 이벤트 ----------
  fontFamilyInput.addEventListener('focus', () => {
    fontFamilyInput.dataset.prev = fontFamilyInput.value;
    fontFamilyInput.value = '';
  });
  fontFamilyInput.addEventListener('blur', () => {
    if (!fontFamilyInput.value)
      fontFamilyInput.value = fontFamilyInput.dataset.prev || '';
  });
  fontFamilyInput.addEventListener('input', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    obj.set('fontFamily', fontFamilyInput.value || 'Arial');
    canvas.requestRenderAll();
  });
  fontFamilyInput.addEventListener('change', async () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    const fam = fontFamilyInput.value || 'Arial';
    try { await document.fonts.load(`16px "${fam}"`); } catch (e) {}
    obj.set('fontFamily', fam);
    canvas.requestRenderAll();
    pushHistory();
  });

  fontSizeInput.addEventListener('input', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    const size = parseFloat(fontSizeInput.value);
    if (!isNaN(size) && size > 0) {
      obj.set('fontSize', size);
      canvas.requestRenderAll();
    }
  });
  fontSizeInput.addEventListener('change', () => {
    const obj = canvas.getActiveObject();
    if (obj && obj.layerType === 'text') pushHistory();
  });

  colorInput.addEventListener('input', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    obj.set('fill', colorInput.value);
    canvas.requestRenderAll();
  });
  colorInput.addEventListener('change', () => {
    const obj = canvas.getActiveObject();
    if (obj && obj.layerType === 'text') pushHistory();
  });

  document.querySelectorAll('.align-buttons button').forEach(btn => {
    btn.addEventListener('click', () => {
      const obj = canvas.getActiveObject();
      if (!obj || obj.layerType !== 'text') return;
      obj.set('textAlign', btn.dataset.align);
      canvas.requestRenderAll();
      document.querySelectorAll('.align-buttons button').forEach(b =>
        b.classList.toggle('active', b === btn));
      pushHistory();
    });
  });

  bgColorNone.addEventListener('change', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    if (bgColorNone.checked) {
      obj.set('backgroundColor', '');
      bgColorInput.disabled = true;
    } else {
      obj.set('backgroundColor', bgColorInput.value);
      bgColorInput.disabled = false;
    }
    canvas.requestRenderAll();
    pushHistory();
  });
  bgColorInput.addEventListener('input', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    if (!bgColorNone.checked) {
      obj.set('backgroundColor', bgColorInput.value);
      canvas.requestRenderAll();
    }
  });
  bgColorInput.addEventListener('change', () => {
    const obj = canvas.getActiveObject();
    if (obj && obj.layerType === 'text') pushHistory();
  });

  strokeColorInput.addEventListener('input', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    obj.set('stroke', strokeColorInput.value);
    if (!obj.strokeWidth || obj.strokeWidth <= 0) {
      obj.set('strokeWidth', 1);
      if (document.activeElement !== strokeWidthInput) strokeWidthInput.value = 1;
    }
    obj.set('strokeUniform', true);
    canvas.requestRenderAll();
  });
  strokeColorInput.addEventListener('change', () => {
    const obj = canvas.getActiveObject();
    if (obj && obj.layerType === 'text') pushHistory();
  });
  strokeWidthInput.addEventListener('input', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    const w = parseFloat(strokeWidthInput.value);
    obj.set('strokeWidth', isNaN(w) ? 0 : w);
    obj.set('strokeUniform', true);
    canvas.requestRenderAll();
  });
  strokeWidthInput.addEventListener('change', () => {
    const obj = canvas.getActiveObject();
    if (obj && obj.layerType === 'text') pushHistory();
  });

  // ---------- 레이어 패널 ----------
  function refreshLayers() {
    const objs = canvas.getObjects().filter(o => o.layerType).slice().reverse();
    layerListEl.innerHTML = '';
    layerCount.textContent = objs.length;
    objs.forEach(obj => {
      const li = document.createElement('li');
      const tag = document.createElement('span');
      tag.className = 'type-tag';
      tag.textContent = obj.layerType === 'image' ? 'IMG' : 'TXT';
      const label = document.createElement('span');
      label.textContent = (obj.layerType === 'text' ? obj.text : obj.name) || '이미지';
      li.appendChild(tag);
      li.appendChild(label);
      li.dataset.uid = obj.__uid;
      li.addEventListener('click', () => {
        canvas.setActiveObject(obj);
        canvas.requestRenderAll();
        updateSelectionUI();
      });
      layerListEl.appendChild(li);
    });
    highlightLayerList();
  }
  function highlightLayerList() {
    const active = canvas.getActiveObject();
    layerListEl.querySelectorAll('li').forEach(li => {
      li.classList.toggle('selected',
        active && String(active.__uid) === li.dataset.uid);
    });
  }

  // ---------- Fabric 이벤트 ----------
  canvas.on('selection:created', updateSelectionUI);
  canvas.on('selection:updated', updateSelectionUI);
  canvas.on('selection:cleared', updateSelectionUI);
  canvas.on('object:added', refreshLayers);
  canvas.on('object:removed', refreshLayers);
  canvas.on('text:changed', e => {
    if (e.target) {
      e.target.name = (e.target.text || '텍스트').slice(0, 20);
      const li = layerListEl.querySelector('li[data-uid="' + e.target.__uid + '"]');
      if (li) {
        const labelSpan = li.querySelector('span:not(.type-tag)');
        if (labelSpan) labelSpan.textContent = e.target.name;
      }
    }
    if (e.target && e.target.isEditing) return;
    scheduleMinimap();
  });
  canvas.on('object:modified', opt => {
    if (opt.target && opt.target.isEditing) return;
    pushHistory();
  });
  canvas.on('text:editing:exited', () => {
    pushHistory();
    scheduleMinimap();
  });

  canvas.on('object:added', () => scheduleMinimap());
  canvas.on('object:removed', () => scheduleMinimap());
  canvas.on('object:modified', () => scheduleMinimap());

  // ---------- 휠 줌 ----------
  stageWrap.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = 0.999 ** e.deltaY;
    zoomAtPoint(zoom * factor, e.clientX, e.clientY);
  }, { passive: false });

  // ---------- 팬 ----------
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let panOriginX = 0, panOriginY = 0;
  let spaceDown = false;

  canvas.on('mouse:down', opt => {
    const e = opt.e;

    // 텍스트 도구: 빈 곳 클릭 시 텍스트 생성
    if (currentTool === 'text' && !opt.target) {
      const pointer = canvas.getPointer(e);
      addTextAt(pointer.x, pointer.y);
      setTool('select');
      return;
    }

    // 이동 도구: 무조건 팬
    if (currentTool === 'move' || e.altKey || spaceDown) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = panX;
      panOriginY = panY;
      canvas.selection = false;
      canvas.discardActiveObject();
      updateSelectionUI();
      stageWrap.classList.add('dragging');
    }
  });

  stageWrap.addEventListener('mousedown', e => {
    if (e.target === stageWrap && currentTool === 'move') {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = panX;
      panOriginY = panY;
      stageWrap.classList.add('dragging');
    }
  });

  window.addEventListener('mousemove', e => {
    if (!isPanning) return;
    panX = panOriginX + (e.clientX - panStartX);
    panY = panOriginY + (e.clientY - panStartY);
    applyViewToDOM();
  });
  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      stageWrap.classList.remove('dragging');
    }
  });

  // ---------- 줌 컨트롤 ----------
  zoomRange.addEventListener('input', () => {
    setZoomCenter(parseInt(zoomRange.value, 10) / 100);
  });
  zoomInBtn.addEventListener('click', () => setZoomCenter(zoom * 1.2));
  zoomOutBtn.addEventListener('click', () => setZoomCenter(zoom / 1.2));
  fitViewBtn.addEventListener('click', fitView);

  // ---------- JSON 저장 ----------
  saveJsonBtn.addEventListener('click', () => {
    const snap = snapshot();
    snap.objects.forEach(o => { if (o.type === 'image') delete o.src; });
    snap.hasImage = !!bgImage;
    snap.imageName = bgImage ? bgImage.name : null;
    snap.savedAt = new Date().toISOString();

    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cardnews-' + currentRatio.replace(':', 'x') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('JSON으로 저장되었습니다.', 'success');
  });

  // ---------- JSON 불러오기 ----------
  loadJsonBtn.addEventListener('click', () => jsonFileInput.click());
  jsonFileInput.addEventListener('change', async () => {
    const file = jsonFileInput.files[0];
    jsonFileInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const snap = JSON.parse(text);
      const err = validateSnapshot(snap);
      if (err) { showToast('불러오기 실패: ' + err); return; }
      await loadSnapshotWithImagePrompt(snap, '불러온 JSON');
    } catch (e) {
      console.warn(e);
      showToast('불러오기 실패: JSON 형식이 아닙니다.');
    }
  });

  function validateSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return 'JSON 형식이 아닙니다.';
    if (typeof snap.ratio !== 'string' || !RATIO_VALUES[snap.ratio]) return 'ratio 값이 잘못되었습니다.';
    if (!Array.isArray(snap.objects)) return 'objects 배열이 없습니다.';
    if (typeof snap.canvasW !== 'number' || typeof snap.canvasH !== 'number') return '캔버스 크기 정보가 없습니다.';
    for (const o of snap.objects) {
      if (o.type !== 'text' && o.type !== 'image') continue;
      if (o.type === 'text' && typeof o.text !== 'string') return '텍스트 객체 형식 오류.';
    }
    return null;
  }

  async function loadSnapshotWithImagePrompt(snap, sourceLabel) {
    const hasImage = snap.hasImage || snap.objects.some(o => o.type === 'image');
    if (hasImage) {
      const ok = await openModal(
        sourceLabel + '에 이미지가 포함되어 있지 않습니다.\n' +
        '같은 이미지를 다시 업로드하면 편집 상태가 그대로 복원됩니다.\n' +
        '(취소하면 텍스트만 복원됩니다.)'
      );
      const textOnly = JSON.parse(JSON.stringify(snap));
      textOnly.objects = textOnly.objects.filter(o => o.type !== 'image');
      if (ok) {
        pendingImageUpload = { snap };
        await restoreSnapshot(textOnly);
        showToast('이미지를 드롭하거나 선택하세요.', 'success');
      } else {
        await restoreSnapshot(textOnly);
        showToast('텍스트만 복원되었습니다.', 'success');
      }
      return;
    }
    await restoreSnapshot(snap);
    showToast('불러왔습니다.', 'success');
  }

  // ---------- PNG 내보내기 ----------
  exportBtn.addEventListener('click', () => {
    clearSnapGuides();
    const prevBgColor = canvasEl.style.backgroundColor;
    const prevBgImage = canvasEl.style.backgroundImage;
    canvasEl.style.backgroundColor = 'transparent';
    canvasEl.style.backgroundImage = 'none';

    canvas.discardActiveObject();
    canvas.requestRenderAll();
    const dataURL = canvas.toDataURL({ format: 'png', multiplier: 1 });

    canvasEl.style.backgroundColor = prevBgColor;
    canvasEl.style.backgroundImage = prevBgImage;
    canvas.requestRenderAll();
    updateSelectionUI();

    const a = document.createElement('a');
    a.href = dataURL;
    a.download = 'cardnews-' + currentRatio.replace(':', 'x') + '.png';
    a.click();
    showToast('PNG로 저장되었습니다.', 'success');
  });

  // ---------- 초기화 ----------
  function initEditor() {
    applyCanvasSize();
    refreshLayers();
    updateSelectionUI();
    updateHistoryUI();
    pushHistory();
    setTool('select');
    ratioToolLabel.textContent = currentRatio;

    setTimeout(() => renderMinimap(), 60);

    window.addEventListener('resize', () => {
      fitView();
      scheduleMinimap();
    });

    // 임시저장 자동 복원
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) {
      try {
        const snap = JSON.parse(saved);
        const err = validateSnapshot(snap);
        if (!err && snap.objects.length > 0) {
          if (snap.hasImage) {
            openModal('이전 작업이 임시저장되어 있습니다.\n이미지가 포함되어 있지 않으니 같은 이미지를 다시 업로드하면 복원됩니다.')
              .then(ok => {
                const textOnly = JSON.parse(JSON.stringify(snap));
                textOnly.objects = textOnly.objects.filter(o => o.type !== 'image');
                if (ok) {
                  pendingImageUpload = { snap };
                  restoreSnapshot(textOnly);
                  showToast('이미지를 드롭하거나 선택하세요.', 'success');
                } else {
                  restoreSnapshot(textOnly);
                }
              });
          } else {
            restoreSnapshot(snap);
          }
        }
      } catch (e) { console.warn('임시저장 복원 실패:', e); }
    }
  }

  if (CUSTOM_FONTS.length === 0) {
    initEditor();
  } else {
    Promise.all(
      CUSTOM_FONTS.map(family =>
        document.fonts.load(`16px "${family}"`).catch(err => {
          console.warn('폰트 로드 실패:', family, err);
        })
      )
    ).then(() => initEditor());
  }

})();