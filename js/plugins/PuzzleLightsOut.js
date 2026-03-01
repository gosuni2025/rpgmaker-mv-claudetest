/*:
 * @plugindesc Lights Out Puzzle — 실제 맵 위에서 전구를 토글해 모두 끄는 퍼즐.
 * @author Claude
 *
 * @help
 * ============================================================================
 * Lights Out Puzzle Plugin
 * ============================================================================
 *
 * Map022에 25개 전구 이벤트를 5x5 그리드로 배치합니다.
 * 각 이벤트 note: <light row=R col=C>  (R, C = 0~4)
 * 이벤트 page1 (SelfSwitch A: off) = 꺼진 전구(!Switch2 sprite)
 * 이벤트 page2 (SelfSwitch A: on)  = 켜진 전구(!Switch1 sprite)
 * 이벤트 trigger = 1 (플레이어 터치)
 *
 * ============================================================================
 * 플러그인 커맨드
 * ============================================================================
 *
 * PUZZLE_LIGHTSOUT_INIT switchId
 *   퍼즐을 초기화합니다.
 *   switchId : 퍼즐 완료 시 ON으로 설정할 게임 스위치 ID
 *   예) PUZZLE_LIGHTSOUT_INIT 5
 *
 * PUZZLE_LIGHTSOUT_TOGGLE r c
 *   (r, c) 및 상하좌우 인접 전구를 모두 토글합니다.
 *   이벤트 trigger(플레이어 터치) 에서 플러그인 커맨드로 호출하세요.
 *   예) PUZZLE_LIGHTSOUT_TOGGLE 2 3
 *   스크립트에서 직접 호출: $gameMap.callPuzzleLightsOutToggle(r, c)
 *
 * PUZZLE_LIGHTSOUT_RESET
 *   퍼즐을 초기 상태(체커보드 패턴)로 리셋합니다.
 *
 * ============================================================================
 * 이벤트 설정 방법
 * ============================================================================
 *
 * Map022에 25개 이벤트를 배치합니다.
 *   위치: x = 2,4,6,8,10 / y = 2,4,6,8,10 (5x5 그리드)
 *   각 이벤트 note: <light row=R col=C>  (R=행 0~4, C=열 0~4)
 *
 * 각 이벤트 구성:
 *   Page 1 (조건: SelfSwitch A = OFF)
 *     - Trigger: Player Touch
 *     - Sprite: !Switch2 (꺼진 전구)
 *     - 내용: 플러그인 커맨드 PUZZLE_LIGHTSOUT_TOGGLE R C
 *
 *   Page 2 (조건: SelfSwitch A = ON)
 *     - Trigger: Player Touch
 *     - Sprite: !Switch1 (켜진 전구)
 *     - 내용: 플러그인 커맨드 PUZZLE_LIGHTSOUT_TOGGLE R C
 *
 * ============================================================================
 */

