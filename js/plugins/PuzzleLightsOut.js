//=============================================================================
// PuzzleLightsOut.js — Lights Out 퍼즐 미니게임
//=============================================================================
/*:
 * @plugindesc Lights Out 불 끄기 퍼즐 미니게임 (5×5)
 * @author RPGMaker MV Web Editor
 *
 * @help 플러그인 커맨드:
 *   PUZZLE_LIGHTSOUT start [switchId]
 *   switchId — 완료 시 ON할 스위치 번호 (생략 시 0)
 */

(function() {
  'use strict';

  //===========================================================================
  // 플러그인 커맨드 등록
  //===========================================================================
  var _pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function(command, args) {
    _pluginCommand.call(this, command, args);
    if (command === 'PUZZLE_LIGHTSOUT') {
      if (args[0] === 'start') {
        var switchId = parseInt(args[1]) || 0;
        SceneManager.push(Scene_PuzzleLightsOut);
        SceneManager.prepareNextScene(switchId);
      }
    }
  };

  //===========================================================================
  // 상수 정의
  //===========================================================================
  var GRID_SIZE    = 5;
  var CELL_SIZE    = 80;
  var CELL_GAP     = 8;
  var GRID_TOTAL   = GRID_SIZE * CELL_SIZE + (GRID_SIZE - 1) * CELL_GAP;

  var COLOR_ON_FILL   = '#ffe066';
  var COLOR_ON_GLOW   = '#ffffff';
  var COLOR_OFF_FILL  = '#333344';
  var COLOR_OFF_EDGE  = '#22223a';
  var COLOR_BG_OVERLAY = 'rgba(0,0,0,0.75)';

  var SHUFFLE_COUNT_MIN = 10;
  var SHUFFLE_COUNT_MAX = 20;

  //===========================================================================
  // Scene_PuzzleLightsOut
  //===========================================================================
  function Scene_PuzzleLightsOut() {
    this.initialize.apply(this, arguments);
  }

  Scene_PuzzleLightsOut.prototype = Object.create(Scene_Base.prototype);
  Scene_PuzzleLightsOut.prototype.constructor = Scene_PuzzleLightsOut;

  Scene_PuzzleLightsOut.prototype.initialize = function() {
    Scene_Base.prototype.initialize.call(this);
    this._switchId    = 0;
    this._grid        = [];
    this._cursorX     = 2;
    this._cursorY     = 2;
    this._clickCount  = 0;
    this._completed   = false;
    this._completeTimer = 0;
    this._flashPhase  = 0;   // 완료 후 점멸 단계
    this._exitReady   = false;
  };

  Scene_PuzzleLightsOut.prototype.prepare = function(switchId) {
    this._switchId = switchId;
  };

  //-------------------------------------------------------------------------
  // Scene ライフサイクル
  //-------------------------------------------------------------------------
  Scene_PuzzleLightsOut.prototype.create = function() {
    Scene_Base.prototype.create.call(this);
    this._initGrid();
    this._createBackground();
    this._createGridSprite();
    this._createTitleSprite();
    this._createHelpSprite();
    this._createCompleteSprite();
    this._renderAll();
  };

  Scene_PuzzleLightsOut.prototype.start = function() {
    Scene_Base.prototype.start.call(this);
  };

  Scene_PuzzleLightsOut.prototype.update = function() {
    Scene_Base.prototype.update.call(this);
    if (this._exitReady) return;

    if (this._completed) {
      this._updateComplete();
    } else {
      this._updateInput();
    }
  };

  Scene_PuzzleLightsOut.prototype.terminate = function() {
    Scene_Base.prototype.terminate.call(this);
  };

  //-------------------------------------------------------------------------
  // グリッド初期化・シャッフル
  //-------------------------------------------------------------------------
  Scene_PuzzleLightsOut.prototype._initGrid = function() {
    // 全 OFF 初期状態
    this._grid = [];
    for (var i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      this._grid.push(false);
    }

    // ランダムクリックで必ず解ける盤面を生成
    var count = SHUFFLE_COUNT_MIN +
      Math.floor(Math.random() * (SHUFFLE_COUNT_MAX - SHUFFLE_COUNT_MIN + 1));

    // 全 OFF にならないよう、シャッフル後に確認して再試行
    var attempts = 0;
    do {
      for (var i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        this._grid[i] = false;
      }
      for (var s = 0; s < count; s++) {
        var rx = Math.floor(Math.random() * GRID_SIZE);
        var ry = Math.floor(Math.random() * GRID_SIZE);
        this._toggleCell(rx, ry);
      }
      attempts++;
    } while (this._isAllOff() && attempts < 100);

    this._clickCount = 0;
  };

  Scene_PuzzleLightsOut.prototype._idx = function(x, y) {
    return y * GRID_SIZE + x;
  };

  Scene_PuzzleLightsOut.prototype._toggleCell = function(x, y) {
    // 自分 + 上下左右をトグル
    var dirs = [[0,0],[0,-1],[0,1],[-1,0],[1,0]];
    for (var d = 0; d < dirs.length; d++) {
      var nx = x + dirs[d][0];
      var ny = y + dirs[d][1];
      if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
        this._grid[this._idx(nx, ny)] = !this._grid[this._idx(nx, ny)];
      }
    }
  };

  Scene_PuzzleLightsOut.prototype._isAllOff = function() {
    for (var i = 0; i < this._grid.length; i++) {
      if (this._grid[i]) return false;
    }
    return true;
  };

  //-------------------------------------------------------------------------
  // スプライト作成
  //-------------------------------------------------------------------------
  Scene_PuzzleLightsOut.prototype._createBackground = function() {
    // シーン背景(前のシーンのスナップショット)
    this._backgroundSprite = new Sprite(SceneManager.backgroundBitmap());
    this.addChild(this._backgroundSprite);

    // 半透明オーバーレイ
    this._overlayBitmap = new Bitmap(Graphics.width, Graphics.height);
    this._overlayBitmap.fillAll(COLOR_BG_OVERLAY);
    this._overlaySprite = new Sprite(this._overlayBitmap);
    this.addChild(this._overlaySprite);
  };

  Scene_PuzzleLightsOut.prototype._createGridSprite = function() {
    var w = GRID_TOTAL;
    var h = GRID_TOTAL;
    this._gridBitmap = new Bitmap(w, h);
    this._gridSprite = new Sprite(this._gridBitmap);
    this._gridSprite.x = Math.floor((Graphics.width  - w) / 2);
    this._gridSprite.y = Math.floor((Graphics.height - h) / 2) + 20;
    this.addChild(this._gridSprite);
  };

  Scene_PuzzleLightsOut.prototype._createTitleSprite = function() {
    var w = Graphics.width;
    var h = 80;
    this._titleBitmap = new Bitmap(w, h);
    this._titleSprite = new Sprite(this._titleBitmap);
    this._titleSprite.x = 0;
    this._titleSprite.y = this._gridSprite.y - 70;
    this.addChild(this._titleSprite);
  };

  Scene_PuzzleLightsOut.prototype._createHelpSprite = function() {
    var w = Graphics.width;
    var h = 48;
    this._helpBitmap = new Bitmap(w, h);
    this._helpSprite = new Sprite(this._helpBitmap);
    this._helpSprite.x = 0;
    this._helpSprite.y = this._gridSprite.y + GRID_TOTAL + 12;
    this.addChild(this._helpSprite);
  };

  Scene_PuzzleLightsOut.prototype._createCompleteSprite = function() {
    var w = Graphics.width;
    var h = 80;
    this._completeBitmap = new Bitmap(w, h);
    this._completeSprite = new Sprite(this._completeBitmap);
    this._completeSprite.x = 0;
    this._completeSprite.y = Math.floor((Graphics.height - h) / 2);
    this._completeSprite.visible = false;
    this.addChild(this._completeSprite);
  };

  //-------------------------------------------------------------------------
  // 描画
  //-------------------------------------------------------------------------
  Scene_PuzzleLightsOut.prototype._renderAll = function() {
    this._renderGrid();
    this._renderTitle();
    this._renderHelp();
  };

  Scene_PuzzleLightsOut.prototype._renderGrid = function() {
    var bmp = this._gridBitmap;
    var ctx = bmp._context;
    bmp.clear();

    for (var gy = 0; gy < GRID_SIZE; gy++) {
      for (var gx = 0; gx < GRID_SIZE; gx++) {
        var px = gx * (CELL_SIZE + CELL_GAP);
        var py = gy * (CELL_SIZE + CELL_GAP);
        var on = this._grid[this._idx(gx, gy)];
        var isCursor = (!this._completed && gx === this._cursorX && gy === this._cursorY);

        this._drawCell(ctx, px, py, on, isCursor);
      }
    }
    bmp._setDirty();
  };

  Scene_PuzzleLightsOut.prototype._drawCell = function(ctx, px, py, on, isCursor) {
    var r = 8; // 角丸半径
    var s = CELL_SIZE;

    ctx.save();

    if (on) {
      // 発光エフェクト (シャドウ)
      ctx.shadowColor = COLOR_ON_GLOW;
      ctx.shadowBlur  = 18;
    }

    // セル背景
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.lineTo(px + s - r, py);
    ctx.quadraticCurveTo(px + s, py, px + s, py + r);
    ctx.lineTo(px + s, py + s - r);
    ctx.quadraticCurveTo(px + s, py + s, px + s - r, py + s);
    ctx.lineTo(px + r, py + s);
    ctx.quadraticCurveTo(px, py + s, px, py + s - r);
    ctx.lineTo(px, py + r);
    ctx.quadraticCurveTo(px, py, px + r, py);
    ctx.closePath();
    ctx.fillStyle = on ? COLOR_ON_FILL : COLOR_OFF_FILL;
    ctx.fill();

    ctx.shadowBlur = 0;

    // カーソル枠
    if (isCursor) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 3;
      ctx.stroke();
    } else if (!on) {
      // OFF セルは薄いエッジ
      ctx.strokeStyle = COLOR_OFF_EDGE;
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    // ON セル: 内側ハイライト (上部の明るいライン)
    if (on) {
      ctx.beginPath();
      ctx.moveTo(px + r + 4, py + 6);
      ctx.lineTo(px + s - r - 4, py + 6);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    ctx.restore();
  };

  Scene_PuzzleLightsOut.prototype._renderTitle = function() {
    var bmp = this._titleBitmap;
    bmp.clear();
    bmp.textColor = '#ffffff';
    bmp.fontSize  = 28;
    bmp.fontBold  = true;
    bmp.drawText('Lights Out', 0, 0, bmp.width, 40, 'center');

    bmp.textColor = '#cccccc';
    bmp.fontSize  = 20;
    bmp.fontBold  = false;
    bmp.drawText('クリック数: ' + this._clickCount, 0, 40, bmp.width, 32, 'center');
  };

  Scene_PuzzleLightsOut.prototype._renderHelp = function() {
    var bmp = this._helpBitmap;
    bmp.clear();
    bmp.textColor = '#aaaaaa';
    bmp.fontSize  = 18;
    bmp.drawText('[クリック/Enter] トグル    [矢印] カーソル移動    [ESC] キャンセル',
      0, 0, bmp.width, 40, 'center');
  };

  Scene_PuzzleLightsOut.prototype._renderCompleteMessage = function(alpha) {
    var bmp = this._completeBitmap;
    bmp.clear();
    // フラッシュ時の輝度調整はスプライトの opacity で行う
    bmp.textColor = '#ffe066';
    bmp.fontSize  = 36;
    bmp.fontBold  = true;
    bmp.drawText('Puzzle Clear!', 0, 0, bmp.width, 80, 'center');
    this._completeSprite.opacity = Math.floor(alpha * 255);
  };

  //-------------------------------------------------------------------------
  // 入力処理
  //-------------------------------------------------------------------------
  Scene_PuzzleLightsOut.prototype._updateInput = function() {
    // キーボード移動
    if (Input.isRepeated('left')) {
      this._cursorX = (this._cursorX - 1 + GRID_SIZE) % GRID_SIZE;
      SoundManager.playCursor();
      this._renderGrid();
    } else if (Input.isRepeated('right')) {
      this._cursorX = (this._cursorX + 1) % GRID_SIZE;
      SoundManager.playCursor();
      this._renderGrid();
    } else if (Input.isRepeated('up')) {
      this._cursorY = (this._cursorY - 1 + GRID_SIZE) % GRID_SIZE;
      SoundManager.playCursor();
      this._renderGrid();
    } else if (Input.isRepeated('down')) {
      this._cursorY = (this._cursorY + 1) % GRID_SIZE;
      SoundManager.playCursor();
      this._renderGrid();
    }

    // 決定 (Z / Enter / Space)
    if (Input.isTriggered('ok')) {
      this._doToggle(this._cursorX, this._cursorY);
    }

    // キャンセル (ESC / X)
    if (Input.isTriggered('cancel')) {
      this.onCancel();
    }

    // マウスクリック
    if (TouchInput.isTriggered()) {
      this._handleTouch(TouchInput.x, TouchInput.y);
    }
  };

  Scene_PuzzleLightsOut.prototype._handleTouch = function(tx, ty) {
    var ox = this._gridSprite.x;
    var oy = this._gridSprite.y;
    var lx = tx - ox;
    var ly = ty - oy;

    if (lx < 0 || ly < 0 || lx >= GRID_TOTAL || ly >= GRID_TOTAL) return;

    var step = CELL_SIZE + CELL_GAP;
    var gx   = Math.floor(lx / step);
    var gy   = Math.floor(ly / step);

    // セルの実ピクセル範囲内かチェック (ギャップ部分を除外)
    var localX = lx - gx * step;
    var localY = ly - gy * step;
    if (localX >= CELL_SIZE || localY >= CELL_SIZE) return;
    if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return;

    this._cursorX = gx;
    this._cursorY = gy;
    this._doToggle(gx, gy);
  };

  Scene_PuzzleLightsOut.prototype._doToggle = function(x, y) {
    this._toggleCell(x, y);
    this._clickCount++;
    SoundManager.playOk();
    this._renderAll();

    if (this._isAllOff()) {
      this._startComplete();
    }
  };

  //-------------------------------------------------------------------------
  // 完了シーケンス
  //-------------------------------------------------------------------------
  Scene_PuzzleLightsOut.prototype._startComplete = function() {
    this._completed       = true;
    this._completeTimer   = 0;
    this._flashPhase      = 0;
    this._completeSprite.visible = true;
    this._renderCompleteMessage(1.0);

    // タイトル更新
    this._renderTitle();
    this._renderHelp();

    // ヘルプ非表示
    this._helpSprite.visible = false;
  };

  Scene_PuzzleLightsOut.prototype._updateComplete = function() {
    this._completeTimer++;

    // フェーズ 0: 点滅アニメ (60フレーム)
    // フェーズ 1: 完了メッセージ安定表示 (90フレーム)
    // フェーズ 2: フェードアウト → 終了

    if (this._flashPhase === 0) {
      // セルを高速点滅
      if (this._completeTimer <= 60) {
        var t = this._completeTimer;
        // 5フレームごとに全セル ON/OFF トグル
        if (t % 5 === 1) {
          var allOn = (Math.floor(t / 5) % 2 === 0);
          for (var i = 0; i < this._grid.length; i++) {
            this._grid[i] = allOn;
          }
          this._renderGrid();
        }
        // "Clear!" テキストをフラッシュ
        var alpha = 0.5 + 0.5 * Math.sin(t * 0.3);
        this._renderCompleteMessage(alpha);
      } else {
        // 全セル OFF に確定
        for (var i = 0; i < this._grid.length; i++) {
          this._grid[i] = false;
        }
        this._renderGrid();
        this._flashPhase = 1;
        this._completeTimer = 0;
        this._renderCompleteMessage(1.0);
        // 完了音
        AudioManager.playSe({name: 'Applause1', pan: 0, pitch: 100, volume: 90});
      }
    } else if (this._flashPhase === 1) {
      // 安定表示
      if (this._completeTimer > 90) {
        this._flashPhase = 2;
        this._completeTimer = 0;
      }
    } else if (this._flashPhase === 2) {
      // フェードアウト
      var fadeFrames = 30;
      var ratio = 1.0 - Math.min(this._completeTimer / fadeFrames, 1.0);
      this._overlaySprite.opacity = Math.floor(ratio * 255);
      this._gridSprite.opacity    = Math.floor(ratio * 255);
      this._titleSprite.opacity   = Math.floor(ratio * 255);
      this._completeSprite.opacity = Math.floor(ratio * 255);

      if (this._completeTimer >= fadeFrames) {
        this._exitReady = true;
        this.onComplete();
      }
    }
  };

  //-------------------------------------------------------------------------
  // コールバック
  //-------------------------------------------------------------------------
  Scene_PuzzleLightsOut.prototype.onComplete = function() {
    if (this._switchId > 0) {
      $gameSwitches.setValue(this._switchId, true);
    }
    SceneManager.pop();
  };

  Scene_PuzzleLightsOut.prototype.onCancel = function() {
    AudioManager.playCancel();
    SceneManager.pop();
  };

})();
