'use client';

import { useState } from 'react';

import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

import { useCandidateDiscovery } from '../hooks/use-candidate-discovery';
import { useDocumentResourceIndex } from '../hooks/use-document-resource-index';
import { useReportProfile } from '../hooks/use-report-profile';
import { CandidateDeduplicationPanel } from './candidate-deduplication-panel';

const KIND_LABELS: Record<string, string> = {
  site: '유적',
  area: '조사구역',
  trench: '트렌치',
  layer: '층위',
  feature: '유구',
  artifact: '유물',
  shipwreck: '침몰선',
  unknown: '미상',
};
const BASIS_LABELS: Record<string, string> = {
  independent_body: '독립 본문',
  table_item: '표 개별 항목',
  explicit_context_unit: '명시된 맥락 단위',
};
const STATUS_LABELS: Record<string, string> = {
  running: '추출 중',
  completed: '추출 완료 · 검토 대기',
  failed: '실행 실패',
  cancelled: '중단됨',
  interrupted: '서버 재시작으로 중단됨',
};

export function CandidateDiscoveryPanel({ taskId }: { taskId: string }) {
  const { data: indexData } = useDocumentResourceIndex(taskId);
  const { query, start, cancel, audit } = useCandidateDiscovery(taskId);
  const [scope, setScope] = useState<string[]>([]);
  const [modelId, setModelId] = useState('anthropic/claude-haiku-5-5');
  const [maxTextChars, setMaxTextChars] = useState(8000);
  const [tableRowsPerUnit, setTableRowsPerUnit] = useState(12);
  const [maxRetries, setMaxRetries] = useState(0);
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const chapters =
    indexData?.index.resources.filter((r) => r.kind === 'chapter') ?? [];
  const defaultScope = chapters.find(
    (c) => c.kind === 'chapter' && /조사\s*내용/.test(c.data.title),
  )?.resourceId;
  const scopeIds = scope.length ? scope : defaultScope ? [defaultScope] : [];
  // one chapter keeps the original single-scope settings; several are planned in document order
  const scopeChapterId = scopeIds.length === 1 ? scopeIds[0] : scopeIds;
  const selectedKeys = chapters
    .filter((c) => scopeIds.includes(c.resourceId!))
    .map((c) => c.key);
  const insideSelected = (key: string) =>
    selectedKeys.some((k) => key.startsWith(`${k}/children/`));
  const toggleScope = (id: string) =>
    setScope(
      scopeIds.includes(id)
        ? scopeIds.filter((s) => s !== id)
        : chapters
            .map((c) => c.resourceId!)
            .filter((s) => s === id || scopeIds.includes(s)),
    );
  const titleOf = (id: string) => {
    const c = chapters.find((r) => r.resourceId === id);
    return c?.kind === 'chapter' ? c.data.originTitle : '';
  };
  const profile = useReportProfile(taskId);
  const stored = profile.query.data?.stored ?? null;
  const profileScope = stored?.profile.scopeChapterIds ?? [];
  // the profile scope is used only while the selection matches it exactly
  const usingProfileScope =
    profileScope.length > 0 &&
    profileScope.length === scopeIds.length &&
    profileScope.every((id) => scopeIds.includes(id));
  const loadProfile = async (file: File | undefined) => {
    if (!file) return;
    try {
      profile.save.mutate(JSON.parse(await file.text()));
    } catch {
      profile.save.reset();
      alert('프로필 JSON을 읽을 수 없습니다.');
    }
  };
  const run = query.data?.run;
  const running = run?.status === 'running';
  const candidates =
    run?.result.candidates.filter(
      (c) =>
        (!kind || c.recordKind === kind) &&
        (!filter ||
          `${c.sourceIdentifier ?? ''} ${c.sourceName} ${c.reason} ${c.chapterId}`.includes(
            filter,
          )),
    ) ?? [];
  const selected =
    candidates.find((c) => c.candidateId === selectedId) ?? candidates[0];
  const download = async () => {
    const payload = await audit.mutateAsync();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${run!.runId}-candidate-discovery-audit.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>조사내용 객체 후보 추출과 전체 중복 통합</CardTitle>
        <CardDescription>
          선택한 장과 하위 장의 본문·표를 검사합니다. 원문 인용을 확인한 후보만
          목록에 담은 뒤 LLM이 전체 후보를 검토해 중복을 묶습니다. 모든 후보는
          사람 검토 대기로 남깁니다. 부모·속성·매체 연결과 원장 등록은 다음 결정
          사항입니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 rounded border p-3 text-sm md:col-span-2">
            <p className="font-medium">보고서 프로필</p>
            {stored ? (
              <>
                <p>
                  확인된 프로필 · 출처{' '}
                  {stored.profile.source === 'router' ? '라우터' : '수동'} ·
                  확인 {stored.profile.confirmedAt.slice(0, 10)}
                </p>
                <p className="text-muted-foreground text-xs">
                  범위{' '}
                  {profileScope.map((id) => `${id} ${titleOf(id)}`).join(' · ')}{' '}
                  · 특성 yes{' '}
                  {Object.entries(stored.profile.traits)
                    .filter(([, v]) => v === 'yes')
                    .map(([k]) => k)
                    .join(', ')}
                </p>
                <p className="font-mono text-xs break-all">
                  {stored.profileSha256}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={running || usingProfileScope}
                  onClick={() => setScope(profileScope)}
                >
                  {usingProfileScope
                    ? '프로필 범위 사용 중'
                    : '프로필 범위로 채우기'}
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground text-xs">
                확인된 프로필이 없습니다. 프로필 JSON을 불러오면 검증 후
                저장합니다.
              </p>
            )}
            <input
              aria-label="보고서 프로필 JSON"
              type="file"
              accept="application/json,.json"
              disabled={running || profile.save.isPending}
              onChange={(e) => loadProfile(e.target.files?.[0])}
            />
            {profile.save.error && (
              <p className="text-destructive text-xs">
                {profile.save.error.message}
              </p>
            )}
          </div>
          <fieldset className="text-sm">
            <legend>후보 탐색 범위 (하위 장 포함, 여러 장 선택 가능)</legend>
            <div
              aria-label="후보 탐색 범위"
              className="bg-background mt-1 max-h-48 space-y-1 overflow-y-auto rounded border p-2"
            >
              {chapters.map((c) => {
                const nested = insideSelected(c.key);
                return (
                  <label
                    key={c.key}
                    className="flex items-center gap-2"
                    style={{
                      paddingLeft: `${(c.key.split('/children/').length - 1) * 12}px`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={scopeIds.includes(c.resourceId!) || nested}
                      disabled={running || nested}
                      onChange={() => toggleScope(c.resourceId!)}
                    />
                    <span className={nested ? 'text-muted-foreground' : ''}>
                      {c.resourceId} ·{' '}
                      {c.kind === 'chapter' ? c.data.originTitle : ''}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              선택한 장의 하위 장은 자동으로 포함됩니다. 여러 장의 후보는 중복
              검토 한 번으로 함께 묶습니다.
            </p>
          </fieldset>
          <label className="text-sm">
            후보 판단 모델
            <input
              aria-label="후보 판단 모델"
              className="bg-background mt-1 w-full rounded border p-2 font-mono"
              value={modelId}
              disabled={running}
              onChange={(e) => setModelId(e.target.value)}
            />
          </label>
        </div>
        <details>
          <summary className="cursor-pointer text-sm">실행 설정</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              본문 묶음 문자 수
              <input
                aria-label="본문 묶음 문자 수"
                className="mt-1 w-full rounded border p-2"
                type="number"
                min={1000}
                max={40000}
                value={maxTextChars}
                disabled={running}
                onChange={(e) => setMaxTextChars(Number(e.target.value))}
              />
            </label>
            <label className="text-sm">
              표 묶음 행 수
              <input
                aria-label="표 묶음 행 수"
                className="mt-1 w-full rounded border p-2"
                type="number"
                min={1}
                max={30}
                value={tableRowsPerUnit}
                disabled={running}
                onChange={(e) => setTableRowsPerUnit(Number(e.target.value))}
              />
            </label>
            <label className="text-sm">
              모델 재시도 횟수
              <input
                aria-label="모델 재시도 횟수"
                className="mt-1 w-full rounded border p-2"
                type="number"
                min={0}
                max={3}
                value={maxRetries}
                disabled={running}
                onChange={(e) => setMaxRetries(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            모든 묶음은 순차 실행합니다. 본문은 블록 경계에서 나누므로 하나의 긴
            블록은 설정 문자 수를 넘을 수 있습니다.
          </p>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              !scopeIds.length || !modelId || running || start.isPending
            }
            onClick={() =>
              start.mutate({
                scopeChapterId,
                modelId,
                maxTextChars,
                tableRowsPerUnit,
                maxRetries,
                ...(usingProfileScope ? { useProfileScope: true } : {}),
              })
            }
          >
            {run ? '새 실행으로 후보 다시 추출' : '조사내용 후보 추출 실행'}
          </Button>
          {run && run.completedUnits === run.totalUnits && !running && (
            <Button
              variant="outline"
              disabled={start.isPending || !modelId}
              onClick={() =>
                start.mutate({
                  ...run.settings,
                  modelId,
                  deduplicationOnly: true,
                  retryFailedUnits: false,
                })
              }
            >
              이 추출본으로 중복만 다시 검토
            </Button>
          )}
          {run &&
            run.completedUnits === run.totalUnits &&
            run.result.issues.length > 0 &&
            !running && (
              <Button
                variant="outline"
                disabled={start.isPending || !modelId}
                onClick={() =>
                  start.mutate({
                    ...run.settings,
                    modelId,
                    deduplicationOnly: false,
                    retryFailedUnits: true,
                  })
                }
              >
                문제 난 묶음만 다시 추출 후 통합
              </Button>
            )}
          {running && (
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              추출 중단
            </Button>
          )}
          {run && (
            <Button
              variant="outline"
              disabled={audit.isPending}
              onClick={() => void download().catch(() => {})}
            >
              입력·프롬프트·응답 JSON 다운로드
            </Button>
          )}
        </div>
        {(query.error || start.error || cancel.error || audit.error) && (
          <p role="alert">
            {
              (query.error || start.error || cancel.error || audit.error)
                ?.message
            }
          </p>
        )}
        {run && (
          <>
            <div
              className="bg-muted/40 space-y-1 rounded p-3 text-sm"
              aria-live="polite"
            >
              <p>
                {running && run.stage === 'deduplication'
                  ? '전체 후보 중복 통합 중'
                  : STATUS_LABELS[run.status]}{' '}
                · {run.completedUnits}/{run.totalUnits} 묶음 · 후보{' '}
                {run.result.candidates.length}개 · 자동 검사 문제{' '}
                {run.result.issues.length}개
              </p>
              <p>
                {run.result.scopeTitle} (
                {(
                  run.result.scopeChapterIds ?? [run.result.scopeChapterId]
                ).join(', ')}
                ){run.settings.useProfileScope ? ' · 프로필 범위' : ''} · 모델{' '}
                {run.settings.modelId}
              </p>
              <p className="font-mono text-xs break-all">
                실행 {run.runId} · 입력 {run.result.inputSha256}
                {run.discoverySourceRunId &&
                  ` · 최초 추출 실행 ${run.discoverySourceRunId}`}
              </p>
              <p className="text-muted-foreground text-xs">
                검사 입력 {run.result.inspectedResourceCount}개. 묶음 처리가
                끝났다는 뜻이며 후보의 누락 없음이나 사람 검수 완료를 보장하지
                않습니다. 새 실행은 이전 실행을 덮어쓰지 않습니다.
              </p>
              {run.rerunUnitIds && (
                <p>
                  문제 묶음 {run.rerunUnitIds.length}개 재실행 · 나머지{' '}
                  {run.totalUnits - run.rerunUnitIds.length}개 응답 재사용 ·
                  기준 실행 {run.reusedFromRunId}
                </p>
              )}
              {run.error && <p role="alert">{run.error}</p>}
            </div>
            {run.deduplication && (
              <CandidateDeduplicationPanel
                result={run.deduplication}
                candidates={run.result.candidates}
                index={indexData?.index}
              />
            )}
            <details open={!run.deduplication}>
              <summary className="cursor-pointer text-sm">
                통합 전 원래 후보 {run.result.candidates.length}개와 추출 검사
                보기
              </summary>
              <div className="flex flex-wrap gap-3">
                <input
                  aria-label="객체 후보 검색"
                  className="bg-background rounded border p-2 text-sm"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setSelectedId('');
                  }}
                  placeholder="후보 이름 · 번호 · 장 검색"
                />
                <select
                  aria-label="객체 후보 종류"
                  className="bg-background rounded border p-2 text-sm"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setSelectedId('');
                  }}
                >
                  <option value="">
                    전체 종류 ({run.result.candidates.length})
                  </option>
                  {Object.entries(KIND_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label} (
                      {
                        run.result.candidates.filter((c) => c.recordKind === k)
                          .length
                      }
                      )
                    </option>
                  ))}
                </select>
                <p className="self-center text-sm">
                  표시 {candidates.length}개 · 모두 미확정 후보
                </p>
              </div>
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="max-h-[680px] space-y-1 overflow-auto rounded border p-2">
                  {candidates.map((c) => (
                    <button
                      key={c.candidateId}
                      type="button"
                      aria-pressed={selected?.candidateId === c.candidateId}
                      className={`w-full rounded border p-3 text-left text-sm ${selected?.candidateId === c.candidateId ? 'border-primary bg-muted' : 'hover:bg-muted/50 border-transparent'}`}
                      onClick={() => setSelectedId(c.candidateId)}
                    >
                      <p className="font-medium">
                        {KIND_LABELS[c.recordKind]} ·{' '}
                        {c.sourceIdentifier ? `${c.sourceIdentifier} · ` : ''}
                        {c.sourceName}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {BASIS_LABELS[c.eligibilityBasis]} · {c.chapterId} · PDF{' '}
                        {c.evidence[0].pdfPageNo}
                      </p>
                    </button>
                  ))}
                  {!candidates.length && (
                    <p className="p-3 text-sm">아직 표시할 후보가 없습니다.</p>
                  )}
                </div>
                {selected && (
                  <div className="min-w-0 space-y-4 rounded border p-4 text-sm">
                    <h3 className="font-semibold">
                      {KIND_LABELS[selected.recordKind]} ·{' '}
                      {selected.sourceIdentifier
                        ? `${selected.sourceIdentifier} · `
                        : ''}
                      {selected.sourceName}
                    </h3>
                    <p>{selected.reason}</p>
                    <p className="text-muted-foreground">
                      등록 근거 제안: {BASIS_LABELS[selected.eligibilityBasis]}{' '}
                      · 검토 대기
                    </p>
                    {selected.evidence.map((e, i) => {
                      const resource = indexData?.index.resources.find(
                        (r) => r.key === e.resourceKey,
                      );
                      const range = e.logicalPageRange;
                      return (
                        <div
                          key={`${e.resourceKey}-${i}`}
                          className="space-y-2 border-t pt-3"
                        >
                          <p className="text-xs">
                            {e.resourceId ?? e.resourceKey} · PDF {e.pdfPageNo}{' '}
                            · 논리{' '}
                            {range
                              ? `${range.startPageNo}${range.endPageNo === range.startPageNo ? '' : `~${range.endPageNo}`}`
                              : '미상'}
                          </p>
                          <blockquote className="bg-muted/40 rounded border-l-2 p-3 leading-6 whitespace-pre-wrap">
                            {e.quote}
                          </blockquote>
                          <p className="font-mono text-xs break-all">
                            {e.sourceRefs.join(' ; ') || 'sourceRef 없음'} ·
                            문자 [{e.charStart}, {e.charEnd})
                          </p>
                          {resource && (
                            <details>
                              <summary className="cursor-pointer text-xs">
                                전처리 원문 전체 확인
                              </summary>
                              <pre className="bg-muted/40 mt-2 max-h-64 overflow-auto rounded p-3 text-xs whitespace-pre-wrap">
                                {JSON.stringify(resource, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <details>
                <summary className="cursor-pointer text-sm">
                  자동 검사 문제 ({run.result.issues.length}) · 제외 설명 (
                  {run.result.exclusions.length})
                </summary>
                <pre className="bg-muted/40 mt-2 max-h-80 overflow-auto p-3 text-xs whitespace-pre-wrap">
                  {JSON.stringify(
                    {
                      issues: run.result.issues,
                      exclusions: run.result.exclusions,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
