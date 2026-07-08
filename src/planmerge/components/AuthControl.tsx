'use client';

import { signIn, signOut, useSession } from 'next-auth/react';

export function AuthControl() {
  const { data: session, status } = useSession();
  const user = session?.user;
  const displayName = user?.name?.trim() || user?.email?.trim() || '사용자';
  const avatarInitial = displayName.slice(0, 1).toUpperCase();
  const avatarImage = getSafeAvatarImage(user?.image);

  if (status === 'authenticated' && user) {
    return (
      <div
        data-testid="auth-user-menu"
        className="flex h-9 max-w-64 flex-shrink-0 items-center gap-2 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700"
      >
        {avatarImage ? (
          <span
            aria-hidden="true"
            className="h-6 w-6 flex-shrink-0 rounded-full bg-gray-100 bg-cover bg-center"
            style={{ backgroundImage: `url("${avatarImage}")` }}
          />
        ) : (
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs text-gray-600">
            {avatarInitial}
          </span>
        )}
        <span className="min-w-0 truncate">{displayName}</span>
        <button
          type="button"
          className="flex-shrink-0 rounded px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          onClick={() => {
            void signOut({ redirect: false });
          }}
        >
          로그아웃
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="auth-login-button"
      className="h-9 flex-shrink-0 rounded-md border border-gray-200 px-3 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:text-gray-400"
      disabled={status === 'loading'}
      onClick={() => {
        void signIn('github');
      }}
    >
      로그인
    </button>
  );
}

function getSafeAvatarImage(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
