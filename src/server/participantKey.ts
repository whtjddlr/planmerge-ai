import { createHmac } from 'node:crypto';

/**
 * 참여자 키 — 투표·의견·초안에서 "같은 사람"을 묶는 식별자.
 *
 * 설계(docs/planmerge-auth-org-design.md "익명 키 재설계"):
 * - 게스트(링크 공유, 비로그인): 클라이언트가 localStorage에 만든 키를 그대로 쓴다.
 *   시크릿 창을 열면 새 표가 된다 — 링크 공유의 개방성을 위한 **의도된 트레이드오프**다.
 *   이걸 막는 건 레이트리밋뿐이고, 그 사실은 숨기지 않는다.
 * - 로그인 사용자: 서버가 `HMAC-SHA256(ANON_KEY_SECRET, userId + workspaceId)`로 파생한
 *   키로 **자동 승격**한다. localStorage를 지워도 계정당 1키다. 워크스페이스마다 키가
 *   달라서 워크스페이스 간 참여 이력을 이을 수 없고, DB에는 HMAC만 남아 시크릿 없이는
 *   계정을 역산할 수 없다.
 *
 * 한때 이 설계는 문서와 `.env.example`에만 있었고 코드는 항상 클라이언트 키를 믿었다.
 */

let warnedMissingSecret = false;

export function isParticipantKeySecretConfigured() {
  return Boolean(process.env.ANON_KEY_SECRET?.trim());
}

/** 같은 userId + workspaceId → 항상 같은 키. 다른 워크스페이스 → 다른 키. */
export function deriveParticipantKey(userId: string, workspaceId: string, secret: string) {
  return createHmac('sha256', secret).update(`${userId}\n${workspaceId}`).digest('hex');
}

/**
 * 요청 한 건의 참여자 키를 정한다.
 *
 * 로그인 상태이고 시크릿이 있으면 파생 키, 그 외에는 클라이언트 키. 시크릿이 없는데
 * 로그인 사용자가 오면 게스트처럼 처리하고 서버 로그에 한 번 경고한다 — 공유 기능을
 * 죽이지 않기 위해서다(게스트 모드는 기본 동작이다). 운영에서는 시크릿을 넣어야 한다.
 */
export function resolveParticipantKey(input: {
  userId?: string | null;
  workspaceId: string;
  clientKey?: string;
}): string | undefined {
  const userId = input.userId?.trim();

  if (!userId) {
    return input.clientKey;
  }

  const secret = process.env.ANON_KEY_SECRET?.trim();

  if (!secret) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn(
        '[participantKey] ANON_KEY_SECRET이 없어 로그인 사용자도 클라이언트 키로 참여합니다. 운영에서는 시크릿을 설정하세요.',
      );
    }

    return input.clientKey;
  }

  return deriveParticipantKey(userId, input.workspaceId, secret);
}
