//=============================================================================
// ThreeTilemap.js - GPU-native tilemap rendering for Three.js backend
//=============================================================================
// ShaderTilemap의 addRect() API를 Three.js로 네이티브 구현.
// Canvas 2D 중간 단계 없이 타일을 직접 GPU 메시로 렌더링.
//
// 구조:
//   ThreeTilemapZLayer (ThreeContainer)
//     └── ThreeTilemapCompositeLayer
//           └── ThreeTilemapRectLayer (addRect 호출 수신)
//                 ├── 통합 메시 (DataArrayTexture, 모든 비물/비그림자 타일)
//                 ├── 그림자 메시 (단색 material)
//                 └── 물 메시 (ThreeWaterShader, kind별 분리)
//
// z-fighting 해결: 모든 setNumber의 타일 쿼드를 하나의 메시로 합침.
// 같은 위치의 쿼드는 동일 model matrix + 동일 vertex position → 동일 depth 보간.
//=============================================================================

// DataArrayTexture 상수: 모든 타일셋 레이어를 768×768로 패딩
var TILESET_TEX_SIZE = 768;
var TILESET_LAYER_COUNT = 9;  // A1~A5 + B~E

//=============================================================================
// ThreeTilemapRectLayer - 핵심 렌더링 클래스
// addRect()로 쿼드 데이터를 축적, syncTransform 시 메시 빌드
//=============================================================================

function ThreeTilemapRectLayer() {
    this._threeObj = new THREE.Group();
    this._threeObj._wrapper = this;

    this._x = 0;
    this._y = 0;
    this._scaleX = 1;
    this._scaleY = 1;
    this._rotation = 0;
    this._pivotX = 0;
    this._pivotY = 0;
    this._alpha = 1;
    this._visible = true;
    this._zIndex = 0;
    this.worldAlpha = 1;
    this.worldVisible = true;
    this.parent = null;
    this.children = [];
    this._filters = null;
    this._transformDirty = true;

    this.scale = { x: 1, y: 1 };
    this.pivot = { x: 0, y: 0 };

    // setNumber → rect data 배열 (-1 = 그림자, 0~8 = 타일셋)
    this._rectData = {};   // { setNumber: { positions: [], uvs: [], count: 0 } }
    this._bitmaps = [];    // 타일셋 텍스처 배열
    this._meshes = {};     // 물/그림자 메시 캐싱 (키: meshKey)
    this._needsRebuild = false;
    this._shadowColor = new Float32Array([0, 0, 0, 0.5]);

    // 애니메이션 오프셋 (ShaderTilemap._hackRenderer에서 설정)
    this._tileAnimX = 0;
    this._tileAnimY = 0;
    // 이전 프레임의 애니메이션 값 (변경 감지용)
    this._lastTileAnimX = 0;
    this._lastTileAnimY = 0;

    // animOffset 데이터 (setNumber별)
    this._animData = {};   // { setNumber: [] }  animX, animY per rect
    // A1 kind 데이터 (setNumber별)
    this._kindData = {};   // { setNumber: [] }  kind per rect (-1 = not A1)
    // 그리기 z 레이어 데이터 (setNumber별)
    this._drawZData = {};  // { setNumber: [] }  z layer per rect (0~3)
    this._currentDrawZ = 0;

    // DataArrayTexture (9 타일셋 → 768×768 패딩)
    this._arrayTexture = null;
    this._layerLoaded = null;
    this._layerImageVersions = null;
    this._offscreenCanvas = null;
    this._offscreenCtx = null;

    // 통합 메시 (모든 비물/비그림자 타일)
    this._unifiedMesh = null;
    this._unifiedRects = null;   // 빌드 시 rect 메타데이터 (애니메이션 UV 업데이트용)
    this._unifiedShaderRef = null; // onBeforeCompile shader 참조
}

// 1×1 더미 텍스처 (USE_MAP 활성화용, 공유)
ThreeTilemapRectLayer._dummyTexture = null;

Object.defineProperties(ThreeTilemapRectLayer.prototype, {
    x: {
        get: function() { return this._x; },
        set: function(v) { this._x = v; },
        configurable: true
    },
    y: {
        get: function() { return this._y; },
        set: function(v) { this._y = v; },
        configurable: true
    },
    alpha: {
        get: function() { return this._alpha; },
        set: function(v) { this._alpha = v; },
        configurable: true
    },
    visible: {
        get: function() { return this._visible; },
        set: function(v) { this._visible = v; this._threeObj.visible = v; },
        configurable: true
    },
    zIndex: {
        get: function() { return this._zIndex; },
        set: function(v) { this._zIndex = v; },
        configurable: true
    }
});

/**
 * 타일셋 텍스처 바인딩
 */
ThreeTilemapRectLayer.prototype.setBitmaps = function(bitmaps) {
    this._bitmaps = bitmaps || [];
    // 배열 텍스처 전체 무효화 (타일셋 변경 시)
    if (this._arrayTexture) {
        this._arrayTexture.image.data.fill(0);
        this._arrayTexture.needsUpdate = true;
    }
    if (this._layerLoaded) {
        this._layerLoaded.fill(false);
    }
    this._needsRebuild = true;
};

/**
 * 모든 쿼드 데이터 초기화
 */
ThreeTilemapRectLayer.prototype.clear = function() {
    for (var key in this._rectData) {
        this._rectData[key].count = 0;
    }
    for (var key in this._animData) {
        this._animData[key].length = 0;
    }
    for (var key in this._kindData) {
        this._kindData[key].length = 0;
    }
    for (var key in this._drawZData) {
        this._drawZData[key].length = 0;
    }
    this._unifiedRects = null;
    this._needsRebuild = true;
};

/**
 * 쿼드 추가 (ShaderTilemap API 호환)
 * @param {Number} setNumber - 타일셋 인덱스 (-1 = 그림자)
 * @param {Number} u - 소스 X (픽셀)
 * @param {Number} v - 소스 Y (픽셀)
 * @param {Number} x - 대상 X (픽셀)
 * @param {Number} y - 대상 Y (픽셀)
 * @param {Number} w - 너비
 * @param {Number} h - 높이
 * @param {Number} [animX=0] - 애니메이션 X 배율
 * @param {Number} [animY=0] - 애니메이션 Y 배율
 */
