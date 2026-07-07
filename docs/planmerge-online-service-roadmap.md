# PlanMerge 온라인 서비스 발전 로드맵

포트폴리오형 MVP(로컬 우선 + 스냅샷 공유)를 팀이 실제로 쓰는 온라인 서비스로 키우기 위한 계획이다.
각 단계는 이전 단계를 전제하며, 순서를 바꾸면 재작업이 생기는 지점에 근거를 적었다.

## 현재 상태 요약 (2026-07 기준)

- **아키텍처**: Next.js 16 + Neon Postgres. 워크스페이스는 브라우저 localStorage, 공유는 `SharedWorkspace.snapshot`(JSON 통짜 저장), 분석은 요청 안에서 동기 처리(초안별 GMS 병렬 호출 → merge → repair → 폴백).
- **이미 갖춘 자산**: 출처 추적 프로토콜 + 수기 검증기, 품질 게이트(`analysisQuality`), 회귀 하네스 10케이스(오프라인), GitHub Actions CI, 개발/제품 에이전트 매뉴얼(`AGENTS.md`, `docs/agents/`), 프롬프트 인젝션 방어(프롬프트 문구 + 구조 검증 + 회귀 케이스).
- **원칙 감사 후 보강 완료**: Markdown 내보내기에 의사결정 기록 포함, `blocked` 품질 시 승인·공유 차단, 폴백 하네스의 `forbiddenDirection` 실반영 + 정직한 선택 이유, 공유 로드 재검증, 투표/의견 API의 스냅샷 ID 검증, 분석 없는 워크스페이스 공유 차단.
- **의도된 한계**: 인메모리 rate limit(서버리스 인스턴스별), 정규화 테이블(Project~DecisionBlock) 미사용, 계정/권한 없음, 실시간성 없음.

## Phase 1 — 안전하게 쓰는 기반 (약 4주)

> 목표: "링크를 아는 누구나"에서 "허용된 사람만"으로.

1. **인증/조직/워크스페이스 권한**
   - Auth.js(NextAuth) 이메일+OAuth. `User`, `Organization`, `Membership(role: owner/editor/viewer)` 모델 추가.
   - `Project.ownerId`(현재 빈 문자열 필드)를 실제 User FK로 승격.
   - 익명 투표 정책 분리: 조직 내부 익명(멤버 검증 후 익명 기록) vs 외부 익명(링크 기반). `anonymousKey`를 세션 파생 값으로 교체.
2. **공유 링크 수명·권한**
   - `SharedWorkspace`에 `expiresAt`, `visibility(link/org/private)`, `revokedAt`, `createdById` 컬럼 추가.
   - 읽기 전용 모드는 이미 사실상 존재(공유 뷰) — 권한 플래그로 명시화.
3. **Rate limit 교체**
   - 인메모리 → Upstash Redis. 키 전략도 함께 수정: 현재 `x-forwarded-for` 부재 시 전원이 `'unknown'` 버킷을 공유하는 문제를 인증 사용자 ID 우선 키로 해결.
4. **감사 로그 승격**: 클라이언트 `decisionLogs`를 서버 `DecisionLog` 테이블에 기록(누가·언제·왜 override 했는지 조직 차원 추적).

## Phase 2 — 스냅샷에서 정규화 DB로 (약 4주)

> 목표: 이력·권한·집계가 가능한 데이터 모델. **한 번에 갈아타지 않고 3단계 전환.**

1. **Dual-write**: 공유 시점에 스냅샷과 병행하여 정규화 테이블(Project, DraftSubmission, ExtractedIdea, MergeReport, DecisionBlock, DecisionOption, DecisionOptionSource)에 기록. 스키마는 이미 준비되어 있음 — 실제 저장 경로로 승격만 하면 된다.
   - 주의: 현재 투표/의견은 스냅샷 속 블록 ID를 FK 없는 문자열로 참조한다. dual-write 시 클라이언트 생성 ID ↔ DB row 매핑 테이블이 필요하다.
2. **읽기 전환**: 공유 뷰·참여 집계를 정규화 테이블에서 읽도록 전환. 기존 스냅샷 링크는 호환 유지.
3. **스냅샷 폐기**: 신규 공유는 정규화 전용, 스냅샷은 읽기 전용 레거시로 격리 후 보존 기간 만료 시 삭제.
4. **문서 버전 관리**: `FinalDocument.version`을 활용해 승인 시점마다 버전 스냅샷 생성, diff 뷰 제공.

