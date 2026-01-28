'use client';

import type { FC, ReactNode } from 'react';

import type { ProcessingFormValues } from '../types/form-values';

import { createContext, useContext } from 'react';

/**
 * Form instance type for processing form.
 * Using a simplified interface to avoid complex generic type issues with @tanstack/react-form.
 */
export interface ProcessingFormInstance {
  Field: FC<{
    name: keyof ProcessingFormValues;
    children: (field: {
      state: { value: ProcessingFormValues[keyof ProcessingFormValues] };
      handleChange: (
        value: ProcessingFormValues[keyof ProcessingFormValues],
      ) => void;
    }) => ReactNode;
  }>;
  Subscribe: FC<{
    selector: (state: { values: ProcessingFormValues }) => unknown;
    children: (value: unknown) => ReactNode;
  }>;
  handleSubmit: () => void;
}

const ProcessingFormContext = createContext<any>(null);

interface ProcessingFormProviderProps {
  form: any;
  children: ReactNode;
}

export function ProcessingFormProvider({
  form,
  children,
}: ProcessingFormProviderProps) {
  return (
    <ProcessingFormContext.Provider value={form}>
      {children}
    </ProcessingFormContext.Provider>
  );
}

export function useProcessingForm(): any {
  const context = useContext(ProcessingFormContext);
  if (!context) {
    throw new Error(
      'useProcessingForm must be used within ProcessingFormProvider',
    );
  }
  return context;
}