ThreeTilemapRectLayer.prototype.addRect = function(setNumber, u, v, x, y, w, h, animX, animY, a1Kind) {
    if (!this._rectData[setNumber]) {
        this._rectData[setNumber] = {
            positions: new Float32Array(1000 * 12),  // 1000 quads * 6 vertices * 2 components
            uvs: new Float32Array(1000 * 12),
            count: 0,
            capacity: 1000
        };
        this._animData[setNumber] = [];
        this._kindData[setNumber] = [];
        this._drawZData[setNumber] = [];
    }

    var data = this._rectData[setNumber];
    var idx = data.count;

    // 용량 확장
    if (idx >= data.capacity) {
        var newCapacity = data.capacity * 2;
        var newPositions = new Float32Array(newCapacity * 6 * 2);
        newPositions.set(data.positions);
        data.positions = newPositions;
        var newUvs = new Float32Array(newCapacity * 6 * 2);
        newUvs.set(data.uvs);
        data.uvs = newUvs;
        data.capacity = newCapacity;
    }

    // 6 vertices (2 triangles) 위치 데이터
    var pi = idx * 12; // 6 vertices * 2 components
    // Triangle 1: top-left, top-right, bottom-left
    data.positions[pi]     = x;
    data.positions[pi + 1] = y;
    data.positions[pi + 2] = x + w;
    data.positions[pi + 3] = y;
    data.positions[pi + 4] = x;
    data.positions[pi + 5] = y + h;
    // Triangle 2: top-right, bottom-right, bottom-left
    data.positions[pi + 6]  = x + w;
    data.positions[pi + 7]  = y;
    data.positions[pi + 8]  = x + w;
    data.positions[pi + 9]  = y + h;
    data.positions[pi + 10] = x;
    data.positions[pi + 11] = y + h;

    // UV 데이터 (픽셀 좌표, 나중에 정규화)
    data.uvs[pi]     = u;
    data.uvs[pi + 1] = v;
    data.uvs[pi + 2] = u + w;
    data.uvs[pi + 3] = v;
    data.uvs[pi + 4] = u;
    data.uvs[pi + 5] = v + h;
    data.uvs[pi + 6]  = u + w;
    data.uvs[pi + 7]  = v;
    data.uvs[pi + 8]  = u + w;
    data.uvs[pi + 9]  = v + h;
    data.uvs[pi + 10] = u;
    data.uvs[pi + 11] = v + h;

    // 애니메이션 오프셋
    this._animData[setNumber].push(animX || 0, animY || 0);
    // A1 kind 정보 (-1 = A1이 아님)
    this._kindData[setNumber].push(a1Kind != null ? a1Kind : -1);
    // 그리기 z 레이어 (0~3, _paintTiles에서 설정)
    this._drawZData[setNumber].push(this._currentDrawZ || 0);

    data.count++;
    this._needsRebuild = true;
};

//=============================================================================
// DataArrayTexture 관리
//=============================================================================

/**
 * bitmap에서 Three.js 텍스처 추출
 */
ThreeTilemapRectLayer.prototype._extractThreeTexture = function(bmp) {
    if (!bmp) return null;
    if (bmp.baseTexture && bmp.baseTexture._threeTexture) {
        return bmp.baseTexture._threeTexture;
    } else if (bmp._threeTexture) {
        return bmp._threeTexture;
    } else if (bmp instanceof THREE.Texture) {
        return bmp;
    }
    return null;
};

/**
 * 이미지를 DataArrayTexture의 특정 레이어에 복사
 */
ThreeTilemapRectLayer.prototype._copyImageToLayer = function(img, layerIndex) {
    if (!this._offscreenCanvas) {
        this._offscreenCanvas = document.createElement('canvas');
        this._offscreenCanvas.width = TILESET_TEX_SIZE;
        this._offscreenCanvas.height = TILESET_TEX_SIZE;
        this._offscreenCtx = this._offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }

    var ctx = this._offscreenCtx;
    ctx.clearRect(0, 0, TILESET_TEX_SIZE, TILESET_TEX_SIZE);
    ctx.drawImage(img, 0, 0);
    var imageData = ctx.getImageData(0, 0, TILESET_TEX_SIZE, TILESET_TEX_SIZE);

    var layerSize = TILESET_TEX_SIZE * TILESET_TEX_SIZE * 4;
    this._arrayTexture.image.data.set(imageData.data, layerIndex * layerSize);
};

/**
 * DataArrayTexture 생성 및 비트맵 로딩 체크
 * 매 프레임 호출되어 새로 로드된 비트맵을 감지하고 해당 레이어 갱신
 */
ThreeTilemapRectLayer.prototype._ensureArrayTexture = function() {
    if (!this._arrayTexture) {
        var data = new Uint8Array(TILESET_TEX_SIZE * TILESET_TEX_SIZE * TILESET_LAYER_COUNT * 4);
        this._arrayTexture = new THREE.DataArrayTexture(data, TILESET_TEX_SIZE, TILESET_TEX_SIZE, TILESET_LAYER_COUNT);
        this._arrayTexture.minFilter = THREE.NearestFilter;
        this._arrayTexture.magFilter = THREE.NearestFilter;
        this._arrayTexture.generateMipmaps = false;
        this._arrayTexture.needsUpdate = true;
        this._layerLoaded = new Array(TILESET_LAYER_COUNT).fill(false);
        this._layerImageVersions = new Array(TILESET_LAYER_COUNT).fill(0);
    }

    var updated = false;
    for (var i = 0; i < TILESET_LAYER_COUNT; i++) {
        if (i >= this._bitmaps.length || !this._bitmaps[i]) continue;

        var tex = this._extractThreeTexture(this._bitmaps[i]);
        if (!tex || !tex.image || !tex.image.width || !tex.image.height) continue;

        var version = tex.version || 0;
        if (this._layerLoaded[i] && this._layerImageVersions[i] === version) continue;

        this._copyImageToLayer(tex.image, i);
        this._layerLoaded[i] = true;
        this._layerImageVersions[i] = version;
        updated = true;
    }

    if (updated) {
        this._arrayTexture.needsUpdate = true;
    }

    return this._arrayTexture;
};

//=============================================================================
// 통합 메시 Material (onBeforeCompile로 sampler2DArray 주입)
//=============================================================================

/**
 * onBeforeCompile 셰이더 수정: sampler2D map → sampler2DArray uTilesets
 */
ThreeTilemapRectLayer.prototype._injectArrayTextureShader = function(shader) {
    shader.uniforms.uTilesets = { value: this._arrayTexture };
    this._unifiedShaderRef = shader;

    // Vertex: add layer attribute and varying
    shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nattribute float aTextureLayer;\nvarying float vTextureLayer;'
    );
    shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvTextureLayer = aTextureLayer;'
    );

    // Fragment: replace map declaration and sampling with array texture
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_pars_fragment>',
        'uniform sampler2DArray uTilesets;\nvarying float vTextureLayer;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#ifdef USE_MAP\n' +
        '  vec4 sampledDiffuseColor = texture2D(uTilesets, vec3(vMapUv, vTextureLayer));\n' +
        '  diffuseColor *= sampledDiffuseColor;\n' +
        '#endif'
    );
};

/**
 * 통합 메시용 Material 생성
 */
