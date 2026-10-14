'use client';

import type {
  DocumentResource,
  DocumentResourceQuery,
} from '@heripo/ledger-extractor';

import { queryDocumentResources } from '@heripo/ledger-extractor';
import { useMemo, useState } from 'react';

import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

import { useDocumentResourceIndex } from '../hooks/use-document-resource-index';
import { LedgerPreviewImage } from './ledger-preview-image';

const PAGE_SIZE = 40;
const KINDS: Record<DocumentResource['kind'], string> = {
  chapter: '장',
  text: '텍스트',
  image: '이미지',
  table: '표',
  tableCell: '표 셀',
  footnote: '각주',
};

function summary(resource: DocumentResource): string {
  switch (resource.kind) {
    case 'chapter':
      return resource.data.originTitle;
    case 'image':
    case 'table':
      return resource.data.caption?.fullText ?? '캡션 없음';
    default:
      return resource.data.text;
  }
}

function pageLabel(resource: DocumentResource): string {
  const range = resource.logicalPageRange;
  const logical =
    range === null
      ? '미상'
      : range.startPageNo === range.endPageNo
        ? String(range.startPageNo)
        : `${range.startPageNo}~${range.endPageNo}`;
  return `${resource.pdfPageNo === null ? 'PDF 미지정' : `PDF ${resource.pdfPageNo}`} · 논리 ${logical}${resource.kind === 'chapter' ? ' (시작)' : ''}`;
}

