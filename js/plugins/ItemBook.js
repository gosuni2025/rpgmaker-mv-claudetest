//=============================================================================
// ItemBook.js — 아이템 도감
//=============================================================================

/*:
 * @plugindesc 아이템/무기/방어구 도감. 획득한 아이템을 기록하여 목록으로 열람.
 * @author custom
 *
 * @param Unknown Data
 * @desc 미확인 아이템에 표시할 텍스트
 * @default ??????
 *
 * @param Price Text
 * @default 가격
 *
 * @param Equip Text
 * @default 장비
 *
 * @param Type Text
 * @default 타입
 *
 * @help
 * Plugin Command:
 *   ItemBook open            # 도감 열기
 *   ItemBook complete        # 전 아이템 등록
 *   ItemBook clear           # 등록 초기화
 *   ItemBook add weapon 3    # 무기 #3 등록
 *   ItemBook add armor 4     # 방어구 #4 등록
 *   ItemBook remove item 5   # 아이템 #5 제거
 *
 * 아이템 메모:
 *   <book:no>   # 도감에 표시하지 않음
 */

(function() {

    var parameters  = PluginManager.parameters('ItemBook');
    var unknownData = String(parameters['Unknown Data'] || '??????');
    var priceText   = String(parameters['Price Text']   || '가격');
    var equipText   = String(parameters['Equip Text']   || '장비');
    var typeText    = String(parameters['Type Text']    || '타입');

    //-------------------------------------------------------------------------
    // Plugin Command
    //-------------------------------------------------------------------------
    var _pluginCommand = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function(command, args) {
        _pluginCommand.call(this, command, args);
        if (command !== 'ItemBook') return;
        switch (args[0]) {
        case 'open':     SceneManager.push(Scene_ItemBook); break;
        case 'add':      $gameSystem.addToItemBook(args[1], Number(args[2])); break;
        case 'remove':   $gameSystem.removeFromItemBook(args[1], Number(args[2])); break;
        case 'complete': $gameSystem.completeItemBook(); break;
        case 'clear':    $gameSystem.clearItemBook(); break;
        }
    };

    //-------------------------------------------------------------------------
    // Game_System — 도감 데이터 관리
    //-------------------------------------------------------------------------
    Game_System.prototype.clearItemBook = function() {
        this._itemBookFlags = [[], [], []]; // [0]=item [1]=weapon [2]=armor
    };

    Game_System.prototype._itemBookTypeIndex = function(type) {
        return type === 'item' ? 0 : type === 'weapon' ? 1 : type === 'armor' ? 2 : -1;
    };

    Game_System.prototype.addToItemBook = function(type, dataId) {
        if (!this._itemBookFlags) this.clearItemBook();
        var i = this._itemBookTypeIndex(type);
        if (i >= 0) this._itemBookFlags[i][dataId] = true;
    };

    Game_System.prototype.removeFromItemBook = function(type, dataId) {
        if (!this._itemBookFlags) return;
        var i = this._itemBookTypeIndex(type);
        if (i >= 0) this._itemBookFlags[i][dataId] = false;
    };

    Game_System.prototype.completeItemBook = function() {
        var i;
        this.clearItemBook();
        for (i = 1; i < $dataItems.length;   i++) this._itemBookFlags[0][i] = true;
        for (i = 1; i < $dataWeapons.length;  i++) this._itemBookFlags[1][i] = true;
        for (i = 1; i < $dataArmors.length;   i++) this._itemBookFlags[2][i] = true;
    };

    Game_System.prototype.isInItemBook = function(item) {
        if (!this._itemBookFlags || !item) return false;
        var i = DataManager.isItem(item) ? 0 : DataManager.isWeapon(item) ? 1 : DataManager.isArmor(item) ? 2 : -1;
        return i >= 0 ? !!this._itemBookFlags[i][item.id] : false;
    };

    // 아이템 획득 시 자동 등록
    var _gainItem = Game_Party.prototype.gainItem;
    Game_Party.prototype.gainItem = function(item, amount, includeEquip) {
        _gainItem.call(this, item, amount, includeEquip);
        if (item && amount > 0) {
            var type = DataManager.isItem(item) ? 'item' : DataManager.isWeapon(item) ? 'weapon' : 'armor';
            $gameSystem.addToItemBook(type, item.id);
        }
    };

    //=========================================================================
    // Scene_ItemBook
    //
    //  ┌────────────┐ ┌─────────────────────────────┐
    //  │ 001 [i] 이름│ │  stats                      │
    //  │ 002 [i] 이름│ │                             │
    //  │  ...       │ ├─────────────────────────────┤
    //  │            │ │  description                │
    //  └────────────┘ └─────────────────────────────┘
    //=========================================================================
    function Scene_ItemBook() { this.initialize.apply(this, arguments); }
    Scene_ItemBook.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_ItemBook.prototype.constructor = Scene_ItemBook;

    Scene_ItemBook.prototype.initialize = function() {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_ItemBook.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);

        var lw = 240;
        var rw = Graphics.boxWidth - lw;
        var rh = Math.floor(Graphics.boxHeight * 0.55);

        this._indexWindow  = new Window_ItemBookIndex(0, 0, lw, Graphics.boxHeight);
        this._statusWindow = new Window_ItemBookStatus(lw, 0, rw, rh);
        this._descWindow   = new Window_ItemBookDesc(lw, rh, rw, Graphics.boxHeight - rh);

        this._indexWindow.setHandler('cancel', this.popScene.bind(this));
        this._indexWindow.setStatusWindow(this._statusWindow);
        this._indexWindow.setDescWindow(this._descWindow);

        this.addWindow(this._indexWindow);
        this.addWindow(this._statusWindow);
        this.addWindow(this._descWindow);
    };

    //=========================================================================
    // Window_ItemBookIndex — 왼쪽 목록
    //=========================================================================
    function Window_ItemBookIndex() { this.initialize.apply(this, arguments); }
    Window_ItemBookIndex.prototype = Object.create(Window_Selectable.prototype);
    Window_ItemBookIndex.prototype.constructor = Window_ItemBookIndex;
    Window_ItemBookIndex.lastTopRow = 0;
    Window_ItemBookIndex.lastIndex  = 0;

    Window_ItemBookIndex.prototype.initialize = function(x, y, width, height) {
        Window_Selectable.prototype.initialize.call(this, x, y, width, height);
        this.refresh();
        this.setTopRow(Window_ItemBookIndex.lastTopRow);
        this.select(Window_ItemBookIndex.lastIndex);
        this.activate();
    };

    Window_ItemBookIndex.prototype.maxCols  = function() { return 1; };
    Window_ItemBookIndex.prototype.maxItems = function() { return this._list ? this._list.length : 0; };

    Window_ItemBookIndex.prototype.setStatusWindow = function(w) { this._statusWindow = w; this._updateRight(); };
    Window_ItemBookIndex.prototype.setDescWindow   = function(w) { this._descWindow   = w; this._updateRight(); };

    Window_ItemBookIndex.prototype.update = function() {
        Window_Selectable.prototype.update.call(this);
        this._updateRight();
    };

    Window_ItemBookIndex.prototype._updateRight = function() {
        var item = this._list ? this._list[this.index()] : null;
        if (this._statusWindow) this._statusWindow.setItem(item);
        if (this._descWindow)   this._descWindow.setItem(item);
    };

    Window_ItemBookIndex.prototype.refresh = function() {
        var i, item;
        this._list = [];
        for (i = 1; i < $dataItems.length;   i++) {
            item = $dataItems[i];
            if (item && item.name && item.itypeId === 1 && item.meta.book !== 'no') this._list.push(item);
        }
        for (i = 1; i < $dataWeapons.length;  i++) {
            item = $dataWeapons[i];
            if (item && item.name && item.meta.book !== 'no') this._list.push(item);
        }
        for (i = 1; i < $dataArmors.length;   i++) {
            item = $dataArmors[i];
            if (item && item.name && item.meta.book !== 'no') this._list.push(item);
        }
        this.createContents();
        this.drawAllItems();
    };

    Window_ItemBookIndex.prototype.drawItem = function(index) {
        var item  = this._list[index];
        var rect  = this.itemRectForText(index);
        var known = $gameSystem.isInItemBook(item);
        var iw    = Window_Base._iconWidth; // 32
        var x = rect.x, y = rect.y;

        // 번호
        this.changeTextColor(this.textColor(7));
        this.drawText(('000' + (index + 1)).slice(-3), x, y, 36);
        x += 40;

        if (known) {
            this.drawIcon(item.iconIndex, x, y + 2);
            this.resetTextColor();
            this.drawText(item.name, x + iw + 4, y, rect.width - 40 - iw - 4);
        } else {
            this.changeTextColor(this.textColor(7));
            this.drawText(unknownData, x + iw + 4, y, rect.width - 40 - iw - 4);
        }
    };

    Window_ItemBookIndex.prototype.processCancel = function() {
        Window_Selectable.prototype.processCancel.call(this);
        Window_ItemBookIndex.lastTopRow = this.topRow();
        Window_ItemBookIndex.lastIndex  = this.index();
    };

    //=========================================================================
    // Window_ItemBookStatus — 오른쪽 상단 스탯
    //=========================================================================
    function Window_ItemBookStatus() { this.initialize.apply(this, arguments); }
    Window_ItemBookStatus.prototype = Object.create(Window_Base.prototype);
    Window_ItemBookStatus.prototype.constructor = Window_ItemBookStatus;

    Window_ItemBookStatus.prototype.initialize = function(x, y, width, height) {
        Window_Base.prototype.initialize.call(this, x, y, width, height);
        this._item = null;
        this.refresh();
    };

    Window_ItemBookStatus.prototype.setItem = function(item) {
        if (this._item !== item) { this._item = item; this.refresh(); }
    };

    Window_ItemBookStatus.prototype.refresh = function() {
        var item = this._item;
        var lh   = this.lineHeight();
        var pad  = this.textPadding();
        var cw   = this.contents.width;
        this.contents.clear();
        if (!item || !$gameSystem.isInItemBook(item)) return;

        var x = pad, y = 0;
        var col2 = Math.floor(cw / 2) + pad;

        // 이름 + 아이콘
        this.drawItemName(item, x, y, cw - pad);
        y += lh;

        // 가격
        this.changeTextColor(this.systemColor());
        this.drawText(priceText, x, y, 90);
        this.resetTextColor();
        this.drawText(item.price > 0 ? item.price : '-', x + 90, y, 60, 'right');

        if (DataManager.isWeapon(item) || DataManager.isArmor(item)) {
            // 장비 슬롯
            var etype = $dataSystem.equipTypes[item.etypeId];
            this.changeTextColor(this.systemColor());
            this.drawText(equipText, col2, y, 90);
            this.resetTextColor();
            this.drawText(etype || '-', col2 + 90, y, 110);
            y += lh;

            // 타입
            var typeName = DataManager.isWeapon(item)
                ? $dataSystem.weaponTypes[item.wtypeId]
                : $dataSystem.armorTypes[item.atypeId];
            this.changeTextColor(this.systemColor());
            this.drawText(typeText, x, y, 90);
            this.resetTextColor();
            this.drawText(typeName || '-', x + 90, y, 110);
            y += lh;

            // 파라미터 (ATK~LUK, 인덱스 2~7) — 2열
            for (var i = 2; i < 8; i++) {
                var pi = i - 2;
                var px = (pi % 2 === 0) ? x : col2;
                var py = y + Math.floor(pi / 2) * lh;
                this.changeTextColor(this.systemColor());
                this.drawText(TextManager.param(i), px, py, 90);
                this.resetTextColor();
                this.drawText(item.params[i], px + 90, py, 50, 'right');
            }
        }
    };

    //=========================================================================
    // Window_ItemBookDesc — 오른쪽 하단 설명
    //=========================================================================
    function Window_ItemBookDesc() { this.initialize.apply(this, arguments); }
    Window_ItemBookDesc.prototype = Object.create(Window_Base.prototype);
    Window_ItemBookDesc.prototype.constructor = Window_ItemBookDesc;

    Window_ItemBookDesc.prototype.initialize = function(x, y, width, height) {
        Window_Base.prototype.initialize.call(this, x, y, width, height);
        this._item = null;
        this.refresh();
    };

    Window_ItemBookDesc.prototype.setItem = function(item) {
        if (this._item !== item) { this._item = item; this.refresh(); }
    };

    Window_ItemBookDesc.prototype.refresh = function() {
        this.contents.clear();
        var item = this._item;
        if (!item || !$gameSystem.isInItemBook(item)) return;
        this.drawTextEx(item.description, this.textPadding(), 0);
    };

})();
