import type { TextEditorModel } from "./TextEditorModel";

export interface TextEditorRepositoryState {
  applyRecoveredContent(fileId: string, text: string): void;
  onContentDirty(
    listener: (fileId: string, text: string) => void
  ): () => void;
  updateModelContent(uri: string, content: string): void;
}

export interface TextEditorModelRepository {
  getModelForFile(fileId: string): TextEditorModel | undefined;
  getModelForUri(uri: string): TextEditorModel | undefined;
}

const repositories: TextEditorModelRepository[] = [];
const stateRepositories: TextEditorRepositoryState[] = [];

export function registerTextEditorRepository(
  repo: TextEditorModelRepository & TextEditorRepositoryState
): void {
  repositories.push(repo);
  stateRepositories.push(repo);
}

export function getTextEditorModelRepositories(): readonly TextEditorModelRepository[] {
  return repositories;
}

export function getTextEditorRepositoryStates(): readonly TextEditorRepositoryState[] {
  return stateRepositories;
}
