'use client';

import type {
  CandidateDeduplicationResult,
  DocumentResourceIndex,
  LedgerObjectCandidate,
} from '@heripo/ledger-extractor';

import {
  getCandidateGroupMembers,
  groupCandidateUncertainties,
} from '@heripo/ledger-extractor';
import { useState } from 'react';

export function CandidateDeduplicationPanel({
  result,
  candidates,
  index,
}: {
  result: CandidateDeduplicationResult;
  candidates: LedgerObjectCandidate[];
  index?: DocumentResourceIndex;
}) {
  const [filter, setFilter] = useState('');
  const [onlyMerged, setOnlyMerged] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const groups = result.groups.map((group) => ({
    ...group,
    members: getCandidateGroupMembers(group, candidates),
  }));
  const uncertainties = groupCandidateUncertainties(result, candidates);
  const groupLabels = new Map(
    groups.map((g, i) => [
      g.groupId,
      `R${i + 1} ${g.members[0].sourceIdentifier ?? ''} ${g.members[0].sourceName}`,
    ]),
  );
  const visible = groups.filter(
    (g) =>
      (!onlyMerged || g.members.length > 1) &&
      (!filter ||
        g.members.some((c) =>
          `${c.sourceName} ${c.sourceIdentifier ?? ''} ${c.chapterId}`.includes(
            filter,
          ),
        )),
  );
  const selected = visible.find((g) => g.groupId === selectedId) ?? visible[0];
  return (
    <section className="space-y-3 rounded border p-3">
      <h3 className="font-semibold">전체 후보 중복 통합 · 검토 대기</h3>
      <p className="text-sm">
        원래 후보 {candidates.length}개 → 객체 후보 {groups.length}개 · 합친
        묶음 {groups.filter((g) => g.members.length > 1).length}개 · 불확실한
        동일성 {uncertainties.length}건 · 근거 후보쌍{' '}
        {result.uncertainMatches.length}개 · 자동 검사 문제{' '}
        {result.issues.length}개
      </p>
      <p className="text-muted-foreground text-xs">
        모든 원래 후보와 원문·출처를 보존합니다. 묶음은 LLM의 동일 대상 판단
        제안이며 사람 검수 완료를 뜻하지 않습니다.
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          aria-label="통합 후보 검색"
          className="rounded border p-2"
          placeholder="이름 · 번호 · 장 검색"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={onlyMerged}
            onChange={(e) => setOnlyMerged(e.target.checked)}
          />{' '}
          합친 묶음만 보기
        </label>
        <span>표시 {visible.length}개</span>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="max-h-[600px] space-y-1 overflow-auto">
          {visible.map((g) => (
            <button
              key={g.groupId}
              type="button"
              aria-pressed={selected?.groupId === g.groupId}
              onClick={() => setSelectedId(g.groupId)}
              className={`w-full rounded border p-3 text-left text-sm ${selected?.groupId === g.groupId ? 'border-primary bg-muted' : ''}`}
            >
              {g.members[0].sourceIdentifier} {g.members[0].sourceName} ·{' '}
              {g.members.length}개 원래 후보
              <p className="text-muted-foreground text-xs">
                {[...new Set(g.members.map((c) => c.chapterId))].join(', ')} ·{' '}
                {g.members[0].recordKind}
              </p>
            </button>
          ))}
        </div>
        {selected && (
          <div className="min-w-0 space-y-3 text-sm">
            <p className="font-medium">통합 판단: {selected.reason}</p>
            {selected.members.map((c) => (
              <details key={c.candidateId} open className="rounded border p-3">
                <summary className="cursor-pointer font-medium">
                  {c.sourceIdentifier} {c.sourceName} · {c.chapterId} ·{' '}
                  {c.eligibilityBasis}
                </summary>
                <p className="mt-2">추출 판단: {c.reason}</p>
                <p className="font-mono text-xs break-all">{c.candidateId}</p>
                {c.evidence.map((e, i) => (
                  <div key={i} className="mt-3 space-y-2 border-t pt-2">
                    <p>
                      {e.resourceId ?? e.resourceKey} · PDF {e.pdfPageNo} · 논리{' '}
                      {e.logicalPageRange
                        ? `${e.logicalPageRange.startPageNo}~${e.logicalPageRange.endPageNo}`
                        : '미상'}
                    </p>
                    <blockquote className="bg-muted/40 rounded border-l-2 p-3 whitespace-pre-wrap">
                      {e.quote}
                    </blockquote>
                    <p className="font-mono text-xs break-all">
                      {e.resourceKey} · {e.sourceRefs.join(' ; ')} · 문자 [
                      {e.charStart}, {e.charEnd})
                    </p>
                    <details>
                      <summary className="cursor-pointer text-xs">
                        전처리 원문 전체 확인
                      </summary>
                      <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap">
                        {JSON.stringify(
                          index?.resources.find((r) => r.key === e.resourceKey),
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </div>
                ))}
              </details>
            ))}
          </div>
        )}
      </div>
      {(result.issues.length > 0 || result.uncertainMatches.length > 0) && (
        <details>
          <summary className="cursor-pointer text-sm">
            통합 검사·불확실성 확인
          </summary>
          {result.issues.length > 0 && (
            <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap">
              {JSON.stringify(result.issues, null, 2)}
            </pre>
          )}
          <div className="mt-2 space-y-3">
            {uncertainties.map((item) => (
              <details
                key={JSON.stringify([item.leftGroupId, item.rightGroupId])}
                className="rounded border p-3"
              >
                <summary className="cursor-pointer text-sm">
                  {groupLabels.get(item.leftGroupId)} ↔{' '}
                  {groupLabels.get(item.rightGroupId)} · 근거{' '}
                  {item.candidateMatches.length}쌍
                </summary>
                {item.candidateMatches.map((match) => (
                  <details
                    key={match.sourceMatchIndex}
                    open
                    className="mt-3 border-t pt-2"
                  >
                    <summary className="cursor-pointer text-sm">
                      {match.leftCandidate.sourceName} ↔{' '}
                      {match.rightCandidate.sourceName}
                    </summary>
                    <p className="my-2 text-sm">판단: {match.reason}</p>
                    <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap">
                      {JSON.stringify(match, null, 2)}
                    </pre>
                  </details>
                ))}
              </details>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