function ResourceBody({ resource }: { resource: DocumentResource }) {
  if (resource.kind === 'image') {
    return (
      <LedgerPreviewImage
        key={resource.key}
        id={resource.resourceId!}
        pdfPageNo={resource.pdfPageNo!}
        url={resource.data.path}
      />
    );
  }
  if (resource.kind === 'table') {
    return (
      <div className="overflow-auto">
        <p className="text-muted-foreground mb-2 text-xs">
          아래 좌표는 실제 grid 배열의 0부터 시작하는 인덱스입니다. 병합 셀의
          생략 칸을 복원하지 않습니다.
        </p>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {resource.data.grid.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="min-w-24 border p-2 align-top">
                    <p className="text-muted-foreground mb-1 font-mono text-xs">
                      [{r}][{c}] · span {cell.rowSpan}×{cell.colSpan}
                      {cell.isHeader ? ' · header' : ''}
                    </p>
                    <p className="whitespace-pre-wrap">{cell.text}</p>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (resource.kind === 'chapter') {
    return <p className="whitespace-pre-wrap">{resource.data.originTitle}</p>;
  }
  return (
    <p className="text-sm leading-7 whitespace-pre-wrap">
      {resource.data.text}
    </p>
  );
}

/** Whole-document S0 inspection; filters never change the input or register ledger objects. */
export function DocumentResourceInspector({ taskId }: { taskId: string }) {
  const { data, isLoading, error } = useDocumentResourceIndex(taskId);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [pdfPage, setPdfPage] = useState('');
  const [logicalPage, setLogicalPage] = useState('');
  const [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState('');
  const index = data?.index;
  const invalidPage =
    (pdfPage !== '' &&
      (!/^\d+$/.test(pdfPage) ||
        !Number.isSafeInteger(Number(pdfPage)) ||
        Number(pdfPage) < 1)) ||
    (logicalPage !== '' &&
      (!/^-?\d+$/.test(logicalPage) ||
        !Number.isSafeInteger(Number(logicalPage))));
  const chapters = useMemo(
    () => index?.resources.filter((r) => r.kind === 'chapter') ?? [],
    [index],
  );
  const filtered = useMemo(() => {
    if (!index || invalidPage) return [];
    const query: DocumentResourceQuery = {};
    if (kind) query.kind = kind as DocumentResource['kind'];
    if (chapterId) query.chapterId = chapterId;
    if (text) query.text = text;
    if (pdfPage !== '') query.pdfPageNo = Number(pdfPage);
    if (logicalPage !== '') query.logicalPageNo = Number(logicalPage);
    return queryDocumentResources(index, query);
  }, [index, invalidPage, kind, chapterId, text, pdfPage, logicalPage]);
  const selected =
    filtered.find((r) => r.key === selectedKey) ?? filtered[page * PAGE_SIZE];
  const change = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(0);
    setSelectedKey('');
  };
  const chapterLabel = (id: string): string => {
    const node = chapters.find((ch) => ch.resourceId === id);
    if (!node) return id;
    return chapters
      .filter(
        (ch) =>
          node.key === ch.key || node.key.startsWith(`${ch.key}/children/`),
      )
      .map((ch) => `${ch.resourceId} ${summary(ch)}`)
      .join(' / ');
  };
  const exportIndex = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${index!.reportId}-s0-resource-index.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>전체 문서 자원 조회</CardTitle>
          <Button variant="outline" onClick={exportIndex} disabled={!data}>
            S0 색인 JSON 다운로드
          </Button>
        </div>
        <CardDescription>
          원문·캡션·ID·sourceRef를 그대로 조회합니다. 장 소속은 전처리 결과의
          직접 소속이며, 목록은 입력 저장 순서입니다. PDF 내 읽기 순서나 원장
          객체를 판정한 결과가 아닙니다.
        </CardDescription>
        {data && (
          <p className="text-muted-foreground font-mono text-xs break-all">
            입력 SHA-256: {data.inputSha256}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p role="status">전체 문서 색인을 만드는 중…</p>}
        {error && (
          <p role="alert">색인을 불러오지 못했습니다: {error.message}</p>
        )}
        {index && (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="space-y-1 text-sm xl:col-span-2">
                ID · sourceRef · 원문 검색
                <input
                  aria-label="ID · sourceRef · 원문 검색"
                  className="bg-background mt-1 w-full rounded-md border p-2"
                  value={text}
                  placeholder="예: 우물, txt-761, #/texts/5616"
                  onChange={(e) => change(setText, e.target.value)}
                />
              </label>
              <label className="text-sm">
                종류
                <select
                  aria-label="자원 종류"
                  className="bg-background mt-1 w-full rounded-md border p-2"
                  value={kind}
                  onChange={(e) => change(setKind, e.target.value)}
                >
                  <option value="">전체 종류</option>
                  {Object.entries(KINDS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                PDF 페이지
                <input
                  aria-label="PDF 페이지"
                  className="bg-background mt-1 w-full rounded-md border p-2"
                  value={pdfPage}
                  placeholder="1 이상"
                  onChange={(e) => change(setPdfPage, e.target.value)}
                />
              </label>
              <label className="text-sm">
                논리 페이지
                <input
                  aria-label="논리 페이지"
                  className="bg-background mt-1 w-full rounded-md border p-2"
                  value={logicalPage}
                  placeholder="음수 · 0 · 양수"
                  onChange={(e) => change(setLogicalPage, e.target.value)}
                />
              </label>
              <label className="text-sm md:col-span-2 xl:col-span-5">
                장 직접 소속
                <select
                  aria-label="장 직접 소속"
                  className="bg-background mt-1 w-full rounded-md border p-2"
                  value={chapterId}
                  onChange={(e) => change(setChapterId, e.target.value)}
                >
                  <option value="">전체 문서</option>
                  {chapters.map((ch) => (
                    <option key={ch.key} value={ch.resourceId!}>
                      {chapterLabel(ch.resourceId!)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p aria-live="polite">
                전체 {index.resources.length.toLocaleString()}개 중{' '}
                {filtered.length.toLocaleString()}개 일치 · 검색은 문자 그대로
                부분 일치 · 필터는 모두 함께 적용
              </p>
              <Button
                variant="ghost"
                onClick={() => {
                  setText('');
                  setKind('');
                  setChapterId('');
                  setPdfPage('');
                  setLogicalPage('');
                  setPage(0);
                  setSelectedKey('');
                }}
              >
                필터 초기화
              </Button>
            </div>
            {invalidPage && (
              <p role="alert">
                PDF 페이지는 1 이상의 정수, 논리 페이지는 음수·0·양의 정수를
                입력하세요.
              </p>
            )}
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="space-y-3">
                <div className="max-h-[680px] space-y-1 overflow-auto rounded-md border p-2">
                  {filtered
                    .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                    .map((resource) => (
                      <button
                        type="button"
                        key={resource.key}
                        aria-pressed={selected?.key === resource.key}
                        onClick={() => setSelectedKey(resource.key)}
                        className={`w-full rounded-md border p-3 text-left ${selected?.key === resource.key ? 'border-primary bg-muted' : 'hover:bg-muted/50 border-transparent'}`}
                      >
                        <p className="text-xs">
                          <span className="font-medium">
                            {KINDS[resource.kind]}
                          </span>{' '}
                          ·{' '}
                          <span className="font-mono">
                            {resource.resourceId ?? resource.key}
                          </span>
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm whitespace-pre-wrap">
                          {summary(resource)}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {pageLabel(resource)}
                        </p>
                      </button>
                    ))}
                  {filtered.length === 0 && (
                    <p className="p-3 text-sm">일치하는 자원이 없습니다.</p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => {
                      setPage(page - 1);
                      setSelectedKey('');
                    }}
                  >
                    이전
                  </Button>
                  <span className="text-sm">
                    {filtered.length === 0 ? 0 : page + 1} /{' '}
                    {Math.ceil(filtered.length / PAGE_SIZE)}
                  </span>
                  <Button
                    variant="outline"
                    disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                    onClick={() => {
                      setPage(page + 1);
                      setSelectedKey('');
                    }}
                  >
                    다음
                  </Button>
                </div>
              </div>
              {selected && (
                <div className="min-w-0 space-y-4 rounded-md border p-4">
                  <div className="space-y-2 text-sm">
                    <h3 className="font-semibold">
                      {KINDS[selected.kind]} ·{' '}
                      {selected.resourceId ?? '입력 ID 없음'}
                    </h3>
                    <p>{pageLabel(selected)}</p>
                    <p className="break-words">
                      장:{' '}
                      {selected.chapterIds.length
                        ? selected.chapterIds.map(chapterLabel).join(' ; ')
                        : '소속 없음'}
                    </p>
                    <p className="font-mono text-xs break-all">
                      입력 위치: {selected.key}
                    </p>
                    <p className="font-mono text-xs break-all">
                      sourceRef: {selected.sourceRefs.join(' ; ') || '없음'}
                    </p>
                    {selected.kind === 'tableCell' && (
                      <p>
                        부모 표: {selected.tableId} · grid[{selected.rowIndex}][
                        {selected.columnIndex}] · 병합 {selected.data.rowSpan}×
                        {selected.data.colSpan}
                      </p>
                    )}
                  </div>
                  <div className="max-h-[500px] overflow-auto border-t pt-4">
                    <ResourceBody resource={selected} />
                  </div>
                  <details>
                    <summary className="cursor-pointer text-sm">
                      자원 JSON 보기
                    </summary>
                    <pre className="bg-muted/50 mt-2 max-h-80 overflow-auto rounded p-3 text-xs">
                      {JSON.stringify(selected, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
