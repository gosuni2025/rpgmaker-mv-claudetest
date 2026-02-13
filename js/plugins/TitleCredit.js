/*:
 * @plugindesc 타이틀 화면에 Credit 버튼 추가
 * @author Claude
 *
 * @help
 * 타이틀 화면에 "크레딧" 버튼을 추가합니다.
 * 사용된 에셋의 저작권/라이선스 정보를 표시합니다.
 */

(function() {

    //=========================================================================
    // Window_TitleCommand - "크레딧" 커맨드 추가
    //=========================================================================

    var _Window_TitleCommand_makeCommandList = Window_TitleCommand.prototype.makeCommandList;
    Window_TitleCommand.prototype.makeCommandList = function() {
        _Window_TitleCommand_makeCommandList.call(this);
        this.addCommand('크레딧', 'credit');
    };

    //=========================================================================
    // Scene_Title - Credit 핸들러 등록
    //=========================================================================

    var _Scene_Title_createCommandWindow = Scene_Title.prototype.createCommandWindow;
    Scene_Title.prototype.createCommandWindow = function() {
        _Scene_Title_createCommandWindow.call(this);
        this._commandWindow.setHandler('credit', this.commandCredit.bind(this));
    };

    Scene_Title.prototype.commandCredit = function() {
        this._commandWindow.close();
        SceneManager.push(Scene_Credit);
    };

    //=========================================================================
    // Scene_Credit - 크레딧 화면
    //=========================================================================

    function Scene_Credit() {
        this.initialize.apply(this, arguments);
    }

    Scene_Credit.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_Credit.prototype.constructor = Scene_Credit;

    Scene_Credit.prototype.initialize = function() {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_Credit.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createCreditWindow();
    };

    Scene_Credit.prototype.createCreditWindow = function() {
        this._creditWindow = new Window_Credit();
        this.addWindow(this._creditWindow);
    };

    Scene_Credit.prototype.update = function() {
        Scene_MenuBase.prototype.update.call(this);
        if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
            SoundManager.playCancel();
            SceneManager.pop();
        }
        if (Input.isTriggered('ok') || TouchInput.isTriggered()) {
            // 터치/클릭으로도 돌아갈 수 있도록
            if (this._creditWindow._touchCloseReady) {
                SoundManager.playCancel();
                SceneManager.pop();
            }
            this._creditWindow._touchCloseReady = true;
        }
    };

    //=========================================================================
    // Window_Credit - 크레딧 내용 표시
    //=========================================================================

    function Window_Credit() {
        this.initialize.apply(this, arguments);
    }

    Window_Credit.prototype = Object.create(Window_Base.prototype);
    Window_Credit.prototype.constructor = Window_Credit;

    Window_Credit.prototype.initialize = function() {
        var width = Graphics.boxWidth - 100;
        var height = Graphics.boxHeight - 100;
        var x = (Graphics.boxWidth - width) / 2;
        var y = (Graphics.boxHeight - height) / 2;
        Window_Base.prototype.initialize.call(this, x, y, width, height);
        this._touchCloseReady = false;
        this.drawCredits();
    };

    Window_Credit.prototype.drawCredits = function() {
        var y = 0;
        var lineHeight = this.lineHeight();
        var contentWidth = this.contentsWidth();

        // Title
        this.changeTextColor(this.systemColor());
        this.drawText('- 크레딧 -', 0, y, contentWidth, 'center');
        y += lineHeight * 2;

        // SkyBox
        this.changeTextColor(this.systemColor());
        this.drawText('[SkyBox]', 0, y, contentWidth);
        y += lineHeight;

        this.resetTextColor();
        this.drawText('Cloudy Skyboxes', 0, y, contentWidth);
        y += lineHeight;

        this.drawText('by Screaming Brain Studios', 0, y, contentWidth);
        y += lineHeight;

        this.changeTextColor(this.textColor(4));  // 파란색
        this.drawText('https://screamingbrainstudios.itch.io/', 0, y, contentWidth);
        y += lineHeight;

        this.changeTextColor(this.textColor(3));  // 초록색
        this.drawText('License: CC0 (Public Domain)', 0, y, contentWidth);
        y += lineHeight * 2;

        // Footer
        this.resetTextColor();
        this.changeTextColor(this.textColor(8));  // 회색
        this.drawText('아무 키나 눌러 돌아가기', 0, y, contentWidth, 'center');
    };

    window.Scene_Credit = Scene_Credit;

})();
