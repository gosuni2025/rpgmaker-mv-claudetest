/*:
 * @plugindesc 인게임 잠금장치 퍼즐 플러그인
 * @author Claude
 *
 * @help
 * 플레이어가 실제 맵에서 다이얼 이벤트를 밟아 번호를 맞추는 퍼즐 플러그인.
 *
 * ■ 이벤트 노트 설정
 *   다이얼 이벤트: <lock_dial index=0> ~ <lock_dial index=3>
 *   확인 이벤트:   <lock_check>
 *
 * ■ 플러그인 커맨드
 *   PUZZLE_LOCK_INIT switchId code
 *     - switchId : 정답 시 ON할 스위치 번호
 *     - code     : 4자리 비밀번호 문자열 (예: 7391)
 *     - 초기화 + 숫자 스프라이트 생성 + 안내 메시지 표시
 *
 *   PUZZLE_LOCK_CHECK
 *     - 현재 다이얼 값을 체크, 정답이면 지정 스위치 ON
 *
 *   PUZZLE_LOCK_RESET
 *     - 모든 다이얼을 0으로 초기화
 *
 * ■ 조작
 *   Z키(결정 버튼)로 다이얼 이벤트를 밟으면 해당 다이얼이 +1
 *   자물쇠 확인 이벤트를 밟으면 비밀번호 체크
 */