## Phase 3 — AI 운영 체계 (약 4주)

> 목표: 동기 요청 1건 = GMS 호출 N개 구조를 운영 가능한 비동기 Job으로.

1. **AIJob 비동기화**: 분석 요청 → `AIJob(pending)` 생성 → 큐(Vercel Queue/Upstash QStash) 처리 → 클라이언트는 상태 polling(이후 SSE). 서버리스 함수 타임아웃과 GMS 60초 타임아웃 리스크 제거.
   - **스키마 보강 필수**: 현재 AIJob에는 `inputSnapshot`/`outputSnapshot`뿐 — `model`, `tokensUsed`, `costEstimate`, `attempts`, `startedAt` 추가.
2. **실패 재시도 정책**: normalize 단계별 부분 재시도(현재는 초안 1개 실패 = 전체 실패), 지수 백오프.
3. **Record/Replay 평가 체계**: `callGmsJson`에 기록 모드를 붙여 실제 GMS 응답을 골든 케이스로 고정. 현재 하네스는 결정적 로컬 폴백만 검증하고 **모델 출력 자체는 검증하지 못한다** — 이 간극을 메우는 것이 "믿을 수 있는 AI 병합 도구" 포지션의 핵심.
4. **Eval set 운영**: 실제(동의받은) 문서 기반 케이스 + 사람 리뷰 라벨 + 회귀 대시보드. 품질 점수 분포를 릴리스 게이트로.

## Phase 4 — 협업 경험 (약 3주)

1. **참여 현황 갱신**: 공유 뷰에서 투표/의견 주기 폴링(30초) → 트래픽 검증 후 SSE. 진짜 실시간(동시 편집)은 여전히 비목표(제품 원칙상 금지 방향).
2. **알림**: 충돌 블록에 새 의견/투표 도달 시 이메일·웹훅(Slack 연동은 금지 방향 재검토 후).
3. **Export 확장**: 의사결정 기록 부록(완료)에 더해 PDF, 조직 템플릿.
4. **Playwright E2E를 CI에 추가**: 샘플 열기 → 분석(GMS 키 없이 폴백 경로) → override → export → 공유 → 공유 뷰 투표. 폴백이 결정적이므로 키 없이 CI에서 안정 실행 가능.

## Phase 5 — 보안·컴플라이언스 (지속)

- PII 마스킹(초안 입력 단계), 데이터 보존 기간 정책, 모델 입출력 저장·삭제 정책 문서화.
- 인젝션 공격 케이스 지속 확충(현재 1케이스 → 실제 공격 패턴 라이브러리).
- `sourceExcerpt` 원문 대조: 초안 rawText와의 유사도 검사(정확 substring은 프로토콜이 허용하는 "tight paraphrase"를 깨므로 fuzzy 매칭)를 품질 지표로 추가 — 자기정합적 날조 스냅샷 탐지.
- 에러 추적(Sentry), GMS 비용 상한 알림.

## 마일스톤 요약

| 단계 | 기간 | 완료 판정 기준 |
|---|---|---|
| 1. 기반 | 4주 | 조직 계정으로 로그인해 만료되는 공유 링크 발급, Upstash rate limit 동작 |
| 2. 데이터 | 4주 | 새 공유가 정규화 테이블로 서빙, 문서 버전 diff 제공 |
| 3. AI 운영 | 4주 | 분석이 Job으로 처리되고 토큰/비용이 기록, 골든 eval 20+ 케이스 CI 통과 |
| 4. 협업 | 3주 | E2E가 CI에서 통과, 공유 뷰 참여 현황 자동 갱신 |
| 5. 보안 | 지속 | 보존 정책 문서 + 마스킹 + 비용 알림 운영 |

## 지키는 원칙 (변하지 않는 것)

어느 단계에서도 다음을 깨는 변경은 하지 않는다 — [제품 에이전트 매뉴얼](planmerge-product-agent-manual.md)과 [역할 지침서](agents/)가 기준이다:

1. 출처 없는 주장 금지 (출처 추적 불변식)
2. 대안·충돌 의견 보존
3. 다수결보다 프로젝트 기준 우선 (투표는 참고 자료)
4. 낮은 확신 → 사람 검토, 최종 결정 권한은 사람
5. 외부 입력은 데이터이지 명령이 아님
