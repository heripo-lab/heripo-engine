'use client';

import type {
  LedgerMediaReference,
  LedgerRecord,
  LedgerRecordLink,
  LedgerRecordSource,
  LedgerReviewItem,
} from '@heripo/ledger-extractor';

import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ArchaeologyLedgerView as LedgerView } from '~/lib/ledger/archaeology-ledger';

import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Input } from '~/components/ui/input';

import { useArchaeologyLedger } from '../hooks/use-archaeology-ledger';
import { useContentAttachment } from '../hooks/use-content-attachment';
import { usePlaceAliases } from '../hooks/use-place-aliases';

const KIND_LABEL: Record<string, string> = {
  site: '유적',
  area: '조사구역',
  trench: '트렌치',
  layer: '층위',
  feature: '유구',
  artifact: '유물',
  shipwreck: '침몰선',
  unknown: '미상',
};
const KIND_ORDER = Object.keys(KIND_LABEL);
const REASON_LABEL: Record<string, string> = {
  whole_unit: '묶음 전체 검수',
  invalid_run: '무효 호출',
  contested_targets: '호출마다 대상 다름',
  uncertainty_differs: '불확실성 판단 다름',
  area: '조사구역 제안',
  layer: '층위 제안 미확정',
  large_collective: '큰 집합',
  large_handle: '장 집합으로 배정',
  identity_uncertain: '같은 객체인지 불확실',
  profile_decision: '유형 결정 필요',
  unresolved_parent: '부모 미결',
  scope_only: '제목 범위만',
  title_only: '장 제목만',
  unmatched_place: '맞는 기록이 없는 장소',
  confirming_phrase: '확인 표현만',
  row_only: '소속 열 아닌 표 행',
  ambiguous_target: '후보 여럿',
  conflicting_targets: '후보 충돌',
  cycle: '순환',
  not_judged: '판단 전',
  judged_none: '판단 결과 없음',
  judgment_split: '판단 갈림',
  alias_unresolved: '대응 규칙으로도 못 찾음',
  alias_duplicate: '약칭 중복',
  media_ambiguous: '같은 번호의 이미지 여럿',
  media_caption_several: '캡션이 여러 객체를 가리킴',
  attribute_owner_ambiguous: '문장이 다른 객체도 언급함',
  link_enclosure: '둘러쌈 서술',
  link_several_targets: '나열된 여러 객체',
  link_unclear: '관계 서술어 없음',
};
const ATTRIBUTE_METHOD_LABEL: Record<string, string> = {
  table_mapping: '표',
  rule: '본문',
};
const PARENT_BASIS_LABEL = {
  code: '코드 확정',
  alias: '사람 지정 대응',
  judgment: '판단 일치',
};
const BASIS_LABEL: Record<string, string> = {
  registration: '객체 등록 근거',
  model_unanimous: '모든 호출 일치',
  model_majority: '세 호출 중 둘 일치',
  code_row_owner: '표 행 소유 객체',
  code_typed_row: '표 유형 행',
  code_cell_registration: '표 칸 등록',
};
const LINK_BASIS_LABEL: Record<string, string> = {
  rule: '원문 서술',
  table_column: '표 관계 열',
};
const PENDING = [
  { id: 'links', label: '객체 간 관계', note: '유구-유물 등 관계와 그 근거' },
  {
    id: 'media_references',
    label: '도면·사진',
    note: '도면·사진과 객체의 연결',
  },
] as const;
type Tab =
  'records' | 'review' | 'hierarchy' | 'media' | (typeof PENDING)[number]['id'];
const MEDIA_BASIS_LABEL: Record<string, string> = {
  text_reference: '본문 참조',
  caption_name: '캡션 이름',
  caption_range: '캡션 번호 범위',
};

const STATUS_BADGE: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'outline' }
> = {
  passed: { label: '자동 검사 통과', variant: 'success' },
  warnings: { label: '자동 검사 경고', variant: 'warning' },
  failed: { label: '자동 검사 오류', variant: 'destructive' },
  not_run: { label: '자동 검사 전', variant: 'outline' },
};
const SEVERITY_LABEL = { error: '오류', warning: '경고', info: '정보' };
const ISSUE_CODE_LABEL: Record<string, string> = {
  DUPLICATE_ID: 'ID 중복',
  INVALID_RESOURCE_REFERENCE: '없는 대상을 가리킴',
  PARENT_CYCLE: '부모 순환',
  MISSING_RECORD_SOURCE: '기록 출처 없음',
  MISSING_ATTRIBUTE_SOURCE: '속성 출처 없음',
  MISSING_CONTENT_SOURCE: '발췌 출처 없음',
  INVALID_CONTENT_SOURCE_REFERENCE: '발췌 출처 불일치',
  INVALID_TABLE_CELL_POINTER: '표 칸 좌표 무효',
  UNSUPPORTED_CONTENT_CLAIM: '근거에 없는 내용',
  SOURCE_VALUE_MISMATCH: '원문과 다른 값',
  UNRESOLVED_EVIDENCE_ASSIGNMENT: '배정 문제',
  DIFFERING_SOURCE_VALUES: '출처마다 다른 표현',
  UNMAPPED_TABLE_CELL: '머리글 없는 표 칸',
  REFERENCE_LABEL_MISMATCH: '도면·사진 번호 불일치',
  MEDIA_MATCH_AMBIGUOUS: '캡션 대상 미결',
  UNRESOLVED_LINK_TARGET: '관계 대상 미결',
};
const STAGE_LABEL: Record<string, string> = {
  assembly: '조립',
  media: '도면·사진',
  attributes: '속성',
  links: '관계',
  validation: '전체 검증',
};

/**
 * Automatic check results: the full validation's check counts, then every issue grouped by severity and code
 * with the step that found it and the record it names. Passing checks is not a person's review.
 */
