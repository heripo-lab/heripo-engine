'use client';

import type { DragEndEvent } from '@dnd-kit/core';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronDown, GripVertical, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '~/lib/utils';

import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface MultiSelectOption {
  label: string;
  value: string;
}

interface SortableMultiSelectProps {
  options: readonly MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

interface SortableTagProps {
  id: string;
  label: string;
  onRemove: () => void;
  disabled?: boolean;
}

function SortableTag({ id, label, onRemove, disabled }: SortableTagProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-secondary text-secondary-foreground flex items-center gap-1 rounded-md px-2 py-1 text-sm',
        isDragging && 'opacity-50',
        disabled && 'opacity-50',
      )}
    >
      <button
        type="button"
        className={cn(
          'touch-none',
          disabled ? 'cursor-not-allowed' : 'cursor-grab',
        )}
        {...attributes}
        {...listeners}
        disabled={disabled}
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <span>{label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="hover:bg-secondary-foreground/20 rounded-sm"
        disabled={disabled}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function SortableMultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select items...',
  disabled = false,
}: SortableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = value.indexOf(active.id as string);
      const newIndex = value.indexOf(over.id as string);
      onChange(arrayMove(value, oldIndex, newIndex));
    }
  };

  const handleToggle = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const handleRemove = (optionValue: string) => {
    onChange(value.filter((v) => v !== optionValue));
  };

  const getLabel = (optionValue: string) => {
    return options.find((o) => o.value === optionValue)?.label ?? optionValue;
  };

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="combobox"
          tabIndex={disabled ? -1 : 0}
          className={cn(
            'border-input ring-offset-background focus:ring-ring flex min-h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus:ring-1 focus:outline-none',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
        >
          <div className="flex flex-1 flex-wrap gap-1">
            {value.length > 0 ? (
              mounted ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={value}
                    strategy={horizontalListSortingStrategy}
                  >
                    {value.map((v) => (
                      <SortableTag
                        key={v}
                        id={v}
                        label={getLabel(v)}
                        onRemove={() => handleRemove(v)}
                        disabled={disabled}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                value.map((v) => (
                  <div
                    key={v}
                    className="bg-secondary text-secondary-foreground flex items-center gap-1 rounded-md px-2 py-1 text-sm"
                  >
                    <GripVertical className="h-3 w-3" />
                    <span>{getLabel(v)}</span>
                    <X className="h-3 w-3" />
                  </div>
                ))
              )
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </div>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <div className="max-h-60 overflow-auto p-1">
          {options.map((option) => {
            const isSelected = value.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleToggle(option.value)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
                  'hover:bg-accent hover:text-accent-foreground',
                  'focus:bg-accent focus:text-accent-foreground',
                )}
              >
                <div
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-sm border',
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-input',
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                {option.label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
