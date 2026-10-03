/** Minimal declaration of the htmlparser2 3.10.1 callback API used here.
 * Runtime shape verified by the ROX parser regression tests. */
declare module "htmlparser2" {
  export interface ParserCallbacks {
    onopentag?: (name: string, attributes: Record<string, string>) => void;
    ontext?: (text: string) => void;
    onclosetag?: (name: string) => void;
  }
  export interface ParserOptions {
    decodeEntities?: boolean;
    lowerCaseTags?: boolean;
    lowerCaseAttributeNames?: boolean;
  }
  export class Parser {
    constructor(callbacks: ParserCallbacks, options?: ParserOptions);
    end(input?: string): void;
  }
}