function IssuePanel({
  view,
  nameOf,
}: {
  view: LedgerView;
  nameOf: (id: string) => string;
}) {
  const { issues } = view.ledger;
  const failedChecks = view.checks.filter((c) => c.failed > 0);
  const groups = (['error', 'warning', 'info'] as const).map((severity) => {
    const byCode = new Map<string, typeof issues>();
    for (const i of issues.filter((x) => x.severity === severity))
      byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
    return { severity, byCode };
  });
  return (
    <details className="rounded border p-2 text-xs">
      <summary className="cursor-pointer">
        자동 검사 {view.checks.length}개 중 통과{' '}
        {view.checks.length - failedChecks.length}개 ·{' '}
        {groups
          .map(
            (g) =>
              `${SEVERITY_LABEL[g.severity]} ${[...g.byCode.values()].flat().length}건`,
          )
          .join(' · ')}
      </summary>
      <p className="text-muted-foreground mt-1">
        원장을 전처리 문서와 대조한 결과입니다. 통과는 사람이 검수했다는 뜻이
        아닙니다.
      </p>
      {groups.map((g) =>
        [...g.byCode].map(([code, list]) => (
          <details key={`${g.severity}-${code}`} className="mt-1 pl-2">
            <summary
              className={`cursor-pointer ${g.severity === 'error' ? 'text-destructive' : g.severity === 'warning' ? 'text-amber-600' : 'text-muted-foreground'}`}
            >
              {SEVERITY_LABEL[g.severity]} · {ISSUE_CODE_LABEL[code] ?? code}{' '}
              {list.length}건{' '}
              <span className="text-muted-foreground">({code})</span>
            </summary>
            <ul className="mt-1 max-h-48 list-disc overflow-auto pl-6">
              {list.map((i, n) => (
                <li key={n}>
                  <span className="text-muted-foreground">
                    [{STAGE_LABEL[i.stage] ?? i.stage}]
                  </span>{' '}
                  {i.recordId ? `${nameOf(i.recordId)} · ` : ''}
                  {i.message}
                </li>
              ))}
            </ul>
          </details>
        )),
      )}
    </details>
  );
}

const reasonText = (reasons: string[]) =>
  reasons.map((r) => REASON_LABEL[r] ?? r).join(' · ');
/** The record's name as written, with the chapter that tells it apart from a same-named record. */
const recordLabel = (r: LedgerRecord, view: LedgerView) =>
  (r.sourceIdentifier && !r.sourceName.includes(r.sourceIdentifier)
    ? `${r.sourceIdentifier} ${r.sourceName}`
    : r.sourceName) + (view.scopes[r.id] ? ` · ${view.scopes[r.id]}` : '');

function SourceLine({
  source,
  chapterTitles,
}: {
  source: LedgerRecordSource;
  chapterTitles: Record<string, string>;
}) {
  return (
    <span className="text-muted-foreground block text-xs">
      {source.pdfPageNo ? `PDF ${source.pdfPageNo}쪽` : '쪽 없음'}
      {source.chapterId &&
        ` · ${chapterTitles[source.chapterId] ?? source.chapterId}`}
      {source.tableCell &&
        ` · 표 ${source.tableId} ${source.tableCell.rowIndex + 1}행 ${source.tableCell.columnIndex + 1}열`}
      {' · '}
      {BASIS_LABEL[source.basis] ?? source.basis}
    </span>
  );
}

/** How the parent was decided and its evidence; an alias rule shows its correspondence and basis quote. */
function ParentEvidenceLine({ record }: { record: LedgerRecord }) {
  return (
    <span className="text-muted-foreground block text-xs">
      {PARENT_BASIS_LABEL[record.parentBasis!]}
      {record.parentEvidence?.map((e, i) => (
        <span key={i} className="block">
          {e.kind === 'alias_rule'
            ? `사람 지정 대응 ${e.ruleId}: ${e.text} · 근거 “${e.quote}”`
            : e.text}
        </span>
      ))}
    </span>
  );
}

/**
 * The task's place alias table: upload a person-decided JSON table, see whether it was applied and its
 * warnings, or remove it. The demo does not edit tables.
 */