ThreeTilemapRectLayer.prototype._createUnifiedMaterial = function(is3D, needsPhong) {
    var self = this;

    // 공유 더미 텍스처 (USE_MAP 활성화용)
    if (!ThreeTilemapRectLayer._dummyTexture) {
        ThreeTilemapRectLayer._dummyTexture = new THREE.DataTexture(
            new Uint8Array([255, 255, 255, 255]), 1, 1
        );
        ThreeTilemapRectLayer._dummyTexture.needsUpdate = true;
    }

    var matOpts = {
        map: ThreeTilemapRectLayer._dummyTexture,
        side: THREE.DoubleSide,
    };

    if (is3D) {
        matOpts.transparent = false;
        matOpts.alphaTest = 0.5;
        matOpts.depthTest = true;
        matOpts.depthWrite = true;
    } else {
        matOpts.transparent = true;
        matOpts.depthTest = false;
        matOpts.depthWrite = false;
    }

    var material;
    if (needsPhong) {
        matOpts.emissive = new THREE.Color(0x000000);
        matOpts.specular = new THREE.Color(0x000000);
        matOpts.shininess = 0;
        material = new THREE.MeshPhongMaterial(matOpts);
    } else {
        material = new THREE.MeshBasicMaterial(matOpts);
    }

    material.onBeforeCompile = function(shader) {
        self._injectArrayTextureShader(shader);
    };

    material.customProgramCacheKey = function() {
        return 'unified-tile-' + (needsPhong ? 'phong' : 'basic');
    };

    material.userData.isUnifiedMaterial = true;
    return material;
};

/**
 * 통합 메시 customDepthMaterial 생성 (그림자 캐스팅용)
 */
ThreeTilemapRectLayer.prototype._createUnifiedDepthMaterial = function() {
    var self = this;
    var depthMat = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: ThreeTilemapRectLayer._dummyTexture,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
    });

    depthMat.onBeforeCompile = function(shader) {
        self._injectArrayTextureShader(shader);
    };

    depthMat.customProgramCacheKey = function() {
        return 'unified-tile-depth';
    };

    return depthMat;
};

//=============================================================================
// BufferAttribute 헬퍼
//=============================================================================

ThreeTilemapRectLayer.prototype._updateBufferAttribute = function(geometry, name, array, itemSize) {
    var attr = geometry.attributes[name];
    if (attr && attr.array.length === array.length) {
        attr.array.set(array);
        attr.needsUpdate = true;
    } else {
        geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
    }
};

//=============================================================================
// 메시 빌드
//=============================================================================

/**
 * 축적된 쿼드 데이터로 Three.js 메시 빌드
 */
ThreeTilemapRectLayer.prototype._flush = function() {
    var tileAnimX = this._tileAnimX;
    var tileAnimY = this._tileAnimY;
    var animChanged = (tileAnimX !== this._lastTileAnimX || tileAnimY !== this._lastTileAnimY);

    // 물 메시 uTime은 매 프레임 갱신 (wave 연속 애니메이션)
    if (typeof ThreeWaterShader !== 'undefined') {
        for (var wk in this._meshes) {
            var wm = this._meshes[wk];
            if (wm && wm.userData && wm.userData.isWaterMesh) {
                ThreeWaterShader.updateTime(wm, ThreeWaterShader._time);
            }
        }
    }

    // 매 프레임 비트맵 로딩 체크 (비동기 로드 완료 감지)
    this._ensureArrayTexture();

    // 배열 텍스처 uniform 참조 갱신 (텍스처 재생성 시)
    if (this._unifiedShaderRef && this._unifiedShaderRef.uniforms.uTilesets) {
        this._unifiedShaderRef.uniforms.uTilesets.value = this._arrayTexture;
    }

    if (!this._needsRebuild && animChanged) {
        // 빠른 경로: 애니메이션 오프셋만 변경 → UV만 갱신
        this._lastTileAnimX = tileAnimX;
        this._lastTileAnimY = tileAnimY;
        this._updateAnimUVs(tileAnimX, tileAnimY);
        return;
    }

    if (!this._needsRebuild) return;
    this._needsRebuild = false;
    this._lastTileAnimX = tileAnimX;
    this._lastTileAnimY = tileAnimY;

    // 기존 메시 숨기기
    for (var key in this._meshes) {
        this._meshes[key].visible = false;
    }
    if (this._unifiedMesh) {
        this._unifiedMesh.visible = false;
    }

    // 모든 rect를 분류: 통합 메시 / 물 / 그림자
    var allRects = [];           // 통합 메시용 (비물, 비그림자)
    var hasWaterBySet = {};      // { setNumber(string): true }

    for (var setNumber in this._rectData) {
        var data = this._rectData[setNumber];
        if (data.count === 0) continue;

        var sn = parseInt(setNumber);

        // 그림자 → 별도 메시
        if (sn === -1) {
            this._buildShadowMesh(data);
            continue;
        }

        var animOffsets = this._animData[setNumber] || [];
        var kindArr = this._kindData[setNumber] || [];
        var drawZArr = this._drawZData[setNumber] || [];

        for (var ci = 0; ci < data.count; ci++) {
            var cAnimX = animOffsets[ci * 2] || 0;
            var cAnimY = animOffsets[ci * 2 + 1] || 0;

            // 물 rect 체크
            if (sn === 0 && typeof ThreeWaterShader !== 'undefined') {
                var ck = kindArr[ci] != null ? kindArr[ci] : -1;
                if (ThreeWaterShader.isWaterRect(cAnimX, cAnimY) &&
                    (ck < 0 || ThreeWaterShader.isKindEnabled(ck))) {
                    hasWaterBySet[setNumber] = true;
                    continue;
                }
            }

            allRects.push({
                setNumber: sn,
                setNumberStr: setNumber,
                index: ci,
                drawZ: drawZArr[ci] || 0
            });
        }
    }

    // drawZ 기준 오름차순 정렬 (같은 drawZ 내 원래 순서 유지 — stable sort)
    allRects.sort(function(a, b) { return a.drawZ - b.drawZ; });

    // 통합 메시 빌드
    this._buildUnifiedMesh(allRects, tileAnimX, tileAnimY);

    // 물 메시 빌드 (개별 텍스처 사용, 기존 방식 유지)
    for (var wSn in hasWaterBySet) {
        var wData = this._rectData[wSn];
        var wAnimOffsets = this._animData[wSn] || [];
        var wTex = this._extractThreeTexture(this._bitmaps[parseInt(wSn)]);
        if (!wTex || !wTex.image) continue;
        var texW = wTex.image.width || 1;
        var texH = wTex.image.height || 1;
        if (wTex.minFilter !== THREE.NearestFilter) {
            wTex.minFilter = THREE.NearestFilter;
            wTex.magFilter = THREE.NearestFilter;
            wTex.generateMipmaps = false;
            wTex.anisotropy = 1;
            wTex.needsUpdate = true;
        }
        this._buildWaterMesh(wSn, wData, wAnimOffsets, wTex, texW, texH, tileAnimX, tileAnimY);
    }
};

/**
 * 통합 메시 빌드 — 모든 비물/비그림자 타일을 하나의 메시로
 * DataArrayTexture + sampler2DArray로 setNumber별 텍스처 선택
 */
