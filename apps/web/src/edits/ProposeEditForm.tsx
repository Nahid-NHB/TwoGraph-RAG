import { useState, type FormEvent } from 'react';
import { useProposeEdit } from '../api/hooks.js';

interface FieldSpec {
  name: string;
  label: string;
  kind: 'text' | 'number' | 'checkbox' | 'json';
  optional?: boolean;
}

interface OperationSpec {
  id: string;
  label: string;
  fields: FieldSpec[];
}

const OPERATIONS: OperationSpec[] = [
  {
    id: 'rename_symbol',
    label: 'Rename symbol',
    fields: [
      { name: 'symbolId', label: 'Symbol ID', kind: 'text' },
      { name: 'newName', label: 'New name', kind: 'text' },
    ],
  },
  {
    id: 'add_parameter',
    label: 'Add parameter',
    fields: [
      { name: 'symbolId', label: 'Symbol ID', kind: 'text' },
      { name: 'name', label: 'Parameter name', kind: 'text' },
      { name: 'type', label: 'Type', kind: 'text' },
      { name: 'defaultValue', label: 'Default value (expression)', kind: 'text', optional: true },
    ],
  },
  {
    id: 'remove_parameter',
    label: 'Remove parameter',
    fields: [
      { name: 'symbolId', label: 'Symbol ID', kind: 'text' },
      { name: 'paramName', label: 'Parameter name', kind: 'text' },
      { name: 'force', label: 'Force (remove even if used)', kind: 'checkbox', optional: true },
    ],
  },
  {
    id: 'move_function',
    label: 'Move function',
    fields: [
      { name: 'symbolId', label: 'Symbol ID', kind: 'text' },
      { name: 'targetFile', label: 'Target file (repo-relative)', kind: 'text' },
    ],
  },
  {
    id: 'extract_function',
    label: 'Extract function',
    fields: [
      { name: 'file', label: 'File (repo-relative)', kind: 'text' },
      { name: 'startLine', label: 'Start line', kind: 'number' },
      { name: 'endLine', label: 'End line', kind: 'number' },
      { name: 'name', label: 'New function name', kind: 'text' },
    ],
  },
  {
    id: 'update_imports',
    label: 'Update imports',
    fields: [
      { name: 'file', label: 'File (repo-relative)', kind: 'text' },
      { name: 'add', label: 'Add (JSON array, optional)', kind: 'json', optional: true },
      { name: 'remove', label: 'Remove (JSON array, optional)', kind: 'json', optional: true },
      { name: 'organize', label: 'Organize imports', kind: 'checkbox', optional: true },
    ],
  },
];

const fieldClass =
  'mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

/** Propose-edit form covering every registered operation (issue #61). */
export function ProposeEditForm({
  repoId,
  initialOperation,
  initialParams,
  onProposed,
}: {
  repoId: string | undefined;
  initialOperation?: string | undefined;
  initialParams?: Record<string, unknown> | undefined;
  onProposed: (editId: string) => void;
}) {
  const [operationId, setOperationId] = useState(initialOperation ?? OPERATIONS[0]!.id);
  const operation = OPERATIONS.find((o) => o.id === operationId) ?? OPERATIONS[0]!;
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    initialParams
      ? Object.fromEntries(
          Object.entries(initialParams).map(([k, v]) => [
            k,
            typeof v === 'boolean' ? v : String(v),
          ]),
        )
      : {},
  );
  const [error, setError] = useState<string | null>(null);
  const propose = useProposeEdit(repoId);

  function setField(name: string, value: string | boolean): void {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const params: Record<string, unknown> = {};
      for (const field of operation.fields) {
        const raw = values[field.name];
        if (raw === undefined || raw === '') {
          if (!field.optional) throw new Error(`${field.label} is required`);
          continue;
        }
        if (field.kind === 'number') params[field.name] = Number(raw);
        else if (field.kind === 'checkbox') params[field.name] = Boolean(raw);
        else if (field.kind === 'json') params[field.name] = JSON.parse(String(raw));
        else params[field.name] = raw;
      }
      const edit = await propose.mutateAsync({ operation: operationId, params });
      setValues({});
      onProposed(edit.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to propose edit');
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2 p-3">
      <select
        value={operationId}
        onChange={(e) => {
          setOperationId(e.target.value);
          setValues({});
          setError(null);
        }}
        className={fieldClass}
      >
        {OPERATIONS.map((op) => (
          <option key={op.id} value={op.id}>
            {op.label}
          </option>
        ))}
      </select>

      {operation.fields.map((field) => (
        <label key={field.name} className="block text-xs text-slate-500 dark:text-slate-400">
          {field.label}
          {field.kind === 'checkbox' ? (
            <input
              type="checkbox"
              checked={Boolean(values[field.name])}
              onChange={(e) => setField(field.name, e.target.checked)}
              className="ml-2 align-middle"
            />
          ) : field.kind === 'json' ? (
            <textarea
              value={String(values[field.name] ?? '')}
              onChange={(e) => setField(field.name, e.target.value)}
              rows={2}
              className={`${fieldClass} font-mono`}
            />
          ) : (
            <input
              type={field.kind === 'number' ? 'number' : 'text'}
              value={String(values[field.name] ?? '')}
              onChange={(e) => setField(field.name, e.target.value)}
              className={fieldClass}
            />
          )}
        </label>
      ))}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={propose.isPending}
        className="w-full rounded-md bg-slate-900 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {propose.isPending ? 'Proposing…' : 'Propose edit'}
      </button>
    </form>
  );
}
