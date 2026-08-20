// components/json-ld.tsx
//
// Renders one or more schema.org objects as a <script type="application/ld+json"> tag. Server
// component (no "use client"): the script ships in the initial HTML, which is the whole point -
// crawlers read it without executing JS.
//
// dangerouslySetInnerHTML is the correct tool here and is safe: every value comes from lib/seo.ts,
// which serializes only static, controlled content - never user input.

export default function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      // Escape "<" so a stray sequence can never break out of the script element.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
