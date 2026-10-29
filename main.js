(function () {
  'use strict';

  // ---------- 상수 ----------
  // 이미지가 없을 때 임시 캔버스 기준 크기(비율별)
  const DEFAULT_RATIOS = {
    '1:1':  { w: 1080, h: 1080 },
    '4:5':  { w: 1080, h: 1350 },
    '9:16': { w: 1080, h: 1920 },
  };
  // 비율 수치
  const RATIO_VALUES = {
    '1:1':  1 / 1,
    '4:5':  4 / 5,
    '9:16': 9 / 16,
  };

  // ---------- 폰트 목록 ----------
  const FONT_LIST = [
    // 영문
    'Pacifico', 'Varela Round', 'Quicksand', 'Montserrat',
    // 한글
    'Jua', 'Noto Sans KR',
    // 시스템 폰트 (폴백용)
    'Arial', 'Helvetica', 'Verdana',
    'Malgun Gothic', 'Apple SD Gothic Neo',
    'sans-serif', 'serif', 'monospace',
  ];

  // ---------- 커스텀 폰트 (구글 폰트 CDN) ----------
  const CUSTOM_FONTS = [
    'Pacifico',
    'Varela Round',
    'Quicksand',
    'Montserrat',
    'Jua',
    'Noto Sans KR',
  ];

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const ratioSelect = $('ratioSelect');
  const addTextBtn  = $('addTextBtn');
  const undoBtn     = $('undoBtn');
  const redoBtn     = $('redoBtn');
  const exportBtn   = $('exportBtn');
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
  const jsonFileInput = $('jsonFileInput');
  const saveJsonBtn   = $('saveJsonBtn');
  const loadJsonBtn   = $('loadJsonBtn');
  const fileInput   = $('fileInput');
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
  const minimapScaleCache = {
    scale: 1,
    w: 0,
    h: 0,
    offsetX: 0,
    offsetY: 0,
  };

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
    borderColor: '#ff8fab',
    cornerColor: '#ffd6e0',
    cornerStrokeColor: '#ff8fab',
    cornerStyle: 'circle',
    cornerSize: 12,
    transparentCorners: false,
    padding: 4,
  });
  // 회전 핸들 전역 제거
  fabric.Object.prototype.setControlsVisibility({ mtr: false });

  // ---------- 자석 스냅 ----------
  // 캔버스 변(좌/우/상/하), 중앙선, 다른 오브젝트 중심에 가까우면 붙임.
  // 캔버스 좌표계 기준으로 계산. 시각 가이드라인은 캔버스 위 임시 오브젝트로 그림.

  const SNAP_THRESHOLD_RATIO = 0.012;   // 캔버스 짧은 변의 1.2%
  const SNAP_THRESHOLD_MIN   = 6;       // 최소 6px

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
      stroke: '#ff8fab', strokeWidth: 1,
      selectable: false, evented: false, excludeFromExport: true,
      opacity: 0.9,
    });
    snapGuideV._isGuide = true;
    canvas.add(snapGuideV);
  }
  function drawSnapGuideH(y) {
    if (snapGuideH) canvas.remove(snapGuideH);
    snapGuideH = new fabric.Line([0, y, canvas.getWidth(), y], {
      stroke: '#ff8fab', strokeWidth: 1,
      selectable: false, evented: false, excludeFromExport: true,
      opacity: 0.9,
    });
    snapGuideH._isGuide = true;
    canvas.add(snapGuideH);
  }

  // 대상의 캔버스 좌표계 bounding box
  function getBounds(obj) {
    const r = obj.getBoundingRect(true, true); // absolute, no viewport
    return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height,
            cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  }

  function applySnap(obj) {
    // 가이드 제외
    if (!obj || obj._isGuide) return;

    const thr = getSnapThreshold();
    const cw = canvas.getWidth();
    const ch = canvas.getHeight();
    const b = getBounds(obj);

    // 스냅 후보: 캔버스 변 + 중앙
    const targetXs = [0, cw / 2, cw];
    const targetYs = [0, ch / 2, ch];

    // 다른 오브젝트의 중심/변도 후보로 (자기 자신, 가이드, 배경이미지 제외)
    canvas.getObjects().forEach(o => {
      if (o === obj || o._isGuide || o === bgImage) return;
      const ob = getBounds(o);
      targetXs.push(ob.left, ob.cx, ob.right);
      targetYs.push(ob.top, ob.cy, ob.bottom);
    });

    // 대상의 세 기준점: 왼쪽, 중심, 오른쪽 / 위, 중앙, 아래
    const objXs = [
      { v: b.left,   anchor: 'left'   },
      { v: b.cx,     anchor: 'center' },
      { v: b.right,  anchor: 'right'  },
    ];
    const objYs = [
      { v: b.top,    anchor: 'top'    },
      { v: b.cy,     anchor: 'center' },
      { v: b.bottom, anchor: 'bottom' },
    ];

    let bestDx = Infinity, bestDxTarget = null, bestDxAnchor = null;
    let bestDy = Infinity, bestDyTarget = null, bestDyAnchor = null;

    objXs.forEach(ox => {
      targetXs.forEach(tx => {
        const d = Math.abs(ox.v - tx);
        if (d < thr && d < bestDx) {
          bestDx = d; bestDxTarget = tx; bestDxAnchor = ox.anchor;
        }
      });
    });
    objYs.forEach(oy => {
      targetYs.forEach(ty => {
        const d = Math.abs(oy.v - ty);
        if (d < thr && d < bestDy) {
          bestDy = d; bestDyTarget = ty; bestDyAnchor = oy.anchor;
        }
      });
    });

    // 가이드 초기화
    clearSnapGuides();

    // X 스냅 적용
    if (bestDxTarget !== null) {
      let dx = 0;
      if (bestDxAnchor === 'left')   dx = bestDxTarget - b.left;
      if (bestDxAnchor === 'center') dx = bestDxTarget - b.cx;
      if (bestDxAnchor === 'right')  dx = bestDxTarget - b.right;
      obj.left += dx;
      drawSnapGuideV(bestDxTarget);
    }

    // Y 스냅 적용
    if (bestDyTarget !== null) {
      let dy = 0;
      if (bestDyAnchor === 'top')    dy = bestDyTarget - b.top;
      if (bestDyAnchor === 'center') dy = bestDyTarget - b.cy;
      if (bestDyAnchor === 'bottom') dy = bestDyTarget - b.bottom;
      obj.top += dy;
      drawSnapGuideH(bestDyTarget);
    }

    if (bestDxTarget !== null || bestDyTarget !== null) {
      obj.setCoords();
    }
  }

  // 캔버스 이벤트에 훅
  canvas.on('object:moving', e => {
    applySnap(e.target);
  });
  canvas.on('object:scaling', e => {
    // 스케일 중에도 스냅(코너 조절 시)
    applySnap(e.target);
  });
  canvas.on('mouse:up', () => {
    clearSnapGuides();
  });
  canvas.on('object:modified', () => {
    clearSnapGuides();
  });

  let currentRatio = '1:1';
  let bgImage = null;
  let imageNatural = null;    // { w, h } 원본 크기

  // 뷰 상태
  let zoom = 1;
  let panX = 0;
  let panY = 0;

  let uidSeq = 0;
  const origAdd = canvas.add.bind(canvas);
  canvas.add = function (...objs) {
    objs.forEach(o => { if (!o.__uid) o.__uid = ++uidSeq; });
    return origAdd(...objs);
  };

  // ---------- 캔버스 크기 계산 ----------
  // 이미지 원본에서 비율에 맞는 "최대 내접 사각형"을 중앙 기준으로 계산
  function computeCanvasSize(ratioKey, imgW, imgH) {
    if (!imgW || !imgH) {
      return DEFAULT_RATIOS[ratioKey];
    }
    const r = RATIO_VALUES[ratioKey];
    // 이미지 안에서 비율 r을 만족하는 최대 사각형
    let w, h;
    if (imgW / imgH > r) {
      // 이미지가 더 넓음 → 높이 기준
      h = imgH;
      w = h * r;
    } else {
      // 이미지가 더 좁음 → 너비 기준
      w = imgW;
      h = w / r;
    }
    return { w: Math.round(w), h: Math.round(h) };
  }

  // 이미지가 캔버스의 어디를 크롭해서 보여줄지(중앙) 기준으로 이미지 위치 지정
  function placeImageCentralCrop(img) {
    // 캔버스 크기와 이미지 원본 크기 관계에서, 이미지 원본을 캔버스 위에 "1:1 픽셀"로 놓고
    // 캔버스 중심과 이미지 중심을 맞춤. 이미지는 캔버스를 덮을 만큼 크다.
    const cw = canvas.getWidth();
    const ch = canvas.getHeight();
    img.scaleX = 1;
    img.scaleY = 1;
    // 이미지 중심 = 캔버스 중심이 되게 배치
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
    if (bgImage) {
      // 이미지 위치를 중앙 크롭 기준으로 재배치
      // (비율 변경 시 캔버스가 커지거나 작아지므로 이미지 중심을 다시 캔버스 중심에)
      placeImageCentralCrop(bgImage);
    }
    applyViewToDOM();
    enforceBgCoverage();
    fitView();
  }
  
  // ---------- 미니맵 ----------
  let minimapTimer = null;

  function scheduleMinimap() {
    if (minimapTimer) return;
    minimapTimer = setTimeout(() => {
      minimapTimer = null;
      renderMinimap();
    }, 120);
  }

  // 미니맵 박스 안에서 캔버스 축소본이 차지하는 배율/오프셋 계산
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
    // 편집 중이면 미니맵 렌더 스킵 (포커스 보호)
    if (activeObj && activeObj.isEditing) return;

    const g = getMinimapGeometry();
    if (!g) return;

    minimapScaleCache.scale = g.scale;
    minimapScaleCache.w = g.renderW;
    minimapScaleCache.h = g.renderH;
    minimapScaleCache.offsetX = g.offsetX;
    minimapScaleCache.offsetY = g.offsetY;

    // 선택/가이드 잠시 숨기고 캔버스 축소본 추출
    const prevBgColor = canvasEl.style.backgroundColor;
    const prevBgImage = canvasEl.style.backgroundImage;
    canvasEl.style.backgroundColor = '#ffffff';
    canvasEl.style.backgroundImage = 'none';

    if (activeObj) canvas.discardActiveObject();
    clearSnapGuides();
    canvas.requestRenderAll();

    const dataURL = canvas.toDataURL({
      format: 'png',
      multiplier: g.scale,
    });

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

    // 캐시 갱신 (미니맵 렌더 없이 뷰포트만 갱신할 때도 scale 필요)
    minimapScaleCache.scale = g.scale;
    minimapScaleCache.w = g.renderW;
    minimapScaleCache.h = g.renderH;
    minimapScaleCache.offsetX = g.offsetX;
    minimapScaleCache.offsetY = g.offsetY;

    // 화면 영역(0 ~ stageWrap 크기)을 캔버스 좌표로 변환
    const sw = stageWrap.clientWidth;
    const sh = stageWrap.clientHeight;

    const viewLeftC   = (0  - panX) / zoom;
    const viewTopC    = (0  - panY) / zoom;
    const viewRightC  = (sw - panX) / zoom;
    const viewBottomC = (sh - panY) / zoom;

    // 캔버스 좌표 → 미니맵 좌표
    const mx = viewLeftC  * g.scale + g.offsetX;
    const my = viewTopC   * g.scale + g.offsetY;
    const mw = (viewRightC  - viewLeftC) * g.scale;
    const mh = (viewBottomC - viewTopC)  * g.scale;

    minimapViewport.style.left   = mx + 'px';
    minimapViewport.style.top    = my + 'px';
    minimapViewport.style.width  = mw + 'px';
    minimapViewport.style.height = mh + 'px';
  }
  // ---------- 뷰(줌/팬) → DOM 반영 ----------
  // Fabric 내부 zoom은 항상 1. element 전체를 CSS transform으로 스케일/이동.
  // → 캔버스 element 자체가 커지고 작아지며, 내부 콘텐츠도 비례해서 함께 확대/축소.
  // → 내부 상대 위치는 완벽히 보존.
  function applyViewToDOM() {
    const w = canvas.getWidth();   // 원본 캔버스 크기
    const h = canvas.getHeight();

    // Fabric 내부 해상도(백스토어)는 원본 유지. CSS 크기는 아래에서 직접 제어.
    canvas.setDimensions({ width: w, height: h }, { backstoreOnly: true });
    canvas.setZoom(1);
    canvas.viewportTransform[4] = 0;
    canvas.viewportTransform[5] = 0;

    // Fabric이 만든 컨테이너와 두 캔버스 레이어를 모두 동일한 크기/위치로 정렬
    const container = canvas.wrapperEl; // .canvas-container
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

    // lower / upper 캔버스 레이어 크기 명시 (컨테이너 안에서 100%로 채움)
    const lowerEl = canvas.lowerCanvasEl;
    const upperEl = canvas.upperCanvasEl;
    if (lowerEl) {
        lowerEl.style.width  = '100%';
        lowerEl.style.height = '100%';
    }
    if (upperEl) {
        upperEl.style.width  = '100%';
        upperEl.style.height = '100%';
    }

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
    // 커서 아래 캔버스 좌표
    const cx = (px - panX) / zoom;
    const cy = (py - panY) / zoom;
    zoom = newZoom;
    panX = px - cx * zoom;
    panY = py - cy * zoom;
    applyViewToDOM();
    }
    function setZoomCenter(newZoom) {
    newZoom = Math.max(0.02, Math.min(8, newZoom));
    const cxScreen = stageWrap.clientWidth / 2;
    const cyScreen = stageWrap.clientHeight / 2;
    const cxCanvas = (cxScreen - panX) / zoom;
    const cyCanvas = (cyScreen - panY) / zoom;
    zoom = newZoom;
    panX = cxScreen - cxCanvas * zoom;
    panY = cyScreen - cyCanvas * zoom;
    applyViewToDOM();
    }

  function syncZoomUI() {
    const pct = Math.round(zoom * 100);
    zoomLabel.textContent = pct + '%';
    zoomRange.value = Math.min(400, Math.max(2, pct));
  }

  // ---------- 배경 커버리지 ----------
  // 이미지가 캔버스보다 작아지면 다시 덮도록 확대
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
      bgImage.set({
        scaleX: bgImage.scaleX * need,
        scaleY: bgImage.scaleY * need,
      });
      // 중심 기준으로 확대했으니 중심 유지
      const cwOld = bgImage.left + visW / 2;
      const chOld = bgImage.top + visH / 2;
      const newVisW = bgImage.width * bgImage.scaleX;
      const newVisH = bgImage.height * bgImage.scaleY;
      bgImage.set({
        left: cwOld - newVisW / 2,
        top:  chOld - newVisH / 2,
      });
    }
    canvas.requestRenderAll();
  }

  // ---------- 히스토리 ----------
  const history = { stack: [], index: -1, max: 50, restoring: false };

  function snapshot() {
    const objs = canvas
    .getObjects()
    .filter((o) => o.layerType)
    .map((o) => {
      const base = {
        type: o.layerType,
        __uid: o.__uid,
        name: o.name,
        left: o.left,
        top: o.top,
        scaleX: o.scaleX,
        scaleY: o.scaleY,
        angle: o.angle,
        originX: o.originX,
        originY: o.originY,
      };
      if (o.layerType === 'text') {
        Object.assign(base, {
          text: o.text,
          fontSize: o.fontSize,
          fontFamily: o.fontFamily,
          fill: o.fill,
          textAlign: o.textAlign,
          width: o.width,
          backgroundColor: o.backgroundColor || '',
          stroke: o.stroke || '',
          strokeWidth: o.strokeWidth || 0,
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

// ---------- 임시저장 (localStorage) ----------
const AUTOSAVE_KEY = 'cardnews.autosave.v1';
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
    // 이미지 소스(blob URL)는 세션 종료 시 무효화되므로 저장하지 않음
    snap.objects.forEach(o => {
      if (o.type === 'image') {
        delete o.src;
      }
    });
    // 이미지 자체는 저장 안 하지만, "이미지가 있었는지"는 알아야 복원 시 안내 가능
    snap.hasImage = !!bgImage;
    snap.imageName = bgImage ? bgImage.name : null;
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snap));
  } catch (e) {
    console.warn('임시저장 실패:', e);
  }
}

function clearLocalStorage() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {}
}

  function updateHistoryUI() {
    undoBtn.disabled = history.index <= 0;
    redoBtn.disabled = history.index >= history.stack.length - 1;
  }

  async function restoreSnapshot(snap) {
    history.restoring = true;

    currentRatio = snap.ratio;
    ratioSelect.value = snap.ratio;
    imageNatural = snap.imageNatural ? { ...snap.imageNatural } : null;

    canvas.setWidth(snap.canvasW);
    canvas.setHeight(snap.canvasH);
    canvas.clear();
    canvas.backgroundColor = null;

    const imageJobs = [];
    const textObjs = [];
    let newBg = null;

    snap.objects.forEach((o) => {
      if (o.type === 'image' && o.src) {
        imageJobs.push(
          new Promise((res) => {
            fabric.Image.fromURL(o.src, (img) => {
              img.set({
                left: o.left,
                top: o.top,
                scaleX: o.scaleX,
                scaleY: o.scaleY,
                angle: o.angle,
                originX: o.originX,
                originY: o.originY,
                selectable: true,
                hasControls: true,
                hasBorders: true,
                lockRotation: true,
                lockUniScaling: true,
                hoverCursor: 'move',
              });
              img.layerType = 'image';
              img.name = o.name;
              img._src = o.src;
              img.__uid = o.__uid;
              canvas.add(img);
              if (!newBg) newBg = img;
              res();
            });
          })
        );
      } else if (o.type === 'text') {
        textObjs.push(o);
      }
    });

    await Promise.all(imageJobs);

    textObjs.forEach((o) => {
      const t = new fabric.IText(o.text || '', {
        left: o.left,
        top: o.top,
        scaleX: o.scaleX,
        scaleY: o.scaleY,
        angle: o.angle,
        originX: o.originX,
        originY: o.originY,
        fontSize: o.fontSize,
        fontFamily: o.fontFamily,
        fill: o.fill,
        textAlign: o.textAlign,
        width: o.width,
        editable: true,
        backgroundColor: o.backgroundColor || '',
        stroke: o.stroke || '',
        strokeWidth: o.strokeWidth || 0,
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
    }
    if (e.code === 'Space' && !isInput) {
      spaceDown = true;
      stageWrap.style.cursor = 'grab';
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') {
      spaceDown = false;
      stageWrap.style.cursor = '';
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

      // 캔버스 크기: 이미지 원본 기준, 현재 비율에 맞는 최대 내접 사각형
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

      // 중앙 크롭 배치
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

    // 대기 중인 JSON 복원이 있으면 그 흐름으로
    if (pendingImageUpload) {
      const snap = pendingImageUpload.snap;
      pendingImageUpload = null;
      // 이미지 로드 + 스냅샷의 텍스트만 복원
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
    await new Promise((resolve) => {
      fabric.Image.fromURL(url, (img) => {
        // 스냅샷에 있던 이미지 오브젝트의 위치/스케일 정보
        const imgSnap = snap.objects.find(o => o.type === 'image');
        // 캔버스 크기 복원
        currentRatio = snap.ratio;
        ratioSelect.value = snap.ratio;
        imageNatural = snap.imageNatural ? { ...snap.imageNatural } : { w: img.width, h: img.height };
        canvas.setWidth(snap.canvasW);
        canvas.setHeight(snap.canvasH);
        canvas.clear();
        canvas.backgroundColor = null;

        // 이미지 배치
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
            angle: imgSnap.angle,
            originX: imgSnap.originX, originY: imgSnap.originY,
          });
        } else {
          placeImageCentralCrop(img);
        }

        canvas.add(img);
        canvas.sendToBack(img);
        bgImage = img;

        // 텍스트 복원
        snap.objects.filter(o => o.type === 'text').forEach(o => {
          const t = new fabric.IText(o.text || '', {
            left: o.left, top: o.top,
            scaleX: o.scaleX, scaleY: o.scaleY,
            angle: o.angle,
            originX: o.originX, originY: o.originY,
            fontSize: o.fontSize, fontFamily: o.fontFamily,
            fill: o.fill, textAlign: o.textAlign,
            width: o.width, editable: true,
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
    if (e.target === stageWrap && !bgImage) fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleIncomingFile(fileInput.files[0]);
    fileInput.value = '';
  });

  // ---------- 비율 ----------
  ratioSelect.addEventListener('change', () => {
    currentRatio = ratioSelect.value;
    applyCanvasSize();
    pushHistory();
  });

  // ---------- 텍스트 ----------
  function addText() {
    const t = new fabric.IText('텍스트를 입력하세요', {
      left: canvas.getWidth() / 2,
      top: canvas.getHeight() / 2,
      originX: 'center', originY: 'center',
      fontSize: 48,
      fill: '#ff8fab',
      fontFamily: 'Quicksand',   // ← Arial에서 변경
      textAlign: 'center',
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
    addTextBtn.addEventListener('click', addText);

  // ---------- 선택 UI ----------
  function updateSelectionUI() {
    const objs = canvas.getActiveObjects();
    const single = objs.length === 1 ? objs[0] : null;
    const isSingleText = single && single.layerType === 'text';

    textControls.hidden = !isSingleText;
    textEmpty.hidden = !!isSingleText || objs.length > 1;
    deleteBtn.disabled = objs.length === 0;

    if (isSingleText) updateTextControls();
    highlightLayerList();
  }

  function updateTextControls() {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;

    if (document.activeElement !== fontFamilyInput) {
      fontFamilyInput.value = obj.fontFamily || '';
    }
    if (document.activeElement !== fontSizeInput) {
      fontSizeInput.value = Math.round(obj.fontSize || 48);
    }
    if (document.activeElement !== colorInput) {
      colorInput.value = toHex(obj.fill);
    }
    // 정렬 버튼은 항상 갱신
    document.querySelectorAll('.align-buttons button').forEach((b) =>
      b.classList.toggle('active', b.dataset.align === (obj.textAlign || 'left'))
    );

    // 배경색
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

    // 외곽선
    if (document.activeElement !== strokeColorInput) {
      strokeColorInput.value = toHex(obj.stroke || '#000000');
    }
    if (document.activeElement !== strokeWidthInput) {
      strokeWidthInput.value = obj.strokeWidth || 0;
    }
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
    return '#ff8fab';
  }

  function deleteSelected() {
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    objs.forEach(o => {
      if (o.layerType) {
        if (o === bgImage) {
          bgImage = null;
          imageNatural = null;
        }
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

    // 미니맵 좌표 → 캔버스 좌표
    const cx = (mx - g.offsetX) / g.scale;
    const cy = (my - g.offsetY) / g.scale;

    // 해당 캔버스 좌표가 화면 중앙에 오도록 pan 조정
    panX = stageWrap.clientWidth / 2 - cx * zoom;
    panY = stageWrap.clientHeight / 2 - cy * zoom;
    applyViewToDOM();
  }

  minimapBox.addEventListener('mousedown', (e) => {
    minimapDragging = true;
    minimapToPan(e.clientX, e.clientY);
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (minimapDragging) minimapToPan(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', () => {
    minimapDragging = false;
  });

  // ---------- 텍스트 속성 이벤트 ----------
  fontFamilyInput.addEventListener('input', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    obj.set('fontFamily', fontFamilyInput.value || 'Arial');
    canvas.requestRenderAll();
  });
  fontFamilyInput.addEventListener('change', async () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    const family = fontFamilyInput.value || 'Arial';
    // 폰트 로드 보장
    try {
      await document.fonts.load(`16px "${family}"`);
    } catch (e) {}
    obj.set('fontFamily', family);
    canvas.requestRenderAll();
    pushHistory();
  });
  // 포커스 시 전체 목록 표시를 위해 값 비우기
  fontFamilyInput.addEventListener('focus', () => {
    fontFamilyInput.dataset.prevValue = fontFamilyInput.value;
    fontFamilyInput.value = '';
  });

  // 포커스 아웃 시 원래 값 복원 (단, 사용자가 새 값을 입력했으면 그 값 유지)
  fontFamilyInput.addEventListener('blur', () => {
    if (!fontFamilyInput.value) {
      fontFamilyInput.value = fontFamilyInput.dataset.prevValue || '';
    }
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
    if (!obj || obj.layerType !== 'text') return;
    pushHistory();
  });
  colorInput.addEventListener('input', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    obj.set('fill', colorInput.value);
    canvas.requestRenderAll();
  });
  colorInput.addEventListener('change', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    pushHistory();
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
  canvas.on('text:changed', (e) => {
    if (e.target) {
      e.target.name = (e.target.text || '텍스트').slice(0, 20);
      const li = layerListEl.querySelector('li[data-uid="' + e.target.__uid + '"]');
      if (li) {
        const labelSpan = li.querySelector('span:not(.type-tag)');
        if (labelSpan) labelSpan.textContent = e.target.name;
      }
    }
    // 편집 중엔 미니맵 갱신하지 않음
    if (e.target && e.target.isEditing) return;
    scheduleMinimap();
  });
  canvas.on('object:modified', (opt) => {
    // 편집 중이면 히스토리 푸시 스킵 (editing:exited에서 처리)
    if (opt.target && opt.target.isEditing) return;
    pushHistory();
  });
  canvas.on('text:editing:exited', () => {
    pushHistory();
    scheduleMinimap();
  });
  // ---------- 미니맵 갱신 트리거 ----------
  canvas.on('object:added', () => scheduleMinimap());
  canvas.on('object:removed', () => scheduleMinimap());
  canvas.on('object:modified', () => scheduleMinimap());

  // ---------- 휠 = 카드 줌 (커서 기준) ----------
  // preventDefault 필수: 브라우저 기본 스크롤/페이지 줌 방지
  stageWrap.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = 0.999 ** e.deltaY;
    zoomAtPoint(zoom * factor, e.clientX, e.clientY);
  }, { passive: false });

  // ---------- 팬: 빈 곳 드래그 또는 Alt/스페이스 드래그 ----------
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let panOriginX = 0, panOriginY = 0;
  let spaceDown = false;

  // 캔버스 위 마우스 다운
  canvas.on('mouse:down', (opt) => {
    const e = opt.e;
    // Alt 또는 Space 상태면 어떤 대상 위에서도 팬
    if (e.altKey || spaceDown) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = panX;
      panOriginY = panY;
      canvas.selection = false;
      canvas.discardActiveObject();
      updateSelectionUI();
      stageWrap.style.cursor = 'grabbing';
    }
    // 그 외 빈 곳 드래그는 Fabric이 마퀴 선택으로 처리
  });

  // stageWrap 자체에도 mousedown 등록: 캔버스 바깥(어두운 영역)에서 시작해도 팬
  stageWrap.addEventListener('mousedown', e => {
    if (e.target === stageWrap) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = panX;
      panOriginY = panY;
      stageWrap.style.cursor = 'grabbing';
    }
  });

  // mousemove / mouseup은 window에서 처리 (캔버스 밖으로 나가도 유지)
  window.addEventListener('mousemove', e => {
    if (!isPanning) return;
    panX = panOriginX + (e.clientX - panStartX);
    panY = panOriginY + (e.clientY - panStartY);
    applyViewToDOM();
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      stageWrap.style.cursor = spaceDown ? 'grab' : '';
    }
  });

  window.addEventListener('beforeunload', () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    saveToLocalStorage();
  });

  // ---------- 줌 컨트롤 ----------
  zoomRange.addEventListener('input', () => {
    setZoomCenter(parseInt(zoomRange.value, 10) / 100);
  });
  zoomInBtn.addEventListener('click', () => setZoomCenter(zoom * 1.2));
  zoomOutBtn.addEventListener('click', () => setZoomCenter(zoom / 1.2));
  fitViewBtn.addEventListener('click', fitView);

  // 배경색
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
    if (!obj || obj.layerType !== 'text') return;
    pushHistory();
  });

  // 외곽선
  strokeColorInput.addEventListener('input', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    obj.set('stroke', strokeColorInput.value);
    canvas.requestRenderAll();
  });
  strokeColorInput.addEventListener('change', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    pushHistory();
  });
  strokeWidthInput.addEventListener('input', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    const w = parseFloat(strokeWidthInput.value);
    obj.set('strokeWidth', isNaN(w) ? 0 : w);
    canvas.requestRenderAll();
  });
  strokeWidthInput.addEventListener('change', () => {
    const obj = canvas.getActiveObject();
    if (!obj || obj.layerType !== 'text') return;
    pushHistory();
  });

  // ---------- 내보내기 ----------
  // 뷰(zoom/pan)는 무시하고, 캔버스 내부 해상도 그대로 PNG 추출.
  // 캔버스 element의 CSS 체크무늬 배경은 일시적으로 흰색 처리 후 복원.
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

  // ---------- JSON 저장 ----------
saveJsonBtn.addEventListener('click', () => {
  const snap = snapshot();
  // 이미지는 저장하지 않음
  snap.objects.forEach(o => {
    if (o.type === 'image') delete o.src;
  });
  snap.hasImage = !!bgImage;
  snap.imageName = bgImage ? bgImage.name : null;
  snap.savedAt = new Date().toISOString();

  const blob = new Blob([JSON.stringify(snap, null, 2)], {
    type: 'application/json',
  });
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
    if (err) {
      showToast('불러오기 실패: ' + err);
      return;
    }
    await loadSnapshotWithImagePrompt(snap, '불러온 JSON');
  } catch (e) {
    console.warn(e);
    showToast('불러오기 실패: JSON 형식이 아닙니다.');
  }
});

// 스냅샷 검증
function validateSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return 'JSON 형식이 아닙니다.';
  if (typeof snap.ratio !== 'string' || !RATIO_VALUES[snap.ratio]) return 'ratio 값이 잘못되었습니다.';
  if (!Array.isArray(snap.objects)) return 'objects 배열이 없습니다.';
  if (typeof snap.canvasW !== 'number' || typeof snap.canvasH !== 'number') return '캔버스 크기 정보가 없습니다.';
  // 필수 필드 최소 검사
  for (const o of snap.objects) {
    if (o.type !== 'text' && o.type !== 'image') continue;
    if (o.type === 'text' && typeof o.text !== 'string') return '텍스트 객체 형식 오류.';
  }
  return null;
}

// 스냅샷 복원 + 이미지 재업로드 프롬프트
async function loadSnapshotWithImagePrompt(snap, sourceLabel) {
  // 이미지가 있었으면 재업로드 요청
  const hasImage = snap.hasImage || snap.objects.some(o => o.type === 'image');
  if (hasImage) {
    const ok = await openModal(
      sourceLabel + '에 이미지가 포함되어 있지 않습니다.\n' +
      '같은 이미지를 다시 업로드하면 편집 상태가 그대로 복원됩니다.\n' +
      '(취소하면 텍스트만 복원됩니다.)'
    );
    if (ok) {
      // 이미지 업로드를 기다리는 상태로 전환 후 종료
      pendingImageUpload = { snap: snap };
      showToast('이미지를 드롭하거나 선택하세요.', 'success');
      // 텍스트만이라도 먼저 복원해두기 (이미지 없이)
      const textOnly = JSON.parse(JSON.stringify(snap));
      textOnly.objects = textOnly.objects.filter(o => o.type !== 'image');
      await restoreSnapshot(textOnly);
      // 이미지 자리 표시 안 함 (재업로드 시 교체)
      return;
    }
  }
  // 이미지 없이 복원
  await restoreSnapshot(snap);
  showToast('불러왔습니다.', 'success');
}

let pendingImageUpload = null;

  // ---------- 리사이즈 ----------
  window.addEventListener('resize', fitView);

  // ---------- 초기화 ----------
    // ---------- 초기화 ----------
  function initEditor() {
    applyCanvasSize();
    refreshLayers();
    updateSelectionUI();
    updateHistoryUI();
    pushHistory();

    setTimeout(() => { renderMinimap(); }, 60);

    window.addEventListener('resize', () => {
      fitView();
      scheduleMinimap();
    });

    // 새로고침 후 임시저장 자동 복원
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) {
      try {
        const snap = JSON.parse(saved);
        const err = validateSnapshot(snap);
        if (!err) {
          if (snap.hasImage) {
            // 이미지는 재업로드 필요 → 안내만 (자동 복원 시엔 조용히)
            openModal('이전 작업이 임시저장되어 있습니다.\n이미지가 포함되어 있지 않으니 같은 이미지를 다시 업로드하면 복원됩니다.')
              .then((ok) => {
                if (!ok) {
                  // 취소 시 그냥 텍스트만 복원
                  const textOnly = JSON.parse(JSON.stringify(snap));
                  textOnly.objects = textOnly.objects.filter(o => o.type !== 'image');
                  restoreSnapshot(textOnly);
                } else {
                  pendingImageUpload = { snap: snap };
                  const textOnly = JSON.parse(JSON.stringify(snap));
                  textOnly.objects = textOnly.objects.filter(o => o.type !== 'image');
                  restoreSnapshot(textOnly);
                }
              });
          } else {
            restoreSnapshot(snap);
          }
        }
      } catch (e) {
        console.warn('임시저장 복원 실패:', e);
      }
    }
  }

  if (CUSTOM_FONTS.length === 0) {
    initEditor();
  } else {
    Promise.all(
      CUSTOM_FONTS.map((family) =>
        document.fonts.load(`16px "${family}"`).catch((err) => {
          console.warn('폰트 로드 실패:', family, err);
        })
      )
    ).then(() => {
      initEditor();
    });
  }

})();