//=============================================================================
// PuzzleSimon.js — 기억 게임(Simon Says) 미니게임 (맵 발판 방식)
//=============================================================================
/*:
 * @plugindesc 기억 게임(Simon Says) - 맵 위의 발판 이벤트를 밟아 순서를 맞추는 퍼즐
 * @author RPGMaker MV Web Editor
 *
 * @help
 * 맵에 4개의 발판 이벤트를 배치합니다.
 * 각 발판 이벤트의 note에 <simon color=I> (I=0~3) 를 기재합니다.
 * 컨트롤러 이벤트(parallel)에서 매 프레임 PUZZLE_SIMON_TICK을 호출합니다.
 *
 * 플러그인 커맨드:
 *   PUZZLE_SIMON_INIT switchId
 *       초기화. 5라운드 시퀀스 생성 후 첫 라운드 시작.
 *       switchId — 완료 시 ON할 스위치 번호
 *
 *   PUZZLE_SIMON_INPUT colorIndex
 *       발판 이벤트 터치 시 호출. colorIndex 는 0~3.
 *
 *   PUZZLE_SIMON_TICK
 *       컨트롤러 이벤트(parallel)에서 매 프레임 호출.
 *
 *   PUZZLE_SIMON_RESET
 *       게임 상태 리셋 (맵 떠날 때 등).
 *
 * 발판 이벤트 구성:
 *   - note: <simon color=0> ~ <simon color=3>
 *   - page1 (selfSwitch A = OFF): 꺼진 스프라이트
 *   - page2 (selfSwitch A = ON) : 켜진 스프라이트
 *   - trigger: 플레이어 터치(1)
 *   - 이벤트 커맨드: 플러그인 커맨드 PUZZLE_SIMON_INPUT I
 *
 * 컨트롤러 이벤트 구성:
 *   - trigger: 병렬처리(4)
 *   - 이벤트 커맨드(반복): 플러그인 커맨드 PUZZLE_SIMON_TICK
 *
 * 맵 설정 (Map025 예시):
 *   - 발판 4개: y=5, x=3,6,9,12, note: <simon color=0> ~ <simon color=3>
 *   - 컨트롤러 이벤트: 임의 위치, parallel trigger
 *   - 퍼즐 시작 이벤트: PUZZLE_SIMON_INIT [switchId]
 */

