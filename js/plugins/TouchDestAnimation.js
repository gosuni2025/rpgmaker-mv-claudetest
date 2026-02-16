/*:
 * @pluginname 터치 목적지 애니메이션
 * @plugindesc 터치/클릭 목적지에 RPG Maker 애니메이션 재생 및 이동경로 화살표 표시
 * @author Claude
 *
 * @param Animation ID
 * @type animation
 * @desc 터치 시 재생할 애니메이션 ID (0 = 비활성)
 * @default 0
 *
 * @param Hide Default
 * @type boolean
 * @desc 기존 흰색 펄스 목적지 스프라이트를 숨길지 여부
 * @default true
 *
 * @param Show Path Arrow
 * @type boolean
 * @desc 플레이어에서 목적지까지 이동경로 화살표를 표시할지 여부
 * @default true
 *
 * @param Arrow Color
 * @desc 화살표 색상 (CSS 색상값)
 * @default rgba(255, 255, 255, 0.7)
 *
 * @help
 * 맵을 터치/클릭하면 기본 흰색 사각형 펄스 대신
 * 지정한 RPG Maker 애니메이션을 해당 위치에 재생합니다.
 *
 * Animation ID: $dataAnimations에서 사용할 애니메이션 번호
 * Hide Default: true이면 기존 Sprite_Destination 숨김
 * Show Path Arrow: true이면 이동경로를 화살표로 표시
 * Arrow Color: 화살표 색상
 */

