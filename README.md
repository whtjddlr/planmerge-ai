# PlanMerge

여러 사람이 각자 AI로 만든 기획서 초안을 하나의 문서로 병합하면서, AI가 선택한 아이디어와 선택되지 않은 대안/충돌 의견을 섹션별로 추적하는 MVP 웹앱입니다.

## 핵심 기능

- 프로젝트 목표, 공통 기준, 금지 방향 입력
- 여러 AI 초안 붙여넣기
- GMS API 기반 초안 분석 및 로컬 하네스 fallback
- 섹션별 Decision Block 생성
- 선택안, 선택 이유, 대안, 충돌 의견, 출처 확인
- 익명 투표와 익명 의견 등록
- 팀 공유 링크 (Neon DB 설정 시): 링크를 연 참여자 전체 기준으로 투표/의견 집계
- Review Queue로 내보내기 전 충돌/검토/입력 부족 항목 확인
- 워크스페이스 JSON 내보내기/가져오기

## 기술 스택

- Next.js 16 App Router
- React 19
- Tailwind CSS 4
- TypeScript
- GMS API compatible Responses endpoint
- Prisma + Neon 설정 파일 포함

기본 동작은 브라우저 `localStorage` 중심입니다. Neon `DATABASE_URL`을 설정하면 "팀 공유 링크 만들기"로 워크스페이스를 서버에 올리고, 링크를 연 팀원들의 투표/익명 의견을 실제로 집계할 수 있습니다 (`docs/neon-setup.md` 참고). DB가 없으면 공유 기능만 비활성화되고 나머지는 그대로 동작합니다.

## 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

`.env.local`에는 실제 배포/개발 환경 값만 넣습니다.

```bash
GMS_API_KEY="..."
GMS_API_URL="https://gms.ssafy.io/gmsapi/api.openai.com/v1/responses"
GMS_DEFAULT_MODEL="gpt-4.1"
```

`GMS_API_KEY`가 없거나 API 호출이 실패하면 로컬 하네스 결과로 fallback됩니다.

## 검증

```bash
npm run lint
npm run build
npm run harness:local
npm run harness:quality
```

`harness:quality`는 다음 케이스를 검사합니다.

- 기본 샘플 분석
- 12개 기획서 섹션 완성 입력
- MVP 범위 충돌
- 프롬프트 인젝션 문구
- 여러 AI 모델 출처 반영
- 빈 초안/중복 ID/초안 개수 제한

## 주요 구조

```text
src/app/api/analyze/planmerge       GMS 분석 API route
src/app/api/decision-blocks         의견 클러스터 API route
src/planmerge/App.tsx               PlanMerge 클라이언트 앱
src/planmerge/components            화면/패널 컴포넌트
src/planmerge/lib/ai                분석 프로토콜, GMS 클라이언트, 의견 병합
src/planmerge/lib                   품질 평가, override, localStorage workspace
scripts/run-planmerge-harness.ts    기본 로컬 하네스
scripts/run-planmerge-quality-cases.ts 품질 회귀 케이스
docs                                기획/ERD/AI 판단 설계 문서
```

## 현재 범위

MVP는 붙여넣기 기반 단일 페이지 웹앱입니다. 팀 초대, 실시간 공동 편집, 결제, Google Docs/Notion/Slack 연동, 복잡한 버전 관리는 의도적으로 제외했습니다.