(function() {
    'use strict';

    // -------------------------------------------------------------------------
    // 핵심 데이터 구조
    // -------------------------------------------------------------------------
    var LightsOut = {
        _active: false,
        _switchId: 0,
        _grid: [],        // 5x5 boolean 배열 (true = 켜짐)
        _initGrid: [],    // 초기 상태 (reset 용)
        _eventMap: {}     // { row: { col: eventId } } 매핑
    };

    // -------------------------------------------------------------------------
    // 내부 헬퍼
    // -------------------------------------------------------------------------

    /**
     * 5x5 boolean 배열을 깊은 복사합니다.
     */
    function cloneGrid(grid) {
        return grid.map(function(row) { return row.slice(); });
    }

    /**
     * 이벤트 note 문자열에서 <light row=R col=C> 태그를 파싱합니다.
     * @returns {{ row: number, col: number } | null}
     */
    function parseLightNote(note) {
        if (!note) return null;
        var match = note.match(/<light\s+row=(\d+)\s+col=(\d+)>/i);
        if (!match) return null;
        return { row: parseInt(match[1], 10), col: parseInt(match[2], 10) };
    }

    /**
     * (row, col)에 해당하는 이벤트 ID를 _eventMap에서 찾습니다.
     * @returns {number|null}
     */
    function getEventId(row, col) {
        var rowMap = LightsOut._eventMap[row];
        if (!rowMap) return null;
        return (rowMap[col] != null) ? rowMap[col] : null;
    }

    /**
     * 단일 셀의 SelfSwitch A를 _grid 값에 맞게 설정합니다.
     */
    function applySelfSwitch(row, col) {
        var evId = getEventId(row, col);
        if (evId == null) return;
        var key = [$gameMap.mapId(), evId, 'A'];
        $gameSelfSwitches.setValue(key, LightsOut._grid[row][col]);
    }

    /**
     * 모든 셀의 SelfSwitch A를 _grid에 맞게 갱신합니다.
     */
    function applyAllSelfSwitches() {
        for (var r = 0; r < 5; r++) {
            for (var c = 0; c < 5; c++) {
                applySelfSwitch(r, c);
            }
        }
    }

    /**
     * 승리 조건 체크: 모든 셀이 false(꺼짐)이면 true.
     * @returns {boolean}
     */
    function checkWin() {
        for (var r = 0; r < 5; r++) {
            for (var c = 0; c < 5; c++) {
                if (LightsOut._grid[r][c]) return false;
            }
        }
        return true;
    }

    /**
     * 승리 처리: 게임 스위치 ON, 팡파레 SE, 완성 메시지.
     */
    function handleWin() {
        LightsOut._active = false;

        if (LightsOut._switchId > 0) {
            $gameSwitches.setValue(LightsOut._switchId, true);
        }

        AudioManager.playSe({ name: 'Fanfare1', pan: 0, pitch: 100, volume: 90 });

        $gameMessage.add('\\C[14]★ Lights Out 퍼즐 완료! ★\\C[0]');
        $gameMessage.add('모든 전구를 껐습니다!');
        if (LightsOut._switchId > 0) {
            $gameMessage.add('스위치 #' + LightsOut._switchId + ' 가 ON 으로 설정되었습니다.');
        }
    }

    // -------------------------------------------------------------------------
    // INIT 커맨드
    // -------------------------------------------------------------------------

    /**
     * PUZZLE_LIGHTSOUT_INIT switchId
     * 이벤트 note를 파싱하여 _eventMap을 구성하고,
     * 체커보드 초기 패턴을 설정하며 SelfSwitch를 적용합니다.
     */
    function cmdInit(args) {
        var switchId = parseInt(args[0], 10) || 0;
        LightsOut._switchId = switchId;
        LightsOut._active   = true;

        // 이벤트 note 파싱으로 _eventMap 구성
        LightsOut._eventMap = {};
        var events = $gameMap.events();
        events.forEach(function(ev) {
            var data = ev.event();
            if (!data) return;
            var parsed = parseLightNote(data.note);
            if (!parsed) return;
            var r = parsed.row;
            var c = parsed.col;
            if (!LightsOut._eventMap[r]) {
                LightsOut._eventMap[r] = {};
            }
            LightsOut._eventMap[r][c] = ev.eventId();
        });

        // 초기 ON/OFF 패턴 — 체커보드 (솔루션이 존재하는 패턴)
        LightsOut._initGrid = [
            [true,  false, true,  false, true ],
            [false, true,  false, true,  false],
            [true,  false, true,  false, true ],
            [false, true,  false, true,  false],
            [true,  false, true,  false, true ]
        ];
        LightsOut._grid = cloneGrid(LightsOut._initGrid);

        // SelfSwitch 적용
        applyAllSelfSwitches();

        // 안내 메시지
        $gameMessage.add('\\C[6]Lights Out 퍼즐\\C[0]');
        $gameMessage.add('모든 전구를 꺼야 합니다!');
        $gameMessage.add('전구 위에 서면 해당 전구와 상하좌우가 토글됩니다.');
    }

    // -------------------------------------------------------------------------
    // TOGGLE 커맨드
    // -------------------------------------------------------------------------

    /**
     * PUZZLE_LIGHTSOUT_TOGGLE r c
     * (r, c) 및 4방향 인접 셀을 flip하고 SelfSwitch를 갱신합니다.
     * 승리 조건을 충족하면 handleWin()을 호출합니다.
     */
    function cmdToggle(args) {
        if (!LightsOut._active) return;

        var row = parseInt(args[0], 10);
        var col = parseInt(args[1], 10);

        if (isNaN(row) || isNaN(col) || row < 0 || row > 4 || col < 0 || col > 4) {
            console.warn('[PuzzleLightsOut] TOGGLE: 범위를 벗어난 좌표 r=%s c=%s', args[0], args[1]);
            return;
        }

        // 토글할 셀 목록: 자신 + 4방향 인접
        var targets = [
            [row,     col    ],
            [row - 1, col    ],
            [row + 1, col    ],
            [row,     col - 1],
            [row,     col + 1]
        ];

        targets.forEach(function(pos) {
            var nr = pos[0];
            var nc = pos[1];
            if (nr < 0 || nr > 4 || nc < 0 || nc > 4) return;
            LightsOut._grid[nr][nc] = !LightsOut._grid[nr][nc];
            applySelfSwitch(nr, nc);
        });

        // 스위치 토글 SE
        AudioManager.playSe({ name: 'Switch1', pan: 0, pitch: 100, volume: 80 });

        // 승리 체크
        if (checkWin()) {
            handleWin();
        }
    }

    // -------------------------------------------------------------------------
    // RESET 커맨드
    // -------------------------------------------------------------------------

    /**
     * PUZZLE_LIGHTSOUT_RESET
     * 초기 체커보드 패턴으로 리셋하고 SelfSwitch를 갱신합니다.
     */
    function cmdReset() {
        if (LightsOut._initGrid.length === 0) {
            console.warn('[PuzzleLightsOut] RESET: 초기화되지 않은 상태입니다. INIT 먼저 실행하세요.');
            return;
        }
        LightsOut._active = true;
        LightsOut._grid = cloneGrid(LightsOut._initGrid);
        applyAllSelfSwitches();
        AudioManager.playSe({ name: 'Decision1', pan: 0, pitch: 100, volume: 80 });
        $gameMessage.add('퍼즐이 초기 상태로 리셋되었습니다.');
    }

    // -------------------------------------------------------------------------
    // 플러그인 커맨드 등록
    // -------------------------------------------------------------------------

    var _Game_Interpreter_pluginCommand =
        Game_Interpreter.prototype.pluginCommand;

    Game_Interpreter.prototype.pluginCommand = function(command, args) {
        _Game_Interpreter_pluginCommand.call(this, command, args);
        switch (command) {
            case 'PUZZLE_LIGHTSOUT_INIT':
                cmdInit(args);
                break;
            case 'PUZZLE_LIGHTSOUT_TOGGLE':
                cmdToggle(args);
                break;
            case 'PUZZLE_LIGHTSOUT_RESET':
                cmdReset();
                break;
        }
    };

    // -------------------------------------------------------------------------
    // 편의 API — 이벤트 스크립트에서 직접 호출 가능
    // -------------------------------------------------------------------------

    /**
     * 이벤트 스크립트에서:
     *   $gameMap.callPuzzleLightsOutToggle(r, c)
     */
    Game_Map.prototype.callPuzzleLightsOutToggle = function(r, c) {
        cmdToggle([String(r), String(c)]);
    };

    // -------------------------------------------------------------------------
    // Scene_Map 훅 — 맵을 나갈 때 _active = false
    // -------------------------------------------------------------------------

    var _Scene_Map_stop = Scene_Map.prototype.stop;
    Scene_Map.prototype.stop = function() {
        _Scene_Map_stop.call(this);
        // 맵 이동 또는 메뉴 등으로 씬이 정지될 때 active 해제.
        // SelfSwitch 상태는 $gameSelfSwitches에 보존되므로,
        // 같은 맵으로 돌아와도 전구 상태는 유지됩니다.
        LightsOut._active = false;
    };

    /**
     * Scene_Map.start 시 퍼즐 맵으로 복귀했을 때 active를 복원합니다.
     * (전투 후 귀환 등)
     */
    var _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        _Scene_Map_start.call(this);
        // _initGrid가 설정되어 있고, 현재 맵에 light 이벤트가 존재하면 복원
        if (LightsOut._initGrid.length > 0 && !LightsOut._active) {
            var hasLightEvent = $gameMap.events().some(function(ev) {
                var data = ev.event();
                return data && parseLightNote(data.note) !== null;
            });
            if (hasLightEvent) {
                LightsOut._active = true;
            }
        }
    };

    // -------------------------------------------------------------------------
    // 전역 노출 (디버그용)
    // -------------------------------------------------------------------------
    window.PuzzleLightsOut = LightsOut;

})();
