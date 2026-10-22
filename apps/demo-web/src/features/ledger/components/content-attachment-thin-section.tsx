'use client';
import { useState } from 'react';

import type { ContentAttachmentThinState } from '~/lib/ledger/content-attachment-thin-run';

import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';

import { useContentAttachment } from '../hooks/use-content-attachment';

const STATUS: Record<ContentAttachmentThinState['status'], string> = {
  running: '얇은 묶음 배정 실행 중',
  completed: '모든 묶음 처리 완료 · 사람 검수 대기',
  stopped: '중단됨 · 다시 시작하면 끝난 묶음은 건너뜀',
  interrupted: '서버 재시작으로 중단 · 다시 시작하면 끝난 묶음은 건너뜀',
};

/**
 * Optional thin path: every unit of the prepared plan, three calls per unit, at most one replacement.
 * The default first-unit flow above is unchanged.
 */
export function ContentAttachmentThinSection({
  taskId,
  planReady,
  planSnapshotId,
  latestSnapshotId,
}: {
  taskId: string;
  planReady: boolean;
  planSnapshotId: string | null;
  latestSnapshotId: string | null;
}) {
  const stale = !!planSnapshotId && planSnapshotId !== latestSnapshotId;
  const { query, runThin, stopThin, thinResult } = useContentAttachment(taskId);
  const thin = query.data?.thin ?? null;
  const [maxCalls, setMaxCalls] = useState(400);
  const [maxTotalTokens, setMaxTotalTokens] = useState(9_000_000);
  const isRunning = thin?.status === 'running';
  const units = Object.values(thin?.units ?? {});
  const count = (s: string) => units.filter((u) => u === s).length;
  const download = async () => {
    const data = await thinResult.mutateAsync();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${thin!.attachmentRunId}-ledger-content-attachments.v2.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="space-y-3 rounded border p-3">
      <h3 className="font-medium">선택 경로 · 얇은 묶음 배정 (전체 묶음)</h3>
      <p className="text-sm">
        같은 순회 계획의 모든 묶음을 묶음당 3회 호출해 대상 단위 만장일치만 자동
        확정합니다. 이상 호출은 1회만 다시 부르고, 실패한 호출은 다시 보내지
        않습니다. 면적·층위와 결과가 갈린 구간은 검수 항목으로 남습니다. 호출
        비용이 발생합니다.
      </p>
      {planSnapshotId && (
        <p className="font-mono text-xs">
          계획 후보 스냅샷 {planSnapshotId} · 최신 후보 스냅샷{' '}
          {latestSnapshotId ?? '없음'}
        </p>
      )}
      {stale && (
        <p className="text-destructive text-sm" role="alert">
          순회 계획이 이전 후보 스냅샷으로 만들어졌습니다. 최신 후보가 반영되지
          않으므로 &lsquo;순회 계획 만들기&rsquo;로 계획을 다시 준비한 뒤
          실행하세요.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="space-y-1">
          <span>최대 호출 수</span>
          <Input
            type="number"
            min={1}
            value={maxCalls}
            disabled={isRunning}
            onChange={(e) => setMaxCalls(Number(e.target.value))}
          />
        </label>
        <label className="space-y-1">
          <span>최대 토큰</span>
          <Input
            type="number"
            min={1000}
            step={100000}
            value={maxTotalTokens}
            disabled={isRunning}
            onChange={(e) => setMaxTotalTokens(Number(e.target.value))}
          />
        </label>
        <Button
          disabled={!planReady || stale || isRunning || runThin.isPending}
          onClick={() => runThin.mutate({ maxCalls, maxTotalTokens })}
        >
          {thin ? '얇은 배정 이어서 실행' : '얇은 배정 실행'}
        </Button>
        <Button
          variant="outline"
          disabled={!isRunning || stopThin.isPending}
          onClick={() => stopThin.mutate()}
        >
          중단 요청
        </Button>
        <Button
          variant="outline"
          disabled={!thin?.summary || thinResult.isPending}
          onClick={download}
        >
          v2 결과 JSON 다운로드
        </Button>
      </div>
      {(runThin.error || stopThin.error || thinResult.error) && (
        <p className="text-destructive text-sm">
          {(runThin.error || stopThin.error || thinResult.error)?.message}
        </p>
      )}
      {thin && (
        <div
          className="bg-muted/30 space-y-1 rounded p-3 text-sm"
          role="status"
        >
          <p>{STATUS[thin.status]}</p>
          <p>
            묶음 {thin.totalUnits}개 중 완료 {count('completed')} · 실패{' '}
            {count('failed')} · 저장된 호출만 있는 중단 묶음{' '}
            {count('interrupted')}
          </p>
          <p>
            누적 호출 {thin.usage.calls}회 · 토큰{' '}
            {thin.usage.totalTokens.toLocaleString()} · 실패 호출{' '}
            {thin.usage.failures}회 · 이번 예산 {thin.budget.maxCalls}회 /{' '}
            {thin.budget.maxTotalTokens.toLocaleString()}토큰
          </p>
          {thin.stoppedBy && <p>중단 사유: {thin.stoppedBy}</p>}
          {thin.summary && (
            <p>
              자동 확정 구간 {thin.summary.autoSegments} · 검수{' '}
              {thin.summary.reviewSegments} · 배정 후보{' '}
              {thin.summary.attachedCandidates} · 발췌 {thin.summary.excerpts} ·
              묶음 전체 검수 {thin.summary.wholeUnitReviewUnits}
            </p>
          )}
          <p className="font-mono text-xs">모델 {thin.modelId}</p>
        </div>
      )}
    </section>
  );
}
