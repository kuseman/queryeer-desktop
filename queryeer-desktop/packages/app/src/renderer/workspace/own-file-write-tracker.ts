type FileWriteResult = { success: boolean };
type FileReadResult = { success: boolean; content: string };

type WriteState = {
  tail: Promise<void>;
  generation: number;
  lastSuccessfulContent?: string;
};

export class OwnFileWriteTracker {
  private readonly states = new Map<string, WriteState>();

  write(
    uri: string,
    content: string,
    writer: () => Promise<FileWriteResult>
  ): Promise<FileWriteResult> {
    const state = this.getState(uri);
    const operation = state.tail.catch(() => {}).then(async () => {
      const result = await writer();
      if (result.success) {
        state.lastSuccessfulContent = content;
        state.generation += 1;
      }
      return result;
    });
    state.tail = operation.then(() => {}, () => {});
    return operation;
  }

  async matchesCurrentDiskContent(
    uri: string,
    reader: () => Promise<FileReadResult>
  ): Promise<boolean> {
    const state = this.states.get(uri);
    if (!state) {
      return false;
    }

    while (true) {
      const tail = state.tail;
      await tail;
      const generation = state.generation;
      const expectedContent = state.lastSuccessfulContent;
      if (expectedContent === undefined) {
        return false;
      }

      const result = await reader();
      if (state.tail !== tail || state.generation !== generation) {
        continue;
      }
      return result.success && result.content === expectedContent;
    }
  }

  private getState(uri: string): WriteState {
    let state = this.states.get(uri);
    if (!state) {
      state = { tail: Promise.resolve(), generation: 0 };
      this.states.set(uri, state);
    }
    return state;
  }
}
