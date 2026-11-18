// Глобальные имена, которые app.js получает из vendor/ и data.js. Версии — как в vendor/LICENSES.txt.
import type MarkdownIt from "markdown-it";
import type { PluginSimple } from "markdown-it";
import type { DOMPurify } from "dompurify";
import type { HLJSApi } from "highlight.js";
import type { RenderRule } from "markdown-it/lib/renderer.mjs";
import type Token from "markdown-it/lib/token.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";

declare global {
  /** правило рендера markdown-it — для JSDoc в app.js */
  type MdRenderRule = RenderRule;
  /** токен и состояние ядра markdown-it — для помощников правил в app.js */
  type MdToken = Token;
  type MdStateCore = StateCore;

  /** то, чем app.js пользуется из mermaid 11 (vendor/mermaid.min.js, грузится лениво) */
  interface MermaidApi {
    initialize(config: Record<string, unknown>): void;
    parse(text: string): Promise<unknown>;
    render(id: string, text: string): Promise<{ svg: string }>;
  }

  interface Window {
    markdownit: typeof MarkdownIt;
    markdownitFootnote: PluginSimple;
    DOMPurify: DOMPurify;
    hljs: HLJSApi;
    /** есть только после первой схемы на странице */
    mermaid?: MermaidApi;
    /** data.js — граница ввода: проверяется в app.js (isData) */
    MDV_DATA?: unknown;
    /** assets.js — граница ввода: проверяется в app.js (loadAssets) */
    MDV_ASSETS?: unknown;
    /** overview.js — вид «Обзор» и «Показ» для БТ и спеки; show() зовёт render() и mounted() */
    CoddocView?: {
      attach(api: object): void;
      render(e: object, out: { html: string, headings: Array<{ level: number, text: string, id: string }> }):
        { html: string, headings: Array<{ level: number, text: string, id: string }> } | null;
      mounted(e: object, doc: HTMLElement): void;
    };
    /** layouts.js (пишут pack.sh / pack.ps1) — граница ввода: проверяется в layout.js (parseLayout) */
    CODDOC_LAYOUTS?: unknown;
    CODDOC_LAYOUT_DIR?: unknown;
    /** layout.js — своя раскладка «Обзора» */
    CoddocLayout?: {
      attach(api: { rerender(): void, toast?(text: string): void }): void;
      render(view: string, label: string, items: Array<{ key: string, title: string, html: string, span: number,
        heads: Array<{ level: number, text: string, id: string }>, head: boolean }>):
        { html: string, headings: Array<{ level: number, text: string, id: string }> };
      mounted(doc: HTMLElement): void;
      test: object;
    };
    /** File System Access (Chrome, Edge): выбор папки; в других браузерах нет — проверять typeof */
    showDirectoryPicker?(opts?: { id?: string, mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
  }
  /** разрешения выбранной папки — Chrome, Edge; в lib.dom их нет */
  interface FileSystemHandle {
    queryPermission?(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
    requestPermission?(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  }
}

export {};
