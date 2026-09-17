# Stage B 설계 — 인증, 조직, 멤버십

팀 협업 전환 설계([planmerge-team-collaboration-design.md](planmerge-team-collaboration-design.md))의 마지막 단계.
차단급 문제 중 유일하게 남은 "링크를 아는 누구나 = 접근 권한"을 "허용된 사람만"으로 바꾸고,
현재 클라이언트가 마음대로 정하는 익명 키의 투표 무결성 문제를 해결한다.

## 설계 원칙

1. **게스트 모드는 죽지 않는다.** 로그인 없이 쓰는 로컬 우선 흐름(현재의 전부)은 그대로 유지된다. 인증은 능력을 더하는 것이지(내 공유 링크 관리, 조직 공유, 진짜 1인 1표) 문턱을 만드는 게 아니다. 어떤 단계에서도 "로그인해야 분석 가능" 같은 회귀는 금지.
2. **기존 메커니즘은 대체가 아니라 강등이다.** 관리 토큰은 삭제하지 않고 "로그인 안 한 소유자의 폴백"으로 남는다. 기존 공유 링크·토큰은 계속 동작한다.
3. **익명성과 무결성을 분리해서 설계한다.** 익명 투표의 목적은 "누가 찍었는지 숨기기"이지 "몇 번이고 찍기"가 아니다. 조직 내부 투표는 인증으로 1인 1표를 강제하되 집계에서는 익명을 유지한다.

## 스택 결정

**Auth.js(next-auth) v5 + @auth/prisma-adapter + JWT 세션.**

- 근거: 무료·자체 호스팅, 사용자 데이터가 우리 Neon DB에 남음(출처 추적이 정체성인 제품과 부합), Prisma 어댑터 기성품, App Router 지원.
- **JWT 세션 전략** (DB 세션 아님): Neon serverless에서 요청마다 세션 조회 쿼리를 없앤다. Session 테이블 불필요.
- 프로바이더: **GitHub + Google OAuth** (팀원 전원이 가진 계정). 이메일 매직링크는 메일 인프라가 필요하므로 v1 제외.
- 대안 검토: Clerk(마켓플레이스 네이티브)는 통합이 빠르지만 사용자 데이터가 외부에 있고 MAU 과금 종속이 생겨 배제. 필요해지면 Auth.js 계정 모델에서 이전 가능.
- 구현 시 주의: next-auth v5의 App Router 관례(`auth.ts` 루트 설정, `/api/auth/[...nextauth]` 핸들러, `auth()` 헬퍼)는 학습 데이터가 낡기 쉬우니 **공식 문서를 먼저 읽고** 작업할 것 (AGENTS.md의 Next.js 경고와 동일한 이유).

## 데이터 모델

```prisma
// Auth.js 표준 (JWT 세션이므로 Session 테이블 없음)
model User {
  id            String   @id @default(uuid())
  name          String?
  email         String   @unique
  emailVerified DateTime?
  image         String?
  createdAt     DateTime @default(now())

  accounts    Account[]
  memberships Membership[]
  sharedWorkspaces SharedWorkspace[]
}

model Account { // Auth.js 표준 필드 그대로 (provider, providerAccountId, tokens...)
  // @auth/prisma-adapter 스키마 준수
  @@unique([provider, providerAccountId])
}

model Organization {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())

  memberships Membership[]
  sharedWorkspaces SharedWorkspace[]
}

model Membership {
  id             String   @id @default(uuid())
  userId         String
  organizationId String
  role           String   @default("editor") // owner | admin | editor | viewer
  createdAt      DateTime @default(now())

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, organizationId])
}

// 기존 테이블 확장 (전부 nullable — 게스트 흐름 보존)
model SharedWorkspace {
  // 기존 필드 +
  createdById    String?  // User FK
  organizationId String?  // 조직 공유일 때
  visibility     String   @default("link") // link | org
}
```

`Project.ownerId`(정규화 테이블)는 이 단계에서 건드리지 않는다 — Phase 2 승격 때 User FK로.

## 익명 키 재설계 (투표 무결성의 핵심)

**구현됨(2026-09-17)**: 로그인 사용자는 `src/server/participantKey.ts`가 `HMAC-SHA256(ANON_KEY_SECRET, userId + workspaceId)`로 파생한 키로 자동 승격되고(투표·의견·참여 조회·초안 제출·철회 모두), 게스트는 아래 표대로 클라이언트 키를 유지한다. `visibility=org`는 아직이다.

구현 전 상태: `anonymousKey`는 클라이언트 localStorage 값 → 시크릿 창을 열 때마다 새 표. 공유 링크가 외부 공개면 사실상 무제한 투표.

| 모드 | 키 생성 | 무결성 | 익명성 |
|---|---|---|---|
| 외부 익명 (visibility=link, 비로그인) | 현행 유지: 클라이언트 키 | 약함 (의도된 트레이드오프 — 링크 공유의 개방성) | 완전 |
| **조직 내부 익명 (visibility=org)** | **서버가 파생: `HMAC-SHA256(serverSecret, userId + workspaceId)`** | **강함: 계정당 1키, localStorage 삭제 무력** | 집계에는 HMAC만 저장 — DB를 보더라도 serverSecret 없이는 역산 불가, 화면에는 수치만 |
| 로그인한 사용자의 link 공유 참여 | 위 HMAC 키 사용 (로그인 상태면 자동 승격) | 강함 | 동일 |

- `serverSecret`은 새 env `ANON_KEY_SECRET`. 워크스페이스별로 키가 달라지므로 워크스페이스 간 참여 이력 연결도 불가.
- 기존 투표 행은 그대로 둔다 (스냅샷 버전과 동일한 "이어붙이지 않는다" 원칙).

