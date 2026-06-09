/* Puter.js global types (loaded via CDN script in index.html) */

declare global {
  interface PuterAI {
    chat(text: string, options?: { model?: string; stream?: boolean }): Promise<{
      message?: { content: string };
      text?: string;
      id?: string;
    }>;
  }

  interface PuterFS {
    write(path: string, data: string | Blob | ArrayBuffer): Promise<void>;
    read(path: string): Promise<Blob | string>;
    readdir(path: string): Promise<string[]>;
    mkdir(path: string): Promise<void>;
  }

  interface PuterKV {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    del(key: string): Promise<void>;
  }

  interface Puter {
    ai: PuterAI;
    fs: PuterFS;
    kv: PuterKV;
    print: (...args: unknown[]) => void;
  }

  const puter: Puter;
}

export {};
