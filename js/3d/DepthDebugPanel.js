//=============================================================================
// DepthDebugPanel.js - Depth Test 디버그 패널
//=============================================================================
// URL에 ?dev=true 시 활성화
// depthTest/depthWrite/alphaTest + ZLayer/drawZ 오프셋을 실시간 조절
// 의존: DevPanelUtils.js
//=============================================================================

(function() {
    // 전역 설정 (다른 파일에서 참조) — dev 모드 여부와 무관하게 항상 설정
    if (!window.DepthDebugConfig) {
        window.DepthDebugConfig = {
            zLayerStep: -0.01,
            drawZStep: -0.001,
            // 카테고리별 depthTest/depthWrite/alphaTest 토글
            tile:   { depthTest: true, depthWrite: true, alphaTest: true },
            sprite: { depthTest: true, depthWrite: true, alphaTest: true },
            water:  { depthTest: true, depthWrite: true, alphaTest: true },
            shadow: { depthTest: true, depthWrite: false, alphaTest: false },
        };
    }

    var STORAGE_KEY = 'depthDebugPanel';

    var SLIDER_PARAMS = [
        { key: 'zLayerStep', label: 'ZLayer Step', min: -2, max: 2, step: 0.001, def: -0.01 },
        { key: 'drawZStep',  label: 'DrawZ Step',  min: -1, max: 1, step: 0.0001, def: -0.001 },
    ];

    var CATEGORIES = [
        { key: 'tile',   label: 'Tile',   defDepthTest: true, defDepthWrite: true,  defAlphaTest: true },
        { key: 'sprite', label: 'Sprite', defDepthTest: true, defDepthWrite: true,  defAlphaTest: true },
        { key: 'water',  label: 'Water',  defDepthTest: true, defDepthWrite: true,  defAlphaTest: true },
        { key: 'shadow', label: 'Shadow', defDepthTest: true, defDepthWrite: false, defAlphaTest: false },
    ];

    // localStorage 저장/복원
    function saveToStorage() {
        var data = { sliders: {}, categories: {} };
        SLIDER_PARAMS.forEach(function(p) {
            data.sliders[p.key] = window.DepthDebugConfig[p.key];
        });
        CATEGORIES.forEach(function(c) {
            data.categories[c.key] = window.DepthDebugConfig[c.key];
        });
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
    }

    function loadFromStorage() {
        var raw;
        try { raw = localStorage.getItem(STORAGE_KEY); } catch(e) { return; }
        if (!raw) return;
        var data;
        try { data = JSON.parse(raw); } catch(e) { return; }
        if (data.sliders) {
            SLIDER_PARAMS.forEach(function(p) {
                if (data.sliders[p.key] !== undefined) {
                    window.DepthDebugConfig[p.key] = data.sliders[p.key];
                }
            });
        }
        if (data.categories) {
            CATEGORIES.forEach(function(c) {
                if (data.categories[c.key]) {
                    window.DepthDebugConfig[c.key] = data.categories[c.key];
                }
            });
        }
    }
    loadFromStorage();

    // dev 모드가 아니면 패널 UI는 생성하지 않음
    if (!(new URLSearchParams(window.location.search)).has('dev') && !window._forceDevPanel) return;

    var PANEL_ID = 'depthDebugPanel';
    var panel = null;
    var panelCtrl = null;
    var sliderEls = {};
    var checkboxEls = {};

    function updateSlider(key, val) {
        var el = sliderEls[key];
        if (!el) return;
        el.slider.value = val;
        if (el.valueEl) el.valueEl.textContent = formatVal(val);
    }

    function formatVal(val) {
        if (val === 0) return '0';
        var abs = Math.abs(val);
        if (abs < 0.01) return val.toFixed(4);
        if (abs < 0.1) return val.toFixed(3);
        return val.toFixed(3);
    }

    function createSliderRow(param) {
        var row = document.createElement('div');
        row.style.cssText = 'margin:3px 0;display:flex;align-items:center;gap:4px;';

        var label = document.createElement('span');
        label.textContent = param.label;
        label.style.cssText = 'flex:0 0 80px;font-size:10px;color:#aaa;';
        row.appendChild(label);

        var slider = document.createElement('input');
        slider.type = 'range';
        slider.min = param.min;
        slider.max = param.max;
        slider.step = param.step;
        slider.value = window.DepthDebugConfig[param.key];
        slider.style.cssText = 'flex:1;height:14px;cursor:pointer;accent-color:#4af;';
        row.appendChild(slider);

        var valEl = document.createElement('span');
        valEl.textContent = formatVal(window.DepthDebugConfig[param.key]);
        valEl.style.cssText = 'flex:0 0 50px;font-size:10px;color:#ff8;text-align:right;';
        row.appendChild(valEl);

        slider.addEventListener('input', function() {
            var val = parseFloat(slider.value);
            valEl.textContent = formatVal(val);
            window.DepthDebugConfig[param.key] = val;
            saveToStorage();
        });

        sliderEls[param.key] = { slider: slider, valueEl: valEl };
        return row;
    }

    function createCategoryRow(cat) {
        var row = document.createElement('div');
        row.style.cssText = 'margin:2px 0;display:flex;align-items:center;gap:6px;';

        var label = document.createElement('span');
        label.textContent = cat.label;
        label.style.cssText = 'flex:0 0 50px;font-size:10px;color:#aaa;';
        row.appendChild(label);

        var cfg = window.DepthDebugConfig[cat.key];
        var props = ['depthTest', 'depthWrite', 'alphaTest'];
        var shortLabels = ['dTest', 'dWrite', 'aTest'];

        props.forEach(function(prop, i) {
            var wrap = document.createElement('label');
            wrap.style.cssText = 'display:flex;align-items:center;gap:2px;cursor:pointer;';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!cfg[prop];
            cb.style.cssText = 'margin:0;cursor:pointer;width:12px;height:12px;';
            cb.addEventListener('change', function() {
                window.DepthDebugConfig[cat.key][prop] = cb.checked;
                saveToStorage();
            });

            var lbl = document.createElement('span');
            lbl.textContent = shortLabels[i];
            lbl.style.cssText = 'font-size:9px;color:#888;';

            wrap.appendChild(cb);
            wrap.appendChild(lbl);
            row.appendChild(wrap);

            if (!checkboxEls[cat.key]) checkboxEls[cat.key] = {};
            checkboxEls[cat.key][prop] = cb;
        });

        return row;
    }

    function createPanel() {
        if (panel) return;
        panel = document.createElement('div');
        panel.id = 'depth-debug-panel';
        panel.style.cssText = [
            'position:fixed', 'top:10px', 'left:10px', 'z-index:99998',
            'background:rgba(0,0,0,0.85)', 'color:#ddd',
            'font:11px/1.4 monospace', 'padding:6px 8px',
            'pointer-events:auto', 'user-select:none',
            'min-width:280px', 'max-width:360px',
            'border:1px solid #555', 'border-radius:4px'
        ].join(';');

        // 타이틀
        var titleBar = document.createElement('div');
        titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
        var titleText = document.createElement('span');
        titleText.textContent = 'Depth Debug';
        titleText.style.cssText = 'font-size:12px;font-weight:bold;color:#4af;flex:1;';
        titleBar.appendChild(titleText);
        panel.appendChild(titleBar);

        // 바디
        var body = document.createElement('div');

        // 슬라이더 섹션
        var sliderSection = document.createElement('div');
        sliderSection.style.cssText = 'margin-bottom:6px;';
        var sliderTitle = document.createElement('div');
        sliderTitle.textContent = '── Z Offsets ──';
        sliderTitle.style.cssText = 'color:#888;font-size:10px;margin-bottom:4px;';
        sliderSection.appendChild(sliderTitle);
        SLIDER_PARAMS.forEach(function(p) {
            sliderSection.appendChild(createSliderRow(p));
        });
        body.appendChild(sliderSection);

        // 카테고리 토글 섹션
        var catSection = document.createElement('div');
        // 헤더
        var catHeader = document.createElement('div');
        catHeader.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
        var catTitle = document.createElement('span');
        catTitle.textContent = '── Material ──';
        catTitle.style.cssText = 'color:#888;font-size:10px;';
        catHeader.appendChild(catTitle);
        catSection.appendChild(catHeader);

        // 컬럼 헤더
        var colHeader = document.createElement('div');
        colHeader.style.cssText = 'margin:0 0 2px;display:flex;align-items:center;gap:6px;';
        var spacer = document.createElement('span');
        spacer.style.cssText = 'flex:0 0 50px;';
        colHeader.appendChild(spacer);
        ['dTest', 'dWrite', 'aTest'].forEach(function(t) {
            var col = document.createElement('span');
            col.textContent = t;
            col.style.cssText = 'font-size:8px;color:#666;text-align:center;width:46px;';
            colHeader.appendChild(col);
        });
        catSection.appendChild(colHeader);

        CATEGORIES.forEach(function(c) {
            catSection.appendChild(createCategoryRow(c));
        });
        body.appendChild(catSection);

        // Reset 버튼
        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'margin-top:6px;display:flex;gap:4px;';
        var resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset All';
        resetBtn.style.cssText = 'flex:1;padding:2px 8px;background:#444;color:#ccc;border:1px solid #666;font:10px monospace;cursor:pointer;border-radius:2px;';
        resetBtn.addEventListener('click', function() {
            SLIDER_PARAMS.forEach(function(p) {
                window.DepthDebugConfig[p.key] = p.def;
                updateSlider(p.key, p.def);
            });
            CATEGORIES.forEach(function(c) {
                window.DepthDebugConfig[c.key] = {
                    depthTest: c.defDepthTest,
                    depthWrite: c.defDepthWrite,
                    alphaTest: c.defAlphaTest,
                };
                if (checkboxEls[c.key]) {
                    checkboxEls[c.key].depthTest.checked = c.defDepthTest;
                    checkboxEls[c.key].depthWrite.checked = c.defDepthWrite;
                    checkboxEls[c.key].alphaTest.checked = c.defAlphaTest;
                }
            });
            saveToStorage();
        });
        btnRow.appendChild(resetBtn);

        var copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy';
        copyBtn.style.cssText = 'flex:1;padding:2px 8px;background:#345;color:#ccc;border:1px solid #666;font:10px monospace;cursor:pointer;border-radius:2px;';
        copyBtn.addEventListener('click', function() {
            var cfg = window.DepthDebugConfig;
            var text = JSON.stringify({
                zLayerStep: cfg.zLayerStep,
                drawZStep: cfg.drawZStep,
                tile: cfg.tile,
                sprite: cfg.sprite,
                water: cfg.water,
                shadow: cfg.shadow,
            }, null, 2);
            navigator.clipboard.writeText(text).then(function() {
                copyBtn.textContent = 'Copied!';
                copyBtn.style.background = '#264';
                setTimeout(function() { copyBtn.textContent = 'Copy'; copyBtn.style.background = '#345'; }, 1200);
            }, function() {
                copyBtn.textContent = 'Failed';
                copyBtn.style.background = '#644';
                setTimeout(function() { copyBtn.textContent = 'Copy'; copyBtn.style.background = '#345'; }, 1200);
            });
        });
        btnRow.appendChild(copyBtn);
        body.appendChild(btnRow);

        panel.appendChild(body);
        document.body.appendChild(panel);

        // 드래그 + 접기
        if (window.DevPanelUtils) {
            panelCtrl = DevPanelUtils.makeDraggablePanel(panel, PANEL_ID, {
                defaultPosition: 'top-left',
                titleBar: titleBar,
                bodyEl: body,
                defaultCollapsed: false,
            });
        }
    }

    // window.onload 후 생성 (defer 스크립트 모두 실행 완료 보장)
    window.addEventListener('load', createPanel);
})();
