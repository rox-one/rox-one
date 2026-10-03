/** ROX security patch: rebuild a conservative HTML subset from parsed tokens.
 * Raw CSS, foreign content and executable elements are intentionally unsupported.
 * Diagram SVG is generated separately after this untrusted-markdown boundary. */
import { Parser } from "htmlparser2";
const tags = new Set("p br hr h1 h2 h3 h4 h5 h6 blockquote pre code em strong del s b i u ul ol li dl dt dd table thead tbody tfoot tr th td caption div span section article figure figcaption a img sup sub details summary".split(" "));
const voids = new Set(["br", "hr", "img"]);
const discard = new Set("script style svg math iframe object embed template noscript textarea xmp plaintext".split(" "));
const attrs = new Set("id class title alt width height colspan rowspan align scope start reversed open".split(" "));
function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function safeUrl(value: string, image: boolean): boolean {
  // Entity decoding already occurred in the parser. Reject control/backslash
  // normalization and unknown schemes before serializing a fresh attribute.
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (value.startsWith("//")) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (scheme === "http" || scheme === "https") return true;
  if (!image && scheme === "mailto") return true;
  return image && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value);
}
export function sanitizeParsedHtml(html: string): string {
  const output: string[] = [];
  const stack: Array<{ name: string; emitted: boolean; blocked: boolean }> = [];
  let blocked = 0;
  const parser = new Parser({
    onopentag(name: string, attributes: Record<string, string>) {
      const suppress = discard.has(name);
      const emitted = blocked === 0 && !suppress && tags.has(name);
      stack.push({ name, emitted, blocked: suppress });
      if (suppress) blocked++;
      if (!emitted) return;
      let token = `<${name}`;
      for (const [key, value] of Object.entries(attributes)) {
        if ((key === "href" && name === "a") || (key === "src" && name === "img")) {
          if (safeUrl(value, key === "src")) token += ` ${key}="${escape(value)}"`;
        } else if (attrs.has(key) || /^data-gstack-[a-z0-9-]+$/.test(key)) {
          token += ` ${key}="${escape(value)}"`;
        }
      }
      output.push(token + ">");
    },
    ontext(text: string) { if (!blocked) output.push(escape(text)); },
    onclosetag(name: string) {
      const index = stack.map(entry => entry.name).lastIndexOf(name);
      if (index < 0) return;
      while (stack.length > index) {
        const entry = stack.pop()!;
        if (entry.blocked) blocked--;
        if (entry.emitted && !voids.has(entry.name)) output.push(`</${entry.name}>`);
      }
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.end(html);
  return output.join("");
}

/** Separate SVG boundary: diagrams retain vector geometry, never foreign HTML,
 * scripts, remote resources, CSS escapes or event callbacks. */
export function sanitizeDiagramSvg(svg: string): string {
  const allowed = new Set("svg g path rect circle ellipse line polyline polygon text tspan defs marker clipPath mask title desc".toLowerCase().split(" "));
  const attributes = new Set("id class xmlns viewbox x y x1 y1 x2 y2 dx dy width height d points r rx ry cx cy transform text-anchor dominant-baseline font-size font-family font-weight stroke-width stroke-dasharray stroke-linecap stroke-linejoin opacity fill-opacity stroke-opacity markerwidth markerheight refx refy orient markerunits preserveaspectratio".split(" "));
  const output: string[] = [];
  const stack: Array<{ name: string; emitted: boolean }> = [];
  let excluded = 0;
  const parser = new Parser({
    onopentag(name: string, values: Record<string, string>) {
      const emitted = excluded === 0 && allowed.has(name);
      stack.push({ name, emitted });
      if (!emitted) { excluded++; return; }
      let token = `<${name}`;
      for (const [key, value] of Object.entries(values)) {
        if (/[\u0000-\u001f\u007f\\]/.test(value)) continue;
        if (attributes.has(key)) token += ` ${key}="${escape(value)}"`;
        else if (["fill", "stroke", "marker-start", "marker-mid", "marker-end", "clip-path"].includes(key)) {
          if (/^(?:#[a-z0-9_-]+|[a-z]+|[a-z]+\([0-9.,% ]+\)|url\(#[a-z0-9_-]+\))$/i.test(value)) token += ` ${key}="${escape(value)}"`;
        } else if ((key === "href" || key === "xlink:href") && /^#[a-z0-9_-]+$/i.test(value)) {
          token += ` ${key}="${escape(value)}"`;
        }
      }
      output.push(token + ">");
    },
    ontext(text: string) { if (!excluded) output.push(escape(text)); },
    onclosetag(name: string) {
      const index = stack.map(entry => entry.name).lastIndexOf(name);
      if (index < 0) return;
      while (stack.length > index) {
        const entry = stack.pop()!;
        if (!entry.emitted) excluded--;
        else output.push(`</${entry.name}>`);
      }
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.end(svg);
  return output.join("");
}
