import { useState, type FormEvent } from 'react';
import {
  clearAnalysisCredentials,
  maskApiKey,
  saveAnalysisCredentials,
  verifyAnalysisKey,
  type StoredAnalysisCredentials,
} from '../lib/analysisKeyStore';

export type AnalysisKeyStatus = {
  /** 서버에 운영자가 설정한 키가 있는가. 있으면 사용자 키를 묻지 않는다. */
  serverConfigured: boolean;
  credentials: StoredAnalysisCredentials | null;
  loaded: boolean;
};

type Props = {
  status: AnalysisKeyStatus;
  onCredentialsChange: (credentials: StoredAnalysisCredentials | null) => void;
  /** 'banner'는 키가 없을 때만 보이는 상단 안내, 'card'는 설정 화면의 관리 영역. */
  variant: 'banner' | 'card';
};

type FormState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'error'; message: string };

export function AnalysisKeySetup({ status, onCredentialsChange, variant }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [formState, setFormState] = useState<FormState>({ kind: 'idle' });

  const resolved = status.serverConfigured || Boolean(status.credentials);

  // 배너는 아직 쓸 키가 없을 때만 나타난다. 해결되면 조용히 사라진다.
  if (variant === 'banner' && (!status.loaded || resolved)) {
    return null;
  }

  const submitKey = async (event: FormEvent) => {
    event.preventDefault();

    const apiKey = draftKey.trim();

    if (!apiKey) {
      setFormState({ kind: 'error', message: '키를 입력해 주세요.' });
      return;
    }

    setFormState({ kind: 'verifying' });

    const outcome = await verifyAnalysisKey(apiKey);

    if (!outcome.ok) {
      setFormState({ kind: 'error', message: outcome.message });
      return;
    }

    const credentials = { apiKey, model: outcome.model };
    saveAnalysisCredentials(credentials);
    onCredentialsChange(credentials);

    // 입력칸에 원문 키를 남겨 두지 않는다.
    setDraftKey('');
    setFormState({ kind: 'idle' });
    setExpanded(false);
  };

  const removeKey = () => {
    if (!window.confirm('이 브라우저에 저장된 API 키를 지울까요? AI 분석을 다시 쓰려면 새로 등록해야 합니다.')) {
      return;
    }

    clearAnalysisCredentials();
    onCredentialsChange(null);
  };

  const form = (
    <form onSubmit={submitKey} className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={draftKey}
          onChange={(event) => setDraftKey(event.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          spellCheck={false}
          disabled={formState.kind === 'verifying'}
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 font-mono text-sm disabled:bg-gray-50"
          aria-label="OpenAI API 키"
        />
        <button
          type="submit"
          disabled={formState.kind === 'verifying'}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-wait disabled:bg-blue-300"
        >
          {formState.kind === 'verifying' ? '확인 중' : '확인하고 저장'}
        </button>
        {variant === 'banner' && (
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              setDraftKey('');
              setFormState({ kind: 'idle' });
            }}
            className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            취소
          </button>
        )}
      </div>

      {formState.kind === 'error' && (
        <div className="text-xs text-red-700">{formState.message}</div>
      )}

      <p className="text-xs leading-relaxed text-gray-500">
        키는 이 브라우저에만 저장되고, 분석을 요청할 때만 서버로 전달되어 그 요청이 끝나면 버려집니다.
        서버나 공유 링크, 내보내기 파일에는 저장되지 않습니다.
        공용 PC에서는 사용 후 아래에서 삭제해 주세요.
      </p>
    </form>
  );

  if (variant === 'banner') {
    return (
      <div data-testid="analysis-key-banner" className="border-b border-blue-100 bg-blue-50 px-8 py-3 text-sm text-blue-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="font-medium">AI 분석을 사용하려면 OpenAI API 키가 필요합니다.</span>
            <span className="ml-2 text-blue-800">키를 등록하면 바로 분석을 실행할 수 있습니다.</span>
          </div>
          {!expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="shrink-0 rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              키 등록
            </button>
          )}
        </div>
        {expanded && form}
      </div>
    );
  }

  return (
    <section className="rounded-md border border-gray-200 p-5">
      <div className="text-sm text-gray-900">AI 연결</div>

      {status.serverConfigured ? (
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          서버에 분석 키가 설정되어 있어 별도 등록 없이 사용할 수 있습니다.
        </p>
      ) : status.credentials ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-700">
            <span className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">연결됨</span>
            <span className="font-mono text-xs text-gray-600">{maskApiKey(status.credentials.apiKey)}</span>
            <span className="text-xs text-gray-500">· {status.credentials.model}</span>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              키 변경
            </button>
            <button
              type="button"
              onClick={removeKey}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
            >
              키 삭제
            </button>
          </div>
          {expanded && form}
        </>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            OpenAI API 키를 등록하면 초안 병합 분석과 Decision Room을 사용할 수 있습니다.
          </p>
          {form}
        </>
      )}
    </section>
  );
}