(function() {
  'use strict';

  //-----------------------------------------------------------------------------
  // Simon 상태 오브젝트
  //-----------------------------------------------------------------------------

  var Simon = {
    _active:     false,
    _switchId:   0,
    _sequence:   [],     // 전체 시퀀스 5개 (각 0~3 랜덤)
    _round:      0,      // 현재 라운드 (1~5)
    _phase:      'idle', // 'idle' | 'show' | 'input' | 'nextRound' | 'failed'
    _showIndex:  0,      // show 단계: 현재 표시 중인 시퀀스 인덱스
    _showTimer:  0,      // show/idle 단계 프레임 카운터
    _inputIndex: 0,      // input 단계: 플레이어 입력 인덱스
    _eventIds:   {},     // { colorIndex: eventId }
    _litColor:   -1,     // 현재 점등 중인 색 인덱스 (-1=없음)
    _litTimer:   0,      // input 정답 시 발판 켜짐 유지 타이머
    _failTimer:  0,      // failed/nextRound 단계 대기 타이머
    _nextRound:  0,      // nextRound 단계에서 진입할 라운드 번호

    // 타이밍 상수
    _SHOW_ON:   40,      // 발판 켜짐 프레임 수 (약 0.67초)
    _SHOW_OFF:  20,      // 발판 꺼짐 프레임 수 (다음 발판 사이 간격, 약 0.33초)
    _IDLE_WAIT: 60,      // 라운드 시작 전 대기 프레임 (1초)
    _INPUT_LIT: 20,      // 정답 입력 시 발판 켜짐 유지 프레임 (약 0.33초)
    _FAIL_WAIT: 120,     // 오답 후 리셋까지 대기 프레임 (2초)
    _NEXT_WAIT: 80,      // 라운드 성공 후 다음 라운드까지 대기 프레임 (약 1.3초)
  };

  //-----------------------------------------------------------------------------
  // 내부 유틸
  //-----------------------------------------------------------------------------

  /**
   * note에서 <simon color=I> 파싱. 실패 시 -1 반환.
   */
  function parseSimonColor(note) {
    if (!note) return -1;
    var m = note.match(/<simon\s+color\s*=\s*(\d+)>/i);
    return m ? parseInt(m[1]) : -1;
  }

  /**
   * 맵의 모든 이벤트를 스캔하여 note 기반으로 _eventIds 구성
   */
  function buildEventIds() {
    Simon._eventIds = {};
    if (!$gameMap) return;
    $gameMap.events().forEach(function(ev) {
      var color = parseSimonColor(ev.event().note);
      if (color >= 0 && color <= 3) {
        Simon._eventIds[color] = ev.eventId();
      }
    });
  }

  /**
   * selfSwitch A 로 발판 켜고 끄기
   */
  function setSelfSwitch(colorIdx, state) {
    var evId = Simon._eventIds[colorIdx];
    if (evId === undefined) return;
    $gameSelfSwitches.setValue([$gameMap.mapId(), evId, 'A'], state);
  }

  /**
   * 모든 발판 소등
   */
  function allOff() {
    for (var i = 0; i < 4; i++) {
      setSelfSwitch(i, false);
    }
    Simon._litColor = -1;
  }

  /**
   * 5개 랜덤 시퀀스 생성 (각 0~3)
   */
  function generateSequence() {
    var seq = [];
    for (var i = 0; i < 5; i++) {
      seq.push(Math.floor(Math.random() * 4));
    }
    return seq;
  }

  //-----------------------------------------------------------------------------
  // SE 헬퍼
  //-----------------------------------------------------------------------------

  function playShowSE(colorIdx) {
    AudioManager.playSe({
      name:   'Cursor1',
      pan:    0,
      pitch:  80 + colorIdx * 20,  // 80, 100, 120, 140
      volume: 80
    });
  }

  function playInputSE(inputIndex) {
    AudioManager.playSe({
      name:   'Cursor2',
      pan:    0,
      pitch:  100 + inputIndex * 10,
      volume: 80
    });
  }

  function playCompleteSE() {
    AudioManager.playSe({
      name:   'Fanfare1',
      pan:    0,
      pitch:  100,
      volume: 90
    });
  }

  //-----------------------------------------------------------------------------
  // 메시지 표시
  //-----------------------------------------------------------------------------

  function showMessage(text) {
    if ($gameMessage && !$gameMessage.isBusy()) {
      $gameMessage.newPage();
      $gameMessage.add(text);
    }
  }

  //-----------------------------------------------------------------------------
  // 라운드 진입
  //-----------------------------------------------------------------------------

  function startRound(round) {
    Simon._round      = round;
    Simon._phase      = 'idle';
    Simon._showTimer  = Simon._IDLE_WAIT;
    Simon._showIndex  = 0;
    Simon._inputIndex = 0;
    Simon._litColor   = -1;
    Simon._litTimer   = 0;
    allOff();
  }

  //-----------------------------------------------------------------------------
  // TICK 처리 (PUZZLE_SIMON_TICK 플러그인 커맨드에서 매 프레임 호출)
  //-----------------------------------------------------------------------------

  function tick() {
    if (!Simon._active) return;

    switch (Simon._phase) {

      //--------------------------------------------------------------
      // idle: 라운드 시작 전 대기 (_IDLE_WAIT 프레임 후 show로 전환)
      //--------------------------------------------------------------
      case 'idle':
        Simon._showTimer--;
        if (Simon._showTimer <= 0) {
          Simon._phase     = 'show';
          Simon._showIndex = 0;
          Simon._showTimer = 0; // tickShow에서 첫 항목 즉시 시작
        }
        break;

      //--------------------------------------------------------------
      // show: 시퀀스 순서대로 발판 점멸 표시
      //--------------------------------------------------------------
      case 'show':
        tickShow();
        break;

      //--------------------------------------------------------------
      // input: 플레이어 발판 입력 대기
      //        (실제 입력은 PUZZLE_SIMON_INPUT에서 처리)
      //        여기서는 정답 입력 후 발판 켜짐 유지 타이머만 처리
      //--------------------------------------------------------------
      case 'input':
        if (Simon._litTimer > 0) {
          Simon._litTimer--;
          if (Simon._litTimer === 0 && Simon._litColor >= 0) {
            setSelfSwitch(Simon._litColor, false);
            Simon._litColor = -1;
          }
        }
        break;

      //--------------------------------------------------------------
      // nextRound: 라운드 성공 후 잠시 대기 후 다음 라운드 시작
      //--------------------------------------------------------------
      case 'nextRound':
        Simon._failTimer--;
        if (Simon._failTimer <= 0) {
          startRound(Simon._nextRound);
        }
        break;

      //--------------------------------------------------------------
      // failed: 오답 후 발판 깜빡임 → 새 시퀀스로 라운드 1 재시작
      //--------------------------------------------------------------
      case 'failed':
        Simon._failTimer--;
        // 8프레임 주기로 깜빡임
        var blink = Math.floor(Simon._failTimer / 8) % 2 === 0;
        for (var i = 0; i < 4; i++) {
          setSelfSwitch(i, blink);
        }
        if (Simon._failTimer <= 0) {
          allOff();
          Simon._sequence = generateSequence();
          startRound(1);
        }
        break;
    }
  }

  /**
   * show 단계 서브 루틴
   *
   * 타이밍 구조 (한 항목당):
   *   [점등: _SHOW_ON 프레임] → [소등: _SHOW_OFF 프레임] → 다음 항목
   *
   * _showTimer = 0 이면 이번 항목을 새로 시작.
   * _showTimer = _SHOW_ON + _SHOW_OFF 에서 카운트다운.
   * _showTimer = _SHOW_OFF 직전에 소등.
   * _showTimer = 0 이 되면 showIndex++ 후 다음 프레임에 다음 항목 시작.
   */
  function tickShow() {
    var total = Simon._SHOW_ON + Simon._SHOW_OFF;

    // 현재 라운드 시퀀스를 모두 표시 완료 → input 단계로
    if (Simon._showIndex >= Simon._round) {
      allOff();
      Simon._phase      = 'input';
      Simon._inputIndex = 0;
      return;
    }

    // _showTimer = 0: 이번 항목 점등 시작
    if (Simon._showTimer <= 0) {
      var colorIdx = Simon._sequence[Simon._showIndex];
      allOff();
      setSelfSwitch(colorIdx, true);
      Simon._litColor  = colorIdx;
      Simon._showTimer = total;
      playShowSE(colorIdx);
    }

    Simon._showTimer--;

    // 점등 구간 종료 → 소등 구간 진입
    if (Simon._showTimer === Simon._SHOW_OFF) {
      setSelfSwitch(Simon._litColor, false);
      Simon._litColor = -1;
    }

    // 이 항목 완료
    if (Simon._showTimer <= 0) {
      Simon._showIndex++;
      // _showTimer = 0 이므로 다음 프레임에 다음 항목 자동 시작
    }
  }

  //-----------------------------------------------------------------------------
  // INPUT 처리 (PUZZLE_SIMON_INPUT 플러그인 커맨드에서 호출)
  //-----------------------------------------------------------------------------

  function processInput(colorIdx) {
    if (!Simon._active) return;
    if (Simon._phase !== 'input') return;

    var expected = Simon._sequence[Simon._inputIndex];

    if (colorIdx === expected) {
      // 정답
      playInputSE(Simon._inputIndex);
      allOff();
      setSelfSwitch(colorIdx, true);
      Simon._litColor = colorIdx;
      Simon._litTimer = Simon._INPUT_LIT;
      Simon._inputIndex++;

      if (Simon._inputIndex >= Simon._round) {
        // 이번 라운드 완료
        if (Simon._round >= 5) {
          // 게임 완료
          Simon._active = false;
          playCompleteSE();
          if (Simon._switchId > 0) {
            $gameSwitches.setValue(Simon._switchId, true);
          }
          showMessage('\\c[14]기억 게임 완료!\\c[0] 훌륭합니다!');
        } else {
          // 다음 라운드로 전환 (잠시 대기 후)
          Simon._nextRound = Simon._round + 1;
          Simon._failTimer = Simon._NEXT_WAIT;
          Simon._phase     = 'nextRound';
        }
      }
    } else {
      // 오답
      SoundManager.playBuzzer();
      // 모든 발판 켜서 실패 표시 (깜빡임은 failed 단계 tick에서 처리)
      for (var i = 0; i < 4; i++) {
        setSelfSwitch(i, true);
      }
      Simon._litColor  = -1;
      Simon._litTimer  = 0;
      Simon._phase     = 'failed';
      Simon._failTimer = Simon._FAIL_WAIT;
      showMessage('\\c[18]틀렸습니다!\\c[0] 다시 시작합니다.');
    }
  }

  //-----------------------------------------------------------------------------
  // Plugin Command
  //-----------------------------------------------------------------------------

  var _pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function(command, args) {
    _pluginCommand.call(this, command, args);

    switch (command) {

      //------------------------------------------------------------------
      // PUZZLE_SIMON_INIT switchId
      //   초기화: 5개 랜덤 시퀀스 생성, 이벤트 ID 파싱, 라운드 1 시작
      //   안내 메시지 표시
      //------------------------------------------------------------------
      case 'PUZZLE_SIMON_INIT': {
        var switchId = parseInt(args[0]) || 0;
        Simon._switchId = switchId;
        Simon._active   = true;
        Simon._sequence = generateSequence();
        buildEventIds();
        startRound(1);

        if ($gameMessage && !$gameMessage.isBusy()) {
          $gameMessage.newPage();
          $gameMessage.add('\\c[14]기억 게임\\c[0]');
          $gameMessage.add('발광하는 발판을 기억하고,');
          $gameMessage.add('같은 순서로 밟으세요!');
        }
        break;
      }

      //------------------------------------------------------------------
      // PUZZLE_SIMON_INPUT colorIndex
      //   발판 이벤트 터치 시 호출. colorIndex = 0~3
      //------------------------------------------------------------------
      case 'PUZZLE_SIMON_INPUT': {
        var colorIdx = parseInt(args[0]);
        if (!isNaN(colorIdx)) {
          processInput(colorIdx);
        }
        break;
      }

      //------------------------------------------------------------------
      // PUZZLE_SIMON_TICK
      //   컨트롤러 이벤트(parallel)에서 매 프레임 호출
      //------------------------------------------------------------------
      case 'PUZZLE_SIMON_TICK':
        tick();
        break;

      //------------------------------------------------------------------
      // PUZZLE_SIMON_RESET
      //   게임 상태 완전 리셋
      //------------------------------------------------------------------
      case 'PUZZLE_SIMON_RESET':
        Simon._active   = false;
        Simon._phase    = 'idle';
        Simon._round    = 0;
        Simon._sequence = [];
        Simon._switchId = 0;
        allOff();
        break;
    }
  };

  //-----------------------------------------------------------------------------
  // Scene_Map 종료 시 클린업
  // 맵을 벗어날 때 Simon 상태와 발판 selfSwitch 초기화
  //-----------------------------------------------------------------------------

  var _Scene_Map_stop = Scene_Map.prototype.stop;
  Scene_Map.prototype.stop = function() {
    _Scene_Map_stop.call(this);
    if (Simon._active) {
      Simon._active = false;
      allOff();
    }
  };

})();
