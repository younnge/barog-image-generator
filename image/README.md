# 원내이미지 생성기 (barog-image-generator)

원내 이벤트 전단지용 **A4 이미지 생성기**. 빌드/백엔드 없는 **클라이언트 전용 정적 웹앱**으로, 브라우저 canvas에서 A4(1240×1754, 2배 스케일) 이미지를 만들고 JPEG로 내려받습니다.

## 실행

정적 파일이라 서버에 올리거나 로컬에서 정적 서버로 열기만 하면 됩니다.

```bash
# 로컬 미리보기 (둘 중 아무거나)
python -m http.server 8000      # → http://localhost:8000
npx serve .
```

> `file://` 직접 열기는 CSP/폰트 로딩 때문에 권장하지 않습니다. 반드시 http로 서빙하세요.

## 테스트

```bash
npm test     # node tests/logic.test.js — 순수 로직 회귀 테스트(외부 의존성 없음)
```

## 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 마크업 + CSP/SRI + CDN(JSZip·FileSaver·폰트) |
| `main.js` | 전체 로직(입력·DSL 서식·측정/캔버스 렌더·균등 맞춤·백업) |
| `style.css` | UI 스타일 + @font-face |
| `tests/logic.test.js` | 순수 함수 단위 테스트 |

## 주요 기능

- **서식 DSL**: `<강조>`, `<+확대+>`/`<-축소->`, `{굵게}` (짝 없는 기호는 리터럴로 보존)
- **좌우 균등 맞춤**: 섹션을 높이 균형으로 좌/우 분할. `상하단 정확 맞춤`(하단 픽셀 일치) 옵션
- **한 장에 자동 맞춤**: 내용이 항상 A4 한 장에 들어가도록 글자 크기 자동 조절(70~150%)
- **의료법 위반어 감지** + 대체어 제안
- **백업/복구**: JSON 내보내기·불러오기 + sessionStorage 자동 보존(스키마 `version` 포함)

## 배포 메모

- CSS/JS는 `?v=YYYYMMDDx` 쿼리로 캐시 무효화 — **수정 시 `index.html`의 두 버전을 함께 올릴 것.**
- 외부 의존: JSZip·FileSaver(SRI 고정), 폰트(jsdelivr/Google, `font-display:swap`). 폐쇄망에서는 저장/ZIP·웹폰트가 제한될 수 있음(앱은 토스트로 안내).
