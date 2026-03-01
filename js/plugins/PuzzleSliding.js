/*:
 * @plugindesc 인게임 슬라이딩 퍼즐 — 실제 맵에서 이벤트를 이동시켜 퍼즐을 푼다.
 * @author Claude
 *
 * @help
 * ============================================================
 * PuzzleSliding.js
 * ============================================================
 *
 * 플레이어가 맵(Map023, 13×13)에서 직접 슬라이딩 퍼즐을 푸는 플러그인.
 * 씬 전환 없이 실제 이벤트 오브젝트를 이동시켜 퍼즐을 구현한다.
 *
 * ■ 맵 구성
 *   - 9개 이벤트: ev1~ev8 = 조각1~8, ev9 = 빈칸
 *   - 각 이벤트 note: <slide n=N>  (N=1~8: 조각, N=9: 빈칸)
 *   - 그리드 (gx, gy) → 월드 (gx*3+3, gy*3+3)  — 3×3 슬롯, 간격 3타일
 *
 * ■ 이벤트 페이지 설정
 *   - trigger: 0 (액션버튼)
 *   - priorityType: 1 (이동 차단)
 *   - 이벤트 커맨드 없이 note만 설정하면 됨 (플러그인이 처리)
 *
 * ■ 플러그인 커맨드
 *   PUZZLE_SLIDING_INIT switchId
 *     퍼즐 초기화 + 섞기 + 안내 메시지 표시
 *     switchId: 완성 시 ON 할 스위치 번호
 *
 *   PUZZLE_SLIDING_RESET
 *     퍼즐을 다시 섞고 재시작
 *
 * ============================================================
 */