ThreeTilemapRectLayer.prototype._buildUnifiedMesh = function(allRects, tileAnimX, tileAnimY) {
    var count = allRects.length;
    this._unifiedRects = allRects;

    if (count === 0) {
        if (this._unifiedMesh) this._unifiedMesh.visible = false;
        return;
    }

    var vertCount = count * 6;
    var posArray = new Float32Array(vertCount * 3);
    var normalArray = new Float32Array(vertCount * 3);
    var uvArray = new Float32Array(vertCount * 2);
    var layerArray = new Float32Array(vertCount);

    var is3DMode = typeof ConfigManager !== 'undefined' && ConfigManager.mode3d;
    var elevationEnabled = !is3DMode && $dataMap && $dataMap.tileLayerElevation;

    var maxDrawZ = 0;

    for (var ri = 0; ri < count; ri++) {
        var rect = allRects[ri];
        var data = this._rectData[rect.setNumberStr];
        var animOffsets = this._animData[rect.setNumberStr] || [];
        var drawZArr = this._drawZData[rect.setNumberStr] || [];

        var i = rect.index;
        var srcOff = i * 12;
        var posOff = ri * 18;
        var uvOff = ri * 12;
        var layerOff = ri * 6;

        var ax = (animOffsets[i * 2] || 0) * tileAnimX;
        var ay = (animOffsets[i * 2 + 1] || 0) * tileAnimY;

        var drawZ = drawZArr[i] || 0;
        if (drawZ > maxDrawZ) maxDrawZ = drawZ;
        var zOffset = elevationEnabled ? -drawZ * 0.01 : 0;

        var sn = rect.setNumber;

        for (var j = 0; j < 6; j++) {
            posArray[posOff + j * 3]     = data.positions[srcOff + j * 2];
            posArray[posOff + j * 3 + 1] = data.positions[srcOff + j * 2 + 1];
            posArray[posOff + j * 3 + 2] = zOffset;

            normalArray[posOff + j * 3]     = 0;
            normalArray[posOff + j * 3 + 1] = 0;
            normalArray[posOff + j * 3 + 2] = -1;

            // UV: 픽셀 좌표 → TILESET_TEX_SIZE 기준 정규화
            // DataArrayTexture flipY=false: UV.y = py / size (Y 반전 없음)
            uvArray[uvOff + j * 2]     = (data.uvs[srcOff + j * 2] + ax) / TILESET_TEX_SIZE;
            uvArray[uvOff + j * 2 + 1] = (data.uvs[srcOff + j * 2 + 1] + ay) / TILESET_TEX_SIZE;

            layerArray[layerOff + j] = sn;
        }
    }

    var needsPhong = (window.ShadowLight && window.ShadowLight._active);

    if (this._unifiedMesh) {
        // 기존 메시 geometry 갱신
        var geometry = this._unifiedMesh.geometry;
        this._updateBufferAttribute(geometry, 'position', posArray, 3);
        this._updateBufferAttribute(geometry, 'normal', normalArray, 3);
        this._updateBufferAttribute(geometry, 'uv', uvArray, 2);
        this._updateBufferAttribute(geometry, 'aTextureLayer', layerArray, 1);

        // material 타입 전환 체크
        this._updateUnifiedMaterial(this._unifiedMesh, needsPhong, is3DMode);

        this._unifiedMesh.visible = true;
    } else {
        // 최초 생성
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
        geometry.setAttribute('aTextureLayer', new THREE.BufferAttribute(layerArray, 1));

        var material = this._createUnifiedMaterial(is3DMode, needsPhong);

        this._unifiedMesh = new THREE.Mesh(geometry, material);
        this._unifiedMesh.frustumCulled = false;

        // 3D 모드: upper layer (z=4) 타일에 polygonOffset 적용
        var parentZLayer = this.parent && this.parent.parent;
        if (is3DMode && parentZLayer && parentZLayer.z === 4) {
            material.polygonOffset = true;
            material.polygonOffsetFactor = -1;
            material.polygonOffsetUnits = -1;
        }

        // ShadowLight 활성 시 그림자 수신/캐스팅
        if (window.ShadowLight && window.ShadowLight._active) {
            this._unifiedMesh.receiveShadow = true;
            if (parentZLayer && parentZLayer.z === 4) {
                this._unifiedMesh.castShadow = true;
                this._unifiedMesh.customDepthMaterial = this._createUnifiedDepthMaterial();
            }
        }

        this._threeObj.add(this._unifiedMesh);
    }

    this._unifiedMesh.userData.maxDrawZ = maxDrawZ;
};

/**
 * 통합 메시 material 갱신 (Basic ↔ Phong, 2D ↔ 3D 전환)
 */
ThreeTilemapRectLayer.prototype._updateUnifiedMaterial = function(mesh, needsPhong, is3D) {
    var mat = mesh.material;
    var isPhong = mat.isMeshPhongMaterial;

    // material 타입 변경 필요 시 재생성
    if (needsPhong && !isPhong) {
        mat.dispose();
        mesh.material = this._createUnifiedMaterial(is3D, true);
        this._applyUnifiedMeshExtras(mesh, is3D);
        return;
    }
    if (!needsPhong && isPhong) {
        mat.dispose();
        mesh.material = this._createUnifiedMaterial(is3D, false);
        this._applyUnifiedMeshExtras(mesh, is3D);
        return;
    }

    // depth 설정 갱신
    if (is3D) {
        if (!mat.depthTest || !mat.depthWrite) {
            mat.depthTest = true;
            mat.depthWrite = true;
            mat.transparent = false;
            mat.alphaTest = 0.5;
            mat.needsUpdate = true;
        }
    } else {
        if (mat.depthTest || mat.depthWrite) {
            mat.depthTest = false;
            mat.depthWrite = false;
            mat.transparent = true;
            mat.alphaTest = 0;
            mat.needsUpdate = true;
        }
    }

    // polygonOffset (upper layer)
    var parentZLayer = this.parent && this.parent.parent;
    if (is3D && parentZLayer && parentZLayer.z === 4) {
        if (!mat.polygonOffset) {
            mat.polygonOffset = true;
            mat.polygonOffsetFactor = -1;
            mat.polygonOffsetUnits = -1;
            mat.needsUpdate = true;
        }
    }

    // ShadowLight 상태 갱신
    if (window.ShadowLight && window.ShadowLight._active) {
        mesh.receiveShadow = true;
        if (parentZLayer && parentZLayer.z === 4 && !mesh.castShadow) {
            mesh.castShadow = true;
            mesh.customDepthMaterial = this._createUnifiedDepthMaterial();
        }
    }
};

/**
 * 통합 메시 extras (polygonOffset, shadow) 적용
 */
ThreeTilemapRectLayer.prototype._applyUnifiedMeshExtras = function(mesh, is3D) {
    var parentZLayer = this.parent && this.parent.parent;
    if (is3D && parentZLayer && parentZLayer.z === 4) {
        mesh.material.polygonOffset = true;
        mesh.material.polygonOffsetFactor = -1;
        mesh.material.polygonOffsetUnits = -1;
    }
    if (window.ShadowLight && window.ShadowLight._active) {
        mesh.receiveShadow = true;
        if (parentZLayer && parentZLayer.z === 4) {
            mesh.castShadow = true;
            mesh.customDepthMaterial = this._createUnifiedDepthMaterial();
        }
    }
};

/**
 * 그림자 메시 빌드 (단색 MeshBasicMaterial, 별도 관리)
 */
