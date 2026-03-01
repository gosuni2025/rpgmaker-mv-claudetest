//=============================================================================
// PuzzleSokoban.js — 인게임 소코반 퍼즐 (맵 위 직접 플레이)
//=============================================================================
/*:
 * @plugindesc 소코반(박스 밀기) 퍼즐 — 별도 씬 없이 실제 맵 위에서 플레이
 * @author RPGMaker MV Web Editor
 *
 * @help
 * 플레이어가 실제 맵 위에서 박스 이벤트를 밀어 목표 위치에 넣는 퍼즐입니다.
 *
 * ─────────────────────────────────────────────
 * 설정 방법
 * ─────────────────────────────────────────────
 * 1. 박스로 사용할 이벤트의 노트(메모)에 <sokoban_box> 를 입력하세요.
 *    - 이벤트 속성: through=false, 우선도=통상 캐릭터와 동일
 *
 * 2. 목표 위치 타일에 region ID 1 을 설정하세요.
 *
 * ─────────────────────────────────────────────
 * 플러그인 커맨드
 * ─────────────────────────────────────────────
 *   PUZZLE_SOKOBAN_INIT switchId
 *     퍼즐을 초기화합니다.
 *     switchId — 모든 박스가 목표 위치에 들어갔을 때 ON 할 스위치 번호
 *
 *   PUZZLE_SOKOBAN_RESET
 *     박스 위치를 초기 위치로 복구합니다.
 *
 * ─────────────────────────────────────────────
 * 조작
 * ─────────────────────────────────────────────
 *   방향키  : 이동 / 박스 밀기
 *   R 키    : 박스 위치 리셋 (RPG Maker MV 에서 R = pagedown)
 */

