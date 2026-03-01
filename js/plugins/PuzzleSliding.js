//=============================================================================
// PuzzleSliding.js — 슬라이딩 퍼즐 미니게임
//=============================================================================
/*:
 * @plugindesc 슬라이딩 퍼즐 미니게임 (3×3)
 * @author RPGMaker MV Web Editor
 *
 * @help 플러그인 커맨드:
 *   PUZZLE_SLIDING start [switchId]
 *   switchId — 완료 시 ON할 스위치 번호 (생략 시 0)
 */

(function() {
  'use strict';

  //-----------------------------------------------------------------------------
  // Plugin Command
  //-----------------------------------------------------------------------------

  var _pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function(command, args) {
    _pluginCommand.call(this, command, args);
    if (command === 'PUZZLE_SLIDING') {
      if (args[0] === 'start') {
        var switchId = parseInt(args[1]) || 0;
        SceneManager.push(Scene_PuzzleSliding);
        SceneManager.prepareNextScene(switchId);
      }
    }
  };

  //-----------------------------------------------------------------------------
  // Scene_PuzzleSliding
  //-----------------------------------------------------------------------------

  function Scene_PuzzleSliding() { this.initialize.apply(this, arguments); }
  Scene_PuzzleSliding.prototype = Object.create(Scene_Base.prototype);
  Scene_PuzzleSliding.prototype.constructor = Scene_PuzzleSliding;

  Scene_PuzzleSliding.prototype.initialize = function() {
    Scene_Base.prototype.initialize.call(this);
    this._switchId = 0;
    this._tiles = [];          // 3×3 배열, 값 0~8 (0=빈칸)
    this._blankX = 2;
    this._blankY = 2;
    this._moveCount = 0;
    this._completed = false;
    this._completeTimer = 0;
    this._tileSprites = [];
    this._inputCooldown = 0;
  };

  Scene_PuzzleSliding.prototype.prepare = function(switchId) {
    this._switchId = switchId;
  };

  //-----------------------------------------------------------------------------
  // Create
  //-----------------------------------------------------------------------------

  Scene_PuzzleSliding.prototype.create = function() {
    Scene_Base.prototype.create.call(this);
    this._initBoard();
    this._shuffleBoard();
    this._createBackground();
    this._createOverlay();
    this._createTileSprites();
    this._createUI();
  };

  Scene_PuzzleSliding.prototype._initBoard = function() {
    // 초기 상태: [1,2,3,4,5,6,7,8,0], 0이 빈칸 (2,2 위치)
    this._tiles = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 0]
    ];
    this._blankX = 2;
    this._blankY = 2;
  };

  Scene_PuzzleSliding.prototype._shuffleBoard = function() {
    var steps = 50 + Math.floor(Math.random() * 51); // 50~100
    var dirs = [
      { dx: 0, dy: -1 }, // 빈칸을 위로 (아래 타일이 올라옴)
      { dx: 0, dy:  1 }, // 빈칸을 아래로
      { dx: -1, dy: 0 }, // 빈칸을 왼쪽으로
      { dx:  1, dy: 0 }  // 빈칸을 오른쪽으로
    ];
    var lastDir = -1;
    for (var i = 0; i < steps; i++) {
      var validDirs = [];
      for (var d = 0; d < dirs.length; d++) {
        // 역방향 제외 (앞뒤 왔다갔다 방지)
        var opposite = (lastDir === 0) ? 1 : (lastDir === 1) ? 0 : (lastDir === 2) ? 3 : (lastDir === 3) ? 2 : -1;
        if (d === opposite) continue;
        var nx = this._blankX + dirs[d].dx;
        var ny = this._blankY + dirs[d].dy;
        if (nx >= 0 && nx < 3 && ny >= 0 && ny < 3) {
          validDirs.push(d);
        }
      }
      var pick = validDirs[Math.floor(Math.random() * validDirs.length)];
      lastDir = pick;
      var tx = this._blankX + dirs[pick].dx;
      var ty = this._blankY + dirs[pick].dy;
      this._tiles[this._blankY][this._blankX] = this._tiles[ty][tx];
      this._tiles[ty][tx] = 0;
      this._blankX = tx;
      this._blankY = ty;
    }
  };

  //-----------------------------------------------------------------------------
  // Background & Overlay
  //-----------------------------------------------------------------------------

  Scene_PuzzleSliding.prototype._createBackground = function() {
    this._backgroundSprite = new Sprite();
    var bg = SceneManager.backgroundBitmap();
    if (bg) {
      this._backgroundSprite.bitmap = bg;
    } else {
      var bmp = new Bitmap(Graphics.width, Graphics.height);
      bmp.fillAll('#000000');
      this._backgroundSprite.bitmap = bmp;
    }
    this.addChild(this._backgroundSprite);
  };

  Scene_PuzzleSliding.prototype._createOverlay = function() {
    this._overlaySprite = new Sprite();
    var bmp = new Bitmap(Graphics.width, Graphics.height);
    bmp.fillAll('rgba(0,0,0,0.7)');
    this._overlaySprite.bitmap = bmp;
    this.addChild(this._overlaySprite);
  };

  //-----------------------------------------------------------------------------
  // Tile Sprites
  //-----------------------------------------------------------------------------

  // 타일 크기 및 그리드 레이아웃 상수
  Scene_PuzzleSliding.TILE_SIZE = 100;
  Scene_PuzzleSliding.TILE_GAP  = 6;
  Scene_PuzzleSliding.GRID_SIZE = 3 * 100 + 2 * 6; // 312

  Scene_PuzzleSliding.prototype._gridOriginX = function() {
    return Math.floor((Graphics.width  - Scene_PuzzleSliding.GRID_SIZE) / 2);
  };

  Scene_PuzzleSliding.prototype._gridOriginY = function() {
    return Math.floor((Graphics.height - Scene_PuzzleSliding.GRID_SIZE) / 2);
  };

  Scene_PuzzleSliding.prototype._tilePixelX = function(gx) {
    return this._gridOriginX() + gx * (Scene_PuzzleSliding.TILE_SIZE + Scene_PuzzleSliding.TILE_GAP);
  };

  Scene_PuzzleSliding.prototype._tilePixelY = function(gy) {
    return this._gridOriginY() + gy * (Scene_PuzzleSliding.TILE_SIZE + Scene_PuzzleSliding.TILE_GAP);
  };

  Scene_PuzzleSliding.prototype._createTileSprites = function() {
    this._tileContainer = new Sprite();
    this.addChild(this._tileContainer);

    var T = Scene_PuzzleSliding.TILE_SIZE;
    for (var gy = 0; gy < 3; gy++) {
      this._tileSprites[gy] = [];
      for (var gx = 0; gx < 3; gx++) {
        var spr = new Sprite();
        spr.bitmap = new Bitmap(T, T);
        spr.x = this._tilePixelX(gx);
        spr.y = this._tilePixelY(gy);
        this._tileContainer.addChild(spr);
        this._tileSprites[gy][gx] = spr;
      }
    }
    this._redrawAllTiles();
  };

  Scene_PuzzleSliding.prototype._drawTile = function(gx, gy) {
    var T = Scene_PuzzleSliding.TILE_SIZE;
    var val = this._tiles[gy][gx];
    var bmp = this._tileSprites[gy][gx].bitmap;
    bmp.clear();

    if (val === 0) {
      // 빈칸
      bmp.fillRect(0, 0, T, T, '#1a1a2e');
    } else {
      // 숫자 타일 — 테두리(진한 파랑) + 내부(밝은 파랑 그라디언트 모사)
      var border = 3;
      bmp.fillRect(0, 0, T, T, '#1a4a8c');            // 테두리 색
      bmp.fillRect(border, border, T - border * 2, T - border * 2, '#2675bf'); // 내부 상단
      // 하단 약간 어둡게 — 그라디언트 느낌
      var gradH = Math.floor((T - border * 2) * 0.4);
      bmp.fillRect(border, border + (T - border * 2 - gradH), T - border * 2, gradH, '#1f5fa0');
      // 숫자 텍스트
      bmp.textColor = '#ffffff';
      bmp.fontSize = 42;
      bmp.fontBold = true;
      bmp.drawText(String(val), 0, 0, T, T, 'center');
    }
  };

  Scene_PuzzleSliding.prototype._redrawAllTiles = function() {
    for (var gy = 0; gy < 3; gy++) {
      for (var gx = 0; gx < 3; gx++) {
        this._drawTile(gx, gy);
      }
    }
  };

  //-----------------------------------------------------------------------------
  // UI (제목, 이동 횟수, 안내, 완료 메시지)
  //-----------------------------------------------------------------------------

  Scene_PuzzleSliding.prototype._createUI = function() {
    // 제목
    this._titleSprite = new Sprite();
    this._titleSprite.bitmap = new Bitmap(Graphics.width, 56);
    this._titleSprite.x = 0;
    this._titleSprite.y = 24;
    this.addChild(this._titleSprite);
    this._drawTitle();

    // 이동 횟수
    this._moveSprite = new Sprite();
    this._moveSprite.bitmap = new Bitmap(Graphics.width, 40);
    this._moveSprite.x = 0;
    this._moveSprite.y = 80;
    this.addChild(this._moveSprite);
    this._drawMoveCount();

    // 하단 안내
    this._hintSprite = new Sprite();
    this._hintSprite.bitmap = new Bitmap(Graphics.width, 36);
    this._hintSprite.x = 0;
    this._hintSprite.y = Graphics.height - 50;
    this.addChild(this._hintSprite);
    this._drawHint();

    // 완료 메시지 (숨겨진 상태)
    this._completeSprite = new Sprite();
    this._completeSprite.bitmap = new Bitmap(Graphics.width, 60);
    this._completeSprite.x = 0;
    this._completeSprite.y = Math.floor(Graphics.height / 2) - 30;
    this._completeSprite.visible = false;
    this.addChild(this._completeSprite);
    this._drawCompleteMessage();
  };

  Scene_PuzzleSliding.prototype._drawTitle = function() {
    var bmp = this._titleSprite.bitmap;
    bmp.clear();
    bmp.textColor = '#ffffff';
    bmp.fontSize = 36;
    bmp.fontBold = true;
    bmp.drawText('슬라이딩 퍼즐', 0, 0, Graphics.width, 56, 'center');
  };

  Scene_PuzzleSliding.prototype._drawMoveCount = function() {
    var bmp = this._moveSprite.bitmap;
    bmp.clear();
    bmp.textColor = '#aaddff';
    bmp.fontSize = 22;
    bmp.fontBold = false;
    bmp.drawText('이동 횟수: ' + this._moveCount, 0, 0, Graphics.width, 40, 'center');
  };

  Scene_PuzzleSliding.prototype._drawHint = function() {
    var bmp = this._hintSprite.bitmap;
    bmp.clear();
    bmp.textColor = '#aaaaaa';
    bmp.fontSize = 20;
    bmp.drawText('[ESC] 취소', 0, 0, Graphics.width, 36, 'center');
  };

  Scene_PuzzleSliding.prototype._drawCompleteMessage = function() {
    var bmp = this._completeSprite.bitmap;
    bmp.clear();
    bmp.textColor = '#ffee44';
    bmp.fontSize = 44;
    bmp.fontBold = true;
    bmp.drawText('퍼즐 완료!', 0, 0, Graphics.width, 60, 'center');
  };

  //-----------------------------------------------------------------------------
  // Update
  //-----------------------------------------------------------------------------

  Scene_PuzzleSliding.prototype.update = function() {
    Scene_Base.prototype.update.call(this);

    if (this._completed) {
      this._completeTimer--;
      if (this._completeTimer <= 0) {
        this.onComplete();
      }
      return;
    }

    if (this._inputCooldown > 0) {
      this._inputCooldown--;
      return;
    }

    this._handleKeyboard();
    this._handleTouch();
  };

  Scene_PuzzleSliding.prototype._handleKeyboard = function() {
    var moved = false;
    // 화살표 키: 빈칸이 해당 방향으로 이동 (반대 방향 타일이 이동)
    if (Input.isTriggered('up')) {
      // 빈칸 위에 타일 있으면 → 그 타일을 아래(빈칸)로 이동
      moved = this._tryMove(this._blankX, this._blankY - 1);
    } else if (Input.isTriggered('down')) {
      moved = this._tryMove(this._blankX, this._blankY + 1);
    } else if (Input.isTriggered('left')) {
      moved = this._tryMove(this._blankX - 1, this._blankY);
    } else if (Input.isTriggered('right')) {
      moved = this._tryMove(this._blankX + 1, this._blankY);
    } else if (Input.isTriggered('escape') || Input.isTriggered('cancel')) {
      this.onCancel();
      return;
    }
    if (moved) this._inputCooldown = 4;
  };

  Scene_PuzzleSliding.prototype._handleTouch = function() {
    if (TouchInput.isTriggered()) {
      var tx = TouchInput.x;
      var ty = TouchInput.y;
      var gx = this._pixelToGridX(tx);
      var gy = this._pixelToGridY(ty);
      if (gx >= 0 && gx < 3 && gy >= 0 && gy < 3) {
        if (this._tryMove(gx, gy)) {
          this._inputCooldown = 4;
        }
      }
    }
  };

  Scene_PuzzleSliding.prototype._pixelToGridX = function(px) {
    var T = Scene_PuzzleSliding.TILE_SIZE;
    var G = Scene_PuzzleSliding.TILE_GAP;
    return Math.floor((px - this._gridOriginX()) / (T + G));
  };

  Scene_PuzzleSliding.prototype._pixelToGridY = function(py) {
    var T = Scene_PuzzleSliding.TILE_SIZE;
    var G = Scene_PuzzleSliding.TILE_GAP;
    return Math.floor((py - this._gridOriginY()) / (T + G));
  };

  //-----------------------------------------------------------------------------
  // Move Logic
  //-----------------------------------------------------------------------------

  Scene_PuzzleSliding.prototype._tryMove = function(tileX, tileY) {
    // (tileX, tileY)가 빈칸에 인접한지 확인
    if (tileX < 0 || tileX >= 3 || tileY < 0 || tileY >= 3) return false;
    var dx = Math.abs(tileX - this._blankX);
    var dy = Math.abs(tileY - this._blankY);
    if (!((dx === 1 && dy === 0) || (dx === 0 && dy === 1))) return false;

    // 스왑
    this._tiles[this._blankY][this._blankX] = this._tiles[tileY][tileX];
    this._tiles[tileY][tileX] = 0;
    this._blankX = tileX;
    this._blankY = tileY;
    this._moveCount++;

    // 타일 스프라이트 위치 갱신
    this._syncTileSpritePositions();

    // UI 갱신
    this._drawMoveCount();

    // 효과음
    AudioManager.playSe({name: 'Cursor2', pan: 0, pitch: 100 + Math.floor(Math.random() * 20) - 10, volume: 70});

    // 완료 체크
    if (this._checkComplete()) {
      this._onPuzzleComplete();
    }
    return true;
  };

  Scene_PuzzleSliding.prototype._syncTileSpritePositions = function() {
    for (var gy = 0; gy < 3; gy++) {
      for (var gx = 0; gx < 3; gx++) {
        this._drawTile(gx, gy);
      }
    }
  };

  Scene_PuzzleSliding.prototype._checkComplete = function() {
    var expected = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 0]
    ];
    for (var gy = 0; gy < 3; gy++) {
      for (var gx = 0; gx < 3; gx++) {
        if (this._tiles[gy][gx] !== expected[gy][gx]) return false;
      }
    }
    return true;
  };

  Scene_PuzzleSliding.prototype._onPuzzleComplete = function() {
    this._completed = true;
    this._completeTimer = 120; // 2초 (60fps 기준)
    this._completeSprite.visible = true;
  };

  //-----------------------------------------------------------------------------
  // Complete / Cancel
  //-----------------------------------------------------------------------------

  Scene_PuzzleSliding.prototype.onComplete = function() {
    if (this._switchId > 0) {
      $gameSwitches.setValue(this._switchId, true);
    }
    AudioManager.playSe({name: 'Applause1', pan: 0, pitch: 100, volume: 90});
    SceneManager.pop();
  };

  Scene_PuzzleSliding.prototype.onCancel = function() {
    AudioManager.playCancel();
    SceneManager.pop();
  };

})();
