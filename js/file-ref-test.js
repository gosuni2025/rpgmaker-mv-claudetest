// 파일 참조 기능 테스트 스크립트
// ScriptEditor의 "파일 참조" 탭 기능을 검증합니다.
(function fileRefTest() {
  var ok = 0, fail = 0;
  var lines = [];

  function run(name, valueFn) {
    try {
      var value = valueFn();
      var result = value !== undefined ? String(value) : 'OK';
      lines.push('\\C[3][OK]\\C[0] ' + name + ': \\C[6]' + result + '\\C[0]');
      ok++;
    } catch(e) {
      lines.push('\\C[2][FAIL]\\C[0] ' + name + ': ' + e.message);
      fail++;
    }
  }

  run('소지금', function() { return $gameParty.gold() + 'G'; });
  run('변수#1', function() { return $gameVariables.value(1); });
  run('스위치#1', function() { return $gameSwitches.value(1); });
  run('플레이어 위치', function() { return '(' + $gamePlayer.x + ', ' + $gamePlayer.y + ')'; });
  run('맵', function() { return $gameMap.mapId() + ' ' + $dataMap.displayName; });
  run('게임 제목', function() { return $dataSystem.gameTitle; });

  // 결과 요약
  var resultColor = fail === 0 ? 3 : 2;
  lines.push('');
  lines.push('\\C[' + resultColor + ']결과: OK=' + ok + '  FAIL=' + fail + ' / 총 ' + (ok + fail) + '개\\C[0]');

  // 대화창에 출력 (4줄씩 페이지 나누기)
  $gameMessage.setBackground(0);
  $gameMessage.setPositionType(2);
  for (var i = 0; i < lines.length; i++) {
    $gameMessage.add(lines[i]);
  }
})();