function PlaceAliasControl({
  taskId,
  view,
}: {
  taskId: string;
  view: LedgerView;
}) {
  const { query, save, remove } = usePlaceAliases(taskId);
  const state = view.placeAliases;
  const load = async (file?: File) => {
    if (!file) return;
    try {
      save.mutate(JSON.parse(await file.text()));
    } catch {
      save.reset();
      alert('JSON을 읽을 수 없습니다.');
    }
  };
  return (
    <details className="rounded border p-2 text-xs">
      <summary className="cursor-pointer">
        장소 약칭 대응 표{' '}
        {state.status === 'applied'
          ? `· 규칙 ${state.ruleIds.length}개 적용`
          : state.status === 'invalid'
            ? '· 적용 안 됨'
            : '· 없음'}
      </summary>
      <div className="mt-2 space-y-2">
        <div className="text-muted-foreground">
          보고서의 장소 약칭(예: 발굴 1구역)과 등록 이름(예: 23-1 구역)의 대응을
          사람이 정한 JSON(place-aliases.v1)입니다. 원문 근거 인용이 있어야
          하며, 저장하면 원장 부모에 바로 반영됩니다.
        </div>
        {state.status === 'applied' && (
          <div>
            적용 규칙 {state.ruleIds.join(', ')} · 해시{' '}
            <span className="font-mono">{state.sha256.slice(0, 12)}</span>
            {state.warnings.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-amber-700">
                {state.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {state.status === 'invalid' && (
          <ul className="text-destructive list-disc pl-4">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="장소 약칭 대응 표 JSON"
            type="file"
            accept="application/json,.json"
            disabled={save.isPending}
            onChange={(e) => load(e.target.files?.[0])}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!query.data?.table || remove.isPending}
            onClick={() => remove.mutate()}
          >
            대응 표 삭제
          </Button>
        </div>
        {save.data && (
          <div>저장했습니다. 경고 {save.data.warnings.length}건</div>
        )}
        {(save.error || remove.error) && (
          <div className="text-destructive whitespace-pre-wrap">
            {(save.error || remove.error)!.message}
          </div>
        )}
      </div>
    </details>
  );
}

/** An image thumbnail from its public URL; a failed load shows the label only. */
function MediaThumb({
  view,
  imageId,
  note,
}: {
  view: LedgerView;
  imageId: string;
  note?: string;
}) {
  const [failed, setFailed] = useState(false);
  const image = view.images[imageId];
  return (
    <figure className="w-36 shrink-0 space-y-1 text-xs">
      {image && !failed ? (
        <img
          src={image.url}
          alt={image.caption ?? imageId}
          loading="lazy"
          onError={() => setFailed(true)}
          className="bg-muted h-24 w-full rounded border object-contain"
        />
      ) : (
        <div className="bg-muted text-muted-foreground flex h-24 items-center justify-center rounded border">
          {imageId}
        </div>
      )}
      <figcaption className="text-muted-foreground line-clamp-3">
        {image?.caption ?? `캡션 없음 · PDF ${image?.pdfPageNo ?? '?'}쪽`}
        {note && <span className="block">{note}</span>}
      </figcaption>
    </figure>
  );
}

function RecordDetail({
  record,
  view,
  itemsOf,
  nameOf,
  childrenOf,
  onSelect,
}: {
  record: LedgerRecord;
  view: LedgerView;
  itemsOf: LedgerReviewItem[];
  nameOf: (id: string) => string;
  childrenOf: LedgerRecord[];
  onSelect: (id: string) => void;
}) {
  const sourceById = useMemo(
    () => new Map(view.ledger.sources.map((s) => [s.id, s])),
    [view],
  );
  const own = itemsOf.filter((i) => !i.collective && i.kind !== 'media');
  const attributes = view.ledger.attributes.filter(
    (a) => a.recordId === record.id,
  );
  const links = view.ledger.links.filter(
    (l) => l.fromRecordId === record.id || l.toRecordId === record.id,
  );
  const layerMentions = view.ledger.layerMentions.filter(
    (m) => m.layerRecordId === record.id || m.recordIds.includes(record.id),
  );
  const collective = itemsOf.filter((i) => i.collective).length;
  const media = view.ledger.mediaReferences.filter(
    (m) => m.recordId === record.id,
  );
  const samePage = view.ledger.mediaCandidates.filter((c) =>
    c.recordIds.includes(record.id),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">{recordLabel(record, view)}</h3>
        <Badge variant="outline">{KIND_LABEL[record.recordKind]}</Badge>
        {record.needsReview && <Badge variant="warning">검수 필요</Badge>}
      </div>
      <div className="space-y-1 text-sm">
        <div>
          상위{' '}
          {record.parentRecordId ? (
            <button
              type="button"
              className="underline"
              onClick={() => onSelect(record.parentRecordId!)}
            >
              {nameOf(record.parentRecordId)}
            </button>
          ) : (
            <span className="text-muted-foreground">없음</span>
          )}
          {record.parentRecordId && <ParentEvidenceLine record={record} />}
        </div>
        {childrenOf.length > 0 && (
          <div>
            하위 {childrenOf.length}개{' '}
            <span className="text-muted-foreground">
              {childrenOf
                .slice(0, 12)
                .map((c) => recordLabel(c, view))
                .join(', ')}
              {childrenOf.length > 12 ? ' …' : ''}
            </span>
          </div>
        )}
      </div>
      <div>
        <div className="mb-2 text-sm font-medium">
          원문 발췌 {record.content.length}건
        </div>
        <ol className="space-y-2">
          {record.content.map((excerpt) => (
            <li key={excerpt.id} className="rounded border p-2 text-sm">
              <span className="block whitespace-pre-wrap">{excerpt.text}</span>
              {excerpt.sourceIds.map((id) => (
                <SourceLine
                  key={id}
                  source={sourceById.get(id)!}
                  chapterTitles={view.chapterTitles}
                />
              ))}
            </li>
          ))}
        </ol>
      </div>
      {links.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium">관계 {links.length}개</div>
          <ul className="space-y-2">
            {links.map((l) => {
              const other =
                l.fromRecordId === record.id ? l.toRecordId : l.fromRecordId;
              return (
                <li key={l.id} className="rounded border p-2 text-sm">
                  <LinkLine
                    link={l}
                    nameOf={nameOf}
                    onSelect={onSelect}
                    focus={other}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {layerMentions.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium">
            층위 언급 후보 {layerMentions.length}개
          </div>
          <p className="text-muted-foreground mb-2 text-xs">
            문장에 층위 이름이 나오지만 어느 실행도 그 층위에 붙이지 않은
            경우입니다. 출토 위치나 기반 층처럼 관계일 수 있어 관계 단계를 위한
            후보로만 남겼습니다.
          </p>
          <ul className="space-y-2">
            {layerMentions.map((m) => (
              <li key={m.id} className="rounded border p-2 text-sm">
                <span className="block">{m.text}</span>
                <span className="text-muted-foreground block text-xs">
                  {m.pdfPageNo ? `PDF ${m.pdfPageNo}쪽 · ` : ''}층위{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => onSelect(m.layerRecordId)}
                  >
                    {nameOf(m.layerRecordId)}
                  </button>
                  {m.recordIds.length > 0 && (
                    <>
                      {' · 문장의 객체 '}
                      {m.recordIds.map((id, i) => (
                        <span key={id}>
                          {i > 0 && ', '}
                          <button
                            type="button"
                            className="underline"
                            onClick={() => onSelect(id)}
                          >
                            {nameOf(id)}
                          </button>
                        </span>
                      ))}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {attributes.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium">
            속성 {attributes.length}개
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="py-1 pr-2 font-normal">항목</th>
                <th className="py-1 pr-2 font-normal">값</th>
                <th className="py-1 pr-2 font-normal">단위</th>
                <th className="py-1 font-normal">출처</th>
              </tr>
            </thead>
            <tbody>
              {attributes.map((a) => (
                <tr key={a.id} className="border-b align-top">
                  <td className="py-1 pr-2">{a.keyText}</td>
                  <td className="py-1 pr-2">
                    {a.valueText}
                    {a.sourceText !== a.valueText && (
                      <span className="text-muted-foreground block text-xs">
                        {a.sourceText}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2">{a.unitText ?? ''}</td>
                  <td className="text-muted-foreground py-1 text-xs whitespace-nowrap">
                    {ATTRIBUTE_METHOD_LABEL[a.extractionMethod]}
                    {a.metadata.pdfPageNo
                      ? ` · PDF ${a.metadata.pdfPageNo}쪽`
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(media.length > 0 || samePage.length > 0) && (
        <div>
          <div className="mb-2 text-sm font-medium">
            도면·사진 {media.length}개
          </div>
          <div className="flex flex-wrap gap-2">
            {media.map((m) => (
              <MediaThumb
                key={m.id}
                view={view}
                imageId={m.imageId}
                note={MEDIA_BASIS_LABEL[m.basis]}
              />
            ))}
          </div>
          {samePage.map((c) => (
            <p key={c.id} className="text-muted-foreground mt-2 text-xs">
              PDF {c.pdfPageNo}쪽 캡션 없는 이미지 {c.imageIds.length}장이 이
              쪽의 객체 {c.recordIds.length}개와 관련된 쪽 단위 후보입니다.
              이미지별 객체는 정하지 않았습니다.
            </p>
          ))}
        </div>
      )}
      {(own.length > 0 || collective > 0) && (
        <div>
          <div className="mb-2 text-sm font-medium">사람이 결정할 것</div>
          <ul className="space-y-2">
            {own.map((item) => (
              <li key={item.id} className="rounded border p-2 text-sm">
                <span className="block font-medium">
                  {reasonText(item.reasons)}
                </span>
                {item.text && (
                  <span className="block whitespace-pre-wrap">{item.text}</span>
                )}
                {item.detail && <span className="block">{item.detail}</span>}
                <span className="text-muted-foreground block text-xs">
                  {item.kind === 'parent' ? (
                    <ParentItemLine item={item} nameOf={nameOf} />
                  ) : item.kind === 'link' ? (
                    <>
                      {item.pdfPageNo ? `PDF ${item.pdfPageNo}쪽 · ` : ''}
                      관계 후보{' '}
                      {item.candidateRecordIds?.map(nameOf).join(', ')} · 원문에
                      관계를 정할 서술어가 없어 관계로 넣지 않았습니다.
                    </>
                  ) : item.kind === 'attribute' ? (
                    <>
                      {item.pdfPageNo ? `PDF ${item.pdfPageNo}쪽 · ` : ''}
                      함께 언급된 객체{' '}
                      {[...item.recordIds, ...(item.candidateRecordIds ?? [])]
                        .map(nameOf)
                        .join(', ')}{' '}
                      · 어느 객체의 값인지 정해지지 않아 속성에 넣지 않았습니다.
                    </>
                  ) : (
                    <>
                      {item.pdfPageNo ? `PDF ${item.pdfPageNo}쪽 · ` : ''}
                      제안 대상{' '}
                      {item.recordIds.map(nameOf).join(', ') || '없음'}
                      {item.confirmedRecordIds.length > 0 &&
                        ` · 확정 ${item.confirmedRecordIds.map(nameOf).join(', ')}`}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {collective > 0 && (
            <p className="text-muted-foreground mt-2 text-xs">
              이 객체를 포함한 장 집합 서술 {collective}건은 검수 항목 탭에서
              집합 단위로 결정합니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const voteLabel = (vote: string, nameOf: (id: string) => string) =>
  vote === 'none' ? '없음' : vote === 'invalid' ? '무효' : nameOf(vote);

function ParentItemLine({
  item,
  nameOf,
}: {
  item: LedgerReviewItem;
  nameOf: (id: string) => string;
}) {
  return (
    <>
      부모 후보 {item.candidateRecordIds?.map(nameOf).join(', ') || '없음'}
      {item.votes?.length
        ? ` · 판단 ${item.votes.map((v) => voteLabel(v, nameOf)).join(' | ')}`
        : ''}
    </>
  );
}

/** One link: the pair with the label (→ directed, ↔ symmetric), how it was decided and each source sentence. */
function LinkLine({
  link,
  nameOf,
  onSelect,
  focus,
}: {
  link: LedgerRecordLink;
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
  focus?: string;
}) {
  const name = (id: string) =>
    id === focus || !focus ? (
      <button type="button" className="underline" onClick={() => onSelect(id)}>
        {nameOf(id)}
      </button>
    ) : (
      <span>{nameOf(id)}</span>
    );
  return (
    <>
      <span className="block">
        {name(link.fromRecordId)}{' '}
        <Badge variant="outline" className="mx-1 px-1 text-[10px]">
          {link.relationLabel} {link.symmetric === false ? '→' : '↔'}
        </Badge>{' '}
        {name(link.toRecordId)}
        <span className="text-muted-foreground text-xs">
          {' '}
          · {link.basis ? LINK_BASIS_LABEL[link.basis] : '부모 판단 옆 관계'}
        </span>
      </span>
      {link.evidence.map((e, i) => (
        <span key={i} className="text-muted-foreground block text-xs">
          {e.pdfPageNo ? `PDF ${e.pdfPageNo}쪽 · ` : ''}“{e.quote ?? e.text}”
        </span>
      ))}
    </>
  );
}

/** Every link with its source sentences; names open the record. */
function LinkList({
  view,
  nameOf,
  onSelect,
}: {
  view: LedgerView;
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  const links = view.ledger.links;
  if (!links.length)
    return (
      <p className="text-muted-foreground text-sm">
        원문에서 코드로 정할 수 있는 객체 간 관계 서술이 없습니다. 정하지 못한
        서술은 검수 항목 탭에 있습니다.
      </p>
    );
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground text-xs">
        관계 이름은 원문의 짧은 낱말이며 표준 술어가 아닙니다. 한 절 안에서 이름
        바로 뒤에 서술어가 이어질 때만 코드가 정했습니다.
      </p>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.id} className="rounded border p-2">
            <LinkLine link={l} nameOf={nameOf} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The containment tree: records with children as roots, each child with how its parent was decided. */
function HierarchyTree({
  view,
  childrenOf,
  nameOf,
  onSelect,
}: {
  view: LedgerView;
  childrenOf: Map<string, LedgerRecord[]>;
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  const records = view.ledger.records;
  const roots = records.filter(
    (r) => !r.parentRecordId && childrenOf.has(r.id),
  );
  const open = view.ledger.reviewItems.filter((i) => i.kind === 'parent');
  const node = (r: LedgerRecord): React.ReactNode => {
    const children = childrenOf.get(r.id) ?? [];
    const label = (
      <span className="text-sm">
        <span className="text-muted-foreground text-xs">
          {KIND_LABEL[r.recordKind]}
        </span>{' '}
        <button
          type="button"
          className="underline"
          onClick={() => onSelect(r.id)}
        >
          {recordLabel(r, view)}
        </button>
        {r.parentBasis && (
          <Badge variant="outline" className="ml-1 px-1 text-[10px]">
            {PARENT_BASIS_LABEL[r.parentBasis]}
          </Badge>
        )}
        {r.needsReview && (
          <Badge variant="warning" className="ml-1 px-1 text-[10px]">
            검수
          </Badge>
        )}
        {children.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {' '}
            · 하위 {children.length}
          </span>
        )}
      </span>
    );
    if (!children.length)
      return (
        <li key={r.id}>
          {label}
          {r.parentEvidence?.[0] && (
            <span className="text-muted-foreground block truncate pl-4 text-xs">
              {r.parentEvidence[0].text}
            </span>
          )}
        </li>
      );
    return (
      <li key={r.id}>
        <details open={children.length <= 12}>
          <summary className="cursor-pointer">{label}</summary>
          <ul className="ml-4 space-y-1 border-l pl-3">{children.map(node)}</ul>
        </details>
      </li>
    );
  };
  const withParent = records.filter((r) => r.parentRecordId).length;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground text-xs">
        부모가 정해진 객체 {withParent}개 (코드 확정 {view.parents.code} · 사람
        지정 대응 {view.parents.alias} · 판단 일치 {view.parents.judged}) · 부모
        미결 {open.length}건 · 원문에 포함 관계가 없는 객체는 최상위로 둡니다.
        {!view.parents.judgmentsLoaded &&
          ' 저장된 부모 판단 결과가 없어 코드가 정하지 못한 질문은 모두 미결입니다.'}
      </p>
      {roots.length ? (
        <ul className="space-y-1">{roots.map(node)}</ul>
      ) : (
        <p className="text-muted-foreground">정해진 포함 관계가 없습니다.</p>
      )}
      {open.length > 0 && (
        <section>
          <h3 className="mb-2 font-medium">부모 미결 {open.length}건</h3>
          <ul className="space-y-1">
            {open.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className="underline"
                  onClick={() => onSelect(i.recordIds[0])}
                >
                  {nameOf(i.recordIds[0])}
                </button>
                <span className="text-muted-foreground text-xs">
                  {' '}
                  — {reasonText(i.reasons.slice(1))} ·{' '}
                  <ParentItemLine item={i} nameOf={nameOf} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Images with the records they are linked to, then same-page groups of uncaptioned images that code could
 * not assign. Shown a page of images at a time.
 */
function MediaList({
  view,
  nameOf,
  onSelect,
}: {
  view: LedgerView;
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  const [limit, setLimit] = useState(24);
  const byImage = new Map<string, LedgerMediaReference[]>();
  for (const m of view.ledger.mediaReferences)
    byImage.set(m.imageId, [...(byImage.get(m.imageId) ?? []), m]);
  const groups = view.ledger.mediaCandidates;
  const images = [...byImage];
  return (
    <div className="space-y-6 text-sm">
      <p className="text-muted-foreground text-xs">
        이미지 {images.length}장에 객체{' '}
        {new Set(view.ledger.mediaReferences.map((m) => m.recordId)).size}개
        연결 · 같은 쪽 후보 {groups.length}쪽
      </p>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {images.slice(0, limit).map(([imageId, refs]) => (
          <li key={imageId} className="flex gap-2 rounded border p-2">
            <MediaThumb view={view} imageId={imageId} />
            <div className="min-w-0 space-y-1 text-xs">
              {refs.map((m) => (
                <div key={m.id}>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => onSelect(m.recordId)}
                  >
                    {nameOf(m.recordId)}
                  </button>
                  <span className="text-muted-foreground">
                    {' '}
                    · {MEDIA_BASIS_LABEL[m.basis]}
                  </span>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {images.length > limit && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLimit((l) => l + 48)}
        >
          더 보기 ({images.length - limit}장 남음)
        </Button>
      )}
      {groups.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-medium">
            같은 쪽의 캡션 없는 이미지 (쪽 단위 후보)
          </h3>
          {groups.slice(0, 6).map((g) => (
            <div key={g.id} className="space-y-1 rounded border p-2">
              <div className="text-xs">
                PDF {g.pdfPageNo}쪽 · 객체 {g.recordIds.map(nameOf).join(', ')}
              </div>
              <div className="flex flex-wrap gap-2">
                {g.imageIds.map((id) => (
                  <MediaThumb key={id} view={view} imageId={id} />
                ))}
              </div>
            </div>
          ))}
          {groups.length > 6 && (
            <p className="text-muted-foreground text-xs">
              외 {groups.length - 6}개 쪽은 각 객체 화면에 있습니다.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function ReviewList({
  view,
  nameOf,
}: {
  view: LedgerView;
  nameOf: (id: string) => string;
}) {
  const [limit, setLimit] = useState(30);
  const items = view.ledger.reviewItems;
  const decisions = items.filter((i) => i.kind === 'profile_decision');
  const identities = items.filter((i) => i.kind === 'identity');
  const collectives = new Map<string, LedgerReviewItem[]>();
  for (const i of items)
    if (i.collective) {
      const key = `${i.collective.path.join(' > ')} · ${KIND_LABEL[i.collective.kind] ?? i.collective.kind} ${i.collective.members}개`;
      collectives.set(key, [...(collectives.get(key) ?? []), i]);
    }
  const segments = items.filter((i) => i.kind === 'segment' && !i.collective);
  const parentItems = items.filter((i) => i.kind === 'parent');
  const mediaItems = items.filter((i) => i.kind === 'media');
  const attributeItems = items.filter((i) => i.kind === 'attribute');
  const linkItems = items.filter((i) => i.kind === 'link');
  return (
    <div className="space-y-6 text-sm">
      <section>
        <h3 className="mb-2 font-medium">관계 미결 {linkItems.length}건</h3>
        <p className="text-muted-foreground mb-2 text-xs">
          관계 단서가 있지만 이름 바로 뒤에 서술어가 없어 코드가 관계를 정하지
          않은 서술입니다.
        </p>
        <ul className="space-y-1">
          {linkItems.map((i) => (
            <li key={i.id}>
              {nameOf(i.recordIds[0])} · {reasonText(i.reasons)}
              <span className="text-muted-foreground text-xs">
                {' '}
                — {i.pdfPageNo ? `PDF ${i.pdfPageNo}쪽 · ` : ''}후보{' '}
                {i.candidateRecordIds?.map(nameOf).join(', ')} · {i.text}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-medium">
          속성 소유자 미결 {attributeItems.length}건
        </h3>
        <p className="text-muted-foreground mb-2 text-xs">
          문장이 같은 종류의 다른 객체도 언급해 값이 누구의 것인지 정하지 않은
          경우입니다. 속성에는 넣지 않았습니다.
        </p>
        <ul className="space-y-1">
          {attributeItems.map((i) => (
            <li key={i.id}>
              {i.recordIds.map(nameOf).join(', ')} · {i.detail}
              <span className="text-muted-foreground text-xs">
                {' '}
                — {i.pdfPageNo ? `PDF ${i.pdfPageNo}쪽 · ` : ''}
                {i.candidateRecordIds?.length
                  ? `함께 언급 ${i.candidateRecordIds.map(nameOf).join(', ')} · `
                  : ''}
                {i.text}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-medium">
          도면·사진 검수 {mediaItems.length}건
        </h3>
        <ul className="space-y-1">
          {mediaItems.map((i) => (
            <li key={i.id}>
              {reasonText(i.reasons)}
              <span className="text-muted-foreground text-xs">
                {' '}
                — {i.pdfPageNo ? `PDF ${i.pdfPageNo}쪽 · ` : ''}이미지{' '}
                {i.imageIds?.length ?? 0}장 · 객체{' '}
                {i.recordIds.map(nameOf).join(', ')}
                {i.text ? ` · ${i.text}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-medium">부모 미결 {parentItems.length}건</h3>
        <ul className="space-y-1">
          {parentItems.map((i) => (
            <li key={i.id}>
              {nameOf(i.recordIds[0])}
              <span className="text-muted-foreground text-xs">
                {' '}
                — {reasonText(i.reasons.slice(1))} ·{' '}
                <ParentItemLine item={i} nameOf={nameOf} />
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-medium">유형 결정 {decisions.length}건</h3>
        {decisions.length === 0 ? (
          <p className="text-muted-foreground">
            보고서 유형 규칙은 모두 정해져 있습니다.
          </p>
        ) : (
          <ul className="space-y-1">
            {decisions.map((d) => (
              <li key={d.id}>{d.detail}</li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-2 font-medium">
          같은 객체인지 불확실 {identities.length}건
        </h3>
        <ul className="space-y-1">
          {identities.map((i) => (
            <li key={i.id}>
              {i.reasons.includes('alias_duplicate') && (
                <Badge variant="warning" className="mr-1 px-1 text-[10px]">
                  약칭 중복
                </Badge>
              )}
              {i.recordIds.map(nameOf).join(' ↔ ')}
              <span className="text-muted-foreground"> — {i.detail}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-medium">
          장 집합 서술 {collectives.size}묶음 (
          {[...collectives.values()].reduce((a, v) => a + v.length, 0)}건)
        </h3>
        <p className="text-muted-foreground mb-2 text-xs">
          한 문장이 장 전체 객체를 가리키는 경우입니다. 집합마다 한 번 결정하며,
          구성원에게는 검수 표시를 붙이지 않습니다.
        </p>
        <ul className="space-y-2">
          {[...collectives.entries()].map(([key, group]) => (
            <li key={key} className="rounded border p-2">
              <span className="block font-medium">
                {key} · 서술 {group.length}건
              </span>
              {group.slice(0, 3).map((i) => (
                <span
                  key={i.id}
                  className="text-muted-foreground block truncate text-xs"
                >
                  {i.pdfPageNo ? `PDF ${i.pdfPageNo}쪽 · ` : ''}
                  {i.text}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-medium">
          구간별 배정 검수 {segments.length}건
        </h3>
        <ul className="space-y-2">
          {segments.slice(0, limit).map((i) => {
            const open = i.recordIds.filter(
              (id) => !i.confirmedRecordIds.includes(id),
            );
            return (
              <li key={i.id} className="rounded border p-2">
                <span className="block font-medium">
                  {reasonText(i.reasons)}
                </span>
                <span className="block whitespace-pre-wrap">{i.text}</span>
                <span className="text-muted-foreground block text-xs">
                  {i.pdfPageNo ? `PDF ${i.pdfPageNo}쪽 · ` : ''}
                  미정{' '}
                  {open.length > 8
                    ? `${open.length}개`
                    : open.map(nameOf).join(', ') || '없음'}
                  {i.confirmedRecordIds.length > 0 &&
                    ` · 확정 ${i.confirmedRecordIds.length > 8 ? `${i.confirmedRecordIds.length}개` : i.confirmedRecordIds.map(nameOf).join(', ')}`}
                </span>
              </li>
            );
          })}
        </ul>
        {segments.length > limit && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setLimit((l) => l + 50)}
          >
            더 보기 ({segments.length - limit}건 남음)
          </Button>
        )}
      </section>
    </div>
  );
}

/**
 * The archaeology ledger assembled from the latest thin attachment run: archaeological objects with their
 * unchanged excerpts and sources, the containment hierarchy with how each parent was decided, and what a
 * person must decide. Relations, attributes and media are not extracted yet and are shown as pending. This
 * demo shows review flags only; it does not edit them.
 */
export function ArchaeologyLedgerView({ taskId }: { taskId: string }) {
  const attachment = useContentAttachment(taskId);
  const revision = attachment.query.data?.thin?.completedAt ?? null;
  const { data, isLoading, error } = useArchaeologyLedger(taskId, revision);
  const [tab, setTab] = useState<Tab>('records');
  const [kind, setKind] = useState<string | null>(null);
  const [onlyReview, setOnlyReview] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const view = data?.ledger ?? null;

  const derived = useMemo(() => {
    if (!view) return null;
    const records = view.ledger.records;
    const byId = new Map(records.map((r) => [r.id, r]));
    const itemsOf = new Map<string, LedgerReviewItem[]>();
    for (const item of view.ledger.reviewItems)
      for (const id of item.recordIds)
        if (!item.confirmedRecordIds.includes(id) || item.kind !== 'segment')
          itemsOf.set(id, [...(itemsOf.get(id) ?? []), item]);
    const counts = new Map<string, number>();
    for (const r of records)
      counts.set(r.recordKind, (counts.get(r.recordKind) ?? 0) + 1);
    const childrenOf = new Map<string, LedgerRecord[]>();
    for (const r of records)
      if (r.parentRecordId)
        childrenOf.set(r.parentRecordId, [
          ...(childrenOf.get(r.parentRecordId) ?? []),
          r,
        ]);
    return { byId, itemsOf, counts, childrenOf };
  }, [view]);

  if (isLoading)
    return <p className="text-muted-foreground text-sm">원장을 불러오는 중…</p>;
  if (error)
    return (
      <p className="text-destructive text-sm">원장 오류: {error.message}</p>
    );
  if (!view || !derived)
    return (
      <Card>
        <CardHeader>
          <CardTitle>고고학 데이터 원장</CardTitle>
          <CardDescription>
            아직 원장이 없습니다. 아래 &lsquo;추출 실행&rsquo;을 펼쳐 객체 후보
            탐색, 배정 계획, 얇은 원문 배정을 마치면 여기에 원장이 나타납니다.
          </CardDescription>
        </CardHeader>
      </Card>
    );

  const { ledger } = view;
  const nameOf = (id: string) => {
    const r = derived.byId.get(id);
    return r ? recordLabel(r, view) : id;
  };
  const query = search.trim();
  const shown = ledger.records
    .filter((r) => !kind || r.recordKind === kind)
    .filter((r) => !onlyReview || r.needsReview)
    .filter(
      (r) =>
        !query ||
        r.sourceName.includes(query) ||
        r.sourceIdentifier?.includes(query),
    )
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.recordKind) - KIND_ORDER.indexOf(b.recordKind) ||
        a.ordinal - b.ordinal,
    );
  const selected =
    (selectedId && derived.byId.get(selectedId)) || shown[0] || null;
  const flagged = ledger.records.filter((r) => r.needsReview).length;
  const decisions = ledger.reviewItems.filter(
    (i) => i.kind === 'profile_decision',
  ).length;
  const profile = ledger.ledger.reportProfile;

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(ledger, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ledger.ledger.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <CardTitle>고고학 데이터 원장</CardTitle>
          <CardDescription>
            객체 {ledger.records.length}개 · 원문 발췌{' '}
            {ledger.records.reduce((a, r) => a + r.content.length, 0)}건 · 검수
            필요 객체 {flagged}개 · 결정할 항목 {ledger.reviewItems.length}건
          </CardDescription>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <Badge
              variant={STATUS_BADGE[ledger.ledger.validationStatus].variant}
            >
              {STATUS_BADGE[ledger.ledger.validationStatus].label}
            </Badge>
            {decisions > 0 && (
              <Badge variant="warning">유형 결정 필요 {decisions}건</Badge>
            )}
            {!ledger.pending.includes('attributes') && (
              <Badge variant="outline">
                속성 {ledger.attributes.length}개 ·{' '}
                {new Set(ledger.attributes.map((a) => a.recordId)).size}개 객체
              </Badge>
            )}
            {ledger.layerMentions.length > 0 && (
              <Badge variant="outline">
                층위 언급 후보 {ledger.layerMentions.length}개
              </Badge>
            )}
            {view.discoveryScope && (
              <Badge
                variant="outline"
                title={view.discoveryScope
                  .map(
                    (c) =>
                      `${c.title}${c.added ? ' (조사 장 신호로 추가)' : ''}`,
                  )
                  .join(' · ')}
              >
                탐색 범위 {view.discoveryScope.length}장
                {view.discoveryScope.some((c) => c.added)
                  ? ` · 신호로 추가 ${view.discoveryScope
                      .filter((c) => c.added)
                      .map((c) => c.title)
                      .join(', ')}`
                  : ''}
              </Badge>
            )}
            {view.placeAliases.status === 'applied' && (
              <Badge variant="outline">
                {view.placeAliases.source === 'model'
                  ? '자동 제안'
                  : '사람 지정'}{' '}
                대응 규칙 {view.placeAliases.ruleIds.length}개
              </Badge>
            )}
            {view.placeAliases.status === 'invalid' && (
              <Badge variant="destructive">대응 표 적용 안 됨</Badge>
            )}
            <span>
              보고서 유형{' '}
              {profile
                ? profile.source === 'router'
                  ? '자동 분류'
                  : '사람 지정'
                : '지정 없음'}{' '}
              · 배정 {view.thin.attachedUnits}/{view.thin.totalUnits}묶음 ·{' '}
              {view.thin.modelId} ·{' '}
              {(view.thin.completedAt ?? '').slice(0, 16).replace('T', ' ')}
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={download}>
          <Download className="mr-2 h-4 w-4" />
          원장 JSON
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <IssuePanel view={view} nameOf={nameOf} />
        <PlaceAliasControl taskId={taskId} view={view} />
        <div className="flex flex-wrap gap-2 border-b pb-2">
          {(
            [
              ['records', `객체 ${ledger.records.length}`],
              ['review', `검수 항목 ${ledger.reviewItems.length}`],
              ...(ledger.pending.includes('parent_hierarchy')
                ? []
                : [['hierarchy', '포함 계층']]),
              ...(ledger.pending.includes('media_references')
                ? []
                : [['media', `도면·사진 ${ledger.mediaReferences.length}`]]),
              ...(ledger.pending.includes('links')
                ? []
                : [['links', `관계 ${ledger.links.length}`]]),
              ...PENDING.filter((p) => ledger.pending.includes(p.id)).map(
                (p) => [p.id, `${p.label} · 미추출`],
              ),
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={tab === id ? 'default' : 'ghost'}
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        {tab === 'records' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant={kind === null ? 'secondary' : 'ghost'}
                  onClick={() => setKind(null)}
                >
                  전체
                </Button>
                {KIND_ORDER.filter((k) => derived.counts.get(k)).map((k) => (
                  <Button
                    key={k}
                    size="sm"
                    variant={kind === k ? 'secondary' : 'ghost'}
                    onClick={() => setKind(k)}
                  >
                    {KIND_LABEL[k]} {derived.counts.get(k)}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="번호·명칭 검색"
                  className="h-8"
                />
                <label className="flex shrink-0 items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={onlyReview}
                    onChange={(e) => setOnlyReview(e.target.checked)}
                  />
                  검수 필요만
                </label>
              </div>
              <ul className="max-h-[36rem] divide-y overflow-auto rounded border">
                {shown.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      className={`hover:bg-muted flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${selected?.id === r.id ? 'bg-muted' : ''}`}
                    >
                      <span className="text-muted-foreground w-12 shrink-0 text-xs">
                        {KIND_LABEL[r.recordKind]}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {recordLabel(r, view)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        발췌 {r.content.length}
                      </span>
                      {r.needsReview && (
                        <Badge variant="warning" className="px-1.5 text-[10px]">
                          검수
                        </Badge>
                      )}
                    </button>
                  </li>
                ))}
                {shown.length === 0 && (
                  <li className="text-muted-foreground p-2 text-sm">
                    조건에 맞는 객체가 없습니다.
                  </li>
                )}
              </ul>
            </div>
            <div className="max-h-[42rem] overflow-auto rounded border p-3">
              {selected ? (
                <RecordDetail
                  record={selected}
                  view={view}
                  itemsOf={derived.itemsOf.get(selected.id) ?? []}
                  nameOf={nameOf}
                  childrenOf={derived.childrenOf.get(selected.id) ?? []}
                  onSelect={setSelectedId}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  객체를 고르세요.
                </p>
              )}
            </div>
          </div>
        )}
        {tab === 'review' && <ReviewList view={view} nameOf={nameOf} />}
        {tab === 'media' && (
          <MediaList
            view={view}
            nameOf={nameOf}
            onSelect={(id) => {
              setSelectedId(id);
              setKind(null);
              setOnlyReview(false);
              setSearch('');
              setTab('records');
            }}
          />
        )}
        {tab === 'links' && !ledger.pending.includes('links') && (
          <LinkList
            view={view}
            nameOf={nameOf}
            onSelect={(id) => {
              setSelectedId(id);
              setKind(null);
              setOnlyReview(false);
              setSearch('');
              setTab('records');
            }}
          />
        )}
        {tab === 'hierarchy' && (
          <HierarchyTree
            view={view}
            childrenOf={derived.childrenOf}
            nameOf={nameOf}
            onSelect={(id) => {
              setSelectedId(id);
              setKind(null);
              setOnlyReview(false);
              setSearch('');
              setTab('records');
            }}
          />
        )}
        {PENDING.filter(
          (p) => p.id === tab && ledger.pending.includes(p.id),
        ).map((p) => (
          <div
            key={p.id}
            className="text-muted-foreground rounded border p-4 text-sm"
          >
            {p.label}({p.note})은 엔진이 아직 추출하지 않습니다. 비어 있는 것은
            보고서에 없어서가 아니라 추출 단계가 아직 없기 때문입니다.
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