ThreeTilemapRectLayer.prototype._buildShadowMesh = function(data) {
    var drawZArr = this._drawZData['-1'] || [];
    var vertCount = data.count * 6;
    var posArray = new Float32Array(vertCount * 3);

    var is3DMode = typeof ConfigManager !== 'undefined' && ConfigManager.mode3d;
    var elevationEnabled = !is3DMode && $dataMap && $dataMap.tileLayerElevation;

    for (var i = 0; i < data.count; i++) {
        var srcOff = i * 12;
        var posOff = i * 18;
        var drawZ = drawZArr[i] || 0;
        var zOffset = elevationEnabled ? -drawZ * 0.01 : 0;

        for (var j = 0; j < 6; j++) {
            posArray[posOff + j * 3]     = data.positions[srcOff + j * 2];
            posArray[posOff + j * 3 + 1] = data.positions[srcOff + j * 2 + 1];
            posArray[posOff + j * 3 + 2] = zOffset;
        }
    }

    var mesh = this._meshes['-1'];
    if (mesh) {
        this._updateBufferAttribute(mesh.geometry, 'position', posArray, 3);
        // depth 설정 갱신
        if (is3DMode && !mesh.material.depthTest) {
            mesh.material.depthTest = true;
            mesh.material.needsUpdate = true;
        } else if (!is3DMode && mesh.material.depthTest) {
            mesh.material.depthTest = false;
            mesh.material.needsUpdate = true;
        }
        mesh.visible = true;
    } else {
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

        var sc = this._shadowColor;
        var material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(sc[0], sc[1], sc[2]),
            transparent: true, opacity: sc[3],
            depthTest: is3DMode, depthWrite: false, side: THREE.DoubleSide,
        });

        mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        this._meshes['-1'] = mesh;
        this._threeObj.add(mesh);
    }

    mesh.userData.maxDrawZ = 0;
};

/**
 * 물 타일 메시 빌드 (wave UV 왜곡 셰이더 적용)
 */
ThreeTilemapRectLayer.prototype._buildWaterMesh = function(setNumber, data, animOffsets,
        texture, texW, texH, tileAnimX, tileAnimY) {
    // kind별로 그룹핑하여 분리
    var kindGroups = {};  // { 'water_K': { indices: [], isWaterfall: false, kinds: [K] } }
    var kindArr = this._kindData[setNumber] || [];

    for (var ci = 0; ci < data.count; ci++) {
        var cAnimX = animOffsets[ci * 2] || 0;
        var cAnimY = animOffsets[ci * 2 + 1] || 0;
        if (!ThreeWaterShader.isWaterRect(cAnimX, cAnimY)) continue;

        // enabled=false인 kind는 물 셰이더 제외 (통합 메시로 렌더)
        var kind = kindArr[ci] != null ? kindArr[ci] : -1;
        if (kind >= 0 && !ThreeWaterShader.isKindEnabled(kind)) continue;

        var isWaterfall = ThreeWaterShader.isWaterfallRect(cAnimX, cAnimY);
        var groupKey = (isWaterfall ? 'wf' : 'w') + '_' + kind;

        if (!kindGroups[groupKey]) {
            kindGroups[groupKey] = { indices: [], isWaterfall: isWaterfall, kinds: kind >= 0 ? [kind] : [] };
        }
        kindGroups[groupKey].indices.push(ci);
        if (kind >= 0 && kindGroups[groupKey].kinds.indexOf(kind) < 0) {
            kindGroups[groupKey].kinds.push(kind);
        }
    }

    for (var gk in kindGroups) {
        var group = kindGroups[gk];
        if (group.indices.length > 0) {
            this._buildWaterTypeMesh(setNumber, setNumber + '_' + gk, group.indices, data, animOffsets,
                                      texture, texW, texH, tileAnimX, tileAnimY,
                                      group.isWaterfall, group.kinds);
        }
    }
};

/**
 * 물/폭포 타일 메시 빌드 (공통)
 */
