'use client';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

import { useCandidateDiscovery } from '../hooks/use-candidate-discovery';
import { useContentAttachment } from '../hooks/use-content-attachment';
import { ContentAttachmentThinSection } from './content-attachment-thin-section';

const STATUS: Record<string, string> = {
  prepared: '순회 계획 준비 · 미실행',
  running: '첫 묶음 배정 중',
  first_unit_completed: '첫 묶음 처리 완료 · 사람 검토 대기',
  first_unit_issues: '첫 묶음 자동 검사 문제',
  failed: '첫 묶음 실행 실패',
  interrupted: '서버 재시작으로 중단',
};
export function ContentAttachmentPanel({ taskId }: { taskId: string }) {
  const { query, prepare, execute, audit } = useContentAttachment(taskId);
  const candidate = useCandidateDiscovery(taskId).query.data?.run;
  const run = query.data?.run;
  const busy =
    run?.status === 'running' || prepare.isPending || execute.isPending;
  const download = async () => {
    const data = await audit.mutateAsync();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${run!.runId}-content-attachment-first-unit.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>원문 배정 · 순회 계획과 첫 작업 묶음</CardTitle>
        <CardDescription>
          고정된 후보에 본문·표 원문을 연결합니다. 계획을 만든 뒤 첫 묶음만
          실행하며, 나머지 문서는 실행하지 않습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || candidate?.status !== 'completed'}
            onClick={() => prepare.mutate(8000)}
          >
            순회 계획 만들기
          </Button>
          <Button
            variant="outline"
            disabled={busy || run?.status !== 'prepared' || !run.firstUnit}
            onClick={() => execute.mutate()}
          >
            첫 작업 묶음만 실행
          </Button>
          <Button
            variant="outline"
            disabled={!run || audit.isPending}
            onClick={download}
          >
            계획·입력·응답 JSON 다운로드
          </Button>
        </div>
        <ContentAttachmentThinSection
          taskId={taskId}
          planReady={!!run && run.status !== 'running'}
          planSnapshotId={run?.candidateSnapshotId ?? null}
          latestSnapshotId={candidate?.runId ?? null}
        />
        {(query.error || prepare.error || execute.error || audit.error) && (
          <p className="text-destructive text-sm">
            {
              (query.error || prepare.error || execute.error || audit.error)
                ?.message
            }
          </p>
        )}
        {run && (
          <>
            <div
              className="bg-muted/30 space-y-1 rounded p-3 text-sm"
              role="status"
            >
              <p>{STATUS[run.status]}</p>
              <p>
                객체 후보 {run.registryCount}개 · 문서 {run.pages.length}쪽 ·
                계획 {run.totalUnits}묶음 · 처리{' '}
                {run.result.completedUnitIds.length}묶음 · 전체 실행 안 함
              </p>
              <p>
                배정된 후보 {run.result.contents.length}개 · 배정 미결{' '}
                {run.result.unresolved.length}건 · 자동 검사 문제{' '}
                {run.result.issues.length}건
              </p>
              <p className="font-mono text-xs break-all">
                후보 스냅샷 {run.candidateSnapshotId} · 실행 {run.runId}
              </p>
              <p>
                후보 동일성의 기존 불확실성은 보존합니다. 배정 완료는 사람 검수
                완료를 뜻하지 않습니다.
              </p>
              {run.error && <p>{run.error}</p>}
            </div>
            <details>
              <summary className="cursor-pointer text-sm">
                페이지별 순회 계획
              </summary>
              <div className="max-h-72 overflow-auto text-xs">
                {run.pages.map((p) => (
                  <p key={p.pdfPageNo}>
                    PDF {p.pdfPageNo} ·{' '}
                    {p.status === 'planned'
                      ? `${p.unitIds.length}묶음 계획`
                      : '본문·표 텍스트 없음'}{' '}
                    · {p.unitIds.join(', ')}
                  </p>
                ))}
              </div>
            </details>
            {run.firstUnit && (
              <section className="space-y-2 rounded border p-3">
                <h3 className="font-medium">
                  첫 묶음 실제 입력 · PDF {run.firstUnit.pdfPageNo}
                </h3>
                <p className="text-xs">
                  {run.firstUnit.unitId} · 원문 자원{' '}
                  {run.firstUnit.sources.length}개
                </p>
                {run.firstUnit.sources.map((s) => (
                  <div key={s.sourceId} className="border-t pt-2 text-sm">
                    <p className="text-xs">
                      {s.resource.resourceId ?? s.resource.key} ·{' '}
                      {s.resource.kind} · 논리{' '}
                      {s.resource.logicalPageRange
                        ? `${s.resource.logicalPageRange.startPageNo}~${s.resource.logicalPageRange.endPageNo}`
                        : '미상'}
                    </p>
                    <blockquote className="whitespace-pre-wrap">
                      {s.resource.data.text || '빈 셀'}
                    </blockquote>
                    <p className="font-mono text-xs break-all">
                      {s.sourceId} · {s.resource.sourceRefs.join(' ; ')}
                    </p>
                  </div>
                ))}
              </section>
            )}
            <details>
              <summary className="cursor-pointer text-sm">
                실제 축약 프롬프트·전체 후보·인접 문맥
              </summary>
              <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap">
                {JSON.stringify(run.firstRequest, null, 2)}
              </pre>
            </details>
            {run.modelUsage && (
              <p className="text-sm">
                실제 입력 {run.modelUsage.inputTokens.toLocaleString()}토큰 ·
                출력 {run.modelUsage.outputTokens.toLocaleString()}토큰 · 캐시
                읽기 {(run.modelUsage.cachedInputTokens ?? 0).toLocaleString()}{' '}
                · 캐시 쓰기{' '}
                {(run.modelUsage.cacheWriteTokens ?? 0).toLocaleString()}
              </p>
            )}
            {run.modelResponse && (
              <details open>
                <summary className="cursor-pointer text-sm">
                  LLM 실제 원응답
                </summary>
                <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap">
                  {JSON.stringify(run.modelResponse, null, 2)}
                </pre>
              </details>
            )}
            <section className="space-y-2">
              <h3 className="font-medium">첫 묶음 배정 결과</h3>
              {run.status === 'prepared' ? (
                <p className="text-sm">모델 미실행</p>
              ) : (
                <pre className="max-h-96 overflow-auto text-xs whitespace-pre-wrap">
                  {JSON.stringify(run.result, null, 2)}
                </pre>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
