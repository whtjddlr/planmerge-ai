# PlanMerge

> 여러 사람이 각자 AI로 만든 기획서 초안을 **하나의 문서로 병합**하면서, AI가 **무엇을 선택했고 무엇을 버렸는지** 섹션별로 추적하는 협업 도구

팀원 각자가 ChatGPT, Claude, Gemini로 기획서를 쓰는 시대에, 초안 병합은 여전히 수작업입니다. 그냥 LLM에 다 붙여넣으면 문서는 나오지만 **"내 의견은 어디 갔지?"** 에 답할 수 없습니다. PlanMerge는 병합 결과가 아니라 **병합 과정의 투명성**을 제품으로 만듭니다.

![병합 결과 화면 — 섹션별 문서와 Decision Panel(선택 근거, 충돌 배지, 익명 투표)](docs/images/merge-view.png)

## 핵심 기능

| 기능 | 설명 |
|---|---|
| **Decision Trace** | 섹션별로 선택안 · 선택 이유 · 탈락한 대안 · 충돌 의견 · **원문 발췌 출처**를 추적 |
| **2단계 AI 파이프라인** | 초안별 아이디어 정규화(추출) → Decision Block 병합. 모든 선택지는 출처 아이디어 ID를 인용해야 함 |
| **충돌 감지** | 프로젝트 금지 방향과 부딪히는 아이디어를 심각도와 함께 표시, 사람 검토 필요 여부 플래그 |
| **선택안 오버라이드** | AI의 선택을 사람이 대안/충돌 의견으로 교체 가능, Decision Log에 기록 |
| **익명 투표 · 의견** | 결정 블록별 익명 투표와 의견 등록, AI 의견 클러스터링 요약 |
| **팀 공유 링크** | 워크스페이스를 서버에 올려 링크 공유 — 참여자 전체의 투표/의견이 실제 집계 (Neon DB) |
| **Review Queue** | 내보내기 전 충돌/검토 필요/입력 부족 섹션 일괄 점검, Markdown/JSON 내보내기 |

![Review Queue — 내보내기 전 충돌·검토·입력 부족 섹션을 우선순위로 정리](docs/images/review-queue.png)

## AI 신뢰성 설계

LLM 출력을 그대로 믿지 않는 것이 이 프로젝트의 중심 설계입니다.

```
GMS 호출 (json_object 강제, temp 0.1, 60s 타임아웃)
  → 구조 검증 (ID 존재성 · 중복 · enum 화이트리스트 · 출처 정합성 교차 검증)
  → 실패 시: repair 프롬프트로 오류 목록과 함께 재시도
  → 그래도 실패 시: 규칙 기반 로컬 하네스 폴백 (배지로 투명하게 표시)
```

- **Canonical idea 고정** — merge 단계에서 모델이 아이디어를 조작/날조해도 서버가 검증 완료본으로 덮어씀. 프롬프트 인젝션에 대한 심층 방어
- **프롬프트 인젝션 방어** — 모든 프롬프트에서 초안 본문·프로젝트 필드를 untrusted input으로 선언. "충돌을 숨겨라" 같은 지시가 초안에 심겨도 서버 보정이 무력화
- **품질 회귀 하네스** — 프롬프트 인젝션, 중복 ID, 빈 초안, 30개 초과, 멀티 모델 출처 등 9개 케이스를 API 호출 없이 로컬로 검사 (`npm run harness:quality`)

## 보안

- API 라우트 전체에 IP 기반 레이트리밋 (분석 5회/분 등) — LLM 비용 소진 공격 방어
- 클라이언트가 프롬프트를 주입할 수 없음 (서버가 항상 자체 프롬프트 빌더 사용)
- 업스트림 오류 본문은 서버 로그에만 기록, 클라이언트에 미노출
- localStorage/가져오기/공유 업로드 데이터 전부 구조 검증 후 수용 (손상 데이터로 인한 크래시 루프 방지)
- 공유 투표는 참여자(익명 키)당 블록별 1표 — DB unique 제약으로 강제

## 기술 스택

**Next.js 16** (App Router) · **React 19** · **TypeScript** · **Tailwind CSS 4** · **Prisma 7 + Neon** (serverless Postgres) · GMS Responses API (OpenAI 호환)

의존성 최소화 원칙: 검증 라이브러리 없이 수제 파서/검증 함수로 입력·출력 전 구간을 방어합니다.

## 실행

```bash
npm install          # postinstall에서 prisma generate 자동 실행
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

`.env.local` 없이도 동작합니다 — GMS 키가 없으면 로컬 하네스 결과로, DB가 없으면 localStorage 모드로 자동 전환됩니다.

| 환경변수 | 용도 | 없을 때 |
|---|---|---|
| `GMS_API_KEY` | AI 분석/의견 요약 | 규칙 기반 로컬 하네스 폴백 |
| `DATABASE_URL` | 팀 공유 링크 (투표/의견 서버 집계) | 공유 기능만 비활성화 |

팀 공유를 켜려면 Neon DB 생성 후 `npx prisma migrate dev --name shared-workspace` 실행 ([docs/neon-setup.md](docs/neon-setup.md)).

## 검증

```bash
npm run lint             # ESLint 9 flat config
npm run build            # 타입 체크 포함
npm run harness:local    # 분석 프로토콜 구조 검증
npm run harness:quality  # 품질 회귀 9케이스
```

## 구조

```text
src/app/api/analyze/planmerge     2단계 분석 파이프라인 (정규화 → 병합 → 검증 → repair → 폴백)
src/app/api/decision-blocks       익명 의견 AI 클러스터링
src/app/api/workspaces            공유 워크스페이스 · 투표 · 의견 (Prisma)
src/planmerge/App.tsx             클라이언트 앱 (localStorage/공유 모드)
src/planmerge/components          문서 · Decision Panel · Review Queue · Inspector
src/planmerge/lib/ai              프로토콜 정의, 프롬프트, 검증, GMS 클라이언트
src/server                        Prisma 클라이언트, 레이트리밋, 공유 집계
scripts                           로컬 하네스 · 품질 회귀 케이스
docs                              기획/ERD/AI 판단 설계 문서
```

## 로드맵 / 한계

- 현재 분석 대상은 한국어 서비스 기획서 12섹션 템플릿 (템플릿 일반화 예정)
- 공유 워크스페이스는 정적 스냅샷 (실시간 갱신·링크 만료·인증 미구현)
- 금지 방향 충돌의 의미 판정은 모델 담당, 서버 보강은 키워드 휴리스틱 수준
- 정규화 DB 스키마(프로젝트/초안/아이디어 단위 영속화)는 설계 완료, 이관 예정 ([docs/planmerge-v0.1-spec.md](docs/planmerge-v0.1-spec.md))
