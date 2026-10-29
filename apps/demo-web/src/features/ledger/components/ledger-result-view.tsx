'use client';

import type {
  LedgerRecord,
  LedgerRecordSource,
  LedgerReviewItem,
} from '@heripo/ledger-extractor';

import { Download, FileText, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { SupportedLanguage } from '~/lib/hooks/use-browser-language';
import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';
import type { ArchaeologyLedgerView as LedgerView } from '~/lib/ledger/archaeology-ledger';

import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Checkbox } from '~/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';

import { useArchaeologyLedger } from '../hooks/use-archaeology-ledger';
import { useContentAttachment } from '../hooks/use-content-attachment';
import { PlaceAliasControl } from './place-alias-control';

const text = {
  ko: {
    title: '고고학 데이터 원장',
    loading: '원장을 불러오는 중…',
    error: '원장을 불러오지 못했습니다',
    empty: '아직 원장이 없습니다. 원장 추출이 끝나면 여기에 나타납니다.',
    records: (n: number) => `객체 ${n}개`,
    flagged: (n: number) => `검수 필요 ${n}개`,
    reportChecks: (n: number) => `보고서·여러 객체 단위 확인 ${n}건`,
    download: '원장 JSON 내려받기',
    all: '전체',
    search: '번호·이름 검색',
    onlyReview: '검수 필요만',
    noMatch: '조건에 맞는 객체가 없습니다.',
    needsReview: '검수 필요',
    parent: '상위',
    none: '없음',
    children: (n: number) => `하위 ${n}개`,
    attributes: '속성',
    noAttributes: '원문에서 찾은 속성이 없습니다.',
    key: '항목',
    value: '값',
    unit: '단위',
    relations: '관계',
    noRelations: '원문에서 찾은 관계가 없습니다.',
    layerCandidate: '층위 관계 후보',
    images: '도면·사진',
    reviewItems: '검수할 내용',
    sources: (n: number) => `원문 ${n}건 보기`,
    sourcesTitle: (name: string) => `${name} · 원문`,
    sourcesNote: '이 객체에 배정된 원문 발췌와 그 위치입니다.',
    evidence: '근거',
    page: (n: number | null | undefined) => (n ? `PDF ${n}쪽` : '쪽 정보 없음'),
    table: (id: string, row: number, col: number) =>
      `표 ${id} ${row}행 ${col}열`,
    noCaption: '캡션 없음',
    moreImages: (n: number) => `외 ${n}장 더 보기`,
    reportTitle: '보고서 전체나 여러 객체에 걸친 확인 항목',
  },
  en: {
    title: 'Archaeological Data Ledger',
    loading: 'Loading the ledger…',
    error: 'Could not load the ledger',
    empty: 'No ledger yet. It appears here once ledger extraction finishes.',
    records: (n: number) => `${n} records`,
    flagged: (n: number) => `${n} need review`,
    reportChecks: (n: number) =>
      `${n} checks across the report or many records`,
    download: 'Download ledger JSON',
    all: 'All',
    search: 'Search number or name',
    onlyReview: 'Needs review only',
    noMatch: 'No records match.',
    needsReview: 'Needs review',
    parent: 'Parent',
    none: 'None',
    children: (n: number) => `${n} children`,
    attributes: 'Attributes',
    noAttributes: 'No attributes found in the source.',
    key: 'Field',
    value: 'Value',
    unit: 'Unit',
    relations: 'Relations',
    noRelations: 'No relations found in the source.',
    layerCandidate: 'Possible layer relation',
    images: 'Drawings and photos',
    reviewItems: 'To review',
    sources: (n: number) => `View ${n} source excerpts`,
    sourcesTitle: (name: string) => `${name} · source text`,
    sourcesNote: 'Source excerpts assigned to this record and where they are.',
    evidence: 'Evidence',
    page: (n: number | null | undefined) => (n ? `PDF p. ${n}` : 'No page'),
    table: (id: string, row: number, col: number) =>
      `Table ${id}, row ${row}, column ${col}`,
    noCaption: 'No caption',
    moreImages: (n: number) => `Show ${n} more`,
    reportTitle: 'Checks across the whole report or many records',
  },
} as const;
type Text = (typeof text)[SupportedLanguage];

