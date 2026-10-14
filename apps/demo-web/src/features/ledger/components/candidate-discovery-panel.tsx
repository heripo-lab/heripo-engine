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
  const [scope, setScope] = useState('');
  const [modelId, setModelId] = useState('openai/gpt-6-luna');
  const [maxTextChars, setMaxTextChars] = useState(8000);
  const [tableRowsPerUnit, setTableRowsPerUnit] = useState(12);
  const [maxRetries, setMaxRetries] = useState(0);
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const chapters =
    indexData?.index.resources.filter((r) => r.kind === 'chapter') ?? [];
  const scopeChapterId =
    scope ||
    chapters.find(
      (c) => c.kind === 'chapter' && /조사\s*내용/.test(c.data.title),
    )?.resourceId ||
    '';
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
        <CardTitle>다음 단계 · 조사내용에서 객체 후보 제안</CardTitle>
        <CardDescription>
          선택한 장과 하위 장의 본문·표를 검사합니다. 원문 인용을 확인한 후보만
          목록에 담고, 모든 후보는 사람 검토 대기로 남깁니다. 부모·속성·매체
          연결과 원장 등록은 다음 결정 사항입니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            후보 탐색 범위 (하위 장 포함)
            <select
              aria-label="후보 탐색 범위"
              className="bg-background mt-1 w-full rounded border p-2"
              value={scopeChapterId}
              disabled={running}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="">장 선택</option>
              {chapters.map((c) => (
                <option key={c.key} value={c.resourceId!}>
                  {c.resourceId} ·{' '}
                  {c.kind === 'chapter' ? c.data.originTitle : ''}
                </option>
              ))}
            </select>
          </label>
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
            disabled={!scopeChapterId || !modelId || running || start.isPending}
            onClick={() =>
              start.mutate({
                scopeChapterId,
                modelId,
                maxTextChars,
                tableRowsPerUnit,
                maxRetries,
              })
            }
          >
            {run ? '새 실행으로 후보 다시 추출' : '조사내용 후보 추출 실행'}
          </Button>
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
                {STATUS_LABELS[run.status]} · {run.completedUnits}/
                {run.totalUnits} 묶음 · 후보 {run.result.candidates.length}개 ·
                자동 검사 문제 {run.result.issues.length}개
              </p>
              <p>
                {run.result.scopeTitle} ({run.result.scopeChapterId}) · 모델{' '}
                {run.settings.modelId}
              </p>
              <p className="font-mono text-xs break-all">
                실행 {run.runId} · 입력 {run.result.inputSha256}
              </p>
              <p className="text-muted-foreground text-xs">
                검사 입력 {run.result.inspectedResourceCount}개. 묶음 처리가
                끝났다는 뜻이며 후보의 누락 없음이나 사람 검수 완료를 보장하지
                않습니다. 새 실행은 이전 실행을 덮어쓰지 않습니다.
              </p>
              {run.error && <p role="alert">{run.error}</p>}
            </div>
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
                    등록 근거 제안: {BASIS_LABELS[selected.eligibilityBasis]} ·
                    검토 대기
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
                          {e.resourceId ?? e.resourceKey} · PDF {e.pdfPageNo} ·
                          논리{' '}
                          {range
                            ? `${range.startPageNo}${range.endPageNo === range.startPageNo ? '' : `~${range.endPageNo}`}`
                            : '미상'}
                        </p>
                        <blockquote className="bg-muted/40 rounded border-l-2 p-3 leading-6 whitespace-pre-wrap">
                          {e.quote}
                        </blockquote>
                        <p className="font-mono text-xs break-all">
                          {e.sourceRefs.join(' ; ') || 'sourceRef 없음'} · 문자
                          [{e.charStart}, {e.charEnd})
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