(function() {

    var parameters = PluginManager.parameters('TouchDestAnimation');
    var animationId = Number(parameters['Animation ID'] || 0);
    var hideDefault = String(parameters['Hide Default']) !== 'false';
    var showPathArrow = String(parameters['Show Path Arrow']) !== 'false';
    var arrowColor = String(parameters['Arrow Color'] || 'rgba(255, 255, 255, 0.7)');

    var _lastDestX = -1;
    var _lastDestY = -1;

    // Hide Default: Sprite_Destination.update를 차단하여 visible=true 방지
    if (hideDefault) {
        Sprite_Destination.prototype.update = function() {
            this.visible = false;
        };
    }

    //=========================================================================
    // A* 경로 탐색 - 전체 경로를 배열로 반환
    //=========================================================================
    function findPath(startX, startY, goalX, goalY) {
        var searchLimit = $gamePlayer.searchLimit();
        var mapWidth = $gameMap.width();
        var nodeList = [];
        var openList = [];
        var closedList = [];
        var start = {};
        var best = start;

        if (startX === goalX && startY === goalY) return [];

        start.parent = null;
        start.x = startX;
        start.y = startY;
        start.g = 0;
        start.f = $gameMap.distance(startX, startY, goalX, goalY);
        nodeList.push(start);
        openList.push(start.y * mapWidth + start.x);

        while (nodeList.length > 0) {
            var bestIndex = 0;
            for (var i = 0; i < nodeList.length; i++) {
                if (nodeList[i].f < nodeList[bestIndex].f) {
                    bestIndex = i;
                }
            }

            var current = nodeList[bestIndex];
            var x1 = current.x;
            var y1 = current.y;
            var pos1 = y1 * mapWidth + x1;
            var g1 = current.g;

            nodeList.splice(bestIndex, 1);
            openList.splice(openList.indexOf(pos1), 1);
            closedList.push(pos1);

            if (current.x === goalX && current.y === goalY) {
                best = current;
                break;
            }

            if (g1 >= searchLimit) continue;

            for (var j = 0; j < 4; j++) {
                var direction = 2 + j * 2;
                var x2 = $gameMap.roundXWithDirection(x1, direction);
                var y2 = $gameMap.roundYWithDirection(y1, direction);
                var pos2 = y2 * mapWidth + x2;

                if (closedList.indexOf(pos2) >= 0) continue;
                if (!$gamePlayer.canPass(x1, y1, direction)) continue;

                var g2 = g1 + 1;
                var index2 = openList.indexOf(pos2);

                if (index2 < 0 || g2 < nodeList[index2].g) {
                    var neighbor;
                    if (index2 >= 0) {
                        neighbor = nodeList[index2];
                    } else {
                        neighbor = {};
                        nodeList.push(neighbor);
                        openList.push(pos2);
                    }
                    neighbor.parent = current;
                    neighbor.x = x2;
                    neighbor.y = y2;
                    neighbor.g = g2;
                    neighbor.f = g2 + $gameMap.distance(x2, y2, goalX, goalY);
                    if (!best || neighbor.f - neighbor.g < best.f - best.g) {
                        best = neighbor;
                    }
                }
            }
        }

        // best에서 start까지 역추적하여 경로 생성
        var path = [];
        var node = best;
        while (node && node !== start) {
            path.unshift({ x: node.x, y: node.y });
            node = node.parent;
        }
        return path;
    }

    //=========================================================================
    // 화살표 스프라이트
    //=========================================================================
    var _Spriteset_Map_createDestination = Spriteset_Map.prototype.createDestination;
    Spriteset_Map.prototype.createDestination = function() {
        _Spriteset_Map_createDestination.call(this);

        // 애니메이션용 스프라이트
        if (animationId > 0) {
            this._touchAnimSprite = new Sprite_Base();
            this._touchAnimSprite.anchor.x = 0.5;
            this._touchAnimSprite.anchor.y = 0.5;
            this._touchAnimSprite.bitmap = new Bitmap(48, 48);
            this._touchAnimSprite.z = 9;
            this._tilemap.addChild(this._touchAnimSprite);
        }

        // 경로 화살표 스프라이트
        if (showPathArrow) {
            this._pathArrowSprite = new Sprite();
            this._pathArrowSprite.z = 8;
            this._pathArrowSprite.bitmap = new Bitmap(
                $gameMap.width() * $gameMap.tileWidth(),
                $gameMap.height() * $gameMap.tileHeight()
            );
            this._tilemap.addChild(this._pathArrowSprite);
            this._currentPath = [];
        }

        _lastDestX = -1;
        _lastDestY = -1;
    };

    var _Spriteset_Map_update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function() {
        _Spriteset_Map_update.call(this);
        this.updateTouchDestAnimation();
        this.updatePathArrow();
    };

    //=========================================================================
    // 목적지 애니메이션 업데이트
    //=========================================================================
    Spriteset_Map.prototype.updateTouchDestAnimation = function() {
        if (!this._touchAnimSprite) return;
        if (animationId <= 0) return;

        if ($gameTemp.isDestinationValid()) {
            var destX = $gameTemp.destinationX();
            var destY = $gameTemp.destinationY();
            var tw = $gameMap.tileWidth();
            var th = $gameMap.tileHeight();

            if (destX !== _lastDestX || destY !== _lastDestY) {
                _lastDestX = destX;
                _lastDestY = destY;
                this._touchAnimSprite.x = $gameMap.adjustX(destX) * tw + tw / 2;
                this._touchAnimSprite.y = $gameMap.adjustY(destY) * th + th / 2;
                var anim = $dataAnimations[animationId];
                if (anim) {
                    this._touchAnimSprite.startAnimation(anim, false, 0);
                }
            } else {
                this._touchAnimSprite.x = $gameMap.adjustX(destX) * tw + tw / 2;
                this._touchAnimSprite.y = $gameMap.adjustY(destY) * th + th / 2;
            }
        } else {
            _lastDestX = -1;
            _lastDestY = -1;
        }
    };

    //=========================================================================
    // 경로 화살표 업데이트
    //=========================================================================
    var _pathLastPlayerX = -1;
    var _pathLastPlayerY = -1;
    var _pathLastDestX = -1;
    var _pathLastDestY = -1;

    Spriteset_Map.prototype.updatePathArrow = function() {
        if (!this._pathArrowSprite) return;

        if (!$gameTemp.isDestinationValid()) {
            if (this._currentPath.length > 0) {
                this._currentPath = [];
                this._pathArrowSprite.bitmap.clear();
            }
            _pathLastPlayerX = -1;
            _pathLastPlayerY = -1;
            _pathLastDestX = -1;
            _pathLastDestY = -1;
            return;
        }

        var destX = $gameTemp.destinationX();
        var destY = $gameTemp.destinationY();
        var playerX = $gamePlayer.x;
        var playerY = $gamePlayer.y;

        // 플레이어 위치나 목적지가 변경되면 경로 재계산
        if (playerX !== _pathLastPlayerX || playerY !== _pathLastPlayerY ||
            destX !== _pathLastDestX || destY !== _pathLastDestY) {
            _pathLastPlayerX = playerX;
            _pathLastPlayerY = playerY;
            _pathLastDestX = destX;
            _pathLastDestY = destY;
            this._currentPath = findPath(playerX, playerY, destX, destY);
            this.drawPathArrow();
        }
    };

    Spriteset_Map.prototype.drawPathArrow = function() {
        var bitmap = this._pathArrowSprite.bitmap;
        bitmap.clear();

        var path = this._currentPath;
        if (path.length === 0) return;

        var tw = $gameMap.tileWidth();
        var th = $gameMap.tileHeight();
        var ctx = bitmap._context;

        ctx.save();
        ctx.strokeStyle = arrowColor;
        ctx.fillStyle = arrowColor;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 시작점: 플레이어 위치
        var startX = _pathLastPlayerX * tw + tw / 2;
        var startY = _pathLastPlayerY * th + th / 2;

        // 경로 선 그리기
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        for (var i = 0; i < path.length; i++) {
            var px = path[i].x * tw + tw / 2;
            var py = path[i].y * th + th / 2;
            ctx.lineTo(px, py);
        }
        ctx.stroke();

        // 끝점 화살촉 그리기
        if (path.length >= 1) {
            var last = path[path.length - 1];
            var prev = path.length >= 2 ? path[path.length - 2] :
                       { x: _pathLastPlayerX, y: _pathLastPlayerY };

            var endX = last.x * tw + tw / 2;
            var endY = last.y * th + th / 2;
            var dx = last.x - prev.x;
            var dy = last.y - prev.y;
            var angle = Math.atan2(dy, dx);
            var arrowSize = 10;

            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(
                endX - arrowSize * Math.cos(angle - Math.PI / 6),
                endY - arrowSize * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
                endX - arrowSize * Math.cos(angle + Math.PI / 6),
                endY - arrowSize * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fill();
        }

        ctx.restore();
        bitmap._setDirty();
    };

})();