ThreeTilemapRectLayer.prototype._buildWaterTypeMesh = function(setNumber, meshKey, indices, data, animOffsets,
        texture, texW, texH, tileAnimX, tileAnimY, isWaterfall, a1Kinds) {
    var count = indices.length;
    var vertCount = count * 6;
    var posArray = new Float32Array(vertCount * 3);
    var normalArray = new Float32Array(vertCount * 3);
    var uvArray = new Float32Array(vertCount * 2);
    var uvBoundsArray = new Float32Array(vertCount * 4); // vec4(uMin, vMin, uMax, vMax)

    for (var ni = 0; ni < count; ni++) {
        var i = indices[ni];
        var srcOff = i * 12;
        var posOff = ni * 18;
        var uvOff = ni * 12;
        var boundsOff = ni * 24; // 6 verts * 4 components

        var ax = (animOffsets[i * 2] || 0) * tileAnimX;
        var ay = (animOffsets[i * 2 + 1] || 0) * tileAnimY;

        // 쿼드의 UV 바운드 계산 (6개 버텍스 중 min/max)
        var uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
        for (var j = 0; j < 6; j++) {
            var u = (data.uvs[srcOff + j * 2] + ax) / texW;
            var v = 1.0 - (data.uvs[srcOff + j * 2 + 1] + ay) / texH;
            uvArray[uvOff + j * 2] = u;
            uvArray[uvOff + j * 2 + 1] = v;
            if (u < uMin) uMin = u;
            if (u > uMax) uMax = u;
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
        }
        // 텍셀 절반만큼 안쪽으로 수축하여 인접 타일 샘플링 방지
        var halfTexelU = 0.5 / texW;
        var halfTexelV = 0.5 / texH;
        uMin += halfTexelU;
        uMax -= halfTexelU;
        vMin += halfTexelV;
        vMax -= halfTexelV;
        // 물 타일은 drawZ 기반 z 오프셋 적용 (높은 drawZ가 카메라에 더 가깝도록 음수)
        var drawZArr = this._drawZData[setNumber] || [];
        var drawZ = drawZArr[i] || 0;
        var elevationEnabled = $dataMap && $dataMap.tileLayerElevation;
        var zOffset = elevationEnabled ? -drawZ * 0.01 : 0;
        for (var j = 0; j < 6; j++) {
            posArray[posOff + j * 3]     = data.positions[srcOff + j * 2];
            posArray[posOff + j * 3 + 1] = data.positions[srcOff + j * 2 + 1];
            posArray[posOff + j * 3 + 2] = zOffset;

            normalArray[posOff + j * 3]     = 0;
            normalArray[posOff + j * 3 + 1] = 0;
            normalArray[posOff + j * 3 + 2] = -1;

            uvBoundsArray[boundsOff + j * 4]     = uMin;
            uvBoundsArray[boundsOff + j * 4 + 1] = vMin;
            uvBoundsArray[boundsOff + j * 4 + 2] = uMax;
            uvBoundsArray[boundsOff + j * 4 + 3] = vMax;
        }
    }

    var needsPhong = (window.ShadowLight && window.ShadowLight._active);
    var mesh = this._meshes[meshKey];
    // kind별 설정 조회
    var kindSettings = null;
    if (a1Kinds && a1Kinds.length > 0 && a1Kinds[0] >= 0) {
        kindSettings = ThreeWaterShader.getUniformsForKind(a1Kinds[0]);
    }

    if (mesh) {
        var geometry = mesh.geometry;
        // geometry attribute 갱신
        this._updateBufferAttribute(geometry, 'position', posArray, 3);
        this._updateBufferAttribute(geometry, 'normal', normalArray, 3);
        this._updateBufferAttribute(geometry, 'uv', uvArray, 2);
        this._updateBufferAttribute(geometry, 'aUvBounds', uvBoundsArray, 4);

        // material 타입 전환 (ShadowLight 상태에 따라)
        var isPhong = mesh.material.isMeshPhongMaterial;
        var isShader = mesh.material.isShaderMaterial;
        if (needsPhong && !isPhong) {
            mesh.material.dispose();
            var mat = new THREE.MeshPhongMaterial({
                map: texture, transparent: true, depthTest: true, depthWrite: false,
                side: THREE.DoubleSide,
                emissive: new THREE.Color(0x000000),
                specular: new THREE.Color(0x000000), shininess: 0,
            });
            ThreeWaterShader.applyToPhongMaterial(mat, isWaterfall, kindSettings);
            mesh.material = mat;
            mesh.material.needsUpdate = true;
        } else if (!needsPhong && (isPhong || !isShader)) {
            mesh.material.dispose();
            mesh.material = ThreeWaterShader.createStandaloneMaterial(texture, isWaterfall, kindSettings);
            mesh.material.needsUpdate = true;
        }

        mesh.visible = true;
    } else {
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
        geometry.setAttribute('aUvBounds', new THREE.BufferAttribute(uvBoundsArray, 4));

        var material;
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.anisotropy = 1;

        if (needsPhong) {
            material = new THREE.MeshPhongMaterial({
                map: texture, transparent: true, depthTest: true, depthWrite: false,
                side: THREE.DoubleSide,
                emissive: new THREE.Color(0x000000),
                specular: new THREE.Color(0x000000), shininess: 0,
            });
            ThreeWaterShader.applyToPhongMaterial(material, isWaterfall, kindSettings);
        } else {
            material = ThreeWaterShader.createStandaloneMaterial(texture, isWaterfall, kindSettings);
        }

        mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = -1;  // 물은 다른 타일보다 먼저 렌더 (투명도 때문)
        // 물 타일은 receiveShadow 비활성 (shadow acne로 검은 구멍 아티팩트 방지)
        this._meshes[meshKey] = mesh;
        this._threeObj.add(mesh);
    }

    // 텍스처 교체
    if (mesh.material.isShaderMaterial) {
        if (mesh.material.uniforms.map && mesh.material.uniforms.map.value !== texture) {
            mesh.material.uniforms.map.value = texture;
            mesh.material.needsUpdate = true;
        }
    } else if (mesh.material.map !== texture) {
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.anisotropy = 1;
        mesh.material.map = texture;
        mesh.material.needsUpdate = true;
    }

    // uTime uniform 업데이트
    ThreeWaterShader.updateTime(mesh, ThreeWaterShader._time);
    // 물 메시 키 저장 (renderLoop에서 time 업데이트용)
    mesh.userData.isWaterMesh = true;
    mesh.userData.isWaterfall = isWaterfall;
    mesh.userData.a1Kinds = a1Kinds || [];
    ThreeWaterShader._hasWaterMesh = true;
};

//=============================================================================
// 애니메이션 UV 갱신
//=============================================================================

/**
 * 애니메이션 오프셋 변경 시 UV attribute만 갱신 (전체 재빌드 없이)
 */
ThreeTilemapRectLayer.prototype._updateAnimUVs = function(tileAnimX, tileAnimY) {
    // --- 통합 메시 UV 갱신 ---
    if (this._unifiedMesh && this._unifiedMesh.visible && this._unifiedRects) {
        var uvAttr = this._unifiedMesh.geometry.attributes.uv;
        if (uvAttr) {
            var uvArray = uvAttr.array;
            var rects = this._unifiedRects;

            for (var ri = 0; ri < rects.length; ri++) {
                var rect = rects[ri];
                var data = this._rectData[rect.setNumberStr];
                var animOffsets = this._animData[rect.setNumberStr] || [];
                var i = rect.index;
                var srcOff = i * 12;
                var uvOff = ri * 12;

                var ax = (animOffsets[i * 2] || 0) * tileAnimX;
                var ay = (animOffsets[i * 2 + 1] || 0) * tileAnimY;

                for (var j = 0; j < 6; j++) {
                    uvArray[uvOff + j * 2]     = (data.uvs[srcOff + j * 2] + ax) / TILESET_TEX_SIZE;
                    uvArray[uvOff + j * 2 + 1] = (data.uvs[srcOff + j * 2 + 1] + ay) / TILESET_TEX_SIZE;
                }
            }
            uvAttr.needsUpdate = true;
        }
    }

    // --- 물 메시 UV 갱신 (기존 로직 유지, 개별 텍스처 사용) ---
    for (var setNumber in this._rectData) {
        var sn = parseInt(setNumber);
        if (sn !== 0) continue; // 물은 setNumber=0만
        if (typeof ThreeWaterShader === 'undefined') continue;

        var data = this._rectData[setNumber];
        if (data.count === 0) continue;

        var animOffsets = this._animData[setNumber] || [];
        var kindArr = this._kindData[setNumber] || [];

        // 물 rect 유무 확인
        var hasWater = false;
        for (var ci = 0; ci < data.count; ci++) {
            var ck = kindArr[ci] != null ? kindArr[ci] : -1;
            if (ThreeWaterShader.isWaterRect(animOffsets[ci * 2] || 0, animOffsets[ci * 2 + 1] || 0) &&
                (ck < 0 || ThreeWaterShader.isKindEnabled(ck))) {
                hasWater = true;
                break;
            }
        }
        if (!hasWater) continue;

        // 물 메시 텍스처 크기 가져오기
        var texW = 1, texH = 1;

        // 물 메시 UV 업데이트 (kind별 분리된 메시)
        for (var mkey in this._meshes) {
            var prefix = setNumber + '_';
            if (mkey.indexOf(prefix + 'w_') !== 0 && mkey.indexOf(prefix + 'wf_') !== 0) continue;
            var wMesh = this._meshes[mkey];
            if (!wMesh || !wMesh.geometry) continue;
            var wUvAttr = wMesh.geometry.attributes.uv;
            if (!wUvAttr) continue;

            var wTex = wMesh.material.map || (wMesh.material.uniforms && wMesh.material.uniforms.map && wMesh.material.uniforms.map.value);
            if (wTex && wTex.image) {
                texW = wTex.image.width || 1;
                texH = wTex.image.height || 1;
            }

            var meshKinds = wMesh.userData.a1Kinds || [];
            var meshIsWF = wMesh.userData.isWaterfall;
            var wUvArray = wUvAttr.array;
            var wBoundsAttr = wMesh.geometry.attributes.aUvBounds;
            var wBoundsArray = wBoundsAttr ? wBoundsAttr.array : null;
            var halfTexelU = 0.5 / texW;
            var halfTexelV = 0.5 / texH;
            var wi = 0;
            for (var i = 0; i < data.count; i++) {
                var cAx = animOffsets[i * 2] || 0;
                var cAy = animOffsets[i * 2 + 1] || 0;
                if (!ThreeWaterShader.isWaterRect(cAx, cAy)) continue;
                var isThisWF = ThreeWaterShader.isWaterfallRect(cAx, cAy);
                if (isThisWF !== meshIsWF) continue;
                var ck = kindArr[i] != null ? kindArr[i] : -1;
                if (meshKinds.length > 0 && meshKinds.indexOf(ck) < 0) continue;

                var srcOff = i * 12;
                var uvOff = wi * 12;
                var boundsOff = wi * 24;
                var ax = cAx * tileAnimX;
                var ay = cAy * tileAnimY;
                var uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
                for (var j = 0; j < 6; j++) {
                    var u = (data.uvs[srcOff + j * 2] + ax) / texW;
                    var v = 1.0 - (data.uvs[srcOff + j * 2 + 1] + ay) / texH;
                    wUvArray[uvOff + j * 2]     = u;
                    wUvArray[uvOff + j * 2 + 1] = v;
                    if (u < uMin) uMin = u;
                    if (u > uMax) uMax = u;
                    if (v < vMin) vMin = v;
                    if (v > vMax) vMax = v;
                }
                if (wBoundsArray) {
                    uMin += halfTexelU; uMax -= halfTexelU;
                    vMin += halfTexelV; vMax -= halfTexelV;
                    for (var j = 0; j < 6; j++) {
                        wBoundsArray[boundsOff + j * 4]     = uMin;
                        wBoundsArray[boundsOff + j * 4 + 1] = vMin;
                        wBoundsArray[boundsOff + j * 4 + 2] = uMax;
                        wBoundsArray[boundsOff + j * 4 + 3] = vMax;
                    }
                }
                wi++;
            }
            wUvAttr.needsUpdate = true;
            if (wBoundsAttr) wBoundsAttr.needsUpdate = true;
            ThreeWaterShader.updateTime(wMesh, ThreeWaterShader._time);
        }
    }
};

