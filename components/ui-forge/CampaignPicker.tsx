"use client";

import React, { useId } from "react";
import { Select, Label } from "./Field";

// components/ui-forge/CampaignPicker.tsx
//
// The "pick a campaign" selector re-implemented on ~14 pages (a label, a select, a "No campaigns
// yet" empty option). Presentational and controlled: the page still owns the campaigns list and the
// selected id, so this changes no data flow, it only removes the copy-paste. Fetch the list and
// track `value` in the page exactly as before, and hand them down.
//
// The label is tied to the select (audit U12), and with label={null} the select still has an
// accessible name. selectStyle lets a page keep its own field look while sharing the markup.

type Campaign = { id: string; name: string };

type Props = {
  campaigns: Campaign[];
  value: string;
  onChange: (id: string) => void;
  label?: string | null;
  emptyLabel?: string;
  /** An always-present first choice with an empty value, such as "Pick a campaign". */
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  selectStyle?: React.CSSProperties;
};

export default function CampaignPicker({
  campaigns,
  value,
  onChange,
  label = "Campaign",
  emptyLabel = "No campaigns yet",
  placeholder,
  disabled,
  style,
  selectStyle,
}: Props) {
  const id = useId();
  const options = (
    <>
      {placeholder ? <option value="">{placeholder}</option> : campaigns.length === 0 && <option value="">{emptyLabel}</option>}
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </>
  );
  // A page that passes its own field style gets a plain select with exactly that style (the kit's
  // carved Select would also bring its width, padding and font size); otherwise the kit's Select.
  const Sel = selectStyle ? "select" : Select;
  // No visible label: just the select, so it sits in a page's own row exactly where it did before.
  if (!label) {
    return (
      <Sel aria-label="Campaign" value={value} disabled={disabled} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)} style={{ ...style, ...selectStyle }}>
        {options}
      </Sel>
    );
  }
  return (
    <div style={style}>
      <Label htmlFor={id}>{label}</Label>
      <Sel
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        style={{ display: "block", width: "100%", marginTop: 6, ...selectStyle }}
      >
        {options}
      </Sel>
    </div>
  );
}