const KIND_LABEL: Record<SupportedLanguage, Record<string, string>> = {
  ko: {
    site: '유적',
    area: '조사구역',
    trench: '트렌치',
    layer: '층위',
    feature: '유구',
    artifact: '유물',
    shipwreck: '침몰선',
    unknown: '미상',
  },
  en: {
    site: 'Site',
    area: 'Survey area',
    trench: 'Trench',
    layer: 'Layer',
    feature: 'Feature',
    artifact: 'Artifact',
    shipwreck: 'Shipwreck',
    unknown: 'Unknown',
  },
};
const KIND_ORDER = Object.keys(KIND_LABEL.ko);
/** A review item naming more records than this is shown with the report, not flagged on each record. */
const RECORD_ITEM_LIMIT = 10;
/** Thumbnails shown before the rest of a record's drawings and photos are opened. */
const MEDIA_PREVIEW = 6;

/** What a researcher has to check, in plain words; unknown reasons fall back to their code. */
const REASON_LABEL: Record<SupportedLanguage, Record<string, string>> = {
  ko: {
    whole_unit: '이 부분 전체의 판단이 불안정함',
    invalid_run: '자동 판단이 실패함',
    contested_targets: '어느 객체의 설명인지 판단이 갈림',
    uncertainty_differs: '어느 객체의 설명인지 불확실함',
    area: '조사구역에 대한 설명인지 확인 필요',
    layer: '층위에 대한 설명인지 확인 필요',
    large_collective: '많은 객체에 한꺼번에 붙은 문장',
    large_handle: '장 전체 객체에 붙은 문장',
    identity_uncertain: '다른 객체와 같은 것인지 불확실함',
    profile_decision: '보고서 유형 판단이 필요함',
    unresolved_parent: '상위 객체를 정하지 못함',
    scope_only: '장 범위로만 상위 객체가 추정됨',
    title_only: '장 제목으로만 상위 객체가 추정됨',
    unmatched_place: '원문 장소와 맞는 객체가 없음',
    confirming_phrase: '확인 표현만 있음',
    row_only: '표 행만으로 상위 객체가 추정됨',
    ambiguous_target: '상위 객체 후보가 여럿임',
    conflicting_targets: '상위 객체 후보가 서로 충돌함',
    cycle: '상위 관계가 순환함',
    not_judged: '상위 객체 판단이 아직 없음',
    judged_none: '상위 객체가 없다고 판단됨',
    judgment_split: '상위 객체 판단이 갈림',
    alias_unresolved: '장소 약칭에 맞는 객체가 없음',
    alias_duplicate: '장소 약칭이 겹침',
    media_ambiguous: '같은 번호의 도면·사진이 여럿임',
    media_caption_several: '캡션이 여러 객체를 가리킴',
    attribute_owner_ambiguous: '어느 객체의 값인지 불확실함',
    link_enclosure: '둘러싼 관계인지 확인 필요',
    link_several_targets: '관계 대상이 여럿 나열됨',
    link_unclear: '관계를 정할 서술이 없음',
  },
  en: {
    whole_unit: 'Judgments for this whole part are unstable',
    invalid_run: 'The automatic judgment failed',
    contested_targets: 'Runs disagree on which record this describes',
    uncertainty_differs: 'Unclear which record this describes',
    area: 'Check whether this describes the survey area',
    layer: 'Check whether this describes the layer',
    large_collective: 'A sentence attached to many records at once',
    large_handle: 'A sentence attached to a whole chapter of records',
    identity_uncertain: 'May be the same as another record',
    profile_decision: 'The report type needs a decision',
    unresolved_parent: 'The parent could not be decided',
    scope_only: 'Parent inferred from the chapter scope only',
    title_only: 'Parent inferred from the chapter title only',
    unmatched_place: 'No record matches the place in the source',
    confirming_phrase: 'Only a confirming phrase',
    row_only: 'Parent inferred from a table row only',
    ambiguous_target: 'Several possible parents',
    conflicting_targets: 'Possible parents conflict',
    cycle: 'The parents form a cycle',
    not_judged: 'The parent is not judged yet',
    judged_none: 'Judged to have no parent',
    judgment_split: 'Parent judgments disagree',
    alias_unresolved: 'No record matches the place abbreviation',
    alias_duplicate: 'Place abbreviations overlap',
    media_ambiguous: 'Several drawings or photos share a number',
    media_caption_several: 'The caption names several records',
    attribute_owner_ambiguous: 'Unclear which record the value belongs to',
    link_enclosure: 'Check whether this is an enclosure',
    link_several_targets: 'Several related records are listed',
    link_unclear: 'No wording decides the relation',
  },
};

