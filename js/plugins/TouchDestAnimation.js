/*:
 * @plugindesc 터치/클릭 목적지에 RPG Maker 애니메이션 재생
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
 * @help
 * 맵을 터치/클릭하면 기본 흰색 사각형 펄스 대신
 * 지정한 RPG Maker 애니메이션을 해당 위치에 재생합니다.
 *
 * Animation ID: $dataAnimations에서 사용할 애니메이션 번호
 * Hide Default: true이면 기존 Sprite_Destination 숨김
 */

(function() {

    var parameters = PluginManager.parameters('TouchDestAnimation');
    var animationId = Number(parameters['Animation ID'] || 0);
    var hideDefault = String(parameters['Hide Default']) !== 'false';

    var _lastDestX = -1;
    var _lastDestY = -1;

    // Spriteset_Map.createDestination 래핑 - 애니메이션용 스프라이트 생성
    var _Spriteset_Map_createDestination = Spriteset_Map.prototype.createDestination;
    Spriteset_Map.prototype.createDestination = function() {
        _Spriteset_Map_createDestination.call(this);
        this._touchAnimSprite = new Sprite_Base();
        this._touchAnimSprite.anchor.x = 0.5;
        this._touchAnimSprite.anchor.y = 0.5;
        // Sprite_Base에 빈 비트맵을 설정해야 애니메이션이 올바르게 위치함
        this._touchAnimSprite.bitmap = new Bitmap(48, 48);
        this._touchAnimSprite.z = 9;
        this._tilemap.addChild(this._touchAnimSprite);
        _lastDestX = -1;
        _lastDestY = -1;
    };

    // Spriteset_Map.update 래핑 - 목적지 변경 감지 및 애니메이션 재생
    var _Spriteset_Map_update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function() {
        _Spriteset_Map_update.call(this);
        this.updateTouchDestAnimation();
    };

    Spriteset_Map.prototype.updateTouchDestAnimation = function() {
        if (!this._touchAnimSprite) return;
        if (animationId <= 0) return;

        if ($gameTemp.isDestinationValid()) {
            var destX = $gameTemp.destinationX();
            var destY = $gameTemp.destinationY();

            if (destX !== _lastDestX || destY !== _lastDestY) {
                _lastDestX = destX;
                _lastDestY = destY;

                // 스프라이트 위치를 타일 중앙으로 설정
                var tw = $gameMap.tileWidth();
                var th = $gameMap.tileHeight();
                this._touchAnimSprite.x = $gameMap.adjustX(destX) * tw + tw / 2;
                this._touchAnimSprite.y = $gameMap.adjustY(destY) * th + th / 2;

                // 애니메이션 재생
                var anim = $dataAnimations[animationId];
                if (anim) {
                    this._touchAnimSprite.startAnimation(anim, false, 0);
                }
            } else {
                // 스크롤에 따른 위치 업데이트
                var tw = $gameMap.tileWidth();
                var th = $gameMap.tileHeight();
                this._touchAnimSprite.x = $gameMap.adjustX(destX) * tw + tw / 2;
                this._touchAnimSprite.y = $gameMap.adjustY(destY) * th + th / 2;
            }

            // 기존 목적지 스프라이트 숨기기
            if (hideDefault && this._destinationSprite) {
                this._destinationSprite.visible = false;
            }
        } else {
            _lastDestX = -1;
            _lastDestY = -1;
        }
    };

})();