(function() {
    'use strict';

    // =========================================================
    // Lock 상태 객체
    // =========================================================
    var Lock = {
        _active: false,
        _switchId: 0,
        _code: [],          // 정답 배열 [7,3,9,1]
        _dials: [0,0,0,0],  // 현재 다이얼 값
        _eventIds: [],      // 다이얼 이벤트 ID (index 순서)
        _digitSprites: []   // 숫자 표시 스프라이트
    };

    // =========================================================
    // 초기화
    // =========================================================
    Lock.init = function(switchId, codeStr) {
        this._switchId = switchId;
        this._code = codeStr.split('').map(Number);
        this._dials = [0, 0, 0, 0];
        this._active = true;

        // 다이얼 이벤트 ID 수집
        this._eventIds = [];
        var events = $gameMap.events();
        var indexMap = {};
        events.forEach(function(ev) {
            var note = ev.event().note || '';
            var m = note.match(/<lock_dial\s+index=(\d+)>/);
            if (m) {
                indexMap[parseInt(m[1])] = ev.eventId();
            }
        });
        // index 순서대로 정렬
        for (var i = 0; i < this._code.length; i++) {
            this._eventIds[i] = (indexMap[i] !== undefined) ? indexMap[i] : 0;
        }

        // 스프라이트 생성
        this.destroyDigitSprites();
        this.createDigitSprites();

        // 안내 메시지
        this._showHint();
    };

    Lock._showHint = function() {
        $gameMessage.newPage();
        $gameMessage.add('\\C[14]■ 잠금장치 퍼즐');
        $gameMessage.add('다이얼을 돌려 올바른 비밀번호를 입력하세요!');
        $gameMessage.add('\\C[3]Z키(결정 버튼): 다이얼 증가 (+1)');
        $gameMessage.add('\\C[7]자물쇠 이벤트에서 Z키: 번호 확인');
    };

    // =========================================================
    // 다이얼 조작
    // =========================================================
    Lock.incrementDial = function(index) {
        if (index < 0 || index >= this._dials.length) return;
        this._dials[index] = (this._dials[index] + 1) % 10;
        this.updateDigitSprites();
        AudioManager.playSe({ name: 'Cursor2', pan: 0, pitch: 100, volume: 80 });
    };

    // =========================================================
    // 정답 확인
    // =========================================================
    Lock.check = function() {
        var correct = this._code.every(function(val, i) {
            return val === Lock._dials[i];
        });

        if (correct) {
            AudioManager.playSe({ name: 'Switch1', pan: 0, pitch: 100, volume: 90 });
            $gameMessage.newPage();
            $gameMessage.add('\\C[14]딸깍!');
            $gameMessage.add('\\C[3]잠금 해제!');
            $gameSwitches.setValue(this._switchId, true);
            this._active = false;
            this.destroyDigitSprites();
        } else {
            SoundManager.playBuzzer();
            $gameMessage.newPage();
            $gameMessage.add('\\C[2]비밀번호가 틀렸습니다.');
        }
    };

    // =========================================================
    // 리셋
    // =========================================================
    Lock.reset = function() {
        this._dials = [0, 0, 0, 0];
        this.updateDigitSprites();
    };

    // =========================================================
    // 숫자 스프라이트
    // =========================================================
    Lock.createDigitSprites = function() {
        var scene = SceneManager._scene;
        var spriteset = scene && scene._spriteset;
        if (!spriteset) return;

        this._digitSprites = this._eventIds.map(function(evId, i) {
            var sprite = new Sprite(new Bitmap(40, 40));
            sprite._lockEventId = evId;
            sprite._lockIndex = i;
            sprite.z = 9;
            spriteset._tilemap.addChild(sprite);
            return sprite;
        });

        this.updateDigitSprites();
    };

    Lock.updateDigitSprites = function() {
        this._digitSprites.forEach(function(sprite, i) {
            var ev = $gameMap && $gameMap.event(sprite._lockEventId);
            if (!ev || !sprite.bitmap) return;
            sprite.x = ev.screenX() - 20;
            sprite.y = ev.screenY() - 48;
            sprite.bitmap.clear();
            sprite.bitmap.fillRect(0, 0, 40, 40, '#222222');
            sprite.bitmap.textColor =
                (Lock._dials[i] === Lock._code[i]) ? '#ffff00' : '#ffffff';
            sprite.bitmap.fontSize = 24;
            sprite.bitmap.fontBold = true;
            sprite.bitmap.drawText(String(Lock._dials[i]), 0, 4, 40, 32, 'center');
        });
    };

    Lock.destroyDigitSprites = function() {
        this._digitSprites.forEach(function(sprite) {
            if (sprite.parent) {
                sprite.parent.removeChild(sprite);
            }
            if (sprite.bitmap) {
                sprite.bitmap.destroy();
            }
        });
        this._digitSprites = [];
    };

    // =========================================================
    // 플러그인 커맨드
    // =========================================================
    var _GameInterpreter_pluginCommand =
        Game_Interpreter.prototype.pluginCommand;

    Game_Interpreter.prototype.pluginCommand = function(command, args) {
        _GameInterpreter_pluginCommand.call(this, command, args);

        switch (command) {
            case 'PUZZLE_LOCK_INIT': {
                var switchId = parseInt(args[0]) || 0;
                var codeStr  = String(args[1] || '0000');
                Lock.init(switchId, codeStr);
                break;
            }
            case 'PUZZLE_LOCK_CHECK': {
                Lock.check();
                break;
            }
            case 'PUZZLE_LOCK_RESET': {
                Lock.reset();
                break;
            }
        }
    };

    // =========================================================
    // Game_Event.prototype.start 후킹 — 다이얼/확인 처리
    // =========================================================
    var _Game_Event_start = Game_Event.prototype.start;
    Game_Event.prototype.start = function() {
        if (Lock._active) {
            var note = this.event().note || '';

            // 다이얼 이벤트
            var dm = note.match(/<lock_dial\s+index=(\d+)>/);
            if (dm) {
                Lock.incrementDial(parseInt(dm[1]));
                return;  // 원본 이벤트 커맨드 실행 안 함
            }

            // 확인 이벤트
            if (note.match(/<lock_check>/)) {
                Lock.check();
                return;
            }
        }
        _Game_Event_start.call(this);
    };

    // =========================================================
    // Spriteset_Map.prototype.update 후킹 — 매 프레임 위치 갱신
    // =========================================================
    var _Spriteset_Map_update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function() {
        _Spriteset_Map_update.call(this);
        if (Lock._active && Lock._digitSprites.length > 0) {
            Lock.updateDigitSprites();
        }
    };

    // =========================================================
    // Scene_Map 종료 시 스프라이트 정리
    // =========================================================
    var _Scene_Map_terminate = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function() {
        _Scene_Map_terminate.call(this);
        Lock.destroyDigitSprites();
        Lock._active = false;
    };

})();
