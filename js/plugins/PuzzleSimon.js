//=============================================================================
// PuzzleSimon.js — 기억 게임(Simon Says) 미니게임
//=============================================================================
/*:
 * @plugindesc 기억 게임(Simon Says) 미니게임 - 5라운드 달성으로 완료
 * @author RPGMaker MV Web Editor
 *
 * @help 플러그인 커맨드:
 *   PUZZLE_SIMON start [switchId]
 *   switchId — 완료 시 ON할 스위치 번호
 */

(function() {
  'use strict';

  //-----------------------------------------------------------------------------
  // 상수 정의
  //-----------------------------------------------------------------------------

  var BUTTON_SIZE  = 180;  // 버튼 한 변 픽셀
  var BUTTON_GAP   = 4;    // 버튼 사이 간격
  var MAX_ROUNDS   = 5;    // 목표 라운드 수

  // 버튼 색 (인덱스: 0=빨강, 1=파랑, 2=녹색, 3=노랑)
  var COLORS_DIM = ['#882222', '#224488', '#226622', '#886622'];
  var COLORS_LIT = ['#ff4444', '#4488ff', '#44cc44', '#ffcc44'];

  // 키보드 매핑: Q=0(빨강), W=1(파랑), A=2(녹색), S=3(노랑)  /  1=0, 2=1, 3=2, 4=3
  var KEY_MAP = {
    81: 0,  // Q
    87: 1,  // W
    65: 2,  // A
    83: 3,  // S
    49: 0,  // 1
    50: 1,  // 2
    51: 2,  // 3
    52: 3   // 4
  };

  // 각 버튼 효과음 피치 (Cursor1 기준)
  var BUTTON_PITCH = [80, 100, 120, 140];

  //-----------------------------------------------------------------------------
  // Plugin Command
  //-----------------------------------------------------------------------------

  var _pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function(command, args) {
    _pluginCommand.call(this, command, args);
    if (command === 'PUZZLE_SIMON') {
      if (args[0] === 'start') {
        var switchId = parseInt(args[1]) || 0;
        SceneManager.push(Scene_PuzzleSimon);
        SceneManager.prepareNextScene(switchId);
      }
    }
  };

  //-----------------------------------------------------------------------------
  // Scene_PuzzleSimon
  //-----------------------------------------------------------------------------

  function Scene_PuzzleSimon() { this.initialize.apply(this, arguments); }
  Scene_PuzzleSimon.prototype = Object.create(Scene_Base.prototype);
  Scene_PuzzleSimon.prototype.constructor = Scene_PuzzleSimon;

  Scene_PuzzleSimon.prototype.initialize = function() {
    Scene_Base.prototype.initialize.call(this);
    this._switchId    = 0;
    this._sequence    = [];    // 정답 시퀀스
    this._round       = 0;    // 현재 라운드 (1-based)
    this._phase       = 'idle'; // idle / showing / waiting / result
    this._phaseTimer  = 0;
    this._showIndex   = 0;    // 재생 중인 시퀀스 인덱스
    this._playerInput = [];   // 이번 라운드 플레이어 입력
    this._litButton   = -1;   // 현재 점등 중인 버튼 인덱스 (-1=소등)
    this._litTimer    = 0;    // 점등 지속 타이머
    this._resultText  = '';   // 결과 메시지
    this._keyConsumed = {};   // 프레임별 키 소비 방지
  };

  Scene_PuzzleSimon.prototype.prepare = function(switchId) {
    this._switchId = switchId;
  };

  //-----------------------------------------------------------------------------
  // Create
  //-----------------------------------------------------------------------------

  Scene_PuzzleSimon.prototype.create = function() {
    Scene_Base.prototype.create.call(this);
    this._createBackground();
    this._createOverlay();
    this._createButtons();
    this._createUI();
    this._startGame();
  };

  Scene_PuzzleSimon.prototype._createBackground = function() {
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

  Scene_PuzzleSimon.prototype._createOverlay = function() {
    this._overlaySprite = new Sprite();
    var bmp = new Bitmap(Graphics.width, Graphics.height);
    bmp.fillAll('rgba(0,0,0,0.72)');
    this._overlaySprite.bitmap = bmp;
    this.addChild(this._overlaySprite);
  };

  //-----------------------------------------------------------------------------
  // 버튼 레이아웃 헬퍼
  //-----------------------------------------------------------------------------

  // 그리드 전체 폭/높이: 2*(BUTTON_SIZE+GAP) - GAP
  Scene_PuzzleSimon.prototype._gridWidth = function() {
    return 2 * BUTTON_SIZE + BUTTON_GAP;
  };

  Scene_PuzzleSimon.prototype._gridHeight = function() {
    return 2 * BUTTON_SIZE + BUTTON_GAP;
  };

  // 버튼 인덱스 → 열/행 (0=좌상, 1=우상, 2=좌하, 3=우하)
  Scene_PuzzleSimon.prototype._buttonCol = function(idx) { return idx % 2; };
  Scene_PuzzleSimon.prototype._buttonRow = function(idx) { return Math.floor(idx / 2); };

  // 그리드 왼쪽 상단 픽셀 좌표
  Scene_PuzzleSimon.prototype._originX = function() {
    return Math.floor((Graphics.width  - this._gridWidth())  / 2);
  };

  // 제목+라운드 영역 때문에 약간 아래로 이동
  Scene_PuzzleSimon.prototype._originY = function() {
    return Math.floor((Graphics.height - this._gridHeight()) / 2) + 24;
  };

  Scene_PuzzleSimon.prototype._buttonX = function(idx) {
    return this._originX() + this._buttonCol(idx) * (BUTTON_SIZE + BUTTON_GAP);
  };

  Scene_PuzzleSimon.prototype._buttonY = function(idx) {
    return this._originY() + this._buttonRow(idx) * (BUTTON_SIZE + BUTTON_GAP);
  };

  //-----------------------------------------------------------------------------
  // Button Sprites
  //-----------------------------------------------------------------------------

  Scene_PuzzleSimon.prototype._createButtons = function() {
    this._buttonContainer = new Sprite();
    this.addChild(this._buttonContainer);

    this._buttonSprites = [];
    for (var i = 0; i < 4; i++) {
      var spr = new Sprite();
      spr.bitmap = new Bitmap(BUTTON_SIZE, BUTTON_SIZE);
      spr.x = this._buttonX(i);
      spr.y = this._buttonY(i);
      this._buttonContainer.addChild(spr);
      this._buttonSprites.push(spr);
      this._drawButton(i, false);
    }
  };

  // 버튼 라벨 (색 이름)
  var BUTTON_LABELS = ['빨강', '파랑', '녹색', '노랑'];
  // 키 안내 (Q/W/A/S)
  var BUTTON_KEYS   = ['Q', 'W', 'A', 'S'];

  Scene_PuzzleSimon.prototype._drawButton = function(idx, lit) {
    var bmp = this._buttonSprites[idx].bitmap;
    var color = lit ? COLORS_LIT[idx] : COLORS_DIM[idx];
    bmp.clear();

    // 배경
    bmp.fillRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, color);

    // 테두리 (밝게)
    if (lit) {
      // 점등 시 밝은 흰 테두리
      bmp.fillRect(0, 0, BUTTON_SIZE, 4, '#ffffff88');
      bmp.fillRect(0, 0, 4, BUTTON_SIZE, '#ffffff88');
      bmp.fillRect(0, BUTTON_SIZE - 4, BUTTON_SIZE, 4, '#00000055');
      bmp.fillRect(BUTTON_SIZE - 4, 0, 4, BUTTON_SIZE, '#00000055');
    } else {
      // 소등 시 어두운 테두리
      bmp.fillRect(0, 0, BUTTON_SIZE, 3, '#ffffff33');
      bmp.fillRect(0, 0, 3, BUTTON_SIZE, '#ffffff33');
      bmp.fillRect(0, BUTTON_SIZE - 3, BUTTON_SIZE, 3, '#00000066');
      bmp.fillRect(BUTTON_SIZE - 3, 0, 3, BUTTON_SIZE, '#00000066');
    }

    // 라벨 (색 이름)
    bmp.textColor = lit ? '#ffffff' : '#cccccc';
    bmp.fontSize  = 28;
    bmp.fontBold  = true;
    bmp.drawText(BUTTON_LABELS[idx], 0, BUTTON_SIZE / 2 - 30, BUTTON_SIZE, 40, 'center');

    // 키 안내
    bmp.fontSize  = 20;
    bmp.fontBold  = false;
    bmp.textColor = lit ? '#ffffaa' : '#888888';
    bmp.drawText('[' + BUTTON_KEYS[idx] + ']', 0, BUTTON_SIZE / 2 + 14, BUTTON_SIZE, 32, 'center');
  };

  Scene_PuzzleSimon.prototype._lightButton = function(idx, lit) {
    // 이전 점등 버튼 소등 (인덱스가 유효하고 현재 켜진 버튼이 다를 때)
    if (this._litButton >= 0 && (this._litButton !== idx || !lit)) {
      this._drawButton(this._litButton, false);
    }
    if (idx < 0) {
      this._litButton = -1;
      return;
    }
    this._litButton = lit ? idx : -1;
    this._drawButton(idx, lit);
  };

  //-----------------------------------------------------------------------------
  // UI Sprites
  //-----------------------------------------------------------------------------

  Scene_PuzzleSimon.prototype._createUI = function() {
    // 제목
    this._titleSprite = new Sprite();
    this._titleSprite.bitmap = new Bitmap(Graphics.width, 52);
    this._titleSprite.x = 0;
    this._titleSprite.y = 18;
    this.addChild(this._titleSprite);
    this._drawTitle();

    // 라운드 표시
    this._roundSprite = new Sprite();
    this._roundSprite.bitmap = new Bitmap(Graphics.width, 38);
    this._roundSprite.x = 0;
    this._roundSprite.y = 72;
    this.addChild(this._roundSprite);
    this._drawRound();

    // 상태 메시지 (준비하세요 / 입력하세요 / 결과)
    this._msgSprite = new Sprite();
    this._msgSprite.bitmap = new Bitmap(Graphics.width, 40);
    this._msgSprite.x = 0;
    this._msgSprite.y = this._originY() + this._gridHeight() + 18;
    this.addChild(this._msgSprite);
    this._drawMsg('');

    // 하단 힌트
    this._hintSprite = new Sprite();
    this._hintSprite.bitmap = new Bitmap(Graphics.width, 32);
    this._hintSprite.x = 0;
    this._hintSprite.y = Graphics.height - 44;
    this.addChild(this._hintSprite);
    this._drawHint();
  };

  Scene_PuzzleSimon.prototype._drawTitle = function() {
    var bmp = this._titleSprite.bitmap;
    bmp.clear();
    bmp.textColor = '#ffffff';
    bmp.fontSize  = 34;
    bmp.fontBold  = true;
    bmp.drawText('기억 게임', 0, 0, Graphics.width, 52, 'center');
  };

  Scene_PuzzleSimon.prototype._drawRound = function() {
    var bmp = this._roundSprite.bitmap;
    bmp.clear();
    bmp.textColor = '#aaddff';
    bmp.fontSize  = 22;
    bmp.fontBold  = false;
    var text = this._round > 0 ? '라운드 ' + this._round + ' / ' + MAX_ROUNDS : '';
    bmp.drawText(text, 0, 0, Graphics.width, 38, 'center');
  };

  Scene_PuzzleSimon.prototype._drawMsg = function(msg, color) {
    var bmp = this._msgSprite.bitmap;
    bmp.clear();
    bmp.textColor = color || '#ffffff';
    bmp.fontSize  = 22;
    bmp.fontBold  = false;
    if (msg) bmp.drawText(msg, 0, 0, Graphics.width, 40, 'center');
  };

  Scene_PuzzleSimon.prototype._drawHint = function() {
    var bmp = this._hintSprite.bitmap;
    bmp.clear();
    bmp.textColor = '#888888';
    bmp.fontSize  = 18;
    bmp.drawText('[ESC] 취소   |   Q / W / A / S (또는 1~4) 로 입력', 0, 0, Graphics.width, 32, 'center');
  };

  //-----------------------------------------------------------------------------
  // 게임 흐름 상태 머신
  //-----------------------------------------------------------------------------

  // 게임 시작: 시퀀스 초기화 후 1라운드 준비
  Scene_PuzzleSimon.prototype._startGame = function() {
    this._sequence    = [];
    this._round       = 0;
    this._litButton   = -1;
    this._showIndex   = 0;
    this._playerInput = [];
    this._nextRound();
  };

  // 다음 라운드 진입
  Scene_PuzzleSimon.prototype._nextRound = function() {
    this._round++;
    this._sequence.push(Math.floor(Math.random() * 4));
    this._playerInput = [];
    this._drawRound();
    this._setPhase('ready', 60); // 1초 "준비하세요"
    this._drawMsg('준비하세요...', '#ffee88');
  };

  // phase 변경 + 타이머 설정
  Scene_PuzzleSimon.prototype._setPhase = function(phase, timer) {
    this._phase      = phase;
    this._phaseTimer = timer || 0;
  };

  //-----------------------------------------------------------------------------
  // Update
  //-----------------------------------------------------------------------------

  Scene_PuzzleSimon.prototype.update = function() {
    Scene_Base.prototype.update.call(this);
    this._keyConsumed = {};

    switch (this._phase) {
      case 'ready':
        this._updateReady();
        break;
      case 'showing':
        this._updateShowing();
        break;
      case 'waiting':
        this._updateWaiting();
        break;
      case 'result':
        this._updateResult();
        break;
    }
  };

  // 준비 단계: 1초 대기 후 시퀀스 재생 시작
  Scene_PuzzleSimon.prototype._updateReady = function() {
    if (this._phaseTimer > 0) {
      this._phaseTimer--;
      return;
    }
    // 시퀀스 재생 시작
    this._showIndex = 0;
    this._litButton = -1;
    this._drawMsg('잘 보세요!', '#aaddff');
    this._setPhase('showing', 0);
    this._updateShowing(); // 첫 프레임 즉시 처리
  };

  // 시퀀스 재생 단계
  // 한 버튼당: 36프레임 점등(0.6초) → 12프레임 소등(0.2초) → 다음
  Scene_PuzzleSimon.prototype._updateShowing = function() {
    if (this._showIndex >= this._sequence.length) {
      // 재생 완료 → 입력 대기
      this._lightButton(-1, false); // 소등
      this._litButton = -1;
      this._drawMsg('입력하세요!', '#88ffaa');
      this._setPhase('waiting', 0);
      return;
    }

    var idx = this._sequence[this._showIndex];

    // phaseTimer가 0이면 이번 버튼 점등 시작
    if (this._phaseTimer <= 0) {
      // 소등 간격 직후 점등 시작
      this._lightButton(idx, true);
      this._playSE(idx);
      this._phaseTimer = 36 + 12; // 총 48프레임 (점등 36 + 소등 12)
    }

    this._phaseTimer--;

    if (this._phaseTimer === 12) {
      // 36프레임 점등 완료 → 소등
      this._lightButton(idx, false);
    }

    if (this._phaseTimer <= 0) {
      // 소등 12프레임 완료 → 다음 버튼
      this._showIndex++;
    }
  };

  // 플레이어 입력 대기 단계
  Scene_PuzzleSimon.prototype._updateWaiting = function() {
    // 점등 애니메이션 처리 (플레이어가 누른 버튼)
    if (this._litTimer > 0) {
      this._litTimer--;
      if (this._litTimer === 0 && this._litButton >= 0) {
        this._lightButton(this._litButton, false);
        this._litButton = -1;
      }
    }

    // ESC / cancel
    if (Input.isTriggered('cancel') || Input.isTriggered('escape')) {
      this.onCancel();
      return;
    }

    // 점등 중 추가 입력 무시 (짧게만 무시)
    var buttonIdx = this._detectInput();
    if (buttonIdx < 0) return;

    this._onPlayerInput(buttonIdx);
  };

  // 입력 감지: 마우스 / 터치 클릭 (키보드는 keydown 이벤트 리스너에서 처리)
  Scene_PuzzleSimon.prototype._detectInput = function() {
    if (TouchInput.isTriggered()) {
      var tx = TouchInput.x;
      var ty = TouchInput.y;
      for (var i = 0; i < 4; i++) {
        var bx = this._buttonX(i);
        var by = this._buttonY(i);
        if (tx >= bx && tx < bx + BUTTON_SIZE &&
            ty >= by && ty < by + BUTTON_SIZE) {
          return i;
        }
      }
    }
    return -1;
  };

  // 플레이어 입력 처리
  Scene_PuzzleSimon.prototype._onPlayerInput = function(buttonIdx) {
    // 점등 애니메이션
    this._lightButton(buttonIdx, true);
    this._litTimer  = 12; // 0.2초 (12프레임)
    this._playSE(buttonIdx);

    this._playerInput.push(buttonIdx);
    var pos = this._playerInput.length - 1;

    if (this._playerInput[pos] !== this._sequence[pos]) {
      // 오답
      this._setPhase('result', 90); // 1.5초
      this._drawMsg('틀렸습니다! 처음부터...', '#ff6666');
      AudioManager.playSe({name: 'Buzzer1', pan: 0, pitch: 100, volume: 80});
      return;
    }

    if (this._playerInput.length === this._sequence.length) {
      // 이번 라운드 정답
      if (this._round >= MAX_ROUNDS) {
        // 게임 완료
        this._drawMsg('완료!', '#ffee44');
        this._setPhase('result', 90);
        this._resultText = 'complete';
      } else {
        // 다음 라운드
        this._drawMsg('정답!', '#88ffaa');
        this._setPhase('result', 50);
        this._resultText = 'next';
      }
    }
  };

  // 결과 표시 대기 후 다음 단계로
  Scene_PuzzleSimon.prototype._updateResult = function() {
    if (this._phaseTimer > 0) {
      this._phaseTimer--;
      return;
    }
    if (this._resultText === 'complete') {
      this.onComplete();
    } else if (this._resultText === 'next') {
      this._resultText = '';
      this._nextRound();
    } else {
      // 오답: 처음부터
      this._resultText = '';
      this._startGame();
    }
  };

  //-----------------------------------------------------------------------------
  // 키 감지 — keydown 이벤트 직접 수신 (Input 객체 우회)
  //-----------------------------------------------------------------------------

  Scene_PuzzleSimon.prototype.start = function() {
    Scene_Base.prototype.start.call(this);
    this._boundKeyDown = this._onKeyDown.bind(this);
    document.addEventListener('keydown', this._boundKeyDown);
  };

  Scene_PuzzleSimon.prototype.terminate = function() {
    Scene_Base.prototype.terminate.call(this);
    if (this._boundKeyDown) {
      document.removeEventListener('keydown', this._boundKeyDown);
      this._boundKeyDown = null;
    }
    // 소등 정리
    if (this._litButton >= 0) {
      this._drawButton(this._litButton, false);
    }
  };

  Scene_PuzzleSimon.prototype._onKeyDown = function(e) {
    if (this._phase !== 'waiting') return;
    if (this._litTimer > 0) return; // 직전 입력 애니메이션 중

    var keyCode = e.keyCode;

    // ESC (27)
    if (keyCode === 27) {
      this.onCancel();
      return;
    }

    if (KEY_MAP[keyCode] !== undefined) {
      e.preventDefault();
      var buttonIdx = KEY_MAP[keyCode];
      this._onPlayerInput(buttonIdx);
    }
  };

  //-----------------------------------------------------------------------------
  // SE 재생
  //-----------------------------------------------------------------------------

  Scene_PuzzleSimon.prototype._playSE = function(buttonIdx) {
    AudioManager.playSe({
      name:   'Cursor1',
      pan:    0,
      pitch:  BUTTON_PITCH[buttonIdx],
      volume: 80
    });
  };

  //-----------------------------------------------------------------------------
  // Complete / Cancel
  //-----------------------------------------------------------------------------

  Scene_PuzzleSimon.prototype.onComplete = function() {
    if (this._switchId > 0) $gameSwitches.setValue(this._switchId, true);
    AudioManager.playSe({name: 'Applause1', pan: 0, pitch: 100, volume: 90});
    SceneManager.pop();
  };

  Scene_PuzzleSimon.prototype.onCancel = function() {
    SoundManager.playCancel();
    SceneManager.pop();
  };

})();
