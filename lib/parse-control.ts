export type ParseLease = {
  id: number;
  signal: AbortSignal;
};

export type ParseControl = {
  begin(): ParseLease | null;
  cancel(): void;
  complete(id: number): boolean;
  isCurrent(id: number): boolean;
  readonly busy: boolean;
};

export function createParseControl(): ParseControl {
  let nextId = 0;
  let currentId = 0;
  let controller: AbortController | null = null;

  const control: ParseControl = {
    begin() {
      if (control.busy) return null;
      const id = ++nextId;
      currentId = id;
      controller = new AbortController();
      return { id, signal: controller.signal };
    },
    cancel() {
      currentId = 0;
      controller?.abort();
      controller = null;
    },
    complete(id) {
      if (id !== currentId) return false;
      currentId = 0;
      controller = null;
      return true;
    },
    isCurrent(id) {
      return currentId !== 0 && id === currentId;
    },
    get busy() {
      return currentId !== 0;
    },
  };

  return control;
}
