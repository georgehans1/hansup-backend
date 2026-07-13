declare const process: {
  env: Record<string, string | undefined>;
};

declare const Buffer: {
  isBuffer(value: unknown): boolean;
  from(value: string, encoding?: string): { toString(encoding?: string): string };
  from(value: unknown): { toString(encoding?: string): string };
  concat(values: unknown[]): { toString(encoding?: string): string };
  byteLength(value: string): number;
};

declare function fetch(url: string): Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}>;
declare function fetch(url: string, init: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}): Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}>;

declare class URLSearchParams {
  constructor(values?: Record<string, string>);
}

declare module "node:http" {
  const http: {
    createServer(handler: (req: any, res: any) => void | Promise<void>): any;
  };
  export default http;
}

declare module "node:http2" {
  const http2: {
    connect(authority: string): any;
  };
  export default http2;
}

declare module "node:url" {
  export class URL {
    constructor(input: string, base?: string);
    pathname: string;
    searchParams: {
      get(name: string): string | null;
    };
  }
}

declare module "node:crypto" {
  export function createHmac(algorithm: string, key: string): {
    update(value: string): any;
    digest(encoding: string): string;
  };
  export function createSign(algorithm: string): {
    update(value: string): any;
    end(): void;
    sign(key: string): { toString(encoding: string): string };
  };
  export function randomBytes(size: number): { toString(encoding: string): string };
}

declare module "node:fs" {
  export function readFileSync(path: any, encoding: string): string;
  export function existsSync(path: string): boolean;
}

declare module "pg" {
  export class Pool {
    constructor(config: { connectionString: string; ssl?: boolean | { ca?: string; rejectUnauthorized: boolean } });
    query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  }
}

declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}

declare module "node:test" {
  const test: any;
  export default test;
}
