"use client";

import React from "react";
import { Select, Label } from "./Field";

// components/ui-forge/CampaignPicker.tsx
//
// The "pick a campaign" selector re-implemented on ~14 pages (a label, a select, a "No campaigns
// yet" empty option). Presentational and controlled: the page still owns the campaigns list and the
// selected id, so this changes no data flow, it only removes the copy-paste. Fetch the list and
// track `value` in the page exactly as before, and hand them down.

type Campaign = { id: string; name: string };

type Props = {
  campaigns: Campaign[];
  value: string;
  onChange: (id: string) => void;
  label?: string | null;
  emptyLabel?: string;
  style?: React.CSSProperties;
  selectStyle?: React.CSSProperties;
};

export default function CampaignPicker({
  campaigns,
  value,
  onChange,
  label = "Campaign",
  emptyLabel = "No campaigns yet",
  style,
  selectStyle,
}: Props) {
  return (
    <div style={style}>
      {label ? <Label>{label}</Label> : null}
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ display: "block", width: "100%", marginTop: label ? 6 : 0, ...selectStyle }}
      >
        {campaigns.length === 0 && <option value="">{emptyLabel}</option>}
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
