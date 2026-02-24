// 파일 참조 기능 테스트 스크립트
// ScriptEditor의 "파일 참조" 탭 기능을 검증합니다.
(function fileRefTest() {
  var ok = 0, fail = 0;
  function run(name, fn) {
    try { fn(); console.log('[FILE-REF OK] ' + name); ok++; }
    catch(e) { console.error('[FILE-REF FAIL] ' + name + ' -> ' + e.message); fail++; }
  }

  run('$gameParty.gold() 읽기', function() {
    var g = $gameParty.gold();
    console.log('  소지금: ' + g);
  });

  run('$gameVariables.value(1) 읽기', function() {
    var v = $gameVariables.value(1);
    console.log('  변수#1: ' + v);
  });

  run('$gameSwitches.value(1) 읽기', function() {
    var s = $gameSwitches.value(1);
    console.log('  스위치#1: ' + s);
  });

  run('$gamePlayer 위치', function() {
    console.log('  플레이어: (' + $gamePlayer.x + ', ' + $gamePlayer.y + ')');
  });

  run('$gameMap.mapId()', function() {
    console.log('  맵 ID: ' + $gameMap.mapId());
    console.log('  맵 이름: ' + $dataMap.displayName);
  });

  run('$dataSystem 접근', function() {
    console.log('  게임 제목: ' + $dataSystem.gameTitle);
  });

  console.log('[FILE-REF] === 결과: OK=' + ok + ' FAIL=' + fail + ' / 총 ' + (ok + fail) + '개 ===');
})();
