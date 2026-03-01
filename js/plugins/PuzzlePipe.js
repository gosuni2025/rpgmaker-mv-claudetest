//=============================================================================
// PuzzlePipe.js — 파이프 연결 퍼즐 미니게임
//=============================================================================
/*:
 * @plugindesc 파이프 연결 퍼즐 미니게임 (5×5)
 * @author RPGMaker MV Web Editor
 *
 * @help 플러그인 커맨드:
 *   PUZZLE_PIPE start [switchId]
 *   switchId — 완료 시 ON할 스위치 번호
 */

(function () {
  'use strict';

  //===========================================================================
  // 상수 정의
  //===========================================================================

  var GRID_SIZE = 5;
  var CELL_SIZE = 90;
  var PIPE_THICKNESS = 16;

  // 방향 인덱스: 0=상, 1=우, 2=하, 3=좌
  var DIR_N = 0, DIR_E = 1, DIR_S = 2, DIR_W = 3;
  var DIR_DELTA = [
    { dx: 0, dy: -1 }, // N
    { dx: 1, dy: 0  }, // E
    { dx: 0, dy: 1  }, // S
    { dx: -1, dy: 0 }  // W
  ];
  var OPPOSITE = [DIR_S, DIR_W, DIR_N, DIR_E];

  // 파이프 타입별 기본 연결 방향 집합 (rotation=0 기준)
  var PIPE_CONNECTIONS = {
    straight: [DIR_N, DIR_S],          // 상↔하 (H면 좌우지만 기본 V로 정의, 회전으로 표현)
    elbow:    [DIR_N, DIR_E],          // 상↔우 (기본 NE)
    t:        [DIR_N, DIR_E, DIR_W],   // T_N: 상+좌+우
    cross:    [DIR_N, DIR_E, DIR_S, DIR_W],
    source:   [DIR_N, DIR_E, DIR_S, DIR_W],
    sink:     [DIR_N, DIR_E, DIR_S, DIR_W]
  };

  // rotation(0~3) 적용: 방향을 시계방향으로 r회 회전
  function rotateDir(dir, r) {
    return (dir + r) % 4;
  }

  // 셀의 실제 연결 방향 목록 반환
  function getConnections(cell) {
    var base = PIPE_CONNECTIONS[cell.type];
    return base.map(function (d) { return rotateDir(d, cell.rotation); });
  }

  // 두 인접 셀이 서로 연결되는지 확인 (dir: 첫 번째 셀 기준 방향)
  function areConnected(cellA, cellB, dir) {
    var aConns = getConnections(cellA);
    var bConns = getConnections(cellB);
    return aConns.indexOf(dir) >= 0 && bConns.indexOf(OPPOSITE[dir]) >= 0;
  }

  //===========================================================================
  // 레벨 데이터 (하드코딩)
  //===========================================================================

  function cell(type, rotation) {
    return { type: type, rotation: rotation };
  }

  var LEVELS = [
    // 레벨 1: 가로 뱀형 경로 (검증됨 — 정답 exists)
    {
      grid: [
        [ cell('source',0), cell('straight',0), cell('straight',0), cell('straight',0), cell('elbow',1) ],
        [ cell('elbow',2),  cell('straight',0), cell('straight',0), cell('straight',0), cell('elbow',1) ],
        [ cell('elbow',2),  cell('straight',0), cell('straight',0), cell('straight',0), cell('elbow',1) ],
        [ cell('elbow',2),  cell('straight',0), cell('straight',0), cell('straight',0), cell('elbow',0) ],
        [ cell('elbow',2),  cell('straight',0), cell('straight',0), cell('straight',0), cell('sink',0)  ]
      ],
      hint: '좌→우로 뱀처럼 이어지는 경로를 찾아보세요!'
    },
    // 레벨 2: 세로 뱀형 경로 (검증됨 — 정답 exists)
    {
      grid: [
        [ cell('source',0), cell('elbow',0),    cell('elbow',1),    cell('elbow',2),    cell('elbow',0)  ],
        [ cell('straight',1),cell('straight',1),cell('straight',1), cell('straight',1), cell('straight',1)],
        [ cell('straight',1),cell('straight',1),cell('straight',1), cell('straight',1), cell('straight',1)],
        [ cell('straight',1),cell('straight',1),cell('straight',1), cell('straight',1), cell('straight',1)],
        [ cell('elbow',3),  cell('elbow',2),    cell('elbow',1),    cell('elbow',1),    cell('sink',0)   ]
      ],
      hint: '위→아래로 뱀처럼 내려가는 경로를 찾아보세요!'
    }
  ];

  // 레벨 데이터를 깊은 복사하여 반환 (원본 보호)
  function cloneLevel(levelIndex) {
    var level = LEVELS[levelIndex % LEVELS.length];
    var grid = level.grid.map(function (row) {
      return row.map(function (c) {
        return { type: c.type, rotation: c.rotation };
      });
    });
    return { grid: grid, hint: level.hint };
  }

  //===========================================================================
  // 연결 판정 (BFS)
  //===========================================================================

  function findConnectedCells(grid) {
    // source 위치 탐색
    var startX = -1, startY = -1;
    outer:
    for (var gy = 0; gy < GRID_SIZE; gy++) {
      for (var gx = 0; gx < GRID_SIZE; gx++) {
        if (grid[gy][gx].type === 'source') {
          startX = gx; startY = gy;
          break outer;
        }
      }
    }
    if (startX < 0) return { connected: [], reached: false };

    var visited = [];
    for (var r = 0; r < GRID_SIZE; r++) {
      visited.push([false, false, false, false, false]);
    }
    var queue = [{ x: startX, y: startY }];
    visited[startY][startX] = true;
    var connected = [{ x: startX, y: startY }];
    var reached = false;

    while (queue.length > 0) {
      var cur = queue.shift();
      var curCell = grid[cur.y][cur.x];
      if (curCell.type === 'sink' && (cur.x !== startX || cur.y !== startY)) {
        reached = true;
      }
      for (var d = 0; d < 4; d++) {
        var nx = cur.x + DIR_DELTA[d].dx;
        var ny = cur.y + DIR_DELTA[d].dy;
        if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
        if (visited[ny][nx]) continue;
        var neighbor = grid[ny][nx];
        if (areConnected(curCell, neighbor, d)) {
          visited[ny][nx] = true;
          connected.push({ x: nx, y: ny });
          queue.push({ x: nx, y: ny });
        }
      }
    }
    return { connected: connected, reached: reached };
  }

  //===========================================================================
  // 플러그인 커맨드
  //===========================================================================

  var _pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function (command, args) {
    _pluginCommand.call(this, command, args);
    if (command === 'PUZZLE_PIPE') {
      if (args[0] === 'start') {
        var switchId = parseInt(args[1]) || 0;
        var levelIndex = parseInt(args[2]) || 0;
        SceneManager.push(Scene_PuzzlePipe);
        SceneManager.prepareNextScene(switchId, levelIndex);
      }
    }
  };

  //===========================================================================
  // Scene_PuzzlePipe
  //===========================================================================

  function Scene_PuzzlePipe() {
    this.initialize.apply(this, arguments);
  }

  Scene_PuzzlePipe.prototype = Object.create(Scene_Base.prototype);
  Scene_PuzzlePipe.prototype.constructor = Scene_PuzzlePipe;

  Scene_PuzzlePipe.prototype.initialize = function () {
    Scene_Base.prototype.initialize.call(this);
    this._switchId = 0;
    this._levelIndex = 0;
    this._grid = null;
    this._connected = [];
    this._reached = false;
    this._cursorX = 0;
    this._cursorY = 0;
    this._completed = false;
    this._completionTimer = 0;
  };

  Scene_PuzzlePipe.prototype.prepare = function (switchId, levelIndex) {
    this._switchId = switchId || 0;
    this._levelIndex = levelIndex || 0;
  };

  Scene_PuzzlePipe.prototype.create = function () {
    Scene_Base.prototype.create.call(this);
    this._levelData = cloneLevel(this._levelIndex);
    this._grid = this._levelData.grid;
    this._refreshConnections();
    this._createBackground();
    this._createGridSprite();
    this._createUI();
    this._drawAll();
  };

  // ── 배경 ──────────────────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype._createBackground = function () {
    this._bgSprite = new Sprite(new Bitmap(Graphics.width, Graphics.height));
    var bmp = this._bgSprite.bitmap;
    // 어두운 그라데이션 배경
    bmp.fillAll('#0a0e18');
    // 격자 패턴 (공장 느낌)
    bmp.paintOpacity = 30;
    for (var gx = 0; gx < Graphics.width; gx += 40) {
      bmp.fillRect(gx, 0, 1, Graphics.height, '#2a3a50');
    }
    for (var gy = 0; gy < Graphics.height; gy += 40) {
      bmp.fillRect(0, gy, Graphics.width, 1, '#2a3a50');
    }
    bmp.paintOpacity = 255;
    this.addChild(this._bgSprite);
  };

  // ── 그리드 스프라이트 ─────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype._createGridSprite = function () {
    var totalW = GRID_SIZE * CELL_SIZE + 4;
    var totalH = GRID_SIZE * CELL_SIZE + 4;
    this._gridBitmap = new Bitmap(totalW, totalH);
    this._gridSprite = new Sprite(this._gridBitmap);
    this._gridSprite.x = Math.floor((Graphics.width - totalW) / 2);
    this._gridSprite.y = Math.floor((Graphics.height - totalH) / 2) + 10;
    this.addChild(this._gridSprite);

    // 마우스 클릭 처리를 위한 히트 영역 저장
    this._gridLeft = this._gridSprite.x;
    this._gridTop = this._gridSprite.y;
  };

  // ── UI (타이틀, 힌트, 조작안내) ──────────────────────────────────────────

  Scene_PuzzlePipe.prototype._createUI = function () {
    // 타이틀
    this._titleWindow = new Window_Base(0, 0, Graphics.width, 60);
    this._titleWindow.opacity = 0;
    this._titleBitmap = this._titleWindow.contents;
    this._titleBitmap.fontSize = 28;
    this._titleBitmap.textColor = '#00ccff';
    this._titleBitmap.outlineColor = '#001830';
    this._titleBitmap.outlineWidth = 4;
    this._titleBitmap.drawText('파이프 퍼즐', 0, 0, Graphics.width - 36, 40, 'center');
    this.addChild(this._titleWindow);

    // 조작 안내 (하단)
    this._helpWindow = new Window_Base(0, Graphics.height - 52, Graphics.width, 52);
    this._helpWindow.opacity = 120;
    this._helpBitmap = this._helpWindow.contents;
    this._helpBitmap.fontSize = 18;
    this._helpBitmap.textColor = '#aabbcc';
    this._helpBitmap.drawText('[클릭/Enter] 회전    [화살표] 커서 이동    [ESC] 취소',
      0, 0, Graphics.width - 36, 36, 'center');
    this.addChild(this._helpWindow);

    // 완료 메시지 (숨겨둠)
    this._completeSprite = new Sprite(new Bitmap(Graphics.width, 80));
    this._completeSprite.y = Math.floor(Graphics.height / 2) - 40;
    this._completeSprite.visible = false;
    var cb = this._completeSprite.bitmap;
    cb.fillAll('rgba(0,30,60,0)');
    cb.fontSize = 40;
    cb.textColor = '#00ffcc';
    cb.outlineColor = '#003322';
    cb.outlineWidth = 6;
    cb.drawText('완료!', 0, 10, Graphics.width, 60, 'center');
    this.addChild(this._completeSprite);
  };

  // ── 전체 다시 그리기 ──────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype._drawAll = function () {
    this._gridBitmap.clear();
    // 외곽 테두리
    this._gridBitmap.fillRect(0, 0, GRID_SIZE * CELL_SIZE + 4, GRID_SIZE * CELL_SIZE + 4, '#1a3050');
    this._gridBitmap.fillRect(2, 2, GRID_SIZE * CELL_SIZE, GRID_SIZE * CELL_SIZE, '#0a0e18');

    for (var gy = 0; gy < GRID_SIZE; gy++) {
      for (var gx = 0; gx < GRID_SIZE; gx++) {
        this._drawCell(gx, gy);
      }
    }
    this._drawCursor();
  };

  // ── 단일 셀 그리기 ────────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype._isConnectedCell = function (gx, gy) {
    return this._connected.some(function (c) { return c.x === gx && c.y === gy; });
  };

  Scene_PuzzlePipe.prototype._drawCell = function (gx, gy) {
    var px = 2 + gx * CELL_SIZE;
    var py = 2 + gy * CELL_SIZE;
    var cell = this._grid[gy][gx];
    var bmp = this._gridBitmap;
    var isConn = this._isConnectedCell(gx, gy);
    var bgColor = isConn ? '#0d1a2a' : '#111520';

    // 셀 배경
    bmp.fillRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2, bgColor);

    // 셀 테두리
    var borderColor = isConn ? '#224466' : '#1a2535';
    bmp.fillRect(px, py, CELL_SIZE, 1, borderColor);
    bmp.fillRect(px, py + CELL_SIZE - 1, CELL_SIZE, 1, borderColor);
    bmp.fillRect(px, py, 1, CELL_SIZE, borderColor);
    bmp.fillRect(px + CELL_SIZE - 1, py, 1, CELL_SIZE, borderColor);

    // 파이프 그리기
    this._drawPipe(bmp, px, py, cell, isConn);
  };

  // ── 파이프 렌더링 (방향별 fillRect) ──────────────────────────────────────

  Scene_PuzzlePipe.prototype._drawPipe = function (bmp, px, py, cell, isConn) {
    var pipeColor = isConn ? '#00ccff' : '#556677';
    var halfT = Math.floor(PIPE_THICKNESS / 2);
    var cx = px + Math.floor(CELL_SIZE / 2);
    var cy = py + Math.floor(CELL_SIZE / 2);

    // source/sink 전용 배경
    if (cell.type === 'source') {
      bmp.fillRect(px + 10, py + 10, CELL_SIZE - 20, CELL_SIZE - 20, '#004400');
      bmp.fontSize = 22;
      bmp.textColor = '#00ff44';
      bmp.outlineColor = '#001100';
      bmp.outlineWidth = 3;
      bmp.drawText('S', px, py + 8, CELL_SIZE, CELL_SIZE - 8, 'center');
      return;
    }
    if (cell.type === 'sink') {
      bmp.fillRect(px + 10, py + 10, CELL_SIZE - 20, CELL_SIZE - 20, isConn ? '#004433' : '#440000');
      bmp.fontSize = 22;
      bmp.textColor = isConn ? '#00ff88' : '#ff4444';
      bmp.outlineColor = '#110000';
      bmp.outlineWidth = 3;
      bmp.drawText('E', px, py + 8, CELL_SIZE, CELL_SIZE - 8, 'center');
      return;
    }

    // 연결 방향에 따라 파이프 세그먼트 그리기
    var conns = getConnections(cell);
    // 중앙 허브 (2개 이상 연결이면 중앙 사각형)
    if (conns.length >= 2) {
      bmp.fillRect(cx - halfT, cy - halfT, PIPE_THICKNESS, PIPE_THICKNESS, pipeColor);
    }

    conns.forEach(function (dir) {
      switch (dir) {
        case DIR_N: // 상
          bmp.fillRect(cx - halfT, py, PIPE_THICKNESS, cy - py, pipeColor);
          break;
        case DIR_E: // 우
          bmp.fillRect(cx, cy - halfT, px + CELL_SIZE - cx, PIPE_THICKNESS, pipeColor);
          break;
        case DIR_S: // 하
          bmp.fillRect(cx - halfT, cy, PIPE_THICKNESS, py + CELL_SIZE - cy, pipeColor);
          break;
        case DIR_W: // 좌
          bmp.fillRect(px, cy - halfT, cx - px, PIPE_THICKNESS, pipeColor);
          break;
      }
    });

    // 파이프 끝단 캡 (엔드포인트에 작은 원형 표시)
    conns.forEach(function (dir) {
      var capSize = 8;
      var half = Math.floor(capSize / 2);
      switch (dir) {
        case DIR_N:
          bmp.fillRect(cx - half, py + 2, capSize, capSize, isConn ? '#55eeff' : '#778899');
          break;
        case DIR_E:
          bmp.fillRect(px + CELL_SIZE - capSize - 2, cy - half, capSize, capSize, isConn ? '#55eeff' : '#778899');
          break;
        case DIR_S:
          bmp.fillRect(cx - half, py + CELL_SIZE - capSize - 2, capSize, capSize, isConn ? '#55eeff' : '#778899');
          break;
        case DIR_W:
          bmp.fillRect(px + 2, cy - half, capSize, capSize, isConn ? '#55eeff' : '#778899');
          break;
      }
    });
  };

  // ── 커서 그리기 ───────────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype._drawCursor = function () {
    if (this._completed) return;
    var px = 2 + this._cursorX * CELL_SIZE;
    var py = 2 + this._cursorY * CELL_SIZE;
    var bmp = this._gridBitmap;
    var color = '#ffff00';
    var t = 3;
    bmp.fillRect(px, py, CELL_SIZE, t, color);
    bmp.fillRect(px, py + CELL_SIZE - t, CELL_SIZE, t, color);
    bmp.fillRect(px, py, t, CELL_SIZE, color);
    bmp.fillRect(px + CELL_SIZE - t, py, t, CELL_SIZE, color);
  };

  // ── 연결 갱신 ─────────────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype._refreshConnections = function () {
    var result = findConnectedCells(this._grid);
    this._connected = result.connected;
    this._reached = result.reached;
  };

  // ── 셀 회전 ───────────────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype._rotateCell = function (gx, gy) {
    var cell = this._grid[gy][gx];
    if (cell.type === 'source' || cell.type === 'sink') return; // source/sink는 회전 안 함
    cell.rotation = (cell.rotation + 1) % 4;
    AudioManager.playSe({ name: 'Switch2', pan: 0, pitch: 100 + Math.random() * 20 - 10, volume: 70 });
    this._refreshConnections();
    this._drawAll();
    if (this._reached && !this._completed) {
      this._onComplete();
    }
  };

  // ── 완료 처리 ─────────────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype._onComplete = function () {
    this._completed = true;
    this._drawAll();
    this._completeSprite.visible = true;
    this._completionTimer = 90; // 90프레임 후 씬 종료
    AudioManager.playSe({ name: 'Applause1', pan: 0, pitch: 100, volume: 90 });
  };

  // ── update ────────────────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype.update = function () {
    Scene_Base.prototype.update.call(this);
    if (this._completed) {
      this._completionTimer--;
      if (this._completionTimer <= 0) {
        this.onComplete();
      }
      return;
    }
    this._handleInput();
    this._handleMouseInput();
  };

  // ── 키보드 입력 ───────────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype._handleInput = function () {
    var prevX = this._cursorX, prevY = this._cursorY;

    if (Input.isRepeated('left')) {
      this._cursorX = Math.max(0, this._cursorX - 1);
    } else if (Input.isRepeated('right')) {
      this._cursorX = Math.min(GRID_SIZE - 1, this._cursorX + 1);
    } else if (Input.isRepeated('up')) {
      this._cursorY = Math.max(0, this._cursorY - 1);
    } else if (Input.isRepeated('down')) {
      this._cursorY = Math.min(GRID_SIZE - 1, this._cursorY + 1);
    }

    if (this._cursorX !== prevX || this._cursorY !== prevY) {
      this._drawAll();
    }

    if (Input.isTriggered('ok')) {
      this._rotateCell(this._cursorX, this._cursorY);
    }

    if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
      this.onCancel();
    }
  };

  // ── 마우스 입력 ───────────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype._handleMouseInput = function () {
    if (TouchInput.isTriggered()) {
      var tx = TouchInput.x - this._gridLeft;
      var ty = TouchInput.y - this._gridTop - 2;
      var gx = Math.floor(tx / CELL_SIZE);
      var gy = Math.floor(ty / CELL_SIZE);
      if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
        this._cursorX = gx;
        this._cursorY = gy;
        this._rotateCell(gx, gy);
      }
    }
  };

  // ── 씬 종료 콜백 ──────────────────────────────────────────────────────────

  Scene_PuzzlePipe.prototype.onComplete = function () {
    if (this._switchId > 0) {
      $gameSwitches.setValue(this._switchId, true);
    }
    SceneManager.pop();
  };

  Scene_PuzzlePipe.prototype.onCancel = function () {
    SoundManager.playCancel();
    SceneManager.pop();
  };

  // ── Scene_PuzzlePipe 전역 노출 ────────────────────────────────────────────
  window.Scene_PuzzlePipe = Scene_PuzzlePipe;

})();