(function () {
    'use strict';

    //=========================================================================
    // Sokoban 네임스페이스
    //=========================================================================
    var Sokoban = {
        _active:    false,
        _switchId:  0,
        _boxes:     [],   // [{eventId, x, y}]  현재 위치
        _goals:     [],   // [{x, y}]            region ID 1 인 타일
        _originals: []    // [{eventId, x, y}]   초기 위치 (reset 용)
    };

    //-------------------------------------------------------------------------
    // 맵의 모든 region ID 1 타일 좌표를 수집
    //-------------------------------------------------------------------------
    Sokoban.collectGoals = function () {
        this._goals = [];
        var map = $dataMap;
        if (!map) return;
        var w = map.width;
        var h = map.height;
        // region ID 는 레이어 z=5 에 저장됨
        // $gameMap.regionId(x, y) 사용
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                if ($gameMap.regionId(x, y) === 1) {
                    this._goals.push({ x: x, y: y });
                }
            }
        }
    };

    //-------------------------------------------------------------------------
    // 현재 맵의 <sokoban_box> 이벤트를 수집
    //-------------------------------------------------------------------------
    Sokoban.collectBoxes = function () {
        this._boxes     = [];
        this._originals = [];
        var events = $gameMap.events();
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var note = ev.event().note || '';
            if (note.indexOf('<sokoban_box>') >= 0) {
                var entry = { eventId: ev.eventId(), x: ev.x, y: ev.y };
                this._boxes.push(entry);
                this._originals.push({ eventId: ev.eventId(), x: ev.x, y: ev.y });
            }
        }
    };

    //-------------------------------------------------------------------------
    // 좌표 (x, y) 에 박스가 있는지 확인 → 있으면 해당 박스 객체 반환, 없으면 null
    //-------------------------------------------------------------------------
    Sokoban.boxAt = function (x, y) {
        for (var i = 0; i < this._boxes.length; i++) {
            if (this._boxes[i].x === x && this._boxes[i].y === y) {
                return this._boxes[i];
            }
        }
        return null;
    };

    //-------------------------------------------------------------------------
    // 승리 체크: 모든 박스가 목표 위치에 있는가
    //-------------------------------------------------------------------------
    Sokoban.isCleared = function () {
        if (this._boxes.length === 0 || this._goals.length === 0) return false;
        for (var i = 0; i < this._boxes.length; i++) {
            var bx = this._boxes[i].x;
            var by = this._boxes[i].y;
            var onGoal = false;
            for (var j = 0; j < this._goals.length; j++) {
                if (this._goals[j].x === bx && this._goals[j].y === by) {
                    onGoal = true;
                    break;
                }
            }
            if (!onGoal) return false;
        }
        return true;
    };

    //-------------------------------------------------------------------------
    // 초기화
    //-------------------------------------------------------------------------
    Sokoban.init = function (switchId) {
        this._active   = true;
        this._switchId = switchId || 0;
        this.collectGoals();
        this.collectBoxes();

        // 안내 메시지 표시
        $gameMessage.setBackground(0);
        $gameMessage.setPositionType(2);
        $gameMessage.add('\\{소코반 퍼즐\\}');
        $gameMessage.add('상자(□)를 ★ 표시된 목표 위치에 밀어 넣으세요.');
        $gameMessage.add('R키: 리셋 | 방향키: 이동');
    };

    //-------------------------------------------------------------------------
    // 리셋: 박스를 초기 위치로 복원
    //-------------------------------------------------------------------------
    Sokoban.reset = function () {
        SoundManager.playCancel();
        for (var i = 0; i < this._originals.length; i++) {
            var orig = this._originals[i];
            var ev   = $gameMap.event(orig.eventId);
            if (ev) {
                ev.locate(orig.x, orig.y);
            }
            // _boxes 동기화
            for (var j = 0; j < this._boxes.length; j++) {
                if (this._boxes[j].eventId === orig.eventId) {
                    this._boxes[j].x = orig.x;
                    this._boxes[j].y = orig.y;
                    break;
                }
            }
        }
    };

    //=========================================================================
    // 플러그인 커맨드
    //=========================================================================
    var _pluginCommand = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function (command, args) {
        _pluginCommand.call(this, command, args);
        if (command === 'PUZZLE_SOKOBAN_INIT') {
            var switchId = parseInt(args[0]) || 0;
            Sokoban.init(switchId);
        } else if (command === 'PUZZLE_SOKOBAN_RESET') {
            Sokoban.reset();
        }
    };

    //=========================================================================
    // Game_Player.prototype.moveStraight 훅
    // 박스 밀기 처리
    //=========================================================================
    var _moveStraight = Game_Player.prototype.moveStraight;
    Game_Player.prototype.moveStraight = function (d) {
        if (!Sokoban._active) {
            _moveStraight.call(this, d);
            return;
        }

        // 이동 방향으로의 한 칸 앞 좌표 계산
        var nx = $gameMap.roundXWithDirection(this.x, d);
        var ny = $gameMap.roundYWithDirection(this.y, d);

        var box = Sokoban.boxAt(nx, ny);

        if (!box) {
            // 박스 없음 — 기본 이동
            _moveStraight.call(this, d);
            return;
        }

        // 박스 너머 좌표
        var bx = $gameMap.roundXWithDirection(nx, d);
        var by = $gameMap.roundYWithDirection(ny, d);

        // 박스를 밀 수 있는지 확인
        // 1) 맵 통과 가능 여부 (벽, 지형 등)
        // 2) 다른 박스가 없는지 확인
        var passable  = $gameMap.isPassable(nx, ny, d);
        var anotherBox = Sokoban.boxAt(bx, by);

        if (!passable || anotherBox) {
            // 밀 수 없음
            SoundManager.playBuzzer();
            return; // 이동 취소
        }

        // 박스 이동
        var ev = $gameMap.event(box.eventId);
        if (ev) {
            ev.locate(bx, by);
        }
        box.x = bx;
        box.y = by;

        // 박스 밀기 SE
        AudioManager.playSe({ name: 'Cursor1', pan: 0, pitch: 100, volume: 80 });

        // 플레이어 이동 허용
        _moveStraight.call(this, d);

        // 승리 체크
        if (Sokoban.isCleared()) {
            Sokoban._active = false;
            if (Sokoban._switchId > 0) {
                $gameSwitches.setValue(Sokoban._switchId, true);
            }
            AudioManager.playSe({ name: 'Fanfare1', pan: 0, pitch: 100, volume: 90 });
            $gameMessage.setBackground(0);
            $gameMessage.setPositionType(2);
            $gameMessage.add('\\{퍼즐 완성!\\}');
            $gameMessage.add('모든 상자를 목표 위치에 넣었습니다!');
        }
    };

    //=========================================================================
    // Scene_Map.prototype.stop 훅
    // 맵을 나갈 때 소코반 비활성화
    //=========================================================================
    var _sceneMapStop = Scene_Map.prototype.stop;
    Scene_Map.prototype.stop = function () {
        _sceneMapStop.call(this);
        Sokoban._active = false;
    };

    //=========================================================================
    // R키(pagedown) 감지 → 리셋
    // Scene_Map.prototype.update 에 훅
    //=========================================================================
    var _sceneMapUpdate = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _sceneMapUpdate.call(this);

        if (Sokoban._active) {
            // 메시지 창이 열려 있으면 키 입력 무시
            if (!$gameMessage.isBusy()) {
                if (Input.isTriggered('pagedown')) {
                    Sokoban.reset();
                }
            }
        }
    };

    //=========================================================================
    // 맵 전환 시 상태 리셋
    // Game_Player.prototype.reserveTransfer 훅
    //=========================================================================
    var _reserveTransfer = Game_Player.prototype.reserveTransfer;
    Game_Player.prototype.reserveTransfer = function (mapId, x, y, d, fadeType) {
        Sokoban._active = false;
        _reserveTransfer.call(this, mapId, x, y, d, fadeType);
    };

})();