## 권한 매트릭스

| 행위 | 게스트(링크) | 로그인 사용자 | 링크 생성자 | 조직 admin/owner |
|---|---|---|---|---|
| link 공유 열람/투표/의견/초안 제출 | ✅ | ✅ | ✅ | ✅ |
| org 공유 열람/투표/의견/초안 제출 | ❌ 401/403 | 멤버만 ✅ | ✅ | ✅ |
| 공유 링크 생성 | ✅ (현행, 토큰 발급) | ✅ (createdById 기록, 토큰 불필요) | — | — |
| 공유 갱신(PUT)/회수(DELETE) | 토큰 보유 시 ✅ | ❌ | ✅ (로그인만으로) | org 공유면 ✅ |
| 내 공유 링크 목록/일괄 관리 | ❌ (토큰 단위) | 본인 것 ✅ | — | 조직 것 ✅ |
| 참여율(전체 대비 투표 수) 조회 | ❌ | ❌ | ✅ | ✅ |

서버 구현: 각 API에서 `auth()` 세션 → `resolveShareAccess(workspace, session)` 헬퍼 하나로 판정을 중앙화한다 (기존 `getSharedWorkspaceAccessStatus` 확장). 판정 우선순위: revoked/expired → visibility → role.

## 세션·미들웨어·rate limit

- 세션은 JWT(쿠키). API 라우트에서 `auth()`로 읽는다. 페이지 미들웨어 보호는 v1 불필요(게스트 모드가 정상이므로) — org 공유 화면만 클라이언트에서 세션 확인 후 안내.
- **rate limit 키 개선**: 로그인 사용자는 `user:${userId}`를 클라이언트 키로 사용 → 기존 `'unknown'` 공유 버킷 문제가 인증 사용자에게서 사라진다 (`getClientKey`에 세션 주입 지점 추가).

## UI 변경 (최소)

- Toolbar에 로그인/아바타 버튼 (게스트일 때 "로그인" — 눌러도 지금 하던 일이 사라지지 않게 새 탭/모달).
- "내 공유 링크" 화면: 내가 만든 링크 목록(제목, 버전, 만료, 참여 수) + 갱신/회수. 관리 토큰 없이 로그인으로.
- 공유 생성 다이얼로그에 visibility 선택(링크 공유 / 조직 공유 — 조직이 있을 때만 노출).
- 조직 생성/초대: v1은 초대 링크(조직별 초대 토큰) 방식. 이메일 초대는 메일 인프라와 함께 이후.

## 구현 패키지 (Codex 작업 단위)

| 패키지 | 내용 | 의존 |
|---|---|---|
| **B1. Auth 기반** | next-auth v5 + Prisma 어댑터 + GitHub/Google, User/Account 테이블, 로그인 UI, JWT 세션. 동작 변화 없음(게스트 그대로) | OAuth 앱 등록(사용자), AUTH_SECRET 등 env |
| **B2. 소유 연결** | SharedWorkspace.createdById 스탬핑, 로그인 소유자의 토큰 없는 PUT/DELETE, "내 공유 링크" 화면, rate limit user 키 | B1 |
| **B3. 조직** | Organization/Membership, 초대 링크, visibility=org 공유 + 접근 판정, 조직 내부 익명 HMAC 키, 참여율 뷰 | B2 |
| **B4. (Phase 2 다리)** | 로그인 사용자의 워크스페이스 서버 저장(localStorage 취약성 해소) — 별도 설계로 | B2 |

각 패키지는 독립 검증(lint/하네스/빌드/E2E) 후 개별 머지. 스키마 변경은 매번 SQL diff 생성 → Neon SQL Editor 적용 → 머지 순서 (5432 차단 환경 절차).

## 검증 계획

- E2E: 게스트 플로우(기존 스펙)는 무변경으로 계속 통과해야 한다 — 이것이 "게스트 모드는 죽지 않는다"의 회귀 게이트.
- 인증 플로우 E2E: dev/test 환경 전용 Credentials 프로바이더(`AUTH_TEST_LOGIN=1`일 때만 활성)로 실제 OAuth 없이 로그인 상태를 만든 뒤 B2 화면 검증. 프로덕션 빌드에서 이 프로바이더가 비활성인지 확인하는 케이스 포함.
- HMAC 익명 키: 같은 userId+workspaceId → 항상 같은 키, 다른 워크스페이스 → 다른 키를 확인하는 단위 수준 하네스 케이스 추가.

## 사용자 준비물 (코드 착수 전)

1. GitHub OAuth App 등록 (callback: `https://planmerge-ai.vercel.app/api/auth/callback/github` + 로컬용 localhost) → `AUTH_GITHUB_ID/SECRET`
2. Google OAuth Client 등록 (동일 패턴) → `AUTH_GOOGLE_ID/SECRET`
3. `AUTH_SECRET`, `ANON_KEY_SECRET` 생성(랜덤 32바이트) — Vercel env 등록
4. Google은 콘솔 설정이 번거로우므로 **B1은 GitHub만으로 시작해도 된다**

## 리스크

- next-auth v5 API가 학습 데이터와 다를 수 있음 → 공식 문서 우선, 작은 B1로 조기 검증.
- JWT 세션은 즉시 강제 로그아웃 불가(만료까지 유효) → v1 수용, 세션 만료 7일.
- OAuth 콜백 URL 불일치가 가장 흔한 삽질 → B1 검증 절차에 명시.
- Prisma 어댑터 스키마와 우리 uuid 관례 충돌 여부 → B1에서 어댑터 요구 스키마 그대로 따른다.
