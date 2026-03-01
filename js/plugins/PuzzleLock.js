//=============================================================================
// PuzzleLock.js — 잠금장치 조합 퍼즐 미니게임
//=============================================================================
/*:
 * @plugindesc 잠금장치(조합 다이얼) 퍼즐 미니게임
 * @author RPGMaker MV Web Editor
 *
 * @help 플러그인 커맨드:
 *   PUZZLE_LOCK start [code] [switchId]
 *   code — 4자리 정답 코드 (생략 시 랜덤)
 *   switchId — 완료 시 ON할 스위치 번호
 *
 * 예:
 *   PUZZLE_LOCK start 7394 13  — 코드 7394, 완료 시 스위치 13 ON
 *   PUZZLE_LOCK start 13       — 랜덤 코드, 완료 시 스위치 13 ON
 *
 * 조작:
 *   좌/우 화살표 — 자리 선택
 *   위/아래 화살표 — 숫자 증감
 *   Enter / Z — 제출
 *   ESC / X — 취소
 */

(function () {
  'use strict';

  //-------------------------------------------------------------------------
  // 플러그인 커맨드 등록
  //-------------------------------------------------------------------------
  var _pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function (command, args) {
    _pluginCommand.call(this, command, args);
    if (command === 'PUZZLE_LOCK') {
      if (args[0] === 'start') {
        var code, switchId;
        if (args[1] && args[1].length === 4 && /^\d{4}$/.test(args[1])) {
          code = args[1];
          switchId = parseInt(args[2]) || 0;
        } else {
          code = null; // 랜덤 생성
          switchId = parseInt(args[1]) || 0;
        }
        SceneManager.push(Scene_PuzzleLock);
        SceneManager.prepareNextScene(code, switchId);
      }
    }
  };

  //=========================================================================
  // Scene_PuzzleLock
  //=========================================================================
  function Scene_PuzzleLock() {
    this.initialize.apply(this, arguments);
  }

  Scene_PuzzleLock.prototype = Object.create(Scene_Base.prototype);
  Scene_PuzzleLock.prototype.constructor = Scene_PuzzleLock;

  Scene_PuzzleLock.prototype.initialize = function () {
    Scene_Base.prototype.initialize.call(this);
    this._code = null;
    this._switchId = 0;
    this._digits = [0, 0, 0, 0];   // 현재 입력 값
    this._cursor = 0;               // 선택된 자리 (0~3)
    this._state = 'input';          // 'input' | 'wrong' | 'correct'
    this._stateTimer = 0;
    this._shakeTimer = 0;
    this._shakeOffset = 0;
    this._hintTimer = 0;
    this._isRandom = false;
    this._sprite = null;
  };

  Scene_PuzzleLock.prototype.prepare = function (code, switchId) {
    if (code) {
      this._code = code;
      this._isRandom = false;
    } else {
      this._code = String(Math.floor(1000 + Math.random() * 9000));
      this._isRandom = true;
    }
    this._switchId = switchId || 0;
  };

  Scene_PuzzleLock.prototype.create = function () {
    Scene_Base.prototype.create.call(this);
    this._sprite = new Sprite_PuzzleLock(
      this._code,
      this._isRandom,
      this._digits,
      this
    );
    this.addChild(this._sprite);
  };

  Scene_PuzzleLock.prototype.update = function () {
    Scene_Base.prototype.update.call(this);

    if (this._state === 'correct') {
      // 완료 상태: 잠깐 표시 후 씬 종료
      this._stateTimer--;
      if (this._stateTimer <= 0) {
        this.onComplete();
      }
      this._sprite.setState(this._state, 0);
      return;
    }

    if (this._state === 'wrong') {
      this._stateTimer--;
      this._shakeTimer--;
      if (this._shakeTimer > 0) {
        this._shakeOffset = (this._shakeTimer % 4 < 2) ? -4 : 4;
      } else {
        this._shakeOffset = 0;
      }
      if (this._stateTimer <= 0) {
        this._state = 'input';
        this._shakeOffset = 0;
      }
      this._sprite.setState(this._state, this._shakeOffset);
      return;
    }

    // 힌트 타이머 (랜덤 코드일 때)
    if (this._hintTimer > 0) {
      this._hintTimer--;
    }

    this._handleInput();
    this._sprite.setCursor(this._cursor);
    this._sprite.setDigits(this._digits);
    this._sprite.setHintVisible(this._hintTimer > 0);
    this._sprite.setState(this._state, 0);
  };

  Scene_PuzzleLock.prototype._handleInput = function () {
    if (Input.isRepeated('left')) {
      this._cursor = (this._cursor + 3) % 4;
      AudioManager.playCursor();
    } else if (Input.isRepeated('right')) {
      this._cursor = (this._cursor + 1) % 4;
      AudioManager.playCursor();
    } else if (Input.isRepeated('up')) {
      this._digits[this._cursor] = (this._digits[this._cursor] + 1) % 10;
      AudioManager.playCursor();
    } else if (Input.isRepeated('down')) {
      this._digits[this._cursor] = (this._digits[this._cursor] + 9) % 10;
      AudioManager.playCursor();
    } else if (Input.isTriggered('ok')) {
      this._submit();
    } else if (Input.isTriggered('cancel')) {
      this.onCancel();
    }
  };

  Scene_PuzzleLock.prototype._submit = function () {
    var entered = this._digits.join('');
    if (entered === this._code) {
      this._state = 'correct';
      this._stateTimer = 90; // 약 1.5초 후 씬 종료
      AudioManager.playSe({ name: 'Unlock', pan: 0, pitch: 100, volume: 90 });
    } else {
      this._state = 'wrong';
      this._stateTimer = 80;
      this._shakeTimer = 30;
      AudioManager.playBuzzer();
    }
  };

  Scene_PuzzleLock.prototype.onComplete = function () {
    if (this._switchId > 0) {
      $gameSwitches.setValue(this._switchId, true);
    }
    SceneManager.pop();
  };

  Scene_PuzzleLock.prototype.onCancel = function () {
    AudioManager.playCancel();
    SceneManager.pop();
  };

  // 씬 활성 시 힌트 타이머 시작 (랜덤 코드인 경우)
  Scene_PuzzleLock.prototype.start = function () {
    Scene_Base.prototype.start.call(this);
    if (this._isRandom) {
      this._hintTimer = 180; // 3초 (60fps 기준)
    }
    this._sprite.setHintVisible(this._isRandom);
  };

  //=========================================================================
  // Sprite_PuzzleLock — 전체 UI 렌더링
  //=========================================================================
  function Sprite_PuzzleLock(code, isRandom, digits, scene) {
    this.initialize.apply(this, arguments);
  }

  Sprite_PuzzleLock.prototype = Object.create(Sprite.prototype);
  Sprite_PuzzleLock.prototype.constructor = Sprite_PuzzleLock;

  // 상수
  var DIAL_W = 60;
  var DIAL_H = 90;
  var DIAL_GAP = 16;
  var DIAL_COLS = 4;
  var BOX_PAD = 48;
  var BOX_W = DIAL_COLS * DIAL_W + (DIAL_COLS - 1) * DIAL_GAP + BOX_PAD * 2;
  var BOX_H = 280;
  var TITLE_H = 56;

  Sprite_PuzzleLock.prototype.initialize = function (code, isRandom, digits, scene) {
    Sprite.prototype.initialize.call(this);
    this._code = code;
    this._isRandom = isRandom;
    this._scene = scene;
    this._digits = digits.slice();
    this._cursor = 0;
    this._state = 'input';
    this._shakeOffset = 0;
    this._hintVisible = false;

    this._bitmap = new Bitmap(Graphics.width, Graphics.height);
    this.bitmap = this._bitmap;
    this._draw();
  };

  Sprite_PuzzleLock.prototype.setCursor = function (cursor) {
    if (this._cursor !== cursor) {
      this._cursor = cursor;
      this._draw();
    }
  };

  Sprite_PuzzleLock.prototype.setDigits = function (digits) {
    var changed = false;
    for (var i = 0; i < 4; i++) {
      if (this._digits[i] !== digits[i]) { changed = true; break; }
    }
    if (changed) {
      this._digits = digits.slice();
      this._draw();
    }
  };

  Sprite_PuzzleLock.prototype.setState = function (state, shakeOffset) {
    var changed = (this._state !== state || this._shakeOffset !== shakeOffset);
    this._state = state;
    this._shakeOffset = shakeOffset;
    if (changed) this._draw();
  };

  Sprite_PuzzleLock.prototype.setHintVisible = function (visible) {
    if (this._hintVisible !== visible) {
      this._hintVisible = visible;
      this._draw();
    }
  };

  Sprite_PuzzleLock.prototype._draw = function () {
    var bmp = this._bitmap;
    var gw = Graphics.width;
    var gh = Graphics.height;

    bmp.clear();

    // 전체 어두운 반투명 배경
    bmp.fillRect(0, 0, gw, gh, 'rgba(0,0,0,0.72)');

    // 금고 박스 위치 계산
    var boxX = Math.floor((gw - BOX_W) / 2) + this._shakeOffset;
    var boxY = Math.floor((gh - BOX_H) / 2);

    // 금고 외곽 (다크 그레이)
    this._drawRoundRect(bmp, boxX, boxY, BOX_W, BOX_H, 12, 'rgba(40,40,48,0.97)');

    // 금고 외곽 테두리
    var borderColor;
    if (this._state === 'wrong') {
      borderColor = '#cc2222';
    } else if (this._state === 'correct') {
      borderColor = '#22cc55';
    } else {
      borderColor = '#555566';
    }
    this._drawRoundRectStroke(bmp, boxX, boxY, BOX_W, BOX_H, 12, borderColor, 3);

    // 내부 장식 띠
    bmp.fillRect(boxX + 8, boxY + 8, BOX_W - 16, 6, '#333344');

    // 제목
    bmp.fontSize = 28;
    bmp.textColor = '#e8d090';
    bmp.drawText('잠금장치', boxX, boxY + 16, BOX_W, TITLE_H, 'center');

    // 자물쇠 아이콘 (간단한 그림)
    this._drawLockIcon(bmp, boxX + BOX_W / 2, boxY + 14);

    // 다이얼 4개
    var dialStartX = boxX + BOX_PAD;
    var dialY = boxY + TITLE_H + 24;

    for (var i = 0; i < 4; i++) {
      var dx = dialStartX + i * (DIAL_W + DIAL_GAP);
      this._drawDial(bmp, dx, dialY, i);
    }

    // 구분선
    bmp.fillRect(boxX + 16, dialY + DIAL_H + 16, BOX_W - 32, 1, '#444455');

    // 안내 텍스트
    var guideY = dialY + DIAL_H + 24;
    bmp.fontSize = 16;
    bmp.textColor = '#aaaaaa';
    bmp.drawText('← → 자리 선택   ↑ ↓ 숫자 변경   Enter 확인   ESC 취소', boxX, guideY, BOX_W, 24, 'center');

    // 상태 메시지
    if (this._state === 'wrong') {
      bmp.fontSize = 22;
      bmp.textColor = '#ff5555';
      bmp.drawText('틀렸습니다', boxX, guideY + 28, BOX_W, 30, 'center');
    } else if (this._state === 'correct') {
      bmp.fontSize = 22;
      bmp.textColor = '#55ff88';
      bmp.drawText('잠금 해제!', boxX, guideY + 28, BOX_W, 30, 'center');
    }

    // 힌트 (랜덤 코드일 때, 3초 표시)
    if (this._isRandom && this._hintVisible) {
      var hintY = boxY - 48;
      this._drawRoundRect(bmp, boxX + 20, hintY - 4, BOX_W - 40, 40, 6, 'rgba(80,60,20,0.92)');
      this._drawRoundRectStroke(bmp, boxX + 20, hintY - 4, BOX_W - 40, 40, 6, '#ffe066', 1);
      bmp.fontSize = 20;
      bmp.textColor = '#ffe066';
      bmp.drawText('힌트: 코드는 ' + this._code + ' 입니다.', boxX + 20, hintY, BOX_W - 40, 32, 'center');
    }
  };

  Sprite_PuzzleLock.prototype._drawDial = function (bmp, x, y, index) {
    var digit = this._digits[index];
    var isSelected = (index === this._cursor);

    // 다이얼 배경
    var bgColor = isSelected ? 'rgba(60,55,30,0.95)' : 'rgba(30,30,38,0.95)';
    this._drawRoundRect(bmp, x, y, DIAL_W, DIAL_H, 8, bgColor);

    // 다이얼 테두리
    var borderColor;
    if (this._state === 'wrong') {
      borderColor = isSelected ? '#ff4444' : '#882222';
    } else if (this._state === 'correct') {
      borderColor = isSelected ? '#44ff88' : '#228844';
    } else {
      borderColor = isSelected ? '#ffe066' : '#445566';
    }
    var borderWidth = isSelected ? 2 : 1;
    this._drawRoundRectStroke(bmp, x, y, DIAL_W, DIAL_H, 8, borderColor, borderWidth);

    // 위 화살표 ▲
    bmp.fontSize = 18;
    bmp.textColor = isSelected ? '#ffe066' : '#667788';
    bmp.drawText('▲', x, y + 4, DIAL_W, 20, 'center');

    // 숫자 (중앙 크게)
    bmp.fontSize = 48;
    bmp.textColor = isSelected ? '#ffffff' : '#cccccc';
    bmp.drawText(String(digit), x, y + 20, DIAL_W, 52, 'center');

    // 아래 화살표 ▼
    bmp.fontSize = 18;
    bmp.textColor = isSelected ? '#ffe066' : '#667788';
    bmp.drawText('▼', x, y + DIAL_H - 24, DIAL_W, 20, 'center');
  };

  Sprite_PuzzleLock.prototype._drawLockIcon = function (bmp, cx, y) {
    // 간단한 자물쇠 모양을 캔버스로 직접 그림
    var canvas = bmp._canvas || (bmp.canvas);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.save();

    var lx = cx - 10;
    var ly = y + 2;
    var lw = 20;
    var lh = 16;
    var arcR = 7;

    // 자물쇠 고리
    ctx.beginPath();
    ctx.arc(cx, ly + arcR, arcR, Math.PI, 0, false);
    ctx.strokeStyle = '#e8d090';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 자물쇠 몸체
    ctx.fillStyle = '#e8d090';
    ctx.beginPath();
    ctx.roundRect(lx, ly + arcR - 1, lw, lh, 3);
    ctx.fill();

    // 열쇠 구멍
    ctx.fillStyle = '#333340';
    ctx.beginPath();
    ctx.arc(cx, ly + arcR + 5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 1.5, ly + arcR + 7, 3, 5);

    ctx.restore();
  };

  Sprite_PuzzleLock.prototype._drawRoundRect = function (bmp, x, y, w, h, r, color) {
    var canvas = bmp._canvas || bmp.canvas;
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      this._roundRectPath(ctx, x, y, w, h, r);
    }
    ctx.fill();
    ctx.restore();
  };

  Sprite_PuzzleLock.prototype._drawRoundRectStroke = function (bmp, x, y, w, h, r, color, lineWidth) {
    var canvas = bmp._canvas || bmp.canvas;
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth || 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      this._roundRectPath(ctx, x, y, w, h, r);
    }
    ctx.stroke();
    ctx.restore();
  };

  Sprite_PuzzleLock.prototype._roundRectPath = function (ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  };

})();
