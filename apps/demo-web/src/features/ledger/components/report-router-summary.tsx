'use client';

import { CONTENT_ATTACHMENT_THIN_POLICY_TRAITS } from '@heripo/ledger-extractor';

import type { ReportRouterRunSummary } from '~/lib/ledger/report-profile';

import { Badge } from '~/components/ui/badge';

const VALUE_LABEL = { yes: '예', no: '아니오', unclear: '불명확' } as const;
const CONFIDENCE_LABEL = { high: '높음', medium: '중간', low: '낮음' } as const;

/**
 * The latest automatic classification: each trait's judgment with its confidence and problems, the proposed
 * scope, new trait proposals and open questions. A judgment becomes a profile value only without problems and
 * with high confidence; otherwise the profile keeps it unclear. Traits that drive an attachment rule are
 * marked for an outside decision when unclear; this demo does not edit them. The scope is only a proposal.
 */
export function ReportRouterSummary({
  router,
}: {
  router: ReportRouterRunSummary;
}) {
  const proposal = router.proposal;
  return (
    <div className="space-y-2 rounded border p-2 text-xs">
      <p>
        최근 자동 분류 · {router.createdAt.slice(0, 16).replace('T', ' ')} ·{' '}
        {router.modelId} · 토큰 {router.usage.totalTokens.toLocaleString()} ·{' '}
        {router.status === 'completed' ? '완료' : `실패: ${router.error}`} ·
        프로필 {router.profileSaved ? '저장됨' : '저장 안 됨'}
      </p>
      {proposal && (
        <>
          <table className="w-full text-left">
            <thead>
              <tr className="text-muted-foreground">
                <th>특성</th>
                <th>판정</th>
                <th>확신도</th>
                <th>이유·문제</th>
              </tr>
            </thead>
            <tbody>
              {proposal.traits.map((t) => {
                const kept =
                  t.value !== 'unclear' &&
                  t.confidence === 'high' &&
                  t.issues.length === 0;
                const drivesRule =
                  CONTENT_ATTACHMENT_THIN_POLICY_TRAITS.includes(t.id);
                return (
                  <tr key={t.id} className="align-top">
                    <td className="font-mono">
                      {t.id}
                      {!drivesRule && (
                        <span className="text-muted-foreground">
                          {' '}
                          (규칙 미사용)
                        </span>
                      )}
                    </td>
                    <td>
                      {VALUE_LABEL[t.value]}
                      {!kept && t.value !== 'unclear' && (
                        <span className="text-muted-foreground">
                          {' '}
                          → 프로필 불명확
                        </span>
                      )}
                      {!kept && drivesRule && (
                        <Badge variant="warning" className="ml-1">
                          결정 필요
                        </Badge>
                      )}
                    </td>
                    <td>{CONFIDENCE_LABEL[t.confidence]}</td>
                    <td>
                      {t.reason}
                      {t.issues.length > 0 && (
                        <span className="text-destructive block">
                          {t.issues.join(' · ')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p>
            제안 범위(자동 적용 안 함){' '}
            {proposal.scopeChapterIds.join(' · ') || '없음'}
            {proposal.scopeReasons.length > 0 &&
              ` (${proposal.scopeReasons.map((r) => `${r.chapterId}: ${r.reason}`).join(' / ')})`}
          </p>
          {proposal.newTraits.length > 0 && (
            <p>
              새 특성 제안(프로필에 넣지 않음){' '}
              {proposal.newTraits
                .map((n) => `${n.name}: ${n.definition}`)
                .join(' / ')}
            </p>
          )}
          {proposal.unknowns.length > 0 && (
            <p>모르는 점 {proposal.unknowns.join(' / ')}</p>
          )}
        </>
      )}
      {router.issues.length > 0 && (
        <p className="text-destructive">문제 {router.issues.join(' · ')}</p>
      )}
    </div>
  );
}
