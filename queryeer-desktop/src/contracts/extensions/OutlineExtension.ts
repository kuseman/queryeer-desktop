import type { TextRange } from "../editor/EditorApi.js";

export type SymbolKind =
  | "File"
  | "Module"
  | "Namespace"
  | "Package"
  | "Class"
  | "Method"
  | "Property"
  | "Field"
  | "Constructor"
  | "Enum"
  | "Interface"
  | "Function"
  | "Variable"
  | "Constant"
  | "String"
  | "Number"
  | "Boolean"
  | "Array"
  | "Object"
  | "Key"
  | "Null"
  | "EnumMember"
  | "Struct"
  | "Event"
  | "Operator"
  | "TypeParameter";

export type OutlineSymbol = {
  id: string;
  name: string;
  detail?: string;
  kind: SymbolKind;
  tags?: string[];
  range: TextRange;
  selectionRange: TextRange;
  children?: OutlineSymbol[];
};

export type OutlineProvider = (
  content: string
) => OutlineSymbol[] | Promise<OutlineSymbol[]>;

export type OutlineProviderRegistration = {
  mimeType: string;
  provider: OutlineProvider;
};

export type OutlineRegistry = {
  registerOutlineProvider: (registration: OutlineProviderRegistration) => void;
  registerSupplementaryOutlineProvider: (registration: OutlineProviderRegistration) => void;
  hasProvider: (mimeType: string) => boolean;
  getProvider: (mimeType: string) => OutlineProvider | undefined;
  getSymbols: (mimeType: string, content: string) => Promise<OutlineSymbol[]>;
};