ThreeTilemapRectLayer.prototype.syncTransform = function() {
    var obj = this._threeObj;
    obj.position.x = this._x;
    obj.position.y = this._y;
    obj.position.z = this._zIndex;
    obj.visible = this._visible;
    this._flush();
};

ThreeTilemapRectLayer.prototype.updateTransform = function(parentAlpha) {
    if (parentAlpha === undefined) parentAlpha = 1;
    this.worldAlpha = this._alpha * parentAlpha;
    this.worldVisible = this._visible;
    this.syncTransform();
};

// PIXI compat stubs
ThreeTilemapRectLayer.prototype.addChild = function() {};
ThreeTilemapRectLayer.prototype.removeChild = function() {};
ThreeTilemapRectLayer.prototype.removeChildren = function() { return []; };
ThreeTilemapRectLayer.prototype.getBounds = function() { return { x: 0, y: 0, width: 0, height: 0 }; };
ThreeTilemapRectLayer.prototype.renderWebGL = function() {};
ThreeTilemapRectLayer.prototype.renderCanvas = function() {};
ThreeTilemapRectLayer.prototype.destroy = function() {
    // 물/그림자 메시 정리
    for (var key in this._meshes) {
        var m = this._meshes[key];
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
    }
    this._meshes = {};
    // 통합 메시 정리
    if (this._unifiedMesh) {
        if (this._unifiedMesh.geometry) this._unifiedMesh.geometry.dispose();
        if (this._unifiedMesh.material) this._unifiedMesh.material.dispose();
        if (this._unifiedMesh.customDepthMaterial) this._unifiedMesh.customDepthMaterial.dispose();
        this._unifiedMesh = null;
    }
    // 배열 텍스처 정리
    if (this._arrayTexture) {
        this._arrayTexture.dispose();
        this._arrayTexture = null;
    }
    this._unifiedRects = null;
    this._unifiedShaderRef = null;
    this._rectData = {};
    this._threeObj = null;
};


//=============================================================================
// ThreeTilemapCompositeLayer - CompositeRectTileLayer 호환
// children[0] = RectLayer, setBitmaps/shadowColor 관리
//=============================================================================

function ThreeTilemapCompositeLayer() {
    this._threeObj = new THREE.Group();
    this._threeObj._wrapper = this;

    this._x = 0;
    this._y = 0;
    this._alpha = 1;
    this._visible = true;
    this._zIndex = 0;
    this.worldAlpha = 1;
    this.worldVisible = true;
    this.parent = null;
    this._transformDirty = true;
    this._filters = null;

    this.scale = { x: 1, y: 1 };
    this.pivot = { x: 0, y: 0 };

    // RectLayer를 children[0]으로
    var rectLayer = new ThreeTilemapRectLayer();
    this.children = [rectLayer];
    rectLayer.parent = this;
    this._threeObj.add(rectLayer._threeObj);
}

Object.defineProperties(ThreeTilemapCompositeLayer.prototype, {
    x: {
        get: function() { return this._x; },
        set: function(v) { this._x = v; },
        configurable: true
    },
    y: {
        get: function() { return this._y; },
        set: function(v) { this._y = v; },
        configurable: true
    },
    alpha: {
        get: function() { return this._alpha; },
        set: function(v) { this._alpha = v; },
        configurable: true
    },
    visible: {
        get: function() { return this._visible; },
        set: function(v) { this._visible = v; this._threeObj.visible = v; },
        configurable: true
    },
    zIndex: {
        get: function() { return this._zIndex; },
        set: function(v) { this._zIndex = v; },
        configurable: true
    },
    shadowColor: {
        get: function() { return this.children[0]._shadowColor; },
        set: function(v) { this.children[0]._shadowColor = v; },
        configurable: true
    }
});

ThreeTilemapCompositeLayer.prototype.setBitmaps = function(bitmaps) {
    this.children[0].setBitmaps(bitmaps);
};

ThreeTilemapCompositeLayer.prototype.clear = function() {
    this.children[0].clear();
};

ThreeTilemapCompositeLayer.prototype.syncTransform = function() {
    var obj = this._threeObj;
    obj.position.x = this._x;
    obj.position.y = this._y;
    obj.position.z = this._zIndex;
    obj.visible = this._visible;
};

ThreeTilemapCompositeLayer.prototype.updateTransform = function(parentAlpha) {
    if (parentAlpha === undefined) parentAlpha = 1;
    this.worldAlpha = this._alpha * parentAlpha;
    this.worldVisible = this._visible;
    this.syncTransform();
    for (var i = 0; i < this.children.length; i++) {
        if (this.children[i].updateTransform) {
            this.children[i].updateTransform(this.worldAlpha);
        }
    }
};

