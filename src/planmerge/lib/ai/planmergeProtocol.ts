/**
 * PlanMerge 프로토콜 배럴.
 *
 * 한 파일이 1,800줄이 되어 타입·프롬프트·검증기·마이그레이션·보정·하네스로 나눴다.
 * 기존 import 경로(`@/planmerge/lib/ai/planmergeProtocol`)는 전부 이 배럴로 들어오므로
 * 호출자는 바뀌지 않는다. 내부 헬퍼(`protocolInternals.ts`)는 여기서 내보내지 않는다.
 *
 * - `protocolTypes.ts` — v0.4 타입, 섹션 정의 12개, 초안 상한
 * - `protocolValidation.ts` — 수기 검증기 3종
 * - `protocolPrompts.ts` — 프롬프트 빌더 4종
 * - `protocolMigrations.ts` — 버전 올리기, 서버 소유 필드(봉투·출처), 본문 낡음 파생
 * - `protocolRepairs.ts` — 서버 보정 순수 함수, 배치 복구 상한
 * - `localHarness.ts` — 회귀 픽스처 전용
 */
export * from './protocolTypes';
export * from './protocolValidation';
export * from './protocolPrompts';
export * from './protocolMigrations';
export * from './protocolRepairs';
export * from './localHarness';