const recordLabel = (r: LedgerRecord, view: LedgerView) =>
  (r.sourceIdentifier && !r.sourceName.includes(r.sourceIdentifier)
    ? `${r.sourceIdentifier} ${r.sourceName}`
    : r.sourceName) + (view.scopes[r.id] ? ` · ${view.scopes[r.id]}` : '');

const reasonsOf = (item: LedgerReviewItem, lang: SupportedLanguage) =>
  item.reasons.map((r) => REASON_LABEL[lang][r] ?? r).join(', ');

/** Where a source excerpt is: page, chapter and table cell. */
function SourcePlace({
  source,
  view,
  t,
}: {
  source: LedgerRecordSource;
  view: LedgerView;
  t: Text;
}) {
  return (
    <span className="text-muted-foreground block text-xs">
      {t.page(source.pdfPageNo)}
      {source.chapterId &&
        ` · ${view.chapterTitles[source.chapterId] ?? source.chapterId}`}
      {source.tableCell &&
        ` · ${t.table(source.tableId ?? '', source.tableCell.rowIndex + 1, source.tableCell.columnIndex + 1)}`}
    </span>
  );
}

/** A popup with source text: a list of quotes, each with where it is. */
function SourceDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-2 text-sm">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

/** A small button that shows one piece of source text in a popup. */
function EvidenceButton({
  label,
  title,
  quote,
  place,
}: {
  label: string;
  title: string;
  quote: string;
  place: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="text-muted-foreground text-xs underline"
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <SourceDialog open={open} onOpenChange={setOpen} title={title}>
        <blockquote className="rounded border p-3">{quote}</blockquote>
        <p className="text-muted-foreground text-xs">{place}</p>
      </SourceDialog>
    </>
  );
}

function Thumb({
  view,
  imageId,
  t,
}: {
  view: LedgerView;
  imageId: string;
  t: Text;
}) {
  const [failed, setFailed] = useState(false);
  const image = view.images[imageId];
  return (
    <figure className="w-32 shrink-0 space-y-1 text-xs">
      {image && !failed ? (
        <a href={image.url} target="_blank" rel="noreferrer">
          <img
            src={image.url}
            alt={image.caption ?? imageId}
            loading="lazy"
            onError={() => setFailed(true)}
            className="bg-muted h-24 w-full rounded border object-contain"
          />
        </a>
      ) : (
        <div className="bg-muted text-muted-foreground flex h-24 items-center justify-center rounded border">
          {imageId}
        </div>
      )}
      <figcaption className="text-muted-foreground line-clamp-2">
        {image?.caption ?? `${t.noCaption} · ${t.page(image?.pdfPageNo)}`}
      </figcaption>
    </figure>
  );
}