(function() {
    'use strict';

    // ============================================================
    // 상수
    // ============================================================
    var GRID_SIZE = 3;
    var COLORS = [
        '#cc3333', '#33cc33', '#3333cc', '#cccc33',
        '#33cccc', '#cc33cc', '#cc8833', '#888888'
    ];

    // ============================================================
    // Sliding 메인 객체
    // ============================================================
    var Sliding = {
        _active: false,
        _switchId: 0,
        _grid: [],       // _grid[gy][gx] = { eventId, n } or null(빈칸)
        _emptyGx: 2,
        _emptyGy: 2,
        _numberSprites: [],
        _mapId: 0
    };

    // -------------------------------------------------------
    // 그리드 초기화 (이벤트 note 파싱)
    // -------------------------------------------------------
    Sliding.buildGridFromEvents = function() {
        this._grid = [];
        for (var gy = 0; gy < GRID_SIZE; gy++) {
            this._grid[gy] = [];
            for (var gx = 0; gx < GRID_SIZE; gx++) {
                this._grid[gy][gx] = null;
            }
        }

        var events = $gameMap.events();
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var note = ev.event().note || '';
            var m = note.match(/<slide\s+n=(\d+)>/i);
            if (!m) continue;
            var n = parseInt(m[1]);
            // 해결된 상태 기준 위치 계산 (n=1 at (0,0), ..., n=9=empty at (2,2))
            var idx = n - 1; // 0~8
            var gx2 = idx % GRID_SIZE;
            var gy2 = Math.floor(idx / GRID_SIZE);
            if (n === 9) {
                this._grid[gy2][gx2] = null; // 빈칸
                this._emptyGx = gx2;
                this._emptyGy = gy2;
            } else {
                this._grid[gy2][gx2] = { eventId: ev.eventId(), n: n };
            }
        }
    };

    // -------------------------------------------------------
    // 랜덤 섞기 (200번 유효한 이동으로 솔루블 보장)
    // -------------------------------------------------------
    Sliding.shuffle = function() {
        var dirs = [
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
            { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
        ];
        var lastDx = 0, lastDy = 0;

        for (var i = 0; i < 200; i++) {
            // 유효한 이동 방향 수집 (직전 역방향 제외로 ping-pong 방지)
            var valid = [];
            for (var d = 0; d < dirs.length; d++) {
                var dir = dirs[d];
                var nx = this._emptyGx + dir.dx;
                var ny = this._emptyGy + dir.dy;
                var isReverse = (dir.dx === -lastDx && dir.dy === -lastDy);
                if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE && !isReverse) {
                    valid.push(dir);
                }
            }
            if (valid.length === 0) continue;
            var chosen = valid[Math.floor(Math.random() * valid.length)];
            var px = this._emptyGx + chosen.dx;
            var py = this._emptyGy + chosen.dy;
            this._swapGrid(px, py, this._emptyGx, this._emptyGy);
            this._emptyGx -= chosen.dx;
            this._emptyGy -= chosen.dy;
            lastDx = chosen.dx;
            lastDy = chosen.dy;
        }
    };

    // -------------------------------------------------------
    // 그리드 swap (위치만 교환, 이벤트 locate 없음)
    // -------------------------------------------------------
    Sliding._swapGrid = function(ax, ay, bx, by) {
        var tmp = this._grid[ay][ax];
        this._grid[ay][ax] = this._grid[by][bx];
        this._grid[by][bx] = tmp;
    };

    // -------------------------------------------------------
    // 그리드 위치 → 월드 좌표 변환
    // -------------------------------------------------------
    Sliding.gridToWorld = function(gx, gy) {
        return { wx: gx * 3 + 3, wy: gy * 3 + 3 };
    };

    // -------------------------------------------------------
    // 모든 이벤트를 그리드 위치로 이동
    // -------------------------------------------------------
    Sliding.relocateAll = function() {
        for (var gy = 0; gy < GRID_SIZE; gy++) {
            for (var gx = 0; gx < GRID_SIZE; gx++) {
                var cell = this._grid[gy][gx];
                if (!cell) continue;
                var ev = $gameMap.event(cell.eventId);
                if (!ev) continue;
                var pos = this.gridToWorld(gx, gy);
                ev.locate(pos.wx, pos.wy);
            }
        }
        // 빈칸 이벤트(n=9)도 이동
        var emptyEv = this.findEventByN(9);
        if (emptyEv) {
            var emptyPos = this.gridToWorld(this._emptyGx, this._emptyGy);
            emptyEv.locate(emptyPos.wx, emptyPos.wy);
        }
    };

    // -------------------------------------------------------
    // n값으로 이벤트 찾기
    // -------------------------------------------------------
    Sliding.findEventByN = function(n) {
        var events = $gameMap.events();
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var note = ev.event().note || '';
            var m = note.match(/<slide\s+n=(\d+)>/i);
            if (m && parseInt(m[1]) === n) return ev;
        }
        return null;
    };

    // -------------------------------------------------------
    // 그리드에서 n값으로 위치 찾기
    // -------------------------------------------------------
    Sliding.findPosByN = function(n) {
        for (var gy = 0; gy < GRID_SIZE; gy++) {
            for (var gx = 0; gx < GRID_SIZE; gx++) {
                var cell = this._grid[gy][gx];
                if (cell && cell.n === n) return { gx: gx, gy: gy };
            }
        }
        return null;
    };

    // -------------------------------------------------------
    // 조각 인터랙션 (Z키/액션으로 조각 터치 시)
    // -------------------------------------------------------
    Sliding.interactPiece = function(n) {
        if (n === 9) return; // 빈칸 클릭 무시

        var pos = this.findPosByN(n);
        if (!pos) return;

        var px = pos.gx, py = pos.gy;
        var ex = this._emptyGx, ey = this._emptyGy;

        // 인접 여부 확인 (맨해튼 거리 1)
        if (Math.abs(px - ex) + Math.abs(py - ey) !== 1) {
            // 인접하지 않음 — 무시
            return;
        }

        // 그리드 swap
        var pieceCell = this._grid[py][px];
        this._grid[ey][ex] = pieceCell;
        this._grid[py][px] = null;
        this._emptyGx = px;
        this._emptyGy = py;

        // 이벤트 이동
        var pieceEv = $gameMap.event(pieceCell.eventId);
        if (pieceEv) {
            var newPos = this.gridToWorld(ex, ey);
            pieceEv.locate(newPos.wx, newPos.wy);
        }
        // 빈칸 이벤트도 이동
        var emptyEv = this.findEventByN(9);
        if (emptyEv) {
            var emptyPos2 = this.gridToWorld(px, py);
            emptyEv.locate(emptyPos2.wx, emptyPos2.wy);
        }

        // 슬라이드 SE
        AudioManager.playSe({ name: 'Cursor1', pan: 0, pitch: 100, volume: 90 });

        // 승리 체크
        if (this.isSolved()) {
            this.onSolved();
        }
    };

    // -------------------------------------------------------
    // 승리 조건 체크
    // -------------------------------------------------------
    Sliding.isSolved = function() {
        if (this._emptyGx !== GRID_SIZE - 1 || this._emptyGy !== GRID_SIZE - 1) return false;
        for (var gy = 0; gy < GRID_SIZE; gy++) {
            for (var gx = 0; gx < GRID_SIZE; gx++) {
                if (gx === GRID_SIZE - 1 && gy === GRID_SIZE - 1) continue; // 빈칸
                var cell = this._grid[gy][gx];
                if (!cell) return false;
                var expectedN = gy * GRID_SIZE + gx + 1;
                if (cell.n !== expectedN) return false;
            }
        }
        return true;
    };

    // -------------------------------------------------------
    // 완성 처리
    // -------------------------------------------------------
    Sliding.onSolved = function() {
        AudioManager.playSe({ name: 'Fanfare1', pan: 0, pitch: 100, volume: 90 });
        if (this._switchId > 0) {
            $gameSwitches.setValue(this._switchId, true);
        }
        this._active = false;
        this.removeNumberSprites();
        // 완성 메시지
        $gameMessage.add('퍼즐 완성!');
        $gameMessage.add('훌륭합니다! 모든 조각을 올바르게 배열했습니다!');
    };

    // ============================================================
    // 번호 스프라이트
    // ============================================================
    Sliding.createNumberSprites = function() {
        this.removeNumberSprites();
        var spriteset = SceneManager._scene && SceneManager._scene._spriteset;
        if (!spriteset) return;
        if (!spriteset._tilemap) return;

        for (var gy = 0; gy < GRID_SIZE; gy++) {
            for (var gx = 0; gx < GRID_SIZE; gx++) {
                var cell = this._grid[gy][gx];
                if (!cell) continue; // 빈칸은 스프라이트 없음

                var n = cell.n;
                var color = COLORS[n - 1] || '#888888';
                var bmp = new Bitmap(48, 48);
                // 배경 색상
                bmp.fillRect(2, 2, 44, 44, color);
                // 테두리 (흰색)
                bmp.fillRect(0, 0, 48, 2, '#ffffff');
                bmp.fillRect(0, 46, 48, 2, '#ffffff');
                bmp.fillRect(0, 0, 2, 48, '#ffffff');
                bmp.fillRect(46, 0, 2, 48, '#ffffff');
                // 숫자
                bmp.textColor = '#ffffff';
                bmp.fontSize = 22;
                bmp.fontBold = true;
                bmp.drawText(String(n), 0, 8, 48, 32, 'center');

                var sprite = new Sprite(bmp);
                sprite.anchor.x = 0.5;
                sprite.anchor.y = 0.5;
                sprite.z = 6; // upper tile 위에 표시
                sprite._puzzleEventId = cell.eventId;

                spriteset._tilemap.addChild(sprite);
                this._numberSprites.push(sprite);
            }
        }
    };

    // -------------------------------------------------------
    // 번호 스프라이트 위치 업데이트 (매 프레임)
    // -------------------------------------------------------
    Sliding.updateNumberSprites = function() {
        if (!this._active) return;
        for (var i = 0; i < this._numberSprites.length; i++) {
            var sprite = this._numberSprites[i];
            var ev = $gameMap.event(sprite._puzzleEventId);
            if (!ev) continue;
            sprite.x = ev.screenX();
            sprite.y = ev.screenY() - $gameMap.tileHeight() / 2;
        }
    };

    // -------------------------------------------------------
    // 번호 스프라이트 제거
    // -------------------------------------------------------
    Sliding.removeNumberSprites = function() {
        for (var i = 0; i < this._numberSprites.length; i++) {
            var sprite = this._numberSprites[i];
            if (sprite.parent) sprite.parent.removeChild(sprite);
            if (sprite.bitmap) sprite.bitmap.destroy();
        }
        this._numberSprites = [];
    };

    // ============================================================
    // 초기화 진입점
    // ============================================================
    Sliding.init = function(switchId) {
        this._switchId = switchId || 0;
        this._mapId = $gameMap.mapId();
        this._active = false;

        // 1. 이벤트 파싱으로 그리드 구성 (solved state)
        this.buildGridFromEvents();

        // 2. 섞기
        this.shuffle();

        // 3. 이벤트 이동
        this.relocateAll();

        // 4. 번호 스프라이트 생성
        this.createNumberSprites();

        // 5. 퍼즐 활성화
        this._active = true;

        // 6. 안내 메시지
        $gameMessage.add('슬라이딩 퍼즐');
        $gameMessage.add('조각을 올바른 순서로 배열하세요!');
        $gameMessage.add('Z키로 조각 이동 | 목표: 1~8 순서대로');
    };

    // ============================================================
    // 플러그인 커맨드 후킹
    // ============================================================
    var _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function(command, args) {
        _Game_Interpreter_pluginCommand.call(this, command, args);
        if (command === 'PUZZLE_SLIDING_INIT') {
            var switchId = parseInt(args[0]) || 0;
            Sliding.init(switchId);
        } else if (command === 'PUZZLE_SLIDING_RESET') {
            if (!Sliding._active) return;
            Sliding.removeNumberSprites();
            Sliding._active = false;
            Sliding.buildGridFromEvents();
            Sliding.shuffle();
            Sliding.relocateAll();
            Sliding.createNumberSprites();
            Sliding._active = true;
            $gameMessage.add('퍼즐을 다시 섞었습니다. 도전해보세요!');
        }
    };

    // ============================================================
    // Game_Event.prototype.start 후킹 — 조각 터치 처리
    // ============================================================
    var _Game_Event_start = Game_Event.prototype.start;
    Game_Event.prototype.start = function() {
        if (Sliding._active) {
            var note = this.event().note || '';
            var m = note.match(/<slide\s+n=(\d+)>/i);
            if (m) {
                Sliding.interactPiece(parseInt(m[1]));
                return; // 이벤트 페이지 실행 방지
            }
        }
        _Game_Event_start.call(this);
    };

    // ============================================================
    // Spriteset_Map.prototype.update 후킹 — 스프라이트 위치 매 프레임 갱신
    // ============================================================
    var _Spriteset_Map_update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function() {
        _Spriteset_Map_update.call(this);
        Sliding.updateNumberSprites();
    };

    // ============================================================
    // 맵 전환 시 정리 — Scene_Map.prototype.terminate 후킹
    // ============================================================
    var _Scene_Map_terminate = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function() {
        if (Sliding._active) {
            Sliding.removeNumberSprites();
            Sliding._active = false;
        }
        _Scene_Map_terminate.call(this);
    };

    // ============================================================
    // Scene_Map onMapLoaded 후킹 — 동일 맵 재진입 시 스프라이트 재생성
    // ============================================================
    var _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function() {
        _Scene_Map_onMapLoaded.call(this);
        if (Sliding._active && $gameMap.mapId() === Sliding._mapId) {
            // spriteset이 준비된 후 스프라이트 재생성
            var self = this;
            setTimeout(function() {
                Sliding.createNumberSprites();
            }, 100);
        } else if ($gameMap.mapId() !== Sliding._mapId) {
            // 다른 맵으로 이동 시 리셋
            Sliding._active = false;
            Sliding._numberSprites = [];
        }
    };

})();
