//=============================================================================
// PuzzleSokoban.js — 소코반 퍼즐 미니게임
//=============================================================================
/*:
 * @plugindesc 소코반(박스 밀기) 퍼즐 미니게임
 * @author RPGMaker MV Web Editor
 *
 * @help 플러그인 커맨드:
 *   PUZZLE_SOKOBAN start [switchId]
 *   switchId — 완료 시 ON할 스위치 번호
 */

(function() {
  'use strict';

  //=============================================================================
  // 레벨 데이터
  //=============================================================================
  // '#' = 벽, ' ' = 바닥, '@' = 플레이어, '$' = 박스
  // '.' = 목표, '*' = 박스+목표, '+' = 플레이어+목표

  var LEVELS = [
    // 레벨 1: 입문 (7×7)
    [
      '#######',
      '#     #',
      '# $@$.#',
      '#  .  #',
      '#  $  #',
      '#     #',
      '#######'
    ],
    // 레벨 2: 중급 (9×9)
    [
      '#########',
      '#   #   #',
      '# $ . $ #',
      '#   #   #',
      '### @ ###',
      '#   #   #',
      '# . # . #',
      '#   $   #',
      '#########'
    ]
  ];

  //=============================================================================
  // 플러그인 커맨드
  //=============================================================================
  var _pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function(command, args) {
    _pluginCommand.call(this, command, args);
    if (command === 'PUZZLE_SOKOBAN') {
      if (args[0] === 'start') {
        var switchId = parseInt(args[1]) || 0;
        SceneManager.push(Scene_PuzzleSokoban);
        SceneManager.prepareNextScene(switchId);
      }
    }
  };

  //=============================================================================
  // Scene_PuzzleSokoban
  //=============================================================================
  function Scene_PuzzleSokoban() { this.initialize.apply(this, arguments); }
  Scene_PuzzleSokoban.prototype = Object.create(Scene_Base.prototype);
  Scene_PuzzleSokoban.prototype.constructor = Scene_PuzzleSokoban;

  Scene_PuzzleSokoban.prototype.prepare = function(switchId) {
    this._switchId = switchId;
  };

  Scene_PuzzleSokoban.prototype.initialize = function() {
    Scene_Base.prototype.initialize.call(this);
    this._switchId = 0;
    this._levelIndex = 0;
    this._moveCount = 0;
    this._history = [];
    this._state = null;
    this._inputDelay = 0;
  };

  Scene_PuzzleSokoban.prototype.create = function() {
    Scene_Base.prototype.create.call(this);
    this._loadLevel(this._levelIndex);
    this._createSprites();
  };

  Scene_PuzzleSokoban.prototype._loadLevel = function(index) {
    var raw = LEVELS[index];
    this._levelRows = raw.length;
    this._levelCols = raw[0].length;
    this._moveCount = 0;
    this._history = [];

    // 그리드를 숫자 배열로 파싱
    // 0=빈, 1=벽, 2=바닥, 3=목표, 4=박스, 5=박스+목표
    // 플레이어는 별도 좌표로 관리
    this._grid = [];
    this._playerX = 0;
    this._playerY = 0;
    this._playerOnGoal = false;

    for (var r = 0; r < this._levelRows; r++) {
      var row = [];
      for (var c = 0; c < this._levelCols; c++) {
        var ch = raw[r][c] || ' ';
        switch (ch) {
          case '#': row.push(1); break;   // 벽
          case ' ': row.push(2); break;   // 바닥
          case '.': row.push(3); break;   // 목표
          case '$': row.push(4); break;   // 박스
          case '*': row.push(5); break;   // 박스+목표
          case '@':
            row.push(2);                  // 바닥으로 처리
            this._playerX = c;
            this._playerY = r;
            this._playerOnGoal = false;
            break;
          case '+':
            row.push(3);                  // 목표로 처리
            this._playerX = c;
            this._playerY = r;
            this._playerOnGoal = true;
            break;
          default:  row.push(0); break;   // 빈
        }
      }
      this._grid.push(row);
    }
  };

  Scene_PuzzleSokoban.prototype._createSprites = function() {
    this._backgroundSprite = new Sprite(new Bitmap(Graphics.width, Graphics.height));
    this._backgroundSprite.bitmap.fillAll('rgba(0,0,0,0.75)');
    this.addChild(this._backgroundSprite);

    this._boardLayer = new Sprite();
    this.addChild(this._boardLayer);

    this._uiLayer = new Sprite();
    this.addChild(this._uiLayer);

    this._drawBoard();
    this._drawUI();
  };

  //=============================================================================
  // 그리기 헬퍼
  //=============================================================================
  var CELL = 64; // 셀 크기(px)
  var WALL_COLOR    = '#445566';
  var FLOOR_COLOR   = '#1e2a3a';
  var GOAL_COLOR    = '#1e2a3a';
  var BOX_COLOR     = '#8B4513';
  var BOX_DARK      = '#5C2D0A';
  var BOX_DONE_COLOR= '#DAA520';
  var BOX_DONE_DARK = '#A07800';
  var PLAYER_COLOR  = '#4488ff';
  var PLAYER_DARK   = '#2255bb';

  Scene_PuzzleSokoban.prototype._boardOrigin = function() {
    var bw = this._levelCols * CELL;
    var bh = this._levelRows * CELL;
    return {
      x: Math.floor((Graphics.width  - bw) / 2),
      y: Math.floor((Graphics.height - bh) / 2) + 10
    };
  };

  Scene_PuzzleSokoban.prototype._drawBoard = function() {
    var bw = this._levelCols * CELL;
    var bh = this._levelRows * CELL;
    var origin = this._boardOrigin();

    if (!this._boardBitmap || this._boardBitmap.width !== bw || this._boardBitmap.height !== bh) {
      this._boardBitmap = new Bitmap(bw, bh);
      this._boardLayer.bitmap = this._boardBitmap;
      this._boardLayer.x = origin.x;
      this._boardLayer.y = origin.y;
    }

    var bmp = this._boardBitmap;
    bmp.clear();

    for (var r = 0; r < this._levelRows; r++) {
      for (var c = 0; c < this._levelCols; c++) {
        var x = c * CELL;
        var y = r * CELL;
        var cell = this._grid[r][c];

        switch (cell) {
          case 0: // 빈
            break;
          case 1: // 벽
            this._drawWall(bmp, x, y);
            break;
          case 2: // 바닥
            this._drawFloor(bmp, x, y);
            break;
          case 3: // 목표
            this._drawGoal(bmp, x, y);
            break;
          case 4: // 박스
            this._drawFloor(bmp, x, y);
            this._drawBox(bmp, x, y, false);
            break;
          case 5: // 박스+목표
            this._drawGoal(bmp, x, y);
            this._drawBox(bmp, x, y, true);
            break;
        }
      }
    }

    // 플레이어
    var px = this._playerX * CELL;
    var py = this._playerY * CELL;
    if (this._playerOnGoal) {
      this._drawGoal(bmp, px, py);
    } else {
      this._drawFloor(bmp, px, py);
    }
    this._drawPlayer(bmp, px, py);
  };

  Scene_PuzzleSokoban.prototype._drawWall = function(bmp, x, y) {
    bmp.fillRect(x, y, CELL, CELL, WALL_COLOR);
    // 하이라이트 (좌,상단)
    bmp.fillRect(x, y, CELL, 3, '#6688aa');
    bmp.fillRect(x, y, 3, CELL, '#6688aa');
    // 그림자 (우,하단)
    bmp.fillRect(x + CELL - 3, y, 3, CELL, '#223344');
    bmp.fillRect(x, y + CELL - 3, CELL, 3, '#223344');
  };

  Scene_PuzzleSokoban.prototype._drawFloor = function(bmp, x, y) {
    bmp.fillRect(x, y, CELL, CELL, FLOOR_COLOR);
    bmp.fillRect(x, y, CELL, 1, '#2a3a4a');
    bmp.fillRect(x, y, 1, CELL, '#2a3a4a');
  };

  Scene_PuzzleSokoban.prototype._drawGoal = function(bmp, x, y) {
    bmp.fillRect(x, y, CELL, CELL, GOAL_COLOR);
    bmp.fillRect(x, y, CELL, 1, '#2a3a4a');
    bmp.fillRect(x, y, 1, CELL, '#2a3a4a');
    // 황금색 별 (★)
    bmp.fontSize = 32;
    bmp.textColor = '#DAA520';
    bmp.drawText('★', x, y + (CELL - 36) / 2, CELL, 36, 'center');
  };

  Scene_PuzzleSokoban.prototype._drawBox = function(bmp, x, y, onGoal) {
    var pad = 6;
    var baseColor = onGoal ? BOX_DONE_COLOR : BOX_COLOR;
    var darkColor = onGoal ? BOX_DONE_DARK  : BOX_DARK;
    // 본체
    bmp.fillRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, baseColor);
    // 테두리 밝게
    bmp.fillRect(x + pad, y + pad, CELL - pad * 2, 4, onGoal ? '#ffe066' : '#c06030');
    bmp.fillRect(x + pad, y + pad, 4, CELL - pad * 2, onGoal ? '#ffe066' : '#c06030');
    // 테두리 어둡게
    bmp.fillRect(x + CELL - pad - 4, y + pad, 4, CELL - pad * 2, darkColor);
    bmp.fillRect(x + pad, y + CELL - pad - 4, CELL - pad * 2, 4, darkColor);
  };

  Scene_PuzzleSokoban.prototype._drawPlayer = function(bmp, x, y) {
    // 원형을 직접 그리기 위해 canvas context 접근
    var canvas = bmp._canvas;
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var cx = x + CELL / 2;
    var cy = y + CELL / 2;
    var r  = CELL / 2 - 10;

    ctx.save();
    // 그림자(아래쪽 반원)
    ctx.beginPath();
    ctx.arc(cx, cy + 2, r, 0, Math.PI * 2);
    ctx.fillStyle = PLAYER_DARK;
    ctx.fill();
    // 본체
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = PLAYER_COLOR;
    ctx.fill();
    // 하이라이트
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
    ctx.restore();

    // Bitmap의 내부 dirty 처리 강제
    bmp._setDirty();
  };

  //=============================================================================
  // UI (상단 정보 / 하단 안내)
  //=============================================================================
  Scene_PuzzleSokoban.prototype._drawUI = function() {
    if (!this._uiBitmap) {
      this._uiBitmap = new Bitmap(Graphics.width, Graphics.height);
      this._uiLayer.bitmap = this._uiBitmap;
    }
    var bmp = this._uiBitmap;
    bmp.clear();

    // 상단 — 레벨 / 이동 횟수
    bmp.fontSize = 22;
    bmp.textColor = '#ffffff';
    var levelText = '레벨 ' + (this._levelIndex + 1) + ' / ' + LEVELS.length;
    var moveText  = '이동: ' + this._moveCount;
    bmp.drawText(levelText, 0, 12, Graphics.width, 28, 'center');
    bmp.drawText(moveText,  0, 44, Graphics.width, 28, 'center');

    // 하단 — 조작 안내
    bmp.fontSize = 18;
    bmp.textColor = '#aabbcc';
    var hint = '[화살표] 이동   [R] 리셋   [Z] 되돌리기   [ESC] 취소';
    bmp.drawText(hint, 0, Graphics.height - 36, Graphics.width, 28, 'center');
  };

  //=============================================================================
  // 게임 로직
  //=============================================================================
  Scene_PuzzleSokoban.prototype._cloneGrid = function() {
    return this._grid.map(function(row) { return row.slice(); });
  };

  Scene_PuzzleSokoban.prototype._tryMove = function(dx, dy) {
    var nx = this._playerX + dx;
    var ny = this._playerY + dy;

    if (ny < 0 || ny >= this._levelRows || nx < 0 || nx >= this._levelCols) return false;
    var nCell = this._grid[ny][nx];

    // 벽 or 빈 공간
    if (nCell === 1 || nCell === 0) return false;

    // 박스 처리
    if (nCell === 4 || nCell === 5) {
      var bx = nx + dx;
      var by = ny + dy;
      if (by < 0 || by >= this._levelRows || bx < 0 || bx >= this._levelCols) return false;
      var bCell = this._grid[by][bx];
      if (bCell === 1 || bCell === 0 || bCell === 4 || bCell === 5) return false;

      // 스냅샷 저장 (undo용)
      this._history.push({
        grid: this._cloneGrid(),
        playerX: this._playerX,
        playerY: this._playerY,
        playerOnGoal: this._playerOnGoal
      });

      // 박스 이동
      var newBoxCell = (bCell === 3) ? 5 : 4; // 목표 위면 박스+목표
      this._grid[by][bx] = newBoxCell;
      // 박스가 있던 자리는 목표(was *) or 바닥(was $)
      this._grid[ny][nx] = (nCell === 5) ? 3 : 2;
    } else {
      // 박스가 없는 이동 (스냅샷)
      this._history.push({
        grid: this._cloneGrid(),
        playerX: this._playerX,
        playerY: this._playerY,
        playerOnGoal: this._playerOnGoal
      });
    }

    // 플레이어 이동
    this._playerOnGoal = (this._grid[ny][nx] === 3);
    this._playerX = nx;
    this._playerY = ny;
    this._moveCount++;

    AudioManager.playSe({name: 'Cursor2', pan: 0, pitch: 100 + (dx ? 5 : 0), volume: 60});
    return true;
  };

  Scene_PuzzleSokoban.prototype._undo = function() {
    if (this._history.length === 0) return;
    var snap = this._history.pop();
    this._grid = snap.grid;
    this._playerX = snap.playerX;
    this._playerY = snap.playerY;
    this._playerOnGoal = snap.playerOnGoal;
    if (this._moveCount > 0) this._moveCount--;
    AudioManager.playSe({name: 'Cancel2', pan: 0, pitch: 120, volume: 70});
  };

  Scene_PuzzleSokoban.prototype._isCleared = function() {
    for (var r = 0; r < this._levelRows; r++) {
      for (var c = 0; c < this._levelCols; c++) {
        if (this._grid[r][c] === 4) return false; // 목표에 없는 박스 존재
      }
    }
    return true;
  };

  Scene_PuzzleSokoban.prototype._resetLevel = function() {
    this._loadLevel(this._levelIndex);
    AudioManager.playSe({name: 'Cancel2', pan: 0, pitch: 90, volume: 80});
  };

  Scene_PuzzleSokoban.prototype._advanceLevel = function() {
    this._levelIndex++;
    if (this._levelIndex >= LEVELS.length) {
      this.onComplete();
    } else {
      this._loadLevel(this._levelIndex);
      this._drawBoard();
      this._drawUI();
      this._showMessage('레벨 ' + this._levelIndex + ' 클리어!', 90);
    }
  };

  //=============================================================================
  // 메시지 오버레이 (클리어 알림)
  //=============================================================================
  Scene_PuzzleSokoban.prototype._showMessage = function(text, frames) {
    this._messageText   = text;
    this._messageFrames = frames;
    if (!this._msgBitmap) {
      this._msgBitmap = new Bitmap(Graphics.width, 60);
      this._msgSprite = new Sprite(this._msgBitmap);
      this._msgSprite.y = Math.floor(Graphics.height / 2) - 30;
      this.addChild(this._msgSprite);
    }
    this._msgBitmap.clear();
    this._msgBitmap.fillRect(0, 0, Graphics.width, 60, 'rgba(0,0,0,0.7)');
    this._msgBitmap.fontSize = 28;
    this._msgBitmap.textColor = '#FFD700';
    this._msgBitmap.drawText(text, 0, 10, Graphics.width, 40, 'center');
    this._msgSprite.visible = true;
  };

  Scene_PuzzleSokoban.prototype._updateMessage = function() {
    if (this._messageFrames > 0) {
      this._messageFrames--;
      if (this._messageFrames === 0 && this._msgSprite) {
        this._msgSprite.visible = false;
      }
    }
  };

  //=============================================================================
  // 완료 / 취소
  //=============================================================================
  Scene_PuzzleSokoban.prototype.onComplete = function() {
    if (this._switchId > 0) $gameSwitches.setValue(this._switchId, true);
    AudioManager.playSe({name: 'Applause1', pan: 0, pitch: 100, volume: 90});
    SceneManager.pop();
  };

  Scene_PuzzleSokoban.prototype.onCancel = function() {
    AudioManager.playCancel();
    SceneManager.pop();
  };

  //=============================================================================
  // 업데이트 루프
  //=============================================================================
  Scene_PuzzleSokoban.prototype.update = function() {
    Scene_Base.prototype.update.call(this);

    this._updateMessage();

    if (this._inputDelay > 0) {
      this._inputDelay--;
      return;
    }

    // ESC — 취소
    if (Input.isTriggered('cancel')) {
      this.onCancel();
      return;
    }

    // R — 리셋
    if (Input.isTriggered('r') || (Input.isPressed('r'))) {
      if (Input.isTriggered('r')) {
        this._resetLevel();
        this._drawBoard();
        this._drawUI();
        this._inputDelay = 12;
        return;
      }
    }

    // Z — 되돌리기
    if (Input.isTriggered('z') || Input.isPressed('z')) {
      if (Input.isTriggered('z')) {
        this._undo();
        this._drawBoard();
        this._drawUI();
        this._inputDelay = 8;
        return;
      }
    }

    // 방향 이동
    var moved = false;
    if (Input.isTriggered('left')  || Input.isRepeated('left'))  { moved = this._tryMove(-1,  0); }
    if (Input.isTriggered('right') || Input.isRepeated('right')) { moved = this._tryMove( 1,  0); }
    if (Input.isTriggered('up')    || Input.isRepeated('up'))    { moved = this._tryMove( 0, -1); }
    if (Input.isTriggered('down')  || Input.isRepeated('down'))  { moved = this._tryMove( 0,  1); }

    if (moved) {
      this._drawBoard();
      this._drawUI();
      this._inputDelay = 5;

      if (this._isCleared()) {
        this._inputDelay = 90;
        var self = this;
        var delay = 0;
        // 클리어 연출 후 다음 레벨 or 완료
        var origDelay = this._inputDelay;
        this._onClearScheduled = true;
        this._clearCountdown = 90;
        this._showMessage(
          this._levelIndex + 1 < LEVELS.length
            ? '클리어! 다음 레벨로...'
            : '모든 레벨 클리어!',
          85
        );
      }
    }

    // 클리어 카운트다운
    if (this._onClearScheduled) {
      this._clearCountdown--;
      if (this._clearCountdown <= 0) {
        this._onClearScheduled = false;
        this._advanceLevel();
      }
    }
  };

  //=============================================================================
  // 키 입력 매핑 (RPG Maker MV Input 시스템에 r, z 키 추가)
  //=============================================================================
  (function() {
    var _Input_initialize = Input.initialize;
    Input.initialize = function() {
      _Input_initialize.call(this);
    };

    // keyMapper 에 없는 키는 isTriggered가 작동하지 않으므로 추가
    if (!Input.keyMapper[82]) Input.keyMapper[82] = 'r'; // R
    if (!Input.keyMapper[90]) Input.keyMapper[90] = 'z'; // Z
  })();

})();
