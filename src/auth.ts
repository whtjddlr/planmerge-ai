import { createHash } from 'node:crypto';
import { PrismaAdapter } from '@auth/prisma-adapter';
import NextAuth, { type NextAuthConfig, type User as AuthUser } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import { getDb, isDatabaseConfigured } from '@/server/db';

const AUTH_DISABLED_SECRET = 'planmerge-auth-disabled-without-secret';
const TEST_LOGIN_ENABLED = process.env.AUTH_TEST_LOGIN === '1';

if (process.env.NODE_ENV === 'production' && TEST_LOGIN_ENABLED) {
  throw new Error('AUTH_TEST_LOGIN은 프로덕션에서 활성화할 수 없습니다.');
}

const databaseConfigured = isDatabaseConfigured();
const authSecret = process.env.AUTH_SECRET?.trim();
const githubId = process.env.AUTH_GITHUB_ID?.trim();
const githubSecret = process.env.AUTH_GITHUB_SECRET?.trim();
const authDatabaseAvailable = Boolean(authSecret && databaseConfigured);
const githubAvailable = authDatabaseAvailable && Boolean(githubId && githubSecret);

const providers: NextAuthConfig['providers'] = [];

if (githubAvailable) {
  providers.push(GitHub);
}

if (TEST_LOGIN_ENABLED) {
  providers.push(
    Credentials({
      name: '테스트 로그인',
      credentials: {
        username: {
          label: '사용자 이름',
          type: 'text',
        },
      },
      async authorize(credentials) {
        const username = getCredentialString(credentials.username);

        if (!username) {
          return null;
        }

        return createTestUser(username);
      },
    }),
  );
}

export const authConfig = {
  adapter: databaseConfigured ? PrismaAdapter(getDb()) : undefined,
  providers,
  secret: authSecret || AUTH_DISABLED_SECRET,
  session: {
    strategy: 'jwt',
  },
  trustHost: true,
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }

      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

function getCredentialString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function createTestUser(username: string): Promise<AuthUser | null> {
  const normalizedUsername = normalizeTestUsername(username);
  const userId = createDeterministicUuid(normalizedUsername);
  const email = `${normalizedUsername}@planmerge.test`;
  const user: AuthUser = {
    id: userId,
    name: username,
    email,
    image: null,
  };

  if (!databaseConfigured) {
    return user;
  }

  try {
    await getDb().user.upsert({
      where: {
        email,
      },
      update: {
        name: user.name,
        image: user.image,
      },
      create: {
        id: userId,
        name: user.name,
        email,
        emailVerified: new Date(0),
        image: user.image,
      },
    });
  } catch (error) {
    console.warn('테스트 로그인 사용자를 DB에 저장하지 못해 JWT 사용자로 진행합니다.', error);
  }

  return user;
}

function normalizeTestUsername(username: string) {
  const normalized = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return normalized || 'user';
}

function createDeterministicUuid(value: string) {
  const hex = createHash('sha256')
    .update(`planmerge-test-user:${value}`)
    .digest('hex')
    .split('');

  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8).join(''),
    hex.slice(8, 12).join(''),
    hex.slice(12, 16).join(''),
    hex.slice(16, 20).join(''),
    hex.slice(20, 32).join(''),
  ].join('-');
}
