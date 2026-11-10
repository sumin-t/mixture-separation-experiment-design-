/* 혼합물 분리 설계실 - 설정 (선생님이 수정하는 파일) */
window.SSL_CONFIG = {
  // Apps Script 웹 앱 URL (끝이 /exec). 비워 두면 '이 기기(브라우저)' 안에서만 동작합니다.
  // 비워 둔 상태에서도 같은 브라우저의 다른 탭끼리는 동기화되므로 미리 시험해 볼 수 있어요.
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbxd3Yu8EGq4V-4sm7Ec8znJP6FUgshigefSn_Lm0PWmaxzLeXRPd67rTR-QbT5rkkJRSA/exec',

  // 패들렛 보드 주소 (예: https://padlet.com/내계정/보드이름). 비워 두면 패들렛 메인 페이지가 열립니다.
  PADLET_URL: '',

  // 반별 패들렛 주소 (1반~6반). 공유하기 탭에 '1반(패들렛)'~'6반(패들렛)' 버튼이 생깁니다.
  // 주소를 비워 둔 반의 버튼을 누르면 "아직 등록되지 않았어요" 안내가 나옵니다. (위 PADLET_URL은 비어 있는 반에 대신 쓰는 공통 주소)
  PADLET_URLS: {
    1: 'https://padlet.com/t223ontool4/2026-b-201-4x3gmuupsalbcq5n',
    2: 'https://padlet.com/t223ontool4/2026-b-202-gk2omqs39x2me9v8',
    3: 'https://padlet.com/t223ontool4/2026-b-203-wmz4bjur4hafr31m',
    4: 'https://padlet.com/t223ontool4/2026-b-204-sgml8h8guwpek2l8',
    5: 'https://padlet.com/t223ontool4/2026-b-205-8md4igvnvyj6pvdq',
    6: 'https://padlet.com/t223ontool4/2026-b-206-h5h8rtjd515t88dl'
  },

  // 혼합물 배정: 'variant' = 모둠 번호에 따라 8가지 혼합물을 자동 배정(특성·난이도 동일), 'fixed' = 모두 같은 혼합물(FIXED_MIXTURE)
  MIX_MODE: 'variant',
  FIXED_MIXTURE: 'L2',

  // 모둠당 코치 힌트 사용 횟수
  HINT_LIMIT: 3,

  // 동기화 주기(밀리초). 서버 사용량을 줄이려고 조작이 없으면 느리게 확인합니다.
  POLL_MS: 3000,
  POLL_IDLE_MS: 7000
};
