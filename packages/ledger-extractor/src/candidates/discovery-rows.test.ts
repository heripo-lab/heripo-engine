import { describe, expect, test } from 'vitest';

import {
  pairs,
  prepare,
  registry,
  sections,
} from './candidate-discovery.test-fixture';
import {
  columnBlocks,
  createFollowUpUnit,
  unansweredItemTableBlocks,
  unansweredItemTableRows,
} from './discovery-rows';

describe('item-table rows', () => {
  test('counts only data rows that no candidate or row-level exclusion answers', () => {
    const { unit, id, item } = registry();
    const blank = structuredClone(unit);
    for (const r of blank.resources)
      if (r.kind === 'tableCell' && r.rowIndex === 4) r.data.text = ' ';
    for (const r of blank.resources)
      if (r.kind === 'tableCell' && r.rowIndex === 5) r.data.isHeader = true;
    const byName = { ...item('2', '뚜껑'), identifierSourceId: null };

    expect(
      unansweredItemTableRows(unit, {
        tableRole: 'item_table',
        candidates: [],
        exclusions: [],
      }),
    ).toEqual([2, 3, 4, 5]);
    expect(
      unansweredItemTableRows(blank, {
        tableRole: 'item_table',
        candidates: [{ ...item('3', '삼족기'), identifierSourceId: null }],
        exclusions: [],
      }),
    ).toEqual([2]);
    expect(
      unansweredItemTableRows(unit, {
        tableRole: 'item_table',
        candidates: [
          {
            ...byName,
            nameSourceId: id('뚜껑'),
            evidence: [{ sourceId: id('합계'), quote: '합계' }],
          },
        ],
        exclusions: [],
      }),
    ).toEqual([3, 4]);
    expect(
      unansweredItemTableRows(unit, {
        tableRole: 'non_item_table',
        candidates: [],
        exclusions: [],
      }),
    ).toEqual([]);
    expect(
      unansweredItemTableRows(unit, { candidates: [], exclusions: [] }),
    ).toEqual([]);
    expect(
      unansweredItemTableRows(
        {
          ...unit,
          resources: [...unit.resources, ...prepare().units[0].resources],
        },
        {
          tableRole: 'item_table',
          candidates: [item('2', '뚜껑')],
          exclusions: [],
        },
      ),
    ).toEqual([3, 4, 5]);
    expect(
      unansweredItemTableRows(prepare().units[0], {
        tableRole: 'item_table',
        candidates: [],
        exclusions: [],
      }),
    ).toEqual([]);
  });

  test('narrows a unit to the given rows and keeps its table, chapter path and context', () => {
    const { unit } = registry();
    const body = prepare().units[0];

    const narrowed = createFollowUpUnit(unit, [3]);

    expect(narrowed.resources.map((r) => r.data.text)).toEqual(['3', '삼족기']);
    expect(narrowed).toMatchObject({
      unitId: unit.unitId,
      table: unit.table,
      context: unit.context,
    });
    expect(createFollowUpUnit(body, [0]).resources).toEqual([]);
  });
});

describe('side-by-side table blocks', () => {
  test('finds repeated column blocks from the spread first header row only', () => {
    const { unit } = pairs();

    expect(columnBlocks(unit)).toEqual({ count: 2, columnsPerBlock: 3 });
    expect(columnBlocks(registry().unit)).toBeNull();
    expect(columnBlocks(sections().unit)).toBeNull();
    expect(
      columnBlocks({
        ...unit,
        table: {
          ...unit.table!,
          headerRows: [['호수', '형태', '호수', '형태']],
        },
      }),
    ).toEqual({ count: 2, columnsPerBlock: 2 });
    expect(
      columnBlocks({ ...unit, table: { ...unit.table!, headerRows: [] } }),
    ).toBeNull();
  });

  test('answers a block only by an identifier cell, a first evidence or a row-level exclusion', () => {
    const { unit, cellId, item } = pairs();
    const marked = structuredClone(unit);
    for (const r of marked.resources)
      if (r.kind === 'tableCell' && r.rowIndex === 3) r.data.isHeader = true;
    const left = [item(2, 0), item(3, 0), item(4, 0)];
    const withText = {
      ...unit,
      resources: [...unit.resources, sections().unit.resources[0]],
    };

    expect(
      unansweredItemTableBlocks(withText, {
        tableRole: 'item_table',
        candidates: [],
        exclusions: [],
      }),
    ).toEqual([
      { rowIndex: 2, block: 0 },
      { rowIndex: 2, block: 1 },
      { rowIndex: 3, block: 0 },
      { rowIndex: 3, block: 1 },
      { rowIndex: 4, block: 0 },
    ]);
    expect(
      unansweredItemTableBlocks(unit, {
        tableRole: 'item_table',
        candidates: left,
        exclusions: [],
      }),
    ).toEqual([
      { rowIndex: 2, block: 1 },
      { rowIndex: 3, block: 1 },
    ]);
    expect(
      unansweredItemTableBlocks(marked, {
        tableRole: 'item_table',
        candidates: [{ ...item(2, 1), identifierSourceId: null }],
        exclusions: [
          { sourceId: cellId(4, 1), category: 'summary_row', reason: '요약' },
          {
            sourceId: cellId(2, 0),
            category: 'passing_mention',
            reason: '언급',
          },
        ],
      }),
    ).toEqual([{ rowIndex: 2, block: 0 }]);
    expect(
      unansweredItemTableBlocks(unit, {
        tableRole: 'non_item_table',
        candidates: [],
        exclusions: [],
      }),
    ).toEqual([]);
    expect(
      unansweredItemTableBlocks(registry().unit, {
        tableRole: 'item_table',
        candidates: [],
        exclusions: [],
      }),
    ).toEqual([]);
  });

  test('narrows a follow-up unit to the cells of the asked blocks', () => {
    const { unit, cellId } = pairs();

    const narrowed = createFollowUpUnit(
      unit,
      [2, 3],
      [
        { rowIndex: 2, block: 1 },
        { rowIndex: 3, block: 1 },
      ],
    );

    expect(narrowed.resources.map((r) => r.key)).toEqual(
      [3, 4, 5]
        .flatMap((c) =>
          [2, 3].map((row) => cellId(row, c).replace('path:', '')),
        )
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
    );
  });
});
