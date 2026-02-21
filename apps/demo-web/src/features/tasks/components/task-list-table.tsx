'use client';

import type {
  ComponentUsageReport,
  PhaseUsageReport,
  TokenUsageReport,
} from '@heripo/model';
import type { MouseEvent } from 'react';

import {
  CheckCircle,
  Clock,
  FileText,
  Loader2,
  RotateCw,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Task, TaskStatus } from '~/lib/api/tasks';
import { sampleTaskConfig } from '~/lib/config/public-mode';
import { calculateCost } from '~/lib/cost/model-pricing';

import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';

import { useDeleteTask } from '../hooks/use-delete-task';
import { useTasks } from '../hooks/use-tasks';
import { Pagination } from './pagination';

const ITEMS_PER_PAGE = 10;

function calculatePhaseCost(phase: PhaseUsageReport): number {
  let cost = 0;
  if (phase.primary) {
    cost += calculateCost(
      phase.primary.modelName,
      phase.primary.inputTokens,
      phase.primary.outputTokens,
    );
  }
  if (phase.fallback) {
    cost += calculateCost(
      phase.fallback.modelName,
      phase.fallback.inputTokens,
      phase.fallback.outputTokens,
    );
  }
  return cost;
}

function calculateComponentCost(comp: ComponentUsageReport): number {
  return comp.phases.reduce((sum, phase) => sum + calculatePhaseCost(phase), 0);
}

function calculateTotalCost(tokenUsage: unknown): number | null {
  const usage = tokenUsage as TokenUsageReport | null;
  if (!usage?.components) return null;
  return usage.components.reduce(
    (sum, comp) => sum + calculateComponentCost(comp),
    0,
  );
}

function getStatusBadge(status: TaskStatus) {
  switch (status) {
    case 'queued':
      return (
        <Badge variant="secondary">
          <Clock className="mr-1 h-3 w-3" />
          Queued
        </Badge>
      );
    case 'running':
      return (
        <Badge variant="default">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Running
        </Badge>
      );
    case 'completed':
      return (
        <Badge variant="success">
          <CheckCircle className="mr-1 h-3 w-3" />
          Completed
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          Failed
        </Badge>
      );
    case 'cancelled':
      return <Badge variant="outline">Cancelled</Badge>;
    default:
      return null;
  }
}

export function TaskListTable() {
  const router = useRouter();
  const [page, setPage] = useState(0);

  const { data, isLoading, isFetching, error, refetch } = useTasks({
    limit: ITEMS_PER_PAGE,
    offset: page * ITEMS_PER_PAGE,
  });

  const deleteTaskMutation = useDeleteTask();

  const handleRowClick = (task: Task) => {
    if (task.status === 'completed') {
      router.push(`/result/${task.id}`);
    } else if (
      task.status === 'running' ||
      task.status === 'queued' ||
      task.status === 'failed'
    ) {
      router.push(`/process/${task.id}`);
    }
  };

  const handleCancel = (e: MouseEvent<HTMLButtonElement>, taskId: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to cancel this task?')) return;

    deleteTaskMutation.mutate(taskId);
  };

  const handleDelete = (e: MouseEvent<HTMLButtonElement>, taskId: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this task?')) return;

    deleteTaskMutation.mutate(taskId);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-red-600">
        Error loading tasks: {error.message}
      </div>
    );
  }

  const tasks = data?.tasks ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  if (tasks.length === 0 && page === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        No tasks yet. Upload a PDF to get started.
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RotateCw
            className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-52">Filename</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="min-w-28 text-right">Cost (USD)</TableHead>
            <TableHead className="w-24 text-right">Chapters</TableHead>
            <TableHead className="w-20 text-right">Images</TableHead>
            <TableHead className="min-w-48">Created</TableHead>
            <TableHead className="w-20"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TableRow
              key={task.id}
              className="cursor-pointer"
              onClick={() => handleRowClick(task)}
            >
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{task.originalFilename}</span>
                  {task.isSample && (
                    <Badge variant="sample" className="shrink-0">
                      Sample
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>{getStatusBadge(task.status)}</TableCell>
              <TableCell className="text-right">
                {(() => {
                  const cost = calculateTotalCost(task.tokenUsage);
                  return cost !== null ? `$${cost.toFixed(4)}` : '-';
                })()}
              </TableCell>
              <TableCell className="text-right">
                {task.chaptersCount ?? '-'}
              </TableCell>
              <TableCell className="text-right">
                {task.imagesCount ?? '-'}
              </TableCell>
              <TableCell>
                {new Date(task.createdAt).toLocaleString(undefined, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </TableCell>
              <TableCell>
                {task.isSample && !sampleTaskConfig.allowDeletion ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled
                    title="Sample tasks cannot be deleted"
                  >
                    <Trash2 className="h-4 w-4 opacity-50" />
                  </Button>
                ) : task.status === 'queued' || task.status === 'running' ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => handleCancel(e, task.id)}
                    disabled={deleteTaskMutation.isPending}
                    title="Cancel task"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => handleDelete(e, task.id)}
                    disabled={deleteTaskMutation.isPending}
                    title="Delete task"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </>
  );
}