// Stubs
ThreeTilemapCompositeLayer.prototype.addChild = function(child) {
    child.parent = this;
    this.children.push(child);
    if (child._threeObj) this._threeObj.add(child._threeObj);
    return child;
};
ThreeTilemapCompositeLayer.prototype.removeChild = function(child) {
    var idx = this.children.indexOf(child);
    if (idx >= 0) {
        this.children.splice(idx, 1);
        child.parent = null;
        if (child._threeObj) this._threeObj.remove(child._threeObj);
    }
    return child;
};
ThreeTilemapCompositeLayer.prototype.removeChildren = function() {
    var removed = this.children.slice();
    for (var i = 0; i < removed.length; i++) {
        removed[i].parent = null;
        if (removed[i]._threeObj) this._threeObj.remove(removed[i]._threeObj);
    }
    this.children.length = 0;
    return removed;
};
ThreeTilemapCompositeLayer.prototype.getBounds = function() { return { x: 0, y: 0, width: 0, height: 0 }; };
ThreeTilemapCompositeLayer.prototype.renderWebGL = function() {};
ThreeTilemapCompositeLayer.prototype.renderCanvas = function() {};
ThreeTilemapCompositeLayer.prototype.destroy = function() {
    for (var i = 0; i < this.children.length; i++) {
        if (this.children[i].destroy) this.children[i].destroy();
    }
    this.children.length = 0;
    this._threeObj = null;
};


//=============================================================================
// ThreeTilemapZLayer - ZLayer 호환 (ThreeContainer 기반)
// position.x/y로 스크롤 오프셋, z로 레이어 순서
//=============================================================================

function ThreeTilemapZLayer(zIndex) {
    this._threeObj = new THREE.Group();
    this._threeObj._wrapper = this;

    this._x = 0;
    this._y = 0;
    this._scaleX = 1;
    this._scaleY = 1;
    this._rotation = 0;
    this._pivotX = 0;
    this._pivotY = 0;
    this._alpha = 1;
    this._visible = true;
    this._zIndex = zIndex || 0;
    this.z = zIndex || 0;
    this.worldAlpha = 1;
    this.worldVisible = true;
    this.parent = null;
    this.children = [];
    this._filters = null;
    this._transformDirty = true;
    this.interactive = false;

    this.scale = this._createScaleProxy();
    this.pivot = this._createPivotProxy();

    // CompositeLayer 생성
    this._compositeLayer = new ThreeTilemapCompositeLayer();
    this.addChild(this._compositeLayer);
}

ThreeTilemapZLayer.prototype._createScaleProxy = ThreeContainer.prototype._createScaleProxy;
ThreeTilemapZLayer.prototype._createPivotProxy = ThreeContainer.prototype._createPivotProxy;

Object.defineProperties(ThreeTilemapZLayer.prototype, {
    x: {
        get: function() { return this._x; },
        set: function(v) { this._x = v; this._transformDirty = true; },
        configurable: true
    },
    y: {
        get: function() { return this._y; },
        set: function(v) { this._y = v; this._transformDirty = true; },
        configurable: true
    },
    rotation: {
        get: function() { return this._rotation; },
        set: function(v) { this._rotation = v; this._transformDirty = true; },
        configurable: true
    },
    alpha: {
        get: function() { return this._alpha; },
        set: function(v) { this._alpha = v; },
        configurable: true
    },
    visible: {
        get: function() { return this._visible; },
        set: function(v) { this._visible = v; this._threeObj.visible = v; },
        configurable: true
    },
    zIndex: {
        get: function() { return this._zIndex; },
        set: function(v) { this._zIndex = v; this._transformDirty = true; },
        configurable: true
    },
    filters: {
        get: function() { return this._filters; },
        set: function(v) { this._filters = v; },
        configurable: true
    }
});

// position proxy (ShaderTilemap이 zLayer.position.x = ... 으로 접근)
Object.defineProperty(ThreeTilemapZLayer.prototype, 'position', {
    get: function() {
        var self = this;
        return {
            get x() { return self._x; },
            set x(v) { self._x = v; self._transformDirty = true; },
            get y() { return self._y; },
            set y(v) { self._y = v; self._transformDirty = true; }
        };
    },
    configurable: true
});

ThreeTilemapZLayer.prototype.clear = function() {
    this._compositeLayer.clear();
};

ThreeTilemapZLayer.prototype.syncTransform = function() {
    var obj = this._threeObj;
    obj.position.x = this._x - this._pivotX;
    obj.position.y = this._y - this._pivotY;
    var elevationEnabled = $dataMap && $dataMap.tileLayerElevation;
    obj.position.z = elevationEnabled ? this._zIndex : 0;
    obj.scale.x = this._scaleX;
    obj.scale.y = this._scaleY;
    obj.rotation.z = -this._rotation;
    obj.visible = this._visible;
};

ThreeTilemapZLayer.prototype.updateTransform = function(parentAlpha) {
    if (parentAlpha === undefined) parentAlpha = 1;
    this.worldAlpha = this._alpha * parentAlpha;
    this.worldVisible = this._visible;
    this.syncTransform();
    for (var i = 0; i < this.children.length; i++) {
        if (this.children[i].updateTransform) {
            this.children[i].updateTransform(this.worldAlpha);
        }
    }
};

// Child management (ThreeContainer 호환)
ThreeTilemapZLayer.prototype.addChild = function(child) {
    if (child.parent) child.parent.removeChild(child);
    child.parent = this;
    this.children.push(child);
    if (child._threeObj) this._threeObj.add(child._threeObj);
    return child;
};

ThreeTilemapZLayer.prototype.addChildAt = function(child, index) {
    if (child.parent) child.parent.removeChild(child);
    child.parent = this;
    this.children.splice(index, 0, child);
    if (child._threeObj) this._threeObj.add(child._threeObj);
    return child;
};

ThreeTilemapZLayer.prototype.removeChild = function(child) {
    var idx = this.children.indexOf(child);
    if (idx >= 0) {
        this.children.splice(idx, 1);
        child.parent = null;
        if (child._threeObj) this._threeObj.remove(child._threeObj);
    }
    return child;
};

ThreeTilemapZLayer.prototype.removeChildren = function() {
    var removed = this.children.slice();
    for (var i = 0; i < removed.length; i++) {
        removed[i].parent = null;
        if (removed[i]._threeObj) this._threeObj.remove(removed[i]._threeObj);
    }
    this.children.length = 0;
    return removed;
};

ThreeTilemapZLayer.prototype.getChildIndex = function(child) {
    return this.children.indexOf(child);
};

ThreeTilemapZLayer.prototype.setChildIndex = function(child, index) {
    var cur = this.children.indexOf(child);
    if (cur >= 0) {
        this.children.splice(cur, 1);
        this.children.splice(index, 0, child);
    }
};

ThreeTilemapZLayer.prototype.getBounds = function() {
    return { x: this._x, y: this._y, width: 0, height: 0 };
};

ThreeTilemapZLayer.prototype.renderWebGL = function() {};
ThreeTilemapZLayer.prototype.renderCanvas = function() {};

ThreeTilemapZLayer.prototype.destroy = function() {
    if (this.parent) this.parent.removeChild(this);
    for (var i = 0; i < this.children.length; i++) {
        if (this.children[i].destroy) this.children[i].destroy();
    }
    this.children.length = 0;
    this._threeObj = null;
};
