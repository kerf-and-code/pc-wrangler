import React from "react";

// components/ui-forge/DataTable.tsx
//
// A thin wrapper that guarantees the one thing every table on the app needs and one was missing:
// an overflow-x scroll container, so a wide table scrolls instead of blowing out the page on a
// narrow screen. It also applies the shared table defaults (full width, collapsed borders). Put
// the usual <thead>/<tbody> inside; style the wrapper via `wrapStyle` and the table via `style`.

type Props = React.TableHTMLAttributes<HTMLTableElement> & {
  wrapStyle?: React.CSSProperties;
};

export default function DataTable({ wrapStyle, style, children, ...rest }: Props) {
  return (
    <div style={{ overflowX: "auto", ...wrapStyle }}>
      <table style={{ width: "100%", borderCollapse: "collapse", ...style }} {...rest}>
        {children}
      </table>
    </div>
  );
}
