'use client';
import type { ContentAttachmentPlan } from '@heripo/ledger-extractor';

import {
  CONTENT_ATTACHMENT_THIN_COMPILE_VERSION,
  CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION,
  CONTENT_ATTACHMENT_THIN_LOCAL_COMPILE_VERSION,
  CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION,
} from '@heripo/ledger-extractor';
import { useState } from 'react';

import type { ContentAttachmentThinState } from '~/lib/ledger/content-attachment-thin-run';

import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';

import { useContentAttachment } from '../hooks/use-content-attachment';
import { useReportProfile } from '../hooks/use-report-profile';

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
  thinPolicy,
  thinPolicyDecisions,
  profile,
}: {
  taskId: string;
  planReady: boolean;
  planSnapshotId: string | null;
  latestSnapshotId: string | null;
  thinPolicy?: ContentAttachmentPlan['thinPolicy'];
  thinPolicyDecisions?: ContentAttachmentPlan['thinPolicyDecisions'];
  profile?: ContentAttachmentPlan['profile'];
}) {
  const stale = !!planSnapshotId && planSnapshotId !== latestSnapshotId;
  const currentProfile = useReportProfile(taskId).query.data?.stored ?? null;
  const profileChanged =
    !!planSnapshotId &&
    (currentProfile?.profileSha256 ?? null) !==
      (profile?.profileSha256 ?? null);
  const local = thinPolicy?.layers === 'local';
  const linked = thinPolicy?.continuity === 'linked';
  const votedAreas = thinPolicy?.areas === 'unanimous';
  const catalogFields = thinPolicy?.catalog === 'fields';
  // how a branch was decided: caller override, profile trait or default, and whether it still needs a decision
  const decisionNote = (
    branch: NonNullable<
      ContentAttachmentPlan['thinPolicyDecisions']
    >[number]['branch'],
  ) => {
    const d = thinPolicyDecisions?.find((x) => x.branch === branch);
    if (!d) return null;
    const source = {
      policy_override: '외부에서 분기 지정',
      trait_override: `외부에서 특성 지정 ${d.trait}=${d.traitValue}`,
      trait: `특성 ${d.trait}=${d.traitValue}`,
      profile: '확인된 프로필',
      default: d.trait ? `기본값(특성 ${d.trait}=${d.traitValue})` : '기본값',
    }[d.source];
    return (
      <span className="text-muted-foreground ml-1 text-xs">
        [{source}]
        {d.needsDecision && (
          <Badge variant="warning" className="ml-1">
            결정 필요
          </Badge>
        )}
      </span>
    );
  };
  const compileVersion = linked
    ? local
      ? CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION
      : CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION
    : local
      ? CONTENT_ATTACHMENT_THIN_LOCAL_COMPILE_VERSION
      : CONTENT_ATTACHMENT_THIN_COMPILE_VERSION;
  const { query, runThin, stopThin, thinResult } = useContentAttachment(taskId);
  const thin = query.data?.thin ?? null;
  const [maxCalls, setMaxCalls] = useState(400);
  const [maxTotalTokens, setMaxTotalTokens] = useState(9_000_000);
  const [modelInput, setModelInput] = useState<string | null>(null);
  // a run that already has calls keeps its model; otherwise default to Claude Haiku 5.5
  const modelId =
    modelInput ??
    (thin?.usage.calls ? thin.modelId : 'anthropic/claude-haiku-5-5');
  const modelLocked = !!thin?.usage.calls;
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
      <h3 className="font-medium">얇은 묶음 배정 (전체 묶음)</h3>
      <p className="text-sm">
        같은 순회 계획의 모든 묶음을 묶음당 3회 호출해 대상 단위 만장일치만 자동
        확정합니다. 이상 호출은 1회만 다시 부르고, 실패한 호출은 다시 보내지
        않습니다. 층위와 결과가 갈린 구간, 그리고 면적 3표 확정 정책이 아닌
        계획의 면적은 검수 항목으로 남습니다. 호출 비용이 발생합니다.
      </p>
      {planSnapshotId && (
        <p className="font-mono text-xs">
          계획 후보 스냅샷 {planSnapshotId} · 최신 후보 스냅샷{' '}
          {latestSnapshotId ?? '없음'}
        </p>
      )}
      {planSnapshotId && (
        <details>
          <summary className="cursor-pointer text-sm">
            세부 정보 · 계획에 고정된 배정 규칙
          </summary>
          <div className="bg-muted/30 mt-2 space-y-1 rounded p-2 text-sm">
            <div>
              적용 정책 · 층위 후보{' '}
              {local
                ? '근처 묶음만 제공(local): 한 묶음에서만 근거가 나온 층위는 자기 묶음과 같은 장의 앞뒤 1묶음까지만, 같은 이름 층위는 가까운 근거로 좁힘'
                : '모두 제공(all)'}
              {decisionNote('layers')}
            </div>
            <div>
              쪽 경계 맥락{' '}
              {linked
                ? '연결(linked): 앞 쪽 블록을 첫 블록과 같은 읽기 순서로 잇고, 후보의 근거 블록이면 표시'
                : '기존 방식'}
              {decisionNote('continuity')}
            </div>
            <div>
              면적 제안{' '}
              {votedAreas
                ? '3표 확정(unanimous): 세 호출이 모두 고른 면적은 확정, 일부만 고른 면적은 다툼 대상으로 검수'
                : '항상 검수(기존 방식)'}
              {decisionNote('areas')}
            </div>
            <div>
              도록 항목{' '}
              {catalogFields
                ? '필드 줄 포함(fields, 프롬프트 v14): 번호·이름·영문명·출수 정보·계측값 줄도 그 항목의 유물을 서술'
                : '별도 규칙 없음(프롬프트 v13)'}
              {decisionNote('catalog')}
            </div>
            <p className="font-mono text-xs break-all">
              컴파일 {compileVersion} ·{' '}
              {profile
                ? `프로필 출처 ${profile.source === 'router' ? '라우터 판정 후 사람 확인' : '사람 직접 작성'} · 해시 ${profile.profileSha256}`
                : '확인된 프로필 없이 준비된 계획(기존 규칙)'}
            </p>
          </div>
        </details>
      )}
      {profileChanged && (
        <p className="text-sm text-amber-700" role="status">
          계획 준비 이후 확인된 프로필이{' '}
          {currentProfile ? '바뀌었습니다' : '없어졌습니다'}. 계획에 고정된
          정책으로 실행되며, 현재 프로필을 반영하려면 &lsquo;순회 계획
          만들기&rsquo;로 다시 준비하세요.
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
          <span>배정 모델</span>
          <Input
            aria-label="배정 모델"
            className="w-64 font-mono"
            value={modelId}
            disabled={isRunning || modelLocked}
            onChange={(e) => setModelInput(e.target.value)}
          />
        </label>
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
          disabled={
            !planReady || stale || !modelId || isRunning || runThin.isPending
          }
          onClick={() => runThin.mutate({ maxCalls, maxTotalTokens, modelId })}
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
      {modelLocked && (
        <p className="text-muted-foreground text-xs">
          이미 호출이 저장된 실행은 같은 모델로만 이어서 실행합니다. 모델을
          바꾸려면 순회 계획을 다시 준비하세요.
        </p>
      )}
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
          <p className="font-mono text-xs">사용 모델 {thin.modelId}</p>
        </div>
      )}
    </section>
  );
}