function RecordDetail({
  record,
  view,
  items,
  childRecords,
  nameOf,
  onSelect,
  lang,
}: {
  record: LedgerRecord;
  view: LedgerView;
  items: LedgerReviewItem[];
  childRecords: LedgerRecord[];
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
  lang: SupportedLanguage;
}) {
  const t = text[lang];
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [showAllMedia, setShowAllMedia] = useState(false);
  const { ledger } = view;
  const sourceById = useMemo(
    () => new Map(ledger.sources.map((s) => [s.id, s])),
    [ledger],
  );
  const attributes = ledger.attributes.filter((a) => a.recordId === record.id);
  const links = ledger.links.filter(
    (l) => l.fromRecordId === record.id || l.toRecordId === record.id,
  );
  const layerMentions = ledger.layerMentions.filter(
    (m) => m.layerRecordId === record.id || m.recordIds.includes(record.id),
  );
  const media = ledger.mediaReferences.filter((m) => m.recordId === record.id);
  const placeOf = (sourceId?: string, page?: number | null) => {
    const s = sourceId ? sourceById.get(sourceId) : undefined;
    return [
      t.page(s?.pdfPageNo ?? page),
      s?.chapterId ? (view.chapterTitles[s.chapterId] ?? s.chapterId) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  };
  const recordButton = (id: string) => (
    <button
      type="button"
      className="underline"
      onClick={() => onSelect(id)}
      key={id}
    >
      {nameOf(id)}
    </button>
  );
  const flagged = items.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">{recordLabel(record, view)}</h3>
        <Badge variant="outline">
          {KIND_LABEL[lang][record.recordKind] ?? record.recordKind}
        </Badge>
        {flagged && <Badge variant="warning">{t.needsReview}</Badge>}
      </div>

      <div className="space-y-1 text-sm">
        <div>
          <span className="text-muted-foreground">{t.parent}</span>{' '}
          {record.parentRecordId ? recordButton(record.parentRecordId) : t.none}
        </div>
        {childRecords.length > 0 && (
          <div>
            <span className="text-muted-foreground">
              {t.children(childRecords.length)}
            </span>{' '}
            <span className="inline-flex flex-wrap gap-x-2">
              {childRecords.slice(0, 30).map((c) => recordButton(c.id))}
              {childRecords.length > 30 && <span>…</span>}
            </span>
          </div>
        )}
      </div>

      <section>
        <h4 className="mb-2 text-sm font-medium">{t.attributes}</h4>
        {attributes.length ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="py-1 pr-2 font-normal">{t.key}</th>
                <th className="py-1 pr-2 font-normal">{t.value}</th>
                <th className="py-1 pr-2 font-normal">{t.unit}</th>
                <th className="py-1 font-normal" />
              </tr>
            </thead>
            <tbody>
              {attributes.map((a) => (
                <tr key={a.id} className="border-b align-top">
                  <td className="py-1 pr-2">{a.keyText}</td>
                  <td className="py-1 pr-2">{a.valueText}</td>
                  <td className="py-1 pr-2">{a.unitText ?? ''}</td>
                  <td className="py-1 text-right">
                    <EvidenceButton
                      label={t.evidence}
                      title={`${a.keyText} · ${t.evidence}`}
                      quote={a.sourceText}
                      place={placeOf(a.metadata.sourceId, a.metadata.pdfPageNo)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted-foreground text-sm">{t.noAttributes}</p>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-sm font-medium">{t.relations}</h4>
        {links.length || layerMentions.length ? (
          <ul className="space-y-1 text-sm">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-1">
                {l.fromRecordId === record.id
                  ? nameOf(l.fromRecordId)
                  : recordButton(l.fromRecordId)}
                <Badge variant="outline" className="px-1 text-[11px]">
                  {l.relationLabel} {l.symmetric === false ? '→' : '↔'}
                </Badge>
                {l.toRecordId === record.id
                  ? nameOf(l.toRecordId)
                  : recordButton(l.toRecordId)}
                {l.needsReview && (
                  <Badge variant="warning" className="px-1 text-[11px]">
                    {t.needsReview}
                  </Badge>
                )}
                {l.evidence[0] && (
                  <EvidenceButton
                    label={t.evidence}
                    title={`${l.relationLabel} · ${t.evidence}`}
                    quote={l.evidence[0].quote ?? l.evidence[0].text}
                    place={t.page(l.evidence[0].pdfPageNo)}
                  />
                )}
              </li>
            ))}
            {layerMentions.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-1">
                {m.layerRecordId === record.id
                  ? m.recordIds.map(recordButton)
                  : recordButton(m.layerRecordId)}
                <Badge variant="outline" className="px-1 text-[11px]">
                  {t.layerCandidate}
                </Badge>
                <EvidenceButton
                  label={t.evidence}
                  title={`${t.layerCandidate} · ${t.evidence}`}
                  quote={m.text}
                  place={t.page(m.pdfPageNo)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t.noRelations}</p>
        )}
      </section>

      {media.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-medium">
            {t.images} {media.length}
          </h4>
          <div className="flex flex-wrap gap-2">
            {(showAllMedia ? media : media.slice(0, MEDIA_PREVIEW)).map((m) => (
              <Thumb key={m.id} view={view} imageId={m.imageId} t={t} />
            ))}
          </div>
          {media.length > MEDIA_PREVIEW && !showAllMedia && (
            <button
              type="button"
              className="text-muted-foreground mt-1 text-xs underline"
              onClick={() => setShowAllMedia(true)}
            >
              {t.moreImages(media.length - MEDIA_PREVIEW)}
            </button>
          )}
        </section>
      )}

      {items.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1 text-sm font-medium text-amber-700">
            <TriangleAlert className="h-4 w-4" />
            {t.reviewItems} {items.length}
          </h4>
          <ul className="space-y-1 text-sm">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                <span>{reasonsOf(i, lang)}</span>
                {i.detail && (
                  <span className="text-muted-foreground">{i.detail}</span>
                )}
                {i.text && (
                  <EvidenceButton
                    label={t.evidence}
                    title={reasonsOf(i, lang)}
                    quote={i.text}
                    place={t.page(i.pdfPageNo)}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Button variant="outline" size="sm" onClick={() => setSourcesOpen(true)}>
        <FileText className="mr-2 h-4 w-4" />
        {t.sources(record.content.length)}
      </Button>
      <SourceDialog
        open={sourcesOpen}
        onOpenChange={setSourcesOpen}
        title={t.sourcesTitle(recordLabel(record, view))}
        description={t.sourcesNote}
      >
        {record.content.map((c) => (
          <div key={c.id} className="rounded border p-3">
            <p>{c.text}</p>
            {c.sourceIds.slice(0, 1).map((id) => {
              const s = sourceById.get(id);
              return s ? (
                <SourcePlace key={id} source={s} view={view} t={t} />
              ) : null;
            })}
          </div>
        ))}
      </SourceDialog>
    </div>
  );
}

/**
 * The archaeology ledger as a researcher reads it: records by kind with their parent, attributes, relations and
 * images, a flag on records a person should check, and source text in popups. The full ledger, with every
 * source, review item and check, is in the downloaded JSON.
 */
export function LedgerResultView({ taskId }: { taskId: string }) {
  const lang = useBrowserLanguage();
  const t = text[lang];
  const attachment = useContentAttachment(taskId);
  const revision = attachment.query.data?.thin?.completedAt ?? null;
  const { data, isLoading, error } = useArchaeologyLedger(taskId, revision);
  const [kind, setKind] = useState<string | null>(null);
  const [onlyReview, setOnlyReview] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const view = data?.ledger ?? null;

  const derived = useMemo(() => {
    if (!view) return null;
    const records = view.ledger.records;
    const byId = new Map(records.map((r) => [r.id, r]));
    // a question about a few records is theirs; one over a collective or many records belongs to the report
    const wide = (item: LedgerReviewItem) =>
      !item.recordIds.length ||
      !!item.collective ||
      item.recordIds.length > RECORD_ITEM_LIMIT;
    const itemsOf = new Map<string, LedgerReviewItem[]>();
    for (const item of view.ledger.reviewItems.filter((i) => !wide(i)))
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
    const flagged = new Set(itemsOf.keys());
    const reportItems = view.ledger.reviewItems.filter(wide);
    return { byId, itemsOf, counts, childrenOf, flagged, reportItems };
  }, [view]);

  if (isLoading)
    return <p className="text-muted-foreground text-sm">{t.loading}</p>;
  if (error)
    return (
      <p className="text-destructive text-sm">
        {t.error}: {error.message}
      </p>
    );
  if (!view || !derived)
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.title}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {t.empty}
        </CardContent>
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
    .filter((r) => !onlyReview || derived.flagged.has(r.id))
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
        <div className="space-y-2">
          <CardTitle>{t.title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">{t.records(ledger.records.length)}</Badge>
            {derived.flagged.size > 0 && (
              <Badge variant="warning">{t.flagged(derived.flagged.size)}</Badge>
            )}
            {derived.reportItems.length > 0 && (
              <button
                type="button"
                className="underline"
                onClick={() => setReportOpen(true)}
              >
                {t.reportChecks(derived.reportItems.length)}
              </button>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={download}>
          <Download className="mr-2 h-4 w-4" />
          {t.download}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={kind === null ? 'default' : 'ghost'}
            onClick={() => setKind(null)}
          >
            {t.all} {ledger.records.length}
          </Button>
          {KIND_ORDER.filter((k) => derived.counts.has(k)).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={kind === k ? 'default' : 'ghost'}
              onClick={() => setKind(k)}
            >
              {KIND_LABEL[lang][k]} {derived.counts.get(k)}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.search}
              />
              <label className="flex shrink-0 items-center gap-1 text-xs">
                <Checkbox
                  checked={onlyReview}
                  onCheckedChange={(v) => setOnlyReview(v === true)}
                />
                {t.onlyReview}
              </label>
            </div>
            <ul className="max-h-[70vh] divide-y overflow-y-auto rounded border text-sm">
              {shown.length === 0 && (
                <li className="text-muted-foreground p-3">{t.noMatch}</li>
              )}
              {shown.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left ${selected?.id === r.id ? 'bg-muted' : 'hover:bg-muted/50'}`}
                  >
                    <span className="text-muted-foreground w-20 shrink-0 truncate text-xs">
                      {KIND_LABEL[lang][r.recordKind] ?? r.recordKind}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {recordLabel(r, view)}
                    </span>
                    {derived.flagged.has(r.id) && (
                      <TriangleAlert
                        className="h-4 w-4 shrink-0 text-amber-600"
                        aria-label={t.needsReview}
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded border p-4">
            {selected && (
              <RecordDetail
                key={selected.id}
                record={selected}
                view={view}
                items={derived.itemsOf.get(selected.id) ?? []}
                childRecords={derived.childrenOf.get(selected.id) ?? []}
                nameOf={nameOf}
                onSelect={setSelectedId}
                lang={lang}
              />
            )}
          </div>
        </div>
        <PlaceAliasControl taskId={taskId} view={view} lang={lang} />
      </CardContent>
      <SourceDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        title={t.reportTitle}
      >
        {derived.reportItems.map((i) => (
          <div key={i.id} className="rounded border p-3">
            <p className="font-medium">{reasonsOf(i, lang)}</p>
            {i.detail && <p>{i.detail}</p>}
            {i.text && <p className="text-muted-foreground">{i.text}</p>}
          </div>
        ))}
      </SourceDialog>
    </Card>
  );
}
